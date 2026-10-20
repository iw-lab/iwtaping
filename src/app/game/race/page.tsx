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
import { Ghost, Bot, Car as CarIcon, Flag, Timer, CalendarDays } from 'lucide-react';
import { useGameBgm } from '@/hooks/useGameBgm';
import { schoolGate } from '@/lib/gb/school';
import { useGameResult } from '@/hooks/useGameResult';
import { soundManager } from '@/lib/sound/sound-manager';
import { createGameJuice } from '@/lib/game/juice-table';
import {
  RaceCore, seededRng, seedFromString, buildOpponents,
  type RaceCar, type RaceEvent, type RaceMode, type GhostSource,
} from '@/lib/game/race/core';
import type { RaceScene } from '@/lib/game3d/race-scene';
import { ModePicker, useGameMode, todayKey, type ModeInfo } from '@/components/game/ModePicker';
import { FullscreenButton } from '@/components/game/FullscreenButton';

const GAME_ID = 'race';

/** 레이스는 3종만 쓴다(기본틀 4종 중 survival 제외) — GDD-3D §2 */
const RACE_MODES: ModeInfo[] = [
  { id: 'classic', label: '기본', desc: '유령 셋과 한 판 승부', icon: Flag },
  { id: 'time', label: '시간 제한', desc: '60초 안에 결승선까지', icon: Timer },
  { id: 'daily', label: '오늘의 레이스', desc: '오늘은 모두 같은 상대', icon: CalendarDays },
];

/** 3D 판을 쓸 수 있나 — WebGL2 가 있고 «가벼운 화면»을 고르지 않았을 때(없으면 지금 2D 판 그대로) */
function want3d(): boolean {
  try {
    if (localStorage.getItem('typingverse:lite') === '1') return false;
    if (new URLSearchParams(location.search).get('lite') === '1') return false;
    return !!document.createElement('canvas').getContext('webgl2');
  } catch { return false; }
}

/** 날짜 시드로 배열에서 n개를 결정적으로 뽑는다(오늘의 레이스 — 모두 같은 글) */
function seededPick<T>(arr: T[], n: number, rng: () => number): T[] {
  const idx = arr.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(n, idx.length)).map((i) => arr[i]);
}

