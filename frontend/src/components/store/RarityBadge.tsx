import React from 'react';
import type { CosmeticRarity } from '@borderfall/shared';
import { rarityStyle } from './storeStyles';

/** An item's rarity, on every card: commons included, so the scale reads at a glance. */
export default function RarityBadge({ rarity }: { rarity: CosmeticRarity | null | undefined }) {
  const style = rarityStyle(rarity);
  return (
    <span
      data-testid="rarity"
      className="shrink-0 text-[10px] font-bold uppercase tracking-[0.1em]"
      style={{ color: style.text }}
    >
      {style.label}
    </span>
  );
}
