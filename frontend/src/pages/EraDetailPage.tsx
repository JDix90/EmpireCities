/**
 * /eras/:slug — one page per playable era.
 *
 * /eras keeps its own bespoke component (ErasPage); this is the detail page,
 * and like the map pages it is a thin configuration of SeoContentPage over
 * content assembled in seoContent.mjs from the era roster and board.
 */
import React from 'react';
import { Hourglass } from 'lucide-react';
import SeoContentPage from './SeoContentPage';

export default function EraDetailPage() {
  return (
    <SeoContentPage
      section="ERAS"
      icon={Hourglass}
      backHref="/eras"
      backLabel="Eras"
      missingTitle="No such era"
      missingBody="That era page doesn’t exist. Every playable era is listed on the eras page."
    />
  );
}
