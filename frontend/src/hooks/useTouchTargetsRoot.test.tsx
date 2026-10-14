/**
 * Phone touch targets (`touch_targets_enabled`): the hook marks the document,
 * and index.css's `.tap-target` / `.tap-min` only apply under that mark.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useTouchTargetsRoot } from './useTouchTargetsRoot';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, touch_targets_enabled: on } }));

function Probe() {
  useTouchTargetsRoot();
  return null;
}

const mark = () => document.documentElement.dataset.touchTargets;

describe('useTouchTargetsRoot', () => {
  afterEach(() => setFlag(false));

  it('marks the document while the flag is on, and unmarks it when it goes off', () => {
    setFlag(true);
    render(<Probe />);
    expect(mark()).toBe('on');
    act(() => setFlag(false));
    expect(mark()).toBeUndefined();
  });

  it('leaves the document unmarked with the flag off', () => {
    setFlag(false);
    render(<Probe />);
    expect(mark()).toBeUndefined();
  });

  it('unmarks the document on unmount', () => {
    setFlag(true);
    const { unmount } = render(<Probe />);
    unmount();
    expect(mark()).toBeUndefined();
  });
});
