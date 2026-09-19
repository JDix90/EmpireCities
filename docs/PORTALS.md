# Game Portals — embedding borderfall.gg

> How the game is distributed through third-party portals (itch.io, CrazyGames, …) by framing the live site, why three separate allowlists must agree, and the routine that keeps them agreeing. Source of truth: [`docker/portals.json`](../docker/portals.json). Status: **current**.

## The three things that must agree

A portal embeds `https://borderfall.gg` in an iframe. For a player on that portal to get a game that works *and* keeps its session across reloads, three independent mechanisms have to name the portal's origins consistently:

| # | Mechanism | Answers | Lives in | Written by |
|---|---|---|---|---|
| 1 | nginx `Content-Security-Policy: frame-ancestors` | who may **frame** the HTML at all | [`docker/nginx.prod.conf`](../docker/nginx.prod.conf), between `# BEGIN/END portal frame-ancestors` markers | `syncPortals.ts` |
| 2 | `EMBED_ORIGINS` on the backend | who gets the **cross-site refresh cookie** (`Partitioned; SameSite=None`) instead of the default `Lax` one that a third-party frame can never send back | operator env on the droplet (`.env.production` → compose `environment:`); sample line in [`.env.production.example`](../.env.production.example) | operator sets it; `syncPortals.ts` prints the value and rewrites the sample |
| 3 | client per-portal policy | what the game may **show inside that portal's frame** (today: `ownAuthUi`, whether our own login/register UI is allowed) | [`frontend/src/utils/portals.generated.ts`](../frontend/src/utils/portals.generated.ts), consumed by [`utils/embedContext.ts`](../frontend/src/utils/embedContext.ts) (`detectPortal`, `ownAuthUiAllowed`) | `syncPortals.ts` |

What drift looks like, so you recognise it in a bug report:

- **In (1) but not (2)** — the worst case, because it is silent. The frame renders, the game plays, and every reload starts a fresh anonymous guest: the refresh cookie was set `SameSite=Lax`, the browser withheld it from the cross-site frame, and the client fell back to a new `/auth/guest`. This is exactly how CrazyGames drifted before the registry existed (the CSP carried `https://*.crazygames.com`; the cookie allowlist had no wildcard support and a hand-expanded list dropped `www.crazygames.com`, the one origin players arrive on).
- **In (2) but not (1)** — loud, and therefore better: the browser refuses to render the frame at all and logs a `frame-ancestors` violation.
- **Wrong (3)** — the game shows a login/register form on a portal whose review rules forbid it (CrazyGames lists "No external login options" under its *Basic* requirements), or hides the upgrade path on a portal that allows it.

The registry makes drift a test failure instead of a support ticket: [`backend/src/config/portalRegistry.test.ts`](../backend/src/config/portalRegistry.test.ts) rebuilds (1), (3) and the env sample from the registry and fails with `stale — run: pnpm -C backend exec tsx scripts/syncPortals.ts` when any of them differs.

## Origin syntax

The same syntax is read by all three consumers (nginx CSP, `parseEmbedOriginList` in [`backend/src/modules/auth/embedContext.ts`](../backend/src/modules/auth/embedContext.ts), and the client matcher):

- An absolute origin: `scheme://host[:port]`, no path, no trailing slash.
- `scheme://*.example.com` matches **subdomains only**. It never matches the bare `example.com`, so list that separately when the portal serves from it.
- There is **no TLD wildcard** anywhere. `https://*.com` is refused by the parser, and CSP has no such form either. A portal with country-code sites (`crazygames.fr`, `crazygames.com.br`, …) needs every one enumerated, because each is a separate registration.
- Native app shells must carry their scheme explicitly (`capacitor://app.crazygames.com`). A bare host inherits `https` and the app then white-screens.
- Matching is on the whole authority with a `.` boundary, so `https://crazygames.com.evil.example` matches nothing, and a downgraded scheme or an extra port does not match either.

## Registry fields

```json
{
  "id": "crazygames",                      // stable slug; the client's detectPortal() returns it
  "name": "CrazyGames",
  "origins": ["https://crazygames.com", "https://*.crazygames.com", "capacitor://app.crazygames.com", "..."],
  "ownAuthUi": false,                      // false = never show our own login/register/upgrade UI in this frame
  "notes": "Basic Launch submitted 2026-09-19. ..."   // free text: dates, source of each origin, review outcome
}
```

`ownAuthUi` is the only policy field today. Add a field here first when a portal needs another (e.g. a required SDK hook, a purchase restriction), then thread it through `generatedTs()` in the script and the `Portal` interface, and read it via `detectPortal(...)` in the client. Do not hard-code portal hostnames anywhere else in the client.

## The routine: add or change a portal

1. **Collect the facts from the portal's own documentation** before touching anything:
   - every origin that can be an *ancestor* of our frame — the page host **and** any sandbox host (itch.io: the project page is `<user>.itch.io`, the sandboxed player is `*.itch.zone`; both are ancestors, both are needed);
   - regional / country-code domains (their docs may write `crazygames.*`, which no allowlist can express — enumerate);
   - native app schemes (`capacitor://…`, `ionic://…`);
   - their login policy (does the portal forbid a game showing its own account UI?);
   - their submission model (SDK required? a "basic" tier without one? multiplayer flags that imply SDK calls?).
