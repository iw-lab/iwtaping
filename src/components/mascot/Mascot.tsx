'use client';

import { useMascotStore, MascotMood } from '@/stores/useMascotStore';
import { Moon, Sparkles, PartyPopper, Droplet, MessageCircle, type LucideIcon } from 'lucide-react';

interface MascotProps {
  mood?: MascotMood;
  size?: number;
  className?: string;
  showBubble?: boolean;
}

export function Mascot({ mood: moodOverride, size = 120, className = '', showBubble: showBubbleOverride }: MascotProps) {
  const { mascot } = useMascotStore();
  const mood = moodOverride || mascot.mood;
  const showBubble = showBubbleOverride ?? mascot.showBubble;

  const animStyle = getMoodStyle(mood);
  const decoration = getMoodDecoration(mood);
  // Cat illustration is portrait (≈0.75 aspect). Height drives the footprint.
  const imgHeight = size;
  const imgWidth = Math.round(size * 0.78);

  return (
    <div className={`relative inline-flex flex-col items-center ${className}`}>
      {/* Speech bubble - positioned above */}
      {showBubble && mascot.message && (
        <div
          className="mb-2 px-4 py-2 rounded-2xl text-xs font-medium slide-down"
          style={{
            background: 'rgba(108,92,231,0.12)',
            border: '1px solid rgba(108,92,231,0.25)',
            color: 'var(--text-primary)',
            maxWidth: 260,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {mascot.message}
        </div>
      )}

      {/* Mascot illustration (AI-generated) */}
      <div style={{ ...animStyle, width: imgWidth, height: imgHeight, position: 'relative' }}>
        <img
          src="/mascot/cat.webp"
          alt="TypingVerse mascot cat"
          width={imgWidth}
          height={imgHeight}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            filter:
              mood === 'sleeping'
                ? 'saturate(0.7) brightness(0.9)'
                : 'drop-shadow(0 4px 10px rgba(108,92,231,0.35))',
            transition: 'filter 0.3s ease',
          }}
        />
        {decoration && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: -2,
              right: -4,
              width: Math.max(14, size * 0.2),
              height: Math.max(14, size * 0.2),
              lineHeight: 1,
              pointerEvents: 'none',
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
              color: decoration.color,
            }}
          >
            <decoration.Icon width="100%" height="100%" />
          </span>
        )}
      </div>
    </div>
  );
}

/** Small icon cue layered over the cat so mood still reads without unique art per mood. */
function getMoodDecoration(mood: MascotMood): { Icon: LucideIcon; color: string } | null {
  switch (mood) {
    case 'sleeping': return { Icon: Moon, color: '#A0AEC0' };
    case 'excited': return { Icon: Sparkles, color: '#FECA57' };
    case 'cheering': return { Icon: PartyPopper, color: '#FF6B9D' };
    case 'sad': return { Icon: Droplet, color: '#48DBFB' };
    case 'thinking': return { Icon: MessageCircle, color: '#A0AEC0' };
    default: return null;
  }
}

function getMoodStyle(mood: MascotMood): React.CSSProperties {
  switch (mood) {
    case 'excited':
    case 'cheering':
      return { animation: 'mascot-bounce 0.6s ease-in-out infinite' };
    case 'sleeping':
      return { animation: 'mascot-sleep 3s ease-in-out infinite' };
    case 'thinking':
    case 'idle':
      return { animation: 'float 3s ease-in-out infinite' };
    default:
      return {};
  }
}
