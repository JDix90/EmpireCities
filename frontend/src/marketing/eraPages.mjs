/**
 * The era pages: /eras/:slug, one per playable era.
 *
 * /eras is a single page listing nine eras in a sentence each — fine as an
 * overview, useless to someone searching for "ww2 strategy game browser". These
 * pages exist because each era is a genuinely different game (a different
 * board, a different roster, different rules) and because those are phrases
 * people actually type, unlike the name of any individual faction.
 *
 * Everything factual is joined from data the game owns: the roster comes from
 * factionCodex.generated.mjs and the board from ERA_MAPS in
 * mapCatalog.generated.mjs, so a balance change or a redrawn map updates these
 * pages the next time the generators run. What lives here is the editorial
 * layer — the query the page is for, and a written read of how the era plays.
 *
 * `years` is duplicated from the ERAS arc in seoContent.mjs rather than joined
 * by label, because matching prose to prose is the kind of link that breaks
 * silently. seoContent.test.ts asserts the two agree.
 */

import { FACTION_CODEX } from './factionCodex.generated.mjs';
import { ERA_MAPS } from './mapCatalog.generated.mjs';

/**
 * Editorial layer, keyed by era id. Every era in the codex needs an entry —
 * buildEraMarketingPages throws otherwise, so a new era cannot ship a page
 * that is a heading and a faction list.
 */
export const ERA_PAGE_COPY = {
  ancient: {
    years: '3000 BC – 400 AD',
    title: 'Ancient Warfare Strategy Game — Free in Your Browser',
    description:
      'Rome, Parthia, Han China, Carthage and Maurya on a 57-territory ancient world map. '
      + 'Free turn-based strategy in your browser — no download, no account.',
    h1: 'The Ancient World',
    hook:
      'The widest opening board in the game at 57 territories across 22 regions, which makes the '
      + 'first dozen turns a land grab rather than a war — there is simply more neutral ground than '
      + 'anyone can reach. Rome rewards discipline and Parthia punishes overreach; the Germanic '
      + 'tribes are the cheapest way to learn how much a defensible frontier is worth.',
  },
  medieval: {
    years: '400 – 1400 AD',
    title: 'Medieval Strategy Game — Free Browser Game, No Download',
    description:
      'Crusader kingdoms, caliphates and the Mongol conquests on a 36-territory medieval map. '
      + 'Free turn-based strategy in any browser, playable as a guest.',
    h1: 'The Medieval Era',
    hook:
      'A tighter board than the ancient world — 36 territories — so contact happens early and the '
      + 'game is decided by chokepoints rather than expansion. The Mongol Khanate is built to punish '
      + 'anyone who spread thin in the opening, which makes this the era where a careful player '
      + 'beats a fast one.',
  },
  discovery: {
    years: '1400 – 1800 AD',
    title: 'Age of Discovery Strategy Game — Free in Your Browser',
    description:
      'Spain, Portugal, the Ottomans, Ming and the Mughals as ocean-going empires on a '
      + '41-territory map. Free turn-based strategy, nothing to install.',
    h1: 'The Age of Discovery',
    hook:
      'The era where sea lanes start mattering as much as borders: fleets turn a distant coast into '
      + 'a neighbour, and a colonial position far from home can be reinforced faster than the land '
      + 'route suggests. The Iberian powers are strongest early and hardest to hold late, which is '
      + 'roughly how it went.',
  },
  acw: {
    years: '1861 – 1865',
    title: 'Civil War Strategy Game — Free Browser Game',
    description:
      'The American Civil War as a two-sided turn-based strategy game: Union and Confederate lines '
      + 'across 18 territories. Free in your browser, no signup.',
    h1: 'The American Civil War',
    hook:
      'Two factions and eighteen territories make this the sharpest game in the set — no diplomacy, '
      + 'no third party to balance against, just a front line and who can concentrate force at the '
      + 'right point. It is also the fastest way to learn the combat maths, because nothing else is '
      + 'happening to distract you.',
  },
  risorgimento: {
    years: '1859 – 1871',
    title: 'Italian Unification Strategy Game — Free in Your Browser',
    description:
      'The Risorgimento as a strategy game: Sardinia, Austria, the Papal States and the Two '
      + 'Sicilies across 14 territories. Free, browser-based, no account.',
    h1: 'Italian Unification',
    hook:
      'The smallest board here — fourteen territories, four powers — and the one that plays most '
      + 'like a puzzle. Sardinia has to unify a peninsula while Austria holds the north, so it '
      + 'rewards sequencing over strength: the order you take things in matters more than what you '
      + 'take.',
  },
  ww2: {
    years: '1939 – 1945',
    title: 'WW2 Strategy Game — Free Turn-Based Browser Game',
    description:
      'World War II as turn-based strategy: the Reich, the USSR, the US, Britain, Japan and Nationalist China on a 42-territory map. Free in your browser.',
    h1: 'World War II',
    hook:
      'Six powers on a global board, which means the war is never one war — the Pacific and the '
      + 'Eastern Front run on separate clocks and reinforcements have to be chosen between them. '
      + 'The classic mistake here is winning both theatres slowly instead of one of them quickly.',
  },
  coldwar: {
    years: '1945 – 1991',
    title: 'Cold War Strategy Game — Free in Your Browser',
    description:
      'The Cold War as turn-based strategy: two superpowers, China, NATO and the Non-Aligned '
      + 'Movement across a 51-territory world. Free browser game, no download.',
    h1: 'The Cold War',
    hook:
      'The largest Earth board in the game at 51 territories across 13 regions, and the one where '
      + 'position beats conquest — the Non-Aligned Movement exists to make the middle of the map '
      + 'worth contesting rather than taking. Expect long games decided on the periphery.',
  },
  modern: {
    years: '2026',
    title: 'Modern Strategy Game — Free Turn-Based Browser Game',
    description:
      'Present-day powers on a 50-territory world map: blocs, rogue states, petrostates and cyber states. Free turn-based strategy in your browser.',
    h1: 'The Modern Day',
    hook:
      'The only era whose factions are archetypes rather than nations — a petrostate and a cyber '
      + 'state want completely different things from the same board, so the asymmetry here is '
      + 'sharper than in the historical eras. The map is the world you know, which makes the '
      + 'opening decisions feel uncomfortably legible.',
  },
  space_age: {
    years: '2100 AD',
    title: 'Space Strategy Game — Free Turn-Based Browser Game',
    description:
      'Orbital and lunar warfare as turn-based strategy: 63 territories above and on the Earth, '
      + 'six factions, free in your browser with nothing to install.',
    h1: 'The Space Age',
    hook:
      'The board leaves the surface: 63 territories across orbit and the Moon, so for the first '
      + 'time position has a vertical axis and a lunar foothold can threaten places no land border '
      + 'touches. The Lunar Pioneers start where everyone else has to arrive.',
  },
  galaxy_age: {
    years: 'Far Future',
    title: 'Galactic Strategy Game — Free Turn-Based Browser Game',
    description:
      'The endgame era: four powers contesting 64 systems across the galaxy. Free turn-based '
      + 'strategy in your browser, reached by playing a game all the way through.',
    h1: 'The Galactic Age',
    hook:
      'Four factions and 64 systems — the fewest players on the most ground, which inverts every '
      + 'habit the earlier eras teach. Borders stop being lines and become routes, and a game that '
      + 'reaches here has usually already decided who is winning; this is where it gets settled.',
  },
};

