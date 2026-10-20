import { Env, json, badRequest, requireUser, ensureGenNick } from '../lib/common';
import { readWallet } from '../lib/wallet';

/** 내 프로필 + 지갑 + 최근 기록 요약 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (!user) return badRequest('unauthorized', 401);

  const profile = await env.DB.prepare(
    `SELECT id, nickname, avatar, grade_band, provisional, created_at FROM users WHERE id = ?1`
  )
    .bind(user.uid)
    .first<{
      id: string;
      nickname: string;
      avatar: string;
      grade_band: string | null;
      provisional: number;
      created_at: number;
    }>();

  if (!profile) return badRequest('account_missing', 404);

  // 옛 자유 입력 이름 → 생성 닉네임으로 한 번 치환(lib/common ensureGenNick)
  const nk = await ensureGenNick(env, profile.id, profile.nickname);
  profile.nickname = nk.nickname;
  const renamed = nk.renamed;

  const wallet = await readWallet(env, user.uid);

  const best = await env.DB.prepare(
    `SELECT MAX(kpm) AS best_kpm, MAX(accuracy) AS best_accuracy, COUNT(*) AS sessions
       FROM scores WHERE user_id = ?1 AND verify_status = 'ok'`
  )
    .bind(user.uid)
    .first<{ best_kpm: number | null; best_accuracy: number | null; sessions: number }>();

  return json({
    ok: true,
    user: {
      id: profile.id,
      nickname: profile.nickname,
      renamed,
      avatar: profile.avatar,
      gradeBand: profile.grade_band,
      provisional: !!profile.provisional,
      createdAt: profile.created_at,
    },
    wallet: wallet ?? { coins: 0, xp: 0, level: 1 },
    records: {
      bestKpm: Math.round(best?.best_kpm ?? 0),
      bestAccuracy: Math.round((best?.best_accuracy ?? 0) * 10) / 10,
      sessions: best?.sessions ?? 0,
    },
  });
};
