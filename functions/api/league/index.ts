import { Env, json, badRequest, requireUser, maskNickname } from '../../lib/common';
import { kstWeekKey } from '../../lib/verify';
import {
  BUCKET_SIZE,
  MAX_TIER,
  bucketQuota,
  settleWeek,
  oldestUnsettledWeek,
  LeagueOutcome,
} from '../../lib/league';

interface BoardRow {
  user_id: string;
  nickname: string;
  avatar: string;
  xp_earned: number;
}

interface LastWeekRow {
  week_key: string;
  tier: number;
  final_rank: number | null;
  outcome: LeagueOutcome | null;
}

/*
 * 화면에 나열할 인원 상한. 정원(30)보다 넉넉히 잡는다 —
 * 버킷 배정이 원자적이지 않아 31명이 될 수 있는데, 정확히 30에서 자르면
 * 넘친 사람이 자기 순위를 못 보고 표시 인원과 정산 인원도 어긋난다.
 */
const BOARD_LIMIT = BUCKET_SIZE * 2;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const user = await requireUser(request, env);
  if (!user) return badRequest('unauthorized', 401);

  const now = Date.now();
  const weekKey = kstWeekKey(now);

  /*
   * 지연 정산.
   *
   * 크론이 죽어 있어도 리그가 멈추지 않게, 리그 화면을 여는 순간 미정산 주가
   * 있으면 뒤에서 정산을 돌린다. "바로 지난주"가 아니라 **가장 오래된 미정산
   * 주**를 집는 이유는, 크론이 2주 넘게 죽어 있었을 때 밀린 주가 영영
   * 처리되지 않는 것을 막기 위해서다.
   * 여러 사용자가 동시에 열어도 league_settlements 실행권과 멱등 쓰기가
   * 중복 승급을 막는다. 응답은 기다리지 않는다(waitUntil).
   */
  const backlog = await oldestUnsettledWeek(env, now);
  if (backlog) {
    waitUntil(settleWeek(env, backlog, now).catch(() => undefined));
  }

  const me = await env.DB.prepare(
    `SELECT tier, bucket, xp_earned FROM league_members WHERE week_key = ?1 AND user_id = ?2`
  )
    .bind(weekKey, user.uid)
    .first<{ tier: number; bucket: number; xp_earned: number }>();

  // 이번 주 아직 안 뛰었으면 확정 티어만 보여준다(버킷은 첫 XP 적립 때 배정된다).
  const standing = await env.DB.prepare(`SELECT tier FROM league_standings WHERE user_id = ?1`)
    .bind(user.uid)
    .first<{ tier: number }>();

  const tier = Math.max(0, Math.min(MAX_TIER, me?.tier ?? standing?.tier ?? 0));

  let members: Array<{ rank: number; nickname: string; avatar: string; xp: number; isMe: boolean }> = [];
  let rank: number | null = null;

  /*
   * 표시 인원과 정산 인원은 같은 수여야 한다 — 이 값으로 승급선·강등선을
   * 그리는데, 정산은 버킷 전원 기준으로 정원을 계산하기 때문이다.
   * 그래서 인원은 목록 길이가 아니라 COUNT(*)로 따로 센다.
   */
  let bucketSize = 0;

  if (me) {
    const counted = await env.DB.prepare(
      `SELECT COUNT(*) AS n
         FROM league_members m JOIN users u ON u.id = m.user_id
        WHERE m.week_key = ?1 AND m.tier = ?2 AND m.bucket = ?3
          AND u.banned = 0 AND u.provisional = 0`
    )
      .bind(weekKey, me.tier, me.bucket)
      .first<{ n: number }>();
    bucketSize = counted?.n ?? 0;

    const board = await env.DB.prepare(
      `SELECT m.user_id, u.nickname, u.avatar, m.xp_earned
         FROM league_members m JOIN users u ON u.id = m.user_id
        WHERE m.week_key = ?1 AND m.tier = ?2 AND m.bucket = ?3
          AND u.banned = 0 AND u.provisional = 0
        ORDER BY m.xp_earned DESC, m.user_id ASC
        LIMIT ?4`
    )
      .bind(weekKey, me.tier, me.bucket, BOARD_LIMIT)
      .all<BoardRow>();

    members = (board.results ?? []).map((row, index) => ({
      rank: index + 1,
      nickname: maskNickname(row.nickname, row.user_id),
      avatar: row.avatar,
      xp: row.xp_earned,
      isMe: row.user_id === user.uid,
    }));
    rank = members.find((m) => m.isMe)?.rank ?? null;
  }

  const quota = bucketQuota(tier, bucketSize);

  // 지난주 결과 (정산이 끝난 가장 최근 주)
  const last = await env.DB.prepare(
    `SELECT week_key, tier, final_rank, outcome
       FROM league_members
      WHERE user_id = ?1 AND outcome IS NOT NULL
      ORDER BY week_key DESC LIMIT 1`
  )
    .bind(user.uid)
    .first<LastWeekRow>();

  /*
   * 지난주 보상은 공식으로 다시 계산하지 않고 **원장에서 읽는다**.
   * 보상 밸런싱으로 공식이 바뀌면 재계산 값은 실제 지급액과 갈라지고,
   * 그 순간 화면이 감사로그를 배신한다(wallet.ts: 원장이 진실원).
   */
  let lastCoins = 0;
  if (last) {
    const paid = await env.DB.prepare(
      `SELECT amount FROM wallet_transactions WHERE user_id = ?1 AND idempotency_key = ?2`
    )
      .bind(user.uid, `league:${last.week_key}:${user.uid}`)
      .first<{ amount: number }>();
    lastCoins = paid?.amount ?? 0;
  }

  return json({
    ok: true,
    weekKey,
    tier,
    bucket: me?.bucket ?? null,
    bucketSize,
    rank,
    xpEarned: me?.xp_earned ?? 0,
    promoteLine: quota.promote,
    demoteLine: quota.demote > 0 ? bucketSize - quota.demote : null,
    members,
    lastWeek: last
      ? {
          weekKey: last.week_key,
          tier: last.tier,
          rank: last.final_rank,
          outcome: last.outcome,
          coins: lastCoins,
        }
      : null,
  });
};
