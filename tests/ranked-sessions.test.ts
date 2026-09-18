import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

/**
 * 2026-09-18 — 칠 글을 사용자가 고르는 판은 순위에 올리지 않는다.
 * 커스텀 테스트가 그렇다(그 기록은 실력의 증거가 될 수 없다).
 * 그리고 예전엔 «무엇을 쳤든» mode:'speed' 로 제출해 연습이 전부 속도 랭킹에 섞였다.
 */
describe('순위에 올릴 수 있는 세션', () => {
  it('커스텀 테스트는 ranked={false} 로 넘긴다', () => {
    const src = read('src/app/test/custom/page.tsx');
    // 🔴 `[^>]*` 로 태그를 잡으면 안 된다 — onRestart={() => {}} 의 «=>» 가 '>' 라서 거기서 끊긴다
    expect(src).toContain('<TypingArea');
    expect(src).toContain('ranked={false}');
  });

  it('ResultPanel 은 ranked 가 아니면 제출하지 않는다', () => {
    const src = read('src/components/typing/ResultPanel.tsx');
    expect(src).toMatch(/if\s*\(!ranked\)\s*return/);
  });

  it("제출 모드가 'speed' 로 박혀 있지 않다", () => {
    const src = read('src/components/typing/ResultPanel.tsx');
    expect(src).not.toMatch(/mode:\s*'speed'/);
  });

  it('연습·테스트 화면이 각자 모드를 밝힌다', () => {
    const expected: [string, string][] = [
      ['src/app/test/speed/page.tsx', 'speed_test'],
      ['src/app/test/accuracy/page.tsx', 'accuracy_test'],
      ['src/app/test/custom/page.tsx', 'custom_test'],
      ['src/app/practice/word/page.tsx', 'word'],
      ['src/app/practice/long/page.tsx', 'long'],
      ['src/app/practice/code/page.tsx', 'code'],
      ['src/app/practice/position/page.tsx', 'position'],
      ['src/components/typing/MultiSentenceRunner.tsx', 'short'],
    ];
    for (const [file, mode] of expected) {
      expect(read(file), `${file} 가 mode="${mode}" 를 넘기지 않습니다`).toContain(`mode="${mode}"`);
    }
  });

  it('레이스 한 판은 순위에 한 번만 오른다', () => {
    const src = read('src/app/game/race/page.tsx');
    // 순위는 game:race 하나. 타이핑 제출은 mode="race" 라 리더보드 MODES 에 없어 순위에 안 오르고,
    // game: 접두사가 아니라 지갑·XP 는 그대로 받는다.
    expect(src).toContain('mode="race"');
    expect(src).toContain("mode: 'game:race'");
    const lb = read('functions/api/leaderboard.ts');
    expect(lb).not.toMatch(/^\s*race:\s*\{/m);
  });

  it("'race' 모드는 game: 접두사가 아니라 보상을 받는다", () => {
    const area = read('src/components/typing/TypingArea.tsx');
    expect(area).toMatch(/race:\s*'race'/);
    expect(area).not.toMatch(/race:\s*'game:race'/);
  });

  it('서버 리더보드가 읽는 키만 순위에 오른다', () => {
    const lb = read('functions/api/leaderboard.ts');
    // speed·accuracy 외의 연습 모드는 MODES 에 없으므로 순위 조회 자체가 안 된다
    expect(lb).toMatch(/speed:\s*\{\s*column:\s*'kpm'\s*\}/);
    expect(lb).toMatch(/accuracy:\s*\{\s*column:\s*'kpm'\s*\}/);
    expect(lb).not.toMatch(/\bcustom_test:\s*\{/);
  });
});
