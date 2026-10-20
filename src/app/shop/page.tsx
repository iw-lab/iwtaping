'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useShopStore } from '@/stores/useShopStore';
import { useProgressStore } from '@/stores/useProgressStore';
import { SOUND_PACKS, CARET_SKINS } from '@/lib/shop/catalog';
import { soundManager, KeyTheme } from '@/lib/sound/sound-manager';
import { Coins, Music, Paintbrush, Play } from 'lucide-react';

export default function ShopPage() {
  const { shop, buy, equipSound, equipSkin, availableCoins, load } = useShopStore();
  const loadProgress = useProgressStore((s) => s.loadProgress);
  // 잔액을 구독한다. 구독하지 않으면 다른 탭에서 코인이 바뀌어도 이 화면은 옛 숫자를
  // 계속 보여주다가, 아무 버튼이나 눌러 리렌더되는 순간 갑자기 튄다.
  useProgressStore((s) => s.progress.coins);
  const [toast, setToast] = useState('');

  useEffect(() => {
    loadProgress();
    load();
  }, [loadProgress, load]);

  const coins = availableCoins();

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  };

  const handleBuy = (id: string, label: string) => {
    const r = buy(id);
    if (r === 'ok') flash(`'${label}' 구매 완료!`);
    else if (r === 'insufficient') flash('코인이 부족해요.');
    else if (r === 'owned') flash('이미 보유 중이에요.');
  };

  // 미리듣기: 잠깐 해당 테마로 바꿔 한 번 재생하고 장착 테마로 복원
  const previewSound = (id: KeyTheme) => {
    if (!soundManager) return;
    soundManager.setKeyTheme(id);
    soundManager.play('keyClick');
    setTimeout(() => soundManager?.play('keySpace'), 120);
    setTimeout(() => soundManager?.setKeyTheme(shop.equippedSound), 300);
  };

  return (
    <div className="max-w-[820px] mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold gradient-text" style={{ fontFamily: "'Outfit', sans-serif" }}>상점</h1>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: 'var(--bg-card)', border: '1px solid var(--key-border)' }}>
          <Coins className="w-4 h-4" style={{ color: 'var(--color-accent-warm)' }} />
          <span className="font-bold" style={{ fontFamily: "'JetBrains Mono'", color: 'var(--color-accent-warm)' }}>{coins.toLocaleString()}</span>
        </div>
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        연습·테스트를 마치거나, 일일 퀘스트를 완료하고 보상을 받으면 코인이 쌓여요.
        타이핑 소리와 커서 모양을 바꿔보세요. 모든 아이템은 이 기기에 저장돼요.
      </p>

      {/* 타이핑 음 팩 */}
      <h2 className="text-lg font-bold mb-3 flex items-center gap-1.5"><Music className="w-4 h-4" /> 타이핑 음</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        {SOUND_PACKS.map((item) => {
          const owned = shop.owned.includes(item.id);
          const equipped = shop.equippedSound === item.id;
          return (
            <Card key={item.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold flex items-center gap-2">
                  {item.label}
                  {equipped && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-primary)', color: 'white' }}>장착중</span>}
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{item.desc}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => previewSound(item.id)} className="text-xs px-2 py-1.5 rounded-lg flex items-center gap-1" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}><Play className="w-3 h-3" /> 듣기</button>
                {!owned ? (
                  <Button size="sm" onClick={() => handleBuy(item.id, item.label)}><Coins className="w-3.5 h-3.5 inline mr-1" />{item.price}</Button>
                ) : equipped ? (
                  <span className="text-xs px-2" style={{ color: 'var(--color-success)' }}>✓</span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => equipSound(item.id)}>장착</Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* 커서 스킨 */}
      <h2 className="text-lg font-bold mb-3 flex items-center gap-1.5"><Paintbrush className="w-4 h-4" /> 커서 스킨</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CARET_SKINS.map((item) => {
          const owned = shop.owned.includes(item.id);
          const equipped = shop.equippedSkin === item.id;
          return (
            <Card key={item.id} className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-1 shrink-0">
                  <span style={{ display: 'inline-block', width: 4, height: 22, background: item.caret, borderRadius: 2 }} />
                  <span style={{ color: item.current, fontFamily: "'JetBrains Mono'", fontWeight: 700 }}>가</span>
                </div>
                <div className="min-w-0">
                  <div className="font-bold flex items-center gap-2">
                    {item.label}
                    {equipped && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-primary)', color: 'white' }}>장착중</span>}
                  </div>
                  <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{item.desc}</div>
                </div>
              </div>
              <div className="shrink-0">
                {!owned ? (
                  <Button size="sm" onClick={() => handleBuy(item.id, item.label)}><Coins className="w-3.5 h-3.5 inline mr-1" />{item.price}</Button>
                ) : equipped ? (
                  <span className="text-xs px-2" style={{ color: 'var(--color-success)' }}>✓</span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => equipSkin(item.id)}>장착</Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-bold z-50"
          style={{ background: 'var(--color-primary)', color: 'white', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
