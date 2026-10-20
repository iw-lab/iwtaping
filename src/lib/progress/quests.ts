import { getToday } from '@/lib/utils/helpers';

/**
 * 일일 퀘스트 — 하루 3개.
 *
 * 설계 의도: 단일 일일챌린지 하나로는 "오늘 할 일"이 너무 좁다.
 * 서로 다른 축(연습량·정확도·게임)을 하나씩 섞어, 어떤 취향이든
 * 최소 하나는 자연스럽게 달성하게 만든다. 날짜 시드라 기기와 무관하게 같다.
 */

export type QuestMetric =
  | 'sessions' // 연습 세션 수
  | 'keystrokes' // 총 타수
  | 'accuracy_sessions' // 특정 정확도 이상 세션 수
  | 'games' // 게임 플레이 수
  | 'combo' // 최대 콤보
  | 'minutes'; // 연습 시간(분)

export interface QuestTemplate {
  metric: QuestMetric;
  title: string;
  icon: string;
  /** 난이도별 목표치 */
  targets: [number, number, number];
  /** accuracy_sessions에서 요구하는 정확도 */
  threshold?: number;
  unit: string;
}

export interface Quest {
  id: string;
  metric: QuestMetric;
  title: string;
  description: string;
  icon: string;
  target: number;
  threshold?: number;
  unit: string;
  xpReward: number;
  coinReward: number;
}

export interface QuestProgress {
  date: string;
  progress: Record<string, number>;
  claimed: string[];
}

/** icon 은 이모지 글자가 아니라 lucide-react 아이콘 이름(kebab-case) — 그리는 쪽은 DataIcon 참고. */
const TEMPLATES: QuestTemplate[] = [
  { metric: 'sessions', title: '오늘의 연습', icon: 'pencil', targets: [2, 3, 5], unit: '회' },
  { metric: 'keystrokes', title: '타수 채우기', icon: 'keyboard', targets: [300, 600, 1000], unit: '타' },
  { metric: 'accuracy_sessions', title: '정확하게', icon: 'target', targets: [1, 2, 3], threshold: 95, unit: '회' },
  { metric: 'games', title: '게임 한 판', icon: 'gamepad', targets: [1, 2, 3], unit: '판' },
  { metric: 'combo', title: '콤보 만들기', icon: 'flame', targets: [20, 35, 50], unit: '콤보' },
  { metric: 'minutes', title: '꾸준한 시간', icon: 'timer', targets: [3, 5, 10], unit: '분' },
];

const STORAGE_KEY = 'typingverse-quests';

function seedFrom(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

/** 하루 3개 — 서로 다른 metric이 나오도록 시드로 고정 선택한다. */
export function getDailyQuests(dateStr: string = getToday()): Quest[] {
  const seed = seedFrom(dateStr);
  const pool = [...TEMPLATES];
  const picked: QuestTemplate[] = [];

  for (let i = 0; i < 3 && pool.length; i++) {
    const idx = (seed >> (i * 5)) % pool.length;
    picked.push(pool.splice(idx, 1)[0]);
  }

  // 요일마다 난이도가 달라져 주중 리듬이 생긴다
  const dayOfWeek = new Date(`${dateStr}T00:00:00`).getDay();
  const difficulty = dayOfWeek === 0 || dayOfWeek === 6 ? 2 : dayOfWeek % 3;

  return picked.map((tpl, i) => {
    const target = tpl.targets[Math.min(2, difficulty)];
    const xpReward = 30 + difficulty * 20 + i * 5;
    return {
      id: `${dateStr}-${tpl.metric}`,
      metric: tpl.metric,
      title: tpl.title,
      description: describe(tpl, target),
      icon: tpl.icon,
      target,
      threshold: tpl.threshold,
      unit: tpl.unit,
      xpReward,
      coinReward: Math.floor(xpReward * 0.4),
    };
  });
}

function describe(tpl: QuestTemplate, target: number): string {
  switch (tpl.metric) {
    case 'sessions':
      return `연습을 ${target}회 완료하세요`;
    case 'keystrokes':
      return `오늘 ${target}타 이상 입력하세요`;
    case 'accuracy_sessions':
      return `정확도 ${tpl.threshold}% 이상으로 ${target}회 완료하세요`;
    case 'games':
      return `게임을 ${target}판 플레이하세요`;
    case 'combo':
      return `${target}콤보를 달성하세요`;
    case 'minutes':
      return `${target}분 이상 연습하세요`;
  }
}

export function emptyProgress(dateStr: string = getToday()): QuestProgress {
  return { date: dateStr, progress: {}, claimed: [] };
}

export function loadProgress(): QuestProgress {
  const today = getToday();
  if (typeof window === 'undefined') return emptyProgress(today);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress(today);
    const parsed = JSON.parse(raw) as QuestProgress;
    // 날짜가 바뀌면 진행도를 초기화한다
    if (parsed.date !== today) return emptyProgress(today);
    return { date: today, progress: parsed.progress ?? {}, claimed: parsed.claimed ?? [] };
  } catch {
    return emptyProgress(today);
  }
}

export function saveProgress(state: QuestProgress): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 저장 실패는 무시 — 진행도는 부가 기능 */
  }
}

export interface SessionEvent {
  kind: 'practice' | 'game';
  keystrokes?: number;
  accuracy?: number;
  maxCombo?: number;
  seconds?: number;
}

/** 세션 결과를 퀘스트 진행도에 반영한다. 누적형은 더하고, 최댓값형은 max를 취한다. */
export function applyEvent(state: QuestProgress, event: SessionEvent): QuestProgress {
  const progress = { ...state.progress };
  const bump = (key: QuestMetric, amount: number) => {
    progress[key] = (progress[key] ?? 0) + amount;
  };

  if (event.kind === 'practice') {
    bump('sessions', 1);
    bump('keystrokes', Math.max(0, Math.round(event.keystrokes ?? 0)));
    bump('minutes', Math.max(0, (event.seconds ?? 0) / 60));
    if ((event.accuracy ?? 0) >= 95) bump('accuracy_sessions', 1);
  } else {
    bump('games', 1);
  }

  if (event.maxCombo != null) {
    progress.combo = Math.max(progress.combo ?? 0, event.maxCombo);
  }

  return { ...state, progress };
}

export function isComplete(quest: Quest, state: QuestProgress): boolean {
  return (state.progress[quest.metric] ?? 0) >= quest.target;
}

export function isClaimed(quest: Quest, state: QuestProgress): boolean {
  return state.claimed.includes(quest.id);
}

export function claim(state: QuestProgress, quest: Quest): QuestProgress {
  if (isClaimed(quest, state) || !isComplete(quest, state)) return state;
  return { ...state, claimed: [...state.claimed, quest.id] };
}

export function questRatio(quest: Quest, state: QuestProgress): number {
  return Math.min(1, (state.progress[quest.metric] ?? 0) / quest.target);
}
