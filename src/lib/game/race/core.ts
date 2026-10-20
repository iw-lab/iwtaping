/**
 * 타이핑 레이스 게임 로직 — 렌더와 분리된 순수 상태 기계.
 * 실제 타이핑 판정(정확도·WPM·한글 조합)은 지금처럼 TypingArea/useTypingEngine(hangul.ts)이 그대로 맡는다.
 * 이 코어는 그 결과(진행률 0~100)를 받아 «고스트 자동차 진행률·추월·승패»만 계산한다 — 2D 판과 3D 판이
 * 같은 코어를 쓰므로 «같은 시드·같은 입력열이면 등수·승패가 같다»(GDD-3D §8 A).
 * 점수식(WPM 그대로 제출)·판정은 페이지가 그대로 쓴다 — 여기서는 바꾸지 않는다.
 */

/** 레이스 모드 — classic(한 판 승부) · time(60초 안에 결승선) · daily(오늘은 모두 같은 상대·같은 글) */
export type RaceMode = 'classic' | 'time' | 'daily';
export const TIME_LIMIT_MS = 60_000;

export interface RaceCar {
  id: number;
  name: string;
  /** 0~100 */
  progress: number;
  color: string;
  isPlayer: boolean;
  /** 고스트: 재생할 실제(또는 합성) WPM */
  wpm?: number;
  /** 고스트: 현재 텍스트 완주까지 걸리는 시간(ms) */
  finishMs?: number;
  isGhost?: boolean;
  /** 실제 유저 기록이면 true, 합성 AI면 false */
  isReal?: boolean;
  /** 사람다운 페이스 흔들림용 시드 */
  seed?: number;
}

export interface GhostSource {
  name: string;
  wpm: number;
  isReal: boolean;
}

export interface Opponent extends GhostSource {
  color: string;
}

/** 실제 고스트가 부족할 때 채우는 합성 AI. WPM = (문자수/5)/분 기준 한국어 초급~고급 대략치(폴백용). */
export const AI_GHOSTS: { name: string; nameEn: string; wpm: number; color: string }[] = [
  { name: 'AI 초급', nameEn: 'AI Easy', wpm: 22, color: '#48DBFB' },
  { name: 'AI 중급', nameEn: 'AI Medium', wpm: 38, color: '#FECA57' },
  { name: 'AI 고급', nameEn: 'AI Hard', wpm: 58, color: '#FF6B6B' },
];
export const GHOST_COLORS = ['#1DD1A1', '#54A0FF', '#FF9FF3', '#FECA57', '#FF6B6B'];
export const PLAYER_COLOR = '#6C5CE7';
export const OPPONENT_COUNT = 3;

/** mulberry32 — 날짜 시드(daily) 결정적 난수. rain 코어와 같은 생성기(각 게임이 자기 코어 안에 둔다). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * 고스트 WPM으로 현재 텍스트(len 글자)를 완주하는 데 걸리는 시간(ms).
 * WPM=(글자/5)/분 이므로 완주ms = (len/5)/WPM*60000 = len*12000/WPM.
 * → 플레이어의 실제 WPM이 고스트 WPM보다 크면 이긴다(정확히 공정) — 기존 판과 같은 식.
 */
export function ghostFinishMs(wpm: number, textLen: number): number {
  return (textLen * 12000) / Math.max(1, wpm);
}

/**
 * 실제 유저 기록(WPM 내림차순)에서 구간별(빠름 20% · 중간 35~60% · 느림 60%~)로 1명씩 뽑는다
 * — 난이도 스펙트럼(빠름/중간/이길만함)이 되도록. rng 주입 — 같은 입력·같은 시드면 같은 사람을 뽑는다.
 */
export function pickRealGhosts(valid: GhostSource[], rng: () => number): GhostSource[] {
  if (valid.length === 0) return [];
  const sorted = [...valid].sort((a, b) => b.wpm - a.wpm);
  const n = sorted.length;
  const bands: [number, number][] = [
    [0, Math.max(1, Math.ceil(n * 0.2))],
    [Math.floor(n * 0.35), Math.max(1, Math.ceil(n * 0.6))],
    [Math.floor(n * 0.6), n],
  ];
  const picked: GhostSource[] = [];
  const used = new Set<string>();
  for (const [lo, hi] of bands) {
    const range = sorted.slice(lo, Math.max(lo + 1, hi)).filter((e) => !used.has(e.name));
    if (range.length === 0) continue;
    const pick = range[Math.floor(rng() * range.length)];
    used.add(pick.name);
    picked.push(pick);
  }
  return picked;
}

/** 상대 3명 구성 — 실제 유저 고스트 우선, 부족분만 합성 AI로 채운다(기존 판과 같은 규칙). */
export function buildOpponents(real: GhostSource[], rng: () => number, isKorean: boolean): Opponent[] {
  const picked = pickRealGhosts(real, rng);
  const opponents: Opponent[] = [];
  picked.slice(0, OPPONENT_COUNT).forEach((g, i) => opponents.push({ ...g, color: GHOST_COLORS[i % GHOST_COLORS.length] }));
  for (const ai of AI_GHOSTS) {
    if (opponents.length >= OPPONENT_COUNT) break;
    opponents.push({ name: isKorean ? ai.name : ai.nameEn, wpm: ai.wpm, isReal: false, color: ai.color });
  }
  return opponents;
}

