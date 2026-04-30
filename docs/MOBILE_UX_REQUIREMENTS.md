# Mobile UX Requirements & Implementation Plan

> Eras of Empire — Mobile-First Improvement Initiative  
> Target: phones (375–430 px wide, iOS & Android), tablets handled as a bonus.  
> Breakpoints in use: `sm` = 640 px · `md` = 768 px · `lg` = 1024 px.

---

## Why this matters

Testing against iPhone-class viewports (375–390 px) revealed that several user-critical flows — landing, lobby, game creation, and in-game controls — overflow, wrap, or strand users on loading screens. Because the vast majority of users are expected to play via mobile browser or Capacitor app, these issues are launch-blockers for retention.

---

## PR A — Hide TopNavBar on phones

### Problem
`TopNavBar` is a desktop-only component (no responsive CSS) but is rendered unconditionally in `LobbyPage`. On phones it overflows horizontally, shows a scrollbar, and competes with `MobileTabBar` which is already the correct mobile nav pattern.

### Requirements
1. `TopNavBar` must not be visible below the `md` breakpoint (768 px).
2. `MobileTabBar` remains the sole navigation on phones.
3. No change to `TopNavBar` itself (keep it for desktop).

### Files changed
- `frontend/src/pages/LobbyPage.tsx` — wrap `<TopNavBar>` in `<div className="hidden md:block">`.

### Acceptance criteria
- At 390 px: no horizontal scroll on `/lobby`.
- At 390 px: `MobileTabBar` visible at bottom.
- At 800 px+: `TopNavBar` visible at top, `MobileTabBar` hidden (it already has `flex md:hidden`).

---

## PR B — Mobile-first Create Game modal

### Problem
- Welcome banner button row (`New Game / Watch a Game / War Room`) overflows on mobile; three `flex-1 sm:flex-none` buttons in one row at 390 px.
- Advanced Features checkbox grid uses `sm:grid-cols-3` which kicks in at 640 px — can cause narrow items at small `sm` widths.
- Active game cards have a small trash icon directly adjacent to the primary `Resume` button — mistap risk; no mobile-friendly confirmation.

### Requirements
1. Welcome banner buttons: stack to a 2-column grid (`grid-cols-2`) on mobile, full `flex-row` on `sm:+`.
2. Advanced Features checkboxes: stay 1-col until `md` (`md:grid-cols-3`), use 2-col at `sm` (`sm:grid-cols-2`).
3. Active game Delete button: trigger a confirm state (inline "Really? / Cancel" text buttons), not an immediate action.
4. Create Game modal form itself is already `grid-cols-1 md:grid-cols-2` — verify and keep.

### Files changed
- `frontend/src/pages/LobbyPage.tsx` — welcome banner buttons grid, Advanced Features grid col counts, active games delete confirm.

### Acceptance criteria
- At 390 px: button row shows 2 columns, no overflow.
- Tapping Delete shows inline confirm before abandoning.
- Feature checkboxes readable at all widths.

---

## PR C — Real "Quick Solo Match" (direct launch)

### Problem
"Quick Solo Match" CTA description says "1v3 AI in the Ancient World — a 20-min game" implying one-tap start, but actually opens the Configure New Game modal with presets — contradicting the UX promise.

### Requirements
1. The "Quick Solo Match" button directly creates the game (3 AI bots, Ancient World, medium difficulty, 5-min timer) and navigates to it — no modal.
2. Show a loading state ("Starting game…") on the button while the API call completes.
3. Error → `toast.error`.

### Files changed
- `frontend/src/pages/LobbyPage.tsx` — replace the `onClick` handler on Quick Solo Match button.

### Acceptance criteria
- Tapping "Quick Solo Match" navigates to `/game/:id` within 2 s (network permitting).
- No modal opens.

---

## PR D — Game-loading error states

### Problem
When the API for a game returns 4xx/5xx, or the socket fails to connect after creation, users see "Loading lobby…" indefinitely with no recovery path.

