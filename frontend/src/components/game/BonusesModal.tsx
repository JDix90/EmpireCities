import React, { useEffect, useState } from 'react';
import { X, Shield, Zap, Star, Building2 } from 'lucide-react';
import clsx from 'clsx';
import { useGameStore } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../services/api';
import { ERA_WONDERS } from '../../constants/eraWonders';
import type { TechNode } from './TechTreeModal';

// ── Static data ───────────────────────────────────────────────────────────────

const MODIFIER_INFO = [
  { key: 'legion_reroll',       label: 'Legion Tactics',      description: 'Attacker may re-roll one die when attacking with 3 dice.',               icon: '⚔️' },
  { key: 'castle_fortification',label: 'Castle Fortification', description: 'Defenders with 4+ units roll an extra die.',                            icon: '🏰' },
  { key: 'sea_lanes',           label: 'Sea Lanes',            description: 'Sea-route attacks are limited to 2 attack dice.',                       icon: '⚓' },
  { key: 'wartime_logistics',   label: 'Wartime Logistics',    description: 'May fortify twice per turn.',                                           icon: '🚂' },
  { key: 'influence_spread',    label: 'Influence Spread',     description: 'May spend 3 units to seize a nearby territory without combat.',          icon: '📡' },
  { key: 'precision_strike',    label: 'Precision Strike',     description: 'Attack with 3 dice when committing 4+ units.',                          icon: '🎯' },
  { key: 'rifle_doctrine',      label: 'Rifle Doctrine',       description: 'Re-roll tied attacker dice to break deadlocks.',                        icon: '🔫' },
  { key: 'carbonari_network',   label: 'Carbonari Network',    description: 'Influence operations can reach beyond adjacent territories.',            icon: '🕵️' },
];

const MOD_TYPE_LABELS: Record<string, string> = {
  attack_modifier:  'Attack Bonus',
  defense_modifier: 'Defense Bonus',
  production_bonus: 'Production Bonus',
};

