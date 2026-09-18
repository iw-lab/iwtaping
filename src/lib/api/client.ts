'use client';

/**
 * 서버 API 클라이언트.
 *
 * 백엔드(Cloudflare Pages Functions)가 배포되지 않은 환경에서도 앱은 그대로 동작해야 한다.
 * 따라서 모든 호출은 실패를 정상 흐름으로 처리하고(오프라인 우선), 실패 시 null을 돌려준다.
 */

const TOKEN_KEY = 'typingverse-token';
const DEVICE_KEY = 'typingverse-device';
const USER_KEY = 'typingverse-user';

export interface ApiUser {
  id: string;
  nickname: string;
  avatar: string;
  provisional: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  avatar: string;
  value: number;
  accuracy: number;
  at: number;
}

function ls(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getDeviceId(): string {
  const store = ls();
  if (!store) return '';
  let id = store.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    store.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getToken(): string | null {
  return ls()?.getItem(TOKEN_KEY) ?? null;
}

export function getCachedUser(): ApiUser | null {
  const raw = ls()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ApiUser;
  } catch {
    return null;
  }
}

function persistAuth(token: string, user: ApiUser): void {
  const store = ls();
  if (!store) return;
  store.setItem(TOKEN_KEY, token);
  store.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  const store = ls();
  if (!store) return;
  store.removeItem(TOKEN_KEY);
  store.removeItem(USER_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  try {
    const token = getToken();
    const res = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // 백엔드 미배포·오프라인 — 로컬 전용 모드로 계속 동작한다
    return null;
  }
}

export type RegisterResult = { user: ApiUser | null; error?: string };

/**
 * 계정 만들기. 실패 사유를 함께 돌려준다 — 금칙어 판정은 서버에만 있어서
 * (목록을 번들에 싣지 않으려고) 사용자에게 이유를 알리려면 응답을 봐야 한다.
 */
export async function register(
  nickname: string,
  avatar = 'cat',
  gradeBand?: string
): Promise<RegisterResult> {
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), nickname, avatar, gradeBand }),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; token: string; user: ApiUser; error?: string }
      | null;
    if (!res.ok || !body?.ok) return { user: null, error: body?.error };
    persistAuth(body.token, body.user);
    return { user: body.user };
  } catch {
    // 백엔드 미배포·오프라인 — 로컬 전용 모드로 계속 동작한다
    return { user: null };
  }
}

/** 이미 등록된 기기라면 조용히 세션을 복구한다. */
export async function restoreSession(): Promise<ApiUser | null> {
  const res = await request<{ ok: boolean; token: string; user: ApiUser }>('/api/register', {
    method: 'POST',
    body: JSON.stringify({ deviceId: getDeviceId() }),
  });
  if (!res?.ok) return null;
  persistAuth(res.token, res.user);
  return res.user;
}

import type { TextFingerprint } from '@/lib/typing/text-fingerprint';

export interface SubmitInput {
  mode: string;
  language?: string;
  kpm: number;
  accuracy: number;
  score?: number;
  maxCombo?: number;
  elapsedMs: number;
  totalKeystrokes: number;
  correctKeystrokes: number;
  textHash?: string;
  intervals?: number[];
  /** 친 «지문»의 되돌릴 수 없는 요약 — 서버가 «무엇을 쳤는가»를 보는 유일한 창구 */
  text?: TextFingerprint;
}

export interface WalletState {
  coins: number;
  xp: number;
  level: number;
}

export async function submitScore(
  input: SubmitInput
): Promise<{ status: string; wallet: WalletState | null } | null> {
  if (!getToken()) return null;

  const challenge = await request<{ ok: boolean; nonce: string }>('/api/challenge', {
    method: 'POST',
    body: JSON.stringify({ mode: input.mode }),
  });
  if (!challenge?.ok) return null;

  return request<{ ok: boolean; status: string; wallet: WalletState | null }>('/api/scores', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      // 서버가 통계 분석에 쓰는 구간만 전송 (상한 2000)
      intervals: input.intervals?.slice(0, 2000),
      nonce: challenge.nonce,
    }),
  });
}

