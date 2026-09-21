import { useEffect } from 'react';

/**
 * Set this page's <title> and meta description while it is mounted, restoring
 * the previous values on the way out.
 *
 * The SPA serves one index.html for every route, so the title a visitor sees is
 * whatever the last page set. Restoring on unmount is what stops a stale title
 * from following someone to the next route — the prerendered HTML already
 * carries the right one for a crawler, and this keeps the live app honest to it.
 *
 * Shared rather than copied: three pages had their own near-identical version,
 * and a fourth was about to.
 */
export function useDocumentMeta(title: string, description?: string): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    const tag = description ? document.querySelector('meta[name="description"]') : null;
    const previousDescription = tag?.getAttribute('content') ?? null;
    if (tag && description) tag.setAttribute('content', description);
    return () => {
      document.title = previousTitle;
      if (tag && previousDescription !== null) tag.setAttribute('content', previousDescription);
    };
  }, [title, description]);
}

export default useDocumentMeta;
