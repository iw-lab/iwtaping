'use client';
import { useEffect, useRef } from 'react';
import { loadSchool } from '@/lib/gb/school';

/** 첫 화면 맨 위 학교 순위(kit/school-hub · 상위 5 + 우리 학교 · 전체 순위 · 참여 통계) — 키트는 브라우저에서만 불러온다
 * 🔴 선행쌤 링크(B12): 키트의 ensureSiteLink()는 안 고르면 rankEl.closest('.gb-home') 가 없을 때
 * rankEl.parentElement 에 붙인다 — 이 앱엔 .gb-home 이 없고 rankEl 의 부모가 페이지 전체 컨테이너라
 * 링크가 맨 아래(3000px+)로 가 "있지만 안 보임"이 됐다(실측 2026-10-22). linkHost 를 따로 둬
 * kit.mountSiteLink(linkHost) 로 자리를 직접 정한다 — 순위 카드 바로 아래, 같은 작은 상자 안.
 */
export function SchoolRankCard() {
  const ref = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void loadSchool().then((kit) => {
      if (!live || !ref.current) return;
      kit.mountSchoolRank(ref.current);
      if (linkRef.current) kit.mountSiteLink(linkRef.current);
      void kit.refreshSchoolRank();
    });
    return () => { live = false; };
  }, []);
  return (
    <div className="max-w-[440px] mx-auto mb-4">
      <div ref={ref} id="schoolRank" />
      <div ref={linkRef} />
    </div>
  );
}
