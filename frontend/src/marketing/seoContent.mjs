/**
 * Single source of truth for the crawlable marketing copy.
 *
 * Consumed by BOTH:
 *   - the build-time prerender script (frontend/scripts/prerender-marketing.mjs,
 *     plain Node) which turns these blocks into static, no-JS HTML, and
 *   - the live React `/eras` page (src/pages/ErasPage.tsx).
 *
 * Keeping it framework-free (plain data + ESM) is what lets one file feed a
 * Node script and a Vite/React module without drift. If you edit copy here it
 * updates the crawlable HTML and the live SPA page together.
 *
 * Voice note: keep this copy human — short declaratives over em-dash chains,
 * concrete images over abstract "what sets us apart" claims. (Any inline
 * `// TODO` comments below are plain JS comments and never reach the HTML.)
 */

import { FACTION_CODEX, FACTION_COUNT } from './factionCodex.generated.mjs';
import { buildMapMarketingPages } from './mapPages.mjs';
import { buildEraMarketingPages } from './eraPages.mjs';

export const SITE_URL = 'https://borderfall.gg';
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

/**
 * Official profile URLs for the game. Populated as the accounts go live, then
 * surfaced as `sameAs` in the VideoGame structured data — this is what tells
 * Google and AI answer engines that all of these belong to the SAME entity
 * (the Borderfall game), which is exactly the disambiguation we need against
 * the unrelated "Borderfall" locations/items in other games. Leave entries out
 * until the profile actually exists (a `sameAs` pointing at a 404 hurts).
 */
export const SOCIAL_LINKS = [
  'https://www.reddit.com/r/borderfall',
  'https://www.reddit.com/user/borderfall',
];

/**
 * Q&A shown on /how-to-play (visible to users AND crawlers) and emitted as
 * FAQPage structured data. The first answer states plainly that Borderfall is a
 * free, standalone, browser-based game — the direct, machine-readable counter
 * to search engines concluding it's "not a standalone game."
 */
export const FAQ = [
  {
    q: 'What is Borderfall?',
    a:
      'Borderfall is a free, browser-based turn-based strategy game you play at borderfall.gg, with '
      + 'nothing to download. You command armies on a world map, take territory from your neighbors, '
      + 'and try to be the last one standing. As a game runs on, your civilization climbs through the '
      + 'historical eras, from ancient legions to a galactic age. (If you searched the name and found a '
      + 'town from another game, that is something else. This one is a standalone game.)',
  },
  {
    q: 'Is Borderfall free to play?',
    a:
      'It is free in your browser, and you can jump straight into a game as a guest without making '
      + 'an account.',
  },
  {
    q: 'Do I need to download or install anything?',
    a:
      'Nothing to install. It runs in any modern browser on desktop or mobile; open borderfall.gg '
      + 'and you are playing.',
  },
  {
    q: 'How is Borderfall different from Risk?',
    a:
      'It keeps the dice-and-territory core Risk players know, but one game advances through nine '
      + 'historical eras, from ancient kingdoms to a galactic age, each adding new units, technologies, '
      + 'and theaters of war. Optional layers like economy, tech trees, naval warfare, and asymmetric '
      + 'factions add depth without touching the core rules.',
  },
  {
    q: 'Can I play solo against AI, or is it multiplayer only?',
    a:
      'You can do either. Play instantly against AI opponents (Easy to Expert), or take on real '
      + 'people, whether friends in a private lobby or matched opponents, in real-time or asynchronous '
      + 'games of 2 to 8 players.',
  },
  {
    q: 'What do I need to play Borderfall?',
    a:
      'Any modern browser (Chrome, Safari, Firefox, or Edge) on a phone, tablet, or computer. '
      + 'Nothing to install, no console, no app.',
  },
];

/**
 * Era id → display label for the faction codex.
 *
 * Lives here rather than in the generated file because it is COPY, and the
 * generated file holds only what the game engine owns. It must stay identical
 * to `ERA_LABELS` in src/constants/gameLobbyLabels.ts — the prerendered HTML
 * and the React page show the same headings, and a mismatch between what a
 * crawler is served and what a visitor sees is the definition of cloaking.
 * `seoContent.test.ts` asserts the two maps agree.
 *
 * (Distinct from `ERAS` below, which is the nine-era marketing arc for /eras
 * and carries no ids.)
 */
export const ERA_CODEX_LABELS = {
  ancient: 'Ancient World',
  medieval: 'Medieval Era',
  discovery: 'Age of Discovery',
  ww2: 'World War II',
  coldwar: 'Cold War',
  modern: 'Modern Day',
  acw: 'American Civil War',
  risorgimento: 'Italian Unification',
  space_age: 'Space Age',
  galaxy_age: 'Galactic Age',
};

/**
 * The nine-era arc, in chronological order, from ancient kingdoms to galactic
 * fronts. These are real, playable eras in Borderfall. (The American Civil War
 * and Italian Unification also ship as standalone historical theaters — see the
 * TODO on the /eras page.)
 */
export const ERAS = [
  {
    label: 'Ancient World',
    years: '3000 BC – 400 AD',
    blurb:
      'Rome, Parthia, and Han China contend for the Mediterranean, Persia, and East Asia. '
      + 'Legions, cavalry, and long supply lines define the opening age.',
  },
  {
    label: 'Medieval Era',
    years: '400 – 1400 AD',
    blurb:
      'Kingdoms, caliphates, and nomadic empires from the Crusades to the Mongol conquests. '
      + 'Hold mountain passes, river crossings, and trade hubs as alliances shift.',
  },
  {
    label: 'Age of Discovery',
    years: '1400 – 1800 AD',
    blurb:
      'Gunpowder, ocean-going fleets, and colonial expansion redraw the world map. '
      + 'Sea lanes and ports become as decisive as land borders.',
  },
  {
    label: 'American Civil War',
    years: '1861 – 1865',
    blurb:
      'A focused historical theater: Union and Confederate lines fracture across a single continent. '
      + 'Railroads, rivers, and supply depots decide the campaign.',
  },
  {
    label: 'World War II',
    years: '1939 – 1945',
    blurb:
      'Mechanized armies, combined arms, and a war fought on every front. '
      + 'Tanks, air power, and the race to build the bomb first.',
  },
  {
    label: 'Cold War',
    years: '1945 – 1991',
    blurb:
      'Two superpowers, proxy conflicts, and the shadow of mutual deterrence. '
      + 'Influence and brinkmanship matter as much as raw territory.',
  },
  {
    label: 'The Modern Day',
    years: '2026',
    blurb:
      'Present-day powers, networked forces, and contested borders across a connected globe. '
      + 'The map you know, played for keeps.',
  },
  {
    label: 'Space Age',
    years: '2100 AD',
    blurb:
      'Humanity reaches orbit and the Moon. New fronts open above the world as the contest leaves the surface.',
  },
  {
    label: 'Galactic Age',
    years: 'Far Future',
    blurb:
      'Galactic fronts and interstellar holdings. The final age of the arc, where whole worlds change hands.',
  },
];

