# Borderfall — Capacitor mobile workflow

The web client lives in `frontend/`. Capacitor wraps the Vite `dist/` output as iOS and Android apps.

## Prerequisites

- Node / pnpm (repo root: `pnpm install`)
- **Android:** Android Studio, JDK 17+
- **iOS (macOS only):** Xcode from the App Store, CocoaPods (`sudo gem install cocoapods`)

## Environment

Build the web app with your API origin baked in (required outside local dev):

```bash
cd frontend
export VITE_API_URL=https://api.yourdomain.com
export VITE_SOCKET_URL=https://api.yourdomain.com
pnpm run build
```

Backend: set `CORS_ORIGINS` to include your Capacitor / hosted app origins (see `backend/.env.example`). For cross-site cookies, tune `REFRESH_COOKIE_SAME_SITE` (often `lax` or `none` with HTTPS).

## Sync native projects

```bash
cd frontend
pnpm run build
pnpm exec cap sync
```

## Open in IDEs

```bash
pnpm run cap:ios       # opens Xcode (after pods install)
pnpm run cap:android   # opens Android Studio
```

## iOS ATS

Use **HTTPS** for the API. The default Capacitor iOS project enforces App Transport Security; do not point production builds at `http://` APIs.

## Android network security

`android/app/src/main/res/xml/network_security_config.xml` disables cleartext traffic. For emulator testing against `http://10.0.2.2:3001`, add a **debug-only** manifest or a debug `network_security_config` that permits that host (do not ship that to production).

## First-time iOS after clone

If `ios/` is missing or CocoaPods failed:

```bash
cd frontend
pnpm exec cap add ios
cd ios/App && pod install && cd ../..
```

## Repo layout

- `frontend/capacitor.config.ts` — `appId: com.borderfall.app`, `appName: Borderfall`, `webDir: dist`, `androidScheme: https`
- `frontend/android/` — Gradle project (`com.borderfall.app`; sync copies `dist` into assets)
- `frontend/ios/` — Xcode project (`PRODUCT_BUNDLE_IDENTIFIER = com.borderfall.app`, when present)

## Borderfall store migration

The native apps ship as **Borderfall** with bundle ID `com.borderfall.app`. This is a **new** App Store / Google Play listing — not an update to the legacy `com.chronoconquest.app` package.

After changing web branding or API URLs:

```bash
cd frontend
export VITE_API_URL=https://api.yourdomain.com
export VITE_SOCKET_URL=https://api.yourdomain.com
pnpm run cap:sync
```

Verify the home-screen label reads **Borderfall** and deep links use the `com.borderfall.app` URL scheme from `strings.xml` (Android) / associated domains (if configured).

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

