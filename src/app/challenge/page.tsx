'use client';

import { toDateKey } from '@/lib/utils/helpers';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Mascot } from '@/components/mascot/Mascot';
import { TypingArea } from '@/components/typing/TypingArea';
import { getDailyChallenge, isChallengeComplete, getChallengeStars, getChallengeStatus, saveChallengeStatus } from '@/lib/challenge/daily-challenge';
import { useProgressStore } from '@/stores/useProgressStore';
import { useMascotStore } from '@/stores/useMascotStore';
import { useCelebrationStore } from '@/components/common/CelebrationOverlay';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { wordGenerator } from '@/lib/content/word-generator';
import { TypingResult } from '@/types/typing';
import { Star } from 'lucide-react';
import { DataIcon } from '@/components/common/DataIcon';

export default function ChallengePage() {
  const { settings } = useSettingsStore();
  const { addXP, addCoins } = useProgressStore();
  const { setMood, showMessage } = useMascotStore();
  const { trigger } = useCelebrationStore();
  const challenge = getDailyChallenge();
  const [status, setStatus] = useState<'intro' | 'playing' | 'complete'>('intro');
  const [challengeStatus, setChallengeStatus] = useState({ completed: false, stars: 0 });
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');

  useEffect(() => {
    setChallengeStatus(getChallengeStatus());
  }, []);

  useEffect(() => {
    // Generate text for challenge
    const words = wordGenerator.getWords({
      language: settings.language,
      difficulty: challenge.difficulty,
      count: 30,
      minLength: settings.language === 'ko' ? 2 : 3,
    });
    setText(words.join(' '));
  }, [settings.language, challenge.difficulty]);

  const handleStart = () => {
    setStatus('playing');
    setMood('typing');
  };

  const handleComplete = useCallback((result: TypingResult) => {
    const completed = isChallengeComplete(challenge, {
      kpm: result.kpm,
      accuracy: result.accuracy,
      maxCombo: 0, // We'd need to track this
      elapsedTime: result.elapsedTime,
    });

    const earnedStars = getChallengeStars(challenge, {
      kpm: result.kpm,
      accuracy: result.accuracy,
      maxCombo: 0,
      elapsedTime: result.elapsedTime,
    });

    setStars(earnedStars);

    if (completed && !challengeStatus.completed) {
      addXP(challenge.xpReward);
      addCoins(challenge.coinReward);
      saveChallengeStatus(challenge.date, true, earnedStars);
      setChallengeStatus({ completed: true, stars: earnedStars });
      setMood('cheering');
      showMessage('챌린지 완료! 대단해!', 4000);
      trigger({
        type: 'challenge_complete',
        title: '일일 챌린지 완료!',
        subtitle: `+${challenge.xpReward} XP, +${challenge.coinReward} 코인`,
        icon: 'trophy',
      });
    } else if (!completed) {
      setMood('sad');
      showMessage('아깝다! 다시 도전해볼까?', 3000);
    }

    setStatus('complete');
  }, [challenge, challengeStatus.completed, addXP, addCoins, setMood, showMessage, trigger]);

  const difficultyLabel = challenge.difficulty === 1 ? '쉬움' : challenge.difficulty === 2 ? '보통' : '어려움';
  const difficultyColor = challenge.difficulty === 1 ? 'var(--color-success)' : challenge.difficulty === 2 ? 'var(--color-warning)' : 'var(--color-error)';

  if (status === 'playing') {
    return (
      <div className="max-w-[800px] mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ fontFamily: "'Outfit'" }}>
            <DataIcon name={challenge.icon} className="w-5 h-5" /> {challenge.title}
          </h1>
          <span className="text-sm px-3 py-1 rounded-full" style={{ background: 'rgba(108,92,231,0.2)', color: 'var(--color-primary-light)' }}>
            목표: {challenge.target}{challenge.unit}
          </span>
        </div>
        <TypingArea
          text={text}
          onComplete={handleComplete}
          onRestart={() => setStatus('intro')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold gradient-text mb-2" style={{ fontFamily: "'Outfit'" }}>
          오늘의 챌린지
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          매일 새로운 도전이 기다려요!
        </p>
      </div>

      <Card variant="glow" className="p-8 text-center mb-6">
        <div className="flex justify-center mb-4">
          <Mascot mood={challengeStatus.completed ? 'cheering' : 'happy'} size={80} />
        </div>

        <div className="flex justify-center mb-3">
          <DataIcon name={challenge.icon} className="w-10 h-10" style={{ color: 'var(--color-primary)' }} />
        </div>
        <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: "'Outfit'" }}>
          {challenge.title}
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          {challenge.description}
        </p>

        <div className="flex items-center justify-center gap-4 mb-6">
          <span className="text-xs px-3 py-1 rounded-full" style={{ background: `${difficultyColor}22`, color: difficultyColor }}>
            {difficultyLabel}
          </span>
          {challenge.timeLimit > 0 && (
            <span className="text-xs px-3 py-1 rounded-full" style={{ background: 'rgba(253,121,168,0.2)', color: 'var(--color-combo)' }}>
              {challenge.timeLimit}초 제한
            </span>
          )}
        </div>

        {/* Rewards preview */}
        <div className="flex items-center justify-center gap-6 mb-6">
          <div className="text-center">
            <div className="text-lg font-bold" style={{ color: 'var(--color-primary)', fontFamily: "'JetBrains Mono'" }}>
              +{challenge.xpReward}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>XP</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold" style={{ color: 'var(--color-accent-warm)', fontFamily: "'JetBrains Mono'" }}>
              +{challenge.coinReward}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>코인</div>
          </div>
        </div>

        {/* Stars */}
        {challengeStatus.completed && (
          <div className="mb-4">
            <div className="flex justify-center gap-1">
              {[1, 2, 3].map(s => (
                <Star
                  key={s}
                  className="w-6 h-6"
                  style={{ opacity: s <= challengeStatus.stars ? 1 : 0.2 }}
                  fill={s <= challengeStatus.stars ? '#FECA57' : 'none'}
                  color="#FECA57"
                />
              ))}
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-success)' }}>완료!</p>
          </div>
        )}

        {status === 'complete' && !challengeStatus.completed && (
          <div className="mb-4">
            <p className="text-sm" style={{ color: 'var(--color-error)' }}>
              목표에 도달하지 못했어요. 다시 도전해보세요!
            </p>
          </div>
        )}

        <Button
          variant="gradient"
          size="lg"
          onClick={handleStart}
        >
          {challengeStatus.completed ? '다시 도전' : status === 'complete' ? '재도전' : '도전 시작!'}
        </Button>
      </Card>

      {/* Weekly calendar */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>이번 주 챌린지</h3>
        <div className="flex justify-between">
          {['일', '월', '화', '수', '목', '금', '토'].map((day, i) => {
            const d = new Date();
            const currentDay = d.getDay();
            const diff = i - currentDay;
            const date = new Date(d);
            date.setDate(date.getDate() + diff);
            const dateStr = toDateKey(date);
            const dayStatus = getChallengeStatus(dateStr);
            const isToday = diff === 0;

            return (
              <div key={i} className="text-center flex-1">
                <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{day}</div>
                <div
                  className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center text-xs font-bold ${isToday ? 'pulse-glow' : ''}`}
                  style={{
                    background: dayStatus.completed ? 'var(--color-success)' : isToday ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                    color: dayStatus.completed || isToday ? 'white' : 'var(--text-muted)',
                  }}
                >
                  {dayStatus.completed ? '✓' : date.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
