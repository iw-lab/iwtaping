import { describe, it, expect } from 'vitest';
import { isGenNick, genNickChoices, genNickFrom, publicNick, NICK_ADJ, NICK_NOUN } from '@/lib/moderation/gen-nick';
import { validateNickname, maskNickname } from '../functions/lib/common';

// 아동 개인정보 HARD — 이름은 «생성 닉네임»만(자유 입력 0). 공개 목록엔 옛 자유 입력 이름이 그대로 나가지 않는다.
describe('생성 닉네임', () => {
  it('후보는 전부 형식을 통과한다', () => {
    for (let i = 0; i < 200; i++) for (const c of genNickChoices(3)) expect(isGenNick(c)).toBe(true);
  });
  it('자유 입력 이름·실명·변형은 거부한다', () => {
    for (const s of ['홍길동', '타자왕', '빠른다람쥐', '빠른다람쥐5', '빠른다람쥐100', '빠른 다람쥐27', '빠른홍길동27', '', null, 12]) expect(isGenNick(s)).toBe(false);
  });
  it('서버 등록 검증도 생성 형식만 받는다', () => {
    expect(validateNickname('타자왕').ok).toBe(false);
    expect(validateNickname('용감한펭귄42').ok).toBe(true);
  });
  it('공개 표시 = 생성 형식(옛 이름은 정해진 생성 이름으로) · 같은 옛 이름 = 같은 표시', () => {
    expect(maskNickname('홍길동')).toBe(publicNick('홍길동'));
    expect(isGenNick(maskNickname('홍길동'))).toBe(true);
    expect(maskNickname('홍길동')).toBe(maskNickname('홍길동'));
    expect(maskNickname('용감한펭귄42')).toBe('용감한펭귄42');
  });
  it('genNickFrom 은 결정론 · salt 로 다른 후보', () => {
    expect(genNickFrom('uid-1')).toBe(genNickFrom('uid-1'));
    expect(genNickFrom('uid-1', 0)).not.toBe(genNickFrom('uid-1', 1));
    expect(isGenNick(genNickFrom('uid-1', 3))).toBe(true);
  });
  it('낱말 표 크기(조합 = 형용사 × 명사 × 90)', () => {
    expect(NICK_ADJ.length * NICK_NOUN.length * 90).toBeGreaterThanOrEqual(80000);
  });
});
