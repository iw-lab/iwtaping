'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { soundManager } from '@/lib/sound/sound-manager';
import { Link2, Timer, Heart, CalendarDays } from 'lucide-react';
import { useGameBgm } from '@/hooks/useGameBgm';
import { schoolGate } from '@/lib/gb/school';
import { useGameResult, hitAccuracy } from '@/hooks/useGameResult';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { wordGenerator } from '@/lib/content/word-generator';
import { submitGameScore } from '@/lib/api/client';
import { createGameJuice } from '@/lib/game/juice-table';
import {
  PuzzleCore, seededRng, seedFromString, SURVIVAL_LIVES,
  type InvalidReason, type PuzzleEvent, type ChainEntry,
} from '@/lib/game/puzzle/core';
import type { PuzzleScene } from '@/lib/game3d/puzzle-scene';
import { ModePicker, useGameMode, saveBest, todayKey, type ModeInfo } from '@/components/game/ModePicker';
import { FullscreenButton } from '@/components/game/FullscreenButton';

const GAME_ID = 'puzzle';
const PUZZLE_MODES: ModeInfo[] = [
  { id: 'classic', label: '기본', desc: '시간 보너스로 계속 잇기', icon: Link2 },
  { id: 'time', label: '60초', desc: '1분 동안 최대 점수', icon: Timer },
  { id: 'survival', label: '목숨 3개', desc: '놓치면 하트 하나 · 점점 빨라져요', icon: Heart },
  { id: 'daily', label: '오늘의 판', desc: '오늘은 모두 같은 상대 단어', icon: CalendarDays },
];

/** 3D 판을 쓸 수 있나 — WebGL2 가 있고 «가벼운 화면»을 고르지 않았을 때(없으면 지금 DOM 카드만의 판 그대로) */
function want3d(): boolean {
  try {
    if (localStorage.getItem('typingverse:lite') === '1') return false;
    if (new URLSearchParams(location.search).get('lite') === '1') return false;
    return !!document.createElement('canvas').getContext('webgl2');
  } catch { return false; }
}

function getLastChar(word: string, isKorean: boolean): string {
  if (!word) return '';
  return isKorean ? word[word.length - 1] : word[word.length - 1].toLowerCase();
}

function invalidMessage(reason: InvalidReason, lastChar: string, isKorean: boolean): string {
  switch (reason) {
    case 'bad-start':
      return isKorean ? `'${lastChar}'(으)로 시작하는 단어를 입력하세요!` : `Word must start with '${lastChar.toUpperCase()}'!`;
    case 'used':
      return isKorean ? '이미 사용한 단어입니다!' : 'Word already used!';
    case 'too-short':
      return isKorean ? '2글자 이상 입력하세요!' : 'Word must be at least 2 letters!';
    case 'malformed':
      return isKorean ? '완성된 한글 단어만 입력하세요!' : 'Letters only!';
    case 'not-in-dict':
      return isKorean ? '사전에 없는 단어입니다!' : 'Not in the dictionary!';
    default:
      return '';
  }
}

