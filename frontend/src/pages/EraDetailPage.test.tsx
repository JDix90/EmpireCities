/**
 * The Galactic Age's era page while the era is an open beta: a notice that
 * says so, with the way in. Other eras, and the page with the beta off, are
 * unchanged.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EraDetailPage from './EraDetailPage';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const setBeta = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, galaxy_age_beta_enabled: on } }));

function visit(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EraDetailPage />
    </MemoryRouter>,
  );
}

describe('EraDetailPage and the Galactic Age beta', () => {
  afterEach(() => setBeta(false));

  it('says Beta on the Galactic Age page, with a way into the lobby', () => {
    setBeta(true);
    visit('/eras/galaxy-age');
    const notice = screen.getByTestId('galactic-beta-notice');
    expect(notice).toHaveTextContent('Galactic Age · Beta');
    expect(screen.getByRole('link', { name: /Play the beta/ })).toHaveAttribute('href', '/lobby?era=galaxy_age&map=era_galaxy');
  });

  it('leaves the page as it was with the beta off, and other eras alone', () => {
    const { unmount } = visit('/eras/galaxy-age');
    expect(screen.queryByTestId('galactic-beta-notice')).toBeNull();
    unmount();
    setBeta(true);
    visit('/eras/ww2');
    expect(screen.queryByTestId('galactic-beta-notice')).toBeNull();
  });
});
