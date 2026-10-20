#!/usr/bin/env node
// 씨앗비 3D 판 실측 — GDD-3D §8 A·§9. 사용: node tools/qa-rain3d.mjs [주소(기본 http://127.0.0.1:5190)]
//   R1 메뉴 모드 카드 4종 · R2 3D 캔버스가 실제로 그려진다(빈 화면 아님) · R3 화면 입력으로 단어를 맞히면 점수가 오른다
//   R4 라벨 ≥ 12px·라벨 겹침 0 · R5 판을 나갔다 들어와도 geometry·texture 수가 안 는다(dispose) · R6 ?lite=1 이면 2D 판
//   R7 성능 — 1280×720 · CPU ×4 · GPU 경로(Metal/실제 GPU) rAF 간격 P95 ≤ 17.5ms(60Hz 한 프레임 + vsync 흔들림) = 합격선
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

const BASE = (process.argv[2] || 'http://127.0.0.1:5190').replace(/\/$/, '');
const P95_GPU = +(process.env.RAIN_P95_MS || 17.5);
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
  await page.goto(`${BASE}/game/rain/${query}`, { waitUntil: 'networkidle2' });
  return page;
}
async function start(page) {
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /게임 시작|Start Game/.test(b.textContent))?.click());
  // 배포본 = 허브가 살아 있다 → 새 기기는 «학교 정하기»가 먼저 뜬다. 실측은 «목록에 없어요»(학교 점수 없이)로 — 진짜 학교 순위를 건드리지 않는다
  const picked = await page.waitForSelector('[data-gb-none]', { timeout: 5000 }).then((b) => b.click().then(() => true)).catch(() => false);
  if (picked) console.log('  · 학교 정하기 창 → «목록에 없어요»로 시작(순위 기록 0)');
  await page.waitForFunction(() => !!window.__rain, { timeout: 15000 });
  await sleep(1200);
}
async function typeFirst(page) {
  const w = await page.evaluate(() => window.__rain.core.words[0]?.text || null);
  if (!w) return false;
  await page.click('input');
  await page.keyboard.type(w);
  await page.keyboard.press('Enter');
  return true;
}

