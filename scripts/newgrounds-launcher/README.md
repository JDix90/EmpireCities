# Newgrounds launcher shell

`index.html` is the whole thing: a single self-contained page, uploaded to
Newgrounds as an HTML5 Archive (`.zip`), that frames the live borderfall.gg.

Borderfall is a full-stack app — Postgres, Redis, sockets — so it cannot be
uploaded as the static build Newgrounds hosts for HTML5 submissions. This shell
is the bridge: Newgrounds hosts the shell, the shell shows the real game. Same
approach as [`../itch-launcher`](../itch-launcher/README.md), different origins
and a different `utm_source`.

## Build and upload

```bash
./scripts/newgrounds-launcher/build.sh      # -> dist/borderfall-newgrounds.zip
```

`index.html` must sit at the **archive root**. Zipping the folder instead of its
contents produces an archive Newgrounds cannot start; `build.sh` gets this right,
so prefer it over zipping by hand.

| setting | value |
|---|---|
| Submission type | **HTML5 Archive (.zip)** |
| Dimensions | 960 × 600 or larger, any 16:10-ish size — the shell fills whatever it is given |
| Scaling / fullscreen | allow both; the game benefits from the room |
| Mobile | enabled |

It tags the frame `?utm_source=newgrounds&utm_medium=embed`, so signups from here
land under `newgrounds` in Admin → Analytics with no extra work.

## Two-step setup, and why

The frame only renders once **every Newgrounds origin in the ancestor chain** is
in [`../../docker/portals.json`](../../docker/portals.json) — both the page the
visitor sees and whatever origin actually serves the uploaded archive. itch.io
taught us this: the project page is `<user>.itch.io` but the sandboxed player is
`*.itch.zone`, and missing either one blocks the frame.

Those origins are only observable from inside the live player, so:

1. **Upload first.** Until the registry knows Newgrounds, the CSP refuses the
   frame and the shell shows its "Play in a new tab" fallback. The submission is
   useful on day one either way.
2. **Read the origins off the live submission.** Any of:
   - open the uploaded `index.html` URL directly in a tab and append `#setup` —
     it prints the chain on screen;
   - open the game page, open devtools, and read the
     `[borderfall] add these origins to docker/portals.json: …` console line;
   - evaluate `window.__borderfallOrigins` in the shell's frame.
3. **Add them to the registry**, then:
   ```bash
   pnpm -C backend exec tsx scripts/syncPortals.ts
   ```
   Commit what it regenerates, set the printed `EMBED_ORIGINS` on the server, and
   deploy **with a rebuild**. See [`docs/PORTALS.md`](../../docs/PORTALS.md).
4. **Nothing to re-upload.** The CSP is server-side, so the shell starts framing
   on its own the moment the deploy lands.

Set `ownAuthUi` when you add the entry. Newgrounds is not known to forbid a game
showing its own login, unlike CrazyGames — but confirm against their current
rules rather than assuming, and set it to `false` if in doubt.

## Known limitation: the frame detector is optimistic

From the parent page you cannot reliably tell a loaded cross-origin frame from a
Chrome error page — reading `contentWindow.location.href` throws `SecurityError`
for **both**. Measured against the live site: a frame refused by
`frame-ancestors` fails with `ERR_BLOCKED_BY_RESPONSE`, lands on
`chrome-error://chromewebdata/`, and the read throws, so the shell concludes
"playing" when it is not and hides its own fallback panel.

Consequences, and what covers them:

- The visitor is **not** stranded: the corner "Open in a new tab ↗" link stays
  visible whenever the shell believes it is playing, precisely because that
  belief can be wrong.
- The origins you need are still retrievable, because they are written to the
  console unconditionally and `#setup` forces them on screen.

The real fix is a `postMessage` handshake — borderfall.gg posting a "ready"
message to its parent on boot, so the shell can confirm positively instead of
inferring. That would also fix the same latent issue in the itch shell, which
uses identical detection logic. Worth doing next time the app is touched.

## Rules risk

Whether Newgrounds permits a submission that frames an externally hosted site is
**not confirmed**. itch.io explicitly supports it; Newgrounds' policy on it could
not be checked. Say plainly in the author comments that the submission loads the
live borderfall.gg, so a moderator is not surprised, and be ready for it to be
rejected on those grounds.
