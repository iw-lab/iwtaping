'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TypingArea } from '@/components/typing/TypingArea';
import { useStatsStore } from '@/stores/useStatsStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import {
  buildDrill,
  selectWeakKeys,
  fingersForKeys,
  FINGER_LABELS,
} from '@/lib/content/adaptive-drill';

/**
 * 맞춤 드릴 — 지금까지 쌓인 키 정확도에서 약한 키를 뽑아 그 키가 자주 나오는
 * 지문을 만든다. 데이터가 없으면(첫 방문) 일반 드릴로 대체한다.
 */
export default function AdaptivePracticePage() {
  const { stats, loadStats } = useStatsStore();
  const settings = useSettingsStore((s) => s.settings);
  const [round, setRound] = useState(0);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const language = settings.language === 'en' ? 'en' : 'ko';

  const weakKeys = useMemo(() => {
    const keyAccuracy: Record<string, number> = {};
    for (const [key, entry] of Object.entries(stats.keyStats ?? {})) {
      keyAccuracy[key] = entry.accuracy;
    }
    const problems = Object.values(stats.keyStats ?? {})
      .filter((k) => k.accuracy < 90 && k.totalAttempts >= 2)
      .map((k) => k.key);
    return selectWeakKeys(keyAccuracy, problems);
  }, [stats.keyStats]);

  // round를 salt로 넘긴다 — 예전엔 deps에만 있고 인자로 안 줘서
  // '새 지문 받기'를 눌러도 똑같은 지문이 다시 나왔다.
  const text = useMemo(() => buildDrill(weakKeys, language, 24, round), [weakKeys, language, round]);

  const fingers = fingersForKeys(weakKeys);

  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2 gradient-text" style={{ fontFamily: "'Outfit', sans-serif" }}>
        맞춤 드릴
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        내가 자주 틀리는 키를 집중적으로 연습합니다.
      </p>

      <Card className="p-4 mb-6">
        {weakKeys.length ? (
          <>
            <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              집중 교정 대상
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {weakKeys.map((key) => (
                <span
                  key={key}
                  className="px-2.5 py-1 rounded-md text-sm font-bold"
                  style={{ background: 'var(--bg-tertiary)', color: 'var(--color-accent)', fontFamily: "'JetBrains Mono'" }}
                >
                  {key === ' ' ? '空' : key}
                </span>
              ))}
            </div>
            {fingers.length > 0 && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                주로 {fingers.map((f) => FINGER_LABELS[f]).join(', ')}에서 실수가 나옵니다.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            아직 분석할 기록이 부족합니다. 연습을 몇 번 하면 약한 키를 찾아 드릴을 맞춰 드려요.
            지금은 기본 드릴로 시작합니다.
          </p>
        )}
      </Card>

      <TypingArea key={round} text={text} onRestart={() => setRound((r) => r + 1)} mode="word" />

      <div className="mt-6 text-center">
        <Button variant="secondary" size="sm" onClick={() => setRound((r) => r + 1)}>
          새 지문 받기
        </Button>
      </div>
    </div>
  );
}
