'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TypingArea, TypingAreaHandle } from '@/components/typing/TypingArea';
import { shuffleArray } from '@/lib/utils/helpers';
import { TypingResult } from '@/types/typing';
import { submitScore } from '@/lib/api/client';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { generateKoreanSentence, generateEnglishSentence } from '@/lib/content/word-generator';
import { fetchRaceGhosts, fetchLeaderboard } from '@/lib/api/client';
import { useGameBgm } from '@/hooks/useGameBgm';
import { useGameResult } from '@/hooks/useGameResult';

interface Car {
  name: string;
  progress: number;
  color: string;
  isPlayer: boolean;
  wpm?: number;        // 고스트: 재생할 실제(또는 합성) WPM
  finishMs?: number;   // 고스트: 현재 텍스트 완주까지 걸리는 시간
  isGhost?: boolean;
  isReal?: boolean;    // 실제 유저 기록이면 true, 합성 AI면 false
  seed?: number;       // 사람다운 페이스 흔들림용 시드
}

// 실제 고스트가 부족할 때 채우는 합성 AI. 같은 WPM→완주시간 모델을 공유한다.
// WPM = (문자수/5)/분 기준 — 한국어 초급~고급 대략치(폴백용).
const AI_GHOSTS = [
  { name: 'AI 초급', wpm: 22, color: '#48DBFB' },
  { name: 'AI 중급', wpm: 38, color: '#FECA57' },
  { name: 'AI 고급', wpm: 58, color: '#FF6B6B' },
];

const GHOST_COLORS = ['#1DD1A1', '#54A0FF', '#FF9FF3', '#FECA57', '#FF6B6B'];

/** 고스트 WPM으로 현재 텍스트(len 글자)를 완주하는 데 걸리는 시간(ms).
 *  WPM=(글자/5)/분 이므로 완주ms = (len/5)/WPM*60000 = len*12000/WPM.
 *  → 플레이어의 실제 WPM이 고스트 WPM보다 크면 이긴다(정확히 공정). */
const ghostFinishMs = (wpm: number, textLen: number): number =>
  (textLen * 12000) / Math.max(1, wpm);

