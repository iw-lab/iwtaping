/**
 * 친 «내용»의 지문 — 순위가 «무엇을 쳤는가»를 볼 수 있게 한다.
 *
 * 🔴 배경(2026-09-18 사용자 지적 「의미없는 문장을 써도 타자수가 막 올라간다」):
 *    커스텀 테스트는 사용자가 지문을 직접 넣는데, 제출 본문에는 텍스트가 **아예 없었다**
 *    (mode·kpm·accuracy·intervals 뿐). 서버의 부정행위 검증은 타건 «간격»만 보므로,
 *    「가가가가…」처럼 같은 키만 반복하는 글을 손으로 빠르게 치면 간격은 정상적으로 흔들리고
 *    900타/분이 그대로 `ok` 로 승인됐다(tests/text-fingerprint.test.ts 재현).
 *
 * 그래서 원문 대신 **되돌릴 수 없는 요약**만 보낸다 — 사생활(친 내용)을 서버에 넘기지 않으면서도
 * «반복뿐인 글인가»는 판정할 수 있다. 서버는 이 숫자만으로 거부/보류를 정한다.
 */

export interface TextFingerprint {
  /** 글자 수(공백 포함) */
  len: number;
  /** 서로 다른 글자 수 ÷ 전체 글자 수 (0~1). 「가가가가」 = 0.25 */
  uniqueRatio: number;
  /** 가장 흔한 글자가 차지하는 비율 (0~1). 「가가가가」 = 1 */
  topCharRatio: number;
  /** 서로 다른 «두 글자 묶음» 수 ÷ 전체 묶음 수 (0~1). 반복문에서 낮아진다 */
  bigramRatio: number;
  /** 서로 다른 낱말 수 ÷ 전체 낱말 수 (0~1). 낱말이 없으면 1 */
  wordUniqueRatio: number;
}

export function fingerprintText(text: string): TextFingerprint {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  const len = chars.length;
  if (len === 0) return { len: 0, uniqueRatio: 1, topCharRatio: 0, bigramRatio: 1, wordUniqueRatio: 1 };

  const freq = new Map<string, number>();
  for (const c of chars) freq.set(c, (freq.get(c) ?? 0) + 1);
  const top = Math.max(...freq.values());

  const bigrams = new Set<string>();
  for (let i = 0; i + 1 < len; i++) bigrams.add(chars[i] + chars[i + 1]);
  const bigramTotal = Math.max(1, len - 1);

  const words = text.split(/\s+/).filter(Boolean);
  const wordUniqueRatio = words.length > 0 ? new Set(words).size / words.length : 1;

  return {
    len,
    uniqueRatio: round3(freq.size / len),
    topCharRatio: round3(top / len),
    bigramRatio: round3(bigrams.size / bigramTotal),
    wordUniqueRatio: round3(wordUniqueRatio),
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
