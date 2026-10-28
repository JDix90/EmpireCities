/**
 * /eras/:slug — one page per playable era.
 *
 * /eras keeps its own bespoke component (ErasPage); this is the detail page,
 * and like the map pages it is a thin configuration of SeoContentPage over
 * content assembled in seoContent.mjs from the era roster and board.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import SeoContentPage from './SeoContentPage';
import { useGalaxyAgeBetaEnabled } from '../store/featureFlagsStore';

/** The Galactic Age's page while the era is an open beta: what that means, and the way in. */
function GalacticBetaNotice() {
  return (
    <div className="rounded-xl border border-bf-gold/40 bg-bf-gold/10 p-4 text-sm" data-testid="galactic-beta-notice">
      <p className="font-display text-bf-gold">Galactic Age · Beta</p>
      <p className="mt-1 text-bf-muted">
        Open to every player while we test and tune it: its rules and balance may change between games.
      </p>
      <Link to="/lobby?era=galaxy_age&map=era_galaxy" className="inline-block mt-2 text-bf-gold hover:underline">
        Play the beta →
      </Link>
    </div>
  );
}

export default function EraDetailPage() {
  const { pathname } = useLocation();
  const galacticBeta = useGalaxyAgeBetaEnabled();
  const isGalacticAgePage = pathname.replace(/\/+$/, '') === '/eras/galaxy-age';
  return (
    <SeoContentPage
      section="ERAS"
      icon={Hourglass}
      backHref="/eras"
      backLabel="Eras"
      missingTitle="No such era"
      missingBody="That era page doesn’t exist. Every playable era is listed on the eras page."
      notice={galacticBeta && isGalacticAgePage ? <GalacticBetaNotice /> : undefined}
    />
  );
}
