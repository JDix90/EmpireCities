import React from 'react';
import clsx from 'clsx';
import { frameLook } from '@borderfall/shared';
import { useCosmeticMotion } from './useCosmetics';

/**
 * A frame's ring around an avatar. The padding is there with or without a
 * ring, so equipping a frame never moves the layout; an id with no frame look
 * (nothing equipped, a banner, an unknown id) draws the avatar alone.
 */
export default function FrameRing({
  frameId,
  children,
  className = 'p-1',
  glow = 'soft',
}: {
  frameId: string | null | undefined;
  children: React.ReactNode;
  /** Padding sets the ring's width. */
  className?: string;
  /** How far a glowing frame's light reaches: `strong` for a large showcase. */
  glow?: 'soft' | 'strong';
}) {
  const look = frameLook(frameId);
  const motion = useCosmeticMotion();
  return (
    <div
      className={clsx('relative inline-flex shrink-0 rounded-full', className)}
      data-frame={look ? frameId : undefined}
    >
      {look && (
        <div
          aria-hidden="true"
          data-testid="frame-ring"
          className={clsx('absolute inset-0 rounded-full', motion && look.motion === 'spin' && 'animate-frame-spin')}
          style={{
            background: `linear-gradient(90deg, ${look.ring.join(', ')})`,
            boxShadow: look.glow
              ? glow === 'strong' ? `0 0 22px ${look.glow}, 0 0 4px ${look.glow}` : `0 0 10px ${look.glow}`
              : undefined,
          }}
        />
      )}
      <div className="relative inline-flex rounded-full">{children}</div>
      {look?.motion === 'orbit' && (
        // A satellite on the ring, circling it; parked at the top when still.
        <div
          aria-hidden="true"
          data-testid="frame-orbit"
          className={clsx('pointer-events-none absolute inset-0', motion && 'animate-frame-spin')}
        >
          <span
            className="absolute left-1/2 top-0 h-[14%] min-h-[3px] w-[14%] min-w-[3px] -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 6px ${look.glow ?? '#fff'}` }}
          />
        </div>
      )}
    </div>
  );
}
