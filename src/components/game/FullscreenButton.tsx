'use client';
// 전체화면 단추(기본틀 ③). 키트 gb-fullscreen 은 불러오는 순간 document 를 만지므로 브라우저에서만 동적으로 붙인다.
import { useEffect, useRef } from 'react';

export function FullscreenButton({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    void import('@/lib/gb/gb-fullscreen.js').then((m) => { if (alive) m.bindFullscreenButton(ref.current); });
    return () => { alive = false; };
  }, []);
  return (
    <button ref={ref} type="button" aria-label="전체화면" title="전체화면"
      className={`inline-flex items-center justify-center w-11 h-11 rounded-xl border ${className}`}
      style={{ borderColor: 'var(--key-border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
  );
}

