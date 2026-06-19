import { create } from 'zustand';
import { api } from '../services/api';

export interface ClientFeatureFlags {
  map_editor_enabled: boolean;
  era_advancement_lobby_enabled: boolean;
}

const DEFAULT_FLAGS: ClientFeatureFlags = {
  map_editor_enabled: false,
  // Mirrors the backend default (on) so the Full Game CTA + Era Advancement toggle
  // paint immediately; GET /feature-flags still reconciles (admin can override off).
  era_advancement_lobby_enabled: true,
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
