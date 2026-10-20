#!/usr/bin/env bash
# 사이트 배포(typingverse.pages.dev · naver 계정) — 빌드·시험이 초록일 때만 올린다.
# 옛 wrangler(4.83 = npx 기본)는 계정·로그인이 맞아도 Pages 배포가 «Authentication error 10000» 이라
# 새 wrangler(4.149) + naver 로그인 홈 + 계정 ID 를 함께 준다(메모리 wrangler-10000-is-old-cli · 2026-10-20 재발).
set -euo pipefail
cd "$(dirname "$0")/.."
WR="$HOME/Documents/dev/snake/worker/node_modules/.bin/wrangler"
[ -x "$WR" ] || { echo "❌ 새 wrangler 없음: $WR"; exit 3; }
npx vitest run >/dev/null && npm run build >/dev/null || { echo "❌ 시험·빌드 실패 — 배포 안 함"; exit 1; }
HOME="$HOME/Documents/dev/iwdraw/.cf-home" CLOUDFLARE_ACCOUNT_ID=4644562c4caa65bcd406fbbe6f104e59 \
  "$WR" pages deploy out --project-name typingverse --branch main --commit-dirty=true