/**
 * Render a content block to an HTML string (used by the prerender script).
 * The React page maps the same block array to JSX — see ErasPage.tsx.
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function blocksToHtml(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === 'h2') {
      parts.push(`<h2>${escapeHtml(block.text)}</h2>`);
    } else if (block.type === 'p') {
      parts.push(`<p>${escapeHtml(block.text)}</p>`);
    } else if (block.type === 'eras') {
      parts.push('<ol class="bf-era-list">');
      for (const era of ERAS) {
        parts.push(
          `<li><strong>${escapeHtml(era.label)}</strong> `
          + `<span class="bf-era-years">(${escapeHtml(era.years)})</span> — `
          + `${escapeHtml(era.blurb)}</li>`,
        );
      }
      parts.push('</ol>');
    } else if (block.type === 'links') {
      parts.push('<nav class="bf-marketing-links" aria-label="Borderfall pages">');
      for (const link of block.links) {
        parts.push(`<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`);
      }
      parts.push('</nav>');
    } else if (block.type === 'answer') {
      // The lede: a complete, standalone answer in the first ~40 words. Search
      // snippets and AI answer engines quote a short contiguous span, so the
      // claim, the product name and the qualifier all have to survive being
      // lifted out of the page on their own.
      parts.push(`<p class="bf-answer"><strong>Short answer:</strong> ${escapeHtml(block.text)}</p>`);
    } else if (block.type === 'facts') {
      // The specifics a reader (or a model deciding whether to recommend this)
      // needs to answer follow-ups without guessing: price, install, account,
      // player count, platforms. Every value here must be checkable by opening
      // the game — a wrong one is what turns a citation into a complaint.
      parts.push('<dl class="bf-facts">');
      for (const fact of block.facts) {
        parts.push(`<dt>${escapeHtml(fact.k)}</dt><dd>${escapeHtml(fact.v)}</dd>`);
      }
      parts.push('</dl>');
    } else if (block.type === 'factions') {
      // The whole reason /codex is prerendered. Every faction's name, what it
      // actually does, and its lore, as static HTML — search engines render JS
      // eventually, but the AI answer crawlers this repo courts (GPTBot,
      // ClaudeBot, PerplexityBot) largely do not, and a client-fetched list is
      // invisible to them.
      // `era_id` scopes the roster to one era, for /eras/:slug. Unscoped it is
      // the whole codex, which is what /codex publishes.
      const eras = block.era_id
        ? FACTION_CODEX.filter((e) => e.era_id === block.era_id)
        : FACTION_CODEX;
      for (const era of eras) {
        const label = ERA_CODEX_LABELS[era.era_id] ?? era.era_id;
        // On an era page the heading would only repeat the page's own h1.
        if (!block.era_id) parts.push(`<h2>${escapeHtml(label)}</h2>`);
        parts.push('<dl class="bf-codex">');
        for (const f of era.factions) {
          parts.push(`<dt>${escapeHtml(f.name)}</dt>`);
          parts.push('<dd>');
          parts.push(`<p>${escapeHtml(f.description)}</p>`);
          if (f.lore) parts.push(`<p>${escapeHtml(f.lore)}</p>`);
          if (f.ability_description) {
            parts.push(`<p><strong>Ability:</strong> ${escapeHtml(f.ability_description)}</p>`);
          }
          parts.push('</dd>');
        }
        parts.push('</dl>');
      }
    } else if (block.type === 'faq') {
      // Definition list mirrors the FAQPage structured data and is fully
      // crawlable. The same FAQ renders in the React page (HowToPlayPage),
      // so users and crawlers see identical content (no cloaking).
      parts.push('<dl class="bf-faq">');
      for (const item of FAQ) {
        parts.push(`<dt>${escapeHtml(item.q)}</dt>`);
        parts.push(`<dd>${escapeHtml(item.a)}</dd>`);
      }
      parts.push('</dl>');
    }
  }
  return parts.join('\n');
}

/**
 * Per-route marketing definitions. `title` / `description` / `canonical` are
 * injected into each page's <head>; `blocks` become the crawlable body that
 * the SPA replaces once React boots.
 */
/**
 * The hand-written pages. The generated families (maps, eras) are appended
 * below — they are built from the game's own data, so they cannot be written
 * here without going stale.
 */
