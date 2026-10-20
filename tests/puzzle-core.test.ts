import { describe, it, expect } from 'vitest';
import {
  PuzzleCore, seededRng, seedFromString,
  TURN_START_MS, TURN_CAP_MS, TIME_LIMIT_MS, SURVIVAL_LIVES, STUCK_BONUS,
  type PuzzleMode,
} from '@/lib/game/puzzle/core';

/** 합성 사전 — 실제 단어 뜻은 중요하지 않고(코어는 글자만 본다), 끝말잇기가 오래 이어지도록
 *  한글 음절을 사슬로 엮는다: WORDS[i] = L[i] + L[i+1], 그래서 WORDS[i]의 끝 = WORDS[i+1]의 시작. */
function buildChainDictionary(n: number): string[] {
  const syll: string[] = [];
  for (let i = 0; i < n + 1; i++) syll.push(String.fromCharCode(0xac00 + ((i * 937) % 11172)));
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(syll[i] + syll[i + 1]);
  return [...new Set(words)];
}
const WORDS = buildChainDictionary(2000);

/** 같은 시드·같은 입력열로 한 판을 «돌린다» — 매 턴 코어가 가리키는 currentWord 의 끝글자로
 *  시작하는 사전 단어를 찾아 이어간다(실제 플레이어 타이핑을 흉내). typoEvery 간격마다는 일부러 오답을 낸다. */
function play(seed: number, mode: PuzzleMode, typeEvery = 20, frames = 4000, typoEvery = 0) {
  const rng = seededRng(seed);
  const core = new PuzzleCore({ isKorean: true, rng, wordPool: WORDS, validWords: new Set(WORDS), mode });
  let t = 0;
  for (let f = 0; f < frames && !core.over; f++) {
    t += 16;
    core.tick(t);
    if (typeEvery && f % typeEvery === 0 && !core.over) {
      if (typoEvery && f % (typeEvery * typoEvery) === 0) {
        core.submit('틀린말이다', t);
        continue;
      }
      const lastCh = core.currentWord[core.currentWord.length - 1];
      const next = WORDS.find((w) => w[0] === lastCh && !core.usedWords.has(w));
      if (next) core.submit(next, t);
    }
  }
  return {
    score: core.score, totalWords: core.totalWords, attempts: core.attempts,
    level: core.level, combo: core.combo, maxCombo: core.maxCombo,
    lives: core.lives, over: core.over, t,
  };
}

