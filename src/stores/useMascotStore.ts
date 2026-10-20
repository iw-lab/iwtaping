'use client';
import { create } from 'zustand';

export type MascotMood = 'happy' | 'excited' | 'sad' | 'sleeping' | 'cheering' | 'thinking' | 'idle' | 'typing';

export interface MascotAccessory {
  id: string;
  name: string;
  icon: string;
  type: 'hat' | 'glasses' | 'ribbon' | 'cape' | 'crown' | 'wings';
  price: number;
  unlockLevel?: number;
}

/** icon 은 화면에 아직 안 꽂혔지만(현재 참조하는 UI 없음), 나중에 꽂을 때를 위해
 *  이모지 글자가 아니라 lucide-react 아이콘 이름(kebab-case)으로 들고 있는다. */
const ALL_ACCESSORIES: MascotAccessory[] = [
  { id: 'ribbon-red', name: '빨간 리본', icon: 'gift', type: 'ribbon', price: 0, unlockLevel: 2 },
  { id: 'hat-wizard', name: '마법사 모자', icon: 'wand-2', type: 'hat', price: 0, unlockLevel: 5 },
  { id: 'glasses-star', name: '별 안경', icon: 'star', type: 'glasses', price: 0, unlockLevel: 10 },
  { id: 'cape-purple', name: '보라색 망토', icon: 'shirt', type: 'cape', price: 0, unlockLevel: 15 },
  { id: 'crown-bronze', name: '브론즈 왕관', icon: 'crown', type: 'crown', price: 0, unlockLevel: 20 },
  { id: 'crown-silver', name: '실버 왕관', icon: 'crown', type: 'crown', price: 0, unlockLevel: 30 },
  { id: 'wings-angel', name: '천사 날개', icon: 'feather', type: 'wings', price: 0, unlockLevel: 40 },
  { id: 'crown-gold', name: '골드 왕관', icon: 'crown', type: 'crown', price: 0, unlockLevel: 50 },
  // Purchasable
  { id: 'hat-cat-ears', name: '고양이 귀', icon: 'cat', type: 'hat', price: 50 },
  { id: 'glasses-cool', name: '선글라스', icon: 'glasses', type: 'glasses', price: 30 },
  { id: 'ribbon-blue', name: '파란 리본', icon: 'heart', type: 'ribbon', price: 25 },
  { id: 'hat-party', name: '파티 모자', icon: 'party-popper', type: 'hat', price: 40 },
  { id: 'cape-rainbow', name: '무지개 망토', icon: 'rainbow', type: 'cape', price: 80 },
  { id: 'hat-chef', name: '셰프 모자', icon: 'chef-hat', type: 'hat', price: 60 },
  { id: 'glasses-heart', name: '하트 안경', icon: 'heart', type: 'glasses', price: 35 },
];

interface MascotState {
  mood: MascotMood;
  equippedAccessories: string[]; // accessory ids
  ownedAccessories: string[];
  message: string;
  showBubble: boolean;
}

interface MascotStore {
  mascot: MascotState;
  setMood: (mood: MascotMood) => void;
  showMessage: (message: string, durationMs?: number) => void;
  hideBubble: () => void;
  equipAccessory: (id: string) => void;
  unequipAccessory: (id: string) => void;
  unlockAccessory: (id: string) => void;
  purchaseAccessory: (id: string) => boolean;
  getAllAccessories: () => MascotAccessory[];
  loadMascot: () => void;
}

const STORAGE_KEY = 'typingverse-mascot';

const defaultMascot: MascotState = {
  mood: 'idle',
  equippedAccessories: [],
  ownedAccessories: [],
  message: '',
  showBubble: false,
};

const ENCOURAGEMENTS = [
  '오늘도 열심히 연습하자!',
  '화이팅! 넌 할 수 있어!',
  '와, 점점 빨라지고 있어!',
  '타이핑 천재가 되는 중!',
  '오늘의 챌린지에 도전해볼까?',
  '연습하면 실력이 쑥쑥!',
];

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;

export const useMascotStore = create<MascotStore>((set, get) => ({
  mascot: defaultMascot,

  setMood: (mood) => {
    set((s) => ({ mascot: { ...s.mascot, mood } }));
  },

  showMessage: (message, durationMs = 3000) => {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    set((s) => ({ mascot: { ...s.mascot, message, showBubble: true } }));
    bubbleTimer = setTimeout(() => {
      set((s) => ({ mascot: { ...s.mascot, showBubble: false } }));
    }, durationMs);
  },

  hideBubble: () => {
    set((s) => ({ mascot: { ...s.mascot, showBubble: false } }));
  },

  equipAccessory: (id) => {
    const state = get().mascot;
    if (!state.ownedAccessories.includes(id)) return;
    const accessory = ALL_ACCESSORIES.find(a => a.id === id);
    if (!accessory) return;
    // Replace same type
    const filtered = state.equippedAccessories.filter(eid => {
      const a = ALL_ACCESSORIES.find(x => x.id === eid);
      return a && a.type !== accessory.type;
    });
    const newState = { ...state, equippedAccessories: [...filtered, id] };
    set({ mascot: newState });
    saveMascot(newState);
  },

  unequipAccessory: (id) => {
    const state = get().mascot;
    const newState = { ...state, equippedAccessories: state.equippedAccessories.filter(x => x !== id) };
    set({ mascot: newState });
    saveMascot(newState);
  },

  unlockAccessory: (id) => {
    const state = get().mascot;
    if (state.ownedAccessories.includes(id)) return;
    const newState = { ...state, ownedAccessories: [...state.ownedAccessories, id] };
    set({ mascot: newState });
    saveMascot(newState);
  },

  purchaseAccessory: (id) => {
    const state = get().mascot;
    const accessory = ALL_ACCESSORIES.find(a => a.id === id);
    if (!accessory || state.ownedAccessories.includes(id)) return false;
    // Coin spending is handled by progressStore
    const newState = { ...state, ownedAccessories: [...state.ownedAccessories, id] };
    set({ mascot: newState });
    saveMascot(newState);
    return true;
  },

  getAllAccessories: () => ALL_ACCESSORIES,

  loadMascot: () => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          set({ mascot: { ...defaultMascot, ...parsed, showBubble: false, message: '' } });
        }
      } catch { /* ignore */ }
      // Show random encouragement after loading
      const msg = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
      setTimeout(() => {
        get().showMessage(msg, 4000);
      }, 1500);
    }
  },
}));

function saveMascot(state: MascotState) {
  if (typeof window !== 'undefined') {
    const { showBubble, message, ...toSave } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }
}
