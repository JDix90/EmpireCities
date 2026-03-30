import React from 'react';
import { Link } from 'react-router-dom';
import { Globe, Sword, Map, Users } from 'lucide-react';

const ERAS = [
  { id: 'ancient',   label: 'Ancient World',     years: '3000 BC – 400 AD',  color: '#c9a84c' },
  { id: 'medieval',  label: 'Medieval Era',       years: '400 – 1400 AD',     color: '#8b6914' },
  { id: 'discovery', label: 'Age of Discovery',   years: '1400 – 1800 AD',    color: '#2e7d9e' },
  { id: 'ww2',       label: 'World War II',        years: '1939 – 1945',       color: '#5a5a5a' },
  { id: 'coldwar',   label: 'Cold War',            years: '1945 – 1991',       color: '#1a3a5c' },
  { id: 'modern',    label: 'The Modern Day',      years: '2025',               color: '#2ecc71' },
];

const FEATURES = [
  { icon: Globe,  title: 'Dynamic Historical Maps',  desc: 'Play across 5 meticulously crafted historical eras, each with accurate borders and era-specific mechanics.' },
  { icon: Sword,  title: 'Deep Strategy',            desc: 'Master the classic Draft-Attack-Fortify loop with diplomacy, card sets, and continent bonuses.' },
  { icon: Map,    title: 'Custom Map Editor',        desc: 'Build and publish your own maps. Share them with the community and watch your creations come to life.' },
  { icon: Users,  title: 'Multiplayer & AI',         desc: 'Challenge friends in real-time or asynchronous games, or hone your skills against AI bots of varying difficulty.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-cc-dark">
      {/* Navigation */}
      <nav className="border-b border-cc-border px-6 py-4 flex items-center justify-between">
        <h1 className="font-display text-2xl text-cc-gold tracking-widest">CHRONOCONQUEST</h1>
        <div className="flex gap-3">
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
          A browser-based grand strategy game spanning the ancient world to the Cold War.
          Command armies, forge alliances, and rewrite history — one territory at a time.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link to="/register" className="btn-primary text-lg px-10 py-3">Play Free Now</Link>
          <Link to="/login" className="btn-secondary text-lg px-10 py-3">Sign In</Link>
        </div>
      </section>

      {/* Era Showcase */}
      <section className="py-16 px-6 max-w-6xl mx-auto">
        <h3 className="font-display text-3xl text-center text-cc-gold mb-10">Choose Your Era</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {ERAS.map((era) => (
            <div
              key={era.id}
              className="card text-center hover:border-cc-gold transition-colors cursor-pointer group"
            >
              <div
                className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl"
                style={{ backgroundColor: era.color + '33', border: `2px solid ${era.color}` }}
              >
                🗺️
              </div>
              <p className="font-display text-sm text-cc-gold group-hover:text-white transition-colors">{era.label}</p>
              <p className="text-xs text-cc-muted mt-1">{era.years}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-6 max-w-6xl mx-auto">
        <h3 className="font-display text-3xl text-center text-cc-gold mb-10">Why ChronoConquest?</h3>
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
      <footer className="border-t border-cc-border py-8 text-center text-cc-muted text-sm">
        <p>© 2026 ChronoConquest. All rights reserved.</p>
      </footer>
    </div>
  );
}
