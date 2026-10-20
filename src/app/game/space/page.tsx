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
  createStarfield, drawStarfield, drawNebula, drawSpaceBackground,
  drawPlayerShip, drawEnemyShip, drawLaser,
  drawShieldBar, drawHUD, drawWordBubble,
  preloadSprites, drawSprite, drawBackgroundImage, wordBubbleY, wordBubbleHeight, wordBubbleWidth,
  drawBubbleLeader, resolveLabels, easeLabelShift, spriteWidthFor,
  type Star, type LabelBox, type LabelRequest,
} from '@/lib/game/renderer';
import { ABILITY_META, drawSpecialMarker } from '@/lib/game/special-words';
import {
  SpaceCore, seededRng, seedFromString, spaceCenter, SHIELD_START, SURVIVAL_LIVES,
  type Ability, type SpaceEnemy, type SpaceEvent,
} from '@/lib/game/space/core';
import type { SpaceScene } from '@/lib/game3d/space-scene';
import { createGameJuice } from '@/lib/game/juice-table';
import { drawVectorIcon, ICON_SNOWFLAKE } from '@/lib/game/canvas-icons';
import { AbilityIcon } from '@/components/common/AbilityIcon';
import { ModePicker, useGameMode, saveBest, todayKey } from '@/components/game/ModePicker';
import { FullscreenButton } from '@/components/game/FullscreenButton';
import { SchoolRankCard } from '@/components/school/SchoolRankCard';
import { Sparkles, Snowflake, Zap, Heart } from 'lucide-react';

const SPACE_SPRITES = {
  'space-bg': '/game/space/bg.webp',
  'space-player': '/game/space/ship.webp',
  'space-enemy': '/game/space/enemy.webp',
};
const GAME_ID = 'space';

/** 3D 판을 쓸 수 있나 — WebGL2 가 있고 «가벼운 화면»을 고르지 않았을 때(없으면 지금 2D 판 그대로) */
function want3d(): boolean {
  try {
    if (localStorage.getItem('typingverse:lite') === '1') return false;
    if (new URLSearchParams(location.search).get('lite') === '1') return false;
    return !!document.createElement('canvas').getContext('webgl2');
  } catch { return false; }
}

