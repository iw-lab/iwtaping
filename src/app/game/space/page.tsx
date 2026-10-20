'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
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
  drawPlayerShip, drawEnemyShip, drawLaser, drawMissile,
  drawShieldBar, drawHUD, drawWordBubble,
  preloadSprites, drawSprite, drawBackgroundImage, wordBubbleY, wordBubbleHeight, wordBubbleWidth,
  drawBubbleLeader, resolveLabels, easeLabelShift, spriteWidthFor,
  type Star, type LabelBox, type LabelRequest,
} from '@/lib/game/renderer';
import { Ability, ABILITY_META, FREEZE_MS, rollSpecial, pickAbility, drawSpecialMarker } from '@/lib/game/special-words';
import { createGameJuice } from '@/lib/game/juice-table';
import { drawVectorIcon, ICON_SNOWFLAKE } from '@/lib/game/canvas-icons';
import { AbilityIcon } from '@/components/common/AbilityIcon';
import { Sparkles, Snowflake, Zap, Heart } from 'lucide-react';

const SPACE_SPRITES = {
  'space-bg': '/game/space/bg.webp',
  'space-player': '/game/space/ship.webp',
  'space-enemy': '/game/space/enemy.webp',
};

interface Enemy {
  id: number;
  text: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  color: string;
  typed: string;
  shipType: number;
  hp: number;
  maxHp: number;
  isBoss: boolean;
  spawnTime: number;
  dying?: boolean;
  special?: boolean;
  ability?: Ability;
  /** 말풍선을 기본 위치에서 추가로 밀어낸 거리(px) — 프레임 간 부드럽게 따라간다 */
  labelShift?: number;
  /** 격파 확정 시 획득 점수(미사일 명중 시점에 반응(주스) 팝업 텍스트로 쓴다) */
  points?: number;
}

interface Projectile {
  x: number;
  y: number;
  targetId: number;
  speed: number;
  angle: number;
  type: 'laser' | 'missile';
}

