// 타비의 버스 — 이야기·성장 장부(기기 localStorage · 서버 0). 화면·DOM 없음(시험 대상).
// 성장 재료 = 판 결과의 «별»(정확도) — 상점 구매로는 안 큰다(GDD-3D §5). 게임마다 별을 모으면 그 정류장 주인과 친해진다(bond).
import { createGrowth } from './growth.js';

export const STORY_KEY = 'typingverse:story.v1';
export const BUS_STAGES = [
  { id: 'village', need: 0, name: '마을 버스' },
  { id: 'double', need: 25, name: '2층 버스' },
  { id: 'wing', need: 70, name: '날개 버스' },
  { id: 'star', need: 140, name: '별빛 버스' },
];
export const GROW = createGrowth({ stages: BUS_STAGES, bondSteps: [0, 3, 6, 9], unit: '별' });
export const STOPS = ['rain', 'space', 'zombie', 'defense', 'race', 'puzzle'] as const;

export interface StoryBook { first: number; growth: { xp: number; bond: Record<string, number> }; storySeen: Record<string, number> }

export function fresh(): StoryBook { return { first: 1, growth: { xp: 0, bond: {} }, storySeen: {} }; }

/** 읽기 — 깨진 값은 새 장부로(숫자는 진짜 숫자만) */
export function loadBook(storage: Pick<Storage, 'getItem'> | null): StoryBook {
  const b = fresh();
  try {
    const raw = storage?.getItem(STORY_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (d && typeof d === 'object') {
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
      // first 가 없거나 이상하면 처음 기기 그대로(1) — 빈 객체 {} 로 프롤로그가 사라지지 않게
      if (d.first === 0 || d.first === false) b.first = 0;
      b.growth.xp = num(d.growth?.xp);
      if (d.growth?.bond && typeof d.growth.bond === 'object') for (const [k, v] of Object.entries(d.growth.bond)) b.growth.bond[k] = num(v);
      if (d.storySeen && typeof d.storySeen === 'object') for (const [k, v] of Object.entries(d.storySeen)) if (v === 1 || v === true) b.storySeen[k] = 1;
    }
  } catch { /* 깨진 값 */ }
  return b;
}
export function saveBook(storage: Pick<Storage, 'setItem'> | null, b: StoryBook) {
  try { storage?.setItem(STORY_KEY, JSON.stringify(b)); } catch { /* 저장 못 해도 판은 계속 */ }
}

/** 판 하나의 별 — 단어 5개 미만은 0(찍기 방지) · 정확도 80/90/97% 문턱 */
export function starsFor(r: { accuracy?: number; wordsTyped?: number }): number {
  const acc = r.accuracy ?? 0;
  if ((r.wordsTyped ?? 0) < 5) return 0;
  return acc >= 97 ? 3 : acc >= 90 ? 2 : acc >= 80 ? 1 : 0;
}

/** 판 결과를 장부에 더한다 → 성장 사건(버스 단계·정류장 우정) */
export function addGame(b: StoryBook, r: { gameType: string; accuracy?: number; wordsTyped?: number }) {
  const stars = starsFor(r);
  const events = stars ? GROW.gain(b, { xp: stars, bond: { [r.gameType]: stars } }) : [];
  return { stars, events };
}

/** 이야기 비트 when 용 평평한 값 */
export const flatOf = (b: StoryBook) => GROW.flat(b, { first: b.first });
export const busStage = (b: StoryBook) => GROW.stageIdx(b.growth.xp);
export const busGoal = (b: StoryBook) => GROW.nextGoal(b);
