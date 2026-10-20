// @gb-juice v3 — 플레이어가 한 일에는 «과하게» 반응한다. 먹기·맞히기·진화 하나하나가 대단한 일처럼 보이고 들려야 한다.
// 정본 = ~/.claude/skills/game-builder/kit/juice/juice.js — 게임마다 복사해 쓴다(내용 수정 금지).
// 🔒 tools/check-juice.mjs 가 «게임 루프가 있는데 이 키트·반응표(JUICE)가 없거나, 행동 하나의 반응이 3갈래 미만·소리 없음» 을 FAIL 시킨다.
// 왜: 끝까지 진화에서 플랑크톤을 먹어도 소리·이펙트가 0이었다(2026-10-12 사용자 «먹으면 효과음. 시간 이펙트좀.
//     사용자의 행동에 반응을 과하게 하란 말이야. 대단한 일을 하고 있는 것처럼. 이것도 스킬 코드에 박아»).
//
// 🎨 kit/juice/juice.css 를 게임 스타일시트 끝에 붙인다(표식 @gb-juice-css · CSP 때문에 JS 가 <style> 을 넣지 않는다).
//   export const JUICE = {            // 행동 → 반응 갈래(≥3, 'sfx' 필수). 게임 코드에 «JUICE» 라는 이름으로 둔다(게이트가 읽는다)
//     eat:    ['sfx', 'combo', 'pop', 'burst', 'punch'],
//     evolve: ['sfx', 'slowmo', 'flash', 'burst', 'banner', 'haptic'],
//   };
//   const J = createJuice({ table: JUICE, host: hudEl, sfx: (name, { rate }) => play(name, rate), burst: (o) => particles(o), punch: { eat: '#score' } });
//   J.fire('eat', { x, y, n: 3, text: '+3', color: '#7ff' });   // x,y = 화면 좌표(없으면 화면 가운데)
//   dt = J.time(dt);                                            // slowmo·hitstop 을 게임 시간에 건다(싱글 판만 · 온라인은 렌더 dt 에만)
//
// 갈래: sfx(콤보면 음이 올라간다) · combo(창 안 연속 → 배수·«콤보 ×N!») · pop(떠오르는 큰 숫자) · burst(파티클 — 게임이 그린다)
//       punch(HUD 숫자 튕김) · flash(화면 번쩍) · slowmo(시간 느리게 0.25초) · hitstop(0.06초 멈칫) · banner(가운데 큰 글자)
//       haptic(진동 — 설정으로 끔) · kick(카메라 줌 펀치 — 게임이 그린다. 3D 에서 카메라 흔들기 대신 이걸 쓴다)
//       squash(맞은 쪽 찌그러뜨림) · knock(튕겨 보냄) · shake(화면 흔들기 — 2D) · hitflash(맞은 몸 하얗게) ← v3 타격 묶음 HIT
// v2(2026-10-14 하루셈): 턴제·퀴즈는 «1.4초 안에 또» 콤보가 영원히 안 터진다(문항당 10~30초) →
//   createJuice({ comboWindow: Infinity, comboText: (n) => `${n}연속 정답!` }) + 틀리면 J.breakCombo().
// v3(2026-10-19 사용자 «같은 칼질인데 왜 이건 시원할까» 손맛 영상): 판정·데미지는 그대로 두고 «맞는 순간»만 바꾼다 —
//   ① 0.1초 멈춤(hitstop) ② 맞은 쪽 찌그러뜨리고(squash) 고무공처럼 튕겨 보냄(knock) ③ 화면 흔들기(shake · 3D 는 kick) + 몸 하얗게 번쩍(hitflash)
//   ④ 파편(burst)·숫자(pop)·소리(sfx). 때리기·맞기 행동은 이 넷을 다 쓴다 → HIT 묶음. 🔒 check-juice 가 타격 행동에 넷 중 하나라도 빠지면 FAIL.
//   squash·knock·hitflash·shake 는 게임이 그린다(콜백 — Phaser: setTintFill(0xffffff)·body.velocity 더하기·cameras.main.shake / three: emissive·속도·카메라 kick).
//   DOM 게임은 fire 에 el(맞은 요소)을 넘기면 키트 CSS 가 대신 찌그러뜨리고·튕기고·번쩍인다.
export const CHANNELS = ['sfx', 'combo', 'pop', 'burst', 'punch', 'flash', 'slowmo', 'hitstop', 'banner', 'haptic', 'kick', 'squash', 'knock', 'shake', 'hitflash'];
/** 때리기·맞기 행동의 기본 묶음 — JUICE = { hit: HIT, hurt: [...HIT, 'haptic'] } (3D 는 HIT_3D: 화면 흔들기 대신 줌 펀치) */
export const HIT = ['sfx', 'hitstop', 'squash', 'knock', 'shake', 'hitflash', 'burst', 'pop'];
export const HIT_3D = ['sfx', 'hitstop', 'squash', 'knock', 'kick', 'hitflash', 'burst', 'pop'];

