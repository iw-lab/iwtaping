'use client';

import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { Trophy, type LucideIcon } from 'lucide-react';
import { getConfetti } from '@/lib/effects/confetti';

type CelebrationType = 'personal_best' | 'achievement' | 'challenge_complete' | 'streak';

/** 축하 배지에 쓰는 아이콘 이름 — 그리는 쪽(CelebrationOverlay)에서 lucide 컴포넌트로 바꾼다. */
type CelebrationIcon = 'trophy';

const CELEBRATION_ICONS: Record<CelebrationIcon, LucideIcon> = {
  trophy: Trophy,
};

interface CelebrationEvent {
  type: CelebrationType;
  title: string;
  subtitle?: string;
  icon?: CelebrationIcon;
}

interface CelebrationStore {
  event: CelebrationEvent | null;
  trigger: (event: CelebrationEvent) => void;
  clear: () => void;
}

export const useCelebrationStore = create<CelebrationStore>((set) => ({
  event: null,
  trigger: (event) => {
    set({ event });
    try { getConfetti().burst(60); } catch {}
  },
  clear: () => set({ event: null }),
}));

export function CelebrationOverlay() {
  const { event, clear } = useCelebrationStore();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (event) {
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        setTimeout(clear, 300);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [event, clear]);

  if (!event) return null;

  return (
    <div
      className={`fixed top-24 left-1/2 -translate-x-1/2 z-[90] px-6 py-4 rounded-2xl text-center ${show ? 'slide-down' : 'opacity-0 translate-y-[-20px]'}`}
      style={{
        background: 'var(--bg-card)',
        border: '2px solid var(--color-accent-warm)',
        boxShadow: '0 8px 32px rgba(254, 202, 87, 0.3)',
        transition: 'opacity 0.3s, transform 0.3s',
      }}
    >
      {event.icon && (
        <div className="flex justify-center mb-1">
          {(() => { const Icon = CELEBRATION_ICONS[event.icon]; return <Icon className="w-8 h-8" style={{ color: 'var(--color-accent-warm)' }} />; })()}
        </div>
      )}
      <div className="text-sm font-bold gradient-text-warm">{event.title}</div>
      {event.subtitle && (
        <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          {event.subtitle}
        </div>
      )}
    </div>
  );
}
