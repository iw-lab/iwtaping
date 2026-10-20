#!/usr/bin/env bash
# 배포본 전수 실측 — 게임 6종 3D·이야기·게임 메뉴 기본틀(학교 순위·관문). 전부 rc 0 이면 «LIVE-E2E PASS»를 적는다.
# 사용: tools/live-all.sh [주소] → docs/live-3d.log
set -u
cd "$(dirname "$0")/.."
U=${1:-https://typingverse.pages.dev}
export PUPPETEER_EXECUTABLE_PATH=${PUPPETEER_EXECUTABLE_PATH:-$(ls -d ~/.cache/puppeteer/chrome-headless-shell/mac_arm-*/chrome-headless-shell-mac-arm64/chrome-headless-shell | tail -1)}
L=docs/live-3d.log; bad=0; ce=0
echo "배포본 실측 $U $(date '+%F %T')" > $L
for g in rain space zombie defense race puzzle; do echo "== $g" >> $L; node tools/qa-${g}3d.mjs $U >> $L 2>&1 || bad=1; done
echo "== story" >> $L; node tools/qa-story.mjs $U >> $L 2>&1 || bad=1
for g in rain space zombie defense race puzzle; do echo "== baseline $g" >> $L; node ~/.claude/skills/game-builder/tools/gate-baseline.mjs . --url $U/game/$g/ --expect-hub >> $L 2>&1 || bad=1; done
ce=$(grep -h "^console_errors=" $L | awk -F= '{s+=$2} END {print s+0}')
if [ $bad = 0 ] && [ "$ce" = 0 ]; then printf 'LIVE-E2E PASS\nconsole_errors=0\n' >> $L; echo "✅ LIVE-E2E PASS"; else echo "❌ 실패 있음(console_errors=$ce) — $L"; exit 1; fi
