import React, { useEffect, useState } from 'react';
import { eraMeta } from '../../constants/eraMeta';

interface EraAdvanceVignetteProps {
  active: boolean;
  /** Era id being entered — drives the label, tint color, and flavor line. */
  eraId?: string;
  onComplete?: () => void;
}

/** Convert a #rrggbb hex to an `r,g,b` triple string for rgba() interpolation. */
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '255,215,100';
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

/**
 * Full-viewport flash when a player ascends to a new era. Tinted by the
 * arriving era's theme color and captioned with its name + flavor line.
 * Sits above the map shell; pointer-events none.
 */
export default function EraAdvanceVignette({ active, eraId, onComplete }: EraAdvanceVignetteProps) {
  const [visible, setVisible] = useState(false);
  const [opacity, setOpacity] = useState(0);
  const [bannerScale, setBannerScale] = useState(0.85);

  const meta = eraMeta(eraId);
  const rgb = hexToRgb(meta.color);

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
      data-testid="era-advance-vignette"
    >
      <div
        className="absolute inset-0"
        style={{
          opacity,
          // Era-tinted core flash blended toward warm gold at the edges.
          background:
            `radial-gradient(ellipse 90% 70% at 50% 45%, rgba(${rgb},0.92) 0%, rgba(255,200,90,0.5) 30%, rgba(120,70,10,0.25) 56%, transparent 78%)`,
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
          {meta.short} Era
        </p>
        <p className="mt-2 text-sm text-amber-100/85 max-w-sm mx-auto" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.9)' }}>
          {meta.flavor}
        </p>
      </div>
    </div>
  );
}
