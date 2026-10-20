'use client';

import { useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { useStatsStore } from '@/stores/useStatsStore';
import { useProgressStore, xpToNextLevel } from '@/stores/useProgressStore';
import { XPBarDetailed } from '@/components/common/XPBar';
import { ContributionCalendar } from '@/components/stats/ContributionCalendar';
import { Mascot } from '@/components/mascot/Mascot';
import { formatTime, getToday } from '@/lib/utils/helpers';
import { ACHIEVEMENTS_LIST } from '@/lib/utils/constants';
import { DataIcon } from '@/components/common/DataIcon';
import { BarChart3, Timer, Trophy, Target, TrendingUp, CheckCircle, Flame, Keyboard } from 'lucide-react';

export default function StatsPage() {
  const { stats, loadStats } = useStatsStore();
  const { progress, loadProgress } = useProgressStore();

  useEffect(() => {
    loadStats();
    loadProgress();
  }, [loadStats, loadProgress]);

  const todayStats = stats.dailyStats.find(d => d.date === getToday());

  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold gradient-text" style={{ fontFamily: "'Outfit'" }}>통계</h1>
        <Mascot mood="happy" size={50} />
      </div>

      {/* Level & XP */}
      <Card variant="glow" className="p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold px-3 py-1 rounded-lg" style={{ background: 'var(--color-primary)', color: 'white' }}>
              Lv.{progress.level}
            </span>
            <div>
              <div className="text-sm font-bold">타이핑 여정</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>총 {progress.totalXpEarned} XP 획득</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {progress.streakDays > 0 && (
              <div className="text-center">
                <div className="text-xl font-bold flex items-center justify-center gap-1" style={{ color: '#FECA57', fontFamily: "'JetBrains Mono'" }}>
                  <Flame className="w-4 h-4" /> {progress.streakDays}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>연속 출석</div>
              </div>
            )}
            <div className="text-center">
              <div className="text-xl font-bold flex items-center justify-center gap-1" style={{ color: 'var(--color-accent-warm)', fontFamily: "'JetBrains Mono'" }}>
                <DataIcon name="coins" className="w-4 h-4" /> {progress.coins}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>보유 코인</div>
            </div>
          </div>
        </div>
        <XPBarDetailed />
      </Card>

      {/* Today */}
      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>오늘의 기록</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { label: '연습 시간', value: todayStats ? formatTime(todayStats.totalPracticeSeconds) : '00:00', color: 'var(--color-primary)' },
          { label: '키 입력', value: todayStats?.totalKeystrokes || 0, color: 'var(--color-secondary)' },
          { label: '평균 타수', value: Math.round(todayStats?.avgSpeed || 0), color: 'var(--color-primary-light)' },
          { label: '평균 정확도', value: `${(todayStats?.avgAccuracy || 0).toFixed(1)}%`, color: 'var(--color-success)' },
        ].map((item, i) => (
          <Card key={item.label} className="p-4 slide-up" style={{ animationDelay: `${i * 0.05}s`, opacity: 0 }}>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.label}</div>
            <div className="text-2xl font-bold mt-1" style={{ fontFamily: "'JetBrains Mono'", color: item.color }}>{item.value}</div>
          </Card>
        ))}
      </div>

      {/* Contribution Calendar */}
      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>연습 활동</h2>
      <Card className="p-4 mb-8 overflow-x-auto">
        <ContributionCalendar dailyStats={stats.dailyStats} />
      </Card>

      {/* Overall */}
      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>전체 기록</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { label: '총 세션', value: stats.totalSessions, icon: BarChart3 },
          { label: '총 연습 시간', value: formatTime(stats.totalPracticeTime), icon: Timer },
          { label: '최고 타수', value: `${Math.round(stats.bestKpm)} 타/분`, icon: Trophy },
          { label: '최고 정확도', value: `${stats.bestAccuracy.toFixed(1)}%`, icon: Target },
          { label: '평균 타수', value: `${Math.round(stats.avgKpm)} 타/분`, icon: TrendingUp },
          { label: '평균 정확도', value: `${stats.avgAccuracy.toFixed(1)}%`, icon: CheckCircle },
          { label: '연속 연습', value: `${progress.streakDays}일`, icon: Flame },
          { label: '총 키 입력', value: stats.totalKeystrokes.toLocaleString(), icon: Keyboard },
        ].map((item, i) => (
          <Card key={item.label} className="p-3 slide-up" style={{ animationDelay: `${i * 0.04}s`, opacity: 0 }}>
            <div className="flex items-center gap-1.5">
              <item.icon className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
            </div>
            <div className="text-lg font-bold mt-1" style={{ fontFamily: "'JetBrains Mono'" }}>{item.value}</div>
          </Card>
        ))}
      </div>

      {/* Speed History Chart */}
      {stats.dailyStats.length > 1 && (
        <>
          <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>일별 평균 속도</h2>
          <Card className="p-4 mb-8">
            <div className="h-40 flex items-end gap-[2px]">
              {stats.dailyStats.slice(-30).map((d, i) => {
                const max = Math.max(...stats.dailyStats.slice(-30).map(x => x.avgSpeed), 1);
                const h = (d.avgSpeed / max) * 100;
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-t-sm transition-all"
                    style={{
                      height: `${h}%`,
                      background: 'linear-gradient(to top, var(--color-primary), var(--color-secondary))',
                      opacity: 0.4 + (h / 100) * 0.6,
                    }}
                    title={`${d.date}: ${Math.round(d.avgSpeed)} 타/분`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>{stats.dailyStats.slice(-30)[0]?.date}</span>
              <span>{stats.dailyStats.slice(-1)[0]?.date}</span>
            </div>
          </Card>
        </>
      )}

      {/* Achievements */}
      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>업적</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {ACHIEVEMENTS_LIST.map((ach, i) => {
          const unlocked = stats.achievements.includes(ach.key);
          return (
            <Card
              key={ach.key}
              className={`p-3 text-center transition-all duration-300 slide-up ${unlocked ? '' : 'grayscale'}`}
              style={{
                opacity: unlocked ? 1 : 0.35,
                animationDelay: `${i * 0.03}s`,
              }}
            >
              <div className={`flex justify-center mb-1 ${unlocked ? 'bounce-in' : ''}`}>
                <DataIcon name={ach.icon} className="w-7 h-7" />
              </div>
              <div className="text-xs font-bold">{ach.title}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{ach.description}</div>
              {unlocked && (
                <div className="text-[10px] mt-1" style={{ color: 'var(--color-success)' }}>해금됨 ✓</div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
