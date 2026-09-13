import { describe, it, expect } from 'vitest';
import {
  shouldShowReferralSurvey,
  hasAnsweredReferralSurvey,
  markReferralSurveyAnswered,
  isValidReferralAnswer,
  REFERRAL_SURVEY_KEY,
  REFERRAL_SURVEY_OPTIONS,
} from './referralSurvey';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    map,
  };
}

const base = {
  flagEnabled: true,
  isTutorial: false,
  isDailyChallenge: false,
  alreadyAnswered: false,
};

describe('shouldShowReferralSurvey', () => {
  it('asks once when the flag is on and nothing else claims the moment', () => {
    expect(shouldShowReferralSurvey(base)).toBe(true);
  });

  it('stays silent while the flag is off (it ships dark)', () => {
    expect(shouldShowReferralSurvey({ ...base, flagEnabled: false })).toBe(false);
  });

  it('never interrupts a flow that owns its own ending', () => {
    expect(shouldShowReferralSurvey({ ...base, isTutorial: true })).toBe(false);
    expect(shouldShowReferralSurvey({ ...base, isDailyChallenge: true })).toBe(false);
  });

  it('never asks twice', () => {
    expect(shouldShowReferralSurvey({ ...base, alreadyAnswered: true })).toBe(false);
  });
});

describe('hasAnsweredReferralSurvey', () => {
  it('is false for a browser that has never been asked', () => {
    expect(hasAnsweredReferralSurvey(memoryStorage())).toBe(false);
  });

  it('is true after an answer, and after a skip', () => {
    expect(hasAnsweredReferralSurvey(memoryStorage({ [REFERRAL_SURVEY_KEY]: 'search' }))).toBe(true);
    expect(hasAnsweredReferralSurvey(memoryStorage({ [REFERRAL_SURVEY_KEY]: 'dismissed' }))).toBe(true);
  });

  it('treats unreadable storage as already asked, so it cannot nag', () => {
    // Private mode throws on access. A prompt that reappears on every
    // game-over screen is far worse than a lost data point.
    const throwing = { getItem: () => { throw new Error('denied'); } };
    expect(hasAnsweredReferralSurvey(throwing)).toBe(true);
  });
});

describe('markReferralSurveyAnswered', () => {
  it('records the answer under the cc- prefixed key', () => {
    const storage = memoryStorage();
    markReferralSurveyAnswered(storage, 'ai_assistant');
    expect(storage.map.get(REFERRAL_SURVEY_KEY)).toBe('ai_assistant');
    expect(REFERRAL_SURVEY_KEY.startsWith('cc-')).toBe(true);
  });

  it('never throws when storage refuses the write', () => {
    const throwing = { setItem: () => { throw new Error('quota'); } };
    expect(() => markReferralSurveyAnswered(throwing, 'other')).not.toThrow();
  });
});

describe('isValidReferralAnswer', () => {
  it('accepts every id the UI actually offers', () => {
    for (const option of REFERRAL_SURVEY_OPTIONS) {
      expect(isValidReferralAnswer(option.id), option.id).toBe(true);
    }
  });

  it('rejects anything else, including free text', () => {
    for (const bad of ['', 'AI_ASSISTANT', 'a friend told me', null, undefined, 42, {}]) {
      expect(isValidReferralAnswer(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
