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
 * <!-- TODO: refine copy --> markers in the strings below flag sections the
 * product owner should expand or polish; they are intentionally visible in the
 * prerendered HTML source as a reminder, not rendered as UI.
 */

export const SITE_URL = 'https://borderfall.gg';
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

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
      + 'Tanks, air power, and the race for game-changing technology.',
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
      'Borderfall is a free, turn-based territory strategy game in your browser — '
      + 'Risk that advances through the ages, from ancient kingdoms to galactic fronts. '
      + 'Every border is temporary.',
    h1: 'Borderfall',
    tagline: 'Every border is temporary.',
    jsonLd: true,
    blocks: [
      {
        type: 'p',
        text:
          'Borderfall is turn-based territory strategy that advances through the ages — '
          + 'free in your browser, no download required. It takes the familiar tension of '
          + 'classic Risk-style conquest and stretches it across a timeline that runs from '
          + 'ancient kingdoms to galactic fronts. You command units, break enemy lines, and '
          + 'redraw the map one turn at a time, then carry the fight forward as the world '
          + 'itself advances into new eras.',
      },
      {
        type: 'p',
        text:
          'Each match begins with reinforcement, maneuver, and the decisive roll of combat. '
          + 'Mass troops on a contested border, sever a rival’s supply of continents, or hold '
          + 'a chokepoint against a larger force. Continent bonuses reward consolidation, while '
          + 'every exposed front invites a counterattack — there is no safe border for long.',
      },
      {
        type: 'h2',
        text: 'Advance through the eras',
      },
      {
        type: 'p',
        text:
          'What sets Borderfall apart is era advancement. Push your civilization forward and '
          + 'the rules of war change underneath you: new technologies, units, factions, and even '
          + 'naval and orbital theaters come into play. A game can begin with legions on a '
          + 'classical map and end with fleets contesting galactic fronts. The arc spans nine '
          + 'eras, from the Ancient World through the Modern Day and on into the Space and '
          + 'Galactic Ages.',
      },
      {
        type: 'h2',
        text: 'Play your way',
      },
      {
        type: 'p',
        text:
          'Play solo against AI, challenge friends in private lobbies, or jump into multiplayer '
          + 'matches. Borderfall runs entirely in the browser, supports quick "lite" games as '
          + 'well as full campaigns, and is free to play. Learn the systems in the how-to-play '
          + 'guide, then explore the full era roster before your first match.',
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
    title: 'The Eras of Borderfall — From Ancient Kingdoms to Galactic Fronts',
    description:
      'Explore the nine-era arc of Borderfall: Ancient World, Medieval Era, Age of Discovery, '
      + 'American Civil War, World War II, Cold War, the Modern Day, the Space Age, and the '
      + 'Galactic Age. Each era changes the units, technology, and theaters of war.',
    h1: 'The Eras of Borderfall',
    tagline: 'One war, nine ages — from ancient kingdoms to galactic fronts.',
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
];

export function getMarketingPage(path) {
  return MARKETING_PAGES.find((p) => p.path === path);
}
