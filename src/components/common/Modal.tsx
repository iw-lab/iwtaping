'use client';

import { useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="rounded-2xl border border-[var(--key-border)] w-full max-w-lg max-h-[90vh] overflow-auto count-up"
        style={{ background: 'var(--bg-card)', boxShadow: '0 25px 50px rgba(0,0,0,0.5)' }}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--key-border)]">
            <h2 className="text-lg font-bold" style={{ fontFamily: "'Outfit', sans-serif" }}>{title}</h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70 min-w-[44px] min-h-[44px] inline-flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