export type RaceEvent =
  | { type: 'overtake'; rank: number }
  /** 고스트가 먼저 골인(플레이어 패배) — 또는 time 모드에서 시간 초과 */
  | { type: 'lost' }
  /** 플레이어가 먼저 100%에 도달(확정은 TypingArea onComplete) */
  | { type: 'win' };

export interface RaceCoreOptions {
  mode: RaceMode;
  /** 이번 판 문장의 글자 수 — 고스트 완주 시간 계산에 쓴다 */
  textLen: number;
  opponents: Opponent[];
  playerName: string;
}

export class RaceCore {
  readonly mode: RaceMode;
  readonly textLen: number;
  /** cars[0] = 플레이어, 나머지 = 고스트(실제 기록 우선 + 합성 AI) */
  cars: RaceCar[];
  over = false;
  /** 고스트가 먼저 골인(또는 시간 초과)해 강제 종료된 판인가 */
  lost = false;
  /** 첫 tick 시각 — 고스트 진행률·time 모드 시간 초과 계산 기준 */
  startedAt = -1;
  private prevRank: number;

  constructor(opts: RaceCoreOptions) {
    this.mode = opts.mode;
    this.textLen = opts.textLen;
    this.cars = [
      { id: 0, name: opts.playerName, progress: 0, color: PLAYER_COLOR, isPlayer: true },
      ...opts.opponents.map((o, i) => ({
        id: i + 1,
        name: o.name,
        progress: 0,
        color: o.color,
        isPlayer: false,
        wpm: o.wpm,
        finishMs: ghostFinishMs(o.wpm, opts.textLen),
        isGhost: true,
        isReal: o.isReal,
        seed: i * 2.3 + 0.7,
      })),
    ];
    // 출발은 전원 동률 — 꼴찌로 간주해 레이스 시작 직후 오탐 추월을 막는다.
    this.prevRank = this.cars.length;
  }

  private checkOvertake(ev: RaceEvent[]): void {
    const rank = this.playerRank();
    if (rank > 0 && rank < this.prevRank) ev.push({ type: 'overtake', rank });
    this.prevRank = rank || this.prevRank;
  }

  /**
   * 한 프레임(폴링 간격) — 고스트 진행률만 갱신한다. elapsed = performance.now() 같은 단조 시각(ms).
   * 고스트 진행률 = 경과/완주시간(완주시간은 실제 WPM으로 계산되므로 플레이어가 더 빠르면 반드시 이긴다) +
   * 사람다운 페이스 흔들림(시작·끝에서 0이라 완주시간은 정확히 보존된다) — 기존 판과 같은 식.
   */
  tick(elapsed: number): RaceEvent[] {
    const ev: RaceEvent[] = [];
    if (this.over) return ev;
    if (this.startedAt < 0) this.startedAt = elapsed;
    const t = elapsed - this.startedAt;
    for (const car of this.cars) {
      if (car.isPlayer || !car.finishMs) continue;
      const base = Math.min(100, (t / car.finishMs) * 100);
      const env = Math.sin((Math.PI * base) / 100);
      const noise = 3.5 * env * Math.sin(t * 0.0016 + (car.seed ?? 0));
      car.progress = Math.max(0, Math.min(100, base + noise));
    }
    const anyGhostFinished = this.cars.some((c) => !c.isPlayer && c.progress >= 100);
    if (anyGhostFinished) {
      this.over = true;
      this.lost = true;
      ev.push({ type: 'lost' });
      return ev;
    }
    if (this.mode === 'time' && t >= TIME_LIMIT_MS) {
      this.over = true;
      this.lost = true;
      ev.push({ type: 'lost' });
      return ev;
    }
    this.checkOvertake(ev);
    return ev;
  }

  /** 플레이어 진행률(실제 타이핑 결과에서 온다 — TypingArea onProgress). 100%면 즉시 승리 처리. */
  setPlayerProgress(progress: number): RaceEvent[] {
    const ev: RaceEvent[] = [];
    if (this.over) return ev;
    const player = this.cars[0];
    player.progress = Math.max(0, Math.min(100, progress));
    if (player.progress >= 100) {
      this.over = true;
      ev.push({ type: 'win' });
      return ev;
    }
    this.checkOvertake(ev);
    return ev;
  }

  /** 진행률 내림차순 — 동률은 배열 순서(플레이어가 먼저) 유지(안정 정렬). */
  rank(): RaceCar[] {
    return [...this.cars].sort((a, b) => b.progress - a.progress);
  }

  playerRank(): number {
    return this.rank().findIndex((c) => c.isPlayer) + 1;
  }
}
