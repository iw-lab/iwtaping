/**
 * 끝말잇기 게임 로직 — 렌더와 분리된 순수 상태 기계.
 * 2D(DOM 카드) 판과 3D(다리 블록) 판이 같은 코어를 쓰므로
 * «같은 시드·같은 입력열이면 점수·정확도·단어 수가 같다»(GDD-3D §8 A).
 * 규칙·검증 순서·점수식·생성 방식은 기존 페이지(구 src/app/game/puzzle/page.tsx)와 완전히 같다 —
 * 로직만 이 파일로 옮기고, Math.random() 은 rng() 주입으로 바꿨다(시험·daily 결정성).
 */
import { allowedStarts } from '@/lib/game/hangul';

const HANGUL_WORD = /^[가-힣]+$/;
const ENGLISH_WORD = /^[a-zA-Z]+$/;

/** 모드 — classic(기존 그대로) · time(60초 통짜 세션) · survival(목숨 3·점점 빨라짐) · daily(오늘의 시드) */
export type PuzzleMode = 'classic' | 'time' | 'survival' | 'daily';

/** 기존 판 그대로 — 첫 제한시간 16초 · 정답 보너스 +4초 · 상한 20초. */
export const TURN_START_MS = 16_000;
export const TURN_BONUS_MS = 4_000;
export const TURN_CAP_MS = 20_000;
/** time 모드 — 60초 통짜 세션. 그 안에서도 classic 과 같은 턴 시계가 같이 돌아 둘 중 먼저 닿는 쪽이 끝낸다. */
export const TIME_LIMIT_MS = 60_000;
/** survival 모드 — 목숨 3개. 보너스 없는 더 빠듯한 턴 시계(레벨이 오를수록 더 빠듯해진다) — 다 쓰면 블록이 떨어지고 다음 섬 조각으로 이어간다. */
export const SURVIVAL_LIVES = 3;
export const SURVIVAL_TURN_MS = 10_000;
export const SURVIVAL_TURN_MIN_MS = 4_000;
export const SURVIVAL_TURN_STEP_MS = 700;
/** 상대(컴퓨터)가 막히면 주는 보너스 점수(기존 그대로). */
export const STUCK_BONUS = 100;
/** 몇 번 이어야 레벨이 오르나(survival 턴 시계가 빨라지는 기준). */
export const WORDS_PER_LEVEL = 8;

export type InvalidReason = 'bad-start' | 'used' | 'too-short' | 'malformed' | 'not-in-dict';

export interface ChainEntry {
  word: string;
  isPlayer: boolean;
}

export type PuzzleEvent =
  | { type: 'start'; word: string }
  /** 체인에 단어가 실제로 더해졌다(플레이어 정답 또는 상대 수) — 3D 판은 다리 블록을 하나 놓는다(squash) */
  | { type: 'hit'; word: string; points: number; isPlayer: boolean }
  | { type: 'invalid'; reason: InvalidReason }
  /** 상대가 이어갈 단어를 못 찾았다(+100점) — 체인이 끊기지 않고 round 가 뒤따른다 */
  | { type: 'bonus'; points: number }
  /** 새 라운드 시작 단어(상대가 막혔거나 survival 턴 초과 뒤) — 3D 판은 블록을 또 하나 놓는다 */
  | { type: 'round'; word: string }
  /** 턴 시간이 다 돼 이번 수를 놓쳤다 — 3D 판은 다음 블록이 흔들리다 떨어진다 */
  | { type: 'miss' }
  | { type: 'gameover' }
  | { type: 'levelup'; level: number };

export interface PuzzleCoreOptions {
  isKorean: boolean;
  /** [0,1) 난수 — 시험·daily 는 시드 난수를 넣는다 */
  rng: () => number;
  /** 상대(컴퓨터)가 낼 수 있는 단어 풀 + 시작 단어 후보. 언어별 최소 글자 수로 이미 걸러져 있어야 한다. */
  wordPool: string[];
  /** 플레이어 입력 검증용 사전. 비어 있으면(아직 로딩 전) 형태 검증으로만 판정한다(기존 그대로). */
  validWords: Set<string>;
  mode?: PuzzleMode;
}

