import { getToday, toDateKey } from '@/lib/utils/helpers';

// Daily challenge system - generates unique challenge per day using date-based seed

export type ChallengeType = 'speed' | 'accuracy' | 'combo' | 'endurance';

export interface DailyChallenge {
  id: string;
  date: string;
  type: ChallengeType;
  title: string;
  description: string;
  icon: string;
  target: number;
  unit: string;
  timeLimit: number; // seconds, 0 = no limit
  xpReward: number;
  coinReward: number;
  difficulty: 1 | 2 | 3; // 1=easy, 2=medium, 3=hard
}

// Simple hash from date string
function dateHash(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

/** icon 은 이모지 글자가 아니라 lucide-react 아이콘 이름(kebab-case) — 그리는 쪽은 DataIcon 참고. */
const CHALLENGE_TEMPLATES: Omit<DailyChallenge, 'id' | 'date' | 'difficulty' | 'xpReward' | 'coinReward'>[] = [
  { type: 'speed', title: '번개 손가락', description: '타수 {target}타/분 이상으로 타이핑하세요!', icon: 'zap', target: 200, unit: '타/분', timeLimit: 60 },
  { type: 'speed', title: '폭풍 타이핑', description: '60초 안에 {target}타/분을 달성하세요!', icon: 'wind', target: 250, unit: '타/분', timeLimit: 60 },
  { type: 'accuracy', title: '완벽주의자', description: '정확도 {target}% 이상으로 연습을 완료하세요!', icon: 'target', target: 98, unit: '%', timeLimit: 0 },
  { type: 'accuracy', title: '오타 제로', description: '정확도 {target}% 이상! 실수 없이 도전!', icon: 'gem', target: 99, unit: '%', timeLimit: 0 },
  { type: 'combo', title: '콤보 마스터', description: '{target}콤보를 달성하세요!', icon: 'flame', target: 30, unit: '콤보', timeLimit: 0 },
  { type: 'combo', title: '무한 콤보', description: '{target}콤보 이상을 기록하세요!', icon: 'zap', target: 50, unit: '콤보', timeLimit: 0 },
  { type: 'endurance', title: '마라톤 타자', description: '{target}분 동안 연습하세요!', icon: 'footprints', target: 5, unit: '분', timeLimit: 0 },
  { type: 'endurance', title: '인내의 달인', description: '{target}개의 단어를 연습하세요!', icon: 'dumbbell', target: 100, unit: '단어', timeLimit: 0 },
  { type: 'speed', title: '로켓 타이핑', description: '30초 안에 {target}타/분 이상!', icon: 'rocket', target: 300, unit: '타/분', timeLimit: 30 },
  { type: 'accuracy', title: '레이저 정확도', description: '긴 글에서 {target}% 정확도를 유지하세요!', icon: 'microscope', target: 97, unit: '%', timeLimit: 0 },
];

const DIFFICULTY_BY_DAY: Record<number, 1 | 2 | 3> = {
  0: 2, // 일요일 - 보통
  1: 1, // 월요일 - 쉬움
  2: 1, // 화요일 - 쉬움
  3: 2, // 수요일 - 보통
  4: 2, // 목요일 - 보통
  5: 3, // 금요일 - 어려움
  6: 3, // 토요일 - 어려움
};

export function getDailyChallenge(dateStr?: string): DailyChallenge {
  const date = dateStr || getToday();
  const hash = dateHash(date);
  const dayOfWeek = new Date(date).getDay();
  const difficulty = DIFFICULTY_BY_DAY[dayOfWeek] || 2;

  // Pick template based on hash
  const templateIdx = hash % CHALLENGE_TEMPLATES.length;
  const template = CHALLENGE_TEMPLATES[templateIdx];

  // Adjust target based on difficulty.
  // 정확도(%)에는 배수를 쓰면 안 된다 — 98 × 1.3 = 127%로 달성 불가능한 목표가 나오고,
  // 쉬운 요일엔 69%가 되어 아무 의미가 없어진다. 퍼센트는 ±가감으로 좁게 조정하고 99%로 막는다.
  const adjustedTarget =
    template.unit === '%'
      ? Math.min(99, template.target + (difficulty === 1 ? -3 : difficulty === 3 ? 1 : 0))
      : Math.round(template.target * (difficulty === 1 ? 0.7 : difficulty === 3 ? 1.3 : 1));

  // Rewards scale with difficulty
  const xpReward = difficulty === 1 ? 50 : difficulty === 2 ? 80 : 120;
  const coinReward = difficulty === 1 ? 10 : difficulty === 2 ? 20 : 35;

  return {
    ...template,
    id: `challenge-${date}`,
    date,
    target: adjustedTarget,
    difficulty,
    xpReward,
    coinReward,
    description: template.description.replace('{target}', String(adjustedTarget)),
  };
}

// Check if challenge is completed
export function isChallengeComplete(
  challenge: DailyChallenge,
  result: { kpm: number; accuracy: number; maxCombo: number; elapsedTime: number; wordCount?: number }
): boolean {
  switch (challenge.type) {
    case 'speed':
      return result.kpm >= challenge.target;
    case 'accuracy':
      return result.accuracy >= challenge.target;
    case 'combo':
      return result.maxCombo >= challenge.target;
    case 'endurance':
      if (challenge.unit === '분') return result.elapsedTime >= challenge.target * 60;
      if (challenge.unit === '단어') return (result.wordCount || 0) >= challenge.target;
      return false;
    default:
      return false;
  }
}

// Star rating (1-3 stars)
export function getChallengeStars(
  challenge: DailyChallenge,
  result: { kpm: number; accuracy: number; maxCombo: number; elapsedTime: number }
): number {
  let score = 0;

  switch (challenge.type) {
    case 'speed':
      if (result.kpm >= challenge.target) score++;
      if (result.kpm >= challenge.target * 1.2) score++;
      if (result.kpm >= challenge.target * 1.5) score++;
      break;
    case 'accuracy':
      if (result.accuracy >= challenge.target) score++;
      if (result.accuracy >= Math.min(challenge.target + 1, 100)) score++;
      if (result.accuracy >= Math.min(challenge.target + 2, 100)) score++;
      break;
    case 'combo':
      if (result.maxCombo >= challenge.target) score++;
      if (result.maxCombo >= challenge.target * 1.5) score++;
      if (result.maxCombo >= challenge.target * 2) score++;
      break;
    case 'endurance':
      score = 1;
      if (result.accuracy >= 90) score++;
      if (result.accuracy >= 95 && result.kpm >= 200) score++;
      break;
  }

  return Math.min(3, Math.max(0, score));
}

const CHALLENGE_STORAGE_KEY = 'typingverse-challenge';

export function getChallengeStatus(dateStr?: string): { completed: boolean; stars: number } {
  if (typeof window === 'undefined') return { completed: false, stars: 0 };
  const date = dateStr || getToday();
  try {
    const saved = localStorage.getItem(CHALLENGE_STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      if (data.date === date) {
        return { completed: data.completed || false, stars: data.stars || 0 };
      }
    }
  } catch {}
  return { completed: false, stars: 0 };
}

export function saveChallengeStatus(date: string, completed: boolean, stars: number) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify({ date, completed, stars }));
  }
}
