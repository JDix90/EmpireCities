# SEO Setup — Borderfall

Manual steps to finish search-engine onboarding. The code-side work (prerendered
marketing HTML, per-page meta/canonical, OG PNG, JSON-LD, `sitemap.xml`,
`robots.txt`) is already done on the `seo/tier-1-visibility` branch — this file
covers the parts that require account access only you have.

**Canonical domain:** `https://borderfall.gg`
**Sitemap URL:** `https://borderfall.gg/sitemap.xml`
**Robots URL:** `https://borderfall.gg/robots.txt`

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
