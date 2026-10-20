#!/usr/bin/env node
// 타이핑 레이스 3D 판 실측 — GDD-3D §8 A·§9. 사용: node tools/qa-race3d.mjs [주소(기본 http://127.0.0.1:5194)]
//   R1 메뉴 모드 카드 3종(classic·time·daily) · R2 3D 캔버스가 실제로 그려진다(빈 화면 아님) ·
//   R3 실제 키 입력으로 문장을 쳐서 내 차(플레이어)가 전진한다 ·
//   R4 하단 고정 문장 글자 ≥ 18px(차 위 라벨이 아니라 DOM 문장이라 24px 규칙 대신 18px) ·
//   R5 판을 나갔다 들어와도 geometry·texture 수가 안 는다(dispose) · R6 ?lite=1 이면 2D 판 ·
//   R7 성능 — 1280×720 · CPU ×4 · GPU 경로(Metal/실제 GPU) rAF 간격 P95 ≤ 17.5ms(60Hz 한 프레임 + vsync 흔들림) = 합격선
//      + 소프트웨어 GL(swiftshader — 내장 GPU 최악 대리) P95 ≤ 33.3ms 는 «경고선»(넘으면 ⚠️ · 실패 아님 · GDD-3D §9) · R8 콘솔 에러 0
// 종료코드 0 = 전부 통과 · 1 = 실패 · 2 = 실행 불가
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let puppeteer;
for (const p of ['puppeteer', path.join(process.env.HOME, 'Documents/dev/englishdefence/node_modules/puppeteer')]) {
  try { puppeteer = require(p); break; } catch { /* 다음 후보 */ }
}
if (!puppeteer) { console.error('puppeteer를 찾을 수 없습니다'); process.exit(2); }

const BASE = (process.argv[2] || 'http://127.0.0.1:5194').replace(/\/$/, '');
const P95_GPU = +(process.env.RACE_P95_MS || 17.5);
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
  await page.goto(`${BASE}/game/race/${query}`, { waitUntil: 'networkidle2' });
  return page;
}
async function start(page) {
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /레이스 시작|Start Race/.test(b.textContent))?.click());
  // 배포본 = 허브가 살아 있다 → 새 기기는 «학교 정하기»가 먼저 뜬다. 실측은 «목록에 없어요»(학교 점수 없이)로 — 진짜 학교 순위를 건드리지 않는다
  const picked = await page.waitForSelector('[data-gb-none]', { timeout: 5000 }).then((b) => b.click().then(() => true)).catch(() => false);
  if (picked) console.log('  · 학교 정하기 창 → «목록에 없어요»로 시작(순위 기록 0)');
  // 카운트다운(3→0) 뒤 레이스 상태에서 코어가 만들어진다
  await page.waitForFunction(() => !!window.__race, { timeout: 15000 });
  await page.waitForSelector('textarea', { timeout: 8000 }).catch(() => {});
  await sleep(500);
}
/** 화면(DOM)에 실제로 뜬 문장 — 차 위 라벨이 아니라 하단 고정 문장에서 읽는다 */
async function displayedText(page) {
  return page.evaluate(() => [...document.querySelectorAll('.typing-char')].map((e) => e.textContent).join(''));
}

