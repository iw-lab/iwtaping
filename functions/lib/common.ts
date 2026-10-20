import { isGenNick, genNickFrom } from '../../src/lib/moderation/gen-nick';
export { isGenNick, genNickFrom };
import { verifyToken } from './auth';
import { checkNickname } from './nickname';

export interface Env {
  DB: D1Database;
  /** wrangler secret put AUTH_SECRET */
  AUTH_SECRET: string;
  /**
   * 주간 정산 잡 호출용 공유 비밀 (wrangler pages secret put CRON_SECRET).
   * 미설정이면 정산 엔드포인트는 항상 거부한다 — 빈 값으로 열려 버리는 사고 방지.
   */
  CRON_SECRET?: string;
}

/**
 * 상수 시간 문자열 비교. 비밀 비교에 `===`를 쓰면 앞자리부터 맞춰 가는
 * 타이밍 공격 여지가 생긴다(엔드포인트가 공개돼 있으므로 실측 가능한 표면이다).
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 정산 잡 인증 — Authorization: Bearer <CRON_SECRET> */
export function isCronAuthorized(request: Request, env: Env): boolean {
  const secret = env.CRON_SECRET ?? '';
  if (secret.length < 16) return false;
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  return safeEqual(header.slice(7), secret);
}

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // API 응답은 절대 공유 캐시에 남기지 않는다 (사용자별·시간민감)
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function badRequest(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

export function getSecret(env: Env): string {
  const secret = env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('AUTH_SECRET is not configured');
  }
  return secret;
}

/**
 * 인증된 사용자를 돌려준다.
 *
 * 서명 검증만으로는 부족하다 — 계정이 삭제됐거나 밴된 뒤에도 기존 토큰이
 * 만료 전까지 계속 통과하기 때문이다. 매 요청마다 계정 상태를 확인한다.
 */
export async function requireUser(request: Request, env: Env): Promise<{ uid: string } | null> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  const payload = await verifyToken(getSecret(env), token);
  if (!payload) return null;

  const row = await env.DB.prepare(`SELECT banned FROM users WHERE id = ?1`)
    .bind(payload.uid)
    .first<{ banned: number }>();

  if (!row || row.banned) return null;
  return { uid: payload.uid };
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 단순 rate limit — D1 기반. 같은 사용자의 같은 액션 호출 빈도를 제한한다.
 * (KV 무료 쓰기 쿼터가 낮아 D1으로 처리)
 */
export async function isRateLimited(
  env: Env,
  userId: string,
  action: 'score',
  maxPerWindow: number,
  windowMs: number
): Promise<boolean> {
  if (action !== 'score') return false;
  const since = Date.now() - windowMs;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scores WHERE user_id = ?1 AND created_at > ?2`
  )
    .bind(userId, since)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= maxPerWindow;
}

// 금칙어 목록·정규화는 nickname.ts에 모여 있다(클라이언트 사본과 테스트로 동기화).
export function validateNickname(nickname: unknown): { ok: true; value: string } | { ok: false; error: string } {
  // 새 이름은 생성 닉네임 형식만 받는다(자유 입력 0 — 아동 개인정보). 형식이 맞아도 금칙어 검사는 그대로 한 번 더
  if (!isGenNick(nickname)) return { ok: false, error: 'nickname_format' };
  return checkNickname(nickname);
}

/**
 * 공개 목록(순위표·리그·고스트)에 내보낼 닉네임.
 *
 * 금칙어 필터를 강화하기 전에 만들어진 계정은 DB에 그대로 남아 있다.
 * 저장본을 건드리지 않고 내보낼 때 한 번 더 걸러, 옛 닉네임이 아이들 화면에
 * 노출되지 않게 한다(계정 자체는 살아 있고 본인 화면에서는 원래대로 보인다).
 */
export function maskNickname(nickname: string, userId: string): string {
  // 생성 닉네임만 공개한다 — 옛 자유 입력 이름(실명·욕설 위험)은 «사용자 id» 로 정해진 생성 이름으로.
  // 옛 이름 문자열로 만들면 «김철수» 같은 후보를 넣어 공개 별칭과 맞춰 볼 수 있다(8way codex) — id 는 공개되지 않는다.
  // ensureGenNick 의 첫 후보(salt 0)와 같아서 로그인 전후 공개 이름이 같다(8way grok).
  return isGenNick(nickname) ? nickname : genNickFrom(userId, 0);
}

/**
 * 옛 자유 입력 이름 → 생성 닉네임으로 한 번 치환(점수·리그·지갑은 그대로). 이미 생성 형식이면 그대로.
 * 돌려줌 = { nickname, renamed } — renamed 면 화면이 «새 이름» 을 한 번 알려 준다.
 */
export async function ensureGenNick(env: Env, id: string, nickname: string): Promise<{ nickname: string; renamed: boolean }> {
  if (isGenNick(nickname)) return { nickname, renamed: false };
  for (let salt = 0; salt < 8; salt++) {
    const next = genNickFrom(id, salt);
    try {
      const r = await env.DB.prepare(`UPDATE users SET nickname = ?1 WHERE id = ?2`).bind(next, id).run();
      if (r.meta?.changes) return { nickname: next, renamed: true };
    } catch { /* 같은 이름이 있으면(UNIQUE) 다음 후보 */ }
  }
  // 8번 다 겹치면(극히 드묾) 저장은 못 했어도 공개 이름은 같은 id 규칙으로 — 옛 자유 입력 이름을 돌려주지 않는다
  return { nickname: genNickFrom(id, 0), renamed: false };
}
