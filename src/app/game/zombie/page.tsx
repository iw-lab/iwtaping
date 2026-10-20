'use client';

import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { soundManager } from '@/lib/sound/sound-manager';
import { useGameBgm } from '@/hooks/useGameBgm';
import { schoolGate } from '@/lib/gb/school';
import { useGameResult, hitAccuracy } from '@/hooks/useGameResult';
import { pickRandom } from '@/lib/utils/helpers';
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
import { Ability, ABILITY_META, FREEZE_MS, rollSpecial, pickAbility, drawSpecialMarker } from '@/lib/game/special-words';
import { createGameJuice } from '@/lib/game/juice-table';
import { drawVectorIcon, ICON_SNOWFLAKE } from '@/lib/game/canvas-icons';
import { AbilityIcon } from '@/components/common/AbilityIcon';

const ZOMBIE_SPRITES = {
  'zombie-bg': '/game/zombie/bg.webp',
  'zombie-hero': '/game/zombie/hero.webp',
  'zombie-mob': '/game/zombie/mob.webp',
};

interface Zombie {
  id: number;
  text: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  color: string;
  type: number;
  variant: number;
  spawnTime: number;
  special?: boolean;
  ability?: Ability;
  /** 말풍선을 기본 위치에서 추가로 밀어낸 거리(px) — 프레임 간 부드럽게 따라간다 */
  labelShift?: number;
}

