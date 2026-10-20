'use client';
import { Trophy } from 'lucide-react';

import { useEffect } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useStatsStore } from '@/stores/useStatsStore';

const SpaceIcon = () => (
  <svg viewBox="0 0 64 64" width="48" height="48">
    <defs><linearGradient id="si" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#A29BFE"/><stop offset="100%" stopColor="#6C5CE7"/></linearGradient></defs>
    <rect width="64" height="64" rx="14" fill="#0A0A2E"/>
    <circle cx="10" cy="10" r="1" fill="#E8E8FF" opacity="0.6"/>
    <circle cx="54" cy="8" r="1" fill="#A29BFE" opacity="0.5"/>
    <circle cx="48" cy="50" r="0.8" fill="#E8E8FF" opacity="0.4"/>
    <g transform="translate(32,35)">
      <polygon points="0,-16 -11,10 0,5 11,10" fill="url(#si)"/>
      <polygon points="0,-16 -6,4 0,7 6,4" fill="#8B7CF7"/>
      <polygon points="0,-12 -3,-3 0,-1 3,-3" fill="#48DBFB"/>
      <ellipse cx="0" cy="13" rx="4" ry="7" fill="#6C5CE7" opacity="0.4"/>
    </g>
  </svg>
);

const RainIcon = () => (
  <svg viewBox="0 0 64 64" width="48" height="48">
    <rect width="64" height="64" rx="14" fill="#0A0A2E"/>
    <line x1="15" y1="8" x2="13" y2="24" stroke="#6C5CE7" strokeWidth="1.5" opacity="0.6"/>
    <line x1="32" y1="5" x2="30" y2="21" stroke="#A29BFE" strokeWidth="1.5" opacity="0.5"/>
    <line x1="49" y1="10" x2="47" y2="26" stroke="#6C5CE7" strokeWidth="1.5" opacity="0.7"/>
    <line x1="24" y1="16" x2="22" y2="30" stroke="#A29BFE" strokeWidth="1" opacity="0.4"/>
    <line x1="40" y1="14" x2="38" y2="28" stroke="#6C5CE7" strokeWidth="1" opacity="0.5"/>
    <rect x="14" y="34" width="36" height="18" rx="4" fill="#1A1A4E" stroke="#6C5CE7" strokeWidth="1.2"/>
    <text x="32" y="47" textAnchor="middle" fill="#00D2D3" fontSize="12" fontFamily="monospace" fontWeight="bold">ABC</text>
  </svg>
);

const RaceIcon = () => (
  <svg viewBox="0 0 64 64" width="48" height="48">
    <rect width="64" height="64" rx="14" fill="#0A0A2E"/>
    <g transform="translate(32,30)">
      <rect x="-15" y="-6" width="30" height="12" rx="3" fill="#6C5CE7"/>
      <rect x="-18" y="-3" width="5" height="6" rx="1.5" fill="#A29BFE"/>
      <rect x="13" y="-3" width="5" height="6" rx="1.5" fill="#A29BFE"/>
      <rect x="-12" y="-9" width="24" height="6" rx="2" fill="#4A3FAF"/>
      <rect x="-8" y="-8" width="7" height="4" rx="1" fill="rgba(72,219,251,0.5)"/>
      <rect x="1" y="-8" width="7" height="4" rx="1" fill="rgba(72,219,251,0.5)"/>
      <circle cx="-9" cy="8" r="3" fill="#333" stroke="#555" strokeWidth="0.8"/>
      <circle cx="9" cy="8" r="3" fill="#333" stroke="#555" strokeWidth="0.8"/>
    </g>
    <text x="32" y="54" textAnchor="middle" fill="#FECA57" fontSize="7" fontFamily="monospace" fontWeight="bold">RACE</text>
  </svg>
);

const DefenseIcon = () => (
  <svg viewBox="0 0 64 64" width="48" height="48">
    <rect width="64" height="64" rx="14" fill="#0A0A2E"/>
    <g transform="translate(32,34)">
      <rect x="-12" y="-14" width="24" height="28" fill="#4A3FAF"/>
      <rect x="-16" y="-22" width="8" height="36" fill="#4A3FAF"/>
      <rect x="8" y="-22" width="8" height="36" fill="#4A3FAF"/>
      <polygon points="-16,-22 -12,-30 -8,-22" fill="#6C5CE7"/>
      <polygon points="8,-22 12,-30 16,-22" fill="#6C5CE7"/>
      <rect x="-5" y="4" width="10" height="10" rx="5" fill="#1A1A3E"/>
      <rect x="-4" y="-8" width="3" height="4" fill="rgba(254,202,87,0.5)"/>
      <rect x="1" y="-8" width="3" height="4" fill="rgba(254,202,87,0.5)"/>
      <line x1="0" y1="-22" x2="0" y2="-34" stroke="#A29BFE" strokeWidth="1.5"/>
      <polygon points="0,-34 8,-29 0,-24" fill="#6C5CE7"/>
    </g>
  </svg>
);

