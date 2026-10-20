/**
 * 우주 방어 3D 장면 — 우주 통로를 고정 후방(체이스) 시점으로 바라본다. 고장 난 드론이 통로 깊은 곳에서
 * 나타나 기지로 다가오고, 글자를 맞힐 때마다 수리 광선이 자란다. 완성하면 드론이 하얗게 번쩍하며
 * 되살아나 편대(기지 옆 호위 자리)로 날아간다. 못 고치고 기지에 닿으면 방패가 흔들린다.
 *
 * 게임 상태·판정은 코어(`lib/game/space/core.ts`)의 화면 픽셀 그대로다. 코어의 (x, y)는 기준점
 * (spaceCenter)에서 바깥으로 퍼진 2D 좌표이고, 이 장면은 "기준점으로부터의 거리"를 통로 깊이(z)로
 * 바꿔 카메라 광선 투영에 쓴다 — 멀수록(방금 스폰) 안쪽, 가까울수록(기지 코앞) 카메라 쪽.
 * 성능 규칙(GDD-3D §9): DPR 1 · 안티앨리어싱·그림자·후처리 0 · Lambert 재질 · 정적인 것(통로)은
 * 한 덩어리로 합치고 별은 InstancedMesh · 드론은 몸통+프로펠러 4+LED 눈을 한 지오메트리로 merge ·
 * 드로 콜 ≤ 30 · 동적 해상도 adapt().
 * three 는 이 파일을 동적 import 할 때만 받는다(게임에 들어갈 때만 전송).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SpaceEnemy, Ability } from '@/lib/game/space/core';
import { spaceCenter, spawnDist } from '@/lib/game/space/core';

export interface SpaceScene {
  /** 매 프레임 — 살아 있는 드론을 그린다. target = 입력 중인 드론(수리 광선 길이용) */
  render(enemies: readonly SpaceEnemy[], time: number, frozen: boolean, target: { id: number | null; typed: number }): void;
  /** 명중 — 드론이 하얗게 번쩍 + 찌그러짐 → 편대 자리로 날아간다 */
  hit(enemy: SpaceEnemy): void;
  /** 놓침 — 기지 방패가 흔들린다 */
  miss(): void;
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

const FORMATION_SLOTS = 6;
const STAR_COUNT = 260;
const RING_COUNT = 9;
const RING_GAP = 2.6;
const TUNNEL_NEAR_Z = 1.0;
const TUNNEL_FAR_Z = -1.6 - RING_COUNT * RING_GAP;
const FLY_MS = 420;
const KICK_MS = 180;

interface Flying { mesh: THREE.Mesh; from: THREE.Vector3; slot: number; t0: number }
interface Slot { pos: THREE.Vector3; occupant: THREE.Mesh | null }

