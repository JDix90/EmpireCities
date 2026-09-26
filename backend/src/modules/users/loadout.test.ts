import { describe, it, expect } from 'vitest';
import { effectiveLoadout, type LoadoutRow } from './loadout';

const row = (over: Partial<LoadoutRow>): LoadoutRow => ({
  equipped_frame: null,
  equipped_frame_type: null,
  equipped_banner: null,
  equipped_marker: null,
  equipped_dice: null,
  ...over,
});

describe('effectiveLoadout', () => {
  it('reads each slot as stored', () => {
    expect(effectiveLoadout(row({
      equipped_frame: 'frame_gold', equipped_frame_type: 'profile_frame',
      equipped_banner: 'general_banner', equipped_marker: 'marker_crown', equipped_dice: 'bone_dice',
    }))).toEqual({ frame: 'frame_gold', banner: 'general_banner', marker: 'marker_crown', dice: 'bone_dice' });
  });

  it('reads a banner in the frame slot as the banner, and no frame', () => {
    expect(effectiveLoadout(row({ equipped_frame: 'general_banner', equipped_frame_type: 'profile_banner' })))
      .toMatchObject({ frame: null, banner: 'general_banner' });
  });

  it('prefers a banner in the frame slot over the banner slot, which is older', () => {
    // Worn with the flag on, then the flag went off and the old route put
    // another banner in the frame slot.
    expect(effectiveLoadout(row({
      equipped_frame: 'emperor_title', equipped_frame_type: 'profile_banner', equipped_banner: 'general_banner',
    }))).toMatchObject({ frame: null, banner: 'emperor_title' });
  });

  it('keeps an id missing from the catalog as a frame (renderers skip ids they do not know)', () => {
    expect(effectiveLoadout(row({ equipped_frame: 'frame_gone', equipped_frame_type: null })))
      .toMatchObject({ frame: 'frame_gone', banner: null });
  });
});
