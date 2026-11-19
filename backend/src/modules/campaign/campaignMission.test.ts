import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allCampaignStages, type PathEraConfig } from './campaignPaths';
import { checkVictory, initializeGameState } from '../../game-engine/state/gameStateManager';
import { applyCampaignMission, isMissionComplete, resolveCampaignMission } from '../../game-engine/victory/missions';
import { normalizeGameSettings, sanitizeCampaignDisplay, sanitizeCampaignMission } from '../../game-engine/state/gameSettings';
import type { EraId, GameMap, GameSettings, GameState } from '../../types';

/**
 * A stage that states its objective: the player holds that mission, the bots
 * hold none, and the deal never hands it over already done.
 */
const CAMPAIGN_ERAS: EraId[] = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'];
const MAPS_DIR = join(__dirname, '../../../../database/maps');
const loadMap = (mapId: string): GameMap => JSON.parse(readFileSync(join(MAPS_DIR, `${mapId}.json`), 'utf-8')) as GameMap;

function dealStage(stage: PathEraConfig, stageIndex: number, gameId: string): { state: GameState; map: GameMap } {
  const map = loadMap(stage.map_id);
  const players = [
    { player_id: 'human', player_index: 0, username: 'Human', color: '#3498db', is_ai: false, is_eliminated: false, mmr: 1000, faction_id: stage.locked_faction },
    ...stage.ai_factions.map((faction_id, i) => ({
      player_id: `ai_${i + 1}`, player_index: i + 1, username: `AI ${i + 1}`, color: '#e74c3c', is_ai: true, is_eliminated: false, mmr: 1000, faction_id,
    })),
  ];
  // As the route writes them and the room loads them: through normalisation,
  // which drops any key it does not know.
  const settings = normalizeGameSettings({
    is_campaign: true,
    factions_enabled: true,
    allowed_victory_conditions: stage.allowed_victory_conditions,
    max_turns: stage.max_turns ?? 100,
    campaign_mission: stage.mission,
  } as unknown as GameSettings);
  const state = initializeGameState(gameId, CAMPAIGN_ERAS[stageIndex]!, map, players as never, settings, { forceStartingPlayerIndex: 0 });
  return { state, map };
}

const pinned = allCampaignStages().filter((s) => s.stage.mission);

