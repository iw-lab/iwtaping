export type FingerType =
  | 'left-pinky' | 'left-ring' | 'left-middle' | 'left-index'
  | 'right-index' | 'right-middle' | 'right-ring' | 'right-pinky'
  | 'thumb';

export type TypingStatus = 'idle' | 'ready' | 'typing' | 'paused' | 'finished';

/**
 * 🔴 'race' 는 «게임이지만 실제 타건으로 검증되는» 타이핑이다. 순위는 game:race 리더보드가 맡고,
 *    이 모드로 내는 제출은 지갑·XP 전용이다 — 예전엔 레이스 한 판이 game:race 와 speed **양쪽에**
 *    올라가 속도 순위를 이중으로 채웠다(2026-09-18).
 */
export type TypingMode = 'position' | 'word' | 'short' | 'long' | 'code' | 'speed_test' | 'accuracy_test' | 'custom_test' | 'race';

export type Language = 'ko' | 'en';

export type KeyboardLayout = 'qwerty-ko' | 'sebeol-390' | 'sebeol-final' | 'qwerty-en' | 'dvorak';

export type ErrorHandling = 'show' | 'stop' | 'free';

export type SpeedUnit = 'kpm' | 'wpm' | 'cpm';

export type CaretStyle = 'block' | 'line' | 'underline';

export interface Keystroke {
  key: string;
  code: string;
  timestamp: number;
  isCorrect: boolean;
  finger: FingerType;
  responseTime: number;
}

export interface ErrorRecord {
  index: number;
  expected: string;
  actual: string;
  timestamp: number;
}

export interface CharState {
  char: string;
  status: 'pending' | 'correct' | 'incorrect' | 'current' | 'composing';
}

export interface TypingState {
  text: string;
  userInput: string;
  currentIndex: number;
  startTime: number | null;
  endTime: number | null;
  keystrokes: Keystroke[];
  errors: ErrorRecord[];
  isComposing: boolean;
  composingText: string;
  status: TypingStatus;
  charStates: CharState[];
}

export interface TypingResult {
  wpm: number;
  cpm: number;
  kpm: number;
  accuracy: number;
  maxSpeed: number;
  consistency: number;
  totalKeystrokes: number;
  correctKeystrokes: number;
  errorKeystrokes: number;
  elapsedTime: number;
  fingerAccuracy: Record<FingerType, number>;
  keyAccuracy: Record<string, number>;
  speedHistory: number[];
  problemKeys: string[];
  /** 연속 타건 간격(ms). 서버 부정행위 검증 입력 — 없으면 빈 배열. */
  keyIntervals?: number[];
}

export interface PracticeSession {
  id: string;
  mode: TypingMode;
  language: Language;
  result: TypingResult;
  text: string;
  timestamp: number;
}

export interface PositionDrill {
  level: number;
  title: string;
  description: string;
  keys: string[];
  drillText: string[];
  passAccuracy: number;
}
