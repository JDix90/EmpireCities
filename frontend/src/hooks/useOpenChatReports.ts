import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { connectSocket, getSocket } from '../services/socket';

/** The event the server sends admins when the open count changes (backend modules/safety/reportAlerts.ts). */
export const ADMIN_CHAT_REPORTS_EVENT = 'admin:chat_reports';

/** How often the count is read again while nothing has been pushed. */
export const OPEN_REPORTS_POLL_MS = 60_000;

/**
 * How many chat reports wait on an admin, for the top bar's Admin badge:
 * read on mount, when the window comes back into focus, and every minute, and
 * updated at once when the server announces a change (a report filed, or
 * closed by another admin), for which an admin's socket is connected. Null
 * until known, and for anyone not an admin.
 */
export function useOpenChatReports(isAdmin: boolean): number | null {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setOpen(null);
      return;
    }
    let live = true;
    const read = () => {
      api.get<{ open: number }>('/admin/chat-reports/open-count')
        .then((res) => { if (live && typeof res.data?.open === 'number') setOpen(res.data.open); })
        .catch(() => { /* the badge waits for the next read */ });
    };
    read();
    const timer = window.setInterval(read, OPEN_REPORTS_POLL_MS);
    const onFocus = () => read();
    window.addEventListener('focus', onFocus);
    // The lobby does not otherwise connect the socket (games and the turn
    // notifier do), and a push only reaches a connected one. As those do, it
    // connects the shared socket and never disconnects it: logout owns that.
    connectSocket();
    const socket = getSocket();
    const onPush = (msg: { open?: number }) => {
      if (live && typeof msg?.open === 'number') setOpen(msg.open);
    };
    socket.on(ADMIN_CHAT_REPORTS_EVENT, onPush);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      socket.off(ADMIN_CHAT_REPORTS_EVENT, onPush);
    };
  }, [isAdmin]);

  return open;
}
