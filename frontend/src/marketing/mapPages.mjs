/**
 * The curated map pages: /game-maps and /game-maps/:slug.
 *
 * NOT /maps — that path is the authenticated Map Hub, and publishing over
 * it made the Hub unreachable for logged-in players until this was caught
 * in production. A marketing route and an app route cannot share a path.
 *
 * Why these exist, and why there are twelve rather than thirty-two: a page
 * earns its place by having a subject someone might actually search for. "Roman
 * Empire strategy game" is a thing people type; "Borderfall map #17" is not.
 * The board data comes from mapCatalog.generated.mjs (projected from the real
 * map definitions, so the numbers on the page are the numbers you play), and
 * each entry below adds the one thing data cannot supply: a sentence about how
 * that particular board plays, written by someone who looked at it.
 *
 * Keep the `hook` honest and specific. If a hook would read the same with
 * another map's name swapped in, it is not worth publishing — that is the
 * difference between a page and filler.
 *
 * Consumed by seoContent.mjs, which folds these into MARKETING_PAGES; from
 * there the prerender script writes the crawlable HTML and SeoContentPage
 * renders the live React version from the same data.
 */

import { MAP_CATALOG } from './mapCatalog.generated.mjs';

/** Editorial layer, keyed by the catalog slug. Order here is the order /game-maps lists. */
export const MAP_PAGE_COPY = {
  'roman-empire-117': {
    title: 'Roman Empire Map — Free Browser Strategy Game',
    description:
      'The Roman Empire at its height, 117 A.D.: 41 provinces from Britannia to Mesopotamia. Free turn-based strategy in your browser, nothing to install.',
    h1: 'Roman Empire — 117 A.D.',
    hook:
      'A third of the routes on this board are Mediterranean sea lanes, which makes it far more '
      + 'open than its shape suggests: Africa can strike Italia without touching Gaul. Holding the '
      + 'imperial core is worth +5 a turn and draws every neighbour at once, so the usual winning '
      + 'shape is to take a quiet frontier province first and grow inward.',
  },
  'sengoku-japan': {
    title: 'Sengoku Japan Map — Warring States Strategy Game',
    description:
      'The Sengoku period as a strategy map: 38 provinces from Satsuma to Ezo, and a march on Kyoto. Free in your browser, nothing to install.',
    h1: 'Sengoku Japan — Warring States',
    hook:
      'Almost half the connections here are sea crossings, so the island chain never really splits '
      + 'into safe interiors — Kyūshū can be hit from Shikoku and the Inland Sea in the same turn. '
      + 'Kinki is the prize at +5 and sits in the middle of everything, which is exactly why '
      + 'holding it early tends to end badly.',
  },
  'napoleonic-europe': {
    title: 'Napoleonic Europe Map — 1812 Strategy Game',
    description:
      'Europe in 1812: 44 territories, the French Empire at its furthest extent, and the Russian campaign ahead. Free browser strategy, no download.',
    h1: 'Napoleonic Europe — 1812',
    hook:
      'The densest board in the set — 110 routes across 44 territories — so fronts here are wide '
      + 'and there is almost nowhere to hide a weak flank. The French Empire starts worth +6 and '
      + 'borders nearly everyone, which reproduces the historical problem fairly well: the '
      + 'strongest position is also the one everybody can reach.',
  },
  'mongol-empire': {
    title: 'Mongol Empire Map — 1279 Strategy Game',
    description:
      'The Mongol Empire in 1279: Yuan China, the Golden Horde, the Ilkhanate and the Chagatai Khanate across 36 territories. Free in your browser.',
    h1: 'Mongol Empire — 1279',
    hook:
      'Nine sea routes on a 36-territory board makes this the land war of the set: everything is '
      + 'decided by who holds the steppe corridors between the khanates. Yuan China pays the most '
      + 'at +6, but the Heartland is the board’s hinge — it touches four regions, and whoever '
      + 'holds it chooses which war to fight next.',
  },
  'charlemagne-814': {
    title: 'Europe 814 A.D. Map — Death of Charlemagne Strategy Game',
    description:
      'Europe at the death of Charlemagne, 814 A.D.: 46 territories from the Frankish Empire to the steppe khaganates. Free in your browser.',
    h1: 'Europe — Death of Charlemagne, 814 A.D.',
    hook:
      'The biggest board here, and the most lopsided: the Frankish Empire is twelve territories '
      + 'paying +7, while the Maghreb and the Abbasids pay +1 for two. That asymmetry is the game — '
      + 'the Frankish player is always ahead and always overextended, and the small powers win by '
      + 'deciding together when to take the inheritance apart.',
  },
  'fractured-china': {
    title: 'Warlord Era China Map — Strategy Game in Your Browser',
    description:
      'China’s Warlord Era as a strategy map: the Fengtian, Zhili and southern cliques across 30 '
      + 'territories, from Manchuria to Yunnan. Free, browser-based, no signup.',
    h1: 'Fractured China — Warlord Era',
    hook:
      'Four sea routes in total, so this is a board about interior lines and nothing else. The '
      + 'treaty ports of Jiangnan pay +6 off only four territories — the richest square foot in the '
      + 'game — and the Northern Frontier and Xinjiang are cheap, wide and nearly indefensible. '
      + 'Rich and small versus poor and vast, which is roughly the period’s argument.',
  },
  'byzantium-megali': {
    title: 'Byzantine Empire Map — Surviving Byzantium Strategy Game',
    description:
      'A Byzantium that held: Constantinople, Anatolia, the Aegean and an Ottoman rump across 33 territories. Free turn-based strategy in your browser.',
    h1: 'Surviving Byzantium',
    hook:
      'Greece and the City pay +6 and the Aegean isles another +5, so the strong position is a '
      + 'naval one — nineteen of the sixty-four routes are sea crossings, and the islands let a '
      + 'fleet-minded player reach behind a land front. The Ottoman rump starts wedged between both '
      + 'halves of the Byzantine position, which is an uncomfortable place to begin and a decisive '
      + 'one to survive.',
  },
  'balkanized-india': {
    title: 'India Strategy Map — Balkanized India Browser Game',
    description:
      'The subcontinent as rival states: Sikh Punjab, the Marathas, Bengal and the Dravidian south across 33 territories. Free browser strategy.',
    h1: 'Balkanized India',
    hook:
      'Hindustan pays +6 across six territories in the middle of the board and touches almost every '
      + 'neighbour, so it is the obvious target and a hard hold. With only three sea routes, the '
      + 'south is genuinely defensible — the Dravidian states and Lanka can turtle behind the Deccan '
      + 'while the north exhausts itself, which is how the long games here tend to be won.',
  },
  'uncolonized-africa': {
    title: 'Africa Strategy Map — Uncolonized Africa Browser Game',
    description:
      'Africa without the colonial partition: the Sahelian empires, Abyssinia, the Swahili coast and Kongo across 38 territories. Free in your browser.',
    h1: 'Uncolonized Africa',
    hook:
      'Two sea routes on a 38-territory continent: this is the most land-locked board in the set, '
      + 'and distance does the work that water does elsewhere. The Sahel and the southern block are '
      + 'both six-territory regions, wide and slow to consolidate, so early aggression usually just '
      + 'buys you a long border with someone who is now angry.',
  },
  nusantara: {
    title: 'Southeast Asia Map — Maritime Strategy Game in Your Browser',
    description:
      'Maritime Southeast Asia: Majapahit Java, Srivijaya, Borneo, the Philippines and the Spice '
      + 'Islands across 34 territories. Free browser strategy, no download.',
    h1: 'Maritime Southeast Asia',
    hook:
      'More than half the routes on this board are sea lanes — the most maritime map in the set — '
      + 'so nothing is ever more than a couple of crossings from anything else and land borders '
      + 'barely constrain the fighting. Java pays +6 off four territories and Siam +4 off two, which '
      + 'makes the small rich islands the whole argument.',
  },
  'south-america': {
    title: 'South America Map — Free Browser Strategy Game',
    description:
      'South America as rival powers: Brazil, Rio de la Plata, Gran Colombia, the Andean Federation and Chile across 34 territories. Free to play.',
    h1: 'Balkanized South America',
    hook:
      'No sea routes at all — every one of the seventy connections is a land border, which makes '
      + 'this the purest positional board here. Brazil and the Río de la Plata are nine territories '
      + 'each and pay +7 and +6, so the two giants are slow to fold and slow to win, and Paraguay '
      + 'at +2 for two is the smallest viable kingdom in the game.',
  },
  'britain-925': {
    title: 'Great Britain 925 A.D. Map — Viking Age Strategy Game',
    description:
      'Britain in 925 A.D.: Anglo-Saxon England, the Danelaw, and the Welsh and Scottish kingdoms across 14 territories. The quickest board, free.',
    h1: 'Great Britain — 925 A.D.',
    hook:
      'Fourteen territories and twenty-three routes make this the shortest game in the set — the '
      + 'board it is worth opening if you have twenty minutes rather than an evening. Anglo-Saxon '
      + 'England is six of those fourteen and pays +4, so the game is usually a straight question of '
      + 'whether everyone else moves on Wessex before it consolidates.',
  },
};

