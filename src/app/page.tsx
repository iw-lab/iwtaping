'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Mascot } from '@/components/mascot/Mascot';
import { DailyQuests } from '@/components/quests/DailyQuests';
import { StreakCard } from '@/components/progress/StreakCard';
import { XPBarDetailed } from '@/components/common/XPBar';
import { useProgressStore } from '@/stores/useProgressStore';
import { useStatsStore } from '@/stores/useStatsStore';
import { useMascotStore } from '@/stores/useMascotStore';
import { getDailyChallenge, getChallengeStatus } from '@/lib/challenge/daily-challenge';
import { formatTime, getToday } from '@/lib/utils/helpers';
import { CloudRain, Rocket, CarFront, Castle, Skull, Link2, Keyboard, Gamepad2, Globe, BookOpen, Coins, Star } from 'lucide-react';
import { DataIcon } from '@/components/common/DataIcon';

const SLOGAN = '손끝으로 여는 무한한 세계';

const practiceCards = [
  { href: '/practice/position', icon: <PracticeIcon type="position" />, title: '자리 연습', desc: '홈키부터 전체 키보드까지', tag: '기초' },
  { href: '/practice/adaptive', icon: <PracticeIcon type="speed" />, title: '맞춤 드릴', desc: '자주 틀리는 키 집중 교정', tag: '추천' },
  { href: '/practice/word', icon: <PracticeIcon type="word" />, title: '낱말 연습', desc: '초급/중급/고급 낱말', tag: '필수' },
  { href: '/practice/short', icon: <PracticeIcon type="short" />, title: '짧은 글', desc: '속담, 명언, 일상 문장', tag: '인기' },
  { href: '/practice/long', icon: <PracticeIcon type="long" />, title: '긴 글', desc: '문학, 에세이 필사', tag: null },
  { href: '/practice/code', icon: <PracticeIcon type="code" />, title: '코드 타이핑', desc: 'Python, JS, HTML', tag: null },
  { href: '/test/speed', icon: <PracticeIcon type="speed" />, title: '속도 테스트', desc: '실력 측정', tag: '도전' },
];

const gameCards = [
  { href: '/game/rain', icon: CloudRain, title: '산성비', desc: '떨어지는 단어 격파', color: '#6C5CE7' },
  { href: '/game/space', icon: Rocket, title: '우주 방어', desc: '적 우주선 파괴', color: '#48DBFB' },
  { href: '/game/race', icon: CarFront, title: '타이핑 레이스', desc: 'AI와 속도 대결', color: '#FECA57' },
  { href: '/game/defense', icon: Castle, title: '킹덤 디펜스', desc: '성 방어 타이핑', color: '#00B894' },
  { href: '/game/zombie', icon: Skull, title: '좀비 서바이벌', desc: '좀비 물리치기', color: '#FF6B6B' },
  { href: '/game/puzzle', icon: Link2, title: '끝말잇기', desc: '단어 연결 게임', color: '#FD79A8' },
];

