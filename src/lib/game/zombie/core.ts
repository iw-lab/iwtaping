/**
 * 슬라임 놀이터(옛 좀비 서바이벌) 게임 로직 — 렌더와 분리된 순수 상태 기계.
 * 2D 판과 3D 판이 같은 코어를 쓰므로 «같은 시드·같은 입력열이면 점수·정확도·타수가 같다»(GDD-3D §8 A).
 * 좌표는 화면 픽셀(x, y) 그대로 둔다 — 3D 장면은 이 픽셀을 광선으로 바닥면에 투영해 슬라임을 놓는다.
 *
 * 규칙은 기존 좀비 서바이벌 판(src/app/game/zombie/page.tsx 구판)과 숫자 그대로:
 *  - 체력 10에서 시작, 슬라임이 다가와 닿으면(반경 38px) 1씩 깎인다(생존 모드는 대신 목숨 3개가 깎인다)
 *  - 점수 = 입력 길이 × 12(특수 슬라임은 2배) · 10마리 정화할 때마다 웨이브 +1 + 체력(또는 목숨) 1 회복
 *  - 특수 슬라임(웨이브 2+부터, 화면당 1개, 14% 확률)을 정화하면 능력 발동(일시정지·전체 정화·회복)
 */

/** 체력 시작값. 생존 모드는 대신 목숨(SURVIVAL_LIVES)을 쓴다. */
export const HP_START = 10;
export const SURVIVAL_LIVES = 3;
export const FREEZE_MS = 4000;
export const TIME_LIMIT_MS = 60_000;
/** 슬라임이 이 거리 안으로 들어오면 플레이어(울타리)에 닿은 것이다. */
export const HIT_RADIUS = 38;
/** 화면 아래에서 바닥까지 여백 · 그 위 플레이어(울타리) 위치 오프셋 — 기존 판과 같은 값. */
export const GROUND_MARGIN = 60;
export const PLAYER_Y_OFFSET = 25;

export type Ability = 'freeze' | 'clear' | 'heal';
export const ABILITIES: Ability[] = ['freeze', 'clear', 'heal'];
export const COLORS = ['#00B894', '#FF6B6B', '#FDCB6E', '#55E6C1', '#B33939'];

export interface ZombieUnit {
  id: number;
  text: string;
  x: number;
  y: number;
  speed: number;
  color: string;
  /** 시각 변주(0~2) — 기존 판의 스프라이트 변주 그대로. */
  type: number;
  /** 0 표준 · 1 뚱뚱(느림) · 2 재빠름(작음) */
  variant: number;
  spawnTime: number;
  special?: boolean;
  ability?: Ability;
  /** 겹침을 피해 가로로 비켜 놓은 거리(px) — 렌더 전용. */
  labelShift?: number;
}

export type ZombieEvent =
  | { type: 'spawn'; zombie: ZombieUnit }
  | { type: 'hit'; zombie: ZombieUnit; points: number }
  | { type: 'miss'; zombie: ZombieUnit }
  | { type: 'wrong' }
  | { type: 'gameover' }
  | { type: 'ability'; ability: Ability; cleared: ZombieUnit[] }
  | { type: 'levelup'; level: number };

/** 모드 — classic(체력 0까지) · time(60초) · survival(목숨 3·점점 빨라짐) · daily(오늘의 단어·날짜 시드) */
export type ZombieMode = 'classic' | 'time' | 'survival' | 'daily';

export interface ZombieCoreOptions {
  W: number;
  H: number;
  isKorean: boolean;
  /** [0,1) 난수 — 시험·daily 는 시드 난수를 넣는다 */
  rng: () => number;
  /** 최소 글자 수를 받아 단어 하나를 고른다 */
  pickWord: (minLen: number) => string;
  mode?: ZombieMode;
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

export class ZombieCore {
  readonly opts: ZombieCoreOptions;
  readonly mode: ZombieMode;
  units: ZombieUnit[] = [];
  score = 0;
  level = 1;
  hp = HP_START;
  lives = SURVIVAL_LIVES;
  kills = 0;
  attempts = 0;
  freezeUntil = 0;
  over = false;
  /** 첫 tick 시각 — time 모드 남은 시간 계산 */
  startedAt = -1;
  private nextId = 0;
  private lastSpawn = 0;

  constructor(opts: ZombieCoreOptions) {
    this.opts = opts;
    this.mode = opts.mode ?? 'classic';
  }

  /** 남은 시간(ms) — time 모드만, 그 밖은 null */
  remaining(time: number): number | null {
    if (this.mode !== 'time' || this.startedAt < 0) return this.mode === 'time' ? TIME_LIMIT_MS : null;
    return Math.max(0, TIME_LIMIT_MS - (time - this.startedAt));
  }

  /** 생존 모드는 놓칠 때마다 목숨 1 · 레벨이 오를수록 더 빨리 다가온다 */
  private speedScale(): number {
    return this.mode === 'survival' ? 1 + (this.level - 1) * 0.08 : 1;
  }

  isFrozen(time: number): boolean { return time < this.freezeUntil; }

