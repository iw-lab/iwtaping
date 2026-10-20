/**
 * 킹덤 디펜스 게임 로직 — 렌더와 분리된 순수 상태 기계.
 * 2D 판과 3D 판이 같은 코어를 쓰므로 «같은 시드·같은 입력열이면 점수·정확도·타수가 같다»(GDD-3D §8 A).
 * 좌표는 화면 픽셀(x, y) 그대로 둔다 — 3D 장면은 이 픽셀을 광선으로 길 판(z=0)에 투영해 유닛을 놓는다.
 *
 * 2D 판의 원래 규칙을 그대로 옮긴 것 — 바뀐 수치는 없다:
 *  - 세로 레인 5개(겹침 방지) · 성 체력 20 · 웨이브는 8킬마다 +1(+ 체력 2 회복)
 *  - 특수 병사(금빛)를 맞히면 능력 발동(얼리기·전체 격퇴·성 수리) + 점수 2배
 *  - 입력이 맞으면 점수·골드·킬 수는 즉시 반영되지만, 병사는 화살이 실제로 맞을 때 치워진다(연출 지연)
 */
import { ABILITIES, ABILITY_META, FREEZE_MS, type Ability } from '@/lib/game/special-words';

export { ABILITY_META, FREEZE_MS, type Ability };

export const CASTLE_HP_START = 20;
export const LANES = 5;
/** 성에 닿았다고 판정하는 x(W 기준 역산). */
export const CASTLE_HIT_X_OFFSET = 150;
export const WAVE_KILL_STEP = 8;

export interface DefenseEnemy {
  id: number;
  text: string;
  x: number;
  y: number;
  speed: number;
  hp: number;
  color: string;
  /** 0=검병 1=창병 2=기사(체력 2) */
  type: number;
  lane: number;
  spawnTime: number;
  dying?: boolean;
  special?: boolean;
  ability?: Ability;
  /** 겹침을 피해 세로로 비켜 놓은 거리(px) — 렌더 전용. 행군 경로(x,y)는 건드리지 않는다. */
  labelShift?: number;
  /** 격파 확정 시 획득 점수 — 화살 명중 시점에 반응(주스) 팝업으로 쓴다. */
  points?: number;
}

export interface DefenseArrow {
  x: number;
  y: number;
  targetId: number;
  speed: number;
  angle: number;
}

export type DefenseEvent =
  | { type: 'spawn'; enemy: DefenseEnemy }
  | { type: 'miss'; enemy: DefenseEnemy }
  | { type: 'gameover' }
  | { type: 'hit'; enemy: DefenseEnemy; points: number }
  | { type: 'wrong' }
  | { type: 'ability'; ability: Ability; cleared: DefenseEnemy[] }
  | { type: 'waveup'; wave: number };

export interface DefenseCoreOptions {
  W: number;
  H: number;
  isKorean: boolean;
  /** [0,1) 난수 — 시험용은 시드 난수를 넣는다 */
  rng: () => number;
  /** 최소 글자 수를 받아 단어 하나를 고른다 */
  pickWord: (minLen: number) => string;
  mode?: DefenseMode;
}

/** 모드 — classic(성 체력 20) · time(60초) · survival(성 체력 3·회복 없음·점점 빨라짐) · daily(날짜 시드 — 페이지가 rng·단어를 고정) */
export type DefenseMode = 'classic' | 'time' | 'survival' | 'daily';
export const TIME_LIMIT_MS = 60_000;
export const SURVIVAL_HP = 3;

/** mulberry32 — 시험용 결정적 난수 */
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

const ENEMY_COLORS = ['#FF6B6B', '#FECA57', '#FD79A8', '#00D2D3'];

export class DefenseCore {
  readonly opts: DefenseCoreOptions;
  enemies: DefenseEnemy[] = [];
  arrows: DefenseArrow[] = [];
  score = 0;
  wave = 1;
  gold = 0;
  castleHp = CASTLE_HP_START;
  kills = 0;
  attempts = 0;
  freezeUntil = 0;
  over = false;
  readonly mode: DefenseMode;
  /** 첫 tick 시각 — 60초 모드 남은 시간 */
  startedAt = -1;
  private nextId = 0;
  private lastSpawn = 0;

