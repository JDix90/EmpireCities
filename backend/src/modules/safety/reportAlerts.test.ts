/**
 * After a chat report is filed or closed, every signed-in admin hears the new
 * open count (the top bar's Admin badge), and filing never fails for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent = vi.hoisted(() => [] as Array<{ room: string; event: string; payload: unknown }>);
const ioState = vi.hoisted(() => ({ up: true }));
const countMock = vi.hoisted(() => vi.fn(async () => 4));

vi.mock('../../sockets/gameSocket', () => ({
  getGameIo: () => (ioState.up
    ? { to: (room: string) => ({ emit: (event: string, payload: unknown) => { sent.push({ room, event, payload }); } }) }
    : null),
}));
vi.mock('./chatSafety.service', () => ({ countOpenChatReports: countMock }));

import { ADMIN_CHAT_REPORTS_EVENT, announceOpenReports } from './reportAlerts';

describe('announceOpenReports', () => {
  beforeEach(() => {
    sent.length = 0;
    ioState.up = true;
    countMock.mockReset().mockResolvedValue(4);
  });

  it('tells the admins room how many reports are open', async () => {
    await announceOpenReports();
    expect(sent).toEqual([{ room: 'admins', event: ADMIN_CHAT_REPORTS_EVENT, payload: { open: 4 } }]);
    expect(ADMIN_CHAT_REPORTS_EVENT).toBe('admin:chat_reports');
  });

  it('does nothing without a game server, and never throws when the count fails', async () => {
    ioState.up = false;
    await expect(announceOpenReports()).resolves.toBeUndefined();
    expect(sent).toEqual([]);
    ioState.up = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    countMock.mockRejectedValue(new Error('db down'));
    await expect(announceOpenReports()).resolves.toBeUndefined();
    expect(sent).toEqual([]);
    warn.mockRestore();
  });
});
