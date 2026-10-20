export const APP_NAME = 'TypingVerse';
export const APP_SLOGAN = '손끝으로 여는 무한한 세계';
export const APP_VERSION = '1.0.0';

export const SPEED_HISTORY_INTERVAL = 500; // ms
export const MOVING_AVERAGE_WINDOW = 5000; // ms
export const COMBO_THRESHOLDS = [2, 3, 5, 10, 20, 50];
export const COMBO_MULTIPLIERS = [1, 1.5, 2, 3, 5, 7];

export const FONT_SIZES = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

export const PASS_ACCURACY = 90;

/** icon 은 이모지 글자가 아니라 lucide-react 아이콘 이름(kebab-case) — 그리는 쪽은 DataIcon 참고. */
export const ACHIEVEMENTS_LIST = [
  { key: 'first_step', title: '첫 발걸음', description: '첫 연습 완료', icon: 'medal' },
  { key: 'lightning', title: '번개손', description: '300타/분 달성', icon: 'zap' },
  { key: 'sharpshooter', title: '명사수', description: '정확도 99% 이상', icon: 'target' },
  { key: 'fire_practice', title: '불꽃연습', description: '7일 연속 연습', icon: 'flame' },
  { key: 'master', title: '마스터', description: '500타/분 달성', icon: 'trophy' },
  { key: 'speed_600', title: '음속 돌파', description: '600타/분 달성', icon: 'gem' },
  { key: 'perfect_game', title: '퍼펙트게임', description: '게임 모드 100% 정확도', icon: 'star' },
  { key: 'game_master', title: '게임 마스터', description: '게임 한 판 1000점 이상', icon: 'crown' },
  { key: 'speed_100', title: '100타 돌파', description: '100타/분 달성', icon: 'rocket' },
  { key: 'speed_200', title: '200타 돌파', description: '200타/분 달성', icon: 'plane' },
  { key: 'speed_400', title: '400타 돌파', description: '400타/분 달성', icon: 'satellite' },
  { key: 'accuracy_95', title: '정확한 손', description: '정확도 95% 이상', icon: 'hand' },
  { key: 'combo_10', title: '콤보 입문', description: '10콤보 달성', icon: 'link-2' },
  { key: 'combo_50', title: '콤보 마스터', description: '50콤보 달성', icon: 'link-2' },
  { key: 'combo_100', title: '콤보 레전드', description: '100콤보 달성', icon: 'sparkles' },
  { key: 'practice_1h', title: '1시간 연습', description: '총 연습 시간 1시간', icon: 'timer' },
  { key: 'practice_10h', title: '10시간 연습', description: '총 연습 시간 10시간', icon: 'hourglass' },
  { key: 'practice_100h', title: '100시간 연습', description: '총 연습 시간 100시간', icon: 'clock' },
  { key: 'word_1000', title: '천 단어', description: '1000개 단어 입력', icon: 'pencil' },
  { key: 'word_10000', title: '만 단어', description: '10000개 단어 입력', icon: 'book-open' },
  { key: 'streak_3', title: '3일 연속', description: '3일 연속 연습', icon: 'calendar' },
  { key: 'streak_30', title: '30일 연속', description: '30일 연속 연습', icon: 'calendar-days' },
  { key: 'rain_clear', title: '씨앗비 클리어', description: '씨앗비 레벨 10 클리어', icon: 'cloud-rain' },
  { key: 'space_clear', title: '우주 방어 클리어', description: '우주 방어 레벨 10 클리어', icon: 'rocket' },
  { key: 'race_win', title: '레이스 우승', description: '타이핑 레이스 1등', icon: 'car-front' },
  { key: 'veteran', title: '베테랑', description: '누적 100세션 완료', icon: 'award' },
  { key: 'marathon', title: '마라톤', description: '총 연습 시간 50시간', icon: 'footprints' },
  { key: 'night_owl', title: '야행성', description: '자정 이후 연습', icon: 'moon' },
  { key: 'early_bird', title: '얼리버드', description: '오전 6시 이전 연습', icon: 'bird' },
  { key: 'multilingual', title: '다국어', description: '한국어와 영어 모두 연습', icon: 'globe' },
] as const;
