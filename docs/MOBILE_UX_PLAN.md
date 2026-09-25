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

**Dismiss telemetry (phase 2).** The budget is measured, not assumed. Every tap that closes something the game put on a phone screen is counted against the tier of what it closed (`utils/dismissTaps.ts`): tier 1 for game over, elimination, a lost capital, the resign confirm and an era advance; tier 2 for the player's own attack result; tier 3 for everything else, which today means the turn-1 draft summary, the start briefing, an event card, a first-turn coach card and a "Skip all". The theater timer and Attack again / Blitz close the combat card through the same callback, so `ActionModal`'s `onDismiss` now carries a reason (`'auto'`, `'action'`) and only a real tap counts. The tally is posted once per round, from the start of the viewer's turn to the start of their next one, as `turn_dismiss_taps` with `layout`, `turn`, `tier1`–`tier3`, `era` and `is_tutorial`; zeros are posted too, because the quiet rounds are the denominator. Phones only; the round in progress goes out when the page is left, so a closed tab loses at most the last round. The target is zero in tiers 2 and 3; tier 3 above zero names the next thing to fold into the strip.

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

### Design

**The cap.** `utils/frameBudget.ts` replaces `window.requestAnimationFrame` for as long as the game page is open on a phone (`applyPhoneFrameBudget`, from `GamePage`). Callbacks queue; at most 30 times a second the queue runs as one batch with one timestamp, exactly as the browser runs a frame, so every renderer draws the same instant. Between frames a timer sleeps until just before the next frame is due, so the main thread does not wake on every vsync to find out. The cap's ids start at one billion so they never collide with native ids; on release the native `requestAnimationFrame` returns at once, and `cancelAnimationFrame` keeps routing the cap's ids until its queue drains, so a component cancelling its loop while unmounting never cancels someone else's frame.

The cap sits under the libraries rather than inside one because none of them offers a frame-rate setting that covers what it drives. react-globe.gl runs its render loop, its CSS2D label renderer, its camera tweens and three-globe's tickers each on `requestAnimationFrame`; throttling only the WebGL renderer would draw the labels at 60 over polygons at 30, and they would visibly slide during a drag.

**Damping.** `dampingFactorForFrameRate(0.1, 30)` gives 0.19: each update keeps 81% of the remaining motion, which over a second matches 90% per update at 60 Hz.

**Wakes.** The globe's render loop is paused and woken by `createRenderWake` (`utils/renderWake.ts`). A wake says how long to stay awake, and a wake only ever extends the deadline, so a short wake never cuts a longer one short. A pointer, a wheel or a queued animation keeps the 4 s wake. A board change (any new game state) wakes it for 300 ms, a few frames, which is enough for a prop update to reach three-globe and be drawn. Under the budget a turn change does the same, and a running loop re-checks every 500 ms instead of every 4 s whether it can idle. Every camera tween (`panCamera`, `zoomByFactor`) keeps the loop awake for its own duration plus 150 ms, so the camera never freezes half-way.

**Stylesheet.** `applyPhoneFrameBudget` sets `data-frame-budget="phone"` on `<html>`. Under it `index.css` removes `backdrop-filter` from every element, and caps `animate-pulse`, `animate-pulse-slow`, `animate-ping` and `animate-capture-glow` at three iterations. The coaching tip and the strip's loss pill, the two surfaces that sat on a 10–15% tint behind their blur, get a 95% phone background; the desktop keeps its tint through the `dlayout:` variant.

### Phases

| Phase | Scope |
|---|---|
| **1 (this item)** | R1–R6: the 30 fps cap, the idle and wake budget, the space age decoration under reduced effects, pulses that settle, no blur on phones. |
| 2 | Per-frame work: territory labels hidden below a zoom level or drawn into the canvas instead of the DOM; the 2D map rendering on demand instead of on every tick; `powerPreference: 'low-power'` for both WebGL contexts; no multisample antialiasing on the 2D map on phones. |
| 3 | Heat-aware: a small Capacitor plugin reading iOS `thermalState` and Android thermal headroom, stepping down to 20 fps with effects off when the device reports it is hot; a battery-saver setting that bundles the same for the web. |

### Checking it on a device

- **Frame rate.** Chrome remote debugging (Android) → Rendering → Frame rendering stats, or Safari Web Inspector (iOS) → Timelines → Rendering Frames. On the game page a phone should never exceed 30 frames a second, and should show none while nothing moves.
- **Endless animations.** In the console, `document.getAnimations().filter(a => a.effect.getTiming().iterations === Infinity && a.playState === 'running').length` should be zero on the game page after a few seconds, spinners aside.
- **Energy.** Xcode's Energy Impact gauge (iOS) or Android Studio's Energy Profiler, over a few AI turns and a turn of your own.

### Measured in development

Production builds of `main` and of this item, served against a throwaway backend, on an emulated iPhone 13 in headless Chromium, in a space age match against three AIs:

| Measure | `main` | M-13 |
|---|---|---|
| `requestAnimationFrame` callbacks a second, idle game page, phone | 60 | 30 |
| The same on a desktop viewport | 60 | 60 |
| Browser GPU process during AI turns on the globe (same twelve battles) | 3.8 cores | 1.4 cores |
| All browser processes during those turns | 3.9 cores | 2.3 cores |
| Blurred elements on screen | 1 | 0 |

Headless Chromium rasterises WebGL in software and draws the space age globe at about one frame a second, so it cannot show what the cap saves on a real GPU at 60 or 120 Hz, and its 2D map never reaches 30 frames a second either way. The on-device checks above are the confirmation that counts.

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
| **Sprint 7** | M-13 (phase 1) | The phone frame budget: a 30 fps cap, a render loop that idles between moves, no endless decoration, no blur over the map. Independent of the sprints above. |

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
