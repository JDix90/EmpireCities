/**
 * The native app's `native-app` class on <html>, and the CSS that hangs off
 * it: a long press selects no text and raises no callout in the app, text
 * boxes still work, and nothing changes in a browser.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Capacitor } from '@capacitor/core';
import { markNativeAppDocument, NATIVE_APP_CLASS } from './nativeApp';

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove(NATIVE_APP_CLASS);
});

describe('markNativeAppDocument', () => {
  it('leaves a browser page unmarked', () => {
    markNativeAppDocument();
    expect(document.documentElement.classList.contains(NATIVE_APP_CLASS)).toBe(false);
  });

  it('marks the page inside the app', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    markNativeAppDocument();
    expect(document.documentElement.classList.contains(NATIVE_APP_CLASS)).toBe(true);
  });
});

describe('the app-only CSS in index.css', () => {
  const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));

  it('turns off selection and the long-press callout only under html.native-app', () => {
    const off = rules.filter((r) => /user-select:\s*none|touch-callout:\s*none/.test(r.body));
    expect(off.length).toBeGreaterThan(0);
    for (const r of off) expect(r.sel.split('\n').pop()!.trim()).toMatch(/^html\.native-app\b/);
  });

  it('keeps text boxes selectable in the app', () => {
    const on = rules.find((r) => /html\.native-app :is\(input, textarea/.test(r.sel));
    expect(on?.body).toMatch(/user-select:\s*text/);
  });

  it('matches the class main.tsx sets', () => {
    expect(css).toContain(`html.${NATIVE_APP_CLASS} body`);
  });
});
