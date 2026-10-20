/**
 * 슬라임 놀이터 3D 장면 — 해 질 녘 놀이터(미끄럼틀·그네·모래밭)로 말랑한 슬라임이 통통 튀며 다가오고,
 * 완성하면 하얗게 번쩍·찌그러진 뒤 무지개빛 «정화된 친구» 색으로 바뀌어 울타리 옆자리로 빠진다.
 * 놓치면(슬라임이 울타리에 닿으면) 울타리가 흔들린다.
 * 게임 상태·판정은 코어(`lib/game/zombie/core.ts`)의 화면 픽셀 그대로다. 이 장면은 그 픽셀을
 * 카메라 광선으로 바닥면(y=0)에 투영해 슬라임을 놓기만 한다 → 2D 라벨과 3D 슬라임이 정확히 겹친다.
 * 성능 규칙(GDD-3D §9): DPR 1 · 안티앨리어싱·그림자·후처리 0 · Lambert 재질 · 정적인 것(놀이터·울타리·언덕)은
 *   한 덩어리로 합치고 · 드로 콜 ≤ 30 · 카메라는 고정 사선 45°(입력 중 흔들리지 않는다).
 * three 는 이 파일을 동적 import 할 때만 받는다(게임에 들어갈 때만 전송).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUND_MARGIN, PLAYER_Y_OFFSET, type ZombieUnit, type Ability } from '@/lib/game/zombie/core';

export interface SlimePlaygroundScene {
  /** 매 프레임 — 살아 있는 슬라임을 그린다(통통 튀는 접근) */
  render(units: readonly ZombieUnit[], time: number, frozen: boolean): void;
  /** 정화 — 하얗게 번쩍 + 찌그러짐 → 무지개빛 친구 색으로 울타리 옆자리에 가 앉는다 */
  hit(unit: ZombieUnit): void;
  /** 놓침 — 울타리가 흔들린다 */
  miss(unit: ZombieUnit): void;
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

/** 정화된 친구가 가 앉는 자리 수(다 차면 가장 오래된 자리를 돌려 쓴다) */
const FRIEND_SLOTS = 6;
const FLY_MS = 420;
const KICK_MS = 200;
const FENCE_SHAKE_MS = 300;
const FENCE_HALF = 9;
/** 정화된 친구의 무지개 색(다가오는 적 색과 안 겹치게 파스텔로) */
const FRIEND_COLORS = ['#FFADC9', '#FFE39B', '#B6FFC2', '#B6E3FF', '#D8B6FF', '#FFC9A8'];

interface Flying { mesh: THREE.Mesh; from: THREE.Vector3; slot: number; t0: number }