/** mulberry32 — 날짜 시드(daily)·시험용 결정적 난수 (rain 코어와 같은 식, 이 파일 안에 자체 보유) */
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

function fallbackStarter(isKorean: boolean): string {
  return isKorean ? '사과' : 'apple';
}

export class PuzzleCore {
  readonly mode: PuzzleMode;
  private opts: PuzzleCoreOptions;
  /** 지금까지 이어진 체인(표시용) — 섬·다리 블록 수와 1:1은 아니다(시작 단어도 포함). */
  chain: ChainEntry[] = [];
  usedWords = new Set<string>();
  currentWord = '';
  score = 0;
  combo = 0;
  maxCombo = 0;
  /** 플레이어가 맞힌 단어 수 — 정확도 산출에 attempts 와 함께 쓴다. */
  totalWords = 0;
  attempts = 0;
  level = 1;
  lives = SURVIVAL_LIVES;
  over = false;
  /** 첫 tick 시각 */
  startedAt = -1;
  private lastTick = -1;
  private turnRemainingMs = TURN_START_MS;
  private dictFirstChars: Set<string>;

  constructor(opts: PuzzleCoreOptions) {
    this.opts = opts;
    this.mode = opts.mode ?? 'classic';
    this.dictFirstChars = new Set([...opts.validWords].map((w) => this.firstChar(w)));
    this.turnRemainingMs = this.mode === 'survival' ? SURVIVAL_TURN_MS : TURN_START_MS;
  }

  /** 쓴 단어 장부 열쇠 — 영어는 소문자(Apple·apple 을 같은 단어로 · 8way codex·gemini·grok) */
  private key(word: string): string { return this.opts.isKorean ? word : word.toLowerCase(); }

  private firstChar(word: string): string {
    return this.opts.isKorean ? word[0] : word[0].toLowerCase();
  }
  private lastChar(word: string): string {
    return this.opts.isKorean ? word[word.length - 1] : word[word.length - 1].toLowerCase();
  }

  /** 이 끝글자로 이어갈 단어가 사전에 실제로 존재하는가(= 막다른 글자가 아닌가). */
  private answerable(ch: string): boolean {
    if (!ch) return false;
    // 사전은 페이지가 나중에 같은 Set 에 채운다 — 스냅샷이 비어 있으면 그때 다시 만든다(8way grok)
    if (this.dictFirstChars.size === 0 && this.opts.validWords.size > 0) this.dictFirstChars = new Set([...this.opts.validWords].map((w) => this.firstChar(w)));
    if (this.dictFirstChars.size === 0) return true; // 사전 로딩 전이면 막지 않음(기존 그대로)
    for (const s of allowedStarts(ch)) if (this.dictFirstChars.has(s)) return true;
    return false;
  }

  /** 게임 시작 단어 — 이어갈 단어가 실제로 존재하는 시작 단어만 고른다(막다른 시작 방지). 못 고르면 고정 폴백(기존 그대로). */
  private pickStarter(): string {
    const { wordPool, rng, isKorean } = this.opts;
    const solvable = wordPool.filter((w) => w.length >= 2 && this.answerable(this.lastChar(w)));
    const pickFrom = solvable.length > 0 ? solvable : wordPool;
    if (pickFrom.length > 0) return pickFrom[Math.floor(rng() * pickFrom.length)];
    return fallbackStarter(isKorean);
  }

  /** 상대가 막혔거나(보너스) 턴을 놓쳤을 때(survival) 새로 여는 라운드 시작 단어. 없으면 null(기존 그대로 — 억지로 만들지 않는다). */
  private nextStarter(exclude: Set<string>): string | null {
    const { wordPool, rng } = this.opts;
    const candidates = wordPool.filter((w) => !exclude.has(this.key(w)) && this.answerable(this.lastChar(w)));
    if (candidates.length === 0) return null;
    return candidates[Math.floor(rng() * candidates.length)];
  }

