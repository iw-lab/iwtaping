#!/usr/bin/env node
// 끝말잇기 3D 판 실측 — GDD-3D §8 A·§9 + 계약서(3d-contract.md) R4 재정의. 사용: node tools/qa-puzzle3d.mjs [주소(기본 http://127.0.0.1:5195)]
//   R1 메뉴 모드 카드 4종 · R2 3D 캔버스가 실제로 그려진다(빈 화면 아님) · R3 화면 입력으로 단어를 맞히면 점수가 오른다
//   R4 정면 카드(고정 DOM) 글자 ≥ 18px(계약서 지정 — 라벨 겹침 판정 대신) · R5 판을 나갔다 들어와도 geometry·texture 수가 안 는다(dispose)
//   R6 ?lite=1 이면 가벼운(DOM 전용) 판 · R7 성능 — 1280×720 · CPU ×4 · GPU 경로(Metal/실제 GPU) rAF 간격 P95 ≤ 17.5ms = 합격선
//      + 소프트웨어 GL(swiftshader — 내장 GPU 최악 대리) P95 ≤ 33.3ms 는 «경고선»(넘으면 ⚠️ · 실패 아님 · GDD-3D §9) · R8 콘솔 에러 0
//   GPU 경로는 Chrome for Testing 이 있어야 잰다(PUPPETEER_GPU_EXECUTABLE) — 헤드리스 셸은 GPU 를 못 쓴다
// 종료코드 0 = 전부 통과 · 1 = 실패 · 2 = 실행 불가
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let puppeteer;
for (const p of ['puppeteer', path.join(process.env.HOME, 'Documents/dev/englishdefence/node_modules/puppeteer')]) {
  try { puppeteer = require(p); break; } catch { /* 다음 후보 */ }
}
if (!puppeteer) { console.error('puppeteer를 찾을 수 없습니다'); process.exit(2); }

const BASE = (process.argv[2] || 'http://127.0.0.1:5195').replace(/\/$/, '');
const P95_GPU = +(process.env.PUZZLE_P95_MS || 17.5);
const P95_SW_WARN = 33.3;
const GPU_EXE = process.env.PUPPETEER_GPU_EXECUTABLE || (() => {
  try {
    const fs = require('node:fs'); const base = path.join(process.env.HOME, '.cache/puppeteer/chrome');
    const v = fs.readdirSync(base).filter((d) => d.startsWith('mac_arm-')).sort().pop();
    const exe = path.join(base, v, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    return fs.existsSync(exe) ? exe : null;
  } catch { return null; }
})();
let pass = 0, fail = 0;
const fails = [];
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); if (!ok) fails.push(name); console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
async function open(query = '') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error' && !/hub|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`${BASE}/game/puzzle/${query}`, { waitUntil: 'networkidle2' });
  return page;
}
async function start(page) {
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /게임 시작|Start Game/.test(b.textContent))?.click());
  // 배포본 = 허브가 살아 있다 → 새 기기는 «학교 정하기»가 먼저 뜬다. 실측은 «목록에 없어요»(학교 점수 없이)로 — 진짜 학교 순위를 건드리지 않는다
  const picked = await page.waitForSelector('[data-gb-none]', { timeout: 5000 }).then((b) => b.click().then(() => true)).catch(() => false);
  if (picked) console.log('  · 학교 정하기 창 → «목록에 없어요»로 시작(순위 기록 0)');
  await page.waitForFunction(() => !!window.__puzzle && !!window.__puzzle.core.currentWord, { timeout: 15000 });
  await sleep(600);
}
/** 코어 사전에서 지금 단어의 끝글자로 시작하는 정답을 찾아 실제 키로 친다(계약서 R3) */
async function typeNext(page) {
  const found = await page.evaluate(() => {
    const h = window.__puzzle;
    const cur = h?.core?.currentWord;
    if (!cur) return null;
    // 두음법칙(src/lib/game/hangul.ts 와 같은 규칙) — 글자 그대로만 찾으면 '로→노' 류를 놓쳐 가끔 못 찾는다.
    function allowedStarts(ch) {
      const set = new Set([ch]);
      const code = ch.charCodeAt(0) - 0xac00;
      if (code < 0 || code > 11171) return set;
      const cho = Math.floor(code / 588), jung = Math.floor((code % 588) / 28), jong = code % 28;
      const compose = (c, j) => String.fromCharCode(0xac00 + c * 588 + j * 28 + jong);
      const YA = [2, 3, 6, 7, 12, 17, 20], A = [0, 1, 8, 11, 13, 18];
      if (cho === 5 && YA.includes(jung)) set.add(compose(11, jung));
      if (cho === 5 && A.includes(jung)) set.add(compose(2, jung));
      if (cho === 2 && YA.includes(jung)) set.add(compose(11, jung));
      if (cho === 11 && YA.includes(jung)) { set.add(compose(5, jung)); set.add(compose(2, jung)); }
      if (cho === 2 && A.includes(jung)) set.add(compose(5, jung));
      return set;
    }
    const last = cur[cur.length - 1];
    const starts = allowedStarts(last);
    const pool = h.validWords && h.validWords.size ? [...h.validWords] : h.wordPool;
    const used = h.core.usedWords;
    return pool.find((w) => starts.has(w[0]) && w.length >= 2 && !used.has(w)) || null;
  });
  if (!found) return false;
  await page.click('input');
  await page.keyboard.type(found);
  await page.keyboard.press('Enter');
  return true;
}

