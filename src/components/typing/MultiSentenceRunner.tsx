'use client';

import { useState, useCallback } from 'react';
import { TypingArea } from './TypingArea';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TypingResult } from '@/types/typing';

interface MultiSentenceRunnerProps {
  /** 순서대로 한 문장씩 타이핑할 문장 목록. */
  sentences: string[];
  /** 전체 완료 시 종합 결과를 통지. 여기서 recordSession 등을 수행한다. */
  onAllDone?: (aggregate: TypingResult, perSentence: TypingResult[]) => void;
  /** 다시 시작(새 문장 세트 로드) 버튼 콜백. */
  onRetry?: () => void;
}

/** 여러 문장을 한 문장씩 입력받고, 마지막에 종합 결과를 낸다(단문장 편향 완화). */
export function aggregateResults(results: TypingResult[]): TypingResult {
  const n = Math.max(results.length, 1);
  const sum = (f: (r: TypingResult) => number) => results.reduce((a, r) => a + f(r), 0);
  const totalKeystrokes = sum((r) => r.totalKeystrokes);
  const correctKeystrokes = sum((r) => r.correctKeystrokes);
  return {
    kpm: Math.round(sum((r) => r.kpm) / n),
    wpm: Math.round(sum((r) => r.wpm) / n),
    cpm: Math.round(sum((r) => r.cpm) / n),
    accuracy: totalKeystrokes > 0 ? Math.round((correctKeystrokes / totalKeystrokes) * 1000) / 10 : 100,
    maxSpeed: results.length ? Math.max(...results.map((r) => r.maxSpeed)) : 0,
    consistency: Math.round(sum((r) => r.consistency) / n),
    totalKeystrokes,
    correctKeystrokes,
    errorKeystrokes: totalKeystrokes - correctKeystrokes,
    elapsedTime: sum((r) => r.elapsedTime),
    // 손가락/키별 통계는 집계에 의미가 없어 첫 결과 형태만 유지(표시·기록에 미사용)
    fingerAccuracy: results[0]?.fingerAccuracy ?? ({} as TypingResult['fingerAccuracy']),
    keyAccuracy: {},
    speedHistory: results.flatMap((r) => r.speedHistory ?? []),
    problemKeys: [],
  };
}

export function MultiSentenceRunner({ sentences, onAllDone, onRetry }: MultiSentenceRunnerProps) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<TypingResult[]>([]);
  const [done, setDone] = useState(false);

  const total = sentences.length;

  const handleComplete = useCallback((r: TypingResult) => {
    setResults((prev) => {
      const next = [...prev, r];
      if (next.length >= total) {
        setDone(true);
        onAllDone?.(aggregateResults(next), next);
      } else {
        setIndex((i) => i + 1);
      }
      return next;
    });
  }, [total, onAllDone]);

  const restart = useCallback(() => {
    setIndex(0);
    setResults([]);
    setDone(false);
    onRetry?.();
  }, [onRetry]);

  if (total === 0) return null;

  if (done) {
    const agg = aggregateResults(results);
    const best = results.reduce((a, b) => (b.kpm > a.kpm ? b : a), results[0]);
    const worst = results.reduce((a, b) => (b.kpm < a.kpm ? b : a), results[0]);
    return (
      <div className="w-full">
        <Card className="p-6 text-center mb-4">
          <div className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>{total}문장 종합 결과</div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div>
              <div className="text-3xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-primary)' }}>{agg.kpm}</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>평균 타/분</div>
            </div>
            <div>
              <div className="text-3xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-secondary)' }}>{agg.accuracy}%</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>전체 정확도</div>
            </div>
            <div>
              <div className="text-3xl font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-accent-warm)' }}>{Math.round(agg.elapsedTime)}s</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>총 시간</div>
            </div>
          </div>
          <div className="flex justify-center gap-6 mt-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span>최고 문장 <b style={{ color: 'var(--color-success)' }}>{Math.round(best.kpm)}</b> 타/분</span>
            <span>최저 문장 <b style={{ color: 'var(--color-error)' }}>{Math.round(worst.kpm)}</b> 타/분</span>
          </div>
        </Card>
        <div className="flex flex-wrap gap-1.5 justify-center mb-4">
          {results.map((r, i) => (
            <span key={i} className="text-xs px-2 py-1 rounded-md" style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--key-border)',
              color: r.accuracy >= 95 ? 'var(--color-success)' : r.accuracy >= 85 ? 'var(--color-accent-warm)' : 'var(--color-error)',
              fontFamily: "'JetBrains Mono'",
            }}>
              {i + 1}. {Math.round(r.kpm)}타 · {Math.round(r.accuracy)}%
            </span>
          ))}
        </div>
        <div className="text-center">
          <Button size="lg" onClick={restart}>새 문장으로 다시</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold" style={{ color: 'var(--color-primary)' }}>
          {index + 1} / {total} 문장
        </span>
        <div className="flex-1 mx-4 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${(index / total) * 100}%`, background: 'var(--color-primary)' }} />
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>ESC 재시작</span>
      </div>
      <TypingArea
        key={index}
        text={sentences[index]}
        mode="short"
        showResult={false}
        onComplete={handleComplete}
      />
    </div>
  );
}