export default function Home() {
  const [sloganText, setSloganText] = useState('');
  const { progress, loadProgress, checkStreak } = useProgressStore();
  const { stats, loadStats } = useStatsStore();
  const { loadMascot } = useMascotStore();

  const challenge = getDailyChallenge();
  // localStorage 접근은 마운트 이후로 미룬다 (정적 프리렌더와 값이 달라 hydration mismatch가 났음)
  const [challengeStatus, setChallengeStatus] = useState<{ completed: boolean; stars: number }>({
    completed: false,
    stars: 0,
  });

  useEffect(() => {
    loadProgress();
    loadStats();
    loadMascot();
    checkStreak();
    setChallengeStatus(getChallengeStatus());
  }, [loadProgress, loadStats, loadMascot, checkStreak]);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      if (i <= SLOGAN.length) {
        setSloganText(SLOGAN.slice(0, i));
        i++;
      } else {
        clearInterval(interval);
      }
    }, 80);
    return () => clearInterval(interval);
  }, []);

  const todayStats = stats.dailyStats.find(d => d.date === getToday());

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      {/* Hero Section with Mascot */}
      <section className="relative text-center py-12 md:py-16 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-10 left-[10%] w-32 h-32 rounded-full opacity-10 blur-3xl" style={{ background: 'var(--color-primary)' }} />
          <div className="absolute top-20 right-[15%] w-24 h-24 rounded-full opacity-10 blur-3xl" style={{ background: 'var(--color-secondary)' }} />
          <div className="absolute bottom-0 left-[40%] w-40 h-40 rounded-full opacity-5 blur-3xl" style={{ background: 'var(--color-combo)' }} />
        </div>

        <div className="relative z-10">
          {/* Mascot */}
          <div className="flex justify-center mb-6">
            <Mascot mood="happy" size={90} showBubble />
          </div>

          <h1
            className="text-4xl md:text-6xl font-extrabold mb-3 gradient-text"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            TypingVerse
          </h1>
          <p className="text-lg md:text-xl h-8" style={{ color: 'var(--text-secondary)', fontFamily: "'Noto Sans KR', sans-serif" }}>
            {sloganText}
            <span className="caret-blink" style={{ borderRight: '2px solid var(--color-secondary)' }}>&nbsp;</span>
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/practice">
              <Button variant="gradient" size="lg">연습 시작</Button>
            </Link>
            <Link href="/game">
              <Button variant="secondary" size="lg">게임 플레이</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Daily quests + streak — 매일 돌아올 이유 */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <DailyQuests className="md:col-span-2" />
        <StreakCard />
      </section>

      {/* Dashboard Row */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {/* Today's stats */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>오늘의 기록</h3>
            <Link href="/stats" className="text-sm font-medium no-underline" style={{ color: 'var(--color-primary)' }}>더보기</Link>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-primary)' }}>
                {todayStats ? formatTime(todayStats.totalPracticeSeconds) : '00:00'}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>연습 시간</div>
            </div>
            <div>
              <div className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-secondary)' }}>
                {Math.round(todayStats?.avgSpeed || 0)}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>평균 타수</div>
            </div>
            <div>
              <div className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-success)' }}>
                {(todayStats?.avgAccuracy || 0).toFixed(0)}%
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>정확도</div>
            </div>
          </div>
        </Card>

        {/* XP Progress */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>내 성장</h3>
            <div className="flex items-center gap-2">
              {progress.streakDays > 0 && (
                <span className="flex items-center gap-1 text-xs">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1C8 1 3 6 3 9.5C3 12.5 5.2 14.5 8 14.5C10.8 14.5 13 12.5 13 9.5C13 6 8 1 8 1Z" fill="#FF6B6B"/>
                    <path d="M8 5C8 5 5.5 8 5.5 10C5.5 11.7 6.6 12.5 8 12.5C9.4 12.5 10.5 11.7 10.5 10C10.5 8 8 5 8 5Z" fill="#FECA57"/>
                  </svg>
                  <span style={{ color: '#FECA57', fontFamily: "'JetBrains Mono'", fontWeight: 'bold' }}>{progress.streakDays}일</span>
                </span>
              )}
            </div>
          </div>
          <XPBarDetailed />
          <div className="flex items-center justify-between mt-3">
            <span className="flex items-center gap-1 text-xs">
              <Coins className="w-3.5 h-3.5" style={{ color: 'var(--color-accent-warm)' }} />
              <span style={{ color: 'var(--color-accent-warm)', fontFamily: "'JetBrains Mono'", fontWeight: 'bold' }}>{progress.coins}</span>
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              총 {progress.totalXpEarned} XP 획득
            </span>
          </div>
        </Card>

        {/* Daily Challenge */}
        <Link href="/challenge" className="no-underline">
          <Card hoverable variant="glow" className="p-4 h-full relative overflow-hidden">
            {!challengeStatus.completed && (
              <div className="absolute top-2 right-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--color-accent)' }} />
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--color-accent)' }} />
                </span>
              </div>
            )}
            <h3 className="text-sm font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>오늘의 챌린지</h3>
            <div className="flex items-center gap-3 mb-2">
              <DataIcon name={challenge.icon} className="w-7 h-7" style={{ color: 'var(--color-primary)' }} />
              <div>
                <div className="text-base font-bold">{challenge.title}</div>
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {challenge.target}{challenge.unit} 달성
                </div>
              </div>
            </div>
            {challengeStatus.completed ? (
              <div className="flex items-center gap-1">
                {[1, 2, 3].map(s => (
                  <Star
                    key={s}
                    className="w-3.5 h-3.5"
                    style={{ opacity: s <= challengeStatus.stars ? 1 : 0.2 }}
                    fill={s <= challengeStatus.stars ? '#FECA57' : 'none'}
                    color="#FECA57"
                  />
                ))}
                <span className="text-xs ml-1" style={{ color: 'var(--color-success)' }}>완료!</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(108,92,231,0.2)', color: 'var(--color-primary-light)' }}>
                  +{challenge.xpReward} XP
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(254,202,87,0.2)', color: 'var(--color-accent-warm)' }}>
                  +{challenge.coinReward} 코인
                </span>
              </div>
            )}
          </Card>
        </Link>
      </section>

      {/* Practice Modes */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold" style={{ fontFamily: "'Outfit'" }}>연습 모드</h2>
          <Link href="/practice" className="text-sm font-medium no-underline" style={{ color: 'var(--color-primary)' }}>전체 보기</Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {practiceCards.map((card, i) => (
            <Link key={card.href} href={card.href} className="no-underline">
              <Card hoverable className="p-4 h-full text-center slide-up" style={{ animationDelay: `${i * 0.05}s`, opacity: 0 }}>
                <div className="flex justify-center mb-2">{card.icon}</div>
                <h3 className="text-base font-bold mb-0.5" style={{ fontFamily: "'Outfit'" }}>{card.title}</h3>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{card.desc}</p>
                {card.tag && (
                  <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(108,92,231,0.15)', color: 'var(--color-primary-light)' }}>
                    {card.tag}
                  </span>
                )}
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Game Modes */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold" style={{ fontFamily: "'Outfit'" }}>게임 모드</h2>
          <Link href="/game" className="text-sm font-medium no-underline" style={{ color: 'var(--color-primary)' }}>전체 보기</Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {gameCards.map((card, i) => (
            <Link key={card.href} href={card.href} className="no-underline">
              <Card hoverable className="p-4 h-full text-center slide-up" style={{ animationDelay: `${(i + 6) * 0.05}s`, opacity: 0 }}>
                <div className="flex justify-center mb-2"><card.icon className="w-7 h-7" style={{ color: card.color }} /></div>
                <h3 className="text-base font-bold mb-0.5" style={{ fontFamily: "'Outfit'" }}>{card.title}</h3>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{card.desc}</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Bottom stats */}
      <section className="text-center py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: '연습 모드', value: '5가지', icon: Keyboard },
            { label: '게임', value: '6종', icon: Gamepad2 },
            { label: '언어', value: '한/영', icon: Globe },
            { label: '연습 콘텐츠', value: '2000+', icon: BookOpen },
          ].map((stat) => (
            <Card key={stat.label} className="p-3">
              <div className="flex justify-center mb-1"><stat.icon className="w-5 h-5" style={{ color: 'var(--text-muted)' }} /></div>
              <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-secondary)' }}>
                {stat.value}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{stat.label}</div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

// SVG practice icons
function PracticeIcon({ type }: { type: string }) {
  const size = 36;
  const iconMap: Record<string, React.ReactNode> = {
    position: (
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <rect width="40" height="40" rx="10" fill="rgba(108,92,231,0.15)" />
        <rect x="6" y="22" width="7" height="6" rx="1.5" fill="#6C5CE7" opacity="0.5" />
        <rect x="14" y="22" width="7" height="6" rx="1.5" fill="#00D2D3" />
        <rect x="22" y="22" width="7" height="6" rx="1.5" fill="#00D2D3" />
        <rect x="10" y="14" width="7" height="6" rx="1.5" fill="#6C5CE7" opacity="0.5" />
        <rect x="18" y="14" width="7" height="6" rx="1.5" fill="#6C5CE7" opacity="0.5" />
        <rect x="26" y="14" width="7" height="6" rx="1.5" fill="#6C5CE7" opacity="0.5" />
        <circle cx="17.5" cy="25" r="1.5" fill="white" opacity="0.8" />
        <circle cx="25.5" cy="25" r="1.5" fill="white" opacity="0.8" />
      </svg>
    ),
    word: (
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <rect width="40" height="40" rx="10" fill="rgba(0,210,211,0.15)" />
        <text x="20" y="26" textAnchor="middle" fill="#00D2D3" fontSize="14" fontFamily="'JetBrains Mono'" fontWeight="bold">가</text>
      </svg>
    ),
    short: (
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <rect width="40" height="40" rx="10" fill="rgba(253,121,168,0.15)" />
        <rect x="8" y="14" width="18" height="2" rx="1" fill="#FD79A8" opacity="0.8" />
        <rect x="8" y="19" width="24" height="2" rx="1" fill="#FD79A8" opacity="0.5" />
        <rect x="8" y="24" width="14" height="2" rx="1" fill="#FD79A8" opacity="0.3" />
      </svg>
    ),
    long: (
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <rect width="40" height="40" rx="10" fill="rgba(0,184,148,0.15)" />
        <rect x="8" y="10" width="24" height="2" rx="1" fill="#00B894" opacity="0.6" />
        <rect x="8" y="15" width="22" height="2" rx="1" fill="#00B894" opacity="0.5" />
        <rect x="8" y="20" width="24" height="2" rx="1" fill="#00B894" opacity="0.4" />
        <rect x="8" y="25" width="18" height="2" rx="1" fill="#00B894" opacity="0.3" />
        <rect x="8" y="30" width="24" height="2" rx="1" fill="#00B894" opacity="0.2" />
      </svg>
    ),
    code: (
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <rect width="40" height="40" rx="10" fill="rgba(72,219,251,0.15)" />
        <text x="12" y="24" fill="#48DBFB" fontSize="10" fontFamily="'JetBrains Mono'" fontWeight="bold">&lt;/&gt;</text>
      </svg>
    ),
    speed: (
      <svg viewBox="0 0 40 40" width={size} height={size}>
        <rect width="40" height="40" rx="10" fill="rgba(254,202,87,0.15)" />
        <path d="M20 10 L23 22 L17 22 Z" fill="#FECA57" opacity="0.9" />
        <path d="M20 18 L22 26 L14 22 Z" fill="#FECA57" opacity="0.7" />
      </svg>
    ),
  };

  return iconMap[type] || null;
}
