// @gb-story v1 — 장르 무관 «얼굴 + 대사» 이야기 층. 퀴즈·액션·탐험 게임 사이사이에 짧은 장면(비트)을 끼운다.
// 정본 = ~/.claude/skills/game-builder/kit/story/story.js — 게임마다 복사해 쓴다(내용 수정 금지 · 고칠 건 키트에서).
// 🔒 tools/check-story.mjs 가 대본(story.json)·초상화 파일·표정 수·대사 길이·도달 가능성·성장(growth.js) 배선을 잰다.
// 왜: 호박불 마을이 «이동하고 문제만 푸는» 게임이 됐다 — 얼굴·대사·이야기·성장이 없었다(2026-10-19 사용자
//     «일러스트와 대사가 나오는 성장형 시뮬레이션 같은 얼굴 나오고 스토리텔링 같은 게 약해 … 게임 빌더 스킬 강화»).
//
// 🎨 kit/story/story.css 를 게임 스타일시트 끝에 붙인다(표식 @gb-story-css — CSP 때문에 JS 가 <style> 을 넣지 않는다).
//   import { createStory, beatsDue } from './story/story.js';
//   const ST = createStory({ host: document.body, script, portrait: (who, ex) => `/assets/portraits/${who}_${ex}.webp`, sfx: (n) => play(n), T: (s) => s });
//   await ST.play('prologue', { name: '나' });       // 장면 끝(또는 건너뛰기)에 풀린다 · 반환 = { skipped, set: {선택지가 바꾼 값} }
//   for (const id of beatsDue(script, state)) await ST.play(id);   // 문턱을 넘은 비트(관계 단계·밤 클리어 등)
//
// 대본(story.json) — 데이터 1벌. 화면 글자는 전부 여기서 나온다(검사기가 읽는다):
//   { "meta": { "maxChars": 46 },                              // 한 말풍선 글자 상한(저학년 ≤40 권장)
//     "cast": { "kkam": { "name": "깜빡이", "side": "left", "color": "#ffe27a", "exprs": ["base","happy","worry","surprise"] } },
//     "scenes": { "prologue": [
//        { "who": "kkam", "ex": "worry", "say": "큰일 났어! 등불이 다 꺼졌어." },
//        { "narr": "바람이 휘잉 불었다." },                     // 해설(얼굴 없음)
//        { "choice": [ { "text": "내가 켤게!", "set": { "brave": 1 } }, { "text": "무서운데…", "goto": "prologue_shy" } ] },
//        { "event": "lanternOff" } ] },                         // 게임에 알림(onEvent) — 연출 끼우기
//     "beats": [ { "id": "prologue", "when": { "first": 1 } },  // when = state 의 수치가 «그 값 이상»이면 열림(모두 만족)
//                { "id": "owl_bond2", "when": { "bond.h_owl": 2 } }, { "id": "finale", "when": { "nightsCleared": 3 }, "ending": true } ] }
// 대사 안 {name} 은 play(id, vars) 의 값으로 바뀐다.
//
// 연출 계약(조사 100+편에서 뽑은 관습 — references/story-and-growth.md):
//   말하는 쪽 밝게·듣는 쪽 어둡게 · 이름표 · 타자 효과(누르면 한 줄 다 보이고, 다시 누르면 다음) · 길게 누르기 = 빨리 넘김
//   · «건너뛰기» 항상(효과(set)는 그대로 적용) · «지난 대사» 로그 · 키보드 Enter/Space = 다음 · Esc = 건너뛰기
//   · 대사창은 화면 아래 ≤ 2줄 · 선택지는 2~3개 · 장면이 끝나면 게임으로 바로(«확인» 단추 없음)

export const STORY_VERSION = 1;

/** 수치 문턱 판정 — when 의 모든 키가 state 에서 «그 값 이상»이어야 열린다. 키 «a.b» = state.a.b */
export function getPath(state, key) { return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), state); }
export function whenMet(when, state) {
  for (const [k, need] of Object.entries(when || {})) { const v = Number(getPath(state, k) ?? 0); if (!(v >= Number(need))) return false; }
  return true;
}
/** 지금 열렸고 아직 안 본 비트(대본 순서대로) — state.storySeen = { id: 1 } */
export function beatsDue(script, state) {
  const seen = state.storySeen || {};
  return (script.beats || []).filter((b) => !seen[b.id] && whenMet(b.when, state)).map((b) => b.id);
}
/** 장면 줄(선택지의 goto 는 고른 뒤에 이어 붙인다) */
export function flatten(script, id) { return Array.isArray(script.scenes?.[id]) ? script.scenes[id] : []; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : `{${k}}`));

