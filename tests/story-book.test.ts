import { describe, it, expect } from 'vitest';
import script from '@/lib/story/story.json';
import { loadBook, addGame, starsFor, busStage, flatOf, STOPS, STORY_KEY } from '@/lib/story/book';
import { beatsDue } from '@/lib/story/story.js';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe('타비의 버스(이야기·성장 장부)', () => {
  it('별 = 정확도 문턱 · 단어 5개 미만은 0(찍기 방지)', () => {
    expect(starsFor({ accuracy: 100, wordsTyped: 3 })).toBe(0);
    expect(starsFor({ accuracy: 79, wordsTyped: 20 })).toBe(0);
    expect(starsFor({ accuracy: 85, wordsTyped: 20 })).toBe(1);
    expect(starsFor({ accuracy: 92, wordsTyped: 20 })).toBe(2);
    expect(starsFor({ accuracy: 98, wordsTyped: 20 })).toBe(3);
  });
  it('첫 실행 = 프롤로그 · 정류장 별 3개면 그 정류장 이야기가 열린다', () => {
    const b = loadBook(mem());
    expect(beatsDue(script, flatOf(b))[0]).toBe('prologue');
    b.first = 0; b.storySeen.prologue = 1;
    addGame(b, { gameType: 'rain', accuracy: 98, wordsTyped: 10 });
    expect(beatsDue(script, flatOf(b))).toContain('stop_rain');
    expect(beatsDue(script, flatOf(b))).not.toContain('stop_space');
  });
  it('버스 4단계(0·25·70·140 별) · 마지막은 화해 끝맺음', () => {
    const b = loadBook(mem());
    b.growth.xp = 24; expect(busStage(b)).toBe(0);
    const ev = addGame(b, { gameType: 'race', accuracy: 98, wordsTyped: 10 }).events;
    expect(busStage(b)).toBe(1); expect(ev.some((e) => e.type === 'stageUp')).toBe(true);
    b.growth.xp = 140; expect(busStage(b)).toBe(3);
    expect(beatsDue(script, flatOf(b))).toContain('finale');
    expect(script.beats.find((x) => x.id === 'finale')?.ending).toBe(true);
  });
  it('정류장 6곳 모두 이야기가 있다 · 깨진 장부는 새 장부', () => {
    for (const s of STOPS) expect(script.beats.some((x) => x.id === `stop_${s}`)).toBe(true);
    const m = mem(); m.setItem(STORY_KEY, '{"growth":{"xp":{"valueOf":null}},"storySeen":[1]}');
    expect(loadBook(m).growth.xp).toBe(0);
  });
});
