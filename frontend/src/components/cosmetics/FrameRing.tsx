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
}: {
  frameId: string | null | undefined;
  children: React.ReactNode;
  /** Padding sets the ring's width. */
  className?: string;
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
            boxShadow: look.glow ? `0 0 10px ${look.glow}` : undefined,
          }}
        />
      )}
      <div className="relative inline-flex rounded-full">{children}</div>
    </div>
  );
}
