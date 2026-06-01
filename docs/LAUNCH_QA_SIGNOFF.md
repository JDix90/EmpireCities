# Launch QA sign-off

Use this checklist before **web soft launch**, **each store submission**, and **major patches**.  
Assign an owner per gate; record date and blockers in the sign-off table at the bottom.

**Web go-live:** Gates A + B + C + D + E + G must pass.  
**Store submit:** All gates (A–H) must pass on the build uploaded to TestFlight / Play internal track.

---

## Gate A — Automated (~15 min)

| Step | Command / action | Owner | Pass |
|------|-------------------|-------|------|
| A1 | `bash .cursor/skills/feature-integration-playbook/scripts/verify.sh` | | |
| A2 | `pnpm run validate:maps` | | |
| A3 | `pnpm run test:frontend` | | |
| A4 | `pnpm run test:e2e:smoke` && `pnpm run test:e2e:map-visual` | | |
| A5 | `docker compose -f docker/docker-compose.prod.yml --env-file .env.production build` | | |
| A6 | `./scripts/smoke-production.sh https://YOUR_STAGING_OR_PROD_URL` | | |
| A7 | `pnpm audit` — patch critical/high | | |

---

## Gate B — Auth and account (~30 min)

- [ ] Register → land in lobby
- [ ] Log out → log in → session persists after reload
- [ ] Wrong password → clear error
- [ ] Password reset (SMTP or `PASSWORD_RESET_DEV_LOG` on staging) → reset → login
- [ ] Profile → delete account → cannot log in again
- [ ] Guest play works; ranked / store / campaign blocked for guests

---

## Gate C — Core gameplay (~2 h, 2 testers)

Desktop Chrome — full match (human vs human or vs AI):

- [ ] C1 Lobby: create game (fog, economy, events, secret missions combos)
- [ ] C2 Draft + deploy cap when stability low
- [ ] C3 Attack: combat modal, capture, card earn
- [ ] C4 Fortify
- [ ] C5 Tech + wonder (if enabled)
- [ ] C6 Event card
- [ ] C7 Victory / game over
- [ ] C8 Reconnect after tab background ~30s
- [ ] C9 Replay at `/game/:id/replay`
- [ ] Globe era + 2D-only era smoke

---

## Gate D — Feature matrix (~1 day, split owners)

| Feature | Route | Desktop | Mobile web | Notes |
|---------|-------|---------|------------|-------|
| Ranked | Lobby queue | | | 3 buckets |
| Daily | `/daily` | | | UTC day |
| Campaign | `/campaign` | | | Guest blocked |
| Tutorial | `/tutorial` | | | |
| Map editor | `/editor` | | | Publish |
| Map hub | `/maps` | | | Rate/report |
| Friends | `/friends` | | | Invites |
| Store | `/store` | | | Gold only |
| How to Play | `/how-to-play` | | | |
| Chat | In-game | | | |
| Async | Create w/ deadline | | | Email if SMTP |

---

## Gate E — Mobile web (~2 h)

iPhone Safari + Android Chrome @ ~390px:

- [ ] Landing: no horizontal scroll; CTAs tappable
- [ ] Lobby create modal: actions reachable (`modal-mobile.spec.ts`)
- [ ] Game: bottom bar, HUD drawer, territory panel, cards tray
- [ ] Globe: pinch doesn’t zoom browser; territory tap works
- [ ] Game load failure: error + Back to Lobby within 15s
- [ ] Lite mode toggle (HUD drawer)

---

## Gate F — Native (before store submit)

Physical devices vs production API:

| Test | Android | iOS |
|------|---------|-----|
| Cold start → login | | |
| Socket join + full turn | | |
| Background reconnect | | |
| Push opt-in (if enabled) | | |
| Icon + splash | | |

Build with `./scripts/build-android-release.sh` or `./scripts/build-ios-release.sh`.

---

## Gate G — Security and ops (~2 h)

Walk [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md):

- [ ] JWT secrets not defaults; CORS limited to your domains
- [ ] Auth rate limits; socket requires JWT
- [ ] `/ready` fails when DB down
- [ ] Backup via `./scripts/backup-databases.sh`; restore drill once
- [ ] Deploy restart: graceful shutdown documented; in-memory game loss understood

---

## Gate H — Store compliance

- [ ] [STORE_RELEASE.md](STORE_RELEASE.md) complete
- [ ] `https://YOUR_DOMAIN/privacy` → 200
- [ ] `https://YOUR_DOMAIN/terms` → 200
- [ ] Screenshots match current UI
- [ ] Demo account in App Review notes (if required)
- [ ] Age rating forms consistent; no real-money IAP at launch

---

## Sign-off record

| Gate | Date | Owner | Pass? | Blockers |
|------|------|-------|-------|----------|
| A Automated | | | | |
| B Auth | | | | |
| C Core gameplay | | | | |
| D Feature matrix | | | | |
| E Mobile web | | | | |
| F Native | | | | |
| G Security/Ops | | | | |
| H Store compliance | | | | |

**Release:** __________________ **Version/tag:** __________________
