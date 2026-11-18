import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CampaignIntroModal from './CampaignIntroModal';

vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      data: { factions: [{ faction_id: 'mongol_empire', name: 'Mongol Khanate', ability_description: 'Horse Archers: strike before the defender rolls.' }] },
    }),
  },
}));

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

  it('names a stage that stages a named campaign, and calls its goal the objective', () => {
    render(
      <CampaignIntroModal
        data={{ ...base, eraIndex: 3, eraLabel: 'World War II', pathTagline: 'Conquer the world.', stageTitle: 'The Second Front, 1944', goals: ['Hold every territory in Western Front'], turnCap: 'Most territory when turn 30 ends also wins' }}
        onBegin={() => {}}
      />,
    );
    expect(screen.getByTestId('campaign-intro-stage-title').textContent).toBe('The Second Front, 1944');
    const goal = screen.getByTestId('campaign-intro-goal');
    expect(goal.textContent).toContain('Objective');
    expect(goal.textContent).toContain('Hold every territory in Western Front');
    expect(goal.textContent).not.toContain('How to win');
  });

  it('names the powers across the table', () => {
    render(<CampaignIntroModal data={{ ...base, opponents: ['Byzantine Empire', 'Holy Roman Empire'] }} onBegin={() => {}} />);
    expect(screen.getByTestId('campaign-intro-opponents').textContent).toBe('Against: Byzantine Empire, Holy Roman Empire');
  });

  it('leads with how the stage is won, and the clock\'s own way to win', () => {
    render(
      <CampaignIntroModal
        data={{ ...base, goals: ['Control 55% of the map'], turnCap: 'Most territory when turn 30 ends also wins' }}
        onBegin={() => {}}
      />,
    );
    const goal = screen.getByTestId('campaign-intro-goal');
    expect(goal.textContent).toContain('Control 55% of the map');
    expect(goal.textContent).toContain('Most territory when turn 30 ends also wins.');
  });

  it('says what the player\'s faction does once the era\'s factions load', async () => {
    render(
      <CampaignIntroModal
        data={{ ...base, eraId: 'medieval', lockedFactionId: 'mongol_empire', lockedFaction: 'Mongol Khanate' }}
        onBegin={() => {}}
      />,
    );
    expect((await screen.findByTestId('campaign-intro-ability')).textContent)
      .toBe('Mongol Khanate — Horse Archers: strike before the defender rolls.');
  });
});
