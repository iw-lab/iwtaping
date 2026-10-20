'use client';

import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { soundManager } from '@/lib/sound/sound-manager';
import { useGameBgm } from '@/hooks/useGameBgm';
import { schoolGate } from '@/lib/gb/school';
import { useGameResult, hitAccuracy } from '@/hooks/useGameResult';
import { pickRandom, randomBetween } from '@/lib/utils/helpers';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { wordGenerator } from '@/lib/content/word-generator';
import { submitGameScore } from '@/lib/api/client';
import {
  ParticleSystem, ScreenShake,
  createStarfield, drawStarfield,
  drawRainEffect, drawWordBubble, drawShieldBar,
  wordBubbleWidth, wordBubbleHeight, resolveLabels, easeLabelShift,
  type Star, type LabelRequest,
} from '@/lib/game/renderer';
import { createGameJuice } from '@/lib/game/juice-table';
import { drawVectorIcon, ICON_SNOWFLAKE, ICON_ZAP, ICON_DROPLET } from '@/lib/game/canvas-icons';
import { Snowflake, Zap, Droplet, type LucideIcon } from 'lucide-react';

/**
 * 단어를 놓쳐 바닥에 닿을 때 깎이는 pH. 시작 pH가 10.0이므로 13번 놓치면 게임오버다.
 * 형제 게임의 실수 허용치(좀비 10·우주 10·디펜스 20)에 맞춘 값 — 이전 0.3은 34회라
 * 무입력 방치 시 게임오버까지 183초 걸렸다(0.8 적용 후 78초, 둘 다 실측).
 * 오답 입력으로는 깎이지 않는다. 맞히면 손실이 없으므로 실제 체감은 더 관대하다.
 */
const PH_DAMAGE_PER_MISS = 0.8;

/** 특수단어(어려운 단어)를 맞히면 발동하는 능력. */
type Ability = 'freeze' | 'clear' | 'heal';

const ABILITY_META: Record<Ability, { iconPaths: readonly string[]; label: string; color: string }> = {
  freeze: { iconPaths: ICON_SNOWFLAKE, label: '일시정지', color: '#48DBFB' },
  clear: { iconPaths: ICON_ZAP, label: '전체 정화', color: '#FD79A8' },
  heal: { iconPaths: ICON_DROPLET, label: 'pH 회복', color: '#00E5A0' },
};
/** 효과 배지(JSX) 전용 — 캔버스가 아니라 실제 lucide 컴포넌트를 쓴다. */
const ABILITY_ICON: Record<Ability, LucideIcon> = { freeze: Snowflake, clear: Zap, heal: Droplet };
const ABILITIES: Ability[] = ['freeze', 'clear', 'heal'];
const FREEZE_MS = 4000;

interface FallingWord {
  id: number;
  text: string;
  x: number;
  y: number;
  speed: number;
  color: string;
  rotation: number;
  glowPhase: number;
  special?: boolean;
  ability?: Ability;
  /** 겹침을 피해 가로로 비켜 놓은 거리(px). 낙하 높이(y)는 건드리지 않는다. */
  labelShift?: number;
}

const COLORS = ['#6C5CE7', '#00D2D3', '#FF6B6B', '#FECA57', '#00B894', '#FD79A8', '#48DBFB', '#A29BFE'];

