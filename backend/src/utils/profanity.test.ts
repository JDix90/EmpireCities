import { describe, it, expect } from 'vitest';
import { normalizeForMatch, isDisallowedUsername, maskMessage } from './profanity';

describe('normalizeForMatch', () => {
  it('lowercases, maps leet, and strips separators/digits', () => {
    expect(normalizeForMatch('F.U.C.K')).toBe('fuck');
    expect(normalizeForMatch('sh1t')).toBe('shit');
    expect(normalizeForMatch('Hello_World')).toBe('helloworld');
  });
});

describe('isDisallowedUsername', () => {
  it('rejects denylisted usernames including leet/underscore evasion', () => {
    expect(isDisallowedUsername('sh1tlord')).toBe(true);
    expect(isDisallowedUsername('shit_lord')).toBe(true);
    expect(isDisallowedUsername('b1tch')).toBe(true); // leet 1->i
  });
  it('allows clean usernames', () => {
    expect(isDisallowedUsername('CommanderJane')).toBe(false);
    expect(isDisallowedUsername('player_123')).toBe(false);
    expect(isDisallowedUsername('Napoleon')).toBe(false);
  });
});

describe('maskMessage', () => {
  it('masks offending tokens, preserving length, and leaves clean text alone', () => {
    expect(maskMessage('you are shit')).toBe('you are ****');
    expect(maskMessage('gg well played')).toBe('gg well played');
  });
  it('catches leet/separator evasion inside a token', () => {
    expect(maskMessage('total sh1t move')).toBe('total **** move');
  });
  it('does not over-mask innocent words (Scunthorpe guard)', () => {
    expect(maskMessage('class pass grass assistant')).toBe('class pass grass assistant');
  });
});