try {
  console.log(`═══ 씨앗비 3D 실측 ${BASE} ═══`);
  const page = await open();
  await page.waitForSelector('[data-gb-mode]', { timeout: 8000 }).catch(() => {});
  const modes = await page.$$eval('[data-gb-mode]', (els) => els.map((e) => e.dataset.gbMode));
  check('R1 메뉴 모드 카드 4종(classic·time·survival·daily)', ['classic', 'time', 'survival', 'daily'].every((m) => modes.includes(m)), modes.join(','));
  await start(page);
  await page.waitForFunction(() => window.__rain.core.words.filter((w) => w.y > 120).length >= 2, { timeout: 30000 }).catch(() => {});
  const render = await page.$eval('[data-render]', (e) => e.dataset.render);
  check('R2a WebGL2 기기 = 3D 판', render === '3d', render);
  await sleep(800);
  // WebGL 캔버스는 drawImage 로 읽으면 비어 나온다(preserveDrawingBuffer 끔) → 실제 화면을 찍어 그 그림을 센다
  const box = await page.$eval('[data-render]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const shot = await page.screenshot({ clip: box, encoding: 'base64' });
  (await import('node:fs')).writeFileSync('screenshots/rain3d-play.png', Buffer.from(shot, 'base64'));
  const lit = await page.evaluate(async (b64) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const g = document.createElement('canvas'); g.width = 64; g.height = 36;
    const x = g.getContext('2d'); x.drawImage(im, 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data; const seen = new Set(); let green = 0;
    for (let i = 0; i < d.length; i += 4) { seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`); if (d[i + 1] > d[i] + 20 && d[i + 1] > d[i + 2]) green++; }
    return { colors: seen.size, green };
  }, shot);
  check('R2b 3D 장면이 화면에 보인다(색 ≥ 12 · 풀밭 초록 칸 > 0)', lit.colors >= 12 && lit.green > 0, JSON.stringify(lit));
  const info0 = await page.evaluate(() => window.__rain.scene()?.info() || null);
  check('R2c 장면 드로 콜 ≤ 30', !!info0 && info0.calls <= 30, info0 ? `calls ${info0.calls} · 삼각형 ${info0.triangles}` : '장면 없음');

  // R3 실제 키 입력으로 맞히기
  await page.waitForFunction(() => window.__rain.core.words.length > 0, { timeout: 8000 });
  const before = await page.evaluate(() => window.__rain.core.score);
  let typed = 0;
  for (let i = 0; i < 4; i++) { if (await typeFirst(page)) typed++; await sleep(350); }
  const after = await page.evaluate(() => ({ score: window.__rain.core.score, kills: window.__rain.core.kills }));
  check('R3 화면 입력으로 맞히면 점수·심은 씨앗이 오른다', after.score > before && after.kills >= Math.min(typed, 1), `${before} → ${after.score} · ${after.kills}개`);

  // R4 라벨 크기·겹침 — 코어 단어 위치와 라벨 폭으로 판정(그리는 함수와 같은 규칙)
  await sleep(1500);
  // 실제로 그린 라벨 사각형(페이지가 매 프레임 남긴다) — 작은 쪽 넓이의 15% 넘게 겹치면 겹침(비켜 서는 중의 스침은 봐준다)
  // 3초 동안 20번 본다 — 비켜 서는 중(easeLabelShift) 한두 프레임 스침은 봐주고, 겹친 채 머무는 것만 잡는다(겹친 표본 ≤ 10%)
  const lab = await page.evaluate(async () => {
    const one = () => {
      const rs = window.__rainLabels || []; let overlap = 0;
      for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (ix * iy > 0.15 * Math.min(a.w * a.h, b.w * b.h)) overlap++;
      }
      return { n: rs.length, overlap, minH: rs.length ? Math.min(...rs.map((r) => r.h)) : 99 };
    };
    let bad = 0, n = 0, minH = 99, maxN = 0;
    for (let k = 0; k < 20; k++) { const r = one(); if (r.overlap) bad++; n++; minH = Math.min(minH, r.minH); maxN = Math.max(maxN, r.n); await new Promise((res) => setTimeout(res, 150)); }
    return { n: maxN, overlap: bad / n > 0.1 ? bad : 0, bad, samples: n, minH };
  });
  check('R4 라벨끼리 겹친 채 머무름 0(표본 20 중 겹침 ≤10%)', lab.overlap === 0, `최대 ${lab.n}개 · 겹친 표본 ${lab.bad}/${lab.samples} · 라벨 높이 최소 ${lab.minH}px`);

  // R5 나갔다 들어오기 — 메뉴로 돌아가 다시 시작해도 GPU 자원 수가 같아야 한다
  const mem1 = await page.evaluate(() => window.__rain.scene()?.info());
  await page.evaluate(() => { window.__rain.core.over = true; });
  await page.goto(`${BASE}/game/`, { waitUntil: 'networkidle2' });
  await page.goto(`${BASE}/game/rain/`, { waitUntil: 'networkidle2' });
  await start(page); await sleep(1500);
  const mem2 = await page.evaluate(() => window.__rain.scene()?.info());
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
      await pg.goto(`${BASE}/game/rain/`, { waitUntil: 'networkidle2' });
      await start(pg); await sleep(6000);
      const cdp = await pg.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const gaps = await pg.evaluate(() => new Promise((done) => {
        const out = []; let last = performance.now(); const t0 = last;
        const step = (now) => { out.push(now - last); last = now; if (now - t0 < 6000) requestAnimationFrame(step); else done(out.slice(5)); };
        requestAnimationFrame(step);
      }));
      const meta = await pg.evaluate(() => {
        const g = document.querySelector('[data-render] canvas')?.getContext('webgl2'); const e = g?.getExtension('WEBGL_debug_renderer_info');
        return { gl: e ? String(g.getParameter(e.UNMASKED_RENDERER_WEBGL)).slice(0, 40) : 'n/a', q: window.__rain.scene()?.info().quality };
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
  // 헤드리스 기본 GL = SwiftShader(Vulkan). «--use-angle=swiftshader» 는 헤드리스 셸에서 2D 판까지 초당 1프레임으로 떨어져 잣대가 못 된다(실측)
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