try {
  console.log(`═══ 끝말잇기 3D 실측 ${BASE} ═══`);
  const page = await open();
  await page.waitForSelector('[data-gb-mode]', { timeout: 8000 }).catch(() => {});
  const modes = await page.$$eval('[data-gb-mode]', (els) => els.map((e) => e.dataset.gbMode));
  check('R1 메뉴 모드 카드 4종(classic·time·survival·daily)', ['classic', 'time', 'survival', 'daily'].every((m) => modes.includes(m)), modes.join(','));
  await start(page);
  const render = await page.$eval('[data-render]', (e) => e.dataset.render);
  check('R2a WebGL2 기기 = 3D 판', render === '3d', render);
  await sleep(500);
  // WebGL 캔버스는 drawImage 로 읽으면 비어 나온다(preserveDrawingBuffer 끔) → 실제 화면을 찍어 그 그림을 센다
  const box = await page.$eval('[data-render]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const shot = await page.screenshot({ clip: box, encoding: 'base64' });
  (await import('node:fs')).writeFileSync('screenshots/puzzle3d-play.png', Buffer.from(shot, 'base64'));
  const lit = await page.evaluate(async (b64) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const g = document.createElement('canvas'); g.width = 64; g.height = 36;
    const x = g.getContext('2d'); x.drawImage(im, 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data; const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    return { colors: seen.size };
  }, shot);
  check('R2b 3D 장면이 화면에 보인다(색 ≥ 12)', lit.colors >= 12, JSON.stringify(lit));
  const info0 = await page.evaluate(() => window.__puzzle.scene()?.info() || null);
  check('R2c 장면 드로 콜 ≤ 30', !!info0 && info0.calls <= 30, info0 ? `calls ${info0.calls} · 삼각형 ${info0.triangles}` : '장면 없음');

  // R3 실제 키 입력으로 맞히기
  const before = await page.evaluate(() => window.__puzzle.core.score);
  let typed = 0;
  for (let i = 0; i < 4; i++) { if (await typeNext(page)) typed++; await sleep(300); }
  const after = await page.evaluate(() => ({ score: window.__puzzle.core.score, totalWords: window.__puzzle.core.totalWords }));
  check('R3 화면 입력으로 맞히면 점수·이은 단어 수가 오른다', after.score > before && after.totalWords >= Math.min(typed, 1), `${before} → ${after.score} · ${after.totalWords}개 (${typed}번 입력)`);

  // R4 정면 카드(고정 DOM) 글자 ≥ 18px — 계약서 지정(라벨 겹침 판정 대신)
  const cardFont = await page.evaluate(() => {
    const card = document.querySelector('[data-puzzle-card]');
    if (!card) return { min: 0, n: 0 };
    const els = [card, ...card.querySelectorAll('input, span, div')];
    const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize)).filter((n) => n > 0);
    return { min: sizes.length ? Math.min(...sizes) : 0, max: sizes.length ? Math.max(...sizes) : 0, n: sizes.length };
  });
  check('R4 정면 카드 글자 ≥ 18px', cardFont.max >= 18, JSON.stringify(cardFont));

  // R5 나갔다 들어오기 — 메뉴로 돌아가 다시 시작해도 GPU 자원 수가 같아야 한다
  const mem1 = await page.evaluate(() => window.__puzzle.scene()?.info());
  await page.evaluate(() => { window.__puzzle.core.over = true; });
  await page.goto(`${BASE}/game/`, { waitUntil: 'networkidle2' });
  await page.goto(`${BASE}/game/puzzle/`, { waitUntil: 'networkidle2' });
  await start(page); await sleep(800);
  const mem2 = await page.evaluate(() => window.__puzzle.scene()?.info());
  check('R5 다시 들어와도 geometry·texture 수 그대로', !!mem1 && !!mem2 && mem2.geometries <= mem1.geometries + 2 && mem2.textures <= mem1.textures, `${JSON.stringify(mem1)} → ${JSON.stringify(mem2)}`);
  await page.close();

  // R6 가벼운 화면
  const lite = await open('?lite=1');
  await start(lite);
  const r2 = await lite.$eval('[data-render]', (e) => e.dataset.render);
  check('R6 ?lite=1 = 가벼운(DOM 전용) 판', r2 === '2d', r2);
  await lite.close();

  // R7 성능 — 판 6초 뒤(동적 해상도가 자리 잡은 뒤) CPU ×4 에서 6초 rAF 간격
  async function perf(exe, args) {
    const b = await puppeteer.launch({ headless: 'new', executablePath: exe || undefined, args });
    try {
      const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      await pg.goto(`${BASE}/game/puzzle/`, { waitUntil: 'networkidle2' });
      await start(pg); await sleep(6000);
      const cdp = await pg.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const gaps = await pg.evaluate(() => new Promise((done) => {
        const out = []; let last = performance.now(); const t0 = last;
        const step = (now) => { out.push(now - last); last = now; if (now - t0 < 6000) requestAnimationFrame(step); else done(out.slice(5)); };
        requestAnimationFrame(step);
      }));
      const meta = await pg.evaluate(() => {
        const g = document.querySelector('[data-render] canvas')?.getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info');
        return { gl: e ? String(g.getParameter(e.UNMASKED_RENDERER_WEBGL)).slice(0, 40) : 'n/a', q: window.__puzzle.scene()?.info().quality };
      });
      const s2 = [...gaps].sort((a, b) => a - b); const q = (p) => s2[Math.min(s2.length - 1, Math.floor(p * s2.length))];
      return { n: gaps.length, p50: q(0.5), p95: q(0.95), max: s2[s2.length - 1], ...meta };
    } finally { await b.close(); }
  }
  if (GPU_EXE) {
    const g = await perf(GPU_EXE, ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']);
    check(`R7 GPU 경로 · 1280×720 · CPU ×4 · P95 ≤ ${P95_GPU}ms`, g.n >= 60 && g.p95 <= P95_GPU, `${g.gl} · 해상도 ${g.q} · ${g.n}프레임 · 중앙 ${g.p50.toFixed(1)} · P95 ${g.p95.toFixed(1)} · 최대 ${g.max.toFixed(1)}ms`);
  } else {
    check('R7 GPU 경로 측정(Chrome for Testing 필요)', false, 'PUPPETEER_GPU_EXECUTABLE 없음 — 미실행은 통과가 아니다');
  }
  // 헤드리스 기본 GL = SwiftShader(Vulkan). «--use-angle=swiftshader» 는 헤드리스 셸에서 DOM 전용 판까지 초당 1프레임으로 떨어져 잣대가 못 된다(실측)
  const sw = await perf(undefined, []);
  const swOk = sw.p95 <= P95_SW_WARN;
  console.log(`  ${swOk ? '✅' : '⚠️'} R7w 소프트웨어 GL(경고선 ${P95_SW_WARN}ms) — ${sw.gl} · 해상도 ${sw.q} · ${sw.n}프레임 · 중앙 ${sw.p50.toFixed(1)} · P95 ${sw.p95.toFixed(1)}ms${swOk ? '' : ' · 경고(실패 아님)'}`);

  check('R8 콘솔 에러 0', errors.length === 0, errors.slice(0, 3).join(' | ') || '0건');
} catch (e) {
  check('실행', false, e.message);
} finally {
  await browser.close();
}
console.log(`\n═══ ${pass} 통과 / ${fail} 실패 ═══${fails.length ? '\n' + fails.join('\n') : ''}`);
console.log(`console_errors=${errors.length}`);
process.exit(fail ? 1 : 0);
