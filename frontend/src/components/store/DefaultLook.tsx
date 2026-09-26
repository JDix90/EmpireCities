import React from 'react';
import type { Slot } from './storeCatalog';

/** What a slot looks like with nothing in it: the game's own default. */
export default function DefaultLook({ slot, initial = '?' }: { slot: Slot; initial?: string }) {
  let body: React.ReactNode;
  switch (slot) {
    case 'frame':
      body = (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-bf-border font-display text-lg text-bf-text">
          {initial.slice(0, 1).toUpperCase()}
        </span>
      );
      break;
    case 'banner':
      body = <span className="text-xs text-bf-muted">No banner</span>;
      break;
    case 'marker':
      body = (
        <span className="flex h-12 w-16 items-center justify-center rounded-md border border-bf-border bg-emerald-900/60">
          <span className="block h-3 w-3 rotate-45 border-2 border-[#ffd700] bg-red-500" />
        </span>
      );
      break;
    case 'dice':
      body = (
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/25 font-mono text-xl font-bold text-red-300 ring-2 ring-red-500/40">
          6
        </span>
      );
      break;
  }
  return (
    <div
      aria-hidden="true"
      data-testid="default-look"
      className="flex h-16 items-center justify-center rounded-lg bg-bf-dark/60"
    >
      {body}
    </div>
  );
}
