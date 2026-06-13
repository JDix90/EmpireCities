/**
 * Manual smoke driver for era advancement (socket-automated).
 * Run: pnpm -C backend exec tsx scripts/eraAdvancementPlaytest.ts
 *
 * Prerequisites:
 * - Backend running at PLAYTEST_BASE_URL (default http://localhost:3001)
 * - `era_advancement_lobby_enabled` true via Admin feature flags, OR admin account
 * - Stage 2: ai_count >= 1 exercises AI advance/stay heuristic
 */
import { io, type Socket } from 'socket.io-client';
import type { GameState, PlayerState } from '../src/types';
import { computeAdvanceCost } from '../src/game-engine/eraAdvancement/advanceEra';
import { resolvePlayerEraId } from '../src/game-engine/eraAdvancement/constants';
import { getEraTechTree } from '../src/game-engine/eras';

const BASE = process.env.PLAYTEST_BASE_URL ?? 'http://localhost:3001';
const USER = process.env.PLAYTEST_USER ?? 'manus_test';
const PASS = process.env.PLAYTEST_PASS ?? 'Manus123!';
/** 'poc' (Ancient→Medieval) by default; set 'classic' to exercise the full climb. */
const SPINE = process.env.PLAYTEST_SPINE ?? 'poc';

/** Charges of the medieval arrival signature, via the generalized store. */
function levyCharges(p: PlayerState): number {
  return p.era_signature_charges?.levy_of_knights ?? 0;
}

async function login(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { accessToken: string; user: { user_id: string } };
  return { token: body.accessToken, userId: body.user.user_id };
}

async function createGame(token: string, eraAdvancement: boolean): Promise<string> {
  const res = await fetch(`${BASE}/api/games`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      era_id: 'ancient',
      map_id: 'era_ancient',
      max_players: 2,
      ai_count: 1,
      ai_difficulty: 'easy',
      settings: {
        era_advancement_enabled: eraAdvancement,
        era_advancement_spine_id: SPINE,
        economy_enabled: true,
        tech_trees_enabled: true,
        stability_enabled: true,
        factions_enabled: false,
        events_enabled: false,
        naval_enabled: false,
        diplomacy_enabled: false,
        fog_of_war: false,
        turn_timer_seconds: 0,
        territory_selection: false,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 && body.includes('not enabled')) {
      throw new Error(
        'create game failed: Era Advancement feature flag is off. Enable era_advancement_lobby_enabled in Admin → Feature Flags, or use an admin account.',
      );
    }
    throw new Error(`create game failed: ${res.status} ${body}`);
  }
  const body = (await res.json()) as { game_id: string };
  return body.game_id;
}

function connect(token: string): Socket {
  return io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
}

function waitConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket connect timeout')), 15_000);
    socket.once('connect', () => { clearTimeout(t); resolve(); });
    socket.once('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

function onceState(socket: Socket, timeoutMs = 45_000): Promise<GameState> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('state timeout')), timeoutMs);
    socket.once('game:state', (s: GameState) => { clearTimeout(t); resolve(s); });
    socket.once('error', (e: { message?: string }) => { clearTimeout(t); reject(new Error(e?.message ?? 'socket error')); });
  });
}

function onState(
  socket: Socket,
  predicate: (s: GameState) => boolean,
  timeoutMs = 90_000,
  initial?: GameState,
): Promise<GameState> {
  if (initial && predicate(initial)) return Promise.resolve(initial);
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const handler = (s: GameState) => {
      if (predicate(s)) {
        socket.off('game:state', handler);
        resolve(s);
      } else if (Date.now() > deadline) {
        socket.off('game:state', handler);
        reject(new Error('predicate timeout'));
      }
    };
    socket.on('game:state', handler);
  });
}