describe('campaign stage objectives', () => {
  it('covers both sides of Blood & Empire\'s last three eras, and all of the other two paths', () => {
    const of = (pathId: string) => pinned.filter((s) => s.path.path_id === pathId).map((s) => `${s.index}:${s.line_id}`);
    expect(of('blood_empire')).toEqual(['3:allies', '3:soviets', '4:allies', '4:soviets', '5:allies', '5:soviets']);
    expect(of('revolutionary_flame')).toEqual(['0:null', '1:null', '2:null', '3:null', '4:null', '5:null']);
    expect(of('last_defenders')).toEqual(['0:null', '1:null', '2:null', '3:null', '4:null', '5:null']);
    // The Last Defenders is the path of stands: every stage is one. The one
    // other objective that counts from a round is The Revolutionary Flame's
    // finale, which has to be taken first and then held.
    const stands = pinned.filter((s) => s.stage.mission!.kind === 'control_regions' && (s.stage.mission as { from_round?: number }).from_round != null);
    expect(stands.map((s) => `${s.path.path_id}:${s.index}`)).toEqual([
      'revolutionary_flame:5',
      'last_defenders:0', 'last_defenders:1', 'last_defenders:2', 'last_defenders:3', 'last_defenders:4', 'last_defenders:5',
    ]);
  });

  for (const { path, index, line_id, stage } of pinned) {
    const name = `${path.path_id} stage ${index + 1}${line_id ? ` (${line_id})` : ''}`;

    it(`${name}: the player holds the stated objective and no bot holds one`, () => {
      const { state, map } = dealStage(stage, index, `pin-${path.path_id}-${line_id}-${index}`);
      const human = state.players.find((p) => !p.is_ai)!;
      expect(human.secret_mission).toEqual(resolveCampaignMission(state, map, stage.mission!));
      expect(human.secret_mission).not.toBeNull();
      expect(state.players.filter((p) => p.is_ai).map((p) => p.secret_mission)).toEqual(stage.ai_factions.map(() => null));
    });

    const standRound = stage.mission!.kind === 'control_regions' ? stage.mission!.from_round : undefined;

    // A stand is the one objective a deal may hand over complete: it is won
    // by still holding it when its round comes, and by nothing before then.
    it.runIf(standRound != null)(`${name}: a stand held from the deal wins in its round and not before, inside the clock`, () => {
      expect(standRound!).toBeLessThan(stage.max_turns!);
      const { state, map } = dealStage(stage, index, `stand-${path.path_id}-${index}`);
      const human = state.players.find((p) => !p.is_ai)!;
      for (const t of map.territories) {
        if (!stage.mission || stage.mission.kind !== 'control_regions') continue;
        if (stage.mission.region_ids.includes(t.region_id) && state.territories[t.territory_id]) {
          state.territories[t.territory_id]!.owner_id = human.player_id;
        }
      }
      for (const p of state.players) {
        p.territory_count = Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length;
      }
      state.turn_number = standRound! - 1;
      expect(isMissionComplete(state, map, human)).toBe(false);
      expect(checkVictory(state, map)).toBeNull();
      state.turn_number = standRound!;
      expect(isMissionComplete(state, map, human)).toBe(true);
      expect(checkVictory(state, map)).toEqual({ winnerIds: [human.player_id], condition: 'secret_mission' });
    });

    it.skipIf(standRound != null)(`${name}: no deal hands the objective over already done`, () => {
      const done: string[] = [];
      for (let g = 0; g < 12; g++) {
        const gameId = `pin-${path.path_id}-${line_id}-${index}-${g}`;
        const { state, map } = dealStage(stage, index, gameId);
        const human = state.players.find((p) => !p.is_ai)!;
        if (isMissionComplete(state, map, human)) done.push(gameId);
      }
      expect(done).toEqual([]);
    });
  }

  it('is won by completing the objective, and by a bot only on the clock', () => {
    const { stage, index } = pinned[0]!;
    const { state, map } = dealStage(stage, index, 'pin-win');
    const human = state.players.find((p) => !p.is_ai)!;
    // Past the rounds a mission is held back for, whatever the guard is set to.
    state.turn_number = 6;
    expect(checkVictory(state, map)).toBeNull();
    const mission = stage.mission!;
    if (mission.kind !== 'control_regions') throw new Error('the first pinned stage is a region objective');
    for (const t of map.territories) {
      if (!mission.region_ids.includes(t.region_id) || !state.territories[t.territory_id]) continue;
      state.territories[t.territory_id]!.owner_id = human.player_id;
    }
    for (const p of state.players) {
      p.territory_count = Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length;
    }
    expect(checkVictory(state, map)).toEqual({ winnerIds: [human.player_id], condition: 'secret_mission' });
  });

  it('leaves a stage with no stated objective dealing missions as before', () => {
    const { state, map } = dealStage({ ...pinned[0]!.stage, mission: undefined }, 3, 'pin-none');
    expect(state.players.every((p) => p.secret_mission != null)).toBe(true);
    const before = state.players.map((p) => p.secret_mission);
    applyCampaignMission(state, map);
    expect(state.players.map((p) => p.secret_mission)).toEqual(before);
  });

  it('keeps the dealt missions when the board cannot carry the objective', () => {
    const { state, map } = dealStage(
      { ...pinned[0]!.stage, mission: { kind: 'control_regions', region_ids: ['atlantis'] } }, 3, 'pin-bad',
    );
    expect(state.players.every((p) => p.secret_mission != null)).toBe(true);
    expect(resolveCampaignMission(state, map, { kind: 'capture_territories', territory_ids: ['germany', 'nowhere'] })).toBeNull();
    expect(resolveCampaignMission(state, map, { kind: 'eliminate_faction', faction_id: 'uk' })).toBeNull();
  });

  it('names a faction, and resolves it to the bot seated as it', () => {
    const { state, map } = dealStage(pinned[0]!.stage, 3, 'pin-faction');
    const germany = state.players.find((p) => p.faction_id === 'germany')!;
    expect(resolveCampaignMission(state, map, { kind: 'eliminate_faction', faction_id: 'germany' }))
      .toEqual({ kind: 'eliminate_player', target_player_id: germany.player_id });
    // Never the player's own faction: that is nobody to eliminate.
    expect(resolveCampaignMission(state, map, { kind: 'eliminate_faction', faction_id: 'usa' })).toBeNull();
  });
});

