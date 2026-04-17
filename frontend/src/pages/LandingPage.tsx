import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { Globe, Sword, Map, Users, X } from 'lucide-react';

type EraScope = 'global' | 'regional';

interface EraDefinition {
  id: string;
  mapId: string;
  label: string;
  years: string;
  color: string;
  scope: EraScope;
  territoryCount: number;
  summary: string;
  suggestedPlayers: string;
}

const ERAS: EraDefinition[] = [
  {
    id: 'ancient',
    mapId: 'era_ancient',
    label: 'Ancient World',
    years: '3000 BC – 400 AD',
    color: '#c9a84c',
    scope: 'global',
    territoryCount: 28,
    summary:
      'Step into the late classical world when Rome, Parthia, and Han China were powers of the first magnitude. '
      + 'Campaign across empires, deserts, and steppe as you fight for control of the Mediterranean, Persia, and East Asia. '
      + 'This map emphasizes legions, cavalry, and long supply lines across a connected ancient world.',
    suggestedPlayers: '2–6 players',
  },
  {
    id: 'medieval',
    mapId: 'era_medieval',
    label: 'Medieval Era',
    years: '400 – 1400 AD',
    color: '#8b6914',
    scope: 'global',
    territoryCount: 29,
    summary:
      'From the Crusades to the Mongol conquests, the medieval map spans kingdoms, caliphates, and nomadic empires. '
      + 'Hold mountain passes, river crossings, and trade hubs as you expand your realm. '
      + 'Ideal for games that emphasize diplomacy, siege lines, and shifting alliances.',
    suggestedPlayers: '2–6 players',
  },
  {
    id: 'discovery',
    mapId: 'era_discovery',
    label: 'Age of Discovery',
    years: '1400 – 1800 AD',
    color: '#2e7d9e',
    scope: 'global',
    territoryCount: 34,
    summary:
      'The age of sail, gunpowder empires, and colonial expansion. Compete for control of oceans, chokepoints, and '
      + 'new-world trade routes. This era rewards naval positioning and competition for overseas resources.',
    suggestedPlayers: '2–6 players',
  },
  {
    id: 'ww2',
    mapId: 'era_ww2',
    label: 'World War II',
    years: '1939 – 1945',
    color: '#5a5a5a',
    scope: 'global',
    territoryCount: 35,
    summary:
      'A global struggle of industrial powers: land, sea, and air theaters from Europe to the Pacific. '
      + 'The map reflects major alliances and front lines of the Second World War. '
      + 'Expect fast, high-stakes turns where multiple theaters can flare at once.',
    suggestedPlayers: '2–6 players',
  },
  {
    id: 'coldwar',
    mapId: 'era_coldwar',
    label: 'Cold War',
    years: '1945 – 1991',
    color: '#1a3a5c',
    scope: 'global',
    territoryCount: 44,
    summary:
      'NATO, the Warsaw Pact, and the non-aligned world in a decades-long contest of influence and proxy struggles. '
      + 'Control strategic regions, sea lanes, and nuclear-age flashpoints. '
      + 'Suited to longer games with layered diplomacy and global pressure.',
    suggestedPlayers: '2–6 players',
  },
  {
    id: 'modern',
    mapId: 'era_modern',
    label: 'The Modern Day',
    years: '2026',
    color: '#2ecc71',
    scope: 'global',
    territoryCount: 43,
    summary:
      'Contemporary superpowers, regional alliances, and economic blocs on a map tuned for the 21st century. '
      + 'Fight for tech hubs, energy corridors, and maritime chokepoints. '
      + 'Best for players who enjoy a modern geopolitical sandbox with many viable strategies.',
    suggestedPlayers: '2–6 players',
  },
  {
    id: 'acw',
    mapId: 'era_acw',
    label: 'American Civil War',
    years: '1861 – 1865',
    color: '#6b5344',
    scope: 'regional',
    territoryCount: 18,
    summary:
      'A focused North American theater: Union versus Confederacy across the Eastern seaboard, the Mississippi, '
      + 'and the Trans-Mississippi West. Territories follow real state boundaries for a tighter, more tactical map. '
      + 'Ideal when you want a shorter, regional campaign with clear front lines.',
    suggestedPlayers: '2–4 players',
  },
  {
    id: 'risorgimento',
    mapId: 'era_risorgimento',
    label: 'Italian Unification',
    years: '1859 – 1871',
    color: '#008C45',
    scope: 'regional',
    territoryCount: 14,
    summary:
      'Risorgimento Italy: from Piedmont and the Two Sicilies to a united kingdom. '
      + 'Territories follow real provincial outlines merged into regional theaters across the peninsula and islands. '
      + 'Tighter and faster than a world map—ideal for diplomacy and coastal maneuver.',
    suggestedPlayers: '2–4 players',
  },
];

