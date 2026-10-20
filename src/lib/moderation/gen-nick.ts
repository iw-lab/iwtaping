// 생성 닉네임 — «형용사 + 명사 + 두 자리 수»(예: 빠른다람쥐27). 화면(가입)과 서버(functions)가 이 파일 하나를 같이 쓴다.
// 왜: 이름 자유 입력은 실명·욕설이 들어오고 금칙어 거르기가 끝없는 숙제다(game-builder 아동 개인정보 HARD «자유 입력 이름 0»).
// ⚠️ 낱말은 «추가만» 한다 — 빼면 그 이름을 쓰던 기기가 형식 검사에서 떨어진다.
export const NICK_ADJ = ['빠른', '용감한', '반짝이는', '씩씩한', '똑똑한', '날쌘', '신나는', '포근한', '튼튼한', '상냥한',
  '부지런한', '재빠른', '든든한', '즐거운', '멋진', '귀여운', '꼼꼼한', '활기찬', '다정한', '힘찬',
  '푸른', '노란', '하얀', '초록', '빨간', '보라', '은빛', '금빛', '무지개', '햇살'] as const;
export const NICK_NOUN = ['다람쥐', '고양이', '강아지', '토끼', '거북이', '부엉이', '돌고래', '펭귄', '여우', '판다',
  '코끼리', '기린', '사자', '호랑이', '수달', '고래', '참새', '독수리', '해파리', '문어',
  '버스', '기차', '로켓', '별', '구름', '나무', '바람', '파도', '연필', '자판'] as const;

/** 형식 검사 — 낱말 표에서 나온 조합만(대소문자·공백 없음) */
export function isGenNick(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  const m = /^(.+?)(\d{2})$/.exec(s); if (!m) return false;
  const n = +m[2]; if (n < 10 || n > 99) return false;
  for (const a of NICK_ADJ) if (m[1].startsWith(a) && (NICK_NOUN as readonly string[]).includes(m[1].slice(a.length))) return true;
  return false;
}

function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
/** 씨앗(문자열)에서 정해진 이름 하나 — 옛 이름 공개 표시·서버 치환에 쓴다. salt 로 다른 후보 */
export function genNickFrom(seed: string, salt = 0): string {
  const h = hash(`${seed}#${salt}`);
  return `${NICK_ADJ[h % NICK_ADJ.length]}${NICK_NOUN[Math.floor(h / 31) % NICK_NOUN.length]}${10 + (Math.floor(h / 997) % 90)}`;
}
/** 무작위 후보 n개(가입 화면) */
export function genNickChoices(n = 3, rnd: () => number = Math.random): string[] {
  const out = new Set<string>();
  while (out.size < n) out.add(`${NICK_ADJ[Math.floor(rnd() * NICK_ADJ.length)]}${NICK_NOUN[Math.floor(rnd() * NICK_NOUN.length)]}${10 + Math.floor(rnd() * 90)}`);
  return [...out];
}
/** 공개 목록에 내보낼 이름 — 생성 형식이면 그대로, 옛 자유 입력 이름이면 그 문자열에서 정해진 생성 이름 */
export function publicNick(nickname: string): string { return isGenNick(nickname) ? nickname : genNickFrom(nickname); }
