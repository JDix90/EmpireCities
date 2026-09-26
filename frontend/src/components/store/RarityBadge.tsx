import React from 'react';
import { RARITY_COLORS, type CosmeticRarity } from '@borderfall/shared';

/** An item's rarity, on every card: commons included, so the scale reads at a glance. */
export default function RarityBadge({ rarity }: { rarity: CosmeticRarity | null | undefined }) {
  const r = rarity && rarity in RARITY_COLORS ? rarity : 'common';
  const color = RARITY_COLORS[r];
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ color, backgroundColor: `${color}15`, border: `1px solid ${color}40` }}
    >
      {r}
    </span>
  );
}
