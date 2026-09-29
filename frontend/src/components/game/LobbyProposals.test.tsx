import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import LobbyProposals from './LobbyProposals';
import { isLobbyProposalOffered } from '../../utils/lobbyProposalRules';

const socket = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock('../../services/socket', () => ({ getSocket: () => socket }));
vi.mock('../../services/mapService', () => ({ fetchMapById: () => new Promise(() => {}) }));

/** The setting names the rule form offers for a lobby with these settings. */
function offeredSettings(settings: Record<string, unknown>): string[] {
  render(<LobbyProposals gameId="g" currentSettings={settings} currentEraId="ww2" currentMapId="era_ww2" />);
  const buttons = screen.getAllByRole('button', { name: /propose change/i });
  fireEvent.click(buttons[buttons.length - 1]!);
  const [settingSelect] = screen.getAllByRole('combobox');
  return within(settingSelect!).getAllByRole('option').map((o) => o.textContent ?? '').slice(1);
}

describe('LobbyProposals', () => {
  it('offers every rule in an ordinary lobby', () => {
    expect(offeredSettings({ turn_timer_seconds: 300 })).toEqual(
      ['Fog of War', 'Turn Timer', 'Diplomacy', 'Starting Units', 'Factions', 'Naval'],
    );
  });

  it('does not offer what the server refuses: a timer in an async game, factions in a draft', () => {
    expect(offeredSettings({ turn_timer_seconds: 300, async_mode: true, territory_selection: true })).toEqual(
      ['Fog of War', 'Diplomacy', 'Starting Units', 'Naval'],
    );
  });
});

describe('isLobbyProposalOffered', () => {
  it('still offers turning factions off in a draft game', () => {
    expect(isLobbyProposalOffered({ territory_selection: true }, 'factions_enabled', false)).toBe(true);
    expect(isLobbyProposalOffered({ territory_selection: true }, 'factions_enabled', true)).toBe(false);
  });
});
