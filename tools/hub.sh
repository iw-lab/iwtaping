#!/usr/bin/env bash
# 학교 허브(daum 계정) 배포·명령 — 로그인 이메일이 daum 이 아니면 멈춘다(계정이 조용히 바뀌는 사고 — 메모리 wrangler-login-switches-accounts-silently).
# 사용: tools/hub.sh deploy | tools/hub.sh <wrangler 인자…>
set -euo pipefail
cd "$(dirname "$0")/../hub"
H="$HOME/.cf-homes/daum"; [ -d "$H" ] && export HOME="$H"
who=$(npx wrangler whoami 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -o 'email [^ ]*' | head -1 | cut -d' ' -f2 | sed 's/\.$//')
[ "$who" = "simssijjang@daum.net" ] || { echo "❌ 허브는 daum 계정 전용 — 지금 로그인: ${who:-없음}"; exit 3; }
if [ "${1:-}" = deploy ]; then exec npx wrangler deploy; fi
exec npx wrangler "$@"
