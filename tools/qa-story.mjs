#!/usr/bin/env node
// 타비의 버스(이야기·성장) 실측 — 사용: node tools/qa-story.mjs [주소(기본 http://127.0.0.1:5190)]
//   S1 처음 기기 홈 = 프롤로그 창 · 얼굴 그림 · 건너뛰기   S2 건너뛰면 버스 카드(단계 이름·다음 목표 한 줄)
//   S3 판 결과(정확도 98%·단어 10개) → 별 3 → 홈에서 그 정류장 이야기   S4 앨범 = 본 이야기만 열림
//   S5 게임 화면에서는 이야기 창이 뜨지 않는다   S6 콘솔 에러 0
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let puppeteer;
for (const p of ['puppeteer', path.join(process.env.HOME, 'Documents/dev/englishdefence/node_modules/puppeteer')]) {
  try { puppeteer = require(p); break; } catch { /* 다음 후보 */ }
}
if (!puppeteer) { console.error('puppeteer를 찾을 수 없습니다'); process.exit(2); }
const BASE = (process.argv[2] || 'http://127.0.0.1:5190').replace(/\/$/, '');
let pass = 0, fail = 0; const errors = [];
const check = (n, ok, d = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new' });
try {
  console.log(`═══ 타비의 버스 실측 ${BASE} ═══`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/hub|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // 가입 안내창은 이 실측과 무관 — 닫아 둔 기기로 연다
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('typingverse-onboard-seen', '1'); } catch { /* */ } });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.gbs:not([hidden])', { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('.gbs img')].some((i) => !i.hidden && i.naturalWidth > 0), { timeout: 6000 }).catch(() => {});
  const pro = await page.evaluate(() => ({ open: !!document.querySelector('.gbs:not([hidden])'), face: [...document.querySelectorAll('.gbs img')].some((i) => !i.hidden && i.naturalWidth > 0), skip: [...document.querySelectorAll('.gbs button')].some((b) => /건너뛰기/.test(b.textContent)) }));
  check('S1 처음 기기 = 프롤로그 · 얼굴 · 건너뛰기', pro.open && pro.face && pro.skip, JSON.stringify(pro));
  await page.evaluate(() => [...document.querySelectorAll('.gbs button')].find((b) => /건너뛰기/.test(b.textContent))?.click());
  await sleep(800);
  const card = await page.evaluate(() => ({ text: document.querySelector('[data-story="bus"]')?.textContent || '', goal: document.querySelector('[data-story="goal"]')?.textContent || '', img: document.querySelector('[data-story="bus"] img')?.naturalWidth || 0 }));
  check('S2 버스 카드 · 단계 이름 · 다음 목표 · 버스 그림', /마을 버스/.test(card.text) && /별/.test(card.goal) && card.img > 0, `${card.goal} · 그림 ${card.img}px`);
  // S3 — 판 결과를 장부에 넣는 것과 같은 길(useGameResult)은 게임 실측이 잰다. 여기선 장부에 별 3을 넣고 홈 재방문
  await page.evaluate(() => { const b = JSON.parse(localStorage.getItem('typingverse:story.v1')); b.growth.xp += 3; b.growth.bond.rain = 3; localStorage.setItem('typingverse:story.v1', JSON.stringify(b)); });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.gbs:not([hidden])', { timeout: 8000 }).catch(() => {});
  const who = await page.evaluate(() => document.querySelector('.gbs')?.textContent || '');
  check('S3 정류장 별 3 → 홈에서 씨앗섬 이야기', /봄이/.test(who), who.slice(0, 40));
  await page.evaluate(() => [...document.querySelectorAll('.gbs button')].find((b) => /건너뛰기/.test(b.textContent))?.click());
  await sleep(600);
  await page.evaluate(() => [...document.querySelectorAll('[data-story="bus"] button')].find((b) => /앨범/.test(b.textContent))?.click());
  await sleep(300);
  const album = await page.evaluate(() => { const bs = [...document.querySelectorAll('[data-story="album"] button')]; return { open: bs.filter((b) => !b.disabled).length, locked: bs.filter((b) => b.disabled).length }; });
  check('S4 앨범 = 본 이야기 2개만 열림', album.open === 2 && album.locked >= 10, JSON.stringify(album));
  // S5 게임 화면 — 처음 기기라도 이야기 창 0
  const g = await browser.newPage();
  await g.goto(`${BASE}/game/rain/`, { waitUntil: 'networkidle2' });
  await g.evaluate(() => localStorage.removeItem('typingverse:story.v1'));
  await g.reload({ waitUntil: 'networkidle2' }); await sleep(1500);
  check('S5 게임 화면에서는 이야기 창이 안 뜬다', await g.evaluate(() => !document.querySelector('.gbs:not([hidden])')));
  check('S6 콘솔 에러 0', errors.length === 0, errors.slice(0, 2).join(' | ') || '0건');
} catch (e) { check('실행', false, e.message); } finally { await browser.close(); }
console.log(`\n═══ ${pass} 통과 / ${fail} 실패 ═══\nconsole_errors=${errors.length}`);
process.exit(fail ? 1 : 0);
