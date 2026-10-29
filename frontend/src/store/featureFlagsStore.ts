import { create } from 'zustand';
import { api } from '../services/api';

export interface ClientFeatureFlags {
  map_editor_enabled: boolean;
  era_advancement_lobby_enabled: boolean;
  first_turn_coach_enabled: boolean;
  turn_recap_panel_enabled: boolean;
  turn_clarity_enabled: boolean;
  map_gestures_v2_enabled: boolean;
  onboarding_tutorial_first_enabled: boolean;
  tutorial_card_fade_enabled: boolean;
  hero_single_cta_enabled: boolean;
  era_advance_payoff_enabled: boolean;
  signup_nudge_enabled: boolean;
  email_account_save_enabled: boolean;
  guest_prompt_v2_enabled: boolean;
  save_account_copy_enabled: boolean;
  results_footer_enabled: boolean;
  ranked_leaderboard_enabled: boolean;
  referral_survey_enabled: boolean;
  player_links_play_enabled: boolean;
  guest_push_reminders_enabled: boolean;
  daily_guest_play_enabled: boolean;
  guest_personal_features_enabled: boolean;
  streak_freezes_enabled: boolean;
  today_panel_enabled: boolean;
  async_onboarding_enabled: boolean;
  spectate_enabled: boolean;
  ranked_multi_size_enabled: boolean;
  match_alerts_enabled: boolean;
  async_turn_alerts_enabled: boolean;
  attack_blitz_enabled: boolean;
  background_music_enabled: boolean;
  era_heritage_buildings_enabled: boolean;
  era_wonder_per_era_enabled: boolean;
  warfront_enabled: boolean;
  galaxy_tutorial_enabled: boolean;
  galaxy_age_beta_enabled: boolean;
  feedback_menu_enabled: boolean;
  localization_enabled: boolean;
  touch_targets_enabled: boolean;
  daily_puzzle_v2_enabled: boolean;
  first_turn_clock_wait_enabled: boolean;
  store_v2_enabled: boolean;
  space_age_moon_race_enabled: boolean;
  first_match_easy_enabled: boolean;
  game_loading_label_enabled: boolean;
  tutorial_phone_gate_visible_enabled: boolean;
  desktop_card_cue_enabled: boolean;
  battle_armies_enabled: boolean;
  battle_player_colors_enabled: boolean;
  tutorial_wrapup_to_match_enabled: boolean;
  first_match_primary_cta_enabled: boolean;
  phone_fortify_fit_enabled: boolean;
  in_game_mute_enabled: boolean;
  full_game_evening_enabled: boolean;
  placement_cap_note_enabled: boolean;
  custom_lobby_fold_enabled: boolean;
  custom_round_cap_enabled: boolean;
  loss_reason_enabled: boolean;
  mission_reveal_enabled: boolean;
  translation_dom_guard_enabled: boolean;
  game_visible_height_enabled: boolean;
}

/**
 * Pre-fetch paint values: these MUST mirror the backend's `FLAG_CODE_DEFAULTS`
 * (backend/src/config/featureFlags.ts). GET /feature-flags reconciles a moment
 * later, so a mismatch here shows the wrong variant on first paint and then
 * visibly swaps it — worst on the landing hero, which is the first thing a
 * visitor sees. An admin override still wins once the fetch lands.
 */
