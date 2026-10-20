/**
 * 우주 방어(수리·구조) 게임 로직 — 렌더와 분리된 순수 상태 기계.
 * 2D 판과 3D 판이 같은 코어를 쓰므로 «같은 시드·같은 입력열이면 점수·정확도·타수가 같다»(GDD-3D §8 A).
 * 좌표는 화면 픽셀(x, y) 그대로 둔다 — 3D 장면은 이 픽셀을 카메라 광선으로 깊이(z)가 있는 면에
 * 투영해 드론을 놓는다(산성비처럼 평면이 아니라, 화면 중심에서 거리 → 통로 깊이로 바뀐다).
 *
 * 점수식·스폰 규칙·명중 판정은 3D 전환 전 2D 판(격파 버전)과 완전히 같다 — 바뀐 것은
 * «명중 뒤 화면에 남아 미사일이 날아가길 기다리는 연출»뿐이고, 그 연출은 늘 렌더(페이지·3D 장면)
 * 책임이었다(코어는 맞히는 순간 바로 점수를 주고 배열에서 뺀다 — 산성비 코어와 같은 방식).
 */

export type Ability = 'freeze' | 'clear' | 'heal';
export const ABILITIES: Ability[] = ['freeze', 'clear', 'heal'];
export const COLORS = ['#FF6B6B', '#00D2D3', '#FECA57', '#FD79A8', '#48DBFB', '#A29BFE'];

/** 기지 방패가 버티는 피격 허용치 — 놓칠 때마다 1씩. 형제 게임의 실수 허용치(좀비 10·씨앗비 13회분·디펜스 20)에 맞춘 값. */
export const SHIELD_START = 10;
export const FREEZE_MS = 4000;
/** 드론이 이 거리 안으로 들어오면 기지에 닿은 것 — 못 고친 채 놓친 것이다. */
export const HIT_DIST = 35;

export type SpaceMode = 'classic' | 'time' | 'survival' | 'daily';
export const TIME_LIMIT_MS = 60_000;
export const SURVIVAL_LIVES = 3;

export interface SpaceEnemy {
  id: number;
  text: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  color: string;
  shipType: number;
  isBoss: boolean;
  spawnTime: number;
  special?: boolean;
  ability?: Ability;
  /** 말풍선을 기본 위치에서 추가로 밀어낸 거리(px) — 렌더 전용. */
  labelShift?: number;
  /** 명중 확정 시 획득 점수(렌더가 팝업 텍스트로 쓴다) */
  points?: number;
}

export type SpaceEvent =
  | { type: 'spawn'; enemy: SpaceEnemy }
  | { type: 'hit'; enemy: SpaceEnemy; points: number }
  | { type: 'miss'; enemy: SpaceEnemy }
  | { type: 'gameover' }
  | { type: 'wrong' }
  | { type: 'ability'; ability: Ability; cleared: SpaceEnemy[] }
  | { type: 'levelup'; level: number };

export interface SpaceCoreOptions {
  W: number;
  H: number;
  isKorean: boolean;
  /** [0,1) 난수 — 시험·daily 는 시드 난수를 넣는다 */
  rng: () => number;
  /** 최소 글자 수를 받아 단어 하나를 고른다 */
  pickWord: (minLen: number) => string;
  mode?: SpaceMode;
}

/** mulberry32 — 날짜 시드(daily)·시험용 결정적 난수 (씨앗비 코어와 같은 구현) */
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

/** 드론이 다가오는 기준점(= 기지/내 함선의 화면 좌표) — 스폰·충돌·3D 투영이 모두 같은 값을 쓴다. */
export function spaceCenter(W: number, H: number): { cx: number; cy: number } {
  return { cx: W / 2, cy: H * 0.55 };
}
/** 드론이 처음 나타나는 거리(기준점에서) */
export function spawnDist(W: number, H: number): number {
  return Math.max(W, H) * 0.65;
}

export class SpaceCore {
  readonly opts: SpaceCoreOptions;
  readonly mode: SpaceMode;
  enemies: SpaceEnemy[] = [];
  score = 0;
  level = 1;
  combo = 0;
  maxCombo = 0;
  shield = SHIELD_START;
  lives = SURVIVAL_LIVES;
  kills = 0;
  attempts = 0;
  freezeUntil = 0;
  over = false;
  /** 첫 tick 시각 — time 모드 남은 시간 계산 */
  startedAt = -1;
  private nextId = 0;
  private lastSpawn = 0;