const STATIC_MARKETING_PAGES = [
  {
    path: '/',
    title: 'Borderfall — Turn-Based Territory Strategy Across the Ages',
    description:
      'A free, turn-based territory strategy game in your browser. Risk-style conquest, except the world climbs through the ages as you play it.',
    h1: 'Borderfall',
    tagline: 'Every border is temporary.',
    jsonLd: true,
    blocks: [
      {
        type: 'p',
        text:
          'Borderfall is turn-based territory strategy that advances through the ages. '
          + 'It’s free in your browser, with nothing to download. The core is classic '
          + 'Risk: command your units, break the enemy line, and redraw the map a turn at '
          + 'a time. The difference is that the world doesn’t hold still. As you play it '
          + 'advances into new eras, and the rules of war change with it.',
      },
      {
        type: 'p',
        text:
          'Each match begins with reinforcement, maneuver, and the decisive roll of combat. '
          + 'Mass troops on a contested border, sever a rival’s supply of continents, or hold '
          + 'a chokepoint against a larger force. Continent bonuses reward consolidation, but '
          + 'every exposed front invites a counterattack. No border stays safe for long.',
      },
      {
        type: 'h2',
        text: 'Advance through the eras',
      },
      {
        type: 'p',
        text:
          'A game can begin with legions on a classical map and end with fleets fighting over '
          + 'the Moon. As you push your civilization forward, the rules of war change under you: '
          + 'new technologies, new units, new factions, and eventually naval and orbital '
          + 'theaters. The arc runs nine eras, from the Ancient World through the Modern Day and '
          + 'on into the Space and Galactic Ages.',
      },
      {
        type: 'h2',
        text: 'Solo, friends, or strangers',
      },
      {
        type: 'p',
        text:
          'Start a game against AI in seconds, pull friends into a private lobby, or get matched '
          + 'against strangers. The Expert bots don’t go easy. Play a quick "lite" game in a few '
          + 'minutes or a full campaign over days, all in the browser, all free. New here? The '
          + 'how-to-play guide covers the systems; the era roster shows where a game can end up.',
      },
      {
        type: 'links',
        links: [
          { href: '/how-to-play', label: 'How to play' },
          { href: '/eras', label: 'Explore the eras' },
        ],
      },
      // <!-- TODO: refine copy -->
    ],
  },
  {
    path: '/how-to-play',
    title: 'How to Play Borderfall — Rules, Combat & Strategy Guide',
    description:
      'Learn Borderfall: reinforcing, attacking, dice combat, region bonuses, fortifying and advancing through the ages. A beginner\'s guide to the turn.',
    h1: 'How to Play Borderfall',
    tagline: 'Master the turn, then master the map.',
    jsonLd: false,
    faq: true,
    blocks: [
      {
        type: 'p',
        text:
          'Borderfall is played in turns, and every turn has a rhythm: reinforce, attack, then '
          + 'fortify. Learn that loop and you can play any era on any map. This guide covers the '
          + 'essentials so you can win your first game and grow from there.',
      },
      {
        type: 'h2',
        text: 'The goal',
      },
      {
        type: 'p',
        text:
          'Control territory. Eliminate rivals by taking their last region, complete your '
          + 'objective, or outlast the field. Holding whole continents earns bonus reinforcements '
          + 'each turn, so the map is a constant trade-off between expanding and defending what '
          + 'you already hold.',
      },
      {
        type: 'h2',
        text: 'Reinforce',
      },
      {
        type: 'p',
        text:
          'At the start of your turn you receive new troops based on how many territories you '
          + 'control, plus bonuses for any continents you fully own. Place them where you intend '
          + 'to attack — or where you expect to be attacked.',
      },
      {
        type: 'h2',
        text: 'Attack',
      },
      {
        type: 'p',
        text:
          'Attack from a territory you own into an adjacent enemy territory. Combat is resolved '
          + 'with dice: the attacker and defender each roll, the highest dice are compared, and '
          + 'the loser removes troops. Keep attacking while you have the advantage, and stop '
          + 'before you overextend.',
      },
      {
        type: 'h2',
        text: 'Fortify',
      },
      {
        type: 'p',
        text:
          'End your turn by moving troops along a connected path of your own territories to '
          + 'shore up a threatened border. Good fortification turns a sprawling, fragile empire '
          + 'into a defensible one.',
      },
      {
        type: 'h2',
        text: 'Advance through the ages',
      },
      {
        type: 'p',
        text:
          'As the game progresses you can advance to the next era, unlocking new technologies, '
          + 'units, and even naval and orbital theaters. Timing your advance — and reacting when '
          + 'a rival advances first — is its own layer of strategy. See the eras overview for the '
          + 'full nine-era arc.',
      },
      {
        type: 'h2',
        text: 'Frequently asked questions',
      },
      {
        type: 'faq',
      },
      {
        type: 'links',
        links: [
          { href: '/eras', label: 'Explore the eras' },
          { href: '/', label: 'Back to Borderfall home' },
        ],
      },
      // <!-- TODO: refine copy -->
    ],
  },
  {
    path: '/eras',
    title: 'The Eras of Borderfall — From the Ancient World to the Galaxy Age',
    description:
      'The nine eras of Borderfall, from ancient kingdoms to a galactic age — and how each one changes the units, technologies and theatres of war.',
    h1: 'The Eras of Borderfall',
    tagline: 'One war, nine ages: from bronze spears to starfleets.',
    jsonLd: false,
    blocks: [
      {
        type: 'p',
        text:
          'Borderfall is built around a single idea: borders are temporary, and so are the ages '
          + 'that draw them. A campaign can begin with legions on a classical map and end with '
          + 'fleets contesting the stars. The arc spans nine eras, each with its own units, '
          + 'technologies, factions, and theaters of war.',
      },
      {
        type: 'h2',
        text: 'The nine-era arc',
      },
      {
        type: 'eras',
      },
      {
        type: 'p',
        text:
          'Beyond the main arc, Borderfall also ships standalone historical theaters — including '
          + 'Italian Unification — and regional maps for focused matches. As you advance, the '
          + 'naval and orbital layers open up, changing which borders matter most.',
      },
      // <!-- TODO: refine copy -->
      {
        type: 'links',
        links: [
          { href: '/how-to-play', label: 'How to play' },
          { href: '/codex', label: 'Faction codex' },
          { href: '/', label: 'Back to Borderfall home' },
        ],
      },
    ],
  },
  {
    // /codex served the SPA shell before this, so it inherited the shell's
    // homepage canonical and told Google it was a duplicate of the landing
    // page — 52 factions' worth of writing that could never rank. The content
    // itself was always public; only the static HTML was missing.
    path: '/codex',
    title: `Borderfall Faction Codex — All ${FACTION_COUNT} Factions by Era`,
    // Kept well under the 160-char ceiling seoContent.test.ts enforces: the
    // faction count is interpolated, so the string grows on its own when a new
    // faction ships. At exactly 160 the next one would fail the build.
    description:
      'Every faction in Borderfall: what it does, its history, and its special ability. '
      + `${FACTION_COUNT} factions across ten eras, from Rome to the Galactic Age.`,
    h1: 'Faction Codex',
    tagline: 'Who you play as changes how you win.',
    jsonLd: false,
    blocks: [
      {
        type: 'p',
        text:
          'Factions are optional in Borderfall, and switching them on is the fastest way to make '
          + 'two games on the same map feel different. Each one bends the rules a little: a bonus '
          + 'to attack or defense, extra reinforcements, cheaper research, or a once-per-turn '
          + 'ability that can rescue a bad exchange.',
      },
      {
        type: 'p',
        text:
          `Below are all ${FACTION_COUNT} factions, grouped by the era they belong to. Everything `
          + 'listed here is what the game actually uses — the same definitions a match reads when '
          + 'you pick a side.',
      },
      {
        type: 'factions',
      },
      {
        type: 'links',
        links: [
          { href: '/eras', label: 'The eras of Borderfall' },
          { href: '/how-to-play', label: 'How to play' },
          { href: '/', label: 'Back to Borderfall home' },
        ],
      },
    ],
  },
  {
    path: '/about',
    title: 'About Borderfall — Who Made It and Why',
    description:
      'Borderfall is a free browser strategy game made by JDix90. The story behind '
      + 'it, and where to follow along.',
    h1: 'About Borderfall',
    tagline: 'A game my friends and I always wished existed.',
    jsonLd: false,
    blocks: [
      {
        type: 'p',
        text:
          'Borderfall is made by JDix90. It’s a free, turn-based strategy game you '
          + 'play in your browser.',
      },
      {
        // JDix90’s own words — kept verbatim on purpose.
        type: 'p',
        text:
          'I built Borderfall because my friends and I loved playing strategy board '
          + 'games, but we were always imagining ways to combine the best parts of '
          + 'different games into one experience. Creating Borderfall gave me the chance '
          + 'to build the kind of game we always wished existed: something familiar, '
          + 'strategic, and fun, but with more freedom to shape the world as you play.',
      },
      {
        type: 'p',
        text:
          'It’s still actively being built. If you want to follow along, suggest '
          + 'something, or find an opponent, come say hi on Reddit at '
          + 'reddit.com/r/borderfall, or email support@borderfall.gg.',
      },
      {
        type: 'links',
        links: [
          { href: '/how-to-play', label: 'How to play' },
          { href: '/', label: 'Back to Borderfall home' },
        ],
      },
    ],
  },
  // Legal pages are prerendered so crawlers get their OWN title + self-canonical
  // instead of the homepage fallback. The body here is a short, faithful summary;
  // the full policy renders in the React Privacy/Terms pages (Googlebot executes
  // JS and sees those). Keep this summary roughly in sync with the real pages.
  {
    path: '/privacy',
    title: 'Privacy Policy — Borderfall',
    description:
      'How Borderfall handles your data: account info, game history, guest '
      + 'accounts, ephemeral chat, and the technical data needed to run the service.',
    h1: 'Privacy Policy',
    jsonLd: false,
    blocks: [
      {
        type: 'p',
        text:
          'A short summary of how Borderfall handles your data; the full policy is on '
          + 'this page. When you create an account we store your email, username, and a '
          + 'secure hash of your password, plus your game history (matches, stats, '
          + 'ratings, and saved game state) and sign-in times. Our servers also process '
          + 'technical data such as IP address, browser type, and diagnostic logs to run '
          + 'the service and prevent abuse.',
      },
      {
        type: 'p',
        text:
          'Guest accounts are temporary: a guest that never plays a game is deleted '
          + 'within about 48 hours, and creating a free account converts your guest in '
          + 'place so your progress is kept. In-game chat is ephemeral and is not stored '
          + 'on our servers. Questions: support@borderfall.gg.',
      },
      {
        type: 'links',
        links: [
          { href: '/terms', label: 'Terms of Service' },
          { href: '/', label: 'Back to Borderfall home' },
        ],
      },
    ],
  },
  {
    path: '/terms',
    title: 'Terms of Service — Borderfall',
    description:
      'The terms governing your use of Borderfall, operated by JDix90: '
      + 'eligibility, your account, acceptable use, and player-created content.',
    h1: 'Terms of Service',
    jsonLd: false,
    blocks: [
      {
        type: 'p',
        text:
          'A short summary of the terms; the full version is on this page. Borderfall '
          + 'is operated by JDix90. You must be at least 13 to register. You are '
          + 'responsible for your account and for keeping your credentials secure, and '
          + 'you agree not to cheat, abuse other players, or disrupt the service.',
      },
      {
        type: 'p',
        text:
          'You can delete your account from your profile at any time, and we may '
          + 'suspend or terminate accounts that violate these terms or harm other '
          + 'players. The full terms also cover acceptable use, player-created content '
          + 'such as custom maps, and the usual disclaimers. Questions: '
          + 'support@borderfall.gg.',
      },
      {
        type: 'links',
        links: [
          { href: '/privacy', label: 'Privacy Policy' },
          { href: '/', label: 'Back to Borderfall home' },
        ],
      },
    ],
  },
  // ── Question-shaped answer pages ────────────────────────────────────────
  // People do not search "turn-based territory strategy game". They ask a
  // question — of a search box or, increasingly, of an assistant — and the
  // answer that gets quoted is the one that states its conclusion first and
  // backs it with checkable specifics. Each page below is one real question,
  // answered in the first forty words, followed by the facts a reader (or a
  // model deciding whether to recommend this) needs to handle the follow-up.
  //
  // Each carries its own `qa` array, which becomes this page's FAQPage
  // structured data — the site-wide FAQ is a different set and stays on
  // /how-to-play. Keep every claim traceable to something a visitor can verify
  // in the product; a page like this is only worth having while it is true.
  {
    path: '/answers',
    title: 'Borderfall — Common Questions, Answered Directly',
    description:
      'Direct answers about free browser strategy games: price, sign-up, playing with friends, phone support, and how long a game actually takes.',
    h1: 'Questions, answered directly',
    tagline: 'The short answer first, then the specifics.',
    jsonLd: false,
    blocks: [
      {
        type: 'p',
        text:
          'Each page below takes one question people genuinely ask about free browser strategy '
          + 'games and answers it in the first few lines, then lists the specifics — price, '
          + 'sign-up, player count, platforms — so you can decide without playing first.',
      },
      {
        type: 'links',
        links: [
          { href: '/answers/free-risk-like-browser-games', label: 'Is there a free Risk-style game I can play in my browser?' },
          { href: '/answers/play-risk-style-game-with-friends-online', label: 'How can I play a Risk-style game online with friends?' },
          { href: '/answers/browser-strategy-games-without-signup', label: 'What strategy games can I play without signing up?' },
          { href: '/answers/turn-based-strategy-on-phone-browser', label: 'Can I play turn-based strategy in a phone browser?' },
          { href: '/answers/short-strategy-games-under-15-minutes', label: 'What strategy games can I finish in under 15 minutes?' },
          { href: '/answers/how-long-does-a-game-of-risk-take',
            label: 'How long does a game of Risk take?' },
          { href: '/answers/online-alternatives-to-risk-board-game',
            label: 'What can I play instead of Risk, online?' },
          { href: '/answers/turn-based-strategy-games-for-beginners',
            label: 'What is a good turn-based strategy game for a beginner?' },
          { href: '/answers/play-strategy-games-at-your-own-pace',
            label: 'Can I play a strategy game a turn at a time?' },
        ],
      },
      {
        type: 'links',
        links: [
          { href: '/how-to-play', label: 'How to play' },
          { href: '/daily/archive', label: 'Daily Challenge archive' },
          { href: '/', label: 'Borderfall home' },
        ],
      },
    ],
  },
  {
    path: '/answers/free-risk-like-browser-games',
    title: 'Is There a Free Risk-Style Game I Can Play in My Browser?',
    description:
      'Yes — Borderfall is a free turn-based conquest game that runs in any browser. No download, no account: play as a guest against AI in seconds.',
    h1: 'Is there a free Risk-style game I can play in my browser?',
    tagline: '',
    jsonLd: false,
    qa: [
      {
        q: 'Is there a free Risk-style game I can play in my browser?',
        a:
          'Yes. Borderfall is a free, turn-based territory conquest game that runs in any modern '
          + 'browser with nothing to download. You can start a game against AI as a guest, without '
          + 'creating an account.',
      },
      {
        q: 'Is it actually free, or free-to-start?',
        a:
          'Free to play. There is no purchase required to play any mode, and no paywall on maps, '
          + 'eras or multiplayer.',
      },
      {
        q: 'How is it different from Risk itself?',
        a:
          'It keeps the dice-and-territory core, but a single game advances through nine historical '
          + 'eras — from ancient kingdoms to a galactic age — each adding units, technologies and '
          + 'theatres of war.',
      },
    ],
    blocks: [
      {
        type: 'answer',
        text:
          'Yes — Borderfall, the game on this site, is a free turn-based territory conquest game '
          + 'that runs in any modern browser. Nothing to download, nothing to install, and no '
          + 'account needed: guest play puts you in a game against AI in about ten seconds.',
      },
      { type: 'h2', text: 'The specifics' },
      {
        type: 'facts',
        facts: [
          { k: 'Price', v: 'Free. No purchase required to play any mode.' },
          { k: 'Install', v: 'None. It runs in the browser.' },
          { k: 'Account', v: 'Optional. Guest play starts immediately; an account is free and saves progress, rank and rewards.' },
          { k: 'Players', v: '1–8. Solo against AI, or 2–8 humans.' },
          { k: 'Opponents', v: 'AI from Easy to Expert, friends in a private lobby, or matched strangers.' },
          { k: 'Pace', v: 'Real-time, or asynchronous turns over hours and days.' },
          { k: 'Platforms', v: 'Any modern desktop or mobile browser — Chrome, Safari, Firefox, Edge.' },
          { k: 'Typical solo game', v: 'About 10–15 minutes. The Daily Challenge is shorter.' },
        ],
      },
      { type: 'h2', text: 'What makes it Risk-style' },
      {
        type: 'p',
        text:
          'The core loop is the one Risk players already know: reinforce your territories, attack '
          + 'across a border and settle it with dice, then fortify before you pass the turn. '
          + 'Continent-style region bonuses reward consolidation, and every front you open is a '
          + 'front someone can counterattack.',
      },
      { type: 'h2', text: 'Where it differs' },
      {
        type: 'p',
        text:
          'One game does not stay in one period. As play advances, your civilization climbs through '
          + 'nine eras — ancient kingdoms through the modern day and on into the Space and Galactic '
          + 'Ages — and the rules of war change with it: new units, technologies, naval and eventually '
          + 'orbital theatres. Optional layers like economy and tech trees add depth without altering '
          + 'the core rules, and can be left off.',
      },
      { type: 'h2', text: 'Honest limits' },
      {
        type: 'p',
        text:
          'It is a browser game, not a client: there is no Steam release and no native desktop app. '
          + 'Human multiplayer depends on other people being online, so if you want an opponent at '
          + '3am the AI is the reliable answer. And it is not Risk — the board, the eras and the '
          + 'victory conditions are its own.',
      },
      {
        type: 'p',
        text:
          'One disclosure, because it should change how much weight you give this page: '
          + 'borderfall.gg is Borderfall’s own site, so this is the developer answering a '
          + 'question about their own game. Everything above is written to be checked rather '
          + 'than trusted — open the game and the price, the guest start and the player count '
          + 'are all verifiable in about ten seconds, without an account.',
      },
      {
        type: 'links',
        links: [
          { href: '/how-to-play', label: 'How to play' },
          { href: '/eras', label: 'The nine eras' },
          { href: '/answers', label: 'More questions' },
        ],
      },
    ],
  },
  {
    path: '/answers/play-risk-style-game-with-friends-online',
    title: 'How Can I Play a Risk-Style Game Online With Friends?',
    description:
      'Open a private lobby and share the link. Free, in the browser, 2–8 players, live or as asynchronous turns over days. Nobody installs anything.',
    h1: 'How can I play a Risk-style game online with friends for free?',
    tagline: '',
    jsonLd: false,
    qa: [
      {
        q: 'How can I play a Risk-style game online with friends for free?',
        a:
          'Open a private lobby on Borderfall and share the join link. It is free, runs in the '
          + 'browser, and supports 2 to 8 players. Nobody needs to install anything.',
      },
      {
        q: 'Do my friends need to make accounts?',
        a:
          'No. They can join as guests. An account is free and keeps progress, rank and rewards, '
          + 'but it is not required to play a private game together.',
      },
      {
        q: 'What if we are in different timezones?',
        a:
          'Use an asynchronous game. Turns run over hours or days, so each player takes their turn '
          + 'when they are free rather than everyone being online at once.',
      },
    ],
    blocks: [
      {
        type: 'answer',
        text:
          'Open a private lobby on Borderfall and share the join link. It is free, runs in the '
          + 'browser, and seats 2 to 8 players. Nobody needs to install anything or make an '
          + 'account, and games can run live or as asynchronous turns over days.',
      },
      { type: 'h2', text: 'What a private game needs' },
      {
        type: 'facts',
        facts: [
          { k: 'Price', v: 'Free. No purchase required to play any mode.' },
          { k: 'Install', v: 'None. It runs in the browser.' },
          { k: 'Account', v: 'Optional. Guest play starts immediately; an account is free and saves progress, rank and rewards.' },
          { k: 'Players', v: '1–8. Solo against AI, or 2–8 humans.' },
          { k: 'Opponents', v: 'AI from Easy to Expert, friends in a private lobby, or matched strangers.' },
          { k: 'Pace', v: 'Real-time, or asynchronous turns over hours and days.' },
          { k: 'Platforms', v: 'Any modern desktop or mobile browser — Chrome, Safari, Firefox, Edge.' },
          { k: 'Typical solo game', v: 'About 10–15 minutes. The Daily Challenge is shorter.' },
        ],
      },
      { type: 'h2', text: 'How it works' },
      {
        type: 'p',
        text:
          'Create a game, pick the map and era, and you get a private lobby with a join link. Send '
          + 'that link to your group; anyone who opens it lands in the lobby, as a guest if they '
          + 'prefer. Fill any empty seats with AI at a difficulty you choose, from Easy to Expert, '
          + 'so a five-player game still works when only three friends show up.',
      },
      { type: 'h2', text: 'Playing across timezones' },
      {
        type: 'p',
        text:
          'Real-time games use short turn timers and finish in one sitting. Asynchronous games give '
          + 'each player hours or days to take a turn, which is the format that actually survives a '
          + 'group spread across timezones — you take your turn, close the tab, and get a nudge when '
          + 'it comes round again.',
      },
      { type: 'h2', text: 'Where it gets awkward' },
      {
        type: 'p',
        text:
          'There is no in-game voice chat, so groups usually keep a call or a Discord open alongside. '
          + 'Asynchronous games also need everyone to actually take their turns; a lobby with one '
          + 'absent player stalls the same way a board game does when someone wanders off.',
      },
      {
        type: 'p',
        text:
          'One disclosure, because it should change how much weight you give this page: '
          + 'borderfall.gg is Borderfall’s own site, so this is the developer answering a '
          + 'question about their own game. Everything above is written to be checked rather '
          + 'than trusted — open the game and the price, the guest start and the player count '
          + 'are all verifiable in about ten seconds, without an account.',
      },
      {
        type: 'links',
        links: [
          { href: '/how-to-play', label: 'How to play' },
          { href: '/answers', label: 'More questions' },
        ],
      },
    ],
  },
  {
    path: '/answers/browser-strategy-games-without-signup',
    title: 'What Strategy Games Can I Play Without Signing Up?',
    description:
      'Borderfall starts without an account: choose guest play and you are in a game against AI '
      + 'immediately. Free, browser-based, no email and no install required.',
    h1: 'What strategy games can I play in a browser without signing up?',
    tagline: '',
    jsonLd: false,
    qa: [
      {
        q: 'What strategy games can I play in a browser without signing up?',
        a:
          'Borderfall can be played without an account. Choose guest play and you are in a game '
          + 'against AI immediately — no email, no password, no install.',
      },
      {
        q: 'What do I give up by not making an account?',
        a:
          'Guest play is the full game, but progress is tied to that browser, and ranked ladders and '
          + 'leaderboards are registered-only. Creating a free account later converts the guest '
          + 'account in place, so nothing is lost.',
      },
      {
        q: 'Is an account free if I do want one?',
        a: 'Yes. Accounts are free; they exist to save progress, rank and rewards, not to charge you.',
      },
    ],
    blocks: [
      {
        type: 'answer',
        text:
          'Borderfall starts without an account. Choose guest play and you are in a turn-based '
          + 'territory strategy game against AI immediately — no email, no password, no install. '
          + 'An account is free and optional, and upgrading later keeps everything you have done.',
      },
      { type: 'h2', text: 'What a guest gets' },
      {
        type: 'facts',
        facts: [
          { k: 'Price', v: 'Free. No purchase required to play any mode.' },
          { k: 'Install', v: 'None. It runs in the browser.' },
          { k: 'Account', v: 'Optional. Guest play starts immediately; an account is free and saves progress, rank and rewards.' },
          { k: 'Players', v: '1–8. Solo against AI, or 2–8 humans.' },
          { k: 'Opponents', v: 'AI from Easy to Expert, friends in a private lobby, or matched strangers.' },
          { k: 'Pace', v: 'Real-time, or asynchronous turns over hours and days.' },
          { k: 'Platforms', v: 'Any modern desktop or mobile browser — Chrome, Safari, Firefox, Edge.' },
          { k: 'Typical solo game', v: 'About 10–15 minutes. The Daily Challenge is shorter.' },
        ],
      },
      { type: 'h2', text: 'What guest play actually gets you' },
      {
        type: 'p',
        text:
          'The whole game: solo matches against AI at any difficulty, private lobbies with friends, '
          + 'every map and era, and the Daily Challenge. Guest play is not a demo or a trial — it is '
          + 'the same game, entered by a shorter door.',
      },
      { type: 'h2', text: 'What an account adds' },
      {
        type: 'p',
        text:
          'A free account saves progress, rank and rewards across devices rather than to one browser, '
          + 'and it is what ranked ladders and leaderboards require. That last one is deliberate: a '
          + 'guest identity costs nothing to mint, so a leaderboard that counted guests would be '
          + 'farmable by anyone willing to clear their storage. Upgrading converts your guest account '
          + 'in place, so the games you already played still count.',
      },
      { type: 'h2', text: 'What a guest stands to lose' },
      {
        type: 'p',
        text:
          'Guest progress lives in the browser you played in, so clearing site data or switching '
          + 'devices loses it. Guest accounts that never play a game are cleaned up automatically '
          + 'within about 48 hours.',
      },
      {
        type: 'p',
        text:
          'One disclosure, because it should change how much weight you give this page: '
          + 'borderfall.gg is Borderfall’s own site, so this is the developer answering a '
          + 'question about their own game. Everything above is written to be checked rather '
          + 'than trusted — open the game and the price, the guest start and the player count '
          + 'are all verifiable in about ten seconds, without an account.',
      },
      {
        type: 'links',
        links: [
          { href: '/how-to-play', label: 'How to play' },
          { href: '/answers', label: 'More questions' },
        ],
      },
    ],
  },
  {
    path: '/answers/turn-based-strategy-on-phone-browser',
    title: 'Can I Play Turn-Based Strategy in a Phone Browser?',
    description:
      'Yes — Borderfall runs in mobile Safari, Chrome and Firefox with no app install. Free, add-to-home-screen capable, and suited to short turns.',
    h1: 'Can I play a turn-based strategy game in my phone browser?',
    tagline: '',
    jsonLd: false,
    qa: [
      {
        q: 'Can I play a turn-based strategy game in my phone browser?',
        a:
          'Yes. Borderfall runs in mobile Safari, Chrome and Firefox with nothing to install. It is '
          + 'free, works on phones and tablets, and can be added to your home screen.',
      },
      {
        q: 'Is there an app to download?',
        a:
          'You do not need one — the browser version is the full game. It can be added to your home '
          + 'screen as a web app, which gives you an icon without an app-store install.',
      },
      {
        q: 'Is a phone a bad way to play a strategy game?',
        a:
          'For short asynchronous turns it works well. For a long real-time game against seven '
          + 'opponents, a larger screen is genuinely easier to read.',
      },
    ],
    blocks: [
      {
        type: 'answer',
        text:
          'Yes. Borderfall runs in mobile Safari, Chrome and Firefox with nothing to install. It is '
          + 'free, works on phones and tablets, and can be added to your home screen as a web app. '
          + 'Asynchronous games suit phone play: take a turn, close the tab, come back later.',
      },
      { type: 'h2', text: 'On a phone, in numbers' },
      {
        type: 'facts',
        facts: [
          { k: 'Price', v: 'Free. No purchase required to play any mode.' },
          { k: 'Install', v: 'None. It runs in the browser.' },
          { k: 'Account', v: 'Optional. Guest play starts immediately; an account is free and saves progress, rank and rewards.' },
          { k: 'Players', v: '1–8. Solo against AI, or 2–8 humans.' },
          { k: 'Opponents', v: 'AI from Easy to Expert, friends in a private lobby, or matched strangers.' },
          { k: 'Pace', v: 'Real-time, or asynchronous turns over hours and days.' },
          { k: 'Platforms', v: 'Any modern desktop or mobile browser — Chrome, Safari, Firefox, Edge.' },
          { k: 'Typical solo game', v: 'About 10–15 minutes. The Daily Challenge is shorter.' },
        ],
      },
      { type: 'h2', text: 'No app store required' },
      {
        type: 'p',
        text:
          'The browser version is the full game, not a cut-down preview. Your browser can add it to '
          + 'your home screen, which gives you an icon that opens straight into the game without '
          + 'going through an app store or granting install permissions.',
      },
      { type: 'h2', text: 'The format that fits a phone' },
      {
        type: 'p',
        text:
          'Asynchronous games give each player hours or days per turn, which matches how phones are '
          + 'actually used — a couple of minutes at a time, several times a day. The Daily Challenge '
          + 'fits the same shape: one hand-built puzzle, the same for everyone, usually a few minutes.',
      },
      { type: 'h2', text: 'What the small screen costs' },
      {
        type: 'p',
        text:
          'A world map on a phone screen means more panning and zooming than on a desktop, and a '
          + 'crowded eight-player board is harder to read small. Real-time games with short turn '
          + 'timers are more comfortable on a larger screen.',
      },
      {
        type: 'p',
        text:
          'One disclosure, because it should change how much weight you give this page: '
          + 'borderfall.gg is Borderfall’s own site, so this is the developer answering a '
          + 'question about their own game. Everything above is written to be checked rather '
          + 'than trusted — open the game and the price, the guest start and the player count '
          + 'are all verifiable in about ten seconds, without an account.',
      },
      {
        type: 'links',
        links: [
          { href: '/how-to-play', label: 'How to play' },
          { href: '/answers', label: 'More questions' },
        ],
      },
    ],
  },
  {
    path: '/answers/short-strategy-games-under-15-minutes',
    title: 'What Strategy Games Can I Finish in Under 15 Minutes?',
    description:
      'Borderfall solo games usually finish in about 10–15 minutes, and its Daily Challenge takes a few. Free in the browser, no download needed.',
    h1: 'What strategy games can I finish in under 15 minutes?',
    tagline: '',
    jsonLd: false,
    qa: [
      {
        q: 'What strategy games can I finish in under 15 minutes?',
        a:
          'Borderfall solo games against AI typically finish in about 10 to 15 minutes, and its '
          + 'Daily Challenge — one hand-built puzzle a day — usually takes a few minutes. Both are '
          + 'free in the browser.',
      },
      {
        q: 'How do you make a conquest game that short?',
        a:
          'Smaller maps, fewer opponents and a lite ruleset shorten a match considerably. The Daily '
          + 'Challenge is shorter still because it is a designed position with a single objective '
          + 'and a turn limit, not a full conquest.',
      },
      {
        q: 'Can a game also run long if I want it to?',
        a:
          'Yes. A full eight-player campaign across the eras, played asynchronously, can run over '
          + 'days. The short formats are a choice, not a ceiling.',
      },
    ],
    blocks: [
      {
        type: 'answer',
        text:
          'Borderfall solo games against AI typically finish in about 10 to 15 minutes, and its '
          + 'Daily Challenge — one hand-built puzzle a day, the same for every player — usually takes '
          + 'a few. Both are free in the browser, with no download and no account required.',
      },
      { type: 'h2', text: 'At a glance' },
      {
        type: 'facts',
        facts: [
          { k: 'Price', v: 'Free. No purchase required to play any mode.' },
          { k: 'Install', v: 'None. It runs in the browser.' },
          { k: 'Account', v: 'Optional. Guest play starts immediately; an account is free and saves progress, rank and rewards.' },
          { k: 'Players', v: '1–8. Solo against AI, or 2–8 humans.' },
          { k: 'Opponents', v: 'AI from Easy to Expert, friends in a private lobby, or matched strangers.' },
          { k: 'Pace', v: 'Real-time, or asynchronous turns over hours and days.' },
          { k: 'Platforms', v: 'Any modern desktop or mobile browser — Chrome, Safari, Firefox, Edge.' },
          { k: 'Typical solo game', v: 'About 10–15 minutes. The Daily Challenge is shorter.' },
        ],
      },
      { type: 'h2', text: 'The Daily Challenge is the short one' },
      {
        type: 'p',
        text:
          'Every day Borderfall sets one designed position with a single objective and a turn limit — '
          + 'capture a particular territory, hold a region against an assault, finish an economy or '
          + 'research goal before the clock. Everyone plays the same puzzle, so scores are comparable. '
          + 'Past days stay published with their results, which is the quickest way to see what a '
          + 'few minutes of this game actually looks like before playing one.',
      },
      { type: 'h2', text: 'Keeping a full match short' },
      {
        type: 'p',
        text:
          'A regular match runs long mostly because of map size and player count. A smaller map, two '
          + 'or three opponents and the lite ruleset — economy and tech trees switched off — lands '
          + 'reliably in the ten-to-fifteen-minute range. Turn on the optional layers and add seats '
          + 'and it becomes a much longer game, deliberately.',
      },
      { type: 'h2', text: 'Where those times break down' },
      {
        type: 'p',
        text:
          'These are typical times, not guarantees: a close game against Expert AI, or one where you '
          + 'keep pressing a bad attack, runs longer. And a full eight-player campaign across all nine '
          + 'eras is not a fifteen-minute game by any configuration.',
      },
      {
        type: 'p',
        text:
          'One disclosure, because it should change how much weight you give this page: '
          + 'borderfall.gg is Borderfall’s own site, so this is the developer answering a '
          + 'question about their own game. Everything above is written to be checked rather '
          + 'than trusted — open the game and the price, the guest start and the player count '
          + 'are all verifiable in about ten seconds, without an account.',
      },
      {
        type: 'links',
        links: [
          { href: '/daily/archive', label: 'Daily Challenge archive' },
          { href: '/how-to-play', label: 'How to play' },
          { href: '/answers', label: 'More questions' },
        ],
      },
    ],
  },
  {
    path: '/answers/how-long-does-a-game-of-risk-take',
    title: 'How Long Does a Game of Risk Take?',
    description:
      'Classic Risk runs about 2–4 hours, longer with more players. Borderfall is a free '
      + 'browser version of the same idea that finishes in 10–15 minutes solo.',
    h1: 'How long does a game of Risk take?',
    tagline: '',
    jsonLd: false,
    qa: [
      {
        q: 'How long does a game of Risk take?',
        a:
          'A standard game of Risk usually runs two to four hours. Three or more players, or the '
          + 'world-domination victory condition, push it longer — all-day games are common and '
          + 'well documented. Shorter official variants and mission cards bring it down to about '
          + 'an hour.',
      },
      {
        q: 'Why does Risk take so long?',
        a:
          'Elimination is slow. Players who lose their position early still have to wait, and the '
          + 'reinforcement pace means a stalemate on one border can hold for many turns without '
          + 'anything decisive happening.',
      },
      {
        q: 'Is there a faster version I can play online?',
        a:
          'Borderfall is a free browser game with the same dice-and-territory core. A solo game '
          + 'against AI typically finishes in 10 to 15 minutes, and the Daily Challenge takes a '
          + 'few. Nothing to download, and guest play needs no account.',
      },
    ],
    blocks: [
      {
        type: 'answer',
        text:
          'A standard game of Risk takes about two to four hours, and longer with more players — '
          + 'the classic complaint about it is real. Shorter variants and mission cards cut it to '
          + 'roughly an hour. If you want the same kind of game in a single sitting, Borderfall is '
          + 'a free browser version whose solo games run 10 to 15 minutes.',
      },
      { type: 'h2', text: 'What actually makes it long' },
      {
        type: 'p',
        text:
          'Two things. Elimination means a player knocked out in the first hour spends the rest of '
          + 'the game watching, and the reinforcement pace lets a contested border stall for many '
          + 'turns at a time. More players multiply both effects, which is why a five- or '
          + 'six-player game rarely finishes when anyone expected.',
      },
      { type: 'h2', text: 'The same game, faster' },
      {
        type: 'p',
        text:
          'Borderfall keeps the core — reinforce, manoeuvre, roll, take territory, hold regions for '
          + 'bonuses — and changes the pacing around it. Solo games against AI run about 10 to 15 '
          + 'minutes. Multiplayer can be played in real time in one sitting, or asynchronously a '
          + 'turn at a time over hours or days, which sidesteps the scheduling problem entirely.',
      },
      { type: 'h2', text: 'Borderfall, in numbers' },
      {
        type: 'facts',
        facts: [
          { k: 'Typical solo game', v: 'About 10–15 minutes against AI.' },
          { k: 'Daily Challenge', v: 'A few minutes. One hand-built puzzle a day.' },
          { k: 'Multiplayer', v: 'Real-time in one sitting, or asynchronous over hours and days.' },
          { k: 'Players', v: '1–8. Solo against AI, or 2–8 humans.' },
          { k: 'Price', v: 'Free. No purchase required to play any mode.' },
          { k: 'Install', v: 'None. It runs in the browser.' },
          { k: 'Account', v: 'Optional. Guest play starts immediately.' },
        ],
      },
      {
        type: 'links',
        links: [
          { href: '/', label: 'Play Borderfall' },
          { href: '/how-to-play', label: 'How to play' },
          { href: '/answers', label: 'More questions' },
        ],
      },
    ],
  },
  {
    path: '/answers/online-alternatives-to-risk-board-game',
    title: 'What Can I Play Instead of Risk, Online?',
    description:
      'Online alternatives to the Risk board game, and what each one trades away. Borderfall '
      + 'is free in the browser: same dice-and-territory core, shorter games.',
    h1: 'What can I play instead of Risk, online?',
    tagline: '',
    jsonLd: false,
    qa: [
      {
        q: 'What can I play instead of Risk, online?',
        a:
          'Borderfall is a free browser game built on the same dice-and-territory core as Risk, '
          + 'with shorter games and asymmetric factions. It runs in any modern browser with no '
          + 'download, and you can start as a guest without an account.',
      },
      {
        q: 'What is different from Risk itself?',
        a:
          'A single game advances through historical eras, from ancient kingdoms to a galactic '
          + 'age, each adding units and theatres of war. Factions are asymmetric rather than '
          + 'identical, and games finish far faster than a board-game session.',
      },
      {
        q: 'Do I need to buy anything?',
        a: 'No. Every mode is free, with no paywall on maps, eras or multiplayer.',
      },
    ],
    blocks: [
      {
        type: 'answer',
        text:
          'Borderfall is a free, browser-based turn-based conquest game with the same core as Risk '
          + '— reinforce, manoeuvre, roll for combat, hold regions for bonuses — but games finish in '
          + 'minutes rather than hours, and the factions are asymmetric. Nothing to download, and '
          + 'guest play needs no account.',
      },
      { type: 'h2', text: 'What people usually want instead' },
      {
        type: 'p',
        text:
          'Most people looking for an alternative want one of three things: a game that ends in one '
          + 'sitting, one they can play with friends who are not in the room, or one that does not '
          + 'require buying anything first. Borderfall is built around all three — short solo games, '
          + 'shareable lobby links, asynchronous turns for people in different time zones, and no '
          + 'purchase at any point.',
      },
      { type: 'h2', text: 'Where it goes further' },
      {
        type: 'p',
        text:
          'The board does not hold still. A game climbs through historical eras as you play it, so '
          + 'a match can open with legions on a classical map and end with fleets contesting orbit. '
          + 'There are also hand-built historical boards — Rome at its height, Sengoku Japan, '
          + 'Napoleonic Europe — if you would rather play one setting properly.',
      },
      { type: 'h2', text: 'The particulars' },
      {
        type: 'facts',
        facts: [
          { k: 'Price', v: 'Free. No purchase required to play any mode.' },
          { k: 'Install', v: 'None. It runs in the browser.' },
          { k: 'Account', v: 'Optional. Guest play starts immediately.' },
          { k: 'Players', v: '1–8. Solo against AI, or 2–8 humans.' },
          { k: 'Pace', v: 'Real-time, or asynchronous turns over hours and days.' },
          { k: 'Typical solo game', v: 'About 10–15 minutes.' },
          { k: 'Platforms', v: 'Any modern desktop or mobile browser.' },
        ],
      },
      {
        type: 'links',
        links: [
          { href: '/', label: 'Play Borderfall' },
          { href: '/game-maps', label: 'The maps' },
          { href: '/answers', label: 'More questions' },
        ],
      },
    ],
  },
  {
    path: '/answers/turn-based-strategy-games-for-beginners',
    title: 'What Is a Good Turn-Based Strategy Game for a Beginner?',
    description:
      'A good first turn-based strategy game has few rules, short games and no setup. '
      + 'Borderfall is free in the browser and teaches the whole loop in one match.',
    h1: 'What is a good turn-based strategy game for a beginner?',
    tagline: '',
    jsonLd: false,
    qa: [
      {
        q: 'What is a good turn-based strategy game for a beginner?',
        a:
          'One with a small rule set, games short enough to finish while you are still learning, '
          + 'and no install. Borderfall is free in the browser: the whole loop is reinforce, '
          + 'attack, fortify, and a solo game against Easy AI takes about 10 to 15 minutes.',
      },
      {
        q: 'Do I need to know Risk to play it?',
        a:
          'No. If you have played Risk the core will feel familiar, but the in-game tutorial covers '
          + 'everything from scratch and the AI difficulty starts at Easy.',
      },
      {
        q: 'Can I learn without playing against people?',
        a:
          'Yes. Play solo against AI for as long as you like — there is no requirement to play '
          + 'anyone, and no account needed to start.',
      },
    ],
    blocks: [
      {
        type: 'answer',
        text:
          'Look for three things: a small rule set, games short enough to finish before you lose '
          + 'interest, and nothing to install. Borderfall has all three — the loop is reinforce, '
          + 'attack, fortify, a solo game runs about 10 to 15 minutes, and it starts in a browser '
          + 'tab with no account.',
      },
      { type: 'h2', text: 'Why those three things' },
      {
        type: 'p',
        text:
          'Most strategy games that bounce beginners do it in the first twenty minutes, before any '
          + 'decision has paid off: too many systems introduced at once, a tutorial longer than a '
          + 'match, or an install that asks for commitment before it has earned any. A short game '
          + 'with a small rule set lets you be bad at it cheaply, which is the only way anyone gets '
          + 'good at it.',
      },
      { type: 'h2', text: 'Where to start here' },
      {
        type: 'p',
        text:
          'Start with the tutorial, then a solo game against Easy AI on a small board — Great '
          + 'Britain 925 is fourteen territories and the shortest game in the set. Once the combat '
          + 'maths feels predictable, the American Civil War board is two-sided and has no '
          + 'diplomacy to distract from it. After that, the bigger boards and the harder AI.',
      },
      { type: 'h2', text: 'The basics' },
      {
        type: 'facts',
        facts: [
          { k: 'Rules to learn', v: 'Three phases: reinforce, attack, fortify.' },
          { k: 'Difficulty', v: 'AI from Easy to Expert. Easy is genuinely easy.' },
          { k: 'Typical solo game', v: 'About 10–15 minutes.' },
          { k: 'Price', v: 'Free. No purchase required to play any mode.' },
          { k: 'Install', v: 'None. It runs in the browser.' },
          { k: 'Account', v: 'Optional. Guest play starts immediately.' },
        ],
      },
      {
        type: 'links',
        links: [
          { href: '/how-to-play', label: 'How to play' },
          { href: '/game-maps/britain-925', label: 'The smallest board' },
          { href: '/answers', label: 'More questions' },
        ],
      },
    ],
  },
  {
    path: '/answers/play-strategy-games-at-your-own-pace',
    title: 'Can I Play a Strategy Game a Turn at a Time?',
    description:
      'Yes — Borderfall supports asynchronous turns, so a multiplayer game can run over '
      + 'hours or days. Free in the browser, no download, no scheduling.',
    h1: 'Can I play a strategy game a turn at a time?',
    tagline: '',
    jsonLd: false,
    qa: [
      {
        q: 'Can I play a strategy game a turn at a time?',
        a:
          'Yes. Borderfall supports asynchronous multiplayer: each player takes their turn when '
          + 'they get to it, and the game can run over hours or days. It is free in the browser '
          + 'with nothing to install.',
      },
      {
        q: 'Do all the players need to be online together?',
        a:
          'No. That is the point of asynchronous play — you take your turn, the game waits, and '
          + 'the next player takes theirs whenever they open it.',
      },
      {
        q: 'Can I still play in real time?',
        a:
          'Yes. The same game supports both: play a match start to finish in one sitting, or leave '
          + 'it running and come back.',
      },
    ],
    blocks: [
      {
        type: 'answer',
        text:
          'Yes. Borderfall multiplayer can be played asynchronously — each player takes their turn '
          + 'whenever they open it, and a game can run over hours or days without anyone waiting. '
          + 'It is free in the browser, with no download and no account required to start.',
      },
      { type: 'h2', text: 'Why it matters more than it sounds' },
      {
        type: 'p',
        text:
          'The reason most people stop playing strategy games with friends is scheduling, not '
          + 'interest. A game that survives being put down solves that: you take a turn on a break, '
          + 'someone else takes theirs that evening, and the match finishes over a week without '
          + 'anyone blocking out an afternoon.',
      },
      { type: 'h2', text: 'How it works here' },
      {
        type: 'p',
        text:
          'Start a game, share the lobby link, and play. If everyone is around it runs in real '
          + 'time; if not, it simply waits. You can leave the tab, close the browser and come back '
          + 'to it later. An account is optional but worth having for a long game, since it is what '
          + 'keeps your progress attached to you across devices.',
      },
      { type: 'h2', text: 'The short version' },
      {
        type: 'facts',
        facts: [
          { k: 'Pace', v: 'Real-time, or asynchronous turns over hours and days.' },
          { k: 'Players', v: '1–8. Solo against AI, or 2–8 humans.' },
          { k: 'Invites', v: 'A lobby link. Guests can join without an account.' },
          { k: 'Price', v: 'Free. No purchase required to play any mode.' },
          { k: 'Install', v: 'None. It runs in the browser.' },
          { k: 'Platforms', v: 'Any modern desktop or mobile browser.' },
        ],
      },
      {
        type: 'links',
        links: [
          { href: '/', label: 'Play Borderfall' },
          { href: '/answers/play-risk-style-game-with-friends-online', label: 'Playing with friends' },
          { href: '/answers', label: 'More questions' },
        ],
      },
    ],
  },
];

/**
 * Every prerendered page, in sitemap order: the written ones, then the map
 * family, then the era family.
 *
 * Appending rather than interleaving keeps the diff of a content edit readable
 * — a new map moves nothing above it.
 */
export const MARKETING_PAGES = [
  ...STATIC_MARKETING_PAGES,
  ...buildMapMarketingPages(),
  ...buildEraMarketingPages(),
];

export function getMarketingPage(path) {
  return MARKETING_PAGES.find((p) => p.path === path);
}
