'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { TypingArea, TypingAreaHandle } from '@/components/typing/TypingArea';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { shuffleArray, pickRandom } from '@/lib/utils/helpers';

const DURATIONS = [15, 30, 60, 120];

export default function SpeedTestPage() {
  const [duration, setDuration] = useState(60);
  const [lang, setLang] = useState<'ko' | 'en'>('ko');
  const [text, setText] = useState('');
  const [timeLeft, setTimeLeft] = useState(60);
  const [isRunning, setIsRunning] = useState(false);
  const areaRef = useRef<TypingAreaHandle>(null);

  const loadText = useCallback(async () => {
    try {
      let words: string[] = [];
      if (lang === 'ko') {
        const mod = await import('@/data/korean/words-beginner');
        words = mod.koreanWordsBeginner;
      } else {
        const mod = await import('@/data/english/words-common1000');
        words = mod.englishCommon1000;
      }
      const selected = shuffleArray(words).slice(0, 100);
      setText(selected.join(' '));
    } catch {
      setText('타이핑 테스트 텍스트 로딩 실패');
    }
    setTimeLeft(duration);
    setIsRunning(false);
  }, [lang, duration]);

  useEffect(() => {
    loadText();
  }, [loadText]);

  useEffect(() => {
    if (!isRunning) return;
    if (timeLeft <= 0) {
      setIsRunning(false);
      areaRef.current?.finish(); // 시간 종료 → 현재까지 입력분으로 결과 확정
      return;
    }
    const timer = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [isRunning, timeLeft]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: "'Outfit', sans-serif" }}>속도 테스트</h1>

      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <div className="flex gap-1">
          {(['ko', 'en'] as const).map((l) => (
            <Button key={l} variant={lang === l ? 'primary' : 'secondary'} size="sm" onClick={() => setLang(l)}>
              {l === 'ko' ? '한국어' : 'English'}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {DURATIONS.map((d) => (
            <Button key={d} variant={duration === d ? 'primary' : 'secondary'} size="sm" onClick={() => { setDuration(d); setTimeLeft(d); setIsRunning(false); }}>
              {d}s
            </Button>
          ))}
        </div>
      </div>

      <Card className="p-4 mb-4 text-center">
        <span className="text-4xl font-bold" style={{
          fontFamily: "'JetBrains Mono', monospace",
          color: timeLeft <= 10 ? 'var(--color-error)' : 'var(--color-secondary)',
        }}>
          {formatTime(timeLeft)}
        </span>
      </Card>

      {text && (
        <TypingArea
          ref={areaRef}
          text={text}
          mode="speed_test"
          onStart={() => setIsRunning(true)}
          // 세션 기록은 TypingArea가 단독으로 한다(콤보·언어까지 함께 넘긴다).
          // 여기서 또 recordSession을 부르면 세션·타수·퀘스트가 2배로 쌓인다.
          onComplete={() => setIsRunning(false)}
          onRestart={() => { setIsRunning(false); setTimeLeft(duration); loadText(); }}
        />
      )}
    </div>
  );
}
