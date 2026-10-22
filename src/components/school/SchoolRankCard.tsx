'use client';
import { useEffect, useRef } from 'react';
import { loadSchool } from '@/lib/gb/school';

/** 첫 화면 맨 위 학교 순위(kit/school-hub · 상위 5 + 우리 학교 · 전체 순위 · 참여 통계) — 키트는 브라우저에서만 불러온다
 * 🔴 선행쌤 링크(B12): 키트의 ensureSiteLink()는 안 고르면 rankEl.closest('.gb-home') 가 없을 때
 * rankEl.parentElement 에 붙인다 — 이 앱엔 .gb-home 이 없고 rankEl 의 부모가 페이지 전체 컨테이너라
 * 링크가 맨 아래(3000px+)로 가 "있지만 안 보임"이 됐다(실측 2026-10-22). linkHost 를 따로 둬
 * kit.mountSiteLink(linkHost) 로 자리를 직접 정한다. 홈은 siteLinkAt(페이지 맨 아래 요소 id)으로 «첫 화면 맨 아래»에 단다
 * (사용자 «첫 화면 아래» · 3000px 아래가 안 보이던 건 위치 탓이 아니라 첫 방문 이야기 덮개 탓이었다 — 2026-10-22 재실측).
 */
export function SchoolRankCard({ siteLinkAt }: { siteLinkAt?: string } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void loadSchool().then((kit) => {
      if (!live || !ref.current) return;
      kit.mountSchoolRank(ref.current);
      const host = (siteLinkAt && document.getElementById(siteLinkAt)) || linkRef.current;
      if (host) kit.mountSiteLink(host);
      void kit.refreshSchoolRank();
    });
    return () => { live = false; };
  }, [siteLinkAt]);
  return (
    <div className="max-w-[440px] mx-auto mb-4">
      <div ref={ref} id="schoolRank" />
      <div ref={linkRef} />
    </div>
  );
}
