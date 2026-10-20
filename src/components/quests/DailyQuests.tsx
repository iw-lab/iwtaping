'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { useQuestStore } from '@/stores/useQuestStore';
import { isClaimed, isComplete, questRatio } from '@/lib/progress/quests';
import { msUntilWeeklyReset } from '@/lib/progress/league';
import { DataIcon } from '@/components/common/DataIcon';

interface DailyQuestsProps {
  className?: string;
  compact?: boolean;
}

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

export function DailyQuests({ className = '', compact = false }: DailyQuestsProps) {
  const { quests, state, load, claimQuest } = useQuestStore();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    load();
    setRemaining(msUntilMidnight());
    const timer = setInterval(() => setRemaining(msUntilMidnight()), 60000);
    return () => clearInterval(timer);
  }, [load]);

  if (!quests.length) return null;

  const done = quests.filter((q) => isComplete(q, state)).length;

  const handleClaim = (id: string) => {
    const reward = claimQuest(id);
    if (reward) {
      setToast(`+${reward.xp} XP · +${reward.coins} 코인`);
      setTimeout(() => setToast(null), 2200);
    }
  };

  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            오늘의 퀘스트
          </h3>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full font-bold"
            style={{
              background: done === quests.length ? 'var(--color-success)' : 'var(--bg-tertiary)',
              color: done === quests.length ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {done}/{quests.length}
          </span>
        </div>
        {remaining !== null && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatRemaining(remaining)} 남음
          </span>
        )}
      </div>

      <div className="space-y-2">
        {quests.map((quest) => {
          const ratio = questRatio(quest, state);
          const complete = isComplete(quest, state);
          const claimed = isClaimed(quest, state);
          return (
            <div key={quest.id} className="flex items-center gap-3">
              <DataIcon name={quest.icon} className="w-5 h-5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium truncate">{quest.title}</span>
                  <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {Math.min(quest.target, Math.floor(state.progress[quest.metric] ?? 0))}/{quest.target} {quest.unit}
                  </span>
                </div>
                {!compact && (
                  <div className="text-xs mb-1 truncate" style={{ color: 'var(--text-muted)' }}>
                    {quest.description}
                  </div>
                )}
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${ratio * 100}%`,
                      background: complete
                        ? 'var(--color-success)'
                        : 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))',
                    }}
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={!complete || claimed}
                onClick={() => handleClaim(quest.id)}
                className="text-xs font-bold px-2 py-1 rounded-md shrink-0 transition-opacity disabled:opacity-40"
                style={{
                  background: claimed ? 'var(--bg-tertiary)' : 'var(--color-primary)',
                  color: claimed ? 'var(--text-muted)' : '#fff',
                  cursor: complete && !claimed ? 'pointer' : 'default',
                }}
              >
                {claimed ? '완료' : `+${quest.xpReward}`}
              </button>
            </div>
          );
        })}
      </div>

      {toast && (
        <div
          className="mt-3 text-center text-xs font-bold py-1.5 rounded-md"
          style={{ background: 'var(--color-success)', color: '#fff' }}
          role="status"
        >
          {toast}
        </div>
      )}
    </Card>
  );
}

/** 리그 마감 카운트다운 — 주간 경쟁의 마감 압박을 만드는 장치 */
export function LeagueCountdown({ className = '' }: { className?: string }) {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    setMs(msUntilWeeklyReset());
    const timer = setInterval(() => setMs(msUntilWeeklyReset()), 60000);
    return () => clearInterval(timer);
  }, []);

  if (ms === null) return null;
  return (
    <span className={className} style={{ color: 'var(--text-muted)' }}>
      리그 마감까지 {formatRemaining(ms)}
    </span>
  );
}
