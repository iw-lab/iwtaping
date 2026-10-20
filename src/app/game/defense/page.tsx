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
  drawCastleDetailed, drawSoldierEnemy, drawWordBubble, drawShieldBar,
  preloadSprites, drawSprite, drawBackgroundImage, wordBubbleY, wordBubbleHeight, wordBubbleWidth,
  drawBubbleLeader, resolveLabels, easeLabelShift, spriteWidthFor,
  type LabelBox, type LabelRequest,
} from '@/lib/game/renderer';
import { ABILITY_META, drawSpecialMarker } from '@/lib/game/special-words';
import { createGameJuice } from '@/lib/game/juice-table';
import { drawVectorIcon, ICON_SNOWFLAKE } from '@/lib/game/canvas-icons';
import { AbilityIcon } from '@/components/common/AbilityIcon';
import {
  DefenseCore, CASTLE_HP_START, seededRng, seedFromString,
  type Ability, type DefenseEnemy, type DefenseEvent,
} from '@/lib/game/defense/core';
import type { DefenseScene } from '@/lib/game3d/defense-scene';
import { FullscreenButton } from '@/components/game/FullscreenButton';
import { SchoolRankCard } from '@/components/school/SchoolRankCard';
import { ModePicker, useGameMode, saveBest, todayKey } from '@/components/game/ModePicker';
import { Snowflake, Zap, Heart } from 'lucide-react';

const DEFENSE_SPRITES = {
  'defense-bg': '/game/defense/bg.webp',
  'defense-castle': '/game/defense/castle.webp',
  'defense-enemy': '/game/defense/enemy.webp',
};

const GAME_ID = 'defense';

/** 3D 판을 쓸 수 있나 — WebGL2 가 있고 «가벼운 화면»을 고르지 않았을 때(없으면 지금 2D 판 그대로) */
function want3d(): boolean {
  try {
    if (localStorage.getItem('typingverse:lite') === '1') return false;
    if (new URLSearchParams(location.search).get('lite') === '1') return false;
    return !!document.createElement('canvas').getContext('webgl2');
  } catch { return false; }
}

