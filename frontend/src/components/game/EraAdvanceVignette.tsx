import React, { useEffect, useState } from 'react';

interface EraAdvanceVignetteProps {
  active: boolean;
  eraLabel?: string;
  onComplete?: () => void;
}

/**
 * Full-viewport golden flash when a player ascends to a new era.
 * Sits above the map shell; pointer-events none.
 */
export default function EraAdvanceVignette({ active, eraLabel, onComplete }: EraAdvanceVignetteProps) {
  const [visible, setVisible] = useState(false);
  const [opacity, setOpacity] = useState(0);
  const [bannerScale, setBannerScale] = useState(0.85);

  useEffect(() => {
    if (!active) return;
    setVisible(true);
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = now - start;
      if (t < 180) {
        setOpacity((t / 180) * 0.85);
        setBannerScale(0.85 + (t / 180) * 0.2);
      } else if (t < 1400) {
        setOpacity(0.85 * (1 - (t - 180) / 1220));
        setBannerScale(1.05 - Math.min(0.1, (t - 180) / 2000));
      } else {
        setOpacity(0);
        setVisible(false);
        onComplete?.();
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, onComplete]);

  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center overflow-hidden"
      aria-hidden
    >
      <div
        className="absolute inset-0"
        style={{
          opacity,
          background:
            'radial-gradient(ellipse 90% 70% at 50% 45%, rgba(255,230,140,0.95) 0%, rgba(255,180,50,0.55) 28%, rgba(120,70,10,0.25) 55%, transparent 78%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          opacity: opacity * 0.6,
          background:
            'linear-gradient(180deg, transparent 0%, rgba(255,215,100,0.15) 40%, rgba(255,215,100,0.08) 100%)',
        }}
      />
      {eraLabel && (
        <div
          className="relative z-10 text-center px-6"
          style={{
            opacity: Math.min(1, opacity * 1.4),
            transform: `scale(${bannerScale})`,
            transition: 'transform 80ms ease-out',
          }}
        >
          <p className="text-[11px] uppercase tracking-[0.35em] text-amber-200/90 mb-2 font-medium">
            Civilization Ascends
          </p>
          <p
            className="font-display text-3xl sm:text-4xl text-amber-50 drop-shadow-[0_2px_24px_rgba(255,200,80,0.9)]"
            style={{ textShadow: '0 0 40px rgba(255,215,100,0.8), 0 2px 8px rgba(0,0,0,0.9)' }}
          >
            {eraLabel} Era
          </p>
        </div>
      )}
    </div>
  );
}
