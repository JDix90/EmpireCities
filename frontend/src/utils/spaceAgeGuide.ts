/**
 * What a Space Age game tells a player about its own rules: the start
 * briefing's "In this era" lines and the fuller "How the Space Age works"
 * guide behind them.
 *
 * Both are written from THIS game's settings, the way the start briefing's
 * win conditions are. The Moon Race phases are the operator's kill switches
 * (docs/space-age-moon/README.md §10.2), so any of them can be off in a given
 * game, and copy describing a mechanic the game is not running is worse than
 * no copy.
 */

import type { GameState } from '../store/gameStore';
import { hegemonyTurnsFor, isLunarHegemonyInPlay } from './lunarHegemony';

/**
 * Every number the copy below states, in one place. They mirror engine
 * constants, and `backend/src/game-engine/state/spaceAgeGuideNumbers.test.ts`
 * reads this block and fails when the two drift — a guide that quotes last
 * month's costs sends players to plan around fuel they do not have.
 */
export const SPACE_AGE_RULES = {
  helium3PerTile: 1,
  helium3PerPole: 2,
  helium3Cap: 30,
  lunarExportMax: 5,
  orbitalDropUnits: 3,
  orbitalDropMoonTiles: 3,
  orbitalDropHelium3: 8,
  dropAssaultUnits: 3,
  dropAssaultMoonTiles: 3,
  dropAssaultHelium3: 10,
  dysonBeamUnits: 4,
  dysonBeamMoonTiles: 1,
  dysonBeamHelium3: 6,
  blockadeHelium3: 3,
  blockadeRounds: 2,
  pioneerDefenceDice: 2,
  pioneerSupplyDropUnits: 2,
  tributeMoonTiles: 6,
  tributeTechPoints: 1,
} as const;

const R = SPACE_AGE_RULES;

export interface SpaceAgeGuideInput {
  /** Lunar tiles on the board. Zero means there is no Moon to describe. */
  moonTiles: number;
  /** The board is the Space Age's (standalone, or Space to Stars). */
  isSpaceAge: boolean;
  isLunarPioneer: boolean;
  /** Economy on: buildings exist, so the Pioneers start with their Launch Pad. */
  economy: boolean;
  /** Secret missions are dealt, so lunar ones can be among them. */
  secretMissions: boolean;
  helium3: boolean;
  gatedTier: boolean;
  hegemony: boolean;
  hegemonyTurns: number;
  blockade: boolean;
  missions: boolean;
  tribute: boolean;
}

export function spaceAgeGuideInput(
  gameState: GameState,
  viewerPlayerId: string | null | undefined,
  moonTiles: number,
): SpaceAgeGuideInput {
  const settings = gameState.settings;
  const viewer = gameState.players.find((p) => p.player_id === viewerPlayerId);
  const victory = settings.allowed_victory_conditions?.length
    ? settings.allowed_victory_conditions
    : [settings.victory_type ?? 'domination'];
  return {
    moonTiles,
    isSpaceAge: gameState.era === 'space_age',
    isLunarPioneer: viewer?.faction_id === 'lunar_pioneers',
    economy: settings.economy_enabled === true,
    secretMissions: victory.includes('secret_mission'),
    helium3: settings.space_age_moon_helium3_enabled === true,
    gatedTier: settings.space_age_moon_gated_tier_enabled === true,
    hegemony: isLunarHegemonyInPlay(settings),
    hegemonyTurns: hegemonyTurnsFor(settings),
    blockade: settings.space_age_moon_blockade_enabled === true,
    missions: settings.space_age_moon_missions_enabled === true,
    tribute: settings.space_age_moon_tribute_enabled === true,
  };
}

/**
 * Whether there is a Space Age to talk about at all. An era-advancement climb
 * reaches the era on its own moonless board, where none of this exists.
 */
export function hasSpaceAgeGuide(input: SpaceAgeGuideInput): boolean {
  return input.isSpaceAge && input.moonTiles > 0;
}

/**
 * The orbital powers bought with Helium-3. The gated tier needs the He-3
 * economy as well as its own phase (`areMoonPowersEnabled`), and a blockade is
 * priced in He-3, so without the economy none of them can be used.
 */
function helium3Uses(input: SpaceAgeGuideInput): { gated: boolean; blockade: boolean } {
  return {
    gated: input.helium3 && input.gatedTier,
    blockade: input.helium3 && input.blockade,
  };
}

export interface EraLine {
  id: string;
  icon: string;
  text: string;
}

/**
 * Three short lines for the start briefing: the Moon, the way up, and what
 * the Moon is for. Everything else lives in the guide behind the link — the
 * briefing is one tap to dismiss on a phone, and every line is read in it.
 */
export function describeSpaceAgeEra(input: SpaceAgeGuideInput): EraLine[] {
  if (!hasSpaceAgeGuide(input)) return [];
  const lines: EraLine[] = [
    {
      id: 'moon',
      icon: '🌕',
      text: `The Moon is a second front: ${input.moonTiles} more territories, neutral and garrisoned, and they count toward every way to win.`,
    },
    {
      id: 'program',
      icon: '🚀',
      text: input.isLunarPioneer
        ? input.economy
          ? 'Your Lunar Pioneers can land from turn one, and start with a Launch Pad whose orbit lane runs straight to the Moon.'
          : 'Your Lunar Pioneers can land from turn one. You still need an orbit lane, so hold one of the spaceports.'
        : 'Getting there takes the Space Program: Spaceport Infrastructure, a Launch Pad, the Space Station, then Lunar Expansion. The Space Program panel tracks each step.',
    },
  ];
  if (input.helium3) {
    const uses = helium3Uses(input);
    const fuelFor = [
      ...(uses.gated ? ['orbital drops', 'the Dyson Beam'] : []),
      ...(uses.blockade ? ['lane blockades'] : []),
    ];
    lines.push({
      id: 'helium3',
      icon: '☾',
      text: fuelFor.length > 0
        ? `Moon territories mine Helium-3 every turn: the fuel for ${joinAnd(fuelFor)}.`
        : 'Moon territories mine Helium-3 every turn, which you can trade for tech.',
    });
  }
  return lines;
}

