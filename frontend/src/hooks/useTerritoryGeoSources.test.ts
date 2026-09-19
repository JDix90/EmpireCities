/**
 * Which Natural Earth files a map pulls, and — for the tutorial board — that it
 * pulls the one that actually has its provinces.
 *
 * The tutorial is mainland Italy drawn from `admin1` codes. Without an entry in
 * `REGIONAL_ADMIN1_SUBSET` those codes resolve against the CDN ne_50m set,
 * which covers ten countries and none of them is Italy: the board would fall
 * back to its outline polygons and look authored again, with nothing failing
 * and a 2.3MB download spent resolving nothing. That is a silent regression a
 * reviewer cannot see in a diff, so it is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { requiredGeoSourceUrls } from './useTerritoryGeoSources';

const tutorialMap = {
  map_id: 'tutorial',
  territories: [
    { territory_id: 'tut_a1', admin1: ['IT-RM', 'IT-FI'] },
    { territory_id: 'tut_b2', admin1: ['IT-BA'] },
  ],
};

describe('requiredGeoSourceUrls — the tutorial board', () => {
  it('resolves its provinces from the Italian subset', () => {
    const urls = requiredGeoSourceUrls(tutorialMap);
    expect(urls.regionalAdmin1Geo).toBe('/geo/risorgimento_admin1.json');
  });

  it('does not also pull the ne_50m world set, which has no Italian codes', () => {
    expect(requiredGeoSourceUrls(tutorialMap).admin50Geo).toBeNull();
  });

  it('pulls nothing region-specific it has no use for', () => {
    const urls = requiredGeoSourceUrls(tutorialMap);
    expect(urls.straitHormuzGeo).toBeNull();
    expect(urls.australiaGeo).toBeNull();
    expect(urls.britainGeo).toBeNull();
    expect(urls.hornAfricaGeo).toBeNull();
    expect(urls.mexicoGeo).toBeNull();
  });
});

describe('requiredGeoSourceUrls — other maps are unaffected', () => {
  it('still falls back to ne_50m for an admin-1 map with no committed subset', () => {
    const urls = requiredGeoSourceUrls({
      map_id: 'some_other_map',
      territories: [{ territory_id: 't1', admin1: ['US-CA'] }],
    });
    expect(urls.regionalAdmin1Geo).toBeNull();
    expect(urls.admin50Geo).toBe('/geo/ne_50m_admin_1_states_provinces.json');
  });

  it('still routes the Risorgimento board to its own source', () => {
    const urls = requiredGeoSourceUrls({
      map_id: 'era_risorgimento',
      territories: [{ territory_id: 'ris_piedmont' }],
    });
    expect(urls.risorgimentoGeo).toBe('/geo/risorgimento_admin1.json');
  });
});
