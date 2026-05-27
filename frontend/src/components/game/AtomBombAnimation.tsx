import React, { useEffect, useMemo } from 'react';

export type StrikeAnimationVariant =
  | 'atom_bomb'
  | 'nuclear_strike'
  | 'orbital_strike'
  | 'hypersonic_strike'
  | 'swarm_strike'
  | 'dyson_beam';

interface Props {
  abilityId: StrikeAnimationVariant;
  targetName: string;
  unitReduction?: number;
  onDone: () => void;
}

const IMPACT_TOP = '58%';

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
@keyframes ns-missile {
  0%   { transform: translate(-120px, -220px) rotate(35deg); opacity: 0; }
  15%  { opacity: 1; }
  55%  { transform: translate(0, 0) rotate(0deg); opacity: 1; }
  100% { transform: translate(0, 0) rotate(0deg); opacity: 0; }
}
@keyframes os-beam {
  0%   { height: 0; opacity: 0; }
  20%  { opacity: 1; }
  65%  { height: 42vh; opacity: 1; }
  100% { height: 42vh; opacity: 0.35; }
}
@keyframes os-satellite {
  0%   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  30%  { opacity: 1; transform: translateX(-50%) translateY(0); }
  100% { opacity: 1; }
}
@keyframes hs-streak {
  0%   { transform: translate(-52vw, -42vh) rotate(32deg) scaleX(0.15); opacity: 0; }
  6%   { opacity: 1; }
  28%  { transform: translate(0, 0) rotate(32deg) scaleX(1); opacity: 1; }
  35%  { opacity: 0; }
  100% { opacity: 0; }
}
@keyframes hs-sonic {
  0%   { transform: scale(0); opacity: 0.85; }
  100% { transform: scale(10); opacity: 0; }
}
@keyframes hs-kinetic {
  0%   { transform: translate(-50%, -50%) scale(0.2); opacity: 0; }
  20%  { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
  55%  { opacity: 0.85; transform: translate(-50%, -50%) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
}
@keyframes sw-streak {
  0%   { transform: translate(-38vw, -28vh) rotate(28deg) scaleX(0.1); opacity: 0; }
  8%   { opacity: 1; }
  32%  { transform: translate(0, 0) rotate(28deg) scaleX(1); opacity: 0.95; }
  38%  { opacity: 0; }
  100% { opacity: 0; }
}
@keyframes db-beam {
  0%   { height: 0; opacity: 0; width: 8vw; }
  18%  { opacity: 1; width: 14vw; }
  55%  { height: 48vh; opacity: 1; width: 16vw; }
  100% { height: 48vh; opacity: 0.25; width: 14vw; }
}
@keyframes db-corona {
  0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
  25%  { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
  70%  { opacity: 0.9; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1); }
}
`;

const VARIANT_CONFIG: Record<StrikeAnimationVariant, {
  durationMs: number;
  emoji: string;
  title: string;
  titleColor: string;
  subtitleColor: string;
  subtitle: (targetName: string, unitReduction?: number) => string;
  showMushroomCloud: boolean;
  flashColor: string;
  bgGradient: string;
  flashDuration: string;
}> = {
  atom_bomb: {
    durationMs: 5200,
    emoji: '☢️',
    title: 'ATOM BOMB',
    titleColor: '#ff4444',
    subtitleColor: '#fca5a5',
    subtitle: (targetName) => `${targetName} has been obliterated`,
    showMushroomCloud: true,
    flashColor: 'radial-gradient(circle at 50% 62%, #fff8e0 0%, #ffb347 30%, #ff6a00 55%, transparent 75%)',
    bgGradient: 'radial-gradient(ellipse at 50% 60%, rgba(80,10,0,0.92) 0%, rgba(10,0,0,0.88) 100%)',
    flashDuration: '2s',
  },
  nuclear_strike: {
    durationMs: 4000,
    emoji: '☢️',
    title: 'NUCLEAR STRIKE',
    titleColor: '#ff4444',
    subtitleColor: '#fca5a5',
    subtitle: (targetName, unitReduction = 2) =>
      `${targetName} hit — ${unitReduction} unit${unitReduction === 1 ? '' : 's'} lost`,
    showMushroomCloud: false,
    flashColor: 'radial-gradient(circle at 50% 58%, #fffde7 0%, #ffd54f 25%, #ff7043 50%, transparent 72%)',
    bgGradient: 'radial-gradient(ellipse at 50% 55%, rgba(60,20,0,0.88) 0%, rgba(8,0,0,0.85) 100%)',
    flashDuration: '1.4s',
  },
  orbital_strike: {
    durationMs: 3600,
    emoji: '🛰️',
    title: 'ORBITAL STRIKE',
    titleColor: '#67e8f9',
    subtitleColor: '#a5f3fc',
    subtitle: (targetName, unitReduction = 3) =>
      `${targetName} targeted from orbit — ${unitReduction} unit${unitReduction === 1 ? '' : 's'} lost`,
    showMushroomCloud: false,
    flashColor: 'radial-gradient(circle at 50% 58%, rgba(224,247,250,0.95) 0%, rgba(103,232,249,0.55) 30%, rgba(8,145,178,0.35) 55%, transparent 75%)',
    bgGradient: 'radial-gradient(ellipse at 50% 25%, rgba(15,40,80,0.92) 0%, rgba(4,8,22,0.94) 100%)',
    flashDuration: '1.2s',
  },
  hypersonic_strike: {
    durationMs: 3200,
    emoji: '🚀',
    title: 'HYPERSONIC STRIKE',
    titleColor: '#fb923c',
    subtitleColor: '#fdba74',
    subtitle: (targetName, unitReduction = 2) =>
      `${targetName} hit at Mach 10+ — ${unitReduction} unit${unitReduction === 1 ? '' : 's'} lost`,
    showMushroomCloud: false,
    flashColor: 'radial-gradient(circle at 50% 58%, #fff 0%, #fed7aa 25%, #fb923c 45%, transparent 70%)',
    bgGradient: 'radial-gradient(ellipse at 50% 55%, rgba(50,25,10,0.88) 0%, rgba(10,8,14,0.92) 100%)',
    flashDuration: '0.9s',
  },
  swarm_strike: {
    durationMs: 3800,
    emoji: '🐝',
    title: 'SWARM STRIKE',
    titleColor: '#fb923c',
    subtitleColor: '#fdba74',
    subtitle: (targetName, unitReduction = 2) =>
      `Autonomous drones swarm ${targetName} — ${unitReduction} unit${unitReduction === 1 ? '' : 's'} lost`,
    showMushroomCloud: false,
    flashColor: 'radial-gradient(circle at 50% 58%, #fff 0%, #fed7aa 30%, #ea580c 50%, transparent 72%)',
    bgGradient: 'radial-gradient(ellipse at 50% 55%, rgba(45,20,5,0.9) 0%, rgba(12,8,8,0.92) 100%)',
    flashDuration: '1s',
  },
  dyson_beam: {
    durationMs: 5500,
    emoji: '☀️',
    title: 'DYSON BEAM',
    titleColor: '#fef08a',
    subtitleColor: '#fde68a',
    subtitle: (targetName, unitReduction = 4) =>
      `Stellar beam scorches ${targetName} — ${unitReduction} unit${unitReduction === 1 ? '' : 's'} lost`,
    showMushroomCloud: false,
    flashColor: 'radial-gradient(circle at 50% 42%, #fffef0 0%, #fef08a 25%, #facc15 45%, transparent 75%)',
    bgGradient: 'radial-gradient(ellipse at 50% 30%, rgba(60,45,0,0.92) 0%, rgba(8,6,2,0.94) 100%)',
    flashDuration: '1.8s',
  },
};

const ORBITAL_BEAM_OFFSETS = [-52, 0, 52];

const SWARM_STREAK_ANGLES = [-18, -8, 2, 12, 22, 32];

function StrikeAbilityAnimation({ abilityId, targetName, unitReduction, onDone }: Props) {
  const config = VARIANT_CONFIG[abilityId];
  const durationSec = `${config.durationMs / 1000}s`;
  const isModernStrike = abilityId === 'orbital_strike' || abilityId === 'hypersonic_strike';
  const impactShockFast = abilityId === 'nuclear_strike' || isModernStrike || abilityId === 'swarm_strike';

  useEffect(() => {
    const t = setTimeout(onDone, config.durationMs);
    return () => clearTimeout(t);
  }, [onDone, config.durationMs]);

  const subtitle = useMemo(
    () => config.subtitle(targetName, unitReduction),
    [config, targetName, unitReduction],
  );

  return (
    <div data-testid="atom-bomb-overlay">
      <style>{STYLES}</style>

      <div style={{
        position: 'fixed', inset: 0, zIndex: 9990,
        background: config.bgGradient,
        animation: `aba-bg ${durationSec} ease-out forwards`,
        pointerEvents: 'all',
      }} />

      <div style={{
        position: 'fixed', inset: 0, zIndex: 9991,
        background: config.flashColor,
        animation: `aba-flash ${config.flashDuration} ease-out forwards`,
        pointerEvents: 'none',
      }} />

      {abilityId === 'nuclear_strike' && (
        <div style={{
          position: 'fixed', left: '50%', top: IMPACT_TOP, zIndex: 9992,
          width: 8, height: 80, marginLeft: -4, marginTop: -40,
          background: 'linear-gradient(to bottom, transparent, #fff 40%, #ff9800 70%, #e65100)',
          boxShadow: '0 0 20px 8px rgba(255,152,0,0.6)',
          animation: 'ns-missile 1.2s ease-in forwards',
          pointerEvents: 'none',
        }} />
      )}

      {abilityId === 'orbital_strike' && (
        <>
          <div style={{
            position: 'fixed', top: '5%', left: '50%', zIndex: 9992,
            fontSize: 32, lineHeight: 1,
            animation: 'os-satellite 0.6s ease-out forwards',
            opacity: 0,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 0 8px rgba(103,232,249,0.8))',
          }}>🛰️</div>
          {ORBITAL_BEAM_OFFSETS.map((offset, i) => (
            <div
              key={offset}
              style={{
                position: 'fixed',
                left: `calc(50% + ${offset}px)`,
                top: '11%',
                width: 3,
                height: 0,
                transform: 'translateX(-50%)',
                background: 'linear-gradient(to bottom, rgba(103,232,249,0) 0%, #e0f7fa 30%, #fff 50%, #67e8f9 72%, #0891b2 100%)',
                boxShadow: '0 0 14px 5px rgba(103,232,249,0.75)',
                animation: `os-beam 0.85s ease-out ${i * 0.12}s forwards`,
                zIndex: 9992,
                pointerEvents: 'none',
              }}
            />
          ))}
        </>
      )}

      {abilityId === 'hypersonic_strike' && (
        <>
          <div style={{
            position: 'fixed', left: '50%', top: IMPACT_TOP, zIndex: 9992,
            width: 140, height: 5, marginLeft: -70, marginTop: -2,
            background: 'linear-gradient(90deg, transparent 0%, #fff 25%, #fed7aa 55%, #ea580c 85%, transparent 100%)',
            boxShadow: '0 0 18px 6px rgba(251,146,60,0.7)',
            transformOrigin: 'center center',
            animation: 'hs-streak 0.45s cubic-bezier(0.2,0.9,0.3,1) forwards',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'fixed', left: '50%', top: IMPACT_TOP, zIndex: 9992,
            width: 48, height: 48, marginLeft: -24, marginTop: -24,
            borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.85)',
            animation: 'hs-sonic 0.75s cubic-bezier(0.1,0.7,0.3,1) 0.32s forwards',
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'fixed', left: '50%', top: IMPACT_TOP, zIndex: 9992,
            width: 48, height: 48, marginLeft: -24, marginTop: -24,
            borderRadius: '50%',
            border: '2px solid rgba(251,146,60,0.65)',
            animation: 'hs-sonic 1s cubic-bezier(0.1,0.7,0.3,1) 0.42s forwards',
            pointerEvents: 'none',
          }} />
        </>
      )}

      {abilityId === 'swarm_strike' && SWARM_STREAK_ANGLES.map((angle, i) => (
        <div
          key={angle}
          style={{
            position: 'fixed', left: '50%', top: IMPACT_TOP, zIndex: 9992,
            width: 90, height: 3, marginLeft: -45, marginTop: -1,
            background: 'linear-gradient(90deg, transparent 0%, #fff 30%, #fb923c 70%, transparent 100%)',
            boxShadow: '0 0 10px 3px rgba(251,146,60,0.55)',
            transformOrigin: 'center center',
            transform: `rotate(${angle}deg)`,
            animation: `sw-streak 0.55s cubic-bezier(0.2,0.9,0.3,1) ${i * 0.06}s forwards`,
            pointerEvents: 'none',
          }}
        />
      ))}

      {abilityId === 'dyson_beam' && (
        <>
          <div style={{
            position: 'fixed', top: '4%', left: '50%', zIndex: 9992,
            fontSize: 36, lineHeight: 1,
            transform: 'translateX(-50%)',
            animation: 'os-satellite 0.8s ease-out forwards',
            opacity: 0,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 0 12px rgba(254,240,138,0.9))',
          }}>☀️</div>
          <div style={{
            position: 'fixed',
            left: '50%',
            top: '10%',
            height: 0,
            transform: 'translateX(-50%)',
            background: 'linear-gradient(to bottom, rgba(254,240,138,0) 0%, #fffef0 25%, #fef08a 50%, #facc15 75%, #ca8a04 100%)',
            boxShadow: '0 0 24px 10px rgba(250,204,21,0.65)',
            animation: 'db-beam 1.4s ease-out 0.2s forwards',
            zIndex: 9992,
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'fixed', left: '50%', top: IMPACT_TOP, zIndex: 9992,
            width: 120, height: 120, marginLeft: -60, marginTop: -60,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,220,0.95) 0%, rgba(250,204,21,0.55) 45%, transparent 70%)',
            animation: 'db-corona 2.2s ease-out 0.9s forwards',
            pointerEvents: 'none',
          }} />
        </>
      )}

      <div style={{
        position: 'fixed', left: '50%', top: abilityId === 'atom_bomb' ? '62%' : IMPACT_TOP, zIndex: 9992,
        width: 40, height: 40, marginLeft: -20, marginTop: -20,
        borderRadius: '50%',
        border: `3px solid ${abilityId === 'orbital_strike' ? 'rgba(103,232,249,0.9)' : abilityId === 'dyson_beam' ? 'rgba(254,240,138,0.9)' : 'rgba(255, 200, 80, 0.9)'}`,
        animation: `aba-shockwave ${impactShockFast ? '1.5s' : '2.2s'} cubic-bezier(0.1,0.6,0.4,1) forwards`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'fixed', left: '50%', top: abilityId === 'atom_bomb' ? '62%' : IMPACT_TOP, zIndex: 9992,
        width: 40, height: 40, marginLeft: -20, marginTop: -20,
        borderRadius: '50%',
        border: `2px solid ${abilityId === 'orbital_strike' ? 'rgba(8,145,178,0.7)' : 'rgba(255, 120, 30, 0.7)'}`,
        animation: `aba-shock2 ${impactShockFast ? '1.8s' : '3s'} cubic-bezier(0.1,0.6,0.4,1) 0.3s forwards`,
        pointerEvents: 'none',
      }} />

      {config.showMushroomCloud && (
        <div style={{
          position: 'fixed', left: '50%', bottom: '14%', zIndex: 9993,
          transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            width: 220, height: 130,
            borderRadius: '50% 50% 35% 35% / 60% 60% 40% 40%',
            background: 'radial-gradient(ellipse at 50% 70%, #ff8c00 0%, #c0392b 40%, #7b241c 65%, #2c0e0e 100%)',
            boxShadow: '0 0 40px 10px rgba(255,80,0,0.5), inset 0 -20px 40px rgba(0,0,0,0.5)',
            filter: 'blur(3px)',
            animation: 'aba-cap 2.8s cubic-bezier(0.1,0.8,0.3,1) 0.6s forwards',
            opacity: 0,
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', inset: '15% 20% 25%',
              borderRadius: '50%',
              background: 'radial-gradient(ellipse at center, rgba(255,255,100,0.7) 0%, rgba(255,140,0,0.4) 50%, transparent 80%)',
              animation: 'aba-cap-inner 2.8s 0.6s forwards',
              opacity: 0,
            }} />
          </div>
          <div style={{
            width: 48, height: 0,
            background: 'linear-gradient(to top, #ff6a00, #c0392b, #7b241c, #3d0f0f)',
            filter: 'blur(2px)',
            boxShadow: '0 0 16px 6px rgba(255,80,0,0.4)',
            animation: 'aba-stem 2.5s cubic-bezier(0.25,0.8,0.3,1) 0.5s forwards',
          }} />
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
      )}

      {abilityId === 'nuclear_strike' && (
        <div style={{
          position: 'fixed', left: '50%', top: IMPACT_TOP, zIndex: 9993,
          transform: 'translate(-50%, -50%)',
          width: 120, height: 120,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #fffde7 0%, #ffab40 35%, #e65100 65%, transparent 85%)',
          boxShadow: '0 0 50px 20px rgba(255,112,0,0.55)',
          animation: 'aba-fireball 1.5s ease-out 0.9s forwards',
          pointerEvents: 'none',
        }} />
      )}

      {abilityId === 'orbital_strike' && (
        <div style={{
          position: 'fixed', left: '50%', top: IMPACT_TOP, zIndex: 9993,
          transform: 'translate(-50%, -50%)',
          width: 100, height: 100,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #fff 0%, #67e8f9 35%, #0891b2 60%, transparent 85%)',
          boxShadow: '0 0 45px 18px rgba(103,232,249,0.55)',
          animation: 'aba-fireball 1.3s ease-out 0.75s forwards',
          pointerEvents: 'none',
        }} />
      )}

      {abilityId === 'hypersonic_strike' && (
        <div style={{
          position: 'fixed', left: '50%', top: IMPACT_TOP, zIndex: 9993,
          width: 90, height: 90,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #fff 0%, #fed7aa 30%, #ea580c 55%, transparent 80%)',
          boxShadow: '0 0 40px 16px rgba(251,146,60,0.5)',
          animation: 'hs-kinetic 1.1s ease-out 0.38s forwards',
          opacity: 0,
          pointerEvents: 'none',
        }} />
      )}

      <div style={{
        position: 'fixed', left: '50%', top: '22%', zIndex: 9994,
        transform: 'translateX(-50%)',
        textAlign: 'center',
        animation: `aba-text ${durationSec} ease-out 0.4s forwards`,
        opacity: 0,
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        <div style={{ fontSize: 52, lineHeight: 1 }}>{config.emoji}</div>
        <div style={{
          fontSize: isModernStrike ? 26 : abilityId === 'nuclear_strike' ? 28 : 32,
          fontWeight: 900,
          letterSpacing: '0.12em',
          color: config.titleColor,
          textShadow: `0 0 30px ${config.titleColor}, 0 2px 4px #000`,
          fontFamily: 'monospace',
          marginTop: 6,
        }}>
          {config.title}
        </div>
        <div style={{
          fontSize: 16, color: config.subtitleColor, marginTop: 10,
          textShadow: '0 0 10px rgba(0,0,0,0.5)',
          fontFamily: 'monospace',
          letterSpacing: '0.06em',
        }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

export default React.memo(StrikeAbilityAnimation);
