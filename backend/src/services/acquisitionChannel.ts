/**
 * Bucket a first-touch acquisition source into a channel.
 *
 * The funnel already groups signups by source (`utm_source` → referrer host →
 * 'direct'), which is the right grain for judging one campaign but the wrong
 * grain for the question that matters now: is the assistant-referral channel
 * growing? That answer is currently spread across a dozen host strings, and a
 * new assistant appearing reads as noise rather than as the same channel
 * gaining a member.
 *
 * ── Two things this measurement genuinely cannot do ─────────────────────────
 *
 * 1. **Referrer-less assistants land in `direct`.** ChatGPT appends
 *    `utm_source=chatgpt.com` to the links it serves, which is why it shows up
 *    at all. Desktop and mobile assistant apps, and several web assistants,
 *    send no referrer — those visits are indistinguishable from someone typing
 *    the URL. So `llm` is a FLOOR, not a measurement, and `direct` is a mixed
 *    bucket. Treat a rise in both together as the same story.
 * 2. **Google's AI surfaces refer as `google.com`.** An AI Overview citation
 *    and a blue-link click arrive identically, so they both count as `search`.
 *
 * Neither is fixable from here; the fix is asking people (see the referral
 * survey) and reading the two numbers together. Say so wherever this is
 * reported, rather than letting a clean-looking table imply precision it does
 * not have.
 */

export type AcquisitionChannel = 'llm' | 'search' | 'social' | 'referral' | 'direct';

/**
 * Hosts (and the `utm_source` tokens assistants stamp on their links) that mean
 * "an AI assistant sent this person". Matched as an exact host or as a dot
 * suffix, so `www.perplexity.ai` matches `perplexity.ai` while a lookalike
 * domain such as `perplexity.ai.evil.test` does not.
 */
export const LLM_SOURCES = [
  'chatgpt.com',
  'chat.openai.com',
  'openai.com',
  'chatgpt',
  'openai',
  'perplexity.ai',
  'perplexity',
  'claude.ai',
  'claude',
  'anthropic.com',
  'gemini.google.com',
  'bard.google.com',
  'gemini',
  'copilot.microsoft.com',
  'copilot',
  'poe.com',
  'you.com',
  'phind.com',
  'grok.com',
  'x.ai',
  'meta.ai',
  'chat.mistral.ai',
  'duckduckgo.com/chat',
] as const;

/** Traditional search engines, including Google's AI surfaces (see the note above). */
export const SEARCH_SOURCES = [
  'google.com',
  'google',
  'bing.com',
  'bing',
  'duckduckgo.com',
  'duckduckgo',
  'search.yahoo.com',
  'yahoo.com',
  'yandex.com',
  'yandex.ru',
  'baidu.com',
  'ecosia.org',
  'search.brave.com',
  'startpage.com',
  'qwant.com',
] as const;

export const SOCIAL_SOURCES = [
  'reddit.com',
  'reddit',
  'twitter.com',
  'x.com',
  't.co',
  'twitter',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'discord.com',
  'discord.gg',
  'linkedin.com',
  'news.ycombinator.com',
  'hn',
  'mastodon.social',
  'bsky.app',
  'threads.net',
  'tumblr.com',
  'pinterest.com',
] as const;

/** Exact host, or a dot-boundary subdomain of it. Never a bare substring. */
function matches(source: string, candidates: readonly string[]): boolean {
  return candidates.some((c) => source === c || source.endsWith(`.${c}`));
}

/**
 * `source` is whatever the funnel recorded: a `utm_source` token, a referrer
 * host, or the literal 'direct'. Unknown non-empty sources are `referral` —
 * a real external site we simply have no rule for.
 */
export function classifyAcquisitionSource(source: string): AcquisitionChannel {
  const s = String(source ?? '').trim().toLowerCase().replace(/^www\./, '');
  if (!s || s === 'direct' || s === '(direct)' || s === 'none') return 'direct';
  if (matches(s, LLM_SOURCES)) return 'llm';
  if (matches(s, SEARCH_SOURCES)) return 'search';
  if (matches(s, SOCIAL_SOURCES)) return 'social';
  return 'referral';
}

/** Display order: the two we are actively trying to move come first. */
export const CHANNEL_ORDER: AcquisitionChannel[] = ['llm', 'search', 'social', 'referral', 'direct'];

export const CHANNEL_LABELS: Record<AcquisitionChannel, string> = {
  llm: 'AI assistants',
  search: 'Search engines',
  social: 'Social / community',
  referral: 'Other referrers',
  direct: 'Direct / unattributed',
};
