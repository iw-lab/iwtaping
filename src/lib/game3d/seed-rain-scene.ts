/**
 * 씨앗비 3D 장면 — 구름 섬에서 씨앗 캡슐이 내려오고, 맞히면 화분으로 날아가 꽃이 핀다 · 놓치면 흙이 시든다.
 * 게임 상태·판정은 코어(`lib/game/rain/core.ts`)의 화면 픽셀 그대로다. 이 장면은 그 픽셀을
 * 카메라 광선으로 낙하면(z=0)에 투영해 캡슐을 놓기만 한다 → 2D 라벨과 캡슐이 정확히 겹친다.
 * 성능 규칙(GDD-3D §9): DPR 1 · 안티앨리어싱·그림자·후처리 0 · Lambert 재질(소프트웨어 GL 에서 PBR 은 픽셀마다 비싸다)
 *   · 정적인 것(구름·화분)은 한 덩어리로 합치고 흙은 InstancedMesh · 빗방울 InstancedMesh 하나 · 드로 콜 ≤ 30(실측 58 → 줄임).
 * three 는 이 파일을 동적 import 할 때만 받는다(게임에 들어갈 때만 전송).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RainWord, Ability } from '@/lib/game/rain/core';

export interface SeedRainScene {
  /** 매 프레임 — 살아 있는 단어를 캡슐로 그린다. shiftOf = 라벨이 비켜 선 거리 */
  render(words: readonly RainWord[], time: number, frozen: boolean): void;
  /** 맞힘 — 캡슐이 화분으로 날아가 꽃이 핀다(번쩍·찌그러짐·줌 펀치) */
  hit(word: RainWord): void;
  /** 놓침 — 가장 가까운 화분의 흙이 시든다 */
  miss(word: RainWord): void;
  ability(kind: Ability): void;
  resize(W: number, H: number): void;
  dispose(): void;
  info(): { geometries: number; textures: number; calls: number; triangles: number; quality: number };
}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

const POTS = 7;
const RAIN_DROPS = 260;
const FLY_MS = 380;
const KICK_MS = 200;

interface Flying { mesh: THREE.Mesh; from: THREE.Vector3; pot: number; t0: number }
interface Pot { pos: THREE.Vector3; flower: THREE.Mesh; bloom: number; target: number; wilt: number; x: number }

