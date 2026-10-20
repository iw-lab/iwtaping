import { Env, json, badRequest, maskNickname } from '../lib/common';

/**
 * 고스트 레이스 상대 목록.
 *
 * 순위(leaderboard)와 달리 '대결 상대의 페이스'를 제공하는 용도이므로
 * Sybil 방지(provisional/미검증 제외)를 걸지 않는다 — 실제 사람이 친 실측 WPM이면
 * 그 자체로 고스트로서 충분하다. 명백한 조작(verify_status='rejected')과
 * 차단 계정(banned)만 제외한다. 노출 정보는 공개 순위와 같은 익명 닉네임 + WPM뿐.
 *
 * 캐시는 leaderboard와 동일하게 Cache API(엣지 로컬, 쓰기 쿼터 없음)를 쓴다.
 */

const CACHE_SECONDS = 45;
const LIMIT = 40;
const ALLOWED = new Set(['game:race']);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') ?? 'game:race').slice(0, 32);
  const language = (url.searchParams.get('lang') ?? '').slice(0, 8);
  if (!ALLOWED.has(mode)) return badRequest('invalid_mode');

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(
    `${url.origin}/api/ghosts?mode=${mode}&lang=${language || 'all'}`,
    { method: 'GET' }
  );
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const filters: string[] = [
    `s.mode = ?1`,
    `s.verify_status != 'rejected'`,
    `u.banned = 0`,
    `s.score > 0`,
  ];
  const binds: unknown[] = [mode];
  if (language) {
    binds.push(language);
    filters.push(`s.language = ?${binds.length}`);
  }

  // 사용자별 최고 WPM 1건씩, 최근 활동 우선.
  const sql = `
    SELECT u.id AS uid, u.nickname AS nickname,
           MAX(s.score) AS wpm,
           MAX(s.created_at) AS at
      FROM scores s
      JOIN users u ON u.id = s.user_id
     WHERE ${filters.join(' AND ')}
     GROUP BY s.user_id
     ORDER BY at DESC
     LIMIT ${LIMIT}`;

  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<{ uid: string; nickname: string; wpm: number; at: number }>();

  const ghosts = (results ?? [])
    .filter((r) => r.nickname && r.wpm > 0)
    // 옛 닉네임도 아이들 화면에 그대로 뜨지 않게 내보낼 때 한 번 더 거른다.
    .map((r) => ({ nickname: maskNickname(r.nickname, r.uid), wpm: Math.round(r.wpm) }));

  const response = json(
    { ok: true, mode, ghosts, updatedAt: Date.now() },
    200,
    { 'cdn-cache-control': `max-age=${CACHE_SECONDS}` }
  );

  await cache.put(
    cacheKey,
    new Response(response.clone().body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `max-age=${CACHE_SECONDS}`,
      },
    })
  );

  return response;
};
