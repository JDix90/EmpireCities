import { describe, it, expect, vi } from 'vitest';
import { requireAdmin } from './requireAdmin';

describe('requireAdmin', () => {
  it('returns 403 when requester is not admin', async () => {
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    await requireAdmin({ isAdmin: false } as any, { status } as any);
    expect(status).toHaveBeenCalledWith(403);
    expect(send).toHaveBeenCalledWith({ error: 'Admin access required' });
  });

  it('passes through for admin user', async () => {
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    await requireAdmin({ isAdmin: true } as any, { status } as any);
    expect(status).not.toHaveBeenCalled();
  });
});
