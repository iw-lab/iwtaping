/**
 * 타이핑 레이스 3D 장면 — 디오라마 트랙 위 장난감 자동차들이 코어의 진행률(0~100)에 따라
 * 타원 트랙을 따라 전진한다. 단어는 이 장면에 그리지 않는다(화면 하단 고정 문장 DOM이 맡는다 —
 * GDD-3D §2 "하단 고정 문장(차 위 라벨 없음) — TypeRacer 관습").
 * 카메라는 다른 5종과 달리(고정) **플레이어 차를 측후방에서 추적**한다 — 위치는 매 프레임 lerp로
 * 부드럽게 좇을 뿐 흔들리지 않고, 입력 중엔 급격한 변화가 없다(줌 펀치는 단어 완성 뒤 0.2초만).
 * 성능 규칙(GDD-3D §9)은 씨앗비와 같다: DPR 1 · 안티앨리어싱·그림자·후처리 0 · Lambert 재질 ·
 * 트랙 타원 판+차선을 한 덩어리로, 관중석·나무도 한 덩어리로 합치고, 차는 몸통+바퀴4+창문을
 * 합친 단일 지오메트리를 모든 차가 공유하고 재질(색)만 다르다 — 드로 콜 ≤ 30.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface RaceCarLike {
  id: number;
  progress: number; // 0~100
  color: string;
  isPlayer: boolean;
}

export interface RaceScene {
  /** 매 프레임 — 차들을 트랙 위 진행률 위치로 옮기고 카메라를 플레이어 차 쪽으로 부드럽게 좇는다. */
  render(cars: readonly RaceCarLike[], time: number): void;
  /** 단어 완성 뒤에만 부른다 — 그 차가 살짝 솟구치고 카메라가 짧게(0.2초) 줌 펀치된다. */
  kick(carId: number): void;
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

const TRACK_A = 6.4; // 타원 긴반지름(x)
const TRACK_B = 3.1; // 타원 짧은반지름(z)
const LANE_GAP = 0.46; // 같은 지점에 여러 차가 몰릴 때 옆으로 벌리는 간격
const KICK_MS = 200;

interface CarEntry {
  mesh: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  squashUntil: number;
}

