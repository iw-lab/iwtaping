'use client';
// 게임 모드 카드(기본틀 ④ — 모드 4종 이상). 카드는 모두 같은 크기·같은 모양: 아이콘 + 이름 + 한 줄 설명 + 최고 기록.
// 고른 모드는 기기에 기억한다(`typingverse:<게임>:mode`). data-gb-mode 는 gate-baseline 이 세는 표지.
import { useEffect, useRef, useState } from 'react';
import { CloudRain, Timer, Heart, CalendarDays, type LucideIcon } from 'lucide-react';

export type GameMode = 'classic' | 'time' | 'survival' | 'daily';

export interface ModeInfo { id: GameMode; label: string; desc: string; icon: LucideIcon }

export const DEFAULT_MODES: ModeInfo[] = [
  { id: 'classic', label: '기본', desc: '끝까지 버티며 레벨 올리기', icon: CloudRain },
  { id: 'time', label: '60초', desc: '1분 동안 최대 점수', icon: Timer },
  { id: 'survival', label: '목숨 3개', desc: '놓치면 하트 하나 · 점점 빨라져요', icon: Heart },
  { id: 'daily', label: '오늘의 판', desc: '오늘은 모두 같은 단어 순서', icon: CalendarDays },
];

const bestKey = (game: string) => `typingverse:${game}:best`;
export function readBest(game: string): Partial<Record<GameMode, number>> {
  try { return JSON.parse(localStorage.getItem(bestKey(game)) || '{}'); } catch { return {}; }
}
/** 새 최고면 true */
export function saveBest(game: string, mode: GameMode, score: number): boolean {
  const all = readBest(game);
  if ((all[mode] ?? -1) >= score) return false;
  all[mode] = score;
  try { localStorage.setItem(bestKey(game), JSON.stringify(all)); } catch { /* 저장 못 해도 판은 계속 */ }
  return true;
}

export function useGameMode(game: string): [GameMode, (m: GameMode) => void] {
  const key = `typingverse:${game}:mode`;
  const [mode, setMode] = useState<GameMode>('classic');
  useEffect(() => {
    try { const m = localStorage.getItem(key) as GameMode | null; if (m && DEFAULT_MODES.some((x) => x.id === m)) setMode(m); } catch { /* 기본값 */ }
  }, [key]);
  const pick = (m: GameMode) => { setMode(m); try { localStorage.setItem(key, m); } catch { /* */ } };
  return [mode, pick];
}

/** 오늘 날짜(현지) 문자열 — daily 시드 */
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

const KIT_ICON: Record<GameMode, string> = { classic: 'play', time: 'timer', survival: 'heart', daily: 'sparkle' };

/** 모드 카드 — 키트 틀(gb-modes renderModeCards · 같은 크기·같은 모양 카드)을 그대로 쓴다(gate-baseline S4). */
export function ModePicker({ game, value, onChange, modes = DEFAULT_MODES }: { game: string; value: GameMode; onChange: (m: GameMode) => void; modes?: ModeInfo[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const pick = useRef(onChange);
  useEffect(() => { pick.current = onChange; });
  useEffect(() => {
    let alive = true;
    void Promise.all([import('@/lib/gb/gb-modes.js'), import('@/lib/gb/gb-icons.js')]).then(([M, I]) => {
      const el = ref.current; if (!alive || !el) return;
      const best = readBest(game);
      M.renderModeCards(el, modes.map((m) => ({
        id: m.id, kind: m.id, icon: I.gbIcon(KIT_ICON[m.id]), label: m.label, desc: m.desc,
        best: best[m.id] != null ? `최고 ${best[m.id]}` : '',
      })), (id: string) => pick.current(id as GameMode));
      mark(el, value);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, modes]);
  useEffect(() => { if (ref.current) mark(ref.current, value); }, [value]);
  return <div ref={ref} className="max-w-2xl mx-auto mb-6" role="radiogroup" aria-label="게임 모드" />;
}

function mark(el: HTMLElement, value: string) {
  el.querySelectorAll<HTMLElement>('.gb-mode').forEach((b) => {
    const on = b.dataset.id === value;
    b.classList.toggle('is-sel', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