const DEFAULT_FLAGS: ClientFeatureFlags = {
  // ON since the editor publish -> moderation -> community loop closed.
  map_editor_enabled: true,
  era_advancement_lobby_enabled: true,
  first_turn_coach_enabled: true,
  // Desktop: the own-turn recap is a panel row, not a modal. On by default; admin kill switch.
  turn_recap_panel_enabled: true,
  turn_clarity_enabled: true,
  // Flat map: pinch zooms around the fingers, panning keeps land on screen. On by default; admin kill switch.
  map_gestures_v2_enabled: true,
  onboarding_tutorial_first_enabled: true,
  // Tutorial card: a fade above the buttons while there is more to read. On by default; admin kill switch.
  tutorial_card_fade_enabled: true,
  hero_single_cta_enabled: true,
  era_advance_payoff_enabled: true,
  signup_nudge_enabled: true,
  // Save your account with just an email; sign in by emailed link. On by default; admin kill switch.
  email_account_save_enabled: true,
  // Guest prompts: an accurate saved-in-this-browser line, one account modal per session. On by default; admin kill switch.
  guest_prompt_v2_enabled: true,
  // "Save your account" wording on every guest surface. On by default; admin kill switch.
  save_account_copy_enabled: true,
  // Results: Rematch and Return to Lobby pinned, no second account ask. On by default; admin kill switch.
  results_footer_enabled: true,
  // OFF until the ranked ladder has enough players not to render empty.
  ranked_leaderboard_enabled: false,
  // Dark-launched OFF: it adds a prompt at the end of a first session.
  referral_survey_enabled: false,
  // Invite, referral and shared-replay links lead into play. On by default; admin kill switch.
  player_links_play_enabled: true,
  // Guests are asked for, and get, push streak and daily reminders. On by default; admin kill switch.
  guest_push_reminders_enabled: true,
  // Guests may play the Daily (registered players are the only ones ranked).
  daily_guest_play_enabled: true,
  // Guests see and use their own achievements, cosmetics, gold and settings. On by default; admin kill switch.
  guest_personal_features_enabled: true,
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
  // On: app-wide "it's your turn" alerts for async games (socket + OS). The
  // fix for async players being told nothing; admin kill switch.
  async_turn_alerts_enabled: true,
  // "Attack until captured": one event resolves repeated exchanges server-side.
  attack_blitz_enabled: true,
  // Generated ambient bed on the game page. On by default; admin kill switch.
  background_music_enabled: true,
  // Heritage build rights + modernize, baked into era-advancement games at
  // create. On by default; admin kill switch.
  era_heritage_buildings_enabled: true,
  // One wonder per era rather than per game. Default off (dark-launch).
  era_wonder_per_era_enabled: false,
  // Experimental Warfront RTS mode: admin-only surfaces, and off by default on top.
  warfront_enabled: false,
  // The Galactic Age tutorial track. On by default; admin kill switch. Off,
  // the Academy hides the galaxy lessons and the server refuses to start one.
  galaxy_tutorial_enabled: true,
  // The Galactic Age open to every signed-in player as a beta. Dark-launched OFF.
  galaxy_age_beta_enabled: false,
  // The lobby menu's Feedback entry. Dark-launched OFF.
  feedback_menu_enabled: false,
  // Localized landing + tutorial (src/i18n). Dark-launched OFF: the bundles
  // ship but everyone sees English until an operator turns this on.
  localization_enabled: false,
  // Touch targets: 44px touch areas for small controls on touch screens. On by default; admin kill switch.
  touch_targets_enabled: true,
  // Daily Challenge v2 (decision puzzles graded by an exact solver). Dark-launched
  // OFF; the server decides which days are v2, the client renders what it is sent.
  daily_puzzle_v2_enabled: false,
  // First turn clock: the first turn's clock waits for the game-start briefing. On by default; admin kill switch.
  first_turn_clock_wait_enabled: true,
  // Store overhaul: cosmetics drawn on profiles and in matches (the store page
  // is the same either way). On by default; admin kill switch.
  store_v2_enabled: true,
  // A player's first Quick Match is one Easy bot on a small map. On by default; admin kill switch.
  first_match_easy_enabled: true,
  // Game loading: the skeleton names the match being set up. On by default; admin kill switch.
  game_loading_label_enabled: true,
  // Phone tutorial keeps the tech tree's controls in view at the era gate. On by default; admin kill switch.
  tutorial_phone_gate_visible_enabled: true,
  // Desktop HUD offers a one-click card trade when a set is ready. On by default; admin kill switch.
  desktop_card_cue_enabled: true,
  // Battle result: armies left beside both names, blitz dice marked as the last roll. On by default; admin kill switch.
  battle_armies_enabled: true,
  // Battle colours by player: battle dice and names in each player's map colour. On by default; admin kill switch.
  battle_player_colors_enabled: true,
  // The tutorial wrap-up leads into the first real match. On by default; admin kill switch.
  tutorial_wrapup_to_match_enabled: true,
  // While the next Quick Match is the first, it is the lobby's gold button. On by default; admin kill switch.
  first_match_primary_cta_enabled: true,
  // Phone fortify: the sheet grows to show the amount and the first destination. On by default; admin kill switch.
  phone_fortify_fit_enabled: true,
  // In-game mute: one sound and music switch in Tools & options. On by default; admin kill switch.
  in_game_mute_enabled: true,
  // A Full Game fits an evening: the 65% ending by default, an 80-round cap. Dark-launched OFF.
  full_game_evening_enabled: false,
  // Placement cap note: explain the stability cap where units are placed. On by default; admin kill switch.
  placement_cap_note_enabled: true,
  // The Custom Game form folds its less-used options under Advanced. Dark-launched OFF.
  custom_lobby_fold_enabled: false,
  // The Custom Game form sets a round limit. Dark-launched OFF.
  custom_round_cap_enabled: false,
  // Loss reason: the defeat screen says why the player lost. On by default; admin kill switch.
  loss_reason_enabled: true,
  // A game won by a secret mission names every player's mission at game over. On by default; admin kill switch.
  mission_reveal_enabled: true,
  // A page the browser translated doesn't crash (utils/translationDomGuard.ts). On by default; admin kill switch.
  translation_dom_guard_enabled: true,
  // The game screen, and the replay page, are as tall as what the browser shows (100dvh). On by default; admin kill switch.
  game_visible_height_enabled: true,
  // The Space Age Moon Race, Lunar Hegemony included. On by default; admin kill switch.
  space_age_moon_race_enabled: true,
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

/** Desktop: the end of your own turn adds a row to the non-blocking recap panel instead of a modal summary (pages/GamePage.tsx, components/game/AiTurnRecapPanel.tsx). */
export function useTurnRecapPanelEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.turn_recap_panel_enabled);
}

