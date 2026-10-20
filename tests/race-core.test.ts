import { describe, it, expect } from 'vitest';
import {
  RaceCore, seededRng, buildOpponents, pickRealGhosts, ghostFinishMs,
  TIME_LIMIT_MS, GHOST_COLORS, AI_GHOSTS, OPPONENT_COUNT,
  type RaceMode, type GhostSource,
} from '@/lib/game/race/core';

const REAL: GhostSource[] = [
  { name: '유저A', wpm: 80, isReal: true },
  { name: '유저B', wpm: 75, isReal: true },
  { name: '유저C', wpm: 50, isReal: true },
  { name: '유저D', wpm: 45, isReal: true },
  { name: '유저E', wpm: 20, isReal: true },
  { name: '유저F', wpm: 18, isReal: true },
];

/** 같은 시드로 한 판을 «돌린다» — 렌더(2D/3D)는 코어를 건드리지 않으므로 이 결과가 곧 두 판의 결과다.
 *  playerSpeed(ms) = 1프레임(16ms)마다 플레이어가 전진하는 진행률 — 실제 타이핑 WPM 자리를 대신한다. */
function play(seed: number, mode: RaceMode, textLen: number, playerStep: number, maxFrames = 20000) {
  const rng = seededRng(seed);
  const opponents = buildOpponents(REAL, rng, true);
  const core = new RaceCore({ mode, textLen, opponents, playerName: '플레이어' });
  let t = 0;
  let playerProgress = 0;
  const log: { t: number; rank: number; events: string[] }[] = [];
  for (let f = 0; f < maxFrames && !core.over; f++) {
    t += 16;
    const evs = core.tick(t);
    if (!core.over) {
      playerProgress = Math.min(100, playerProgress + playerStep);
      const evs2 = core.setPlayerProgress(playerProgress);
      evs.push(...evs2);
    }
    if (evs.length) log.push({ t, rank: core.playerRank(), events: evs.map((e) => e.type) });
  }
  return {
    over: core.over,
    lost: core.lost,
    t,
    cars: core.cars.map((c) => ({ name: c.name, progress: Math.round(c.progress * 1000) / 1000, isReal: c.isReal, wpm: c.wpm })),
    finalRank: core.playerRank(),
    logLen: log.length,
  };
}

