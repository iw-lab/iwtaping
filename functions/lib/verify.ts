/**
 * 점수 제출 검증 (부정행위 방지).
 *
 * 전제: 웹 클라이언트만으로는 "사람이 실제로 눌렀다"를 증명할 수 없다.
 * 목표는 완벽 차단이 아니라 (1) 순진한 조작을 전부 걷어내고
 * (2) 정교한 조작의 비용을 올리며 (3) 애매한 건 보류시켜 사람이 보게 하는 것.
 */

export interface ScoreSubmission {
  mode: string;
  language?: string;
  kpm: number;
  accuracy: number;
  score?: number;
  elapsedMs: number;
  totalKeystrokes: number;
  correctKeystrokes: number;
  /** 이번 세션 최대 콤보. XP 공식에 들어가므로 반드시 검증 대상이다. */
  maxCombo?: number;
  textHash?: string;
  textVersion?: string;
  /** 연속 키 입력 간격(ms) 배열. 최대 2000개까지만 전송. */
  intervals?: number[];
  /**
   * 친 «지문»의 되돌릴 수 없는 요약(src/lib/typing/text-fingerprint.ts).
   * 🔴 이게 없으면 서버는 «무엇을 쳤는지»를 볼 방법이 아예 없다 — 간격만 보므로 사용자가 직접 넣은
   *    「가가가가…」를 손으로 빠르게 친 900타/분이 그대로 승인됐다(2026-09-18 사용자 지적·재현).
   *    원문은 보내지 않는다(사생활). 반복뿐인 글인지 판정할 만큼의 숫자만 보낸다.
   */
  text?: { len: number; uniqueRatio: number; topCharRatio: number; bigramRatio: number; wordUniqueRatio: number };
}

export type VerifyStatus = 'ok' | 'pending' | 'rejected';

export interface VerifyResult {
  status: VerifyStatus;
  reason?: string;
}

/** 사람의 물리적 상한 — 세계 기록(약 1000타/분)에 여유를 둔 값 */
export const MAX_KPM = 1300;
/** 최소 인정 세션 길이 */
export const MIN_ELAPSED_MS = 3000;
export const MAX_ELAPSED_MS = 1000 * 60 * 60; // 1시간
/** 게임 점수 상한 — 초당 획득 가능한 점수에 여유를 둔 값 */
export const MAX_SCORE_PER_SECOND = 500;
export const MAX_SCORE = 1_000_000;
/** 신고 정확도와 타수에서 계산한 정확도의 허용 오차(%p) */
export const ACCURACY_TOLERANCE = 2;

/**
 * 지문 «내용» 문턱 — 앱이 실제로 쓰는 글과 무의미한 반복문을 가르는 선.
 * 2026-09-18 실측(tests/text-fingerprint.test.ts 가 이 수치를 고정한다):
 *   실제 콘텐츠 bigramRatio 최저 — 한글 긴문장 0.416 · 영어 짧은문장 0.549 ·
 *                                한글 짧은문장 0.636 · 자리 드릴 0.865 · 단어목록 0.816
 *   무의미 반복       bigramRatio — 「가」×20 0.053 · 「사과」 반복 0.107 · 자모 반복 0.174
 * 양쪽 어디에도 붙지 않게 거부 0.25 / 보류 0.35 로 둔다.
 * 🔴 짧은 글은 비율이 불안정하므로 TEXT_MIN_LEN 미만은 «판정하지 않는다»(자리 드릴 한 글자 등).
 */
