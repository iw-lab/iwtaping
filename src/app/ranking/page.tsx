'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { GameResult, GameType } from '@/types/game';
import { PracticeSession } from '@/types/typing';
import { useProgressStore } from '@/stores/useProgressStore';
import { Medal } from 'lucide-react';

const MEDAL_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32']; // 금·은·동

function RankBadge({ rank }: { rank: number }) {
  if (rank > 3) return <>{`#${rank}`}</>;
  return <Medal className="w-4 h-4 inline" style={{ color: MEDAL_COLORS[rank - 1] }} />;
}

type RankMode = 'speed' | 'accuracy' | 'game';

interface RankEntry {
  rank: number;
  label: string;
  primary: string;
  secondary: string;
  date: string;
}

const GAME_NAMES: Record<string, string> = {
  rain: '씨앗비',
  space: '우주 방어',
  race: '타이핑 레이스',
  defense: '킹덤 디펜스',
  zombie: '좀비 서바이벌',
  puzzle: '끝말잇기',
};

function readJSON<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ko-KR');
}

export default function RankingPage() {
  const [mode, setMode] = useState<RankMode>('speed');
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [gameResults, setGameResults] = useState<GameResult[]>([]);

  const { loadProgress } = useProgressStore();

  useEffect(() => {
    loadProgress();
    setSessions(readJSON<PracticeSession>('typingverse-sessions').filter((s) => s?.result));
    setGameResults(readJSON<GameResult>('typingverse-game-results').filter((g) => g?.gameType));
  }, [loadProgress]);

  const rankings = useMemo<RankEntry[]>(() => {
    if (mode === 'game') {
      // 게임별 최고 점수 1개씩 → 점수 내림차순
      const best = new Map<GameType, GameResult>();
      for (const g of gameResults) {
        const prev = best.get(g.gameType);
        if (!prev || g.score > prev.score) best.set(g.gameType, g);
      }
      return [...best.values()]
        .sort((a, b) => b.score - a.score)
        .map((g, i) => ({
          rank: i + 1,
          label: GAME_NAMES[g.gameType] ?? g.gameType,
          primary: `${Math.round(g.score).toLocaleString()}점`,
          secondary: `${g.maxCombo} 콤보`,
          date: formatDate(g.timestamp),
        }));
    }

    const sorted = [...sessions].sort((a, b) =>
      mode === 'speed' ? b.result.kpm - a.result.kpm : b.result.accuracy - a.result.accuracy
    );

    return sorted.slice(0, 20).map((s, i) => ({
      rank: i + 1,
      label: s.text ? `${s.text.slice(0, 14)}${s.text.length > 14 ? '…' : ''}` : '연습 기록',
      primary:
        mode === 'speed'
          ? `${Math.round(s.result.kpm)} 타/분`
          : `${s.result.accuracy.toFixed(1)}%`,
      secondary:
        mode === 'speed'
          ? `${s.result.accuracy.toFixed(1)}%`
          : `${Math.round(s.result.kpm)} 타/분`,
      date: formatDate(s.timestamp),
    }));
  }, [mode, sessions, gameResults]);

  const columns =
    mode === 'game'
      ? { label: '게임', primary: '최고 점수', secondary: '최고 콤보' }
      : mode === 'speed'
        ? { label: '지문', primary: '속도', secondary: '정확도' }
        : { label: '지문', primary: '정확도', secondary: '속도' };

  return (
    <div className="max-w-[800px] mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2 gradient-text" style={{ fontFamily: "'Outfit', sans-serif" }}>
        내 기록
      </h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
        이 기기에 남은 내 연습·게임 기록이에요. 학교 순위는 첫 화면 맨 위에서 확인할 수 있어요.
      </p>

      <div className="flex gap-2 mb-6">
        <Button variant={mode === 'speed' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('speed')}>
          속도
        </Button>
        <Button variant={mode === 'accuracy' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('accuracy')}>
          정확도
        </Button>
        <Button variant={mode === 'game' ? 'primary' : 'secondary'} size="sm" onClick={() => setMode('game')}>
          게임
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)' }}>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>순위</th>
                <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{columns.label}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{columns.primary}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{columns.secondary}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>날짜</th>
              </tr>
            </thead>
            <tbody>
              {rankings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
                    아직 기록이 없습니다. {mode === 'game' ? '게임을 플레이해보세요!' : '연습을 시작해보세요!'}
                  </td>
                </tr>
              ) : (
                rankings.map((entry) => (
                  <tr key={`${entry.rank}-${entry.label}`} className="border-t border-[var(--key-border)]">
                    <td className="px-4 py-3">
                      <span
                        className="font-bold"
                        style={{
                          color: entry.rank <= 3 ? 'var(--color-accent-warm)' : 'var(--text-secondary)',
                          fontFamily: "'JetBrains Mono'",
                        }}
                      >
                        <RankBadge rank={entry.rank} />
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{entry.label}</td>
                    <td className="px-4 py-3 text-right font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-primary)' }}>
                      {entry.primary}
                    </td>
                    <td className="px-4 py-3 text-right" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--text-secondary)' }}>
                      {entry.secondary}
                    </td>
                    <td className="px-4 py-3 text-right text-sm" style={{ color: 'var(--text-muted)' }}>
                      {entry.date}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
