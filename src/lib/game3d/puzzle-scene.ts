/**
 * 끝말잇기 3D 장면 — 공중에 뜬 섬 2개를 다리 블록이 잇는다. 이은 단어마다(플레이어든 상대든) 블록이
 * 하나씩 떨어져 꽂히고(squash), 턴 시간을 넘겨 놓치면 다음 블록이 흔들리다 떨어진다. 고양이 운전사
 * «타비»가 놓인 블록 위를 따라 걷는다.
 * 이 게임은 화면 픽셀에 단어를 띄우는 낙하형이 아니라 **고정 정면 카드(DOM)** 로 입력을 받으므로
 * (GDD-3D §2 6번) 씨앗비처럼 화면→3D 좌표 투영이 필요 없다 — 카메라는 고정 사선이고, 단어 완성
 * 직후에만 x 로 살짝 lerp 한다(가독성 규칙: 입력 중 카메라 고정).
 * 성능 규칙(GDD-3D §9): DPR 1 · 안티앨리어싱·그림자·후처리 0 · Lambert 재질 · 정적인 것(섬·구름·고양이)은
 * 한 덩어리로 합치고 다리 블록은 InstancedMesh(instanceColor) 하나 · 드로 콜 ≤ 30.
 * three 는 이 파일을 동적 import 할 때만 받는다(게임에 들어갈 때만 전송).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface PuzzleScene {
  /** 매 프레임 — 카메라 pan(단어 완성 직후만)·고양이 이동·블록 애니메이션을 갱신한다. */
  render(time: number): void;
  /** 단어가 체인에 더해졌다(플레이어 정답 또는 상대 수, 새 라운드 시작 포함) — 블록 하나가 떨어져 꽂힌다. */
  hit(): void;
  /** 턴 시간을 넘겨 놓쳤다 — 다음 블록이 흔들리다 떨어진다. */
  fail(): void;
  resize(W: number, H: number): void;
  dispose(): void;
  info(): { geometries: number; textures: number; calls: number; triangles: number; quality: number };
}

const BLOCKS = 12;
const BLOCK_GAP = 1.15;
const SPAN = (BLOCKS + 1) * BLOCK_GAP;
const ISLAND_X = SPAN / 2;
const DROP_MS = 260;
const SQUASH_MS = 150;
const FAIL_SHAKE_MS = 220;
const FAIL_DROP_MS = 320;

type SlotMode = 'idle' | 'dropping' | 'failing';
interface SlotState { mode: SlotMode; t0: number }

