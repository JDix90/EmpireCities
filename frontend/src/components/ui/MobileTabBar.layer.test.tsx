/**
 * The phone tab bar sits below the shared Modal. It renders last on the lobby
 * page, so at the Modal's own layer it painted over every lobby modal's lower
 * edge: on an iPhone SE it covered the bottom of the Full Game modal.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MobileTabBar from './MobileTabBar';
import Modal from './Modal';

vi.mock('../../hooks/useIsLandscape', () => ({ useIsLandscape: () => false }));

/** The `z-N` / `z-[N]` layer on an element's classes. */
function layer(el: Element | null): number {
  const m = el?.className.toString().match(/(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/);
  expect(m, `no z-index class on ${el?.className}`).toBeTruthy();
  return Number(m![1]);
}

describe('the phone tab bar', () => {
  it('sits below the shared Modal, whichever renders later', () => {
    const { container } = render(
      <MemoryRouter>
        <Modal open onClose={() => {}} title="Full Game"><p>Start</p></Modal>
        <MobileTabBar isGuest onCreateGame={vi.fn()} onLogout={vi.fn()} />
      </MemoryRouter>,
    );
    const modalRoot = container.querySelector('[role="dialog"]')!.closest('.fixed');
    const tabBar = container.querySelector('nav.fixed.bottom-0');
    expect(layer(tabBar)).toBeLessThan(layer(modalRoot));
  });
});
