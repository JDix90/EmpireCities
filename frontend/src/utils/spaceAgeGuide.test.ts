import { describe, it, expect } from 'vitest';
import {
  buildSpaceAgeGuide,
  describeSpaceAgeEra,
  spaceAgeGuideInput,
  type SpaceAgeGuideInput,
} from './spaceAgeGuide';
import type { GameState } from '../store/gameStore';

/**
 * The Space Age explains itself from the game's own settings: every Moon Race
 * phase is an operator kill switch, so a line about a mechanic this game is not
 * running would be teaching a rule that does not exist.
 */

const everything: SpaceAgeGuideInput = {
  moonTiles: 9,
  isSpaceAge: true,
  isLunarPioneer: false,
  economy: true,
  secretMissions: true,
  helium3: true,
  gatedTier: true,
  hegemony: true,
  hegemonyTurns: 7,
  blockade: true,
  missions: true,
  tribute: false,
};

const ids = (sections: { id: string }[]) => sections.map((s) => s.id);

describe('the start briefing\'s "In this era" lines', () => {
  it('names the Moon, the way up and what the Moon is for', () => {
    const lines = describeSpaceAgeEra(everything);
    expect(ids(lines)).toEqual(['moon', 'program', 'helium3']);
    expect(lines[0]!.text).toMatch(/9 more territories/);
    expect(lines[1]!.text).toMatch(/Spaceport Infrastructure, a Launch Pad, the Space Station, then Lunar Expansion/);
    expect(lines[2]!.text).toBe(
      'Moon territories mine Helium-3 every turn: the fuel for orbital drops, the Dyson Beam and lane blockades.',
    );
  });

  it('names only the Helium-3 uses this game has', () => {
    const noTier = describeSpaceAgeEra({ ...everything, gatedTier: false, blockade: false });
    expect(noTier[2]!.text).toMatch(/trade for tech/);
    const noHelium = describeSpaceAgeEra({ ...everything, helium3: false });
    expect(ids(noHelium)).toEqual(['moon', 'program']);
  });

  it('tells a Lunar Pioneer they start with the way up', () => {
    const [, program] = describeSpaceAgeEra({ ...everything, isLunarPioneer: true });
    expect(program!.text).toMatch(/land from turn one, and start with a Launch Pad/);
    // No economy, no buildings: the faction's starting pad does not exist.
    const [, bare] = describeSpaceAgeEra({ ...everything, isLunarPioneer: true, economy: false });
    expect(bare!.text).toMatch(/hold one of the spaceports/);
  });

  it('says nothing on a board without a Moon', () => {
    // An era-advancement climb reaches the Space Age on its moonless start
    // board; the phases are baked but have nothing to act on.
    expect(describeSpaceAgeEra({ ...everything, moonTiles: 0 })).toEqual([]);
    expect(describeSpaceAgeEra({ ...everything, isSpaceAge: false })).toEqual([]);
  });
});

describe('How the Space Age works', () => {
  it('walks through every running mechanic in order', () => {
    expect(ids(buildSpaceAgeGuide(everything))).toEqual(['moon', 'program', 'helium3', 'hegemony', 'missions']);
  });

  it('prices the orbital powers', () => {
    const helium = buildSpaceAgeGuide(everything).find((s) => s.id === 'helium3')!;
    expect(helium.paragraphs[0]).toMatch(/mines 1 Helium-3 .* poles mine 2\. You can bank up to 30/);
    expect(helium.items).toHaveLength(5);
    expect(helium.items!.find((i) => i.startsWith('Orbital Drop'))).toMatch(/8 He-3, while you hold 3 Moon territories/);
    expect(helium.items!.find((i) => i.startsWith('Drop Assault'))).toMatch(/10 He-3/);
    expect(helium.items!.find((i) => i.startsWith('Orbital Blockade'))).toMatch(/for 2 rounds\. 3 He-3/);
  });

  it('leaves out the gated tier when the phase is off, or when there is no He-3 to pay for it', () => {
    const noTier = buildSpaceAgeGuide({ ...everything, gatedTier: false }).find((s) => s.id === 'helium3')!;
    expect(noTier.items!.map((i) => i.split(':')[0])).toEqual(['Lunar Export', 'Orbital Blockade']);
    expect(ids(buildSpaceAgeGuide({ ...everything, helium3: false }))).not.toContain('helium3');
  });

  it('counts the Hegemony from THIS game\'s clock, and explains the contest rule', () => {
    const hegemony = buildSpaceAgeGuide({ ...everything, hegemonyTurns: 5 }).find((s) => s.id === 'hegemony')!;
    expect(hegemony.paragraphs[0]).toMatch(/all 9 Moon territories at the end of 5 of your own turns/);
    expect(hegemony.paragraphs[2]).toMatch(/just Spaceport Infrastructure and a Launch Pad/);
    expect(ids(buildSpaceAgeGuide({ ...everything, hegemony: false }))).not.toContain('hegemony');
  });

  it('mentions Moon missions only when secret missions are dealt', () => {
    expect(ids(buildSpaceAgeGuide({ ...everything, secretMissions: false }))).not.toContain('missions');
    expect(ids(buildSpaceAgeGuide({ ...everything, missions: false }))).not.toContain('missions');
  });

  it('adds the Tribute only in a game that runs it', () => {
    expect(ids(buildSpaceAgeGuide(everything))).not.toContain('tribute');
    const tribute = buildSpaceAgeGuide({ ...everything, tribute: true }).find((s) => s.id === 'tribute')!;
    expect(tribute.paragraphs[0]).toMatch(/6 or more Moon territories/);
  });

  it('gives the Lunar Pioneers their own way up', () => {
    const program = buildSpaceAgeGuide({ ...everything, isLunarPioneer: true }).find((s) => s.id === 'program')!;
    expect(program.paragraphs.join(' ')).toMatch(/skip the Space Program/);
    expect(program.paragraphs.join(' ')).toMatch(/\+2 dice/);
  });

  it('is empty without a Moon', () => {
    expect(buildSpaceAgeGuide({ ...everything, moonTiles: 0 })).toEqual([]);
  });
});

describe('reading a game into the guide', () => {
  const state = (settings: Record<string, unknown>, faction?: string) => ({
    era: 'space_age',
    players: [{ player_id: 'me', faction_id: faction }],
    settings,
  }) as unknown as GameState;

  it('reads the phases, the viewer\'s faction and the victory list', () => {
    const input = spaceAgeGuideInput(
      state({
        economy_enabled: true,
        allowed_victory_conditions: ['domination', 'secret_mission', 'lunar_hegemony'],
        space_age_moon_helium3_enabled: true,
        space_age_moon_hegemony_enabled: true,
        space_age_hegemony_turns: 6,
      }, 'lunar_pioneers'),
      'me',
      9,
    );
    expect(input).toMatchObject({
      moonTiles: 9, isSpaceAge: true, isLunarPioneer: true, economy: true, secretMissions: true,
      helium3: true, gatedTier: false, hegemony: true, hegemonyTurns: 6, blockade: false,
    });
  });

  it('only counts the Hegemony when the game can be won that way', () => {
    const input = spaceAgeGuideInput(
      state({ allowed_victory_conditions: ['domination'], space_age_moon_hegemony_enabled: true }),
      'me',
      9,
    );
    expect(input.hegemony).toBe(false);
  });
});
