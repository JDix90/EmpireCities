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
export const MARKETING_PAGES = [
  {
    path: '/',
    file: 'index.html',
    title: 'Borderfall — Turn-Based Territory Strategy Across the Ages',
    description:
      'Borderfall is a free, turn-based territory strategy game you play in your '
      + 'browser. Classic Risk-style conquest, except the world advances through the '
      + 'ages while you play it, from ancient legions to fleets among the stars.',
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
    file: 'how-to-play/index.html',
    title: 'How to Play Borderfall — Rules, Combat & Strategy Guide',
    description:
      'Learn how to play Borderfall: reinforcements, attacking and defending, dice combat, '
      + 'continent bonuses, fortifying, and advancing through the ages. A beginner-friendly '
      + 'guide to turn-based territory strategy.',
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
    file: 'eras/index.html',
    title: 'The Eras of Borderfall — From the Ancient World to the Galaxy Age',
    description:
      'Explore the nine-era arc of Borderfall: Ancient World, Medieval Era, Age of Discovery, '
      + 'American Civil War, World War II, Cold War, the Modern Day, the Space Age, and the '
      + 'Galactic Age. Each era changes the units, technology, and theaters of war.',
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
          { href: '/', label: 'Back to Borderfall home' },
        ],
      },
    ],
  },
  {
    path: '/about',
    file: 'about/index.html',
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
    file: 'privacy/index.html',
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
    file: 'terms/index.html',
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
];

export function getMarketingPage(path) {
  return MARKETING_PAGES.find((p) => p.path === path);
}
