import { describe, it, expect, vi } from 'vitest';
import {
  getIndexNowConfig,
  filterSubmittableUrls,
  buildPayload,
  submitUrls,
  dailyArchiveUrl,
  MAX_URLS_PER_REQUEST,
} from './indexNow';

const ENV = {
  INDEXNOW_KEY: 'a005712f9fb74d1a9483320e23805107',
  PUBLIC_SITE_URL: 'https://borderfall.gg',
} as NodeJS.ProcessEnv;

describe('getIndexNowConfig', () => {
  it('derives host and keyLocation from the site URL', () => {
    expect(getIndexNowConfig(ENV)).toEqual({
      key: 'a005712f9fb74d1a9483320e23805107',
      host: 'borderfall.gg',
      keyLocation: 'https://borderfall.gg/a005712f9fb74d1a9483320e23805107.txt',
    });
  });

  it('is unconfigured (null, not an error) without a key', () => {
    expect(getIndexNowConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(getIndexNowConfig({ INDEXNOW_KEY: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('refuses a key that could not be served at <key>.txt', () => {
    // The protocol proves host control by serving the key at a path built from
    // it. A key with a slash, a space or a dot cannot round-trip, so sending it
    // would just be a guaranteed 403 against a third party.
    for (const bad of ['short', 'has space', 'has/slash', 'has.dot', 'a'.repeat(200)]) {
      expect(getIndexNowConfig({ ...ENV, INDEXNOW_KEY: bad }), bad).toBeNull();
    }
  });

  it('tolerates a trailing slash on the site URL', () => {
    const cfg = getIndexNowConfig({ ...ENV, PUBLIC_SITE_URL: 'https://borderfall.gg/' });
    expect(cfg?.keyLocation).toBe('https://borderfall.gg/a005712f9fb74d1a9483320e23805107.txt');
  });
});

describe('filterSubmittableUrls', () => {
  it('keeps on-host URLs and drops everything else', () => {
    const out = filterSubmittableUrls(
      [
        'https://borderfall.gg/answers',
        'https://borderfall.gg/daily/2026-09-12',
        'https://evil.test/borderfall.gg',      // other host
        'https://www.borderfall.gg/answers',    // different hostname
        'not a url',
        'ftp://borderfall.gg/x',                // wrong scheme
      ],
      'borderfall.gg',
    );
    expect(out).toEqual([
      'https://borderfall.gg/answers',
      'https://borderfall.gg/daily/2026-09-12',
    ]);
  });

  it('de-duplicates', () => {
    const out = filterSubmittableUrls(
      ['https://borderfall.gg/answers', 'https://borderfall.gg/answers'],
      'borderfall.gg',
    );
    expect(out).toHaveLength(1);
  });
});

describe('buildPayload', () => {
  const cfg = getIndexNowConfig(ENV)!;

  it('builds the documented shape', () => {
    expect(buildPayload(['https://borderfall.gg/answers'], cfg)).toEqual({
      host: 'borderfall.gg',
      key: 'a005712f9fb74d1a9483320e23805107',
      keyLocation: 'https://borderfall.gg/a005712f9fb74d1a9483320e23805107.txt',
      urlList: ['https://borderfall.gg/answers'],
    });
  });

  it('is null when nothing survives filtering', () => {
    expect(buildPayload(['https://elsewhere.test/x'], cfg)).toBeNull();
    expect(buildPayload([], cfg)).toBeNull();
  });

  it('caps at the protocol limit', () => {
    const many = Array.from({ length: MAX_URLS_PER_REQUEST + 50 }, (_, i) => `https://borderfall.gg/p/${i}`);
    expect(buildPayload(many, cfg)!.urlList).toHaveLength(MAX_URLS_PER_REQUEST);
  });
});

describe('submitUrls', () => {
  it('skips silently when unconfigured — never throws, never calls out', async () => {
    const fetchImpl = vi.fn();
    const res = await submitUrls(['https://borderfall.gg/answers'], {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.skipped).toBe('unconfigured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips when no URL is submittable', async () => {
    const fetchImpl = vi.fn();
    const res = await submitUrls(['https://elsewhere.test/x'], {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.skipped).toBe('no-urls');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs the payload as JSON and reports the status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200 });
    const res = await submitUrls(['https://borderfall.gg/daily/2026-09-12'], {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toMatchObject({ submitted: 1, status: 200, skipped: null });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      host: 'borderfall.gg',
      urlList: ['https://borderfall.gg/daily/2026-09-12'],
    });
  });

  it('swallows a rejection — a bad key must not throw into a caller', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 403 });
    const res = await submitUrls(['https://borderfall.gg/answers'], {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.status).toBe(403);
  });

  it('swallows a network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const res = await submitUrls(['https://borderfall.gg/answers'], {
      env: ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.submitted).toBe(0);
    expect(res.error).toContain('ECONNRESET');
  });
});

describe('dailyArchiveUrl', () => {
  it('builds the public archive URL for a settled day', () => {
    expect(dailyArchiveUrl('2026-09-12', ENV)).toBe('https://borderfall.gg/daily/2026-09-12');
  });
});