const BUILDING_META: Record<string, { label: string; effect: string; color: string }> = {
  defense_1:    { label: 'Palisade',        effect: '+1 defender die',            color: 'text-blue-300'   },
  defense_2:    { label: 'Fortification',   effect: '+2 defender dice',           color: 'text-blue-300'   },
  defense_3:    { label: 'Citadel',         effect: '+3 defender dice',           color: 'text-blue-300'   },
  production_1: { label: 'Camp',            effect: '+1 unit reinforced/turn',    color: 'text-amber-300'  },
  production_2: { label: 'Barracks',        effect: '+2 units reinforced/turn',   color: 'text-amber-300'  },
  production_3: { label: 'War Factory',     effect: '+4 units reinforced/turn',   color: 'text-amber-300'  },
  tech_gen_1:   { label: 'Library',         effect: '+2 tech points/turn',        color: 'text-purple-300' },
  tech_gen_2:   { label: 'University',      effect: '+4 tech points/turn',        color: 'text-purple-300' },
  special_a:    { label: 'Workshop',        effect: 'Special production project', color: 'text-emerald-300'},
  special_b:    { label: 'Special Project', effect: 'Unique era project',         color: 'text-emerald-300'},
  port:         { label: 'Port',            effect: 'Enables fleet deployment',   color: 'text-cyan-300'   },
  naval_base:   { label: 'Naval Base',      effect: '+2 fleet capacity',          color: 'text-cyan-300'   },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-base leading-none">{icon}</span>
      <h3 className="text-xs font-semibold text-cc-gold uppercase tracking-wider">{title}</h3>
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
          className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-cc-dark border border-cc-border/60"
        >
          <span className="text-sm shrink-0 mt-0.5">{row.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium text-cc-text leading-snug">{row.label}</span>
              {row.value && (
                <span className={clsx('text-xs font-mono font-semibold shrink-0', row.valueColor ?? 'text-cc-gold')}>
                  {row.value}
                </span>
              )}
            </div>
            {row.description && (
              <p className="text-xs text-cc-muted mt-0.5 leading-relaxed">{row.description}</p>
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
  passive_attack_bonus?: number;
  passive_defense_bonus?: number;
}

export interface BonusesModalProps {
  /** Tech tree nodes already loaded (may be empty — modal will show note to open Tech Tree). */
  techTree: TechNode[];
  onClose: () => void;
}

export default function BonusesModal({ techTree, onClose }: BonusesModalProps) {
  const { gameState } = useGameStore();
  const { user } = useAuthStore();
  const [factionData, setFactionData] = useState<FactionInfo | null>(null);
  const [factionLoading, setFactionLoading] = useState(false);

  const myPlayer = gameState?.players.find((p) => p.player_id === user?.user_id);

  // Fetch faction info on open when factions are enabled
  useEffect(() => {
    if (!gameState || !myPlayer?.faction_id || !gameState.settings.factions_enabled) return;
    setFactionLoading(true);
    api
      .get(`/eras/${gameState.era}/factions`)
      .then((res) => {
        const factions: FactionInfo[] = res.data.factions ?? [];
        const mine = factions.find((f) => f.faction_id === myPlayer.faction_id);
        setFactionData(mine ?? null);
      })
      .catch(() => {})
      .finally(() => setFactionLoading(false));
  }, [gameState?.era, myPlayer?.faction_id, gameState?.settings.factions_enabled]);

  if (!gameState || !myPlayer) return null;

  // ── Active era modifiers ────────────────────────────────────────────────────
  const activeEraRules = MODIFIER_INFO.filter(
    (m) => gameState.era_modifiers && (gameState.era_modifiers as Record<string, unknown>)[m.key],
  );

  // ── Temporary event buffs ───────────────────────────────────────────────────
  const tempMods = myPlayer.temporary_modifiers ?? [];

  // ── Wonder the player owns ──────────────────────────────────────────────────
  const eraWonder = ERA_WONDERS[gameState.era];
  const ownsWonder = eraWonder
    ? Object.values(gameState.territories).some(
        (t) => t.owner_id === user?.user_id && t.buildings?.includes(eraWonder.wonder_id),
      )
    : false;

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
    myPlayer.faction_id ||
    tempMods.length > 0 ||
    ownsWonder ||
    hasUnlocked ||
    Object.keys(buildingCounts).length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-auto pt-6 px-4 pb-8 pt-safe pb-safe"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-cc-surface border border-cc-border rounded-xl shadow-2xl w-full max-w-lg flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-cc-border shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-cc-gold" />
            <h2 className="text-base font-semibold text-cc-gold">Bonuses &amp; Active Rules</h2>
          </div>
          <button
            onClick={onClose}
            className="text-cc-muted hover:text-white transition-colors"
            aria-label="Close bonuses panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 space-y-6">
          {!hasSomething && (
            <p className="text-cc-muted text-sm text-center py-10">
              No active bonuses yet. Research techs, build structures, or wait for an event card.
            </p>
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
              <SectionHeader icon={<Star className="w-3.5 h-3.5 text-cc-gold" />} title="Your Faction" />
              {factionLoading && !factionData && (
                <p className="text-xs text-cc-muted italic">Loading…</p>
              )}
              {factionData && (
                <BonusTable
                  rows={[
                    {
                      icon: '🏴',
                      label: factionData.name,
                      value: '',
                      description: factionData.description,
                    },
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
                  ]}
                />
              )}
              {!factionLoading && !factionData && (
                <p className="text-xs text-cc-muted italic">
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
          {ownsWonder && eraWonder && (
            <section>
              <SectionHeader icon="🏛️" title="Era Wonder" />
              <BonusTable
                rows={[{
                  icon: '✨',
                  label: eraWonder.name,
                  value: 'Owned',
                  description: eraWonder.description,
                  valueColor: 'text-cc-gold',
                }]}
              />
            </section>
          )}

          {/* ── Researched technologies ────────────────────────────── */}
          {gameState.settings.tech_trees_enabled && hasUnlocked && (
            <section>
              <SectionHeader icon={<Zap className="w-3.5 h-3.5 text-cc-gold" />} title="Researched Technologies" />
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
                <div className="px-3 py-2 rounded-lg bg-cc-dark border border-cc-border/60">
                  <p className="text-xs text-cc-muted">
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
              <SectionHeader icon={<Building2 className="w-3.5 h-3.5 text-cc-gold" />} title="Your Buildings" />
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
                      valueColor: meta?.color ?? 'text-cc-text',
                    };
                  })}
              />
            </section>
          )}
        </div>

        {/* Footer note */}
        <div className="px-4 py-3 border-t border-cc-border shrink-0">
          <p className="text-xs text-cc-muted text-center">
            Bonuses stack unless otherwise noted. Era Rules apply to all players equally.
          </p>
        </div>
      </div>
    </div>
  );
}