export interface GhostRun {
  nickname: string;
  wpm: number;
}

/**
 * 고스트 레이스 상대 목록(익명 닉네임 + WPM).
 * 순위와 달리 신규·미검증 기록도 포함해 소규모 유저풀에서도 실제 사람과 대결하게 한다.
 * 토큰 불필요(공개 GET). 실패 시 null → 호출부에서 순위/합성 AI로 폴백.
 */
export async function fetchRaceGhosts(language?: string): Promise<GhostRun[] | null> {
  const params = new URLSearchParams({ mode: 'game:race' });
  if (language) params.set('lang', language);
  const res = await request<{ ok: boolean; ghosts: GhostRun[] }>(
    `/api/ghosts?${params.toString()}`
  );
  return res?.ok ? res.ghosts : null;
}

export async function fetchLeaderboard(
  mode = 'speed',
  period: 'daily' | 'weekly' | 'monthly' | 'all' = 'weekly',
  grade?: string
): Promise<LeaderboardEntry[] | null> {
  const params = new URLSearchParams({ mode, period });
  if (grade) params.set('grade', grade);
  const res = await request<{ ok: boolean; entries: LeaderboardEntry[] }>(
    `/api/leaderboard?${params.toString()}`
  );
  return res?.ok ? res.entries : null;
}

/**
 * 게임 점수 제출 — 순위 전용.
 * 서버는 game:* 모드에 지갑/리그 XP를 지급하지 않고 game 리더보드 순위만 매긴다.
 * 토큰(계정)이 없으면 submitScore가 조용히 무시한다(로컬 전용 모드).
 */
export async function submitGameScore(
  game: string,
  score: number,
  elapsedMs: number,
  language = 'ko'
): Promise<void> {
  if (!getToken()) return;
  if (!Number.isFinite(score) || score <= 0) return;
  if (elapsedMs < 3000) return; // 서버 MIN_ELAPSED_MS와 동일 — 너무 짧은 세션은 거부됨
  await submitScore({
    mode: `game:${game}`,
    language,
    kpm: 0,
    accuracy: 0,
    score: Math.round(score),
    maxCombo: 0,
    elapsedMs: Math.round(elapsedMs),
    totalKeystrokes: 0,
    correctKeystrokes: 0,
  });
}

export interface MyRank {
  ranked: boolean;
  rank?: number;
  total?: number;
  value?: number;
}

/** 요청자 본인의 전국 순위 (인증 필요). ranked=false면 아직 집계 전. */
export async function fetchMyRank(
  mode = 'speed',
  period: 'daily' | 'weekly' | 'monthly' | 'all' = 'weekly'
): Promise<MyRank | null> {
  if (!getToken()) return null;
  const res = await request<{ ok: boolean; ranked: boolean; rank?: number; total?: number; value?: number }>(
    `/api/my-rank?mode=${encodeURIComponent(mode)}&period=${period}`
  );
  if (!res?.ok) return null;
  return { ranked: res.ranked, rank: res.rank, total: res.total, value: res.value };
}

export interface LeagueMemberEntry {
  rank: number;
  nickname: string;
  avatar: string;
  xp: number;
  isMe: boolean;
}

export interface LeagueState {
  weekKey: string;
  tier: number;
  bucket: number | null;
  bucketSize: number;
  rank: number | null;
  xpEarned: number;
  promoteLine: number;
  demoteLine: number | null;
  members: LeagueMemberEntry[];
  lastWeek: {
    weekKey: string;
    tier: number;
    rank: number | null;
    outcome: 'promoted' | 'demoted' | 'stayed' | null;
    coins: number;
  } | null;
}

/** 서버 리그 현황. 백엔드 미배포·미등록이면 null(로컬 추정으로 대체). */
export async function fetchLeague(): Promise<LeagueState | null> {
  if (!getToken()) return null;
  const res = await request<{ ok: boolean } & LeagueState>('/api/league');
  return res?.ok ? res : null;
}

/** 지문 변조 탐지를 위한 해시(서버가 대조) */
export async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