export function createSlimePlaygroundScene(canvas: HTMLCanvasElement, W0: number, H0: number): SlimePlaygroundScene {
  let W = W0;
  let H = H0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // 하늘 = 세로 그라데이션 텍스처 1장(2×256) — 해 질 녘(위는 보랏빛 저녁, 아래는 주황·분홍 노을)
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
  const sg = sky.getContext('2d');
  if (sg) {
    const gr = sg.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#4a3f7a'); gr.addColorStop(0.45, '#c9638a'); gr.addColorStop(0.75, '#f6965f'); gr.addColorStop(1, '#ffd79a');
    sg.fillStyle = gr; sg.fillRect(0, 0, 2, 256);
  }
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog('#d98a7a', 18, 38);

  // 고정 사선 45° — 입력 중 카메라는 움직이지 않는다(줌 펀치는 정화 직후 0.2초만)
  const BASE_FOV = 42;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, W / H, 0.1, 60);
  camera.position.set(0, 8.4, 11);
  camera.lookAt(0, 0, 2);
  // 🔴 unproject 는 matrixWorld 를 쓴다 — 첫 render 전엔 단위행렬이라 바닥 자리가 화면 가운데로 틀어졌다(rain 장면에서 실측)
  camera.updateMatrixWorld();

  scene.add(new THREE.HemisphereLight('#ffd9b0', '#5a4a6a', 1.6));
  const sun = new THREE.DirectionalLight('#ffb37a', 1.6);
  sun.position.set(-4, 5, 3);
  scene.add(sun);

  // ── 화면 픽셀 → 바닥면(y=planeY) 위 점. 광선과 평면의 교점이라 라벨과 정확히 겹친다.
  const ndc = new THREE.Vector3();
  const dir = new THREE.Vector3();
  function pixelToWorld(px: number, py: number, out: THREE.Vector3, planeY = 0): THREE.Vector3 {
    ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1, 0.5).unproject(camera);
    dir.copy(ndc).sub(camera.position).normalize();
    const t = (planeY - camera.position.y) / dir.y;
    return out.copy(camera.position).addScaledVector(dir, t);
  }
  /** 특정 화면 위치에서 바닥면의 픽셀당 월드 길이(원근 때문에 위치마다 다르다 — 가까울수록 크다) */
  const tmpU1 = new THREE.Vector3();
  const tmpU2 = new THREE.Vector3();
  function localUnit(px: number, py: number): number {
    pixelToWorld(px - 10, py, tmpU1);
    pixelToWorld(px + 10, py, tmpU2);
    return Math.abs((tmpU2.x - tmpU1.x) / 20);
  }

  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { owned.push(x); return x; };
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count; const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };

  // ── 잔디 바닥(넓게) — 그 위에 모래밭 패치
  const ground = new THREE.Mesh(own(new THREE.BoxGeometry(44, 0.5, 44)), own(new THREE.MeshLambertMaterial({ color: '#3f8f52' })));
  ground.position.set(0, -0.25, 0);
  scene.add(ground);
  const sandbox = new THREE.Mesh(own(new THREE.BoxGeometry(5.5, 0.12, 4)), own(new THREE.MeshLambertMaterial({ color: '#e8cf8a' })));
  scene.add(sandbox);
  // 먼 언덕(깊이감) — 낮은 원뿔 몇 개를 한 덩어리로
  const hillParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.ConeGeometry(2.6 + (i % 3) * 0.9, 1.0 + ((i * 7) % 4) * 0.3, 7);
    g.translate((i - 2.5) * 4.2 + ((i * 13) % 5) * 0.3, 0.3, -11 - (i % 2) * 2);
    hillParts.push(g);
  }
  const hills = new THREE.Mesh(own(mergeGeometries(hillParts)), own(new THREE.MeshLambertMaterial({ color: '#8a6f9a', flatShading: true })));
  for (const g of hillParts) g.dispose();
  scene.add(hills);

  // ── 놀이터(미끄럼틀·그네·모래밭 테두리)를 한 덩어리로 합친다(드로 콜 1) — 원점(0,0,0) 기준, layoutStatic 에서 통째로 옮긴다
  const playParts: THREE.BufferGeometry[] = [];
  const addPart = (g: THREE.BufferGeometry, color: string) => { playParts.push(paint(g, new THREE.Color(color))); };
  // 미끄럼틀 — 계단 몸체 + 경사 슬라이드 판 + 난간 기둥 2개
  { const body = new THREE.BoxGeometry(1.1, 1.8, 1.1); body.translate(3.4, 0.9, -1.5); addPart(body, '#e0734a'); }
  { const slide = new THREE.BoxGeometry(1.0, 0.12, 2.6); slide.rotateX(-0.55); slide.translate(2.2, 1.0, -0.2); addPart(slide, '#4ab0e0'); }
  { const pole1 = new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6); pole1.translate(3.9, 0.95, -1.9); addPart(pole1, '#f0d040'); }
  { const pole2 = new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6); pole2.translate(2.9, 0.95, -1.9); addPart(pole2, '#f0d040'); }
  // 그네 — ㄷ자 프레임(기둥 2 + 상단 보) + 의자 2개 + 체인(가는 기둥으로 대신)
  const swingX = -2.4;
  { const postL = new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6); postL.translate(swingX - 1.1, 1.1, 1.2); addPart(postL, '#c8783a'); }
  { const postR = new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6); postR.translate(swingX + 1.1, 1.1, 1.2); addPart(postR, '#c8783a'); }
  { const beam = new THREE.CylinderGeometry(0.08, 0.08, 2.3, 6); beam.rotateZ(Math.PI / 2); beam.translate(swingX, 2.15, 1.2); addPart(beam, '#c8783a'); }
  for (const dx of [-0.55, 0.55]) {
    { const chainL = new THREE.CylinderGeometry(0.02, 0.02, 1.3, 4); chainL.translate(swingX + dx - 0.05, 1.45, 1.2); addPart(chainL, '#8a8a8a'); }
    { const chainR = new THREE.CylinderGeometry(0.02, 0.02, 1.3, 4); chainR.translate(swingX + dx + 0.05, 1.45, 1.2); addPart(chainR, '#8a8a8a'); }
    { const seat = new THREE.BoxGeometry(0.5, 0.06, 0.3); seat.translate(swingX + dx, 0.78, 1.2); addPart(seat, '#4ab06a'); }
  }
  const playMat = own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const playground = new THREE.Mesh(own(mergeGeometries(playParts)), playMat);
  for (const g of playParts) g.dispose();
  scene.add(playground);

  // ── 울타리 — 기둥 + 가로대를 한 덩어리로(미스 때 전체를 흔든다). 원점 기준(x축 가로) · layoutStatic 이 깊이(z)·높이(y)를 맞춘다
  const fenceParts: THREE.BufferGeometry[] = [];
  for (let i = -FENCE_HALF; i <= FENCE_HALF; i += 1.2) {
    const post = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 5); post.translate(i, 0.5, 0); fenceParts.push(post);
  }
  for (const ry of [0.3, 0.7]) {
    const rail = new THREE.BoxGeometry(FENCE_HALF * 2 + 0.4, 0.07, 0.07); rail.translate(0, ry, 0); fenceParts.push(rail);
  }
  const fenceGeo = own(mergeGeometries(fenceParts));
  for (const g of fenceParts) g.dispose();
  const fence = new THREE.Mesh(fenceGeo, own(new THREE.MeshLambertMaterial({ color: '#e8e0c8' })));
  scene.add(fence);
  let fenceShakeUntil = 0;
  let fenceBaseY = 0;

  // ── 정화된 친구 자리 — 울타리 옆으로 나란히(한 자리 = 슬라임 메시 하나, 풀은 돌려 쓴다)
  const friendSlots: THREE.Vector3[] = Array.from({ length: FRIEND_SLOTS }, () => new THREE.Vector3());
  let friendCursor = 0;
  const friendMeshes: (THREE.Mesh | null)[] = new Array(FRIEND_SLOTS).fill(null);

  // 플레이어(울타리) 지점의 바닥 좌표 — 코어가 쓰는 판정 지점(cx, playerY 픽셀)과 같은 곳.
  const playerWorld = new THREE.Vector3();
  function layoutStatic() {
    const groundY = H - GROUND_MARGIN;
    const playerPixelY = groundY - PLAYER_Y_OFFSET;
    pixelToWorld(W / 2, playerPixelY, playerWorld, 0);
    fence.position.set(playerWorld.x, 0, playerWorld.z);
    fenceBaseY = fence.position.y;
    sandbox.position.set(playerWorld.x - 5.5, 0.06, playerWorld.z - 7);
    playground.position.set(playerWorld.x, 0, playerWorld.z - 7);
    for (let i = 0; i < FRIEND_SLOTS; i++) {
      const t = (i / (FRIEND_SLOTS - 1)) - 0.5;
      friendSlots[i].set(playerWorld.x + t * (FENCE_HALF * 1.7), 0, playerWorld.z - 1.4);
    }
  }
  layoutStatic();

  // ── 슬라임 — 말랑 반구 몸 + 눈 2개 + 하이라이트를 한 geometry 로 합친다(몸은 흰 정점색 → 재질색으로 물든다)
  const slimeParts: THREE.BufferGeometry[] = [];
  { const body = new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.9); body.scale(1, 0.72, 1); slimeParts.push(paint(body, new THREE.Color('#ffffff'))); }
  { const eyeL = new THREE.SphereGeometry(0.075, 6, 5); eyeL.translate(-0.17, 0.2, 0.42); slimeParts.push(paint(eyeL, new THREE.Color('#15121a'))); }
  { const eyeR = new THREE.SphereGeometry(0.075, 6, 5); eyeR.translate(0.17, 0.2, 0.42); slimeParts.push(paint(eyeR, new THREE.Color('#15121a'))); }
  { const hi = new THREE.SphereGeometry(0.1, 6, 5); hi.translate(-0.2, 0.38, 0.22); slimeParts.push(paint(hi, new THREE.Color('#ffffff'))); }
  const slimeGeo = own(mergeGeometries(slimeParts));
  for (const g of slimeParts) g.dispose();
  // 바닥에 발이 닿게 — 가장 낮은 정점이 로컬 y=0 이 되도록 통째로 올린다(스케일은 원점 기준이라 이후 배율이 바뀌어도 바닥은 그대로 0).
  slimeGeo.computeBoundingBox();
  const slimeMinY = slimeGeo.boundingBox ? slimeGeo.boundingBox.min.y : 0;
  slimeGeo.translate(0, -slimeMinY, 0);
  const slimeMats = new Map<string, THREE.MeshLambertMaterial>();
  const matFor = (c: string) => {
    let m = slimeMats.get(c);
    if (!m) { m = own(new THREE.MeshLambertMaterial({ color: c, vertexColors: true, emissive: c, emissiveIntensity: 0.18 })); slimeMats.set(c, m); }
    return m;
  };
  const whiteMat = own(new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.6 }));
  const ringGeo = own(new THREE.TorusGeometry(0.62, 0.05, 6, 20));
  const ringMat = own(new THREE.MeshBasicMaterial({ color: '#FECA57', transparent: true, opacity: 0.85 }));

  const slimes = new Map<number, THREE.Mesh>();
  const flying: Flying[] = [];
  const freeMeshes: THREE.Mesh[] = [];
  function slimeMesh(u: ZombieUnit): THREE.Mesh {
    let m = slimes.get(u.id);
    if (m) return m;
    m = freeMeshes.pop() ?? new THREE.Mesh(slimeGeo, matFor(u.color));
    m.material = matFor(u.color);
    m.scale.set(1, 1, 1);
    m.visible = true;
    m.userData.squashUntil = 0;
    (m.userData.ring as THREE.Mesh | undefined)?.removeFromParent();
    m.userData.ring = undefined;
    if (u.special) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.55;
      m.add(ring);
      m.userData.ring = ring;
    }
    scene.add(m);
    slimes.set(u.id, m);
    return m;
  }
  function release(m: THREE.Mesh) {
    m.visible = false;
    m.removeFromParent();
    freeMeshes.push(m);
  }
  function settleFriend(m: THREE.Mesh, slot: number) {
    m.material = matFor(FRIEND_COLORS[slot % FRIEND_COLORS.length]);
    m.scale.setScalar(0.55);
    m.rotation.y = 0;
    const old = friendMeshes[slot];
    if (old && old !== m) release(old);
    friendMeshes[slot] = m;
  }

  let kickUntil = 0;
  let lastTime = 0;
  // 동적 해상도 — 학교 PC(내장 GPU·소프트웨어 GL)에서 프레임이 22ms 를 넘으면 3D 배경만 해상도를 낮춘다(1 → 0.83 → 0.67 → 0.5).
  // 글자(라벨)는 위의 2D 캔버스가 원래 해상도로 그리므로 흐려지지 않는다. 다시 올리지는 않는다(오르내림 깜빡임 방지).
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

  const api: SlimePlaygroundScene = {
    render(units, time, frozen) {
      const rawDt = lastTime ? time - lastTime : 16;
      lastTime = time;
      if (rawDt < 250) adapt(rawDt); // 탭을 숨겼다 돌아온 긴 간격은 성능으로 치지 않는다
      const live = new Set<number>();
      for (const u of units) {
        live.add(u.id);
        const m = slimeMesh(u);
        const px = u.x + (u.labelShift ?? 0);
        pixelToWorld(px, u.y, m.position, 0);
        const unit = localUnit(px, u.y);
        let size = 12;
        if (u.variant === 1) size = 16; // 뚱뚱 — 큼
        if (u.variant === 2) size = 10; // 재빠름 — 작음
        const s = unit * size * 0.95;
        // 통통 튀며 접근 — 사인파 squash(눌렸다 펴졌다) + 수직 홉(바닥은 geometry 가 이미 y=0 이라 배율만 줘도 발이 뜨지 않는다)
        const walkPhase = time * 0.005 + u.id;
        const squat = Math.abs(Math.sin(walkPhase * 2));
        const squashK = m.userData.squashUntil > time ? 1 + 0.4 * ((m.userData.squashUntil - time) / 120) : 1;
        m.position.y += squat * s * 0.3;
        m.scale.set(s * (1 + squat * 0.1) * squashK, (s * (1 - squat * 0.18)) / squashK, s * (1 + squat * 0.1) * squashK);
        m.rotation.y = Math.atan2(playerWorld.x - m.position.x, playerWorld.z - m.position.z);
        if (m.userData.ring) (m.userData.ring as THREE.Mesh).rotation.z = time * 0.003;
      }
      for (const [id, m] of slimes) if (!live.has(id)) { slimes.delete(id); release(m); }

      // 정화된 친구가 자기 자리로 날아간다
      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i];
        const k = Math.min(1, (time - f.t0) / FLY_MS);
        const to = friendSlots[f.slot];
        f.mesh.position.lerpVectors(f.from, to, k);
        f.mesh.position.y += Math.sin(k * Math.PI) * 1.1;
        if (k >= 1) {
          settleFriend(f.mesh, f.slot);
          flying.splice(i, 1);
        }
      }
      // 자리에 앉은 친구들 — 가볍게 까딱까딱
      for (let i = 0; i < FRIEND_SLOTS; i++) {
        const fm = friendMeshes[i];
        if (!fm) continue;
        const b = friendSlots[i];
        fm.position.set(b.x, b.y + Math.abs(Math.sin(time * 0.0025 + i)) * 0.15, b.z);
      }

      // 울타리 흔들림(미스 직후 0.3초)
      const shakeK = fenceShakeUntil > time ? (fenceShakeUntil - time) / FENCE_SHAKE_MS : 0;
      fence.rotation.z = Math.sin(time * 0.06) * 0.06 * shakeK;
      fence.position.y = fenceBaseY + Math.abs(Math.sin(time * 0.08)) * 0.06 * shakeK;

      // 줌 펀치(정화 직후 0.2초만) — 위치·각도는 그대로, 화각만 살짝
      const kick = kickUntil > time ? (kickUntil - time) / KICK_MS : 0;
      const fov = BASE_FOV - kick * 1.6;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      void frozen; // 얼어붙은 동안은 코어가 이동을 멈춘다 — 장면은 그 결과(멈춘 좌표)만 그린다

      renderer.render(scene, camera);
    },
    hit(unit) {
      const m = slimes.get(unit.id);
      if (!m) return;
      slimes.delete(unit.id);
      // 하얗게 번쩍 + 찌그러짐 → 무지개빛 친구 색으로 자리에 날아가 앉는다
      m.material = whiteMat;
      m.userData.squashUntil = performance.now() + 140;
      const slot = friendCursor % FRIEND_SLOTS;
      friendCursor++;
      flying.push({ mesh: m, from: m.position.clone(), slot, t0: lastTime });
      kickUntil = lastTime + KICK_MS;
    },
    miss(unit) {
      void unit;
      fenceShakeUntil = lastTime + FENCE_SHAKE_MS;
    },
    ability(kind) {
      if (kind === 'clear') {
        for (const [id, m] of slimes) {
          slimes.delete(id);
          m.material = whiteMat;
          const slot = friendCursor % FRIEND_SLOTS; friendCursor++;
          flying.push({ mesh: m, from: m.position.clone(), slot, t0: lastTime });
        }
        kickUntil = lastTime + KICK_MS;
      } else if (kind === 'heal') {
        const mat = fence.material as THREE.MeshLambertMaterial;
        const orig = mat.color.getHex();
        mat.color.set('#8fffb0');
        setTimeout(() => mat.color.setHex(orig), 400);
      }
      // freeze 는 2D 오버레이(페이지)가 안내 문구를 그린다 — 장면은 코어가 멈춘 좌표를 그대로 그리기만 한다.
    },
    resize(w, h) {
      W = w; H = h;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      layoutStatic();
    },
    dispose() {
      for (const o of owned) o.dispose();
      skyTex.dispose();
      renderer.dispose();
    },
    info() {
      const i = renderer.info;
      return { geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls, triangles: i.render.triangles, quality };
    },
  };
  return api;
}
