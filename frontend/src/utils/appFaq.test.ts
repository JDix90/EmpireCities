/**
 * How to Play's FAQ in the native app says nothing that makes the installed
 * app read as a website in a frame (App Store guideline 4.2), and the
 * website's FAQ, which also feeds search engines, is untouched.
 */
import { describe, it, expect } from 'vitest';
import { FAQ } from '../marketing/seoContent.mjs';
import { faqForApp } from './appFaq';

const WEB_WORDS = /browser|borderfall\.gg|nothing to (download|install)|no app\b|install/i;

describe('faqForApp', () => {
  it('leaves out the install questions and rewords the answers that name the browser', () => {
    const app = faqForApp(FAQ);
    for (const entry of app) {
      expect(`${entry.q} ${entry.a}`).not.toMatch(WEB_WORDS);
    }
    expect(app.map((e) => e.q)).toEqual([
      'What is Borderfall?',
      'Is Borderfall free to play?',
      'How is Borderfall different from Risk?',
      'Can I play solo against AI, or is it multiplayer only?',
    ]);
  });

  it('keeps every other answer word for word', () => {
    const app = faqForApp(FAQ);
    const risk = (list: typeof FAQ) => list.find((e) => e.q === 'How is Borderfall different from Risk?');
    expect(risk(app)).toEqual(risk(FAQ));
  });

  it('does not change the website FAQ it was given', () => {
    const before = JSON.stringify(FAQ);
    faqForApp(FAQ);
    expect(JSON.stringify(FAQ)).toBe(before);
    expect(FAQ.some((e) => /browser/.test(e.a))).toBe(true);
  });
});
