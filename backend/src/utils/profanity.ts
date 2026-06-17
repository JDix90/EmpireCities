/**
 * Lightweight, dependency-free content moderation for usernames and chat.
 *
 * This is a STARTER denylist + normalizer for launch brand-safety — NOT a
 * complete solution. Trust & Safety should expand the list or, better, swap the
 * lookup for a managed moderation service (the public API here —
 * `isDisallowedUsername` / `maskMessage` — can stay the same).
 *
 * The value is the normalizer: it folds the most common evasion (leet-speak and
 * embedded separators) so `n1gg3r`, `f.u.c.k`, `s h i t`-within-a-token resolve
 * to the same base entries. It deliberately does NOT collapse repeated letters
 * (that causes Scunthorpe-style false positives like "class" → "clas"), so
 * stretched spellings ("fuuuck") can slip through — acceptable for a basic
 * first-pass filter, and the kind of gap a managed service later closes.
 */

// Leet / homoglyph folding applied before matching.
const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i',
};

/**
 * Base denylist terms (already normalized: lowercase a–z only). Substring-matched
 * against normalized input, so a base like `nigg` catches `nigga`/`n1gg3r`.
 * Slurs are prioritized (brand safety); a handful of strong profanities are
 * included. Terms that are common substrings of innocent words (e.g. bare "ass")
 * are intentionally omitted to limit false positives. EXPAND via Trust & Safety.
 */
const DENYLIST: readonly string[] = [
  // Slurs (the brand-safety priority).
  'nigg', 'faggot', 'fagg', 'retard', 'tranny', 'chink', 'spic', 'kike',
  'wetback', 'coon', 'gook', 'beaner', 'cripple',
  // Strong profanity (reasonably substring-safe).
  'fuck', 'shit', 'bitch', 'cunt', 'bastard', 'whore', 'slut', 'douche',
  'wanker', 'bollocks', 'pussy', 'cock', 'dickhead', 'asshole', 'jackass',
  'motherfucker',
];

/**
 * Fold a string to a comparison form: lowercase, map leet/homoglyphs, and drop
 * everything that isn't a–z (so separators, spaces, digits and punctuation used
 * to break up a word disappear). Exported for testing the evasion handling.
 */
export function normalizeForMatch(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    const mapped = LEET[ch] ?? ch;
    if (mapped >= 'a' && mapped <= 'z') out += mapped;
  }
  return out;
}

/**
 * True if `name` contains a denylisted term once normalized. Used at
 * registration/upgrade. Usernames are a single adversarial token, so we match
 * by substring; a rare false positive just means the user picks another name.
 */
export function isDisallowedUsername(name: string): boolean {
  const normalized = normalizeForMatch(name);
  return DENYLIST.some((term) => normalized.includes(term));
}

/**
 * Mask any chat token whose normalized form contains a denylisted term, e.g.
 * "you f.u.c.k" → "you *****". Operates per whitespace-token so it preserves
 * spacing and limits over-masking; the original token length is preserved as
 * asterisks. Non-offending text is returned unchanged.
 */
export function maskMessage(text: string): string {
  return text.replace(/\S+/g, (token) => {
    const normalized = normalizeForMatch(token);
    if (!normalized) return token;
    return DENYLIST.some((term) => normalized.includes(term))
      ? '*'.repeat(token.length)
      : token;
  });
}
