import { describe, it, expect } from 'vitest';
import { canOfferBlitz } from './blitzEligibility';

const eligible = {
  flagEnabled: true,
  hasActiveTruce: false,
  connectionType: 'land' as string | undefined,
  isDailyChallenge: false,
};

describe('canOfferBlitz', () => {
  it('offers the blitz on a plain land attack', () => {
    expect(canOfferBlitz(eligible)).toBe(true);
    // Orbit lanes resolve as land combat — the blitz applies there too.
    expect(canOfferBlitz({ ...eligible, connectionType: 'orbit' })).toBe(true);
    // A missing connection type (older payloads) does not hide the button.
    expect(canOfferBlitz({ ...eligible, connectionType: undefined })).toBe(true);
  });

  it('never through the kill switch', () => {
    expect(canOfferBlitz({ ...eligible, flagEnabled: false })).toBe(false);
  });

  it('never through an active truce — breaking one is a confirmed single attack', () => {
    expect(canOfferBlitz({ ...eligible, hasActiveTruce: true })).toBe(false);
  });

  it('never across a sea lane — the crossing pays fleets per attack', () => {
    expect(canOfferBlitz({ ...eligible, connectionType: 'sea' })).toBe(false);
  });

  it('never in a daily challenge — each attack is graded as its own move', () => {
    expect(canOfferBlitz({ ...eligible, isDailyChallenge: true })).toBe(false);
  });
});
