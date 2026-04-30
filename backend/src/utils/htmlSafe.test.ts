import { describe, expect, it } from 'vitest';
import { escapeAttr, escapeHtml } from './htmlSafe';

describe('escapeHtml', () => {
  it('escapes the five canonical HTML entity characters', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)" />')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot; /&gt;',
    );
  });

  it('escapes apostrophes so single-quoted attributes stay safe', () => {
    expect(escapeHtml("O'Reilly")).toBe('O&#39;Reilly');
  });

  it('passes through plain text untouched', () => {
    expect(escapeHtml('Hello world!')).toBe('Hello world!');
  });

  it('escapes ampersand first to avoid double-encoding', () => {
    expect(escapeHtml('A & B < C')).toBe('A &amp; B &lt; C');
  });
});

describe('escapeAttr', () => {
  it('blocks attribute breakout via double-quote', () => {
    const input = '"><script>alert(1)</script>';
    const out = escapeAttr(input);
    expect(out).not.toContain('"');
    expect(out).not.toContain('<');
  });
});