const GLOBAL_ERAS = ERAS.filter((e) => e.scope === 'global');
const REGIONAL_ERAS = ERAS.filter((e) => e.scope === 'regional');

const FEATURES = [
  { icon: Globe,  title: 'Dynamic Historical Maps',  desc: 'Play across multiple meticulously crafted historical eras, each with accurate borders and era-specific mechanics.' },
  { icon: Sword,  title: 'Deep Strategy',            desc: 'Master the classic Draft-Attack-Fortify loop with diplomacy, card sets, and continent bonuses.' },
  { icon: Map,    title: 'Custom Map Editor',        desc: 'Build and publish your own maps. Share them with the community and watch your creations come to life.' },
  { icon: Users,  title: 'Multiplayer & AI',         desc: 'Challenge friends in real-time or asynchronous games, or hone your skills against AI bots of varying difficulty.' },
];

function EraDetailModal({
  era,
  onClose,
  playHref,
}: {
  era: EraDefinition;
  onClose: () => void;
  playHref: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto px-3 py-4 pt-safe pb-safe sm:px-4 sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="era-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div
          className="relative w-full max-w-lg rounded-xl border border-cc-border bg-[#0f1419] shadow-2xl shadow-black/50 p-4 sm:p-6 md:p-8 max-h-[min(92vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] overflow-y-auto overscroll-contain"
          style={{ boxShadow: `0 0 0 1px ${era.color}33, 0 25px 50px -12px rgba(0,0,0,0.5)` }}
        >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded text-cc-muted hover:text-cc-gold hover:bg-white/5 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div
          className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl"
          style={{ backgroundColor: era.color + '33', border: `2px solid ${era.color}` }}
        >
          🗺️
        </div>

        <h4 id="era-modal-title" className="font-display text-2xl text-cc-gold text-center mb-1">
          {era.label}
        </h4>
        <p className="text-center text-cc-muted text-sm mb-6">{era.years}</p>

        <div className="space-y-4 text-cc-muted text-sm leading-relaxed">
          <p>{era.summary}</p>
          <div className="flex flex-wrap gap-4 pt-2 border-t border-cc-border text-xs">
            <span>
              <span className="text-cc-gold/90 font-medium">Suggested players:</span>{' '}
              {era.suggestedPlayers}
            </span>
            <span>
              <span className="text-cc-gold/90 font-medium">Territories:</span>{' '}
              {era.territoryCount}
            </span>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button type="button" onClick={onClose} className="btn-secondary order-2 sm:order-1">
            Close
          </button>
          <Link to={playHref} className="btn-primary text-center order-1 sm:order-2">
            Play this Map
          </Link>
        </div>
        </div>
      </div>
    </div>
  );
}

function EraCardButton({ era, onOpen }: { era: EraDefinition; onOpen: (e: EraDefinition) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(era)}
      className="card text-center hover:border-cc-gold transition-colors cursor-pointer group w-full"
    >
      <div
        className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl"
        style={{ backgroundColor: era.color + '33', border: `2px solid ${era.color}` }}
      >
        🗺️
      </div>
      <p className="font-display text-sm text-cc-gold group-hover:text-white transition-colors">{era.label}</p>
      <p className="text-xs text-cc-muted mt-1">{era.years}</p>
    </button>
  );
}