export default function PuzzleGamePage() {
  const { settings } = useSettingsStore();
  const [status, setStatus] = useState<'menu' | 'playing' | 'gameover'>('menu');
  useGameBgm('focus', status === 'playing');
  const [mode, setMode] = useGameMode(GAME_ID);
  const [is3d, setIs3d] = useState(false);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chainEndRef = useRef<HTMLDivElement>(null);

  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [level, setLevel] = useState(1);
  const [lives, setLives] = useState(SURVIVAL_LIVES);
  const [chain, setChain] = useState<ChainEntry[]>([]);
  const [currentWord, setCurrentWord] = useState('');
  const [input, setInput] = useState('');
  const [turnLeft, setTurnLeft] = useState(16);
  const [sessionLeft, setSessionLeft] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [bonusMsg, setBonusMsg] = useState('');
  const [newBest, setNewBest] = useState(false);
  const [wordPool, setWordPool] = useState<string[]>([]);
  const [validWords, setValidWords] = useState<Set<string>>(new Set());

  const coreRef = useRef<PuzzleCore | null>(null);
  const sceneRef = useRef<PuzzleScene | null>(null);
  const animFrameRef = useRef<number>(0);
  const startedAtRef = useRef(0);
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null);
  const isKorean = settings.language === 'ko';

  useEffect(() => { setIs3d(want3d()); }, []);

  // 반응(주스) — 3D 판은 hit() 안에서 찌그러짐·튕김·번쩍·줌 펀치를 다 그린다(squash 로 블록을 놓는다).
  // DOM 카드만의 판(lite)은 그릴 곳이 없어 비워 둔다(캔버스가 없어 2D 화면 흔들기도 생략).
  useEffect(() => {
    juiceRef.current = createGameJuice({
      soundManager,
      punch: { hit: '#puzzle-score' },
      kick: () => { /* 3D: hit() 안에서 카메라 줌 펀치로 처리 · lite 는 캔버스가 없어 생략 */ },
      squash: () => { sceneRef.current?.hit(); },
      knock: () => { /* 3D: hit() 안에서 블록이 떨어져 꽂히는 동작에 포함 */ },
      hitflash: () => { /* 3D: hit() 안에서 블록이 하얗게 번쩍인다(instanceColor) */ },
      haptics: () => settings.sfx,
    });
    return () => juiceRef.current?.destroy();
  }, [settings.sfx]);

  // 게임 종료 시 서버 순위 제출(계정 없으면 무시) + 모드별 최고 기록
  useEffect(() => {
    const c = coreRef.current;
    if (status === 'gameover' && c && c.score > 0) {
      void submitGameScore('puzzle', c.score, Date.now() - startedAtRef.current, settings.language);
      setNewBest(saveBest(GAME_ID, mode, c.score));
    }
  }, [status, settings.language, mode]);

  // 일일 퀘스트·도전과제에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  useGameResult(status === 'gameover', () => {
    const c = coreRef.current;
    if (!c || (c.attempts === 0 && c.score === 0)) return null;
    return {
      gameType: 'puzzle',
      score: c.score,
      level: c.level,
      maxCombo: c.maxCombo,
      accuracy: hitAccuracy(c.totalWords, c.attempts),
      wordsTyped: c.totalWords,
      elapsedTime: Math.round((Date.now() - startedAtRef.current) / 1000),
    };
  });

  // 대용량 실단어 사전 불러오기(기존 그대로 — 초·중·고급 통합, AI 풀은 고급 제외)
  useEffect(() => {
    wordGenerator.reset();
    const extraWords = wordGenerator.getWords({ language: settings.language, difficulty: 5, count: 500, minLength: 2 });
    (async () => {
      try {
        if (isKorean) {
          const m1 = await import('@/data/korean/words-beginner');
          const m2 = await import('@/data/korean/words-intermediate');
          const m3 = await import('@/data/korean/words-advanced');
          const md = await import('@/data/korean/words-dictionary');
          const pool = [...new Set([...md.koreanDictionary, ...m1.koreanWordsBeginner, ...m2.koreanWordsIntermediate])].filter((w) => w.length >= 2);
          const dict = new Set<string>([...pool, ...m3.koreanWordsAdvanced].filter((w) => w.length >= 2));
          setWordPool(pool);
          setValidWords(dict);
        } else {
          const m1 = await import('@/data/english/words-common200');
          const m2 = await import('@/data/english/words-common1000');
          const m3 = await import('@/data/english/words-advanced');
          const pool = [...new Set([...m1.englishCommon200, ...m2.englishCommon1000, ...extraWords])].filter((w) => w.length >= 3);
          const dict = new Set<string>([...pool, ...m3.englishWordsAdvanced].map((w) => w.toLowerCase()).filter((w) => w.length >= 3));
          setWordPool(pool);
          setValidWords(dict);
        }
      } catch {
        const fb = extraWords.length > 0 ? extraWords :
          (isKorean
            ? ['사과', '과일', '일출', '출발', '발자국', '국어', '어머니', '니트', '트럭', '럭비']
            : ['apple', 'elephant', 'tiger', 'rabbit', 'turtle', 'eagle', 'eel', 'lion', 'newt']);
        setWordPool(fb);
        setValidWords(new Set(fb.map((w) => (isKorean ? w : w.toLowerCase()))));
      }
    })();
  }, [isKorean, settings.language]);

  const startGame = () => {
    setStatus('playing');
    startedAtRef.current = Date.now();
    setScore(0); setCombo(0); setMaxCombo(0); setTotalWords(0); setLevel(1); setLives(SURVIVAL_LIVES);
    setChain([]); setCurrentWord(''); setInput(''); setMessage(''); setBonusMsg(''); setNewBest(false);
    setTurnLeft(16); setSessionLeft(mode === 'time' ? 60 : null);
    coreRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  /** 코어가 낸 사건 → 소리·화면 반응·3D 장면(화면 입력으로만 판정이 바뀐다 — 렌더는 구경만 한다). */
  const handleEvents = useCallback((events: PuzzleEvent[]) => {
    const core = coreRef.current;
    if (!core) return;
    for (const e of events) {
      if (e.type === 'start') {
        setChain([{ word: e.word, isPlayer: false }]);
        setCurrentWord(e.word);
      } else if (e.type === 'hit') {
        setChain((prev) => [...prev, { word: e.word, isPlayer: e.isPlayer }]);
        setCurrentWord(e.word);
        setScore(core.score);
        setTotalWords(core.totalWords);
        setMaxCombo(core.maxCombo);
        if (e.isPlayer) {
          setCombo(core.combo);
          setMessage('');
          juiceRef.current?.fire('hit', { n: e.points, text: `+${e.points}` });
        } else {
          sceneRef.current?.hit();
        }
      } else if (e.type === 'bonus') {
        setScore(core.score);
        setBonusMsg(isKorean ? '상대가 단어를 못 찾았습니다! +100점 보너스!' : "Opponent can't find a word! +100 bonus!");
        juiceRef.current?.fire('special', { title: isKorean ? '+100 보너스!' : '+100 Bonus!', color: '#FECA57', vib: [25, 30, 25] });
        setTimeout(() => setBonusMsg(''), 2200);
      } else if (e.type === 'round') {
        setChain((prev) => [...prev, { word: e.word, isPlayer: false }]);
        setCurrentWord(e.word);
        sceneRef.current?.hit();
      } else if (e.type === 'invalid') {
        setMessage(invalidMessage(e.reason, getLastChar(core.currentWord, isKorean), isKorean));
        setCombo(core.combo);
        juiceRef.current?.fire('miss');
      } else if (e.type === 'miss') {
        setLives(core.lives);
        sceneRef.current?.fail();
        juiceRef.current?.fire('miss');
      } else if (e.type === 'levelup') {
        setLevel(e.level);
        juiceRef.current?.fire('levelup', { title: `LEVEL ${e.level}!`, color: '#A29BFE' });
      } else if (e.type === 'gameover') {
        setStatus('gameover');
        soundManager?.play('gameOver');
      }
    }
  }, [isKorean]);

  // 게임 루프 — 코어는 화면 픽셀/시간 그대로 받아 판정하고, 렌더(3D 장면)는 구경만 한다(GDD-3D §8 A).
  useEffect(() => {
    if (status !== 'playing' || wordPool.length === 0) return;
    const daily = mode === 'daily';
    const rng = daily ? seededRng(seedFromString(`puzzle:${todayKey()}:${settings.language}`)) : Math.random;
    const core = new PuzzleCore({ isKorean, rng, wordPool, validWords, mode });
    coreRef.current = core;
    (window as unknown as { __puzzle?: unknown }).__puzzle = { core, scene: () => sceneRef.current, wordPool, validWords };

    let alive = true;
    if (is3d && canvas3dRef.current) {
      const c3 = canvas3dRef.current;
      const W = c3.clientWidth || 640;
      const H = c3.clientHeight || 300;
      import('@/lib/game3d/puzzle-scene').then((m) => {
        if (!alive) return;
        try { sceneRef.current = m.createPuzzleScene(c3, W, H); } catch { sceneRef.current = null; setIs3d(false); }
      }).catch(() => setIs3d(false));
    }

    let lastDisplay = 0;
    const loop = (time: number) => {
      const events = core.tick(time);
      if (events.length) handleEvents(events);
      if (!core.over) {
        if (time - lastDisplay > 180) {
          lastDisplay = time;
          setTurnLeft(core.turnSeconds(time));
          const rem = core.sessionRemaining(time);
          if (rem !== null) setSessionLeft(Math.ceil(rem / 1000));
        }
        sceneRef.current?.render(time);
        animFrameRef.current = requestAnimationFrame(loop);
      }
    };
    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(animFrameRef.current);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, wordPool, validWords, isKorean, is3d, mode]);

  // Scroll to bottom of chain
  useEffect(() => {
    chainEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chain]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const core = coreRef.current;
    if (!input.trim() || !core) return;
    handleEvents(core.submit(input, performance.now()));
    setInput('');
  };

  const lastChar = currentWord ? getLastChar(currentWord, isKorean) : '';

  if (status === 'menu') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <div className="flex justify-end mb-2"><FullscreenButton /></div>
        <div className="flex justify-center mb-4"><Link2 className="w-14 h-14" style={{ color: '#FD79A8' }} /></div>
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>
          {isKorean ? '끝말잇기' : 'Word Chain'}
        </h1>
        <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
          {isKorean
            ? '상대 단어의 마지막 글자로 시작하는 단어를 이어가세요!'
            : 'Type a word starting with the last letter of the previous word!'}
        </p>
        <div className="max-w-md mx-auto mb-6 text-left">
          <Card className="p-4">
            <h3 className="font-bold mb-2" style={{ color: 'var(--color-primary)' }}>
              {isKorean ? '게임 규칙' : 'Rules'}
            </h3>
            <ul className="text-sm space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>{isKorean ? '• 상대 단어의 마지막 글자로 시작하는 단어 입력' : '• Type a word starting with the last letter'}</li>
              <li>{isKorean ? '• 이미 사용한 단어는 사용 불가' : '• No repeating words'}</li>
              <li>{isKorean ? '• 정답 시 시간 +4초 보너스' : '• Correct answer gives +4 seconds'}</li>
              <li>{isKorean ? '• 연속 정답으로 콤보 보너스 점수!' : '• Chain combos for bonus points!'}</li>
            </ul>
          </Card>
        </div>
        <ModePicker game={GAME_ID} value={mode} onChange={setMode} modes={PUZZLE_MODES} />
        <Button size="lg" onClick={() => schoolGate(startGame)}>
          {isKorean ? '게임 시작' : 'Start Game'}
        </Button>
        <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {is3d ? '3D 화면' : '가벼운 화면'}
        </p>
      </div>
    );
  }

  if (status === 'gameover') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit'", color: 'var(--color-error)' }}>
          {isKorean ? '시간 종료!' : 'Time\'s Up!'}
        </h1>
        {newBest && <p className="mb-4 font-bold" style={{ color: '#FECA57' }}>{isKorean ? '새 최고 기록!' : 'New best!'}</p>}
        <div className="grid grid-cols-3 gap-4 max-w-md mx-auto mb-6">
          <Card className="p-4">
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{isKorean ? '점수' : 'Score'}</div>
            <div className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-primary)' }}>{score}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{isKorean ? '단어 수' : 'Words'}</div>
            <div className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-secondary)' }}>{totalWords}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{isKorean ? '최대 콤보' : 'Max Combo'}</div>
            <div className="text-2xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-combo)' }}>{maxCombo}</div>
          </Card>
        </div>
        <div className="max-w-md mx-auto mb-6">
          <Card className="p-3">
            <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{isKorean ? '단어 체인' : 'Word Chain'}</div>
            <div className="flex flex-wrap gap-1">
              {chain.map((entry, i) => (
                <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{
                  background: entry.isPlayer ? 'rgba(108,92,231,0.3)' : 'rgba(0,210,211,0.2)',
                  color: entry.isPlayer ? 'var(--color-primary-light)' : 'var(--color-secondary)',
                }}>
                  {entry.word}
                </span>
              ))}
            </div>
          </Card>
        </div>
        <Button size="lg" onClick={() => schoolGate(startGame)}>{isKorean ? '다시 도전' : 'Play Again'}</Button>
        <div className="mt-3"><Button variant="ghost" onClick={() => setStatus('menu')}>{isKorean ? '모드 바꾸기' : 'Change mode'}</Button></div>
      </div>
    );
  }

  return (
    <div className="max-w-[600px] mx-auto px-4 py-5">
      {/* 3D 장면 — 공중 블록 섬. 입력 중엔 카메라가 고정이고, 단어를 완성한 직후에만 살짝 이동한다. */}
      <div ref={stageRef} className="relative rounded-xl overflow-hidden border mb-4" style={{ borderColor: 'rgba(108,92,231,0.28)', height: '220px', background: '#5a7fd6' }} data-render={is3d ? '3d' : '2d'}>
        {is3d && <canvas ref={canvas3dRef} className="absolute inset-0 w-full h-full" style={{ display: 'block' }} aria-hidden />}
        <div className="absolute top-2 right-2"><FullscreenButton /></div>
        {bonusMsg && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-sm font-bold pointer-events-none"
            style={{ background: 'rgba(254,202,87,0.92)', color: '#3A2A00', boxShadow: '0 4px 16px rgba(254,202,87,0.4)' }}>
            {bonusMsg}
          </div>
        )}
      </div>

      <div
        className="rounded-2xl p-5"
        style={{ background: 'rgba(9,7,22,0.88)', border: '1px solid rgba(108,92,231,0.28)' }}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{isKorean ? '점수' : 'Score'} </span>
            <span id="puzzle-score" className="text-xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-primary)' }}>{score}</span>
            {combo > 1 && (
              <span className="ml-2 text-sm font-bold" style={{ color: 'var(--color-combo)' }}>{combo}x combo!</span>
            )}
          </div>
          {mode === 'survival' ? (
            <div className="flex gap-1" aria-label={isKorean ? `목숨 ${lives}개` : `${lives} lives`}>
              {Array.from({ length: SURVIVAL_LIVES }, (_, i) => (
                <Heart key={i} className="w-5 h-5" aria-hidden
                  style={{ color: '#FD79A8', fill: i < lives ? '#FD79A8' : 'none' }} />
              ))}
            </div>
          ) : (
            <div className="text-3xl font-bold" style={{
              fontFamily: "'JetBrains Mono'",
              color: turnLeft <= 3 ? 'var(--color-error)' : turnLeft <= 6 ? 'var(--color-accent-warm)' : 'var(--color-secondary)',
              animation: turnLeft <= 3 ? 'pulse 0.5s ease-in-out infinite' : undefined,
            }}>
              {turnLeft}{sessionLeft !== null ? ` · ${sessionLeft}s` : ''}
            </div>
          )}
        </div>

        {/* Chain display */}
        <Card className="p-4 mb-4" style={{ maxHeight: '180px', overflowY: 'auto' }}>
          <div className="flex flex-wrap gap-2 items-center">
            {chain.map((entry, i) => (
              <div key={i} className="flex items-center gap-1">
                {i > 0 && <span style={{ color: 'var(--text-muted)' }}>→</span>}
                <span
                  className="px-3 py-1.5 rounded-lg text-sm font-bold transition-all"
                  style={{
                    background: entry.isPlayer ? 'rgba(108,92,231,0.25)' : 'rgba(0,210,211,0.15)',
                    color: entry.isPlayer ? '#A29BFE' : '#00D2D3',
                    border: `1px solid ${entry.isPlayer ? 'rgba(108,92,231,0.4)' : 'rgba(0,210,211,0.3)'}`,
                  }}
                >
                  {entry.word}
                </span>
              </div>
            ))}
            <div ref={chainEndRef} />
          </div>
        </Card>

        {/* 정면 카드(고정) — 다음 글자 힌트 + 입력. 3D 장면과 무관하게 항상 같은 자리, 같은 크기. */}
        <div data-puzzle-card>
          <div className="text-center mb-4">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {isKorean ? '다음 글자: ' : 'Next letter: '}
            </span>
            <span className="text-3xl font-bold" style={{ color: 'var(--color-accent-warm)', fontFamily: "'Outfit'", fontSize: '28px' }}>
              {isKorean ? lastChar : lastChar.toUpperCase()}
            </span>
          </div>

          {message && (
            <div className="text-center text-sm mb-3 font-bold" style={{ color: 'var(--color-error)' }}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 px-4 py-3 rounded-xl border-2 text-center"
              style={{
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontFamily: "'JetBrains Mono', 'Noto Sans KR'",
                borderColor: 'var(--key-border)',
                fontSize: '20px',
              }}
              placeholder={isKorean ? `'${lastChar}'(으)로 시작하는 단어...` : `Word starting with '${lastChar.toUpperCase()}'...`}
              autoComplete="off"
              autoFocus
            />
            <Button type="submit" size="lg">{isKorean ? '입력' : 'Go'}</Button>
          </form>
        </div>

        <div className="text-center mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {isKorean ? `사용한 단어: ${totalWords}개 · 레벨 ${level}` : `Words used: ${totalWords} · Level ${level}`}
        </div>
      </div>
    </div>
  );
}
