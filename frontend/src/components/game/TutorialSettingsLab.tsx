/**
 * TutorialSettingsLab — an interactive sandbox overlay for the Advanced Settings lesson.
 *
 * Presents the key toggles in explore-mode (changes are local-only, not sent to server).
 * When the player flips at least two distinct toggles the `onSettingsExplored` callback fires,
 * advancing the tutorial step that requireAction === 'settings_explored'.
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';

interface LabSetting {
  key: string;
  label: string;
  description: string;
  defaultOn: boolean;
  effectOn: string;
  effectOff: string;
}

const EXPLORER_THRESHOLD = 2;

const LAB_SETTINGS: LabSetting[] = [
  {
    key: 'fog_of_war',
    label: 'Fog of War',
    description: 'Hides enemy unit counts on territories you have not scouted.',
    defaultOn: false,
    effectOn: 'enemy unit counts stay hidden until you scout or attack.',
    effectOff: 'you always see exact enemy troop counts on the map.',
  },
  {
    key: 'factions_enabled',
    label: 'Factions',
    description: 'Each player picks a faction with a unique passive bonus and active ability.',
    defaultOn: false,
    effectOn: 'each player gets a faction passive and an active power.',
    effectOff: 'all players use the same baseline rules with no faction powers.',
  },
  {
    key: 'tech_trees_enabled',
    label: 'Technology Tree',
    description: 'Players earn Tech Points and research upgrades each turn.',
    defaultOn: false,
    effectOn: 'players earn Tech Points and unlock combat or economy upgrades.',
    effectOff: 'there is no research — only cards, dice, and territory control.',
  },
  {
    key: 'economy_enabled',
    label: 'Economy & Buildings',
    description: 'Territories generate gold; spend it to construct defense or production buildings.',
    defaultOn: false,
    effectOn: 'territories generate gold you can spend on buildings.',
    effectOff: 'there is no gold income — reinforcements come from cards and continents only.',
  },
  {
    key: 'events_enabled',
    label: 'Era Events',
    description: 'Random historical events fire each round — boons, disasters, or diplomatic crises.',
    defaultOn: false,
    effectOn: 'random era events can shift income, combat, or diplomacy each round.',
    effectOff: 'matches play out without surprise event cards.',
  },
  {
    key: 'diplomacy_enabled',
    label: 'Diplomacy',
    description: 'Propose truces and ceasefire pacts with other players.',
    defaultOn: true,
    effectOn: 'players can propose truces and temporary ceasefires.',
    effectOff: 'every border stays hostile — no truce proposals.',
  },
];

interface TutorialSettingsLabProps {
  onSettingsExplored: (values: Record<string, boolean>) => void;
  onClose: () => void;
}

export default function TutorialSettingsLab({
  onSettingsExplored,
  onClose,
}: TutorialSettingsLabProps) {
  const [values, setValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(LAB_SETTINGS.map((s) => [s.key, s.defaultOn])),
  );
  const [toggledKeys, setToggledKeys] = useState<Set<string>>(() => new Set());
  const [exploredComplete, setExploredComplete] = useState(false);

  function toggle(key: string) {
    const nextValues = { ...values, [key]: !values[key] };
    setValues(nextValues);

    setToggledKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      if (next.size >= EXPLORER_THRESHOLD && !exploredComplete) {
        setExploredComplete(true);
        onSettingsExplored(nextValues);
      }
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="tutorial-settings-lab"
    >
      <div className="w-full max-w-sm mx-4 rounded-2xl border border-bf-gold/30 bg-bf-surface shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-bf-border">
          <span className="font-display text-lg text-bf-gold">Settings Lab</span>
          <button
            type="button"
            onClick={onClose}
            className="text-bf-muted hover:text-bf-text transition-colors"
            aria-label="Close Settings Lab"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="px-5 pt-4 pb-2 text-xs text-bf-muted/70">
          Flip at least two toggles to preview how they change this match. Enabled options take effect
          when you close the lab.
        </p>

        <div className="px-5 pb-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {LAB_SETTINGS.map((setting) => {
            const isOn = values[setting.key];
            const wasToggled = toggledKeys.has(setting.key);
            return (
              <div key={setting.key}>
                <label
                  className="flex items-start gap-3 cursor-pointer select-none group"
                  data-testid={`lab-toggle-${setting.key}`}
                >
                  <div className="mt-0.5 shrink-0">
                    <div
                      onClick={() => toggle(setting.key)}
                      role="switch"
                      aria-checked={isOn}
                      className={`relative w-9 h-5 rounded-full transition-colors ${
                        isOn ? 'bg-bf-gold' : 'bg-bf-border'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          isOn ? 'translate-x-[18px]' : 'translate-x-0.5'
                        }`}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-bf-text group-hover:text-bf-gold transition-colors">
                      {setting.label}
                    </p>
                    <p className="text-xs text-bf-muted/70 mt-0.5">{setting.description}</p>
                  </div>
                </label>
                {wasToggled && (
                  <p className="ml-12 mt-1 text-xs text-bf-gold/80 italic">
                    With this {isOn ? 'on' : 'off'}, {isOn ? setting.effectOn : setting.effectOff}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {exploredComplete ? (
          <div className="px-5 pb-5">
            <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-4 py-2.5 text-sm text-emerald-300">
              ✓ 2 settings explored — close the lab to apply them to this match.
            </div>
          </div>
        ) : toggledKeys.size === 1 ? (
          <div className="px-5 pb-5">
            <div className="rounded-lg border border-bf-gold/30 bg-bf-gold/10 px-4 py-2.5 text-sm text-bf-gold/90">
              1 of 2 explored — flip one more toggle to continue.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
