'use client';
// 홈 «타비의 버스» 카드 — 지금 버스 단계 그림 · 다음 목표 한 줄 · 이야기 앨범. 열린(안 본) 이야기는 여기서 이어 본다.
// 판 안에서는 대화창을 열지 않는다(홈·게임 목록에서만 — GDD-3D §5).
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Star } from 'lucide-react';
import script from '@/lib/story/story.json';
import { loadBook, saveBook, flatOf, busStage, busGoal, BUS_STAGES, type StoryBook } from '@/lib/story/book';

type StoryApi = { play(id: string): Promise<unknown> };
const TITLES: Record<string, string> = {
  prologue: '지워진 정류장', stop_rain: '씨앗섬', stop_space: '우주 정거장', stop_zombie: '놀이터', stop_defense: '장난감 성',
  stop_race: '트랙', stop_puzzle: '블록섬', ink_1: '잉크 망토의 질문', grow_2: '2층 버스', ink_2: '잉크 망토의 비밀',
  grow_3: '날개 버스', grow_4: '별빛 버스', finale: '같이 타자',
};
const portrait = (who: string, ex: string) => script.meta.portrait.replace('{who}', who).replace('{ex}', ex);
let apiP: Promise<{ api: StoryApi; beatsDue: (s: unknown, st: unknown) => string[] }> | null = null;
function storyApi() {
  apiP ||= import('@/lib/story/story.js').then((m) => ({ api: m.createStory({ host: document.body, script, portrait }), beatsDue: m.beatsDue }));
  return apiP;
}

export function BusCard() {
  const [book, setBook] = useState<StoryBook | null>(null);
  const [album, setAlbum] = useState(false);
  const running = useRef(false);

  const playDue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const { api, beatsDue } = await storyApi();
      const b = loadBook(localStorage);
      for (const id of beatsDue(script, flatOf(b))) {
        if (b.storySeen[id]) continue;
        await api.play(id);
        b.storySeen[id] = 1;
        if (id === 'prologue') b.first = 0;
        saveBook(localStorage, b);
      }
      setBook(loadBook(localStorage));
    } catch { /* 이야기를 못 불러와도 홈은 그대로 */ } finally { running.current = false; }
  }, []);

  useEffect(() => { setBook(loadBook(localStorage)); void playDue(); }, [playDue]);

  if (!book) return null;
  const k = busStage(book);
  const goal = busGoal(book);
  return (
    <section className="rounded-2xl border p-4 mb-6 flex items-center gap-4" style={{ borderColor: 'var(--key-border)', background: 'var(--bg-card)' }} data-story="bus">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/story/bus/bus_${k + 1}.webp`} alt={BUS_STAGES[k].name} width={120} height={90} className="w-[120px] h-[90px] object-contain shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>타비의 버스</div>
        <div className="text-lg font-bold">{BUS_STAGES[k].name}</div>
        <div className="mt-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--key-border)' }}>
          <div className="h-full" style={{ width: `${Math.round((goal ? goal.pct : 1) * 100)}%`, background: '#FECA57' }} />
        </div>
        <div className="mt-1 text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }} data-story="goal">
          <Star className="w-3.5 h-3.5" aria-hidden />
          {goal ? `${goal.next.name}까지 별 ${goal.left}개 · 정확도 80% 넘는 판마다 별` : '모든 노선을 다시 이었어요!'}
        </div>
      </div>
      <button type="button" onClick={() => setAlbum((v) => !v)} className="shrink-0 inline-flex items-center gap-1 rounded-xl border px-3 min-h-[44px] text-sm" style={{ borderColor: 'var(--key-border)' }}>
        <BookOpen className="w-4 h-4" aria-hidden /> 앨범
      </button>
      {album && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setAlbum(false)}>
          <div className="w-full max-w-md rounded-2xl p-4" style={{ background: 'var(--bg-card)' }} onClick={(e) => e.stopPropagation()} data-story="album">
            <div className="font-bold mb-3">이야기 앨범</div>
            <div className="grid grid-cols-2 gap-2">
              {script.beats.map((bt) => {
                const seen = !!book.storySeen[bt.id];
                return (
                  <button key={bt.id} type="button" disabled={!seen} className="rounded-xl border px-2 min-h-[44px] text-sm disabled:opacity-40"
                    style={{ borderColor: 'var(--key-border)' }}
                    onClick={async () => { setAlbum(false); const { api } = await storyApi(); await api.play(bt.id); }}>
                    {seen ? TITLES[bt.id] ?? bt.id : '아직 잠겨 있어요'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