  /** 한 프레임 진행 — 스폰·접근·판정. */
  tick(time: number): ZombieEvent[] {
    const ev: ZombieEvent[] = [];
    if (this.over) return ev;
    if (this.startedAt < 0) this.startedAt = time;
    const { W, H, isKorean, rng, pickWord } = this.opts;
    const wave = this.level;
    const cx = W / 2;
    const cy = H / 2;
    const groundY = H - GROUND_MARGIN;
    const playerY = groundY - PLAYER_Y_OFFSET;

    // 스폰 — 화면이 거의 비면 빨리 하나 내보낸다
    const interval = this.units.length < 2 ? 380 : Math.max(1300 - wave * 70, 500);
    const zMax = Math.min(6 + wave, 14);
    if (time - this.lastSpawn > interval && this.units.length < zMax) {
      this.lastSpawn = time;
      const special = wave >= 2 && !this.units.some((u) => u.special) && rng() < 0.14;
      const ability = special ? ABILITIES[Math.floor(rng() * ABILITIES.length)] : undefined;
      const wordFloor = special
        ? (isKorean ? 4 : 6)
        : (isKorean ? Math.min(2 + Math.floor(wave / 3), 5) : Math.min(3 + Math.floor(wave / 2), 8));
      const text = pickWord(wordFloor) || (isKorean ? '슬라임' : 'slime');
      const baseSpeed = (0.3 + wave * 0.04) * this.speedScale();
      const speedVariant = rng();
      let variant: number;
      let speed: number;
      if (speedVariant < 0.6) { variant = 0; speed = baseSpeed; }
      else if (speedVariant < 0.8) { variant = 1; speed = baseSpeed * 0.7; }
      else { variant = 2; speed = baseSpeed * 1.4; }
      const angle = rng() * Math.PI * 2;
      const dist = Math.max(W, H) * 0.55;
      const zombie: ZombieUnit = {
        id: this.nextId++,
        text,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        // 특수 슬라임은 느리게 다가와 긴 단어를 입력할 시간을 준다
        speed: special ? baseSpeed * 0.55 : speed,
        color: special ? '#FECA57' : COLORS[Math.floor(rng() * COLORS.length)],
        type: Math.floor(rng() * 3),
        variant,
        spawnTime: time,
        special,
        ability,
      };
      this.units.push(zombie);
      ev.push({ type: 'spawn', zombie });
    }

    const frozen = this.isFrozen(time);
    const alive: ZombieUnit[] = [];
    for (const z of this.units) {
      const a = Math.atan2(playerY - z.y, cx - z.x);
      if (!frozen) {
        z.x += Math.cos(a) * z.speed;
        z.y += Math.sin(a) * z.speed;
      }
      const dist = Math.hypot(z.x - cx, z.y - playerY);
      if (dist < HIT_RADIUS) {
        ev.push({ type: 'miss', zombie: z });
        if (this.mode === 'survival') this.lives -= 1;
        else this.hp -= 1;
        if (this.hp <= 0 || this.lives <= 0) {
          this.hp = Math.max(0, this.hp);
          this.lives = Math.max(0, this.lives);
          this.over = true;
          this.units = alive;
          ev.push({ type: 'gameover' });
          return ev;
        }
        continue;
      }
      alive.push(z);
    }
    this.units = alive;

    const rem = this.remaining(time);
    if (rem !== null && rem <= 0) {
      this.over = true;
      ev.push({ type: 'gameover' });
    }
    return ev;
  }

  /** 입력 확정. 맞으면 hit(+능력·웨이브업), 틀리면 wrong. */
  submit(raw: string, time: number): ZombieEvent[] {
    const ev: ZombieEvent[] = [];
    const text = raw.trim();
    if (!text || this.over) return ev;
    this.attempts += 1;
    const idx = this.units.findIndex((u) => u.text === text);
    if (idx < 0) {
      ev.push({ type: 'wrong' });
      return ev;
    }
    const z = this.units[idx];
    this.units.splice(idx, 1);
    // 특수 슬라임은 2배 점수 + 능력 발동 (점수 = 입력 길이 × 12 — 기존 판과 같다)
    const points = raw.length * 12 * (z.special ? 2 : 1);
    this.score += points;
    this.kills += 1;
    ev.push({ type: 'hit', zombie: z, points });
    if (z.special && z.ability) ev.push(this.trigger(z.ability, time));
    if (this.kills % 10 === 0) {
      this.level += 1;
      if (this.mode === 'survival') this.lives = Math.min(SURVIVAL_LIVES, this.lives + 1);
      else this.hp = Math.min(HP_START, this.hp + 1);
      ev.push({ type: 'levelup', level: this.level });
    }
    return ev;
  }

  private trigger(ability: Ability, time: number): ZombieEvent {
    let cleared: ZombieUnit[] = [];
    if (ability === 'freeze') {
      this.freezeUntil = time + FREEZE_MS;
    } else if (ability === 'clear') {
      cleared = this.units;
      this.score += 20 * cleared.length;
      this.units = [];
    } else if (ability === 'heal') {
      if (this.mode === 'survival') this.lives = Math.min(SURVIVAL_LIVES, this.lives + 1);
      else this.hp = Math.min(HP_START, this.hp + 2);
    }
    return { type: 'ability', ability, cleared };
  }
}