describe('a stage\'s neutral ground', () => {
  const entry = allCampaignStages().find((s) => s.stage.neutral_territories)!;
  const deal = (isCampaign: boolean) => {
    const { stage, index } = entry;
    const map = loadMap(stage.map_id);
    const players = [stage.locked_faction, ...stage.ai_factions].map((faction_id, i) => ({
      player_id: i === 0 ? 'human' : `ai_${i}`, player_index: i, username: `P${i}`, color: '#3498db', is_ai: i > 0, is_eliminated: false, mmr: 1000, faction_id,
    }));
    const settings = normalizeGameSettings({
      is_campaign: isCampaign ? true : undefined,
      factions_enabled: true,
      campaign_neutral_territories: stage.neutral_territories,
    } as unknown as GameSettings);
    return initializeGameState('neutral', CAMPAIGN_ERAS[index]!, map, players as never, settings, { forceStartingPlayerIndex: 0 });
  };

  it('sits out of the deal, garrisoned and unowned, and everything else is dealt evenly', () => {
    const state = deal(true);
    const neutral = new Set(entry.stage.neutral_territories);
    for (const id of neutral) {
      expect({ id, owner: state.territories[id]!.owner_id, units: state.territories[id]!.unit_count })
        .toEqual({ id, owner: null, units: 3 });
    }
    const dealt = Object.entries(state.territories).filter(([id]) => !neutral.has(id));
    expect(dealt.every(([, t]) => t.owner_id != null)).toBe(true);
    const counts = state.players.map((p) => dealt.filter(([, t]) => t.owner_id === p.player_id).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('is a campaign stage\'s alone: the same key on any other game leaves the deal as it was', () => {
    const state = deal(false);
    expect(Object.values(state.territories).every((t) => t.owner_id != null)).toBe(true);
  });

  it('survives the settings normalisation a room load runs, and is dropped when malformed', () => {
    expect(normalizeGameSettings({ campaign_neutral_territories: ['a', 'b'] } as unknown as GameSettings).campaign_neutral_territories).toEqual(['a', 'b']);
    for (const bad of [[], ['a', 1], 'a', null]) {
      expect(normalizeGameSettings({ campaign_neutral_territories: bad } as unknown as GameSettings).campaign_neutral_territories).toBeUndefined();
    }
  });
});

describe('sanitizeCampaignDisplay', () => {
  it('keeps the names a stage brings, as strings, and is nothing when there are none', () => {
    const display = { era_label: 'The American Revolution', factions: { germany: 'Hessian Regiments' }, objective: 'Hold the seaboard' };
    expect(sanitizeCampaignDisplay(display)).toEqual(display);
    expect(normalizeGameSettings({ campaign_display: display } as unknown as GameSettings).campaign_display).toEqual(display);
    expect(sanitizeCampaignDisplay({ era_label: 7, factions: { germany: null, uk: ' The Crown ' }, extra: true }))
      .toEqual({ factions: { uk: 'The Crown' } });
    for (const empty of [undefined, null, 'x', {}, { factions: {} }, { era_label: '  ' }]) {
      expect(sanitizeCampaignDisplay(empty)).toBeUndefined();
    }
  });

  it('is on the one stage that plays a period on another era\'s rules', () => {
    const shown = allCampaignStages().filter((s) => s.stage.display);
    expect(shown.map((s) => `${s.path.path_id}:${s.index}`)).toEqual(['revolutionary_flame:3']);
    expect(shown[0]!.stage.display!.factions).toMatchObject({ germany: 'Hessian Regiments' });
  });
});

describe('sanitizeCampaignMission', () => {
  it('keeps the three kinds and drops anything else', () => {
    expect(sanitizeCampaignMission({ kind: 'control_regions', region_ids: ['a', 'b'], extra: 1 }))
      .toEqual({ kind: 'control_regions', region_ids: ['a', 'b'] });
    expect(sanitizeCampaignMission({ kind: 'capture_territories', territory_ids: ['a', 'b'] }))
      .toEqual({ kind: 'capture_territories', territory_ids: ['a', 'b'] });
    expect(sanitizeCampaignMission({ kind: 'eliminate_faction', faction_id: 'x' }))
      .toEqual({ kind: 'eliminate_faction', faction_id: 'x' });
    // A stand keeps its round; a round that is not one makes it an ordinary objective.
    expect(sanitizeCampaignMission({ kind: 'control_regions', region_ids: ['a'], from_round: 15 }))
      .toEqual({ kind: 'control_regions', region_ids: ['a'], from_round: 15 });
    expect(sanitizeCampaignMission({ kind: 'control_regions', region_ids: ['a'], from_round: 1.5 }))
      .toEqual({ kind: 'control_regions', region_ids: ['a'] });
    for (const bad of [
      null, 'control_regions', {}, { kind: 'control_regions', region_ids: [] }, { kind: 'control_regions', region_ids: [1] },
      { kind: 'capture_territories', territory_ids: ['a'] }, { kind: 'capture_territories', territory_ids: ['a', 'a'] },
      { kind: 'eliminate_faction' }, { kind: 'eliminate_player', target_player_id: 'p' },
    ]) {
      expect(sanitizeCampaignMission(bad)).toBeUndefined();
    }
  });

  it('survives the settings normalisation a room load runs', () => {
    const mission = { kind: 'control_regions', region_ids: ['western_front'] };
    expect(normalizeGameSettings({ campaign_mission: mission } as unknown as GameSettings).campaign_mission).toEqual(mission);
    expect(normalizeGameSettings({} as GameSettings).campaign_mission).toBeUndefined();
  });
});
