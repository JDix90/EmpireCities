import React, { useEffect, useState } from 'react';
import { X, Shield, Zap, Star, Building2 } from 'lucide-react';
import clsx from 'clsx';
import { useGameStore } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { ERA_WONDERS } from '../../constants/eraWonders';
import type { TechNode } from './TechTreeModal';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { resolvePlayerTechEraId } from '../../utils/eraAdvancement';
import { buildingDisplayName, buildingEffect, inferWorldId } from '@borderfall/shared';
import { getSpaceProgramProgress, type FrontendMapData } from '../../utils/orbitAccess';
import {
  describeWorldModifiers,
  describeWorldRules,
  gatewayTerritoryIds,
  laneAttackDiceCap,
  laneStateFor,
  prettyRegionId,
  vaultViews,
  worldDisplayName,
} from '../../utils/galaxyLanes';

// ── Static data ───────────────────────────────────────────────────────────────

const MODIFIER_INFO = [
  { key: 'legion_reroll',       label: 'Legion Tactics',      description: 'Attacker may re-roll one die when attacking with 3 dice.',               icon: '⚔️' },
  { key: 'castle_fortification',label: 'Castle Fortification', description: 'Defenders with 4+ units roll an extra die.',                            icon: '🏰' },
  { key: 'sea_lanes',           label: 'Sea Lanes',            description: 'Sea-route attacks are limited to 2 attack dice.',                       icon: '⚓' },
  { key: 'wartime_logistics',   label: 'Wartime Logistics',    description: 'May fortify twice per turn.',                                           icon: '🚂' },
  { key: 'influence_spread',    label: 'Influence Spread',     description: 'Seize via Influence: spend 3 units from your bordering territories to capture a weak target (3 units or fewer) without combat. 3-turn cooldown.', icon: '📡' },
  { key: 'precision_strike',    label: 'Precision Strike',     description: 'Attack with 3 dice when committing 4+ units.',                          icon: '🎯' },
  { key: 'rifle_doctrine',      label: 'Rifle Doctrine',       description: 'Re-roll tied attacker dice to break deadlocks.',                        icon: '🔫' },
  { key: 'carbonari_network',   label: 'Carbonari Network',    description: 'Influence operations can reach beyond adjacent territories.',            icon: '🕵️' },
];

const MOD_TYPE_LABELS: Record<string, string> = {
  attack_modifier:  'Attack Bonus',
  defense_modifier: 'Defense Bonus',
  production_bonus: 'Production Bonus',
};

/**
 * Colour per building category. The NAME and EFFECT come from
 * `BUILDING_DISPLAY` in @borderfall/shared — this modal used to keep its own
 * table, which had drifted from the build panel's ("War Factory" vs "Arsenal",
 * "Library" vs "Laboratory", "Fortification" vs "Fortress") and carried the
 * same wrong claim that production buildings reinforce units.
 */
const BUILDING_COLOR: Record<string, string> = {
  defense_1: 'text-blue-300',
  defense_2: 'text-blue-300',
  defense_3: 'text-blue-300',
  production_1: 'text-amber-300',
  production_2: 'text-amber-300',
  production_3: 'text-amber-300',
  production_4: 'text-amber-300',
  tech_gen_1: 'text-purple-300',
  tech_gen_2: 'text-purple-300',
  port: 'text-cyan-300',
  naval_base: 'text-cyan-300',
  coastal_battery: 'text-cyan-300',
};

const BUILDING_META: Record<string, { label: string; effect: string; color: string }> =
  Object.fromEntries(
    Object.entries(BUILDING_COLOR).map(([id, color]) => [
      id,
      { label: buildingDisplayName(id, false), effect: buildingEffect(id), color },
    ]),
  );

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-base leading-none">{icon}</span>
      <h3 className="text-xs font-semibold text-bf-gold uppercase tracking-wider">{title}</h3>
    </div>
  );
}

interface BonusRow {
  icon: string;
  label: string;
  value: string;
  description?: string;
  valueColor?: string;
}