export function useTurnClarityEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.turn_clarity_enabled);
}

/** Flat map gestures: pinch and wheel zoom around the fingers or cursor, bounded panning, no double-tap from a pinch (components/game/GameMap.tsx). */
export function useMapGesturesV2Enabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.map_gestures_v2_enabled);
}

export function useOnboardingTutorialFirstEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.onboarding_tutorial_first_enabled);
}

/** Tutorial card: a fade above the buttons while the prose has more below the fold (components/game/TutorialOverlay.tsx). */
export function useTutorialCardFadeEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.tutorial_card_fade_enabled);
}

export function useHeroSingleCtaEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.hero_single_cta_enabled);
}

export function useReferralSurveyEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.referral_survey_enabled);
}

/** Invite, referral and shared-replay links lead into play (pages/JoinGamePage.tsx, utils/pendingReferral.ts, pages/ReplayPage.tsx). */
export function usePlayerLinksPlayEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.player_links_play_enabled);
}

/** Guests get push reminders: the ask in components/game/ComeBackTomorrowPanel.tsx, the switch in Settings. */
export function useGuestPushRemindersEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.guest_push_reminders_enabled);
}

export function useSignupNudgeEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.signup_nudge_enabled);
}

/** Save your account with just an email, password optional; sign in by an emailed link (email_account_save_enabled). */
export function useEmailAccountSaveEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.email_account_save_enabled);
}

/** Guest prompts: an accurate saved-in-this-browser line, and one blocking account modal per tab session (utils/guestGate.ts, pages/GamePage.tsx). */
export function useGuestPromptV2Enabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.guest_prompt_v2_enabled);
}

/** "Save your account" wording on every guest surface (save_account_copy_enabled). */
export function useSaveAccountCopyEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.save_account_copy_enabled);
}

/** Results: Rematch and Return to Lobby pinned in a footer, and no signup nudge after the results offered saving (components/game/ActionModal.tsx, pages/GamePage.tsx). */
export function useResultsFooterEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.results_footer_enabled);
}

/** The game screen sized to the visible screen, not 100vh (pages/GamePage.tsx, `.h-visible` in index.css). */
export function useGameVisibleHeightEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.game_visible_height_enabled);
}

/** Ranked ladder surfaces: the Ranked leaderboard tab + lobby Top Commanders. */
export function useRankedLeaderboardEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.ranked_leaderboard_enabled);
}

export function useDailyGuestPlayEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.daily_guest_play_enabled);
}

/** Guests see and use their own achievements, unlocked cosmetics, gold and settings (guest_personal_features_enabled). */
export function useGuestPersonalFeaturesEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.guest_personal_features_enabled);
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

export function useAsyncTurnAlertsEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.async_turn_alerts_enabled);
}

/**
 * Warfront (experimental RTS mode). Client-side this only decides what the
 * Admin → Warfront tab says; the server enforces admin + flag on every request.
 */
export function useWarfrontEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.warfront_enabled);
}

/**
 * The Galactic Age tutorial track (src/tutorial/modules/galaxy*). On by
 * default. Off (the admin kill switch), the Academy lists the five core
 * lessons only and nothing recommends a galaxy one; the server refuses to
 * start one either way.
 */
export function useGalaxyTutorialEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.galaxy_tutorial_enabled);
}

/** The Galactic Age open beta: every signed-in player may play it, labelled Beta (constants/galacticAgeAccess.ts). */
export function useGalaxyAgeBetaEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.galaxy_age_beta_enabled);
}

/** The lobby menu's Feedback entry (components/feedback/FeedbackModal.tsx). */
export function useFeedbackMenuEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.feedback_menu_enabled);
}

export function useAttackBlitzEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.attack_blitz_enabled);
}