export const TEXT_MIN_LEN = 12;
export const TEXT_BIGRAM_REJECT = 0.25;
export const TEXT_BIGRAM_PENDING = 0.35;

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function verifySubmission(sub: ScoreSubmission): VerifyResult {
  // --- 형식 검사 ---
  const nums = [sub.kpm, sub.accuracy, sub.elapsedMs, sub.totalKeystrokes, sub.correctKeystrokes];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
    return { status: 'rejected', reason: 'malformed' };
  }
  if (sub.accuracy > 100) return { status: 'rejected', reason: 'accuracy_out_of_range' };
  if (sub.correctKeystrokes > sub.totalKeystrokes) {
    return { status: 'rejected', reason: 'correct_exceeds_total' };
  }

  // --- 물리 한계 ---
  if (sub.kpm > MAX_KPM) return { status: 'rejected', reason: 'kpm_above_human_limit' };
  if (sub.elapsedMs < MIN_ELAPSED_MS) return { status: 'rejected', reason: 'session_too_short' };
  if (sub.elapsedMs > MAX_ELAPSED_MS) return { status: 'rejected', reason: 'session_too_long' };

  // --- 게임 점수: 범위 + 시간당 획득률 상한 ---
  // (숫자 범위만 보면 Number.MAX_SAFE_INTEGER를 그대로 리더보드 1위로 올릴 수 있다)
  const score = sub.score ?? 0;
  if (!Number.isFinite(score) || score < 0 || !Number.isSafeInteger(Math.round(score))) {
    return { status: 'rejected', reason: 'malformed_score' };
  }
  if (score > MAX_SCORE) return { status: 'rejected', reason: 'score_above_limit' };
  if (score > (sub.elapsedMs / 1000) * MAX_SCORE_PER_SECOND) {
    return { status: 'rejected', reason: 'score_rate_impossible' };
  }

  // --- 콤보: 타수를 넘을 수 없다 ---
  // (XP 공식에 maxCombo가 들어가므로 검증에서 빠지면 임의 XP 발행이 가능해진다)
  const maxCombo = sub.maxCombo ?? 0;
  if (!Number.isFinite(maxCombo) || maxCombo < 0) {
    return { status: 'rejected', reason: 'malformed_combo' };
  }
  if (maxCombo > sub.correctKeystrokes) {
    return { status: 'rejected', reason: 'combo_exceeds_keystrokes' };
  }

  // --- 자기모순: 신고한 정확도가 신고한 타수와 맞는지 ---
  // (accuracy만 100에 가깝게 조작해 XP·순위를 부풀리는 경로를 막는다)
  if (sub.totalKeystrokes > 0) {
    const impliedAccuracy = (sub.correctKeystrokes / sub.totalKeystrokes) * 100;
    if (Math.abs(sub.accuracy - impliedAccuracy) > ACCURACY_TOLERANCE) {
      return { status: 'rejected', reason: 'accuracy_inconsistent_with_keystrokes' };
    }
  } else if (sub.accuracy > 0) {
    return { status: 'rejected', reason: 'accuracy_without_keystrokes' };
  }

  // --- 자기모순: 신고한 타수와 경과시간이 신고한 속도와 맞는지 ---
  const minutes = sub.elapsedMs / 60000;
  if (minutes > 0) {
    const impliedKpm = sub.correctKeystrokes / minutes;
    // 한글은 자모 분해로 타수가 늘어 오차가 크므로 넉넉히 3배까지 허용
    if (sub.kpm > impliedKpm * 3 + 60) {
      return { status: 'rejected', reason: 'kpm_inconsistent_with_keystrokes' };
    }
  }

  // --- 타건 간격 분석 (있을 때만) ---
  const intervals = (sub.intervals ?? []).filter((n) => Number.isFinite(n) && n >= 0);

  if (intervals.length) {
    // 간격의 총합은 세션 길이를 넘을 수 없다. 넘으면 로그가 조작됐거나
    // 다른 세션의 로그를 붙여넣은 것이다.
    const sum = intervals.reduce((a, b) => a + b, 0);
    if (sum > sub.elapsedMs * 1.1 + 1000) {
      return { status: 'rejected', reason: 'intervals_exceed_session' };
    }
    // 타건 수가 신고 타수보다 많을 수는 없다(자모 분해 감안해 3배까지 허용)
    if (intervals.length > sub.totalKeystrokes * 3 + 10) {
      return { status: 'rejected', reason: 'intervals_exceed_keystrokes' };
    }
  }
  if (intervals.length >= 20) {
    const sd = stdev(intervals);
    const med = median(intervals);

    // 사람의 타건 간격은 반드시 흔들린다. 변동계수가 극단적으로 낮으면 자동 입력.
    const cv = med > 0 ? sd / med : 0;
    if (cv < 0.05) return { status: 'rejected', reason: 'interval_variance_too_low' };

    // 물리적으로 불가능한 연타 비율
    const impossible = intervals.filter((i) => i < 10).length / intervals.length;
    if (impossible > 0.2) return { status: 'rejected', reason: 'impossible_burst' };

    // --- 여기부터는 "거부"가 아니라 보류 신호 (확실한 조작 판정 뒤에 온다) ---

    // 애매한 구간은 보류시켜 사람이 확인
    if (cv < 0.12) return { status: 'pending', reason: 'suspicious_regularity' };

    // 로그가 세션을 거의 대변하지 못하면(예: 60초 세션에 1.4초어치 로그) 보류
    const sum = intervals.reduce((a, b) => a + b, 0);
    if (sum < sub.elapsedMs * 0.3) {
      return { status: 'pending', reason: 'intervals_do_not_cover_session' };
    }
  } else if (sub.kpm > 700) {
    // 고득점인데 타건 로그가 없으면 자동 승인하지 않는다
    return { status: 'pending', reason: 'high_score_without_keylog' };
  }

  // --- 친 «내용» 검사 — 무엇을 쳤는지 볼 수 있을 때만 ---
  const fp = sub.text;
  if (fp && Number.isFinite(fp.len) && fp.len >= TEXT_MIN_LEN) {
    const bg = Number(fp.bigramRatio);
    if (!Number.isFinite(bg) || bg < 0 || bg > 1) return { status: 'rejected', reason: 'malformed_text_stats' };
    // 같은 글자·낱말만 되풀이하는 글은 «빨리 치기 쉬운 글»이지 실력이 아니다
    if (bg < TEXT_BIGRAM_REJECT) return { status: 'rejected', reason: 'text_too_repetitive' };
    if (bg < TEXT_BIGRAM_PENDING) return { status: 'pending', reason: 'text_repetitive' };
  } else if (!fp && sub.kpm > 700) {
    // 고득점인데 «무엇을 쳤는지»를 안 보냈으면 자동 승인하지 않는다(옛 클라이언트 포함)
    return { status: 'pending', reason: 'high_score_without_text_stats' };
  }

  return { status: 'ok' };
}

/** KST 기준 날짜 키 — 순위 집계 단위 */
export function kstDayKey(now: number = Date.now()): string {
  const kst = new Date(now + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * KST 기준 이번 달 1일 00:00의 epoch(ms).
 * scores.created_at(= Date.now() ms)와 직접 비교해 월간 순위를 낸다
 * (월간은 별도 키 컬럼 없이 created_at 범위로 집계 — 마이그레이션 불요).
 */
export function kstMonthStartMs(now: number = Date.now()): number {
  const kst = new Date(now + 9 * 3600 * 1000);
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1, 0, 0, 0) - 9 * 3600 * 1000;
}

/** KST 기준 ISO 주차 키 (리그 주기) */
export function kstWeekKey(now: number = Date.now()): string {
  const kst = new Date(now + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  // ISO-8601: 목요일이 속한 해가 그 주의 해
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
