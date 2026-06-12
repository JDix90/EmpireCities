# Third-Party Connections — Borderfall

> Everything this app talks to that isn't in `docker-compose`. For each: what it's for, what credentials it needs, what breaks without it, and how to turn it off. Env var details: [CONFIGURATION.md](CONFIGURATION.md).

## Summary matrix

| Service | Purpose | Credentials / env | Code entry point | Without it |
|---|---|---|---|---|
| jsDelivr CDN | Globe textures + Natural Earth geojson | none | `GlobeMap.tsx`, `useTerritoryGeoSources.ts` | 3D globe loses earth texture; geo-shaped territories fall back to seed rectangles (2D) / fail to render shapes |
| Tenor API | In-chat GIF search | `VITE_TENOR_API_KEY` | `frontend/src/utils/gifSearch.ts` | GIF search hidden; chat otherwise unaffected |
| Sentry | Error reporting (both ends) | `SENTRY_DSN`, `VITE_SENTRY_DSN` | `backend/src/services/sentry.ts`, frontend `@sentry/react` init | Errors only in logs/console |
| Email (SMTP **or** Resend) | Password resets, transactional mail | `SMTP_*` or `EMAIL_PROVIDER=resend_api` + `RESEND_API_KEY` | `backend/src/services/notificationService.ts` | Password reset emails silently skipped (dev can log URLs via `PASSWORD_RESET_DEV_LOG`) |
| Firebase FCM | Push notifications (async-turn alerts) | server: `FCM_SERVICE_ACCOUNT_PATH`; web: `VITE_FIREBASE_*` + `firebase-messaging-sw.js` | `notificationService.ts`, `frontend/src/services/pushNotifications.ts` | No push; in-app notification feed still works |
| Capacitor (APNs/FCM native) | Native iOS/Android push + device APIs | none beyond store builds | `@capacitor/*` plugins | Web-only behavior |
| Google Fonts (gstatic) | Cinzel / Inter webfonts | none | `index.html` / CSS | System-font fallback |
| Twitter / Discord intents | Post-game share links | none (outbound links only) | `ActionModal.tsx` share section | Buttons still open the sites |

## Notes per integration

**jsDelivr CDN** — two distinct uses: (1) `three-globe` example textures (blue-marble earth, topology, night sky, moon) for the 3D globe skin; (2) **Natural Earth** vector geojson (`ne_50m_admin_0_countries`, `ne_110m_admin_1_states_provinces`) that real-geography maps clip territory shapes from. Fetched client-side, module-cached once per session, and **skipped entirely for maps without geo hints** (galaxy/custom-canvas maps). Production CSP whitelists the host in `img-src`/`connect-src`. Offline dev: globe renders untextured polygons; 2D map falls back to seed-rectangle layouts.

**Sentry** — backend init at boot (`initSentry`), receives the global `unhandledRejection` backstop reports; frontend SDK wraps React. The backend DSN's ingest host is automatically added to the CSP `connect-src`. Both DSNs optional and independent.

**Email** — one logical service, two transports selected by `EMAIL_PROVIDER`: nodemailer/SMTP (default) or the Resend HTTPS API (`https://api.resend.com/emails`) for hosts that block outbound SMTP ports. Resend key falls back to `SMTP_PASS` so one secret can serve both configurations.

**Firebase push** — three credential surfaces that are easy to conflate: the **server** needs a service-account JSON file (admin SDK, sends the pushes); the **web client** needs the six `VITE_FIREBASE_*` values plus the service worker; **native** apps need neither (Capacitor registers with APNs/FCM directly). Tokens register via `POST /api/users/me/push-tokens`; stale tokens are pruned on send failure. The dev-console line `[Push] Firebase config not set; skipping web push` is expected when unconfigured.

**Privacy / data flow** — what leaves the server: Sentry receives error stacks (may include user ids in context); FCM receives device tokens + notification text; the email provider receives addresses + reset links; Tenor receives search terms (client-side); jsDelivr/Google Fonts receive standard CDN request metadata (client IPs). See [PRIVACY_POLICY.md](../PRIVACY_POLICY.md) for the user-facing commitments.
