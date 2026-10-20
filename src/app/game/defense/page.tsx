'use client';

import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { soundManager } from '@/lib/sound/sound-manager';
import { useGameBgm } from '@/hooks/useGameBgm';
import { useGameResult, hitAccuracy } from '@/hooks/useGameResult';
import { pickRandom, randomBetween } from '@/lib/utils/helpers';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { wordGenerator } from '@/lib/content/word-generator';
import { submitGameScore } from '@/lib/api/client';
import {
  ParticleSystem, ScreenShake,
  drawCastle, drawCastleDetailed, drawSoldierEnemy, drawWordBubble, drawShieldBar,
  preloadSprites, drawSprite, drawBackgroundImage, wordBubbleY, wordBubbleHeight, wordBubbleWidth,
  drawBubbleLeader, resolveLabels, easeLabelShift, spriteWidthFor,
  type LabelBox, type LabelRequest,
} from '@/lib/game/renderer';
import { Ability, ABILITY_META, FREEZE_MS, rollSpecial, pickAbility, drawSpecialMarker } from '@/lib/game/special-words';
import { createGameJuice } from '@/lib/game/juice-table';
import { drawVectorIcon, ICON_SNOWFLAKE } from '@/lib/game/canvas-icons';
import { AbilityIcon } from '@/components/common/AbilityIcon';

const DEFENSE_SPRITES = {
  'defense-bg': '/game/defense/bg.webp',
  'defense-castle': '/game/defense/castle.webp',
  'defense-enemy': '/game/defense/enemy.webp',
};

interface Enemy {
  id: number;
  text: string;
  x: number;
  y: number;
  speed: number;
  hp: number;
  color: string;
  type: number; // 0=swordsman, 1=spearman, 2=knight
  lane: number; // 세로 레인 인덱스(말풍선 겹침 방지)
  spawnTime: number;
  dying?: boolean;
  special?: boolean;
  ability?: Ability;
  /** 말풍선을 머리 위에서 추가로 밀어 올린 거리(px) — 프레임 간 부드럽게 따라간다 */
  labelShift?: number;
  /** 격파 확정 시 획득 점수(화살 명중 시점에 반응(주스) 팝업 텍스트로 쓴다) */
  points?: number;
}

interface Arrow {
  x: number;
  y: number;
  targetId: number;
  speed: number;
  angle: number;
}

