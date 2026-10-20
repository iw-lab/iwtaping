'use client';

import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { soundManager } from '@/lib/sound/sound-manager';
import { useGameBgm } from '@/hooks/useGameBgm';
import { schoolGate } from '@/lib/gb/school';
import { useGameResult, hitAccuracy } from '@/hooks/useGameResult';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { wordGenerator } from '@/lib/content/word-generator';
import { submitGameScore } from '@/lib/api/client';
import {
  ParticleSystem, ScreenShake,
  createStarfield, drawStarfield,
  drawWordBubble, drawShieldBar,
  wordBubbleWidth, wordBubbleHeight, resolveLabels, easeLabelShift,
  type Star, type LabelRequest,
} from '@/lib/game/renderer';
import { createGameJuice } from '@/lib/game/juice-table';
import { drawVectorIcon, ICON_SNOWFLAKE, ICON_ZAP, ICON_DROPLET } from '@/lib/game/canvas-icons';
import {
  RainCore, seededRng, seedFromString, PH_START, SURVIVAL_LIVES, GROUND_OFFSET,
  type Ability, type RainWord, type RainEvent,
} from '@/lib/game/rain/core';
import type { SeedRainScene } from '@/lib/game3d/seed-rain-scene';
import { ModePicker, useGameMode, saveBest, todayKey, type GameMode } from '@/components/game/ModePicker';
import { FullscreenButton } from '@/components/game/FullscreenButton';
import { SchoolRankCard } from '@/components/school/SchoolRankCard';
import { Snowflake, Zap, Droplet, Sprout, type LucideIcon } from 'lucide-react';

/** 특수단어(어려운 단어)를 맞히면 발동하는 능력. */
const ABILITY_META: Record<Ability, { iconPaths: readonly string[]; label: string; color: string }> = {
  freeze: { iconPaths: ICON_SNOWFLAKE, label: '일시정지', color: '#48DBFB' },
  clear: { iconPaths: ICON_ZAP, label: '모두 심기', color: '#FD79A8' },
  heal: { iconPaths: ICON_DROPLET, label: '흙 회복', color: '#00E5A0' },
};
/** 효과 배지(JSX) 전용 — 캔버스가 아니라 실제 lucide 컴포넌트를 쓴다. */
const ABILITY_ICON: Record<Ability, LucideIcon> = { freeze: Snowflake, clear: Zap, heal: Droplet };
const GAME_ID = 'rain';

/** 3D 판을 쓸 수 있나 — WebGL2 가 있고 «가벼운 화면»을 고르지 않았을 때(없으면 지금 2D 판 그대로) */
function want3d(): boolean {
  try {
    if (localStorage.getItem('typingverse:lite') === '1') return false;
    if (new URLSearchParams(location.search).get('lite') === '1') return false;
    return !!document.createElement('canvas').getContext('webgl2');
  } catch { return false; }
}