export default function ZombieGamePage() {
  const { settings } = useSettingsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  useGameBgm('boss', status === 'countdown' || status === 'playing');
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [hp, setHp] = useState(10);
  const [input, setInput] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [wordPool, setWordPool] = useState<string[]>([]);
  const [killCount, setKillCount] = useState(0);
  const [muzzleFlash, setMuzzleFlash] = useState(false);
  const [effectMsg, setEffectMsg] = useState<{ ability: Ability; msg: string } | null>(null);
  const freezeUntilRef = useRef(0);

  const zombiesRef = useRef<Zombie[]>([]);
  const animRef = useRef<number>(0);
  const nextIdRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const scoreRef = useRef(0);
  const startedAtRef = useRef(0);
  const waveRef = useRef(1);
  const hpRef = useRef(10);
  const killCountRef = useRef(0);
  const attemptsRef = useRef(0); // 입력 시도 횟수 — 정확도 산출용(맞힌 수 = killCountRef)
  const particlesRef = useRef(new ParticleSystem());
  const shakeRef = useRef(new ScreenShake());
  const recoilRef = useRef(0); // 마지막 사격 시각(ms) — 반동 애니메이션용
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 격파·피격·능력·웨이브업
  const isKorean = settings.language === 'ko';

  useEffect(() => { preloadSprites(ZOMBIE_SPRITES); }, []);

  // 반응(주스) 인스턴스 — burst는 이 게임의 파티클(캔버스 로컬 좌표)로, sfx는 기존 soundManager로 연결한다.
  useEffect(() => {
    juiceRef.current = createGameJuice({
      soundManager,
      burst: (o: { x: number; y: number; big?: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        particlesRef.current.explode(o.x - rect.left, o.y - rect.top, (o.big ?? 1) * 0.9);
      },
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
          setWordPool([...new Set([...mod.koreanWordsBeginner, ...mod2.koreanWordsIntermediate, ...words].filter(w => w.length >= 2 && w.length <= 5))]);
        } else {
          const m = await import('@/data/english/words-common200');
          const m2 = await import('@/data/english/words-common1000');
          setWordPool([...new Set([...m.englishCommon200, ...m2.englishCommon1000, ...words].filter(w => w.length >= 3 && w.length <= 8))]);
        }
      } catch {
        setWordPool(words);
      }
    })();
  }, [settings.language]);

  useEffect(() => {
    if (wave > 1) {
      const newWords = wordGenerator.getWords({
        language: settings.language, theme: 'adventure', difficulty: Math.min(10, wave), count: 100,
      });
      setWordPool(prev => [...new Set([...prev, ...newWords])]);
    }
  }, [wave, settings.language]);

  useEffect(() => {
    if (status === 'gameover' && scoreRef.current > 0) {
      void submitGameScore('zombie', scoreRef.current, Date.now() - startedAtRef.current, settings.language);
    }
  }, [status, settings.language]);

  // 일일 퀘스트·도전과제에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  // 좀비는 콤보 시스템이 없어 maxCombo는 0으로 둔다.
  useGameResult(status === 'gameover', () =>
    attemptsRef.current === 0 && scoreRef.current === 0
      ? null
      : {
          gameType: 'zombie',
          score: scoreRef.current,
          level: waveRef.current,
          maxCombo: 0,
          accuracy: hitAccuracy(killCountRef.current, attemptsRef.current),
          wordsTyped: killCountRef.current,
          elapsedTime: Math.round((Date.now() - startedAtRef.current) / 1000),
        }
  );

  const startGame = () => {
    startedAtRef.current = Date.now();
    setStatus('countdown'); setScore(0); setWave(1); setHp(10); setInput('');
    setKillCount(0);
    zombiesRef.current = []; nextIdRef.current = 0; lastSpawnRef.current = 0;
    scoreRef.current = 0; waveRef.current = 1; hpRef.current = 10; killCountRef.current = 0;
    attemptsRef.current = 0;
    freezeUntilRef.current = 0; setEffectMsg(null);
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
    const particles = particlesRef.current;
    const shake = shakeRef.current;

    const loop = (time: number) => {
      const currentWave = waveRef.current;
      const shakeOffset = shake.update();

      ctx.save();
      ctx.translate(shakeOffset.x, shakeOffset.y);

      // Background - Night sky with moon and city
      const groundY = H - 60;
      if (!drawBackgroundImage(ctx, 'zombie-bg', W, H, 0.3)) {
        drawMoonlight(ctx, W, H, time);
        drawCityscape(ctx, W, H, groundY);

        // Ground area with cracked pavement texture
        const groundGrad = ctx.createLinearGradient(0, groundY, 0, H);
        groundGrad.addColorStop(0, '#2A2A2A');
        groundGrad.addColorStop(0.5, '#1A1A1A');
        groundGrad.addColorStop(1, '#0A0A0A');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, groundY, W, H - groundY);

        // Pavement cracks
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

        // Fog/mist between ground and city
        const mistGrad = ctx.createLinearGradient(0, groundY - 30, 0, groundY);
        mistGrad.addColorStop(0, 'rgba(40,40,80,0.2)');
        mistGrad.addColorStop(1, 'rgba(40,40,80,0)');
        ctx.fillStyle = mistGrad;
        ctx.fillRect(0, groundY - 30, W, 30);
      }

      // Calculate player facing direction (toward nearest zombie or mouse)
      let facingAngle = 0;
      if (zombiesRef.current.length > 0) {
        const nearest = zombiesRef.current.reduce((closest, z) => {
          const dist = Math.hypot(z.x - cx, z.y - cy);
          const closestDist = Math.hypot(closest.x - cx, closest.y - cy);
          return dist < closestDist ? z : closest;
        });
        facingAngle = Math.atan2(nearest.y - cy, nearest.x - cx);
      }

      // Player character - position at center-bottom
      // 절차적 애니메이션: 숨쉬기 상하 흔들림 + 사격 반동(총 반대방향으로 살짝 밀림)
      const playerY = groundY - 25;
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

      // Main flashlight cone - wider and more dramatic
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

      // Volumetric light effect
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

      // Energy barrier effect
      ctx.strokeStyle = `rgba(108,92,231,${barrierPulse})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#6C5CE7';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(0, 0, 35, 0, Math.PI * 2);
      ctx.stroke();

      // Inner glow
      ctx.strokeStyle = `rgba(108,92,231,${barrierPulse * 0.5})`;
      ctx.lineWidth = 1;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 33, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.restore();

      // HP indicator ring around player
      const hpRatio = hpRef.current / 10;
      ctx.beginPath();
      ctx.arc(cx, playerY, 45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
      ctx.strokeStyle = hpRatio > 0.5 ? '#00B894' : hpRatio > 0.25 ? '#FECA57' : '#FF6B6B';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Spawn zombies — refill quickly when the screen is nearly empty
      const zSpawnInterval = zombiesRef.current.length < 2 ? 380 : Math.max(1300 - currentWave * 70, 500);
      const zMax = Math.min(6 + currentWave, 14);
      if (time - lastSpawnRef.current > zSpawnInterval) {
        lastSpawnRef.current = time;
        if (zombiesRef.current.length < zMax) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.max(W, H) * 0.55;
          const isSpecial = rollSpecial(currentWave, zombiesRef.current.some(z => z.special));
          const ability = isSpecial ? pickAbility() : undefined;
          const wordFloor = isSpecial
            ? (isKorean ? 4 : 6)
            : (isKorean ? Math.min(2 + Math.floor(currentWave / 3), 5) : Math.min(3 + Math.floor(currentWave / 2), 8));
          const word = wordGenerator.getUniqueWord(wordPool, wordFloor) || (isKorean ? '좀비' : 'zombie');
          const baseSpeed = 0.3 + currentWave * 0.04;
          const speedVariant = Math.random();
          let variant, speed;

          if (speedVariant < 0.6) {
            variant = 0; // Standard zombie
            speed = baseSpeed;
          } else if (speedVariant < 0.8) {
            variant = 1; // Fat zombie (slower)
            speed = baseSpeed * 0.7;
          } else {
            variant = 2; // Fast crawler
            speed = baseSpeed * 1.4;
          }

          zombiesRef.current.push({
            id: nextIdRef.current++,
            text: word,
            x: cx + Math.cos(angle) * dist,
            y: cy + Math.sin(angle) * dist,
            angle: 0,
            // 특수 좀비는 느리게 접근해 긴 단어를 입력할 시간을 준다
            speed: isSpecial ? baseSpeed * 0.55 : speed,
            color: isSpecial ? '#FECA57' : pickRandom(['#00B894', '#FF6B6B', '#FDCB6E', '#55E6C1', '#B33939']),
            type: Math.floor(Math.random() * 3),
            variant,
            spawnTime: time,
            special: isSpecial,
            ability,
          });
        }
      }

      // Update & draw zombies
      const frozen = time < freezeUntilRef.current;
      const alive: Zombie[] = [];
      // 주인공도 가리면 안 된다 — 좀비가 중앙으로 몰리면 라벨이 주인공 위에 쌓인다.
      // 상단 HUD(점수·웨이브·킬)와 하단 정보줄도 같은 이유로 비켜야 할 영역이다.
      const spriteBoxes: LabelBox[] = [
        { x: cx, y: playerY, w: spriteWidthFor('zombie-hero', 72, 44), h: 72 },
        { x: W / 2, y: 26, w: W, h: 52, weight: 0.8 },
        { x: W / 2, y: H - 30, w: W, h: 44, weight: 0.8 },
      ];
      const labels: (LabelRequest & { z: Zombie; fs: number; spriteH: number; fade: number })[] = [];
      for (const z of zombiesRef.current) {
        const a = Math.atan2(playerY - z.y, cx - z.x);
        if (!frozen) {
          z.x += Math.cos(a) * z.speed;
          z.y += Math.sin(a) * z.speed;
        }
        const dist = Math.hypot(z.x - cx, z.y - playerY);

        if (dist < 38) {
          hpRef.current--;
          setHp(hpRef.current);
          shake.shake(6);
          particles.emit(z.x, z.y, 6, {
            speed: 2, life: 15, size: 3,
            colors: ['#B33939', '#FF6B6B'],
          });
          {
            const rect = canvas.getBoundingClientRect();
            juiceRef.current?.fire('miss', { x: rect.left + z.x, y: rect.top + z.y, color: '#FF6B6B' });
          }
          if (hpRef.current <= 0) {
            particles.explode(cx, playerY, 2);
            setStatus('gameover');
            cancelAnimationFrame(animRef.current);
            soundManager?.play('gameOver');
            ctx.restore();
            return;
          }
          continue;
        }

        // Draw zombie sprite with new function
        const fadeIn = Math.min(1, (time - z.spawnTime) / 500);
        ctx.globalAlpha = fadeIn;

        // Calculate size based on variant
        let size = 12;
        if (z.variant === 1) size = 16; // Fat zombie bigger
        if (z.variant === 2) size = 10; // Crawler smaller

        // 절차적 좀비 걸음: 비틀거리는 좌우 흔들림(lurch) + 발걸음마다 상하 홉(hop)
        const walkPhase = time * 0.005 + z.id;
        const lurch = Math.sin(walkPhase) * 0.14;
        const hop = Math.abs(Math.sin(walkPhase * 2)) * (size * 0.16);
        if (!drawSprite(ctx, 'zombie-mob', z.x, z.y - hop, { h: size * 3, rotate: lurch, flip: z.x > cx })) {
          drawZombieSprite(ctx, z.x, z.y, size, z.variant, walkPhase, time);
        }

        // Slime trail for fat zombies
        if (z.variant === 1) {
          ctx.fillStyle = 'rgba(0,184,148,0.15)';
          ctx.beginPath();
          ctx.arc(z.x - Math.cos(a) * 12, z.y - Math.sin(a) * 12, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // 말풍선은 좀비를 다 그린 뒤 한꺼번에 배치한다(아래 resolveLabels).
        // 스프라이트 높이는 size*3, 여기에 hop 진폭(size*0.16)까지 더해 비켜 놓는다 —
        // 예전 위치(z.y - size - 15)는 좀비 머리 위에 걸쳐 그려졌다(실측 26% 가림).
        const fs = z.special ? 15 : 13;
        const spriteH = size * 3.32;
        const home = wordBubbleY({ spriteY: z.y, spriteH, fontSize: fs, canvasH: H });
        spriteBoxes.push({
          x: z.x, y: z.y,
          w: spriteWidthFor('zombie-mob', size * 3, size * 2) + 6, // +6 = lurch로 넓어지는 몫
          h: spriteH,
        });
        labels.push({
          z, fs, spriteH, fade: fadeIn,
          x: z.x,
          w: wordBubbleWidth(ctx, z.text, fs),
          h: wordBubbleHeight(fs),
          homeY: home,
          // 화면 위쪽이 좁아 아래로 뒤집힌 경우엔 밀어내는 방향도 같이 뒤집는다.
          y: 0, dir: home < z.y ? -1 : 1, offset: 0, prefer: z.labelShift,
        });
        ctx.globalAlpha = 1;
        alive.push(z);
      }
      zombiesRef.current = alive;

      // 라벨 배치 — 좀비·다른 라벨을 피해 밀어낸다.
      // 좀비는 주인공 한 점으로 몰려들어 같은 세로줄에 라벨이 쌓인다. 예전엔 그래서
      // 230px까지 밀어냈는데, 그러면 라벨이 자기 좀비와 반 화면 떨어져 연결선이
      // 풍선끈처럼 보인다(실측). 겹치더라도 몸통 가까이 두는 쪽이 읽기 쉽다 — 기본값(72) 사용.
      resolveLabels(labels, spriteBoxes, { canvasH: H });
      for (const L of labels) {
        L.z.labelShift = easeLabelShift(L.z.labelShift, L.offset);
        const y = L.homeY + L.z.labelShift;
        ctx.globalAlpha = L.fade;
        drawBubbleLeader(ctx, L.x, L.z.y, L.spriteH, y, L.fs, 'rgba(255,255,255,0.2)', H);
        // 특수 좀비: 금빛 후광 링 + 능력 라벨(말풍선 바깥쪽)
        if (L.z.special && L.z.ability) {
          drawSpecialMarker(ctx, L.z.x, L.z.y, L.z.ability, time, L.z.id, y - L.h / 2 - 7);
        }
        // Enhanced word bubble for targeted zombie
        if (input.trim().length > 0 && L.z.text.startsWith(input.trim())) {
          ctx.shadowColor = L.z.color;
          ctx.shadowBlur = 10;
        }
        drawWordBubble(ctx, L.x, y, L.z.text, L.z.color, { fontSize: L.fs });
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }

      // Particles
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

      // Enhanced HUD
      drawHUD(ctx, {
        score: scoreRef.current,
        level: waveRef.current,
        combo: 0,
        label: 'WAVE',
      }, W);

      // Additional game-specific HUD elements
      ctx.font = "bold 14px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#FF6B6B';
      ctx.textAlign = 'right';
      ctx.fillText(`KILLS: ${killCountRef.current}`, W - 20, 50);

      // Ammo/weapon indicator
      ctx.font = "bold 12px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#FECA57';
      ctx.textAlign = 'left';
      ctx.fillText('WEAPON: ASSAULT RIFLE', 20, H - 20);

      // Active zombies count
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`HOSTILES: ${zombiesRef.current.length}`, 20, H - 40);

      ctx.restore();
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [status, wordPool, isKorean]);

  const flashEffect = (ability: Ability, msg: string) => {
    setEffectMsg({ ability, msg });
    setTimeout(() => setEffectMsg(null), 2200);
  };

  /** 특수 좀비를 맞혔을 때 능력 발동. */
  const triggerAbility = (ability: Ability) => {
    const meta = ABILITY_META[ability];
    if (ability === 'freeze') {
      freezeUntilRef.current = performance.now() + FREEZE_MS;
    } else if (ability === 'clear') {
      // 화면의 모든 좀비 소탕 — 폭발 + 보너스 점수
      for (const z of zombiesRef.current) {
        particlesRef.current.explode(z.x, z.y, 0.6);
        scoreRef.current += 20;
      }
      zombiesRef.current = [];
      setScore(scoreRef.current);
      shakeRef.current.shake(8);
    } else if (ability === 'heal') {
      hpRef.current = Math.min(10, hpRef.current + 2);
      setHp(hpRef.current);
    }
    juiceRef.current?.fire('special', { title: `${meta.label}!`, color: meta.color, vib: [25, 30, 25] });
    flashEffect(ability, `${meta.label} 발동!`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    attemptsRef.current += 1;
    const idx = zombiesRef.current.findIndex(z => z.text === input.trim());
    if (idx >= 0) {
      const z = zombiesRef.current[idx];

      // Muzzle flash effect
      setMuzzleFlash(true);
      setTimeout(() => setMuzzleFlash(false), 100);
      recoilRef.current = performance.now(); // 사격 반동 시작

      // Gunfire line and particles
      const canvas = canvasRef.current;
      if (canvas) {
        const cx = canvas.offsetWidth / 2;
        const playerY = (canvas.offsetHeight - 60) - 25; // Ground level player position
        const angle = Math.atan2(z.y - playerY, z.x - cx);

        // Muzzle flash particles
        particlesRef.current.emit(cx + Math.cos(angle) * 26, playerY + Math.sin(angle) * 26, 5, {
          speed: 8, life: 8, size: 3,
          colors: ['#FECA57', '#FFF', '#FFAA00'],
          angle: angle,
          spread: 0.3,
        });

        // Bullet trail
        particlesRef.current.emit(cx + Math.cos(angle) * 30, playerY + Math.sin(angle) * 30, 2, {
          speed: 15, life: 3, size: 1,
          colors: ['#FFF', '#FECA57'],
          angle: angle,
          spread: 0.1,
        });
      }

      shakeRef.current.shake(4);
      zombiesRef.current.splice(idx, 1);
      const points = input.length * 12 * (z.special ? 2 : 1); // 특수 좀비는 2배
      scoreRef.current += points;
      if (z.special && z.ability) triggerAbility(z.ability);
      setScore(scoreRef.current);
      killCountRef.current += 1;
      setKillCount(killCountRef.current);
      {
        const rect = canvas?.getBoundingClientRect();
        juiceRef.current?.fire('hit', {
          x: rect ? rect.left + z.x : undefined,
          y: rect ? rect.top + z.y : undefined,
          n: points,
          text: `+${points}`,
          color: z.color,
          big: z.special ? 1.3 : 1,
        });
      }
      if (killCountRef.current % 10 === 0) {
        waveRef.current += 1;
        setWave(waveRef.current);
        // Heal 1 HP on wave up
        if (hpRef.current < 10) {
          hpRef.current = Math.min(10, hpRef.current + 1);
          setHp(hpRef.current);
        }
        juiceRef.current?.fire('levelup', { title: `WAVE ${waveRef.current}!`, color: '#FECA57' });
      }
    } else {
      juiceRef.current?.fire('miss', { color: '#FF6B6B' });
    }
    setInput('');
  };

  if (status === 'menu') return (
    <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
      <div className="text-6xl mb-4">
        <svg viewBox="0 0 80 80" width="80" height="80" className="mx-auto">
          <rect width="80" height="80" rx="16" fill="#0A0A1A"/>
          <g transform="translate(40,40)">
            <circle cx="0" cy="-10" r="12" fill="#00B894" opacity="0.8"/>
            <rect x="-8" y="2" width="16" height="16" fill="#00B894" opacity="0.7"/>
            <circle cx="-4" cy="-12" r="2.5" fill="#FF0000"/>
            <circle cx="4" cy="-12" r="2.5" fill="#FF0000"/>
            <line x1="-10" y1="6" x2="-20" y2="10" stroke="#00B894" strokeWidth="3" opacity="0.6"/>
            <line x1="10" y1="6" x2="20" y2="8" stroke="#00B894" strokeWidth="3" opacity="0.6"/>
          </g>
          <text x="40" y="70" textAnchor="middle" fill="#FF6B6B" fontSize="8" fontFamily="monospace" fontWeight="bold">SURVIVAL</text>
        </svg>
      </div>
      <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit'" }}>
        {isKorean ? '좀비 서바이벌' : 'Zombie Survival'}
      </h1>
      <p className="mb-3" style={{ color: 'var(--text-secondary)' }}>
        {isKorean ? '좀비를 물리치며 생존하세요!' : 'Survive the zombie horde!'}
      </p>
      {isKorean && (
        <p className="mb-6 text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
          ✨ 금빛으로 빛나는 <b style={{ color: '#FECA57' }}>특수 좀비</b>를 잡으면 능력 발동 —
          ❄️ 일시정지 · 💥 전체 소탕 · 💚 체력 회복 (점수 2배!)
        </p>
      )}
      <Button size="lg" onClick={() => schoolGate(startGame)}>{isKorean ? '게임 시작' : 'Start Game'}</Button>
    </div>
  );

  if (status === 'countdown') return <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}><div className="text-8xl font-bold neon-text">{countdown}</div></div>;

  if (status === 'gameover') return (
    <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
      <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-error)', fontFamily: "'Outfit'" }}>
        {isKorean ? '게임 오버' : 'Game Over'}
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        {isKorean ? '좀비에게 잡혔습니다...' : 'The zombies got you...'}
      </p>
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
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '격파' : 'KILLS'}</div>
          <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: '#FF6B6B' }}>{killCount}</div>
        </Card>
      </div>
      <Button size="lg" onClick={() => schoolGate(startGame)}>{isKorean ? '다시 시작' : 'Retry'}</Button>
    </div>
  );

  return (
    <div className="max-w-[900px] mx-auto px-4 py-4">
      <div className="relative rounded-xl overflow-hidden border border-[var(--key-border)]" style={{ height: '450px' }}>
        <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
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
        <Button type="submit" size="lg">{isKorean ? '사격' : 'Shoot'}</Button>
      </form>
    </div>
  );
}
