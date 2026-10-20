'use client';
import { useEffect, useRef } from 'react';
import { initSchool } from '@/lib/gb/school';
import { mountSchoolRank, refreshSchoolRank } from '@/lib/gb/gb-school.js';

/** 첫 화면 맨 위 학교 순위(kit/school-hub · 상위 5 + 우리 학교 · 전체 순위 · 참여 통계) */
export function SchoolRankCard() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    initSchool();
    if (ref.current) { mountSchoolRank(ref.current); void refreshSchoolRank(); }
  }, []);
  return <div ref={ref} id="schoolRank" className="max-w-[440px] mx-auto mb-4" />;
}