export function useBackgroundMusicEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.background_music_enabled);
}

/**
 * Localized landing page + tutorial (src/i18n). Off — the dark-launch default —
 * renders English for everyone and hides the language switcher; on lets the
 * stored `cc-lang` choice, then the browser language, pick the bundle.
 */
export function useLocalizationEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.localization_enabled);
}

/** Touch targets: 44px touch areas for small game controls on touch screens (hooks/useTouchTargetsRoot.ts marks the document; index.css does the rest). */
export function useTouchTargetsEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.touch_targets_enabled);
}

/**
 * Daily Challenge v2 (docs/DAILY_PUZZLE_V2.md). The server decides whether a
 * day is served as a decision puzzle; the client renders the v2 block it is
 * sent either way. This hook only tells surfaces that the mode is switched on.
 */
export function useDailyPuzzleV2Enabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.daily_puzzle_v2_enabled);
}

/** First turn clock: hold the countdown while the game-start briefing is open on the player's first turn (GameHUD, gameSocket game:turn_ready). */
export function useFirstTurnClockWaitEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.first_turn_clock_wait_enabled);
}

/**
 * The store overhaul: cosmetics rendered where players see each other, the
 * banner slot, unequipping. Off, every surface renders exactly as before.
 */
export function useStoreV2Enabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.store_v2_enabled);
}

/**
 * The Space Age Moon Race, one operator switch for the whole lunar package.
 * The Custom Game form reads it to say whether a Space Age game can also be
 * won by the Lunar Hegemony, which rides with it.
 */
export function useSpaceAgeMoonRaceEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.space_age_moon_race_enabled);
}

/** A player's first Quick Match is one Easy bot on a small map (utils/firstMatch.ts). */
export function useFirstMatchEasyEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.first_match_easy_enabled);
}

/** Game loading: the route skeleton on /tutorial and /game/ names the match being set up (components/ui/GameLoadingFallback.tsx). */
export function useGameLoadingLabelEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.game_loading_label_enabled);
}

/** Phone tutorial keeps the tech tree's controls in view at the era gate (components/game/TutorialOverlay.tsx). */
export function useTutorialPhoneGateVisibleEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.tutorial_phone_gate_visible_enabled);
}

/** Desktop HUD offers a one-click card trade during the draft when a set is ready (components/game/GameHUD.tsx). */
export function useDesktopCardCueEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.desktop_card_cue_enabled);
}

/** Battle result: armies left beside both territory names on your own attack, and a blitz's dice labelled as its last roll (components/game/ActionModal.tsx). */
export function useBattleArmiesEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.battle_armies_enabled);
}

/** Battle colours by player: battle dice and names in each player's map colour (ActionModal CombatResultView). */
export function useBattlePlayerColorsEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.battle_player_colors_enabled);
}

/** The tutorial wrap-up's main button starts the first real match (components/game/TutorialOverlay.tsx). */
export function useTutorialWrapupToMatchEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.tutorial_wrapup_to_match_enabled);
}

/** While the next Quick Match is the player's first, it is the lobby's gold button (pages/LobbyPage.tsx). */
export function useFirstMatchPrimaryCtaEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.first_match_primary_cta_enabled);
}

/** Phone fortify: the territory sheet grows to show the amount dial and the first destination row together (components/game/TerritoryPanel.tsx). */
export function usePhoneFortifyFitEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.phone_fortify_fit_enabled);
}

/** In-game mute: one sound and music switch in the HUD's Tools & options, on desktop and in the phone menu (components/game/GameHUD.tsx). */
export function useInGameMuteEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.in_game_mute_enabled);
}

/** A Full Game fits an evening: the 65% ending by default, an 80-round cap (utils/quickMatchPrefs.ts). */
export function useFullGameEveningEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.full_game_evening_enabled);
}

/** Placement cap note: explain the stability deploy cap where units are placed (components/game/PlacementCapNote.tsx). */
export function usePlacementCapNoteEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.placement_cap_note_enabled);
}

/** The Custom Game form folds its less-used options under Advanced (pages/LobbyPage.tsx). */
export function useCustomLobbyFoldEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.custom_lobby_fold_enabled);
}

/** The Custom Game form sets a round limit (pages/LobbyPage.tsx, utils/customRoundLimit.ts). */
export function useCustomRoundCapEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.custom_round_cap_enabled);
}

/** Loss reason: a "Why you lost" line on the defeat screen (utils/lossReason.ts). */
export function useLossReasonEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.loss_reason_enabled);
}

export function useMissionRevealEnabled(): boolean {
  return useFeatureFlagsStore((s) => s.flags.mission_reveal_enabled);
}
