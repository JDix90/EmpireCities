/**
 * Captures a serialized game state produced by the PRE-spine-refactor era
 * advancement code, for use as a frozen back-compat fixture.
 *
 * The fixture locks in the legacy field shapes (`medieval_signature_charges`,
 * flat `era_advancement_tech_echo`, no `era_spine` snapshot) so the spine
 * refactor's state-loader normalization is CI-tested against real output of
 * the old code — not a hand-written approximation.
 *
 * Run once (from backend/): pnpm tsx scripts/captureEraAdvancementFixture.ts
 * Output: src/game-engine/eraAdvancement/__fixtures__/pre-spine-refactor-state.json
 *
 * Do NOT regenerate after the spine refactor lands — the point of the fixture
 * is that the new code can no longer produce this shape.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { initializeGameState } from '../src/game-engine/state/gameStateManager';
import { canAdvanceEra, executeAdvanceEra } from '../src/game-engine/eraAdvancement/advanceEra';
import type { GameMap, GameSettings } from '../src/types';

// 3 tier-1 techs + 1 tier-2 tech: satisfies the default milestone gate.
const MILESTONE_TECHS = [
  'ancient_iron_weapons',
  'ancient_stone_walls',
  'ancient_granaries',
  'ancient_siege_engines',
];

async function main(): Promise<void> {
  const mapRaw = await readFile(join(__dirname, '../../database/maps/era_ancient.json'), 'utf-8');
  const map = JSON.parse(mapRaw) as GameMap;

  const settings: GameSettings = {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: true,
    era_advancement_enabled: true,
  } as GameSettings;

  const state = initializeGameState(
    'legacy-ea-fixture',
    'ancient',
    map,
    [
      {
        player_id: 'p1',
        player_index: 0,
        username: 'Advancer',
        color: '#e74c3c',
        is_ai: false,
        is_eliminated: false,
        mmr: 1000,
      },
      {
        player_id: 'p2',
        player_index: 1,
        username: 'Trailer',
        color: '#3498db',
        is_ai: true,
        is_eliminated: false,
        mmr: 1000,
      },
    ],
    settings,
  );

  // Simulate a few turns of progress so the captured state is mid-game, not
  // freshly initialized: techs researched, a building up, income recorded.
  state.turn_number = 6;
  state.phase = 'draft';
  const p1 = state.players.find((p) => p.player_id === 'p1')!;
  const p2 = state.players.find((p) => p.player_id === 'p2')!;

  p1.unlocked_techs = [...MILESTONE_TECHS];
  p1.special_resource = 100;
  p1.last_turn_production_income = 10;

  p2.unlocked_techs = ['ancient_iron_weapons', 'ancient_granaries'];
  p2.special_resource = 7;
  p2.last_turn_production_income = 6;

  const p1Territories = Object.values(state.territories).filter((t) => t.owner_id === 'p1');
  p1Territories[0].buildings = ['production_1'];
  for (const t of Object.values(state.territories)) {
    if (!t.owner_id) continue;
    t.stability = 80;
    t.population = 5;
  }

  const gate = canAdvanceEra(state, 'p1');
  if (!gate.canAdvance) {
    throw new Error(`Fixture setup is not advance-ready: ${gate.error}`);
  }

  const result = executeAdvanceEra(state, 'p1');
  if (!result.success) {
    throw new Error(`executeAdvanceEra failed: ${result.error}`);
  }

  // Sanity-check the legacy shapes we exist to preserve.
  if (p1.medieval_signature_charges !== 1) {
    throw new Error('Expected legacy medieval_signature_charges === 1');
  }
  if (!p1.era_advancement_tech_echo || typeof Object.values(p1.era_advancement_tech_echo)[0] !== 'number') {
    throw new Error('Expected legacy flat tech echo (stat -> number)');
  }

  const outDir = join(__dirname, '../src/game-engine/eraAdvancement/__fixtures__');
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'pre-spine-refactor-state.json');
  await writeFile(outPath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${outPath}`);
  console.log(`p1: era_index=${p1.current_era_index}, charges=${p1.medieval_signature_charges}, echo=${JSON.stringify(p1.era_advancement_tech_echo)}`);
  console.log(`p2: era_index=${p2.current_era_index ?? 0}, gold=${p2.special_resource}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