export default function RainGamePage() {
  const { settings } = useSettingsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  useGameBgm('action', status === 'countdown' || status === 'playing');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [ph, setPh] = useState(10.0);
  const [input, setInput] = useState('');
  const [countdown, setCountdown] = useState(3);
  const [wordPool, setWordPool] = useState<string[]>([]);
  const [destroyCount, setDestroyCount] = useState(0);
  const [effectMsg, setEffectMsg] = useState<{ ability: Ability; msg: string } | null>(null);
  const freezeUntilRef = useRef(0);

  const wordsRef = useRef<FallingWord[]>([]);
  const animFrameRef = useRef<number>(0);
  const nextIdRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const scoreRef = useRef(0);
  const startedAtRef = useRef(0);
  const levelRef = useRef(1);
  const comboRef = useRef(0);
  const phRef = useRef(10.0);
  const killRef = useRef(0);
  const attemptsRef = useRef(0); // 입력 시도 횟수 — 정확도 산출용(맞힌 수 = killRef)
  const starsRef = useRef<Star[]>([]);
  const particlesRef = useRef(new ParticleSystem());
  const shakeRef = useRef(new ScreenShake());
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 격파·피격·능력·레벨업
  const isKorean = settings.language === 'ko';

  // 네오/사이버펑크 배경 씬(AI 생성). 로드 전에는 절차적 그라데이션으로 폴백한다.
  useEffect(() => {
    const img = new Image();
    img.src = '/game/rain/bg.webp';
    img.onload = () => { bgImageRef.current = img; };
  }, []);

  // 반응(주스) 인스턴스 — burst는 이 게임의 파티클(캔버스 로컬 좌표)로, sfx는 기존 soundManager로 연결한다.
  useEffect(() => {
    juiceRef.current = createGameJuice({
      soundManager,
      burst: (o: { x: number; y: number; big?: number }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        particlesRef.current.explode(o.x - rect.left, o.y - rect.top, (o.big ?? 1) * 0.7);
      },
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
          setWordPool([...new Set([...mod.koreanWordsBeginner, ...mod2.koreanWordsIntermediate, ...words])]);
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

  useEffect(() => {
    if (level > 1) {
      const newWords = wordGenerator.getWords({
        language: settings.language, difficulty: Math.min(10, level), count: 100,
        minLength: settings.language === 'ko' ? 2 : 3,
      });
      setWordPool(prev => [...new Set([...prev, ...newWords])]);
    }
  }, [level, settings.language]);

  useEffect(() => {
    if (status === 'gameover' && scoreRef.current > 0) {
      void submitGameScore('rain', scoreRef.current, Date.now() - startedAtRef.current, settings.language);
    }
  }, [status, settings.language]);

  // 일일 퀘스트·도전과제에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  useGameResult(status === 'gameover', () =>
    attemptsRef.current === 0 && scoreRef.current === 0
      ? null
      : {
          gameType: 'rain',
          score: scoreRef.current,
          level: levelRef.current,
          maxCombo,
          accuracy: hitAccuracy(killRef.current, attemptsRef.current),
          wordsTyped: killRef.current,
          elapsedTime: Math.round((Date.now() - startedAtRef.current) / 1000),
        }
  );

  const startGame = () => {
    setStatus('countdown');
    startedAtRef.current = Date.now();
    setScore(0); setLevel(1); setCombo(0); setMaxCombo(0); setPh(10.0);
    setInput(''); setDestroyCount(0);
    wordsRef.current = []; nextIdRef.current = 0; lastSpawnRef.current = 0;
    scoreRef.current = 0; levelRef.current = 1; comboRef.current = 0; phRef.current = 10.0;
    killRef.current = 0; attemptsRef.current = 0;
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

    if (starsRef.current.length === 0) starsRef.current = createStarfield(60, W, H);

    const loop = (time: number) => {
      const currentLevel = levelRef.current;
      const shakeOffset = shake.update();

      ctx.save();
      ctx.translate(shakeOffset.x, shakeOffset.y);

      // Background — AI 생성 사이버펑크 씬(cover-fit). 로드 전에는 그라데이션 폴백.
      const bg = bgImageRef.current;
      if (bg && bg.width > 0) {
        const scale = Math.max(W / bg.width, H / bg.height);
        const dw = bg.width * scale;
        const dh = bg.height * scale;
        ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
        // 낙하 단어·HUD 가독성을 위한 어두운 오버레이(상단은 살짝, 하단은 더 진하게)
        const readGrad = ctx.createLinearGradient(0, 0, 0, H);
        readGrad.addColorStop(0, 'rgba(6,4,20,0.32)');
        readGrad.addColorStop(0.55, 'rgba(6,4,20,0.12)');
        readGrad.addColorStop(1, 'rgba(6,4,20,0.45)');
        ctx.fillStyle = readGrad;
        ctx.fillRect(0, 0, W, H);
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#030310');
        grad.addColorStop(0.3, '#0A0820');
        grad.addColorStop(0.6, '#120E30');
        grad.addColorStop(0.8, '#1A1545');
        grad.addColorStop(1, '#0D0B25');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        // 별·구름은 폴백 배경에서만(AI 씬에는 이미 도시 불빛·구름이 있어 겹치면 탁해짐)
        drawStarfield(ctx, starsRef.current, time, 0.005);
        ctx.save();
        for (let layer = 0; layer < 3; layer++) {
          const speed = 0.008 + layer * 0.005;
          const opacity = 0.15 + layer * 0.1;
          const yBase = -20 + layer * 25;
          for (let i = 0; i < 6; i++) {
            const cx = (i * 180 + time * speed + layer * 100) % (W + 300) - 150;
            const cloudGrad = ctx.createRadialGradient(cx, yBase, 10, cx, yBase, 100 + layer * 30);
            cloudGrad.addColorStop(0, `rgba(40,30,80,${opacity})`);
            cloudGrad.addColorStop(0.6, `rgba(25,20,50,${opacity * 0.5})`);
            cloudGrad.addColorStop(1, 'transparent');
            ctx.fillStyle = cloudGrad;
            ctx.beginPath();
            ctx.ellipse(cx, yBase, 130 + layer * 20, 35 + layer * 10, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      // Lightning effect (dramatic fork)
      if (currentLevel > 3 && Math.random() < 0.004) {
        ctx.save();
        // Screen flash
        ctx.fillStyle = 'rgba(180,170,255,0.12)';
        ctx.fillRect(0, 0, W, H);
        // Lightning bolt
        ctx.strokeStyle = 'rgba(200,200,255,0.8)';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#A29BFE';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        let lx = W * 0.3 + Math.random() * W * 0.4;
        let ly = 0;
        ctx.moveTo(lx, ly);
        for (let s = 0; s < 6; s++) {
          lx += (Math.random() - 0.5) * 40;
          ly += H * 0.12 + Math.random() * H * 0.05;
          ctx.lineTo(lx, ly);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // Enhanced rain (dense, angled, variable)
      ctx.save();
      const rainIntensity = Math.min(3, 0.5 + currentLevel * 0.3);
      const rainCount = Math.floor(50 * rainIntensity);
      ctx.strokeStyle = 'rgba(120,100,220,0.2)';
      ctx.lineWidth = 1;
      for (let i = 0; i < rainCount; i++) {
        const rx = (i * 47 + time * 0.2) % (W + 40) - 20;
        const ry = (i * 97 + time * 0.6) % (H + 20) - 10;
        const len = 10 + Math.sin(i * 0.7) * 5;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 1.5, ry + len);
        ctx.stroke();
      }
      // Heavier rain drops
      ctx.strokeStyle = 'rgba(140,120,240,0.12)';
      ctx.lineWidth = 2;
      for (let i = 0; i < Math.floor(rainCount * 0.3); i++) {
        const rx = (i * 131 + time * 0.15) % W;
        const ry = (i * 211 + time * 0.5) % H;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 2, ry + 14);
        ctx.stroke();
      }
      ctx.restore();

      // Spawn word — nudge one out quickly if the screen is empty
      const rSpawnInterval = wordsRef.current.length < 1 ? 500 : Math.max(1000 - currentLevel * 50, 400);
      if (time - lastSpawnRef.current > rSpawnInterval && wordsRef.current.length < Math.min(3 + currentLevel, 10)) {
        lastSpawnRef.current = time;
        // 특수단어: 레벨 2+부터 화면당 1개, 더 긴(어려운) 단어를 골라 능력을 부여한다.
        const makeSpecial = currentLevel >= 2 && !wordsRef.current.some(w => w.special) && Math.random() < 0.14;
        const wordFloor = makeSpecial
          ? (isKorean ? 4 : 7)
          : (isKorean ? Math.min(2 + Math.floor(currentLevel / 4), 4) : Math.min(3 + Math.floor(currentLevel / 3), 8));
        const text = wordGenerator.getUniqueWord(wordPool, wordFloor) || (isKorean ? '단어' : 'word');
        const ability = makeSpecial ? ABILITIES[Math.floor(Math.random() * ABILITIES.length)] : undefined;
        wordsRef.current.push({
          id: nextIdRef.current++,
          text,
          x: randomBetween(60, W - 60),
          y: -30,
          // 특수단어는 조금 느리게 떨어져 입력할 시간을 준다.
          speed: (makeSpecial ? 0.18 : 0.25) + currentLevel * (makeSpecial ? 0.03 : 0.06) + Math.random() * 0.15,
          color: makeSpecial ? '#FECA57' : pickRandom(COLORS),
          rotation: (Math.random() - 0.5) * 0.02,
          glowPhase: Math.random() * Math.PI * 2,
          special: makeSpecial,
          ability,
        });
      }

      // Update & draw words — 그리기는 겹침 해소(resolveLabels) 뒤에 한다.
      const frozen = time < freezeUntilRef.current;
      const alive: FallingWord[] = [];
      const labels: (LabelRequest & { word: FallingWord; fs: number })[] = [];
      for (const word of wordsRef.current) {
        if (!frozen) word.y += word.speed;

        // Ground hit
        if (word.y > H - 50) {
          phRef.current -= PH_DAMAGE_PER_MISS;
          setPh(phRef.current);
          shake.shake(3);
          // Splash effect — 겹침을 피해 옆으로 비켜 놓은 자리에서 터져야 한다
          // (원본 word.x를 쓰면 눈에 보이던 물방울과 최대 120px 어긋난다).
          particles.emit(word.x + (word.labelShift ?? 0), H - 40, 10, {
            speed: 2, life: 20, size: 3,
            colors: [word.color, '#FF6B6B'],
            spread: Math.PI, angle: -Math.PI / 2,
          });
          {
            const rect = canvas.getBoundingClientRect();
            juiceRef.current?.fire('miss', { x: rect.left + word.x, y: rect.top + (H - 40), color: '#FF6B6B' });
          }
          if (phRef.current <= 0) {
            setStatus('gameover');
            cancelAnimationFrame(animFrameRef.current);
            soundManager?.play('gameOver');
            ctx.restore();
            return;
          }
          continue;
        }

        labels.push({
          word,
          fs: word.special ? 17 : 15,
          x: word.x,
          w: wordBubbleWidth(ctx, word.text, word.special ? 17 : 15),
          h: wordBubbleHeight(word.special ? 17 : 15),
          homeY: word.y,
          // 화면 안쪽으로 비켜야 잘리지 않는다.
          dir: word.x > W / 2 ? -1 : 1,
          y: 0, offset: 0, prefer: word.labelShift,
        });
        alive.push(word);
      }
      wordsRef.current = alive;

      // 겹친 단어는 둘 다 못 읽어서 칠 수가 없다(실측: 두 단어가 77% 겹침).
      // y는 낙하 높이 = 게임 상태라 건드리면 안 되므로 가로로만 비켜 놓는다.
      resolveLabels(labels, [], { canvasH: H, canvasW: W, axis: 'x', maxShift: 60, pad: 4 });

      for (const L of labels) {
        const word = L.word;
        word.labelShift = easeLabelShift(word.labelShift, L.offset);
        const wx = word.x + word.labelShift;

        // Draw word with glowing droplet style
        const glow = 0.5 + Math.sin(time * 0.003 + word.glowPhase) * 0.3;
        ctx.save();
        ctx.translate(wx, word.y);
        ctx.rotate(Math.sin(time * 0.001 + word.id) * word.rotation);

        // Neon droplet shape
        ctx.beginPath();
        ctx.moveTo(0, -22);
        ctx.bezierCurveTo(-12, -8, -10, 6, 0, 10);
        ctx.bezierCurveTo(10, 6, 12, -8, 0, -22);
        ctx.closePath();
        // Droplet glow
        ctx.shadowColor = word.color;
        ctx.shadowBlur = 8 + glow * 6;
        ctx.fillStyle = `rgba(108,92,231,${0.08 + glow * 0.06})`;
        ctx.fill();
        ctx.shadowBlur = 0;
        // Droplet outline
        ctx.strokeStyle = `${word.color}44`;
        ctx.lineWidth = 1;
        ctx.stroke();
        // Droplet highlight
        ctx.beginPath();
        ctx.ellipse(-3, -10, 2.5, 5, -0.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.06 + glow * 0.04})`;
        ctx.fill();

        ctx.restore();

        // 특수단어: 금빛 후광 링 + 능력 아이콘/라벨을 단어 위에 표시
        if (word.special && word.ability) {
          const meta = ABILITY_META[word.ability];
          ctx.save();
          const pulse = 0.6 + Math.sin(time * 0.006 + word.id) * 0.4;
          ctx.strokeStyle = `rgba(254,202,87,${0.35 + pulse * 0.4})`;
          ctx.lineWidth = 2;
          ctx.shadowColor = '#FECA57';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.ellipse(wx, word.y, 44, 20, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.font = "bold 10px 'Noto Sans KR', sans-serif";
          ctx.fillStyle = meta.color;
          ctx.textAlign = 'center';
          ctx.fillText(meta.label, wx, word.y - 26);
          drawVectorIcon(ctx, meta.iconPaths, wx - ctx.measureText(meta.label).width / 2 - 9, word.y - 30, 12, meta.color);
          ctx.restore();
        }

        drawWordBubble(ctx, wx, word.y, word.text, word.color, { fontSize: L.fs });
      }

      // 일시정지(freeze) 발동 중 화면 얼음 오버레이
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

      // Particles
      particles.update();
      particles.draw(ctx);

      // Enhanced water surface
      const waterGrad = ctx.createLinearGradient(0, H - 55, 0, H);
      waterGrad.addColorStop(0, 'rgba(108,92,231,0.02)');
      waterGrad.addColorStop(0.3, 'rgba(80,60,200,0.12)');
      waterGrad.addColorStop(0.7, 'rgba(60,40,180,0.2)');
      waterGrad.addColorStop(1, 'rgba(40,25,140,0.35)');
      ctx.fillStyle = waterGrad;
      ctx.fillRect(0, H - 55, W, 55);

      // Animated waves
      ctx.save();
      ctx.strokeStyle = 'rgba(120,100,231,0.15)';
      ctx.lineWidth = 1.5;
      for (let wave = 0; wave < 3; wave++) {
        const waveY = H - 50 + wave * 8;
        ctx.beginPath();
        for (let wx = 0; wx <= W; wx += 4) {
          const wy = waveY + Math.sin(wx * 0.02 + time * 0.002 + wave * 1.5) * 3;
          if (wx === 0) ctx.moveTo(wx, wy);
          else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }
      ctx.restore();

      // Water ripples (impact rings)
      ctx.save();
      for (let i = 0; i < 12; i++) {
        const rx = (i * 95 + time * 0.04) % W;
        const ripplePhase = (time * 0.003 + i * 1.2) % (Math.PI * 2);
        // ⚠️ sin이 음수일 때 rippleSize가 음수가 되면 ctx.ellipse가 IndexSizeError를
        //    던져 렌더 루프 전체가 죽는다(단어·HUD가 안 그려짐). 반드시 0 이상으로 clamp.
        const rippleSize = Math.max(0, 8 + Math.sin(ripplePhase) * 12);
        const rippleAlpha = Math.max(0, 0.12 - rippleSize * 0.004);
        ctx.strokeStyle = `rgba(140,120,240,${rippleAlpha})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(rx, H - 42 + Math.sin(i) * 4, rippleSize, rippleSize * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Water surface highlight
      ctx.save();
      const surfGlow = ctx.createLinearGradient(0, H - 52, 0, H - 48);
      surfGlow.addColorStop(0, 'transparent');
      surfGlow.addColorStop(0.5, 'rgba(160,140,255,0.08)');
      surfGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = surfGlow;
      ctx.fillRect(0, H - 52, W, 4);
      ctx.restore();

      // pH bar
      const phVal = phRef.current;
      drawShieldBar(ctx, 20, H - 28, phVal, 10, W - 40);
      ctx.font = "bold 11px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#E8E8FF';
      ctx.textAlign = 'center';
      ctx.fillText(`pH ${phVal.toFixed(1)}`, W / 2, H - 14);

      // HUD
      ctx.font = "bold 18px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#E8E8FF';
      ctx.textAlign = 'left';
      ctx.fillText(`${scoreRef.current}`, 20, 28);
      ctx.font = "9px 'Noto Sans KR', sans-serif";
      ctx.fillStyle = 'rgba(232,232,255,0.4)';
      ctx.fillText('SCORE', 20, 14);

      ctx.font = "bold 16px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#A29BFE';
      ctx.textAlign = 'center';
      ctx.fillText(`LEVEL ${levelRef.current}`, W / 2, 28);

      if (comboRef.current > 1) {
        ctx.font = "bold 14px 'JetBrains Mono', monospace";
        ctx.fillStyle = '#FD79A8';
        ctx.textAlign = 'right';
        ctx.fillText(`${comboRef.current}x COMBO`, W - 20, 28);
      }

      ctx.restore();
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [status, wordPool, isKorean]);

  const flashEffect = (ability: Ability, msg: string) => {
    setEffectMsg({ ability, msg });
    setTimeout(() => setEffectMsg(null), 2200);
  };

  /** 특수단어를 맞혔을 때 능력 발동. */
  const triggerAbility = (ability: Ability) => {
    const meta = ABILITY_META[ability];
    if (ability === 'freeze') {
      freezeUntilRef.current = performance.now() + FREEZE_MS;
    } else if (ability === 'clear') {
      // 화면의 모든 단어를 정화 — 각 단어 폭발 + 보너스 점수
      for (const w of wordsRef.current) {
        particlesRef.current.explode(w.x + (w.labelShift ?? 0), w.y, 0.5);
        scoreRef.current += 20;
      }
      wordsRef.current = [];
      setScore(scoreRef.current);
    } else if (ability === 'heal') {
      phRef.current = Math.min(10, phRef.current + 2);
      setPh(phRef.current);
    }
    juiceRef.current?.fire('special', { title: `${meta.label}!`, color: meta.color, vib: [25, 30, 25] });
    flashEffect(ability, `${meta.label} 발동!`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    attemptsRef.current += 1;
    const idx = wordsRef.current.findIndex(w => w.text === input.trim());
    if (idx >= 0) {
      const word = wordsRef.current[idx];
      wordsRef.current.splice(idx, 1);
      // 특수단어는 2배 점수 + 능력 발동
      const points = input.length * 10 * (word.special ? 2 : 1);
      scoreRef.current += points;
      if (word.special && word.ability) triggerAbility(word.ability);
      setScore(scoreRef.current);
      comboRef.current += 1;
      setCombo(comboRef.current);
      setMaxCombo(m => Math.max(m, comboRef.current));
      killRef.current += 1;
      setDestroyCount(killRef.current);
      {
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        const wx = word.x + (word.labelShift ?? 0);
        juiceRef.current?.fire('hit', {
          x: rect ? rect.left + wx : undefined,
          y: rect ? rect.top + word.y : undefined,
          n: points,
          text: `+${points}`,
          color: word.color,
          big: word.special ? 1.3 : 1,
        });
      }
      if (killRef.current % 15 === 0) {
        levelRef.current += 1;
        setLevel(levelRef.current);
        juiceRef.current?.fire('levelup', { title: `LEVEL ${levelRef.current}!`, color: '#A29BFE' });
      }
    } else {
      comboRef.current = 0;
      setCombo(0);
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
            <line x1="20" y1="10" x2="18" y2="30" stroke="#6C5CE7" strokeWidth="2" opacity="0.6"/>
            <line x1="40" y1="5" x2="38" y2="25" stroke="#A29BFE" strokeWidth="2" opacity="0.5"/>
            <line x1="60" y1="12" x2="58" y2="32" stroke="#6C5CE7" strokeWidth="2" opacity="0.7"/>
            <line x1="30" y1="20" x2="28" y2="40" stroke="#A29BFE" strokeWidth="1.5" opacity="0.4"/>
            <line x1="50" y1="18" x2="48" y2="38" stroke="#6C5CE7" strokeWidth="1.5" opacity="0.5"/>
            <rect x="18" y="42" width="44" height="22" rx="5" fill="#1A1A4E" stroke="#6C5CE7" strokeWidth="1.5"/>
            <text x="40" y="57" textAnchor="middle" fill="#00D2D3" fontSize="12" fontFamily="monospace" fontWeight="bold">ABC</text>
            <line x1="35" y1="64" x2="33" y2="72" stroke="rgba(108,92,231,0.3)" strokeWidth="6" strokeLinecap="round"/>
          </svg>
        </div>
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>
          {isKorean ? '산성비' : 'Acid Rain'}
        </h1>
        <p className="mb-3" style={{ color: 'var(--text-secondary)' }}>
          {isKorean ? '떨어지는 단어를 입력해서 제거하세요!' : 'Type falling words before they hit the ground!'}
        </p>
        {isKorean && (
          <p className="mb-6 text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            ✨ 금빛으로 빛나는 <b style={{ color: '#FECA57' }}>특수단어</b>를 맞히면 특수 능력이 발동돼요 —
            ❄️ 일시정지 · 💥 전체 정화 · 💧 pH 회복 (점수도 2배!)
          </p>
        )}
        <Button size="lg" onClick={() => schoolGate(startGame)}>{isKorean ? '게임 시작' : 'Start Game'}</Button>
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
        <h1 className="text-3xl font-bold mb-4" style={{ fontFamily: "'Outfit'", color: 'var(--color-error)' }}>
          {isKorean ? '게임 오버' : 'Game Over'}
        </h1>
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
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{isKorean ? '격파' : 'CLEARED'}</div>
            <div className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: '#00B894' }}>{destroyCount}</div>
          </Card>
        </div>
        <Button size="lg" onClick={() => schoolGate(startGame)}>{isKorean ? '다시 시작' : 'Retry'}</Button>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-4 py-4">
      <div className="relative rounded-xl overflow-hidden border border-[var(--key-border)]" style={{ background: 'var(--bg-card)', height: '500px' }}>
        <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
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
}
