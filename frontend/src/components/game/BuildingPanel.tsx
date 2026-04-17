/**
 * BuildingPanel — appears inside TerritoryPanel when economy_enabled.
 * Shows current buildings on the selected territory and build buttons.
 */
import React from 'react';
import clsx from 'clsx';
import { Hammer, Shield, Zap, Star, Anchor } from 'lucide-react';

const BUILDING_META: Record<
  string,
  { label: string; description: string; cost: number; icon: React.ReactNode; category: string }
> = {
  production_1: {
    label: 'Camp (I)',
    description: '+1 unit per turn',
    cost: 3,
    icon: <Hammer className="w-3 h-3" />,
    category: 'production',
  },
  production_2: {
    label: 'Barracks (II)',
    description: '+2 units per turn',
    cost: 6,
    icon: <Hammer className="w-3 h-3" />,
    category: 'production',
  },
  production_3: {
    label: 'Arsenal (III)',
    description: '+4 units per turn',
    cost: 10,
    icon: <Hammer className="w-3 h-3" />,
    category: 'production',
  },
  defense_1: {
    label: 'Palisade (I)',
    description: '+1 defense die',
    cost: 3,
    icon: <Shield className="w-3 h-3" />,
    category: 'defense',
  },
  defense_2: {
    label: 'Fortress (II)',
    description: '+2 defense dice',
    cost: 6,
    icon: <Shield className="w-3 h-3" />,
    category: 'defense',
  },
  defense_3: {
    label: 'Citadel (III)',
    description: '+3 defense dice',
    cost: 10,
    icon: <Shield className="w-3 h-3" />,
    category: 'defense',
  },
  tech_gen_1: {
    label: 'Laboratory (I)',
    description: '+2 TP/turn',
    cost: 4,
    icon: <Zap className="w-3 h-3" />,
    category: 'tech',
  },
  tech_gen_2: {
    label: 'Research Center (II)',
    description: '+4 TP/turn',
    cost: 8,
    icon: <Zap className="w-3 h-3" />,
    category: 'tech',
  },
  special_a: {
    label: 'Capital Works',
    description: 'Capital special project',
    cost: 5,
    icon: <Star className="w-3 h-3" />,
    category: 'special',
  },
  special_b: {
    label: 'Special Project',
    description: 'Era wonder project',
    cost: 8,
    icon: <Star className="w-3 h-3" />,
    category: 'special',
  },
  port: {
    label: 'Port',
    description: '+1 fleet/turn',
    cost: 5,
    icon: <Anchor className="w-3 h-3" />,
    category: 'naval',
  },
  naval_base: {
    label: 'Naval Base',
    description: '+2 fleets/turn',
    cost: 10,
    icon: <Anchor className="w-3 h-3" />,
    category: 'naval',
  },
};

const UPGRADES: Record<string, string> = {
  production_1: 'production_2',
  production_2: 'production_3',
  defense_1: 'defense_2',
  defense_2: 'defense_3',
  tech_gen_1: 'tech_gen_2',
  port: 'naval_base',
};

interface EraWonderInfo {
  id: string;
  name: string;
  description: string;
  cost: number;
  alreadyBuilt: boolean;
  builderName?: string;
}

interface Props {
  territoryId: string;
  buildings: string[];
  /** Current player's available resource (special_resource from PlayerState) */
  playerResources: number;
  isMine: boolean;
  isMyTurn: boolean;
  phase: string;
  onBuild: (buildingType: string) => void;
  isCoastal?: boolean;
  eraWonder?: EraWonderInfo;
}

