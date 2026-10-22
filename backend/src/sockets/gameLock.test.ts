/**
 * Redlock reports every failed attempt on its 'error' event, retries included.
 * A busy game is not an error: the lock is doing its job, and the caller hears
 * about it itself if the retries run out. Logged with console.error, each one
 * reached Sentry (which captures console.error) as a ResourceLockedError.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionError, ResourceLockedError } from 'redlock';

vi.mock('../db/redis', () => ({ redis: {} }));

import { onRedlockError, redlock } from './gameLock';

describe('redlock errors', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it('says nothing when the game is busy', () => {
    onRedlockError(new ResourceLockedError('The operation was applied to: 0 of the 1 requested resources.'));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('is the listener redlock reports to', () => {
    redlock.emit('error', new ResourceLockedError('The operation was applied to: 0 of the 1 requested resources.'));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('still logs anything else, such as Redis failing', () => {
    const down = new Error('Connection is closed.');
    redlock.emit('error', down);
    expect(consoleError).toHaveBeenCalledWith('[Redlock] Unexpected error:', down);

    consoleError.mockClear();
    const other = new ExecutionError('The operation was unable to achieve a quorum during its retry window.', []);
    onRedlockError(other);
    expect(consoleError).toHaveBeenCalledWith('[Redlock] Unexpected error:', other);
  });
});
