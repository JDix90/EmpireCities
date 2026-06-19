import { useEffect, useState } from 'react';

/**
 * Real in-game capture of the 3D globe (Modern Day era), shown on the landing page
 * instead of a "why you should play" pitch — the page shows the game rather than
 * arguing for it. Muted autoplay loop with a poster still for instant first paint.
 * Respects prefers-reduced-motion: those users get the still image and the video is
 * never rendered or downloaded.
 */
export default function GameplayShowcase() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <figure
      className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-bf-border shadow-2xl shadow-black/50"
      // Reserve the aspect ratio up front so the poster/video swap causes no layout shift.
      style={{ aspectRatio: '1280 / 874' }}
    >
      {reduceMotion ? (
        <img
          src="/gameplay-globe-poster.jpg"
          alt="A Borderfall match on the Modern Day globe — territories colored by faction, with regional reinforcement counts."
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <video
          className="h-full w-full object-cover"
          poster="/gameplay-globe-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-label="A Borderfall match on the Modern Day globe — faction-colored territories on a slowly rotating world."
        >
          <source src="/gameplay-globe.mp4" type="video/mp4" />
        </video>
      )}
    </figure>
  );
}
