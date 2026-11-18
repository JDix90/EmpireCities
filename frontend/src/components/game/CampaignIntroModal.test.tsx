import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CampaignIntroModal from './CampaignIntroModal';

const base = { eraLabel: 'Medieval Era', eraIndex: 1, eraCount: 6, pathName: 'Blood & Empire', signatureCarryLabel: 'Prestige' };

describe('CampaignIntroModal', () => {
  it('shows what the campaign carries into the stage as its effect, not a number', () => {
    render(
      <CampaignIntroModal
        data={{ ...base, carryEffects: [{ key: 'prestige', label: 'Prestige', text: '+2 attack dice in rounds 1–3', until_round: 3 }] }}
        onBegin={() => {}}
      />,
    );
    const carry = within(screen.getByTestId('campaign-intro-carry'));
    expect(carry.getByText('Prestige: +2 attack dice in rounds 1–3')).toBeTruthy();
  });

  it('says there is nothing yet on a first stage, and what a win earns', () => {
    render(<CampaignIntroModal data={{ ...base, eraIndex: 0 }} onBegin={() => {}} />);
    expect(screen.getByTestId('campaign-intro-carry').textContent).toContain('Nothing yet. Win this era to carry Prestige into the next.');
  });

  it('names the powers across the table', () => {
    render(<CampaignIntroModal data={{ ...base, opponents: ['Byzantine Empire', 'Holy Roman Empire'] }} onBegin={() => {}} />);
    expect(screen.getByTestId('campaign-intro-opponents').textContent).toBe('Against: Byzantine Empire, Holy Roman Empire');
  });
});
