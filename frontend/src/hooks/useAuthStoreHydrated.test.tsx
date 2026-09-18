import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({
  resyncSocketAuth: vi.fn(),
  disconnectSocket: vi.fn(),
}));

import { useAuthStore } from '../store/authStore';
import { useAuthStoreHydrated } from './useAuthStoreHydrated';

function Probe() {
  return <span data-testid="hydrated">{String(useAuthStoreHydrated())}</span>;
}

describe('useAuthStoreHydrated', () => {
  const realPersist = useAuthStore.persist;

  afterEach(() => {
    (useAuthStore as unknown as { persist: typeof realPersist }).persist = realPersist;
  });

  it('reports hydrated once the persisted slice has been read', () => {
    render(<Probe />);
    expect(screen.getByTestId('hydrated')).toHaveTextContent('true');
  });

  it('reports hydrated instead of throwing when the persist API is absent', () => {
    // zustand omits `store.persist` entirely when the middleware has no usable
    // storage backend. Dereferencing it unguarded is what blanked the embed;
    // nothing will ever hydrate in that state, so "hydrated" is the honest
    // answer — a splash screen held forever would be the other bug.
    (useAuthStore as unknown as { persist: undefined }).persist = undefined;
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId('hydrated')).toHaveTextContent('true');
  });
});
