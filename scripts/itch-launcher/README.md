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

Detection works by reading `frame.contentWindow.location.href`: a genuinely
cross-origin document throws a SecurityError, while a frame the browser refused
stays on same-origin `about:blank` and reads back fine. **Throwing is the
success signal.** The `load` event alone proves nothing — a refused frame fires
it too, which is how the first version of this got it backwards.

## It must never bust out of its frame

No `top.location`, no `parent.location`, no auto-redirect. Navigating the
player away from itch is hostile to the platform and to the person who clicked
Run. The only way out is a link the visitor chooses to click, in a new tab.

## What has to be true for inline play

As of this writing, **framing is still blocked in production** and the shell
falls back. Two things are needed, and only one of them is in this repo:

1. **`X-Frame-Options: SAMEORIGIN` must stop being sent on the HTML document.**
   It is on `https://borderfall.gg/` today and it is not set by
   `docker/nginx.prod.conf` or by helmet — it comes from the TLS-terminating
   layer in front of nginx, which lives outside this repository. XFO has no
   allowlist (`SAMEORIGIN` or `DENY` only), so the only move is to drop it and
   let CSP `frame-ancestors` do the job, which is its modern replacement.

2. **The document needs a CSP naming itch.** `https://borderfall.gg/` currently
   sends no `Content-Security-Policy` at all — nginx serves the SPA statically
   and adds none. The `EMBED_ORIGINS` work in `modules/auth/embedContext.ts`
   governs helmet's CSP, which only rides on **API** responses; the API is not
   what gets framed. nginx needs `add_header Content-Security-Policy
   "frame-ancestors 'self' https://html-classic.itch.zone" always;` on the
   static location. Note `nginx.prod.conf` is `COPY`d into the image at build
   time with no envsubst, so wiring this to `EMBED_ORIGINS` means switching to
   `/etc/nginx/templates/` first.

itch serves HTML projects from `https://html-classic.itch.zone` (they retired
the old `*.hwcdn.net` domain in 2023). Their own site-locking guidance suggests
allowing `*.itch.zone` — but note `isEmbeddedOrigin` matches exactly, so a
wildcard would satisfy CSP while silently failing the cookie side.

## Caveat worth keeping in view

`html-classic.itch.zone` is a **shared user-generated-content origin** — anyone
can upload a game there. Allowing it to frame Borderfall means any itch-hosted
page can, and can cause a `SameSite=None` refresh cookie to be issued into that
visitor's browser. The cookie stays `HttpOnly` and scoped to `/api/auth`, so a
framing page cannot read it, but it does weaken that visitor's CSRF posture.
Worth deciding deliberately rather than by default.
