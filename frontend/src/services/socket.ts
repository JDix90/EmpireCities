import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { getSocketUrl } from '../config/env';

let socket: Socket | null = null;
let boundSocketUrl: string | undefined;

function socketUrlKey(): string {
  return getSocketUrl() ?? '';
}

export function getSocket(): Socket {
  const key = socketUrlKey();
  if (socket && boundSocketUrl !== key) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  if (!socket) {
    boundSocketUrl = key;
    const token = useAuthStore.getState().accessToken;
    const url = getSocketUrl();
    socket = io(url, {
      auth: { token },
      withCredentials: true,
      transports: ['websocket'],
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket(): void {
  const s = getSocket();
  if (!s.connected) {
    // Update token before connecting
    const token = useAuthStore.getState().accessToken;
    s.auth = { token };
    s.connect();
  }
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    boundSocketUrl = undefined;
  }
}
