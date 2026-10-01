/**
 * The app's error screen reports what it catches to Sentry. Once React has
 * caught an error, a production build never hands it to Sentry's global
 * handlers, so without this a crash behind the screen went unrecorded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const sentry = vi.hoisted(() => ({ captureReactException: vi.fn() }));
vi.mock('@sentry/react', () => sentry);

import ErrorBoundary from './ErrorBoundary';

const boom = new Error('boom');
function Boom(): never {
  throw boom;
}

beforeEach(() => {
  sentry.captureReactException.mockClear();
  // React and the boundary both log the crash.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('reports a crash to Sentry, with where it happened, as unhandled', () => {
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(sentry.captureReactException).toHaveBeenCalledTimes(1);
    const [error, info, hint] = sentry.captureReactException.mock.calls[0];
    expect(error).toBe(boom);
    expect(info.componentStack).toContain('Boom');
    expect(hint).toEqual({ mechanism: { type: 'auto.function.react.error_boundary', handled: false } });
  });

  it('marks it handled where a fallback stands in', () => {
    render(<ErrorBoundary fallback={<p>Fallback</p>}><Boom /></ErrorBoundary>);
    expect(screen.getByText('Fallback')).toBeInTheDocument();
    expect(sentry.captureReactException.mock.calls[0][2])
      .toEqual({ mechanism: { type: 'auto.function.react.error_boundary', handled: true } });
  });

  it('reports nothing while nothing has crashed', () => {
    render(<ErrorBoundary><p>Fine</p></ErrorBoundary>);
    expect(screen.getByText('Fine')).toBeInTheDocument();
    expect(sentry.captureReactException).not.toHaveBeenCalled();
  });
});
