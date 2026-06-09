/**
 * Manual smoke driver for era advancement items 3–6 (socket-automated).
 * Run: pnpm -C backend exec tsx scripts/eraAdvancementPlaytest.ts
 */
import { io, type Socket } from 'socket.io-client';
import type { GameState } from '../src/types';

const BASE = process.env.PLAYTEST_BASE_URL ?? 'http://localhost:3001';
const USER = process.env.PLAYTEST_USER ?? 'manus_test';
const PASS = process.env.PLAYTEST_PASS ?? 'Manus123!';

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
  if (!res.ok) throw new Error(`create game failed: ${res.status} ${await res.text()}`);
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
  const order = ['ancient_granaries', 'ancient_iron_weapons', 'ancient_stone_walls', 'ancient_roads'] as const;
  const player = me(state, userId);
  for (const techId of order) {
    if ((player.unlocked_techs ?? []).includes(techId)) continue;
    const cost = techId === 'ancient_granaries' ? 3 : 4;
    if ((player.tech_points ?? 0) >= cost) {
      await researchTech(socket, gameId, techId);
      const fresh = await onState(socket, (s) => (me(s, userId).unlocked_techs ?? []).includes(techId), 10_000);
      Object.assign(player, me(fresh, userId));
    }
  }
}

async function tryBuildProduction(socket: Socket, gameId: string, state: GameState, userId: string) {
  const player = me(state, userId);
  if (!(player.unlocked_techs ?? []).includes('ancient_granaries')) return;
  const owned = ownedTerritories(state, userId);
  const withProd = owned.find((t) => t.buildings.some((b) => b.startsWith('production_')));
  if (withProd) return;
  const target = owned[0]?.id;
  if (!target) return;
  socket.emit('game:build', { gameId, territoryId: target, buildingType: 'production_1' });
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
    `  turn ${state.turn_number} phase=${state.phase} gold=${p.special_resource ?? 0} tp=${p.tech_points ?? 0} techs=${(p.unlocked_techs ?? []).length} income=${p.last_turn_production_income ?? 0} era=${p.current_era_index ?? 0} vuln=${p.era_transition_turns_remaining ?? 0} sig=${p.medieval_signature_charges ?? 0}`,
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
    const mult = state.settings.era_advancement_cost_mult ?? 2;
    const escalation = state.settings.era_advancement_cost_escalation ?? 1.5;
    const fromIndex = player.current_era_index ?? 0;
    const cost = income > 0 ? Math.ceil(income * mult * escalation ** fromIndex) : 9999;

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
  console.log(`  signature charges: ${postAdvance.medieval_signature_charges ?? 0}`);

  // Item 4: let AI take turn while vulnerable
  state = await onState(socket, (s) => s.players[s.current_player_index].is_ai, 120_000);
  console.log(`  AI turn while human vuln=${me(state, userId).era_transition_turns_remaining ?? 0}`);
  await sleep(8000);
  const afterAi = await onState(socket, (s) => s.players[s.current_player_index].player_id === userId, 180_000);
  const ownedAfter = ownedTerritories(afterAi, userId);
  console.log(`  territories after AI window: ${ownedAfter.length} (still alive: ${!me(afterAi, userId).is_eliminated})`);

  // Item 5: attempt attack with signature charge if still present
  let state5 = afterAi;
  if ((me(state5, userId).medieval_signature_charges ?? 0) > 0 && state5.phase === 'draft') {
    state5 = await playHumanTurn(socket, gameId, state5, userId, { research: false });
    state5 = await onState(socket, (s) => s.phase === 'attack' && s.players[s.current_player_index].player_id === userId, 60_000);
    const from = ownedTerritories(state5, userId).sort((a, b) => b.units - a.units)[0];
    const enemy = Object.entries(state5.territories).find(([, t]) => t.owner_id && t.owner_id !== userId);
    if (from && enemy) {
      const [toId] = enemy;
      socket.emit('game:attack', { gameId, fromTerritoryId: from.id, toTerritoryId: toId, units: Math.min(3, from.units - 1) });
      await sleep(2000);
      state5 = await onState(socket, (s) => s.players[s.current_player_index].player_id === userId, 60_000);
      console.log(`  signature charges after first attack: ${me(state5, userId).medieval_signature_charges ?? 0}`);
    }
  }

  socket.disconnect();
  return gameId;
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
