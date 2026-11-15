# Borderfall — the native apps (Capacitor)

The web client lives in `frontend/`. Capacitor 6 wraps its build as an iOS app (iPhone and
iPad) and an Android app. There is one codebase and one bundle: everything the app does
differently from the website is behind `Capacitor.isNativePlatform()`, so none of it changes
the website.

**iOS is the app being prepared for release.** The Android project builds from the same
commands but has not been taken through this work; see [Android](#android).

The store submission itself (enrolment, listing, screenshots, TestFlight) is in
[STORE_RELEASE.md](STORE_RELEASE.md). This page is how the app is built, what it needs from
the server, how it differs from the website, and how to test it on a device.

## Contents

- [Prerequisites](#prerequisites)
- [Build settings](#build-settings)
- [Server settings](#server-settings)
- [Sync, open, run](#sync-open-run)
- [How the app differs from the website](#how-the-app-differs-from-the-website)
- [Minimum app version and API compatibility](#minimum-app-version-and-api-compatibility)
- [Analytics: telling the app from the website](#analytics-telling-the-app-from-the-website)
- [Not built yet](#not-built-yet)
- [Testing on a device](#testing-on-a-device)
- [Android](#android)
- [Repo layout](#repo-layout)

## Prerequisites

- Node and pnpm (repo root: `pnpm install`, then `pnpm --filter @borderfall/shared build`)
- **iOS (macOS only):** Xcode from the App Store, CocoaPods (`sudo gem install cocoapods`), an
  Apple Developer account for running on a device
- **Android:** Android Studio, JDK 17+

## Build settings

The website is served from the same host as its API and builds with no server address. The
native app is served from inside the app (`capacitor://localhost` on iOS), where a relative
`/api` reaches nothing, so a native build needs the server's full address:

| Variable | Required | Value |
|----------|----------|-------|
| `VITE_API_URL` | yes | The server's origin, `https://` only, no path. The app adds `/api` |
| `VITE_SOCKET_URL` | yes | The Socket.IO origin, normally the same value |
| `VITE_PUBLIC_SITE_URL` | no | The website's origin for links the app shares (invites, replays). Defaults to the origin of `VITE_API_URL`; set it only when the website is on a different host from the API |
| `VITE_SENTRY_DSN` | no | Error reporting from the app's JavaScript, as on the website |

Set them as shell variables for that one build. Do not put them in `.env.production`: the
website's Docker build reads that file and must keep the first two empty.

```bash
cd frontend
export VITE_API_URL=https://your-domain.example
export VITE_SOCKET_URL=https://your-domain.example
pnpm run build:native
```

`build:native` is `build` with two differences (`frontend/scripts/nativeBuildEnv.mjs`):

- It refuses to build unless both addresses are absolute `https://` origins. iOS will not load
  plain http (App Transport Security). `NATIVE_ALLOW_HTTP=1` allows http for a local test
  build only; never submit such a build.
- It leaves out the last step of the web build, which writes the landing page's text into
  `index.html` for search engines and prerenders the marketing pages. In the app that text
  would show at every launch until the game had loaded. It then checks that
  `dist/index.html` is the bare app shell.

Use `build:native` (or the `cap:sync` scripts below, which run it) for every native build.
A plain `pnpm run build` followed by `cap sync` ships the landing page inside the app.

## Server settings

Three things on the server, none of which the website needs.

### 1. Allow the app's origin

Every request the iOS app makes is cross-origin, from `capacitor://localhost`. The development
server allows that origin on its own; **a production server allows it only when `CORS_ORIGINS`
lists it** (`parseCorsOrigins` in `backend/src/config/index.ts`). The same list feeds Socket.IO.

```bash
# in the server's .env.production; keep any origins already listed, comma-separated
CORS_ORIGINS=capacitor://localhost
```

Then restart the backend. Without it the app loads and every request fails.

Do not add `https://localhost`, the Android app's default origin: production refuses to start
with a loopback web origin in the list (`backend/src/config/validateEnv.ts`).

### 2. Turn on what an app with chat must have

Both are OFF by default and both are required before submission: Apple asks an app with chat
for a way to report content and block users (guideline 1.2), and an app that creates accounts
for a way to delete them inside the app (guideline 5.1.1(v)).

| Flag | What it adds | Where to switch it |
|------|--------------|--------------------|
| `chat_safety_enabled` | Report a chat message, block a player, Admin → Reports, Settings → Blocked players | Admin → Config, or `CHAT_SAFETY_ENABLED=true` |
| `guest_account_deletion_enabled` | A guest can delete their own account; Settings → Account → Delete account for everyone | Admin → Config, or `GUEST_ACCOUNT_DELETION_ENABLED=true` |

The in-app privacy page reads both flags and describes what is actually switched on
(`frontend/src/pages/PrivacyPage.tsx`).

### 3. Leave the minimum app version empty until there is a second version

See [Minimum app version and API compatibility](#minimum-app-version-and-api-compatibility).

## Sync, open, run

```bash
cd frontend
export VITE_API_URL=https://your-domain.example
export VITE_SOCKET_URL=https://your-domain.example
pnpm run cap:sync:ios     # build:native, then cap sync ios (copies dist/, updates the Podfile, runs pod install)
pnpm run cap:ios          # opens Xcode
```

`pnpm run cap:sync` does the same for iOS and Android together.
`scripts/build-ios-release.sh` and `scripts/build-android-release.sh` wrap these and print a
release checklist.

In Xcode: pick your team under Signing & Capabilities (the project uses automatic signing and
has no team committed), choose a device, Run.

**First time after a clone**, or if CocoaPods failed:

```bash
cd frontend/ios/App && pod install
```

**Version numbers.** `MARKETING_VERSION` (the store version, `1.0` today) and
`CURRENT_PROJECT_VERSION` (the build number) are in the Xcode project. The store version is
what the app reports to the server as its version; bump it for every release.

**Custom native code.** Plugins from npm are picked up by `cap sync`. Plugins that live in
this repo are registered by hand in `frontend/ios/App/App/MainViewController.swift`
(`ThermalPlugin.swift`, which reports device heat, is the one today).

## How the app differs from the website

All of it is in `frontend/src/utils/nativeApp.ts` and the files it names. The check is
`isNativeApp()`, which is false in every browser, a Home Screen web app included.

| | Website | Native app |
|---|---|---|
| `/` | The marketing landing page | Play: the lobby with a session; otherwise a start screen with Play and Sign In (`pages/NativeHomePage.tsx`) |
| Pages written for search engines: `/eras`, `/eras/:slug`, `/game-maps`, `/game-maps/:slug`, `/answers`, `/answers/:slug`, `/daily/archive`, `/daily/:date`, `/about`; and `/unsubscribe` | Served | Redirect to `/` (`components/native/WebOnlyRoute.tsx`) |
| `/how-to-play`, `/codex`, `/privacy`, `/terms` | Served | Served: the app links to them |
| "Home", "Landing", "Marketing Home" links in the lobby | Shown | Hidden |
| A link to another site | New tab | An in-app browser sheet over the game (`@capacitor/browser`; `components/native/NativeLinkHandler.tsx`). `mailto:` and store links go to the system |
| "Add to Home Screen" offers and the Settings Home Screen row | Shown where the browser supports it | Never |
| GIF search in chat | On when `VITE_TENOR_API_KEY` is set | Off. Chat itself is on. A GIF sent from the website still shows, and can be reported |
| Guest copy | "saved in this browser" | "saved on this device" |
| Links the game shares (invites, replays, referral, map pages) | Built from the page's address | Built from the public site's address (`utils/publicOrigin.ts`) |
| A build the server no longer serves | Not applicable | An "Update required" screen (next section) |

Adding a page that only makes sense on the website: wrap its route in `WebOnlyRoute` in
`App.tsx`. Opening another site from code: call `openExternal(url)`, not `window.open`.

**iPad.** The app targets iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`). An iPad gets
the game's desktop layout, the same as a tablet browser; the e2e smoke suite checks that no
page overflows at 820×1180 and 1024×768 (`frontend/tests/e2e/smoke.spec.ts`). The iPad build
supports all four orientations, so it also runs in Split View.

## Minimum app version and API compatibility

A browser tab on an old build is moved to the new one by a reload. An installed app is not: it
bundles the frontend as it was when the app was built, and keeps it until the player updates,
which can be weeks later or never. Two things follow.

### The compatibility rule

**Every API and socket change must keep the oldest app version still being served working.**
"Still being served" means at or above the minimum set in Admin → Config (below), or every
version ever shipped while no minimum is set.

- Add response fields; do not rename, retype or remove one an app reads.
- Do not make a new request field or header required. Give it a default that matches what an
  old app meant by leaving it out.
- Do not remove or repurpose an endpoint, a socket event or an error code an app handles.
- A new feature flag must default, on a client that has never heard of it, to the behaviour old
  apps already have.
- If a change cannot follow these, ship it in this order:
  1. Release an app version that works with both the old and the new server behaviour.
  2. Wait for it to be live in the store.
  3. Raise the minimum to that version.
  4. Only then deploy the server change.

### The minimum version

The app sends two headers on every API request, read from `App.getInfo()`
(`frontend/src/services/nativeAppVersion.ts`):

| Header | Value |
|--------|-------|
| `X-BF-Platform` | `ios` or `android` |
| `X-BF-App-Version` | the store version, e.g. `1.4.0` (iOS `MARKETING_VERSION`) |

The server holds a minimum per platform in the `native_app` admin-config block
(`backend/src/services/adminConfig.ts`):

```json
{
  "ios_min_version": "",
  "ios_store_url": "",
  "android_min_version": "",
  "android_store_url": ""
}
```

Empty means no minimum, which is the default. When a request's version is older than its
platform's minimum, a global hook (`backend/src/middleware/minAppVersion.ts`) answers
`426` with `code: "UPDATE_REQUIRED"`, the minimum and the store link, and the app replaces
itself with an "Update required" screen that opens the store. The app also asks
`GET /api/app/version-check` at launch, so the screen appears before anything else loads. The
website sends neither header and is never refused.

To set it: Admin → Config → Patch config block → `native_app`. Send only the fields you are
changing, for example:

```json
{ "ios_min_version": "1.4.0", "ios_store_url": "https://apps.apple.com/app/id0000000000" }
```

The block is validated: a version must be one to three numbers (`1.4.0`), a store link must be
`https://`. It applies to every instance within a moment, with no deploy.

- **Never set a minimum above the newest version live in the store.** Those players would be
  locked out with nothing to update to. If that happens, set the minimum back (or to `""`);
  the screen's "Check again" button lets them back in without restarting the app.
- A request whose version is missing or unreadable is served, not refused.
- A refused app keeps its session: a `426` on the token refresh is not treated as a rejected
  sign-in, so the player is still signed in after updating.
- Sockets are not checked on their own. A refused app shows the update screen on its first API
  request and opens no socket after that.

## Analytics: telling the app from the website

The device class (`phone | tablet | desktop`) cannot: Safari on an iPhone and the iOS app are
both a `phone`. Signups and the daily `app_opened` beacon also carry `platform`
(`web | ios | android`, `frontend/src/utils/platform.ts`). An event recorded without one is
the website's.

- **Admin → Analytics:** a "By platform" table (signups, started a game, finished a game,
  saved account, back next day, opened the game), and a platform selector that narrows the
  activation, tutorial and first-turn funnels.
- **CLI:** `pnpm -C backend exec tsx scripts/funnelReport.ts 30` prints a `BY PLATFORM` table;
  add `--platform=ios` to narrow the funnels to signups in the iOS app.

## Not built yet

Three things the iOS app needs before it can be submitted. Each needs a real iPhone to
confirm, and each is waiting on a decision about its approach. Until they are built:

| | What happens in the app today | Why |
|---|---|---|
| **Staying signed in** | The session lasts only while the app stays in memory, and at most until the access token expires (about an hour for an account, four for a guest). Force-quit the app, or let iOS evict it, and the player is signed out. A guest loses their account, since nothing else can sign back in to it | The access token is kept in memory only, and the session renews with an httpOnly cookie on `/api/auth`. The app calls the API from another site (`capacitor://localhost`), and the web view does not send that cookie back |
| **Links that open the app** | An emailed sign-in link, an invite link and a shared replay link all open Safari, not the app | There is no `apple-app-site-association` file, no Associated Domains entitlement and no `appUrlOpen` handler |
| **Push notifications** | The app asks for notification permission at sign-in, and no notification ever arrives | `AppDelegate.swift` does not forward the registration callbacks, there is no push entitlement, and the server sends only through Firebase, which cannot use the token iOS gives the app. The Settings and lobby notification controls are also web-only |

When each is built, its section moves up into this page with its own device test steps.

## Testing on a device

What only a device can confirm, for the parts that are built. Do this against a server that is
safe to create accounts on.

**Before you start**

1. The server's `CORS_ORIGINS` includes `capacitor://localhost`, and the backend was restarted.
2. `chat_safety_enabled` and `guest_account_deletion_enabled` are on (Admin → Config).
3. On the Mac:
   ```bash
   git pull && pnpm install && pnpm --filter @borderfall/shared build
   cd frontend
   export VITE_API_URL=https://<the server>
   export VITE_SOCKET_URL=https://<the server>
   pnpm run cap:sync:ios
   pnpm run cap:ios
   ```
4. In Xcode: select your team, select your iPhone, Run. Repeat the list on an iPad.

**Opens as an app**

1. First launch shows the Borderfall start screen with "Play Free Now" and "Sign In". There is
   no landing page, and no flash of landing-page text before it.
2. The start screen clears the status bar and the home indicator.
3. Tap Play Free Now: a guest is made and the tutorial match (or the lobby) opens.
4. The lobby has no "Home", "Landing" or "Marketing Home" link.
5. Send the app to the background and bring it back: you are still in the lobby. (Force-quit
   and reopen, and you are back on the start screen with the guest gone. That is the
   sign-in gap in [Not built yet](#not-built-yet), not a fault in this list.)
6. Lobby copy for a guest says "saved on this device", not "in this browser".
7. Settings has no "Borderfall on your home screen" row, and nothing offers "Add to Home Screen".
8. In a game with chat, there is no GIF button. Text chat works; a message's menu offers Report
   and Block.
9. Finish a game and tap the Twitter / X share button: a browser sheet slides up over the
   game. Close it: you are back on the results screen, not in Safari.
10. Tap a Privacy or Terms link: it opens inside the app.

**Shared links**

11. In a lobby, open Invite and copy the link: it starts with `https://<the site>`, not
    `capacitor://localhost`.
12. From a finished game, copy the replay link: the same.

**Analytics**

13. In Admin → Analytics, "By platform" shows the guest you made under "iOS app", and one
    under "Opened the game".

**Update required**

14. In Xcode, note the app's version (`MARKETING_VERSION`, `1.0`).
15. In Admin → Config → Patch config block → `native_app`, save
    `{ "ios_min_version": "9.0", "ios_store_url": "https://apps.apple.com/app/id0000000000" }`.
16. Reopen the app: the "Update required" screen appears and nothing else is reachable.
17. Tap "Update in the App Store": the App Store app opens (on a listing that does not exist
    yet, which is expected).
18. Back in the app, tap "Check again": the screen stays.
19. Save `{ "ios_min_version": "", "ios_store_url": "" }` in Admin → Config, tap "Check
    again": the app returns with no restart, and you are still signed in.
20. On the website, in a browser, nothing changed during steps 15 to 19.

## Android

The Android project (`frontend/android/`) builds with the same scripts, and everything in
[How the app differs from the website](#how-the-app-differs-from-the-website) applies to it.
What is different, and not done:

- **It cannot talk to a production server yet.** Its page is served from `https://localhost`,
  and production refuses to start with that origin in `CORS_ORIGINS`. It needs its own
  hostname (Capacitor's `server.hostname`) first.
- `android/app/src/main/res/xml/network_security_config.xml` disables cleartext traffic. For
  emulator testing against `http://10.0.2.2:3001`, add a **debug-only** network security
  config that permits that host; do not ship it.
- After adding or removing a Capacitor plugin, run `pnpm exec cap sync android` so its Gradle
  plugin list is regenerated.

## Repo layout

| Path | What |
|------|------|
| `frontend/capacitor.config.ts` | `appId: com.borderfall.app`, `appName: Borderfall`, `webDir: dist` |
| `frontend/ios/App/` | The Xcode project. `App/AppDelegate.swift`, `App/MainViewController.swift` (registers in-repo plugins), `App/ThermalPlugin.swift`, `App/Info.plist`, `Podfile` (rewritten by `cap sync`) |
| `frontend/android/` | The Gradle project |
| `frontend/scripts/nativeBuildEnv.mjs`, `check-native-env.mjs` | The `build:native` guard |
| `frontend/src/utils/nativeApp.ts` | `isNativeApp()`, link handling, `openExternal()` |
| `frontend/src/utils/platform.ts` | `clientPlatform()` for analytics |
| `frontend/src/utils/publicOrigin.ts` | The public site's address, for shared links |
| `frontend/src/services/nativeAppVersion.ts` | Version headers, the launch check, the update-required state |
| `frontend/src/components/native/` | `NativeLinkHandler`, `WebOnlyRoute`, `UpdateRequiredScreen` |
| `frontend/src/pages/NativeHomePage.tsx` | `/` in the app |
| `backend/src/middleware/minAppVersion.ts` | The 426 hook |
| `scripts/build-ios-release.sh`, `scripts/build-android-release.sh` | Build, sync, open the IDE |

The apps ship as **Borderfall** with bundle ID `com.borderfall.app`: a new App Store and
Google Play listing, not an update to the legacy `com.chronoconquest.app` package.
