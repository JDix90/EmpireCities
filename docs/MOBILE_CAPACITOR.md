# ChronoConquest — Capacitor mobile workflow

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

- `frontend/capacitor.config.ts` — app id, `webDir: dist`, `androidScheme: https`
- `frontend/android/` — Gradle project (sync copies `dist` into assets)
- `frontend/ios/` — Xcode project (when present)
