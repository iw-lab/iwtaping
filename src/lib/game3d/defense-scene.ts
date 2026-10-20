/**
 * 킹덤 디펜스 3D 장면 — 디오라마 성과 길. 장난감 병정들이 길을 따라 행군해 오고,
 * 입력으로 멈춰 세운 뒤(«태엽이 풀려 멈춤») 화살이 실제로 닿으면 그 자리에서 천천히 쓰러진다.
 * 게임 상태·판정은 코어(`lib/game/defense/core.ts`)의 화면 픽셀 그대로다. 이 장면은 그 픽셀을
 * 카메라 광선으로 길 판(z=0)에 투영해 유닛을 놓기만 한다 → 2D 라벨과 유닛이 정확히 겹친다.
 * 카메라는 고정 아이소(입력 중 움직이지 않는다 — 줌 펀치는 단어 완성 뒤 0.2초만).
 * 성능 규칙(GDD-3D §9): DPR 1 · 안티앨리어싱·그림자·후처리 0 · Lambert 재질
 *   · 정적인 것(성·나무)은 한 덩어리로 합치고 병정은 InstancedMesh · 드로 콜 ≤ 30.
 * three 는 이 파일을 동적 import 할 때만 받는다(게임에 들어갈 때만 전송).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DefenseEnemy, DefenseArrow, Ability } from '@/lib/game/defense/core';

export interface DefenseScene {
  /** 매 프레임 — 살아 있는 병사·화살을 그린다 */
  render(enemies: readonly DefenseEnemy[], arrows: readonly DefenseArrow[], time: number, frozen: boolean): void;
  /** 화살이 실제로 닿음 — 병정이 하얗게 번쩍하고 천천히 쓰러져 멈춘다(«태엽이 풀림») */
  hit(enemy: DefenseEnemy): void;
  /** 병사가 성에 닿음 — 성이 짧게 흔들리고 붉게 번쩍인다 */
  miss(enemy: DefenseEnemy): void;
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

const MAX_SOLDIERS = 16;
/** 병정 지오메트리(몸통+머리+모자)의 로컬 높이 — 모자 끝(0.84+0.22/2) 기준. 화면 픽셀 크기를 월드 scale 로 바꿀 때 쓴다. */
const SOLDIER_LOCAL_H = 0.95;
const MAX_ARROWS = 8;
const WIND_MS = 420; // 태엽 풀려 쓰러지는 시간
const KICK_MS = 200;
const MISS_FLASH_MS = 260;

interface WindDown { mesh: THREE.Mesh; t0: number; baseColor: THREE.Color }

