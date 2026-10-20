import { describe, it, expect } from 'vitest';
import { ZombieCore, seededRng, HP_START, SURVIVAL_LIVES, TIME_LIMIT_MS, type ZombieMode } from '@/lib/game/zombie/core';

const WORDS = ['사과', '바나나', '하늘', '구름', '나무', '씨앗', '화분', '꽃잎', '바람', '햇살', '무지개', '도토리'];

/** 같은 시드·같은 입력열로 한 판을 «돌린다» — 렌더(2D/3D)는 코어를 건드리지 않으므로 이 결과가 곧 두 판의 결과다 */
function play(seed: number, mode: ZombieMode, typeEvery = 40, frames = 4000, typoEvery = 0) {
  const rng = seededRng(seed);
  const core = new ZombieCore({
    W: 800, H: 500, isKorean: true, rng, mode,
    pickWord: (min) => { const ok = WORDS.filter((w) => w.length >= min); const b = ok.length ? ok : WORDS; return b[Math.floor(rng() * b.length)]; },
  });
  let t = 0;
  for (let f = 0; f < frames && !core.over; f++) {
    t += 16;
    core.tick(t);
    if (typeEvery && f % typeEvery === 0 && core.units.length) {
      const target = typoEvery && f % (typeEvery * typoEvery) === 0 ? '틀린말' : core.units[0].text;
      core.submit(target, t);
    }
  }
  return { score: core.score, kills: core.kills, attempts: core.attempts, level: core.level, hp: core.hp, lives: core.lives, over: core.over, t };
}

describe('슬라임 놀이터 코어', () => {
  it('같은 시드·같은 입력열 → 점수·정확도·타수가 같다(2D·3D 동일 판정의 근거)', () => {
    for (const mode of ['classic', 'time', 'survival', 'daily'] as ZombieMode[]) {
      expect(play(7, mode, 30, 3000, 5)).toEqual(play(7, mode, 30, 3000, 5));
    }
  });

  it('다른 시드면 판이 달라진다(시드가 실제로 쓰인다)', () => {
    const first = (seed: number) => {
      const rng = seededRng(seed);
      const c = new ZombieCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '슬라임' });
      c.tick(1000);
      return c.units[0].x;
    };
    expect(first(1)).not.toBe(first(2));
    expect(first(1)).toBe(first(1));
  });

  it('슬라임이 닿으면 체력이 1씩 깎이고 10번째에 끝난다(기본)', () => {
    const r = play(3, 'classic', 0, 300000);
    expect(r.over).toBe(true);
    expect(r.hp).toBe(0);
    expect(HP_START).toBe(10);
  });

  it('오답 입력은 체력을 깎지 않고 시도 수만 늘린다', () => {
    const rng = seededRng(5);
    const core = new ZombieCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '슬라임' });
    core.tick(1000);
    core.submit('없는말', 1000);
    expect(core.hp).toBe(HP_START);
    expect(core.attempts).toBe(1);
    expect(core.kills).toBe(0);
  });

  it('60초 모드는 60초에 끝난다', () => {
    const r = play(4, 'time', 10, 300000);
    expect(r.over).toBe(true);
    expect(r.t).toBeGreaterThanOrEqual(TIME_LIMIT_MS);
    expect(r.t).toBeLessThan(TIME_LIMIT_MS + 100);
  });

  it('목숨 3개 모드는 세 번 닿으면 끝난다(체력은 그대로)', () => {
    const r = play(6, 'survival', 0, 300000);
    expect(r.over).toBe(true);
    expect(r.lives).toBe(0);
    expect(r.hp).toBe(HP_START);
    expect(SURVIVAL_LIVES).toBe(3);
  });

  it('점수 = 입력 길이 × 12 (특수 슬라임 2배)', () => {
    const core = new ZombieCore({ W: 800, H: 500, isKorean: true, rng: seededRng(9), pickWord: () => '무지개' });
    core.tick(1000);
    const u = core.units[0];
    const ev = core.submit(u.text, 1000);
    expect(ev[0]).toMatchObject({ type: 'hit', points: u.text.length * 12 * (u.special ? 2 : 1) });
  });

  it('10마리 정화마다 웨이브가 오르고 체력을 회복한다', () => {
    const rng = seededRng(11);
    const core = new ZombieCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '씨앗' });
    core.hp = 5;
    let t = 0;
    for (let i = 0; i < 10; i++) {
      t += 16;
      core.tick(t);
      while (core.units.length === 0) { t += 16; core.tick(t); }
      core.submit(core.units[0].text, t);
    }
    expect(core.level).toBe(2);
    expect(core.hp).toBe(6);
  });
});