export function createSeedRainScene(canvas: HTMLCanvasElement, W0: number, H0: number): SeedRainScene {
  let W = W0;
  let H = H0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // 하늘 = 세로 그라데이션 텍스처 1장(2×256) — 위는 비구름 보라, 아래는 새벽빛
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
  const sg = sky.getContext('2d');
  if (sg) {
    const gr = sg.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#3b3f8f'); gr.addColorStop(0.55, '#6a7fd0'); gr.addColorStop(1, '#f2c9a0');
    sg.fillStyle = gr; sg.fillRect(0, 0, 2, 256);
  }
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog('#8a8fd6', 16, 34);

  // 고정 정면 사선 20° — 입력 중 카메라는 움직이지 않는다(줌 펀치는 단어 완성 뒤 0.2초만)
  const BASE_FOV = 42;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, W / H, 0.1, 60);
  camera.position.set(0, 3.6, 12);
  camera.lookAt(0, -0.4, 0);
  // 🔴 unproject 는 matrixWorld 를 쓴다 — 첫 render 전엔 단위행렬이라 화분·구름 자리가 화면 가운데로 틀어졌다(실측)
  camera.updateMatrixWorld();

  scene.add(new THREE.HemisphereLight('#e6ecff', '#5a4a3a', 1.7));
  const sun = new THREE.DirectionalLight('#fff3d6', 1.5);
  sun.position.set(3, 6, 8);
  scene.add(sun);

  // ── 화면 픽셀 → 낙하면(z=0) 위 점. 광선과 평면의 교점이라 라벨과 정확히 겹친다.
  const ndc = new THREE.Vector3();
  const dir = new THREE.Vector3();
  function pixelToWorld(px: number, py: number, out: THREE.Vector3, z = 0): THREE.Vector3 {
    ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1, 0.5).unproject(camera);
    dir.copy(ndc).sub(camera.position).normalize();
    const t = (z - camera.position.z) / dir.z;
    return out.copy(camera.position).addScaledVector(dir, t);
  }
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  let unit = 0; // 낙하면에서 화면 1px 의 월드 길이
  function measure() {
    pixelToWorld(0, H / 2, tmpA);
    pixelToWorld(W, H / 2, tmpB);
    unit = (tmpB.x - tmpA.x) / W;
  }
  measure();

  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { owned.push(x); return x; };

  // ── 구름 섬(위) — 씨앗이 내려오는 곳 · 덩이 9개를 한 geometry 로(드로 콜 1)
  const cloudMat = own(new THREE.MeshLambertMaterial({ color: '#f4f6ff', emissive: '#5a5f9a', flatShading: true }));
  const puffs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const k = 0.9 + ((i * 37) % 7) * 0.12;
    g.scale(k * 1.4, k * 0.7, k);
    g.translate((i - 4) * 1.55, ((i * 13) % 5) * 0.12, -1.5 - (i % 3) * 0.4);
    puffs.push(g);
  }
  const cloud = new THREE.Mesh(own(mergeGeometries(puffs)), cloudMat);
  for (const g of puffs) g.dispose();
  scene.add(cloud);

  // ── 땅(아래) + 화분 7개 — 화분 몸통은 한 덩어리 · 흙은 InstancedMesh(시들면 색이 바랜다) · 꽃은 화분마다 1개(줄기+꽃잎을 정점색으로 합침)
  const groundMat = own(new THREE.MeshLambertMaterial({ color: '#3f8f4f' }));
  const ground = new THREE.Mesh(own(new THREE.BoxGeometry(40, 0.6, 6)), groundMat);
  scene.add(ground);
  // 먼 언덕(깊이감) — 낮은 원뿔 몇 개를 한 덩어리로
  const hillParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.ConeGeometry(2.2 + (i % 3) * 0.8, 0.9 + ((i * 7) % 4) * 0.3, 7);
    g.translate((i - 3) * 3.6 + ((i * 13) % 5) * 0.3, 0, -6 - (i % 2) * 2);
    hillParts.push(g);
  }
  const hills = new THREE.Mesh(own(mergeGeometries(hillParts)), own(new THREE.MeshLambertMaterial({ color: '#7a9fb0', flatShading: true })));
  for (const g of hillParts) g.dispose();
  scene.add(hills);
  const potMat = own(new THREE.MeshLambertMaterial({ color: '#c8734a' }));
  const potBody = new THREE.Mesh(undefined, potMat);
  scene.add(potBody);
  const soilWet = new THREE.Color('#5b3a22');
  const soilDry = new THREE.Color('#8a7a68');
  const soilMat = own(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  const soils = new THREE.InstancedMesh(own(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 14)), soilMat, POTS);
  for (let i = 0; i < POTS; i++) soils.setColorAt(i, soilWet);
  scene.add(soils);
  const flowerMat = own(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#221a33' }));
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count; const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const flowerGeos = ['#ff7eb6', '#ffd166', '#9b8cff', '#5fd3ff'].map((pc) => {
    const parts: THREE.BufferGeometry[] = [];
    const stem = new THREE.CylinderGeometry(0.035, 0.045, 0.9, 6); stem.translate(0, 0.45, 0); parts.push(paint(stem, new THREE.Color('#3fbf5a')));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const pg = new THREE.SphereGeometry(0.16, 8, 6); pg.scale(1, 0.55, 1); pg.translate(Math.cos(a) * 0.17, 0.92, Math.sin(a) * 0.17);
      parts.push(paint(pg, new THREE.Color(pc)));
    }
    const heart = new THREE.SphereGeometry(0.09, 8, 6); heart.translate(0, 0.95, 0); parts.push(paint(heart, new THREE.Color('#fff3b0')));
    const m = own(mergeGeometries(parts));
    for (const g of parts) g.dispose();
    return m;
  });
  const pots: Pot[] = [];
  for (let i = 0; i < POTS; i++) {
    const flower = new THREE.Mesh(flowerGeos[i % flowerGeos.length], flowerMat);
    flower.scale.setScalar(0.001);
    scene.add(flower);
    pots.push({ pos: new THREE.Vector3(), flower, bloom: 0, target: 0, wilt: 0, x: 0 });
  }

  function layoutStatic() {
    // 구름은 화면 위쪽 띠, 땅·화분은 바닥 판정선(H-50) 아래
    pixelToWorld(W / 2, H * 0.02, tmpA, -1.5);
    cloud.position.set(0, tmpA.y + 0.4, 0);
    const bodies: THREE.BufferGeometry[] = [];
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < POTS; i++) {
      const px = ((i + 0.5) / POTS) * W;
      pixelToWorld(px, H - 70, tmpA, 0.6);   // 판정선(H-50) 바로 위 — 아래 상태 띠에 가리지 않게
      const p = pots[i];
      p.pos.set(tmpA.x, tmpA.y - 0.28, 0.6);
      p.x = px;
      const b = new THREE.CylinderGeometry(0.42, 0.3, 0.55, 14); b.translate(p.pos.x, p.pos.y, p.pos.z); bodies.push(b);
      soils.setMatrixAt(i, m4.makeTranslation(p.pos.x, p.pos.y + 0.26, p.pos.z));
      p.flower.position.set(p.pos.x, p.pos.y + 0.28, p.pos.z);
    }
    // 땅 윗면 = 화분 밑면(화분이 뜨지 않게) · 언덕은 그 뒤
    const groundTop = pots[0].pos.y - 0.275;
    ground.position.set(0, groundTop - 0.3, 0.6);
    hills.position.set(0, groundTop + 0.1, 0);
    potBody.geometry?.dispose();
    potBody.geometry = mergeGeometries(bodies);
    for (const g of bodies) g.dispose();
    soils.instanceMatrix.needsUpdate = true;
  }
  layoutStatic();

  // ── 씨앗 캡슐 — 색마다 재질 1개 공유
  const capGeo = own(new THREE.CapsuleGeometry(0.5, 0.7, 4, 10));
  const ringGeo = own(new THREE.TorusGeometry(0.95, 0.07, 6, 24));
  const ringMat = own(new THREE.MeshBasicMaterial({ color: '#FECA57', transparent: true, opacity: 0.8 }));
  const capMats = new Map<string, THREE.MeshLambertMaterial>();
  const matFor = (c: string) => {
    let m = capMats.get(c);
    if (!m) { m = own(new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.35 })); capMats.set(c, m); }
    return m;
  };
  const seeds = new Map<number, THREE.Mesh>();
  const flying: Flying[] = [];
  const freeMeshes: THREE.Mesh[] = [];
  function seedMesh(w: RainWord): THREE.Mesh {
    let m = seeds.get(w.id);
    if (m) return m;
    m = freeMeshes.pop() ?? new THREE.Mesh(capGeo, matFor(w.color));
    m.material = matFor(w.color);
    m.scale.set(1, 1, 1);
    m.visible = true;
    m.userData.ring?.removeFromParent();
    m.userData.ring = undefined;
    if (w.special) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2.4;
      m.add(ring);
      m.userData.ring = ring;
    }
    scene.add(m);
    seeds.set(w.id, m);
    return m;
  }
  function release(m: THREE.Mesh) {
    m.visible = false;
    m.removeFromParent();
    freeMeshes.push(m);
  }

  // ── 빗방울 — InstancedMesh 하나
  const dropGeo = own(new THREE.BoxGeometry(0.025, 0.42, 0.025));
  const dropMat = own(new THREE.MeshBasicMaterial({ color: '#9fb4ff', transparent: true, opacity: 0.45 }));
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, RAIN_DROPS);
  drops.frustumCulled = false;
  scene.add(drops);
  const dropSeed = Array.from({ length: RAIN_DROPS }, (_, i) => ({ x: ((i * 7919) % 1000) / 1000, y: ((i * 104729) % 1000) / 1000, z: ((i * 31) % 100) / 100, v: 0.6 + ((i * 17) % 10) / 20 }));
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();

  let kickUntil = 0;
  let lastTime = 0;
  // 동적 해상도 — 학교 PC(내장 GPU·소프트웨어 GL)에서 프레임이 22ms 를 넘으면 3D 배경만 해상도를 낮춘다(1 → 0.83 → 0.67 → 0.5).
  // 글자(라벨)는 위의 2D 캔버스가 원래 해상도로 그리므로 흐려지지 않는다. 다시 올리지는 않는다(오르내림 깜빡임 방지).
  // 실측(swiftshader 900×500): 해상도 1 = 프레임 P50 33ms → 렌더를 빼면 16.7ms — 비용은 픽셀 수에 비례한다.
  let quality = 1;
  let ema = 16.7;
  let sampled = 0;
  function adapt(dt: number) {
    ema += (dt - ema) * 0.08;
    if (++sampled < 45 || quality <= 0.5) return;
    if (ema > 22) {
      quality = Math.max(0.5, Math.round((quality - 0.17) * 100) / 100);
      renderer.setPixelRatio(quality);
      renderer.setSize(W, H, false);
      sampled = 0;
      ema = 16.7;
    }
  }

  function potNearest(px: number): number {
    let best = 0;
    for (let i = 1; i < POTS; i++) if (Math.abs(pots[i].x - px) < Math.abs(pots[best].x - px)) best = i;
    return best;
  }

  const api: SeedRainScene = {
    render(words, time, frozen) {
      const rawDt = lastTime ? time - lastTime : 16;
      const dt = Math.min(50, rawDt);
      lastTime = time;
      if (rawDt < 250) adapt(rawDt);   // 탭을 숨겼다 돌아온 긴 간격은 성능으로 치지 않는다
      const live = new Set<number>();
      for (const w of words) {
        live.add(w.id);
        const m = seedMesh(w);
        // 라벨 바로 위(말풍선 높이만큼)에 캡슐 — 라벨과 같은 x(비켜 선 거리 포함)
        pixelToWorld(w.x + (w.labelShift ?? 0), w.y - 30, m.position);
        const s = unit * 13;
        const sq = m.userData.squashUntil > time ? 1 + 0.35 * ((m.userData.squashUntil - time) / 120) : 1;
        m.scale.set(s * sq, (s / sq), s * sq);
        m.rotation.z = Math.sin(time * 0.002 + w.id) * 0.25;
        m.rotation.y = time * 0.0015 + w.id;
        if (m.userData.ring) (m.userData.ring as THREE.Mesh).rotation.z = time * 0.003;
      }
      for (const [id, m] of seeds) if (!live.has(id)) { seeds.delete(id); release(m); }

      // 날아가는 씨앗 → 화분
      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i];
        const k = Math.min(1, (time - f.t0) / FLY_MS);
        const to = pots[f.pot].pos;
        f.mesh.position.lerpVectors(f.from, tmpA.set(to.x, to.y + 0.6, to.z), k);
        f.mesh.position.y += Math.sin(k * Math.PI) * 1.2;
        f.mesh.scale.multiplyScalar(0.985);
        if (k >= 1) {
          const p = pots[f.pot];
          p.target = Math.min(1.4, p.target + 0.35);
          p.wilt = Math.max(0, p.wilt - 0.5);
          release(f.mesh);
          flying.splice(i, 1);
        }
      }

      // 화분 — 꽃 피기·시들기(부드럽게)
      for (let i = 0; i < POTS; i++) {
        const p = pots[i];
        p.bloom += (p.target - p.bloom) * Math.min(1, dt / 160);
        p.flower.scale.setScalar(Math.max(0.001, p.bloom));
        p.flower.rotation.z = p.wilt * 0.5;
        soils.setColorAt(i, tmpC.copy(soilWet).lerp(soilDry, Math.min(1, p.wilt)));
      }
      if (soils.instanceColor) soils.instanceColor.needsUpdate = true;

      // 비 — 얼음(freeze) 중엔 멈춘다
      const top = cloud.position.y;
      const bottom = ground.position.y;
      const span = top - bottom;
      const halfW = Math.abs(unit * W) * 0.6;
      for (let i = 0; i < RAIN_DROPS; i++) {
        const d = dropSeed[i];
        if (!frozen) d.y = (d.y + (dt / 1000) * d.v * 0.9) % 1;
        dummy.position.set((d.x * 2 - 1) * halfW, top - d.y * span, -2 + d.z * 3);
        dummy.rotation.z = 0.12;
        dummy.updateMatrix();
        drops.setMatrixAt(i, dummy.matrix);
      }
      drops.instanceMatrix.needsUpdate = true;
      dropMat.color.set(frozen ? '#d8f6ff' : '#9fb4ff');

      // 줌 펀치(단어 완성 뒤 0.2초만) — 위치·각도는 그대로, 화각만 살짝
      const kick = kickUntil > time ? (kickUntil - time) / KICK_MS : 0;
      const fov = BASE_FOV - kick * 1.6;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

      renderer.render(scene, camera);
    },
    hit(word) {
      const m = seeds.get(word.id);
      if (!m) return;
      seeds.delete(word.id);
      // 하얗게 번쩍 + 찌그러짐 → 화분으로
      m.material = matFor('#ffffff');
      m.userData.squashUntil = performance.now() + 120;
      flying.push({ mesh: m, from: m.position.clone(), pot: potNearest(word.x + (word.labelShift ?? 0)), t0: lastTime });
      kickUntil = lastTime + KICK_MS;
    },
    miss(word) {
      const p = pots[potNearest(word.x + (word.labelShift ?? 0))];
      p.wilt = Math.min(1.2, p.wilt + 0.6);
      p.target = Math.max(0, p.target - 0.25);
    },
    ability(kind) {
      if (kind === 'heal') for (const p of pots) p.wilt = Math.max(0, p.wilt - 0.6);
      if (kind === 'clear') for (const [id, m] of seeds) { seeds.delete(id); release(m); }
    },
    resize(w, h) {
      W = w; H = h;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      measure();
      layoutStatic();
    },
    dispose() {
      for (const o of owned) o.dispose();
      skyTex.dispose();
      // 땅 윗면 = 화분 밑면(화분이 뜨지 않게) · 언덕은 그 뒤
    const groundTop = pots[0].pos.y - 0.275;
    ground.position.set(0, groundTop - 0.3, 0.6);
    hills.position.set(0, groundTop + 0.1, 0);
    potBody.geometry?.dispose();
      soils.dispose();
      drops.dispose();
      renderer.dispose();
    },
    info() {
      const i = renderer.info;
      return { geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls, triangles: i.render.triangles, quality };
    },
  };
  return api;
}