  private findComputerWord(lastCh: string): string | null {
    const { wordPool, rng } = this.opts;
    const starts = allowedStarts(lastCh);
    const candidates = wordPool.filter((w) => starts.has(this.firstChar(w)) && !this.usedWords.has(this.key(w)));
    if (candidates.length === 0) return null;
    // 플레이어가 이어갈 수 있는 단어만 낸다(막다른 글자로 끝나는 단어는 내지 않음).
    const safe = candidates.filter((w) => this.answerable(this.lastChar(w)));
    if (safe.length === 0) return null;
    return safe[Math.floor(rng() * safe.length)];
  }

  /** survival 모드 턴 시간 — 레벨이 오를수록 빠듯해진다(바닥 있음). */
  private survivalTurnMs(): number {
    return Math.max(SURVIVAL_TURN_MIN_MS, SURVIVAL_TURN_MS - (this.level - 1) * SURVIVAL_TURN_STEP_MS);
  }

  /** 한 프레임 진행. 턴 시계가 다 되면 이번 수를 놓친다(miss) — survival 은 목숨을 깎고 새 라운드로, 그 밖은 즉시 게임오버.
   *  time 모드는 턴 시계와 별개로 전체 세션 예산(60초)도 같이 본다 — 둘 중 먼저 닿는 쪽이 끝낸다. */
  tick(time: number): PuzzleEvent[] {
    const ev: PuzzleEvent[] = [];
    if (this.over) return ev;
    if (this.startedAt < 0) {
      this.startedAt = time;
      this.lastTick = time;
      const starter = this.pickStarter();
      this.currentWord = starter;
      this.usedWords.add(this.key(starter));
      this.chain.push({ word: starter, isPlayer: false });
      ev.push({ type: 'start', word: starter });
      return ev;
    }
    const dt = Math.max(0, time - this.lastTick);
    this.lastTick = time;
    this.turnRemainingMs -= dt;

    if (this.turnRemainingMs <= 0) {
      ev.push({ type: 'miss' });
      if (this.mode === 'survival') {
        this.lives -= 1;
        if (this.lives <= 0) {
          this.over = true;
          ev.push({ type: 'gameover' });
          return ev;
        }
        const next = this.nextStarter(this.usedWords);
        if (next) {
          this.usedWords.add(this.key(next));
          this.currentWord = next;
          this.chain.push({ word: next, isPlayer: false });
          this.turnRemainingMs = this.survivalTurnMs();
          ev.push({ type: 'round', word: next });
        } else {
          // 더 이어갈 단어가 없다 — 생존 끝.
          this.over = true;
          ev.push({ type: 'gameover' });
          return ev;
        }
      } else {
        this.over = true;
        ev.push({ type: 'gameover' });
        return ev;
      }
    }

    if (this.mode === 'time' && time - this.startedAt >= TIME_LIMIT_MS) {
      this.over = true;
      ev.push({ type: 'gameover' });
    }
    return ev;
  }

