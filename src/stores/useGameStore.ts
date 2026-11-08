'use client';
import { create } from 'zustand';
import { GameType, GameStatus, GameResult } from '@/types/game';
import { useQuestStore } from './useQuestStore';
import { useStatsStore } from './useStatsStore';
import { evaluateAchievements } from '@/lib/progress/achievements';
import { useProgressStore } from './useProgressStore';
import { notifyAchievements } from './useAchievementToast';

interface GameStore {
  gameType: GameType | null;
  status: GameStatus;
  score: number;
  level: number;
  combo: number;
  maxCombo: number;
  input: string;
  results: GameResult[];

  setGameType: (type: GameType) => void;
  setStatus: (status: GameStatus) => void;
  setScore: (score: number) => void;
  addScore: (points: number) => void;
  setLevel: (level: number) => void;
  setCombo: (combo: number) => void;
  incrementCombo: () => void;
  resetCombo: () => void;
  setInput: (input: string) => void;
  addResult: (result: GameResult) => void;
  reset: () => void;
  loadResults: () => void;
}

// export: BusCard(타비의 버스)가 «이미 한 판 쳤는지»를 판정하려고 이 키를 그대로 읽는다(첫 판 앞 프롤로그 안 띄우기).
export const RESULTS_KEY = 'typingverse-game-results';

/** 저장된 게임 기록. 파싱 실패·미저장은 빈 배열. */
function readPersistedResults(): GameResult[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  gameType: null,
  status: 'menu',
  score: 0,
  level: 1,
  combo: 0,
  maxCombo: 0,
  input: '',
  results: [],

  setGameType: (type) => set({ gameType: type }),
  setStatus: (status) => set({ status }),
  setScore: (score) => set({ score }),
  addScore: (points) => {
    const { combo } = get();
    const multiplier = combo >= 50 ? 5 : combo >= 20 ? 3 : combo >= 10 ? 2 : combo >= 5 ? 1.5 : 1;
    set((s) => ({ score: s.score + Math.round(points * multiplier) }));
  },
  setLevel: (level) => set({ level }),
  setCombo: (combo) => set({ combo }),
  incrementCombo: () => {
    const { combo, maxCombo } = get();
    const newCombo = combo + 1;
    set({ combo: newCombo, maxCombo: Math.max(maxCombo, newCombo) });
  },
  resetCombo: () => set({ combo: 0 }),
  setInput: (input) => set({ input }),
  addResult: (result) => {
    // 저장본 위에 누적한다. loadResults()는 어디서도 호출되지 않아 게임 페이지의
    // results는 항상 빈 배열이고, 그대로 저장하면 기록이 매번 1건으로 덮어써진다(실측).
    const results = [...readPersistedResults(), result];
    set({ results });
    // 일일 퀘스트 진행도 (게임 판수·최대 콤보)
    useQuestStore.getState().recordEvent({ kind: 'game', maxCombo: result.maxCombo });

    // 게임 전용 도전과제 (퍼펙트게임·레벨 클리어·레이스 우승)
    // 누적 통계를 보고 판정하므로, 스토어가 초기값인 게임 페이지에서는 먼저 하이드레이트한다.
    useStatsStore.getState().loadStats();
    const stats = useStatsStore.getState().stats;
    const unlocked = evaluateAchievements({
      stats,
      streakDays: useProgressStore.getState().progress.streakDays,
      game: result,
      maxCombo: result.maxCombo,
    });
    if (unlocked.length) {
      for (const key of unlocked) useStatsStore.getState().unlockAchievement(key);
      notifyAchievements(unlocked);
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(RESULTS_KEY, JSON.stringify(results.slice(-500)));
      } catch { /* ignore */ }
    }
  },
  reset: () => set({ status: 'menu', score: 0, level: 1, combo: 0, maxCombo: 0, input: '' }),
  loadResults: () => {
    if (typeof window !== 'undefined') {
      try {
        set({ results: JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]') });
      } catch { /* ignore */ }
    }
  },
}));
