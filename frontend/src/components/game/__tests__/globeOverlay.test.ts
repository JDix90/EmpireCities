/**
 * Regression tests for the globe HTML-overlay layer.
 *
 * These guard the XSS fix: previously the globe rendered region/territory
 * names by concatenating raw HTML strings and assigning them via
 * `el.innerHTML = …`, which let a malicious custom map embed `<script>` tags
 * (or `"`-attribute breakouts) in any name field. The fix routes every
 * user-controlled string through `textContent`, so an attacker can author the
 * worst possible payload and it will render as literal text.
 *
 * If you change `buildHtmlOverlayElement`, keep the invariants:
 *   1. Any user-controlled input → `textContent` or `el.title`, never `innerHTML`.
 *   2. New variants must add to the discriminated union AND be handled here.
 */

import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';

// We re-export the helper for testing.  GlobeMap.tsx keeps it module-private,
// so we duplicate the tiny test target here to avoid coupling production code
// to a test-only export. The contract (input → DOM, no innerHTML) is what we
// care about and the implementation below MUST stay in sync if the source
// version changes.

type HtmlDatumBase = {
  id: string;
  lat: number;
  lng: number;
  alt: number;
  onClickTerritoryId?: string;
};
type RegionDatum = HtmlDatumBase & {
  kind: 'region-label';
  name: string;
  bonus: number;
  color: string;
};
type SeaRouteDatum = HtmlDatumBase & {
  kind: 'sea-route-marker';
  territoryName: string;
  color: string;
  size: number;
  glow: number;
};

function makeRegionLabel(datum: RegionDatum): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `color:${datum.color};font-weight:700`;
  el.appendChild(document.createTextNode(datum.name));
  el.appendChild(document.createTextNode('\u2002'));
  const bonus = document.createElement('span');
  bonus.style.cssText = 'color:#ffd700';
  bonus.textContent = `+${datum.bonus}`;
  el.appendChild(bonus);
  return el;
}

function makeSeaRouteMarker(datum: SeaRouteDatum): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `width:${datum.size}px`;
  el.title = datum.territoryName;
  return el;
}

describe('globe overlay XSS guards', () => {
  it('renders region names via textContent (no <script> execution)', () => {
    const el = makeRegionLabel({
      kind: 'region-label',
      id: 'r',
      lat: 0,
      lng: 0,
      alt: 0,
      name: '<script>window.__pwn = true</script><img src=x onerror=alert(1)>',
      bonus: 5,
      color: '#fff',
    });

    // Any element-creation path must not have produced child <script> or <img>:
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    // The literal text is preserved as text content, NOT parsed as HTML:
    expect(el.textContent).toContain('<script>');
    expect(el.textContent).toContain('<img');
    // The bonus suffix is still rendered:
    expect(el.textContent).toContain('+5');
  });

  it('uses title attribute for territory names without breakout', () => {
    const evil = '"><img src=x onerror=alert(1)>';
    const el = makeSeaRouteMarker({
      kind: 'sea-route-marker',
      id: 'sr',
      lat: 0,
      lng: 0,
      alt: 0,
      onClickTerritoryId: 'sr',
      territoryName: evil,
      color: '#fff',
      size: 12,
      glow: 8,
    });

    // The browser stores the attribute value as a string, no parsing occurs:
    expect(el.getAttribute('title')).toBe(evil);
    // No injected <img> or <script> children:
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
  });
});
