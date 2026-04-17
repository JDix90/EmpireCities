import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ArrowLeft, Swords, Shield, Dices, CreditCard, Trophy, Settings2, Map, Users, Zap } from 'lucide-react';
import clsx from 'clsx';

/* ─── Collapsible section ─────────────────────────────────── */
function Section({ icon: Icon, title, children, defaultOpen = false }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-cc-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-cc-surface hover:bg-cc-surface/80 transition-colors text-left"
      >
        <Icon className="w-5 h-5 text-cc-gold shrink-0" />
        <span className="font-display text-lg text-cc-text flex-1">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-cc-muted" /> : <ChevronRight className="w-4 h-4 text-cc-muted" />}
      </button>
      {open && <div className="px-5 pb-5 pt-3 text-sm text-cc-muted leading-relaxed space-y-3">{children}</div>}
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────── */
export default function HowToPlayPage() {
  return (
    <div className="min-h-screen bg-cc-dark pt-safe pb-12">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="flex items-center gap-3 py-6">
          <Link to="/lobby" className="text-cc-muted hover:text-cc-text transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-display text-2xl text-cc-gold tracking-wider">How to Play</h1>
        </div>

        <p className="text-cc-muted mb-6">
          Everything you need to know to play Eras of Empire. Sections are collapsible — expand what you need.
        </p>

        <div className="space-y-3">
          {/* ── Overview ────────────────────────────────────── */}
          <Section icon={Map} title="Game Overview" defaultOpen>
            <p>
              Eras of Empire is a turn-based strategy game of territory conquest. Players take turns
              reinforcing their armies, attacking neighbors, and repositioning troops. The goal depends
              on the chosen victory condition — typically, conquer the entire map.
            </p>
            <p>
              Games are played on historical maps spanning different eras (Ancient, Medieval, Age of
              Discovery, WW2, Cold War, Modern, and more). Each era can have unique combat modifiers
              that add flavor without changing core rules.
            </p>
            <p>
              You can play with friends, random opponents, or AI bots. Games can be real-time (fast
              turn timers) or asynchronous (24–72 hour turns).
            </p>
          </Section>

          {/* ── Turn Structure ──────────────────────────────── */}
          <Section icon={Zap} title="Turn Structure">
            <p>Each turn has <strong className="text-cc-text">three phases</strong>:</p>
            <ol className="list-decimal list-inside space-y-2 ml-1">
              <li>
                <strong className="text-cc-text">Draft (Reinforcement)</strong> — Receive new units and
                place them on your territories. You get <strong className="text-cc-text">1 unit per 3
                territories</strong> you hold (minimum 3), plus bonuses for controlling entire
                continents. You may also trade in card sets for extra units.
              </li>
              <li>
                <strong className="text-cc-text">Attack</strong> — Attack adjacent enemy territories.
                You can make as many attacks as you like, or skip entirely.
              </li>
              <li>
                <strong className="text-cc-text">Fortify</strong> — Move units from one of your
                territories to another connected friendly territory. You can fortify once or skip.
              </li>
            </ol>
            <p className="text-cc-muted/70 text-xs">
              Some games enable a <strong>Territory Selection</strong> phase before the first draft,
              where players take turns picking starting territories instead of receiving random ones.
            </p>
          </Section>

          {/* ── Combat ──────────────────────────────────────── */}
          <Section icon={Dices} title="Combat & Dice">
            <p>
              To attack, select your territory (must have <strong className="text-cc-text">2+ units</strong>),
              then click an adjacent enemy territory. Combat is resolved with dice:
            </p>
            <div className="bg-cc-dark/50 rounded-lg p-3 space-y-1.5 text-xs">
              <p>
                <strong className="text-cc-text">Attacker</strong> rolls up to <strong className="text-cc-gold">3 dice</strong>{' '}
                (one fewer than units committed, max 3).
              </p>
              <p>
                <strong className="text-cc-text">Defender</strong> rolls up to <strong className="text-cc-gold">2 dice</strong>{' '}
                (up to their unit count, max 2).
              </p>
              <p>
                Dice are sorted highest → lowest and compared in pairs. The lower roll in each pair
                loses a unit. <strong className="text-cc-text">Ties go to the defender.</strong>
              </p>
            </div>
            <p>
              You capture a territory when its last defending unit is destroyed. At least 1 attacking
              unit moves in automatically. Attacking is always optional — you can skip the phase.
            </p>
          </Section>

          {/* ── Cards ───────────────────────────────────────── */}
          <Section icon={CreditCard} title="Territory Cards">
            <p>
              If you capture <strong className="text-cc-text">at least one territory</strong> during
              your attack phase, you draw a card at the end of your turn. Cards show one of three
              symbols: <strong className="text-cc-text">Infantry</strong>,{' '}
              <strong className="text-cc-text">Cavalry</strong>, or{' '}
              <strong className="text-cc-text">Artillery</strong>. There are also 2{' '}
              <strong className="text-cc-gold">Wild</strong> cards in the deck.
            </p>
            <p>During your Draft phase, you can trade a <strong className="text-cc-text">set of 3 cards</strong> for bonus units:</p>
            <div className="bg-cc-dark/50 rounded-lg p-3 space-y-1 text-xs">
              <p>• <strong className="text-cc-text">Three of a kind</strong> (e.g. 3 Infantry)</p>
              <p>• <strong className="text-cc-text">One of each</strong> (Infantry + Cavalry + Artillery)</p>
              <p>• <strong className="text-cc-text">Any 2 + 1 Wild</strong></p>
            </div>
            <p>
              Each successive trade-in gives <strong className="text-cc-text">more units</strong>: 4 → 6 → 8 → 10 → 12 → 15 → 20 → … The
              count is global (shared across all players), so timing your trades strategically can be
              a big advantage.
            </p>
          </Section>

          {/* ── Victory ─────────────────────────────────────── */}
          <Section icon={Trophy} title="Victory Conditions">
            <p>The game host chooses one or more victory conditions when creating the game:</p>
            <div className="space-y-2">
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text mb-0.5">Domination (default)</p>
                <p className="text-xs">Capture every territory on the map — or be the last player standing.</p>
              </div>
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text mb-0.5">Threshold</p>
                <p className="text-xs">Own a set percentage of all territories (e.g. 70%). Faster games.</p>
              </div>
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text mb-0.5">Capital Conquest</p>
                <p className="text-xs">Each player starts with a capital. Capture yours + all opponents' capitals to win.</p>
              </div>
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text mb-0.5">Secret Mission</p>
                <p className="text-xs">
                  Each player gets a hidden objective — eliminate a specific player, control certain
                  continents, or capture key territories. Complete yours before anyone else. Some
                  players may even be secret allies.
                </p>
              </div>
            </div>
            <p className="text-cc-muted/70 text-xs">
              Multiple conditions can be enabled at once — the first player to satisfy <em>any</em> of
              them wins.
            </p>
          </Section>

          {/* ── Game Settings ───────────────────────────────── */}
          <Section icon={Settings2} title="Game Settings">
            <p>When creating a game, you can customize:</p>
            <div className="space-y-1.5 text-xs">
              <p>
                <strong className="text-cc-text">Era & Map</strong> — Choose from historical eras
                (Ancient, Medieval, etc.) or community-created maps. Each era may have unique combat
                modifiers.
              </p>
              <p>
                <strong className="text-cc-text">Players & AI</strong> — 2–12 players. Add AI bots
                (Easy / Medium / Hard / Expert) to fill slots.
              </p>
              <p>
                <strong className="text-cc-text">Turn Timer</strong> — Real-time (3–10 min per turn)
                or async (12h / 24h / 72h). No timer for casual play.
              </p>
              <p>
                <strong className="text-cc-text">Fog of War</strong> — When enabled, you only see
                territories you own and their immediate neighbors. Everything else is hidden.
              </p>
              <p>
                <strong className="text-cc-text">Territory Draft</strong> — Instead of random starting
                positions, players take turns picking territories one at a time.
              </p>
              <p>
                <strong className="text-cc-text">Ranked / Casual</strong> — Ranked games affect your
                rating and appear on leaderboards. Casual games are for fun.
              </p>
            </div>
          </Section>

          {/* ── Advanced Features ────────────────────────────── */}
          <Section icon={Shield} title="Advanced Features (Opt-In)">
            <p>
              These features are <strong className="text-cc-text">all optional</strong> — the host
              toggles each one independently. They're designed to add depth without changing the core
              game:
            </p>
            <div className="space-y-2 text-xs">
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text">Economy & Buildings</p>
                <p>Earn Production Points from territories. Build structures (camps, barracks, forts, ports, wonders) that generate income, boost defense, or unlock new capabilities.</p>
              </div>
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text">Technology Trees</p>
                <p>Earn Tech Points each turn to research upgrades across multiple tiers — attack bonuses, defense bonuses, extra reinforcements, building unlocks, and special abilities.</p>
              </div>
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text">Naval Warfare</p>
                <p>Build fleets at ports and naval bases. Required for attacking across sea lanes. Includes naval combat, fleet movement, and blockades.</p>
              </div>
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text">Historical Events</p>
                <p>Random event cards drawn each round — global effects, regional bonuses, player-targeted events, and natural disasters. Some offer a choice, others are automatic.</p>
              </div>
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text">Asymmetric Factions</p>
                <p>Each player is assigned a faction with unique passive bonuses (attack, defense, reinforcement, or geographic advantages).</p>
              </div>
              <div className="bg-cc-dark/50 rounded-lg p-3">
                <p className="font-medium text-cc-text">Population & Stability</p>
                <p>Territories have a stability rating (0–100%) that affects production. Conquering or losing territories causes instability. Manage your empire's health.</p>
              </div>
            </div>
            <p className="text-cc-muted/70 text-xs mt-2">
              For detailed rules on each advanced feature, see the{' '}
              <strong className="text-cc-gold">Player Guide</strong> (accessible from your Profile).
            </p>
          </Section>

          {/* ── Other Modes ─────────────────────────────────── */}
          <Section icon={Users} title="Other Modes & Features">
            <div className="space-y-1.5 text-xs">
              <p>
                <strong className="text-cc-text">Daily Challenge</strong> — A new puzzle scenario
                every day. Compete for the fastest completion time on the leaderboard.
              </p>
              <p>
                <strong className="text-cc-text">Campaign</strong> — A series of linked scenarios
                with escalating difficulty and narrative.
              </p>
              <p>
                <strong className="text-cc-text">Spectating</strong> — Watch live games in progress.
                Spectator view has a slight delay to prevent cheating.
              </p>
              <p>
                <strong className="text-cc-text">Replays</strong> — Review completed games turn by
                turn. Share replays with friends.
              </p>
              <p>
                <strong className="text-cc-text">Map Editor</strong> — Create your own custom maps
                with the built-in editor, then share them with the community.
              </p>
              <p>
                <strong className="text-cc-text">Diplomacy</strong> — Propose truces with other
                players during a game. Both sides must agree.
              </p>
            </div>
          </Section>

          {/* ── Quick Tips ──────────────────────────────────── */}
          <Section icon={Swords} title="Strategy Tips">
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Focus on holding <strong className="text-cc-text">entire continents</strong> early — the bonus units compound quickly.</li>
              <li>Don't spread thin. A few strong positions beat many weak ones.</li>
              <li>Save card trade-ins for when you need them most — the escalating bonus rewards patience.</li>
              <li>Leave at least <strong className="text-cc-text">2 units</strong> on border territories to avoid easy captures.</li>
              <li>Pay attention to who's growing fastest — sometimes the right play is attacking the leader, not your neighbor.</li>
              <li>In <strong className="text-cc-text">Fog of War</strong>, scout by attacking lightly — information is power.</li>
            </ol>
          </Section>
        </div>

        <div className="mt-8 text-center">
          <Link to="/lobby" className="btn-primary inline-block px-8 py-2.5">
            Back to Lobby
          </Link>
        </div>
      </div>
    </div>
  );
}
