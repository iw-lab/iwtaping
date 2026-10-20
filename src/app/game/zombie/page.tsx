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
  drawWordBubble, drawShieldBar, drawHUD,
  drawZombieSprite, drawPlayerCharacter, drawMoonlight, drawCityscape,
  preloadSprites, drawSprite, drawBackgroundImage, wordBubbleY, wordBubbleHeight, wordBubbleWidth,
  drawBubbleLeader, resolveLabels, easeLabelShift, spriteWidthFor,
  type LabelBox, type LabelRequest,
} from '@/lib/game/renderer';
import { ABILITY_META, drawSpecialMarker } from '@/lib/game/special-words';
import { createGameJuice } from '@/lib/game/juice-table';
import { drawVectorIcon, ICON_SNOWFLAKE } from '@/lib/game/canvas-icons';
import { AbilityIcon } from '@/components/common/AbilityIcon';
import {
  ZombieCore, seededRng, seedFromString, GROUND_MARGIN, PLAYER_Y_OFFSET, HP_START, SURVIVAL_LIVES,
  type Ability, type ZombieUnit, type ZombieEvent,
} from '@/lib/game/zombie/core';
import type { SlimePlaygroundScene } from '@/lib/game3d/slime-playground-scene';
import { ModePicker, useGameMode, saveBest, todayKey } from '@/components/game/ModePicker';
import { FullscreenButton } from '@/components/game/FullscreenButton';

const ZOMBIE_SPRITES = {
  'zombie-bg': '/game/zombie/bg.webp',
  'zombie-hero': '/game/zombie/hero.webp',
  'zombie-mob': '/game/zombie/mob.webp',
};

const GAME_ID = 'zombie';

/** 3D 판을 쓸 수 있나 — WebGL2 가 있고 «가벼운 화면»을 고르지 않았을 때(없으면 지금 2D 판 그대로) */
function want3d(): boolean {
  try {
    if (localStorage.getItem('typingverse:lite') === '1') return false;
    if (new URLSearchParams(location.search).get('lite') === '1') return false;
    return !!document.createElement('canvas').getContext('webgl2');
  } catch { return false; }
}