export function validateJuiceTable(table) {
  const bad = [];
  for (const [k, ch] of Object.entries(table || {})) {
    if (!Array.isArray(ch)) { bad.push(`${k}: 배열 아님`); continue; }
    const u = ch.filter((c) => CHANNELS.includes(c));
    if (!ch.includes('sfx')) bad.push(`${k}: 소리(sfx) 없음`);
    if (new Set(u).size < 3) bad.push(`${k}: 반응 ${new Set(u).size}갈래(≥3)`);
    for (const c of ch) if (!CHANNELS.includes(c)) bad.push(`${k}: 모르는 갈래 ${c}`);
  }
  return bad;
}

export function createJuice({ table, host = document.body, sfx, burst, kick, squash, knock, shake, hitflash, shakeEl, punch = {}, haptics = () => true, comboWindow = 1.4, comboText = (n) => `콤보 ×${n}!` } = {}) {
  const bad = validateJuiceTable(table); if (bad.length) console.error('[gb-juice] 반응표 오류: ' + bad.join(' · '));
  const doc = host.ownerDocument || document;
  const layer = doc.createElement('div'); layer.className = 'gbj-layer'; layer.setAttribute('aria-hidden', 'true'); host.appendChild(layer); // 꾸밈 — 읽기 프로그램엔 게임의 상태 글이 따로 알린다
  const flashEl = doc.createElement('div'); flashEl.className = 'gbj-flash'; layer.appendChild(flashEl);
  const bannerEl = doc.createElement('div'); bannerEl.className = 'gbj-banner'; layer.appendChild(bannerEl);
  const warned = new Set();
  let combo = 0, comboT = -1e9, slowT = 0, stopT = 0, now = () => performance.now() / 1000;
  const stats = {}; (globalThis.__gbJuice = globalThis.__gbJuice || {}).stats = stats;
  const J = {
    get combo() { return combo; },
    /** 콤보 끊기 — 턴제·퀴즈에서 틀렸을 때(시간 창 대신 정오로 끊는다) */
    breakCombo() { combo = 0; comboT = -1e9; },
    fire(action, o = {}) {
      const ch = table[action];
      if (!ch) { console.error(`[gb-juice] 반응표에 없는 행동: ${action}`); return; }
      const s = (stats[action] = stats[action] || { n: 0, ch: {} }); s.n++;
      const x = o.x ?? innerWidth / 2, y = o.y ?? innerHeight / 2, color = o.color || '#fff';
      let mult = 1;
      if (ch.includes('combo')) {
        const t = now(); combo = t - comboT <= comboWindow ? combo + 1 : 1; comboT = t; mult = combo;
        if (combo === 3 || combo === 5 || combo === 10 || (combo > 10 && combo % 10 === 0)) J.banner(comboText(combo), o.comboColor || '#ffe066', 0.9);
      }
      const big = Math.min(2.4, 1 + (mult - 1) * 0.12) * (o.big || 1);
      for (const c of ch) {
        s.ch[c] = (s.ch[c] || 0) + 1;
        if (c === 'sfx') sfx?.(o.sfx || action, { rate: Math.pow(2, Math.min(12, mult - 1) / 12), vol: o.vol ?? 1 });
        else if (c === 'pop') J.pop(o.text ?? (o.n != null ? `+${o.n}` : '!'), x, y, color, big);
        else if (c === 'burst') burst?.({ ...o, action, mult, big });
        else if (c === 'kick') kick?.({ ...o, action, mult, big });
        else if (c === 'punch') for (const sel of [].concat(o.punch || punch[action] || [])) J.punch(sel, big);
        else if (c === 'flash') J.flash(o.flashColor || color, o.flashAlpha ?? 0.35);
        else if (c === 'slowmo') slowT = Math.max(slowT, o.slowSec ?? 0.35);
        else if (c === 'hitstop') stopT = Math.max(stopT, o.stopSec ?? (ch.includes('knock') ? 0.1 : 0.06));   // 타격은 0.1초 — 짧은 정지가 묵직함을 만든다
        else if (c === 'squash') { if (squash) squash({ ...o, action, mult, big }); else J.css(o.el, 'gbj-squash', c, action); }
        else if (c === 'knock') { if (knock) knock({ ...o, action, mult, big }); else J.css(o.el, 'gbj-knock', c, action, { '--kx': `${Math.round((o.dirX ?? 1) * 14 * big)}px`, '--ky': `${Math.round((o.dirY ?? 0) * 14 * big)}px` }); }
        else if (c === 'shake') { if (shake) shake({ ...o, action, mult, big }); else J.css(o.shakeEl || shakeEl || host, 'gbj-shake', c, action, { '--sh': `${Math.round(5 * big)}px` }); }
        else if (c === 'hitflash') { if (hitflash) hitflash({ ...o, action, mult, big }); else J.css(o.el, 'gbj-hitflash', c, action); }
        else if (c === 'banner') J.banner(o.title || o.text || '', color, o.bannerSec ?? 1.4);
        else if (c === 'haptic') { if (haptics()) navigator.vibrate?.(o.vib ?? [18]); }
      }
    },
    /** 게임 시간에 hitstop·slowmo 를 건다 — 멈칫(0) → 느리게(0.3) → 원래대로 */
    time(dt) {
      if (stopT > 0) { stopT -= dt; return 0; }
      if (slowT > 0) { slowT -= dt; return dt * 0.3; }
      return dt;
    },
    pop(text, x, y, color = '#fff', big = 1) {
      const d = doc.createElement('div'); d.className = 'gbj-pop'; d.textContent = text;
      d.style.cssText = `left:${x}px;top:${y}px;color:${color};--s:${big.toFixed(2)};--dx:${(Math.random() * 40 - 20).toFixed(0)}px`;   // @allow-math-random 연출(떠오르는 글자 좌우 흔들림)
      layer.appendChild(d); setTimeout(() => d.remove(), 900);
    },
    punch(sel, big = 1) {
      const el = typeof sel === 'string' ? doc.querySelector(sel) : sel; if (!el) return;
      el.style.setProperty('--gbj-p', (1 + 0.35 * big).toFixed(2)); el.classList.remove('gbj-punch'); void el.offsetWidth; el.classList.add('gbj-punch');
    },
    /** 콜백 없는 갈래를 DOM 요소에 CSS 로 — 그릴 곳(el)이 없으면 한 번 크게 알린다(표만 있고 화면 반응 0 이 되지 않게) */
    css(el, cls, c, action, vars = {}) {
      const t = typeof el === 'string' ? doc.querySelector(el) : el;
      if (!t || !t.classList) { if (!warned.has(c + action)) { warned.add(c + action); console.error(`[gb-juice] ${action}: ${c} 를 그릴 곳 없음 — createJuice({ ${c} }) 콜백을 주거나 fire(…, { el }) 로 맞은 요소를 넘겨라`); } return; }
      for (const [k, v] of Object.entries(vars)) t.style.setProperty(k, v);
      t.classList.remove(cls); void t.offsetWidth; t.classList.add(cls); setTimeout(() => t.classList.remove(cls), 450);
    },
    flash(color = '#fff', a = 0.35) { flashEl.style.background = color; flashEl.style.opacity = a; flashEl.classList.remove('gbj-go'); void flashEl.offsetWidth; flashEl.classList.add('gbj-go'); },
    banner(text, color = '#fff', sec = 1.4) {
      bannerEl.textContent = text; bannerEl.style.color = color; bannerEl.style.setProperty('--d', sec + 's');
      bannerEl.classList.remove('gbj-go'); void bannerEl.offsetWidth; bannerEl.classList.add('gbj-go');
    },
    destroy() { layer.remove(); },
  };
  return J;
}
