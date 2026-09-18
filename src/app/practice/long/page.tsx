'use client';

import { useState, useEffect } from 'react';
import { TypingArea } from '@/components/typing/TypingArea';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

type Lang = 'ko' | 'en';

interface LongText {
  title: string;
  author: string;
  text: string;
}

export default function LongPracticePage() {
  const [lang, setLang] = useState<Lang>('ko');
  const [texts, setTexts] = useState<LongText[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        if (lang === 'ko') {
          const mod = await import('@/data/korean/sentences-long');
          setTexts(mod.koreanSentencesLong);
        } else {
          const mod = await import('@/data/english/sentences-long');
          setTexts(mod.englishSentencesLong);
        }
      } catch {
        setTexts([{ title: '로딩 실패', author: '', text: '데이터를 불러올 수 없습니다.' }]);
      }
      setSelectedIdx(0);
    })();
  }, [lang]);

  const currentText = texts[selectedIdx];

  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: "'Outfit', sans-serif" }}>긴 글 연습</h1>

      <div className="flex gap-2 mb-6">
        {(['ko', 'en'] as Lang[]).map((l) => (
          <Button key={l} variant={lang === l ? 'primary' : 'secondary'} size="sm" onClick={() => setLang(l)}>
            {l === 'ko' ? '한국어' : 'English'}
          </Button>
        ))}
      </div>

      {texts.length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {texts.map((t, i) => (
            <button
              key={i}
              onClick={() => setSelectedIdx(i)}
              className="px-3 py-1.5 rounded-lg text-xs transition-all"
              style={{
                background: selectedIdx === i ? 'var(--color-primary)' : 'var(--bg-card)',
                color: selectedIdx === i ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${selectedIdx === i ? 'var(--color-primary)' : 'var(--key-border)'}`,
              }}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      {currentText && (
        <>
          <Card className="p-4 mb-4">
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
              <strong>{currentText.title}</strong>
              {currentText.author && <span> - {currentText.author}</span>}
            </div>
          </Card>
          {/* 세션 기록은 TypingArea가 단독으로 한다 — 여기서 또 부르면 2배로 쌓인다. */}
          <TypingArea text={currentText.text} mode="long" />
        </>
      )}
    </div>
  );
}
