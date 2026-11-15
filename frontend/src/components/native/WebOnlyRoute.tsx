import React from 'react';
import { Navigate } from 'react-router-dom';
import { isNativeApp } from '../../utils/nativeApp';

/**
 * Pages that exist for the website: the landing page's companions, written to
 * be found by a search engine (the era and map catalogues, the answer pages,
 * the public Daily archive, About) and the email unsubscribe page.
 *
 * The native app leaves them out (utils/nativeApp.ts): an app that opens onto
 * web pages is what App Store guideline 4.2 turns away, and nothing in the app
 * links to them. A route that is reached anyway (a link pasted into chat, a
 * stale deep link) goes to `/`, which in the app is play. On the website this
 * renders its children and nothing else.
 */
export default function WebOnlyRoute({ children }: { children: React.ReactNode }) {
  if (isNativeApp()) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
