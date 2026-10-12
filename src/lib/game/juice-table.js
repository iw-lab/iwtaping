// 반응(주스) — 타이핑 게임 6종 공용 반응표. 서바이벌게임(js/fx.js)의 패턴을 그대로 따른다.
// 각 게임은 createGameJuice()로 자기 파티클·흔들림·진동 설정만 꽂아서 쓴다.
// 반응표 = JUICE(🔒 game-builder tools/check-juice.mjs — 행동마다 sfx 포함 ≥3갈래 · fire 호출 필수).
// 왜: 2026-10-12 사용자 「사용자의 행동에 반응을 과하게 하란 말이야. 대단한 일을 하고 있는 것처럼. 전부 붙여」.
import { createJuice } from './juice.js';

export const JUICE = {
  hit: ['sfx', 'combo', 'pop', 'burst', 'punch'], // 정답 격파·단어 완성·따라잡기
  miss: ['sfx', 'flash', 'punch', 'haptic'], // 오타·피격·역전당함
  special: ['sfx', 'flash', 'burst', 'banner', 'haptic'], // 특수 능력 발동(얼음·소탕·회복)
  levelup: ['sfx', 'flash', 'banner', 'burst'], // 웨이브/레벨업·완주·우승
};

/** 행동 → 기존 soundManager SoundType 매핑(새 효과음 파일 없이 기존 사운드 재사용). */
const SFX = { hit: 'explosion', miss: 'keyError', special: 'achievement', levelup: 'levelUp' };

/**
 * 게임마다 자기 파티클/흔들림/진동을 꽂아 J 인스턴스를 만든다.
 * sfx는 soundManager — 연속 격파(hit)는 콤보 사운드로 바꿔 음이 올라가는 느낌을 살린다
 * (soundManager.play는 'combo' 타입에만 variation으로 피치를 올리므로, 콤보 중엔 그 타입을 쓴다).
 */
export function createGameJuice({ soundManager, burst, punch, haptics } = {}) {
  let J;
  const sfx = (name) => {
    if (!soundManager) return;
    const combo = J ? J.combo : 0;
    if (name === 'hit' && combo > 1) soundManager.play('combo', combo);
    else soundManager.play(SFX[name] || name);
  };
  J = createJuice({ table: JUICE, host: typeof document !== 'undefined' ? document.body : undefined, sfx, burst, punch, haptics });
  return J;
}
