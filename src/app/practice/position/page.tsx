'use client';

import { useState, useEffect, useCallback } from 'react';
import { TypingArea } from '@/components/typing/TypingArea';
import { JamoTypingArea } from '@/components/typing/JamoTypingArea';
import { VirtualKeyboard } from '@/components/keyboard/VirtualKeyboard';
import { useKeyHighlight } from '@/components/keyboard/KeyHighlight';
import { loadKeyboardLayout } from '@/components/keyboard/KeyboardLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { KeyboardLayoutData } from '@/types/keyboard';
import { TypingResult } from '@/types/typing';
import { getCodeForChar } from '@/lib/typing/finger-mapper';
import { decomposeKorean } from '@/lib/utils/helpers';

// Check if text contains only individual jamo (not composed syllables)
function isJamoOnly(text: string): boolean {
  for (const char of text) {
    if (char === ' ') continue;
    const code = char.charCodeAt(0);
    // Korean jamo range: 0x3131 (ㄱ) to 0x3163 (ㅣ)
    if (code < 0x3131 || code > 0x3163) return false;
  }
  return true;
}

export default function PositionPracticePage() {
  const [level, setLevel] = useState(1);
  const [layout, setLayout] = useState<KeyboardLayoutData | null>(null);
  const [drills, setDrills] = useState<{ level: number; title: string; drillText: string[] }[]>([]);
  const [text, setText] = useState('');
  const [lang, setLang] = useState<'ko' | 'en'>('ko');
  const { activeKeys, targetKey, setTargetKey } = useKeyHighlight();
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    loadKeyboardLayout(lang === 'ko' ? 'qwerty-ko' : 'qwerty-en').then(setLayout);
  }, [lang]);

  useEffect(() => {
    (async () => {
      try {
        if (lang === 'ko') {
          const mod = await import('@/data/korean/position-drills');
          setDrills(mod.koreanPositionDrills);
        } else {
          const mod = await import('@/data/english/position-drills');
          setDrills(mod.englishPositionDrills);
        }
      } catch {
        setDrills([{ level: 1, title: '기본', drillText: ['asdf jkl;'] }]);
      }
    })();
  }, [lang]);

  useEffect(() => {
    const drill = drills.find((d) => d.level === level);
    if (drill) {
      setText(drill.drillText.join(' '));
    }
  }, [level, drills]);

  const maxLevel = drills.length || 15;

  const handleRestart = () => {
    const drill = drills.find((d) => d.level === level);
    if (drill) setText(drill.drillText.join(' '));
  };

  // 다음에 칠 문자 → 물리 키코드 → 가상 키보드 타겟 하이라이트
  const handleCurrentChar = useCallback((ch: string) => {
    if (!ch || ch === ' ') { setTargetKey(ch === ' ' ? 'Space' : undefined); return; }
    // 완성형 한글 음절이면 첫 자모의 키를 가리킨다(자모 드릴은 그대로).
    const first = decomposeKorean(ch)[0] ?? ch;
    setTargetKey(getCodeForChar(first) ?? undefined);
  }, [setTargetKey]);

  // Determine if current text needs jamo mode (Korean jamo-only levels)
  const useJamoMode = lang === 'ko' && text.length > 0 && isJamoOnly(text);

  return (
    <div className="max-w-[900px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6" style={{ fontFamily: "'Outfit', sans-serif" }}>자리 연습</h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="flex gap-1">
          {(['ko', 'en'] as const).map((l) => (
            <Button key={l} variant={lang === l ? 'primary' : 'secondary'} size="sm" onClick={() => { setLang(l); setLevel(1); }}>
              {l === 'ko' ? '한국어' : 'English'}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {Array.from({ length: maxLevel }, (_, i) => i + 1).map((lvl) => (
          <button
            key={lvl}
            onClick={() => setLevel(lvl)}
            className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${level === lvl ? 'scale-110' : 'opacity-60 hover:opacity-100'}`}
            style={{
              background: level === lvl ? 'var(--color-primary)' : 'var(--bg-card)',
              color: level === lvl ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${level === lvl ? 'var(--color-primary)' : 'var(--key-border)'}`,
            }}
          >
            {lvl}
          </button>
        ))}
      </div>

      {drills[level - 1] && (
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          {drills[level - 1]?.title}
          {useJamoMode && (
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(108,92,231,0.2)', color: 'var(--color-primary-light)' }}>
              자모 직접 입력
            </span>
          )}
        </p>
      )}

      {text && (
        useJamoMode ? (
          <JamoTypingArea text={text} onRestart={handleRestart} onCurrentChar={handleCurrentChar} />
        ) : (
          <TypingArea text={text} onRestart={handleRestart} onCurrentChar={handleCurrentChar} mode="position" />
        )
      )}

      {layout && (
        <div className="mt-6">
          <VirtualKeyboard
            layout={layout}
            activeKeys={activeKeys}
            targetKey={targetKey}
            showFingerGuide={settings.showFingerGuide}
          />
        </div>
      )}
    </div>
  );
}
