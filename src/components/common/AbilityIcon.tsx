'use client';

import { Snowflake, Zap, Heart, type LucideIcon } from 'lucide-react';
import type { Ability } from '@/lib/game/special-words';

const ICONS: Record<Ability, LucideIcon> = {
  freeze: Snowflake,
  clear: Zap,
  heal: Heart,
};

/** 우주 방어·좀비·디펜스 공용 — 특수능력 발동 배지에 쓰는 아이콘(얼음·제거·회복). */
export function AbilityIcon({ ability, className }: { ability: Ability; className?: string }) {
  const Icon = ICONS[ability];
  return <Icon className={className} aria-hidden />;
}
