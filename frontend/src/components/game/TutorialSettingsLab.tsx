/**
 * TutorialSettingsLab — an interactive sandbox overlay for the Advanced Settings lesson.
 *
 * Presents the key toggles, starting from what the practice match has on. Once the
 * player has flipped at least two distinct toggles, closing the lab hands every value
 * to `onSettingsExplored`, which applies them to the match (the server takes the
 * first submission only) and advances the step that requireAction === 'settings_explored'.
 * Before that, closing changes nothing.
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';

interface LabSetting {
  key: string;
  label: string;
  description: string;
  effectOn: string;
  effectOff: string;
}

const EXPLORER_THRESHOLD = 2;

const LAB_SETTINGS: LabSetting[] = [
  {
    key: 'fog_of_war',
    label: 'Fog of War',
    description: 'Hides enemy unit counts beyond your own borders.',
    effectOn: 'you see exact counts only on your territories and the ones bordering them.',
    effectOff: 'you always see exact enemy troop counts on the map.',
  },
  {
    key: 'factions_enabled',
    label: 'Factions',
    description: 'Each player plays a faction with its own active ability, and some add a passive bonus.',
    effectOn: 'each player gets a faction and its active power.',
    effectOff: 'all players use the same baseline rules with no faction powers.',
  },
  {
    key: 'tech_trees_enabled',
    label: 'Technology Tree',
    description: 'Players earn Tech Points and research upgrades each turn.',
    effectOn: 'players earn Tech Points and unlock combat or economy upgrades.',
    effectOff: 'there is no research — only cards, dice, and territory control.',
  },
  {
    key: 'economy_enabled',
    label: 'Economy & Buildings',
    description: 'Territories generate gold; spend it to construct defense or production buildings.',
    effectOn: 'territories generate gold you can spend on buildings.',
    effectOff: 'there is no gold and no buildings — reinforcements come from territories, regions and cards.',
  },
  {
    key: 'events_enabled',
    label: 'Era Events',
    description: 'Random historical events fire each round — boons, disasters, or diplomatic crises.',
    effectOn: 'random era events can shift income, combat, or diplomacy each round.',
    effectOff: 'matches play out without surprise event cards.',
  },
  {
    key: 'diplomacy_enabled',
    label: 'Diplomacy',
    description: 'Propose truces and ceasefire pacts with other players.',
    effectOn: 'players can propose truces and temporary ceasefires.',
    effectOff: 'every border stays hostile — no truce proposals.',
  },
];

interface TutorialSettingsLabProps {
  /**
   * What the practice match has on now, keyed like LAB_SETTINGS. The lab starts
   * there, so an option the player never touches is submitted as it already is.
   */
  initialValues: Partial<Record<string, boolean>>;
  onSettingsExplored: (values: Record<string, boolean>) => void;
  onClose: () => void;
}

export default function TutorialSettingsLab({
  initialValues,
  onSettingsExplored,
  onClose,
}: TutorialSettingsLabProps) {
  const [values, setValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(LAB_SETTINGS.map((s) => [s.key, initialValues[s.key] === true])),
  );
  const [toggledKeys, setToggledKeys] = useState<Set<string>>(() => new Set());
  const exploredComplete = toggledKeys.size >= EXPLORER_THRESHOLD;

  function toggle(key: string) {
    setValues((prev) => ({ ...prev, [key]: !prev[key] }));
    setToggledKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }

  function close() {
    if (exploredComplete) onSettingsExplored(values);
    onClose();
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
            onClick={close}
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
