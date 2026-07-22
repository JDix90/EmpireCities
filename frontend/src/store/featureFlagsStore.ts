import { create } from 'zustand';
import { api } from '../services/api';

export interface ClientFeatureFlags {
  map_editor_enabled: boolean;
  era_advancement_lobby_enabled: boolean;
  first_turn_coach_enabled: boolean;
  turn_clarity_enabled: boolean;
  onboarding_tutorial_first_enabled: boolean;
  hero_single_cta_enabled: boolean;
  era_advance_payoff_enabled: boolean;
  signup_nudge_enabled: boolean;
  streak_freezes_enabled: boolean;
  today_panel_enabled: boolean;
  async_onboarding_enabled: boolean;
  spectate_enabled: boolean;
  ranked_multi_size_enabled: boolean;
  match_alerts_enabled: boolean;
}

const DEFAULT_FLAGS: ClientFeatureFlags = {
  map_editor_enabled: false,
  // Mirrors the backend default (on) so the Full Game CTA + Era Advancement toggle
  // paint immediately; GET /feature-flags still reconciles (admin can override off).
  era_advancement_lobby_enabled: true,
  // Default off (dark-launch); GET /feature-flags reconciles once admin enables it.
  first_turn_coach_enabled: false,
  // Default off (dark-launch); in-game phase bar / target highlighting / undo.
  turn_clarity_enabled: false,
  // Default off (dark-launch); route landing guests straight into the tutorial.
  onboarding_tutorial_first_enabled: false,
  // Default off (dark-launch); collapse the landing hero to one dominant Play CTA.
  hero_single_cta_enabled: false,
  // Default off (dark-launch); celebratory era-advance payoff modal.
  era_advance_payoff_enabled: false,
  // Default off (dark-launch); GET /feature-flags reconciles once it's enabled.
  signup_nudge_enabled: false,
  // Wave 2 retention flags — all default off (dark-launch).
  streak_freezes_enabled: false,
  today_panel_enabled: false,
  async_onboarding_enabled: false,
  // Default off — Watch/Spectate is hidden until there's enough live traffic
  // for the list to look alive; GET /feature-flags reconciles once enabled.
  spectate_enabled: false,
  // Default off (dark-launch); ranked opponents-count dropdown + multi-size queue.
  ranked_multi_size_enabled: false,
  // Default off (dark-launch); app-wide match-found alerts (socket + OS + push).
  match_alerts_enabled: false,
};

interface FeatureFlagsState {
  flags: ClientFeatureFlags;
  loaded: boolean;
  load: () => Promise<void>;
}

export const useFeatureFlagsStore = create<FeatureFlagsState>((set) => ({
  flags: DEFAULT_FLAGS,
  loaded: false,
  load: async () => {
    try {
      const res = await api.get<Partial<ClientFeatureFlags>>('/feature-flags');
      set({
        flags: { ...DEFAULT_FLAGS, ...res.data },
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
}));

export function useMapEditorEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.map_editor_enabled);
}

export function useEraAdvancementLobbyEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.era_advancement_lobby_enabled);
}

export function useFirstTurnCoachEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.first_turn_coach_enabled);
}

export function useTurnClarityEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.turn_clarity_enabled);
}

export function useOnboardingTutorialFirstEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.onboarding_tutorial_first_enabled);
}

export function useHeroSingleCtaEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.hero_single_cta_enabled);
}

export function useEraAdvancePayoffEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.era_advance_payoff_enabled);
}

export function useSignupNudgeEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.signup_nudge_enabled);
}

export function useStreakFreezesEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.streak_freezes_enabled);
}

export function useTodayPanelEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.today_panel_enabled);
}

export function useAsyncOnboardingEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.async_onboarding_enabled);
}

export function useSpectateEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.spectate_enabled);
}

export function useRankedMultiSizeEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.ranked_multi_size_enabled);
}

export function useMatchAlertsEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.match_alerts_enabled);
}