export default function DefenseGamePage() {
  const { settings } = useSettingsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  useGameBgm('action', status === 'countdown' || status === 'playing');
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [gold, setGold] = useState(0);
  const [castleHp, setCastleHp] = useState(CASTLE_HP_START);
  const [mode, setMode] = useGameMode('defense');
  const [newBest, setNewBest] = useState(false);
  const [input, setInput] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [wordPool, setWordPool] = useState<string[]>([]);
  const [killCount, setKillCount] = useState(0);
  const [effectMsg, setEffectMsg] = useState<{ ability: Ability; msg: string } | null>(null);
  const [is3d, setIs3d] = useState(false);

  const coreRef = useRef<DefenseCore | null>(null);
  const sceneRef = useRef<DefenseScene | null>(null);
  const animRef = useRef<number>(0);
  const startedAtRef = useRef(0);
  const particlesRef = useRef(new ParticleSystem());
  const shakeRef = useRef(new ScreenShake());
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 격파·피격·능력·웨이브업
  const isKorean = settings.language === 'ko';

  useEffect(() => { preloadSprites(DEFENSE_SPRITES); }, []);
  useEffect(() => { setIs3d(want3d()); }, []);

  // 반응(주스) 인스턴스 — burst는 이 게임의 파티클(캔버스 로컬 좌표)로, sfx는 기존 soundManager로 연결한다.
  useEffect(() => {
    juiceRef.current = createGameJuice({
      soundManager,
      burst: (o: { x: number; y: number; big?: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        particlesRef.current.explode(o.x - rect.left, o.y - rect.top, (o.big ?? 1) * 0.8);
      },
      kick: () => { if (!sceneRef.current) shakeRef.current.shake(2); },
      squash: (o: { enemy?: DefenseEnemy }) => { if (o.enemy) sceneRef.current?.hit(o.enemy); },
      knock: () => { /* 3D: hit() 안에서 병정이 쓰러지며 자리를 벗어난다 · 2D: 파티클이 대신한다 */ },
      hitflash: () => { /* 3D: hit() 안에서 병정이 하얗게 번쩍 · 2D: 말풍선이 바로 사라진다 */ },
      haptics: () => settings.sfx,
    });
    return () => juiceRef.current?.destroy();
  }, [settings.sfx]);

  useEffect(() => {
    wordGenerator.reset();
    const words = wordGenerator.getWords({
      language: settings.language, theme: 'fantasy', difficulty: 1, count: 500,
      minLength: settings.language === 'ko' ? 2 : 3,
      maxLength: settings.language === 'ko' ? 6 : 10,
    });
    (async () => {
      try {
        if (settings.language === 'ko') {
          const mod = await import('@/data/korean/words-beginner');
          const mod2 = await import('@/data/korean/words-intermediate');
          setWordPool([...new Set([...mod.koreanWordsBeginner, ...mod2.koreanWordsIntermediate, ...words])]);
        } else {
          const mod = await import('@/data/english/words-common200');
          const mod2 = await import('@/data/english/words-common1000');
          setWordPool([...new Set([...mod.englishCommon200, ...mod2.englishCommon1000, ...words].filter(w => w.length >= 3))]);
        }
      } catch {
        setWordPool(words);
      }
    })();
  }, [settings.language]);

  useEffect(() => {
    if (wave > 1) {
      const newWords = wordGenerator.getWords({
        language: settings.language, theme: 'fantasy', difficulty: Math.min(10, wave), count: 100,
      });
      setWordPool(prev => [...new Set([...prev, ...newWords])]);
    }
  }, [wave, settings.language]);

  useEffect(() => {
    const c = coreRef.current;
    if (status === 'gameover' && c && c.score > 0) {
      void submitGameScore('defense', c.score, Date.now() - startedAtRef.current, settings.language);
      setNewBest(saveBest('defense', mode, c.score));
    }
  }, [status, settings.language, mode]);

  // 일일 퀘스트·도전과제에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  // 킹덤 디펜스는 콤보 시스템이 없어 maxCombo는 0으로 둔다.
  useGameResult(status === 'gameover', () => {
    const c = coreRef.current;
    if (!c || (c.attempts === 0 && c.score === 0)) return null;
    return {
      gameType: 'defense',
      score: c.score,
      level: c.wave,
      maxCombo: 0,
      accuracy: hitAccuracy(c.kills, c.attempts),
      wordsTyped: c.kills,
      elapsedTime: Math.round((Date.now() - startedAtRef.current) / 1000),
    };
  });

  const startGame = () => {
    setStatus('countdown');
    startedAtRef.current = Date.now();
    setScore(0); setWave(1); setGold(0); setCastleHp(mode === 'survival' ? 3 : CASTLE_HP_START); setNewBest(false);
    setInput(''); setKillCount(0);
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

  /** 코어가 낸 사건 → 소리·화면 반응·3D 장면. submit()(즉시)·tick()(화살 명중 등) 양쪽에서 쓴다. */
  const handleEvents = (events: DefenseEvent[], canvas: HTMLCanvasElement, W: number, H: number) => {
    const rect = canvas.getBoundingClientRect();
    const c = coreRef.current;
    const scene = sceneRef.current;
    for (const e of events) {
      if (e.type === 'miss') {
        setCastleHp(c?.castleHp ?? 0);
        shakeRef.current.shake(scene ? 0 : 5);
        particlesRef.current.emit(W - 120, e.enemy.y, 8, {
          speed: 2, life: 20, size: 3, colors: ['#FF6B6B', '#FF9F43'],
        });
        scene?.miss(e.enemy);
        if (!c?.over) juiceRef.current?.fire('miss', { x: rect.left + (W - 120), y: rect.top + e.enemy.y, color: '#FF6B6B' });
      } else if (e.type === 'gameover') {
        particlesRef.current.explode(W - 100, H * 0.75, 2);
        setStatus('gameover');
        soundManager?.play('gameOver');
      } else if (e.type === 'hit') {
        shakeRef.current.shake(scene ? 0 : 3);
        juiceRef.current?.fire('hit', {
          x: rect.left + e.enemy.x, y: rect.top + e.enemy.y, n: e.points, text: e.points ? `+${e.points}` : undefined,
          color: e.enemy.color, big: e.enemy.special ? 1.3 : 1, enemy: e.enemy,
        });
      } else if (e.type === 'wrong') {
        juiceRef.current?.fire('miss', { color: '#FF6B6B' });
      } else if (e.type === 'ability') {
        const meta = ABILITY_META[e.ability];
        const abilityLabel = e.ability === 'heal' ? '성 수리' : meta.label;
        if (e.ability === 'clear') {
          for (const en of e.cleared) particlesRef.current.explode(en.x, en.y, 0.6);
          shakeRef.current.shake(scene ? 0 : 8);
        }
        scene?.ability(e.ability);
        setScore(c?.score ?? 0);
        setGold(c?.gold ?? 0);
        juiceRef.current?.fire('special', { title: `${abilityLabel}!`, color: meta.color, vib: [25, 30, 25] });
        flashEffect(e.ability, `${abilityLabel} 발동!`);
      } else if (e.type === 'waveup') {
        setWave(e.wave);
        setCastleHp(c?.castleHp ?? 0);
        juiceRef.current?.fire('levelup', { title: `WAVE ${e.wave}!`, color: '#FECA57' });
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

    // 오늘의 판 = 날짜 시드 + 정렬한 단어 목록(모두 같은 순서) · 그 밖 = 기존 무작위
    const daily = mode === 'daily';
    const rng = daily ? seededRng(seedFromString(`defense:${todayKey()}:${settings.language}`)) : Math.random;
    const dailyPool = daily ? [...wordPool].sort() : wordPool;
    const core = new DefenseCore({
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
    (window as unknown as { __defense?: unknown }).__defense = { core, scene: () => sceneRef.current };

    // 3D 장면(있으면) — three 는 이때만 받는다. 못 만들면 2D 판 그대로.
    let alive = true;
    if (is3d && canvas3dRef.current) {
      const c3 = canvas3dRef.current;
      import('@/lib/game3d/defense-scene').then((m) => {
        if (!alive) return;
        try { sceneRef.current = m.createDefenseScene(c3, W, H); } catch { sceneRef.current = null; setIs3d(false); }
      }).catch(() => setIs3d(false));
    }

    const loop = (time: number) => {
      const events = core.tick(time);
      if (events.length) handleEvents(events, canvas, W, H);
      if (core.over) { cancelAnimationFrame(animRef.current); return; }

      const scene = sceneRef.current;
      const shakeOffset = scene ? { x: 0, y: 0 } : shake.update();
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(shakeOffset.x, shakeOffset.y);

      const hpVal = core.castleHp;
      const castleBaseX = W - 100;
      const castleBaseY = H * 0.75;

      if (!scene) {
        drawDefenseBackdrop(ctx, W, H, time);
        // Castle — AI sprite with HP bar + damage tint, else procedural (damage states built-in)
        if (drawSprite(ctx, 'defense-castle', castleBaseX, castleBaseY - 72, { h: 150 })) {
          const hpRatio = Math.max(0, hpVal / core.maxHp());
          if (hpRatio < 1) {
            ctx.save();
            ctx.globalAlpha = (1 - hpRatio) * 0.35;
            ctx.fillStyle = '#8B1A1A';
            ctx.fillRect(castleBaseX - 55, castleBaseY - 150, 110, 150);
            ctx.restore();
          }
          const barW = 90, barX = castleBaseX - barW / 2, barY = castleBaseY - 158;
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(barX - 2, barY - 2, barW + 4, 8);
          ctx.fillStyle = hpRatio > 0.5 ? '#48DBFB' : hpRatio > 0.25 ? '#FECA57' : '#FF6B6B';
          ctx.fillRect(barX, barY, barW * hpRatio, 4);
        } else {
          drawCastleDetailed(ctx, castleBaseX, castleBaseY - 20, hpVal, core.maxHp(), time);
        }
      }

      // 라벨 상자 — 성·HUD·각 병사가 가리는 영역을 알아야 라벨이 안 걸친다.
      const spriteBoxes: LabelBox[] = [
        { x: castleBaseX, y: castleBaseY - 72, w: spriteWidthFor('defense-castle', 150, 120), h: 150 },
        { x: W / 2, y: 28, w: W, h: 56, weight: 0.8 },
      ];
      const labels: (LabelRequest & { e: DefenseEnemy; fs: number })[] = [];
      const frozen = core.isFrozen(time);
      for (const e of core.enemies) {
        const walkPhase = time * 0.008 + e.id + e.x * 0.01;
        const bob = Math.abs(Math.sin(walkPhase)) * 3;
        const sway = Math.sin(walkPhase) * 0.09;
        const spriteH = e.type === 2 ? 56 : 44;
        if (!scene) {
          ctx.save();
          if (!drawSprite(ctx, 'defense-enemy', e.x, e.y - 8 - bob, { h: spriteH, rotate: sway })) {
            drawSoldierEnemy(ctx, e.x, e.y, e.type, walkPhase, time);
          }
          ctx.restore();
        }
        const fs = e.special ? 15 : 13;
        const boxH = spriteH + 6;
        const bh = wordBubbleHeight(fs);
        const home = wordBubbleY({ spriteY: e.y - 8, spriteH: boxH, fontSize: fs, canvasH: H });
        spriteBoxes.push({ x: e.x, y: e.y - 8, w: spriteWidthFor('defense-enemy', spriteH, 32) + 6, h: boxH });
        labels.push({
          e, fs,
          x: e.x,
          w: wordBubbleWidth(ctx, e.text, fs),
          h: bh,
          homeY: home,
          y: 0, dir: home < e.y - 8 ? -1 : 1, offset: 0, prefer: e.labelShift,
        });
      }

      // 3D 판은 병정이 라벨 밑 3D 에 있어 «몸통 가림»보다 «라벨끼리 겹침(글자를 못 읽음)»이 더 나쁘다 — 배포본 실측 겹침 1(2026-10-21)
      resolveLabels(labels, spriteBoxes, { canvasH: H, labelWeight: scene ? 8 : 1 });
      for (const L of labels) L.e.labelShift = easeLabelShift(L.e.labelShift, L.offset);
      (window as unknown as { __defenseLabels?: unknown }).__defenseLabels = labels.map((L) => {
        const y = L.homeY + (L.e.labelShift ?? 0);
        return { x: L.e.x - L.w / 2, y: y - L.h / 2, w: L.w, h: L.h };
      });

      // 3D 장면은 라벨이 정한 자리(비켜 선 거리 포함)를 따라간다
      scene?.render(core.enemies, core.arrows, time, frozen);

      for (const L of labels) {
        const y = L.homeY + (L.e.labelShift ?? 0);
        if (!scene) drawBubbleLeader(ctx, L.x, L.e.y - 8, L.e.type === 2 ? 62 : 50, y, L.fs, undefined, H);
        if (L.e.special && L.e.ability) {
          drawSpecialMarker(ctx, L.e.x, L.e.y - 8, L.e.ability, time, L.e.id, y - L.h / 2 - 7);
        }
        drawWordBubble(ctx, L.x, y, L.e.text, L.e.color, { fontSize: L.fs });
      }

      if (!scene) {
        for (const a of core.arrows) {
          ctx.save();
          ctx.translate(a.x, a.y);
          ctx.rotate(a.angle);
          ctx.strokeStyle = 'rgba(254,202,87,0.3)';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(-8, 0); ctx.stroke();
          const shaftGrad = ctx.createLinearGradient(-10, -1, 6, 1);
          shaftGrad.addColorStop(0, '#8B4513'); shaftGrad.addColorStop(0.5, '#A0522D'); shaftGrad.addColorStop(1, '#CD853F');
          ctx.strokeStyle = shaftGrad; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(6, 0); ctx.stroke();
          const headGrad = ctx.createLinearGradient(5, -3, 10, 3);
          headGrad.addColorStop(0, '#E5E5E5'); headGrad.addColorStop(0.5, '#C0C0C0'); headGrad.addColorStop(1, '#A0A0A0');
          ctx.fillStyle = headGrad;
          ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(5, -4); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#F5F5F5'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(5, -2); ctx.stroke();
          ctx.fillStyle = '#8B0000';
          ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-15, -4); ctx.lineTo(-12, 0); ctx.lineTo(-15, 4); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }

      particles.update();
      particles.draw(ctx);

      if (frozen) {
        ctx.save();
        ctx.fillStyle = 'rgba(72,219,251,0.10)';
        ctx.fillRect(0, 0, W, H);
        ctx.font = "bold 13px 'Noto Sans KR', sans-serif";
        ctx.fillStyle = 'rgba(180,240,255,0.9)';
        ctx.textAlign = 'center';
        ctx.fillText('일시정지', W / 2, 62);
        drawVectorIcon(ctx, ICON_SNOWFLAKE, W / 2 - ctx.measureText('일시정지').width / 2 - 11, 57, 16, 'rgba(180,240,255,0.9)');
        ctx.restore();
      }

      // 3D 판은 성 체력 바를 그려 주지 않으므로(그림은 3D 쪽) HUD 에 따로 띄운다.
      if (scene) {
        drawShieldBar(ctx, 20, H - 30, hpVal, core.maxHp(), W - 40);
        ctx.font = "bold 12px 'JetBrains Mono', 'Noto Sans KR', monospace";
        ctx.fillStyle = '#E8E8FF';
        ctx.textAlign = 'center';
        const rem = core.remaining(time);
        ctx.fillText(rem !== null ? `성 체력 ${hpVal} · 남은 ${Math.ceil(rem / 1000)}초` : `성 체력 ${hpVal}`, W / 2, H - 12);
      }

      // HUD
      ctx.font = "bold 18px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#E8E8FF';
      ctx.textAlign = 'left';
      ctx.fillText(`${core.score}`, 20, 25);
      ctx.font = "9px 'Noto Sans KR', sans-serif";
      ctx.fillStyle = 'rgba(232,232,255,0.4)';
      ctx.fillText('SCORE', 20, 12);

      ctx.save();
      ctx.translate(W / 2, 15);
      const bannerGrad = ctx.createLinearGradient(-60, -8, 60, 8);
      bannerGrad.addColorStop(0, 'rgba(162,155,254,0.8)');
      bannerGrad.addColorStop(0.5, 'rgba(108,92,231,0.9)');
      bannerGrad.addColorStop(1, 'rgba(162,155,254,0.8)');
      ctx.fillStyle = bannerGrad;
      ctx.beginPath();
      ctx.moveTo(-60, -8); ctx.lineTo(60, -8); ctx.lineTo(70, 0); ctx.lineTo(60, 8); ctx.lineTo(-60, 8); ctx.lineTo(-70, 0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8B7ED8'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = "bold 16px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`WAVE ${core.wave}`, 0, 0);
      ctx.restore();

      const aliveEnemies = core.enemies.filter(e => !e.dying).length;
      if (aliveEnemies > 0) {
        ctx.font = "12px 'JetBrains Mono', monospace";
        ctx.fillStyle = 'rgba(255,107,107,0.8)';
        ctx.textAlign = 'center';
        ctx.fillText(`${aliveEnemies} enemies`, W / 2, 45);
      }

      ctx.font = "13px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#FECA57';
      ctx.textAlign = 'right';
      ctx.fillText(`${core.gold}G`, W - 20, 25);

      ctx.restore();
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(animRef.current);
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
    const events = core.submit(input, performance.now());
    // 점수·골드·웨이브·킬 수는 입력 순간 바로 반영한다(병사는 화살이 실제로 닿을 때 치워진다).
    setScore(core.score); setGold(core.gold); setWave(core.wave); setKillCount(core.kills);
    handleEvents(events, canvas, canvas.offsetWidth, canvas.offsetHeight);
    setInput('');
  };

  if (status === 'menu') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <div className="text-left mb-4"><SchoolRankCard /></div>
        <div className="flex justify-end mb-2"><FullscreenButton /></div>
        <div className="text-6xl mb-4">
          <svg viewBox="0 0 80 80" width="80" height="80" className="mx-auto">
            <rect width="80" height="80" rx="16" fill="#0A0A2E"/>
            <g transform="translate(40,42)">
              <rect x="-15" y="-18" width="30" height="36" fill="#4A3FAF"/>
              <rect x="-20" y="-28" width="10" height="46" fill="#4A3FAF"/>
              <rect x="10" y="-28" width="10" height="46" fill="#4A3FAF"/>
              <polygon points="-20,-28 -15,-38 -10,-28" fill="#6C5CE7"/>
              <polygon points="10,-28 15,-38 20,-28" fill="#6C5CE7"/>
              <rect x="-6" y="4" width="12" height="14" rx="6" fill="#1A1A3E"/>
              <rect x="-5" y="-12" width="4" height="5" fill="rgba(254,202,87,0.5)"/>
              <rect x="1" y="-12" width="4" height="5" fill="rgba(254,202,87,0.5)"/>
              <line x1="0" y1="-28" x2="0" y2="-42" stroke="#A29BFE" strokeWidth="2"/>
              <polygon points="0,-42 10,-36 0,-30" fill="#6C5CE7"/>
            </g>
          </svg>
        </div>
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit'" }}>
          {isKorean ? '킹덤 디펜스' : 'Kingdom Defense'}
        </h1>
        <p className="mb-3" style={{ color: 'var(--text-secondary)' }}>
          {isKorean ? '성을 지키며 타이핑하세요!' : 'Defend your castle by typing!'}
        </p>
        {isKorean && (
          <p className="mb-5 text-sm max-w-md mx-auto flex flex-wrap items-center justify-center gap-x-2 gap-y-1" style={{ color: 'var(--text-muted)' }}>
            <span>금빛 <b style={{ color: '#FECA57' }}>특수 병정</b>의 태엽을 풀면 능력 발동(점수 2배)</span>
            <span className="inline-flex items-center gap-1"><Snowflake className="w-4 h-4" aria-hidden />일시정지</span>
            <span className="inline-flex items-center gap-1"><Zap className="w-4 h-4" aria-hidden />모두 멈춤</span>
            <span className="inline-flex items-center gap-1"><Heart className="w-4 h-4" aria-hidden />성 수리</span>
          </p>
        )}
        <ModePicker game="defense" value={mode} onChange={setMode} />
        <Button size="lg" data-gb="play" onClick={() => schoolGate(startGame)}>{isKorean ? '게임 시작' : 'Start Game'}</Button>
        <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {is3d ? '3D 화면' : '가벼운 화면(2D)'}
        </p>
      </div>
    );
  }

  if (status === 'countdown') return <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}><div className="text-8xl font-bold neon-text">{countdown}</div></div>;

  if (status === 'gameover') return (
    <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
      <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-error)', fontFamily: "'Outfit'" }}>
        {mode === 'time' ? (isKorean ? '시간 끝!' : "Time's up!") : (isKorean ? '성이 함락되었습니다!' : 'Castle Fallen!')}
      </h1>
      {newBest && <p className="mb-3 font-bold" style={{ color: '#FECA57' }}>{isKorean ? '새 최고 기록!' : 'New best!'}</p>}
      <div className="grid grid-cols-3 gap-3 mb-8 max-w-md mx-auto">
        <Card className="p-3">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '점수' : 'SCORE'}</div>
          <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-primary)' }}>{score}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '웨이브' : 'WAVE'}</div>
          <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-secondary)' }}>{wave}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '골드' : 'GOLD'}</div>
          <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: '#FECA57' }}>{gold}</div>
        </Card>
      </div>
      <Button size="lg" data-gb="play" onClick={() => schoolGate(startGame)}>{isKorean ? '다시 시작' : 'Retry'}</Button>
    </div>
  );

  return (
    <div className="max-w-[900px] mx-auto px-4 py-4">
      <div className="relative rounded-xl overflow-hidden border border-[var(--key-border)]" style={{ height: '450px' }} data-render={is3d ? '3d' : '2d'}>
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
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
          className="flex-1 px-4 py-3 rounded-xl border border-[var(--key-border)] text-lg"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: "'JetBrains Mono'" }}
          placeholder={isKorean ? '단어를 입력하세요...' : 'Type the word...'} autoComplete="off" autoFocus />
        <Button type="submit" size="lg">{isKorean ? '공격' : 'Attack'}</Button>
      </form>
    </div>
  );

  /** 2D 판 배경(WebGL2 없는 기기) — 노을 진 들판 + 산 실루엣 + 길. 3D 판에서는 장면이 대신 그린다. */
  function drawDefenseBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number, time: number) {
    const bgLoaded = drawBackgroundImage(ctx, 'defense-bg', W, H, 0.24);
    if (bgLoaded) return;
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.7);
    skyGrad.addColorStop(0, '#FF6B35');
    skyGrad.addColorStop(0.3, '#F7931E');
    skyGrad.addColorStop(0.6, '#FFB347');
    skyGrad.addColorStop(0.8, '#4A154B');
    skyGrad.addColorStop(1, '#0D1B2A');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H * 0.7);

    ctx.fillStyle = 'rgba(26,26,62,0.8)';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.5);
    for (let x = 0; x <= W; x += 60) ctx.lineTo(x, H * 0.35 + Math.sin(x * 0.005 + time * 0.0001) * 40 + Math.sin(x * 0.012) * 20);
    ctx.lineTo(W, H * 0.7); ctx.lineTo(0, H * 0.7); ctx.fill();

    ctx.fillStyle = 'rgba(36,36,72,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.6);
    for (let x = 0; x <= W; x += 45) ctx.lineTo(x, H * 0.45 + Math.sin(x * 0.008 + time * 0.0001) * 35 + Math.sin(x * 0.018) * 15);
    ctx.lineTo(W, H * 0.7); ctx.lineTo(0, H * 0.7); ctx.fill();

    ctx.fillStyle = 'rgba(46,46,82,1)';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.65);
    for (let x = 0; x <= W; x += 30) ctx.lineTo(x, H * 0.55 + Math.sin(x * 0.015 + time * 0.0002) * 25 + Math.sin(x * 0.03) * 10);
    ctx.lineTo(W, H * 0.7); ctx.lineTo(0, H * 0.7); ctx.fill();

    const groundGrad = ctx.createLinearGradient(0, H * 0.7, 0, H);
    groundGrad.addColorStop(0, '#2D5016');
    groundGrad.addColorStop(0.5, '#355E1D');
    groundGrad.addColorStop(1, '#1A3A0B');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, H * 0.7, W, H * 0.3);

    ctx.strokeStyle = 'rgba(52,154,32,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < W; i += 8) {
      const grassHeight = 3 + Math.sin(time * 0.002 + i * 0.05) * 2;
      ctx.beginPath();
      ctx.moveTo(i, H * 0.75);
      ctx.lineTo(i + Math.sin(time * 0.003 + i * 0.02) * 1, H * 0.75 - grassHeight);
      ctx.stroke();
    }

    const pathGrad = ctx.createLinearGradient(0, H * 0.72, 0, H * 0.78);
    pathGrad.addColorStop(0, '#8B7355'); pathGrad.addColorStop(0.5, '#A0865C'); pathGrad.addColorStop(1, '#6B5B47');
    ctx.fillStyle = pathGrad;
    ctx.fillRect(0, H * 0.74, W * 0.7, 25);

    ctx.fillStyle = '#707070';
    for (let x = W * 0.6; x < W * 0.7; x += 12) for (let y = H * 0.74; y < H * 0.77; y += 8) ctx.fillRect(x + Math.sin(y) * 2, y, 8, 6);

    ctx.fillStyle = 'rgba(107,91,71,0.5)';
    for (let x = 50; x < W * 0.6; x += 40) {
      const trackY = H * 0.75;
      ctx.beginPath(); ctx.ellipse(x, trackY, 3, 6, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 15, trackY + 5, 3, 6, -0.2, 0, Math.PI * 2); ctx.fill();
    }
  }
}
