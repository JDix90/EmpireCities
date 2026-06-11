import { describe, it, expect, vi } from 'vitest';
import { requireGuest } from './requireGuest';

describe('requireGuest', () => {
  it('returns 403 when requester is not a guest', async () => {
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    await requireGuest({ isGuest: false } as never, { status } as never);
    expect(status).toHaveBeenCalledWith(403);
    expect(send).toHaveBeenCalledWith({ error: 'Only guest accounts can be upgraded' });
  });

  it('passes through for guest sessions', async () => {
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    await requireGuest({ isGuest: true } as never, { status } as never);
    expect(status).not.toHaveBeenCalled();
  });
});
