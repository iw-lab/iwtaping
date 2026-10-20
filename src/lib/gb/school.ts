'use client';
// 학교 순위(kit/school-hub 1.12) 연결 한 곳 — 게임 6종의 시작 단추·판 끝이 여기만 부른다.
// FREE_PLAY 허브: 판 자체가 타자 연습이라 «문제 풀고 이용권» 없이 판마다 영수증 1장 · 정확도 90% 이상 판만 학교 +1.
// 배포 호스트에선 허브 워커 직결(Pages 함수 공용 한도와 무관) · 로컬은 키트가 중계(/api/hub)를 쓴다.
// 🔴 키트 모듈은 불러오는 순간 document 를 만진다 — Next 서버 미리 렌더링(SSG)에서 죽으므로 «브라우저에서만» 동적으로 불러온다.

export const HUB_DIRECT = 'https://typingverse-hub.simssijjang-a04.workers.dev';
/** 학교 점수가 붙는 정확도(%) */
export const SCHOOL_ACCURACY = 90;
type Kit = typeof import('./gb-school.js');
let kitP: Promise<Kit> | null = null;
let ticket: string | null = null;

/** 키트를 불러오고 한 번만 설정한다(브라우저 전용) */
export function loadSchool(): Promise<Kit> {
  kitP ||= (async () => {
    const [hub, kit] = await Promise.all([import('./hubnet.js'), import('./gb-school.js')]);
    hub.configureHub({ key: 'typingverse.hub.v1', direct: HUB_DIRECT });
    kit.configureSchool({ playWord: '게임', freePlay: true });
    return kit;
  })();
  return kitP;
}

/**
 * 시작 단추에서 부른다. 학교를 아직 안 골랐으면 학교 찾기 창이 먼저 뜬다.
 * 키트를 못 불러오면(오프라인·차단) 학교 점수 없이 바로 시작한다 — 판은 절대 막지 않는다.
 */
export function schoolGate(start: () => void): void {
  enterFullscreenNow(); // 기본틀 ③ 게임 들어가면 자동 전체화면 — 제스처 안에서 동기로(첫 줄)
  void loadSchool().then((kit) => {
    if (ticket) { void kit.gbLeave(ticket); ticket = null; }
    void kit.gbGate((ref: string | null) => { ticket = ref; start(); });
  }).catch(() => start());
}

/** 판 끝 — 정확도 90% 이상이면 학교 +1. 결과 {added, school} 또는 null */
export async function schoolFinish(accuracy: number) {
  const ref = ticket; ticket = null;
  if (!ref) return null;
  const kit = await loadSchool();
  return kit.gbFinish(ref, accuracy >= SCHOOL_ACCURACY);
}

/** 판 중간에 나감(페이지 떠남) */
export function schoolLeave(): void {
  const ref = ticket; ticket = null;
  if (ref) void loadSchool().then((kit) => kit.gbLeave(ref));
}

/** 시작 단추 클릭(제스처) 안에서 동기로 부른다 — await 뒤엔 브라우저가 거절한다. 설정 «gb.fs.auto»=0 이면 안 한다. */
export function enterFullscreenNow(): void {
  try {
    if (localStorage.getItem('gb.fs.auto') === '0') return;
    const d = document as Document & { webkitFullscreenElement?: Element };
    if (d.fullscreenElement || d.webkitFullscreenElement) return;
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => { /* 정책 거절 — 조용히 */ });
  } catch { /* */ }
}
