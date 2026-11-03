'use client';

import { useEffect } from 'react';
import { LevelUpOverlay } from './LevelUpOverlay';
import { CelebrationOverlay } from './CelebrationOverlay';
import { AchievementToast } from './AchievementToast';
import { ShopApplier } from '@/components/shop/ShopApplier';
import { AudioSettingsSync } from './AudioSettingsSync';
import { CrossTabSync } from './CrossTabSync';
import { useProgressStore } from '@/stores/useProgressStore';
import { useMascotStore } from '@/stores/useMascotStore';
import { useAccountStore } from '@/stores/useAccountStore';

export function GlobalOverlays() {
  const { loadProgress, checkStreak } = useProgressStore();
  const { loadMascot } = useMascotStore();
  const initAccount = useAccountStore((s) => s.init);

  useEffect(() => {
    loadProgress();
    loadMascot();
    checkStreak();
    // 서버 세션 복구 — 백엔드가 없으면 조용히 offline 상태가 된다.
    // (이 배선이 없으면 토큰이 발급되지 않아 백엔드 전체가 도달 불가였다)
    void initAccount();
  }, [loadProgress, loadMascot, checkStreak, initAccount]);

  return (
    <>
      <LevelUpOverlay />
      <CelebrationOverlay />
      <AchievementToast />
      <ShopApplier />
      <AudioSettingsSync />
      <CrossTabSync />
    </>
  );
}
