-- TypingVerse D1 schema (Cloudflare D1 / SQLite)
-- 적용: npx wrangler d1 execute typingverse --file=./schema.sql
--
-- 설계 원칙
--  * 익명 우선: 이메일·실명·생년월일을 저장하지 않는다.
--  * 재화(코인/XP)는 서버 원장이 진실원이며 모든 변경은 ledger에 남는다.
--  * 점수는 검증 상태를 갖고, 미검증 점수는 순위에 반영하지 않는다.

PRAGMA foreign_keys = ON;

-- 사용자 (익명)
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,           -- 서버 발급 uid (deviceId와 분리)
  nickname      TEXT NOT NULL,
  avatar        TEXT NOT NULL DEFAULT 'cat',
  grade_band    TEXT,                       -- 'elem' | 'middle' | 'high' | 'adult' (자기신고, 선택)
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  -- 신규 계정은 일정 활동량 전까지 순위 미반영 (Sybil 완화)
  provisional   INTEGER NOT NULL DEFAULT 1,
  banned        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users (nickname);

-- 기기 바인딩: 하나의 계정에 여러 기기가 붙을 수 있다(전학 코드 이관).
CREATE TABLE IF NOT EXISTS devices (
  device_hash  TEXT PRIMARY KEY,            -- deviceId의 HMAC (원문 저장 안 함)
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices (user_id);

-- 점수 제출
CREATE TABLE IF NOT EXISTS scores (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL,              -- 'speed' | 'accuracy' | 'game:rain' ...
  language      TEXT NOT NULL DEFAULT 'ko',
  kpm           REAL NOT NULL,
  accuracy      REAL NOT NULL,
  score         INTEGER NOT NULL DEFAULT 0, -- 게임 모드용
  elapsed_ms    INTEGER NOT NULL,
  text_hash     TEXT,                       -- 제시문 변조 탐지용
  text_version  TEXT,                       -- 콘텐츠 팩 버전
  nonce         TEXT NOT NULL,              -- 챌린지 nonce (재제출 차단)
  verify_status TEXT NOT NULL DEFAULT 'pending', -- 'ok' | 'pending' | 'rejected'
  hold_reason   TEXT,
  day_key       TEXT NOT NULL,              -- YYYY-MM-DD (KST) — 일간 순위 집계용
  week_key      TEXT NOT NULL,              -- YYYY-Www (KST)
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_nonce ON scores (nonce);
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (mode, verify_status, kpm DESC);
CREATE INDEX IF NOT EXISTS idx_scores_daily ON scores (mode, day_key, verify_status, kpm DESC);
-- 주간 순위(기본 period)가 day_key 색인처럼 주 단위로 안 묶여 mode+verify_status 전체(모든 주)를
-- 훑었다 — leaderboard/my-rank 기본값이라 daily보다 더 자주 맞는다. week_key 로 주 단위 경계.
CREATE INDEX IF NOT EXISTS idx_scores_weekly ON scores (mode, week_key, verify_status, kpm DESC);
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores (user_id, created_at DESC);

-- 발급된 챌린지 (nonce 선발급 → 제출 시 대조)
CREATE TABLE IF NOT EXISTS challenges (
  nonce      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode       TEXT NOT NULL,
  issued_at  INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_challenges_issued ON challenges (issued_at);

-- 재화 원장: 잔액 + 거래 내역 (financial-saas 안전망)
CREATE TABLE IF NOT EXISTS wallets (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coins    INTEGER NOT NULL DEFAULT 0,
  xp       INTEGER NOT NULL DEFAULT 0,
  level    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,            -- 'earn' | 'spend'
  currency        TEXT NOT NULL,            -- 'coins' | 'xp'
  amount          INTEGER NOT NULL,         -- 항상 증분(절대값 덮어쓰기 금지)
  description     TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wtx_idem ON wallet_transactions (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_wtx_user ON wallet_transactions (user_id, created_at DESC);

-- 리그 (주간 30명 버킷)
--
-- final_rank/outcome은 주간 정산 잡이 채운다. outcome IS NULL = 아직 미정산이며,
-- 정산은 이 조건으로만 갱신하므로 잡을 여러 번 돌려도 승강이 중복되지 않는다.
-- (컬럼명이 rank가 아닌 이유: RANK는 SQLite 윈도우 함수 키워드라 인용부호가 필요해진다)
CREATE TABLE IF NOT EXISTS league_members (
  week_key   TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier       INTEGER NOT NULL DEFAULT 0,    -- 0=브론즈 … 4=챌린저
  bucket     INTEGER NOT NULL,
  xp_earned  INTEGER NOT NULL DEFAULT 0,
  final_rank INTEGER,                       -- 정산 후 버킷 내 순위(1부터)
  outcome    TEXT,                          -- 'promoted' | 'demoted' | 'stayed' (NULL=미정산)
  settled_at INTEGER,
  PRIMARY KEY (week_key, user_id)
);
CREATE INDEX IF NOT EXISTS idx_league_bucket ON league_members (week_key, tier, bucket, xp_earned DESC);
-- 정산 잡이 "아직 안 끝난 버킷"만 골라내는 경로
CREATE INDEX IF NOT EXISTS idx_league_unsettled ON league_members (week_key, outcome, tier, bucket);

-- 사용자별 현재 티어(주 경계를 넘어 이어진다).
-- updated_week가 단조 증가 조건이라, 같은 주 정산이 재실행돼도 티어가 두 번 오르지 않는다.
CREATE TABLE IF NOT EXISTS league_standings (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier         INTEGER NOT NULL DEFAULT 0,
  updated_week TEXT NOT NULL,               -- 이 티어를 확정한 주 (YYYY-Www)
  last_rank    INTEGER,
  last_outcome TEXT
);

-- 주간 정산 실행 원장 (중복 실행 방지 + 운영 가시성)
CREATE TABLE IF NOT EXISTS league_settlements (
  week_key   TEXT PRIMARY KEY,
  status     TEXT NOT NULL,                 -- 'running' | 'done'
  started_at INTEGER NOT NULL,
  settled_at INTEGER,
  members    INTEGER NOT NULL DEFAULT 0,
  promoted   INTEGER NOT NULL DEFAULT 0,
  demoted    INTEGER NOT NULL DEFAULT 0
);

-- 학급
CREATE TABLE IF NOT EXISTS classes (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  join_code    TEXT NOT NULL,
  owner_user   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_code ON classes (join_code);

CREATE TABLE IF NOT EXISTS class_members (
  class_id  TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_class_members_user ON class_members (user_id);

-- 계정 이관용 1회성 코드 (해시로만 저장, 24h 만료)
CREATE TABLE IF NOT EXISTS transfer_codes (
  code_hash   TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     INTEGER
);
-- 발급 시 "미사용 코드 무효화" DELETE WHERE user_id=? 전체 훑기 방지(FK 자식열 색인).
CREATE INDEX IF NOT EXISTS idx_transfer_codes_user ON transfer_codes (user_id);
