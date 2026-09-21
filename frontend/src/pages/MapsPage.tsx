/**
 * /maps and /maps/:slug — the map index and the per-map pages.
 *
 * A thin configuration of SeoContentPage: all the content comes from
 * seoContent.mjs (built from the real map definitions), so adding a map to
 * MAP_PAGE_IDS and regenerating is the whole job.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Map as MapIcon } from 'lucide-react';
import SeoContentPage from './SeoContentPage';

export default function MapsPage() {
  const isIndex = useLocation().pathname.replace(/\/+$/, '') === '/maps';
  return (
    <SeoContentPage
      section="MAPS"
      icon={MapIcon}
      backHref={isIndex ? '/' : '/maps'}
      backLabel={isIndex ? 'Borderfall' : 'Maps'}
      missingTitle="No such map"
      missingBody="That map page doesn’t exist. The full list is on the maps index."
    />
  );
}