function BonusTable({ rows }: { rows: BonusRow[] }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div
          key={i}
          className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-bf-dark border border-bf-border/60"
        >
          <span className="text-sm shrink-0 mt-0.5">{row.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-bf-text leading-snug">{row.label}</span>
              {row.value && (
                <span className={clsx('text-xs font-mono font-semibold shrink-0', row.valueColor ?? 'text-bf-gold')}>
                  {row.value}
                </span>
              )}
            </div>
            {row.description && (
              <p className="text-xs text-bf-muted mt-0.5 leading-relaxed whitespace-pre-line">{row.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface FactionInfo {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  flavor_quote?: string;
  passive_attack_bonus?: number;
  passive_defense_bonus?: number;
  reinforce_bonus?: number;
  tech_cost_discount?: number;
  stability_recovery_bonus?: number;
  /** Galactic Age: extra defence die against any attack across a hyperspace lane. */
  lane_defense_bonus?: number;
  ability_description?: string;
}

export interface BonusesModalProps {
  /** Tech tree nodes already loaded (may be empty — modal will show note to open Tech Tree). */
  techTree: TechNode[];
  /** Full map document — drives the Space Age Moon-ladder section. */
  mapData?: FrontendMapData | null;
  onClose: () => void;
}

export default function BonusesModal({ techTree, mapData, onClose }: BonusesModalProps) {
  useEscapeClose(onClose);
  const { gameState } = useGameStore();
  const { user } = useAuthStore();
  const [factionData, setFactionData] = useState<FactionInfo | null>(null);
  const [factionLoading, setFactionLoading] = useState(false);

  const myPlayer = gameState?.players.find((p) => p.player_id === user?.user_id);

  // Fetch faction info on open when factions are enabled. Resolve the player's
  // CURRENT era so a faction that has evolved along its lineage (era advancement)
  // is fetched from the right roster rather than the static game era.
  const factionEraId = gameState && myPlayer ? resolvePlayerTechEraId(gameState, myPlayer) : undefined;
  useEffect(() => {
    if (!gameState || !myPlayer?.faction_id || !gameState.settings.factions_enabled || !factionEraId) return;
    setFactionLoading(true);
    api
      .get(`/eras/${factionEraId}/factions`)
      .then((res) => {
        const factions: FactionInfo[] = res.data.factions ?? [];
        const mine = factions.find((f) => f.faction_id === myPlayer.faction_id);
        setFactionData(mine ?? null);
      })
      .catch(() => {})
      .finally(() => setFactionLoading(false));
  }, [factionEraId, myPlayer?.faction_id, gameState?.settings.factions_enabled]);

  if (!gameState || !myPlayer) return null;

  // ── Space Age Moon ladder ───────────────────────────────────────────────────
  // The Space Age has no era-modifier flag (its signature is the orbit gate),
  // so without this the "what rules am I playing under" screen said nothing at
  // all about the era's defining mechanic.
  const spaceProgram = getSpaceProgramProgress(
    mapData,
    gameState,
    myPlayer?.player_id,
    gameState?.era ?? '',
  );

  // ── Galactic Age worlds ─────────────────────────────────────────────────────
  // One row per world the player holds a system on: what the world pays them,
  // how many of its gateways they hold and how its lanes stand for them. Plus a
  // row for the lane dice cap, the era's defining combat rule.
  const galaxyWorldRows: BonusRow[] = (() => {
    if (mapData?.map_kind !== 'galaxy' || !myPlayer) return [];
    const me = myPlayer.player_id;
    const worldIds = mapData.worlds?.map((w) => w.world_id)
      ?? [...new Set(mapData.territories.map((t) => inferWorldId(t)))];
    const gateways = gatewayTerritoryIds(mapData);
    const rows: BonusRow[] = [];
    for (const worldId of worldIds) {
      const systems = mapData.territories.filter((t) => inferWorldId(t) === worldId);
      const held = systems.filter((t) => gameState.territories[t.territory_id]?.owner_id === me).length;
      if (held === 0) continue;
      const worldGateways = systems.filter((t) => gateways.has(t.territory_id));
      const gatewaysHeld = worldGateways.filter((t) => gameState.territories[t.territory_id]?.owner_id === me).length;
      let corridors = 0;
      let open = 0;
      for (const c of mapData.connections) {
        if (c.type !== 'orbit') continue;
        const near = systems.some((t) => t.territory_id === c.from || t.territory_id === c.to);
        if (!near) continue;
        const state = laneStateFor(gameState, c.from, c.to, me);
        if (state === 'corridor') corridors += 1;
        else if (state === 'open') open += 1;
      }
      const lines = [
        ...describeWorldRules(gameState.settings.world_rules?.[worldId]),
        ...describeWorldModifiers(gameState.settings.world_modifiers?.[worldId]),
      ];
      if (worldGateways.length > 0) {
        lines.push(`Gateways: you hold ${gatewaysHeld} of ${worldGateways.length} · lanes: ${corridors} corridor, ${open} open`);
      }
      rows.push({
        icon: '🪐',
        label: worldDisplayName(mapData, worldId),
        value: `${held} / ${systems.length} systems`,
        description: lines.join('\n'),
        valueColor: held === systems.length ? 'text-emerald-400' : 'text-bf-gold',
      });
    }
    for (const v of vaultViews(gameState, mapData.territories, me)) {
      rows.push({
        icon: '◈',
        label: `The Vault — ${prettyRegionId(v.region_id)}`,
        value: v.holder_id
          ? (v.holder_id === me ? 'Held by you' : `Held by ${gameState.players.find((p) => p.player_id === v.holder_id)?.username ?? 'a rival'}`)
          : `Unheld · ${v.viewer_held} / ${v.tiles}`,
        description: `Hold every tile for +${v.tech_income} tech per turn${v.emergency_seal ? ' and one Emergency Seal per turn on any hyperspace lane' : ''}.`,
        valueColor: v.holder_id === me ? 'text-emerald-400' : v.holder_id ? 'text-red-300' : 'text-bf-muted',
      });
    }
    const cap = laneAttackDiceCap(gameState, me);
    if (cap != null) {
      rows.push({
        icon: '🛰',
        label: 'Hyperspace lane crossings',
        value: `${cap} attack dice`,
        description: cap === 2
          ? 'Attacks across a lane roll 2 dice; Lane Charts gives the third back. The Hyperlane Anchor lifts the cap for its owner.'
          : 'Lane Charts researched: attacks across a lane roll 3 dice. The Hyperlane Anchor lifts the cap for its owner.',
        valueColor: 'text-sky-300',
      });
    }
    return rows;
  })();

  // ── Active era modifiers ────────────────────────────────────────────────────
  // Every era's wonder by building id — a wonder outlives the era that minted it.
  const WONDER_BY_ID: Record<string, (typeof ERA_WONDERS)[keyof typeof ERA_WONDERS]> =
    Object.fromEntries(Object.values(ERA_WONDERS).map((w) => [w.wonder_id, w]));

  const activeEraRules = MODIFIER_INFO.filter(
    (m) => gameState.era_modifiers && (gameState.era_modifiers as Record<string, unknown>)[m.key],
  );

  // ── Temporary event buffs ───────────────────────────────────────────────────
  const tempMods = myPlayer.temporary_modifiers ?? [];

  // ── Wonders the player owns ─────────────────────────────────────────────────
  // Read from the BOARD, not from an era: a wonder keeps paying out after its
  // owner advances, and under the per-era rule a player can hold more than one.
  // Resolving by the viewer's current era hid a wonder they still owned from an
  // era they had left.
  const ownedWonders = Object.values(gameState.territories)
    .filter((t) => t.owner_id === user?.user_id)
    .flatMap((t) => (t.buildings ?? []).filter((b) => b.startsWith('wonder_')))
    .map((id) => WONDER_BY_ID[id])
    .filter(Boolean);
  const ownsWonder = ownedWonders.length > 0;

  // ── Researched techs ────────────────────────────────────────────────────────
  const unlockedTechs = techTree.filter((n) => myPlayer.unlocked_techs?.includes(n.tech_id));
  const hasUnlocked = (myPlayer.unlocked_techs?.length ?? 0) > 0;

  // ── Buildings across owned territories ─────────────────────────────────────
  const buildingCounts: Record<string, number> = {};
  Object.values(gameState.territories).forEach((t) => {
    if (t.owner_id !== user?.user_id) return;
    (t.buildings ?? []).forEach((b) => {
      if (b.startsWith('wonder_')) return; // shown in wonder section
      buildingCounts[b] = (buildingCounts[b] ?? 0) + 1;
    });
  });

  const hasSomething =
    activeEraRules.length > 0 ||
    galaxyWorldRows.length > 0 ||
    myPlayer.faction_id ||
    tempMods.length > 0 ||
    ownsWonder ||
    hasUnlocked ||
    Object.keys(buildingCounts).length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-auto px-4 pt-safe-6 pb-safe-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bf-surface border border-bf-border rounded-xl shadow-2xl w-full max-w-lg flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-bf-border shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-bf-gold" />
            <h2 className="text-base font-semibold text-bf-gold">Bonuses &amp; Active Rules</h2>
          </div>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-bf-muted hover:text-white transition-colors -mr-2"
            aria-label="Close bonuses panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 space-y-6">
          {!hasSomething && (
            <p className="text-bf-muted text-sm text-center py-10">
              No active bonuses yet. Research techs, build structures, or wait for an event card.
            </p>
          )}

          {/* ── Space Program (Space Age orbit gate) ───────────────── */}
          {spaceProgram.applicable && (
            <section>
              <SectionHeader icon="🚀" title="Space Program (Moon access)" />
              <BonusTable
                rows={spaceProgram.isLunarPioneer
                  ? [{
                      icon: '🌕',
                      label: 'Lunar Pioneers',
                      value: 'Unlocked',
                      description: 'You begin with Moon access; no Space Program needed.',
                      valueColor: 'text-emerald-400',
                    }]
                  : spaceProgram.rungs.map((rung) => ({
                      icon: rung.done ? '✅' : '⬜',
                      label: rung.label,
                      value: rung.done ? 'Done' : 'To do',
                      description: rung.detail
                        ?? (rung.key === 'launch_pad'
                          ? 'A Launch Pad opens an orbit lane from its own territory. Cape Canaveral, Kourou and Gobi already have one.'
                          : ''),
                      valueColor: rung.done ? 'text-emerald-400' : 'text-bf-muted',
                    }))}
              />
            </section>
          )}

          {/* ── Galactic Age worlds & lanes ───────────────────────── */}
          {galaxyWorldRows.length > 0 && (
            <section>
              <SectionHeader icon="🌌" title="Your Worlds & Lanes" />
              <BonusTable rows={galaxyWorldRows} />
            </section>
          )}

          {/* ── Era Rules ──────────────────────────────────────────── */}
          {activeEraRules.length > 0 && (
            <section>
              <SectionHeader icon="🌍" title="Era Rules (apply to all players)" />
              <BonusTable
                rows={activeEraRules.map((m) => ({
                  icon: m.icon,
                  label: m.label,
                  value: 'Active',
                  description: m.description,
                  valueColor: 'text-amber-400',
                }))}
              />
            </section>
          )}

          {/* ── Faction ────────────────────────────────────────────── */}
          {gameState.settings.factions_enabled && myPlayer.faction_id && (
            <section>
              <SectionHeader icon={<Star className="w-3.5 h-3.5 text-bf-gold" />} title="Your Faction" />
              {factionLoading && !factionData && (
                <p className="text-xs text-bf-muted italic">Loading…</p>
              )}
              {factionData && (
                <BonusTable
                  rows={[
                    {
                      icon: '🏴',
                      label: factionData.name,
                      value: '',
                      description: factionData.lore
                        ? `${factionData.description}\n\n${factionData.lore}`
                        : factionData.description,
                    },
                    ...(factionData.flavor_quote
                      ? [{
                          icon: '📜',
                          label: 'Lore',
                          value: '',
                          description: `"${factionData.flavor_quote}"`,
                          valueColor: 'text-amber-200',
                        }]
                      : []),
                    ...(factionData.passive_attack_bonus
                      ? [{
                          icon: '⚔️',
                          label: 'Passive Attack Bonus',
                          value: `+${factionData.passive_attack_bonus} die`,
                          description: 'Added to your attack rolls every battle.',
                          valueColor: 'text-red-300',
                        }]
                      : []),
                    ...(factionData.passive_defense_bonus
                      ? [{
                          icon: '🛡️',
                          label: 'Passive Defense Bonus',
                          value: `+${factionData.passive_defense_bonus} die`,
                          description: 'Added to your defense rolls every battle.',
                          valueColor: 'text-blue-300',
                        }]
                      : []),
                    ...(factionData.reinforce_bonus
                      ? [{
                          icon: '🪖',
                          label: 'Faction Reinforcement Bonus',
                          value: `+${factionData.reinforce_bonus} / turn`,
                          description: 'Added at the start of each of your draft phases.',
                          valueColor: 'text-amber-300',
                        }]
                      : []),
                    ...(factionData.tech_cost_discount
                      ? [{
                          icon: '🔬',
                          label: 'Faction Research Discount',
                          value: `−${factionData.tech_cost_discount} TP / research`,
                          description: 'Every technology costs that much less to research (minimum 1).',
                          valueColor: 'text-cyan-300',
                        }]
                      : []),
                    ...(factionData.stability_recovery_bonus
                      ? [{
                          icon: '📈',
                          label: 'Faction Stability Recovery',
                          value: `+${factionData.stability_recovery_bonus} / turn`,
                          description: 'Applied to each of your owned territories during stability tick.',
                          valueColor: 'text-emerald-300',
                        }]
                      : []),
                    ...(factionData.lane_defense_bonus
                      ? [
                          {
                            icon: '🛰',
                            label: 'Faction Lane Defence',
                            value: `+${factionData.lane_defense_bonus} die`,
                            description: 'Extra defence die against any attack across a hyperspace lane.',
                          },
                        ]
                      : []),
                    ...(factionData.ability_description
                      ? [{
                          icon: '✨',
                          label: 'Faction Ability',
                          value: 'Active',
                          description: factionData.ability_description,
                          valueColor: 'text-violet-300',
                        }]
                      : []),
                  ]}
                />
              )}
              {!factionLoading && !factionData && (
                <p className="text-xs text-bf-muted italic">
                  Faction: <span className="font-mono">{myPlayer.faction_id}</span>
                </p>
              )}
            </section>
          )}

          {/* ── Temporary event buffs ──────────────────────────────── */}
          {tempMods.length > 0 && (
            <section>
              <SectionHeader icon="✨" title="Active Event Buffs" />
              <BonusTable
                rows={tempMods.map((mod) => ({
                  icon:
                    mod.type === 'attack_modifier' ? '⚔️' :
                    mod.type === 'defense_modifier' ? '🛡️' : '⚙️',
                  label: MOD_TYPE_LABELS[mod.type] ?? mod.type,
                  value: `+${mod.value}${mod.turns_remaining != null ? ` · ${mod.turns_remaining}t left` : ''}`,
                  description: 'Granted by an event card — expires after the listed turns.',
                  valueColor:
                    mod.type === 'attack_modifier' ? 'text-red-300' :
                    mod.type === 'defense_modifier' ? 'text-blue-300' : 'text-amber-300',
                }))}
              />
            </section>
          )}

          {/* ── Wonder ─────────────────────────────────────────────── */}
          {ownsWonder && (
            <section>
              <SectionHeader icon="🏛️" title={ownedWonders.length > 1 ? 'Era Wonders' : 'Era Wonder'} />
              <BonusTable
                rows={ownedWonders.map((w) => ({
                  icon: '✨',
                  label: w.name,
                  value: 'Owned',
                  description: w.description,
                  valueColor: 'text-bf-gold',
                }))}
              />
            </section>
          )}

          {/* ── Researched technologies ────────────────────────────── */}
          {gameState.settings.tech_trees_enabled && hasUnlocked && (
            <section>
              <SectionHeader icon={<Zap className="w-3.5 h-3.5 text-bf-gold" />} title="Researched Technologies" />
              {unlockedTechs.length > 0 ? (
                <BonusTable
                  rows={unlockedTechs.map((n) => {
                    const parts: string[] = [];
                    if (n.attack_bonus) parts.push(`+${n.attack_bonus} Atk`);
                    if (n.defense_bonus) parts.push(`+${n.defense_bonus} Def`);
                    if (n.reinforce_bonus) parts.push(`+${n.reinforce_bonus} Reinf`);
                    if (n.tech_point_income) parts.push(`+${n.tech_point_income} TP/turn`);
                    if (n.unlocks_building) parts.push(`Unlocks ${n.unlocks_building}`);
                    if (n.unlocks_ability) parts.push(`Ability: ${n.unlocks_ability}`);
                    return {
                      icon: '🔬',
                      label: n.name,
                      value: parts.join(', ') || '✓',
                      description: n.description,
                      valueColor: 'text-blue-300',
                    };
                  })}
                />
              ) : (
                <div className="px-3 py-2 rounded-lg bg-bf-dark border border-bf-border/60">
                  <p className="text-xs text-bf-muted">
                    You have {myPlayer.unlocked_techs?.length} tech
                    {(myPlayer.unlocked_techs?.length ?? 0) !== 1 ? 's' : ''} researched.
                    Open the <span className="text-blue-300">Tech Tree</span> to load full details.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* ── Buildings ──────────────────────────────────────────── */}
          {gameState.settings.economy_enabled && Object.keys(buildingCounts).length > 0 && (
            <section>
              <SectionHeader icon={<Building2 className="w-3.5 h-3.5 text-bf-gold" />} title="Your Buildings" />
              <BonusTable
                rows={Object.entries(buildingCounts)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([type, count]) => {
                    const meta = BUILDING_META[type];
                    return {
                      icon: '🏗️',
                      label: meta?.label ?? type,
                      value: `×${count}`,
                      description: meta
                        ? `${meta.effect}${count > 1 ? ` (across ${count} territories)` : ''}`
                        : undefined,
                      valueColor: meta?.color ?? 'text-bf-text',
                    };
                  })}
              />
            </section>
          )}
        </div>

        {/* Footer note */}
        <div className="px-4 py-3 border-t border-bf-border shrink-0">
          <p className="text-xs text-bf-muted text-center">
            Bonuses stack unless otherwise noted. Era Rules apply to all players equally.
          </p>
        </div>
      </div>
    </div>
  );
}
