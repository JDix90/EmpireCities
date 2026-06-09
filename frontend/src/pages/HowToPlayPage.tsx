import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Swords, Shield, Dices, CreditCard, Trophy, Settings2, Map, Users, Zap, BookOpen } from 'lucide-react';
import { APP_NAME } from '../constants/brand';
import SubpageShell from '../components/ui/SubpageShell';

/* ─── Collapsible section ─────────────────────────────────── */
function Section({ icon: Icon, title, children, defaultOpen = false }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-bf-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 bg-bf-surface hover:bg-bf-surface/80 transition-colors text-left"
      >
        <Icon className="w-5 h-5 text-bf-gold shrink-0" />
        <span className="font-display text-lg text-bf-text flex-1">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-bf-muted" /> : <ChevronRight className="w-4 h-4 text-bf-muted" />}
      </button>
      {open && <div className="px-5 pb-5 pt-3 text-sm text-bf-muted leading-relaxed space-y-3">{children}</div>}
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────── */
export default function HowToPlayPage() {
  return (
    <SubpageShell title="HOW TO PLAY" icon={BookOpen} maxWidth="2xl" contentClassName="space-y-6 pb-12">
        <p className="text-bf-muted">
          Everything you need to know to play {APP_NAME}. Sections are collapsible — expand what you need.
        </p>

        <div className="space-y-3">
          {/* ── Overview ────────────────────────────────────── */}
          <Section icon={Map} title="Game Overview" defaultOpen>
            <p>
              {APP_NAME} is a turn-based strategy game of territory conquest. Players take turns
              reinforcing their armies, attacking neighbors, and repositioning troops. The goal depends
              on the chosen victory condition — typically, conquer the entire map.
            </p>
            <p>
              Games are played on historical maps spanning different eras (Ancient, Medieval, Age of
              Discovery, WW2, Cold War, Modern, American Civil War, Italian Unification, Space Age, and
              more). Each era can have unique combat modifiers that add flavor without changing core rules.
            </p>
            <p>
              You can play with friends, random opponents, or AI bots. Games can be real-time (fast
              turn timers) or asynchronous (24–72 hour turns).
            </p>
          </Section>

          {/* ── Turn Structure ──────────────────────────────── */}
          <Section icon={Zap} title="Turn Structure">
            <p>Each turn has <strong className="text-bf-text">three phases</strong>:</p>
            <ol className="list-decimal list-inside space-y-2 ml-1">
              <li>
                <strong className="text-bf-text">Draft (Reinforcement)</strong> — Receive new units and
                place them on your territories. You get <strong className="text-bf-text">1 unit per 3
                territories</strong> you hold (minimum 3), plus bonuses for controlling entire
                continents. You may also trade in card sets for extra units.
              </li>
              <li>
                <strong className="text-bf-text">Attack</strong> — Attack adjacent enemy territories.
                You can make as many attacks as you like, or skip entirely.
              </li>
              <li>
                <strong className="text-bf-text">Fortify</strong> — Move units from one of your
                territories to another connected friendly territory. By default you fortify once per turn;
                some tech or era rules can allow an extra fortify move. You can always skip.
              </li>
            </ol>
            <p className="text-bf-muted/70 text-xs">
              The first player each game is chosen at random (not lobby seat order), so creating
              the match does not guarantee going first.
            </p>
            <p className="text-bf-muted/70 text-xs">
              Some games enable a <strong>Territory Selection</strong> phase before the first draft,
              where players take turns picking starting territories instead of receiving random ones.
            </p>
          </Section>

          {/* ── Combat ──────────────────────────────────────── */}
          <Section icon={Dices} title="Combat & Dice">
            <p>
              To attack, select your territory (must have <strong className="text-bf-text">2+ units</strong>),
              then click an adjacent enemy territory. Combat is resolved with dice:
            </p>
            <div className="bg-bf-dark/50 rounded-lg p-3 space-y-1.5 text-xs">
              <p>
                <strong className="text-bf-text">Attacker</strong> rolls up to <strong className="text-bf-gold">3 dice</strong>{' '}
                (one fewer than units committed, max 3).
              </p>
              <p>
                <strong className="text-bf-text">Defender</strong> rolls up to <strong className="text-bf-gold">2 dice</strong>{' '}
                (up to their unit count, max 2).
              </p>
              <p>
                Dice are sorted highest → lowest and compared in pairs. The lower roll in each pair
                loses a unit. <strong className="text-bf-text">Ties go to the defender.</strong>
              </p>
            </div>
            <p>
              You capture a territory when its last defending unit is destroyed. At least 1 attacking
              unit moves in automatically. Attacking is always optional — you can skip the phase.
            </p>
            <p>
              When optional rules are on (factions, tech, buildings, wonders, events, sea lanes), attack and
              defense can roll <strong className="text-bf-text">extra dice</strong>. The server sends a
              breakdown when relevant; the HUD, combat modal, and mobile banner highlight faction-based
              extra dice so you can see why a roll used more than the base 3/2 dice.
            </p>
          </Section>

          {/* ── Cards ───────────────────────────────────────── */}
          <Section icon={CreditCard} title="Territory Cards">
            <p>
              If you capture <strong className="text-bf-text">at least one territory</strong> during
              your attack phase, you draw a card at the end of your turn. Cards show one of three
              symbols: <strong className="text-bf-text">Infantry</strong>,{' '}
              <strong className="text-bf-text">Cavalry</strong>, or{' '}
              <strong className="text-bf-text">Artillery</strong>. There are also 2{' '}
              <strong className="text-bf-gold">Wild</strong> cards in the deck.
            </p>
            <p>During your Draft phase, you can trade a <strong className="text-bf-text">set of 3 cards</strong> for bonus units:</p>
            <div className="bg-bf-dark/50 rounded-lg p-3 space-y-1 text-xs">
              <p>• <strong className="text-bf-text">Three of a kind</strong> (e.g. 3 Infantry)</p>
              <p>• <strong className="text-bf-text">One of each</strong> (Infantry + Cavalry + Artillery)</p>
              <p>• <strong className="text-bf-text">Any 2 + 1 Wild</strong></p>
            </div>
            <p>
              Each successive trade-in gives <strong className="text-bf-text">more units</strong>: 4 → 6 → 8 → 10 → 12 → 15 → 20 → … The
              count is global (shared across all players), so timing your trades strategically can be
              a big advantage.
            </p>
          </Section>

          {/* ── Victory ─────────────────────────────────────── */}
          <Section icon={Trophy} title="Victory Conditions">
            <p>The game host chooses one or more victory conditions when creating the game:</p>
            <div className="space-y-2">
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text mb-0.5">Domination (default)</p>
                <p className="text-xs">Capture every territory on the map — or be the last player standing.</p>
              </div>
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text mb-0.5">Threshold</p>
                <p className="text-xs">Own a set percentage of all territories (e.g. 70%). Faster games.</p>
              </div>
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text mb-0.5">Capital Conquest</p>
                <p className="text-xs">Each player starts with a capital. Capture yours + all opponents' capitals to win.</p>
              </div>
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text mb-0.5">Secret Mission</p>
                <p className="text-xs">
                  Each player gets a hidden objective — eliminate a specific player, control certain
                  continents, or capture key territories. Complete yours before anyone else. Some
                  players may even be secret allies.
                </p>
              </div>
            </div>
            <p className="text-bf-muted/70 text-xs">
              Multiple conditions can be enabled at once — the first player to satisfy <em>any</em> of
              them wins.
            </p>
          </Section>

          {/* ── Game Settings ───────────────────────────────── */}
          <Section icon={Settings2} title="Game Settings">
            <p>When creating a game, you can customize:</p>
            <div className="space-y-1.5 text-xs">
              <p>
                <strong className="text-bf-text">Era & Map</strong> — Choose from historical eras
                (Ancient, Medieval, etc.) or community-created maps. Each era may have unique combat
                modifiers.
              </p>
              <p>
                <strong className="text-bf-text">Players & AI</strong> — 2–8 players per lobby. Prefer to play
                right now? Add AI opponents (Easy / Medium / Hard / Expert) and start instantly — no waiting
                for a lobby to fill.
              </p>
              <p>
                <strong className="text-bf-text">Turn Timer</strong> — Real-time (3–10 min per turn)
                or async (12h / 24h / 72h). No timer for casual play.
              </p>
              <p>
                <strong className="text-bf-text">Fog of War</strong> — When enabled, you only see
                territories you own and their immediate neighbors. Everything else is hidden.
              </p>
              <p>
                <strong className="text-bf-text">Territory Draft</strong> — Instead of random starting
                positions, players take turns picking territories one at a time.
              </p>
              <p>
                <strong className="text-bf-text">Ranked / Casual</strong> — Ranked games affect your
                rating and appear on leaderboards. Casual games are for fun.
              </p>
            </div>
          </Section>

          {/* ── Advanced Features ────────────────────────────── */}
          <Section icon={Shield} title="Advanced Features (Opt-In)">
            <p>
              These features are <strong className="text-bf-text">all optional</strong> — the host
              toggles each one independently. They're designed to add depth without changing the core
              game:
            </p>
            <div className="space-y-2 text-xs">
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text">Economy & Buildings</p>
                <p>Earn Production Points from territories. Build structures (camps, barracks, forts, ports, wonders) that generate income, boost defense, or unlock new capabilities.</p>
              </div>
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text">Technology Trees</p>
                <p>Earn Tech Points each turn to research upgrades across multiple tiers — attack bonuses, defense bonuses, extra reinforcements, building unlocks, and special abilities.</p>
              </div>
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text">Naval Warfare</p>
                <p>Build fleets at ports and naval bases. Required for attacking across sea lanes. Includes naval combat, fleet movement, and blockades.</p>
              </div>
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text">Historical Events</p>
                <p>Random event cards drawn each round — global effects, regional bonuses, player-targeted events, and natural disasters. Some offer a choice, others are automatic.</p>
              </div>
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text">Asymmetric Factions</p>
                <p>
                  Each player can be assigned a faction with passive bonuses (attack, defense, reinforcements,
                  stability recovery) and a once-per-turn ability. During combat, extra dice from your faction
                  (and other sources) are called out in the combat log, combat modal, and mobile banner when
                  applicable. Open <strong className="text-bf-text">Bonuses &amp; Active Rules</strong> in-game
                  for a full breakdown of your modifiers.
                </p>
              </div>
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text">Population & Stability</p>
                <p>
                  Territories track stability (0–100) and population. Low stability reduces economy income and
                  limits how many units you can deploy to that territory <em>per draft phase</em> — the cap is
                  cumulative for that territory until your next draft (AI uses the same rule). Caps scale with
                  game progression (turn, era, economy when enabled) so late-game reinforcements are not
                  overly punishing. Very low stability can trigger rebellion checks.
                </p>
              </div>
              <div className="bg-bf-dark/50 rounded-lg p-3">
                <p className="font-medium text-bf-text">Influence (Cold War / Risorgimento)</p>
                <p>
                  When the era allows it, you can spend units to flip a weak neighboring territory during the
                  attack phase, with a cooldown between uses. Certain technologies extend your influence reach
                  by one extra hop; some wonders extend it further when Economy is on.
                </p>
              </div>
            </div>
            <p className="text-bf-muted/70 text-xs mt-2">
              This page summarizes the core and advanced rules. Open the in-game Codex for full faction
              details, building costs, and ability tables.
            </p>
          </Section>

          {/* ── Other Modes ─────────────────────────────────── */}
          <Section icon={Users} title="Other Modes & Features">
            <div className="space-y-1.5 text-xs">
              <p>
                <strong className="text-bf-text">Daily Challenge</strong> — A new puzzle scenario
                every day. Compete for the fastest completion time on the leaderboard.
              </p>
              <p>
                <strong className="text-bf-text">Campaign</strong> — A series of linked scenarios
                with escalating difficulty and narrative.
              </p>
              <p>
                <strong className="text-bf-text">Spectating</strong> — Watch live games in progress.
                Spectator view has a slight delay to prevent cheating.
              </p>
              <p>
                <strong className="text-bf-text">Replays</strong> — Review completed games turn by
                turn. Share replays with friends.
              </p>
              <p>
                <strong className="text-bf-text">Map Editor</strong> — Create your own custom maps
                with the built-in editor, then share them with the community.
              </p>
              <p>
                <strong className="text-bf-text">Diplomacy</strong> — Propose truces with other
                players during a game. Both sides must agree.
              </p>
            </div>
          </Section>

          {/* ── Quick Tips ──────────────────────────────────── */}
          <Section icon={Swords} title="Strategy Tips">
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Focus on holding <strong className="text-bf-text">entire continents</strong> early — the bonus units compound quickly.</li>
              <li>Don't spread thin. A few strong positions beat many weak ones.</li>
              <li>Save card trade-ins for when you need them most — the escalating bonus rewards patience.</li>
              <li>Leave at least <strong className="text-bf-text">2 units</strong> on border territories to avoid easy captures.</li>
              <li>Pay attention to who's growing fastest — sometimes the right play is attacking the leader, not your neighbor.</li>
              <li>In <strong className="text-bf-text">Fog of War</strong>, scout by attacking lightly — information is power.</li>
            </ol>
          </Section>
        </div>

        <div className="card p-4 mt-6 text-center space-y-3">
          <p className="text-bf-muted text-sm">
            Want guided practice? The Training Academy has interactive lessons on advanced settings, factions, and tech.
          </p>
          <Link to="/tutorial" className="btn-primary inline-block px-6 py-2 text-sm">
            Open Training Academy
          </Link>
        </div>
    </SubpageShell>
  );
}