function BuildingPanel({
  buildings,
  playerResources,
  isMine,
  isMyTurn,
  phase,
  onBuild,
  isCoastal,
  eraWonder,
}: Props) {
  const canBuild = isMine && isMyTurn && (phase === 'draft' || phase === 'fortify');

  // Determine which building types the player already has (one slot per category)
  const existingCategories = new Set(buildings.map((b) => BUILDING_META[b]?.category));
  const existingSet = new Set(buildings);

  // Build list: upgrades of existing buildings + new categories not yet present
  const buildOptions: string[] = [];
  for (const b of buildings) {
    const upgrade = UPGRADES[b];
    if (upgrade && !existingSet.has(upgrade)) buildOptions.push(upgrade);
  }
  // New production if none
  if (!existingCategories.has('production') && !buildOptions.some((b) => b.startsWith('production'))) {
    buildOptions.push('production_1');
  }
  // New defense if none
  if (!existingCategories.has('defense') && !buildOptions.some((b) => b.startsWith('defense'))) {
    buildOptions.push('defense_1');
  }
  // New tech gen if none
  if (!existingCategories.has('tech') && !buildOptions.some((b) => b.startsWith('tech_gen'))) {
    buildOptions.push('tech_gen_1');
  }
  // New port if coastal and no naval building yet
  if (isCoastal && !existingCategories.has('naval') && !buildOptions.includes('port')) {
    buildOptions.push('port');
  }
  // Remove naval buildings from non-coastal territories
  const filteredOptions = isCoastal
    ? buildOptions
    : buildOptions.filter((b) => b !== 'port' && b !== 'naval_base');

  if (buildings.length === 0 && filteredOptions.length === 0 && !canBuild && !eraWonder) return null;

  // Wonder already built on THIS territory
  const wonderOnThisTerritory = eraWonder && buildings.includes(eraWonder.id);
  // Wonder can be built here: no wonder on this territory, not already built globally, canBuild
  const showWonderOption = canBuild && eraWonder && !eraWonder.alreadyBuilt && !wonderOnThisTerritory;
  // Wonder built elsewhere — show disabled info
  const showWonderBuiltElsewhere = canBuild && eraWonder && eraWonder.alreadyBuilt && !wonderOnThisTerritory;

  return (
    <div className="mt-3 border-t border-gray-700 pt-3">
      <h4 className="text-xs uppercase tracking-widest text-gray-500 mb-2">Buildings</h4>

      {/* Existing buildings */}
      {buildings.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {buildings.map((b) => {
            const meta = BUILDING_META[b];
            // wonder buildings may not be in BUILDING_META — use eraWonder info
            if (!meta) {
              if (eraWonder && b === eraWonder.id) {
                return (
                  <span
                    key={b}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-800/60 text-amber-200 border border-amber-500/50"
                    title={eraWonder.description}
                  >
                    <Star className="w-3 h-3 text-amber-400" />
                    {eraWonder.name}
                  </span>
                );
              }
              return null;
            }
            return (
              <span
                key={b}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-200"
                title={meta.description}
              >
                {meta.icon}
                {meta.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Build options */}
      {canBuild && filteredOptions.length > 0 && (
        <div className="space-y-1">
          {filteredOptions.map((b) => {
            const meta = BUILDING_META[b];
            if (!meta) return null;
            const affordable = playerResources >= meta.cost;
            return (
              <button
                key={b}
                onClick={() => affordable && onBuild(b)}
                disabled={!affordable}
                title={affordable ? undefined : `Need ${meta.cost - playerResources} more resources`}
                className={clsx(
                  'w-full flex items-center justify-between px-2 py-1 rounded text-xs',
                  'border transition-colors',
                  affordable
                    ? 'border-amber-700/60 bg-amber-900/30 text-amber-200 hover:bg-amber-800/40'
                    : 'border-gray-700/40 bg-gray-800/30 text-gray-500 cursor-not-allowed opacity-60'
                )}
              >
                <span className="flex items-center gap-1.5">
                  {meta.icon}
                  <span>{meta.label}</span>
                  <span className="text-gray-400">— {meta.description}</span>
                </span>
                <span className="ml-2 font-mono">{meta.cost}💰</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Wonder build option */}
      {showWonderOption && eraWonder && (
        <div className="mt-1">
          <button
            onClick={() => playerResources >= eraWonder.cost && onBuild(eraWonder.id)}
            disabled={playerResources < eraWonder.cost}
            title={
              playerResources >= eraWonder.cost
                ? eraWonder.description
                : `Need ${eraWonder.cost - playerResources} more resources`
            }
            className={clsx(
              'w-full flex items-center justify-between px-2 py-1.5 rounded text-xs border transition-colors',
              playerResources >= eraWonder.cost
                ? 'border-yellow-500/70 bg-yellow-900/30 text-yellow-200 hover:bg-yellow-800/40'
                : 'border-yellow-800/40 bg-gray-800/30 text-gray-500 cursor-not-allowed opacity-60'
            )}
          >
            <span className="flex items-center gap-1.5">
              <Star className="w-3 h-3 text-yellow-400" />
              <span className="font-semibold">{eraWonder.name}</span>
              <span
                className="px-1 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-black leading-none"
              >
                UNIQUE · Race!
              </span>
              <span className="text-gray-400">— {eraWonder.description}</span>
            </span>
            <span className="ml-2 font-mono">{eraWonder.cost}💰</span>
          </button>
        </div>
      )}

      {/* Wonder built by another player */}
      {showWonderBuiltElsewhere && eraWonder && (
        <div className="mt-1 px-2 py-1.5 rounded text-xs border border-red-800/50 bg-red-900/20 text-red-300 flex items-center gap-1.5">
          <Star className="w-3 h-3 text-red-400" />
          <span className="font-semibold">{eraWonder.name}</span>
          <span>— already built{eraWonder.builderName ? ` by ${eraWonder.builderName}` : ''}</span>
        </div>
      )}

      {canBuild && filteredOptions.length === 0 && buildings.length > 0 && (
        <p className="text-xs text-gray-500">All buildings fully upgraded.</p>
      )}
    </div>
  );
}


export default React.memo(BuildingPanel);