export function createDefenseScene(canvas: HTMLCanvasElement, W0: number, H0: number): DefenseScene {
  let W = W0;
  let H = H0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // 하늘 = 세로 그라데이션 텍스처 1장(2×256) — 장난감 방 창문으로 보는 맑은 낮
  const sky = document.createElement('canvas'); sky.width = 2; sky.height = 256;
  const sg = sky.getContext('2d');
  if (sg) {
    const gr = sg.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#6fb8e8'); gr.addColorStop(0.6, '#bfe3ef'); gr.addColorStop(1, '#eef6da');
    sg.fillStyle = gr; sg.fillRect(0, 0, 2, 256);
  }
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog('#bfe3ef', 18, 36);

  // 고정 아이소(기울여 내려다보는 디오라마) — 입력 중 카메라는 움직이지 않는다(줌 펀치는 타격 뒤 0.2초만)
  const BASE_FOV = 36;
  const camera = new THREE.PerspectiveCamera(BASE_FOV, W / H, 0.1, 60);
  camera.position.set(0, 8, 9);
  camera.lookAt(0, -1, 0);
  // 🔴 unproject 는 matrixWorld 를 쓴다 — 첫 render 전엔 단위행렬이라 자리가 화면 가운데로 틀어진다(실측, 씨앗비 교훈)
  camera.updateMatrixWorld();

  scene.add(new THREE.HemisphereLight('#fff6e0', '#4a6a3a', 1.6));
  const sun = new THREE.DirectionalLight('#fff3d6', 1.5);
  sun.position.set(4, 7, 5);
  scene.add(sun);

  // ── 화면 픽셀 → 길 판(z=0) 위 점. 광선과 평면의 교점이라 라벨과 정확히 겹친다.
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
  let unit = 0; // 길 판에서 화면 1px 의 월드 길이
  function measure() {
    pixelToWorld(0, H / 2, tmpA);
    pixelToWorld(W, H / 2, tmpB);
    unit = (tmpB.x - tmpA.x) / W;
  }
  measure();

  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { owned.push(x); return x; };
  // mergeGeometries 는 입력이 전부 인덱스가 있거나 전부 없어야 한다 — 다면체(IcosahedronGeometry)는
  // 인덱스가 없는데 원기둥·상자·원뿔은 있어서 섞으면 실패한다(실측). 합치기 전에 전부 맞춘다.
  const flatten = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
    if (!g.index) return g;
    const ng = g.toNonIndexed();
    g.dispose();
    return ng;
  };

  // ── 잔디 + 길 판(하나로 합침) · 언덕(깊이감, 또 하나로 합침)
  const grassMat = own(new THREE.MeshLambertMaterial({ color: '#4f9a4a' }));
  const pathMat = own(new THREE.MeshLambertMaterial({ color: '#c9a36a' }));
  const grass = new THREE.Mesh(own(new THREE.BoxGeometry(44, 0.5, 10)), grassMat);
  scene.add(grass);
  const path = new THREE.Mesh(own(new THREE.BoxGeometry(44, 0.08, 3.4)), pathMat);
  scene.add(path);
  const hillParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.ConeGeometry(2 + (i % 3) * 0.7, 0.8 + ((i * 7) % 4) * 0.25, 7);
    g.translate((i - 3) * 3.4 + ((i * 13) % 5) * 0.3, 0, -5 - (i % 2) * 2);
    hillParts.push(flatten(g));
  }
  const hills = new THREE.Mesh(own(mergeGeometries(hillParts)), own(new THREE.MeshLambertMaterial({ color: '#8fae72', flatShading: true })));
  for (const g of hillParts) g.dispose();
  scene.add(hills);

  // ── 나무(장식) — 몸통+수관을 합쳐 한 덩어리로(드로 콜 1), 길 양옆에 흩뿌린다
  const treeParts: THREE.BufferGeometry[] = [];
  const TREE_N = 8;
  for (let i = 0; i < TREE_N; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const tx = (i - TREE_N / 2) * 1.35 + ((i * 29) % 7) * 0.2;
    const tz = side * (2.1 + ((i * 11) % 5) * 0.15);
    const trunk = new THREE.CylinderGeometry(0.07, 0.09, 0.5, 6); trunk.translate(tx, 0.25, tz);
    const crown = new THREE.IcosahedronGeometry(0.42, 0); crown.translate(tx, 0.75, tz);
    treeParts.push(flatten(trunk), flatten(crown));
  }
  const treeMat = own(new THREE.MeshLambertMaterial({ color: '#3f8f52', flatShading: true }));
  const trunkTint = new THREE.Color('#6b4a2f');
  const crownTint = new THREE.Color('#3f8f52');
  for (let i = 0; i < treeParts.length; i++) {
    const g = treeParts[i];
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    const c = i % 2 === 0 ? trunkTint : crownTint;
    for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  treeMat.vertexColors = true;
  const trees = new THREE.Mesh(own(mergeGeometries(treeParts)), treeMat);
  for (const g of treeParts) g.dispose();
  scene.add(trees);

  // ── 성 — 탑(원기둥) + 지붕(원뿔) + 깃발(얇은 상자)을 하나로 합친다(드로 콜 1)
  const castleParts: THREE.BufferGeometry[] = [];
  const paintPart = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const n = g.getAttribute('position').count; const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  {
    const stoneC = new THREE.Color('#cfcad2');
    const roofC = new THREE.Color('#d1495b');
    const flagC = new THREE.Color('#ffd166');
    const towerL = new THREE.CylinderGeometry(0.55, 0.62, 2.2, 10); towerL.translate(-0.9, 1.1, 0);
    const towerR = new THREE.CylinderGeometry(0.55, 0.62, 2.2, 10); towerR.translate(0.9, 1.1, 0);
    const keep = new THREE.BoxGeometry(2.3, 1.6, 1.4); keep.translate(0, 0.8, 0);
    castleParts.push(paintPart(towerL, stoneC), paintPart(towerR, stoneC), paintPart(keep, stoneC));
    const roofL = new THREE.ConeGeometry(0.72, 0.9, 10); roofL.translate(-0.9, 2.65, 0);
    const roofR = new THREE.ConeGeometry(0.72, 0.9, 10); roofR.translate(0.9, 2.65, 0);
    castleParts.push(paintPart(roofL, roofC), paintPart(roofR, roofC));
    const poleL = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5); poleL.translate(-0.9, 3.3, 0);
    const flagL = new THREE.BoxGeometry(0.34, 0.2, 0.02); flagL.translate(-0.9 + 0.2, 3.5, 0);
    castleParts.push(paintPart(poleL, stoneC), paintPart(flagL, flagC));
  }
  const castleGeo = own(mergeGeometries(castleParts));
  for (const g of castleParts) g.dispose();
  const castle = new THREE.Mesh(castleGeo, own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  scene.add(castle);

  function layoutStatic() {
    pixelToWorld(W / 2, H * 0.84, tmpA, 0);
    grass.position.set(0, tmpA.y - 0.26, 0);
    path.position.set(0, tmpA.y + 0.01, 0);
    hills.position.set(0, tmpA.y + 0.1, -1.2);
    trees.position.set(0, tmpA.y + 0.01, 0.6);
    // 성 = 화면 우측(스폰·행군 좌표계와 같은 x — castlePos().x = W-100)
    pixelToWorld(W - 100, H * 0.75, tmpB, 0.3);
    castle.position.set(tmpB.x + unit * 70, tmpA.y + 0.02, 0.3);
  }
  layoutStatic();

  // ── 장난감 병정 — 몸통(원기둥)+머리(구)+모자(원뿔)를 한 유닛으로 합쳐 InstancedMesh 하나로 그린다
  const bodyC = new THREE.Color('#e9e2d6');
  const headC = new THREE.Color('#f2c9a0');
  const hatC = new THREE.Color('#2f3a63');
  const soldierParts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(0.17, 0.2, 0.52, 8); body.translate(0, 0.26, 0);
  const head = new THREE.SphereGeometry(0.15, 8, 6); head.translate(0, 0.62, 0);
  const hat = new THREE.ConeGeometry(0.17, 0.22, 8); hat.translate(0, 0.84, 0);
  soldierParts.push(paintPart(body, bodyC), paintPart(head, headC), paintPart(hat, hatC));
  const soldierGeo = own(mergeGeometries(soldierParts));
  for (const g of soldierParts) g.dispose();
  const soldierMat = own(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  const soldiers = new THREE.InstancedMesh(soldierGeo, soldierMat, MAX_SOLDIERS);
  soldiers.frustumCulled = false;
  soldiers.count = 0;
  scene.add(soldiers);
  const tmpColor = new THREE.Color();
  const dummy = new THREE.Object3D();
  const activeIds: number[] = []; // 인스턴스 인덱스 → enemy.id (레이블 금빛 링용)

  // ── 특수 병사 후광 링 — 레벨 2+부터 화면당 1개뿐이라 메시 1개로 족하다
  const ringGeo = own(new THREE.TorusGeometry(0.34, 0.03, 6, 20));
  const ringMat = own(new THREE.MeshBasicMaterial({ color: '#FECA57', transparent: true, opacity: 0.85 }));
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.visible = false;
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);

  // ── 화살 — 몇 안 되는 풀(pool), 간단한 원뿔 촉 + 샤프트
  const arrowGeo = own((() => {
    const parts: THREE.BufferGeometry[] = [];
    const shaft = new THREE.CylinderGeometry(0.02, 0.02, 0.46, 5); shaft.rotateZ(Math.PI / 2); shaft.translate(-0.05, 0, 0);
    const head2 = new THREE.ConeGeometry(0.045, 0.14, 6); head2.rotateZ(-Math.PI / 2); head2.translate(0.2, 0, 0);
    parts.push(shaft, head2);
    return mergeGeometries(parts);
  })());
  const arrowMat = own(new THREE.MeshBasicMaterial({ color: '#caa46a' }));
  const arrowMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < MAX_ARROWS; i++) {
    const m = new THREE.Mesh(arrowGeo, arrowMat);
    m.visible = false;
    scene.add(m);
    arrowMeshes.push(m);
  }

  // ── 쓰러짐(태엽 풀림) 연출 풀 — 화살이 실제로 닿았을 때만 잠깐 쓴다
  const windPool: WindDown[] = [];
  const windFree: THREE.Mesh[] = [];
  function windMesh(): THREE.Mesh {
    let m = windFree.pop();
    if (!m) {
      // 이 재질은 owned 에 넣지 않는다 — dispose() 에서 windPool/windFree 를 따로 돌며 한 번만 지운다.
      m = new THREE.Mesh(soldierGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      scene.add(m);
    }
    m.visible = true;
    m.scale.set(1, 1, 1);
    m.rotation.set(0, 0, 0);
    return m;
  }

  let missFlashUntil = 0;
  let kickUntil = 0;
  let lastTime = 0;
  // 동적 해상도 — 학교 PC(내장 GPU·소프트웨어 GL)에서 프레임이 22ms 를 넘으면 3D 배경만 해상도를 낮춘다.
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

  const api: DefenseScene = {
    render(enemies, arrows, time, frozen) {
      const rawDt = lastTime ? time - lastTime : 16;
      lastTime = time;
      if (rawDt < 250) adapt(rawDt);

      // 병정 — InstancedMesh 인스턴스마다 위치·크기·색을 다시 쓴다(행군 중이라 매 프레임 갱신)
      activeIds.length = 0;
      let ringPos: THREE.Vector3 | null = null;
      let ringPhase = 0;
      const n = Math.min(enemies.length, MAX_SOLDIERS);
      for (let i = 0; i < n; i++) {
        const e = enemies[i];
        // labelShift 는 말풍선만 세로로 비켜 놓는 값 — 병정의 행군 자리(x,y)는 그대로 둔다(원본 2D와 같다).
        pixelToWorld(e.x, e.y, tmpA, 0);
        // 원본 2D 스프라이트 높이(44px·기사 56px)에 맞춰 화면 픽셀 크기를 월드 크기로 바꾼다
        // (병정 지오메트리의 로컬 높이 ≈ SOLDIER_LOCAL_H 이므로 그 비율로 scale 을 구한다).
        const targetPx = e.type === 2 ? 56 : 44;
        const scaleFactor = (targetPx * unit) / SOLDIER_LOCAL_H;
        const bob = e.dying ? 0 : Math.abs(Math.sin(time * 0.009 + e.id)) * 0.05;
        dummy.position.set(tmpA.x, tmpA.y + bob, tmpA.z);
        dummy.rotation.set(0, Math.sin(time * 0.0012 + e.id) * 0.12, 0);
        dummy.scale.setScalar(scaleFactor);
        dummy.updateMatrix();
        soldiers.setMatrixAt(i, dummy.matrix);
        soldiers.setColorAt(i, tmpColor.set(e.color));
        activeIds.push(e.id);
        if (e.special && e.ability) { ringPos = tmpA.clone(); ringPos.y += scaleFactor * 1.05 + 0.05; ringPhase = e.id; }
      }
      soldiers.count = n;
      soldiers.instanceMatrix.needsUpdate = true;
      if (soldiers.instanceColor) soldiers.instanceColor.needsUpdate = true;

      if (ringPos) {
        ring.visible = true;
        ring.position.copy(ringPos);
        ring.rotation.z = time * 0.003 + ringPhase;
      } else {
        ring.visible = false;
      }

      // 화살
      const am = Math.min(arrows.length, MAX_ARROWS);
      for (let i = 0; i < MAX_ARROWS; i++) {
        const mesh = arrowMeshes[i];
        if (i < am) {
          const a = arrows[i];
          pixelToWorld(a.x, a.y, tmpB, 0.12);
          mesh.position.copy(tmpB);
          mesh.rotation.set(0, -a.angle, 0);
          mesh.visible = true;
        } else {
          mesh.visible = false;
        }
      }

      // 쓰러짐(태엽 풀림) 연출 진행
      for (let i = windPool.length - 1; i >= 0; i--) {
        const wd = windPool[i];
        const k = Math.min(1, (time - wd.t0) / WIND_MS);
        wd.mesh.rotation.x = k * (Math.PI / 2.1);
        wd.mesh.scale.setScalar(1 - k * 0.4);
        const mat = wd.mesh.material as THREE.MeshLambertMaterial;
        mat.color.copy(tmpColor.set('#ffffff').lerp(wd.baseColor, Math.min(1, k * 2)));
        if (k >= 1) {
          wd.mesh.visible = false;
          windFree.push(wd.mesh);
          windPool.splice(i, 1);
        }
      }

      // 성 피격 번쩍 + 짧은 떨림(흔들기는 카메라가 아니라 성 자체만)
      const missK = missFlashUntil > time ? (missFlashUntil - time) / MISS_FLASH_MS : 0;
      (castle.material as THREE.MeshLambertMaterial).emissive?.setRGB(missK * 0.5, 0, 0);
      castle.rotation.z = Math.sin(time * 0.08) * 0.015 * missK;

      // 길 판 — 얼음(freeze) 중엔 서리빛으로
      pathMat.color.set(frozen ? '#cfe9f2' : '#c9a36a');

      // 줌 펀치(타격 뒤 0.2초만) — 위치·각도는 그대로, 화각만 살짝
      const kick = kickUntil > time ? (kickUntil - time) / KICK_MS : 0;
      const fov = BASE_FOV - kick * 1.4;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }

      renderer.render(scene, camera);
    },
    hit(enemy) {
      const m = windMesh();
      pixelToWorld(enemy.x, enemy.y, tmpA, 0);
      const s = ((enemy.type === 2 ? 56 : 44) * unit) / SOLDIER_LOCAL_H;
      m.position.copy(tmpA);
      m.scale.setScalar(s);
      windPool.push({ mesh: m, t0: lastTime, baseColor: new THREE.Color(enemy.color) });
      kickUntil = lastTime + KICK_MS;
    },
    miss() {
      missFlashUntil = lastTime + MISS_FLASH_MS;
    },
    ability(kind) {
      if (kind === 'heal') {
        (castle.material as THREE.MeshLambertMaterial).emissive?.setRGB(0, 0.35, 0.1);
        setTimeout(() => { (castle.material as THREE.MeshLambertMaterial).emissive?.setRGB(0, 0, 0); }, 260);
      }
      // freeze 는 render() 의 frozen 플래그로, clear 는 다음 render() 의 인스턴스 수 갱신으로 자연히 반영된다.
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
      soldierMat.dispose();
      soldiers.dispose();
      for (const wd of windPool) (wd.mesh.material as THREE.Material).dispose();
      for (const m of windFree) (m.material as THREE.Material).dispose();
      arrowMat.dispose();
      renderer.dispose();
    },
    info() {
      const i = renderer.info;
      return { geometries: i.memory.geometries, textures: i.memory.textures, calls: i.render.calls, triangles: i.render.triangles, quality };
    },
  };
  return api;
}
