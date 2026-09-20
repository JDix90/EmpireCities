# Third-Party Connections — Borderfall

> Everything this app talks to that isn't in `docker-compose`. For each: what it's for, what credentials it needs, what breaks without it, and how to turn it off. Env var details: [CONFIGURATION.md](CONFIGURATION.md).

## Summary matrix

| Service | Purpose | Credentials / env | Code entry point | Without it |
|---|---|---|---|---|
| jsDelivr CDN | Globe textures + Natural Earth geojson | none | `GlobeMap.tsx`, `useTerritoryGeoSources.ts` | 3D globe loses earth texture; geo-shaped territories fall back to seed rectangles (2D) / fail to render shapes |
| Tenor API | In-chat GIF search | `VITE_TENOR_API_KEY` | `frontend/src/utils/gifSearch.ts` | GIF search hidden; chat otherwise unaffected |
| Sentry | Error reporting (both ends) | `SENTRY_DSN`, `VITE_SENTRY_DSN` | `backend/src/services/sentry.ts`, frontend `@sentry/react` init | Errors only in logs/console |
| Email (SMTP **or** Resend) | Password resets, transactional mail | `SMTP_*` or `EMAIL_PROVIDER=resend_api` + `RESEND_API_KEY` | `backend/src/services/notificationService.ts` | Password reset emails silently skipped (dev can log URLs via `PASSWORD_RESET_DEV_LOG`) |
| Firebase FCM | Push notifications (async-turn alerts, match found) | server: `FCM_SERVICE_ACCOUNT_PATH`; web: `VITE_FIREBASE_*` + `firebase-messaging-sw.js` | `notificationService.ts`, `frontend/src/services/pushNotifications.ts`, `modules/users/pushTest.ts` | No push, and no push UI on the web (status `unconfigured`); the in-app socket alerts and turn emails still work |
| Capacitor (APNs/FCM native) | Native iOS/Android push + device APIs | none beyond store builds | `@capacitor/*` plugins | Web-only behavior |
| Google Fonts (gstatic) | Cinzel / Inter webfonts | none | `index.html` / CSS | System-font fallback |
| Twitter / Discord intents | Post-game share links | none (outbound links only) | `ActionModal.tsx` share section | Buttons still open the sites |
| Game portals (itch.io, CrazyGames) | Distribution: the portal frames the live site | `EMBED_ORIGINS` (generated from `docker/portals.json`) | `backend/src/modules/auth/embedContext.ts`, `frontend/src/utils/embedContext.ts` | Frame refused (CSP) or, worse, the game plays but every reload is a fresh guest — see [PORTALS.md](PORTALS.md) |

## Notes per integration

**jsDelivr CDN** — two distinct uses: (1) `three-globe` example textures (blue-marble earth, topology, night sky, moon) for the 3D globe skin; (2) **Natural Earth** vector geojson (`ne_50m_admin_0_countries`, `ne_110m_admin_1_states_provinces`) that real-geography maps clip territory shapes from. Fetched client-side, module-cached once per session, and **skipped entirely for maps without geo hints** (galaxy/custom-canvas maps). Production CSP whitelists the host in `img-src`/`connect-src`. Offline dev: globe renders untextured polygons; 2D map falls back to seed-rectangle layouts.

**Sentry** — backend init at boot (`initSentry`), receives the global `unhandledRejection` backstop reports; frontend SDK wraps React. The backend DSN's ingest host is automatically added to the CSP `connect-src`. Both DSNs optional and independent.

**Email** — one logical service, two transports selected by `EMAIL_PROVIDER`: nodemailer/SMTP (default) or the Resend HTTPS API (`https://api.resend.com/emails`) for hosts that block outbound SMTP ports. Resend key falls back to `SMTP_PASS` so one secret can serve both configurations.

**Firebase push** — three credential surfaces that are easy to conflate: the **server** needs a service-account JSON file (admin SDK, sends the pushes); the **web client** needs the six `VITE_FIREBASE_*` values plus the service worker; **native** apps need neither (Capacitor registers with APNs/FCM directly). Tokens register via `POST /api/users/me/push-tokens`; stale tokens are pruned on send failure. The dev-console line `[Push] Firebase config not set; skipping web push` is expected when unconfigured.

Web push specifics, each the answer to a bug that once shipped:
- **The worker's config travels in its URL.** `public/` is copied verbatim and a worker cannot read `import.meta.env`, so the page registers `/firebase-messaging-sw.js?apiKey=…&projectId=…&messagingSenderId=…&appId=…` (`buildServiceWorkerUrl`) and the worker reads `self.location`. A worker registered without a config still installs (so page-side notifications can show through it) but never touches Firebase.
- **Permission is asked only inside a click** — `enableWebPush()` from Settings → Notifications → This browser or the lobby's opt-in card. The prompt is one-shot per origin and browsers remember a refusal; a gesture-less prompt on login once burned it on every deployment without Firebase. Init only completes a registration that was already granted. On an iPhone browser tab (web push exists only in a Home Screen app) the controls give Add-to-Home-Screen advice instead.
- **One card per turn.** Messages carry a `notification` block, which the FCM web SDK displays itself while the tab is hidden and *also* passes to `onBackgroundMessage`; the worker therefore shows only data-only messages. The card's icon (PNG — Android's tray does not render SVG) and tag (`turn-<gameId>`, shared with `GlobalTurnNotifier`'s page-side card so a push replaces it rather than stacking) come from `webpush.notification` in `sendPushNotification`. In front, the foreground handler defers to the socket alert for `your_turn` and `match_found`.
- **`POST /api/users/me/push-tokens/test`** sends a test card to every device on the account, optionally after `delay_ms` (the SDK only shows a system notification while the tab is hidden, so Settings asks for 5 s and tells the player to switch away). With no delay the response's `accepted` is FCM's count — the operator's `curl` check. Bypasses `push_enabled` on purpose; guests are refused.

**Privacy / data flow** — what leaves the server: Sentry receives error stacks (may include user ids in context); FCM receives device tokens + notification text; the email provider receives addresses + reset links; Tenor receives search terms (client-side); jsDelivr/Google Fonts receive standard CDN request metadata (client IPs). See [PRIVACY_POLICY.md](../PRIVACY_POLICY.md) for the user-facing commitments.
