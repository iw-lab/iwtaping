-- 무료 읽기 한도(D1 하루 500만 행) 보호.
-- schema.sql(신규 DB)에도 같은 색인을 넣어 뒀다 — 기존 DB에는 이 파일을 한 번 적용할 것.
--
--   npx wrangler d1 execute typingverse --file=./migrations/0002_transfer_codes_index.sql --remote

-- 1) transfer_codes 가 user_id 색인 없이 DELETE FROM transfer_codes WHERE user_id = ?1 AND used_at IS NULL 로 전체 훑기.
CREATE INDEX IF NOT EXISTS idx_transfer_codes_user ON transfer_codes (user_id);

-- 2) 주간 순위(leaderboard/my-rank 기본 period)가 day_key 색인처럼 주 단위로 안 묶여
--    mode+verify_status 전체(모든 주)를 훑었다 — daily보다 더 자주 맞는 기본값이라 더 급하다.
CREATE INDEX IF NOT EXISTS idx_scores_weekly ON scores (mode, week_key, verify_status, kpm DESC);