  /** 입력 확정. 검증 순서·메시지 사유·점수식은 기존 페이지와 완전히 같다.
   *  (두 번째 인자는 tick(time) 과 같은 시계를 쓴다는 신호일 뿐, 지금은 안에서 쓰지 않는다 — 호출부 자리는 유지.) */
  submit(raw: string, _time: number): PuzzleEvent[] {
    const ev: PuzzleEvent[] = [];
    const word = raw.trim();
    if (!word || this.over) return ev;
    this.attempts += 1;

    const { isKorean, validWords } = this.opts;
    const lastCh = this.lastChar(this.currentWord);
    const firstCh = this.firstChar(word);

    // 두음법칙 허용(료→요, 라→나 등)
    if (!allowedStarts(lastCh).has(firstCh)) {
      this.combo = 0;
      ev.push({ type: 'invalid', reason: 'bad-start' });
      return ev;
    }
    if (this.usedWords.has(this.key(word))) {
      this.combo = 0;
      ev.push({ type: 'invalid', reason: 'used' });
      return ev;
    }
    if (word.length < 2) {
      // 기존 판 그대로 — 이 분기만 콤보를 끊지 않는다(원본 구현의 비대칭을 그대로 보존한다).
      ev.push({ type: 'invalid', reason: 'too-short' });
      return ev;
    }
    // 형태 검증 — 자모 낙서("리아ㅓㅣㅏ")·기호는 거부.
    const lookup = isKorean ? word : word.toLowerCase();
    const wellFormed = isKorean ? HANGUL_WORD.test(word) : ENGLISH_WORD.test(word);
    if (!wellFormed) {
      this.combo = 0;
      ev.push({ type: 'invalid', reason: 'malformed' });
      return ev;
    }
    // 사전 검증 — 사전이 아직 로드되지 않았을 때만 형태 검증으로 폴백한다(기존 그대로).
    if (validWords.size > 0 && !validWords.has(lookup)) {
      this.combo = 0;
      ev.push({ type: 'invalid', reason: 'not-in-dict' });
      return ev;
    }

    // 정답 — 점수 = 글자 수 × 10 × (1 + ⌊콤보/3⌋ × 0.5), 반올림(기존 그대로)
    this.usedWords.add(this.key(word));
    const newCombo = this.combo + 1;
    const points = Math.round(word.length * 10 * (1 + Math.floor(newCombo / 3) * 0.5));
    this.chain.push({ word, isPlayer: true });
    this.score += points;
    this.combo = newCombo;
    this.maxCombo = Math.max(this.maxCombo, newCombo);
    this.totalWords += 1;
    this.currentWord = word;
    ev.push({ type: 'hit', word, points, isPlayer: true });

    // 턴 시계 — classic·time·daily 는 보너스 연장(+4초, 상한 20초) · survival 은 보너스 없이 그 턴만큼 다시 채운다.
    if (this.mode === 'survival') {
      this.turnRemainingMs = this.survivalTurnMs();
    } else {
      this.turnRemainingMs = Math.min(this.turnRemainingMs + TURN_BONUS_MS, TURN_CAP_MS);
    }

    if (this.totalWords % WORDS_PER_LEVEL === 0) {
      this.level += 1;
      ev.push({ type: 'levelup', level: this.level });
    }

    // 상대(컴퓨터) 차례
    const computerWord = this.findComputerWord(this.lastChar(word));
    if (!computerWord) {
      // 상대가 단어를 못 찾았다 — 플레이어 보너스(기존 그대로 +100)
      this.score += STUCK_BONUS;
      ev.push({ type: 'bonus', points: STUCK_BONUS });
      const next = this.nextStarter(this.usedWords);
      if (next) {
        this.usedWords.add(this.key(next));
        this.currentWord = next;
        this.chain.push({ word: next, isPlayer: false });
        ev.push({ type: 'round', word: next });
      }
      return ev;
    }

    this.usedWords.add(this.key(computerWord));
    this.currentWord = computerWord;
    this.chain.push({ word: computerWord, isPlayer: false });
    ev.push({ type: 'hit', word: computerWord, points: 0, isPlayer: false });
    return ev;
  }

  /** 화면 표시용 — 현재 턴에 남은 시간(초, 올림). */
  turnSeconds(time: number): number {
    if (this.startedAt < 0) return Math.ceil(this.turnRemainingMs / 1000);   // 목숨 3개 모드는 첫 턴부터 짧다
    const dt = Math.max(0, time - this.lastTick);
    return Math.max(0, Math.ceil((this.turnRemainingMs - dt) / 1000));
  }

  /** time 모드 전체 세션 남은 시간(ms) — 그 밖 모드는 null. */
  sessionRemaining(time: number): number | null {
    if (this.mode !== 'time' || this.startedAt < 0) return this.mode === 'time' ? TIME_LIMIT_MS : null;
    return Math.max(0, TIME_LIMIT_MS - (time - this.startedAt));
  }
}
