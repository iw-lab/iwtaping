'use client';

import { useState, useEffect, useCallback } from 'react';
import { TypingArea } from '@/components/typing/TypingArea';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TypingResult } from '@/types/typing';
import { koreanTranscriptions, TranscriptionPassage } from '@/data/korean/transcription';
import { shuffleArray } from '@/lib/utils/helpers';

interface TranscriptionRecord {
  passageId: string;
  title: string;
  source: string;
  accuracy: number;
  kpm: number;
  chars: number;
  at: number;
}

const STORAGE_KEY = 'typingverse-transcriptions';
const LEVEL_LABEL: Record<TranscriptionPassage['level'], string> = { easy: '짧게', medium: '보통', long: '길게' };

function loadRecords(): TranscriptionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveRecord(rec: TranscriptionRecord): TranscriptionRecord[] {
  const all = [rec, ...loadRecords()].slice(0, 200);
  if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return all;
}

export default function TranscribePage() {
  const [level, setLevel] = useState<'all' | TranscriptionPassage['level']>('all');
  const [queue, setQueue] = useState<TranscriptionPassage[]>([]);
  const [current, setCurrent] = useState<TranscriptionPassage | null>(null);
  const [records, setRecords] = useState<TranscriptionRecord[]>([]);
  const [justSaved, setJustSaved] = useState(false);

  const buildQueue = useCallback((lv: 'all' | TranscriptionPassage['level']) => {
    const filtered = lv === 'all' ? koreanTranscriptions : koreanTranscriptions.filter((p) => p.level === lv);
    const shuffled = shuffleArray(filtered.length ? filtered : koreanTranscriptions);
    setQueue(shuffled);
    setCurrent(shuffled[0] ?? null);
  }, []);

  useEffect(() => {
    setRecords(loadRecords());
  }, []);

  useEffect(() => {
    buildQueue(level);
  }, [level, buildQueue]);

  const nextPassage = useCallback(() => {
    setJustSaved(false);
    setQueue((prev) => {
      const rest = prev.slice(1);
      if (rest.length === 0) {
        const reshuffled = shuffleArray(
          level === 'all' ? koreanTranscriptions : koreanTranscriptions.filter((p) => p.level === level)
        );
        setCurrent(reshuffled[0] ?? null);
        return reshuffled;
      }
      setCurrent(rest[0]);
      return rest;
    });
  }, [level]);

  const handleComplete = useCallback((result: TypingResult) => {
    if (!current) return;
    const rec: TranscriptionRecord = {
      passageId: current.id,
      title: current.title,
      source: current.source,
      accuracy: Math.round(result.accuracy * 10) / 10,
      kpm: Math.round(result.kpm),
      chars: current.text.length,
      at: Date.now(),
    };
    setRecords(saveRecord(rec));
    setJustSaved(true);
  }, [current]);

  const totalChars = records.reduce((a, r) => a + r.chars, 0);

  return (
    <div className="max-w-[820px] mx-auto px-4 py-8">
      <div className="mb-2">
        <h1 className="text-3xl font-bold gradient-text" style={{ fontFamily: "'Outfit', sans-serif" }}>필사책</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          좋은 글을 한 글자씩 옮겨 적어요. 완성한 필사는 이 기기의 필사책에 차곡차곡 쌓여요.
        </p>
      </div>
      <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
        모든 지문은 저작권 걱정 없는 창작글·전래 이야기·속담이에요.
      </p>

      {/* 길이 선택 */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {([['all', '전체'], ['easy', '짧게'], ['medium', '보통'], ['long', '길게']] as ['all' | TranscriptionPassage['level'], string][]).map(([lv, label]) => (
          <Button key={lv} size="sm" variant={level === lv ? 'primary' : 'secondary'} onClick={() => setLevel(lv)}>
            {label}
          </Button>
        ))}
      </div>

      {current && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg font-bold" style={{ fontFamily: "'Outfit'" }}>{current.title}</span>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(108,92,231,0.2)', color: 'var(--color-primary-light)' }}>
              {current.source} · {LEVEL_LABEL[current.level]}
            </span>
          </div>
          <TypingArea key={current.id} text={current.text} onComplete={handleComplete} mode="long" />
          <div className="flex justify-center mt-4">
            <Button variant={justSaved ? 'primary' : 'secondary'} onClick={nextPassage}>
              {justSaved ? '필사책에 담고 다음 글 ✍️' : '다른 글 고르기'}
            </Button>
          </div>
        </>
      )}

      {/* 내 필사책 */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">📖 내 필사책</h2>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {records.length}편 · {totalChars.toLocaleString()}자 필사
          </span>
        </div>
        {records.length === 0 ? (
          <Card className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            아직 필사한 글이 없어요. 위에서 한 편을 옮겨 적어 첫 페이지를 채워보세요.
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {records.map((r, i) => (
              <Card key={`${r.at}-${i}`} className="px-4 py-3 flex items-center justify-between gap-3"
                style={{ background: 'linear-gradient(90deg, rgba(255,251,235,0.04), transparent)', borderLeft: '3px solid var(--color-accent-warm)' }}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.title}
                    <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>{r.source}</span>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(r.at).toLocaleDateString('ko-KR')} · {r.chars}자
                  </div>
                </div>
                <div className="text-right shrink-0" style={{ fontFamily: "'JetBrains Mono'" }}>
                  <div className="text-sm font-bold" style={{ color: r.accuracy >= 95 ? 'var(--color-success)' : 'var(--color-accent-warm)' }}>{r.accuracy}%</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.kpm}타/분</div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
