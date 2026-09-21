import { useEffect } from 'react';

/**
 * Keep a "this does not exist" state out of the search index.
 *
 * A pure SPA answers HTTP 200 with the app shell for every URL — the server
 * cannot know which client routes are real — so a route that renders "not
 * found" still looks like a successful page to a crawler. Google renders JS,
 * sees error copy under a 200, and files it as a **soft 404**. That is exactly
 * what Search Console reported for borderfall.gg on 2026-09-20.
 *
 * `noindex` on the rendered page is Google's own documented answer for the
 * case where a real 404 status is not available. It has to be added at runtime
 * rather than sitting in index.html, because the same shell serves every route
 * — hence the removal on unmount, so it can never leak onto a real page when
 * the visitor navigates on.
 *
 * Pass the condition rather than calling this conditionally: the not-found
 * branches below it return early, and a hook after an early return breaks the
 * rules of hooks.
 *
 * Only a tag this hook created is removed. A page that legitimately sets its
 * own robots meta keeps it, and two mounted users do not fight over one tag.
 */
export function useNoindex(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      if (meta.parentNode) meta.parentNode.removeChild(meta);
    };
  }, [active]);
}

export default useNoindex;
