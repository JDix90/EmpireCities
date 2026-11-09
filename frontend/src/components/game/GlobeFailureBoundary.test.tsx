/**
 * The globe failing to get a WebGL context ("Error creating WebGL context." in
 * Sentry, from an iPhone) no longer fails the map panel. It gets one more try a
 * moment later; failing that, the map area offers the 2D map. Other errors go
 * on to the panel boundary as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';

const capture = vi.hoisted(() => vi.fn());
vi.mock('@sentry/react', () => ({ captureException: capture }));

import GlobeFailureBoundary, { GLOBE_RETRY_DELAY_MS, isWebGLContextError } from './GlobeFailureBoundary';

/**
 * A globe that throws `error` while `ctl.failing`, then draws. A flag rather
 * than a count of mounts: React renders a component again after it throws.
 */
function flakyGlobe(error = new Error('Error creating WebGL context.')) {
  const ctl = { failing: true };
  function Globe() {
    if (ctl.failing) throw error;
    return <p>globe drawn</p>;
  }
  return { Globe, ctl };
}

class Outer extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { return this.state.error ? <p>panel boundary: {this.state.error.message}</p> : this.props.children; }
}

describe('the globe without a WebGL context', () => {
  beforeEach(() => {
    capture.mockReset();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('recognises three.js\'s error', () => {
    expect(isWebGLContextError(new Error('Error creating WebGL context.'))).toBe(true);
    expect(isWebGLContextError(new TypeError('x is undefined'))).toBe(false);
  });

  it('tries again a moment later, and a globe that then starts is just drawn', () => {
    const { Globe, ctl } = flakyGlobe();
    render(<GlobeFailureBoundary onUseFlatMap={() => {}}><Globe /></GlobeFailureBoundary>);
    expect(screen.queryByText('globe drawn')).toBeNull();
    expect(screen.queryByTestId('globe-unavailable')).toBeNull();
    ctl.failing = false; // the contexts given back are freed in the meantime
    act(() => { vi.advanceTimersByTime(GLOBE_RETRY_DELAY_MS); });
    expect(screen.getByText('globe drawn')).toBeInTheDocument();
    expect(capture).not.toHaveBeenCalled();
  });

  it('offers the 2D map when the second try fails too, and reports it as handled', () => {
    const useFlat = vi.fn();
    const { Globe } = flakyGlobe();
    render(<GlobeFailureBoundary onUseFlatMap={useFlat}><Globe /></GlobeFailureBoundary>);
    act(() => { vi.advanceTimersByTime(GLOBE_RETRY_DELAY_MS); });
    expect(screen.getByTestId('globe-unavailable')).toHaveTextContent(/The 3D globe couldn.t start/);
    fireEvent.click(screen.getByRole('button', { name: /Use the 2D map/ }));
    expect(useFlat).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]![1]).toMatchObject({ level: 'warning', tags: { globe_fallback: 'webgl_context' } });
  });

  it('lets the player try again from the notice', () => {
    const { Globe, ctl } = flakyGlobe();
    render(<GlobeFailureBoundary><Globe /></GlobeFailureBoundary>);
    act(() => { vi.advanceTimersByTime(GLOBE_RETRY_DELAY_MS); });
    expect(screen.queryByRole('button', { name: /Use the 2D map/ })).toBeNull(); // nothing to switch to here
    ctl.failing = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.getByText('globe drawn')).toBeInTheDocument();
  });

  it('passes any other error on to the panel boundary', () => {
    const { Globe } = flakyGlobe(new TypeError('x is undefined'));
    render(<Outer><GlobeFailureBoundary><Globe /></GlobeFailureBoundary></Outer>);
    expect(screen.getByText('panel boundary: x is undefined')).toBeInTheDocument();
    expect(capture).not.toHaveBeenCalled();
  });
});
