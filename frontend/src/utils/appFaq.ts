import type { FaqEntry } from '../marketing/seoContent.d.mts';

/**
 * The site-wide FAQ as the native app shows it on How to Play.
 *
 * `FAQ` in marketing/seoContent.mjs is written for the website and for search
 * engines: it says Borderfall runs "in your browser" at borderfall.gg with
 * "nothing to install". Inside the installed app that reads as a website in a
 * frame, which is the impression App Store guideline 4.2 rejects apps for. So
 * the app rewords the two answers that say it and leaves out the two questions
 * that only make sense in a browser. The website's FAQ, and the structured
 * data built from it, are untouched.
 */
const APP_ANSWERS: Record<string, string> = {
  'What is Borderfall?':
    'Borderfall is a free turn-based strategy game. You command armies on a world map, take '
    + 'territory from your neighbors, and try to be the last one standing. As a game runs on, your '
    + 'civilization climbs through the historical eras, from ancient legions to a galactic age.',
  'Is Borderfall free to play?':
    'Yes. You can jump straight into a game as a guest without making an account.',
};

/** Questions about installing it or which browser it needs: the app is already installed. */
const WEB_ONLY_QUESTIONS = new Set([
  'Do I need to download or install anything?',
  'What do I need to play Borderfall?',
]);

export function faqForApp(faq: readonly FaqEntry[]): FaqEntry[] {
  return faq
    .filter((entry) => !WEB_ONLY_QUESTIONS.has(entry.q))
    .map((entry) => (entry.q in APP_ANSWERS ? { q: entry.q, a: APP_ANSWERS[entry.q] } : entry));
}
