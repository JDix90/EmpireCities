/**
 * Time-to-completion label, by archetype.
 *
 * Deliberately ignores `max_turns`. The previous version read it as a count of
 * MINUTES — a puzzle capped at 18 turns advertised "~18–23 min", and one such
 * puzzle was actually won on turn 1 in about ninety seconds. A wildly
 * overstated estimate is worse than a vague one: it talks people out of a
 * two-minute puzzle.
 *
 * These are deliberately conservative and provisional. The real numbers are
 * medians of `game_finished.duration_ms` per puzzle, which need traffic that
 * does not exist yet; swap them for measured values once it does.
 */
export function estimatedTime(spec: { archetype?: string }): string {
  switch (spec.archetype) {
    case 'military_capture':
      return '2\u20135 min';
    case 'hold_territory':
      return '3\u20136 min';
    case 'control_region':
    case 'capture_chain':
      return '4\u20138 min';
    case 'economy_build':
      return '4\u20138 min';
    case 'tech_research':
      return '5\u201310 min';
    case 'domination':
    default:
      return '8\u201315 min';
  }
}
