import React, { useEffect } from 'react';

interface Props {
  targetName: string;
  onDone: () => void;
}

const STYLES = `
@keyframes aba-flash {
  0%   { opacity: 0; transform: scale(0.5); }
  10%  { opacity: 1; transform: scale(1); }
  40%  { opacity: 0.6; }
  100% { opacity: 0; }
}
@keyframes aba-shockwave {
  0%   { transform: scale(0); opacity: 0.9; }
  100% { transform: scale(8); opacity: 0; }
}
@keyframes aba-shock2 {
  0%   { transform: scale(0); opacity: 0.6; }
  100% { transform: scale(5); opacity: 0; }
}
@keyframes aba-fireball {
  0%   { transform: scale(0);   opacity: 0; }
  25%  { transform: scale(1.4); opacity: 1; }
  70%  { transform: scale(1.1); opacity: 0.9; }
  100% { transform: scale(0.9); opacity: 0.4; }
}
@keyframes aba-stem {
  0%   { height: 0px; opacity: 0; }
  15%  { opacity: 1; }
  100% { height: 180px; opacity: 1; }
}
@keyframes aba-cap {
  0%   { transform: translateY(60px) scaleX(0.1) scaleY(0.2); opacity: 0; }
  25%  { opacity: 1; }
  100% { transform: translateY(0px) scaleX(1) scaleY(1); opacity: 1; }
}
@keyframes aba-cap-inner {
  0%   { opacity: 0; }
  30%  { opacity: 1; }
  100% { opacity: 1; }
}
@keyframes aba-text {
  0%   { opacity: 0; transform: scale(1.3) translateY(-10px); }
  20%  { opacity: 1; transform: scale(1) translateY(0); }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes aba-bg {
  0%   { opacity: 0; }
  8%   { opacity: 0.85; }
  50%  { opacity: 0.7; }
  100% { opacity: 0; }
}
@keyframes aba-ring-pulse {
  0%, 100% { opacity: 0.6; }
  50%       { opacity: 1; }
}
`;

export default function AtomBombAnimation({ targetName, onDone }: Props) {
  useEffect(() => {
    const t = setTimeout(onDone, 5200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <>
      <style>{STYLES}</style>

      {/* Dark radial background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9990,
        background: 'radial-gradient(ellipse at 50% 60%, rgba(80,10,0,0.92) 0%, rgba(10,0,0,0.88) 100%)',
        animation: 'aba-bg 5.2s ease-out forwards',
        pointerEvents: 'all',
      }} />

      {/* Flash burst */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9991,
        background: 'radial-gradient(circle at 50% 62%, #fff8e0 0%, #ffb347 30%, #ff6a00 55%, transparent 75%)',
        animation: 'aba-flash 2s ease-out forwards',
        pointerEvents: 'none',
      }} />

      {/* Shockwave rings */}
      <div style={{
        position: 'fixed', left: '50%', top: '62%', zIndex: 9992,
        width: 40, height: 40, marginLeft: -20, marginTop: -20,
        borderRadius: '50%',
        border: '3px solid rgba(255, 200, 80, 0.9)',
        animation: 'aba-shockwave 2.2s cubic-bezier(0.1,0.6,0.4,1) forwards',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', left: '50%', top: '62%', zIndex: 9992,
        width: 40, height: 40, marginLeft: -20, marginTop: -20,
        borderRadius: '50%',
        border: '2px solid rgba(255, 120, 30, 0.7)',
        animation: 'aba-shock2 3s cubic-bezier(0.1,0.6,0.4,1) 0.3s forwards',
        pointerEvents: 'none',
      }} />

      {/* Mushroom cloud assembly */}
      <div style={{
        position: 'fixed', left: '50%', bottom: '14%', zIndex: 9993,
        transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        pointerEvents: 'none',
      }}>
        {/* Cloud cap */}
        <div style={{
          width: 220, height: 130,
          borderRadius: '50% 50% 35% 35% / 60% 60% 40% 40%',
          background: 'radial-gradient(ellipse at 50% 70%, #ff8c00 0%, #c0392b 40%, #7b241c 65%, #2c0e0e 100%)',
          boxShadow: '0 0 40px 10px rgba(255,80,0,0.5), inset 0 -20px 40px rgba(0,0,0,0.5)',
          filter: 'blur(3px)',
          animation: 'aba-cap 2.8s cubic-bezier(0.1,0.8,0.3,1) 0.6s forwards',
          opacity: 0,
        }}>
          {/* Inner glow */}
          <div style={{
            position: 'absolute', inset: '15% 20% 25%',
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at center, rgba(255,255,100,0.7) 0%, rgba(255,140,0,0.4) 50%, transparent 80%)',
            animation: 'aba-cap-inner 2.8s 0.6s forwards',
            opacity: 0,
          }} />
        </div>

        {/* Stem */}
        <div style={{
          width: 48, height: 0,
          background: 'linear-gradient(to top, #ff6a00, #c0392b, #7b241c, #3d0f0f)',
          filter: 'blur(2px)',
          boxShadow: '0 0 16px 6px rgba(255,80,0,0.4)',
          animation: 'aba-stem 2.5s cubic-bezier(0.25,0.8,0.3,1) 0.5s forwards',
        }} />

        {/* Fireball at base */}
        <div style={{
          width: 90, height: 90,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 50% 50%, #ffff88 0%, #ff9900 30%, #ff3300 60%, #800000 85%, transparent 100%)',
          boxShadow: '0 0 30px 15px rgba(255,120,0,0.6)',
          transform: 'scale(0)',
          animation: 'aba-fireball 2.4s ease-out 0.4s forwards',
          marginTop: -20,
        }} />
      </div>

      {/* Text */}
      <div style={{
        position: 'fixed', left: '50%', top: '22%', zIndex: 9994,
        transform: 'translateX(-50%)',
        textAlign: 'center',
        animation: 'aba-text 5.2s ease-out 0.4s forwards',
        opacity: 0,
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        <div style={{ fontSize: 52, lineHeight: 1 }}>☢️</div>
        <div style={{
          fontSize: 32, fontWeight: 900, letterSpacing: '0.12em',
          color: '#ff4444',
          textShadow: '0 0 30px #ff0000, 0 0 60px #ff6600, 0 2px 4px #000',
          fontFamily: 'monospace',
          marginTop: 6,
        }}>
          ATOM BOMB
        </div>
        <div style={{
          fontSize: 16, color: '#fca5a5', marginTop: 10,
          textShadow: '0 0 10px rgba(255,0,0,0.5)',
          fontFamily: 'monospace',
          letterSpacing: '0.06em',
        }}>
          {targetName} has been obliterated
        </div>
      </div>
    </>
  );
}