/** Codex eras joined to their copy, roster and board, in codex order. */
export const ERA_PAGES = FACTION_CODEX.map((era) => {
  const copy = ERA_PAGE_COPY[era.era_id];
  if (!copy) {
    throw new Error(
      `[era-pages] era "${era.era_id}" has factions but no entry in ERA_PAGE_COPY. `
      + 'Every published era needs written copy; add one rather than shipping a bare roster.',
    );
  }
  return { era_id: era.era_id, factions: era.factions, board: ERA_MAPS[era.era_id], ...copy };
});

function count(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The blocks for one era page. */
export function eraPageBlocks(era) {
  const blocks = [
    { type: 'p', text: era.hook },
    { type: 'h2', text: 'The era at a glance' },
    {
      type: 'facts',
      facts: [
        { k: 'Period', v: era.years },
        { k: 'Factions', v: String(era.factions.length) },
        ...(era.board
          ? [
            { k: 'Board', v: `${era.board.name} — ${count(era.board.territory_count, 'territory', 'territories')}` },
            { k: 'Regions', v: String(era.board.regions.length) },
          ]
          : []),
        { k: 'Players', v: '2–8, any mix of people and AI' },
        { k: 'Price', v: 'Free. No download, no account required.' },
      ],
    },
    { type: 'h2', text: 'Who you can play' },
    {
      type: 'p',
      text:
        'Each faction has its own passive strengths and one ability that changes how it fights. '
        + 'They are asymmetric on purpose — the same board plays differently depending on who you take.',
    },
    { type: 'factions', era_id: era.era_id },
  ];

  if (era.board?.regions?.length) {
    blocks.push({ type: 'h2', text: 'Regions and what they pay' });
    blocks.push({
      type: 'facts',
      facts: era.board.regions.map((r) => ({
        k: r.name,
        v: `${count(r.territory_count, 'territory', 'territories')} · +${r.bonus} per turn`,
      })),
    });
  }

  blocks.push({ type: 'h2', text: 'Play this era' });
  blocks.push({
    type: 'p',
    text:
      'Start a game and pick the era in the lobby, or let a full campaign carry you through the '
      + 'whole arc — a single game can begin with legions and end in orbit. Guest play needs no '
      + 'account.',
  });
  blocks.push({
    type: 'links',
    links: [
      { href: '/', label: 'Play Borderfall' },
      { href: '/eras', label: 'All eras' },
      { href: '/codex', label: 'Every faction' },
      { href: '/game-maps', label: 'The maps' },
    ],
  });

  return blocks;
}

/** MARKETING_PAGES entries: one per era. /eras itself already exists. */
export function buildEraMarketingPages() {
  return ERA_PAGES.map((era) => ({
    path: `/eras/${era.era_id.replace(/_/g, '-')}`,
    file: `eras/${era.era_id.replace(/_/g, '-')}/index.html`,
    title: era.title,
    description: era.description,
    h1: era.h1,
    tagline: era.years,
    jsonLd: false,
    blocks: eraPageBlocks(era),
  }));
}
