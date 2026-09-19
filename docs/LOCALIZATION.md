# Localization — landing page and tutorial

> How the UI is translated, what is and is not, and the routine for adding a string or a language. Source of truth: [`frontend/src/i18n/`](../frontend/src/i18n/). Status: **current**.

## What is localized

| Surface | Bundle | Notes |
|---|---|---|
| Landing page (`/`) — every visible string, including the ten built-in era cards | `landing` | Community map names and blurbs come from the map data and stay as their authors wrote them. |
| Tutorial lesson picker (`/tutorial`) | `tutorial` → `page.*` | |
| In-game coaching overlay (buttons, step counter, wait prompts) | `tutorial` → `overlay.*` | |
| The five lessons' cards and the module names | `tutorial` → `steps.<lesson>.<stepId>.<field>`, `modules.<lesson>.*` | English lives in the code; see below. |
| Shared bits (the picker label, "Starting…") | `common` | |

**Not localized:** the in-game HUD, the lobby, the codex, the marketing/SEO routes (`/eras`, `/how-to-play`, …), emails, push notifications. Because the HUD is still English, tutorial translations name the buttons and panels the player can actually see — **Advance Era**, the **Bonuses** panel, the phase button via `{{draftButton}}` — rather than translating labels that do not exist in the game.

Languages shipped: English (source), Spanish, Brazilian Portuguese, German, French. The translations were produced in-house and have **not had native review**; that review is the gate for promoting the flag (below).

## The flag

`localization_enabled` — `FLAG_CODE_DEFAULTS` in [`backend/src/config/featureFlags.ts`](../backend/src/config/featureFlags.ts), mirrored in `DEFAULT_FLAGS` in [`frontend/src/store/featureFlagsStore.ts`](../frontend/src/store/featureFlagsStore.ts), toggle in Admin → Config. **Off by default** (dark launch).

- **Off:** everyone gets English regardless of browser language or a stored preference, and the language switcher does not render. The translated bundles are in the build but nothing reads them, so a player sees exactly what they saw before this shipped.
- **On:** the language is chosen once before first paint (`main.tsx` applies the client-side code default) and re-applied when `GET /feature-flags` lands (`App.tsx`), so an admin override that differs from the code default still wins — at the cost of one visible swap for that visitor.

To promote: turn it on as an admin override on staging, read every surface in every language, fix what native reviewers flag, then flip the code default to ON in **both** `FLAG_CODE_DEFAULTS` and `DEFAULT_FLAGS` (a mismatch shows English on first paint and swaps a moment later) and prune the override.

## How the language is chosen

`detectLocale` in [`locales.ts`](../frontend/src/i18n/locales.ts), in order:

1. The stored preference, `cc-lang` in localStorage (via `safeStorage`, so a portal iframe that denies storage still works for the page load). Sanitized on every read: anything that is not a shipped locale is ignored, never passed through.
2. `navigator.languages`, first match wins. Matching is exact and case-insensitive first (`pt-br` → `pt-BR`), then by base language (`de-AT` → `de`, `pt-PT` → `pt-BR`).
3. English.

Switching through the picker persists the choice and syncs `<html lang>`. Bundles for a language load lazily as their own chunk **before** the switch happens, so no key ever renders untranslated mid-switch; if the chunk fails to load the current language simply stays.

## Files

| File | Role |
|---|---|
| `frontend/src/i18n/locales.ts` | `SUPPORTED_LOCALES`, native names, `sanitizeLocale`, `detectLocale` (pure) |
| `frontend/src/i18n/languagePreference.ts` | `cc-lang` read/write |
| `frontend/src/i18n/index.ts` | the i18next instance (English inline, others lazy), `setLanguage`, `applyLocalizationPolicy` |
| `frontend/src/i18n/locales/<lang>/{common,landing,tutorial}.json` | the bundles; `en/` is the source |
| `frontend/src/tutorial/localize.ts` | resolves tutorial card and module copy with the English as `defaultValue`; lists every key a language must cover |
| `frontend/src/data/landingEras.ts` | the era cards' non-copy data (ids, colours, counts) |
| `frontend/src/components/ui/LanguageSwitcher.tsx` | the picker; renders nothing while the flag is off |
| `frontend/src/i18n/localeBundles.test.ts` | parity and coverage: every language has exactly the English keys, every tutorial card is covered, placeholders match |

