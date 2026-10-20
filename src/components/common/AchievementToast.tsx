'use client';

import { useEffect, useState } from 'react';
import { useAchievementToast } from '@/stores/useAchievementToast';
import { DataIcon } from './DataIcon';

const DISPLAY_MS = 3600;

/**
 * 도전과제 달성 알림.
 * 여러 개가 동시에 열려도 큐로 하나씩 보여준다(겹쳐서 안 보이는 일 방지).
 */
export function AchievementToast() {
  const { queue, shift } = useAchievementToast();
  const [visible, setVisible] = useState(false);
  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    setVisible(true);
    const hide = setTimeout(() => setVisible(false), DISPLAY_MS - 300);
    const next = setTimeout(() => shift(), DISPLAY_MS);
    return () => {
      clearTimeout(hide);
      clearTimeout(next);
    };
  }, [current, shift]);

  if (!current) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-none"
      style={{
        bottom: visible ? '2rem' : '-6rem',
        opacity: visible ? 1 : 0,
        transition: 'bottom var(--transition-normal), opacity var(--transition-normal)',
      }}
      role="status"
      aria-live="polite"
    >
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--color-accent-warm)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <DataIcon name={current.icon} className="w-6 h-6 shrink-0" />
        <div>
          <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--color-accent-warm)' }}>
            도전과제 달성
          </div>
          <div className="text-sm font-bold">{current.title}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {current.description}
          </div>
        </div>
      </div>
    </div>
  );
}
