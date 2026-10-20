/**
 * 씨앗비(옛 산성비) 게임 로직 — 렌더와 분리된 순수 상태 기계.
 * 2D 판과 3D 판이 같은 코어를 쓰므로 «같은 시드·같은 입력열이면 점수·정확도·타수가 같다»(GDD-3D §8 A).
 * 좌표는 화면 픽셀(x, y) 그대로 둔다 — 3D 장면은 이 픽셀을 광선으로 낙하면에 투영해 캡슐을 놓는다.
 */

/**
 * 단어를 놓쳐 바닥에 닿을 때 깎이는 pH. 시작 pH가 10.0이므로 13번 놓치면 게임오버다.
 * 형제 게임의 실수 허용치(좀비 10·우주 10·디펜스 20)에 맞춘 값 — 이전 0.3은 34회라
 * 무입력 방치 시 게임오버까지 183초 걸렸다(0.8 적용 후 78초, 둘 다 실측).
 * 오답 입력으로는 깎이지 않는다.
 */
export const PH_DAMAGE_PER_MISS = 0.8;
export const PH_START = 10;
export const FREEZE_MS = 4000;
/** 단어가 이 높이(바닥에서 50px)를 넘으면 놓친 것이다. */
export const GROUND_OFFSET = 50;

export type Ability = 'freeze' | 'clear' | 'heal';
export const ABILITIES: Ability[] = ['freeze', 'clear', 'heal'];
export const COLORS = ['#6C5CE7', '#00D2D3', '#FF6B6B', '#FECA57', '#00B894', '#FD79A8', '#48DBFB', '#A29BFE'];

export interface RainWord {
  id: number;
  text: string;
  x: number;
  y: number;
  speed: number;
  color: string;
  rotation: number;
  glowPhase: number;
  special?: boolean;
  ability?: Ability;
  /** 겹침을 피해 가로로 비켜 놓은 거리(px) — 렌더 전용. 낙하 높이(y)는 건드리지 않는다. */
  labelShift?: number;
}

export type RainEvent =
  | { type: 'spawn'; word: RainWord }
  | { type: 'miss'; word: RainWord }
  | { type: 'gameover' }
  | { type: 'hit'; word: RainWord; points: number }
  | { type: 'wrong' }
  | { type: 'ability'; ability: Ability; cleared: RainWord[] }
  | { type: 'levelup'; level: number };

/** 모드 — classic(pH 0까지) · time(60초) · survival(목숨 3·점점 빨라짐) · daily(오늘의 단어·날짜 시드) */
export type RainMode = 'classic' | 'time' | 'survival' | 'daily';
export const TIME_LIMIT_MS = 60_000;
export const SURVIVAL_LIVES = 3;

export interface RainCoreOptions {
  W: number;
  H: number;
  isKorean: boolean;
  /** [0,1) 난수 — 시험·daily 는 시드 난수를 넣는다 */
  rng: () => number;
  /** 최소 글자 수를 받아 단어 하나를 고른다 */
  pickWord: (minLen: number) => string;
  mode?: RainMode;
}

/** mulberry32 — 날짜 시드(daily)·시험용 결정적 난수 */
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

export class RainCore {
  readonly opts: RainCoreOptions;
  readonly mode: RainMode;
  words: RainWord[] = [];
  score = 0;
  level = 1;
  combo = 0;
  maxCombo = 0;
  ph = PH_START;
  lives = SURVIVAL_LIVES;
  kills = 0;
  attempts = 0;
  freezeUntil = 0;
  over = false;
  /** 첫 tick 시각 — time 모드 남은 시간 계산 */
  startedAt = -1;
  private nextId = 0;
  private lastSpawn = 0;

  constructor(opts: RainCoreOptions) {
    this.opts = opts;
    this.mode = opts.mode ?? 'classic';
  }

  /** 남은 시간(ms) — time 모드만, 그 밖은 null */
  remaining(time: number): number | null {
    if (this.mode !== 'time' || this.startedAt < 0) return this.mode === 'time' ? TIME_LIMIT_MS : null;
    return Math.max(0, TIME_LIMIT_MS - (time - this.startedAt));
  }

  /** 생존 모드는 놓칠 때마다 목숨 1 · 레벨이 오를수록 더 빨리 떨어진다 */
  private speedScale(): number {
    return this.mode === 'survival' ? 1 + (this.level - 1) * 0.08 : 1;
  }

  isFrozen(time: number): boolean { return time < this.freezeUntil; }

