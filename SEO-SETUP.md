# SEO Setup — Borderfall

Manual steps to finish search-engine onboarding. The code-side work (prerendered
marketing HTML, per-page meta/canonical, OG PNG, JSON-LD, `sitemap.xml`,
`robots.txt`) is already done on the `seo/tier-1-visibility` branch — this file
covers the parts that require account access only you have.

**Canonical domain:** `https://borderfall.gg`
**Sitemap URL:** `https://borderfall.gg/sitemap.xml`
**Daily-archive sitemap:** `https://borderfall.gg/sitemap-daily.xml` (generated
from the database — one URL per settled Daily puzzle; declared in `robots.txt`)
**Robots URL:** `https://borderfall.gg/robots.txt`

> **Bing is the priority, not Google.** ChatGPT's search leans on Bing's index,
> and roughly half our attributed signups already arrive from assistant
> referrals — so Bing Webmaster Tools is a direct pipe into the retrieval layer
> that is sending us users, and it is the cheapest thing on this page. Do §2
> before §1 if you only have time for one.

> Project note: any file placed in `frontend/public/` is served at the site
> root (Vite copies `public/` into `dist/`, and nginx serves `dist/` — see
> `docker/nginx.prod.conf`). So `frontend/public/foo.html` →
> `https://borderfall.gg/foo.html`. `robots.txt` allows crawling of everything,
> so verification files are reachable.

---

## 1. Google Search Console

1. Go to <https://search.google.com/search-console> and add a property.
2. Choose one verification method:
   - **Domain property (recommended) — DNS TXT.** Select "Domain", enter
     `borderfall.gg`. Google gives a `google-site-verification=...` TXT record.
     Add it as a TXT record on the `borderfall.gg` DNS zone (apex `@`), wait for
     propagation, then click Verify. This covers `http`, `https`, and all
     subdomains at once.
   - **URL-prefix property — HTML file.** Select "URL prefix", enter
     `https://borderfall.gg`. Download the `googleXXXXXXXX.html` file Google
     provides and commit it to **`frontend/public/googleXXXXXXXX.html`**. After
     the next deploy it will be live at
     `https://borderfall.gg/googleXXXXXXXX.html`; click Verify.
3. After verification, open **Sitemaps** → submit `sitemap.xml` (enter
   `sitemap.xml`; full URL is `https://borderfall.gg/sitemap.xml`).
4. Use **URL Inspection** on `https://borderfall.gg/`, `/how-to-play`, and
   `/eras` → "Test live URL" → confirm Google sees the headings/paragraph text,
   then "Request indexing" for each.

## 2. Bing Webmaster Tools

1. Go to <https://www.bing.com/webmasters> and add `https://borderfall.gg`.
   (Tip: you can **import from Google Search Console** to skip re-verification.)
2. If verifying manually, choose one:
   - **DNS (CNAME/TXT)** — add the record Bing provides to the `borderfall.gg`
     DNS zone.
   - **XML file** — download `BingSiteAuth.xml` and commit it to
     **`frontend/public/BingSiteAuth.xml`** → served at
     `https://borderfall.gg/BingSiteAuth.xml`.
   - **Meta tag** — add the `<meta name="msvalidate.01" content="..."/>` tag to
     `frontend/index.html` (in `<head>`).
3. Under **Sitemaps**, submit `https://borderfall.gg/sitemap.xml`.

## 3. Verify the basics yourself

- `https://borderfall.gg/robots.txt` loads and lists the sitemap.
- `https://borderfall.gg/sitemap.xml` loads and is valid XML.
- Rich Results / schema check: paste `https://borderfall.gg/` into
  <https://search.google.com/test/rich-results> (or
  <https://validator.schema.org>) — the `VideoGame` JSON-LD should parse with no
  errors.
- Social preview: check the OG image with the
  [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/),
  [X/Twitter](https://cards-dev.twitter.com/validator) (or just paste a link in
  a DM), and Discord/Slack. The image is `https://borderfall.gg/og-image.png`
  (1200×630 PNG).

## 4. Keeping it fresh

- Marketing copy lives in `frontend/src/marketing/seoContent.mjs` (single source
  for the live `/eras` page and the prerendered HTML). Edit there.
- After editing the OG SVG (`frontend/public/og-image.svg`), regenerate the PNG:
  `pnpm -C frontend run generate:og`, then commit `public/og-image.png`.
- When you add or remove a public page, update `frontend/public/sitemap.xml`
  (and `MARKETING_PAGES` in `seoContent.mjs` if it should be prerendered).
- The Daily archive needs no sitemap maintenance: `/sitemap-daily.xml` is built
  from `daily_challenges` on request, and a day appears the moment it settles.

## 5. What is published, and how it reaches a crawler

Three different mechanisms, worth keeping straight when something doesn't show
up in an index:

| Surface | Route | How a crawler gets HTML |
|---|---|---|
| Landing, how-to-play, eras, about, legal | `/`, `/how-to-play`, … | Prerendered at build time into `dist/` by `scripts/prerender-marketing.mjs` |
| Answer pages | `/answers`, `/answers/*` | Same prerender — they are entries in `MARKETING_PAGES` |
| Daily archive | `/daily/archive`, `/daily/YYYY-MM-DD` | Server-rendered per request by the backend; nginx routes crawler user-agents there and humans to the SPA |

The Daily archive is server-rendered rather than prerendered because its content
changes daily and depends on the database, which the frontend build has no
access to. nginx sends crawler user-agents (search, social, **and the AI
answer-engine crawlers**) to the backend shell, and everyone else to the SPA —
the same split `/replay/:gameId` already used. Both render the same puzzle,
objective and results from the same public API, which is what keeps dynamic
serving from being cloaking; the backend sends `Vary: User-Agent`.

## 6. IndexNow — push URLs instead of waiting

The Daily archive mints one new permanent URL a day, and the answer pages went
live to a site with almost no crawl budget. A sitemap tells an engine a URL
exists the next time it looks; IndexNow tells it now.

The key file (`frontend/public/<key>.txt`) is committed and serves at the site
root. **It must be deployed before any submission will be accepted** — IndexNow
proves host control by fetching it, and until then every batch is rejected.

One-off / bulk submission (preview by default):

```
export INDEXNOW_KEY=<the key from Bing Webmaster Tools>
pnpm -C backend exec tsx scripts/indexNowSubmit.ts           # preview
pnpm -C backend exec tsx scripts/indexNowSubmit.ts --apply   # send
```

With no arguments it reads both live sitemaps, so it submits exactly what the
site currently claims to publish. It refuses to send unless the key file is
reachable AND its contents match — worth knowing that a missing key file
returns the SPA's HTML with HTTP 200 rather than a 404, so a status-only check
would pass and every submission would then be rejected.

Ongoing, per settled day: set `INDEXNOW_KEY` on the backend and turn on
`indexnow_enabled` (Admin → Config). An hourly sweep announces each Daily
archive page once it settles. Off by default; the flag is the kill switch for
the outbound traffic, separate from the key.

## 7. Measuring whether assistants recommend us

Indexing is only half of it. `docs/GEO-PROMPT-PANEL.md` is the monthly check on
the other half — whether an assistant asked "free browser game like Risk?"
actually names Borderfall, and whether what it says about us is true. The funnel
cannot answer either question (assistants that send no referrer land in
`direct`), so the panel is hand-run and its results live in
`docs/geo-panel/observations.json`:

```
pnpm -C backend exec tsx scripts/geoPanelReport.ts
```
