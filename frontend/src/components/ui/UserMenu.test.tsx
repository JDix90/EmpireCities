import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UserMenu from './UserMenu';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

function renderMenu(isGuest = false, onLogout = vi.fn()) {
  render(
    <MemoryRouter>
      <UserMenu
        username="commander"
        isGuest={isGuest}
        onLogout={onLogout}
        triggerClassName="trigger"
        iconClassName="icon"
      />
    </MemoryRouter>,
  );
  return onLogout;
}

describe('UserMenu', () => {
  it('opens on click and lists account destinations', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /commander/i }));
    expect(screen.getByRole('menuitem', { name: /Profile/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Settings/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /How to Play/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Privacy/ })).toBeTruthy();
  });

  it('hides Settings for guests', () => {
    renderMenu(true);
    fireEvent.click(screen.getByRole('button', { name: /commander/i }));
    expect(screen.queryByRole('menuitem', { name: /Settings/ })).toBeNull();
  });

  it('shows Settings to guests with guest_personal_features_enabled', () => {
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, guest_personal_features_enabled: true } }));
    try {
      renderMenu(true);
      fireEvent.click(screen.getByRole('button', { name: /commander/i }));
      expect(screen.getByRole('menuitem', { name: /Settings/ })).toBeTruthy();
    } finally {
      useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, guest_personal_features_enabled: false } }));
    }
  });

  it('fires logout and closes', () => {
    const onLogout = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /commander/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Logout/ }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /commander/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