function isHumanTurn(state: GameState, userId: string): boolean {
  const cur = state.players[state.current_player_index];
  return !cur.is_ai && cur.player_id === userId;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function me(state: GameState, userId: string) {
  return state.players.find((p) => p.player_id === userId)!;
}

function ownedTerritories(state: GameState, userId: string) {
  return Object.entries(state.territories)
    .filter(([, t]) => t.owner_id === userId)
    .map(([id, t]) => ({ id, units: t.unit_count, buildings: t.buildings ?? [] }));
}

async function joinGameApi(token: string, gameId: string) {
  const res = await fetch(`${BASE}/api/games/${gameId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`join api failed: ${res.status} ${await res.text()}`);
  }
}

async function joinExisting(socket: Socket, gameId: string, token: string): Promise<GameState> {
  await joinGameApi(token, gameId);
  socket.on('error', (e: { message?: string }) => console.error('  socket error:', e?.message));
  const state = await new Promise<GameState>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('join existing timeout')), 30_000);
    socket.once('game:state', (s: GameState) => { clearTimeout(t); resolve(s); });
    socket.once('error', (e: { message?: string }) => { clearTimeout(t); reject(new Error(e?.message ?? 'join error')); });
    socket.emit('game:join', { gameId });
  });
  return state;
}

async function joinAndStart(socket: Socket, gameId: string, token: string): Promise<GameState> {
  await joinGameApi(token, gameId);
  const joinPromise = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('game:join timeout')), 30_000);
    socket.once('game:joined', () => { clearTimeout(t); resolve(); });
    socket.once('error', (e: { message?: string }) => { clearTimeout(t); reject(new Error(e?.message ?? 'join error')); });
  });
  socket.emit('game:join', { gameId });
  await joinPromise;

  socket.on('error', (e: { message?: string }) => console.error('  socket error:', e?.message));
  const startPromise = onState(socket, (s) => s.turn_number >= 1 && s.phase !== 'lobby', 60_000);
  socket.emit('game:start', { gameId });
  const state = await startPromise;
  console.log(`  started turn ${state.turn_number} phase=${state.phase}`);
  return state;
}

async function endPhase(socket: Socket, gameId: string) {
  socket.emit('game:advance_phase', { gameId });
  await sleep(400);
}

async function draftAll(socket: Socket, gameId: string, state: GameState, userId: string) {
  const owned = ownedTerritories(state, userId);
  const target = owned.sort((a, b) => b.units - a.units)[0]?.id;
  const units = state.draft_units_remaining ?? 0;
  if (target && units > 0) {
    socket.emit('game:draft', { gameId, territoryId: target, units });
    await sleep(500);
  }
}

async function researchTech(socket: Socket, gameId: string, techId: string) {
  socket.emit('game:research_tech', { gameId, techId });
  await sleep(600);
}

async function researchWhenAffordable(socket: Socket, gameId: string, state: GameState, userId: string) {
  // Era-agnostic: research affordable nodes from the player's CURRENT era tree,
  // lowest tier first so prerequisites unlock before their children. Works for
  // any spine step, not just Ancient.
  let player = me(state, userId);
  const tree = [...getEraTechTree(resolvePlayerEraId(state, player))].sort((a, b) => a.tier - b.tier);
  for (const node of tree) {
    const unlocked = new Set(player.unlocked_techs ?? []);
    if (unlocked.has(node.tech_id)) continue;
    if (node.prerequisite && !unlocked.has(node.prerequisite)) continue;
    if ((player.tech_points ?? 0) < node.cost) continue;
    await researchTech(socket, gameId, node.tech_id);
    const fresh = await onState(socket, (s) => (me(s, userId).unlocked_techs ?? []).includes(node.tech_id), 10_000)
      .catch(() => state);
    player = me(fresh, userId);
  }
}

async function tryBuildProduction(socket: Socket, gameId: string, state: GameState, userId: string) {
  const player = me(state, userId);
  const owned = ownedTerritories(state, userId);
  if (owned.some((t) => t.buildings.some((b) => !b.startsWith('wonder_')))) return;
  // Build whatever non-wonder building an unlocked current-era tech grants.
  const unlocked = new Set(player.unlocked_techs ?? []);
  const node = getEraTechTree(resolvePlayerEraId(state, player)).find(
    (n) => n.unlocks_building && !n.unlocks_building.startsWith('wonder_') && unlocked.has(n.tech_id),
  );
  const target = owned[0]?.id;
  if (!node?.unlocks_building || !target) return;
  socket.emit('game:build', { gameId, territoryId: target, buildingType: node.unlocks_building });
  await sleep(500);
}

async function playHumanTurn(socket: Socket, gameId: string, state: GameState, userId: string, opts: { research?: boolean }) {
  if (state.phase === 'draft') {
    if (opts.research) {
      await researchWhenAffordable(socket, gameId, state, userId);
      await tryBuildProduction(socket, gameId, state, userId);
    }
    await draftAll(socket, gameId, state, userId);
    await endPhase(socket, gameId);
    state = await onState(socket, (s) => s.phase === 'attack', 45_000, state);
  }
  if (state.phase === 'attack') {
    await endPhase(socket, gameId);
    state = await onState(socket, (s) => s.phase === 'fortify', 45_000, state);
  }
  if (state.phase === 'fortify') {
    await endPhase(socket, gameId);
  }
  return onState(socket, (s) => isHumanTurn(s, userId), 120_000);
}

function logPlayer(state: GameState, userId: string) {
  const p = me(state, userId);
  console.log(
    `  turn ${state.turn_number} phase=${state.phase} gold=${p.special_resource ?? 0} tp=${p.tech_points ?? 0} techs=${(p.unlocked_techs ?? []).length} income=${p.last_turn_production_income ?? 0} era=${p.current_era_index ?? 0} vuln=${p.era_transition_turns_remaining ?? 0} sig=${levyCharges(p)}`,
  );
}

async function runAdvancementGame(token: string, userId: string, existingGameId?: string) {
  const gameId = existingGameId ?? await createGame(token, true);
  console.log(`\n[advance game] ${gameId}`);
  console.log(`  browser: http://localhost:5173/game/${gameId}`);

  const socket = connect(token);
  await waitConnect(socket);
  let state = existingGameId
    ? await joinExisting(socket, gameId, token)
    : await joinAndStart(socket, gameId, token);
  console.log(`  joined turn ${state.turn_number} phase=${state.phase}`);

  let advanced = false;
  let preAdvanceUnits = 0;

  for (let round = 0; round < 12 && !advanced; round++) {
    state = await onState(socket, (s) => isHumanTurn(s, userId), 180_000, state);

    logPlayer(state, userId);
    state = await playHumanTurn(socket, gameId, state, userId, { research: true });

    state = await onState(socket, (s) => isHumanTurn(s, userId), 180_000, state);
    logPlayer(state, userId);

    const player = me(state, userId);
    const techOk = (player.unlocked_techs ?? []).length >= 3;
    const gold = player.special_resource ?? 0;
    const income = player.last_turn_production_income ?? 0;
    const cost = income > 0 ? computeAdvanceCost(state, player) : 9999;

    if (state.phase === 'draft' || state.phase === 'attack') {
      if (techOk && gold >= cost && income > 0 && (player.current_era_index ?? 0) === 0) {
        preAdvanceUnits = ownedTerritories(state, userId).reduce((s, t) => s + t.units, 0);
        socket.emit('game:advance_era', { gameId });
        state = await onState(socket, (s) => (me(s, userId).current_era_index ?? 0) >= 1, 30_000);
        advanced = true;
        console.log('  ✓ advanced to medieval');
        logPlayer(state, userId);
        break;
      }
    }
  }

  if (!advanced) throw new Error('failed to advance within 12 rounds');

  const postAdvance = me(state, userId);
  const postUnits = ownedTerritories(state, userId).reduce((s, t) => s + t.units, 0);
  console.log(`  units before/after advance: ${preAdvanceUnits} → ${postUnits}`);
  console.log(`  vulnerability turns: ${postAdvance.era_transition_turns_remaining ?? 0}`);
  console.log(`  signature charges: ${levyCharges(postAdvance)}`);

  // Item 4: let AI take turn while vulnerable
  state = await onState(socket, (s) => s.players[s.current_player_index].is_ai, 120_000);
  console.log(`  AI turn while human vuln=${me(state, userId).era_transition_turns_remaining ?? 0}`);
  await sleep(8000);
  const afterAi = await onState(socket, (s) => s.players[s.current_player_index].player_id === userId, 180_000);
  const ownedAfter = ownedTerritories(afterAi, userId);
  console.log(`  territories after AI window: ${ownedAfter.length} (still alive: ${!me(afterAi, userId).is_eliminated})`);

  // Item 5: attempt attack with signature charge if still present
  let state5 = afterAi;
  if (levyCharges(me(state5, userId)) > 0 && state5.phase === 'draft') {
    state5 = await playHumanTurn(socket, gameId, state5, userId, { research: false });
    state5 = await onState(socket, (s) => s.phase === 'attack' && s.players[s.current_player_index].player_id === userId, 60_000);
    const from = ownedTerritories(state5, userId).sort((a, b) => b.units - a.units)[0];
    const enemy = Object.entries(state5.territories).find(([, t]) => t.owner_id && t.owner_id !== userId);
    if (from && enemy) {
      const [toId] = enemy;
      socket.emit('game:attack', { gameId, fromTerritoryId: from.id, toTerritoryId: toId, units: Math.min(3, from.units - 1) });
      await sleep(2000);
      state5 = await onState(socket, (s) => s.players[s.current_player_index].player_id === userId, 60_000);
      console.log(`  signature charges after first attack: ${levyCharges(me(state5, userId))}`);
    }
  }

  // Multi-era climb: drive the rest of the spine using the server's own
  // readiness flag (era_advancement_preview.can_advance) attached to state.
  if (SPINE !== 'poc') {
    await climbRemainingSpine(socket, gameId, state5, userId);
  }

  socket.disconnect();
  return gameId;
}

/**
 * Best-effort climb through the remaining spine steps. Plays turns (research +
 * build + draft) and advances whenever the server reports the player is ready,
 * stopping at the spine's max era index. Requires the economy to actually reach
 * each era's gates, so it logs the final era it managed to reach.
 */
async function climbRemainingSpine(socket: Socket, gameId: string, state: GameState, userId: string) {
  for (let round = 0; round < 40; round++) {
    state = await onState(socket, (s) => isHumanTurn(s, userId), 180_000, state);
    const idx = me(state, userId).current_era_index ?? 0;
    const preview = state.era_advancement_preview;
    if (preview && idx >= preview.max_era_index) {
      console.log(`  ✓ reached final era index ${idx} (${resolvePlayerEraId(state, me(state, userId))})`);
      return;
    }
    if ((state.phase === 'draft' || state.phase === 'attack') && preview?.can_advance) {
      socket.emit('game:advance_era', { gameId });
      state = await onState(socket, (s) => (me(s, userId).current_era_index ?? 0) > idx, 30_000).catch(() => state);
      const now = me(state, userId);
      console.log(`  ✓ advanced to index ${now.current_era_index ?? 0} (${resolvePlayerEraId(state, now)})`);
      continue;
    }
    state = await playHumanTurn(socket, gameId, state, userId, { research: true });
  }
  console.log(`  climb hit round budget; final era index ${me(state, userId).current_era_index ?? 0}`);
}

async function runStayerGame(token: string, userId: string) {
  const gameId = await createGame(token, true);
  console.log(`\n[stayer game] ${gameId}`);

  const socket = connect(token);
  await waitConnect(socket);
  let state = await joinAndStart(socket, gameId, token);

  for (let round = 0; round < 8; round++) {
    state = await onState(socket, (s) => isHumanTurn(s, userId), 180_000, state);
    if ((me(state, userId).current_era_index ?? 0) > 0) throw new Error('stayer accidentally advanced');
    state = await playHumanTurn(socket, gameId, state, userId, { research: false });
  }

  const p = me(state, userId);
  console.log(`  ✓ stayer still ancient after 8 human turns (era=${p.current_era_index ?? 0}, territories=${p.territory_count})`);
  socket.disconnect();
}

async function main() {
  const { token, userId } = await login();
  console.log(`logged in as ${USER} (${userId})`);
  const existing = process.env.PLAYTEST_GAME_ID;
  const skipStayer = process.env.PLAYTEST_SKIP_STAYER === '1';
  await runAdvancementGame(token, userId, existing);
  if (!skipStayer) await runStayerGame(token, userId);
  console.log('\nplaytest complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
