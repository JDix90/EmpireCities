import React from 'react';
import { X } from 'lucide-react';

export interface FactionLoreInfo {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  flavor_quote?: string;
  color?: string;
  passive_attack_bonus?: number;
  passive_defense_bonus?: number;
  reinforce_bonus?: number;
  stability_recovery_bonus?: number;
  ability_description?: string;
}

function Chip({ label }: { label: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full bg-cc-gold/15 border border-cc-gold/25 text-cc-gold text-xs">
      {label}
    </span>
  );
}

export default function FactionLoreModal({ faction, onClose }: { faction: FactionLoreInfo; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="bg-cc-surface border border-cc-border rounded-xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          {faction.color && (
            <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: faction.color }} />
          )}
          <p className="font-display text-xl text-cc-gold">{faction.name}</p>
          <button onClick={onClose} className="ml-auto text-cc-muted hover:text-cc-text transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Flavor quote */}
        {faction.flavor_quote && (
          <p className="italic text-cc-muted text-sm mb-4 border-l-2 border-cc-gold/40 pl-3">
            "{faction.flavor_quote}"
          </p>
        )}

        {/* Lore */}
        {faction.lore ? (
          <p className="text-cc-text text-sm leading-relaxed mb-4">{faction.lore}</p>
        ) : (
          <p className="text-cc-muted text-sm leading-relaxed mb-4">{faction.description}</p>
        )}

        {/* Stat chips */}
        {((faction.passive_attack_bonus ?? 0) > 0 ||
          (faction.passive_defense_bonus ?? 0) > 0 ||
          (faction.reinforce_bonus ?? 0) > 0 ||
          (faction.stability_recovery_bonus ?? 0) > 0) && (
          <div className="flex flex-wrap gap-2 mb-4">
            {(faction.passive_attack_bonus ?? 0) > 0 && <Chip label={`+${faction.passive_attack_bonus} Attack`} />}
            {(faction.passive_defense_bonus ?? 0) > 0 && <Chip label={`+${faction.passive_defense_bonus} Defence`} />}
            {(faction.reinforce_bonus ?? 0) > 0 && <Chip label={`+${faction.reinforce_bonus} Reinforce`} />}
            {(faction.stability_recovery_bonus ?? 0) > 0 && (
              <Chip label={`+${faction.stability_recovery_bonus} Stability`} />
            )}
          </div>
        )}

        {/* Ability */}
        {faction.ability_description && (
          <div className="bg-cc-dark/50 rounded-lg p-3 text-sm">
            <p className="text-cc-gold text-xs uppercase tracking-wide mb-1">Special Ability</p>
            <p className="text-cc-text">{faction.ability_description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