describe('타이핑 레이스 코어', () => {
  it('같은 시드·같은 입력열 → 상대 구성·등수·승패가 같다(2D·3D 동일 판정의 근거)', () => {
    for (const mode of ['classic', 'time', 'daily'] as RaceMode[]) {
      expect(play(11, mode, 120, 0.09)).toEqual(play(11, mode, 120, 0.09));
    }
  });

  it('다른 시드면 상대 구성(밴드 내 선택)이 달라질 수 있다(시드가 실제로 쓰인다)', () => {
    const picks = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seededRng(seed);
      const opponents = buildOpponents(REAL, rng, true);
      picks.add(opponents.map((o) => o.name).join(','));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('완주 시간 공식 = 글자수 × 12000 / WPM (기존 판과 같다)', () => {
    expect(ghostFinishMs(60, 120)).toBeCloseTo((120 * 12000) / 60, 5);
    expect(ghostFinishMs(0, 100)).toBeCloseTo(100 * 12000, 5); // WPM 0 방어(÷최소 1)
  });

  it('상대는 최대 3명 — 실제 기록 우선, 부족분만 합성 AI로 채운다', () => {
    const rng = seededRng(42);
    const opponents = buildOpponents([], rng, true);
    expect(opponents.length).toBe(OPPONENT_COUNT);
    expect(opponents.every((o) => !o.isReal)).toBe(true);
    expect(opponents.map((o) => o.wpm)).toEqual(AI_GHOSTS.map((a) => a.wpm));

    const rng2 = seededRng(42);
    const mixed = buildOpponents([{ name: '유저A', wpm: 80, isReal: true }], rng2, true);
    expect(mixed.length).toBe(OPPONENT_COUNT);
    expect(mixed.filter((o) => o.isReal).length).toBe(1);
  });

  it('밴드 선택(pickRealGhosts)은 WPM 구간별로 한 명씩 뽑고 이름이 겹치지 않는다', () => {
    const rng = seededRng(5);
    const picked = pickRealGhosts(REAL, rng);
    expect(picked.length).toBeLessThanOrEqual(3);
    const names = picked.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('플레이어가 더 빠르면(진행률이 고스트보다 항상 앞서면) 1등으로 완주한다', () => {
    // 매우 느린 상대만 두고 플레이어는 빠르게 전진 — 반드시 1등
    const rng = seededRng(2);
    const opponents = buildOpponents([], rng, true); // 합성 AI(최대 58 WPM)
    const core = new RaceCore({ mode: 'classic', textLen: 60, opponents, playerName: 'p' });
    let t = 0;
    for (let f = 0; f < 2000 && !core.over; f++) {
      t += 16;
      core.tick(t);
      if (!core.over) core.setPlayerProgress(Math.min(100, (f + 1) * 2)); // 아주 빠르게 전진
    }
    expect(core.over).toBe(true);
    expect(core.lost).toBe(false);
    expect(core.playerRank()).toBe(1);
  });

  it('플레이어가 거의 안 치면(고스트가 먼저 골인) 패배 처리된다', () => {
    const rng = seededRng(2);
    const opponents = buildOpponents([], rng, true);
    const core = new RaceCore({ mode: 'classic', textLen: 60, opponents, playerName: 'p' });
    let t = 0;
    let lostEvent = false;
    for (let f = 0; f < 20000 && !core.over; f++) {
      t += 16;
      const evs = core.tick(t);
      if (evs.some((e) => e.type === 'lost')) lostEvent = true;
      // 플레이어는 거의 전진하지 않는다
    }
    expect(core.over).toBe(true);
    expect(core.lost).toBe(true);
    expect(lostEvent).toBe(true);
    expect(core.playerRank()).toBeGreaterThan(1);
  });

  it('time 모드는 60초가 지나면 완주하지 못한 판을 패배로 끝낸다', () => {
    const rng = seededRng(2);
    const opponents = buildOpponents([], rng, true);
    // WPM을 매우 낮게 둬 고스트도 60초 안에 못 끝내도록(합성 AI 최저 22 WPM, 글자 수를 크게)
    const core = new RaceCore({ mode: 'time', textLen: 5000, opponents, playerName: 'p' });
    let t = 0;
    for (let f = 0; f < 20000 && !core.over; f++) {
      t += 16;
      core.tick(t);
      if (!core.over) core.setPlayerProgress(Math.min(99, f * 0.001)); // 완주 못 하게 느리게
    }
    expect(core.over).toBe(true);
    expect(core.lost).toBe(true);
    expect(t).toBeGreaterThanOrEqual(TIME_LIMIT_MS);
    expect(t).toBeLessThan(TIME_LIMIT_MS + 100);
  });

  it('classic 모드는 60초가 지나도 끝나지 않는다(시간 제한 없음)', () => {
    const rng = seededRng(2);
    const opponents = buildOpponents([], rng, true);
    const core = new RaceCore({ mode: 'classic', textLen: 5000, opponents, playerName: 'p' });
    let t = 0;
    for (let f = 0; f < 5000; f++) { // 5000*16 = 80000ms > TIME_LIMIT_MS
      t += 16;
      core.tick(t);
      core.setPlayerProgress(0); // 플레이어도 안 치지만 고스트가 5000글자를 다 못 친다
    }
    expect(t).toBeGreaterThan(TIME_LIMIT_MS);
    expect(core.over).toBe(false);
  });

  it('추월(overtake) 이벤트는 그 시점 직전 등수보다 실제로 나아졌을 때만 난다', () => {
    // 🔴 코어는 tick()·setPlayerProgress() 각각에서 독립적으로 추월을 판정한다(기존 페이지의
    // «고스트 폴링 effect»·«타건 진행률 effect» 두 트리거를 그대로 반영 — 한 프레임 안에
    // «밀렸다 다시 앞섬»이 실제로 일어날 수 있으므로, 비교는 각 호출 직후마다 따로 한다).
    const rng = seededRng(9);
    const opponents = buildOpponents([], rng, true);
    const core = new RaceCore({ mode: 'classic', textLen: 200, opponents, playerName: 'p' });
    let t = 0;
    let overtakes = 0;
    // 코어 내부 관례와 같다 — 출발은 전원 동률이라 꼴찌로 간주해 비교 기준을 잡는다(기존 판과 같은 규칙).
    let prevRank = core.cars.length;
    for (let f = 0; f < 3000 && !core.over; f++) {
      t += 16;
      const evs = core.tick(t);
      if (evs.some((e) => e.type === 'overtake')) {
        overtakes++;
        expect(core.playerRank()).toBeLessThan(prevRank);
      }
      prevRank = core.playerRank();
      if (!core.over) {
        const evs2 = core.setPlayerProgress(Math.min(100, f * 0.08));
        if (evs2.some((e) => e.type === 'overtake')) {
          overtakes++;
          expect(core.playerRank()).toBeLessThan(prevRank);
        }
        prevRank = core.playerRank();
      }
    }
    expect(overtakes).toBeGreaterThan(0);
  });

  it('동점이면 플레이어가 먼저(배열 순서 유지 안정 정렬)', () => {
    const core = new RaceCore({
      mode: 'classic', textLen: 100,
      opponents: [{ name: 'g', wpm: 40, isReal: false, color: GHOST_COLORS[0] }],
      playerName: 'p',
    });
    expect(core.playerRank()).toBe(1);
  });
});