export default function SpaceGamePage() {
  const { settings } = useSettingsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  useGameBgm('boss', status === 'countdown' || status === 'playing');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [shield, setShield] = useState(10);
  const [input, setInput] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [wordPool, setWordPool] = useState<string[]>([]);
  const [destroyCount, setDestroyCount] = useState(0);
  const [effectMsg, setEffectMsg] = useState<{ ability: Ability; msg: string } | null>(null);
  const freezeUntilRef = useRef(0);

  const enemiesRef = useRef<Enemy[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const animRef = useRef<number>(0);
  const nextIdRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const targetRef = useRef<number | null>(null);
  const scoreRef = useRef(0);
  const startedAtRef = useRef(0);
  const levelRef = useRef(1);
  const comboRef = useRef(0);
  const shieldRef = useRef(10);
  const killCountRef = useRef(0);
  const attemptsRef = useRef(0); // 입력 시도 횟수 — 정확도 산출용(맞힌 수 = killCountRef)
  const starsRef = useRef<Star[]>([]);
  const particlesRef = useRef(new ParticleSystem());
  const shakeRef = useRef(new ScreenShake());
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 격추·피격·능력·레벨업
  const isKorean = settings.language === 'ko';

  // Preload AI-generated sprites (procedural art stays as fallback until ready)
  useEffect(() => { preloadSprites(SPACE_SPRITES); }, []);

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

  // Load word pool with procedural generation
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

    // Also load base data
    (async () => {
      try {
        if (settings.language === 'ko') {
          const mod = await import('@/data/korean/words-beginner');
          const mod2 = await import('@/data/korean/words-intermediate');
          const base = [...mod.koreanWordsBeginner, ...mod2.koreanWordsIntermediate].filter(w => w.length >= 2);
          setWordPool([...new Set([...base, ...words])]);
        } else {
          const mod = await import('@/data/english/words-common200');
          const mod2 = await import('@/data/english/words-common1000');
          const base = [...mod.englishCommon200, ...mod2.englishCommon1000].filter(w => w.length >= 3);
          setWordPool([...new Set([...base, ...words])]);
        }
      } catch {
        setWordPool(words);
      }
    })();
  }, [settings.language]);

  // Refresh word pool on level up
  useEffect(() => {
    if (level > 1) {
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
  }, [level, settings.language]);

  // 게임 종료 시 서버 순위 제출(계정 없으면 조용히 무시). 게임은 순위 전용.
  useEffect(() => {
    if (status === 'gameover' && scoreRef.current > 0) {
      void submitGameScore('space', scoreRef.current, Date.now() - startedAtRef.current, settings.language);
    }
  }, [status, settings.language]);

  // 일일 퀘스트·도전과제에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  useGameResult(status === 'gameover', () =>
    attemptsRef.current === 0 && scoreRef.current === 0
      ? null
      : {
          gameType: 'space',
          score: scoreRef.current,
          level: levelRef.current,
          maxCombo,
          accuracy: hitAccuracy(killCountRef.current, attemptsRef.current),
          wordsTyped: killCountRef.current,
          elapsedTime: Math.round((Date.now() - startedAtRef.current) / 1000),
        }
  );

  const startGame = () => {
    setStatus('countdown');
    startedAtRef.current = Date.now();
    setScore(0); setLevel(1); setCombo(0); setMaxCombo(0);
    setShield(10); setInput(''); setDestroyCount(0);
    enemiesRef.current = []; projectilesRef.current = [];
    nextIdRef.current = 0; lastSpawnRef.current = 0;
    targetRef.current = null;
    scoreRef.current = 0; levelRef.current = 1; comboRef.current = 0;
    shieldRef.current = 10; killCountRef.current = 0; attemptsRef.current = 0;
    freezeUntilRef.current = 0; setEffectMsg(null);
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
    const cx = W / 2, cy = H * 0.55;
    const particles = particlesRef.current;
    const shake = shakeRef.current;

    // Initialize starfield
    if (starsRef.current.length === 0) {
      starsRef.current = createStarfield(120, W, H);
    }

    const loop = (time: number) => {
      const currentLevel = levelRef.current;
      const currentShield = shieldRef.current;
      const shakeOffset = shake.update();

      ctx.save();
      ctx.translate(shakeOffset.x, shakeOffset.y);

      // === BACKGROUND ===
      if (!drawBackgroundImage(ctx, 'space-bg', W, H, 0.2)) {
        drawSpaceBackground(ctx, W, H, time);
      }
      drawStarfield(ctx, starsRef.current, time, 0.015);
      drawNebula(ctx, W, H, time);

      // === PLAYER SHIP ===
      // 절차적 애니메이션: 부드러운 호버(상하 부유) + 미세 뱅크(좌우 기울임) + 추진기 점멸
      const hoverY = cy + Math.sin(time * 0.003) * 4;
      const bank = Math.sin(time * 0.0016) * 0.05;
      // 추진기 불꽃(선체 뒤쪽) — 매 프레임 세기 흔들림
      const thrust = 0.6 + Math.abs(Math.sin(time * 0.02)) * 0.4;
      const tGrad = ctx.createRadialGradient(cx, hoverY + 40, 0, cx, hoverY + 40, 22 * thrust);
      tGrad.addColorStop(0, `rgba(120,230,255,${0.55 * thrust})`);
      tGrad.addColorStop(0.5, `rgba(80,160,255,${0.3 * thrust})`);
      tGrad.addColorStop(1, 'rgba(80,160,255,0)');
      ctx.fillStyle = tGrad;
      ctx.beginPath();
      ctx.ellipse(cx, hoverY + 40, 12 * thrust, 26 * thrust, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!drawSprite(ctx, 'space-player', cx, hoverY, { h: 88, rotate: bank })) {
        drawPlayerShip(ctx, cx, cy, time, currentShield > 0);
      } else if (currentShield > 0) {
        // keep the shield ring the procedural ship would have drawn
        ctx.beginPath();
        ctx.arc(cx, hoverY, 50, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,210,211,${0.3 + Math.sin(time * 0.01) * 0.15})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // === SPAWN ENEMIES ===
      // Keep the screen populated: refill fast when nearly empty so there is
      // always a word to type, then settle to a steady (level-scaled) cadence.
      const aliveEnemies = enemiesRef.current.filter(e => !e.dying).length;
      const baseInterval = Math.max(1200 - currentLevel * 70, 500);
      const spawnInterval = aliveEnemies < 2 ? 350 : baseInterval;
      const maxEnemies = Math.min(5 + currentLevel, 15);
      if (time - lastSpawnRef.current > spawnInterval && enemiesRef.current.length < maxEnemies) {
        lastSpawnRef.current = time;
        const isBoss = currentLevel > 3 && killCountRef.current > 0 && killCountRef.current % 20 === 0 && !enemiesRef.current.some(e => e.isBoss);
        const isSpecial = !isBoss && rollSpecial(currentLevel, enemiesRef.current.some(e => e.special));
        const ability = isSpecial ? pickAbility() : undefined;
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.max(W, H) * 0.65;
        const wordFloor = isKorean ? Math.min(2 + Math.floor(currentLevel / 3), 5) : Math.min(3 + Math.floor(currentLevel / 2), 9);
        const word = wordGenerator.getUniqueWord(wordPool, wordFloor) || (isKorean ? '적기' : 'enemy');

        const enemy: Enemy = {
          id: nextIdRef.current++,
          text: (() => {
            if (isBoss) {
              const candidates = wordPool.filter(w => w.length >= (isKorean ? 4 : 6));
              return (candidates[Math.floor(Math.random() * candidates.length)] || (isKorean ? '최종보스' : 'destroyer'));
            }
            if (isSpecial) return wordGenerator.getUniqueWord(wordPool, isKorean ? 4 : 7) || word;
            return word;
          })(),
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist - H * 0.15,
          angle: 0,
          // 특수 적기는 조금 느리게 접근해 입력할 시간을 준다
          speed: isBoss ? 0.15 + currentLevel * 0.01 : isSpecial ? 0.16 + currentLevel * 0.02 : 0.25 + currentLevel * 0.04,
          color: isBoss ? '#FF0000' : isSpecial ? '#FECA57' : ['#FF6B6B', '#00D2D3', '#FECA57', '#FD79A8', '#48DBFB', '#A29BFE'][Math.floor(Math.random() * 6)],
          typed: '',
          shipType: isBoss ? 2 : Math.floor(Math.random() * 4),
          hp: isBoss ? 1 : 1,
          maxHp: isBoss ? 1 : 1,
          isBoss,
          spawnTime: time,
          special: isSpecial,
          ability,
        };
        enemy.angle = Math.atan2(cy - enemy.y, cx - enemy.x);
        enemiesRef.current.push(enemy);
      }

      // === UPDATE & DRAW ENEMIES ===
      const frozen = time < freezeUntilRef.current;
      const alive: Enemy[] = [];
      // 내 기체도 가리면 안 된다 — 적이 중앙으로 몰리면 라벨이 그 위에 쌓인다.
      const spriteBoxes: LabelBox[] = [
        { x: cx, y: hoverY, w: spriteWidthFor('space-player', 88, 50), h: 88 },
        // 상단 HUD(점수·레벨)·하단 정보줄(방어막·격파)도 라벨이 덮으면 안 된다.
        { x: cx, y: 26, w: W, h: 52, weight: 0.8 },
        { x: cx, y: H - 26, w: W, h: 48, weight: 0.8 },
      ];
      const labels: (LabelRequest & { e: Enemy; fs: number; spriteH: number; alpha: number })[] = [];
      for (const e of enemiesRef.current) {
        if (!e.dying && !frozen) {
          e.x += Math.cos(e.angle) * e.speed;
          e.y += Math.sin(e.angle) * e.speed;

          const dist = Math.hypot(e.x - cx, e.y - cy);

          // Hit player
          if (dist < 35) {
            shieldRef.current--;
            setShield(shieldRef.current);
            shake.shake(8);
            particles.explode(e.x, e.y, 0.5);
            {
              const rect = canvas.getBoundingClientRect();
              juiceRef.current?.fire('miss', { x: rect.left + e.x, y: rect.top + e.y, color: '#FF6B6B' });
            }
            if (shieldRef.current <= 0) {
              particles.explode(cx, cy, 2);
              setStatus('gameover');
              cancelAnimationFrame(animRef.current);
              soundManager?.play('gameOver');
              ctx.restore();
              return;
            }
            continue;
          }
        }

        // Draw enemy ship — keep hit (dying) enemies fully visible until the
        // missile actually reaches them, so nothing "pops" before impact.
        const age = (time - e.spawnTime) / 1000;
        ctx.globalAlpha = e.dying ? 1 : Math.min(1, age * 2);

        // 절차적 애니메이션: 비행 중 좌우 워블(흔들림) + 크기 맥동(pulse)으로 생동감
        const wobble = Math.sin(time * 0.006 + e.id * 1.7) * 0.12;
        const pulse = 1 + Math.sin(time * 0.008 + e.id) * 0.05;
        const scale = (e.isBoss ? 1.8 : 1) * pulse;
        if (!drawSprite(ctx, 'space-enemy', e.x, e.y, { h: 40 * scale, rotate: wobble })) {
          ctx.save();
          ctx.translate(e.x, e.y);
          ctx.scale(scale, scale);
          ctx.translate(-e.x, -e.y);
          drawEnemyShip(ctx, e.x, e.y, e.shipType, time, e.color);
          ctx.restore();
        }

        // Word bubble — 배치는 적기를 다 그린 뒤 한꺼번에(아래 resolveLabels).
        // 예전 위치는 기체 하단에 겹쳐 적기를 알아보기 어려웠다(실측 38% 가림).
        // 보스는 체력바(기체 아래 40~52)까지 피하도록 여백을 더 준다.
        const fs = e.isBoss ? 16 : e.special ? 16 : 14;
        const spriteH = 40 * scale;
        const home = wordBubbleY({
          spriteY: e.y, spriteH, fontSize: fs, gap: e.isBoss ? 26 : 9, canvasH: H, below: true,
        });
        spriteBoxes.push({
          x: e.x, y: e.y,
          w: spriteWidthFor('space-enemy', spriteH, 40 * scale) + 6, // +6 = wobble로 넓어지는 몫
          h: e.isBoss ? spriteH + 24 : spriteH, // 보스는 체력바까지 몸통으로 친다
        });
        labels.push({
          e, fs, spriteH, alpha: ctx.globalAlpha,
          x: e.x,
          w: wordBubbleWidth(ctx, e.text, fs),
          h: wordBubbleHeight(fs),
          homeY: home,
          // 화면 아래쪽이 좁아 위로 뒤집힌 경우엔 밀어내는 방향도 같이 뒤집는다.
          y: 0, dir: home > e.y ? 1 : -1, offset: 0, prefer: e.labelShift,
        });

        // Boss health bar
        if (e.isBoss) {
          drawShieldBar(ctx, e.x - 30, e.y + 40, e.hp, e.maxHp, 60);
        }

        // Aiming laser — only while the enemy is still typeable (not yet hit)
        if (!e.dying && targetRef.current === e.id && e.typed.length > 0) {
          drawLaser(ctx, cx, cy - 20, e.x, e.y, time, '#00D2D3');
          particles.laserHit(e.x, e.y);
        }

        ctx.globalAlpha = 1;
        alive.push(e);
      }
      enemiesRef.current = alive;

      // 라벨 배치 — 적기·다른 라벨을 피해 밀어낸다.
      resolveLabels(labels, spriteBoxes, { canvasH: H });
      for (const L of labels) {
        L.e.labelShift = easeLabelShift(L.e.labelShift, L.offset);
        const y = L.homeY + L.e.labelShift;
        ctx.globalAlpha = L.alpha;
        drawBubbleLeader(ctx, L.x, L.e.y, L.spriteH, y, L.fs, undefined, H);
        // 특수 적기: 금빛 후광 링 + 능력 라벨(말풍선 반대쪽)
        if (L.e.special && L.e.ability) {
          drawSpecialMarker(ctx, L.e.x, L.e.y, L.e.ability, time, L.e.id, L.e.y - L.spriteH / 2 - 8);
        }
        drawWordBubble(ctx, L.x, y, L.e.text, L.e.color, {
          targeted: targetRef.current === L.e.id,
          fontSize: L.fs,
        });
        ctx.globalAlpha = 1;
      }

      // === UPDATE PROJECTILES ===
      const aliveProjectiles: Projectile[] = [];
      for (const p of projectilesRef.current) {
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed;

        // Check if hit target (dying enemies)
        const target = enemiesRef.current.find(e => e.id === p.targetId && e.dying);
        if (target) {
          const d = Math.hypot(p.x - target.x, p.y - target.y);
          if (d < 25) {
            // Missile hit! Destroy enemy
            shake.shake(target.isBoss ? 10 : 4);
            {
              const rect = canvas.getBoundingClientRect();
              juiceRef.current?.fire('hit', {
                x: rect.left + target.x, y: rect.top + target.y,
                n: target.points, text: target.points ? `+${target.points}` : undefined,
                color: target.color, big: target.isBoss ? 2 : target.special ? 1.3 : 1,
              });
            }
            enemiesRef.current = enemiesRef.current.filter(e => e.id !== target.id);
            continue; // Missile consumed
          }
        }

        // Off screen
        if (p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50) continue;

        drawMissile(ctx, p.x, p.y, p.angle, time);
        aliveProjectiles.push(p);
      }
      projectilesRef.current = aliveProjectiles;

      // === PARTICLES ===
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
      drawHUD(ctx, {
        score: scoreRef.current,
        level: levelRef.current,
        combo: comboRef.current,
        label: isKorean ? 'LEVEL' : 'LEVEL',
      }, W);

      // Shield bar
      drawShieldBar(ctx, 20, H - 25, currentShield, 10, 200);
      ctx.font = "10px 'Noto Sans KR', sans-serif";
      ctx.fillStyle = 'rgba(232,232,255,0.5)';
      ctx.textAlign = 'left';
      ctx.fillText(isKorean ? '방어막' : 'SHIELD', 20, H - 30);

      // Kill counter
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.fillStyle = 'rgba(232,232,255,0.4)';
      ctx.textAlign = 'right';
      ctx.fillText(`${isKorean ? '격파' : 'KILLS'}: ${killCountRef.current}`, W - 20, H - 10);

      ctx.restore();

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [status, wordPool, isKorean]);

  const flashEffect = useCallback((ability: Ability, msg: string) => {
    setEffectMsg({ ability, msg });
    setTimeout(() => setEffectMsg(null), 2200);
  }, []);

  /** 특수 적기를 맞혔을 때 능력 발동. */
  const triggerAbility = useCallback((ability: Ability) => {
    const meta = ABILITY_META[ability];
    if (ability === 'freeze') {
      freezeUntilRef.current = performance.now() + FREEZE_MS;
    } else if (ability === 'clear') {
      // 화면의 모든 적기 격추 — 폭발 + 보너스 점수
      for (const e of enemiesRef.current) {
        if (e.dying) continue;
        particlesRef.current.explode(e.x, e.y, e.isBoss ? 1.5 : 0.7);
        scoreRef.current += 25;
      }
      enemiesRef.current = enemiesRef.current.filter(e => e.dying);
      setScore(scoreRef.current);
      shakeRef.current.shake(8);
    } else if (ability === 'heal') {
      shieldRef.current = Math.min(10, shieldRef.current + 2);
      setShield(shieldRef.current);
    }
    juiceRef.current?.fire('special', { title: `${meta.label}!`, color: meta.color, vib: [25, 30, 25] });
    flashEffect(ability, `${meta.label} 발동!`);
  }, [flashEffect]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    attemptsRef.current += 1;

    const trimmed = input.trim();
    const idx = enemiesRef.current.findIndex(e => !e.dying && e.text === trimmed);

    if (idx >= 0) {
      const enemy = enemiesRef.current[idx];

      // Fire projectile — launch from the ship's actual on-canvas position
      // (the render loop draws the ship at cx=W/2, cy=H*0.55), so the missile
      // visibly leaves the ship's nose rather than appearing from screen bottom.
      const canvas = canvasRef.current;
      if (canvas) {
        const W = canvas.offsetWidth;
        const H = canvas.offsetHeight;
        const cx = W / 2, cy = H * 0.55;
        const originY = cy - 40; // ship nose (ship drawn at h:88)
        const angle = Math.atan2(enemy.y - originY, enemy.x - cx);
        projectilesRef.current.push({
          x: cx, y: originY,
          targetId: enemy.id,
          speed: 12,
          angle,
          type: 'missile',
        });
      }

      // Mark enemy as dying (missile must hit first)
      enemy.dying = true;
      enemy.speed = 0;

      const basePoints = trimmed.length * 15;
      const comboBonus = Math.floor(comboRef.current / 5) * 0.5;
      const bossBonus = enemy.isBoss ? 5 : enemy.special ? 2 : 1; // 특수 적기는 2배
      const points = Math.round(basePoints * (1 + comboBonus) * bossBonus);
      enemy.points = points; // 미사일 명중 시 반응(주스) 팝업에 쓴다

      scoreRef.current += points;
      if (enemy.special && enemy.ability) triggerAbility(enemy.ability);
      setScore(scoreRef.current);
      comboRef.current += 1;
      setCombo(comboRef.current);
      setMaxCombo(m => Math.max(m, comboRef.current));
      killCountRef.current += 1;
      setDestroyCount(killCountRef.current);

      // Level up every 10 kills
      if (killCountRef.current % 10 === 0) {
        levelRef.current += 1;
        setLevel(levelRef.current);
        juiceRef.current?.fire('levelup', { title: `LEVEL ${levelRef.current}!`, color: '#48DBFB' });
        // Restore 1 shield on level up
        if (shieldRef.current < 10) {
          shieldRef.current = Math.min(10, shieldRef.current + 1);
          setShield(shieldRef.current);
        }
      }
      // hit(sfx+burst)는 미사일이 명중하는 애니메이션 루프에서 fire한다
    } else {
      comboRef.current = 0;
      setCombo(0);
      juiceRef.current?.fire('miss', { color: '#FF6B6B' });
    }
    setInput('');
    targetRef.current = null;
  }, [input, triggerAbility]);

  // Auto-target as user types
  useEffect(() => {
    if (!input.trim()) { targetRef.current = null; return; }
    const match = enemiesRef.current.find(e => e.text.startsWith(input.trim()));
    if (match) {
      targetRef.current = match.id;
      match.typed = input.trim();
    } else {
      targetRef.current = null;
    }
  }, [input]);

  if (status === 'menu') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
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
          {isKorean ? '적 우주선의 단어를 입력해서 격파하세요!' : 'Type words to destroy enemy ships!'}
        </p>
        <div className="max-w-md mx-auto mb-6">
          <Card className="p-4 text-left">
            <ul className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>{isKorean ? '• 적 우주선에 표시된 단어를 입력하면 격파' : '• Type displayed words to destroy enemies'}</li>
              <li>{isKorean ? '• 10기 격파할 때마다 레벨 업' : '• Level up every 10 kills'}</li>
              <li>{isKorean ? '• 콤보로 보너스 점수 획득' : '• Chain combos for bonus points'}</li>
              <li>{isKorean ? '• 보스 적기 등장 시 긴 단어 입력 필요' : '• Boss enemies require longer words'}</li>
              <li>{isKorean ? '• 레벨 업 시 방어막 1 회복' : '• Shield +1 on level up'}</li>
              <li style={{ color: '#FECA57' }} className="flex items-center gap-1 flex-wrap">
                •<Sparkles className="w-3.5 h-3.5 inline" aria-hidden />
                {isKorean ? (
                  <>
                    금빛 특수 적기 격파 시 능력 발동 (
                    <Snowflake className="w-3.5 h-3.5 inline" aria-hidden />정지·
                    <Zap className="w-3.5 h-3.5 inline" aria-hidden />전멸·
                    <Heart className="w-3.5 h-3.5 inline" aria-hidden />방어막) + 점수 2배
                  </>
                ) : (
                  'Golden ships trigger abilities (freeze/clear/heal) + 2x points'
                )}
              </li>
            </ul>
          </Card>
        </div>
        <Button size="lg" onClick={() => schoolGate(startGame)}>{isKorean ? '게임 시작' : 'Start Game'}</Button>
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
        <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-error)', fontFamily: "'Outfit'" }}>
          {isKorean ? '게임 오버' : 'Game Over'}
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
          {isKorean ? '우주선이 파괴되었습니다' : 'Your ship has been destroyed'}
        </p>
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
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '격파' : 'KILLS'}</div>
            <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: '#00B894' }}>{destroyCount}</div>
          </Card>
        </div>
        <Button size="lg" onClick={() => schoolGate(startGame)}>{isKorean ? '다시 시작' : 'Retry'}</Button>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-4 py-4">
      <div className="relative rounded-xl overflow-hidden border border-[var(--key-border)]" style={{ height: '500px' }}>
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
        <Button type="submit" size="lg">{isKorean ? '발사' : 'Fire'}</Button>
      </form>
    </div>
  );
}
