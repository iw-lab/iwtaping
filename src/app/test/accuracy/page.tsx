'use client';

import { useState, useEffect } from 'react';
import { TypingArea } from '@/components/typing/TypingArea';
import { Button } from '@/components/ui/Button';
import { pickRandom } from '@/lib/utils/helpers';

export default function AccuracyTestPage() {
  const [lang, setLang] = useState<'ko' | 'en'>('ko');
  const [text, setText] = useState('');

  useEffect(() => {
    (async () => {
      try {
        if (lang === 'ko') {
          const mod = await import('@/data/korean/sentences-short');
          const items = mod.koreanSentencesShort;
          setText(items.slice(0, 5).map(s => s.text).join(' '));
        } else {
          const mod = await import('@/data/english/sentences-short');
          const items = mod.englishSentencesShort;
          setText(items.slice(0, 5).map(s => s.text).join(' '));
        }
      } catch {
        setText('정확도 테스트 텍스트');
      }
    })();
  }, [lang]);

  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>정확도 모드</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        정확도에 집중하세요. 오타 없이 입력하는 것이 목표입니다.
      </p>

      <div className="flex gap-2 mb-6">
        {(['ko', 'en'] as const).map((l) => (
          <Button key={l} variant={lang === l ? 'primary' : 'secondary'} size="sm" onClick={() => setLang(l)}>
            {l === 'ko' ? '한국어' : 'English'}
          </Button>
        ))}
      </div>

      {/* 세션 기록은 TypingArea가 단독으로 한다 — 여기서 또 부르면 2배로 쌓인다. */}
      {text && <TypingArea text={text} mode="accuracy_test" />}
    </div>
  );
}