  /** 한 프레임 진행. 낙하는 프레임당 speed px(기존 판과 같은 단위). */
  tick(time: number): RainEvent[] {
    const ev: RainEvent[] = [];
    if (this.over) return ev;
    if (this.startedAt < 0) this.startedAt = time;
    const { W, H, isKorean, rng, pickWord } = this.opts;
    const lv = this.level;

    // 생성 — 화면이 비면 빨리 하나 내보낸다
    const interval = this.words.length < 1 ? 500 : Math.max(1000 - lv * 50, 400);
    if (time - this.lastSpawn > interval && this.words.length < Math.min(3 + lv, 10)) {
      this.lastSpawn = time;
      // 특수단어: 레벨 2+부터 화면당 1개, 더 긴(어려운) 단어에 능력을 붙인다.
      const special = lv >= 2 && !this.words.some((w) => w.special) && rng() < 0.14;
      const floor = special
        ? (isKorean ? 4 : 7)
        : (isKorean ? Math.min(2 + Math.floor(lv / 4), 4) : Math.min(3 + Math.floor(lv / 3), 8));
      const text = pickWord(floor) || (isKorean ? '단어' : 'word');
      const ability = special ? ABILITIES[Math.floor(rng() * ABILITIES.length)] : undefined;
      const word: RainWord = {
        id: this.nextId++,
        text,
        x: 60 + rng() * Math.max(0, W - 120),
        y: -30,
        // 특수단어는 조금 느리게 떨어져 입력할 시간을 준다.
        speed: ((special ? 0.18 : 0.25) + lv * (special ? 0.03 : 0.06) + rng() * 0.15) * this.speedScale(),
        color: special ? '#FECA57' : COLORS[Math.floor(rng() * COLORS.length)],
        rotation: (rng() - 0.5) * 0.02,
        glowPhase: rng() * Math.PI * 2,
        special,
        ability,
      };
      this.words.push(word);
      ev.push({ type: 'spawn', word });
    }

    const frozen = this.isFrozen(time);
    const alive: RainWord[] = [];
    for (const w of this.words) {
      if (!frozen) w.y += w.speed;
      if (w.y > H - GROUND_OFFSET) {
        ev.push({ type: 'miss', word: w });
        if (this.mode === 'survival') this.lives -= 1;
        else this.ph -= PH_DAMAGE_PER_MISS;
        if (this.ph <= 0 || this.lives <= 0) {
          this.ph = Math.max(0, this.ph);
          this.over = true;
          this.words = alive;
          ev.push({ type: 'gameover' });
          return ev;
        }
        continue;
      }
      alive.push(w);
    }
    this.words = alive;

    const rem = this.remaining(time);
    if (rem !== null && rem <= 0) {
      this.over = true;
      ev.push({ type: 'gameover' });
    }
    return ev;
  }

  /** 입력 확정. 맞으면 hit(+능력·레벨업), 틀리면 wrong. */
  submit(raw: string, time: number): RainEvent[] {
    const ev: RainEvent[] = [];
    const text = raw.trim();
    if (!text || this.over) return ev;
    this.attempts += 1;
    const idx = this.words.findIndex((w) => w.text === text);
    if (idx < 0) {
      this.combo = 0;
      ev.push({ type: 'wrong' });
      return ev;
    }
    const word = this.words[idx];
    this.words.splice(idx, 1);
    // 특수단어는 2배 점수 + 능력 발동 (점수 = 입력 길이 × 10 — 기존 판과 같다)
    const points = raw.length * 10 * (word.special ? 2 : 1);
    this.score += points;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.kills += 1;
    ev.push({ type: 'hit', word, points });
    if (word.special && word.ability) ev.push(this.trigger(word.ability, time));
    if (this.kills % 15 === 0) {
      this.level += 1;
      ev.push({ type: 'levelup', level: this.level });
    }
    return ev;
  }

  private trigger(ability: Ability, time: number): RainEvent {
    let cleared: RainWord[] = [];
    if (ability === 'freeze') {
      this.freezeUntil = time + FREEZE_MS;
    } else if (ability === 'clear') {
      cleared = this.words;
      this.score += 20 * cleared.length;
      this.words = [];
    } else if (ability === 'heal') {
      if (this.mode === 'survival') this.lives = Math.min(SURVIVAL_LIVES, this.lives + 1);
      else this.ph = Math.min(PH_START, this.ph + 2);
    }
    return { type: 'ability', ability, cleared };
  }
}