export interface GuideSection {
  id: string;
  icon: string;
  title: string;
  paragraphs: string[];
  /** A short list under the paragraphs, for things to spend or to aim for. */
  items?: string[];
}

/** The full guide, in the order a new player needs it. */
export function buildSpaceAgeGuide(input: SpaceAgeGuideInput): GuideSection[] {
  if (!hasSpaceAgeGuide(input)) return [];
  const sections: GuideSection[] = [
    {
      id: 'moon',
      icon: '🌕',
      title: 'The Moon',
      paragraphs: [
        `The Space Age is fought on two boards: Earth, and ${input.moonTiles} lunar territories. The Moon starts neutral and garrisoned, and nobody is dealt any of it — not even the Lunar Pioneers.`,
        'Moon territories count toward every way to win. Domination needs them too, and they are part of the total a percentage win is measured against.',
      ],
    },
    input.isLunarPioneer
      ? {
          id: 'program',
          icon: '🚀',
          title: 'Getting there',
          paragraphs: [
            input.economy
              ? 'Your Lunar Pioneers skip the Space Program. You have Moon access from turn one, and you start with a Launch Pad, whose orbit lane runs straight to the Moon.'
              : 'Your Lunar Pioneers skip the Space Program: you have Moon access from turn one. You still need an orbit lane to cross, so hold one of the spaceports.',
            `Up there you defend with +${R.pioneerDefenceDice} dice, and Lunar Supply Drop puts ${R.pioneerSupplyDropUnits} units on a Moon territory you hold, once a turn. Everyone else has to research and build their way up.`,
          ],
        }
      : {
          id: 'program',
          icon: '🚀',
          title: 'Getting there',
          paragraphs: [
            'Crossing to the Moon takes three things at once: Lunar Expansion researched, a Launch Pad on a territory you own, and a launched Space Station (the Space Elevator wonder can stand in for the launch).',
            'On the way you research Spaceport Infrastructure, which unlocks the Launch Pad, and Orbital Station Program, which unlocks the launch. The Space Program panel shows each step.',
            'Every Launch Pad opens its own orbit lane to the Moon, so you launch from wherever you build. Lose your last pad and you are stranded: you keep your Moon territories, but cannot cross a lane until you build another.',
          ],
        },
  ];

  if (input.helium3) {
    const uses = helium3Uses(input);
    const items = [
      `Lunar Export: trade up to ${R.lunarExportMax} He-3 a turn for tech points, one for one.`,
    ];
    if (uses.gated) {
      items.push(
        `Orbital Drop: ${R.orbitalDropUnits} units onto any territory you own, anywhere. ${R.orbitalDropHelium3} He-3, while you hold ${R.orbitalDropMoonTiles} Moon territories.`,
        `Drop Assault: mark an Earth territory you don't hold, and ${R.dropAssaultUnits} units land and attack it at the start of your next turn. Everyone sees the mark coming. ${R.dropAssaultHelium3} He-3, while you hold ${R.dropAssaultMoonTiles} Moon territories.`,
        `Dyson Beam: with the Dyson Array tech, strip up to ${R.dysonBeamUnits} units from any enemy territory. ${R.dysonBeamHelium3} He-3, while you hold a Moon territory.`,
      );
    }
    if (uses.blockade) {
      items.push(
        `Orbital Blockade: hold either end of one of the three original orbit lanes and seal it against rivals for ${R.blockadeRounds} rounds. ${R.blockadeHelium3} He-3.`,
      );
    }
    sections.push({
      id: 'helium3',
      icon: '☾',
      title: 'Helium-3',
      paragraphs: [
        `Each Moon territory mines ${R.helium3PerTile} Helium-3 at the start of your turn, and the two poles mine ${R.helium3PerPole}. You can bank up to ${R.helium3Cap}. Spend it on:`,
      ],
      items,
    });
  }

  if (input.hegemony) {
    sections.push({
      id: 'hegemony',
      icon: '👑',
      title: 'Lunar Hegemony',
      paragraphs: [
        `Hold all ${input.moonTiles} Moon territories at the end of ${input.hegemonyTurns} of your own turns in a row and you win, however Earth stands.`,
        'Everyone sees the countdown, and it starts over the moment the holder loses a single Moon territory.',
        'Once anyone holds Moon ground, the Moon is contested: everyone else can fly with just Spaceport Infrastructure and a Launch Pad. The first one up gets a head start, not a fortress.',
      ],
    });
  }

  if (input.missions && input.secretMissions) {
    sections.push({
      id: 'missions',
      icon: '🎯',
      title: 'Moon missions',
      paragraphs: [
        'Some secret missions point at the Moon: take both poles, hold the whole Moon, hold 3 or 5 Moon territories, or hold 3 while keeping a named rival off it entirely.',
      ],
    });
  }

  if (input.tribute) {
    sections.push({
      id: 'tribute',
      icon: '⇉',
      title: 'Tribute',
      paragraphs: [
        `Hold ${R.tributeMoonTiles} or more Moon territories and every player holding none pays you ${R.tributeTechPoints} tech point a turn.`,
      ],
    });
  }

  return sections;
}

/** "a", "a and b", "a, b and c". */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
