import { describe, it, expect } from 'vitest';
import { fingerprintText } from '@/lib/typing/text-fingerprint';
import { verifySubmission, TEXT_BIGRAM_REJECT, TEXT_BIGRAM_PENDING, TEXT_MIN_LEN } from '../functions/lib/verify';
import { koreanSentencesShort } from '@/data/korean/sentences-short';
import { koreanSentencesLong } from '@/data/korean/sentences-long';
import { englishSentencesShort } from '@/data/english/sentences-short';
import { koreanWordsBeginner } from '@/data/korean/words-beginner';

/**
 * 2026-09-18 사용자 지적: 「의미없는 문장을 써도 타자수가 막 올라간다」.
 * 원인 = 커스텀 테스트는 칠 글을 사용자가 넣는데, 제출 본문에 «무엇을 쳤는지»가 없어서
 *        서버가 타건 간격만 봤다 → 「가가가가…」 900타/분이 그대로 ok 였다.
 */

/** 사람이 실제로 칠 법한 간격(흔들림 포함) — 간격 검사를 통과하는 «손으로 친» 세션 */
function humanIntervals(n: number, mean: number): number[] {
  const out: number[] = [];
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out.push(Math.max(8, Math.round(mean + (seed / 2147483648 - 0.5) * mean * 0.7)));
  }
  return out;
}

function submit(text: string, kpm: number, seconds = 30, withText = true) {
  const keys = Math.max(1, Math.round(kpm * (seconds / 60)));
  return verifySubmission({
    mode: 'speed', language: 'ko',
    kpm, accuracy: 100, score: 0, maxCombo: keys,
    elapsedMs: seconds * 1000, totalKeystrokes: keys, correctKeystrokes: keys,
    intervals: humanIntervals(keys, (seconds * 1000) / keys),
    ...(withText ? { text: fingerprintText(text) } : {}),
  });
}

const pick = (a: unknown[]) => a.map((x) => (typeof x === 'string' ? x : (x as { text?: string }).text ?? '')).filter(Boolean);

describe('친 «내용» 검증', () => {
  it('반복뿐인 글로 만든 고득점은 거부된다 (이 버그의 회귀 방지)', () => {
    expect(submit('가'.repeat(30), 900).status).toBe('rejected');
    expect(submit('사과 '.repeat(15), 900).status).toBe('rejected');
    expect(submit('ㅁㄴㅇㄹ'.repeat(10), 900).status).toBe('rejected');
  });

  it('앱이 실제로 쓰는 지문은 전부 통과한다 (과잉 차단 방지)', () => {
    const corpus = [
      ...pick(koreanSentencesShort as unknown as unknown[]),
      ...pick(koreanSentencesLong as unknown as unknown[]),
      ...pick(englishSentencesShort as unknown as unknown[]),
      pick(koreanWordsBeginner as unknown as unknown[]).slice(0, 100).join(' '),
    ].filter((t) => fingerprintText(t).len >= TEXT_MIN_LEN);

    expect(corpus.length).toBeGreaterThan(300);
    const blocked = corpus.filter((t) => submit(t, 450).status !== 'ok');
    expect(blocked).toEqual([]);
  });

  it('실제 지문과 무의미 반복 사이에 문턱이 놓여 있다', () => {
    const real = [
      ...pick(koreanSentencesShort as unknown as unknown[]),
      ...pick(koreanSentencesLong as unknown as unknown[]),
      ...pick(englishSentencesShort as unknown as unknown[]),
    ].map(fingerprintText).filter((f) => f.len >= TEXT_MIN_LEN).map((f) => f.bigramRatio);
    const junk = ['가'.repeat(30), '사과 '.repeat(15), 'ㅁㄴㅇㄹ'.repeat(10)]
      .map(fingerprintText).map((f) => f.bigramRatio);

    expect(Math.min(...real)).toBeGreaterThan(TEXT_BIGRAM_PENDING);
    expect(Math.max(...junk)).toBeLessThan(TEXT_BIGRAM_REJECT);
  });

  it('짧은 글은 판정하지 않는다 (자리 연습 한두 글자)', () => {
    expect(fingerprintText('ㅁㄴ').len).toBeLessThan(TEXT_MIN_LEN);
    expect(submit('ㅁㄴ', 300).status).toBe('ok');
  });

  it('내용을 안 보낸 고득점은 자동 승인하지 않는다', () => {
    const r = submit('아무 글', 900, 30, false);
    expect(r.status).toBe('pending');
    expect(r.reason).toBe('high_score_without_text_stats');
  });
});
