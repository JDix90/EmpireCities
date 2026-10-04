/**
 * Bot commanders (ai_personalities_enabled): who sits at a bot's seat, and
 * the style it plays this game.
 *
 * Each commander has a usual style and another it sometimes plays, so a name
 * means something (Khan Ulan raids) without being a script (now and then he
 * conquers). Which commanders sit down, and which of their styles each plays,
 * is drawn once per game from the game's key: the lobby, the board and a
 * replay all agree, and a rematch draws again. The backend reads the style
 * (game-engine/ai/aiStyles.ts); every client shows the name and style.
 */

export type AiStyle = 'conqueror' | 'raider' | 'expansionist' | 'opportunist' | 'defender';

export const AI_STYLES: readonly AiStyle[] = ['conqueror', 'raider', 'expansionist', 'opportunist', 'defender'];

/** A style's name on a seat, and the one line that says how it plays. */
export const AI_STYLE_LABELS: Readonly<Record<AiStyle, { name: string; blurb: string }>> = {
  conqueror: { name: 'Conqueror', blurb: 'Takes whole regions and presses every lead.' },
  raider: { name: 'Raider', blurb: 'Breaks rivals’ regions and hunts the weak.' },
  expansionist: { name: 'Expansionist', blurb: 'Grabs free land and new regions early.' },
  opportunist: { name: 'Opportunist', blurb: 'Strikes whoever is weakest.' },
  defender: { name: 'Defender', blurb: 'Holds its borders and attacks only at good odds.' },
};

export interface AiCommander {
  name: string;
  /** The style it usually plays. */
  style: AiStyle;
  /** The style it plays otherwise. */
  alt: AiStyle;
}

/** Thirty commanders, six of each usual style. The first twelve are the bots' names from before. */
export const AI_COMMANDERS: readonly AiCommander[] = [
  { name: 'General Varro', style: 'conqueror', alt: 'defender' },
  { name: 'Marshal Okonkwo', style: 'defender', alt: 'opportunist' },
  { name: 'Admiral Chen', style: 'expansionist', alt: 'raider' },
  { name: 'Strategos Doukas', style: 'defender', alt: 'conqueror' },
  { name: 'Warlord Tamsin', style: 'raider', alt: 'conqueror' },
  { name: 'Commander Reyes', style: 'opportunist', alt: 'expansionist' },
  { name: 'Hetman Volkov', style: 'raider', alt: 'opportunist' },
  { name: 'Rani Aditi', style: 'expansionist', alt: 'defender' },
  { name: 'Jarl Sigrún', style: 'raider', alt: 'expansionist' },
  { name: 'Sultana Yasmin', style: 'opportunist', alt: 'defender' },
  { name: 'Praetor Galba', style: 'conqueror', alt: 'expansionist' },
  { name: 'Khan Ulan', style: 'raider', alt: 'conqueror' },
  { name: 'Consul Aurelia', style: 'conqueror', alt: 'opportunist' },
  { name: 'Shogun Haruto', style: 'defender', alt: 'conqueror' },
  { name: 'Queen Amara', style: 'expansionist', alt: 'opportunist' },
  { name: 'Voivode Dragan', style: 'defender', alt: 'raider' },
  { name: 'Emir Rashid', style: 'opportunist', alt: 'raider' },
  { name: 'Duchess Margarethe', style: 'expansionist', alt: 'defender' },
  { name: 'Tlatoani Itzel', style: 'conqueror', alt: 'raider' },
  { name: 'Inkosi Themba', style: 'conqueror', alt: 'defender' },
  { name: 'Doge Lorenzo', style: 'opportunist', alt: 'expansionist' },
  { name: 'Chieftain Brannoc', style: 'raider', alt: 'defender' },
  { name: 'Satrap Daryush', style: 'expansionist', alt: 'conqueror' },
  { name: 'Captain Inês', style: 'expansionist', alt: 'raider' },
  { name: 'Marshal Lefèvre', style: 'defender', alt: 'opportunist' },
  { name: 'Tsarina Olena', style: 'conqueror', alt: 'defender' },
  { name: 'Regent Kwame', style: 'opportunist', alt: 'defender' },
  { name: 'Atabeg Kerim', style: 'raider', alt: 'opportunist' },
  { name: 'Lady Hoshiko', style: 'defender', alt: 'expansionist' },
  { name: 'Baron Aldric', style: 'opportunist', alt: 'conqueror' },
];

/** The chance a commander plays its usual style in a game; otherwise its other one. */
export const USUAL_STYLE_CHANCE = 0.75;

export interface DrawnCommander {
  name: string;
  style: AiStyle;
}

/** FNV-1a, 32-bit: a game key to a seed. */
function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded stream in [0, 1). */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The commanders at a game's bot seats, by seat index. `gameKey` is the
 * game's id; `aiSeats` its bot seats. Every name differs, and so does every
 * style while the five last. Seats are drawn in seat order, so adding a bot
 * after the others leaves theirs as they were.
 */
export function drawAiCommanders(gameKey: string, aiSeats: readonly number[]): Record<number, DrawnCommander> {
  const rng = stream(hashKey(`commanders:${gameKey}`));
  const order = AI_COMMANDERS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }

  const out: Record<number, DrawnCommander> = {};
  const usedStyles = new Set<AiStyle>();
  let next = 0;
  for (const seat of [...aiSeats].sort((a, b) => a - b)) {
    let pick: DrawnCommander | null = null;
    // The next commander whose drawn style is not yet at the table, or
    // failing that its other style; once all five are seated, anyone.
    for (let tries = 0; tries < order.length && next < order.length; tries++) {
      const c = AI_COMMANDERS[order[next++]!]!;
      const usual = rng() < USUAL_STYLE_CHANCE;
      const first = usual ? c.style : c.alt;
      const second = usual ? c.alt : c.style;
      const fresh = usedStyles.size >= AI_STYLES.length;
      if (fresh || !usedStyles.has(first)) { pick = { name: c.name, style: first }; break; }
      if (!usedStyles.has(second)) { pick = { name: c.name, style: second }; break; }
    }
    // More bots than commanders: start the roster again.
    if (!pick) {
      const c = AI_COMMANDERS[order[seat % order.length]!]!;
      pick = { name: c.name, style: c.style };
    }
    usedStyles.add(pick.style);
    out[seat] = pick;
  }
  return out;
}

/**
 * Whether a bot at this level plays a style: Medium and up, the levels that
 * play toward goals. Easy and the tutorial bot only take a commander's name.
 */
export function aiDifficultyPlaysStyle(difficulty: string | null | undefined): boolean {
  return difficulty === 'medium' || difficulty === 'hard' || difficulty === 'expert';
}

/** A drawn commander's name as a seat shows it: marked as a bot, as every bot's name is. */
export function aiCommanderName(commander: DrawnCommander): string {
  return `${commander.name} (AI)`;
}