const ZombieIcon = () => (
  <svg viewBox="0 0 64 64" width="48" height="48">
    <rect width="64" height="64" rx="14" fill="#0A0A1A"/>
    <g transform="translate(32,32)">
      <circle cx="0" cy="-8" r="10" fill="#00B894" opacity="0.8"/>
      <rect x="-7" y="2" width="14" height="14" fill="#00B894" opacity="0.7"/>
      <circle cx="-3" cy="-10" r="2" fill="#FF0000"/>
      <circle cx="3" cy="-10" r="2" fill="#FF0000"/>
      <line x1="-8" y1="6" x2="-16" y2="10" stroke="#00B894" strokeWidth="2.5" opacity="0.6"/>
      <line x1="8" y1="6" x2="16" y2="8" stroke="#00B894" strokeWidth="2.5" opacity="0.6"/>
    </g>
  </svg>
);

const PuzzleIcon = () => (
  <svg viewBox="0 0 64 64" width="48" height="48">
    <rect width="64" height="64" rx="14" fill="#0A0A2E"/>
    <g transform="translate(32,32)">
      <circle cx="-12" cy="0" r="8" fill="none" stroke="#6C5CE7" strokeWidth="2"/>
      <circle cx="12" cy="0" r="8" fill="none" stroke="#00D2D3" strokeWidth="2"/>
      <line x1="-4" y1="0" x2="4" y2="0" stroke="#A29BFE" strokeWidth="2"/>
      <text x="-12" y="3" textAnchor="middle" fill="#6C5CE7" fontSize="8" fontFamily="monospace" fontWeight="bold">A</text>
      <text x="12" y="3" textAnchor="middle" fill="#00D2D3" fontSize="8" fontFamily="monospace" fontWeight="bold">B</text>
    </g>
  </svg>
);

export default function GamePage() {
  const { settings } = useSettingsStore();
  const { stats, loadStats } = useStatsStore();
  const isKorean = settings.language === 'ko';

  // 하이드레이션은 반드시 effect에서 — 렌더 중에 스토어를 갱신하면
  // set → 리렌더 → 다시 호출로 무한 루프가 될 수 있다(React #185).
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const games = [
    { href: '/game/rain', icon: <RainIcon />, title: isKorean ? '씨앗비' : 'Seed Rain', desc: isKorean ? '떨어지는 씨앗 단어를 쳐서 화분에 심어요' : 'Type falling seed words to plant them', difficulty: isKorean ? '쉬움~어려움' : 'Easy~Hard' },
    { href: '/game/space', icon: <SpaceIcon />, title: isKorean ? '우주 방어' : 'Space Defense', desc: isKorean ? '적 우주선의 단어를 입력해서 격파하세요' : 'Destroy enemy ships by typing', difficulty: isKorean ? '보통~어려움' : 'Medium~Hard' },
    { href: '/game/race', icon: <RaceIcon />, title: isKorean ? '타이핑 레이스' : 'Typing Race', desc: isKorean ? 'AI 라이벌과 타이핑 속도 대결' : 'Race against AI opponents', difficulty: isKorean ? '보통' : 'Medium' },
    { href: '/game/defense', icon: <DefenseIcon />, title: isKorean ? '킹덤 디펜스' : 'Kingdom Defense', desc: isKorean ? '성을 지키며 타이핑하는 전략 게임' : 'Defend your castle with typing', difficulty: isKorean ? '어려움' : 'Hard' },
    { href: '/game/zombie', icon: <ZombieIcon />, title: isKorean ? '좀비 서바이벌' : 'Zombie Survival', desc: isKorean ? '좀비를 물리치며 생존하기' : 'Survive the zombie horde', difficulty: isKorean ? '어려움' : 'Hard' },
    { href: '/game/puzzle', icon: <PuzzleIcon />, title: isKorean ? '끝말잇기' : 'Word Chain', desc: isKorean ? '마지막 글자로 시작하는 단어를 이어가세요' : 'Chain words by their last letter', difficulty: isKorean ? '쉬움~보통' : 'Easy~Medium' },
  ];

  // Map game type to high score key
  const gameScoreKeys: Record<string, string> = {
    '/game/rain': 'rain',
    '/game/space': 'space',
    '/game/race': 'race',
    '/game/defense': 'defense',
    '/game/zombie': 'zombie',
    '/game/puzzle': 'puzzle',
  };

  return (
    <div className="max-w-[1000px] mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2 gradient-text" style={{ fontFamily: "'Outfit', sans-serif" }}>
        {isKorean ? '게임 모드' : 'Game Modes'}
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
        {isKorean ? '재미있게 타이핑 실력을 키우세요' : 'Improve your typing skills with fun games'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {games.map((game, i) => {
          const scoreKey = gameScoreKeys[game.href];
          const highScore = scoreKey && stats.gameHighScores ? (stats.gameHighScores as Record<string, number>)[scoreKey] : undefined;
          return (
            <Link key={game.href} href={game.href} className="no-underline">
              <Card hoverable className="p-6 h-full slide-up" style={{ animationDelay: `${i * 0.06}s`, opacity: 0 }}>
                <div className="mb-3">{game.icon}</div>
                <h2 className="text-lg font-bold mb-1" style={{ fontFamily: "'Outfit', sans-serif" }}>{game.title}</h2>
                <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{game.desc}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(108,92,231,0.2)', color: 'var(--color-primary-light)' }}>
                    {game.difficulty}
                  </span>
                  {highScore != null && highScore > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(254,202,87,0.2)', color: 'var(--color-accent-warm)' }}>
                      <Trophy className="inline w-3 h-3 align-[-2px]" aria-hidden /> {highScore}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