/** Catalog entries paired with their copy, in MAP_CATALOG order. */
export const MAP_PAGES = MAP_CATALOG.map((map) => {
  const copy = MAP_PAGE_COPY[map.slug];
  if (!copy) {
    throw new Error(
      `[map-pages] ${map.slug} is in MAP_CATALOG but has no entry in MAP_PAGE_COPY. `
      + 'Every published map needs written copy; add one or drop it from MAP_PAGE_IDS.',
    );
  }
  return { ...map, ...copy };
});

/** Plural-aware, because "1 sea routes" on a page about care is a bad look. */
function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** How open a board plays, in words, derived from its own numbers. */
function opennessNote(map) {
  if (map.sea_route_count === 0) return 'Land borders only — no sea routes.';
  const share = Math.round((map.sea_route_count / map.connection_count) * 100);
  return `${count(map.sea_route_count, 'sea route', 'sea routes')} of ${map.connection_count} (${share}%).`;
}

/** The blocks for one map page. Data first, then the written read of the board. */
export function mapPageBlocks(map) {
  return [
    { type: 'p', text: map.description },
    { type: 'p', text: map.hook },
    { type: 'h2', text: 'The board' },
    {
      type: 'facts',
      facts: [
        { k: 'Territories', v: String(map.territory_count) },
        { k: 'Regions', v: String(map.regions.length) },
        { k: 'Routes', v: opennessNote(map) },
        { k: 'Players', v: '2–8, any mix of people and AI' },
        { k: 'Price', v: 'Free. No download, no account required.' },
      ],
    },
    { type: 'h2', text: 'Regions and what they pay' },
    {
      type: 'p',
      text:
        'Hold every territory in a region and it pays you reinforcements at the start of each of '
        + 'your turns. Bigger regions pay more and are harder to keep.',
    },
    {
      type: 'facts',
      facts: map.regions.map((r) => ({
        k: r.name,
        v: `${count(r.territory_count, 'territory', 'territories')} · +${r.bonus} per turn`,
      })),
    },
    { type: 'h2', text: 'Play it' },
    {
      type: 'p',
      text:
        'Open Borderfall, start a game, and pick this map in the lobby. You can play it against AI '
        + 'on your own, or share a lobby link with friends. Guest play needs no account.',
    },
    {
      type: 'links',
      links: [
        { href: '/', label: 'Play Borderfall' },
        { href: '/game-maps', label: 'All maps' },
        { href: '/how-to-play', label: 'How to play' },
      ],
    },
  ];
}