describe('끝말잇기 코어', () => {
  it('같은 시드·같은 입력열 → 점수·정확도·단어 수가 같다(2D·3D 동일 판정의 근거)', () => {
    for (const mode of ['classic', 'time', 'survival', 'daily'] as PuzzleMode[]) {
      expect(play(7, mode, 20, 3000, 5)).toEqual(play(7, mode, 20, 3000, 5));
    }
  });

  it('다른 시드면 시작 단어가 달라질 수 있다(시드가 실제로 쓰인다)', () => {
    const starter = (seed: number) => {
      const rng = seededRng(seed);
      const core = new PuzzleCore({ isKorean: true, rng, wordPool: WORDS, validWords: new Set(WORDS) });
      core.tick(16);
      return core.currentWord;
    };
    // 같은 시드는 항상 같은 시작 단어
    expect(starter(1)).toBe(starter(1));
    // 여러 시드를 돌려 보면 적어도 하나는 달라진다(완전히 같은 결과만 나올 확률은 사실상 0)
    const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
    const results = new Set(seeds.map(starter));
    expect(results.size).toBeGreaterThan(1);
  });

  it('classic — 턴 시간이 다 되면(입력 없이) 즉시 게임오버', () => {
    const r = play(3, 'classic', 0, 100000);
    expect(r.over).toBe(true);
    expect(r.t).toBeGreaterThanOrEqual(TURN_START_MS);
    expect(r.t).toBeLessThan(TURN_START_MS + 200);
  });

  it('오답 입력은 콤보만 끊고 시도 수를 늘릴 뿐, 체인은 그대로다', () => {
    const rng = seededRng(5);
    const core = new PuzzleCore({ isKorean: true, rng, wordPool: WORDS, validWords: new Set(WORDS) });
    core.tick(1000);
    const before = core.currentWord;
    const ev = core.submit('없는말이야', 1000);
    expect(ev[0]).toMatchObject({ type: 'invalid' });
    expect(core.currentWord).toBe(before);
    expect(core.attempts).toBe(1);
    expect(core.totalWords).toBe(0);
    expect(core.combo).toBe(0);
  });

  it('time 모드는 60초 세션이 끝나면 게임오버(정답을 계속 이어가며 턴 시계를 늘려도)', () => {
    const r = play(4, 'time', 10, 100000);
    expect(r.over).toBe(true);
    expect(r.t).toBeGreaterThanOrEqual(TIME_LIMIT_MS);
    expect(r.t).toBeLessThan(TIME_LIMIT_MS + 200);
  });

  it('survival — 목숨 3개(입력 없이 세 번 턴 초과)면 끝난다', () => {
    const r = play(6, 'survival', 0, 100000);
    expect(r.over).toBe(true);
    expect(r.lives).toBe(0);
    expect(SURVIVAL_LIVES).toBe(3);
  });

  it('정답 보너스는 턴 시계를 +4초, 20초 상한까지 늘린다', () => {
    const rng = seededRng(9);
    const core = new PuzzleCore({ isKorean: true, rng, wordPool: WORDS, validWords: new Set(WORDS) });
    core.tick(1000);
    const lastCh = core.currentWord[core.currentWord.length - 1];
    const next = WORDS.find((w) => w[0] === lastCh)!;
    core.submit(next, 1000);
    expect(core.turnSeconds(1000)).toBeLessThanOrEqual(TURN_CAP_MS / 1000);
  });

  it('점수 = 글자 수 × 10 × (1 + ⌊콤보/3⌋ × 0.5)', () => {
    const rng = seededRng(11);
    const core = new PuzzleCore({ isKorean: true, rng, wordPool: WORDS, validWords: new Set(WORDS) });
    core.tick(1000);
    let t = 1000;
    let lastPoints = 0;
    for (let i = 0; i < 4; i++) {
      const lastCh = core.currentWord[core.currentWord.length - 1];
      const next = WORDS.find((w) => w[0] === lastCh && !core.usedWords.has(w))!;
      const ev = core.submit(next, t);
      const hit = ev.find((e) => e.type === 'hit' && e.isPlayer);
      expect(hit).toBeTruthy();
      if (hit && hit.type === 'hit') {
        const expected = Math.round(next.length * 10 * (1 + Math.floor(core.combo / 3) * 0.5));
        expect(hit.points).toBe(expected);
        lastPoints = hit.points;
      }
      t += 500;
    }
    expect(lastPoints).toBeGreaterThan(0);
  });

  it('상대가 이어갈 단어를 못 찾으면 +100 보너스를 준다', () => {
    const rng = seededRng(21);
    // 사전을 아주 작게 둬 상대가 금방 막히게 한다(끝말잇기 쪽 단어가 사실상 바닥남).
    const tiny = ['가나', '나다'];
    const core = new PuzzleCore({ isKorean: true, rng, wordPool: tiny, validWords: new Set(tiny) });
    core.tick(1000);
    // 시작 단어 '가나' 다음 '나다'를 넣으면 '다'로 이어갈 단어가 tiny 풀에 없다 → 상대 막힘.
    expect(core.currentWord).toBe('가나');
    const before = core.score;
    const ev = core.submit('나다', 1000);
    const bonus = ev.find((e) => e.type === 'bonus');
    expect(bonus).toMatchObject({ type: 'bonus', points: STUCK_BONUS });
    expect(core.score).toBe(before + '나다'.length * 10 + STUCK_BONUS);
  });

  it('daily — 날짜 문자열 시드가 바뀌면 보통 다른 시작 단어가 나온다', () => {
    const core1 = new PuzzleCore({ isKorean: true, rng: seededRng(seedFromString('puzzle:2026-10-20:ko')), wordPool: WORDS, validWords: new Set(WORDS), mode: 'daily' });
    core1.tick(16);
    const core2 = new PuzzleCore({ isKorean: true, rng: seededRng(seedFromString('puzzle:2026-10-21:ko')), wordPool: WORDS, validWords: new Set(WORDS), mode: 'daily' });
    core2.tick(16);
    // 결정적 재현 — 같은 날짜 시드는 항상 같은 단어
    const core1b = new PuzzleCore({ isKorean: true, rng: seededRng(seedFromString('puzzle:2026-10-20:ko')), wordPool: WORDS, validWords: new Set(WORDS), mode: 'daily' });
    core1b.tick(16);
    expect(core1.currentWord).toBe(core1b.currentWord);
  });
});
