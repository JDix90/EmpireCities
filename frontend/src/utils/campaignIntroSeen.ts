/**
 * Which campaign stage games have shown their intro on this browser.
 *
 * The intro was remembered per tab (sessionStorage), so a stage reopened in a
 * new tab, from the lobby or a reminder, told its story again before the
 * board. It is one list in localStorage, the newest games kept.
 */
const KEY = 'cc-campaign-intros-seen';
const KEEP = 30;

function read(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(-KEEP) : [];
  } catch {
    return [];
  }
}

export function campaignIntroSeen(gameId: string): boolean {
  return read().includes(gameId);
}

export function markCampaignIntroSeen(gameId: string): void {
  try {
    const seen = read().filter((id) => id !== gameId);
    seen.push(gameId);
    localStorage.setItem(KEY, JSON.stringify(seen.slice(-KEEP)));
  } catch {
    /* storage unavailable: the intro shows again in a new tab */
  }
}