  constructor(opts: DefenseCoreOptions) {
    this.opts = opts;
    this.mode = opts.mode ?? 'classic';
    this.castleHp = this.maxHp();
  }

  /** 성 체력 상한 — 목숨 3개 모드는 3 */
  maxHp(): number { return this.mode === 'survival' ? SURVIVAL_HP : CASTLE_HP_START; }

  /** 남은 시간(ms) — 60초 모드만, 그 밖은 null */
  remaining(time: number): number | null {
    if (this.mode !== 'time') return null;
    return this.startedAt < 0 ? TIME_LIMIT_MS : Math.max(0, TIME_LIMIT_MS - (time - this.startedAt));
  }

  isFrozen(time: number): boolean { return time < this.freezeUntil; }

  private laneY(i: number): number {
    const { H } = this.opts;
    return H * 0.58 + i * (H * 0.24 / (LANES - 1));
  }

  private castlePos(): { x: number; top: number } {
    const { W, H } = this.opts;
    return { x: W - 100, top: H * 0.75 - 55 };
  }

  /** 한 프레임 진행 — 생성·행군·성 피격·화살 이동/명중까지. */
  tick(time: number): DefenseEvent[] {
    const ev: DefenseEvent[] = [];
    if (this.over) return ev;
    if (this.startedAt < 0) this.startedAt = time;
    const rem = this.remaining(time);
    if (rem !== null && rem <= 0) { this.over = true; ev.push({ type: 'gameover' }); return ev; }
    const { W, H, isKorean, rng, pickWord } = this.opts;
    const wave = this.wave;

    // 생성 — 세로 레인 중 스폰 지점 앞 여유가 가장 큰 레인을 고른다
    let bestLane = 0;
    let bestClear = -Infinity;
    for (let i = 0; i < LANES; i++) {
      let nearest = Infinity;
      for (const e of this.enemies) if (e.lane === i && e.x < nearest) nearest = e.x;
      if (nearest > bestClear) { bestClear = nearest; bestLane = i; }
    }
    const aliveFoes = this.enemies.filter((e) => !e.dying).length;
    const spawnInterval = aliveFoes < 2 ? 450 : Math.max(1500 - wave * 90, 650);
    const maxOnScreen = Math.min(5 + wave, 13);
    const MIN_GAP = 72;
    if (time - this.lastSpawn > spawnInterval && this.enemies.length < maxOnScreen && bestClear >= MIN_GAP) {
      this.lastSpawn = time;
      const isSpecial = wave >= 2 && !this.enemies.some((e) => e.special) && rng() < 0.14;
      const ability = isSpecial ? ABILITIES[Math.floor(rng() * ABILITIES.length)] : undefined;
      const wordFloor = isSpecial
        ? (isKorean ? 4 : 7)
        : (isKorean ? Math.min(2 + Math.floor(wave / 3), 5) : Math.min(3 + Math.floor(wave / 2), 9));
      const text = pickWord(wordFloor) || (isKorean ? '적군' : 'enemy');

      const typeRoll = rng();
      let type: number; let hp: number;
      if (typeRoll < 0.5) { type = 0; hp = 1; } // 검병
      else if (typeRoll < 0.8) { type = 1; hp = 1; } // 창병
      else { type = 2; hp = 2; } // 기사(희귀·체력 2)

      const enemy: DefenseEnemy = {
        id: this.nextId++,
        text,
        x: -20,
        y: this.laneY(bestLane) + (rng() * 8 - 4),
        speed: (0.25 + wave * 0.04) * (isSpecial ? 0.55 : 1) * (this.mode === 'survival' ? 1 + (wave - 1) * 0.08 : 1),
        hp,
        color: isSpecial ? '#FECA57' : ENEMY_COLORS[Math.floor(rng() * ENEMY_COLORS.length)],
        type,
        lane: bestLane,
        spawnTime: time,
        special: isSpecial,
        ability,
      };
      this.enemies.push(enemy);
      ev.push({ type: 'spawn', enemy });
    }

    // 행군 + 성 피격 판정(죽어가는 중인 병사는 멈춰 있다 — 움직이지 않는다)
    const frozen = this.isFrozen(time);
    const alive: DefenseEnemy[] = [];
    for (const e of this.enemies) {
      if (!e.dying && !frozen) {
        e.x += e.speed;
        if (e.x > W - CASTLE_HIT_X_OFFSET) {
          this.castleHp -= 1;
          ev.push({ type: 'miss', enemy: e });
          if (this.castleHp <= 0) {
            this.castleHp = 0;
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

    // 화살 이동 — 목표(죽어가는 중인 병사)에 닿으면 치워지고 그제야 타격 연출이 터진다
    const aliveArrows: DefenseArrow[] = [];
    for (const a of this.arrows) {
      a.x += Math.cos(a.angle) * a.speed;
      a.y += Math.sin(a.angle) * a.speed;
      if (a.x > W + 20 || a.x < -20 || a.y < -20 || a.y > H + 20) continue;
      const target = this.enemies.find((e) => e.id === a.targetId && e.dying);
      if (target) {
        const dx = a.x - target.x;
        const dy = a.y - target.y;
        if (Math.sqrt(dx * dx + dy * dy) < 25) {
          this.enemies = this.enemies.filter((e) => e.id !== target.id);
          ev.push({ type: 'hit', enemy: target, points: target.points ?? 0 });
          continue; // 화살 소모
        }
      }
      aliveArrows.push(a);
    }
    this.arrows = aliveArrows;

    return ev;
  }

  /** 입력 확정. 맞으면 병사를 멈춰 세우고 화살을 쏜다(점수·골드·웨이브는 즉시 반영) · 틀리면 wrong. */
  submit(raw: string, time: number): DefenseEvent[] {
    const ev: DefenseEvent[] = [];
    const text = raw.trim();
    if (!text || this.over) return ev;
    this.attempts += 1;
    const idx = this.enemies.findIndex((e) => !e.dying && e.text === text);
    if (idx < 0) {
      ev.push({ type: 'wrong' });
      return ev;
    }
    const enemy = this.enemies[idx];
    enemy.dying = true;
    enemy.speed = 0;

    const { x: castleX, top: castleTop } = this.castlePos();
    const angle = Math.atan2(enemy.y - castleTop, enemy.x - castleX);
    this.arrows.push({ x: castleX - 30, y: castleTop, targetId: enemy.id, speed: 12, angle });

    const points = raw.length * 10 * (enemy.special ? 2 : 1);
    enemy.points = points;
    this.score += points;

    if (enemy.special && enemy.ability) ev.push(this.trigger(enemy.ability, time));

    this.gold += 5 + Math.floor(raw.length / 2);
    this.kills += 1;
    if (this.kills % WAVE_KILL_STEP === 0) {
      this.wave += 1;
      ev.push({ type: 'waveup', wave: this.wave });
      // 목숨 3개 모드는 웨이브 회복이 없다
      if (this.mode !== 'survival' && this.castleHp < CASTLE_HP_START) this.castleHp = Math.min(CASTLE_HP_START, this.castleHp + 2);
    }
    return ev;
  }

  private trigger(ability: Ability, time: number): DefenseEvent {
    let cleared: DefenseEnemy[] = [];
    if (ability === 'freeze') {
      this.freezeUntil = time + FREEZE_MS;
    } else if (ability === 'clear') {
      cleared = this.enemies.filter((e) => !e.dying);
      this.score += 20 * cleared.length;
      this.gold += 3 * cleared.length;
      this.enemies = this.enemies.filter((e) => e.dying);
    } else if (ability === 'heal') {
      this.castleHp = Math.min(this.maxHp(), this.castleHp + (this.mode === 'survival' ? 1 : 4));
    }
    return { type: 'ability', ability, cleared };
  }
}