export default function LandingPage() {
  const [modalEra, setModalEra] = useState<EraDefinition | null>(null);
  const navigate = useNavigate();
  const loginAsGuest = useAuthStore((s) => s.loginAsGuest);

  useEffect(() => {
    if (modalEra) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [modalEra]);

  return (
    <div className="min-h-screen bg-cc-dark">
      {/* Navigation */}
      <nav className="border-b border-cc-border px-6 py-4 flex items-center justify-between pt-safe px-safe">
        <Link to="/" className="font-display text-2xl text-cc-gold tracking-widest hover:text-white transition-colors">ERAS OF EMPIRE</Link>
        <div className="flex gap-2 flex-wrap justify-end">
          <Link to="/tutorial" className="btn-secondary text-sm hidden sm:inline-flex">
            Learn to play
          </Link>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={async () => {
              try {
                await loginAsGuest();
                navigate('/lobby?quickstart=true');
              } catch {
                toast.error('Could not start guest session');
              }
            }}
          >
            Play as Guest
          </button>
          <Link to="/login" className="btn-secondary text-sm">Sign In</Link>
          <Link to="/register" className="btn-primary text-sm">Play Free</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="text-center py-24 px-6">
        <h2 className="font-display text-5xl md:text-7xl text-cc-gold mb-6 leading-tight">
          Conquer History
        </h2>
        <p className="text-cc-muted text-xl max-w-2xl mx-auto mb-10">
          A browser-based grand strategy game spanning the ancient world to the modern day.
          Command armies, forge alliances, and rewrite history — one territory at a time.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link to="/register" className="btn-primary text-lg px-10 py-3">Play Free Now</Link>
          <Link to="/tutorial" className="btn-secondary text-lg px-10 py-3">
            Learn to play
          </Link>
          <Link to="/login" className="btn-secondary text-lg px-10 py-3">Sign In</Link>
        </div>
      </section>

      {/* Era Showcase */}
      <section className="py-16 px-6 max-w-6xl mx-auto">
        <h3 className="font-display text-3xl text-center text-cc-gold mb-10">Choose Your Era</h3>

        <div className="mb-12">
          <h4 className="font-display text-lg text-cc-gold/95 mb-4 tracking-wide">Global</h4>
          <p className="text-cc-muted text-sm mb-6 max-w-2xl">
            Full-world maps spanning multiple continents and eras of history.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {GLOBAL_ERAS.map((era) => (
              <EraCardButton key={era.id} era={era} onOpen={setModalEra} />
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-display text-lg text-cc-gold/95 mb-4 tracking-wide">Regional</h4>
          <p className="text-cc-muted text-sm mb-6 max-w-2xl">
            Theater-scale maps focused on a single region for faster, more intimate campaigns.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            {REGIONAL_ERAS.map((era) => (
              <EraCardButton key={era.id} era={era} onOpen={setModalEra} />
            ))}
          </div>
        </div>
      </section>

      {modalEra && (
        <EraDetailModal
          era={modalEra}
          onClose={() => setModalEra(null)}
          playHref={`/lobby?map=${encodeURIComponent(modalEra.mapId)}`}
        />
      )}

      {/* Features */}
      <section className="py-16 px-6 max-w-6xl mx-auto">
        <h3 className="font-display text-3xl text-center text-cc-gold mb-10">Why Eras of Empire?</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="card flex gap-4">
              <div className="shrink-0">
                <f.icon className="w-8 h-8 text-cc-gold" />
              </div>
              <div>
                <h4 className="font-display text-lg text-cc-gold mb-2">{f.title}</h4>
                <p className="text-cc-muted text-sm leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 text-center px-6">
        <h3 className="font-display text-4xl text-cc-gold mb-4">Ready to Command?</h3>
        <p className="text-cc-muted mb-8">No download required. Play instantly in your browser.</p>
        <Link to="/register" className="btn-primary text-lg px-12 py-3">Create Free Account</Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-cc-border py-8 pb-safe text-center text-cc-muted text-sm space-y-2">
        <p>© 2026 Eras of Empire. All rights reserved.</p>
        <Link to="/privacy" className="text-cc-gold/80 hover:text-cc-gold block">Privacy Policy</Link>
      </footer>
    </div>
  );
}
