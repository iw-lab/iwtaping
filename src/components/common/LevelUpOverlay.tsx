'use client';

import { useEffect, useState } from 'react';
import { useProgressStore, Reward } from '@/stores/useProgressStore';
import { Button } from '../ui/Button';
import { getConfetti } from '@/lib/effects/confetti';
import { Mascot } from '../mascot/Mascot';
import { DataIcon } from './DataIcon';

export function LevelUpOverlay() {
  const { progress, clearLevelUp, clearRewards } = useProgressStore();
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<'level' | 'rewards' | 'none'>('none');

  useEffect(() => {
    if (progress.pendingLevelUp) {
      setPhase('level');
      setVisible(true);
      // Fire confetti
      try { getConfetti().burst(100); } catch {}
    }
  }, [progress.pendingLevelUp]);

  const handleContinue = () => {
    if (progress.pendingRewards.length > 0 && phase === 'level') {
      setPhase('rewards');
    } else {
      setVisible(false);
      setPhase('none');
      clearLevelUp();
      clearRewards();
    }
  };

  if (!visible || !progress.pendingLevelUp) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
    >
      {phase === 'level' && (
        <div className="text-center bounce-in">
          <Mascot mood="cheering" size={100} />
          <div className="mt-4">
            <div className="text-sm font-medium" style={{ color: 'var(--color-secondary)' }}>LEVEL UP!</div>
            <div
              className="text-7xl font-extrabold mt-2 gradient-text"
              style={{ fontFamily: "'Outfit', sans-serif" }}
            >
              {progress.pendingLevelUp}
            </div>
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              축하해요! 레벨 {progress.pendingLevelUp}에 도달했어요!
            </p>
          </div>
          <Button size="lg" className="mt-6" onClick={handleContinue}>
            {progress.pendingRewards.length > 0 ? '보상 확인' : '계속하기'}
          </Button>
        </div>
      )}

      {phase === 'rewards' && (
        <div className="text-center bounce-in max-w-sm w-full px-4">
          <div className="text-lg font-bold mb-4" style={{ color: 'var(--color-accent-warm)' }}>
            보상 획득!
          </div>
          <div className="space-y-3">
            {progress.pendingRewards.map((reward, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-xl slide-up"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--key-border)',
                  animationDelay: `${i * 0.1}s`,
                }}
              >
                <DataIcon name={reward.icon} className="w-7 h-7 shrink-0" />
                <div className="text-left">
                  <div className="text-sm font-bold">{reward.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {reward.type === 'accessory' ? '마스코트 액세서리' :
                     reward.type === 'title' ? '칭호' :
                     reward.type === 'coins' ? '코인 보상' : '테마'}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Button size="lg" className="mt-6" onClick={handleContinue}>
            확인
          </Button>
        </div>
      )}
    </div>
  );
}
