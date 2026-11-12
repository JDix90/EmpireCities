import { useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

/**
 * Funnel events v2 (`funnel_events_v2_enabled`): the counts the product
 * review found missing. Every save-account prompt and reminder ask, shown and
 * answered, by where it appeared; the results screen's Tomorrow panel; Daily
 * Challenge links. Before these, "4 of 225 guests saved" had no denominator:
 * nothing said how many saw a prompt, or which one worked.
 *
 * The surfaces are closed sets, mirrored by the server's allow-list
 * (backend modules/analytics/analytics.routes.ts): adding one here means
 * adding it there, or the event is refused.
 */
export type SavePromptSurface = 'results' | 'post_game' | 'tutorial_end' | 'tomorrow' | 'lobby' | 'guest_gate';
export type PushAskSurface = 'results' | 'after_turn' | 'lobby_banner';
export type DailyLinkSurface = 'tomorrow' | 'today_panel' | 'lobby';

type FunnelEvent =
  | { event: 'save_prompt_shown' | 'save_prompt_clicked'; surface: SavePromptSurface }
  | { event: 'push_ask_shown' | 'push_ask_dismissed'; surface: PushAskSurface }
  | { event: 'daily_link_clicked'; surface: DailyLinkSurface }
  | { event: 'tomorrow_panel_shown'; surface?: undefined }
  | { event: 'tutorial_step'; surface?: undefined };

/** The page a guest gate sits on ("/friends" → "friends"): which locked feature a guest wanted. */
export function gatePage(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname.split('/').filter(Boolean)[0]?.slice(0, 40) ?? 'home';
}

/** Whether the events are on: read at call time, so a component needs no hook to send one. */
export function funnelEventsOn(): boolean {
  return useFeatureFlagsStore.getState().flags.funnel_events_v2_enabled === true;
}

/** Post one event; fire-and-forget, so a failed beacon never touches what the player is doing. */
export function trackFunnel(e: FunnelEvent, properties: Record<string, string> = {}): void {
  if (!funnelEventsOn()) return;
  const props = e.surface ? { surface: e.surface, ...properties } : properties;
  // Never throws into the caller: a beacon is not worth a broken button.
  try {
    void Promise.resolve(api.post('/analytics/ui-event', { event: e.event, properties: props })).catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Post a `…_shown` event once per mount, the first time `visible` is true.
 * A prompt that re-renders, or hides and comes back in the same mount, counts once.
 */
export function useTrackShown(e: FunnelEvent, visible: boolean, properties?: Record<string, string>): void {
  const sent = useRef(false);
  const propsRef = useRef(properties);
  propsRef.current = properties;
  const { event, surface } = e;
  useEffect(() => {
    if (!visible || sent.current) return;
    sent.current = true;
    trackFunnel({ event, surface } as FunnelEvent, propsRef.current);
  }, [visible, event, surface]);
}
