'use client';
import { useEffect, useRef } from 'react';
import { loadSchool } from '@/lib/gb/school';

/** 첫 화면 맨 위 학교 순위(kit/school-hub · 상위 5 + 우리 학교 · 전체 순위 · 참여 통계) — 키트는 브라우저에서만 불러온다 */
export function SchoolRankCard() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void loadSchool().then((kit) => { if (live && ref.current) { kit.mountSchoolRank(ref.current); void kit.refreshSchoolRank(); } });
    return () => { live = false; };
  }, []);
  return <div ref={ref} id="schoolRank" className="max-w-[440px] mx-auto mb-4" />;
}