export function createRaceScene(canvas: HTMLCanvasElement, W0: number, H0: number): RaceScene {
  let W = W0;
  let H = H0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // 하늘 = 세로 그라데이션 텍스처 1장 — 맑은 운동장 낮
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
  const sg = sky.getContext('2d');
  if (sg) {
    const gr = sg.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#7fb8f0'); gr.addColorStop(0.6, '#bfe3ff'); gr.addColorStop(1, '#eef9e8');
    sg.fillStyle = gr; sg.fillRect(0, 0, 2, 256);
  }
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog('#bfe3ff', 14, 30);

  const BASE_FOV = 46;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, W / H, 0.1, 60);
  const camPos = new THREE.Vector3(0, 6, 9);
  const camLook = new THREE.Vector3(0, 0, 0);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.updateMatrixWorld();

  scene.add(new THREE.HemisphereLight('#eaf6ff', '#4a6a3a', 1.6));
  const sun = new THREE.DirectionalLight('#fff6d8', 1.4);
  sun.position.set(4, 7, 5);
  scene.add(sun);

  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { owned.push(x); return x; };

  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };

  // ── 디오라마 바닥 + 타원 트랙 + 차선(한 덩어리, 드로 콜 1)
  const grassCol = new THREE.Color('#5fae4a');
  const trackCol = new THREE.Color('#3a3a44');
  const laneCol = new THREE.Color('#f2f2f0');
  const baseParts: THREE.BufferGeometry[] = [];
  const base = new THREE.CylinderGeometry(TRACK_A + 1.8, TRACK_A + 2.1, 0.3, 40);
  base.translate(0, -0.15, 0);
  baseParts.push(paint(base, grassCol));
  // 트랙(타원 띠) — 가느다란 세그먼트를 이어 붙여 타원 모양을 만든다
  const SEGS = 48;
  for (let i = 0; i < SEGS; i++) {
    const a0 = (i / SEGS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGS) * Math.PI * 2;
    const x0 = TRACK_A * Math.cos(a0), z0 = TRACK_B * Math.sin(a0);
    const x1 = TRACK_A * Math.cos(a1), z1 = TRACK_B * Math.sin(a1);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const seg = new THREE.BoxGeometry(len + 0.05, 0.05, 1.35);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    seg.rotateY(-ang);
    seg.translate((x0 + x1) / 2, 0.015, (z0 + z1) / 2);
    baseParts.push(paint(seg, trackCol));
    // 차선(점선) — 세그먼트 중앙에 짧은 흰 블록
    if (i % 2 === 0) {
      const dash = new THREE.BoxGeometry(len * 0.5, 0.06, 0.09);
      dash.rotateY(-ang);
      dash.translate((x0 + x1) / 2, 0.03, (z0 + z1) / 2);
      baseParts.push(paint(dash, laneCol));
    }
  }
  // 결승선(체커무늬 느낌의 띠 하나) — 트랙 시작점(상단, angle=-90°) 위
  {
    const ang = -Math.PI / 2;
    const x = TRACK_A * Math.cos(ang), z = TRACK_B * Math.sin(ang);
    const finish = new THREE.BoxGeometry(1.4, 0.07, 1.4);
    finish.translate(x, 0.02, z);
    baseParts.push(paint(finish, new THREE.Color('#ffffff')));
  }
  const trackMesh = new THREE.Mesh(own(mergeGeometries(baseParts)), own(new THREE.MeshLambertMaterial({ vertexColors: true })));
  for (const g of baseParts) g.dispose();
  scene.add(trackMesh);

  // ── 관중석 + 나무(한 덩어리, 드로 콜 1)
  const standCol = new THREE.Color('#cbb79a');
  const trunkCol = new THREE.Color('#7a5230');
  const leafCol = new THREE.Color('#3f9e52');
  const decorParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + 0.4;
    const r = TRACK_A + 2.6;
    const x = r * Math.cos(ang) * 1.05, z = (TRACK_B + 2.6) * Math.sin(ang);
    const stand = new THREE.BoxGeometry(2.4, 1.1, 0.9);
    stand.rotateY(-Math.atan2(-z, -x));
    stand.translate(x, 0.55, z);
    decorParts.push(paint(stand, standCol));
    const roof = new THREE.BoxGeometry(2.6, 0.15, 1.1);
    roof.rotateY(-Math.atan2(-z, -x));
    roof.translate(x, 1.2, z);
    decorParts.push(paint(roof, new THREE.Color('#e86a6a')));
  }
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 + 0.9;
    const r = TRACK_A + 1.5 + ((i * 31) % 5) * 0.25;
    const x = r * Math.cos(ang), z = (TRACK_B + 1.5) * Math.sin(ang) * 1.1;
    const trunk = new THREE.CylinderGeometry(0.07, 0.09, 0.7, 6);
    trunk.translate(x, 0.35, z);
    decorParts.push(paint(trunk, trunkCol));
    // 🔴 IcosahedronGeometry는 인덱스가 없어 Box/Cylinder(인덱스 있음)와 섞으면 mergeGeometries가
    //    "index attribute exists among all geometries, or in none of them" 오류로 실패한다(실측) — SphereGeometry로 통일.
    const leaf = new THREE.SphereGeometry(0.42, 7, 5);
    leaf.scale(1, 1.15, 1);
    leaf.translate(x, 0.95, z);
    decorParts.push(paint(leaf, leafCol));
  }
  const decorMesh = new THREE.Mesh(own(mergeGeometries(decorParts)), own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  for (const g of decorParts) g.dispose();
  scene.add(decorMesh);

  // ── 차 — 몸통+바퀴4+창문을 합친 geometry 하나를 모든 차가 공유하고, 재질(색)만 다르다.
  const white = new THREE.Color('#ffffff');
  const dark = new THREE.Color('#2a2a2e');
  const glass = new THREE.Color('#bfe9ff');
  function buildCarGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.BoxGeometry(1.05, 0.34, 0.56); body.translate(0, 0.3, 0);
    parts.push(paint(body, white));
    const cabin = new THREE.BoxGeometry(0.56, 0.26, 0.5); cabin.translate(-0.04, 0.54, 0);
    parts.push(paint(cabin, white));
    const windshield = new THREE.BoxGeometry(0.1, 0.2, 0.44); windshield.translate(0.22, 0.54, 0);
    parts.push(paint(windshield, glass));
    const rearWindow = new THREE.BoxGeometry(0.1, 0.2, 0.44); rearWindow.translate(-0.3, 0.54, 0);
    parts.push(paint(rearWindow, glass));
    const nose = new THREE.BoxGeometry(0.2, 0.18, 0.46); nose.translate(0.58, 0.24, 0);
    parts.push(paint(nose, white));
    const wheelPos: [number, number, number][] = [
      [-0.36, 0.13, 0.31], [0.36, 0.13, 0.31], [-0.36, 0.13, -0.31], [0.36, 0.13, -0.31],
    ];
    for (const [x, y, z] of wheelPos) {
      const w = new THREE.CylinderGeometry(0.15, 0.15, 0.13, 10);
      w.rotateX(Math.PI / 2);
      w.translate(x, y, z);
      parts.push(paint(w, dark));
    }
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    return merged;
  }
  const carGeo = own(buildCarGeometry());

  const cars = new Map<number, CarEntry>();
  function carFor(id: number, color: string): CarEntry {
    let e = cars.get(id);
    if (e) return e;
    const mat = own(new THREE.MeshLambertMaterial({ vertexColors: true, color, emissive: color, emissiveIntensity: 0.08 }));
    const mesh = new THREE.Mesh(carGeo, mat);
    scene.add(mesh);
    e = { mesh, mat, squashUntil: 0 };
    cars.set(id, e);
    return e;
  }

  // ── 화면 픽셀 → 트랙 위 점(진행률 0~100 → 타원 둘레)
  const tmp = new THREE.Vector3();
  function trackPos(progress: number, out: THREE.Vector3): number {
    const ang = -Math.PI / 2 + (Math.max(0, Math.min(100, progress)) / 100) * Math.PI * 2;
    out.set(TRACK_A * Math.cos(ang), 0.3, TRACK_B * Math.sin(ang));
    // 진행 방향(접선) — 타원 매개변수 미분
    const heading = Math.atan2(TRACK_B * Math.cos(ang), -TRACK_A * Math.sin(ang));
    return heading;
  }

  let kickUntil = 0;
  let lastTime = 0;

  // 동적 해상도 — 학교 PC(내장 GPU·소프트웨어 GL)에서 프레임이 느려지면 해상도만 낮춘다(1→0.83→0.67→0.5).
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

  const camTargetPos = new THREE.Vector3();
  const camTargetLook = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const side = new THREE.Vector3();

  const api: RaceScene = {
    render(liveCars, time) {
      const rawDt = lastTime ? time - lastTime : 16;
      const dt = Math.min(50, rawDt);
      lastTime = time;
      if (rawDt < 250) adapt(rawDt);

      const live = new Set<number>();
      // 같은 지점 근처에 몰리면 옆으로 벌려 겹침을 줄인다(둘레 위치가 가까운 순서로 정렬 후 레인 배정)
      const ordered = [...liveCars].sort((a, b) => a.progress - b.progress);
      let playerHeading = 0;
      let playerPos: THREE.Vector3 | null = null;
      for (let i = 0; i < ordered.length; i++) {
        const c = ordered[i];
        live.add(c.id);
        const e = carFor(c.id, c.color);
        const heading = trackPos(c.progress, tmp);
        // 레인 오프셋 — 진행 방향의 바깥쪽 수직선으로 살짝 벌린다
        const laneIdx = i - (ordered.length - 1) / 2;
        const nx = Math.cos(heading + Math.PI / 2);
        const nz = Math.sin(heading + Math.PI / 2);
        e.mesh.position.set(tmp.x + nx * laneIdx * LANE_GAP, tmp.y, tmp.z + nz * laneIdx * LANE_GAP);
        e.mesh.rotation.y = -heading;
        const sq = e.squashUntil > time ? 1 + 0.3 * ((e.squashUntil - time) / KICK_MS) : 1;
        e.mesh.scale.set(sq, 1 / sq, sq);
        if (c.isPlayer) { playerHeading = heading; playerPos = e.mesh.position; }
      }
      for (const [id, e] of cars) {
        if (!live.has(id)) { e.mesh.removeFromParent(); e.mat.dispose(); cars.delete(id); }
      }

      // 카메라 — 플레이어 차 측후방을 매 프레임 lerp로 좇는다(흔들림 0 · 스냅 없음)
      if (playerPos) {
        forward.set(Math.cos(playerHeading), 0, Math.sin(playerHeading));
        side.set(Math.cos(playerHeading + Math.PI / 2), 0, Math.sin(playerHeading + Math.PI / 2));
        camTargetPos.copy(playerPos)
          .addScaledVector(forward, -3.3)
          .addScaledVector(side, 1.1);
        camTargetPos.y = playerPos.y + 2.4;
        camTargetLook.copy(playerPos).addScaledVector(forward, 2.2);
        camTargetLook.y = playerPos.y + 0.2;
        const damp = 1 - Math.exp(-dt / 220);
        camera.position.lerp(camTargetPos, damp);
        camLook.lerp(camTargetLook, damp);
        camera.lookAt(camLook);
      }

      // 줌 펀치(단어 완성 뒤 0.2초만) — 위치·각도는 그대로, 화각만 살짝
      const kick = kickUntil > time ? (kickUntil - time) / KICK_MS : 0;
      const fov = BASE_FOV - kick * 2.2;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

      renderer.render(scene, camera);
    },
    kick(carId) {
      const e = cars.get(carId);
      if (e) e.squashUntil = performance.now() + KICK_MS;
      kickUntil = (lastTime || performance.now()) + KICK_MS;
    },
    resize(w, h) {
      W = w; H = h;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    },
    dispose() {
      for (const [, e] of cars) { e.mesh.removeFromParent(); }
      cars.clear();
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
