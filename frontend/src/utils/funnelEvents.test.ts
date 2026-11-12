/**
 * Funnel events v2 (funnel_events_v2_enabled): prompts shown and answered,
 * by surface, posted once per mount and only while the flag is on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { trackFunnel, useTrackShown, gatePage } from './funnelEvents';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const post = vi.fn(async () => ({ data: {} }));
vi.mock('../services/api', () => ({ api: { post: (...a: unknown[]) => post(...(a as [])) } }));

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, funnel_events_v2_enabled: on } }));

describe('funnel events', () => {
  beforeEach(() => {
    post.mockClear();
    setFlag(true);
  });

  it('posts the event with its surface first', () => {
    trackFunnel({ event: 'save_prompt_clicked', surface: 'results' }, { page: 'x' });
    expect(post).toHaveBeenCalledWith('/analytics/ui-event', { event: 'save_prompt_clicked', properties: { surface: 'results', page: 'x' } });
  });

  it('posts nothing with the flag off', () => {
    setFlag(false);
    trackFunnel({ event: 'tomorrow_panel_shown' });
    expect(post).not.toHaveBeenCalled();
  });

  it('records a prompt shown once per mount, the first time it is visible', () => {
    const { rerender } = renderHook(({ visible }) => useTrackShown({ event: 'push_ask_shown', surface: 'after_turn' }, visible), {
      initialProps: { visible: false },
    });
    expect(post).not.toHaveBeenCalled();
    rerender({ visible: true });
    rerender({ visible: false });
    rerender({ visible: true });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/analytics/ui-event', { event: 'push_ask_shown', properties: { surface: 'after_turn' } });
  });

  it('names a guest gate by the first part of its path', () => {
    window.history.pushState({}, '', '/friends/requests');
    expect(gatePage()).toBe('friends');
    window.history.pushState({}, '', '/');
    expect(gatePage()).toBe('home');
  });
});