## Adding or changing a string

- **Landing or common copy:** edit `locales/en/<ns>.json` (the source), then every other language's file. `localeBundles.test.ts` fails on a key present in one language and missing in another, so a string cannot ship half-translated. The English hero tagline, description and CTA tagline must stay identical to the constants in `constants/brand.ts` — the same test pins that.
- **A tutorial card:** edit the module under `frontend/src/tutorial/modules/` as before; the English there is the runtime default. Then add `steps.<lesson>.<stepId>.<field>` to every language's `tutorial.json`. The coverage test derives the required keys from the modules themselves, so a new card or a new copy field fails the test until it is translated. Keys are scoped by lesson because step ids repeat across lessons with different copy (`ea_research` exists in both `core` and `era_advancement`).
- **Placeholders:** `{{name}}` is i18next interpolation and must appear in a translation exactly where the English has it (`{{range}}`, `{{appName}}`, `{{minutes}}`, `{{current}}`, `{{total}}`). Tutorial cards may additionally use `{{draftButton}}`, `{{attackButton}}` and `{{fortifyButton}}` for the gold phase buttons, whose English labels come from `phaseAdvanceLabel` at render time. `{playerColor}` (single braces) is not interpolation: the overlay replaces it with the player's colour name, so it must appear iff the English has it. `**bold**` renders as emphasis.
- Never hard-code a visible string in `LandingPage.tsx`, `TutorialPage.tsx` or `TutorialOverlay.tsx`; everything there goes through `t()`.
- Editing the English of an existing key does not fail any test — remember to update the translations, or they will silently say the old thing.

## Adding a language

1. Append the tag to `SUPPORTED_LOCALES` and its native name to `LOCALE_NAMES` in `locales.ts`. Use the tag players expect (`pt-BR`, not `pt`), since `sanitizeLocale` maps base languages onto it.
2. Create `locales/<tag>/common.json`, `landing.json` and `tutorial.json` with exactly the English key set; for `tutorial.json` also every `modules.*` and `steps.*` key (run the bundle test to get the list of what is missing).
3. Run `cd frontend && npx vitest run src/i18n` — parity, coverage and placeholder checks — and `pnpm -C frontend exec tsc --noEmit`.
4. Nothing else changes: the lazy loader picks the new files up by path.

## Verification

```bash
cd frontend && npx vitest run src/i18n src/tutorial/localize src/pages/LandingPage   # bundles, detection, policy, a Spanish render
pnpm -C frontend exec tsc --noEmit
pnpm run test:backend                                                               # the flag's default and override
```

By hand, with the flag forced on in Admin → Config: open `/` in a browser whose first language is Spanish and confirm the hero reads "Juega gratis ahora"; switch to another language in the footer picker, reload, and confirm it stuck (`cc-lang` in localStorage) and that `document.documentElement.lang` matches; open `/tutorial` and start a lesson, and confirm the coaching cards are translated while the gold phase button they name still matches the HUD. Then force the flag off and confirm everything is English again with no picker.

## Glossary

The terms every translation must keep consistent, and the English UI labels that are quoted rather than translated:

| English (concept) | es | pt-BR | de | fr |
|---|---|---|---|---|
| Draft / Reinforcement phase | Refuerzo | Reforço | Verstärkung | Renfort |
| Attack | Ataque | Ataque | Angriff | Attaque |
| Fortify | Fortificación | Fortificação | Befestigung | Fortification |
| Era | era | era | Zeitalter | ère |
| Advancement gate | puerta (de avance) | portão (de avanço) | (Aufstiegs-)Tor | seuil (de passage) |
| Vulnerability window | ventana de vulnerabilidad | janela de vulnerabilidade | Verwundbarkeitsfenster | fenêtre de vulnérabilité |
| Signature reward | recompensa distintiva | recompensa exclusiva | Signatur-Belohnung | récompense signature |
| Lobby | vestíbulo | lobby | Lobby | salon |
| Codex | Códice | Códice | Kodex | Codex |

Quoted as-is because the game shows them in English: territory names on the tutorial island (**Western Plains**, **Eastern Forest**, …), **Advance Era**, **Place** / **All**, the **Bonuses** and **Era** panels, faction and ability names (**Guerrilla Warfare**), technology names, and the phase labels the HUD prints ("Reinforcement").