export default function ZombieGamePage() {
  const { settings } = useSettingsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  useGameBgm('boss', status === 'countdown' || status === 'playing');
  const [mode, setMode] = useGameMode(GAME_ID);
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [input, setInput] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [wordPool, setWordPool] = useState<string[]>([]);
  const [purifyCount, setPurifyCount] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [is3d, setIs3d] = useState(false);
  const [muzzleFlash, setMuzzleFlash] = useState(false);
  const [effectMsg, setEffectMsg] = useState<{ ability: Ability; msg: string } | null>(null);

  const coreRef = useRef<ZombieCore | null>(null);
  const sceneRef = useRef<SlimePlaygroundScene | null>(null);
  const animRef = useRef<number>(0);
  const startedAtRef = useRef(0);
  const staticPoolRef = useRef<string[]>([]);
  const particlesRef = useRef(new ParticleSystem());
  const shakeRef = useRef(new ScreenShake());
  const recoilRef = useRef(0); // 마지막 «정화» 시각(ms) — 2D 판 반동 애니메이션용
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 정화·피격·능력·웨이브업
  const isKorean = settings.language === 'ko';

  useEffect(() => { preloadSprites(ZOMBIE_SPRITES); }, []);
  useEffect(() => { setIs3d(want3d()); }, []);

  // 반응(주스) — burst 는 이 게임의 파티클(캔버스 로컬 좌표), 타격 묶음(찌그러짐·튕김·번쩍·줌 펀치)은 3D 장면이 그린다.
  // 2D 판(WebGL2 없음)에서는 kick 을 짧은 화면 흔들기로 대신한다.
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
      squash: (o: { zombie?: ZombieUnit }) => { if (o.zombie) sceneRef.current?.hit(o.zombie); },
      knock: () => { /* 3D: hit() 안에서 슬라임이 자리로 날아간다 · 2D: 파티클이 대신한다 */ },
      hitflash: () => { /* 3D: hit() 안에서 슬라임이 하얗게 번쩍 · 2D: 말풍선이 바로 사라진다 */ },
      haptics: () => settings.sfx,
    });
    return () => juiceRef.current?.destroy();
  }, [settings.sfx]);

  useEffect(() => {
    wordGenerator.reset();
    const words = wordGenerator.getWords({
      language: settings.language, theme: 'adventure', difficulty: 1, count: 500,
      minLength: settings.language === 'ko' ? 2 : 3,
      maxLength: settings.language === 'ko' ? 5 : 8,
    });
    (async () => {
      try {
        if (settings.language === 'ko') {
          const mod = await import('@/data/korean/words-beginner');
          const mod2 = await import('@/data/korean/words-intermediate');
          const base = [...mod.koreanWordsBeginner, ...mod2.koreanWordsIntermediate].filter(w => w.length >= 2 && w.length <= 5);
          staticPoolRef.current = [...new Set(base)].sort();
          setWordPool([...new Set([...base, ...words])]);
        } else {
          const m = await import('@/data/english/words-common200');
          const m2 = await import('@/data/english/words-common1000');
          const base = [...m.englishCommon200, ...m2.englishCommon1000].filter(w => w.length >= 3 && w.length <= 8);
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
    if (wave > 1 && mode !== 'daily') {
      const newWords = wordGenerator.getWords({
        language: settings.language, theme: 'adventure', difficulty: Math.min(10, wave), count: 100,
      });
      setWordPool(prev => [...new Set([...prev, ...newWords])]);
    }
  }, [wave, settings.language, mode]);

  useEffect(() => {
    const c = coreRef.current;
    if (status === 'gameover' && c && c.score > 0) {
      void submitGameScore('zombie', c.score, Date.now() - startedAtRef.current, settings.language);
      setNewBest(saveBest(GAME_ID, mode, c.score));
    }
  }, [status, settings.language, mode]);

  // 일일 퀘스트·도전과제에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  // 슬라임 놀이터는 콤보 시스템이 없어 maxCombo는 0으로 둔다.
  useGameResult(status === 'gameover', () => {
    const c = coreRef.current;
    if (!c || (c.attempts === 0 && c.score === 0)) return null;
    return {
      gameType: 'zombie',
      score: c.score,
      level: c.level,
      maxCombo: 0,
      accuracy: hitAccuracy(c.kills, c.attempts),
      wordsTyped: c.kills,
      elapsedTime: Math.round((Date.now() - startedAtRef.current) / 1000),
    };
  });

  const startGame = () => {
    startedAtRef.current = Date.now();
    setStatus('countdown'); setScore(0); setWave(1); setInput('');
    setPurifyCount(0); setNewBest(false);
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
  const handleEvents = (events: ZombieEvent[], canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const c = coreRef.current;
    for (const e of events) {
      if (e.type === 'miss') {
        shakeRef.current.shake(sceneRef.current ? 0 : 6);
        particlesRef.current.emit(e.zombie.x, e.zombie.y, 6, {
          speed: 2, life: 15, size: 3, colors: ['#B33939', '#FF6B6B'],
        });
        sceneRef.current?.miss(e.zombie);
        juiceRef.current?.fire('miss', { x: rect.left + e.zombie.x, y: rect.top + e.zombie.y, color: '#FF6B6B' });
      } else if (e.type === 'gameover') {
        particlesRef.current.explode(canvas.offsetWidth / 2, (canvas.offsetHeight - GROUND_MARGIN) - PLAYER_Y_OFFSET, 2);
        setStatus('gameover');
        soundManager?.play('gameOver');
      } else if (e.type === 'hit') {
        setScore(c?.score ?? 0);
        setPurifyCount(c?.kills ?? 0);
        juiceRef.current?.fire('hit', {
          x: rect.left + e.zombie.x, y: rect.top + e.zombie.y, n: e.points, text: `+${e.points}`,
          color: e.zombie.color, big: e.zombie.special ? 1.3 : 1, zombie: e.zombie,
        });
      } else if (e.type === 'wrong') {
        juiceRef.current?.fire('miss', { color: '#FF6B6B' });
      } else if (e.type === 'ability') {
        const meta = ABILITY_META[e.ability];
        for (const z of e.cleared) particlesRef.current.explode(z.x, z.y, 0.6);
        sceneRef.current?.ability(e.ability);
        setScore(c?.score ?? 0);
        juiceRef.current?.fire('special', { title: `${meta.label}!`, color: meta.color, vib: [25, 30, 25] });
        flashEffect(e.ability, `${meta.label} 발동!`);
      } else if (e.type === 'levelup') {
        setWave(e.level);
        juiceRef.current?.fire('levelup', { title: `WAVE ${e.level}!`, color: '#FECA57' });
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
    const cx = W / 2, cy = H / 2;
    const groundY = H - GROUND_MARGIN;
    const playerY = groundY - PLAYER_Y_OFFSET;
    const particles = particlesRef.current;
    const shake = shakeRef.current;

    // 오늘의 판 = 날짜 시드 + 고정 단어 목록(모두 같은 순서) · 그 밖 = 기존 무작위
    const daily = mode === 'daily';
    const rng = daily ? seededRng(seedFromString(`zombie:${todayKey()}:${settings.language}`)) : Math.random;
    const dailyPool = staticPoolRef.current.length ? staticPoolRef.current : wordPool;
    const core = new ZombieCore({
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
    (window as unknown as { __zombie?: unknown }).__zombie = { core, scene: () => sceneRef.current };

    // 3D 장면(있으면) — three 는 이때만 받는다. 못 만들면 2D 판 그대로.
    let alive = true;
    if (is3d && canvas3dRef.current) {
      const c3 = canvas3dRef.current;
      import('@/lib/game3d/slime-playground-scene').then((m) => {
        if (!alive) return;
        try { sceneRef.current = m.createSlimePlaygroundScene(c3, W, H); } catch { sceneRef.current = null; setIs3d(false); }
      }).catch(() => setIs3d(false));
    }

    const loop = (time: number) => {
      const gameDt = juiceRef.current ? juiceRef.current.time(16 / 1000) : 16 / 1000;
      const events = gameDt > 0 ? core.tick(time) : [];
      if (events.length) handleEvents(events, canvas);
      if (core.over) { cancelAnimationFrame(animRef.current); return; }

      const scene = sceneRef.current;
      const shakeOffset = scene ? { x: 0, y: 0 } : shake.update();
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(shakeOffset.x, shakeOffset.y);

      if (!scene) {
        // Background - Night sky with moon and city(기존 2D 판 그림 그대로 — 가벼운 화면 전용)
        if (!drawBackgroundImage(ctx, 'zombie-bg', W, H, 0.3)) {
          drawMoonlight(ctx, W, H, time);
          drawCityscape(ctx, W, H, groundY);

          const groundGrad = ctx.createLinearGradient(0, groundY, 0, H);
          groundGrad.addColorStop(0, '#2A2A2A');
          groundGrad.addColorStop(0.5, '#1A1A1A');
          groundGrad.addColorStop(1, '#0A0A0A');
          ctx.fillStyle = groundGrad;
          ctx.fillRect(0, groundY, W, H - groundY);

          ctx.strokeStyle = 'rgba(100,80,60,0.25)';
          ctx.lineWidth = 1;
          for (let i = 0; i < 15; i++) {
            const gx = (i * 97) % W;
            const gy = groundY + (i * 13) % (H - groundY);
            ctx.beginPath();
            ctx.moveTo(gx, gy);
            ctx.lineTo(gx + 25, gy + 10);
            ctx.lineTo(gx + 35, gy + 25);
            ctx.stroke();
          }

          const mistGrad = ctx.createLinearGradient(0, groundY - 30, 0, groundY);
          mistGrad.addColorStop(0, 'rgba(40,40,80,0.2)');
          mistGrad.addColorStop(1, 'rgba(40,40,80,0)');
          ctx.fillStyle = mistGrad;
          ctx.fillRect(0, groundY - 30, W, 30);
        }
      }

      // Calculate player facing direction (toward nearest slime)
      let facingAngle = 0;
      if (core.units.length > 0) {
        const nearest = core.units.reduce((closest, z) => {
          const dist = Math.hypot(z.x - cx, z.y - cy);
          const closestDist = Math.hypot(closest.x - cx, closest.y - cy);
          return dist < closestDist ? z : closest;
        });
        facingAngle = Math.atan2(nearest.y - cy, nearest.x - cx);
      }

      if (!scene) {
        // Player character - 절차적 애니메이션: 숨쉬기 상하 흔들림 + 정화 반동(기존 2D 판 그림 그대로)
        const breathe = Math.sin(time * 0.0032) * 1.8;
        const sinceShot = time - recoilRef.current;
        const recoil = sinceShot < 200 ? (1 - sinceShot / 200) * 6 : 0;
        const facingLeft = Math.cos(facingAngle) < 0;
        const heroX = cx - Math.cos(facingAngle) * recoil;
        const heroY = playerY - Math.sin(facingAngle) * recoil + breathe;
        const recoilTilt = recoil * 0.012 * (facingLeft ? -1 : 1);
        if (!drawSprite(ctx, 'zombie-hero', heroX, heroY, { h: 72, rotate: recoilTilt, flip: facingLeft })) {
          drawPlayerCharacter(ctx, cx, playerY, facingAngle, time, muzzleFlash);
        }

        // Enhanced flashlight effect
        ctx.save();
        ctx.translate(cx, playerY);
        ctx.rotate(facingAngle);
        const flashGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 200);
        flashGrad.addColorStop(0, 'rgba(255,255,200,0.15)');
        flashGrad.addColorStop(0.3, 'rgba(254,202,87,0.08)');
        flashGrad.addColorStop(1, 'rgba(254,202,87,0)');
        ctx.fillStyle = flashGrad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 200, -0.7, 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(254,202,87,0.02)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 300, -0.5, 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Dark vignette around edges
        const vignetteGrad = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.7);
        vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
        vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = vignetteGrad;
        ctx.fillRect(0, 0, W, H);

        // Glowing perimeter fence/barrier (safe zone)
        ctx.save();
        ctx.translate(cx, playerY);
        const barrierPulse = 0.3 + Math.sin(time * 0.005) * 0.15;
        ctx.strokeStyle = `rgba(108,92,231,${barrierPulse})`;
        ctx.lineWidth = 2;
        ctx.shadowColor = '#6C5CE7';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, 0, 35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(108,92,231,${barrierPulse * 0.5})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 33, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        // HP indicator ring around player
        const hpRatio = core.hp / HP_START;
        ctx.beginPath();
        ctx.arc(cx, playerY, 45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
        ctx.strokeStyle = hpRatio > 0.5 ? '#00B894' : hpRatio > 0.25 ? '#FECA57' : '#FF6B6B';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // 슬라임도 가리면 안 된다 — 슬라임이 중앙으로 몰리면 라벨이 주인공 위에 쌓인다.
      // 상단 HUD(점수·웨이브·정화)와 하단 정보줄도 같은 이유로 비켜야 할 영역이다.
      const spriteBoxes: LabelBox[] = [
        { x: W / 2, y: 26, w: W, h: 52, weight: 0.8 },
        { x: W / 2, y: H - 30, w: W, h: 44, weight: 0.8 },
      ];
      if (!scene) spriteBoxes.unshift({ x: cx, y: playerY, w: spriteWidthFor('zombie-hero', 72, 44), h: 72 });
      const labels: (LabelRequest & { z: ZombieUnit; fs: number; spriteH: number; fade: number })[] = [];
      for (const z of core.units) {
        // Draw zombie(슬라임) sprite with new function — 기존 2D 판 그림 그대로
        const fadeIn = Math.min(1, (time - z.spawnTime) / 500);
        ctx.globalAlpha = fadeIn;

        let size = 12;
        if (z.variant === 1) size = 16;
        if (z.variant === 2) size = 10;

        const walkPhase = time * 0.005 + z.id;
        const lurch = Math.sin(walkPhase) * 0.14;
        const hop = Math.abs(Math.sin(walkPhase * 2)) * (size * 0.16);
        if (!scene) {
          if (!drawSprite(ctx, 'zombie-mob', z.x, z.y - hop, { h: size * 3, rotate: lurch, flip: z.x > cx })) {
            drawZombieSprite(ctx, z.x, z.y, size, z.variant, walkPhase, time);
          }
          if (z.variant === 1) {
            ctx.fillStyle = 'rgba(0,184,148,0.15)';
            ctx.beginPath();
            ctx.arc(z.x - Math.cos(Math.atan2(playerY - z.y, cx - z.x)) * 12, z.y - Math.sin(Math.atan2(playerY - z.y, cx - z.x)) * 12, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        const fs = z.special ? 15 : 13;
        const spriteH = size * 3.32;
        const home = wordBubbleY({ spriteY: z.y, spriteH, fontSize: fs, canvasH: H });
        spriteBoxes.push({
          x: z.x, y: z.y,
          w: spriteWidthFor('zombie-mob', size * 3, size * 2) + 6,
          h: spriteH,
        });
        labels.push({
          z, fs, spriteH, fade: fadeIn,
          x: z.x,
          w: wordBubbleWidth(ctx, z.text, fs),
          h: wordBubbleHeight(fs),
          homeY: home,
          y: 0, dir: home < z.y ? -1 : 1, offset: 0, prefer: z.labelShift,
        });
        ctx.globalAlpha = 1;
      }

      // 라벨 배치 — 슬라임·다른 라벨을 피해 밀어낸다.
      resolveLabels(labels, spriteBoxes, { canvasH: H });
      const labelRects: { x: number; y: number; w: number; h: number }[] = [];
      for (const L of labels) {
        L.z.labelShift = easeLabelShift(L.z.labelShift, L.offset);
        const y = L.homeY + L.z.labelShift;
        labelRects.push({ x: L.x - L.w / 2, y: y - L.h / 2, w: L.w, h: L.h });
        ctx.globalAlpha = L.fade;
        drawBubbleLeader(ctx, L.x, L.z.y, L.spriteH, y, L.fs, 'rgba(255,255,255,0.2)', H);
        if (L.z.special && L.z.ability) {
          drawSpecialMarker(ctx, L.z.x, L.z.y, L.z.ability, time, L.z.id, y - L.h / 2 - 7);
        }
        if (input.trim().length > 0 && L.z.text.startsWith(input.trim())) {
          ctx.shadowColor = L.z.color;
          ctx.shadowBlur = 10;
        }
        drawWordBubble(ctx, L.x, y, L.z.text, L.z.color, { fontSize: L.fs });
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
      // 시험 손잡이 — 실제로 그린 라벨 사각형(QA 가 겹침·크기를 잰다)
      (window as unknown as { __zombieLabels?: unknown }).__zombieLabels = labelRects;

      // 3D 슬라임은 라벨이 정한 자리(비켜 선 거리 포함)를 따라간다
      const frozen = core.isFrozen(time);
      scene?.render(core.units, time, frozen);

      // Particles
      particles.update();
      particles.draw(ctx);

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

      // HUD — 상단: 점수 + (기본 WAVE N · 시간 모드는 남은 초)
      const rem = core.remaining(time);
      drawHUD(ctx, {
        score: core.score,
        level: rem !== null ? Math.ceil(rem / 1000) : core.level,
        combo: 0,
        label: rem !== null ? (isKorean ? '남은 시간' : 'TIME') : (isKorean ? '웨이브' : 'WAVE'),
      }, W);

      ctx.font = "bold 14px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#55E6C1';
      ctx.textAlign = 'right';
      ctx.fillText(`${isKorean ? '정화' : 'PURIFIED'}: ${core.kills}`, W - 20, 50);

      ctx.font = "bold 12px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#FECA57';
      ctx.textAlign = 'left';
      ctx.fillText(isKorean ? '도구: 무지개 정화봉' : 'TOOL: RAINBOW WAND', 20, H - 20);

      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`${isKorean ? '슬라임' : 'SLIMES'}: ${core.units.length}`, 20, H - 40);

      // 하단 상태 띠 — 생존 모드는 목숨 하트 · 그 밖은 체력 막대(3D 판도 보이는 공용 지표)
      ctx.textAlign = 'center';
      ctx.font = "bold 12px 'JetBrains Mono', 'Noto Sans KR', monospace";
      if (core.mode === 'survival') {
        ctx.fillStyle = '#FFE3EC';
        ctx.fillText(`${'●'.repeat(core.lives)}${'○'.repeat(SURVIVAL_LIVES - core.lives)}`, W / 2, H - 14);
      } else {
        drawShieldBar(ctx, 20, H - 30, core.hp, HP_START, W - 40);
        ctx.fillStyle = '#E8E8FF';
        ctx.fillText(`${isKorean ? '체력' : 'HP'} ${core.hp}`, W / 2, H - 12);
      }

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

    // 2D 판 전용 정화봉 반동·파편 연출(기존 좀비 판 「사격」연출 그대로 — 3D 판은 scene.hit() 이 대신한다)
    if (!sceneRef.current) {
      const idx = core.units.findIndex((u) => u.text === input.trim());
      if (idx >= 0) {
        const z = core.units[idx];
        setMuzzleFlash(true);
        setTimeout(() => setMuzzleFlash(false), 100);
        recoilRef.current = performance.now();
        const cx = canvas.offsetWidth / 2;
        const playerY = (canvas.offsetHeight - GROUND_MARGIN) - PLAYER_Y_OFFSET;
        const angle = Math.atan2(z.y - playerY, z.x - cx);
        particlesRef.current.emit(cx + Math.cos(angle) * 26, playerY + Math.sin(angle) * 26, 5, {
          speed: 8, life: 8, size: 3, colors: ['#FECA57', '#FFF', '#FFAA00'], angle, spread: 0.3,
        });
        particlesRef.current.emit(cx + Math.cos(angle) * 30, playerY + Math.sin(angle) * 30, 2, {
          speed: 15, life: 3, size: 1, colors: ['#FFF', '#FECA57'], angle, spread: 0.1,
        });
        shakeRef.current.shake(4);
      }
    }

    handleEvents(core.submit(input, performance.now()), canvas);
    setInput('');
  };

  if (status === 'menu') return (
    <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
      <div className="flex justify-end mb-2"><FullscreenButton /></div>
      <div className="text-6xl mb-4">
        <svg viewBox="0 0 80 80" width="80" height="80" className="mx-auto">
          <rect width="80" height="80" rx="16" fill="#2a2450"/>
          <g transform="translate(40,44)">
            <path d="M -18 4 Q -18 -20 0 -20 Q 18 -20 18 4 Q 18 16 0 16 Q -18 16 -18 4 Z" fill="#55E6C1" opacity="0.92"/>
            <circle cx="-7" cy="-4" r="3" fill="#2a2450"/>
            <circle cx="7" cy="-4" r="3" fill="#2a2450"/>
            <ellipse cx="-9" cy="-11" rx="4" ry="2.6" fill="#ffffff" opacity="0.8"/>
          </g>
          <text x="40" y="70" textAnchor="middle" fill="#FECA57" fontSize="8" fontFamily="monospace" fontWeight="bold">PLAYGROUND</text>
        </svg>
      </div>
      <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit'" }}>
        {isKorean ? '슬라임 놀이터' : 'Slime Playground'}
      </h1>
      <p className="mb-3" style={{ color: 'var(--text-secondary)' }}>
        {isKorean ? '노을 지는 놀이터로 다가오는 슬라임을 타자로 정화해요!' : 'Type to purify the slimes approaching the sunset playground!'}
      </p>
      {isKorean && (
        <p className="mb-6 text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
          금빛으로 빛나는 <b style={{ color: '#FECA57' }}>특별한 슬라임</b>을 정화하면 능력 발동 —
          일시정지 · 전체 제거 · 회복 (점수 2배!)
        </p>
      )}
      <ModePicker game={GAME_ID} value={mode} onChange={setMode} />
      <Button size="lg" onClick={() => schoolGate(startGame)}>{isKorean ? '게임 시작' : 'Start Game'}</Button>
      <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        {is3d ? '3D 화면' : '가벼운 화면(2D)'}
      </p>
    </div>
  );

  if (status === 'countdown') return <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}><div className="text-8xl font-bold neon-text">{countdown}</div></div>;

  if (status === 'gameover') return (
    <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
      <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-error)', fontFamily: "'Outfit'" }}>
        {mode === 'time' ? (isKorean ? '시간 끝!' : "Time's up!") : (isKorean ? '게임 오버' : 'Game Over')}
      </h1>
      <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
        {isKorean ? '울타리가 너무 많이 흔들렸어요...' : 'The fence shook too much...'}
      </p>
      {newBest && <p className="mb-4 font-bold" style={{ color: '#FECA57' }}>{isKorean ? '새 최고 기록!' : 'New best!'}</p>}
      <div className="grid grid-cols-3 gap-3 mb-8 max-w-md mx-auto">
        <Card className="p-3">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '점수' : 'SCORE'}</div>
          <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-primary)' }}>{score}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '웨이브' : 'WAVE'}</div>
          <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: '#00B894' }}>{wave}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '정화' : 'PURIFIED'}</div>
          <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: '#55E6C1' }}>{purifyCount}</div>
        </Card>
      </div>
      <Button size="lg" onClick={() => schoolGate(startGame)}>{isKorean ? '다시 시작' : 'Retry'}</Button>
      <div className="mt-3"><Button variant="ghost" onClick={() => setStatus('menu')}>{isKorean ? '모드 바꾸기' : 'Change mode'}</Button></div>
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
        <Button type="submit" size="lg">{isKorean ? '정화' : 'Purify'}</Button>
      </form>
    </div>
  );
}
