# Mobile UX Enhancement — Requirements & Implementation Plan

> Audience: developers implementing these changes.
> Priority labels: **P0** (ship-blocking), **P1** (first-week patch), **P2** (fast-follow), **P3** (polish).

---

## Table of Contents

1. [M-01 Lobby Navigation Redesign (P0)](#m-01-lobby-navigation-redesign)
2. [M-02 Territory Tap vs Pan Disambiguation (P0)](#m-02-territory-tap-vs-pan-disambiguation)
3. [M-03 Swipe-to-Dismiss Bottom Sheets (P1)](#m-03-swipe-to-dismiss-bottom-sheets)
4. [M-04 Adaptive Territory Label Sizing (P1)](#m-04-adaptive-territory-label-sizing)
5. [M-05 Haptic Feedback on Native (P1)](#m-05-haptic-feedback-on-native)
6. [M-06 Landscape Layout Adaptation (P2)](#m-06-landscape-layout-adaptation)
7. [M-07 Keyboard Avoidance for Chat (P2)](#m-07-keyboard-avoidance-for-chat)
8. [M-08 Pull-to-Refresh on Lobby (P3)](#m-08-pull-to-refresh-on-lobby)
9. [M-09 Font Loading Optimization (P3)](#m-09-font-loading-optimization)
10. [M-10 Double-Tap Zoom Behavior (P3)](#m-10-double-tap-zoom-behavior)
11. [M-11 Capacitor Plugin Hardening (P2)](#m-11-capacitor-plugin-hardening)
12. [M-12 Mobile Overlay Budget (P0)](#m-12-mobile-overlay-budget)
13. [M-13 Mobile Frame Budget (P0)](#m-13-mobile-frame-budget)

---

## M-01 Lobby Navigation Redesign

**Priority:** P0 — First screen users see; broken UX on small devices.

### Current State

`LobbyPage.tsx` line 675 renders a `<nav>` with 9–11 inline `<Link>` elements inside a `flex-wrap` container. On a 375 px screen these wrap into 3–4 rows, consuming ~120–160 px of vertical space and creating an overwhelming, cluttered header.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | On viewports < 768 px, replace the inline link list with a **persistent bottom tab bar** containing 4–5 primary destinations (Home/Play, Friends, Profile, More). |
| R2 | The "More" tab opens a half-screen bottom sheet listing secondary links (Map Hub, Daily, Store, Map Editor, Leaderboards, Live, Privacy, Logout). |
| R3 | The top bar on mobile is reduced to: logo (left) + gold/coins indicator (right, if applicable). |
| R4 | On desktop (≥ 768 px) the current inline nav is preserved unchanged. |
| R5 | Tab bar respects `pb-safe` for safe-area inset on notched devices. |
| R6 | Active tab is visually highlighted with `bf-gold` color. |
| R7 | Each tab icon uses a `lucide-react` icon with a text label beneath (≤ 10 px font, matching existing `text-bf-muted`/`text-bf-gold` patterns). |

### Implementation Steps

1. **Create `frontend/src/components/ui/MobileTabBar.tsx`.**
   - Accept a `currentPath: string` prop (from `useLocation()`).
   - Render a `<nav>` fixed to the bottom with classes: `fixed bottom-0 inset-x-0 z-40 flex md:hidden items-center justify-around bg-bf-surface border-t border-bf-border pb-safe min-h-[56px]`.
   - Tabs: `Home` (`/lobby`, `Home` icon), `Play` (opens create-game modal or navigates to `/lobby#create`), `Friends` (`/friends`, `Users` icon), `Profile` (`/profile`, `User` icon), `More` (toggles a state boolean).
   - "More" tab renders a bottom sheet (reuse the `mobile-bottom-sheet` CSS class from `index.css`) listing the remaining links with consistent `min-h-[44px]` touch targets and `text-sm` labels.

2. **Modify `LobbyPage.tsx` nav.**
   - Wrap the existing inline links in `hidden md:flex` so they remain on desktop.
   - Import and render `<MobileTabBar />` at the bottom of the page return, outside the scrollable content area.
   - Add `pb-[72px] md:pb-0` to the scrollable main content `<div>` to account for the tab bar height.

3. **Simplify the mobile top bar.**
   - Inside the `<nav>` at line 675, add `hidden md:flex` to the link container `<div>`.
   - For mobile, render only the logo link and optionally a gold/currency badge.

4. **Test.**
   - Verify all 9+ destinations remain accessible on mobile via the tab bar + More sheet.
   - Verify desktop layout is unchanged.
   - Verify safe-area insets render correctly in iOS simulator.

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/ui/MobileTabBar.tsx` | New file |
| `frontend/src/pages/LobbyPage.tsx` | Hide inline nav on mobile, render `MobileTabBar`, add bottom padding |

---

## M-02 Territory Tap vs Pan Disambiguation

**Priority:** P0 — Causes accidental territory selections during every pan gesture.

### Current State

`GameMap.tsx` line 158 fires `onTerritoryClickRef.current(territory.territory_id)` on the PixiJS `pointerdown` event. Any pan that starts on a territory triggers a selection *before* the pan gesture is detected.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | Territory selection fires only when the pointer is released within ≤ 10 px of the down position AND the hold duration is < 300 ms. |
| R2 | If the pointer moves > 10 px before release, the gesture is treated as a pan and no territory is selected. |
| R3 | Desktop mouse clicks remain instantaneous (no perceptible delay for click). |

### Implementation Steps

1. **Replace `pointerdown` with a tap-detection pattern in the territory loop (`GameMap.tsx` ~line 158).**

   ```ts
   // Instead of:
   g.on('pointerdown', () => onTerritoryClickRef.current(territory.territory_id));

   // Use:
   let downPos: { x: number; y: number } | null = null;
   let downTime = 0;
   g.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
     downPos = { x: e.globalX, y: e.globalY };
     downTime = Date.now();
   });
   g.on('pointerup', (e: PIXI.FederatedPointerEvent) => {
     if (!downPos) return;
     const dist = Math.hypot(e.globalX - downPos.x, e.globalY - downPos.y);
     const elapsed = Date.now() - downTime;
     if (dist <= 10 && elapsed < 300) {
       onTerritoryClickRef.current(territory.territory_id);
     }
     downPos = null;
   });
   g.on('pointerupoutside', () => { downPos = null; });
   ```

2. **Verify the existing canvas-level pan handler (`onPointerDown` at line 208) does not conflict.**
   - The canvas `pointerdown` sets `isDragging = true`; the PixiJS graphic `pointerup` fires only when the finger lifts on the same graphic. The two should coexist since the canvas handler uses native DOM events and the territory handler uses PixiJS federated events.

3. **Test.**
   - On a touch device or Chrome DevTools mobile emulation: pan across territories and confirm no accidental selections.
   - Tap a territory cleanly and confirm it selects.
   - Verify on desktop that clicking feels instant (the 300 ms cap is only relevant to long-press, not quick clicks).

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/game/GameMap.tsx` | Replace `pointerdown` handler with tap-detection pattern (~15 lines) |

---

## M-03 Swipe-to-Dismiss Bottom Sheets

**Priority:** P1 — Drag handles are visual-only; users expect swipe interaction.

### Current State

`TerritoryPanel.tsx` (line 82) and `MobileCardsTray.tsx` (line 42) both render a drag handle (`<div className="w-8 h-1 rounded-full bg-bf-border" />`) with no touch event handling. Users see the handle and attempt to swipe down to dismiss, but nothing happens.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | Swiping down on the drag handle area (or the top ~40 px of the sheet) by ≥ 80 px calls `onClose()`. |
| R2 | During the swipe, the sheet translates downward following the finger (visual feedback). |
| R3 | If the swipe distance is < 80 px on release, the sheet snaps back to its open position. |
| R4 | The swipe only activates on vertical movement; horizontal scroll inside the sheet is unaffected. |
| R5 | Implement as a shared hook to avoid duplicating logic. |

### Implementation Steps

1. **Create `frontend/src/hooks/useSwipeToDismiss.ts`.**

   ```ts
   import { useRef, useCallback, type TouchEvent as ReactTouchEvent } from 'react';

   interface SwipeToDismissOptions {
     onDismiss: () => void;
     threshold?: number;       // px, default 80
   }

   export function useSwipeToDismiss({ onDismiss, threshold = 80 }: SwipeToDismissOptions) {
     const sheetRef = useRef<HTMLDivElement>(null);
     const startY = useRef(0);
     const currentY = useRef(0);

     const onTouchStart = useCallback((e: ReactTouchEvent) => {
       startY.current = e.touches[0].clientY;
       currentY.current = startY.current;
       if (sheetRef.current) sheetRef.current.style.transition = 'none';
     }, []);

     const onTouchMove = useCallback((e: ReactTouchEvent) => {
       currentY.current = e.touches[0].clientY;
       const dy = Math.max(0, currentY.current - startY.current);
       if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
     }, []);

     const onTouchEnd = useCallback(() => {
       const dy = currentY.current - startY.current;
       if (sheetRef.current) {
         sheetRef.current.style.transition = 'transform 0.2s ease-out';
         if (dy >= threshold) {
           sheetRef.current.style.transform = 'translateY(100%)';
           setTimeout(onDismiss, 200);
         } else {
           sheetRef.current.style.transform = 'translateY(0)';
         }
       }
     }, [onDismiss, threshold]);

     return { sheetRef, onTouchStart, onTouchMove, onTouchEnd };
   }
   ```

2. **Integrate into `TerritoryPanel.tsx`.**
   - Import `useSwipeToDismiss`.
   - Call `const { sheetRef, onTouchStart, onTouchMove, onTouchEnd } = useSwipeToDismiss({ onDismiss: onClose });`.
   - Attach `ref={sheetRef}` to the mobile outer `<div>`.
   - Attach `onTouchStart`, `onTouchMove`, `onTouchEnd` to the drag handle wrapper `<div>`.

3. **Integrate into `MobileCardsTray.tsx`** — same pattern as step 2.

4. **Test.**
   - Swipe down > 80 px → sheet dismisses with slide-down animation.
   - Swipe down < 80 px → sheet snaps back.
   - Scroll content inside the sheet → no accidental dismiss.

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/useSwipeToDismiss.ts` | New file (~40 lines) |
| `frontend/src/components/game/TerritoryPanel.tsx` | Import hook, wire up drag handle |
| `frontend/src/components/game/MobileCardsTray.tsx` | Import hook, wire up drag handle |

---

## M-04 Adaptive Territory Label Sizing

**Priority:** P1 — Labels at `fontSize: 10` are illegible on phone screens.

### Current State

`GameMap.tsx` line 172 uses a hardcoded `fontSize: 10` for territory name labels and line 391 uses `fontSize: 9` for building icons. These are fixed regardless of canvas size or zoom level.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | Base font size for territory labels scales with canvas width: `Math.max(10, Math.round(canvasW / 80))` (yields ~12 on 375 px, ~14 on 1080 px, ~10 floor on very small). |
| R2 | Building icon text uses the same formula minus 1 (`labelSize - 1`). |
| R3 | When the map is zoomed out below 0.6× scale, territory labels are hidden to reduce clutter. When zoomed in above 0.6×, they are shown. |
| R4 | The show/hide transition updates on each zoom change (inside the `onPointerMove` / `onWheel` handlers). |

### Implementation Steps

1. **Compute a `baseLabelSize` variable in the init `useEffect` (around line 130).**

   ```ts
   const baseLabelSize = Math.max(10, Math.round(canvasW / 80));
   ```

2. **Replace the hardcoded `fontSize: 10` on line 172 with `fontSize: baseLabelSize`.**

3. **Replace the hardcoded `fontSize: 9` on line 391 with `fontSize: baseLabelSize - 1`.**

4. **Add a `labelContainer.visible` toggle.**
   - After `scaleAllLayers(s)` is called in both `onPointerMove` (pinch zoom) and `onWheel`, add:
     ```ts
     labelContainer.visible = s >= 0.6;
     ```
   - This hides labels when zoomed out too far, reducing noise on small screens.

5. **Test.**
   - On a 375 px viewport, labels render at ~12 px — measurably larger.
   - Pinch-zoom out far → labels disappear; zoom in → labels reappear.
   - Desktop at 1920 px → labels at ~24 px, reasonable.
   - If 24 feels too large on large screens, cap with: `Math.min(16, Math.max(10, …))`.

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/game/GameMap.tsx` | Compute `baseLabelSize`, use in 2 places, add visibility toggle (~10 lines changed) |

---

## M-05 Haptic Feedback on Native

**Priority:** P1 — Native app currently feels like a web view; haptics add tactile polish.

### Current State

No usage of `@capacitor/haptics` anywhere in the codebase. The package is not installed. Capacitor config only lists `SplashScreen` and `StatusBar` plugins.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | Install `@capacitor/haptics`. |
| R2 | Create a thin utility module that calls `Haptics.impact()` on native and is a no-op on web. |
| R3 | Add haptic feedback at these interaction points: territory tap (light), attack action (medium), dice roll result (medium), turn change notification (light), card redemption (heavy — success). |
| R4 | Respect `prefersReducedMotion()` — skip haptics if the user has reduced motion enabled. |

### Implementation Steps

1. **Install the package.**

   ```bash
   cd frontend && pnpm add @capacitor/haptics
   ```

2. **Create `frontend/src/utils/haptics.ts`.**

   ```ts
   import { Capacitor } from '@capacitor/core';
   import { prefersReducedMotion } from './device';

   let Haptics: typeof import('@capacitor/haptics').Haptics | null = null;

   if (Capacitor.isNativePlatform()) {
     import('@capacitor/haptics').then((mod) => { Haptics = mod.Haptics; });
   }

   type Style = 'light' | 'medium' | 'heavy';

   const styleMap: Record<Style, string> = {
     light: 'Light',
     medium: 'Medium',
     heavy: 'Heavy',
   };

   export function hapticImpact(style: Style = 'light'): void {
     if (!Haptics || prefersReducedMotion()) return;
     Haptics.impact({ style: styleMap[style] as any }).catch(() => {});
   }
   ```

3. **Add calls at interaction points.**

   | File | Location | Call |
   |------|----------|------|
   | `GameMap.tsx` | Inside the new `pointerup` tap handler (M-02) | `hapticImpact('light')` |
   | `GamePage.tsx` | `handleAttack()` success callback | `hapticImpact('medium')` |
   | `ActionModal.tsx` | Dice roll animation start | `hapticImpact('medium')` |
   | `GamePage.tsx` | `game:turn_changed` socket handler | `hapticImpact('light')` |
   | `GamePage.tsx` / `MobileCardsTray.tsx` | `handleRedeemCards()` success | `hapticImpact('heavy')` |

4. **Run `npx cap sync` after install to register the native plugin.**

5. **Test.**
   - On iOS/Android simulator or device: verify haptic pulses at each trigger point.
   - On web: verify no errors (no-op path).
   - With "Reduce Motion" OS setting enabled: verify no haptics fire.

### Files Changed

| File | Change |
|------|--------|
| `frontend/package.json` | Add `@capacitor/haptics` dependency |
| `frontend/src/utils/haptics.ts` | New file (~20 lines) |
| `frontend/src/components/game/GameMap.tsx` | Import + call in tap handler |
| `frontend/src/pages/GamePage.tsx` | Import + calls in attack/turn/redeem handlers |
| `frontend/src/components/game/ActionModal.tsx` | Import + call in dice animation |
| `frontend/src/components/game/MobileCardsTray.tsx` | Import + call on redeem |

---

## M-06 Landscape Layout Adaptation

**Priority:** P2 — Landscape phones lose half the vertical space to bottom bar + sheets.

### Current State

`isLandscapeMobile()` is defined in `device.ts` line 12 but **never imported** anywhere. The only landscape handling is a CSS media query in `index.css` that reduces `mobile-bottom-sheet` to `max-height: 40vh`.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | In landscape on mobile (< 768 px width-wise AND width > height), the game bottom bar height is reduced from `min-h-[56px]` to `min-h-[40px]` with smaller text. |
| R2 | Bottom sheets use `max-h-[35vh]` in landscape (tighten from 40vh). |
| R3 | The mobile HUD drawer switches from right-side to bottom-sheet style in landscape, limited to 50% of viewport height. |
| R4 | Optionally: show a brief "Rotate for best experience" toast on first landscape detection during a game (dismissible, shown once per session via `sessionStorage`). |

### Implementation Steps

1. **Add a `useIsLandscape()` hook in `frontend/src/hooks/useIsLandscape.ts`.**

   ```ts
   import { useState, useEffect } from 'react';
   import { isMobileViewport } from '../utils/device';

   export function useIsLandscape(): boolean {
     const [landscape, setLandscape] = useState(
       () => isMobileViewport() && window.innerWidth > window.innerHeight,
     );
     useEffect(() => {
       const mq = window.matchMedia('(orientation: landscape) and (max-width: 768px)');
       const handler = (e: MediaQueryListEvent) => setLandscape(e.matches);
       mq.addEventListener('change', handler);
       return () => mq.removeEventListener('change', handler);
     }, []);
     return landscape;
   }
   ```

2. **Update `GamePage.tsx` mobile bottom bar.**
   - Import `useIsLandscape`.
   - Apply conditional classes: `min-h-[${landscape ? '40px' : '56px'}]`, `text-[10px]` for landscape.

3. **Update CSS landscape media query in `index.css`.**

   ```css
   @media (max-width: 768px) and (orientation: landscape) {
     .mobile-bottom-sheet { max-height: 35vh; }
     .mobile-bottom-bar { min-height: 40px; }
   }
   ```

4. **Test.**
   - Rotate phone in Chrome DevTools → bottom bar shrinks, sheets take less space.
   - Game map gets more vertical room in landscape.

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/useIsLandscape.ts` | New file (~15 lines) |
| `frontend/src/pages/GamePage.tsx` | Import hook, apply conditional classes to bottom bar |
| `frontend/src/index.css` | Tighten landscape media query values |

---

## M-07 Keyboard Avoidance for Chat

**Priority:** P2 — Chat is unusable when the virtual keyboard covers the input.

### Current State

No keyboard-specific handling exists. When a user taps the chat input in the mobile HUD drawer, the virtual keyboard pushes up the viewport and the chat messages and input may become obscured or unreachable.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | When the virtual keyboard opens, the chat input remains visible and usable. |
| R2 | Chat message list scrolls to the latest message when the keyboard opens. |
| R3 | On Capacitor native builds, use `@capacitor/keyboard` for reliable keyboard events. On web, use `visualViewport` resize. |

### Implementation Steps

1. **Install Capacitor Keyboard plugin.**

   ```bash
   cd frontend && pnpm add @capacitor/keyboard
   ```

2. **Create `frontend/src/hooks/useKeyboardVisible.ts`.**

   ```ts
   import { useState, useEffect } from 'react';
   import { Capacitor } from '@capacitor/core';

   export function useKeyboardVisible(): boolean {
     const [visible, setVisible] = useState(false);

     useEffect(() => {
       if (Capacitor.isNativePlatform()) {
         import('@capacitor/keyboard').then(({ Keyboard }) => {
           Keyboard.addListener('keyboardWillShow', () => setVisible(true));
           Keyboard.addListener('keyboardWillHide', () => setVisible(false));
         });
         return;
       }

       // Web fallback: visualViewport
       const vv = window.visualViewport;
       if (!vv) return;
       const handler = () => {
         // Keyboard is likely open if viewport height is significantly less than window height
         setVisible(vv.height < window.innerHeight * 0.75);
       };
       vv.addEventListener('resize', handler);
       return () => vv.removeEventListener('resize', handler);
     }, []);

     return visible;
   }
   ```

3. **Update `GameHUD.tsx` chat section.**
   - Import `useKeyboardVisible`.
   - When `keyboardVisible` is true, add `pb-[env(keyboard-inset-height,0)]` or a fixed bottom padding (~260 px fallback) to the chat container.
   - Call `scrollToBottom()` on the chat message list ref when `keyboardVisible` transitions to `true`.

4. **Test.**
   - On iOS simulator: tap chat input → keyboard opens → chat input stays visible.
   - Messages scroll to bottom automatically.
   - Dismiss keyboard → layout returns to normal.

### Files Changed

| File | Change |
|------|--------|
| `frontend/package.json` | Add `@capacitor/keyboard` dependency |
| `frontend/src/hooks/useKeyboardVisible.ts` | New file (~30 lines) |
| `frontend/src/components/game/GameHUD.tsx` | Import hook, add keyboard-aware padding + auto-scroll |

---

## M-08 Pull-to-Refresh on Lobby

**Priority:** P3 — Polish.

### Current State

The lobby page is a long scrollable list with no pull-to-refresh. Users must navigate away and back to see new games.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | On mobile, pulling down at the top of the lobby page triggers a data refresh (re-fetch games list and user data). |
| R2 | A visual spinner/indicator appears during the refresh. |
| R3 | Pull-to-refresh is only active when scrolled to the top (no interference with normal scrolling). |

### Implementation Steps

1. **Create `frontend/src/hooks/usePullToRefresh.ts`.**
   - Track `touchstart` Y at scroll top, `touchmove` delta, and trigger refresh callback when pulled ≥ 60 px.
   - Render a small spinner indicator via a passed ref or a returned `pullDistance` value.

2. **Wire into `LobbyPage.tsx`.**
   - On trigger, call the existing data-fetch functions (re-fetch user, games list, etc.).
   - Show a small spinner at the top of the content area while refreshing.

3. **Test.**
   - Pull down from top → spinner appears → data refreshes → spinner disappears.
   - Scroll to middle and pull → nothing happens (normal scroll).

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/hooks/usePullToRefresh.ts` | New file (~45 lines) |
| `frontend/src/pages/LobbyPage.tsx` | Import hook, attach to scrollable container |

---

## M-09 Font Loading Optimization

**Priority:** P3 — Reduces FOUT (flash of unstyled text) on slow mobile connections.

### Current State

`index.html` loads Cinzel and Inter from Google Fonts with `display=swap`. On slow connections, this causes visible text reflow when fonts load.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | Preload the primary weight of Inter (400) and Cinzel (400) to reduce FOUT. |
| R2 | Keep `display=swap` for Inter (body text — must render immediately). |
| R3 | Switch Cinzel to `display=optional` — if it doesn't load in time, the fallback serif is acceptable for headings. |

### Implementation Steps

1. **Add preload hints to `frontend/index.html` `<head>`.**

   ```html
   <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
   <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&display=optional" />
   ```

2. **Adjust the existing `<link>` tags to match the `display` values above.**

3. **Test.**
   - Throttle to "Slow 3G" in Chrome DevTools → heading text may use serif fallback briefly but body text renders immediately without layout shift.

### Files Changed

| File | Change |
|------|--------|
| `frontend/index.html` | Add preload links, adjust `display` param for Cinzel |

---

## M-10 Double-Tap Zoom Behavior

**Priority:** P3 — Minor discoverability/convention issue.

### Current State

`GameMap.tsx` line 214: double-tap within 300 ms resets the map to its initial position and scale. This is unconventional — users expect double-tap to zoom *in* on the tapped location (matching Maps/Google Maps behavior).

### Requirements

| # | Requirement |
|---|-------------|
| R1 | Double-tap zooms in 2× centered on the tap location. |
| R2 | If already at max zoom (4×), double-tap resets to initial view. |
| R3 | Add a small "Reset View" button (home icon) in the bottom-right corner of the map on mobile as an alternative way to reset. |

### Implementation Steps

1. **Modify the double-tap handler in `GameMap.tsx` (~line 214).**

   ```ts
   if (now - lastTapTime < 300) {
     const currentScale = mapContainer.scale.x;
     if (currentScale >= 3.8) {
       // Already near max — reset
       syncLayers(0, 0);
       scaleAllLayers(initialScale);
     } else {
       // Zoom in 2× centered on tap
       const newScale = Math.min(4, currentScale * 2);
       const ratio = newScale / currentScale;
       const newX = e.clientX - (e.clientX - mapContainer.x) * ratio;
       const newY = e.clientY - (e.clientY - mapContainer.y) * ratio;
       scaleAllLayers(newScale);
       syncLayers(newX, newY);
     }
   }
   ```

2. **Add a "Reset View" button to `GamePage.tsx` map area.**
   - Render a small `<button>` with a `Home` or `Maximize` icon, absolutely positioned `bottom-20 right-4` (above the bottom bar on mobile), `z-20`.
   - On click, reset map position/scale via a ref callback or a shared state setter.

3. **Test.**
   - Double-tap on a territory → zooms in centered on it.
   - Double-tap at max zoom → resets to initial.
   - Tap reset button → returns to initial view.

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/game/GameMap.tsx` | Update double-tap logic (~15 lines) |
| `frontend/src/pages/GamePage.tsx` | Add reset-view button (5–10 lines) |

---

## M-11 Capacitor Plugin Hardening

**Priority:** P2 — Missing plugins degrade native app quality.

### Current State

`capacitor.config.ts` lists only `SplashScreen` and `StatusBar`. Key native capabilities are missing.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | Install and configure `@capacitor/keyboard` (resize mode, accessory bar control). |
| R2 | Install and configure `@capacitor/app` (back button handling, deep link support, app state listeners). |
| R3 | Install and configure `@capacitor/network` (connectivity status). |
| R4 | `@capacitor/haptics` is handled in M-05. |

### Implementation Steps

1. **Install packages.**

   ```bash
   cd frontend && pnpm add @capacitor/keyboard @capacitor/app @capacitor/network
   ```

2. **Update `capacitor.config.ts`.**

   ```ts
   plugins: {
     SplashScreen: { launchShowDuration: 0 },
     StatusBar: { style: 'DARK', backgroundColor: '#0f1117' },
     Keyboard: {
       resize: 'body',          // Resize webview when keyboard opens
       resizeOnFullScreen: true,
     },
   },
   ```

3. **Add back-button handling in `frontend/src/main.tsx` (or a new `capacitorInit.ts`).**

   ```ts
   import { Capacitor } from '@capacitor/core';

   if (Capacitor.isNativePlatform()) {
     import('@capacitor/app').then(({ App }) => {
       App.addListener('backButton', ({ canGoBack }) => {
         if (canGoBack) {
           window.history.back();
         } else {
           App.exitApp();
         }
       });
     });
   }
   ```

4. **Add network status indicator (global).**
   - Create `frontend/src/hooks/useNetworkStatus.ts`:
     ```ts
     import { useState, useEffect } from 'react';
     import { Capacitor } from '@capacitor/core';

     export function useNetworkStatus(): boolean {
       const [online, setOnline] = useState(navigator.onLine);
       useEffect(() => {
         if (Capacitor.isNativePlatform()) {
           import('@capacitor/network').then(({ Network }) => {
             Network.addListener('networkStatusChange', (s) => setOnline(s.connected));
           });
           return;
         }
         const on = () => setOnline(true);
         const off = () => setOnline(false);
         window.addEventListener('online', on);
         window.addEventListener('offline', off);
         return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
       }, []);
       return online;
     }
     ```
   - In the root `App.tsx` or layout, render a thin banner when `!online`:
     ```tsx
     {!online && (
       <div className="fixed top-0 inset-x-0 z-[100] bg-red-900/90 text-red-200 text-center text-sm py-1.5 pt-safe">
         No internet connection
       </div>
     )}
     ```

5. **Run `npx cap sync`.**

6. **Test.**
   - Android back button navigates back; on root screen, exits app.
   - Toggle airplane mode → "No internet connection" banner appears.
   - Keyboard opens → webview resizes correctly.

### Files Changed

| File | Change |
|------|--------|
| `frontend/package.json` | Add 3 Capacitor plugins |
| `frontend/capacitor.config.ts` | Add `Keyboard` config |
| `frontend/src/main.tsx` or `frontend/src/utils/capacitorInit.ts` | Back button handler |
| `frontend/src/hooks/useNetworkStatus.ts` | New file (~25 lines) |
| `frontend/src/hooks/useKeyboardVisible.ts` | New file (from M-07, shared) |
| `frontend/src/App.tsx` | Render offline banner |

---

## M-12 Mobile Overlay Budget

**Priority:** P0 — On a phone the player closes something before almost every move.

### Current State

Six surfaces float over the map on a phone. Each has its own trigger, its own position, its own timer and its own close button, and none of them knows the others exist:

| Surface | Component | Trigger | Goes away |
|---|---|---|---|
| "While you were away" panel | `AiTurnRecapPanel` (top-right, 85vw) | any opponent turn with battles | X, or your turn ends |
| Combat card above the bar | `MobileCombatBanner` | **every** combat in the game, including AI vs AI | 6 s timer or tap |
| "Skip animations (N queued)" | `GlobeMap` (top-right) | globe backlog > 0 | backlog drains |
| Incoming-attack dice theater | `DefenderBattleTheater` (centered, z-40) | attack on you, during the attacker's turn | auto-advance |
| Phase / fortify toasts | `ActionNotification` | phase change, each move | timer |
| Blocking modals | `ActionModal` queue | own attacks, turn summary, draft summary, capital loss, game over | tap |

Plus the globe's `+`/`−` zoom buttons sitting on top of the combat card, and a bottom bar whose phase label truncates to "REI… / Yo…" at 390 px.

Each surface was itself a fix (the recap replaced per-AI "TURN COMPLETE" modals; the theater replaced "INCOMING ATTACK!" modals; the banner was deduped against the combat modal). The remaining problem is that nothing arbitrates: at the start of a turn the panel auto-expands because a territory was lost (`AiTurnRecapPanel` pops open on any loss, written for a 290 px desktop corner), the banner narrates an AI-vs-AI fight the player has no stake in, and the globe is still replaying battles the recap has already summarised.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | **One channel.** On phones, everything glanceable lands in a single strip above the bottom bar. Nothing else floats over the map for information's sake. |
| R2 | **Two modes.** *Watching* (not your turn): the strip is a live ticker of battles involving you plus a running count. *Acting* (your turn): the strip is one collapsed line; the map is clear. |
| R3 | **No auto-expand, ever.** A lost territory is named in the line and pulsed on the map, never shown by covering the map with a panel. |
| R4 | **No mandatory dismissals outside tier 1.** The strip collapses to a badge on the player's first action of the turn and is reachable from the badge; it never needs an X. |
| R5 | **The map does the talking.** Territories the viewer lost since their last turn pulse red on the map when their turn starts, until their first action. |
| R6 | **Only the player's own animations on phones.** Map visuals from other players' turns are not queued; the board updates instantly from state. Board-level visuals (era advance, frontier unlock, board transform, event cards) still play. Any leftover globe backlog is flushed when the player's turn starts. |
| R7 | **Attacks on the player are not a centered card on phones.** The dice theater is desktop-only; on phones the strip's live line carries the result. |
| R8 | The combat banner never shows a battle the viewer is not part of. (On phones it is replaced by the strip entirely.) |
| R9 | Zoom `+`/`−` are hidden on coarse-pointer devices; pinch already zooms. |
| R10 | The bottom bar's phase label reads in full at 360 px ("Reinforce · 4 units / Your turn"). |
| R11 | Three tiers, and only one interrupts: **tier 1** must acknowledge (game over, elimination, capital lost, resign confirm, era advance — `isCriticalModal`); **tier 2** needs a decision (own attack result with Attack again / Blitz); **tier 3** glanceable (everything else, via the strip). |
| R12 | Desktop behaviour is unchanged by phase 1. |
| R13 | **No own-turn summary modal on phones.** "YOUR TURN COMPLETE" recaps moves the player made seconds ago; the HUD log keeps them. The turn's own attack modals are still folded away at turn end, as on desktop. |

### Design

**The strip.** One line, full width, directly above the bottom bar (where the combat banner sat). Its content is decided by mode:

- *Watching:* while a battle involving the viewer is fresh (6 s), the line reads `Chen → Persia (you) · held, −1` or `Chen → Persia (you) · Lost!` in red, with the dice in miniature. Otherwise the running summary: `⚔ 3 turns · 2 captures`.
- *Acting, before the first action:* `While you were away · You lost Persia, Hispania · 12 battles`, loss first and in red.
- *Acting, after the first action:* a small pill at the bottom-right of the map (`🕓 3`) so the recap stays one tap away.

Tapping the line or the pill opens a half-height sheet (`mobile-sheet-above-nav`, like the chat) with the existing per-player entry list and a "View full log →" link into the HUD drawer. Tapping outside closes it.

**Map cues.** `lossPulseTerritoryIds` on both renderers: red rings (globe) / red pulse (2D) on every territory the viewer lost since their last turn, shown from turn start until the first action. Same mechanism as the tutorial highlight ring, different colour.

**Animation budget.** `keepsMapVisualOnPhone(event, viewerId)` filters `mapVisualEvents` before they reach either renderer: keep the viewer's own (`event.playerId === viewerId`) and board-level kinds; drop the rest and acknowledge them immediately so the queue never holds them. The globe flush (`skipAnimationsRef`) runs once when the viewer's turn begins.

**Notices (phase 2).** The strip is the phone's only glanceable channel, so the toasts `ActionNotification` floats top-centre on a desktop (a placement, a fortify, the phase turning over, a free unit from an ability) land in the strip instead. `pickStripSlot` resolves the one line in priority order: a fresh battle against the viewer, then the viewer's own move feedback, then the recap (the full line before the first move, the pill after it). A notice holds the line for 2.2 s, the toast's own dwell; the newest replaces whatever is showing and restarts the clock, so three quick placements read as one line updating, never a backlog. Each slot holds one item and nothing queues behind another: the priority queue is the resolution order, not a waiting line. On a desktop the toast is unchanged.

**Dismiss telemetry (phase 2).** The budget is measured, not assumed. Every tap that closes something the game put on a phone screen is counted against the tier of what it closed (`utils/dismissTaps.ts`): tier 1 for game over, elimination, a lost capital, the resign confirm and an era advance; tier 2 for the player's own attack result; tier 3 for everything else, which today means the turn-1 draft summary, the start briefing, an event card, a first-turn coach card and a "Skip all". A player's first Space Age briefing adds one more: its primary button turns to a second page, "How the Space Age works", instead of closing, and that tap counts as tier 3 too. It happens once per browser (`cc-space-age-guide-seen`), the guide is a page of the briefing rather than a second modal stacked on it, and afterwards it opens only on request, from the briefing's link or the Space Program panel. The theater timer and Attack again / Blitz close the combat card through the same callback, so `ActionModal`'s `onDismiss` now carries a reason (`'auto'`, `'action'`) and only a real tap counts. The tally is posted once per round, from the start of the viewer's turn to the start of their next one, as `turn_dismiss_taps` with `layout`, `turn`, `tier1`–`tier3`, `era` and `is_tutorial`; zeros are posted too, because the quiet rounds are the denominator. Phones only; the round in progress goes out when the page is left, so a closed tab loses at most the last round. The target is zero in tiers 2 and 3; tier 3 above zero names the next thing to fold into the strip.

**Own attack sheet (phase 3).** The tier-2 card moves off the map. On a phone the viewer's own attack result renders in `MobileCombatSheet`, anchored above the bottom bar like the territory panel, with no backdrop: the territory that just changed hands is on screen while the dice are read. It reuses `CombatResultView` in a `compact` mode (smaller dice, losses on one line, Attack again and Blitz side by side, no Continue of its own), so every callout, the blitz breakdown, the fast-combat ordering of Attack again / Blitz and the lite-mode auto-advance are the desktop card's own. The sheet closes on its Done button (the one tap, counted as tier 2; the card's own Continue stays on the desktop), on Attack again / Blitz (an action, not a tap; the next result reopens it with fresh dice), on a map selection (the territory panel takes the same anchor) and when the phase or turn moves on. A new result replaces the one showing; nothing queues. Desktop keeps the modal.

**History (phase 3).** When the viewer's turn ends, the round closes into `recapHistory`: the other players' entries gathered while the viewer waited, then the viewer's own turn as a row of its own, labelled by the turn the viewer played. `pushRecapRound` keeps the last ten and skips a round with no battles. The strip's sheet gains a range scrubber above the rows, oldest round at the left and Now at the right, with earlier/later buttons for one step at a time; the header names the round and how long ago it was. While a past round is selected the map pulses the territories the viewer lost in it, through the same `lossPulseTerritoryIds` the turn start uses. With nothing current to report but rounds to scrub, the pill stays alone in the corner, so the history is a tap away without a line over the map.

**Phases.**

| Phase | Scope |
|---|---|
| 1 (done) | R1–R10, R12 and R13: strip with watching/acting modes and the badge, sheet on tap, loss pulse on both maps, own-turn-only animations, theater off on phones, banner retired on phones, no own-turn summary modal on phones, zoom hidden on touch, bottom-bar label. |
| 2 (done) | The `ActionNotification` toasts fold into the strip behind one priority order (`pickStripSlot`); every tap that closes something on a phone is tallied by tier and posted once per round as `turn_dismiss_taps` through `/analytics/ui-event`, target zero outside tier 1. |
| 3 (done) | The own attack result is a sheet anchored above the bar (`MobileCombatSheet`): the same dice, callouts and Attack again / Blitz as the desktop card, with the map live behind it. The strip's sheet scrubs back through the last ten rounds, and the map pulses the scrubbed round's losses. |

### Implementation Steps

1. **Pure helpers, `frontend/src/utils/mobileOverlays.ts`.** `combatInvolves(result, viewerId)`, `keepsMapVisualOnPhone(event, viewerId)`, `summarizeRecapsForViewer(recaps, viewerId)` (battles, captures, attacks on the viewer, lost territory names and ids). `CombatResult` gains `fromId`/`toId` so a loss can be mapped back to a territory.
2. **`MobileTurnStrip.tsx`.** Props: `recaps`, `viewerPlayerId`, `liveCombat`, `isMyTurn`, `acted`, `onOpenFullLog`. Renders the line / pill / sheet per the modes above; the per-player entry list is lifted out of `AiTurnRecapPanel` into a shared `RecapEntryList` so the desktop panel and the sheet render the same rows.
3. **`GamePage.tsx`.** On `isMobileLayout`: render the strip instead of `AiTurnRecapPanel`; do not queue the defender theater (`incomingAttackCardMode({ liteMode, phoneLayout })`); filter map visual events with `keepsMapVisualOnPhone` and acknowledge the dropped ones; flush the globe backlog when the viewer's turn begins; derive `acted` from `draft_deployments_this_turn` / phase; compute `lossPulseTerritoryIds` from the recaps; fold the turn's own attack modals away without a summary (`dropOwnCombats`); drop `MobileCombatBanner`; shorten the bottom-bar phase labels.
4. **`GlobeMap.tsx` / `GameMap.tsx`.** `lossPulseTerritoryIds` → red rings / red pulse. Globe zoom buttons hidden when `isCoarsePointer()`.
5. **Tests.** `mobileOverlays.test.ts` (predicates, summary, lost ids); `MobileTurnStrip.test.tsx` (never auto-expands on a loss, names the loss, badge after acting, live line only for the viewer's battles, sheet on tap); `combatPresentation.test.ts` (phone case). Desktop tests unchanged.
6. **Verify live.** Chromium at 390×844 with touch emulation against a real server: watching mode during AI turns, the line and red pulse at turn start after a loss, the pill after the first placement, no `+`/`−`, no theater.
7. **Notices (phase 2).** `pickStripSlot` in `mobileOverlays.ts`; a `notice` prop on `MobileTurnStrip` fed from `GamePage`'s `notifState`, with `ActionNotification` rendered only off phones.
8. **Dismiss telemetry (phase 2).** `dismissTaps.ts` (tiers, tally, event properties); `DismissReason` on `ActionModal`'s `onDismiss`; `GamePage` counts taps from the modal, "Skip all", the event card, the coach and the start briefing, and posts the round when the viewer's next turn begins and when the page is left; `turn_dismiss_taps` allowlisted in `analytics.routes.ts`.
9. **Own attack sheet (phase 3).** `MobileCombatSheet.tsx` wrapping `CombatResultView compact`; `GamePage` routes the viewer's own result there on phones instead of the modal queue, and closes it on a selection or a phase/turn change.
10. **History (phase 3).** `RecapRound` and `pushRecapRound` in `mobileOverlays.ts`; `GamePage` closes each round into `recapHistory` when the viewer's turn ends; `MobileTurnStrip` takes `history` and reports the scrubbed round's losses through `onScrub`, which `GamePage` feeds to `lossPulseTerritoryIds`.

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/utils/mobileOverlays.ts` | New: predicates and recap summary |
| `frontend/src/components/game/MobileTurnStrip.tsx` | New: strip, pill and sheet |
| `frontend/src/components/game/AiTurnRecapPanel.tsx` | Lift `RecapEntryList`; desktop panel unchanged |
| `frontend/src/components/game/MobileCombatBanner.tsx` | Removed (replaced by the strip) |
| `frontend/src/components/game/GlobeMap.tsx` | `lossPulseTerritoryIds`; zoom buttons hidden on touch |
| `frontend/src/components/game/GameMap.tsx` | `lossPulseTerritoryIds` |
| `frontend/src/utils/combatPresentation.ts` | `phoneLayout` for incoming attacks |
| `frontend/src/utils/modalQueueOps.ts` | `dropOwnCombats`: the phone turn end |
| `frontend/src/store/gameStore.ts` | `fromId`/`toId` on `CombatResult` |
| `frontend/src/pages/GamePage.tsx` | Wiring above; shorter phase labels; phase 2: notices to the strip, dismiss-tap rounds |
| `frontend/src/utils/dismissTaps.ts` | New (phase 2): dismiss tiers, tally, event properties |
| `frontend/src/components/game/ActionModal.tsx` | Phase 2: `DismissReason` on `onDismiss` (timer and repeat attacks are not taps); phase 3: `compact` on `CombatResultView` |
| `frontend/src/components/game/MobileCombatSheet.tsx` | New (phase 3): the own attack result anchored above the bar |
| `backend/src/modules/analytics/analytics.routes.ts` | Phase 2: `turn_dismiss_taps` on the ui-event allowlist |

## M-13 Mobile Frame Budget

**Priority:** P0 — The phone gets physically hot during a match. Reported on a space age quick match.

### Current State

A turn-based board changes a few times a turn, but a phone was drawing it as if it were a shooter. Before this item:

| Cost | Where | Why it heats the phone |
|---|---|---|
| Unbounded frame rate | The globe's render loop (react-globe.gl), its HTML label layer and three-globe's ring and arc tickers; the 2D map's PixiJS ticker and standalone effect tickers | Every awake frame renders at the display's rate, 60 or 120 Hz. The globe idles after 4 s of quiet, but every touch, turn change and queued animation wakes it for 4 s; the 2D ticker never idles. |
| Endless space age decoration | Four wasteland markers with an infinite CSS pulse; four rings emitting continuously | Neither checked `reducedEffects`, which every phone on the globe runs with. The pulse keeps the compositor producing frames even while the WebGL loop is paused. |
| Backdrop blur over a live canvas | The turn strip, its pill, the attack sheet, the reset-view button, the coaching tip, modal scrims | Over a canvas that repaints, the compositor re-blurs the area under each blurred element on every frame. |
| Endless CSS pulses | The low-time turn-timer chip, the menu's first-visit pulse, the HUD's buff badges | Same as the space age pulse: frames at full rate for as long as they are on screen. |
| A stale board | The idle globe | With M-12 dropping other players' animations on phones, nothing woke the paused globe when the board changed under another player; it repainted at the next turn change or touch. |

Already in place: both renderers cap the device pixel ratio at 1.5, and both stop while the page is hidden.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | **A frame cap on phones.** While a game is open on a phone, everything drawn through `requestAnimationFrame` runs at no more than 30 frames a second: the globe, its labels, its rings and arcs, the 2D map and its effect tickers. The globe's canvas and its HTML labels stay in step. |
| R2 | **Motion keeps its speed.** Tweens, auto-rotate and tickers are time-based and keep their speed. OrbitControls damping, which is per update, is rescaled so a fling coasts as it did at 60 Hz. |
| R3 | **No endless decoration on phones.** The wasteland rings are off and the markers still under reduced effects. Decorative CSS pulses play three times and settle. Spinners keep spinning. |
| R4 | **No backdrop blur on the phone game page.** Surfaces that relied on blur behind a faint tint get a solid phone background. |
| R5 | **The idle globe paints every board change**, for a few frames rather than seconds. Under the budget a turn change wakes it the same way, and a camera tween keeps it awake for exactly its own duration. |
| R6 | Desktop is unchanged, with one exception that is a fix: an idle globe repaints a board change within a few frames there too, even when no animation announces it. |
| R7 | *(Phase 2)* **The 2D map renders on demand on phones.** Its ticker runs while something changed or is moving (a commit, a gesture, a running effect) and stops otherwise, as the globe's loop does. |
| R8 | *(Phase 2)* **The 2D ambient glow is still on phones.** The turn-holder glow and contested borders are drawn once, at the middle of their pulse, not animated forever. On every device the shimmer stops allocating new graphics on each frame. |
| R9 | *(Phase 2)* **Both WebGL contexts ask for the low-power GPU on phones**, and the 2D map drops multisample antialiasing there. |
| R10 | *(Phase 2)* **Both Moon insets follow the phone budget.** The inset is a second full renderer; phase 1 budgeted only the main maps. |
| R11 | *(Phase 3)* **A hot phone steps down.** When the device reports serious or critical heat, the budget drops from 30 to 20 frames a second and adds Lite mode's visual rules. It steps back up only after the device has read below serious for two minutes. The player is told once, on the turn strip. |
| R12 | *(Phase 3)* **Heat comes from the device.** The native apps read iOS `thermalState` and Android's thermal status and headroom through a `Thermal` plugin in the app. Chromium browsers use the Compute Pressure API. A device that reports nothing never steps down. |
| R13 | *(Phase 3)* **Battery saver.** A setting that puts the game page on the reduced tier on any device, desktop included, whatever the device reports. |
| R14 | *(Phase 3)* **Web code ahead of an app build is safe.** A native build without the plugin reports no heat, and the game behaves as in phase 2. |

### Design

**The cap.** `utils/frameBudget.ts` replaces `window.requestAnimationFrame` for as long as the game page is open on a phone (`applyFrameBudget`, from `GamePage` through `useFrameBudget`). Callbacks queue; at most 30 times a second the queue runs as one batch with one timestamp, exactly as the browser runs a frame, so every renderer draws the same instant. Between frames a timer sleeps until just before the next frame is due, so the main thread does not wake on every vsync to find out. The cap's ids start at one billion so they never collide with native ids; on release the native `requestAnimationFrame` returns at once, and `cancelAnimationFrame` keeps routing the cap's ids until its queue drains, so a component cancelling its loop while unmounting never cancels someone else's frame.

The cap sits under the libraries rather than inside one because none of them offers a frame-rate setting that covers what it drives. react-globe.gl runs its render loop, its CSS2D label renderer, its camera tweens and three-globe's tickers each on `requestAnimationFrame`; throttling only the WebGL renderer would draw the labels at 60 over polygons at 30, and they would visibly slide during a drag.

**Damping.** `dampingFactorForFrameRate(0.1, 30)` gives 0.19: each update keeps 81% of the remaining motion, which over a second matches 90% per update at 60 Hz.

**Wakes.** The globe's render loop is paused and woken by `createRenderWake` (`utils/renderWake.ts`). A wake says how long to stay awake, and a wake only ever extends the deadline, so a short wake never cuts a longer one short. A pointer, a wheel or a queued animation keeps the 4 s wake. A board change (any new game state) wakes it for 300 ms, a few frames, which is enough for a prop update to reach three-globe and be drawn. Under the budget a turn change does the same, and a running loop re-checks every 500 ms instead of every 4 s whether it can idle. Every camera tween (`panCamera`, `zoomByFactor`) keeps the loop awake for its own duration plus 150 ms, so the camera never freezes half-way.

**Stylesheet.** `applyFrameBudget` sets `data-frame-budget` on `<html>` to the tier: `standard`, or `reduced` from phase 3. Under either tier `index.css` removes `backdrop-filter` from every element, and caps `animate-pulse`, `animate-pulse-slow`, `animate-ping` and `animate-capture-glow` at three iterations. The coaching tip and the strip's loss pill, the two surfaces that sat on a 10–15% tint behind their blur, get a 95% phone background; the desktop keeps its tint through the `dlayout:` variant.

### Design, phase 2

**The 2D map on demand.** PixiJS draws the whole stage on every tick of the app ticker, whether or not anything moved, so on a phone the 2D map rendered at the full capped rate for as long as the game was open. Under the budget the app is created with `autoStart: false` and its ticker is driven by the same `createRenderWake` rules as the globe:

- **Commits.** An effect with no dependency list, declared after every scene effect, wakes the map for 300 ms after each commit. Anything React changes on the stage (a new board, a selection, a resize) has been drawn into the scene by then.
- **Gestures.** Pointer down, move, up and wheel on the canvas wake it for 600 ms, and it keeps running while a pointer is down. The reset-view button wakes it too, since it moves the stage without a commit.
- **Effects.** The map counts as busy while a visual event plays or while one of its effect tickers runs (the coach highlight, the M-12 loss pulse, a strike flash). A running map re-checks every 500 ms whether it can stop.
- **Visibility.** Coming back to the page repaints once; everything else is unchanged.

Off the budget the ticker never stops, and a late timer from a budgeted moment cannot stop it either. Pointer moves now update only pointers that are actually pressed: a hovering mouse used to be recorded as an active pointer and never removed, which would have read as a finger on the map forever and could turn a later touch into a pinch.

**The ambient glow.** The turn-holder glow and the contested-border lines pulsed on every frame through their own ticker. That loop allocated a new `PIXI.Graphics` for every glowing territory and every contested border on each tick, on every device. The objects are now created once per change and redrawn in place, and destroyed when the layer clears. Under the budget there is no loop at all: the layer is drawn once at a pulse of 0.75, the middle of its range, so the information stays and the animation goes.

**The WebGL contexts.** On phones the 2D map is created with `antialias: false` and `powerPreference: 'low-power'`, and the globe passes `rendererConfig: { powerPreference: 'low-power' }` (globe.gl keeps its own antialias default). Both are read when the renderer is created, so a layout change mid-game keeps the context it started with.

**Moon insets.** Both the globe's and the 2D map's Moon insets now receive the budget: the damping rescale and short wakes on the globe, on-demand rendering and the low-power context on the 2D map.

**Labels.** Phase 2 first listed "territory labels hidden below a zoom level or drawn into the canvas". A survey of the code found nothing for that item to change. The 2D map draws its labels into the canvas already and hides them below 0.6 zoom. The globe has no per-territory labels in the DOM: its HTML layer holds the region labels, capital and building markers, sea-route and wasteland markers and short-lived battle overlays, a few dozen elements at most, and under phase 1 it only updates them while the loop is awake. Hiding the region labels would remove information the player uses, for a small saving, so the item is dropped rather than built.

### Design, phase 3

**Two tiers.** `useFrameBudget` (`hooks/useFrameBudget.ts`) picks the game page's tier:

| Situation | Tier | Frames a second | On top of phases 1–2 |
|---|---|---|---|
| Desktop layout, battery saver off | none | the display's | nothing: the desktop is unchanged |
| Phone layout | `standard` | 30 | nothing |
| Phone layout, the device reports serious or critical | `reduced` | 20 | Lite mode's visual rules |
| Battery saver on, any layout | `reduced` | 20 | Lite mode's visual rules |

Lite mode's visual rules are the ones `GamePage` already applied for the Lite mode setting ("Reduced animations"): no ambient map glow or phase tint, no era vignette, no full-screen strike, the player's own combat card advancing on its own when it offers no repeat attack, reduced map effects and quieter connection hints. The reduced tier applies them without changing the stored setting, so the toggle still shows what the player chose. Lite mode also silences music and sound effects; the reduced tier does not, because music stopping mid-game with no explanation would be a surprise, and the music volume setting already stops the music engine.

On either tier the maps render on demand, the globe's damping is rescaled for the tier's frame rate, and the stylesheet drops blur and endless pulses. `index.css` now matches the attribute's presence rather than a value, and a tier change re-installs the cap at the new rate.

**Heat sources** (`utils/deviceHeat.ts`). The first available source wins, chosen once per page load:

- **The native plugin**, when the app build carries it (`Capacitor.isPluginAvailable('Thermal')`). It is read at once, every 15 s after, and on each change event.
  - iOS reports `ProcessInfo.thermalState`. Its four levels, nominal, fair, serious and critical, are the levels used throughout.
  - Android maps its thermal status: none to nominal, light to fair, moderate to serious, severe and above to critical. From API 30 the thermal headroom forecast raises the level to serious when it predicts severe throttling within ten seconds, so the game sheds work before the phone throttles rather than after. A NaN forecast, which Android returns when a device cannot forecast, changes nothing. Below API 29 it reports `unknown`.
  - The 15 s poll exists for the forecast, which raises no events; Android answers headroom reads more often than about once a second with NaN.
- **The Compute Pressure API** (`PressureObserver`, `cpu` source, 2 s samples) in Chromium browsers, on the same four levels. It folds CPU load in with temperature, which is the right signal here too. Chromium ships it on desktop platforms, so phone browsers rarely have it.
- **Nothing** anywhere else, including Safari. The level never leaves nominal, and battery saver covers those players by hand.

Unknown values read as nominal, so a bad report cannot throttle a cool device. Nothing listens unless the phone budget is on and battery saver is off.

**The governor** (`createHeatGovernor`) turns reports into one decision. Serious or critical steps down at once. Stepping back up waits until the device has reported below serious for a full two minutes, and a hot report during that wait restarts it: a phone handed its full frame rate the moment it dips under the line heats straight back over it.

**The notice.** When a phone steps down, the turn strip shows "Cooling down" with "Fewer effects while your phone is hot" beside it, once, for the strip's usual 2.2 s. Stepping back up is silent.

**Battery saver.** `cc-battery-saver` in local storage, off by default, with a toggle under Settings after Reduced animations. The game page reads it when it opens and on every preference change.

**The native plugins.** Both live in the app rather than in npm packages, so each shell registers them by hand:

- iOS: `ios/App/App/ThermalPlugin.swift`, and `MainViewController.swift`, a `CAPBridgeViewController` subclass that registers the plugin in `capacitorDidLoad`, before the web view loads. `Main.storyboard` names that class instead of Capacitor's.
- Android: `ThermalPlugin.java`, registered in `MainActivity.onCreate` before `super.onCreate`. The status listener is added in `load` and removed when the activity is destroyed.

Neither needs a permission or a new dependency. The web bundle asks whether the plugin exists before using it, so web code that reaches a native build older than this item behaves as in phase 2.

### Phases

| Phase | Scope |
|---|---|
| 1 (done) | R1–R6: the 30 fps cap, the idle and wake budget, the space age decoration under reduced effects, pulses that settle, no blur on phones. |
| 2 (done) | R7–R10: the 2D map rendering on demand, its ambient glow still, the low-power GPU for both WebGL contexts, no multisample antialiasing on the 2D map, both Moon insets on the budget. The label item first written here is dropped; see *Labels* above. |
| 3 (done) | R11–R14, heat-aware: a small Capacitor plugin reading iOS `thermalState` and Android thermal headroom, stepping down to 20 fps with effects off when the device reports it is hot; a battery-saver setting that bundles the same for the web. |

### Checking it on a device

- **Frame rate.** Chrome remote debugging (Android) → Rendering → Frame rendering stats, or Safari Web Inspector (iOS) → Timelines → Rendering Frames. On the game page a phone should never exceed 30 frames a second, and should show none while nothing moves.
- **Endless animations.** In the console, `document.getAnimations().filter(a => a.effect.getTiming().iterations === Infinity && a.playState === 'running').length` should be zero on the game page after a few seconds, spinners aside.
- **Energy.** Xcode's Energy Impact gauge (iOS) or Android Studio's Energy Profiler, over a few AI turns and a turn of your own.
- **Heat, iOS** (a connected device). Xcode → Window → Devices and Simulators → the device → Device Conditions → Thermal State → Serious → Start. The game should drop to 20 frames a second and show "Cooling down" at once, and return to 30 two minutes after the condition stops.
- **Heat, Android 10 and later.** `adb shell cmd thermalservice override-status 2` (moderate) steps the game down; `adb shell cmd thermalservice reset` steps it back up two minutes later.
- **Heat, Chromium.** DevTools Protocol's virtual pressure source: `Emulation.setPressureSourceOverrideEnabled` for `cpu`, then a `serious` state override, on a phone-sized window.
- **Battery saver.** Settings → Battery saver, then a game on any device: `document.documentElement.dataset.frameBudget` reads `reduced`.

### Measured in development

Production builds of `main` and of this item, served against a throwaway backend, on an emulated iPhone 13 in headless Chromium, in a space age match against three AIs:

| Measure | `main` | M-13 |
|---|---|---|
| `requestAnimationFrame` callbacks a second, idle game page, phone | 60 | 30 |
| The same on a desktop viewport | 60 | 60 |
| Browser GPU process during AI turns on the globe (same twelve battles) | 3.8 cores | 1.4 cores |
| All browser processes during those turns | 3.9 cores | 2.3 cores |
| Blurred elements on screen | 1 | 0 |

Phase 2, the same setup on the 2D map, `main` with phase 1 against this item. Both of these builds were made with `NODE_ENV=development` in the environment, so React ran its development build in each; the comparison is like for like, and the idle result does not depend on it.

| Measure (phone, 2D map) | Phase 1 | Phase 2 |
|---|---|---|
| Browser GPU process on the viewer's own turn, nothing moving | 3.8 cores, 2.5 frames a second | 0.01 cores, no frames |
| Browser GPU process during AI turns | 3.8 cores | 2.8–3.0 cores |
| Frames a second during a drag | 2.4 | 4.1 |
| WebGL context, 2D map and its Moon inset | antialias on, default GPU | antialias off, low-power GPU |
| WebGL context, globe and its Moon inset | default GPU | low-power GPU (antialias kept) |
| Desktop contexts | unchanged | unchanged |

Every battle during the AI turns was painted: in the clean run, all nine within 121–247 ms of the server reporting it.

Headless Chromium rasterises WebGL in software and draws the space age globe at about one frame a second, so it cannot show what the cap saves on a real GPU at 60 or 120 Hz, and its 2D map never reaches 30 frames a second either way. The on-device checks above are the confirmation that counts.

Phase 3, a production build of this item on the same setup, in a space age match against one AI, with heat reported through DevTools' virtual CPU pressure source:

| Check | Result |
|---|---|
| Phone, pressure nominal | `standard`, 30 `requestAnimationFrame` callbacks a second once the globe idles |
| Pressure set to serious | `reduced` 1.9 s later (the observer samples every 2 s); 20 a second; "Cooling down" on the strip |
| Pressure back to nominal | still `reduced` 10 s later; `standard` again after 121 s, at 30 a second |
| Phone, 2D map | the phase tint on the map container, gone once the phone steps down (Lite mode's rules) |
| Desktop | no budget, 60 a second, the phase tint kept, no pressure observer created |
| Desktop, battery saver | `reduced`, 20 a second, no phase tint, no pressure observer |
| Phone, battery saver | `reduced` from the start; critical pressure changes nothing and shows no notice; no pressure observer |
| Settings | the Battery saver toggle stores `cc-battery-saver` |

The native plugins could not be built here: there is no Xcode and no Android SDK in this environment, and CI builds neither app. The Android plugin was compiled with `javac -Xlint:all -Werror` against stand-in Android and Capacitor classes and run on simulated API levels 28, 29, 30 and 34, and its unit test passes. The Swift was checked against Capacitor 6's sources but not compiled. The device checks above are needed before an app release.

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/utils/frameBudget.ts` | New: the frame cap, the damping rescale, `applyPhoneFrameBudget` |
| `frontend/src/utils/renderWake.ts` | New: when the globe's render loop runs; wakes as deadlines that only extend |
| `frontend/src/pages/GamePage.tsx` | Turns the budget on for phone layouts; `frameBudget` to the globe; solid phone backgrounds on the reset-view button and the coaching tip |
| `frontend/src/components/game/GlobeMap.tsx` | Wake deadline, board-change repaint, tween wakes, damping rescale, wasteland rings and pulse under reduced effects |
| `frontend/src/components/game/MobileTurnStrip.tsx` | No blur; a solid loss pill |
| `frontend/src/components/game/MobileCombatSheet.tsx` | No blur |
| `frontend/src/index.css` | The `data-frame-budget="phone"` rules |
| `frontend/src/utils/frameBudget.test.ts`, `renderWake.test.ts`, `components/game/GlobeMap.frameBudget.test.tsx` | New: the cap on a fake 60, 90 and 120 Hz display; the wake deadlines; the globe's wiring with react-globe.gl stubbed |
| `frontend/src/components/game/GameMap.tsx` | Phase 2: on-demand rendering under the budget, the still ambient glow, ambient graphics redrawn in place, the low-power context without antialiasing, the budget passed to the Moon inset, pressed-pointer bookkeeping |
| `frontend/src/components/game/GameMap.frameBudget.test.tsx` | New (phase 2): the 2D map's wiring with PixiJS replaced by a fake |
| `frontend/src/components/game/GlobeMap.tsx`, `frontend/src/pages/GamePage.tsx` | Phase 2: the globe's low-power context; the budget passed to the 2D map and to the globe's Moon inset |
| `frontend/src/utils/deviceHeat.ts`, `frontend/src/hooks/useFrameBudget.ts` | New (phase 3): the heat sources and the governor; the tier for the game page |
| `frontend/src/utils/frameBudget.ts`, `frontend/src/index.css` | Phase 3: `standard` and `reduced` tiers (`applyFrameBudget` replaces `applyPhoneFrameBudget`); the rules match either tier |
| `frontend/src/pages/GamePage.tsx` | Phase 3: the budget through `useFrameBudget`; Lite mode's visual rules on the reduced tier; the tier's frame rate to both globes; the heat notice |
| `frontend/src/components/game/GlobeMap.tsx` | Phase 3: `frameBudgetFps`, the rate the damping is rescaled for |
| `frontend/src/components/game/ActionModal.tsx` | Phase 3: a `device` notification type |
| `frontend/src/utils/userPreferences.ts`, `frontend/src/pages/SettingsPage.tsx` | Phase 3: the battery saver preference and its toggle |
| `frontend/ios/App/App/ThermalPlugin.swift`, `MainViewController.swift`, `Base.lproj/Main.storyboard`, `App.xcodeproj/project.pbxproj` | New (phase 3): the iOS plugin, the view controller that registers it, and the project entries |
| `frontend/android/app/src/main/java/com/borderfall/app/ThermalPlugin.java`, `MainActivity.java` | New (phase 3): the Android plugin, registered before the bridge starts |
| `frontend/src/utils/deviceHeat.test.ts`, `hooks/useFrameBudget.test.ts`, `utils/frameBudget.test.ts`, `pages/SettingsPage.test.tsx`, `android/app/src/test/java/com/borderfall/app/ThermalPluginTest.java` | Phase 3: the sources, the governor, the tiers, the setting, and the Android level mapping |

## M-14 Frame Budget While Watching

**Priority:** P1 — Follows M-13. In a match against AIs, most of the time on the game page is spent watching other players move, and the spectator and replay pages had no frame budget at all.

### Current State

M-13 made an idle board almost free on a phone. What it left is the time spent watching: other players' turns on the game page, and the two pages that exist only to watch, spectating and replays.

A profile of AI turns in a space age quick match on an emulated iPhone 13 found the cost where it was not expected. The profile used a production build with source maps, against three AIs, with quick match's own settings: a 300 s timer, diplomacy, economy and tech trees.

| Finding | Measured |
|---|---|
| State updates during AI turns | About 3–5 full game states a second, 28–34 KB each, mostly within 50 ms of the one before |
| JavaScript per state, globe | About 1 ms to re-render the game page and about 1 ms for the globe's data update on the test machine. The globe's territory shapes are not rebuilt: they are memoized on the map. |
| All JavaScript during AI turns, globe | 3–4% of the main thread, three.js's own per-frame work included. The rest was frames being drawn. |
| Frames per state | Every state keeps the globe drawing for 300 ms (M-13's board-change wake), about 9 frames at 30 a second |
| Frames during AI turns | Replaying recorded AI-turn timings through the wake: the globe awake 19% of the time, 6 frames a second |
| Cost of a frame | About 9 ms of three.js JavaScript on the test machine, several times that on a phone, plus the GPU |
| The 2D map, per state | Every state redrew all 63 territory shapes and unit-badge circles, even when one count changed, and PixiJS triangulated them all again on the next frame: about 1.2 s of the 1.8 s of JavaScript in a 12 s AI stretch went to PixiJS's geometry building, earcut and line building |

So the lever during AI turns is what each update makes the renderers draw, not the work React does per update: the frames the globe draws after it, and the shapes the 2D map rebuilds for it.

The spectator and replay pages never applied the frame budget. A phone watching a match or a replay renders at the display's full rate, with backdrop blur and endless pulses, and the heat step-down and battery saver do nothing there.

### Requirements

| # | Requirement |
|---|-------------|
| R1 | **Fewer frames per change under the budget.** A board change or a turn change keeps the globe drawing for 100 ms, not 300, and a commit keeps the 2D map drawing for 100 ms, not 300. 100 ms is still two frames at the reduced tier's 20 a second. The desktop keeps 300 ms. |
| R2 | **No stale board.** A change is owed frames as well as time: the globe keeps drawing until three frames have been drawn since the change, the 2D map one, even when a slow frame outlasts the 100 ms. Owed frames never hold the loop more than a second past the wake. |
| R3 | **The spectator and replay pages follow the frame budget**: the phone tier, the heat step-down and battery saver, with the reduced tier applying Lite mode's visual rules there as it does on the game page. |
| R4 | **The 2D map redraws only what changed.** A territory shape or unit-badge circle is redrawn only when its look changes (colour, border, width, coast, outline); a new unit count changes only the badge's text. On every device: the output is the same, with less work. |

### Design

**Why owed frames.** A new state reaches the globe's scene a few milliseconds after the render that carries it: react-globe.gl sets the props, and two chained kapsule digests, each debounced by 1 ms, hand them to three-globe. If the loop is already running, a frame can start just before those digests and draw the old board. A wake of 300 ms left room for the next frame. With 100 ms, one slow frame on a slow phone could use up the whole wake, and the loop would pause on the old board. That is the M-13 stale-board bug again, only rarer.

A wake therefore asks for frames as well as time (`utils/renderWake.ts`):

- **The counts.** Frames are counted where the renderers count them: three.js's `renderer.info.render.frame` for the globe, which renders once a tick, and ticks of the app ticker for the 2D map.
- **How many.** A board or turn change on the globe owes three frames: the frame drawn as the loop resumes and one drawn before the second digest may still show the old board, and the third cannot. A 2D change owes one, since the map applies its changes to the scene before it wakes. Normally the owed frames fall inside the 100 ms and change nothing.
- **Limits.** Owed frames keep the loop running past the deadline, re-checked every 50 ms, for at most a second, so a renderer that stops drawing cannot hold it awake. A renderer that cannot count frames makes the wake time-only, which is how the desktop and the test stand-ins behave.

**What the change saves.** Replaying the recorded AI-turn timings through the real wake:

| Wake per change | Globe awake during AI turns | Frames a second at 30 fps | At 20 fps |
|---|---|---|---|
| 300 ms (M-13) | 19% | 6.0 | 4.1 |
| 100 ms (this item) | 7% | 2.4 | 1.8 |

**The 2D map's shapes.** Clearing and redrawing a PixiJS Graphics marks its geometry dirty, and the next render triangulates it again with earcut. The territory effect now keeps, per Graphics object, the look it last drew (a string of fill, border colour and width and coast, plus the outline array's identity) and skips shapes whose look is unchanged; the unit badges' circles do the same with radius, era ring and fill. The record is a `WeakMap` keyed by the Graphics object, so a rebuilt scene, whose shapes are new objects drawn blank at creation, is always coloured in full. A move now redraws the territory that changed hands and the borders around it, and a reinforcement redraws nothing but a number.

**A wonder's halo.** The golden ring around a territory with a wonder used to be drawn into the territory's own shape and cleared again by that shape's next line, so it never showed. It is now its own Graphics in a layer directly above the territory shapes (below the turn glow, capitals, effects and labels), so it reads on every side whatever order the neighbours were drawn in. It is two soft gold passes (18 px at 12%, 10 px at 30%) that fade away from the 4 px gold border, redrawn only when the outline changes and hidden when the wonder is gone.

**The watching pages.** `usePageFrameBudget` (`hooks/useFrameBudget.ts`) follows the phone layout and the battery saver setting itself and applies the same tiers as the game page. `SpectatorPage` and `ReplayPage` use it: both pass the budget and its frame rate to the globe and the budget to the 2D map, and treat the reduced tier as Lite mode in their reduced-effects and ambient flags. A hot phone steps down there silently; those pages have no turn strip to explain it on.

**Measured, not built: merging state bursts.** Applying the states that arrive within one frame as a single render would cut renders by about 80% during AI turns: 164 states became 33 renders in the recording. But a render costs about 1 ms, and the game page's state handler does per-state work (the draft pool, the reinforcement recap, turn transitions) that would have to be reworked to skip states safely. The saving does not justify that risk, so this is left out.

### Measured in development

Production builds of `main` (with M-13) and of this item, served against a throwaway backend, on an emulated iPhone 13 in headless Chromium, in space age matches against three AIs with quick match's settings, four AI stretches a run:

| Measure (phone, AI turns) | `main` | M-14 |
|---|---|---|
| Main-thread JavaScript, 2D map | 19% | 2% |
| PixiJS geometry rebuilding, 2D map (one profiled 12 s stretch) | 1.2 s | none left in the profile |
| Main-thread JavaScript, globe | 3% | 3% |
| States with no frame within 3 s, 2D map | 0 of 334 | 0 of 299 |
| States with no frame within 3 s, globe, outside the hitch below | 0 | 0 |
| Globe frames a second during AI turns, replaying recorded timings through the wake at 30 fps | 6.0 | 2.4 |

In the globe runs where the page's socket reconnected, which was most of them on both builds, one AI stretch spent about 80% of the main thread in JavaScript for several seconds. A few states waited more than 3 s for a frame, all inside that stretch. For all but about 0.1 s of each wait the main thread was busy, so no frame could be drawn: a hitch, not a paused loop. It is separate from this item. [The map-resend hitch](#follow-up-the-map-resend-hitch) below explains and fixes it.

As before, headless Chromium draws WebGL in software, at about 700 ms a globe frame and 150 ms a 2D frame, so the frame rate itself cannot show what fewer frames save: here the loop is always behind. The frame counts above come from replaying the recorded state timings through the real wake code; the device checks below are the confirmation that counts.

The watching pages, the same setup:

| Page | Phone | Desktop | Desktop with battery saver |
|---|---|---|---|
| Spectating | `standard`, 30 frames a second | no budget, 60 | `reduced`, 20 |
| Replay | `standard`, 30 | no budget, 60 | `reduced`, 20, phase tint off (Lite mode's rules) |

### Checking it on a device

- **AI turns.** Safari Web Inspector (iOS) → Timelines → Rendering Frames, or Chrome remote debugging (Android) → Performance, during an AI turn on a phone: after each move the globe should draw a short burst of three or four frames, not nine or ten, and every move should show on the board.
- **Spectating and replays.** On a phone, `document.documentElement.dataset.frameBudget` reads `standard` on both pages, and `reduced` with battery saver on.

### Files Changed

| File | Change |
|------|--------|
| `frontend/src/utils/renderWake.ts`, `renderWake.test.ts` | Wakes that owe frames, with a one-second limit |
| `frontend/src/components/game/GlobeMap.tsx`, `GlobeMap.frameBudget.test.tsx` | Under the budget: a 100 ms board-change and turn-change wake that owes three frames, counted by three.js |
| `frontend/src/components/game/GameMap.tsx`, `GameMap.frameBudget.test.tsx` | A 100 ms commit wake that owes one frame, counted by the app ticker; territory shapes and badge circles redrawn only when their look changes |
| `frontend/src/hooks/useFrameBudget.ts`, `useFrameBudget.test.ts` | `usePageFrameBudget`: the budget for a page that does not track the layout and battery saver itself |
| `frontend/src/pages/SpectatorPage.tsx`, `frontend/src/pages/ReplayPage.tsx` | The frame budget, and the reduced tier as Lite mode |

### Follow-up: the map-resend hitch

**What it was.** The globe hitch above is a rejoin. Each time the page's socket reconnects, the game page joins again and the server sends the whole map, about 23 KB for the space age. The page swapped the new copy in, and each globe then rebuilt every territory's shape. On the space age that means two globes, because the Moon inset is a second globe. The build clips Natural Earth countries with turf's `intersect` (59 clips for the space age board), which runs on bignumber.js arithmetic. The new shape objects also made three-globe triangulate every territory again, because it matches its meshes to data by object.

One forced reconnect, profiled on the test machine:

| Cost of a rejoin, space age, globe | Before | After the fix |
|---|---|---|
| JavaScript in the 10 s after the resent map arrives | 6.9 s | 0.4 s |
| Territory geometry builds | 2 (main globe and Moon inset), 4.9 s | 0 |
| three-globe re-triangulating every territory | 1.1 s | none |
| Longest task after the reconnect | 5.5 s | 1.6 s (a software-GL frame) |
| Longest task while the game loads | 5.2–5.7 s, twice in two of four runs | 2.8 s |

One build of each era's board, timed in Node on the same machine; a phone is slower:

| Board | One build |
|---|---|
| Space age | 3.2 s, paid twice (the Moon inset) |
| Ancient | 2.3 s |
| Cold War | 1.4 s |
| Risorgimento | 1.1 s |
| Age of Discovery, Medieval, WWII | about 0.85 s |
| Modern | 0.56 s |
| American Civil War | 0.06 s |

**What triggers it.** In the test rig the reconnects came from the rig itself. Software WebGL holds the main thread for about 1.4 s a frame, and the page fell more than half a minute behind the server's messages. The socket.io client then closed the socket when no server ping had been processed for 45 s. On a phone, the same resend follows any rejoin:
- a dropped connection or a switch between Wi-Fi and mobile data;
- the app coming back from the background;
- a server restart;
- a `GAME_NOT_FOUND` resync.

The second join every page load makes also resends the map. In a space age game the server also pushes a changed map for each new Launch Pad lane. Every switch from the 2D map back to the globe rebuilt the shapes too.

The 2D map was never affected: it caches its geometry per map, and a forced reconnect there cost at most 0.45 s of JavaScript.

**The fix.**
- **A resent map is kept if nothing changed.** When a `game:map` payload serializes the same as the map the page holds, the page keeps its object (`utils/mapResend.ts`), so nothing keyed on the map rebuilds.
- **One build per distinct board.** The globe asks `buildTerritoryGlobeGeometriesShared` for its shapes. It caches builds by the map fields the build reads (id, canvas size, projection bounds, territories) and by which geo sources were passed. The Moon inset, a remount and a connections-only change such as a Launch Pad lane then get the same shape objects back, so three-globe keeps its meshes. Up to three boards are kept.

**Checking it on a device.** In a space age game on the globe, turn on airplane mode for a few seconds and turn it off, or background the app for a minute and return. Once the game resyncs, the board should keep responding with no multi-second freeze. In Safari Web Inspector (iOS) or Chrome remote debugging (Android), the resync should show no JavaScript task longer than a frame or two. Without the fix, one task holds the whole geometry rebuild.

| File | Change |
|------|--------|
| `frontend/src/utils/mapResend.ts`, `mapResend.test.ts` | `isSameMap`: whether a resent map is the one already held |
| `frontend/src/pages/GamePage.tsx` | `game:map` keeps the current map object when the resend is identical |
| `frontend/src/utils/globeTerritoryGeometry.ts`, `globeTerritoryGeometry.shared.test.ts` | `buildTerritoryGlobeGeometriesShared`: one build per distinct board and set of geo sources |
| `frontend/src/components/game/GlobeMap.tsx` | Builds its territory shapes through the shared build |

---

## Implementation Order

The recommended sequence accounts for dependency chains and impact:

| Phase | Items | Rationale |
|-------|-------|-----------|
| **Sprint 1** | M-02, M-04 | Zero-dependency fixes to game map — the core interaction surface. Can be done in a single sitting. |
| **Sprint 2** | M-01, M-03 | Navigation and bottom sheet UX — the two most visible mobile pain points outside the map. |
| **Sprint 3** | M-05, M-11 | Capacitor plugins installed together (one `cap sync`), haptics wired in. |
| **Sprint 4** | M-06, M-07 | Landscape + keyboard — both require the hooks from Sprint 3 plugins. |
| **Sprint 5** | M-08, M-09, M-10 | Polish items — lowest risk, lowest urgency. |
| **Sprint 6** | M-12 (phases 1–3) | The in-game overlay budget: one strip, own-turn-only animations, map cues; then the toasts folded into the strip and the dismiss taps measured; then the own attack result off the map and a scrubbable history. Independent of the sprints above. |
| **Sprint 7** | M-13 (phases 1–3) | The phone frame budget: a 30 fps cap, a render loop that idles between moves, no endless decoration, no blur over the map; then the 2D map rendering on demand, the low-power GPU and both Moon insets on the budget; then a step down to 20 fps when the phone reports heat, and a battery saver setting. Independent of the sprints above. |
| **Sprint 8** | M-14 | The frame budget while watching: fewer frames for each other player's move, owed frames so no move is left undrawn, and the budget on the spectator and replay pages. Follows M-13. |

### Estimated Scope

| Metric | Count |
|--------|-------|
| New files | 7–8 |
| Modified files | ~12 |
| New dependencies | 4 (`@capacitor/haptics`, `@capacitor/keyboard`, `@capacitor/app`, `@capacitor/network`) |
| Net new lines (approx.) | ~350–450 |

### Validation Checklist

After all items are implemented:

- [ ] Chrome DevTools mobile emulation (375×812 iPhone, 360×800 Android) — full game flow
- [ ] iOS Simulator via `npx cap run ios` — safe areas, haptics, keyboard, back button
- [ ] Android emulator via `npx cap run android` — back button, network banner, haptics
- [ ] Playwright e2e tests still pass (`pnpm run test:e2e`)
- [ ] Backend tests still pass (`pnpm run test:backend`)
- [ ] Landscape mode tested on at least one phone-size viewport
- [ ] Pinch-zoom, pan, territory tap tested on touch device
- [ ] Chat with keyboard open tested on iOS + Android