export default function DefenseGamePage() {
  const { settings } = useSettingsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  useGameBgm('action', status === 'countdown' || status === 'playing');
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [gold, setGold] = useState(0);
  const [castleHp, setCastleHp] = useState(20);
  const [input, setInput] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [wordPool, setWordPool] = useState<string[]>([]);
  const [killCount, setKillCount] = useState(0);
  const [effectMsg, setEffectMsg] = useState<{ ability: Ability; msg: string } | null>(null);
  const freezeUntilRef = useRef(0);

  const enemiesRef = useRef<Enemy[]>([]);
  const arrowsRef = useRef<Arrow[]>([]);
  const animRef = useRef<number>(0);
  const nextIdRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const scoreRef = useRef(0);
  const startedAtRef = useRef(0);
  const waveRef = useRef(1);
  const goldRef = useRef(0);
  const castleHpRef = useRef(20);
  const killCountRef = useRef(0);
  const attemptsRef = useRef(0); // 입력 시도 횟수 — 정확도 산출용(맞힌 수 = killCountRef)
  const particlesRef = useRef(new ParticleSystem());
  const shakeRef = useRef(new ScreenShake());
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 격파·피격·능력·웨이브업
  const isKorean = settings.language === 'ko';

  useEffect(() => { preloadSprites(DEFENSE_SPRITES); }, []);

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
    if (status === 'gameover' && scoreRef.current > 0) {
      void submitGameScore('defense', scoreRef.current, Date.now() - startedAtRef.current, settings.language);
    }
  }, [status, settings.language]);

  // 일일 퀘스트·도전과제에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  // 킹덤 디펜스는 콤보 시스템이 없어 maxCombo는 0으로 둔다.
  useGameResult(status === 'gameover', () =>
    attemptsRef.current === 0 && scoreRef.current === 0
      ? null
      : {
          gameType: 'defense',
          score: scoreRef.current,
          level: waveRef.current,
          maxCombo: 0,
          accuracy: hitAccuracy(killCountRef.current, attemptsRef.current),
          wordsTyped: killCountRef.current,
          elapsedTime: Math.round((Date.now() - startedAtRef.current) / 1000),
        }
  );

  const startGame = () => {
    setStatus('countdown');
    startedAtRef.current = Date.now();
    setScore(0); setWave(1); setGold(0); setCastleHp(20);
    setInput(''); setKillCount(0);
    enemiesRef.current = []; arrowsRef.current = [];
    nextIdRef.current = 0; lastSpawnRef.current = 0;
    scoreRef.current = 0; waveRef.current = 1; goldRef.current = 0;
    castleHpRef.current = 20; killCountRef.current = 0; attemptsRef.current = 0;
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
    const particles = particlesRef.current;
    const shake = shakeRef.current;

    const loop = (time: number) => {
      const currentWave = waveRef.current;
      const hpVal = castleHpRef.current;
      const shakeOffset = shake.update();

      ctx.save();
      ctx.translate(shakeOffset.x, shakeOffset.y);

      // Background - scenic sunset landscape (AI art if loaded, else procedural)
      const bgLoaded = drawBackgroundImage(ctx, 'defense-bg', W, H, 0.24);
      if (!bgLoaded) {
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.7);
      skyGrad.addColorStop(0, '#FF6B35'); // Orange sunset
      skyGrad.addColorStop(0.3, '#F7931E'); // Warm orange
      skyGrad.addColorStop(0.6, '#FFB347'); // Peach
      skyGrad.addColorStop(0.8, '#4A154B'); // Deep purple
      skyGrad.addColorStop(1, '#0D1B2A'); // Dark blue-purple
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H * 0.7);

      // Mountain silhouettes (3 layers with parallax)
      // Distant mountains
      ctx.fillStyle = 'rgba(26,26,62,0.8)';
      ctx.beginPath();
      ctx.moveTo(0, H * 0.5);
      for (let x = 0; x <= W; x += 60) {
        ctx.lineTo(x, H * 0.35 + Math.sin(x * 0.005 + time * 0.0001) * 40 + Math.sin(x * 0.012) * 20);
      }
      ctx.lineTo(W, H * 0.7);
      ctx.lineTo(0, H * 0.7);
      ctx.fill();

      // Middle mountains
      ctx.fillStyle = 'rgba(36,36,72,0.9)';
      ctx.beginPath();
      ctx.moveTo(0, H * 0.6);
      for (let x = 0; x <= W; x += 45) {
        ctx.lineTo(x, H * 0.45 + Math.sin(x * 0.008 + time * 0.0001) * 35 + Math.sin(x * 0.018) * 15);
      }
      ctx.lineTo(W, H * 0.7);
      ctx.lineTo(0, H * 0.7);
      ctx.fill();

      // Near mountains
      ctx.fillStyle = 'rgba(46,46,82,1)';
      ctx.beginPath();
      ctx.moveTo(0, H * 0.65);
      for (let x = 0; x <= W; x += 30) {
        ctx.lineTo(x, H * 0.55 + Math.sin(x * 0.015 + time * 0.0002) * 25 + Math.sin(x * 0.03) * 10);
      }
      ctx.lineTo(W, H * 0.7);
      ctx.lineTo(0, H * 0.7);
      ctx.fill();

      // Grassy plain/field
      const groundGrad = ctx.createLinearGradient(0, H * 0.7, 0, H);
      groundGrad.addColorStop(0, '#2D5016'); // Dark green
      groundGrad.addColorStop(0.5, '#355E1D'); // Medium green
      groundGrad.addColorStop(1, '#1A3A0B'); // Very dark green
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, H * 0.7, W, H * 0.3);

      // Animated grass (sin-wave green lines)
      ctx.strokeStyle = 'rgba(52,154,32,0.6)';
      ctx.lineWidth = 1;
      for (let i = 0; i < W; i += 8) {
        const grassHeight = 3 + Math.sin(time * 0.002 + i * 0.05) * 2;
        ctx.beginPath();
        ctx.moveTo(i, H * 0.75);
        ctx.lineTo(i + Math.sin(time * 0.003 + i * 0.02) * 1, H * 0.75 - grassHeight);
        ctx.stroke();
      }

      // Dirt road/path from left to castle
      const pathGrad = ctx.createLinearGradient(0, H * 0.72, 0, H * 0.78);
      pathGrad.addColorStop(0, '#8B7355');
      pathGrad.addColorStop(0.5, '#A0865C');
      pathGrad.addColorStop(1, '#6B5B47');
      ctx.fillStyle = pathGrad;
      ctx.fillRect(0, H * 0.74, W * 0.7, 25);

      // Cobblestones near castle
      ctx.fillStyle = '#707070';
      for (let x = W * 0.6; x < W * 0.7; x += 12) {
        for (let y = H * 0.74; y < H * 0.77; y += 8) {
          ctx.fillRect(x + Math.sin(y) * 2, y, 8, 6);
        }
      }

      // Footprints/tracks on the road
      ctx.fillStyle = 'rgba(107,91,71,0.5)';
      for (let x = 50; x < W * 0.6; x += 40) {
        const trackY = H * 0.75;
        // Left foot
        ctx.beginPath();
        ctx.ellipse(x, trackY, 3, 6, 0.2, 0, Math.PI * 2);
        ctx.fill();
        // Right foot
        ctx.beginPath();
        ctx.ellipse(x + 15, trackY + 5, 3, 6, -0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      } // end procedural background

      // Castle — AI sprite with HP bar + damage tint, else procedural (damage states built-in)
      const castleBaseX = W - 100;
      const castleBaseY = H * 0.75;
      if (drawSprite(ctx, 'defense-castle', castleBaseX, castleBaseY - 72, { h: 150 })) {
        const hpRatio = Math.max(0, hpVal / 20);
        // damage reddening as the castle takes hits
        if (hpRatio < 1) {
          ctx.save();
          ctx.globalAlpha = (1 - hpRatio) * 0.35;
          ctx.fillStyle = '#8B1A1A';
          ctx.fillRect(castleBaseX - 55, castleBaseY - 150, 110, 150);
          ctx.restore();
        }
        // HP bar above the castle
        const barW = 90, barX = castleBaseX - barW / 2, barY = castleBaseY - 158;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(barX - 2, barY - 2, barW + 4, 8);
        ctx.fillStyle = hpRatio > 0.5 ? '#48DBFB' : hpRatio > 0.25 ? '#FECA57' : '#FF6B6B';
        ctx.fillRect(barX, barY, barW * hpRatio, 4);
      } else {
        drawCastleDetailed(ctx, W - 100, H * 0.75 - 20, hpVal, 20, time);
      }

      // Spawn enemies — 세로 레인으로 분산 + 스폰 지점 여유 게이트로 말풍선 겹침 방지
      const D_LANES = 5;
      const laneY = (i: number) => H * 0.58 + i * (H * 0.24 / (D_LANES - 1)); // H*0.58 ~ H*0.82
      const D_MIN_GAP = 72; // 스폰 지점 앞 최소 여유(px). 이보다 붐비면 스폰 보류
      // 가장 여유 있는 레인 = 스폰 지점(x=-20)에서 가장 가까운 적이 가장 멀리 나가 있는 레인
      let bestLane = 0, bestClear = -Infinity;
      for (let i = 0; i < D_LANES; i++) {
        let nearest = Infinity;
        for (const e of enemiesRef.current) if (e.lane === i && e.x < nearest) nearest = e.x;
        if (nearest > bestClear) { bestClear = nearest; bestLane = i; }
      }
      const aliveFoes = enemiesRef.current.filter(e => !e.dying).length;
      const dSpawnInterval = aliveFoes < 2 ? 450 : Math.max(1500 - currentWave * 90, 650);
      const dMax = Math.min(5 + currentWave, 13);
      if (time - lastSpawnRef.current > dSpawnInterval && enemiesRef.current.length < dMax && bestClear >= D_MIN_GAP) {
        lastSpawnRef.current = time;
        const isSpecial = rollSpecial(currentWave, enemiesRef.current.some(e => e.special));
        const ability = isSpecial ? pickAbility() : undefined;
        const wordFloor = isSpecial
          ? (isKorean ? 4 : 7)
          : (isKorean ? Math.min(2 + Math.floor(currentWave / 3), 5) : Math.min(3 + Math.floor(currentWave / 2), 9));
        const word = wordGenerator.getUniqueWord(wordPool, wordFloor) || (isKorean ? '적군' : 'enemy');

        // Enemy type distribution: 50% swordsman, 30% spearman, 20% knight (higher HP)
        const typeRoll = Math.random();
        let enemyType, enemyHp;
        if (typeRoll < 0.5) {
          enemyType = 0; // Swordsman
          enemyHp = 1;
        } else if (typeRoll < 0.8) {
          enemyType = 1; // Spearman
          enemyHp = 1;
        } else {
          enemyType = 2; // Knight (rare, high HP)
          enemyHp = 2;
        }

        enemiesRef.current.push({
          id: nextIdRef.current++,
          text: word,
          x: -20, // 왼쪽 화면 밖에서 스폰 → 성(오른쪽)을 향해 행군
          y: laneY(bestLane) + randomBetween(-4, 4), // 레인별 세로 위치
          // 특수 병사는 느리게 행군해 긴 단어를 입력할 시간을 준다
          speed: (0.25 + currentWave * 0.04) * (isSpecial ? 0.55 : 1),
          hp: enemyHp,
          color: isSpecial ? '#FECA57' : pickRandom(['#FF6B6B', '#FECA57', '#FD79A8', '#00D2D3']),
          type: enemyType,
          lane: bestLane,
          spawnTime: time,
          special: isSpecial,
          ability,
        });
      }

      // Update & draw enemies
      const frozen = time < freezeUntilRef.current;
      const alive: Enemy[] = [];
      // 말풍선은 병사를 다 그린 뒤 한꺼번에 배치한다 — 자기 몸통뿐 아니라
      // 뒤에 선 병사·성·다른 말풍선까지 피해야 해서 전체 상자를 알아야 한다.
      const spriteBoxes: LabelBox[] = [
        { x: W - 100, y: H * 0.75 - 72, w: spriteWidthFor('defense-castle', 150, 120), h: 150 },
        // 상단 HUD(점수·웨이브·골드)도 라벨이 덮으면 안 된다.
        { x: W / 2, y: 28, w: W, h: 56, weight: 0.8 },
      ];
      const labels: (LabelRequest & { e: Enemy; fs: number })[] = [];
      for (const e of enemiesRef.current) {
        if (!e.dying && !frozen) {
          e.x += e.speed; // 오른쪽(성)으로 행군

          // Hit castle (updated position)
          if (e.x > W - 150) {
            castleHpRef.current--;
            setCastleHp(castleHpRef.current);
            shake.shake(5);
            particles.emit(W - 120, e.y, 8, {
              speed: 2, life: 20, size: 3,
              colors: ['#FF6B6B', '#FF9F43'],
            });
            if (castleHpRef.current <= 0) {
              particles.explode(W - 100, H * 0.75, 2);
              setStatus('gameover');
              cancelAnimationFrame(animRef.current);
              soundManager?.play('gameOver');
              ctx.restore();
              return;
            }
            {
              const rect = canvas.getBoundingClientRect();
              juiceRef.current?.fire('miss', { x: rect.left + (W - 120), y: rect.top + e.y, color: '#FF6B6B' });
            }
            continue;
          }
        }

        // Draw detailed enemy soldier — keep hit (dying) enemies fully visible
        // until the arrow reaches them, so nothing pops before impact.
        ctx.save();

        // Calculate walking animation phase based on movement
        const walkPhase = time * 0.008 + e.id + e.x * 0.01;

        // 절차적 행진: 발걸음 상하 홉(bob) + 몸통 좌우 흔들림(sway) — 전진하는 병사 느낌
        const bob = Math.abs(Math.sin(walkPhase)) * 3;
        const sway = Math.sin(walkPhase) * 0.09;
        const spriteH = e.type === 2 ? 56 : 44;
        if (!drawSprite(ctx, 'defense-enemy', e.x, e.y - 8 - bob, { h: spriteH, rotate: sway })) {
          drawSoldierEnemy(ctx, e.x, e.y, e.type, walkPhase, time);
        }

        ctx.restore();

        // Word bubble — keep visible until the arrow hits (dying enemies too),
        // so the word and the soldier explode together on impact.
        // 말풍선은 병사 머리 위로 완전히 비켜 놓는다 — 예전엔 몸통 위에 겹쳐 그려서
        // 병사가 거의 안 보였다(실측 최대 97% 가림). bob 진폭(3)까지 높이에 더해
        // 라벨은 흔들리지 않으면서도 항상 스프라이트 밖에 뜬다.
        const fs = e.special ? 15 : 13;
        const boxH = spriteH + 6;
        const bh = wordBubbleHeight(fs);
        const home = wordBubbleY({ spriteY: e.y - 8, spriteH: boxH, fontSize: fs, canvasH: H });
        // +6은 sway(좌우 기울임)로 넓어지는 몫 — 상자를 넉넉히 잡아야 라벨이 안 걸친다.
        spriteBoxes.push({ x: e.x, y: e.y - 8, w: spriteWidthFor('defense-enemy', spriteH, 32) + 6, h: boxH });
        labels.push({
          e, fs,
          x: e.x,
          w: wordBubbleWidth(ctx, e.text, fs),
          h: bh,
          homeY: home,
          // 화면 위쪽이 좁아 아래로 뒤집힌 경우엔 밀어내는 방향도 같이 뒤집는다.
          y: 0, dir: home < e.y - 8 ? -1 : 1, offset: 0, prefer: e.labelShift,
        });
        alive.push(e);
      }
      enemiesRef.current = alive;

      // 라벨 배치 — 병사·다른 라벨을 피해 위로 밀어 올린다.
      resolveLabels(labels, spriteBoxes, { canvasH: H });
      for (const L of labels) {
        L.e.labelShift = easeLabelShift(L.e.labelShift, L.offset);
        const y = L.homeY + L.e.labelShift;
        drawBubbleLeader(ctx, L.x, L.e.y - 8, L.e.type === 2 ? 62 : 50, y, L.fs, undefined, H);
        // 특수 병사: 금빛 후광 링 + 능력 라벨(말풍선 위로)
        if (L.e.special && L.e.ability) {
          drawSpecialMarker(ctx, L.e.x, L.e.y - 8, L.e.ability, time, L.e.id, y - L.h / 2 - 7);
        }
        drawWordBubble(ctx, L.x, y, L.e.text, L.e.color, { fontSize: L.fs });
      }

      // Update & draw arrows (arrows hit dying enemies)
      const aliveArrows: Arrow[] = [];
      for (const a of arrowsRef.current) {
        a.x += Math.cos(a.angle) * a.speed;
        a.y += Math.sin(a.angle) * a.speed;
        if (a.x > W + 20 || a.x < -20 || a.y < -20 || a.y > H + 20) continue;

        // Check if arrow hit its target
        const target = enemiesRef.current.find(e => e.id === a.targetId && e.dying);
        if (target) {
          const dx = a.x - target.x;
          const dy = a.y - target.y;
          if (Math.sqrt(dx * dx + dy * dy) < 25) {
            // Arrow hit! Explode and remove enemy
            shake.shake(3);
            {
              const rect = canvas.getBoundingClientRect();
              juiceRef.current?.fire('hit', {
                x: rect.left + target.x, y: rect.top + target.y,
                n: target.points, text: target.points ? `+${target.points}` : undefined,
                color: target.color, big: target.special ? 1.3 : 1,
              });
            }
            enemiesRef.current = enemiesRef.current.filter(e => e.id !== target.id);
            continue; // Arrow consumed
          }
        }

        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.angle);

        // Arrow flight trail (fading line behind)
        ctx.strokeStyle = 'rgba(254,202,87,0.3)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.lineTo(-8, 0);
        ctx.stroke();

        // Arrow shaft with gradient (wood color)
        const shaftGrad = ctx.createLinearGradient(-10, -1, 6, 1);
        shaftGrad.addColorStop(0, '#8B4513');
        shaftGrad.addColorStop(0.5, '#A0522D');
        shaftGrad.addColorStop(1, '#CD853F');
        ctx.strokeStyle = shaftGrad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(6, 0);
        ctx.stroke();

        // Arrow head (metallic triangle)
        const headGrad = ctx.createLinearGradient(5, -3, 10, 3);
        headGrad.addColorStop(0, '#E5E5E5');
        headGrad.addColorStop(0.5, '#C0C0C0');
        headGrad.addColorStop(1, '#A0A0A0');
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(5, -4);
        ctx.lineTo(5, 4);
        ctx.closePath();
        ctx.fill();

        // Arrow head highlight
        ctx.strokeStyle = '#F5F5F5';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(5, -2);
        ctx.stroke();

        // Fletching (feathers)
        ctx.fillStyle = '#8B0000';
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(-15, -4);
        ctx.lineTo(-12, 0);
        ctx.lineTo(-15, 4);
        ctx.closePath();
        ctx.fill();

        ctx.restore();

        aliveArrows.push(a);
      }
      arrowsRef.current = aliveArrows;

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
        ctx.fillText('일시정지', W / 2, 62);
        drawVectorIcon(ctx, ICON_SNOWFLAKE, W / 2 - ctx.measureText('일시정지').width / 2 - 11, 57, 16, 'rgba(180,240,255,0.9)');
        ctx.restore();
      }

      // HUD
      ctx.font = "bold 18px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#E8E8FF';
      ctx.textAlign = 'left';
      ctx.fillText(`${scoreRef.current}`, 20, 25);
      ctx.font = "9px 'Noto Sans KR', sans-serif";
      ctx.fillStyle = 'rgba(232,232,255,0.4)';
      ctx.fillText('SCORE', 20, 12);

      // Fancy wave banner
      ctx.save();
      ctx.translate(W / 2, 15);

      // Banner background
      const bannerGrad = ctx.createLinearGradient(-60, -8, 60, 8);
      bannerGrad.addColorStop(0, 'rgba(162,155,254,0.8)');
      bannerGrad.addColorStop(0.5, 'rgba(108,92,231,0.9)');
      bannerGrad.addColorStop(1, 'rgba(162,155,254,0.8)');
      ctx.fillStyle = bannerGrad;
      ctx.beginPath();
      ctx.moveTo(-60, -8);
      ctx.lineTo(60, -8);
      ctx.lineTo(70, 0);
      ctx.lineTo(60, 8);
      ctx.lineTo(-60, 8);
      ctx.lineTo(-70, 0);
      ctx.closePath();
      ctx.fill();

      // Banner border
      ctx.strokeStyle = '#8B7ED8';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Wave text
      ctx.font = "bold 16px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`WAVE ${waveRef.current}`, 0, 0);

      ctx.restore();

      // Enemy count remaining
      const aliveEnemies = enemiesRef.current.filter(e => !e.dying).length;
      if (aliveEnemies > 0) {
        ctx.font = "12px 'JetBrains Mono', monospace";
        ctx.fillStyle = 'rgba(255,107,107,0.8)';
        ctx.textAlign = 'center';
        ctx.fillText(`${aliveEnemies} enemies`, W / 2, 45);
      }

      ctx.font = "13px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#FECA57';
      ctx.textAlign = 'right';
      ctx.fillText(`${goldRef.current}G`, W - 20, 25);

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

  /** 특수 병사를 맞혔을 때 능력 발동. */
  const triggerAbility = (ability: Ability) => {
    const meta = ABILITY_META[ability];
    if (ability === 'freeze') {
      freezeUntilRef.current = performance.now() + FREEZE_MS;
    } else if (ability === 'clear') {
      // 화면의 모든 적군 격퇴 — 폭발 + 골드 보너스
      for (const e of enemiesRef.current) {
        if (e.dying) continue;
        particlesRef.current.explode(e.x, e.y, 0.6);
        scoreRef.current += 20;
        goldRef.current += 3;
      }
      enemiesRef.current = enemiesRef.current.filter(e => e.dying);
      setScore(scoreRef.current);
      setGold(goldRef.current);
      shakeRef.current.shake(8);
    } else if (ability === 'heal') {
      castleHpRef.current = Math.min(20, castleHpRef.current + 4);
      setCastleHp(castleHpRef.current);
    }
    const abilityLabel = ability === 'heal' ? '성 수리' : meta.label;
    juiceRef.current?.fire('special', { title: `${abilityLabel}!`, color: meta.color, vib: [25, 30, 25] });
    flashEffect(ability, `${abilityLabel} 발동!`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    attemptsRef.current += 1;
    const idx = enemiesRef.current.findIndex(e => !e.dying && e.text === input.trim());
    if (idx >= 0) {
      const enemy = enemiesRef.current[idx];
      // Mark as dying (don't remove yet - arrow must hit first)
      enemy.dying = true;
      enemy.speed = 0;
      // Fire arrow toward enemy
      const canvas = canvasRef.current;
      if (canvas) {
        const castleX = canvas.offsetWidth - 100;
        const castleTop = canvas.offsetHeight * 0.75 - 55;
        const angle = Math.atan2(enemy.y - castleTop, enemy.x - castleX);
        arrowsRef.current.push({ x: castleX - 30, y: castleTop, targetId: enemy.id, speed: 12, angle });
      }
      // Score updates immediately (player gets feedback)
      const points = input.length * 10 * (enemy.special ? 2 : 1); // 특수 병사는 2배
      enemy.points = points; // 화살 명중 시 반응(주스) 팝업에 쓴다
      scoreRef.current += points;
      if (enemy.special && enemy.ability) triggerAbility(enemy.ability);
      setScore(scoreRef.current);
      goldRef.current += 5 + Math.floor(input.length / 2);
      setGold(goldRef.current);
      killCountRef.current += 1;
      setKillCount(killCountRef.current);
      if (killCountRef.current % 8 === 0) {
        waveRef.current += 1;
        setWave(waveRef.current);
        juiceRef.current?.fire('levelup', { title: `WAVE ${waveRef.current}!`, color: '#FECA57' });
        if (castleHpRef.current < 20) {
          castleHpRef.current = Math.min(20, castleHpRef.current + 2);
          setCastleHp(castleHpRef.current);
        }
      }
    } else {
      juiceRef.current?.fire('miss', { color: '#FF6B6B' });
    }
    setInput('');
  };

  if (status === 'menu') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
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
          <p className="mb-6 text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            ✨ 금빛으로 빛나는 <b style={{ color: '#FECA57' }}>특수 병사</b>를 격퇴하면 능력 발동 —
            ❄️ 일시정지 · 💥 전체 격퇴 · 💚 성 수리 (점수 2배!)
          </p>
        )}
        <Button size="lg" onClick={startGame}>{isKorean ? '게임 시작' : 'Start Game'}</Button>
      </div>
    );
  }

  if (status === 'countdown') return <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}><div className="text-8xl font-bold neon-text">{countdown}</div></div>;

  if (status === 'gameover') return (
    <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
      <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--color-error)', fontFamily: "'Outfit'" }}>
        {isKorean ? '성이 함락되었습니다!' : 'Castle Fallen!'}
      </h1>
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
      <Button size="lg" onClick={startGame}>{isKorean ? '다시 시작' : 'Retry'}</Button>
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
        <Button type="submit" size="lg">{isKorean ? '공격' : 'Attack'}</Button>
      </form>
    </div>
  );
}
