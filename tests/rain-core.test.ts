import { describe, it, expect } from 'vitest';
import { RainCore, seededRng, PH_START, PH_DAMAGE_PER_MISS, TIME_LIMIT_MS, SURVIVAL_LIVES, type RainMode } from '@/lib/game/rain/core';

const WORDS = ['사과', '바나나', '하늘', '구름', '나무', '씨앗', '화분', '꽃잎', '바람', '햇살', '무지개', '도토리'];

/** 같은 시드·같은 입력열로 한 판을 «돌린다» — 렌더(2D/3D)는 코어를 건드리지 않으므로 이 결과가 곧 두 판의 결과다 */
function play(seed: number, mode: RainMode, typeEvery = 40, frames = 4000, typoEvery = 0) {
  const rng = seededRng(seed);
  const core = new RainCore({
    W: 800, H: 500, isKorean: true, rng, mode,
    pickWord: (min) => { const ok = WORDS.filter((w) => w.length >= min); const b = ok.length ? ok : WORDS; return b[Math.floor(rng() * b.length)]; },
  });
  let t = 0;
  for (let f = 0; f < frames && !core.over; f++) {
    t += 16;
    core.tick(t);
    if (typeEvery && f % typeEvery === 0 && core.words.length) {
      const target = typoEvery && f % (typeEvery * typoEvery) === 0 ? '틀린말' : core.words[0].text;
      core.submit(target, t);
    }
  }
  return { score: core.score, kills: core.kills, attempts: core.attempts, level: core.level, ph: core.ph, lives: core.lives, over: core.over, t };
}

describe('씨앗비 코어', () => {
  it('같은 시드·같은 입력열 → 점수·정확도·타수가 같다(2D·3D 동일 판정의 근거)', () => {
    for (const mode of ['classic', 'time', 'survival', 'daily'] as RainMode[]) {
      expect(play(7, mode, 30, 3000, 5)).toEqual(play(7, mode, 30, 3000, 5));
    }
  });

  it('다른 시드면 판이 달라진다(시드가 실제로 쓰인다)', () => {
    const first = (seed: number) => {
      const rng = seededRng(seed);
      const c = new RainCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '씨앗' });
      c.tick(1000);
      return c.words[0].x;
    };
    expect(first(1)).not.toBe(first(2));
    expect(first(1)).toBe(first(1));
  });

  it('놓치면 흙 기운이 0.8씩 깎이고 13번째에 끝난다(기본)', () => {
    const r = play(3, 'classic', 0, 100000);
    expect(r.over).toBe(true);
    expect(r.ph).toBeCloseTo(0, 5);
    expect(Math.ceil(PH_START / PH_DAMAGE_PER_MISS)).toBe(13);
  });

  it('오답 입력은 흙 기운을 깎지 않고 시도 수만 늘린다', () => {
    const rng = seededRng(5);
    const core = new RainCore({ W: 800, H: 500, isKorean: true, rng, pickWord: () => '씨앗' });
    core.tick(1000);
    core.submit('없는말', 1000);
    expect(core.ph).toBe(PH_START);
    expect(core.attempts).toBe(1);
    expect(core.kills).toBe(0);
  });

  it('60초 모드는 60초에 끝난다', () => {
    const r = play(4, 'time', 10, 100000);
    expect(r.over).toBe(true);
    expect(r.t).toBeGreaterThanOrEqual(TIME_LIMIT_MS);
    expect(r.t).toBeLessThan(TIME_LIMIT_MS + 100);
  });

  it('목숨 3개 모드는 세 번 놓치면 끝난다(흙 기운은 그대로)', () => {
    const r = play(6, 'survival', 0, 100000);
    expect(r.over).toBe(true);
    expect(r.lives).toBe(0);
    expect(r.ph).toBe(PH_START);
    expect(SURVIVAL_LIVES).toBe(3);
  });

  it('점수 = 입력 길이 × 10 (특수 씨앗 2배)', () => {
    const core = new RainCore({ W: 800, H: 500, isKorean: true, rng: seededRng(9), pickWord: () => '무지개' });
    core.tick(1000);
    const w = core.words[0];
    const ev = core.submit(w.text, 1000);
    expect(ev[0]).toMatchObject({ type: 'hit', points: 30 * (w.special ? 2 : 1) });
  });
});