/** MARKETING_PAGES entries: the index, then one page per map. */
export function buildMapMarketingPages() {
  const index = {
    path: '/game-maps',
    title: 'Borderfall Maps — Historical Strategy Boards, Free in Your Browser',
    description:
      `${MAP_PAGES.length} hand-built historical maps for a free turn-based strategy game: Rome, `
      + 'Sengoku Japan, Napoleonic Europe, the Mongol Empire and more. No download.',
    h1: 'Maps',
    tagline: 'Twelve historical boards, each with its own argument.',
    jsonLd: false,
    blocks: [
      {
        type: 'p',
        text:
          'Borderfall ships a set of hand-built historical maps alongside the era boards. Each one '
          + 'is a real setting with its own geography, its own regions, and its own reason to play '
          + 'differently — an archipelago plays nothing like a landlocked continent. All of them are '
          + 'free, in the browser, with nothing to install.',
      },
      { type: 'h2', text: 'The maps' },
      {
        type: 'facts',
        facts: MAP_PAGES.map((m) => ({
          k: m.name,
          v: `${count(m.territory_count, 'territory', 'territories')}, `
            + `${count(m.regions.length, 'region', 'regions')}.`,
        })),
      },
      {
        type: 'links',
        links: [
          ...MAP_PAGES.map((m) => ({ href: `/game-maps/${m.slug}`, label: m.h1 })),
        ],
      },
      { type: 'h2', text: 'Play any of them' },
      {
        type: 'p',
        text:
          'Start a game and choose a map in the lobby. Play solo against AI, or send a lobby link to '
          + 'friends — guests can join without making an account.',
      },
      {
        type: 'links',
        links: [
          { href: '/', label: 'Play Borderfall' },
          { href: '/eras', label: 'The eras' },
          { href: '/how-to-play', label: 'How to play' },
        ],
      },
    ],
  };

  const pages = MAP_PAGES.map((map) => ({
    path: `/game-maps/${map.slug}`,
    title: map.title,
    description: map.description,
    h1: map.h1,
    tagline: '',
    jsonLd: false,
    blocks: mapPageBlocks(map),
  }));

  return [index, ...pages];
}
