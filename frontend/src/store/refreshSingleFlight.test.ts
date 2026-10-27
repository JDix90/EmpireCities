/**
 * One refresh at a time in a tab. The page load, the API's 401 retry and the
 * socket each ask for one, and a phone waking up can ask for several at once.
 * Each refresh retires the cookie it carries, so a second request racing the
 * first got a 401, and a 401 from refresh signs the player out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

const postMock = vi.hoisted(() => vi.fn());
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, create: () => ({ post: postMock }) } };
});
vi.mock('../services/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../services/socket', () => ({ resyncSocketAuth: vi.fn(), disconnectSocket: vi.fn() }));

import { useAuthStore } from './authStore';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const unauthorized = () =>
  new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config: { headers: new AxiosHeaders() },
  });

beforeEach(() => {
  postMock.mockReset();
  sessionStorage.clear();
  useAuthStore.setState({ isAuthenticated: true, accessToken: null, user: { user_id: 'u1', username: 'Ada' } as never });
});

describe('refreshToken', () => {
  it('sends one request for callers that ask while one is in flight', async () => {
    const reply = deferred<{ data: { accessToken: string } }>();
    postMock.mockReturnValueOnce(reply.promise);
    const { refreshToken } = useAuthStore.getState();

    const fromSocket = refreshToken({ silent: true });
    const fromApiRetry = refreshToken({ silent: false });
    expect(postMock).toHaveBeenCalledTimes(1);

    reply.resolve({ data: { accessToken: 'fresh' } });
    await expect(Promise.all([fromSocket, fromApiRetry])).resolves.toEqual(['ok', 'ok']);
    expect(useAuthStore.getState()).toMatchObject({ accessToken: 'fresh', isAuthenticated: true });
  });

  it('sends a new request once the last one has settled', async () => {
    postMock.mockResolvedValue({ data: { accessToken: 'a' } });
    await useAuthStore.getState().refreshToken({ silent: true });
    await useAuthStore.getState().refreshToken({ silent: true });
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('writes the expired notice when any caller of a refused refresh asked for it', async () => {
    const reply = deferred<never>();
    postMock.mockReturnValueOnce(reply.promise);
    const silent = useAuthStore.getState().refreshToken({ silent: true });
    const loud = useAuthStore.getState().refreshToken({ silent: false });
    reply.reject(unauthorized());
    await expect(Promise.all([silent, loud])).resolves.toEqual(['invalid', 'invalid']);
    expect(sessionStorage.getItem('cc-auth-notice')).toBe('session_expired');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('leaves the notice alone when every caller was silent', async () => {
    postMock.mockRejectedValueOnce(unauthorized());
    await expect(useAuthStore.getState().refreshToken({ silent: true })).resolves.toBe('invalid');
    expect(sessionStorage.getItem('cc-auth-notice')).toBeNull();
  });
});
