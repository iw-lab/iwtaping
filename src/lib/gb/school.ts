'use client';
// 학교 순위(kit/school-hub 1.12) 연결 한 곳 — 게임 6종의 시작 단추·판 끝이 여기만 부른다.
// FREE_PLAY 허브: 판 자체가 타자 연습이라 «문제 풀고 이용권» 없이 판마다 영수증 1장 · 정확도 90% 이상 판만 학교 +1.
// 배포 호스트에선 허브 워커 직결(Pages 함수 공용 한도와 무관) · 로컬은 키트가 중계(/api/hub)를 쓴다.
import { configureHub } from './hubnet.js';
import { configureSchool, gbGate, gbFinish, gbLeave } from './gb-school.js';

export const HUB_DIRECT = 'https://typingverse-hub.simssijjang-a04.workers.dev';
/** 학교 점수가 붙는 정확도(%) */
export const SCHOOL_ACCURACY = 90;
let inited = false;
let ticket: string | null = null;

export function initSchool(): void {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  configureHub({ key: 'typingverse.hub.v1', direct: HUB_DIRECT });
  configureSchool({ playWord: '게임', freePlay: true });
}

/** 시작 단추 «안에서» 부른다(전체화면은 제스처 안에서만 된다). 학교를 아직 안 골랐으면 학교 찾기 창이 먼저 뜬다 */
export function schoolGate(start: () => void): void {
  initSchool();
  if (ticket) { void gbLeave(ticket); ticket = null; }
  void gbGate((ref: string | null) => { ticket = ref; start(); });
}

/** 판 끝 — 정확도 90% 이상이면 학교 +1. 결과 {added, school} 또는 null */
export async function schoolFinish(accuracy: number) {
  const ref = ticket; ticket = null;
  if (!ref) return null;
  return gbFinish(ref, accuracy >= SCHOOL_ACCURACY);
}

/** 판 중간에 나감(페이지 떠남) */
export function schoolLeave(): void {
  if (ticket) { void gbLeave(ticket); ticket = null; }
}