export function createStory({ host = document.body, script, portrait, sfx = () => {}, onEvent = () => {}, T = (s) => s, typeMs = 28, reduceMotion = () => false } = {}) {
  let busy = false; const log = [];
  const el = document.createElement('div'); el.className = 'gbs'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="gbs-dim"></div><div class="gbs-stage"><img class="gbs-face left" alt="" draggable="false"><img class="gbs-face right" alt="" draggable="false"></div>
    <div class="gbs-box" aria-live="polite"><div class="gbs-name"></div><div class="gbs-text"></div><div class="gbs-choices"></div><div class="gbs-next" aria-hidden="true"></div></div>
    <div class="gbs-tools"><button type="button" class="gbs-btn" data-gbs="log">지난 대사</button><button type="button" class="gbs-btn" data-gbs="skip">건너뛰기</button></div>
    <div class="gbs-log" hidden><div class="gbs-log-in"></div><button type="button" class="gbs-btn" data-gbs="logclose">닫기</button></div>`;
  host.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const faces = { left: $('.gbs-face.left'), right: $('.gbs-face.right') };
  /* 진행 상태 — 한 번에 한 장면. onTap = 지금 «누르면 할 일»(타자 완성 또는 다음 줄) · 타이머는 전부 여기서 끈다 */
  let onTap = null, skipNow = null, abortNow = null, typing = null, fastT = 0, holdT = 0;
  const clearT = () => { clearInterval(typing); typing = null; clearTimeout(fastT); fastT = 0; };
  const inUi = (t) => t.closest?.('.gbs-tools,.gbs-log,.gbs-choices');
  const advance = () => { if (!$('.gbs-log').hidden) return; onTap?.(); };
  el.addEventListener('pointerup', (e) => { if (!inUi(e.target)) advance(); });
  el.addEventListener('pointerdown', (e) => { if (inUi(e.target)) return; clearTimeout(holdT); holdT = setTimeout(() => el.classList.add('fast'), 450); });
  const upAll = () => { clearTimeout(holdT); el.classList.remove('fast'); };
  addEventListener('pointerup', upAll); addEventListener('pointercancel', upAll);
  /* 대화창이 떠 있는 동안 키는 뒤 게임으로 새지 않는다 · 버튼(선택지·도구)에 포커스면 그 버튼의 기본 동작 · Esc = 로그 닫기 → 건너뛰기 */
  const key = (e) => {
    if (el.hidden) return; e.stopImmediatePropagation();
    if (e.key === 'Escape') { e.preventDefault(); if (!$('.gbs-log').hidden) $('.gbs-log').hidden = true; else skipNow?.(); return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const a = document.activeElement; if ((a && a.tagName === 'BUTTON' && el.contains(a)) || $('.gbs-choices').childElementCount) return;
    e.preventDefault(); advance();
  };
  addEventListener('keydown', key, true);
  $('[data-gbs="skip"]').addEventListener('click', () => skipNow?.());
  $('[data-gbs="log"]').addEventListener('click', () => { $('.gbs-log-in').innerHTML = log.slice(-40).map((l) => `<p>${l.who ? `<b>${esc(l.who)}</b> ` : ''}${esc(l.say)}</p>`).join('') || '<p>아직 대사가 없어요</p>'; $('.gbs-log').hidden = false; });
  $('[data-gbs="logclose"]').addEventListener('click', () => { $('.gbs-log').hidden = true; });

  function showFace(c, ex, side) {
    for (const s of ['left', 'right']) faces[s].classList.toggle('speaking', s === side);
    if (!c) return; const f = faces[side]; const url = portrait(c.id, ex || 'base');
    if (f.dataset.src !== url) { f.dataset.src = url; f.src = url; f.classList.remove('pop'); void f.offsetWidth; f.classList.add('pop'); }
    f.hidden = false; f.dataset.who = c.id; f.dataset.ex = ex || 'base';
  }
  function type(text) {
    return new Promise((res) => {
      const t = $('.gbs-text'); t.textContent = ''; let i = 0, fin = false; const chars = [...text];
      const done = () => { if (fin) return; fin = true; clearInterval(typing); typing = null; if (onTap === done) onTap = null; t.textContent = text; el.classList.add('ready'); res(); };
      el.classList.remove('ready'); onTap = done;
      if (reduceMotion() || el.classList.contains('fast')) { done(); return; }
      typing = setInterval(() => { if (el.classList.contains('fast')) return done(); i += 1; t.textContent = chars.slice(0, i).join(''); if (i % 3 === 1) sfx('blip'); if (i >= chars.length) done(); }, typeMs);
    });
  }
  /* 다음 줄 기다리기 — 길게 누르는 중이면 70ms 뒤 저절로. 옛 타이머는 «내 차례»가 아니면 아무것도 안 한다 */
  const waitTap = () => new Promise((res) => { const go = () => { if (onTap !== go) return; onTap = null; clearTimeout(fastT); fastT = 0; sfx('next'); res(); }; onTap = go; if (el.classList.contains('fast')) fastT = setTimeout(go, 70); });
  /** 남은 줄의 효과(set·event) — 선택지는 첫째(기본) 갈래와 그 goto 장면까지 */
  function applyRest(list, from, set) {
    const q = list.slice(from); let guard = 0;
    while (q.length && guard++ < 500) { const L = q.shift();
      if (L.choice) { const o = L.choice[0]; if (o?.set) Object.assign(set, o.set); if (o?.goto) q.unshift(...flatten(script, o.goto)); continue; }
      if (L.set) Object.assign(set, L.set); if (L.event) onEvent(L.event, L); }
  }

  /** 장면 하나 — 풀리면 { skipped, aborted, set }(busy = 다른 장면 중이라 거절) */
  async function play(id, vars = {}) {
    if (busy) return { skipped: true, aborted: false, set: {}, busy: true };
    let lines = flatten(script, id); if (!lines.length) return { skipped: true, aborted: false, set: {}, empty: true };
    busy = true; const set = {}; let skipped = false, aborted = false, stop = false, from = 0, finish; const cast = script.cast || {};
    faces.left.hidden = true; faces.right.hidden = true; delete faces.left.dataset.src; delete faces.right.dataset.src;
    $('.gbs-log').hidden = true; $('.gbs-choices').innerHTML = ''; $('.gbs-text').textContent = '';
    el.hidden = false; el.dataset.scene = id; el.classList.remove('out'); sfx('open');
    const ended = new Promise((r) => { finish = r; });
    skipNow = () => { if (stop) return; stop = true; skipped = true; clearT(); onTap = null; applyRest(lines, from, set); finish(); };
    abortNow = () => { if (stop) return; stop = true; aborted = true; clearT(); onTap = null; finish(); };
    (async () => {
      for (let idx = 0; idx < lines.length; idx++) {
        if (stop) return; const L = lines[idx];
        if (L.choice) {
          from = idx;   // 고르기 전에 건너뛰면 이 선택지(기본 갈래)부터 적용
          $('.gbs-text').textContent = L.prompt ? T(fill(L.prompt, vars)) : ''; $('.gbs-name').hidden = true; el.classList.add('ready', 'choosing');   // 선택지 = 내 차례 — 앞사람 이름표를 내린다
          const pick = await new Promise((r) => { const box = $('.gbs-choices'); box.innerHTML = L.choice.map((o, k) => `<button type="button" class="gbs-choice" data-choice="${k}">${esc(T(fill(o.text, vars)))}</button>`).join(''); box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => r(+b.dataset.choice), { once: true })); box.querySelector('button')?.focus(); });
          if (stop) return;
          $('.gbs-choices').innerHTML = ''; el.classList.remove('choosing'); const o = L.choice[pick]; sfx('pick'); log.push({ who: '', say: `▸ ${o.text}` });
          if (o.set) Object.assign(set, o.set);
          if (o.goto) lines = lines.slice(0, idx + 1).concat(flatten(script, o.goto), lines.slice(idx + 1));
          from = idx + 1; continue;
        }
        if (L.set) Object.assign(set, L.set);
        if (L.event) onEvent(L.event, L);
        from = idx + 1;   // 이 줄의 효과는 이미 적용 — 건너뛰면 다음 줄부터
        if (L.say == null && L.narr == null) continue;
        const c = L.who ? { id: L.who, ...(cast[L.who] || {}) } : null; const say = T(fill(L.say ?? L.narr ?? '', vars));
        el.classList.toggle('narr', !c);
        $('.gbs-name').textContent = c ? T(c.name || L.who) : ''; $('.gbs-name').style.setProperty('--c', c?.color || '#ffd66b'); $('.gbs-name').hidden = !c;
        if (c) showFace(c, L.ex, c.side === 'right' ? 'right' : 'left'); else showFace(null, null, '-');
        log.push({ who: c ? c.name || L.who : '', say });
        await type(say); if (stop) return; await waitTap();
      }
      finish();
    })();
    await ended;
    skipNow = null; abortNow = null; onTap = null; clearT(); el.classList.add('out'); await new Promise((r) => setTimeout(r, reduceMotion() ? 0 : 180));
    el.hidden = true; el.classList.remove('out', 'narr', 'ready', 'fast', 'choosing'); $('.gbs-choices').innerHTML = ''; $('.gbs-log').hidden = true; busy = false; sfx('close');
    return { skipped, aborted, set };
  }
  return {
    play, log, el, get busy() { return busy; },
    /** 판을 그만둘 때 — 효과 없이 지금 장면을 닫는다(봤음으로 치지 않는다) */
    abort() { abortNow?.(); },
    destroy() { abortNow?.(); clearT(); clearTimeout(holdT); removeEventListener('keydown', key, true); removeEventListener('pointerup', upAll); removeEventListener('pointercancel', upAll); el.remove(); },
  };
}
