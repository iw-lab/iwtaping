'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { ThemeToggle } from '../common/ThemeToggle';
import { XPBar } from '../common/XPBar';
import { useProgressStore, xpToNextLevel } from '@/stores/useProgressStore';
import { DataIcon } from '../common/DataIcon';
import { Flame } from 'lucide-react';

/** icon 은 이모지 글자가 아니라 lucide-react 아이콘 이름(kebab-case) — DataIcon 이 그린다. */
const navItems = [
  { href: '/practice', label: '연습', icon: 'keyboard' },
  { href: '/test', label: '테스트', icon: 'timer' },
  { href: '/game', label: '게임', icon: 'gamepad' },
  { href: '/challenge', label: '챌린지', icon: 'trophy' },
  { href: '/ranking', label: '리그', icon: 'medal' },
  { href: '/shop', label: '상점', icon: 'shopping-bag' },
  { href: '/stats', label: '통계', icon: 'bar-chart' },
  { href: '/settings', label: '설정', icon: 'settings' },
];

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { progress, loadProgress, checkStreak } = useProgressStore();

  useEffect(() => {
    loadProgress();
    checkStreak();
  }, [loadProgress, checkStreak]);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--key-border)]"
      style={{
        // 글래스모피즘: 스크롤 콘텐츠가 비쳐 보이는 반투명 헤더
        background: 'color-mix(in srgb, var(--bg-secondary) 72%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <div className="max-w-[1400px] mx-auto h-[var(--header-height)] flex items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 no-underline min-h-[44px]">
          <span className="text-2xl font-extrabold neon-text" style={{ fontFamily: "'Outfit', sans-serif", color: 'var(--color-primary)' }}>
            TypingVerse
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center min-h-[44px] px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-200 no-underline ${
                  isActive
                    ? 'text-[var(--color-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                style={isActive ? { background: 'rgba(108,92,231,0.15)' } : {}}
              >
                <DataIcon name={item.icon} className="w-4 h-4 mr-1 inline" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {/* Streak */}
          {progress.streakDays > 0 && (
            <div className="hidden sm:flex items-center gap-1 streak-fire" title={`${progress.streakDays}일 연속!`}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 1C8 1 3 6 3 9.5C3 12.5 5.2 14.5 8 14.5C10.8 14.5 13 12.5 13 9.5C13 6 8 1 8 1Z" fill="#FF6B6B"/>
                <path d="M8 5C8 5 5.5 8 5.5 10C5.5 11.7 6.6 12.5 8 12.5C9.4 12.5 10.5 11.7 10.5 10C10.5 8 8 5 8 5Z" fill="#FECA57"/>
              </svg>
              <span className="text-sm font-bold" style={{ color: '#FECA57', fontFamily: "'JetBrains Mono'" }}>
                {progress.streakDays}
              </span>
            </div>
          )}

          {/* Level badge */}
          <div className="hidden sm:flex items-center gap-1.5">
            <span
              className="text-xs font-bold px-2 py-1 rounded-lg"
              style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))', color: 'white', boxShadow: '0 2px 8px rgba(108,92,231,0.35)' }}
            >
              Lv.{progress.level}
            </span>
          </div>

          {/* Coins */}
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg" title="코인" style={{ background: 'rgba(254,202,87,0.10)' }}>
            <DataIcon name="coins" className="w-4 h-4" style={{ color: 'var(--color-accent-warm)' }} />
            <span className="text-sm font-bold" style={{ color: 'var(--color-accent-warm)', fontFamily: "'JetBrains Mono'" }}>
              {progress.coins}
            </span>
          </div>

          <ThemeToggle />

          <button
            className="md:hidden p-2 rounded-lg min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* XP Bar */}
      <XPBar />

      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--key-border)]" style={{ background: 'var(--bg-secondary)' }}>
          {/* Mobile stats row */}
          <div className="flex items-center justify-around py-2 border-b border-[var(--key-border)]">
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'var(--color-primary)', color: 'white' }}>
                Lv.{progress.level}
              </span>
            </div>
            {progress.streakDays > 0 && (
              <div className="flex items-center gap-1">
                <Flame className="w-3.5 h-3.5" style={{ color: '#FECA57' }} />
                <span className="text-xs font-bold" style={{ color: '#FECA57' }}>{progress.streakDays}일</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <DataIcon name="coins" className="w-3.5 h-3.5" style={{ color: 'var(--color-accent-warm)' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--color-accent-warm)' }}>{progress.coins}</span>
            </div>
          </div>

          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-4 py-3 text-sm no-underline transition-colors"
              style={{ color: pathname?.startsWith(item.href) ? 'var(--color-primary)' : 'var(--text-secondary)' }}
              onClick={() => setMobileOpen(false)}
            >
              <DataIcon name={item.icon} className="w-4 h-4 mr-2 inline" />
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