export default function SpaceGamePage() {
  const { settings } = useSettingsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  useGameBgm('boss', status === 'countdown' || status === 'playing');
  const [mode, setMode] = useGameMode(GAME_ID);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [maxCombo, setMaxCombo] = useState(0);
  const [input, setInput] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [wordPool, setWordPool] = useState<string[]>([]);
  const [fixedCount, setFixedCount] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [is3d, setIs3d] = useState(false);
  const [effectMsg, setEffectMsg] = useState<{ ability: Ability; msg: string } | null>(null);
  const isKorean = settings.language === 'ko';

  const coreRef = useRef<SpaceCore | null>(null);
  const sceneRef = useRef<SpaceScene | null>(null);
  const animFrameRef = useRef<number>(0);
  const startedAtRef = useRef(0);
  const staticPoolRef = useRef<string[]>([]);
  const starsRef = useRef<Star[]>([]);
  const particlesRef = useRef(new ParticleSystem());
  const shakeRef = useRef(new ScreenShake());
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 수리·피격·능력·레벨업
  /** 화면 입력으로 고르는 중인 드론(수리 광선 길이·조준선에 쓴다) — 매 키 입력마다 갱신, 루프는 ref로만 읽는다. */
  const targetRef = useRef<{ id: number | null; typed: number }>({ id: null, typed: 0 });

  useEffect(() => { setIs3d(want3d()); }, []);
  useEffect(() => { preloadSprites(SPACE_SPRITES); }, []);

  // 반응(주스) 인스턴스 — burst 는 이 게임의 파티클(캔버스 로컬 좌표), 타격 묶음은 3D 장면이 그린다.
  useEffect(() => {
    juiceRef.current = createGameJuice({
      soundManager,
      burst: (o: { x: number; y: number; big?: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        particlesRef.current.explode(o.x - rect.left, o.y - rect.top, (o.big ?? 1) * 0.9);
      },
      kick: () => { if (!sceneRef.current) shakeRef.current.shake(2); },
      squash: (o: { enemy?: SpaceEnemy }) => { if (o.enemy) sceneRef.current?.hit(o.enemy); },
      knock: () => { /* 3D: hit() 안에서 드론이 번쩍+편대로 날아간다 · 2D: 파티클이 대신한다 */ },
      hitflash: () => { /* 3D: hit() 안에서 흰 번쩍 · 2D: 말풍선이 바로 사라진다 */ },
      haptics: () => settings.sfx,
    });
    return () => juiceRef.current?.destroy();
  }, [settings.sfx]);

  // 단어 목록 — 절차 생성 + 기본 데이터. daily 모드는 날짜 시드로 고정 순서를 뽑아야 하므로
  // 절차 생성 없이 고정 데이터만(staticPoolRef, 정렬) 따로 둔다(씨앗비와 같은 구조).
  useEffect(() => {
    wordGenerator.reset();
    const words = wordGenerator.getWords({
      language: settings.language,
      theme: 'space',
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
          const base = [...mod.koreanWordsBeginner, ...mod2.koreanWordsIntermediate].filter(w => w.length >= 2);
          staticPoolRef.current = [...new Set(base)].sort();
          setWordPool([...new Set([...base, ...words])]);
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
        language: settings.language,
        theme: 'space',
        difficulty: Math.min(10, level),
        count: 200,
        minLength: settings.language === 'ko' ? 2 : 3,
        maxLength: settings.language === 'ko' ? Math.min(8, 3 + level) : Math.min(14, 4 + level),
      });
      setWordPool(prev => [...new Set([...prev, ...newWords])]);
    }
  }, [level, settings.language, mode]);

  useEffect(() => {
    const c = coreRef.current;
    if (status === 'gameover' && c && c.score > 0) {
      void submitGameScore('space', c.score, Date.now() - startedAtRef.current, settings.language);
      setNewBest(saveBest(GAME_ID, mode, c.score));
    }
  }, [status, settings.language, mode]);

  // 일일 퀘스트·도전과제·학교 점수에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  useGameResult(status === 'gameover', () => {
    const c = coreRef.current;
    if (!c || (c.attempts === 0 && c.score === 0)) return null;
    return {
      gameType: 'space',
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
    setInput(''); setFixedCount(0);
    coreRef.current = null;
    targetRef.current = { id: null, typed: 0 };
    setEffectMsg(null);
    particlesRef.current = new ParticleSystem();
    shakeRef.current = new ScreenShake();
    wordGenerator.reset();
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
  const handleEvents = (events: SpaceEvent[], canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const c = coreRef.current;
    for (const e of events) {
      if (e.type === 'miss') {
        shakeRef.current.shake(sceneRef.current ? 0 : 8);
        particlesRef.current.explode(e.enemy.x, e.enemy.y, 0.5);
        sceneRef.current?.miss();
        juiceRef.current?.fire('miss', { x: rect.left + e.enemy.x, y: rect.top + e.enemy.y, color: '#FF6B6B' });
      } else if (e.type === 'gameover') {
        setStatus('gameover');
        soundManager?.play('gameOver');
      } else if (e.type === 'hit') {
        setScore(c?.score ?? 0);
        setFixedCount(c?.kills ?? 0);
        setMaxCombo(c?.maxCombo ?? 0);
        juiceRef.current?.fire('hit', {
          x: rect.left + e.enemy.x, y: rect.top + e.enemy.y, n: e.points, text: `+${e.points}`,
          color: e.enemy.color, big: e.enemy.isBoss ? 2 : e.enemy.special ? 1.3 : 1, enemy: e.enemy,
        });
      } else if (e.type === 'wrong') {
        juiceRef.current?.fire('miss', { color: '#FF6B6B' });
      } else if (e.type === 'ability') {
        const meta = ABILITY_META[e.ability];
        for (const enemy of e.cleared) particlesRef.current.explode(enemy.x, enemy.y, enemy.isBoss ? 1.5 : 0.7);
        sceneRef.current?.ability(e.ability);
        setScore(c?.score ?? 0);
        juiceRef.current?.fire('special', { title: `${meta.label}!`, color: meta.color, vib: [25, 30, 25] });
        flashEffect(e.ability, `${meta.label} 발동!`);
      } else if (e.type === 'levelup') {
        setLevel(e.level);
        juiceRef.current?.fire('levelup', { title: `LEVEL ${e.level}!`, color: '#48DBFB' });
      }
    }
  };

  // Main game loop
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
    const { cx, cy } = spaceCenter(W, H);
    const particles = particlesRef.current;
    const shake = shakeRef.current;

    // 오늘의 판 = 날짜 시드 + 고정 단어 목록(모두 같은 순서) · 그 밖 = 기존 무작위
    const daily = mode === 'daily';
    const rng = daily ? seededRng(seedFromString(`space:${todayKey()}:${settings.language}`)) : Math.random;
    const dailyPool = staticPoolRef.current.length ? staticPoolRef.current : wordPool;
    const core = new SpaceCore({
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
    (window as unknown as { __space?: unknown }).__space = { core, scene: () => sceneRef.current };

    // 3D 장면(있으면) — three 는 이때만 받는다. 못 만들면 2D 판 그대로.
    let alive = true;
    if (is3d && canvas3dRef.current) {
      const c3 = canvas3dRef.current;
      import('@/lib/game3d/space-scene').then((m) => {
        if (!alive) return;
        try { sceneRef.current = m.createSpaceScene(c3, W, H); } catch { sceneRef.current = null; setIs3d(false); }
      }).catch(() => setIs3d(false));
    }

    if (starsRef.current.length === 0) starsRef.current = createStarfield(120, W, H);
    let lastT = 0;

    const loop = (time: number) => {
      const dt = lastT ? Math.min(50, time - lastT) : 16;
      lastT = time;
      const shakeOffset = sceneRef.current ? { x: 0, y: 0 } : shake.update();

      // 타격 순간 0.1초 멈춤(hitstop) — 다가오는 드론·입력은 그대로
      const gameDt = juiceRef.current ? juiceRef.current.time(dt / 1000) : dt / 1000;
      const events = gameDt > 0 ? core.tick(time) : [];
      if (events.length) handleEvents(events, canvas);
      if (core.over) { cancelAnimationFrame(animFrameRef.current); return; }

      const scene = sceneRef.current;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(shakeOffset.x, shakeOffset.y);

      // === 배경(2D 판에서만 — 3D 장면이 있으면 그 장면이 통로·별을 그린다) ===
      if (!scene) {
        if (!drawBackgroundImage(ctx, 'space-bg', W, H, 0.2)) drawSpaceBackground(ctx, W, H, time);
        drawStarfield(ctx, starsRef.current, time, 0.015);
        drawNebula(ctx, W, H, time);
      }

      // === 내 함선(2D 판에서만) ===
      const hoverY = cy + Math.sin(time * 0.003) * 4;
      if (!scene) {
        const bank = Math.sin(time * 0.0016) * 0.05;
        const thrust = 0.6 + Math.abs(Math.sin(time * 0.02)) * 0.4;
        const tGrad = ctx.createRadialGradient(cx, hoverY + 40, 0, cx, hoverY + 40, 22 * thrust);
        tGrad.addColorStop(0, `rgba(120,230,255,${0.55 * thrust})`);
        tGrad.addColorStop(0.5, `rgba(80,160,255,${0.3 * thrust})`);
        tGrad.addColorStop(1, 'rgba(80,160,255,0)');
        ctx.fillStyle = tGrad;
        ctx.beginPath();
        ctx.ellipse(cx, hoverY + 40, 12 * thrust, 26 * thrust, 0, 0, Math.PI * 2);
        ctx.fill();
        const currentShield = core.shield;
        if (!drawSprite(ctx, 'space-player', cx, hoverY, { h: 88, rotate: bank })) {
          drawPlayerShip(ctx, cx, cy, time, currentShield > 0);
        } else if (currentShield > 0) {
          ctx.beginPath();
          ctx.arc(cx, hoverY, 50, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(0,210,211,${0.3 + Math.sin(time * 0.01) * 0.15})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // === 드론(기체 그리기 + 라벨 배치) ===
      const frozen = core.isFrozen(time);
      const spriteBoxes: LabelBox[] = [
        { x: cx, y: hoverY, w: spriteWidthFor('space-player', 88, 50), h: 88 },
        { x: cx, y: 26, w: W, h: 52, weight: 0.8 },
        { x: cx, y: H - 26, w: W, h: 48, weight: 0.8 },
      ];
      const labels: (LabelRequest & { e: SpaceEnemy; fs: number; spriteH: number; alpha: number })[] = [];
      for (const e of core.enemies) {
        const age = (time - e.spawnTime) / 1000;
        const alpha = Math.min(1, age * 2);
        const wobble = Math.sin(time * 0.006 + e.id * 1.7) * 0.12;
        const pulse = 1 + Math.sin(time * 0.008 + e.id) * 0.05;
        const scale = (e.isBoss ? 1.8 : 1) * pulse;
        if (!scene) {
          ctx.globalAlpha = alpha;
          if (!drawSprite(ctx, 'space-enemy', e.x, e.y, { h: 40 * scale, rotate: wobble })) {
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.scale(scale, scale);
            ctx.translate(-e.x, -e.y);
            drawEnemyShip(ctx, e.x, e.y, e.shipType, time, e.color);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
        }

        const fs = e.isBoss ? 16 : e.special ? 16 : 14;
        const spriteH = 40 * scale;
        const home = wordBubbleY({ spriteY: e.y, spriteH, fontSize: fs, gap: e.isBoss ? 26 : 9, canvasH: H, below: true });
        spriteBoxes.push({
          x: e.x, y: e.y,
          w: spriteWidthFor('space-enemy', spriteH, 40 * scale) + 6,
          h: e.isBoss ? spriteH + 24 : spriteH,
        });
        labels.push({
          e, fs, spriteH, alpha,
          x: e.x,
          w: wordBubbleWidth(ctx, e.text, fs),
          h: wordBubbleHeight(fs),
          homeY: home,
          y: 0, dir: home > e.y ? 1 : -1, offset: 0, prefer: e.labelShift,
        });

        if (e.isBoss) drawShieldBar(ctx, e.x - 30, e.y + 40, 1, 1, 60);

        // 수리 광선(조준선) — 입력 중인 드론에만. 완성 전까지는 2D 판에서도 같은 느낌으로 보여 준다.
        if (targetRef.current.id === e.id && targetRef.current.typed > 0) {
          if (!scene) drawLaser(ctx, cx, cy - 20, e.x, e.y, time, '#48DBFB');
          particles.laserHit(e.x, e.y);
        }
      }

      // 3D 판은 드론이 라벨 밑 3D 에 있어 «몸통 가림»보다 «라벨끼리 겹침(글자를 못 읽음)»이 더 나쁘다 — 배포본 실측 20표본 내내 겹침(2026-10-21)
      resolveLabels(labels, spriteBoxes, { canvasH: H, labelWeight: scene ? 8 : 1 });
      for (const L of labels) {
        L.e.labelShift = easeLabelShift(L.e.labelShift, L.offset);
        const y = L.homeY + L.e.labelShift;
        ctx.globalAlpha = L.alpha;
        drawBubbleLeader(ctx, L.x, L.e.y, L.spriteH, y, L.fs, undefined, H);
        if (L.e.special && L.e.ability) {
          drawSpecialMarker(ctx, L.e.x, L.e.y, L.e.ability, time, L.e.id, L.e.y - L.spriteH / 2 - 8);
        }
        drawWordBubble(ctx, L.x, y, L.e.text, L.e.color, {
          targeted: targetRef.current.id === L.e.id,
          fontSize: L.fs,
        });
        ctx.globalAlpha = 1;
      }
      (window as unknown as { __spaceLabels?: unknown }).__spaceLabels = labels.map((L) => ({ x: L.x - L.w / 2, y: (L.homeY + (L.e.labelShift ?? 0)) - L.h / 2, w: L.w, h: L.h }));

      // 3D 드론은 위에서 정한 라벨 자리(비켜 선 거리 포함)를 따라간다
      scene?.render(core.enemies, time, frozen, targetRef.current);

      particles.update();
      particles.draw(ctx);

      // 일시정지(freeze) 발동 중 얼음 오버레이
      if (frozen) {
        ctx.save();
        ctx.fillStyle = 'rgba(72,219,251,0.10)';
        ctx.fillRect(0, 0, W, H);
        ctx.font = "bold 13px 'Noto Sans KR', sans-serif";
        ctx.fillStyle = 'rgba(180,240,255,0.9)';
        ctx.textAlign = 'center';
        ctx.fillText('일시정지', W / 2, 52);
        drawVectorIcon(ctx, ICON_SNOWFLAKE, W / 2 - ctx.measureText('일시정지').width / 2 - 11, 47, 16, 'rgba(180,240,255,0.9)');
        ctx.restore();
      }

      // === HUD ===
      const rem = core.remaining(time);
      drawHUD(ctx, {
        score: core.score,
        level: rem !== null ? Math.ceil(rem / 1000) : core.level,
        combo: core.combo,
        label: rem !== null ? (isKorean ? '초' : 'SEC') : 'LEVEL',
      }, W);

      if (core.mode === 'survival') {
        ctx.font = "bold 12px 'JetBrains Mono', 'Noto Sans KR', monospace";
        ctx.fillStyle = '#FFE3EC';
        ctx.textAlign = 'center';
        ctx.fillText(`목숨 ${'●'.repeat(core.lives)}${'○'.repeat(SURVIVAL_LIVES - core.lives)}`, W / 2, H - 14);
      } else {
        drawShieldBar(ctx, 20, H - 25, core.shield, SHIELD_START, 200);
        ctx.font = "10px 'Noto Sans KR', sans-serif";
        ctx.fillStyle = 'rgba(232,232,255,0.5)';
        ctx.textAlign = 'left';
        ctx.fillText(isKorean ? '방어막' : 'SHIELD', 20, H - 30);
      }

      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.fillStyle = 'rgba(232,232,255,0.4)';
      ctx.textAlign = 'right';
      ctx.fillText(`${isKorean ? '수리' : 'FIXED'}: ${core.kills}`, W - 20, H - 10);

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

  // 화면 입력에 맞춰 드론을 자동 조준(수리 광선이 향할 대상) — core.enemies 를 직접 읽는다.
  useEffect(() => {
    const trimmed = input.trim();
    const core = coreRef.current;
    if (!trimmed || !core) { targetRef.current = { id: null, typed: 0 }; return; }
    const match = core.enemies.find((e) => e.text.startsWith(trimmed));
    targetRef.current = match ? { id: match.id, typed: trimmed.length } : { id: null, typed: 0 };
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const core = coreRef.current;
    const canvas = canvasRef.current;
    if (!input.trim() || !core || !canvas) return;
    handleEvents(core.submit(input, performance.now()), canvas);
    setInput('');
    targetRef.current = { id: null, typed: 0 };
  };

  if (status === 'menu') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <div className="text-left mb-4"><SchoolRankCard /></div>
        <div className="flex justify-end mb-2"><FullscreenButton /></div>
        <div className="text-7xl mb-4">
          <svg viewBox="0 0 80 80" width="80" height="80" className="mx-auto">
            <defs>
              <linearGradient id="shipGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#A29BFE"/>
                <stop offset="100%" stopColor="#6C5CE7"/>
              </linearGradient>
            </defs>
            <rect width="80" height="80" rx="16" fill="#0A0A2E"/>
            <circle cx="15" cy="12" r="1" fill="#E8E8FF" opacity="0.6"/>
            <circle cx="65" cy="18" r="1.2" fill="#A29BFE" opacity="0.5"/>
            <circle cx="55" cy="60" r="0.8" fill="#E8E8FF" opacity="0.4"/>
            <g transform="translate(40,45)">
              <polygon points="0,-18 -12,10 0,5 12,10" fill="url(#shipGrad)"/>
              <polygon points="0,-18 -7,5 0,8 7,5" fill="#8B7CF7"/>
              <polygon points="0,-14 -4,-4 0,-2 4,-4" fill="#48DBFB"/>
              <ellipse cx="0" cy="14" rx="5" ry="8" fill="#6C5CE7" opacity="0.4"/>
            </g>
          </svg>
        </div>
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>
          {isKorean ? '우주 방어' : 'Space Defense'}
        </h1>
        <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {isKorean ? '통로를 가로질러 다가오는 고장 난 드론! 단어를 입력해 수리 광선을 쏘아 살려내세요.' : 'Type the words to beam-repair broken drones drifting down the corridor!'}
        </p>
        <div className="max-w-md mx-auto mb-6">
          <Card className="p-4 text-left">
            <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>{isKorean ? '• 드론에 표시된 단어를 완성하면 수리 완료 — 되살아나 내 편대에 합류' : '• Finish the word to repair a drone — it joins your squadron'}</li>
              <li>{isKorean ? '• 10기 수리할 때마다 레벨 업' : '• Level up every 10 repaired drones'}</li>
              <li>{isKorean ? '• 콤보로 보너스 점수 획득' : '• Chain combos for bonus points'}</li>
              <li>{isKorean ? '• 대장 드론 등장 시 긴 단어 입력 필요' : '• The boss drone needs a longer word'}</li>
              <li>{isKorean ? '• 레벨 업 시 방어막 1 회복' : '• Shield +1 on level up'}</li>
              <li style={{ color: '#FECA57' }} className="flex items-center gap-1 flex-wrap">
                •<Sparkles className="w-3.5 h-3.5 inline" aria-hidden />
                {isKorean ? (
                  <>
                    금빛 특수 드론을 고치면 능력 발동 (
                    <Snowflake className="w-3.5 h-3.5 inline" aria-hidden />정지·
                    <Zap className="w-3.5 h-3.5 inline" aria-hidden />전멸·
                    <Heart className="w-3.5 h-3.5 inline" aria-hidden />방어막) + 점수 2배
                  </>
                ) : (
                  'Golden drones trigger abilities (freeze/clear/heal) + 2x points'
                )}
              </li>
            </ul>
          </Card>
        </div>
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
      <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <div className="text-8xl font-bold neon-text" style={{ fontFamily: "'Outfit', sans-serif", color: 'var(--color-primary)' }}>{countdown}</div>
      </div>
    );
  }

  if (status === 'gameover') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <h1 className="text-3xl font-bold mb-2" style={{ color: mode === 'time' ? 'var(--color-primary)' : 'var(--color-error)', fontFamily: "'Outfit'" }}>
          {mode === 'time' ? (isKorean ? '시간 끝!' : "Time's up!") : (isKorean ? '게임 오버' : 'Game Over')}
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
          {isKorean ? '기지 방어막이 다 떨어졌습니다' : 'Your base shield ran out'}
        </p>
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
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '최대 콤보' : 'MAX COMBO'}</div>
            <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-combo)' }}>{maxCombo}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '수리' : 'FIXED'}</div>
            <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: '#00B894' }}>{fixedCount}</div>
          </Card>
        </div>
        <Button size="lg" data-gb="play" onClick={() => schoolGate(startGame)}>{isKorean ? '다시 시작' : 'Retry'}</Button>
        <div className="mt-3"><Button variant="ghost" onClick={() => setStatus('menu')}>{isKorean ? '모드 바꾸기' : 'Change mode'}</Button></div>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-4 py-4">
      <div className="relative rounded-xl overflow-hidden border border-[var(--key-border)]" style={{ height: '500px' }} data-render={is3d ? '3d' : '2d'}>
        {is3d && <canvas ref={canvas3dRef} className="absolute inset-0 w-full h-full" style={{ display: 'block' }} aria-hidden />}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ display: 'block' }} />
        <div className="absolute top-2 right-2"><FullscreenButton /></div>
        {effectMsg && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-sm font-bold pointer-events-none flex items-center gap-1.5"
            style={{ background: 'rgba(254,202,87,0.92)', color: '#3A2A00', boxShadow: '0 4px 16px rgba(254,202,87,0.4)' }}>
            <AbilityIcon ability={effectMsg.ability} className="w-4 h-4" />
            {effectMsg.msg}
          </div>
        )}
      </div>
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          className="flex-1 px-4 py-3 rounded-xl border border-[var(--key-border)] text-lg"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: "'JetBrains Mono'" }}
          placeholder={isKorean ? '단어를 입력하세요...' : 'Type the word...'}
          autoComplete="off"
          autoFocus
        />
        <Button type="submit" size="lg">{isKorean ? '수리' : 'Repair'}</Button>
      </form>
    </div>
  );
}
