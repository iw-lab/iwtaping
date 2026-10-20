'use client';
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/stores/useGameStore';
import type { GameResult } from '@/types/game';
import { schoolFinish, schoolLeave } from '@/lib/gb/school';
import { loadBook, saveBook, addGame } from '@/lib/story/book';

/**
 * 게임 한 판이 끝났을 때 결과를 useGameStore에 딱 한 번만 기록한다.
 *
 * 이 기록이 일일 퀘스트("게임 한 판"·"콤보 만들기")와 게임 도전과제
 * (퍼펙트게임·레벨 클리어·레이스 우승)의 유일한 원천이다. 배선이 빠져 있던 동안
 * 6개 게임 모두 진행도에 아무 기여도 하지 못했다(브라우저 실측, 2026-07-25).
 *
 * 중복 지급 방지: 같은 판에서 effect가 다시 실행돼도 ref 잠금으로 1회만 기록하고,
 * 잠금은 다음 판이 시작될 때(finished=false) 풀린다.
 *
 * @param finished 게임이 끝난 상태인가 (보통 status === 'gameover')
 * @param build    결과 조립 함수. null을 돌려주면 기록하지 않는다(예: 한 번도 입력 안 한 판).
 */
export function useGameResult(
  finished: boolean,
  build: () => Omit<GameResult, 'timestamp'> | null
): void {
  const recorded = useRef(false);
  // build는 매 렌더 새로 만들어지므로 effect 의존성에서 빼고 ref로 최신값만 읽는다.
  // 갱신은 반드시 effect 안에서 — 렌더 중 ref 쓰기는 React 규칙 위반이다.
  // 이 effect가 아래 기록 effect보다 먼저 선언돼 있어, 같은 커밋에서 항상 먼저 실행된다.
  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });

  useEffect(() => {
    if (!finished) {
      recorded.current = false;
      return;
    }
    if (recorded.current) return;
    const partial = buildRef.current();
    if (!partial) return;
    recorded.current = true;
    useGameStore.getState().addResult({ ...partial, timestamp: Date.now() });
    // 학교 순위 — 판 하나 = 영수증 하나 · 정확도 90% 이상이면 학교 +1(lib/gb/school.ts)
    void schoolFinish(partial.accuracy ?? 0);
    // 타비의 버스 — 정확도 별로 버스가 자라고 그 정류장 주인과 친해진다(이야기는 홈에서 이어 본다 · 판 안 대화창 0)
    try { const b = loadBook(localStorage); addGame(b, partial); saveBook(localStorage, b); } catch { /* 저장 못 해도 결과 화면은 그대로 */ }
  }, [finished]);

  // 판 도중에 페이지를 떠나면 영수증을 닫는다(90초 안 = 환불)
  useEffect(() => () => schoolLeave(), []);
}

/** 시도 대비 성공 비율(%). 시도가 없으면 0 — NaN이 저장되는 것을 막는다. */
export function hitAccuracy(hits: number, attempts: number): number {
  if (!attempts || attempts <= 0) return 0;
  return Math.min(100, Math.round((hits / attempts) * 1000) / 10);
}
