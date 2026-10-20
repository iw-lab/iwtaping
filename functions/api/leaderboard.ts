import { Env, json, badRequest, maskNickname } from '../lib/common';
import { kstDayKey, kstWeekKey, kstMonthStartMs } from '../lib/verify';

/**
 * 전국 순위.
 *
 * 캐시는 KV가 아니라 Cache API를 쓴다 — KV 무료 쓰기가 하루 1,000회뿐이라
 * 분 단위 갱신 × 기간 × 모드 × 급 조합이면 즉시 쿼터를 넘긴다.
 * Cache API는 쓰기 쿼터가 없고 엣지 로컬이라 이 용도에 맞는다.
 */

const CACHE_SECONDS = 60;
const PERIODS = new Set(['daily', 'weekly', 'monthly', 'all']);
const LIMIT = 50;

/**
 * 순위 대상 모드 화이트리스트.
 * SQL 문자열에 들어가는 값은 절대 사용자 입력에서 오지 않게 한다
 * (컬럼명·ORDER BY는 바인딩 파라미터로 넘길 수 없어 보간이 불가피하므로).
 */
const MODES: Record<string, { column: 'kpm' | 'score' }> = {
  speed: { column: 'kpm' },
  accuracy: { column: 'kpm' },
  'game:rain': { column: 'score' },
  'game:space': { column: 'score' },
  'game:race': { column: 'score' },
  'game:defense': { column: 'score' },
  'game:zombie': { column: 'score' },
  'game:puzzle': { column: 'score' },
};

const GRADE_BANDS = new Set(['elem', 'middle', 'high', 'adult']);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') ?? 'speed').slice(0, 32);
  const period = url.searchParams.get('period') ?? 'weekly';
  const gradeParam = url.searchParams.get('grade');

  if (!PERIODS.has(period)) return badRequest('invalid_period');
  const modeSpec = MODES[mode];
  if (!modeSpec) return badRequest('invalid_mode');
  const gradeBand = gradeParam && GRADE_BANDS.has(gradeParam) ? gradeParam : null;

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(
    `${url.origin}/api/leaderboard?mode=${mode}&period=${period}&grade=${gradeBand ?? 'all'}`,
    { method: 'GET' }
  );

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const filters: string[] = [
    `s.mode = ?1`,
    `s.verify_status = 'ok'`,
    `u.banned = 0`,
    // 신규 계정(provisional)은 순위에서 제외 — Sybil 어뷰징 완화
    `u.provisional = 0`,
  ];
  const binds: unknown[] = [mode];

  if (period === 'daily') {
    binds.push(kstDayKey());
    filters.push(`s.day_key = ?${binds.length}`);
  } else if (period === 'weekly') {
    binds.push(kstWeekKey());
    filters.push(`s.week_key = ?${binds.length}`);
  } else if (period === 'monthly') {
    binds.push(kstMonthStartMs());
    filters.push(`s.created_at >= ?${binds.length}`);
  }

  if (gradeBand) {
    binds.push(gradeBand);
    filters.push(`u.grade_band = ?${binds.length}`);
  }

  // 화이트리스트에서 온 값만 보간된다 (사용자 입력 아님)
  const rankColumn = modeSpec.column === 'score' ? 's.score' : 's.kpm';

  // 사용자별 최고 기록 1건씩만 순위에 올린다.
  const sql = `
    SELECT u.id AS uid, u.nickname AS nickname, u.avatar AS avatar,
           MAX(${rankColumn}) AS best,
           s.accuracy AS accuracy, s.created_at AS created_at
      FROM scores s
      JOIN users u ON u.id = s.user_id
     WHERE ${filters.join(' AND ')}
     GROUP BY s.user_id
     ORDER BY best DESC, s.created_at ASC
     LIMIT ${LIMIT}`;

  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<{ uid: string; nickname: string; avatar: string; best: number; accuracy: number; created_at: number }>();

  const entries = (results ?? []).map((r, i) => ({
    rank: i + 1,
    // 금칙어 필터를 강화하기 전에 등록된 닉네임은 DB에 그대로 남아 있다.
    // 저장본을 고치지 않고, 내보낼 때 한 번 더 걸러 순위표에 노출되지 않게 한다.
    nickname: maskNickname(r.nickname, r.uid),
    avatar: r.avatar,
    value: Math.round(r.best),
    accuracy: Math.round(r.accuracy * 10) / 10,
    at: r.created_at,
  }));

  const response = json(
    { ok: true, mode, period, entries, updatedAt: Date.now() },
    200,
    // 브라우저는 캐시하지 않고(no-store) 엣지에서만 60초 재사용
    { 'cdn-cache-control': `max-age=${CACHE_SECONDS}` }
  );

  await cache.put(cacheKey, new Response(response.clone().body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `max-age=${CACHE_SECONDS}`,
    },
  }));

  return response;
};