export function createPuzzleScene(canvas: HTMLCanvasElement, W0: number, H0: number): PuzzleScene {
  let W = W0;
  let H = H0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // 하늘 = 세로 그라데이션 텍스처 1장 — 위는 맑은 하늘, 아래는 노을
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
  const sg = sky.getContext('2d');
  if (sg) {
    const gr = sg.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#5a7fd6'); gr.addColorStop(0.55, '#8fb0e8'); gr.addColorStop(1, '#f0cf9e');
    sg.fillStyle = gr; sg.fillRect(0, 0, 2, 256);
  }
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog('#9ab4e0', 14, 32);

  // 고정 정면 사선 — 입력 중엔 카메라가 움직이지 않는다(kick 은 단어 완성 뒤에만, x 만 lerp).
  const camera = new THREE.PerspectiveCamera(44, W / H, 0.1, 60);
  const CAM_Y = 3.4, CAM_Z = 9.5, LOOK_Y = -0.2;
  // 시작 자리는 첫 섬(고양이가 서 있는 곳) 바로 앞 — 게임을 시작하자마자 카메라가 드리프트하지 않게(입력 중 고정 규칙은 로딩 순간에도 지킨다).
  camera.position.set(-ISLAND_X, CAM_Y, CAM_Z);
  camera.lookAt(-ISLAND_X, LOOK_Y, 0);
  camera.updateMatrixWorld();

  scene.add(new THREE.HemisphereLight('#eaf0ff', '#4a5a3a', 1.7));
  const sun = new THREE.DirectionalLight('#fff1d8', 1.5);
  sun.position.set(4, 6, 6);
  scene.add(sun);

  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { owned.push(x); return x; };

  // ── 구름 — 덩이 8개를 한 geometry 로(드로 콜 1)
  const cloudMat = own(new THREE.MeshLambertMaterial({ color: '#fbfcff', emissive: '#6a7aab', flatShading: true }));
  const puffs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.IcosahedronGeometry(0.9, 1);
    const k = 0.85 + ((i * 29) % 6) * 0.1;
    g.scale(k * 1.3, k * 0.65, k);
    g.translate((i - 3.5) * 2.2, 2.6 + ((i * 11) % 4) * 0.2, -3 - (i % 3) * 0.7);
    puffs.push(g);
  }
  const cloud = new THREE.Mesh(own(mergeGeometries(puffs)), cloudMat);
  for (const g of puffs) g.dispose();
  scene.add(cloud);

  // ── 섬 2개(흙 원뿔 + 풀 원판 + 나무) — 정점색으로 한 덩어리(드로 콜 1)
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count; const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  // mergeGeometries 는 인덱스 유무가 섞이면 실패한다(IcosahedronGeometry 는 인덱스가 없다) — 합치기 전에 통일한다.
  const deindex = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
    if (!g.index) return g;
    const ng = g.toNonIndexed();
    g.dispose();
    return ng;
  };
  const DIRT = new THREE.Color('#8a5a3a');
  const GRASS = new THREE.Color('#4fae5c');
  const BARK = new THREE.Color('#6b4a30');
  const LEAF = new THREE.Color('#3a9a4a');
  const ISLAND_Y = -0.3;
  function buildIsland(x: number): THREE.BufferGeometry[] {
    const parts: THREE.BufferGeometry[] = [];
    const cone = deindex(new THREE.ConeGeometry(1.5, 1.1, 10)); cone.translate(x, ISLAND_Y - 0.55, 0);
    parts.push(paint(cone, DIRT));
    const disc = deindex(new THREE.CylinderGeometry(1.55, 1.55, 0.18, 16)); disc.translate(x, ISLAND_Y + 0.05, 0);
    parts.push(paint(disc, GRASS));
    const trunk = deindex(new THREE.CylinderGeometry(0.1, 0.13, 0.75, 6)); trunk.translate(x + 0.55, ISLAND_Y + 0.5, 0.3);
    parts.push(paint(trunk, BARK));
    for (let k = 0; k < 3; k++) {
      const leaf = new THREE.IcosahedronGeometry(0.34 - k * 0.05, 0);
      leaf.translate(x + 0.55, ISLAND_Y + 0.95 + k * 0.28, 0.3);
      parts.push(paint(leaf, LEAF));
    }
    return parts;
  }
  const islandX = ISLAND_X;
  const islandParts = [...buildIsland(-islandX), ...buildIsland(islandX)];
  const islandMat = own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const islands = new THREE.Mesh(own(mergeGeometries(islandParts)), islandMat);
  for (const g of islandParts) g.dispose();
  scene.add(islands);

  // ── 다리 블록 — InstancedMesh 하나(instanceColor 로 상태 표시: 평소 돌색 · 성공 직후 번쩍 · 실패 중 붉게)
  const blockGeo = own(new THREE.BoxGeometry(0.62, 0.22, 0.62));
  const blockMat = own(new THREE.MeshLambertMaterial({ color: '#ffffff' }));
  const blocks = new THREE.InstancedMesh(blockGeo, blockMat, BLOCKS);
  blocks.frustumCulled = false;
  const STONE = new THREE.Color('#9a8f8a');
  const FLASH = new THREE.Color('#ffffff');
  const FAILC = new THREE.Color('#e05a4a');
  for (let i = 0; i < BLOCKS; i++) blocks.setColorAt(i, STONE);
  scene.add(blocks);

  function blockX(i: number): number { return -islandX + (i + 1) * BLOCK_GAP; }

  const slotState: SlotState[] = Array.from({ length: BLOCKS }, () => ({ mode: 'idle', t0: 0 }));
  const placedSlots = new Set<number>();
  let lifetimeHits = 0; // 지금까지 꽂힌 블록 총 수(칸을 돌려 쓴다 — 다리는 유한, 체인은 무한)
  let panTargetX = -islandX;

  // ── 고양이 운전사 «타비» — 몸통+머리+귀+모자를 한 덩어리로(드로 콜 1)
  const catParts: THREE.BufferGeometry[] = [];
  const BODY = new THREE.Color('#f2a94e');
  const EAR = new THREE.Color('#e08a3a');
  const HAT = new THREE.Color('#6c5ce7');
  const body = new THREE.CapsuleGeometry(0.22, 0.3, 4, 8); body.rotateX(Math.PI / 2); body.translate(0, 0.28, 0);
  catParts.push(paint(body, BODY));
  const head = new THREE.SphereGeometry(0.2, 10, 8); head.translate(0, 0.62, 0.08);
  catParts.push(paint(head, BODY));
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.07, 0.14, 6); ear.translate(s * 0.14, 0.82, 0.04);
    catParts.push(paint(ear, EAR));
  }
  const hat = new THREE.ConeGeometry(0.15, 0.22, 10); hat.translate(0, 0.86, 0.08);
  catParts.push(paint(hat, HAT));
  const catMat = own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const cat = new THREE.Mesh(own(mergeGeometries(catParts)), catMat);
  for (const g of catParts) g.dispose();
  cat.position.set(-islandX, ISLAND_Y + 0.14, 0.4);
  scene.add(cat);

  let kickUntil = 0;
  let lastTime = 0;
  const tmpC = new THREE.Color();
  const dummy = new THREE.Object3D();

  // 동적 해상도 — 프레임이 22ms 를 넘으면 3D 배경만 해상도를 낮춘다(1 → 0.5, 되돌리지 않는다).
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

  function easeOutCubic(x: number): number { return 1 - Math.pow(1 - x, 3); }

  const api: PuzzleScene = {
    render(time) {
      const rawDt = lastTime ? time - lastTime : 16;
      const dt = Math.min(50, rawDt);
      lastTime = time;
      if (rawDt < 250) adapt(rawDt);

      // 블록 — 상태별 애니메이션(놓인 블록은 제자리, 비워진 칸은 숨김)
      for (let i = 0; i < BLOCKS; i++) {
        const st = slotState[i];
        const bx = blockX(i);
        if (st.mode === 'dropping') {
          const k = Math.min(1, (time - st.t0) / DROP_MS);
          const y = ISLAND_Y + (1 - easeOutCubic(k)) * 1.6;
          const sq = time - st.t0 < DROP_MS + SQUASH_MS
            ? 1 + 0.3 * Math.max(0, 1 - Math.abs((time - st.t0 - DROP_MS) / SQUASH_MS - 0.5) * 2)
            : 1;
          dummy.position.set(bx, k >= 1 ? ISLAND_Y : y, 0);
          dummy.scale.set(sq, 1 / sq, sq);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          blocks.setMatrixAt(i, dummy.matrix);
          blocks.setColorAt(i, tmpC.copy(FLASH).lerp(STONE, Math.min(1, k * 1.4)));
          if (k >= 1 && time - st.t0 > DROP_MS + SQUASH_MS) st.mode = 'idle';
        } else if (st.mode === 'failing') {
          const k = (time - st.t0) / (FAIL_SHAKE_MS + FAIL_DROP_MS);
          if (k < FAIL_SHAKE_MS / (FAIL_SHAKE_MS + FAIL_DROP_MS)) {
            const wob = Math.sin((time - st.t0) * 0.08) * 0.18;
            dummy.position.set(bx, ISLAND_Y, 0);
            dummy.rotation.set(0, 0, wob);
            dummy.scale.set(1, 1, 1);
          } else {
            const k2 = Math.min(1, (time - st.t0 - FAIL_SHAKE_MS) / FAIL_DROP_MS);
            dummy.position.set(bx, ISLAND_Y - k2 * 2.2, 0);
            dummy.rotation.set(k2 * 2, 0, k2 * 1.4);
            dummy.scale.setScalar(Math.max(0.001, 1 - k2));
          }
          dummy.updateMatrix();
          blocks.setMatrixAt(i, dummy.matrix);
          blocks.setColorAt(i, FAILC);
          if (k >= 1) { st.mode = 'idle'; dummy.scale.setScalar(0.001); dummy.updateMatrix(); blocks.setMatrixAt(i, dummy.matrix); }
        } else if (!placedSlots.has(i)) {
          dummy.position.set(bx, ISLAND_Y, 0);
          dummy.scale.setScalar(0.001);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          blocks.setMatrixAt(i, dummy.matrix);
        }
      }
      blocks.instanceMatrix.needsUpdate = true;
      if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;

      // 카메라·고양이 — x 만 목표치로 서서히 다가간다(목표는 단어 완성 직후에만 바뀐다 → 입력 중엔 사실상 고정)
      camera.position.x += (panTargetX - camera.position.x) * Math.min(1, dt / 220);
      camera.lookAt(camera.position.x, LOOK_Y, 0);
      cat.position.x += (panTargetX - cat.position.x) * Math.min(1, dt / 260);
      cat.rotation.y = Math.sin(time * 0.003) * 0.08;

      const kick = kickUntil > time ? (kickUntil - time) / 180 : 0;
      const fov = 44 - kick * 1.4;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

      renderer.render(scene, camera);
    },
    hit() {
      const slot = lifetimeHits % BLOCKS;
      lifetimeHits += 1;
      placedSlots.add(slot);
      slotState[slot] = { mode: 'dropping', t0: lastTime };
      panTargetX = Math.min(islandX - BLOCK_GAP * 0.5, blockX(slot));
      kickUntil = lastTime + 180;
    },
    fail() {
      const slot = lifetimeHits % BLOCKS;
      placedSlots.delete(slot);
      slotState[slot] = { mode: 'failing', t0: lastTime };
    },
    resize(w, h) {
      W = w; H = h;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    },
    dispose() {
      for (const o of owned) o.dispose();
      skyTex.dispose();
      blocks.dispose();
      renderer.dispose();
    },
    info() {
      const i = renderer.info;
      return { geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls, triangles: i.render.triangles, quality };
    },
  };
  return api;
}
