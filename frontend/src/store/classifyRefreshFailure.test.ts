import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { classifyRefreshFailure } from './authStore';

function axiosErrorWithStatus(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('rejected', 'ERR_BAD_REQUEST', config, {}, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config,
  } as never);
}

function networkError(): AxiosError {
  // No response object — connection refused / DNS failure / timeout.
  return new AxiosError('Network Error', 'ERR_NETWORK', { headers: new AxiosHeaders() });
}

describe('classifyRefreshFailure', () => {
  it('treats 401 as an invalid session', () => {
    expect(classifyRefreshFailure(axiosErrorWithStatus(401))).toBe('invalid');
  });

  it('treats 403 as an invalid session', () => {
    expect(classifyRefreshFailure(axiosErrorWithStatus(403))).toBe('invalid');
  });

  it('treats a network error as unreachable — the session must survive', () => {
    expect(classifyRefreshFailure(networkError())).toBe('unreachable');
  });

  it('treats 5xx as unreachable — a broken server is not an expired cookie', () => {
    expect(classifyRefreshFailure(axiosErrorWithStatus(502))).toBe('unreachable');
    expect(classifyRefreshFailure(axiosErrorWithStatus(500))).toBe('unreachable');
  });

  it('treats unknown error shapes as unreachable', () => {
    expect(classifyRefreshFailure(new Error('boom'))).toBe('unreachable');
    expect(classifyRefreshFailure(undefined)).toBe('unreachable');
  });
});
