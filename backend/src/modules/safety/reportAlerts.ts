import { countOpenChatReports } from './chatSafety.service';

/** The event an admin's client hears when the number of open chat reports changes. */
export const ADMIN_CHAT_REPORTS_EVENT = 'admin:chat_reports';

/**
 * Tell every signed-in admin how many chat reports are open, after one is
 * filed or closed: the top bar's Admin badge updates at once rather than on
 * its next poll. Admins' sockets join the `admins` room when they connect
 * (sockets/gameSocket.ts), on every instance, through the Redis adapter.
 *
 * The socket module loads lazily, as the ban route's does, so the routes that
 * call this (and their tests) do not pull in the whole game server. Never
 * throws: a report is filed whether or not anyone hears about it now.
 */
export async function announceOpenReports(): Promise<void> {
  try {
    const { getGameIo } = await import('../../sockets/gameSocket');
    const io = getGameIo();
    if (!io) return;
    io.to('admins').emit(ADMIN_CHAT_REPORTS_EVENT, { open: await countOpenChatReports() });
  } catch (err) {
    console.warn('[chat-safety] could not tell admins about open reports:', (err as Error).message);
  }
}
