# itch.io launcher shell

`index.html` is the whole thing: a single self-contained page, uploaded to
itch.io as an HTML project, that frames the live borderfall.gg.

Borderfall is a full-stack app — Postgres, Redis, sockets — so it cannot be
uploaded as the static build itch hosts for HTML projects. This shell is the
bridge: itch hosts the shell, the shell shows the real game.

## Build and upload

```bash
./scripts/itch-launcher/build.sh        # -> dist/borderfall-itch.zip
```

On the itch project page:

| setting | value |
|---|---|
| Kind of project | **HTML** |
| Upload | `borderfall-itch.zip`, ticked "This file will be played in the browser" |
| Viewport dimensions | 960 × 600 (any 16:10-ish size; the shell fills whatever it gets) |
| Fullscreen button | **enabled** — the game benefits from the room |
| Mobile friendly | enabled |

## What it does

It loads `borderfall.gg` in an iframe with `?utm_source=itch.io&utm_medium=embed`,
so signups from here land under `itch.io` in Admin → Analytics without any
extra tagging. `captureAttribution` snapshots the UTM before first render.

Framing is blocked unless the server allows it (see below). The shell detects
that and shows a branded "Play in a new tab" card instead, so it is useful
today and upgrades itself the moment the server side is switched on — no
re-upload needed.

### How it knows the game loaded

**The app says so; the shell does not guess.** On first render borderfall.gg
posts `{source:'borderfall', type:'embed-ready', version:1}` to its parent
(`notifyEmbedderReady` in
[`../../frontend/src/utils/embedContext.ts`](../../frontend/src/utils/embedContext.ts),
re-sent at 0/500/2000 ms so a parent that attaches its listener late still hears
it). The shell settles only on a message passing all three checks:
`event.source === frame.contentWindow`, `event.origin === 'https://borderfall.gg'`,
and the exact payload shape.

Earlier versions inferred it instead, by reading
`frame.contentWindow.location.href` and treating the `SecurityError` as proof of
a loaded cross-origin document. That is wrong, and was measured wrong on the
live Newgrounds player: a frame refused by `frame-ancestors` fails with
`ERR_BLOCKED_BY_RESPONSE`, lands on `chrome-error://chromewebdata/`, and throws
the *same* error — so the shell hid its fallback behind Chrome's "refused to
connect" page. The frame's `load` event settles nothing either; it fires for the
error page too, and only starts a 6 s grace (12 s hard deadline if `load` never
fires at all).

**Deploy order matters:** silence is failure, so deploy borderfall.gg *before*
uploading this shell. A shell in front of an app build that predates the
handshake would cover a working game with a "could not load" button. Confirm the
live bundle sends it:

```bash
curl -s https://borderfall.gg/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1
curl -s https://borderfall.gg/assets/index-XXXX.js | grep -c 'embed-ready'   # >= 1
```

## It must never bust out of its frame

No `top.location`, no `parent.location`, no auto-redirect. Navigating the
player away from itch is hostile to the platform and to the person who clicked
Run. The only way out is a link the visitor chooses to click, in a new tab.

## What has to be true for inline play

**Both are done and verified live** (2026-09-20). Kept here because they are the
two things to re-check first if framing ever stops working.

✅ **The document sends a CSP naming the whole itch ancestor chain.**
`docker/nginx.prod.conf` adds, at server level:

```
frame-ancestors 'self' https://itch.io https://*.itch.io https://*.itch.zone
```

All three matter. `frame-ancestors` is checked against **every ancestor**, not
just the immediate parent, and embedding on itch is three deep:

| level | origin | why |
|---|---|---|
| top | `<user>.itch.io` | the project page |
| middle | `*.itch.zone` | itch's sandboxed player, holding this shell |
| inner | borderfall.gg | the game |

Naming only the player origin fails with *"Refused to frame … because an
ancestor violates …"* — the project page sits above it. The wildcards are
itch's own site-locking recommendation, because the player subdomain varies.

   (The `EMBED_ORIGINS` work in `modules/auth/embedContext.ts` governs helmet's
   CSP, which only rides on **API** responses — the API is not what gets framed.
   It still matters for the refresh cookie, which is per-request, and it
   understands the same `*.` shape: `isEmbeddedOrigin` matches a wildcard entry
   against any subdomain of its suffix, so these three cover the cookie side as
   well as framing.)

✅ **`X-Frame-Options` is no longer sent on the document.** It used to be, and it
blocked framing outright: browsers honour XFO alongside CSP and XFO has no
allowlist (`SAMEORIGIN` or `DENY` only), so while it was sent the frame stayed
blocked no matter what the CSP said. It was never set by `nginx.prod.conf` or by
helmet — it came from the TLS-terminating layer in front of nginx, which lives
outside this repository. If framing regresses, check this before anything else,
because nothing in this repo can cause or fix it.

To confirm the state at any time:

```bash
curl -sSI https://borderfall.gg/ | grep -iE 'x-frame-options|content-security-policy'
```

You want to see a `content-security-policy` line naming `html-classic.itch.zone`
and **no** `x-frame-options` line.

`isEmbeddedOrigin` reads the same `*.` wildcards, matched on the whole
authority against the suffix **with** its leading dot — so `jdix90.itch.io` and
`html-classic.itch.zone` are in, while `evilitch.io` and `itch.io.evil.test` are
not. The bare domain does not match its own wildcard, which is why
`https://itch.io` is listed separately. (An earlier version of this file said
the matcher was exact and that the cookie side needed literal origins; that
stopped being true when wildcard support was added for CrazyGames.)

## Caveat worth keeping in view

`html-classic.itch.zone` is a **shared user-generated-content origin** — anyone
can upload a game there. Allowing it to frame Borderfall means any itch-hosted
page can, and can cause a `SameSite=None` refresh cookie to be issued into that
visitor's browser. The cookie stays `HttpOnly` and scoped to `/api/auth`, so a
framing page cannot read it, but it does weaken that visitor's CSRF posture.
Worth deciding deliberately rather than by default.
