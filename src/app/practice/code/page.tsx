'use client';

import { useState, useEffect } from 'react';
import { TypingArea } from '@/components/typing/TypingArea';
import { Button } from '@/components/ui/Button';
import { pickRandom } from '@/lib/utils/helpers';

type CodeLang = 'python' | 'javascript' | 'html' | 'css';

export default function CodePracticePage() {
  const [codeLang, setCodeLang] = useState<CodeLang>('python');
  const [snippets, setSnippets] = useState<string[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    (async () => {
      try {
        let data: string[] = [];
        switch (codeLang) {
          case 'python': data = (await import('@/data/code/python-snippets')).pythonSnippets; break;
          case 'javascript': data = (await import('@/data/code/javascript-snippets')).javascriptSnippets; break;
          case 'html': data = (await import('@/data/code/html-snippets')).htmlSnippets; break;
          case 'css': data = (await import('@/data/code/css-snippets')).cssSnippets; break;
        }
        setSnippets(data);
        setText(pickRandom(data) || '');
      } catch {
        setText('// Error loading code snippets');
      }
    })();
  }, [codeLang]);

  const handleRestart = () => {
    setText(pickRandom(snippets) || '');
  };

  const langs: [CodeLang, string][] = [
    ['python', 'Python'], ['javascript', 'JavaScript'], ['html', 'HTML'], ['css', 'CSS'],
  ];

  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: "'Outfit', sans-serif" }}>코드 타이핑</h1>

      <div className="flex gap-2 mb-6">
        {langs.map(([l, label]) => (
          <Button key={l} variant={codeLang === l ? 'primary' : 'secondary'} size="sm" onClick={() => setCodeLang(l)}>
            {label}
          </Button>
        ))}
      </div>

      {text && (
        <TypingArea
          text={text}
          mode="code"
          // 세션 기록은 TypingArea가 단독으로 한다 — 여기서 또 부르면 2배로 쌓인다.
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