### Requirements
1. Track a `lobbyError` state in `GamePage`.
2. If `game:lobby_updated` has not fired within 15 s after socket join, show an error UI.
3. If the initial game fetch (REST) fails with 4xx/5xx, immediately show the error UI.
4. Error UI: brief message + "Try again" (re-join socket) + "Back to Lobby" (navigate).
5. The existing socket reconnect banner (lines 2073–2086) is retained for mid-game disconnects.

### Files changed
- `frontend/src/pages/GamePage.tsx` — add `lobbyError` / `lobbyTimeout` state and error render branch in the `!gameStarted` lobby section.

### Acceptance criteria
- If backend is unreachable: within 15 s user sees error with "Back to Lobby" button.
- "Try again" re-emits `game:join` and resets the timer.
- No infinite spinner.

---

## PR E — Landing page nav + hero mobile pass

### Problem
- `LandingPage` nav shows all 4 buttons (`Learn to play / Play as Guest / Sign In / Play Free`) in a row — wraps to 3 rows at 390 px.
- Hero CTA row (`Play Free Now / Learn to play / Sign In`) is 3 wide with `text-lg px-10` — wraps awkwardly.
- "Learn to play" is already `hidden sm:inline-flex` on the nav but the remaining 3 buttons still wrap.

### Requirements
1. Nav: below `sm`, show only logo + "Play as Guest" + "Sign In" in the nav (2 buttons max). Move "Play Free" to be part of the hero CTA.
2. Hero CTA: stack vertically on mobile (`flex-col gap-3`), full-width buttons. Horizontal row on `sm:+`.
3. Era card grid: already `grid-cols-2` on mobile — acceptable; no change.
4. Footer: already fine.

### Files changed
- `frontend/src/pages/LandingPage.tsx` — nav button visibility + hero CTA layout.

### Acceptance criteria
- At 390 px: nav fits in one row with no overflow.
- Hero CTA buttons are full-width stacked on mobile.

---

## PR F — Globe touch hardening

### Problem
- The globe canvas wrapper div does not set `touch-action: none` / `overscroll-behavior: contain`, so browser-level pinch-zoom competes with Three.js OrbitControls.
- Single-finger pan can be misread as a tap, preventing territory selection.
- HTML label overlays at `font-size: 10px` are nearly illegible on a 390-px globe.

