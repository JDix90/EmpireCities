import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GalaxyLessonsOffer from './GalaxyLessonsOffer';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { GALAXY_TUTORIAL_MODULE_IDS } from '../../tutorial';

function setGalaxyTrack(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, galaxy_tutorial_enabled: on } }));
}

function renderOffer(completed: string[]) {
  return render(
    <MemoryRouter>
      <GalaxyLessonsOffer completedModules={completed} />
    </MemoryRouter>,
  );
}

describe('GalaxyLessonsOffer', () => {
  beforeEach(() => setGalaxyTrack(true));

  it('starts a newcomer on the primer and counts the track', () => {
    renderOffer([]);
    const start = screen.getByRole('link', { name: /Start .*Galactic Age: The Differences/ });
    expect(start.getAttribute('href')).toBe('/tutorial?module=galaxy_primer&start=1');
    expect(screen.getByText('0 of 7 done')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All lessons' }).getAttribute('href')).toBe('/tutorial');
  });

  it('moves on to the first lesson not yet done', () => {
    renderOffer(['galaxy_primer', 'galaxy_lane_sovereignty']);
    expect(screen.getByRole('link', { name: /Start .*Transcendence/ }).getAttribute('href'))
      .toBe('/tutorial?module=galaxy_transcendence&start=1');
    expect(screen.getByText('2 of 7 done')).toBeTruthy();
  });

  it('offers only the Academy once every lesson is done', () => {
    renderOffer([...GALAXY_TUTORIAL_MODULE_IDS]);
    expect(screen.queryByRole('link', { name: /^Start/ })).toBeNull();
    expect(screen.getByText(/Every lesson done/)).toBeTruthy();
    expect(screen.getByText('7 of 7 done')).toBeTruthy();
  });

  it('renders nothing while the galaxy track is switched off', () => {
    setGalaxyTrack(false);
    renderOffer([]);
    expect(screen.queryByTestId('galaxy-lessons-offer')).toBeNull();
  });
});
