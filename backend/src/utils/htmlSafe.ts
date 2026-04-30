/**
 * Tiny HTML-escape helpers for the rare server-side paths that build HTML
 * (admin emails, moderation messages, etc.). Frontend should NEVER need this:
 * React's text-content escaping is the canonical safe path. If you find
 * yourself reaching for this in the frontend you're almost certainly setting
 * up an XSS vector — use createElement / textContent instead.
 */

const ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape characters that have meaning inside HTML element text content. */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ENTITY_MAP[ch] ?? ch);
}

/**
 * Escape characters that could break out of a quoted HTML attribute value.
 * Always pair with `"…"` (double quotes) in the surrounding template.
 */
export function escapeAttr(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ENTITY_MAP[ch] ?? ch);
}
