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
- [Staying signed in](#staying-signed-in)
- [Links that open the app](#links-that-open-the-app)
- [Push notifications](#push-notifications)
- [Minimum app version and API compatibility](#minimum-app-version-and-api-compatibility)
- [Analytics: telling the app from the website](#analytics-telling-the-app-from-the-website)
- [Testing on a device](#testing-on-a-device)
- [Android](#android)
- [Repo layout](#repo-layout)

## Prerequisites

- Node and pnpm (repo root: `pnpm install`, then `pnpm --filter @borderfall/shared build`)
- **iOS (macOS only):** Xcode from the App Store, CocoaPods (`sudo gem install cocoapods`), an
  Apple Developer account for running on a device. The command-line tools must point at
  Xcode itself, not the separate Command Line Tools package, or `pod install` fails with
  "tool 'xcodebuild' requires Xcode": run
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, then
  `sudo xcodebuild -runFirstLaunch`. `xcode-select -p` should print that path
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

Five things on the server, none of which the website needs.

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

### 2. Let the app stay signed in

```bash
# in the server's .env.production
NATIVE_APP_ORIGINS=capacitor://localhost
```

Without it the app is signed out every time it is closed, and a guest loses their account.
See [Staying signed in](#staying-signed-in) for what it does and why it does not touch the
website. It names the same origin as `CORS_ORIGINS` above and needs that entry too. Never put a
web origin in it: the server refuses to start on one.

### 3. Turn on what an app with chat must have

Both are OFF by default and both are required before submission: Apple asks an app with chat
for a way to report content and block users (guideline 1.2), and an app that creates accounts
for a way to delete them inside the app (guideline 5.1.1(v)).

| Flag | What it adds | Where to switch it |
|------|--------------|--------------------|
| `chat_safety_enabled` | Report a chat message, block a player, Admin → Reports, Settings → Blocked players | Admin → Config, or `CHAT_SAFETY_ENABLED=true` |
| `guest_account_deletion_enabled` | A guest can delete their own account; Settings → Account → Delete account for everyone | Admin → Config, or `GUEST_ACCOUNT_DELETION_ENABLED=true` |

The in-app privacy page reads both flags and describes what is actually switched on
(`frontend/src/pages/PrivacyPage.tsx`).

### 4. Give the server the Apple push key

```bash
# in the server's .env.production; the path is the one inside the container
APNS_KEY_PATH=/run/secrets/borderfall/AuthKey_XXXXXXXXXX.p8
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
```

The key file goes on the host in `/etc/borderfall/secrets/`, beside the Firebase one. See
[Push notifications](#push-notifications) for where it comes from. Without these the app works
and simply receives no notifications.

### 5. Leave the minimum app version empty until there is a second version

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
To open the project in Xcode by hand, open `frontend/ios/App/App.xcworkspace`, never
`App.xcodeproj`: only the workspace includes the CocoaPods plugins.
`scripts/build-ios-release.sh` and `scripts/build-android-release.sh` wrap these and print a
release checklist.

In Xcode: choose a device and Run. The project uses automatic signing with the team committed
(`DEVELOPMENT_TEAM = 4RNR4T2NYM`, the same Team ID the association file publishes), so Signing &
Capabilities needs no change; the first run on a new iPhone registers it with the team. The app's entitlements
(`App/App.entitlements`) need a team in the paid Apple Developer Program.

**First time after a clone**, or if CocoaPods failed:

```bash
cd frontend/ios/App && pod install
```

**Version numbers.** `MARKETING_VERSION` (the store version, `1.0` today) and
`CURRENT_PROJECT_VERSION` (the build number) are in the Xcode project. The store version is
what the app reports to the server as its version; bump it for every release.

**The app starts through a scene.** Apps built with the iOS 27 SDK must use UIKit's scene life
cycle; one that does not is stopped at launch with "UIScene life cycle is required for apps built
with this SDK" (a black screen, and `EXC_BREAKPOINT` in `UIApplicationMain` in Xcode). So
`Info.plist` declares one scene (`UIApplicationSceneManifest`, storyboard `Main`), and
`AppDelegate.swift` holds a `SceneDelegate` that owns the window. Under scenes iOS hands a link
that opens the app to the scene delegate, not the app delegate, so that is where universal links
are passed to Capacitor (`ApplicationDelegateProxy`), on a cold start as well as while running.
Push registration still arrives in the app delegate.

**Minimum iOS version: 15.** Current Xcode refuses to build for anything lower. It is set in
three places that must agree: `IPHONEOS_DEPLOYMENT_TARGET` in the Xcode project, `platform :ios`
in `ios/App/Podfile`, and that Podfile's `post_install`, which raises every plugin pod to the
same minimum (their podspecs still say 13.0). `cap sync` leaves all three alone.

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
| A long press on text or an image | Selects it; Safari's callout | Nothing, as in any app; text boxes still select and paste (`native-app` class on `<html>`, `index.css`) |
| A long press on a link | Safari's link preview | No preview (`ios.allowsLinkPreview: false` in `capacitor.config.ts`) |
| How to Play's FAQ | Says the game runs in a browser with nothing to install | Leaves that out (`utils/appFaq.ts`). The website's FAQ and its search-engine data are unchanged |
| The map without graphics support | "This browser can't draw the map", with browser fixes | "This device can't draw the map", with what to do on a phone |

Adding a page that only makes sense on the website: wrap its route in `WebOnlyRoute` in
`App.tsx`. Opening another site from code: call `openExternal(url)`, not `window.open`.

**iPad.** The app targets iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`). An iPad gets
the game's desktop layout, the same as a tablet browser; the e2e smoke suite checks that no
page overflows at 820×1180 and 1024×768 (`frontend/tests/e2e/smoke.spec.ts`). The iPad build
supports all four orientations, so it also runs in Split View.

## Staying signed in

The website's session is an httpOnly refresh cookie on `/api/auth`, which the page's
JavaScript can never read. The app cannot use it: its page is served from inside the app and
calls the server across sites, and the web view does not send that cookie back. So for the app,
and only for the app, the refresh token travels in the request and response body, and the app
keeps it in the iOS Keychain.

| | Website | Native app |
|---|---|---|
| Where the refresh token is kept | httpOnly cookie | iOS Keychain, this device only, not iCloud (`frontend/src/services/nativeSession.ts`) |
| How it reaches the server | The browser sends the cookie | In the body of `POST /api/auth/refresh` |
| How a new one comes back | `Set-Cookie` | `refreshToken` in the response body |
| After the app or tab is closed | Still signed in | Still signed in |
| After a reinstall | Not applicable | Signed back in to the same account, a guest's included: the Keychain outlives the app |

**What keeps this from weakening the website** (`backend/src/modules/auth/nativeSession.ts`):

- Which path a request takes is decided by its `Origin` header against `NATIVE_APP_ORIGINS`, and
  by nothing the client chooses. A browser sets `Origin` itself, so a page on the website, even
  one running injected script, cannot ask for a token in a body.
- Every refresh token is signed as the app's or not. A cookie's token is refused in a body, and
  the app's is refused in a cookie.
- `NATIVE_APP_ORIGINS` refuses http(s) origins, so a mistake there cannot switch a website over
  to body tokens.
- With `NATIVE_APP_ORIGINS` empty, the default in production, the body path does not exist.

**What is different about the app's token**

- **A reply the app never received does not sign it out.** A phone suspends an app
  mid-request as a matter of course. The app's old token stays good until a newer one has been
  *used*, which is the proof the app received it. The website keeps its ten-minute window.
- **The app deletes its token only when the server says the app's session is over.** Every
  refusal on the app's path carries `native: true`. A `401` without it means the server is
  running without `NATIVE_APP_ORIGINS`; the app keeps its token and its session, because a
  deleted token cannot be got back.
- **A build without the Keychain plugin's native code does not freeze.** The app checks the
  native half is present before calling it, and Keychain calls time out after three seconds.
  The app then behaves as if it had no token.
- **Signing out, or deleting the account, removes the token** from the Keychain and retires it
  on the server.

## Links that open the app

An emailed sign-in link, a password reset link, a game invite, a shared replay and a
your-turn link all point at the website. With universal links, an iPhone that has the app
opens them in the app instead of Safari. Since most accounts are saved with only an email,
this is also how a reinstalled app on a *new* device signs back in.

**The paths the app claims** are one list, `APP_LINK_PATHS` in
`frontend/src/utils/appLinks.ts`: `/sign-in-link`, `/reset-password`, `/join/*`, `/replay/*`,
`/game/*`. Every other page of the site stays in Safari. A test checks that the list, the
association file, the nginx location and the entitlement agree
(`frontend/src/utils/appLinks.test.ts`).

| Piece | Where | What it does |
|-------|-------|--------------|
| Association file | `frontend/public/.well-known/apple-app-site-association` | Served by the website; tells iOS which paths belong to which app |
| nginx location | `docker/nginx.prod.conf`, `location = /.well-known/apple-app-site-association` | Serves it as `application/json`; a missing file is a 404, never `index.html` |
| Entitlement | `frontend/ios/App/App/App.entitlements`, `applinks:borderfall.gg` | Tells iOS the app claims links on that site |
| In the app | `frontend/src/components/native/AppLinkHandler.tsx` | Routes the opened link inside the app. Follows only https links on the site's own origin, on those paths |

### Before it works: the Team ID

The association file names the app as `<Team ID>.com.borderfall.app`, with the Apple
Developer Team ID (developer.apple.com → Membership details):

```json
"appIDs": ["4RNR4T2NYM.com.borderfall.app"]
```

That file is the only place in the repository that holds the Team ID, and a test checks it is
ten capitals and digits (`frontend/src/utils/appLinks.test.ts`). It takes effect when the
website is deployed with it; until then links keep opening Safari.

After deploying, check what production serves, from any machine:

```bash
curl -sI https://borderfall.gg/.well-known/apple-app-site-association
```

It must answer `200` with `content-type: application/json` and no `location:` header. A
redirect (to `www.`, to a trailing slash, to a login page) or an HTML answer and iOS ignores
it. nginx here serves it correctly; TLS and any redirects are in the proxy in front of it
(Caddy), outside this repository, which is why this check is worth running.

Things to know:

- **iOS fetches the file through Apple's servers when the app is installed**, and they cache
  it. After changing it, allow a day, or delete and reinstall the app to fetch it again.
- **Associated Domains needs the paid Apple Developer Program.** With a free personal team,
  Xcode refuses to sign the app while `App.entitlements` lists the domain.
- **Universal links do not fire for a link typed or pasted into Safari's address bar**, or
  followed within the same site. They fire for a tap in Mail, Messages, Notes and most apps.
- **Some mail apps open links in their own browser**, or wrap them in a tracking redirect, and
  the link then lands in a browser, not the app. That is what the sign-in code is for.

### The sign-in code

With `sign_in_code_enabled` (off by default), the sign-in email also shows a short code, and
the sign-in page asks for it once a link has been requested. The player types the code into
the app, next to the address the email was sent to. Turn it on before the app is released:
without it, a player whose mail app does not hand links to the app has no way to sign in to
an email-only account there.

- The code and the link spend the same one-time sign-in: either works once, both expire in 30
  minutes, and asking again replaces both.
- A code is only good with the address it was sent to, and an address gets ten tries per half
  hour, right or wrong.
- It works on the website too, for a player who opened the email on a different device.

## Push notifications

The website's push goes through Firebase. The iOS app's goes **straight to Apple** (APNs):
the app has no Firebase SDK and no `GoogleService-Info.plist`, so the token iOS gives it is
Apple's, and the server sends to it itself (`backend/src/services/apnsService.ts`).

| | Website | iOS app |
|---|---|---|
| Token comes from | Firebase, through the browser's push service | iOS (`@capacitor/push-notifications`) |
| Stored as | `push_tokens.platform = 'web'` | `push_tokens.platform = 'ios'` |
| Sent through | Firebase (`FCM_SERVICE_ACCOUNT_PATH`) | APNs (`APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`) |
| Asked for | Only from a control the player pressed | The same controls, the same rule |

**Opt-in is the same as on the web.** Signing in never raises the system's permission prompt.
The lobby card, the after-turn prompt, the results panel and Settings → Notifications raise it
when the player presses "Turn on" (`frontend/src/services/pushNotifications.ts`). iOS shows
its prompt once: after a refusal the row says to turn notifications on in the Settings app.

**The key** (do this once, in the Apple Developer account):

1. Certificates, Identifiers & Profiles → Keys → **+**.
2. Enable "Apple Push Notifications service (APNs)", continue, register.
3. Download `AuthKey_<KEY ID>.p8`. It can be downloaded once; keep a copy somewhere safe.
4. Note the Key ID on that page, and the Team ID under Membership details.
5. Copy the file to the server, into `/etc/borderfall/secrets/` (owner root, mode 600), and
   set the three variables in [Server settings](#4-give-the-server-the-apple-push-key).

The key is a secret. `*.p8` is in `.gitignore`; never commit it or paste its contents into an
env file. One key serves both the development and production environments.

**In the Xcode project**

- `App/App.entitlements` carries `aps-environment`. Xcode signs a build run from Xcode for
  the development environment and an archived build for production; nothing needs editing.
- `AppDelegate.swift` passes iOS's registration answer on to Capacitor. Without those two
  methods the app never learns its token.
- The App ID needs the Push Notifications capability, which needs the paid Apple Developer
  Program. With automatic signing Xcode adds it when the entitlement is present.

Things to know:

- **A build run from Xcode gets a sandbox token**; a TestFlight or App Store build gets a
  production one, and the token does not say which. The server tries production, then the
  sandbox, and remembers. Nothing to configure.
- **An iOS token is never sent to Firebase**, with or without the Apple key: Firebase would
  call it invalid, and that answer deletes the token.
- **A token Apple reports as gone** (the app was removed) is deleted, as Firebase's are.
- **The simulator** cannot be relied on for push; test on a device.
- A tap on a notification opens its game inside the app. With the app in front, the alert
  shows as a toast, and not at all for what the app already announces itself.

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

## Testing on a device

What only a device can confirm, for the parts that are built. Do this against a server that is
safe to create accounts on.

**Before you start**

1. The server's `CORS_ORIGINS` and `NATIVE_APP_ORIGINS` both include `capacitor://localhost`,
   the three `APNS_*` variables are set with the key file in place, and the backend was
   restarted.
2. `chat_safety_enabled`, `guest_account_deletion_enabled` and `sign_in_code_enabled` are on
   (Admin → Config).
3. On the Mac:
   ```bash
   git pull && pnpm install && pnpm --filter @borderfall/shared build
   cd frontend
   export VITE_API_URL=https://<the server>
   export VITE_SOCKET_URL=https://<the server>
   pnpm run cap:sync:ios
   pnpm run cap:ios
   ```
4. In Xcode: select your iPhone, Run. Repeat the list on an iPad.

**Opens as an app**

1. First launch shows the Borderfall start screen with "Play Free Now" and "Sign In". There is
   no landing page, and no flash of landing-page text before it.
2. The start screen clears the status bar and the home indicator.
3. Tap Play Free Now: a guest is made and the tutorial match (or the lobby) opens.
4. The lobby has no "Home", "Landing" or "Marketing Home" link.
5. Send the app to the background and bring it back: you are still in the lobby.
6. Lobby copy for a guest says "saved on this device", not "in this browser".
7. Settings has no "Borderfall on your home screen" row, and nothing offers "Add to Home Screen".
8. In a game with chat, there is no GIF button. Text chat works; a message's menu offers Report
   and Block.
9. Finish a game and tap the Twitter / X share button: a browser sheet slides up over the
   game. Close it: you are back on the results screen, not in Safari.
10. Tap a Privacy or Terms link: it opens inside the app.

**Feels like an app, not a web page** (App Store guideline 4.2)

- Press and hold on lobby text, a button and the map: nothing gets selected, no magnifier,
  no Copy menu.
- Press and hold a link (Privacy in Settings, say): no web page preview pops up.
- Press and hold in a text box (chat, sign-in email): the Paste menu still appears.
- Drag the lobby down past its top and up past its bottom: the page does not bounce away from
  its edges showing a blank background.
- Open How to Play → Frequently Asked Questions: nothing says "browser", "borderfall.gg" or
  "nothing to install".
- Turn on Airplane mode with the app open: a red "You are offline" bar appears below the
  status bar and notch, not under them. Turn it off: the bar goes.

**Staying signed in**

Note the guest's name in the lobby before you start.

- **Force-quit.** Swipe the app away in the app switcher and reopen it: it opens on the lobby,
  as the same guest.
- **Time.** Leave the app closed for more than four hours (a guest's access token lasts four)
  and reopen it: still the same guest.
- **Airplane mode.** Turn it on, reopen the app, turn it off: you are not signed out, and the
  game reconnects.
- **Reinstall.** Delete the app from the Home Screen, then run it again from Xcode: it opens
  on the lobby as the same guest, with the same level and games.
- **Sign out.** Sign out from the menu, force-quit, reopen: the start screen. Sign back in to
  a saved account and repeat the force-quit check.
- **Delete account.** Settings → Account → Delete account, then force-quit and reopen: the
  start screen, and the old guest does not come back.
- **The website.** Sign in on the website in Safari, close the tab, open it again: still
  signed in, exactly as before.

**Shared links**

11. In a lobby, open Invite and copy the link: it starts with `https://<the site>`, not
    `capacitor://localhost`.
12. From a finished game, copy the replay link: the same.

**Links that open the app**

These need the website deployed with the Team ID in its association file, and a build
signed with a paid team. Save a guest's account with an email first (Settings → Account).

- **Sign-in link.** Sign out. On the start screen tap Sign In, then "Email me a sign-in
  link", and enter the address. Open the email in Apple's Mail app on the same iPhone and tap the
  link: the Borderfall app opens and signs you in. Safari does not open.
- **Sign-in code.** Sign out and request a link again. Do not tap the link. Type the code from
  the email into the app: it signs you in. Type it a second time after signing out: refused.
- **Cold start.** Force-quit the app, then tap a fresh sign-in link in Mail: the app starts
  and signs you in.
- **Invite.** From another account on the website, create a lobby and send yourself its invite
  link in Messages. Tap it on the iPhone: the app opens on that lobby.
- **Replay.** Tap a shared replay link in Messages: the app opens the replay.
- **Not claimed.** Tap a link to `https://borderfall.gg/how-to-play` in Messages: Safari
  opens, not the app.
- **Without the app.** On a device without the app, the same sign-in link opens the website
  and signs in there, as before.

**Push notifications**

These need the Apple push key on the server and a build signed with a paid team.

- **No prompt at sign-in.** On a fresh install, tap Play Free Now and reach the lobby: iOS
  has not asked about notifications.
- **Turn on.** Settings → Notifications → "This device" → Turn on: iOS asks now. Allow. The
  row reads On.
- **Test.** Tap "Send test", then go to the Home Screen: a "Test notification" banner arrives
  within a few seconds.
- **In front.** Send another test and stay in the app: a toast appears in the app.
- **Your turn.** Start an async game against a second account on the website. Make the
  website's move with the app in the background: a "your turn" notification arrives. Tap it:
  the app opens on that game.
- **Refusal.** Delete and reinstall the app, tap Turn on, and choose Don't Allow: the row says
  to use the Settings app, and nothing arrives.
- **The website.** In a browser signed in to the same account, notifications behave as before.

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
| `frontend/ios/App/` | The Xcode project. `App/AppDelegate.swift` (the app delegate and the scene delegate), `App/MainViewController.swift` (registers in-repo plugins), `App/ThermalPlugin.swift`, `App/Info.plist`, `Podfile` (rewritten by `cap sync`) |
| `frontend/android/` | The Gradle project |
| `frontend/scripts/nativeBuildEnv.mjs`, `check-native-env.mjs` | The `build:native` guard |
| `frontend/src/utils/nativeApp.ts` | `isNativeApp()`, link handling, `openExternal()` |
| `frontend/src/utils/platform.ts` | `clientPlatform()` for analytics |
| `frontend/src/utils/publicOrigin.ts` | The public site's address, for shared links |
| `frontend/src/services/nativeAppVersion.ts` | Version headers, the launch check, the update-required state |
| `frontend/src/services/nativeSession.ts` | The Keychain refresh token |
| `frontend/src/utils/appLinks.ts`, `frontend/public/.well-known/apple-app-site-association`, `frontend/ios/App/App/App.entitlements` | Universal links: the paths, the file iOS reads, the entitlement |
| `backend/src/modules/auth/signInCode.ts` | The typed sign-in code |
| `backend/src/services/apnsService.ts` | Push to the iOS app, sent to Apple |
| `frontend/src/services/pushNotifications.ts` | Push registration and opt-in, web and app |
| `backend/src/modules/auth/nativeSession.ts` | The app's session path on the server |
| `frontend/src/components/native/` | `NativeLinkHandler`, `AppLinkHandler`, `WebOnlyRoute`, `UpdateRequiredScreen` |
| `frontend/src/pages/NativeHomePage.tsx` | `/` in the app |
| `backend/src/middleware/minAppVersion.ts` | The 426 hook |
| `scripts/build-ios-release.sh`, `scripts/build-android-release.sh` | Build, sync, open the IDE |

The apps ship as **Borderfall** with bundle ID `com.borderfall.app`: a new App Store and
Google Play listing, not an update to the legacy `com.chronoconquest.app` package.