export default function RainGamePage() {
  const { settings } = useSettingsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  useGameBgm('action', status === 'countdown' || status === 'playing');
  const [mode, setMode] = useGameMode(GAME_ID);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [maxCombo, setMaxCombo] = useState(0);
  const [input, setInput] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [wordPool, setWordPool] = useState<string[]>([]);
  const [destroyCount, setDestroyCount] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [is3d, setIs3d] = useState(false);
  const [effectMsg, setEffectMsg] = useState<{ ability: Ability; msg: string } | null>(null);

  const coreRef = useRef<RainCore | null>(null);
  const sceneRef = useRef<SeedRainScene | null>(null);
  const animFrameRef = useRef<number>(0);
  const startedAtRef = useRef(0);
  const staticPoolRef = useRef<string[]>([]);
  const starsRef = useRef<Star[]>([]);
  const particlesRef = useRef(new ParticleSystem());
  const shakeRef = useRef(new ScreenShake());
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 격파·피격·능력·레벨업
  const isKorean = settings.language === 'ko';

  useEffect(() => { setIs3d(want3d()); }, []);

  // 2D 판 배경(AI 생성). 3D 판에서는 장면이 배경을 그린다.
  useEffect(() => {
    const img = new Image();
    img.src = '/game/rain/bg.webp';
    img.onload = () => { bgImageRef.current = img; };
  }, []);

  // 반응(주스) — burst 는 파티클(캔버스 로컬 좌표), 타격 묶음(찌그러짐·튕김·번쩍·줌 펀치)은 3D 장면이 그린다.
  // 2D 판(WebGL2 없음)에서는 kick 을 짧은 화면 흔들기로 대신한다 — 단, 단어를 맞힌 «뒤»라 읽는 중인 라벨은 이미 사라졌다.
  useEffect(() => {
    juiceRef.current = createGameJuice({
      soundManager,
      burst: (o: { x: number; y: number; big?: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        particlesRef.current.explode(o.x - rect.left, o.y - rect.top, (o.big ?? 1) * 0.7);
      },
      kick: () => { if (!sceneRef.current) shakeRef.current.shake(2); },
      squash: (o: { word?: RainWord }) => { if (o.word) sceneRef.current?.hit(o.word); },
      knock: () => { /* 3D: hit() 안에서 캡슐이 화분으로 튕겨 날아간다 · 2D: 파티클이 대신한다 */ },
      hitflash: () => { /* 3D: hit() 안에서 캡슐이 하얗게 번쩍 · 2D: 말풍선이 바로 사라진다 */ },
      haptics: () => settings.sfx,
    });
    return () => juiceRef.current?.destroy();
  }, [settings.sfx]);

  useEffect(() => {
    wordGenerator.reset();
    const words = wordGenerator.getWords({
      language: settings.language,
      theme: 'nature',
      difficulty: 1,
      count: 500,
      minLength: settings.language === 'ko' ? 2 : 3,
      maxLength: settings.language === 'ko' ? 6 : 12,
    });
    (async () => {
      try {
        if (settings.language === 'ko') {
          const mod = await import('@/data/korean/words-beginner');
          const mod2 = await import('@/data/korean/words-intermediate');
          staticPoolRef.current = [...new Set([...mod.koreanWordsBeginner, ...mod2.koreanWordsIntermediate])].sort();
          setWordPool([...new Set([...mod.koreanWordsBeginner, ...mod2.koreanWordsIntermediate, ...words])]);
        } else {
          const mod = await import('@/data/english/words-common200');
          const mod2 = await import('@/data/english/words-common1000');
          const base = [...mod.englishCommon200, ...mod2.englishCommon1000].filter(w => w.length >= 3);
          staticPoolRef.current = [...new Set(base)].sort();
          setWordPool([...new Set([...base, ...words])]);
        }
      } catch {
        staticPoolRef.current = [...words].sort();
        setWordPool(words);
      }
    })();
  }, [settings.language]);

  useEffect(() => {
    if (level > 1 && mode !== 'daily') {
      const newWords = wordGenerator.getWords({
        language: settings.language, difficulty: Math.min(10, level), count: 100,
        minLength: settings.language === 'ko' ? 2 : 3,
      });
      setWordPool(prev => [...new Set([...prev, ...newWords])]);
    }
  }, [level, settings.language, mode]);

  useEffect(() => {
    const c = coreRef.current;
    if (status === 'gameover' && c && c.score > 0) {
      void submitGameScore('rain', c.score, Date.now() - startedAtRef.current, settings.language);
      setNewBest(saveBest(GAME_ID, mode, c.score));
    }
  }, [status, settings.language, mode]);

  // 일일 퀘스트·도전과제·학교 점수에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  useGameResult(status === 'gameover', () => {
    const c = coreRef.current;
    if (!c || (c.attempts === 0 && c.score === 0)) return null;
    return {
      gameType: 'rain',
      score: c.score,
      level: c.level,
      maxCombo: c.maxCombo,
      accuracy: hitAccuracy(c.kills, c.attempts),
      wordsTyped: c.kills,
      elapsedTime: Math.round((Date.now() - startedAtRef.current) / 1000),
    };
  });

  const startGame = () => {
    setStatus('countdown');
    startedAtRef.current = Date.now();
    setScore(0); setLevel(1); setMaxCombo(0); setNewBest(false);
    setInput(''); setDestroyCount(0);
    coreRef.current = null;
    setEffectMsg(null);
    particlesRef.current = new ParticleSystem();
    shakeRef.current = new ScreenShake();
    setCountdown(3);
  };

  useEffect(() => {
    if (status !== 'countdown') return;
    if (countdown <= 0) { setStatus('playing'); inputRef.current?.focus(); return; }
    soundManager?.play('countdown');
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [status, countdown]);

  const flashEffect = (ability: Ability, msg: string) => {
    setEffectMsg({ ability, msg });
    setTimeout(() => setEffectMsg(null), 2200);
  };

  /** 코어가 낸 사건 → 소리·화면 반응·3D 장면 */
  const handleEvents = (events: RainEvent[], canvas: HTMLCanvasElement, H: number) => {
    const rect = canvas.getBoundingClientRect();
    const c = coreRef.current;
    for (const e of events) {
      if (e.type === 'miss') {
        const wx = e.word.x + (e.word.labelShift ?? 0);
        shakeRef.current.shake(sceneRef.current ? 0 : 3);
        // 겹침을 피해 옆으로 비켜 놓은 자리에서 터져야 한다(원본 x를 쓰면 보이던 씨앗과 최대 120px 어긋난다).
        particlesRef.current.emit(wx, H - 40, 10, {
          speed: 2, life: 20, size: 3, colors: [e.word.color, '#8A6A4A'], spread: Math.PI, angle: -Math.PI / 2,
        });
        sceneRef.current?.miss(e.word);
        juiceRef.current?.fire('miss', { x: rect.left + wx, y: rect.top + (H - 40), color: '#FF6B6B' });
      } else if (e.type === 'gameover') {
        setStatus('gameover');
        soundManager?.play('gameOver');
      } else if (e.type === 'hit') {
        const wx = e.word.x + (e.word.labelShift ?? 0);
        setScore(c?.score ?? 0);
        setDestroyCount(c?.kills ?? 0);
        setMaxCombo(c?.maxCombo ?? 0);
        juiceRef.current?.fire('hit', {
          x: rect.left + wx, y: rect.top + e.word.y, n: e.points, text: `+${e.points}`,
          color: e.word.color, big: e.word.special ? 1.3 : 1, word: e.word,
        });
      } else if (e.type === 'wrong') {
        juiceRef.current?.fire('miss', { color: '#FF6B6B' });
      } else if (e.type === 'ability') {
        const meta = ABILITY_META[e.ability];
        for (const w of e.cleared) particlesRef.current.explode(w.x + (w.labelShift ?? 0), w.y, 0.5);
        sceneRef.current?.ability(e.ability);
        setScore(c?.score ?? 0);
        juiceRef.current?.fire('special', { title: `${meta.label}!`, color: meta.color, vib: [25, 30, 25] });
        flashEffect(e.ability, `${meta.label} 발동!`);
      } else if (e.type === 'levelup') {
        setLevel(e.level);
        juiceRef.current?.fire('levelup', { title: `LEVEL ${e.level}!`, color: '#A29BFE' });
      }
    }
  };

  useEffect(() => {
    if (status !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const particles = particlesRef.current;
    const shake = shakeRef.current;

    // 오늘의 판 = 날짜 시드 + 고정 단어 목록(모두 같은 순서) · 그 밖 = 기존 무작위
    const daily = mode === 'daily';
    const rng = daily ? seededRng(seedFromString(`rain:${todayKey()}:${settings.language}`)) : Math.random;
    const dailyPool = staticPoolRef.current.length ? staticPoolRef.current : wordPool;
    const core = new RainCore({
      W, H, isKorean, rng, mode,
      pickWord: (minLen) => {
        if (!daily) return wordGenerator.getUniqueWord(wordPool, minLen);
        const ok = dailyPool.filter((w) => w.length >= minLen);
        const base = ok.length ? ok : dailyPool;
        return base[Math.floor(rng() * base.length)] || '';
      },
    });
    coreRef.current = core;
    // 시험 손잡이(읽기 전용 관찰 — 판정·점수는 화면 입력으로만 바뀐다)
    (window as unknown as { __rain?: unknown }).__rain = { core, scene: () => sceneRef.current };

    // 3D 장면(있으면) — three 는 이때만 받는다. 못 만들면 2D 판 그대로.
    let alive = true;
    if (is3d && canvas3dRef.current) {
      const c3 = canvas3dRef.current;
      import('@/lib/game3d/seed-rain-scene').then((m) => {
        if (!alive) return;
        try { sceneRef.current = m.createSeedRainScene(c3, W, H); } catch { sceneRef.current = null; setIs3d(false); }
      }).catch(() => setIs3d(false));
    }

    if (starsRef.current.length === 0) starsRef.current = createStarfield(60, W, H);
    let lastT = 0;

    const loop = (time: number) => {
      const dt = lastT ? Math.min(50, time - lastT) : 16;
      lastT = time;
      // 타격 순간 0.1초 멈춤(hitstop) — 낙하만 멈추고 입력·라벨은 그대로
      const gameDt = juiceRef.current ? juiceRef.current.time(dt / 1000) : dt / 1000;
      const events = gameDt > 0 ? core.tick(time) : [];
      if (events.length) handleEvents(events, canvas, H);
      if (core.over) { cancelAnimationFrame(animFrameRef.current); return; }

      const scene = sceneRef.current;
      const shakeOffset = scene ? { x: 0, y: 0 } : shake.update();
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(shakeOffset.x, shakeOffset.y);

      if (!scene) draw2dBackdrop(ctx, W, H, time, core.level);

      // 단어 — 겹친 단어는 둘 다 못 읽어서 칠 수가 없다(실측: 두 단어가 77% 겹침).
      // y는 낙하 높이 = 게임 상태라 건드리면 안 되므로 가로로만 비켜 놓는다.
      const labels: (LabelRequest & { word: RainWord; fs: number })[] = core.words.map((word) => ({
        word,
        fs: word.special ? 17 : 15,
        x: word.x,
        w: wordBubbleWidth(ctx, word.text, word.special ? 17 : 15),
        h: wordBubbleHeight(word.special ? 17 : 15),
        homeY: word.y,
        dir: word.x > W / 2 ? -1 : 1,
        y: 0, offset: 0, prefer: word.labelShift,
      }));
      resolveLabels(labels, [], { canvasH: H, canvasW: W, axis: 'x', maxShift: 60, pad: 4 });
      for (const L of labels) L.word.labelShift = easeLabelShift(L.word.labelShift, L.offset);
      (window as unknown as { __rainLabels?: unknown }).__rainLabels = labels.map((L) => ({ x: L.word.x + (L.word.labelShift ?? 0) - L.w / 2, y: L.word.y - L.h / 2, w: L.w, h: L.h }));

      // 3D 씨앗 캡슐은 라벨이 정한 자리(비켜 선 거리 포함)를 따라간다
      const frozen = core.isFrozen(time);
      scene?.render(core.words, time, frozen);

      for (const L of labels) {
        const word = L.word;
        const wx = word.x + (word.labelShift ?? 0);
        if (!scene) drawSeed2d(ctx, word, wx, time);
        if (word.special && word.ability) {
          const meta = ABILITY_META[word.ability];
          ctx.save();
          if (!scene) {
            const pulse = 0.6 + Math.sin(time * 0.006 + word.id) * 0.4;
            ctx.strokeStyle = `rgba(254,202,87,${0.35 + pulse * 0.4})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(wx, word.y, 44, 20, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.font = "bold 12px 'Noto Sans KR', sans-serif";
          ctx.fillStyle = meta.color;
          ctx.textAlign = 'center';
          ctx.fillText(meta.label, wx, word.y - 50);
          drawVectorIcon(ctx, meta.iconPaths, wx - ctx.measureText(meta.label).width / 2 - 10, word.y - 55, 13, meta.color);
          ctx.restore();
        }
        drawWordBubble(ctx, wx, word.y, word.text, word.color, { fontSize: L.fs });
      }

      if (frozen) {
        ctx.save();
        ctx.fillStyle = 'rgba(72,219,251,0.10)';
        ctx.fillRect(0, 0, W, H);
        ctx.font = "bold 14px 'Noto Sans KR', sans-serif";
        ctx.fillStyle = 'rgba(180,240,255,0.95)';
        ctx.textAlign = 'center';
        ctx.fillText('일시정지', W / 2, 52);
        drawVectorIcon(ctx, ICON_SNOWFLAKE, W / 2 - ctx.measureText('일시정지').width / 2 - 11, 47, 16, 'rgba(180,240,255,0.9)');
        ctx.restore();
      }

      particles.update();
      particles.draw(ctx);

      if (!scene) draw2dGround(ctx, W, H, time);

      // 상태 띠 — 기본·오늘의 판 = 흙 기운 막대 · 60초 = 남은 시간 · 목숨 3개 = 하트
      ctx.font = "bold 12px 'JetBrains Mono', 'Noto Sans KR', monospace";
      ctx.textAlign = 'center';
      if (core.mode === 'survival') {
        ctx.fillStyle = '#FFE3EC';
        ctx.fillText(`목숨 ${'●'.repeat(core.lives)}${'○'.repeat(SURVIVAL_LIVES - core.lives)}`, W / 2, H - 14);
      } else {
        drawShieldBar(ctx, 20, H - 30, core.ph, PH_START, W - 40);
        ctx.fillStyle = '#E8E8FF';
        ctx.fillText(`흙 기운 ${core.ph.toFixed(1)}`, W / 2, H - 12);
      }

      ctx.font = "bold 18px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#E8E8FF';
      ctx.textAlign = 'left';
      ctx.fillText(`${core.score}`, 20, 30);
      ctx.font = "12px 'Noto Sans KR', sans-serif";
      ctx.fillStyle = 'rgba(232,232,255,0.7)';
      ctx.fillText(isKorean ? '점수' : 'SCORE', 20, 14);

      ctx.font = "bold 16px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#C9C2FF';
      ctx.textAlign = 'center';
      const rem = core.remaining(time);
      ctx.fillText(rem !== null ? `${Math.ceil(rem / 1000)}초` : `LEVEL ${core.level}`, W / 2, 30);

      if (core.combo > 1) {
        ctx.font = "bold 14px 'JetBrains Mono', monospace";
        ctx.fillStyle = '#FD79A8';
        ctx.textAlign = 'right';
        ctx.fillText(`${core.combo}x COMBO`, W - 20, 30);
      }

      ctx.restore();
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
  }, [status, wordPool, isKorean, is3d, mode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const core = coreRef.current;
    const canvas = canvasRef.current;
    if (!input.trim() || !core || !canvas) return;
    handleEvents(core.submit(input, performance.now()), canvas, canvas.offsetHeight);
    setInput('');
  };

  if (status === 'menu') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <div className="text-left mb-4"><SchoolRankCard /></div>
        <div className="flex justify-end mb-2"><FullscreenButton /></div>
        <Sprout className="w-16 h-16 mx-auto mb-3" style={{ color: '#3FBF5A' }} aria-hidden />
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>
          {isKorean ? '씨앗비' : 'Seed Rain'}
        </h1>
        <p className="mb-3" style={{ color: 'var(--text-secondary)' }}>
          {isKorean ? '구름 섬에서 떨어지는 씨앗 단어를 쳐서 화분에 심어요!' : 'Type the falling seed words to plant them!'}
        </p>
        {isKorean && (
          <p className="mb-5 text-sm max-w-md mx-auto flex flex-wrap items-center justify-center gap-x-2 gap-y-1" style={{ color: 'var(--text-muted)' }}>
            <span>금빛 <b style={{ color: '#FECA57' }}>특수 씨앗</b>을 맞히면 능력 발동(점수 2배)</span>
            <span className="inline-flex items-center gap-1"><Snowflake className="w-4 h-4" aria-hidden />일시정지</span>
            <span className="inline-flex items-center gap-1"><Zap className="w-4 h-4" aria-hidden />모두 심기</span>
            <span className="inline-flex items-center gap-1"><Droplet className="w-4 h-4" aria-hidden />흙 회복</span>
          </p>
        )}
        <ModePicker game={GAME_ID} value={mode} onChange={setMode} />
        <Button size="lg" data-gb="play" onClick={() => schoolGate(startGame)}>{isKorean ? '게임 시작' : 'Start Game'}</Button>
        <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {is3d ? '3D 화면' : '가벼운 화면(2D)'}
        </p>
      </div>
    );
  }

  if (status === 'countdown') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <div className="text-8xl font-bold neon-text" style={{ fontFamily: "'Outfit'", color: 'var(--color-primary)' }}>{countdown}</div>
      </div>
    );
  }

  if (status === 'gameover') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit'", color: mode === 'time' ? 'var(--color-primary)' : 'var(--color-error)' }}>
          {mode === 'time' ? (isKorean ? '시간 끝!' : "Time's up!") : (isKorean ? '게임 오버' : 'Game Over')}
        </h1>
        {newBest && <p className="mb-4 font-bold" style={{ color: '#FECA57' }}>{isKorean ? '새 최고 기록!' : 'New best!'}</p>}
        <div className="grid grid-cols-4 gap-3 mb-8 max-w-lg mx-auto">
          <Card className="p-3">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '점수' : 'SCORE'}</div>
            <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-primary)' }}>{score}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '레벨' : 'LEVEL'}</div>
            <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-secondary)' }}>{level}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '콤보' : 'COMBO'}</div>
            <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-combo)' }}>{maxCombo}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '심은 씨앗' : 'PLANTED'}</div>
            <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: '#00B894' }}>{destroyCount}</div>
          </Card>
        </div>
        <Button size="lg" data-gb="play" onClick={() => schoolGate(startGame)}>{isKorean ? '다시 시작' : 'Retry'}</Button>
        <div className="mt-3"><Button variant="ghost" onClick={() => setStatus('menu')}>{isKorean ? '모드 바꾸기' : 'Change mode'}</Button></div>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-4 py-4">
      <div className="relative rounded-xl overflow-hidden border border-[var(--key-border)]" style={{ background: 'var(--bg-card)', height: '500px' }} data-render={is3d ? '3d' : '2d'}>
        {is3d && <canvas ref={canvas3dRef} className="absolute inset-0 w-full h-full" style={{ display: 'block' }} aria-hidden />}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ display: 'block' }} />
        <div className="absolute top-2 right-2"><FullscreenButton /></div>
        {effectMsg && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-sm font-bold pointer-events-none flex items-center gap-1.5"
            style={{ background: 'rgba(254,202,87,0.92)', color: '#3A2A00', boxShadow: '0 4px 16px rgba(254,202,87,0.4)' }}>
            {(() => { const Icon = ABILITY_ICON[effectMsg.ability]; return <Icon className="w-4 h-4" aria-hidden />; })()}
            {effectMsg.msg}
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
          className="flex-1 px-4 py-3 rounded-xl border border-[var(--key-border)] text-lg"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: "'JetBrains Mono', monospace" }}
          placeholder={isKorean ? '단어를 입력하세요...' : 'Type the word...'} autoComplete="off" autoFocus />
        <Button type="submit" size="lg">{isKorean ? '입력' : 'Enter'}</Button>
      </form>
    </div>
  );

  /** 2D 판 배경(WebGL2 없는 기기) — 하늘·별·비 */
  function draw2dBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number, time: number, lv: number) {
    const bg = bgImageRef.current;
    if (bg && bg.width > 0) {
      const scale = Math.max(W / bg.width, H / bg.height);
      const dw = bg.width * scale;
      const dh = bg.height * scale;
      ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      const readGrad = ctx.createLinearGradient(0, 0, 0, H);
      readGrad.addColorStop(0, 'rgba(6,4,20,0.32)');
      readGrad.addColorStop(0.55, 'rgba(6,4,20,0.12)');
      readGrad.addColorStop(1, 'rgba(6,4,20,0.45)');
      ctx.fillStyle = readGrad;
      ctx.fillRect(0, 0, W, H);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#030310');
      grad.addColorStop(0.6, '#120E30');
      grad.addColorStop(1, '#0D0B25');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      drawStarfield(ctx, starsRef.current, time, 0.005);
    }
    ctx.save();
    const rainCount = Math.floor(50 * Math.min(3, 0.5 + lv * 0.3));
    ctx.strokeStyle = 'rgba(120,100,220,0.2)';
    ctx.lineWidth = 1;
    for (let i = 0; i < rainCount; i++) {
      const rx = (i * 47 + time * 0.2) % (W + 40) - 20;
      const ry = (i * 97 + time * 0.6) % (H + 20) - 10;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - 1.5, ry + 10 + Math.sin(i * 0.7) * 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 2D 판 씨앗(물방울 모양) */
  function drawSeed2d(ctx: CanvasRenderingContext2D, word: RainWord, wx: number, time: number) {
    const glow = 0.5 + Math.sin(time * 0.003 + word.glowPhase) * 0.3;
    ctx.save();
    ctx.translate(wx, word.y);
    ctx.rotate(Math.sin(time * 0.001 + word.id) * word.rotation);
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.bezierCurveTo(-12, -8, -10, 6, 0, 10);
    ctx.bezierCurveTo(10, 6, 12, -8, 0, -22);
    ctx.closePath();
    ctx.shadowColor = word.color;
    ctx.shadowBlur = 8 + glow * 6;
    ctx.fillStyle = `rgba(108,92,231,${0.08 + glow * 0.06})`;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `${word.color}44`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /** 2D 판 바닥(흙·물결) */
  function draw2dGround(ctx: CanvasRenderingContext2D, W: number, H: number, time: number) {
    const g = ctx.createLinearGradient(0, H - GROUND_OFFSET - 5, 0, H);
    g.addColorStop(0, 'rgba(90,60,30,0.05)');
    g.addColorStop(0.4, 'rgba(90,60,30,0.25)');
    g.addColorStop(1, 'rgba(60,40,20,0.5)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - GROUND_OFFSET - 5, W, GROUND_OFFSET + 5);
    ctx.save();
    ctx.strokeStyle = 'rgba(120,200,120,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = H - GROUND_OFFSET + Math.sin(x * 0.02 + time * 0.002) * 2;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
