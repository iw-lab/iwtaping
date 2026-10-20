'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { soundManager } from '@/lib/sound/sound-manager';
import { allowedStarts } from '@/lib/game/hangul';
import { Link2 } from 'lucide-react';
import { useGameBgm } from '@/hooks/useGameBgm';
import { schoolGate } from '@/lib/gb/school';
import { useGameResult, hitAccuracy } from '@/hooks/useGameResult';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { wordGenerator } from '@/lib/content/word-generator';
import { submitGameScore } from '@/lib/api/client';
import { createGameJuice } from '@/lib/game/juice-table';

interface WordEntry {
  word: string;
  isPlayer: boolean;
  isCorrect: boolean;
}

const HANGUL_WORD = /^[가-힣]+$/;
const ENGLISH_WORD = /^[a-zA-Z]+$/;

export default function PuzzleGamePage() {
  const { settings } = useSettingsStore();
  const [status, setStatus] = useState<'menu' | 'playing' | 'gameover'>('menu');
  useGameBgm('focus', status === 'playing');
  const [score, setScore] = useState(0);
  const [chain, setChain] = useState<WordEntry[]>([]);
  const [currentWord, setCurrentWord] = useState('');
  const [input, setInput] = useState('');
  const [timeLeft, setTimeLeft] = useState(10);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [wordPool, setWordPool] = useState<string[]>([]);
  /** 실제 단어 검증용 사전(초·중·고급 통합). 여기 없는 문자열은 정답으로 인정하지 않는다. */
  const [validWords, setValidWords] = useState<Set<string>>(new Set());
  const [usedWords, setUsedWords] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const chainEndRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef(0);
  const attemptsRef = useRef(0); // 입력 시도 횟수 — 정확도 산출용(맞힌 수 = totalWords)
  /** 사전 단어들의 첫 글자 집합 — 어떤 끝글자가 이어갈 수 있는지(막다른지) 판정용 */
  const dictFirstCharsRef = useRef<Set<string>>(new Set());
  const juiceRef = useRef<ReturnType<typeof createGameJuice> | null>(null); // 반응(주스) — 정답·오답·보너스
  const isKorean = settings.language === 'ko';

  // 반응(주스) 인스턴스 — 캔버스가 없으므로 DOM 점수 숫자(punch)만 꽂는다.
  useEffect(() => {
    juiceRef.current = createGameJuice({
      soundManager,
      punch: { hit: '#puzzle-score' },
      haptics: () => settings.sfx,
    });
    return () => juiceRef.current?.destroy();
  }, [settings.sfx]);

  // 게임 종료 시 서버 순위 제출 (계정 없으면 무시)
  useEffect(() => {
    if (status === 'gameover' && score > 0) {
      void submitGameScore('puzzle', score, Date.now() - startedAtRef.current, settings.language);
    }
  }, [status, score, settings.language]);

  // 일일 퀘스트·도전과제에 이 판을 반영한다(한 번도 입력하지 않은 판은 제외).
  useGameResult(status === 'gameover', () =>
    attemptsRef.current === 0 && score === 0
      ? null
      : {
          gameType: 'puzzle',
          score,
          level: 1, // 끝말잇기는 레벨 개념이 없다
          maxCombo,
          accuracy: hitAccuracy(totalWords, attemptsRef.current),
          wordsTyped: totalWords,
          elapsedTime: Math.round((Date.now() - startedAtRef.current) / 1000),
        }
  );

  // Load word pool with massive expansion
  useEffect(() => {
    wordGenerator.reset();
    const extraWords = wordGenerator.getWords({
      language: settings.language,
      difficulty: 5,
      count: 500,
      minLength: 2,
    });
    (async () => {
      try {
        if (isKorean) {
          const m1 = await import('@/data/korean/words-beginner');
          const m2 = await import('@/data/korean/words-intermediate');
          const m3 = await import('@/data/korean/words-advanced');
          // 대용량 실단어 사전(약 29k, 실사용 빈도순 실제 표제어) — AI가 자연스럽게 이어가고
          // 막다른 글자 판정이 정확해진다. 절차생성 extraWords(가짜일 수 있음)는 AI 풀에서 제외.
          const md = await import('@/data/korean/words-dictionary');
          const pool = [...new Set([...md.koreanDictionary, ...m1.koreanWordsBeginner, ...m2.koreanWordsIntermediate])].filter(w => w.length >= 2);
          // 검증 사전 = 컴퓨터가 쓰는 풀 + 고급 단어까지(플레이어가 아는 단어를 최대한 인정)
          const dict = new Set<string>([...pool, ...m3.koreanWordsAdvanced].filter(w => w.length >= 2));
          setWordPool(pool);
          setValidWords(dict);
          dictFirstCharsRef.current = new Set([...dict].map(w => w[0]));
        } else {
          const m1 = await import('@/data/english/words-common200');
          const m2 = await import('@/data/english/words-common1000');
          const m3 = await import('@/data/english/words-advanced');
          const pool = [...new Set([...m1.englishCommon200, ...m2.englishCommon1000, ...extraWords])].filter(w => w.length >= 3);
          const dict = new Set<string>([...pool, ...m3.englishWordsAdvanced].map(w => w.toLowerCase()).filter(w => w.length >= 3));
          setWordPool(pool);
          setValidWords(dict);
          dictFirstCharsRef.current = new Set([...dict].map(w => w[0].toLowerCase()));
        }
      } catch {
        const fb = extraWords.length > 0 ? extraWords :
          (isKorean
            ? ['사과', '과일', '일출', '출발', '발자국', '국어', '어머니', '니트', '트럭', '럭비']
            : ['apple', 'elephant', 'tiger', 'rabbit', 'turtle', 'eagle', 'eel', 'lion', 'newt']);
        setWordPool(fb);
        setValidWords(new Set(fb.map(w => isKorean ? w : w.toLowerCase())));
      }
    })();
  }, [isKorean, settings.language]);

  const getLastChar = useCallback((word: string): string => {
    if (isKorean) {
      return word[word.length - 1];
    } else {
      return word[word.length - 1].toLowerCase();
    }
  }, [isKorean]);

  const getFirstChar = useCallback((word: string): string => {
    if (isKorean) {
      return word[0];
    } else {
      return word[0].toLowerCase();
    }
  }, [isKorean]);

  /** 이 끝글자로 이어갈 단어가 사전에 실제로 존재하는가(= 막다른 글자가 아닌가). */
  const answerable = useCallback((ch: string): boolean => {
    if (!ch) return false;
    const idx = dictFirstCharsRef.current;
    if (idx.size === 0) return true; // 사전 로딩 전이면 막지 않음
    for (const s of allowedStarts(ch)) if (idx.has(s)) return true;
    return false;
  }, []);

  const findComputerWord = useCallback((lastChar: string): string | null => {
    const starts = allowedStarts(lastChar);
    const candidates = wordPool.filter(w =>
      starts.has(getFirstChar(w)) && !usedWords.has(w)
    );
    if (candidates.length === 0) return null;
    // 플레이어가 이어갈 수 있는 단어만 낸다(막다른 글자로 끝나는 단어는 내지 않음).
    const safe = candidates.filter(w => answerable(getLastChar(w)));
    if (safe.length === 0) return null;
    return safe[Math.floor(Math.random() * safe.length)];
  }, [wordPool, usedWords, getFirstChar, getLastChar, answerable]);

  const startGame = () => {
    // 이어갈 단어가 실제로 존재하는 시작 단어만 고른다("스켈레톤 → 톤..." 같은 막다른 시작 방지)
    const solvable = wordPool.filter(w => w.length >= 2 && answerable(getLastChar(w)));
    const pickFrom = solvable.length > 0 ? solvable : wordPool;
    const starter = pickFrom.length > 0
      ? pickFrom[Math.floor(Math.random() * pickFrom.length)]
      : (isKorean ? '사과' : 'apple');

    setStatus('playing');
    startedAtRef.current = Date.now();
    attemptsRef.current = 0;
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setTotalWords(0);
    setChain([{ word: starter, isPlayer: false, isCorrect: true }]);
    setCurrentWord(starter);
    setUsedWords(new Set([starter]));
    setInput('');
    setTimeLeft(16); // 난이도 완화(기존 12초)
    setMessage('');
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Timer
  useEffect(() => {
    if (status !== 'playing') return;
    if (timeLeft <= 0) {
      setStatus('gameover');
      soundManager?.play('gameOver');
      return;
    }
    const t = setTimeout(() => setTimeLeft(tl => tl - 1), 1000);
    return () => clearTimeout(t);
  }, [status, timeLeft]);

  // Scroll to bottom of chain
  useEffect(() => {
    chainEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chain]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const word = input.trim();
    if (!word) return;
    attemptsRef.current += 1;

    const lastChar = getLastChar(currentWord);
    const firstChar = getFirstChar(word);

    // Validate — 두음법칙 허용(료→요, 라→나 등)
    if (!allowedStarts(lastChar).has(firstChar)) {
      setMessage(isKorean
        ? `'${lastChar}'(으)로 시작하는 단어를 입력하세요!`
        : `Word must start with '${lastChar.toUpperCase()}'!`);
      setCombo(0);
      juiceRef.current?.fire('miss');
      setInput('');
      return;
    }

    if (usedWords.has(word)) {
      setMessage(isKorean ? '이미 사용한 단어입니다!' : 'Word already used!');
      setCombo(0);
      juiceRef.current?.fire('miss');
      setInput('');
      return;
    }

    if (word.length < 2) {
      setMessage(isKorean ? '2글자 이상 입력하세요!' : 'Word must be at least 2 letters!');
      juiceRef.current?.fire('miss');
      setInput('');
      return;
    }

    // 형태 검증 — 자모 낙서("리아ㅓㅣㅏ")·기호는 거부.
    const lookup = isKorean ? word : word.toLowerCase();
    const wellFormed = isKorean ? HANGUL_WORD.test(word) : ENGLISH_WORD.test(word);
    if (!wellFormed) {
      setMessage(isKorean ? '완성된 한글 단어만 입력하세요!' : 'Letters only!');
      setCombo(0);
      juiceRef.current?.fire('miss');
      setInput('');
      return;
    }

    // 사전 검증 — 29k 실단어 사전에 있는 단어만 인정한다.
    // (과거엔 내장 사전이 900단어뿐이라 "완성된 한글이면 통과"로 우회했는데,
    //  그 우회가 남아 '련수' 같은 비단어까지 정답 처리되고 있었다.)
    // 사전이 아직 로드되지 않았을 때만 형태 검증으로 폴백한다.
    if (validWords.size > 0 && !validWords.has(lookup)) {
      setMessage(isKorean ? '사전에 없는 단어입니다!' : 'Not in the dictionary!');
      setCombo(0);
      juiceRef.current?.fire('miss');
      setInput('');
      return;
    }

    // Player word accepted
    const newUsed = new Set(usedWords);
    newUsed.add(word);
    const newCombo = combo + 1;
    const points = word.length * 10 * (1 + Math.floor(newCombo / 3) * 0.5);

    setChain(prev => [...prev, { word, isPlayer: true, isCorrect: true }]);
    setScore(s => s + Math.round(points));
    setCombo(newCombo);
    setMaxCombo(m => Math.max(m, newCombo));
    setTotalWords(t => t + 1);
    setUsedWords(newUsed);
    setTimeLeft(Math.min(timeLeft + 4, 20)); // Bonus time (난이도 완화)
    setMessage('');
    juiceRef.current?.fire('hit', { n: Math.round(points), text: `+${Math.round(points)}` });
    setInput('');

    // Computer's turn
    const computerLastChar = getLastChar(word);
    const computerWord = findComputerWord(computerLastChar);

    if (!computerWord) {
      // Computer can't find a word - player wins bonus!
      setScore(s => s + 100);
      setMessage(isKorean ? '상대가 단어를 못 찾았습니다! +100점 보너스!' : "Opponent can't find a word! +100 bonus!");
      juiceRef.current?.fire('special', { title: isKorean ? '+100 보너스!' : '+100 Bonus!', color: '#FECA57', vib: [25, 30, 25] });
      // Pick a new random starter
      const newStarter = wordPool.filter(w => !newUsed.has(w) && answerable(getLastChar(w)));
      if (newStarter.length > 0) {
        const next = newStarter[Math.floor(Math.random() * newStarter.length)];
        newUsed.add(next);
        setUsedWords(newUsed);
        setCurrentWord(next);
        setTimeout(() => {
          setChain(prev => [...prev, { word: `---`, isPlayer: false, isCorrect: true }, { word: next, isPlayer: false, isCorrect: true }]);
        }, 500);
      }
      return;
    }

    newUsed.add(computerWord);
    setUsedWords(newUsed);
    setCurrentWord(computerWord);

    setTimeout(() => {
      setChain(prev => [...prev, { word: computerWord, isPlayer: false, isCorrect: true }]);
    }, 400);
  };

  const lastChar = currentWord ? getLastChar(currentWord) : '';

  if (status === 'menu') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <div className="flex justify-center mb-4"><Link2 className="w-14 h-14" style={{ color: '#FD79A8' }} /></div>
        <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>
          {isKorean ? '끝말잇기' : 'Word Chain'}
        </h1>
        <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
          {isKorean
            ? '상대 단어의 마지막 글자로 시작하는 단어를 이어가세요!'
            : 'Type a word starting with the last letter of the previous word!'}
        </p>
        <div className="max-w-md mx-auto mb-8 text-left">
          <Card className="p-4">
            <h3 className="font-bold mb-2" style={{ color: 'var(--color-primary)' }}>
              {isKorean ? '게임 규칙' : 'Rules'}
            </h3>
            <ul className="text-sm space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>{isKorean ? '• 상대 단어의 마지막 글자로 시작하는 단어 입력' : '• Type a word starting with the last letter'}</li>
              <li>{isKorean ? '• 이미 사용한 단어는 사용 불가' : '• No repeating words'}</li>
              <li>{isKorean ? '• 정답 시 시간 +4초 보너스' : '• Correct answer gives +4 seconds'}</li>
              <li>{isKorean ? '• 연속 정답으로 콤보 보너스 점수!' : '• Chain combos for bonus points!'}</li>
              <li>{isKorean ? '• 시간이 0이 되면 게임 오버' : '• Game over when time runs out'}</li>
            </ul>
          </Card>
        </div>
        <Button size="lg" onClick={() => schoolGate(startGame)}>
          {isKorean ? '게임 시작' : 'Start Game'}
        </Button>
      </div>
    );
  }

  if (status === 'gameover') {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-8 text-center">
        <h1 className="text-3xl font-bold mb-6" style={{ fontFamily: "'Outfit'", color: 'var(--color-error)' }}>
          {isKorean ? '시간 종료!' : 'Time\'s Up!'}
        </h1>
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
              {chain.filter(e => e.word !== '---').map((entry, i) => (
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
      </div>
    );
  }

  const formatTime = (s: number) => s.toString();

  return (
    <div
      className="max-w-[600px] mx-auto px-4 py-5 rounded-2xl"
      style={{
        backgroundImage:
          'linear-gradient(rgba(9,7,22,0.80), rgba(9,7,22,0.90)), url(/game/puzzle/bg.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        border: '1px solid rgba(108,92,231,0.28)',
      }}
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
        <div className="text-3xl font-bold" style={{
          fontFamily: "'JetBrains Mono'",
          color: timeLeft <= 3 ? 'var(--color-error)' : timeLeft <= 6 ? 'var(--color-accent-warm)' : 'var(--color-secondary)',
          animation: timeLeft <= 3 ? 'pulse 0.5s ease-in-out infinite' : undefined,
        }}>
          {formatTime(timeLeft)}
        </div>
      </div>

      {/* Chain display */}
      <Card className="p-4 mb-4" style={{ maxHeight: '250px', overflowY: 'auto' }}>
        <div className="flex flex-wrap gap-2 items-center">
          {chain.map((entry, i) => (
            entry.word === '---' ? (
              <div key={i} className="w-full text-center text-xs py-1" style={{ color: 'var(--text-muted)' }}>— {isKorean ? '새 라운드' : 'New Round'} —</div>
            ) : (
              <div key={i} className="flex items-center gap-1">
                {i > 0 && chain[i - 1]?.word !== '---' && (
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                )}
                <span
                  className="px-3 py-1.5 rounded-lg text-sm font-bold transition-all"
                  style={{
                    background: entry.isPlayer
                      ? 'rgba(108,92,231,0.25)'
                      : 'rgba(0,210,211,0.15)',
                    color: entry.isPlayer ? '#A29BFE' : '#00D2D3',
                    border: `1px solid ${entry.isPlayer ? 'rgba(108,92,231,0.4)' : 'rgba(0,210,211,0.3)'}`,
                  }}
                >
                  {entry.word}
                </span>
              </div>
            )
          ))}
          <div ref={chainEndRef} />
        </div>
      </Card>

      {/* Current hint */}
      <div className="text-center mb-4">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {isKorean ? '다음 글자: ' : 'Next letter: '}
        </span>
        <span className="text-3xl font-bold" style={{ color: 'var(--color-accent-warm)', fontFamily: "'Outfit'" }}>
          {isKorean ? lastChar : lastChar.toUpperCase()}
        </span>
        <span className="text-sm ml-1" style={{ color: 'var(--text-muted)' }}>
          {isKorean ? '(으)로 시작하는 단어' : ''}
        </span>
      </div>

      {/* Message */}
      {message && (
        <div className="text-center text-sm mb-3 font-bold" style={{
          color: message.includes('보너스') || message.includes('bonus') ? 'var(--color-success)' : 'var(--color-error)'
        }}>
          {message}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          className="flex-1 px-4 py-3 rounded-xl border-2 text-lg text-center"
          style={{
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            fontFamily: "'JetBrains Mono', 'Noto Sans KR'",
            borderColor: 'var(--key-border)',
            fontSize: '1.25rem',
          }}
          placeholder={isKorean ? `'${lastChar}'(으)로 시작하는 단어...` : `Word starting with '${lastChar.toUpperCase()}'...`}
          autoComplete="off"
          autoFocus
        />
        <Button type="submit" size="lg">{isKorean ? '입력' : 'Go'}</Button>
      </form>

      {/* Used words count */}
      <div className="text-center mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {isKorean ? `사용한 단어: ${totalWords}개` : `Words used: ${totalWords}`}
      </div>
    </div>
  );
}