2. **Edit [`docker/portals.json`](../docker/portals.json)** — add the portal (or its new origins). Put the date and the source of each unusual origin in `notes`.
3. **Sync the generated artifacts:**
   ```bash
   pnpm -C backend exec tsx scripts/syncPortals.ts
   ```
   This rewrites the nginx block, `portals.generated.ts` and the env sample, and prints the `EMBED_ORIGINS=` line to set on the server. Re-running is idempotent.
4. **Verify locally:**
   ```bash
   pnpm -C backend exec vitest run src/config/portalRegistry.test.ts   # drift + syntax
   bash scripts/check-nginx-conf.sh                                     # nginx still parses
   cd frontend && npx vitest run src/utils/embedContext.test.ts          # client matcher
   ```
   Add a `detectPortal` case for the new portal's real origins (and one lookalike) to `embedContext.test.ts`.
5. **Commit the registry and everything it generated together** — `docker/portals.json`, `docker/nginx.prod.conf`, `frontend/src/utils/portals.generated.ts`, `.env.production.example` — in one PR. CI's backend job runs the drift test, so a half-committed change fails there.
6. **Deploy, then set the env.** On the droplet, from the repo root:
   ```bash
   git pull
   # paste the EMBED_ORIGINS=… line the script printed into .env.production
   ./scripts/deploy-production.sh
   docker compose -f docker/docker-compose.prod.yml --env-file .env.production exec -T backend printenv EMBED_ORIGINS
   ```
   A **rebuild is required** (the default; not `--no-build`): the nginx conf and the generated client file are baked into the web image at build time. The backend reads `EMBED_ORIGINS` at boot from compose's `environment:` block, so the value must be in `.env.production` *before* `up -d` recreates the container. The deploy script validates the nginx conf before swapping anything, so a syntax slip fails the deploy rather than the site.
7. **Verify live** (probes below), then do the portal-side work: upload the launcher shell or register the URL, submit for review, and record the outcome in `notes`.

## Verification probes

Run these against production after every deploy that touches the registry.

**The frame header carries the origin:**
```bash
curl -sI https://borderfall.gg/ | grep -i '^content-security-policy'
```
Expect `frame-ancestors 'self' …` listing every registry origin. This is served by nginx for the SPA only; API responses carry helmet's CSP, which is fine because they are never framed.

**The cookie is partitioned for a real portal origin and not for a lookalike:**
```bash
# real portal origin → Partitioned; SameSite=None
curl -s -D - -o /dev/null -X POST https://borderfall.gg/api/auth/guest \
  -H 'content-type: application/json' -H 'x-bf-embedder: https://www.crazygames.com' -d '{}' \
  | grep -i '^set-cookie: refreshToken'
# lookalike → SameSite=Lax (the default), i.e. NOT trusted
curl -s -D - -o /dev/null -X POST https://borderfall.gg/api/auth/guest \
  -H 'content-type: application/json' -H 'x-bf-embedder: https://crazygames.com.evil.example' -d '{}' \
  | grep -i '^set-cookie: refreshToken'
```
`x-bf-embedder` is the header the client sends with the origin that framed it; the server only honours it when the value is in `EMBED_ORIGINS`. Each probe creates a throwaway guest, so do not loop it.

**The session survives a reload inside the real portal** (the only test that exercises all three at once): open the game on the portal's page, click *Play Free Now*, note the guest name in the lobby, reload the portal page, click again — the name must be the same. If it changes, the cookie was not sent back: check (2) first, then the browser's third-party-cookie setting.

## Client-side behaviour inside a frame

- The client stores the framing origin once at boot (`EMBEDDER_ORIGIN` in `utils/embedContext.ts`) and sends it as `x-bf-embedder` on `/auth/guest` and `/auth/refresh`.
- `localStorage` may be entirely unavailable in a third-party frame (Safari's default, Chrome's "Block third-party cookies"). All persisted state goes through `utils/safeStorage.ts`, which probes once and falls back to memory, so the game still renders and a guest can still play; only the *reload* continuity depends on the partitioned cookie.
- `ownAuthUiAllowed()` gates every login/register/upgrade entry point (routes `/login`, `/register`, `/upgrade`, `/forgot-password`, `/reset-password` redirect to `/`; CTAs are hidden). Everything else is unchanged inside a frame.
- Attribution: the itch launcher shell adds `?utm_source=itch.io&utm_medium=embed`, so signups group under the portal in Admin → Analytics. Give every new portal a `utm_source` the same way. The shell itself lives in [`scripts/itch-launcher/`](../scripts/itch-launcher/README.md).

## Before adding a portal that is an aggregator network

Some distributors (GameDistribution, GamePix and similar) syndicate a game to thousands of publisher sites. The framing origin is then any of those sites, which an allowlist cannot express: the frame renders only where the CSP names the framer, and the cookie is partitioned only where `EMBED_ORIGINS` does. Those networks generally expect a *static* build hosted on their CDN with their SDK, not a framed live site, so they are a different integration (a launcher shell with a different session strategy), not a registry entry. Confirm the model from their docs before promising anything.

## Portal status

| Portal | Status | Notes |
|---|---|---|
| itch.io | live | Launcher shell in `scripts/itch-launcher/`. Own login UI allowed. |
| CrazyGames | Basic Launch submitted 2026-09-19, awaiting review | No external login options (Basic rule) → `ownAuthUi: false`. Regional domains enumerated from their sitelock docs. |
| Poki, Newgrounds, GamePix, GameDistribution | not started | Nothing confirmed; run step 1 of the routine first. |
