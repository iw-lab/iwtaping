import { describe, it, expect } from 'vitest';
import {
  DefenseCore, seededRng, CASTLE_HP_START, WAVE_KILL_STEP,
} from '@/lib/game/defense/core';

const WORDS = ['사과', '바나나', '하늘', '구름', '나무', '씨앗', '화분', '꽃잎', '바람', '햇살', '무지개', '도토리'];

/** 같은 시드·같은 입력열로 한 판을 «돌린다» — 렌더(2D/3D)는 코어를 건드리지 않으므로 이 결과가 곧 두 판의 결과다 */
function play(seed: number, typeEvery = 40, frames = 4000, typoEvery = 0) {
  const rng = seededRng(seed);
  const core = new DefenseCore({
    W: 800, H: 500, isKorean: true, rng,
    pickWord: (min) => { const ok = WORDS.filter((w) => w.length >= min); const b = ok.length ? ok : WORDS; return b[Math.floor(rng() * b.length)]; },
  });
  let t = 0;
  for (let f = 0; f < frames && !core.over; f++) {
    t += 16;
    core.tick(t);
    if (typeEvery && f % typeEvery === 0) {
      const target = core.enemies.find((e) => !e.dying);
      if (target) {
        const text = typoEvery && f % (typeEvery * typoEvery) === 0 ? '틀린말' : target.text;
        core.submit(text, t);
      }
    }
  }
  return {
    score: core.score, kills: core.kills, attempts: core.attempts, wave: core.wave,
    gold: core.gold, castleHp: core.castleHp, over: core.over, t,
  };
}

describe('킹덤 디펜스 코어', () => {
  it('같은 시드·같은 입력열 → 점수·정확도·타수가 같다(2D·3D 동일 판정의 근거)', () => {
    expect(play(7, 30, 3000, 5)).toEqual(play(7, 30, 3000, 5));
    expect(play(11, 20, 4000, 4)).toEqual(play(11, 20, 4000, 4));
  });

  it('다른 시드면 판이 달라진다(시드가 실제로 쓰인다)', () => {
    const firstY = (seed: number) => {
      const rng = seededRng(seed);
      const c = new DefenseCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '씨앗' });
      c.tick(1000);
      return c.enemies[0].y;
    };
    expect(firstY(1)).not.toBe(firstY(2));
    expect(firstY(1)).toBe(firstY(1));
  });

  it('입력 없이 두면 병사가 성에 닿을 때마다 체력이 1씩 깎이고 0에서 끝난다', () => {
    const r = play(3, 0, 200000);
    expect(r.over).toBe(true);
    expect(r.castleHp).toBe(0);
    expect(CASTLE_HP_START).toBe(20);
  });

  it('오답 입력은 점수·골드·체력을 깎지 않고 시도 수만 늘린다', () => {
    const rng = seededRng(5);
    const core = new DefenseCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '씨앗' });
    core.tick(1000);
    core.submit('없는말', 1000);
    expect(core.score).toBe(0);
    expect(core.gold).toBe(0);
    expect(core.castleHp).toBe(CASTLE_HP_START);
    expect(core.attempts).toBe(1);
    expect(core.kills).toBe(0);
  });

  it(`${WAVE_KILL_STEP}킬마다 웨이브가 오른다(격파 수 = 화살이 실제로 맞은 수)`, () => {
    const r = play(9, 10, 200000);
    expect(r.wave).toBeGreaterThan(1);
    expect(r.kills % WAVE_KILL_STEP === 0 || r.over).toBe(true);
  });

  it('맞히면 즉시 멈춰 서고(죽어가는 중) 화살이 실제로 닿아야 치워진다(점수는 입력 순간 반영)', () => {
    const rng = seededRng(13);
    const core = new DefenseCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '무지개' });
    core.tick(1000);
    const enemy = core.enemies[0];
    const enemyId = enemy.id;
    const before = core.score;
    const ev = core.submit(enemy.text, 1000);
    expect(ev).toEqual([]); // 특수 병사가 아니면 submit 은 사건을 내지 않는다(능력 없음)
    expect(core.score).toBe(before + enemy.text.length * 10);
    expect(core.enemies.find((e) => e.id === enemyId)?.dying).toBe(true);
    expect(core.enemies.find((e) => e.id === enemyId)?.speed).toBe(0);
    expect(core.enemies.some((e) => e.id === enemyId)).toBe(true); // 화살이 아직 안 닿아 치워지지 않았다
    expect(core.arrows.length).toBe(1);
    // 화살이 날아가 실제로 맞는 프레임까지 진행
    let t = 1000; let hit = false;
    for (let i = 0; i < 200 && !hit; i++) {
      t += 16;
      const events = core.tick(t);
      if (events.some((e) => e.type === 'hit' && e.enemy.id === enemyId)) hit = true;
    }
    expect(hit).toBe(true);
    expect(core.enemies.some((e) => e.id === enemyId)).toBe(false);
  });

  it('점수 = 입력 길이 × 10 (특수 병사는 2배) — 1웨이브엔 특수 병사가 스폰되지 않는다', () => {
    const rng = seededRng(21);
    const core = new DefenseCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '무지개' });
    core.tick(1000);
    const e = core.enemies[0];
    expect(e.special).toBeFalsy();
    const before = core.score;
    core.submit(e.text, 1000);
    expect(core.score).toBe(before + e.text.length * 10);
  });
});