export default function RaceGamePage() {
  const { settings } = useSettingsStore();
  const [status, setStatus] = useState<'menu' | 'countdown' | 'racing' | 'finished'>('menu');
  useGameBgm('action', status === 'countdown' || status === 'racing');
  const [text, setText] = useState('');
  const [cars, setCars] = useState<Car[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [playerProgress, setPlayerProgress] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const areaRef = useRef<TypingAreaHandle>(null);
  // 이 판의 타이핑 결과. 완주든 패배든 실제 타건에서 계산된 값만 담는다.
  const resultRef = useRef<TypingResult | null>(null);
  // 고스트가 먼저 골인해 강제 종료된 판인가 — 순위 제출·진행률 100% 처리를 건너뛴다.
  const lostRef = useRef(false);
  const isKorean = settings.language === 'ko';

  const loadText = async (): Promise<string> => {
    try {
      if (settings.language === 'ko') {
        const mod = await import('@/data/korean/sentences-short');
        const sentences = shuffleArray(mod.koreanSentencesShort).slice(0, 3);
        let t = sentences.map(s => s.text).join(' ');
        // Add procedurally generated sentences
        for (let i = 0; i < 2; i++) t += ' ' + generateKoreanSentence();
        setText(t);
        return t;
      } else {
        const mod = await import('@/data/english/sentences-short');
        const sentences = shuffleArray(mod.englishSentencesShort).slice(0, 3);
        let t = sentences.map(s => s.text).join(' ');
        for (let i = 0; i < 2; i++) t += ' ' + generateEnglishSentence();
        setText(t);
        return t;
      }
    } catch {
      const s = isKorean
        ? Array.from({ length: 5 }, () => generateKoreanSentence()).join(' ')
        : Array.from({ length: 5 }, () => generateEnglishSentence()).join(' ');
      setText(s);
      return s;
    }
  };

  /** 전국 레이스 순위에서 실제 유저 기록을 가져와 고스트 후보로 만든다.
   *  공개 순위(닉네임+WPM)만 읽으므로 개인정보·서버 쓰기·실시간 연결이 없다.
   *  네트워크 실패·무계정·기록 부족이면 빈 배열 → 합성 AI로 폴백. */
  const loadGhosts = async (): Promise<{ name: string; wpm: number; isReal: boolean }[]> => {
    try {
      // 1순위: 고스트 전용 엔드포인트(신규·미검증 기록 포함 → 소규모 유저풀에서도 실제 사람과 대결).
      let raw: { name: string; wpm: number }[] = [];
      const g = await fetchRaceGhosts(settings.language);
      if (g && g.length > 0) {
        raw = g.map(x => ({ name: x.nickname, wpm: Math.round(x.wpm) }));
      } else {
        // 2순위 폴백: 전국 순위(검증 완료 기록). value = WPM.
        const entries = await fetchLeaderboard('game:race', 'all');
        if (entries) raw = entries.filter(e => e.value > 0 && e.nickname).map(e => ({ name: e.nickname, wpm: Math.round(e.value) }));
      }
      const valid = raw.filter(r => r.wpm > 0 && r.name);
      if (valid.length === 0) return [];
      // WPM 내림차순 → 난이도 스펙트럼이 되도록 구간별로 1명씩 뽑는다(빠름/중간/이길만함).
      valid.sort((a, b) => b.wpm - a.wpm);
      const n = valid.length;
      const bands: [number, number][] = [
        [0, Math.max(1, Math.ceil(n * 0.2))],
        [Math.floor(n * 0.35), Math.max(1, Math.ceil(n * 0.6))],
        [Math.floor(n * 0.6), n],
      ];
      const picked: { name: string; wpm: number; isReal: boolean }[] = [];
      const usedNames = new Set<string>();
      for (const [lo, hi] of bands) {
        const range = valid.slice(lo, Math.max(lo + 1, hi)).filter(e => !usedNames.has(e.name));
        if (range.length === 0) continue;
        const pick = range[Math.floor(Math.random() * range.length)];
        usedNames.add(pick.name);
        picked.push({ name: pick.name, wpm: pick.wpm, isReal: true });
      }
      return picked;
    } catch {
      return [];
    }
  };

  const startRace = async () => {
    const raceText = await loadText();
    const L = raceText.length;
    const real = await loadGhosts();
    // 상대 3명 구성: 실제 유저 고스트 우선, 부족분만 합성 AI로 채운다.
    const opponents: { name: string; wpm: number; isReal: boolean; color: string }[] = [];
    real.slice(0, 3).forEach((g, i) => opponents.push({ ...g, color: GHOST_COLORS[i % GHOST_COLORS.length] }));
    for (const ai of AI_GHOSTS) {
      if (opponents.length >= 3) break;
      opponents.push({
        name: isKorean ? ai.name : ai.name.replace('AI 초급', 'AI Easy').replace('AI 중급', 'AI Medium').replace('AI 고급', 'AI Hard'),
        wpm: ai.wpm,
        isReal: false,
        color: ai.color,
      });
    }
    setCars([
      { name: isKorean ? '플레이어' : 'Player', progress: 0, color: '#6C5CE7', isPlayer: true },
      ...opponents.map((o, i) => ({
        name: o.name,
        progress: 0,
        color: o.color,
        isPlayer: false,
        wpm: o.wpm,
        finishMs: ghostFinishMs(o.wpm, L),
        isGhost: true,
        isReal: o.isReal,
        seed: i * 2.3 + 0.7,
      })),
    ]);
    setPlayerProgress(0);
    resultRef.current = null;
    lostRef.current = false;
    setStatus('countdown');
    setCountdown(3);
  };

  useEffect(() => {
    if (status !== 'countdown') return;
    if (countdown <= 0) { setStatus('racing'); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [status, countdown]);

  useEffect(() => {
    if (status !== 'racing') return;
    const startT = performance.now();
    intervalRef.current = setInterval(() => {
      const elapsed = performance.now() - startT;
      setCars(prev => {
        const updated = prev.map(car => {
          if (car.isPlayer || !car.finishMs) return car;
          // 고스트 진행률 = 경과/완주시간. 완주시간은 실제 WPM으로 계산되므로
          // 플레이어가 더 빠르면(=더 높은 WPM) 반드시 이긴다.
          const base = Math.min(100, (elapsed / car.finishMs) * 100);
          // 사람다운 페이스 흔들림 — 시작(0%)·끝(100%)에서 0이라 완주시간은 정확히 보존된다.
          const env = Math.sin((Math.PI * base) / 100);
          const noise = 3.5 * env * Math.sin(elapsed * 0.0016 + (car.seed ?? 0));
          const progress = Math.max(0, Math.min(100, base + noise));
          return { ...car, progress };
        });
        // 고스트가 먼저 100%면 레이스 종료(플레이어 패배)
        const anyFinished = updated.some(c => !c.isPlayer && c.progress >= 100);
        if (anyFinished) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setTimeout(() => {
            // 패배해도 여기까지 친 만큼은 실제 결과로 확정한다 — 그래야 일일 퀘스트
            // "게임 한 판"이 다른 5개 게임과 같은 기준으로 인정된다(정확도를 지어내지 않음).
            lostRef.current = true;
            areaRef.current?.finish();
            setStatus('finished');
          }, 0);
        }
        return updated;
      });
    }, 80);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [status]);

  const handleProgress = (progress: number) => {
    setPlayerProgress(progress);
    setCars(prev => prev.map(car => car.isPlayer ? { ...car, progress } : car));
    if (progress >= 100) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setStatus('finished');
    }
  };

  const handleComplete = (result: TypingResult) => {
    resultRef.current = result;
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (lostRef.current) {
      // 강제 종료(패배) — 진행률을 100으로 올리지도, 미완주 기록을 순위에 올리지도 않는다.
      setStatus('finished');
      return;
    }
    setCars(prev => prev.map(car => car.isPlayer ? { ...car, progress: 100 } : car));
    setStatus('finished');
    // 레이스는 실제 타이핑 — WPM으로 game:race 순위 제출(실제 타건 로그로 검증).
    void submitScore({
      mode: 'game:race',
      language: settings.language,
      kpm: result.kpm,
      accuracy: result.accuracy,
      score: Math.round(result.wpm),
      maxCombo: 0,
      elapsedMs: Math.round(result.elapsedTime * 1000),
      totalKeystrokes: result.totalKeystrokes,
      correctKeystrokes: result.correctKeystrokes,
      intervals: result.keyIntervals,
    });
  };

  const rank = [...cars].sort((a, b) => b.progress - a.progress);
  const playerRank = rank.findIndex(c => c.isPlayer) + 1;

  // 일일 퀘스트·도전과제 반영. 완주하지 못한 판(고스트가 먼저 골인)은 타이핑 결과가
  // 없으므로 기록하지 않는다 — 없는 정확도를 지어내지 않기 위해서다.
  // level은 achievements의 race_win 규칙(level >= 1)이 읽는 값이라 우승 시에만 1을 준다.
  useGameResult(status === 'finished', () => {
    const r = resultRef.current;
    if (!r || r.totalKeystrokes === 0) return null; // 한 글자도 안 친 판은 제외
    return {
      gameType: 'race' as const,
      score: Math.round(r.wpm),
      // lostRef를 함께 본다 — 고스트가 먼저 골인한 직후 플레이어가 100%에 도달하면
      // 동률 정렬에서 플레이어가 앞서 1등으로 잡혀 우승 도전과제가 잘못 열린다.
      level: playerRank === 1 && !lostRef.current ? 1 : 0,
      maxCombo: 0,
      accuracy: r.accuracy,
      wordsTyped: text.trim().split(/\s+/).length,
      elapsedTime: Math.round(r.elapsedTime),
    };
  });

  if (status === 'menu') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <div className="text-6xl mb-4">
          <svg viewBox="0 0 80 80" width="80" height="80" className="mx-auto">
            <rect width="80" height="80" rx="16" fill="#0A0A2E"/>
            <g transform="translate(40,40)">
              <rect x="-18" y="-8" width="36" height="16" rx="4" fill="#6C5CE7"/>
              <rect x="-22" y="-4" width="6" height="8" rx="2" fill="#A29BFE"/>
              <rect x="16" y="-4" width="6" height="8" rx="2" fill="#A29BFE"/>
              <rect x="-14" y="-12" width="28" height="8" rx="3" fill="#4A3FAF"/>
              <rect x="-10" y="-11" width="8" height="5" rx="1" fill="rgba(72,219,251,0.5)"/>
              <rect x="2" y="-11" width="8" height="5" rx="1" fill="rgba(72,219,251,0.5)"/>
              <circle cx="-12" cy="10" r="4" fill="#333" stroke="#555" strokeWidth="1"/>
              <circle cx="12" cy="10" r="4" fill="#333" stroke="#555" strokeWidth="1"/>
              <rect x="18" y="-2" width="8" height="2" rx="1" fill="#FF6B6B" opacity="0.8"/>
            </g>
            <text x="40" y="70" textAnchor="middle" fill="#FECA57" fontSize="8" fontFamily="monospace" fontWeight="bold">RACE</text>
          </svg>
        </div>
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>
          {isKorean ? '타이핑 레이스' : 'Typing Race'}
        </h1>
        <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>
          {isKorean ? '실제 유저의 기록(👻)과 타이핑 속도 대결!' : 'Race real players’ recorded runs (👻)!'}
        </p>
        <p className="mb-6 text-xs" style={{ color: 'var(--text-muted)' }}>
          {isKorean ? '전국 순위 기록을 고스트로 불러옵니다 · 기록이 없으면 AI가 대신 뜁니다' : 'Ghosts are loaded from the national leaderboard · AI fills in when none are available'}
        </p>
        <Button size="lg" onClick={startRace}>{isKorean ? '레이스 시작' : 'Start Race'}</Button>
      </div>
    );
  }

  if (status === 'countdown') {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <div className="text-8xl font-bold neon-text" style={{ fontFamily: "'Outfit'", color: 'var(--color-primary)' }}>{countdown}</div>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-4 py-4">
      {/* Race track */}
      <Card
        className="p-4 mb-4"
        style={{
          backgroundImage:
            'linear-gradient(rgba(10,8,26,0.72), rgba(10,8,26,0.86)), url(/game/race/bg.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          border: '1px solid rgba(108,92,231,0.35)',
        }}
      >
        {cars.map((car, i) => (
          <div key={i} className="mb-3">
            <div className="flex items-center gap-2 text-sm mb-1">
              {car.isGhost && <span className="text-xs">{car.isReal ? '👻' : '🤖'}</span>}
              <span style={{ color: car.color, fontWeight: 'bold', fontFamily: "'JetBrains Mono'" }}>{car.name}</span>
              {car.isReal && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(29,209,161,0.15)', color: '#1DD1A1', fontWeight: 'bold' }}>
                  {isKorean ? '실제 기록' : 'REAL'}
                </span>
              )}
              {car.isGhost && car.wpm != null && (
                <span className="text-[11px]" style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono'" }}>{car.wpm} WPM</span>
              )}
              <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono'" }}>{Math.round(car.progress)}%</span>
            </div>
            <div className="h-8 rounded-lg overflow-hidden relative" style={{ background: 'var(--bg-tertiary)' }}>
              {/* Track markings */}
              <div className="absolute inset-0 flex items-center">
                {[25, 50, 75].map(p => (
                  <div key={p} className="absolute h-full w-px" style={{ left: `${p}%`, background: 'rgba(255,255,255,0.05)' }} />
                ))}
              </div>
              <div className="h-full rounded-lg transition-all duration-200 flex items-center justify-end pr-2"
                style={{ width: `${Math.max(5, car.progress)}%`, background: `linear-gradient(90deg, ${car.color}40, ${car.color})` }}>
                <span className="text-sm">
                  {car.isPlayer ? (
                    <img
                      src="/game/race/car.webp"
                      width={34}
                      height={20}
                      alt=""
                      className="race-car-drive"
                      style={{ filter: 'drop-shadow(0 0 4px rgba(108,92,231,0.9))', objectFit: 'contain' }}
                    />
                  ) : (car.isReal ? '👻' : '🚗')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </Card>

      {/* 🔴 mode="race" — 순위는 handleComplete 의 game:race 제출 하나로 끝낸다.
          기본값(speed_test)이면 한 판이 speed 리더보드에도 같이 올라간다(2026-09-18 정리). */}
      {status === 'racing' && text && (
        <TypingArea ref={areaRef} text={text} mode="race" onComplete={handleComplete} onProgress={handleProgress} />
      )}

      {status === 'finished' && (
        <div className="text-center py-8">
          <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: "'Outfit'" }}>
            {isKorean ? '레이스 완료!' : 'Race Complete!'}
          </h2>
          <p className="text-sm mb-6" style={{
            color: playerRank === 1 ? 'var(--color-success)' : playerRank === 2 ? 'var(--color-accent-warm)' : 'var(--text-secondary)',
            fontWeight: playerRank <= 2 ? 'bold' : 'normal',
          }}>
            {playerRank === 1 ? (isKorean ? '1등! 축하합니다!' : '1st Place! Congratulations!') :
             playerRank === 2 ? (isKorean ? '2등! 잘했어요!' : '2nd Place! Well done!') :
             (isKorean ? `${playerRank}등` : `${playerRank}th Place`)}
          </p>
          <div className="max-w-sm mx-auto">
            {rank.map((car, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 border-b border-[var(--key-border)]"
                style={{ background: car.isPlayer ? 'rgba(108,92,231,0.1)' : 'transparent', borderRadius: car.isPlayer ? 8 : 0, padding: car.isPlayer ? '0.625rem 0.75rem' : undefined }}>
                <span className="text-lg font-bold w-8 text-center" style={{
                  color: i === 0 ? '#FECA57' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--text-muted)',
                  fontFamily: "'JetBrains Mono'"
                }}>
                  {i + 1}
                </span>
                <span style={{ color: car.color, fontWeight: 'bold' }}>{car.name}</span>
                <span className="ml-auto text-sm" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--text-muted)' }}>{Math.round(car.progress)}%</span>
              </div>
            ))}
          </div>
          <Button size="lg" className="mt-6" onClick={startRace}>{isKorean ? '다시 도전' : 'Race Again'}</Button>
        </div>
      )}
    </div>
  );
}
