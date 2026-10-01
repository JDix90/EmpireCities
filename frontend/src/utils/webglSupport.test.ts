import { describe, it, expect, vi, afterEach } from 'vitest';

/** A fresh copy of the module, so each test starts unprobed. */
async function load() {
  vi.resetModules();
  return import('./webglSupport');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webglAvailable', () => {
  it('says yes when a canvas hands out a WebGL context, and asks only once', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never);
    const { webglAvailable } = await load();
    expect(webglAvailable()).toBe(true);
    expect(webglAvailable()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('webgl');
  });

  it("hands the probe's own context straight back", async () => {
    const loseContext = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null),
    } as never);
    const { webglAvailable } = await load();
    expect(webglAvailable()).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('falls back to the experimental context name', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(((kind: string) => (kind === 'experimental-webgl' ? {} : null)) as never);
    const { webglAvailable } = await load();
    expect(webglAvailable()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(2);
  });

  it('says no without a context, or when asking throws', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect((await load()).webglAvailable()).toBe(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('blocked'); });
    expect((await load()).webglAvailable()).toBe(false);
  });
});
