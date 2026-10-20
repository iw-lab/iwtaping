'use client';

import type { CSSProperties } from 'react';
import {
  Medal, Zap, Target, Flame, Trophy, Gem, Star, Crown, Rocket, Plane, Satellite,
  Hand, Link2, Sparkles, Timer, Hourglass, Clock, Pencil, BookOpen, Calendar,
  CalendarDays, CloudRain, CarFront, Award, Footprints, Moon, Bird, Globe,
  Gift, Coins, Wand2, Banknote, Shirt, Feather, Cat, Glasses, Heart,
  PartyPopper, Rainbow, ChefHat, Keyboard, Gamepad2, BarChart3, Settings,
  ShoppingBag, TrendingUp, CheckCircle, Wind, Dumbbell, Microscope,
  type LucideIcon,
} from 'lucide-react';

/**
 * 업적·퀘스트·챌린지·레벨업 보상·마스코트 액세서리·내비 등 "데이터로 들고 있는 아이콘
 * 이름(kebab-case)" → lucide-react 컴포넌트 매핑. 데이터는 이모지 글자 대신 이 이름을
 * 문자열로 들고, 그리는 쪽은 여기서 실제 아이콘을 가져와 그린다.
 */
const ICONS: Record<string, LucideIcon> = {
  medal: Medal, zap: Zap, target: Target, flame: Flame, trophy: Trophy, gem: Gem,
  star: Star, crown: Crown, rocket: Rocket, plane: Plane, satellite: Satellite,
  hand: Hand, 'link-2': Link2, sparkles: Sparkles, timer: Timer,
  hourglass: Hourglass, clock: Clock, pencil: Pencil, 'book-open': BookOpen,
  calendar: Calendar, 'calendar-days': CalendarDays, 'cloud-rain': CloudRain,
  'car-front': CarFront, award: Award, footprints: Footprints, moon: Moon,
  bird: Bird, globe: Globe, gift: Gift, coins: Coins, 'wand-2': Wand2,
  banknote: Banknote, shirt: Shirt, feather: Feather, cat: Cat, glasses: Glasses,
  heart: Heart, 'party-popper': PartyPopper, rainbow: Rainbow, 'chef-hat': ChefHat,
  keyboard: Keyboard, gamepad: Gamepad2, 'bar-chart': BarChart3, settings: Settings,
  'shopping-bag': ShoppingBag, 'trending-up': TrendingUp, 'check-circle': CheckCircle,
  wind: Wind, dumbbell: Dumbbell, microscope: Microscope,
};

/** `name` 이 등록된 아이콘이 아니면 아무것도 그리지 않는다(깨진 데이터로 화면이 비는 일은 없게). */
export function DataIcon({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  const Icon = ICONS[name];
  if (!Icon) return null;
  return <Icon className={className} style={style} aria-hidden />;
}