### Requirements
1. Wrapping `<div>` of the globe canvas: add `style={{ touchAction: 'none', overscrollBehavior: 'contain' }}`.
2. Add a drag threshold (~8 px movement delta): only fire `onTerritoryClick` if pointer moved < threshold from pointerdown.
3. HTML territory labels: hide labels that would overlap (already handled by react-globe.gl's label altitude), and add a minimum `font-size: 11px` on the HTML label element string.

### Files changed
- `frontend/src/components/game/GlobeMap.tsx` — wrapper div style, label font-size, onClick threshold guard.

### Acceptance criteria
- Pinching the globe does not zoom the browser chrome on iOS/Android.
- Tapping a territory reliably fires `onTerritoryClick` (not a drag mis-fire).

---

## PR G — Loading skeletons + lite-mode + auto-spin defaults

### Problem
- Slow networks (3G/mobile data) show only "Preparing the next front…" with no progress signal for 8–15 s.
- Auto-spin is on by default even on `prefers-reduced-motion` devices.
- No lite-mode option for low-end devices.

### Requirements
1. `RouteLoadingFallback` (in `App.tsx`): add a pulsing skeleton placeholder (2 cards + a map rectangle) instead of plain text.
2. `device.ts::getGlobeSpinPreference()`: return `false` if `prefersReducedMotion()` is true, regardless of localStorage.
3. `device.ts`: export a new `isLiteMode()` function that reads `localStorage` key `cc-lite-mode`.
4. `device.ts`: export `persistLiteMode(enabled: boolean)`.
5. In-game top bar (GamePage): when `isLiteMode()`, render a small "Lite" badge and skip globe animations.
6. Lite mode toggle: surface inside the mobile HUD drawer (`GameHUD.tsx` footer area, mobile only).

### Files changed
- `frontend/src/App.tsx` — improved `RouteLoadingFallback`.
- `frontend/src/utils/device.ts` — `getGlobeSpinPreference` fix, new `isLiteMode` / `persistLiteMode`.
- `frontend/src/components/game/GameHUD.tsx` — lite-mode toggle in footer (mobile only).
- `frontend/src/pages/GamePage.tsx` — pass `isLiteMode()` into `reducedGlobe` logic.

### Acceptance criteria
- Fallback shows a visible skeleton, not just text.
- On a device with `prefers-reduced-motion: reduce`, globe does not auto-spin.
- Toggling Lite mode in the HUD drawer persists across sessions.

---

## PR H — Mobile bottom-bar enrichments

### Problem
- Async-mode deadline is only visible inside the HUD drawer (hidden by default on mobile).
- The "Globe / 2D Map / Spin" toggle row in the game header adds 3+ rows of wrapping text at 390 px.

### Requirements
1. Mobile bottom bar (GamePage lines 2266–2330): when `gameState.settings.async_mode` is true, surface the remaining time chip directly in the bar next to the phase label.
2. Game header: move the "Globe / 2D Map" toggle to be `hidden md:flex` (desktop) and instead put a compact icon-only toggle in the mobile HUD drawer or as a floating pill near the map-view toggle area.
3. Keep "Spin" toggle inside the HUD drawer (mobile only).

### Files changed
- `frontend/src/pages/GamePage.tsx` — mobile bottom bar async time chip; header toggle visibility.

### Acceptance criteria
- In async game on mobile: remaining time visible in the always-on bottom bar without opening the drawer.
- Game header on mobile: no Globe/2D text buttons competing for vertical space; accessible via drawer.

---

## PR I — Modal sizing contract

### Problem
Several modals (`TechTreeModal`, `BonusesModal`, `EventCardModal`, `InviteFriendsModal`, `GameShortcutsModal`, `FactionLoreModal`) were built with desktop-first grids and may overflow or clip on narrow phones.

### Requirements
1. Every modal that does **not** already use the shared `Modal` component: audit and confirm it has:
   - `max-w-lg` or smaller (or `max-w-2xl` with inner single-column on mobile).
   - `max-h-[92dvh]` or equivalent.
   - `overflow-y-auto`.
   - `pb-safe` / `pt-safe` or equivalent safe-area handling.
2. Modals that use a custom backdrop: ensure backdrop click fires `onClose`.
3. All modal close buttons: minimum `min-h-[44px] min-w-[44px]` touch target.
4. `TechTreeModal`: tech nodes grid (`grid-cols-2 md:grid-cols-3`) — check and enforce.
5. `BonusesModal`: single-column list, fine on mobile; add `pb-safe`.
6. `EventCardModal`: choice buttons must be `w-full` on mobile.
7. `InviteFriendsModal`: friend list scroll area must not exceed `max-h-[50vh]`.

### Files changed
- `frontend/src/components/game/TechTreeModal.tsx`
- `frontend/src/components/game/BonusesModal.tsx`
- `frontend/src/components/game/EventCardModal.tsx`
- `frontend/src/components/game/InviteFriendsModal.tsx`
- `frontend/src/components/game/GameShortcutsModal.tsx`
- `frontend/src/components/game/FactionLoreModal.tsx`

### Acceptance criteria
- All modals open without horizontal overflow at 390 px.
- Close button reachable with thumb (top-right, min 44 px).
- Scrollable on long content.

---

## Implementation order

| PR | Effort | Risk | First |
|----|--------|------|-------|
| A | XS | Low | ✓ |
| C | XS | Low | ✓ |
| E | S | Low | ✓ |
| D | S | Low | ✓ |
| B | M | Low | |
| H | M | Low | |
| G | M | Medium | |
| F | M | Medium | |
| I | L | Low | |

Each PR is independently deployable and does not touch server-authoritative game logic.
