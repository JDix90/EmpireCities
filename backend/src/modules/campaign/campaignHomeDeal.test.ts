import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAMPAIGN_PATH_LIST, allCampaignStages, type CampaignPath, type PathEraConfig } from './campaignPaths';
import { initializeGameState } from '../../game-engine/state/gameStateManager';
import { getFactionById } from '../../game-engine/eras';
import type { EraId, GameMap, GameSettings } from '../../types';

/**
 * A campaign stage deals each faction its homeland.
 *
 * A stage's text places its powers ("Rome eyes the known world from seven
 * hills"), and the deal used a faction's home regions only to seed its first
 * territory. Home first, every seat is dealt its home regions' territories
 * before anything else, as far as its share of the board goes, and keeps them
 * through the balancing passes. The deal is deterministic for a campaign
 * stage's settings, so one deal per stage is the whole check.
 */
const CAMPAIGN_ERAS: EraId[] = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'];
const MAPS_DIR = join(__dirname, '../../../../database/maps');
const loadMap = (mapId: string): GameMap => JSON.parse(readFileSync(join(MAPS_DIR, `${mapId}.json`), 'utf-8')) as GameMap;

function dealStage(path: CampaignPath, stageIndex: number, stage: PathEraConfig) {
  const era = CAMPAIGN_ERAS[stageIndex]!;
  const map = loadMap(stage.map_id);
  const players = [
    { player_id: 'human', player_index: 0, username: 'Human', color: '#3498db', is_ai: false, is_eliminated: false, mmr: 1000, faction_id: stage.locked_faction },
    ...stage.ai_factions.map((faction_id, i) => ({
      player_id: `ai_${i + 1}`, player_index: i + 1, username: `AI ${i + 1}`, color: '#e74c3c', is_ai: true, is_eliminated: false, mmr: 1000, faction_id,
    })),
  ];
  const settings = {
    is_campaign: true,
    factions_enabled: true,
    allowed_victory_conditions: stage.allowed_victory_conditions,
    victory_threshold: stage.victory_threshold,
    max_turns: stage.max_turns ?? 100,
  } as unknown as GameSettings;
  const state = initializeGameState(`deal-${path.path_id}-${stageIndex}`, era, map, players as never, settings, { forceStartingPlayerIndex: 0 });
  return { path, stage, era, map, state, players };
}

describe('campaign home deal', () => {
  {
    allCampaignStages().forEach(({ path, index: stageIndex, line_id, stage }) => {
      it(`${path.path_id} stage ${stageIndex + 1}${line_id ? ` (${line_id})` : ''}: every seat starts on its home regions, with an even count`, () => {
        const { era, map, state, players } = dealStage(path, stageIndex, stage);
        const dealt = Object.values(state.territories).filter((t) => t.owner_id);
        const share = Math.floor(dealt.length / players.length);
        const counts = players.map((p) => dealt.filter((t) => t.owner_id === p.player_id).length);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);

        // Which seats call each region home: a region two seats share is split between them.
        const homes = players.map((p) => new Set(getFactionById(era, p.faction_id)?.home_region_ids ?? []));
        const claimers = (regionId: string) => homes.filter((h) => h.has(regionId)).length;
        players.forEach((p, i) => {
          const own = map.territories.filter(
            (t) => homes[i]!.has(t.region_id) && claimers(t.region_id) === 1 && state.territories[t.territory_id]?.owner_id != null,
          );
          const held = own.filter((t) => state.territories[t.territory_id]!.owner_id === p.player_id).length;
          // All of a homeland no one else claims, or a full share of the board when it is bigger than that.
          expect({ seat: p.faction_id, held }).toEqual({ seat: p.faction_id, held: Math.min(own.length, share) === own.length ? own.length : held });
          expect(held).toBeGreaterThanOrEqual(Math.min(own.length, share));
        });
      });
    });
  }

  it('is the campaign\'s rule alone: the same seats in an ordinary game are dealt as before', () => {
    // The Last Defenders' opener: the Germanic tribes against Rome, Carthage and Parthia.
    const stage = CAMPAIGN_PATH_LIST[2]!.eras[0]!;
    const map = loadMap(stage.map_id);
    const players = [stage.locked_faction, ...stage.ai_factions].map((faction_id, i) => ({
      player_id: i === 0 ? 'human' : `ai_${i}`, player_index: i, username: `P${i}`, color: '#3498db', is_ai: i > 0, is_eliminated: false, mmr: 1000, faction_id,
    }));
    const homeland = map.territories
      .filter((t) => (getFactionById('ancient', stage.locked_faction)?.home_region_ids ?? []).includes(t.region_id))
      .map((t) => t.territory_id);
    const heldAtHome = (isCampaign: boolean) => {
      const settings = { is_campaign: isCampaign ? true : undefined, factions_enabled: true } as unknown as GameSettings;
      const state = initializeGameState('deal-plain', 'ancient', map, players as never, settings, { forceStartingPlayerIndex: 0 });
      return homeland.filter((id) => state.territories[id]?.owner_id === 'human').length;
    };
    const dealtHomeland = homeland.filter((id) => {
      const state = initializeGameState('deal-count', 'ancient', map, players as never, { factions_enabled: true } as unknown as GameSettings, { forceStartingPlayerIndex: 0 });
      return state.territories[id]?.owner_id != null;
    }).length;
    expect(heldAtHome(true)).toBe(dealtHomeland);
    // The ordinary deal seeds the tribes at home and floods outward from there: part of the homeland, not all of it.
    expect(heldAtHome(false)).toBeLessThan(dealtHomeland);
  });
});
