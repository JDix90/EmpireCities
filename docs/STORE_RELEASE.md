# Store release checklist (template)

Use this when submitting Borderfall to Apple App Store and Google Play. Adjust for your legal entity and hosting.

## Before submission

- [ ] Production API on HTTPS with valid TLS
- [ ] `VITE_API_URL` / `VITE_SOCKET_URL` set for release builds
- [ ] `CORS_ORIGINS` and cookie `REFRESH_COOKIE_SAME_SITE` verified on real devices
- [ ] Database migrations applied through `026_rebrand_borderfall.sql` (run `pnpm run db:migrate` from repo root)
- [ ] Database migration `003_user_delete_fk.sql` applied (required for account deletion)
- [ ] Privacy Policy URL live (e.g. `/privacy` on your marketing site or in-app WebView)
- [ ] Terms of Service URL live (e.g. `/terms`)
- [ ] Support email or form in store listing

## Apple App Store

- [ ] Apple Developer Program enrollment
- [ ] App Store Connect: display name **Borderfall**; bundle ID `com.borderfall.app` (new listing — distinct from legacy `com.chronoconquest.app`)
- [ ] Privacy nutrition labels (data collected: account, gameplay, identifiers if any)
- [ ] Age rating (strategy / mild combat)
- [ ] Screenshots for required device sizes
- [ ] TestFlight internal testing
- [ ] Export compliance / encryption questionnaire (typically standard HTTPS)

## Google Play

- [ ] Play Console developer account
- [ ] Application ID aligned with Capacitor `appId`
- [ ] Data safety form (account data, optional analytics)
- [ ] Content rating questionnaire
- [ ] Internal testing track with AAB
- [ ] Signed upload key stored securely

## Versioning

- Bump `version` / `android.versionName` / iOS `MARKETING_VERSION` as part of release process
- Document any breaking API changes for forced-upgrade logic (future)

## Store listing copy (template)

**Short description:** Turn-based territory strategy across historical eras — draft, attack, fortify, conquer.

**Full description:** Borderfall is a free strategy game inspired by classic territory conquest. Command armies across historical world maps and regional theaters, research technologies, play ranked matches, daily challenges, and async games with friends. No real-money purchases at launch — earn gold and cosmetics through gameplay.

**Category:** Strategy  
**Support URL:** `https://YOUR_DOMAIN/` (or dedicated support page)  
**Privacy URL:** `https://YOUR_DOMAIN/privacy`  
**Terms URL:** `https://YOUR_DOMAIN/terms`

**Build commands:**

```bash
export VITE_API_URL=https://YOUR_DOMAIN
export VITE_SOCKET_URL=https://YOUR_DOMAIN
./scripts/build-android-release.sh   # then sign AAB in Android Studio
./scripts/build-ios-release.sh       # then Archive in Xcode
```

## Post-launch

- [ ] Error monitoring (e.g. Sentry) for API and optional WebView JS
- [ ] Backup and restore drill for PostgreSQL