export function createSpaceScene(canvas: HTMLCanvasElement, W0: number, H0: number): SpaceScene {
  let W = W0;
  let H = H0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05061a');
  scene.fog = new THREE.Fog('#05061a', 6, Math.abs(TUNNEL_FAR_Z) + 6);

  // 고정 후방(체이스) 시점 — 내 함선 바로 뒤 위에서 통로 안쪽을 본다. 입력 중엔 카메라가 움직이지 않는다.
  const BASE_FOV = 54;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, W / H, 0.1, 80);
  camera.position.set(0, 1.35, 3.4);
  camera.lookAt(0, 0.15, -20);
  // 🔴 unproject 는 matrixWorld 를 쓴다 — 첫 render 전엔 단위행렬이라 자리가 틀어진다(씨앗비에서 실측).
  camera.updateMatrixWorld();

  scene.add(new THREE.HemisphereLight('#aab8ff', '#101033', 1.1));
  const key = new THREE.DirectionalLight('#dfe8ff', 1.1);
  key.position.set(2, 4, 4);
  scene.add(key);

  // ── 화면 픽셀 + 깊이(z) → 월드 점. 광선과 z평면의 교점이라 2D 라벨과 정확히 겹친다(씨앗비와 같은 트릭,
  // z를 고정값이 아니라 드론마다 다른 깊이로 쓴다는 점만 다르다).
  const ndc = new THREE.Vector3();
  const dir = new THREE.Vector3();
  function pixelToWorld(px: number, py: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    ndc.set((px / W) * 2 - 1, -(py / H) * 2 + 1, 0.5).unproject(camera);
    dir.copy(ndc).sub(camera.position).normalize();
    const t = (z - camera.position.z) / dir.z;
    return out.copy(camera.position).addScaledVector(dir, t);
  }
  const tmpA = new THREE.Vector3();

  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { owned.push(x); return x; };

  // ── 통로(튜브) — 안으로 들어갈수록 작아지는 팔각 고리 9개 + 모서리 기둥 4개를 한 덩어리로(드로 콜 1)
  const tunnelParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const z = TUNNEL_NEAR_Z - i * RING_GAP;
    const ring = new THREE.TorusGeometry(2.3, 0.045, 5, 8);
    ring.translate(0, 0.1, z);
    tunnelParts.push(ring);
  }
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const strut = new THREE.BoxGeometry(0.07, 0.07, RING_COUNT * RING_GAP);
    strut.translate(Math.cos(ang) * 2.3, 0.1 + Math.sin(ang) * 2.3, TUNNEL_NEAR_Z - (RING_COUNT * RING_GAP) / 2);
    tunnelParts.push(strut);
  }
  const tunnelMat = own(new THREE.MeshLambertMaterial({ color: '#2a3a7a', emissive: '#111b45', flatShading: true }));
  const tunnel = new THREE.Mesh(own(mergeGeometries(tunnelParts)), tunnelMat);
  for (const g of tunnelParts) g.dispose();
  scene.add(tunnel);

  // ── 별 배경 — InstancedMesh 하나. 통로 바깥 넓은 구역에 흩어 두고 아주 천천히 안쪽으로 흘러 들어오게 한다.
  const starGeo = own(new THREE.IcosahedronGeometry(0.035, 0));
  const starMat = own(new THREE.MeshBasicMaterial({ color: '#dfe8ff' }));
  const stars = new THREE.InstancedMesh(starGeo, starMat, STAR_COUNT);
  stars.frustumCulled = false;
  scene.add(stars);
  const starSeed = Array.from({ length: STAR_COUNT }, (_, i) => ({
    x: (((i * 7919) % 2000) / 1000 - 1) * 14,
    y: (((i * 104729) % 2000) / 1000 - 1) * 8 + 1,
    z: ((i * 31) % 1000) / 1000,
  }));
  const dummy = new THREE.Object3D();

  // ── 내 함선(기지) — 저폴리 조각 몇 개를 합쳐 한 덩어리로 · 방패는 따로(흔들림·번쩍을 독립적으로 주려고)
  const shipParts: THREE.BufferGeometry[] = [];
  const hull = new THREE.ConeGeometry(0.42, 1.1, 6); hull.rotateX(Math.PI / 2); hull.translate(0, 0, 0.1); shipParts.push(hull);
  const wingGeo = new THREE.BoxGeometry(1.5, 0.06, 0.5);
  const wingL = wingGeo.clone(); wingL.translate(-0.7, -0.05, 0.3); shipParts.push(wingL);
  const wingR = wingGeo.clone(); wingR.translate(0.7, -0.05, 0.3); shipParts.push(wingR);
  wingGeo.dispose();
  const ship = new THREE.Mesh(own(mergeGeometries(shipParts)), own(new THREE.MeshLambertMaterial({ color: '#8b7cf7', emissive: '#2a1f66', flatShading: true })));
  for (const g of shipParts) g.dispose();
  ship.position.set(0, 0.55, 2.4);
  ship.rotation.y = Math.PI;
  scene.add(ship);

  const shieldMat = own(new THREE.MeshBasicMaterial({ color: '#00d2d3', transparent: true, opacity: 0.16, wireframe: true }));
  const shield = new THREE.Mesh(own(new THREE.IcosahedronGeometry(1.05, 1)), shieldMat);
  shield.position.copy(ship.position);
  scene.add(shield);
  let shieldShakeUntil = 0;

  // ── 수리 광선 — 입력 중인 드론 하나에만 뜨는 가는 빔(기지 → 드론). 평소엔 숨긴다.
  // 원기둥 기본 축(Y)이 그대로 "빔의 길이 방향" — 매 프레임 두 점 사이로 scale.y·회전만 다시 맞춘다.
  const beamGeo = own(new THREE.CylinderGeometry(0.018, 0.018, 1, 6, 1, true));
  const beamMat = own(new THREE.MeshBasicMaterial({ color: '#7cf7ff', transparent: true, opacity: 0.75 }));
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.visible = false;
  scene.add(beam);
  const UP = new THREE.Vector3(0, 1, 0);
  const beamDir = new THREE.Vector3();

  // ── 드론 — 몸통+프로펠러 4+LED 눈을 한 geometry 로 merge(드로 콜 1/개체). 색·반짝임은 개체마다 다른
  // material 인스턴스로 준다(공유 재질로는 드론별 깜빡임 위상을 따로 줄 수 없다).
  function buildDroneGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.BoxGeometry(0.46, 0.26, 0.6); parts.push(body);
    const nose = new THREE.ConeGeometry(0.16, 0.3, 6); nose.rotateX(Math.PI / 2); nose.translate(0, 0, 0.45); parts.push(nose);
    const eye = new THREE.SphereGeometry(0.075, 8, 6); eye.translate(0, 0.03, 0.55); parts.push(eye);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const ax = Math.cos(ang) * 0.3, az = Math.sin(ang) * 0.3;
      const arm = new THREE.BoxGeometry(0.05, 0.05, 0.38); arm.translate(ax, 0.02, az); parts.push(arm);
      const blade = new THREE.BoxGeometry(0.3, 0.015, 0.07); blade.translate(ax, 0.07, az); parts.push(blade);
    }
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    return merged;
  }
  const droneGeo = own(buildDroneGeometry());

  const drones = new Map<number, THREE.Mesh>();
  const freeMeshes: THREE.Mesh[] = [];
  const flying: Flying[] = [];
  const droneMaterials: THREE.MeshLambertMaterial[] = [];
  function newDroneMaterial(): THREE.MeshLambertMaterial {
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#330000', flatShading: true });
    droneMaterials.push(m);
    return m;
  }
  function droneMesh(e: SpaceEnemy): THREE.Mesh {
    let m = drones.get(e.id);
    if (m) return m;
    m = freeMeshes.pop() ?? new THREE.Mesh(droneGeo, newDroneMaterial());
    m.visible = true;
    m.userData.broken = true;
    m.userData.phase = e.id * 1.37;
    (m.material as THREE.MeshLambertMaterial).color.set(e.color);
    scene.add(m);
    drones.set(e.id, m);
    return m;
  }
  function release(m: THREE.Mesh) {
    m.visible = false;
    m.removeFromParent();
    freeMeshes.push(m);
  }

  // ── 편대(호위) 자리 — 기지 옆에 고정된 칸(V자 대형). 고친 드론이 도착하면 그 칸을 차지한다(칸이 차 있으면 이전 드론은 반납).
  const slots: Slot[] = [];
  for (let i = 0; i < FORMATION_SLOTS; i++) {
    const k = i - (FORMATION_SLOTS - 1) / 2;
    slots.push({ pos: new THREE.Vector3(k * 0.62, 0.4 + (i % 2) * 0.1, ship.position.z - Math.abs(k) * 0.16), occupant: null });
  }
  let landedCount = 0;

  let kickUntil = 0;
  let lastTime = 0;
  // 동적 해상도 — 학교 PC(내장 GPU·소프트웨어 GL)에서 프레임이 22ms 를 넘으면 해상도를 낮춘다(1 → 0.5, 0.17 간격).
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

  /** 드론의 "통로 깊이" — 기준점(기지)에서 멀수록(방금 스폰) 안쪽(더 음수인 z), 가까울수록 기지 코앞. */
  function depthOf(e: SpaceEnemy): number {
    const { cx, cy } = spaceCenter(W, H);
    const maxDist = spawnDist(W, H);
    const d = Math.hypot(e.x - cx, e.y - cy);
    const t = Math.min(1, Math.max(0, d / maxDist));
    return TUNNEL_NEAR_Z + (TUNNEL_FAR_Z - TUNNEL_NEAR_Z) * t;
  }

  const api: SpaceScene = {
    render(enemies, time, frozen, target) {
      const rawDt = lastTime ? time - lastTime : 16;
      const dt = Math.min(50, rawDt);
      lastTime = time;
      if (rawDt < 250) adapt(rawDt);

      const live = new Set<number>();
      let targetPos: THREE.Vector3 | null = null;
      let targetLen = 1;
      for (const e of enemies) {
        live.add(e.id);
        const m = droneMesh(e);
        const z = depthOf(e);
        pixelToWorld(e.x + (e.labelShift ?? 0), e.y, z, m.position);
        const scale = (e.isBoss ? 1.7 : e.special ? 1.25 : 1) * (m.userData.squashUntil > time ? 1 + 0.3 * ((m.userData.squashUntil - time) / 120) : 1);
        m.scale.setScalar(scale);
        // 비행 자세 — 가볍게 좌우로 기울고(wobble) 통로 중심을 바라보도록 살짝 돌아본다.
        m.rotation.y = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z) + Math.sin(time * 0.002 + m.userData.phase) * 0.15;
        m.rotation.z = Math.sin(time * 0.003 + m.userData.phase) * 0.08;
        // 고장난 드론은 LED/몸체가 붉게 깜빡인다(수리되면 hit()에서 흰색으로 바뀌고 이 깜빡임도 멈춘다).
        if (m.userData.broken) {
          const pulse = 0.5 + 0.5 * Math.sin(time * 0.01 + m.userData.phase);
          (m.material as THREE.MeshLambertMaterial).emissive.setRGB(0.5 * pulse, 0.05, 0.05);
        }
        if (target.id === e.id) { targetPos = m.position.clone(); targetLen = Math.max(1, e.text.length); }
      }
      for (const [id, m] of drones) if (!live.has(id)) { drones.delete(id); release(m); }

      // 수리 광선 — 입력한 글자 수만큼 자라서 드론까지 이어진다(글자마다 조금씩 더 간다).
      if (targetPos && !frozen) {
        beam.visible = true;
        const from = ship.position.clone(); from.y += 0.15;
        const k = Math.min(1, (target.typed + 0.4) / (targetLen + 0.4));
        tmpA.lerpVectors(from, targetPos, k); // 빔의 끝점 — 아직 다 안 쳤으면 드론 못 미쳐 멈춘다
        const len = from.distanceTo(tmpA);
        if (len < 0.01) {
          beam.visible = false;
        } else {
          beam.position.copy(from).lerp(tmpA, 0.5);
          beam.scale.set(1, len, 1);
          beamDir.subVectors(tmpA, from).normalize();
          beam.quaternion.setFromUnitVectors(UP, beamDir);
          beamMat.opacity = 0.5 + 0.35 * Math.sin(time * 0.02);
        }
      } else {
        beam.visible = false;
      }

      // 날아가는(수리 완료) 드론 → 편대 자리
      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i];
        const k = Math.min(1, (time - f.t0) / FLY_MS);
        const to = slots[f.slot].pos;
        f.mesh.position.lerpVectors(f.from, to, k);
        f.mesh.position.y += Math.sin(k * Math.PI) * 0.4;
        f.mesh.rotation.y += dt * 0.01;
        if (k >= 1) {
          f.mesh.position.copy(to);
          f.mesh.userData.broken = false;
          (f.mesh.material as THREE.MeshLambertMaterial).emissive.set('#113322');
          (f.mesh.material as THREE.MeshLambertMaterial).color.set(f.mesh.userData.homeColor ?? '#9be89b');
          const prevOccupant = slots[f.slot].occupant;
          if (prevOccupant && prevOccupant !== f.mesh) release(prevOccupant);
          slots[f.slot].occupant = f.mesh;
          flying.splice(i, 1);
        }
      }
      // 편대 자리에 선 드론은 살짝 맴돈다(살아 있는 느낌)
      for (const s of slots) {
        if (!s.occupant) continue;
        s.occupant.position.y = s.pos.y + Math.sin(time * 0.0025 + s.pos.x) * 0.05;
        s.occupant.rotation.z = Math.sin(time * 0.002 + s.pos.x) * 0.1;
      }

      // 별 — 아주 천천히 통로 안쪽(-z)에서 바깥(+z, 카메라 쪽)으로 흘러 다시 감는다.
      for (let i = 0; i < STAR_COUNT; i++) {
        const s = starSeed[i];
        if (!frozen) s.z = (s.z + dt * 0.00006) % 1;
        dummy.position.set(s.x, s.y, TUNNEL_FAR_Z - 4 + s.z * (Math.abs(TUNNEL_FAR_Z) + 8));
        dummy.updateMatrix();
        stars.setMatrixAt(i, dummy.matrix);
      }
      stars.instanceMatrix.needsUpdate = true;

      // 방패 — 평소엔 은은하게, 피격 뒤 잠깐 흔들리고 붉게 번쩍인다.
      const shake = shieldShakeUntil > time ? (shieldShakeUntil - time) / 260 : 0;
      shield.scale.setScalar(1 + Math.sin(time * 0.006) * 0.015 + shake * 0.25 * Math.sin(time * 0.09));
      shieldMat.opacity = frozen ? 0.1 : 0.16 + shake * 0.5;
      shieldMat.color.set(shake > 0 ? '#ff5050' : '#00d2d3');

      // 줌 펀치(명중 직후 0.18초) — 위치·각도는 그대로, 화각만 살짝
      const kick = kickUntil > time ? (kickUntil - time) / KICK_MS : 0;
      const fov = BASE_FOV - kick * 2;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

      renderer.render(scene, camera);
    },
    hit(enemy) {
      const m = drones.get(enemy.id);
      if (!m) return;
      drones.delete(enemy.id);
      const mat = m.material as THREE.MeshLambertMaterial;
      m.userData.homeColor = enemy.color;
      mat.color.set('#ffffff');
      mat.emissive.set('#aaaaaa');
      m.userData.squashUntil = lastTime + 140;
      // 편대 자리는 도착한 뒤에(render의 비행 완료 분기) 배정한다 — 여기서 바로 배정하면
      // 같은 자리에 먼저 날아가고 있던 드론이 도착 전에 반납돼 버린다(짧은 콤보 폭주 시 겹침).
      const slot = landedCount % FORMATION_SLOTS;
      landedCount += 1;
      flying.push({ mesh: m, from: m.position.clone(), slot, t0: lastTime });
      kickUntil = lastTime + KICK_MS;
    },
    miss() {
      shieldShakeUntil = lastTime + 420;
    },
    ability(kind) {
      if (kind === 'clear') for (const [id, m] of drones) { drones.delete(id); release(m); }
      if (kind === 'heal') shieldShakeUntil = 0;
    },
    resize(w, h) {
      W = w; H = h;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    },
    dispose() {
      for (const mat of droneMaterials) mat.dispose();
      for (const o of owned) o.dispose();
      stars.dispose();
      renderer.dispose();
    },
    info() {
      const i = renderer.info;
      return { geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls, triangles: i.render.triangles, quality };
    },
  };
  return api;
}
