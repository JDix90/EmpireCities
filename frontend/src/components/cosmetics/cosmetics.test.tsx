import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  COSMETIC_GLYPHS,
  COSMETIC_LOOKS,
  bannerLook,
  cosmeticLook,
  diceLook,
  frameLook,
  markerLook,
} from '@borderfall/shared';
import BannerTag from './BannerTag';
import CosmeticPreview from './CosmeticPreview';
import FrameRing from './FrameRing';
import { diceEffectClass, diceFaceStyle } from './diceSkin';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

describe('cosmetic looks', () => {
  it('are drawable: known glyphs, hex colours, enough gradient stops', () => {
    for (const [id, look] of Object.entries(COSMETIC_LOOKS)) {
      const colours: string[] = [];
      switch (look.kind) {
        case 'frame':
          expect(look.ring.length, id).toBeGreaterThanOrEqual(2);
          colours.push(...look.ring, ...(look.glow ? [look.glow] : []));
          break;
        case 'banner':
          expect(COSMETIC_GLYPHS[look.glyph], id).toBeDefined();
          expect(look.label.trim(), id).not.toBe('');
          colours.push(look.color, look.background, look.trim);
          break;
        case 'marker':
          expect(COSMETIC_GLYPHS[look.glyph], id).toBeDefined();
          colours.push(look.color);
          break;
        case 'dice':
          expect(look.face.length, id).toBeGreaterThanOrEqual(1);
          colours.push(...look.face, look.ink, look.edge);
          break;
      }
      for (const colour of colours) expect(colour, id).toMatch(HEX);
    }
  });

  it('answer only for their own kind, and never for a missing id', () => {
    expect(frameLook('frame_gold')?.kind).toBe('frame');
    expect(frameLook('general_banner')).toBeNull();
    expect(bannerLook('general_banner')?.kind).toBe('banner');
    expect(bannerLook('frame_gold')).toBeNull();
    expect(markerLook('marker_crown')?.kind).toBe('marker');
    expect(diceLook('bone_dice')?.kind).toBe('dice');
    for (const id of [null, undefined, '', 'not_a_cosmetic', '__proto__', 'constructor', 'toString']) {
      expect(cosmeticLook(id)).toBeNull();
    }
  });
});

describe('FrameRing', () => {
  const avatar = <span>C</span>;

  it('rings the avatar in the frame’s colours', () => {
    const { container } = render(<FrameRing frameId="frame_gold">{avatar}</FrameRing>);
    const ring = screen.getByTestId('frame-ring');
    expect(ring.style.background).toContain('linear-gradient');
    expect(ring).not.toHaveClass('animate-frame-spin');
    expect(container.firstElementChild).toHaveAttribute('data-frame', 'frame_gold');
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('turns the rarest frames', () => {
    render(<FrameRing frameId="frame_s1_diamond">{avatar}</FrameRing>);
    expect(screen.getByTestId('frame-ring')).toHaveClass('animate-frame-spin');
  });

  it('draws the avatar alone, in the same space, for anything that is not a frame', () => {
    for (const id of [null, 'general_banner', 'frame_retired_long_ago']) {
      const { container, unmount } = render(<FrameRing frameId={id}>{avatar}</FrameRing>);
      expect(screen.queryByTestId('frame-ring')).not.toBeInTheDocument();
      expect(container.firstElementChild).toHaveClass('p-1');
      expect(screen.getByText('C')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('BannerTag', () => {
  it('names a glyph-only banner for screen readers', () => {
    render(<BannerTag bannerId="general_banner" />);
    expect(screen.getByRole('img', { name: 'General' })).toBeInTheDocument();
  });

  it('shows a title banner’s title', () => {
    render(<BannerTag bannerId="emperor_title" />);
    expect(screen.getByRole('img', { name: 'Emperor' })).toHaveTextContent('Emperor');
  });

  it('draws nothing for anything that is not a banner', () => {
    for (const id of [null, 'frame_gold', 'nope']) {
      const { container, unmount } = render(<BannerTag bannerId={id} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe('dice skins', () => {
  it('colour the face, the number and the border', () => {
    const style = diceFaceStyle(diceLook('bone_dice')!);
    expect(style.background).toContain('linear-gradient');
    expect(style.color).toBe('#4a3520');
    expect(style.border).toContain('#a8906a');
  });

  it('rock bone dice only while they roll, and always shimmer holographic ones', () => {
    expect(diceEffectClass(diceLook('bone_dice')!, true)).toBe('animate-dice-wobble');
    expect(diceEffectClass(diceLook('bone_dice')!, false)).toBeUndefined();
    expect(diceEffectClass(diceLook('holo_dice')!, false)).toBe('cosmetic-shimmer');
  });
});

describe('CosmeticPreview', () => {
  it.each([
    ['frame_level_50', 'profile_frame', 'frame'],
    ['emperor_title', 'profile_banner', 'banner'],
    ['marker_skull', 'map_marker', 'marker'],
    ['holo_dice', 'dice_skin', 'dice'],
  ])('shows %s as worn', (id, type, kind) => {
    render(<CosmeticPreview cosmeticId={id} type={type} initial="commander" />);
    const preview = screen.getByTestId('cosmetic-preview');
    expect(preview).toHaveAttribute('data-kind', kind);
    expect(preview).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows nothing for an item without a look of its type’s kind', () => {
    const { container } = render(
      <>
        <CosmeticPreview cosmeticId="general_banner" type="profile_frame" />
        <CosmeticPreview cosmeticId="roman_legionary" type="unit_skin" />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
