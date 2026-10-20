import { Env, json, badRequest, getSecret, readJson, validateNickname, ensureGenNick } from '../lib/common';
import { hashDevice, signToken } from '../lib/auth';

interface Body {
  deviceId?: string;
  nickname?: string;
  avatar?: string;
  gradeBand?: string;
}

const GRADE_BANDS = new Set(['elem', 'middle', 'high', 'adult']);

/**
 * 익명 계정 발급/복구.
 * 같은 deviceId면 기존 계정을 그대로 돌려준다(재발급 아님).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJson<Body>(request);
  if (!body?.deviceId || typeof body.deviceId !== 'string' || body.deviceId.length < 8) {
    return badRequest('device_id_required');
  }

  const secret = getSecret(env);
  const deviceHash = await hashDevice(secret, body.deviceId);
  const now = Date.now();

  const existing = await env.DB.prepare(
    `SELECT u.id AS id, u.nickname AS nickname, u.avatar AS avatar, u.provisional AS provisional, u.banned AS banned
       FROM devices d JOIN users u ON u.id = d.user_id
      WHERE d.device_hash = ?1`
  )
    .bind(deviceHash)
    .first<{ id: string; nickname: string; avatar: string; provisional: number; banned: number }>();

  if (existing) {
    if (existing.banned) return badRequest('account_banned', 403);
    await env.DB.prepare(`UPDATE users SET last_seen_at = ?1 WHERE id = ?2`).bind(now, existing.id).run();
    const nk = await ensureGenNick(env, existing.id, existing.nickname);
    return json({
      ok: true,
      token: await signToken(secret, { uid: existing.id, iat: now }),
      user: {
        id: existing.id,
        nickname: nk.nickname,
        renamed: nk.renamed,
        avatar: existing.avatar,
        provisional: !!existing.provisional,
      },
    });
  }

  const nick = validateNickname(body.nickname);
  if (!nick.ok) return badRequest(nick.error);

  const gradeBand = GRADE_BANDS.has(String(body.gradeBand)) ? String(body.gradeBand) : null;
  const uid = crypto.randomUUID();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, nickname, avatar, grade_band, created_at, last_seen_at, provisional, banned)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1, 0)`
      ).bind(uid, nick.value, typeof body.avatar === 'string' ? body.avatar : 'cat', gradeBand, now),
      env.DB.prepare(`INSERT INTO devices (device_hash, user_id, created_at) VALUES (?1, ?2, ?3)`).bind(
        deviceHash,
        uid,
        now
      ),
      env.DB.prepare(`INSERT INTO wallets (user_id, coins, xp, level) VALUES (?1, 0, 0, 1)`).bind(uid),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('idx_users_nickname') || message.includes('UNIQUE')) {
      return badRequest('nickname_taken', 409);
    }
    throw err;
  }

  return json({
    ok: true,
    token: await signToken(secret, { uid, iat: now }),
    user: { id: uid, nickname: nick.value, avatar: body.avatar ?? 'cat', provisional: true },
  });
};
