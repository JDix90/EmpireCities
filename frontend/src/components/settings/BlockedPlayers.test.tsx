import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlockedPlayers from './BlockedPlayers';

const getMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../../services/api', () => ({ api: { get: getMock, delete: deleteMock, post: vi.fn() } }));

describe('Settings → Blocked players', () => {
  beforeEach(() => { getMock.mockReset(); deleteMock.mockClear(); });

  it('lists blocked players and unblocks one', async () => {
    getMock.mockResolvedValue({ data: { blocks: [
      { user_id: 'u1', username: 'RudeRaven', blocked_at: '2026-11-14T00:00:00Z' },
      { user_id: 'u2', username: 'SpamSwift', blocked_at: '2026-11-13T00:00:00Z' },
    ] } });
    render(<BlockedPlayers />);
    expect(await screen.findByText('RudeRaven')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Unblock' })[0]!);
    await waitFor(() => expect(screen.queryByText('RudeRaven')).toBeNull());
    expect(deleteMock).toHaveBeenCalledWith('/safety/blocks/u1');
    expect(screen.getByText('SpamSwift')).toBeInTheDocument();
  });

  it('says how to block someone when the list is empty', async () => {
    getMock.mockResolvedValue({ data: { blocks: [] } });
    render(<BlockedPlayers />);
    expect(await screen.findByTestId('blocked-players-empty')).toHaveTextContent(/tap ⋯ beside one of their chat messages/);
  });
});
