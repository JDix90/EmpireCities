import { describe, it, expect } from 'vitest';
import { Semaphore } from './aiConcurrency';

describe('Semaphore', () => {
  it('allows up to max concurrent and queues the rest (FIFO)', async () => {
    const sem = new Semaphore(2);
    const r1 = await sem.acquire();
    await sem.acquire();
    expect(sem.activeCount).toBe(2);

    let r3acquired = false;
    const p3 = sem.acquire().then((rel) => {
      r3acquired = true;
      return rel;
    });
    await Promise.resolve();
    expect(r3acquired).toBe(false);
    expect(sem.queuedCount).toBe(1);

    r1(); // releasing one slot lets the queued acquire proceed
    await p3;
    expect(r3acquired).toBe(true);
    expect(sem.activeCount).toBe(2);
  });

  it('release is one-shot (double-release is a no-op)', async () => {
    const sem = new Semaphore(1);
    const rel = await sem.acquire();
    rel();
    rel();
    expect(sem.activeCount).toBe(0);
    const rel2 = await sem.acquire();
    expect(sem.activeCount).toBe(1);
    rel2();
  });

  it('never exceeds max under a burst of 20 contending tasks', async () => {
    const sem = new Semaphore(3);
    let peak = 0;
    let active = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        (async () => {
          const rel = await sem.acquire();
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 1));
          active--;
          rel();
        })(),
      ),
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(sem.activeCount).toBe(0);
  });
});
