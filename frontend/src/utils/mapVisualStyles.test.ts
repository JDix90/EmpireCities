import { describe, it, expect } from 'vitest';
import { hexToRgb, lerpRgb, rgbToPixi } from './mapVisualStyles';

describe('mapVisualStyles', () => {
  it('hexToRgb parses 6-digit hex', () => {
    expect(hexToRgb('#e74c3c')).toEqual([231, 76, 60]);
  });

  it('lerpRgb interpolates toward target', () => {
    expect(lerpRgb([0, 0, 0], [100, 200, 255], 0.5)).toEqual([50, 100, 128]);
  });

  it('rgbToPixi packs components', () => {
    expect(rgbToPixi([255, 120, 50])).toBe(0xff7832);
  });
});