  constructor(opts: SpaceCoreOptions) {
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

  /** 한 프레임 진행. */
  tick(time: number): SpaceEvent[] {
    const ev: SpaceEvent[] = [];
    if (this.over) return ev;
    if (this.startedAt < 0) this.startedAt = time;
    const { W, H, isKorean, rng, pickWord } = this.opts;
    const lv = this.level;
    const { cx, cy } = spaceCenter(W, H);

    // 생성 — 화면이 비면 빨리 하나 내보낸다
    const baseInterval = Math.max(1200 - lv * 70, 500);
    const interval = this.enemies.length < 2 ? 350 : baseInterval;
    const maxEnemies = Math.min(5 + lv, 15);
    if (time - this.lastSpawn > interval && this.enemies.length < maxEnemies) {
      this.lastSpawn = time;
      const isBoss = lv > 3 && this.kills > 0 && this.kills % 20 === 0 && !this.enemies.some((e) => e.isBoss);
      const isSpecial = !isBoss && lv >= 2 && !this.enemies.some((e) => e.special) && rng() < 0.14;
      const ability = isSpecial ? ABILITIES[Math.floor(rng() * ABILITIES.length)] : undefined;
      const angle = rng() * Math.PI * 2;
      const dist = spawnDist(W, H);
      const wordFloor = isKorean ? Math.min(2 + Math.floor(lv / 3), 5) : Math.min(3 + Math.floor(lv / 2), 9);
      const text = isBoss
        ? (pickWord(isKorean ? 4 : 6) || (isKorean ? '대장드론' : 'bossdrone'))
        : isSpecial
          ? (pickWord(isKorean ? 4 : 7) || (isKorean ? '드론' : 'drone'))
          : (pickWord(wordFloor) || (isKorean ? '드론' : 'drone'));
      const enemy: SpaceEnemy = {
        id: this.nextId++,
        text,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist - H * 0.15,
        angle: 0,
        // 특수 드론은 조금 느리게 다가와 입력할 시간을 준다.
        speed: (isBoss ? 0.15 + lv * 0.01 : isSpecial ? 0.16 + lv * 0.02 : 0.25 + lv * 0.04) * this.speedScale(),
        color: isBoss ? '#FF0000' : isSpecial ? '#FECA57' : COLORS[Math.floor(rng() * COLORS.length)],
        shipType: isBoss ? 2 : Math.floor(rng() * 4),
        isBoss,
        spawnTime: time,
        special: isSpecial,
        ability,
      };
      enemy.angle = Math.atan2(cy - enemy.y, cx - enemy.x);
      this.enemies.push(enemy);
      ev.push({ type: 'spawn', enemy });
    }

    const frozen = this.isFrozen(time);
    const alive: SpaceEnemy[] = [];
    for (const e of this.enemies) {
      if (!frozen) {
        e.x += Math.cos(e.angle) * e.speed;
        e.y += Math.sin(e.angle) * e.speed;
        const d = Math.hypot(e.x - cx, e.y - cy);
        if (d < HIT_DIST) {
          ev.push({ type: 'miss', enemy: e });
          if (this.mode === 'survival') this.lives -= 1;
          else this.shield -= 1;
          if (this.shield <= 0 || this.lives <= 0) {
            this.shield = Math.max(0, this.shield);
            this.over = true;
            this.enemies = alive;
            ev.push({ type: 'gameover' });
            return ev;
          }
          continue;
        }
      }
      alive.push(e);
    }
    this.enemies = alive;

    const rem = this.remaining(time);
    if (rem !== null && rem <= 0) {
      this.over = true;
      ev.push({ type: 'gameover' });
    }
    return ev;
  }

  /** 입력 확정. 맞으면 hit(+능력·레벨업), 틀리면 wrong. */
  submit(raw: string, time: number): SpaceEvent[] {
    const ev: SpaceEvent[] = [];
    const text = raw.trim();
    if (!text || this.over) return ev;
    this.attempts += 1;
    const idx = this.enemies.findIndex((e) => e.text === text);
    if (idx < 0) {
      this.combo = 0;
      ev.push({ type: 'wrong' });
      return ev;
    }
    const enemy = this.enemies[idx];
    this.enemies.splice(idx, 1);
    // 점수 = 글자 수 × 15 × (콤보 보너스) × (보스 5배 · 특수 2배 · 기본 1배) — 전환 전 2D 판과 같다.
    const comboBonus = Math.floor(this.combo / 5) * 0.5;
    const bossBonus = enemy.isBoss ? 5 : enemy.special ? 2 : 1;
    const points = Math.round(text.length * 15 * (1 + comboBonus) * bossBonus);
    enemy.points = points;
    this.score += points;
    this.combo += 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.kills += 1;
    ev.push({ type: 'hit', enemy, points });
    if (enemy.special && enemy.ability) ev.push(this.trigger(enemy.ability, time));
    if (this.kills % 10 === 0) {
      this.level += 1;
      ev.push({ type: 'levelup', level: this.level });
      // 레벨 업 시 방어막 1 회복(전환 전과 같다). 목숨 모드는 다른 자원(생존 목숨)을 쓰므로 해당 없음.
      if (this.mode !== 'survival' && this.shield < SHIELD_START) this.shield = Math.min(SHIELD_START, this.shield + 1);
    }
    return ev;
  }

  private trigger(ability: Ability, time: number): SpaceEvent {
    let cleared: SpaceEnemy[] = [];
    if (ability === 'freeze') {
      this.freezeUntil = time + FREEZE_MS;
    } else if (ability === 'clear') {
      cleared = this.enemies;
      this.score += 25 * cleared.length;
      this.enemies = [];
    } else if (ability === 'heal') {
      if (this.mode === 'survival') this.lives = Math.min(SURVIVAL_LIVES, this.lives + 1);
      else this.shield = Math.min(SHIELD_START, this.shield + 2);
    }
    return { type: 'ability', ability, cleared };
  }
}
