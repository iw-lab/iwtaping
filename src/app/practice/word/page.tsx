'use client';

import { useState, useEffect, useCallback } from 'react';
import { TypingArea } from '@/components/typing/TypingArea';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { shuffleArray } from '@/lib/utils/helpers';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';
type Lang = 'ko' | 'en';

export default function WordPracticePage() {
  const [difficulty, setDifficulty] = useState<Difficulty>('beginner');
  const [lang, setLang] = useState<Lang>('ko');
  const [words, setWords] = useState<string[]>([]);
  const [text, setText] = useState('');
  const settings = useSettingsStore((s) => s.settings);

  const loadWords = useCallback(async () => {
    let wordList: string[] = [];
    try {
      if (lang === 'ko') {
        switch (difficulty) {
          case 'beginner': wordList = (await import('@/data/korean/words-beginner')).koreanWordsBeginner; break;
          case 'intermediate': wordList = (await import('@/data/korean/words-intermediate')).koreanWordsIntermediate; break;
          case 'advanced': wordList = (await import('@/data/korean/words-advanced')).koreanWordsAdvanced; break;
        }
      } else {
        switch (difficulty) {
          case 'beginner': wordList = (await import('@/data/english/words-common200')).englishCommon200; break;
          case 'intermediate': wordList = (await import('@/data/english/words-common1000')).englishCommon1000; break;
          case 'advanced': wordList = (await import('@/data/english/words-advanced')).englishWordsAdvanced; break;
        }
      }
    } catch {
      wordList = ['연습', '단어', '로딩', '실패'];
    }
    setWords(wordList);
    const selected = shuffleArray(wordList).slice(0, 20);
    setText(selected.join(' '));
  }, [difficulty, lang]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  const handleRestart = () => {
    const selected = shuffleArray(words).slice(0, 20);
    setText(selected.join(' '));
  };

  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: "'Outfit', sans-serif" }}>낱말 연습</h1>

      <div className="flex gap-2 mb-6 flex-wrap">
        <div className="flex gap-1">
          {(['ko', 'en'] as Lang[]).map((l) => (
            <Button key={l} variant={lang === l ? 'primary' : 'secondary'} size="sm" onClick={() => setLang(l)}>
              {l === 'ko' ? '한국어' : 'English'}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {([
            ['beginner', '초급'],
            ['intermediate', '중급'],
            ['advanced', '고급'],
          ] as [Difficulty, string][]).map(([d, label]) => (
            <Button key={d} variant={difficulty === d ? 'primary' : 'secondary'} size="sm" onClick={() => setDifficulty(d)}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      {text && (
        <TypingArea
          text={text}
          mode="word"
          // 세션 기록은 TypingArea가 단독으로 한다 — 여기서 또 부르면 2배로 쌓인다.
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
