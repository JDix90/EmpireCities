/**
 * Phone touch targets: the hook marks the document, and index.css's
 * `.tap-target` / `.tap-min` only apply under that mark.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useTouchTargetsRoot } from './useTouchTargetsRoot';

function Probe() {
  useTouchTargetsRoot();
  return null;
}

const mark = () => document.documentElement.dataset.touchTargets;

describe('useTouchTargetsRoot', () => {
  it('marks the document while mounted', () => {
    expect(mark()).toBeUndefined();
    render(<Probe />);
    expect(mark()).toBe('on');
  });

  it('unmarks the document on unmount', () => {
    const { unmount } = render(<Probe />);
    unmount();
    expect(mark()).toBeUndefined();
  });
});
