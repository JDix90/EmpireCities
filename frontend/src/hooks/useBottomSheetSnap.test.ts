import { describe, expect, it } from 'vitest';
import {
  getNextSnap,
  getPrevSnap,
  resolveSnapFromDrag,
} from './useBottomSheetSnap';

describe('useBottomSheetSnap helpers', () => {
  it('steps through snap order', () => {
    expect(getNextSnap('peek')).toBe('half');
    expect(getNextSnap('half')).toBe('full');
    expect(getNextSnap('full')).toBe('full');
    expect(getPrevSnap('full')).toBe('half');
    expect(getPrevSnap('half')).toBe('peek');
    expect(getPrevSnap('peek')).toBe('peek');
  });

  it('dismisses when dragging down far from peek', () => {
    expect(resolveSnapFromDrag('peek', 90)).toBe('dismiss');
    expect(resolveSnapFromDrag('peek', 40)).toBe('peek');
  });

  it('collapses one level when dragging down from half or full', () => {
    expect(resolveSnapFromDrag('full', 60)).toBe('half');
    expect(resolveSnapFromDrag('half', 60)).toBe('peek');
  });

  it('expands when dragging up', () => {
    expect(resolveSnapFromDrag('peek', -60)).toBe('half');
    expect(resolveSnapFromDrag('half', -60)).toBe('full');
  });
});
