'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/ui/Button';
import { Mascot } from '@/components/mascot/Mascot';
import { useAccountStore } from '@/stores/useAccountStore';
import { isGenNick, genNickChoices } from '@/lib/moderation/gen-nick';
import { RefreshCw } from 'lucide-react';

const DISMISS_KEY = 'typingverse-onboard-seen';

const GRADES: { id: string; label: string }[] = [
  { id: 'elem', label: '초등' },
  { id: 'middle', label: '중등' },
  { id: 'high', label: '고등' },
  { id: 'adult', label: '성인' },
];

/**
 * 첫 방문 계정 만들기.
 * 계정이 없으면(unregistered) 닉네임을 받아 서버에 등록한다 — 이게 있어야
 * 점수가 서버로 가고 전국 순위·리그에 참여된다. "나중에"로 닫을 수 있고,
 * 한 번 닫으면 로컬 플래그로 다시 자동으로 뜨지 않는다(헤더/순위 화면에서 재유도).
 */
export function AccountOnboarding() {
  const status = useAccountStore((s) => s.status);
  const createAccount = useAccountStore((s) => s.createAccount);

  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState('');
  // 이름은 만들어진 후보에서 고른다(자유 입력 0 — 실명·욕설이 순위표에 오르지 않게)
  const [choices, setChoices] = useState<string[]>([]);
  useEffect(() => { if (open && !choices.length) setChoices(genNickChoices(3)); }, [open, choices.length]);
  const [grade, setGrade] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 계정이 없고 아직 안 닫았으면 자동으로 연다 — 단 게임 화면(/game/…)에선 열지 않는다.
  // 계정 확인은 비동기라 판이 시작된 뒤에 창이 떠서 떨어지는 단어를 가렸다(2026-10-20 씨앗비 3D 실측). 홈·다른 화면에서 연다.
  const pathname = usePathname() || '';
  const inGame = pathname.startsWith('/game/') && pathname.replace(/\/$/, '') !== '/game';
  useEffect(() => {
    if (status === 'unregistered' && !inGame) {
      const seen = typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY);
      if (!seen) setOpen(true);
    }
    if (status === 'online') setOpen(false);
  }, [status, inGame]);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setOpen(false);
  };

  const submit = async () => {
    const name = nickname;
    if (!isGenNick(name)) {
      setError('아래 이름 중 하나를 골라 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user, error: reason } = await createAccount(name, 'cat', grade);
      if (user) {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
        setOpen(false);
      } else if (reason === 'nickname_banned') {
        // 금칙어 목록은 서버에만 있다(번들에 욕설 목록을 싣지 않으려고).
        setError('다른 이름을 골라 주세요.');
      } else if (reason === 'nickname_format') {
        setError('아래 이름 중 하나를 골라 주세요.');
      } else {
        setChoices(genNickChoices(3)); setNickname('');
        setError('이미 누가 쓰는 이름이거나 네트워크 문제예요. 새 이름 중에서 다시 골라 주세요.');
      }
    } catch {
      setError('계정을 만들지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  // 옛 이름이 생성 닉네임으로 바뀐 계정 — 한 번만 알려 준다
  const [renamed, setRenamed] = useState<string | null>(null);
  useEffect(() => { try { setRenamed(localStorage.getItem('typingverse-renamed')); } catch { /* 없음 */ } }, [status]);
  if (renamed && !open) {
    const close = () => { try { localStorage.removeItem('typingverse-renamed'); } catch { /* 없음 */ } setRenamed(null); };
    return (
      <Modal isOpen onClose={close} title="새 이름이 생겼어요">
        <p className="text-center mb-4" style={{ color: 'var(--text-secondary)' }}>
          순위표에 안전하게 보이도록 이름이 <strong>{renamed}</strong>(으)로 바뀌었어요.<br />점수·리그·코인은 그대로예요.
        </p>
        <Button size="md" className="w-full" onClick={close}>좋아요</Button>
      </Modal>
    );
  }
  if (!open) return null;

  return (
    <Modal isOpen={open} onClose={dismiss} title="전국 순위에 참여하기">
      <div className="text-center mb-4">
        <div className="flex justify-center mb-2">
          <Mascot mood="excited" size={72} showBubble={false} />
        </div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          닉네임을 정하면 <strong>전국 순위·리그</strong>에 참여하고,<br />내 등수를 확인할 수 있어요.
        </p>
      </div>

      <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>내 이름 고르기</label>
      <div className="grid grid-cols-1 gap-2 mb-2" role="radiogroup" aria-label="이름 후보">
        {choices.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={nickname === c} onClick={() => setNickname(c)}
            className="w-full px-4 py-3 rounded-xl border text-base font-semibold"
            style={{ background: nickname === c ? 'var(--color-primary)' : 'var(--bg-tertiary)', color: nickname === c ? '#fff' : 'var(--text-primary)', borderColor: nickname === c ? 'var(--color-primary)' : 'var(--key-border)' }}>
            {c}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => { setChoices(genNickChoices(3)); setNickname(''); }}
        className="w-full mb-3 py-2 min-h-[44px] rounded-lg text-sm inline-flex items-center justify-center gap-1"
        style={{ color: 'var(--text-secondary)' }}>
        <RefreshCw className="w-4 h-4" /> 다른 이름 보기
      </button>
      <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>학년 (선택)</label>
      <div className="flex gap-2 mb-3">
        {GRADES.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGrade(grade === g.id ? undefined : g.id)}
            className="flex-1 py-2 min-h-[44px] rounded-lg text-sm font-medium border transition-colors"
            style={{
              background: grade === g.id ? 'var(--color-primary)' : 'var(--bg-tertiary)',
              color: grade === g.id ? '#fff' : 'var(--text-secondary)',
              borderColor: grade === g.id ? 'var(--color-primary)' : 'var(--key-border)',
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs mb-3" style={{ color: 'var(--color-error)' }}>{error}</p>}

      <div className="flex gap-2">
        <Button variant="secondary" size="md" className="flex-1" onClick={dismiss} disabled={busy}>나중에</Button>
        <Button size="md" className="flex-1" onClick={submit} disabled={busy}>
          {busy ? '만드는 중…' : '시작하기'}
        </Button>
      </div>
      <p className="text-xs text-center mt-3" style={{ color: 'var(--text-muted)' }}>
        실명·이메일은 받지 않아요. 닉네임에 실명을 넣지 마세요.
      </p>
    </Modal>
  );
}
