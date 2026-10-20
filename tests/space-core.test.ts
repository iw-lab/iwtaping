import { describe, it, expect } from 'vitest';
import {
  SpaceCore, seededRng, SHIELD_START, TIME_LIMIT_MS, SURVIVAL_LIVES, HIT_DIST,
  type SpaceMode,
} from '@/lib/game/space/core';

const WORDS = ['우주선', '행성', '혜성', '소행성', '은하수', '로켓', '위성', '궤도', '중력', '태양풍', '블랙홀', '유성우'];

/** 같은 시드·같은 입력열로 한 판을 «돌린다» — 렌더(2D/3D)는 코어를 건드리지 않으므로 이 결과가 곧 두 판의 결과다 */
function play(seed: number, mode: SpaceMode, typeEvery = 40, frames = 4000, typoEvery = 0) {
  const rng = seededRng(seed);
  const core = new SpaceCore({
    W: 800, H: 500, isKorean: true, rng, mode,
    pickWord: (min) => { const ok = WORDS.filter((w) => w.length >= min); const b = ok.length ? ok : WORDS; return b[Math.floor(rng() * b.length)]; },
  });
  let t = 0;
  for (let f = 0; f < frames && !core.over; f++) {
    t += 16;
    core.tick(t);
    if (typeEvery && f % typeEvery === 0 && core.enemies.length) {
      const target = typoEvery && f % (typeEvery * typoEvery) === 0 ? '틀린말' : core.enemies[0].text;
      core.submit(target, t);
    }
  }
  return { score: core.score, kills: core.kills, attempts: core.attempts, level: core.level, shield: core.shield, lives: core.lives, over: core.over, t };
}

describe('우주 방어 코어', () => {
  it('같은 시드·같은 입력열 → 점수·정확도·타수가 같다(2D·3D 동일 판정의 근거)', () => {
    for (const mode of ['classic', 'time', 'survival', 'daily'] as SpaceMode[]) {
      expect(play(7, mode, 30, 3000, 5)).toEqual(play(7, mode, 30, 3000, 5));
    }
  });

  it('다른 시드면 판이 달라진다(시드가 실제로 쓰인다)', () => {
    const first = (seed: number) => {
      const rng = seededRng(seed);
      const c = new SpaceCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '드론' });
      c.tick(1000);
      return c.enemies[0]?.x;
    };
    expect(first(1)).not.toBe(first(2));
    expect(first(1)).toBe(first(1));
  });

  it(`놓치면 방어막이 1씩 깎이고 ${SHIELD_START}번째에 끝난다(기본)`, () => {
    const r = play(3, 'classic', 0, 200000);
    expect(r.over).toBe(true);
    expect(r.shield).toBe(0);
  });

  it('오답 입력은 방어막을 깎지 않고 시도 수만 늘린다', () => {
    const rng = seededRng(5);
    const core = new SpaceCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '드론' });
    core.tick(1000);
    core.submit('없는말', 1000);
    expect(core.shield).toBe(SHIELD_START);
    expect(core.attempts).toBe(1);
    expect(core.kills).toBe(0);
  });

  it('60초 모드는 60초에 끝난다', () => {
    const r = play(4, 'time', 10, 200000);
    expect(r.over).toBe(true);
    expect(r.t).toBeGreaterThanOrEqual(TIME_LIMIT_MS);
    expect(r.t).toBeLessThan(TIME_LIMIT_MS + 100);
  });

  it('목숨 3개 모드는 세 번 놓치면 끝난다(방어막은 그대로)', () => {
    const r = play(6, 'survival', 0, 200000);
    expect(r.over).toBe(true);
    expect(r.lives).toBe(0);
    expect(r.shield).toBe(SHIELD_START);
    expect(SURVIVAL_LIVES).toBe(3);
  });

  it('점수 = 글자 수 × 15(콤보 0·보스 아님·특수 아님일 때 — 레벨 1의 첫 스폰은 항상 평범한 드론이다)', () => {
    const core = new SpaceCore({ W: 800, H: 500, isKorean: true, rng: seededRng(9), pickWord: () => '소행성' });
    core.tick(1000);
    const e = core.enemies[0];
    expect(e.special).toBeFalsy();
    expect(e.isBoss).toBe(false);
    const ev = core.submit(e.text, 1000);
    expect(ev[0]).toMatchObject({ type: 'hit', points: e.text.length * 15 });
  });

  it('맞히면 즉시 배열에서 빠진다(미사일 비행 연출은 렌더 책임)', () => {
    const core = new SpaceCore({ W: 800, H: 500, isKorean: true, rng: seededRng(11), pickWord: () => '혜성' });
    core.tick(1000);
    const before = core.enemies.length;
    core.submit(core.enemies[0].text, 1000);
    expect(core.enemies.length).toBe(before - 1);
  });

  it('기지에 닿는 거리(HIT_DIST)는 35다', () => {
    expect(HIT_DIST).toBe(35);
  });
});