export default function RaceGamePage() {
  const { settings } = useSettingsStore();
  const [status, setStatus] = useState<'menu' | 'countdown' | 'racing' | 'finished'>('menu');
  useGameBgm('action', status === 'countdown' || status === 'racing');
  const [mode, setMode] = useGameMode(GAME_ID);
  const [is3d, setIs3d] = useState(false);
  const [text, setText] = useState('');
  const [cars, setCars] = useState<RaceCar[]>([]);
  const [countdown, setCountdown] = useState(3);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const areaRef = useRef<TypingAreaHandle>(null);
  // 이 판의 타이핑 결과. 완주든 패배든 실제 타건에서 계산된 값만 담는다.
  const resultRef = useRef<TypingResult | null>(null);
  // 고스트가 먼저 골인해 강제 종료된 판인가 — 순위 제출·진행률 100% 처리를 건너뛴다.
  const lostRef = useRef(false);
  const coreRef = useRef<RaceCore | null>(null);
  const sceneRef = useRef<RaceScene | null>(null);
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 추월·우승·역전당함
  // 문장의 단어 경계(누적 글자 수) — 단어를 하나 끝낼 때마다 3D 카메라 kick(단어 완성 뒤 0.2초만, GDD-3D §8 A)
  const wordBoundsRef = useRef<number[]>([]);
  const lastWordIdxRef = useRef(0);
  const isKorean = settings.language === 'ko';
  const raceMode: RaceMode = mode === 'time' || mode === 'daily' ? mode : 'classic';

  useEffect(() => { setIs3d(want3d()); }, []);

  // 반응(주스) 인스턴스 — 레이스는 전용 캔버스가 없어 DOM 레이어(토스트·배너)만 쓴다.
  // squash·knock·hitflash 콜백이 없으면 반응표가 el 대상 CSS로 대신 그리려다 대상이 없어 콘솔 에러를
  // 남긴다(요소가 없는 '추월!'·'우승!' 토스트가 그 경우) — 3D 장면의 kick()이 그 역할을 대신하므로 비워 둔다.
  useEffect(() => {
    juiceRef.current = createGameJuice({
      soundManager,
      squash: () => {},
      knock: () => {},
      hitflash: () => {},
      haptics: () => settings.sfx,
    });
    return () => juiceRef.current?.destroy();
  }, [settings.sfx]);

  const loadText = async (raceMode: RaceMode): Promise<string> => {
    try {
      if (raceMode === 'daily') {
        // 오늘의 레이스 — 모두 같은 글(날짜 시드, 가공 문장 추가 없이 고정 문장만 써서 결정적으로 유지)
        const rng = seededRng(seedFromString(`race-text:${todayKey()}:${settings.language}`));
        if (settings.language === 'ko') {
          const mod = await import('@/data/korean/sentences-short');
          const t = seededPick(mod.koreanSentencesShort, 3, rng).map((s) => s.text).join(' ');
          setText(t);
          return t;
        } else {
          const mod = await import('@/data/english/sentences-short');
          const t = seededPick(mod.englishSentencesShort, 3, rng).map((s) => s.text).join(' ');
          setText(t);
          return t;
        }
      }
      if (settings.language === 'ko') {
        const mod = await import('@/data/korean/sentences-short');
        const sentences = shuffleArray(mod.koreanSentencesShort).slice(0, 3);
        let t = sentences.map((s) => s.text).join(' ');
        for (let i = 0; i < 2; i++) t += ' ' + generateKoreanSentence();
        setText(t);
        return t;
      } else {
        const mod = await import('@/data/english/sentences-short');
        const sentences = shuffleArray(mod.englishSentencesShort).slice(0, 3);
        let t = sentences.map((s) => s.text).join(' ');
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
   *  밴드별 선정(빠름/중간/이길만함)은 코어(buildOpponents)가 맡는다 — 로직 분리. */
  const loadGhosts = async (): Promise<GhostSource[]> => {
    try {
      let raw: { name: string; wpm: number }[] = [];
      const g = await fetchRaceGhosts(settings.language);
      if (g && g.length > 0) {
        raw = g.map((x) => ({ name: x.nickname, wpm: Math.round(x.wpm) }));
      } else {
        const entries = await fetchLeaderboard('game:race', 'all');
        if (entries) raw = entries.filter((e) => e.value > 0 && e.nickname).map((e) => ({ name: e.nickname, wpm: Math.round(e.value) }));
      }
      return raw.filter((r) => r.wpm > 0 && r.name).map((r) => ({ name: r.name, wpm: r.wpm, isReal: true }));
    } catch {
      return [];
    }
  };

  const startRace = async () => {
    const raceText = await loadText(raceMode);
    const real = await loadGhosts();
    const rng = raceMode === 'daily' ? seededRng(seedFromString(`race:${todayKey()}:${settings.language}`)) : Math.random;
    const opponents = buildOpponents(real, rng, isKorean);
    const core = new RaceCore({ mode: raceMode, textLen: raceText.length, opponents, playerName: isKorean ? '플레이어' : 'Player' });
    coreRef.current = core;
    // 시험 손잡이(읽기 전용 관찰 — 판정·점수는 화면 입력으로만 바뀐다)
    (window as unknown as { __race?: unknown }).__race = { core, scene: () => sceneRef.current };
    setCars(core.cars.map((c) => ({ ...c })));
    // 단어 경계 — 공백 기준 누적 글자 수(단어를 끝낼 때마다 kick)
    const bounds: number[] = [];
    let acc = 0;
    for (const w of raceText.split(' ')) { acc += w.length; bounds.push(acc); acc += 1; }
    wordBoundsRef.current = bounds;
    lastWordIdxRef.current = 0;
    resultRef.current = null;
    lostRef.current = false;
    setStatus('countdown');
    setCountdown(3);
  };

  useEffect(() => {
    if (status !== 'countdown') return;
    if (countdown <= 0) { setStatus('racing'); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [status, countdown]);

  /** 코어가 낸 사건 → 소리·반응·3D 장면. 점수 제출·최종 등수 확정은 handleComplete(TypingArea onComplete)가 맡는다
   *  — 기존 판과 같은 소유권(여기서는 «고스트가 먼저 골인했다/플레이어가 먼저 100%» 상태 전환만 한다). */
  const handleRaceEvents = (events: RaceEvent[]) => {
    for (const e of events) {
      if (e.type === 'overtake') {
        juiceRef.current?.fire('hit', { text: isKorean ? '추월!' : 'Overtake!', color: '#1DD1A1' });
      } else if (e.type === 'lost') {
        // 패배해도 여기까지 친 만큼은 실제 결과로 확정한다 — handleComplete에서 lostRef를 보고 처리.
        lostRef.current = true;
        areaRef.current?.finish();
        setStatus('finished');
      } else if (e.type === 'win') {
        setStatus('finished');
      }
    }
  };

  // 3D 장면 + 고스트 진행 — rAF 루프 하나로 코어를 매 프레임 돌린다(씨앗비와 같은 패턴).
  useEffect(() => {
    if (status !== 'racing') return;
    const core = coreRef.current;
    if (!core) return;
    let alive = true;

    if (is3d && canvas3dRef.current) {
      const c3 = canvas3dRef.current;
      const W = c3.offsetWidth || 900;
      const H = c3.offsetHeight || 460;
      import('@/lib/game3d/race-scene').then((m) => {
        if (!alive) return;
        try { sceneRef.current = m.createRaceScene(c3, W, H); } catch { sceneRef.current = null; setIs3d(false); }
      }).catch(() => setIs3d(false));
    }

    let lastHudSync = 0;
    const loop = (time: number) => {
      const events = core.tick(time);
      if (events.length) handleRaceEvents(events);
      sceneRef.current?.render(core.cars, time);
      if (time - lastHudSync > 120) { lastHudSync = time; setCars(core.cars.map((c) => ({ ...c }))); }
      if (core.over) { cancelAnimationFrame(animFrameRef.current); return; }
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(animFrameRef.current);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, is3d]);

  const handleProgress = (progress: number) => {
    const core = coreRef.current;
    if (!core) return;
    // 단어 하나를 끝낼 때마다(공백을 지날 때) 카메라를 짧게 kick — 입력 중엔 그 밖엔 움직이지 않는다.
    const charIdx = Math.round((progress / 100) * text.length);
    const bounds = wordBoundsRef.current;
    while (lastWordIdxRef.current < bounds.length && charIdx >= bounds[lastWordIdxRef.current]) {
      sceneRef.current?.kick(0);
      lastWordIdxRef.current++;
    }
    const events = core.setPlayerProgress(progress);
    setCars(core.cars.map((c) => ({ ...c })));
    if (events.length) handleRaceEvents(events);
  };

  const handleComplete = (result: TypingResult) => {
    resultRef.current = result;
    const core = coreRef.current;
    if (lostRef.current) {
      // 강제 종료(패배) — 진행률을 100으로 올리지도, 미완주 기록을 순위에 올리지도 않는다.
      setStatus('finished');
      juiceRef.current?.fire('miss', { title: isKorean ? '패배...' : 'Defeated...', color: '#FF6B6B' });
      return;
    }
    if (!core) { setStatus('finished'); return; }
    // 🔴 onComplete는 currentIndex가 text.length로 갱신되기 전에(같은 핸들러 안에서 동기로) 불린다 —
    // 아직 onProgress(100)가 코어에 닿지 않았을 수 있다. 등수는 그 전 값으로 정하고(기존 판과 같은 공정성),
    // 화면 표시만 완주로 확정한다(기존 판의 setCars(... progress:100 ...)와 같은 역할).
    const finalRank = core.playerRank();
    core.cars[0].progress = 100;
    setCars(core.cars.map((c) => ({ ...c })));
    setStatus('finished');
    juiceRef.current?.fire(finalRank === 1 ? 'special' : 'hit', finalRank === 1
      ? { title: isKorean ? '우승!' : 'You Win!', color: '#FECA57', vib: [25, 30, 25] }
      : { text: isKorean ? '완주!' : 'Finished!', color: '#1DD1A1' });
    // 레이스는 실제 타이핑 — WPM으로 game:race 순위 제출(실제 타건 로그로 검증) — 기존 판과 같은 식.
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
  const playerRank = rank.findIndex((c) => c.isPlayer) + 1;

  // 일일 퀘스트·도전과제 반영. 완주하지 못한 판(고스트가 먼저 골인)은 타이핑 결과가
  // 없으므로 기록하지 않는다 — 없는 정확도를 지어내지 않기 위해서다.
  useGameResult(status === 'finished', () => {
    const r = resultRef.current;
    if (!r || r.totalKeystrokes === 0) return null;
    return {
      gameType: 'race' as const,
      score: Math.round(r.wpm),
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
        <div className="flex justify-end mb-2"><FullscreenButton /></div>
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
        <p className="mb-2 flex items-center justify-center gap-1 flex-wrap" style={{ color: 'var(--text-secondary)' }}>
          {isKorean ? (
            <>실제 유저의 기록(<Ghost className="w-4 h-4 inline" />)과 타이핑 속도 대결!</>
          ) : (
            <>Race real players&rsquo; recorded runs (<Ghost className="w-4 h-4 inline" />)!</>
          )}
        </p>
        <p className="mb-6 text-xs" style={{ color: 'var(--text-muted)' }}>
          {isKorean ? '전국 순위 기록을 고스트로 불러옵니다 · 기록이 없으면 AI가 대신 뜁니다' : 'Ghosts are loaded from the national leaderboard · AI fills in when none are available'}
        </p>
        <ModePicker game={GAME_ID} value={mode} onChange={setMode} modes={RACE_MODES} />
        <Button size="lg" onClick={() => schoolGate(() => { void startRace(); })}>{isKorean ? '레이스 시작' : 'Start Race'}</Button>
        <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {is3d ? '3D 화면' : '가벼운 화면(2D)'}
        </p>
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
      {is3d ? (
        <div
          className="relative rounded-xl overflow-hidden border border-[var(--key-border)] mb-4"
          style={{ background: 'var(--bg-card)', height: '460px' }}
          data-render="3d"
        >
          <canvas ref={canvas3dRef} className="absolute inset-0 w-full h-full" style={{ display: 'block' }} aria-hidden />
          <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none">
            {rank.map((car, i) => (
              <div key={car.id} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md"
                style={{ background: 'rgba(10,8,26,0.6)', minWidth: 150 }}>
                <span style={{
                  color: i === 0 ? '#FECA57' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--text-muted)',
                  fontFamily: "'JetBrains Mono'", width: 14,
                }}>{i + 1}</span>
                {car.isGhost && (car.isReal ? <Ghost className="w-3 h-3" aria-hidden /> : <Bot className="w-3 h-3" aria-hidden />)}
                <span style={{ color: car.color, fontWeight: 'bold' }}>{car.name}</span>
                <span className="ml-auto" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--text-muted)' }}>{Math.round(car.progress)}%</span>
              </div>
            ))}
          </div>
          <div className="absolute top-2 right-2"><FullscreenButton /></div>
        </div>
      ) : (
        <Card
          className="p-4 mb-4"
          data-render="2d"
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
                {car.isGhost && (
                  <span className="text-xs">
                    {car.isReal ? <Ghost className="w-3.5 h-3.5 inline" /> : <Bot className="w-3.5 h-3.5 inline" />}
                  </span>
                )}
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
                <div className="absolute inset-0 flex items-center">
                  {[25, 50, 75].map((p) => (
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
                    ) : (car.isReal ? <Ghost className="w-4 h-4 inline" /> : <CarIcon className="w-4 h-4 inline" />)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* 🔴 mode="race" — 순위는 handleComplete 의 game:race 제출 하나로 끝낸다.
          기본값(speed_test)이면 한 판이 speed 리더보드에도 같이 올라간다(2026-09-18 정리).
          🔴 하단 고정 문장 DOM — 3D 판에서도 차 위에 라벨을 띄우지 않는다(GDD-3D §2, TypeRacer 관습). */}
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
          <Button size="lg" className="mt-6" onClick={() => schoolGate(() => { void startRace(); })}>{isKorean ? '다시 도전' : 'Race Again'}</Button>
          <div className="mt-3"><Button variant="ghost" onClick={() => setStatus('menu')}>{isKorean ? '모드 바꾸기' : 'Change mode'}</Button></div>
        </div>
      )}
    </div>
  );
}