try {
  console.log(`═══ 타이핑 레이스 3D 실측 ${BASE} ═══`);
  const page = await open();
  await page.waitForSelector('[data-gb-mode]', { timeout: 8000 }).catch(() => {});
  const modes = await page.$$eval('[data-gb-mode]', (els) => els.map((e) => e.dataset.gbMode));
  check('R1 메뉴 모드 카드 3종(classic·time·daily)', ['classic', 'time', 'daily'].every((m) => modes.includes(m)), modes.join(','));
  await start(page);
  const render = await page.$eval('[data-render]', (e) => e.dataset.render);
  check('R2a WebGL2 기기 = 3D 판', render === '3d', render);
  await sleep(800);
  // WebGL 캔버스는 drawImage 로 읽으면 비어 나온다(preserveDrawingBuffer 끔) → 실제 화면을 찍어 그 그림을 센다
  const box = await page.$eval('[data-render]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const shot = await page.screenshot({ clip: box, encoding: 'base64' });
  (await import('node:fs')).mkdirSync('screenshots', { recursive: true });
  (await import('node:fs')).writeFileSync('screenshots/race3d-play.png', Buffer.from(shot, 'base64'));
  const lit = await page.evaluate(async (b64) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const g = document.createElement('canvas'); g.width = 64; g.height = 36;
    const x = g.getContext('2d'); x.drawImage(im, 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data; const seen = new Set(); let green = 0;
    for (let i = 0; i < d.length; i += 4) { seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`); if (d[i + 1] > d[i] + 20 && d[i + 1] > d[i + 2]) green++; }
    return { colors: seen.size, green };
  }, shot);
  check('R2b 3D 장면이 화면에 보인다(색 ≥ 12 · 잔디 초록 칸 > 0)', lit.colors >= 12 && lit.green > 0, JSON.stringify(lit));
  const info0 = await page.evaluate(() => window.__race.scene()?.info() || null);
  check('R2c 장면 드로 콜 ≤ 30', !!info0 && info0.calls <= 30, info0 ? `calls ${info0.calls} · 삼각형 ${info0.triangles}` : '장면 없음');

  // R3 실제 키 입력으로 문장을 쳐서 내 차(플레이어)가 전진
  const sentence = await displayedText(page);
  check('R3 사전조건 — 하단 고정 문장이 떠 있다', sentence.length > 10, `${sentence.length}자`);
  const before = await page.evaluate(() => window.__race.core.cars.find((c) => c.isPlayer)?.progress ?? -1);
  await page.click('textarea');
  await page.keyboard.type(sentence.slice(0, Math.min(30, sentence.length)), { delay: 25 });
  await sleep(300);
  const after = await page.evaluate(() => window.__race.core.cars.find((c) => c.isPlayer)?.progress ?? -1);
  check('R3 화면 입력으로 문장을 치면 내 차 진행률이 오른다', after > before, `${before.toFixed?.(2) ?? before} → ${after.toFixed?.(2) ?? after}`);

  // R4 하단 고정 문장 글자 ≥ 18px(차 위 라벨 없음 — TypeRacer 관습, GDD-3D §2)
  const fontInfo = await page.evaluate(() => {
    const el = document.querySelector('.typing-char');
    if (!el) return null;
    const px = parseFloat(getComputedStyle(el).fontSize);
    return { px, n: document.querySelectorAll('.typing-char').length };
  });
  check('R4 하단 고정 문장 글자 ≥ 18px', !!fontInfo && fontInfo.px >= 18, fontInfo ? `${fontInfo.px}px · ${fontInfo.n}자` : '문장 DOM 없음');

  // R5 나갔다 들어오기 — 메뉴로 돌아가 다시 시작해도 GPU 자원 수가 같아야 한다
  const mem1 = await page.evaluate(() => window.__race.scene()?.info());
  await page.goto(`${BASE}/game/`, { waitUntil: 'networkidle2' });
  await page.goto(`${BASE}/game/race/`, { waitUntil: 'networkidle2' });
  await start(page); await sleep(1200);
  const mem2 = await page.evaluate(() => window.__race.scene()?.info());
  check('R5 다시 들어와도 geometry·texture 수 그대로', !!mem1 && !!mem2 && mem2.geometries <= mem1.geometries + 2 && mem2.textures <= mem1.textures, `${JSON.stringify(mem1)} → ${JSON.stringify(mem2)}`);
  await page.close();

  // R6 가벼운 화면
  const lite = await open('?lite=1');
  await start(lite);
  const r2 = await lite.$eval('[data-render]', (e) => e.dataset.render);
  check('R6 ?lite=1 = 2D 판', r2 === '2d', r2);
  await lite.close();

  // R7 성능 — 판 6초 뒤(동적 해상도가 자리 잡은 뒤) CPU ×4 에서 6초 rAF 간격
  async function perf(exe, args) {
    const b = await puppeteer.launch({ headless: 'new', executablePath: exe || undefined, args });
    try {
      const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      await pg.goto(`${BASE}/game/race/`, { waitUntil: 'networkidle2' });
      await start(pg); await sleep(6000);
      const cdp = await pg.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const gaps = await pg.evaluate(() => new Promise((done) => {
        const out = []; let last = performance.now(); const t0 = last;
        const step = (now) => { out.push(now - last); last = now; if (now - t0 < 6000) requestAnimationFrame(step); else done(out.slice(5)); };
        requestAnimationFrame(step);
      }));
      const meta = await pg.evaluate(() => {
        const g = document.querySelector('[data-render] canvas')?.getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info');
        return { gl: e ? String(g.getParameter(e.UNMASKED_RENDERER_WEBGL)).slice(0, 40) : 'n/a', q: window.__race.scene()?.info().quality };
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
