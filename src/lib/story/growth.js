// @gb-growth v1 — 성장형 시뮬 층(장르 무관): «함께 다니는 동반자가 자란다» + «만난 인물과 친해진다» + «다음 목표 한 줄».
// 정본 = ~/.claude/skills/game-builder/kit/story/growth.js — 게임마다 복사(내용 수정 금지). 순수 함수 — 봇 시뮬·시험이 그대로 부른다.
// 🔒 tools/check-story.mjs 가 «성장 단계 ≥3 · 화면에 다음 목표(nextGoal) · 단계마다 이야기 비트(beats)가 있나»를 잰다.
// 왜(조사 100+편 공통 관습 — references/story-and-growth.md): 아이는 «숫자가 오른다»보다 «얘가 커졌다·나랑 친해졌다»를 기억한다.
//   다마고치·포켓몬(진화) · 동물의 숲·스타듀(우정 하트 → 이야기 해금) · 꾸미기 마을 복원(보이는 변화) · 다음 목표 한 줄(가든스케이프).
//
//   import { createGrowth } from './story/growth.js';
//   const GROW = createGrowth({
//     stages: [{ id: 'spark', need: 0, name: '꼬마 불씨' }, { id: 'glow', need: 30, name: '반짝 불빛' }, { id: 'lamp', need: 90, name: '등불 요정' }],
//     bondSteps: [0, 3, 6, 9],                        // 우정 점수 → 단계(0~3) 문턱
//   });
//   const ev = GROW.gain(state, { xp: 5, bond: { h_owl: 2 } });   // state.growth = { xp, bond: {id: 점수} } 를 바꾸고 사건 목록을 돌려준다
//   //  ev = [{ type: 'stageUp', from, to, stage }, { type: 'bondUp', id, level }] → 화면 연출 + story beatsDue(state) 로 이야기
//   GROW.nextGoal(state)  // { text: '반짝 불빛까지 별 12개', left: 12, pct: 0.6 } — 첫 화면·결과 화면에 한 줄로 늘 보인다

export const GROWTH_VERSION = 1;

export function createGrowth({ stages, bondSteps = [0, 3, 6, 9], unit = '점' }) {
  if (!Array.isArray(stages) || stages.length < 2) throw new Error('growth: stages ≥2');
  const S = stages.slice().sort((a, b) => a.need - b.need);
  const ensure = (state) => { state.growth ||= {}; state.growth.xp = Math.max(0, Number(state.growth.xp) || 0); state.growth.bond ||= {}; return state.growth; };
  const stageIdx = (xp) => { let k = 0; for (let i = 0; i < S.length; i++) if (xp >= S[i].need) k = i; return k; };
  const bondLevel = (pts) => { let k = 0; for (let i = 0; i < bondSteps.length; i++) if (pts >= bondSteps[i]) k = i; return k; };
  return {
    stages: S, bondSteps,
    stageIdx, bondLevel,
    stageOf(state) { return S[stageIdx(ensure(state).xp)]; },
    /** 성장·우정을 더하고 «단계가 오른 사건»을 돌려준다(음수는 받지 않는다 — 성장은 되돌지 않는다) */
    gain(state, { xp = 0, bond = {} } = {}) {
      const g = ensure(state); const ev = [];
      const a = stageIdx(g.xp); g.xp += Math.max(0, Number(xp) || 0); const b = stageIdx(g.xp);
      if (b > a) ev.push({ type: 'stageUp', from: S[a].id, to: S[b].id, stage: S[b], level: b });
      for (const [id, n] of Object.entries(bond)) {
        const before = bondLevel(g.bond[id] || 0); g.bond[id] = (g.bond[id] || 0) + Math.max(0, Number(n) || 0); const after = bondLevel(g.bond[id]);
        if (after > before) ev.push({ type: 'bondUp', id, level: after });
      }
      return ev;
    },
    /** 다음 목표 한 줄 — 마지막 단계면 null */
    nextGoal(state, label = unit) {
      const g = ensure(state); const i = stageIdx(g.xp); const nx = S[i + 1]; if (!nx) return null;
      const cur = S[i]; const left = Math.max(0, nx.need - g.xp);
      return { text: `${nx.name}까지 ${label} ${left}`, left, pct: Math.min(1, (g.xp - cur.need) / Math.max(1, nx.need - cur.need)), next: nx };
    },
    /** 이야기 비트 when 에 쓰는 평평한 값(«growth.stage»·«bond.<id>») — story beatsDue 의 state 로 넘긴다 */
    flat(state, extra = {}) {
      const g = ensure(state); const bond = {}; for (const [k, v] of Object.entries(g.bond)) bond[k] = bondLevel(v);
      return { ...extra, growth: { xp: g.xp, stage: stageIdx(g.xp) }, bond, storySeen: state.storySeen || {} };
    },
  };
}
