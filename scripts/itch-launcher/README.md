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

**One of the two is done; the remaining one is not in this repository.**

✅ **The document now sends a CSP naming itch.** `docker/nginx.prod.conf` adds
`frame-ancestors 'self' https://html-classic.itch.zone` at server level, so
every response inherits it. Before this there was no CSP on static responses at
all. Verified by running nginx over the real config and reading the header off
a 200.

   (The `EMBED_ORIGINS` work in `modules/auth/embedContext.ts` governs helmet's
   CSP, which only rides on **API** responses — the API is not what gets framed.
   It still matters for the refresh cookie, which is per-request.)

❌ **`X-Frame-Options: SAMEORIGIN` must stop being sent on the document.** It is
on `https://borderfall.gg/` today. It is not set by `nginx.prod.conf` and not by
helmet — it comes from the **TLS-terminating layer in front of nginx**, which
lives outside this repository (Caddy, a cloud load balancer, Cloudflare —
whatever terminates TLS for borderfall.gg). Browsers honour XFO alongside CSP,
and XFO has no allowlist (`SAMEORIGIN` or `DENY` only), so while it is sent the
frame stays blocked no matter what the CSP says. Dropping it in favour of
`frame-ancestors` is the intended modern path — CSP is its replacement, not a
supplement.

Until that happens the shell shows its fallback card, which is why it was built
that way. Nothing needs re-uploading when it changes.

To confirm the state at any time:

```bash
curl -sSI https://borderfall.gg/ | grep -iE 'x-frame-options|content-security-policy'
```

You want to see a `content-security-policy` line naming `html-classic.itch.zone`
and **no** `x-frame-options` line.

Note `isEmbeddedOrigin` matches origins exactly, so a CSP wildcard like
`*.itch.zone` would satisfy framing while silently failing the cookie side.

## Caveat worth keeping in view

`html-classic.itch.zone` is a **shared user-generated-content origin** — anyone
can upload a game there. Allowing it to frame Borderfall means any itch-hosted
page can, and can cause a `SameSite=None` refresh cookie to be issued into that
visitor's browser. The cookie stays `HttpOnly` and scoped to `/api/auth`, so a
framing page cannot read it, but it does weaken that visitor's CSRF posture.
Worth deciding deliberately rather than by default.
