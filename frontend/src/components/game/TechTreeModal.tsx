import React, { useMemo } from 'react';
import clsx from 'clsx';
import { X, Lock, CheckCircle, Zap } from 'lucide-react';
import type { GameState } from '../../store/gameStore';

// Matches the backend TechNode shape
export interface TechNode {
  tech_id: string;
  name: string;
  description: string;
  tier: 1 | 2 | 3 | 4;
  cost: number;
  prerequisite?: string;
  attack_bonus?: number;
  defense_bonus?: number;
  reinforce_bonus?: number;
  tech_point_income?: number;
  unlocks_building?: string;
  unlocks_ability?: string;
}

interface Props {
  gameState: GameState;
  currentPlayerId: string;
  techTree: TechNode[];
  onResearch: (techId: string) => void;
  onClose: () => void;
}

function NodeBonusTags({ node }: { node: TechNode }) {
  const tags: string[] = [];
  if (node.attack_bonus) tags.push(`+${node.attack_bonus} Atk`);
  if (node.defense_bonus) tags.push(`+${node.defense_bonus} Def`);
  if (node.reinforce_bonus) tags.push(`+${node.reinforce_bonus} Reinf`);
  if (node.tech_point_income) tags.push(`+${node.tech_point_income} TP/turn`);
  if (node.unlocks_building) tags.push(`Unlocks: ${node.unlocks_building}`);
  if (node.unlocks_ability) tags.push(`Ability: ${node.unlocks_ability}`);
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tags.map((t) => (
        <span key={t} className="px-1.5 py-0.5 rounded text-xs bg-blue-900/50 text-blue-300">
          {t}
        </span>
      ))}
    </div>
  );
}

function UnlockChainTags({ node, allTechs }: { node: TechNode; allTechs: TechNode[] }) {
  const unlockedTechs = allTechs.filter((t) => t.prerequisite === node.tech_id);
  if (unlockedTechs.length === 0) return null;
  
  return (
    <div className="mt-2 pt-1.5 border-t border-amber-900/40">
      <p className="text-xs text-amber-400/90 font-semibold mb-1">🔓 Unlocks next tier:</p>
      <div className="flex flex-wrap gap-1">
        {unlockedTechs.map((t) => (
          <span
            key={t.tech_id}
            className="px-2 py-0.5 rounded text-xs bg-amber-900/30 text-amber-300 border border-amber-700/40"
            title={t.name}
          >
            {t.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function TechTreeModal({ gameState, currentPlayerId, techTree, onResearch, onClose }: Props) {
  const player = gameState.players.find((p) => p.player_id === currentPlayerId);
  const unlocked = useMemo(() => new Set(player?.unlocked_techs ?? []), [player]);
  const techPoints = player?.tech_points ?? 0;

  const tiers = [1, 2, 3, 4] as const;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm px-3 py-4 pt-safe pb-safe sm:px-4">
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[min(92vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Zap className="text-yellow-400 w-5 h-5" />
            <h2 className="text-lg font-semibold text-white">Technology Tree</h2>
            <span className="ml-2 px-2 py-0.5 rounded-full bg-blue-800 text-blue-200 text-sm font-mono">
              {techPoints} TP available
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info banner */}
        <div className="px-4 pt-4 pb-2">
          <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700/40 text-xs text-amber-200">
            <p className="font-semibold mb-1">💡 Strategy Tip:</p>
            <p>
              Researching a tech unlocks related technologies in higher tiers. Plan your tech path to unlock synergies!
              Look for the <span className="text-amber-300">🔓 Unlocks</span> section to see chains.
            </p>
          </div>
        </div>

        {/* Tree body */}
        <div className="overflow-y-auto p-4 space-y-6">
          {tiers.map((tier) => {
            const tierNodes = techTree.filter((n) => n.tier === tier);
            if (tierNodes.length === 0) return null;
            return (
              <div key={tier}>
                <h3 className="text-xs uppercase tracking-widest text-gray-500 mb-2">
                  Tier {tier}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {tierNodes.map((node) => {
                    const isUnlocked = unlocked.has(node.tech_id);
                    const prereqsMet = !node.prerequisite || unlocked.has(node.prerequisite);
                    const canResearch = !isUnlocked && prereqsMet && techPoints >= node.cost;
                    const unlockedByThis = techTree.filter((t) => t.prerequisite === node.tech_id);

                    return (
                      <div
                        key={node.tech_id}
                        className={clsx(
                          'rounded-lg border p-3 flex flex-col gap-1 transition-colors',
                          isUnlocked
                            ? 'bg-green-900/30 border-green-700/60'
                            : canResearch
                            ? 'bg-gray-800 border-gray-600 hover:border-blue-500 cursor-pointer'
                            : 'bg-gray-800/50 border-gray-700/40 opacity-50'
                        )}
                      >
                        {/* Title row */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-white truncate">{node.name}</span>
                          {isUnlocked ? (
                            <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                          ) : prereqsMet ? (
                            <span className="text-xs font-mono text-blue-300 flex-shrink-0">
                              {node.cost} TP
                            </span>
                          ) : (
                            <Lock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                          )}
                        </div>

                        {/* Description */}
                        <p className="text-xs text-gray-400 leading-snug">{node.description}</p>

                        {/* Bonus tags */}
                        <NodeBonusTags node={node} />

                        {/* Unlock chain indicator */}
                        {unlockedByThis.length > 0 && (
                          <UnlockChainTags node={node} allTechs={techTree} />
                        )}

                        {/* Research button */}
                        {canResearch && (
                          <button
                            onClick={() => onResearch(node.tech_id)}
                            className={clsx(
                              'mt-2 w-full py-1 rounded text-xs font-semibold',
                              'bg-blue-700 hover:bg-blue-600 text-white transition-colors'
                            )}
                          >
                            Research ({node.cost} TP)
                          </button>
                        )}

                        {/* Prerequisites hint */}
                        {!isUnlocked && !prereqsMet && node.prerequisite && (
                          <p className="text-xs text-gray-500 mt-1">
                            Requires: {node.prerequisite}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {techTree.length === 0 && (
            <p className="text-center text-gray-500 py-8">No technology tree available for this era.</p>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
