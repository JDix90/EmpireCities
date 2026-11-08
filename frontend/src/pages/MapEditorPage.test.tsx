/**
 * The editor page as the author meets it, with the globe, the API and the
 * Natural Earth data stood in for: a continent template becomes a playable
 * draft, search adds a bordering country already connected, Map health
 * points at problems and fixes them, and Save posts the document.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MapEditorPage from './MapEditorPage';
import { useMapEditorStore } from '../store/mapEditorStore';
import { editorDraftKey } from '../utils/mapEditorDraft';

const { getMock, postMock, putMock, COUNTRIES, ISO_TO_FEATURES, COUNTRY_DATA } = vi.hoisted(() => {
  const square = (x: number, y: number, size = 1): [number, number][] => [
    [x, y], [x + size, y], [x + size, y + size], [x, y + size],
  ];
  const poly = (ring: [number, number][]): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[...ring, ring[0]]] });
  const country = (code: string, name: string, subregion: string, ring: [number, number][]) => ({
    code,
    name,
    continent: 'Testland',
    subregion,
    areaKm2: 12_000,
    label: [ring[0][0] + 0.5, ring[0][1] + 0.5] as [number, number],
    geometry: poly(ring),
  });
  // A 3×2 block of bordering squares and an island off to the east.
  const COUNTRIES = [
    country('AA', 'Aa', 'West', square(0, 0)),
    country('BB', 'Bb', 'West', square(1, 0)),
    country('CC', 'Cc', 'West', square(2, 0)),
    country('DD', 'Dd', 'North', square(0, 1)),
    country('EE', 'Ee', 'North', square(1, 1)),
    country('FF', 'Ff', 'North', square(2, 1)),
    country('II', 'Isle', 'Islands', square(6, 0)),
  ];
  const ISO_TO_FEATURES = new Map(
    COUNTRIES.map((c) => [c.code, [{ type: 'Feature', properties: { ISO_A2: c.code, NAME: c.name }, geometry: c.geometry } as GeoJSON.Feature]]),
  );
  const COUNTRY_DATA = COUNTRIES.map((c) => ({
    id: `country_${c.code}`,
    kind: 'country' as const,
    geometry: c.geometry,
    isoCode: c.code,
    countryName: c.name,
  }));
  return { getMock: vi.fn(), postMock: vi.fn(), putMock: vi.fn(), COUNTRIES, ISO_TO_FEATURES, COUNTRY_DATA };
});

vi.mock('../services/api', () => ({
  api: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    put: (...a: unknown[]) => putMock(...a),
  },
}));

vi.mock('../utils/globeLoader', () => ({
  GlobeMapEditorLazy: () => <div data-testid="globe" />,
  preloadGlobeEditorChunk: () => {},
}));

vi.mock('../hooks/useEditorCountries', () => ({
  useEditorCountries: () => ({ ready: true, isoToFeatures: ISO_TO_FEATURES, countryData: COUNTRY_DATA, countries: COUNTRIES }),
}));

const store = () => useMapEditorStore.getState();

function renderEditor(path = '/editor') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/editor" element={<MapEditorPage />} />
        <Route path="/editor/:mapId" element={<MapEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  store().reset();
  getMock.mockReset();
  postMock.mockReset();
  putMock.mockReset();
  getMock.mockImplementation((url: string) => {
    if (url === '/maps/me') return Promise.resolve({ data: [] });
    if (url.startsWith('/maps/public')) return Promise.resolve({ data: { maps: [] } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as typeof window.matchMedia;
});

describe('MapEditorPage', () => {
  it('opens a new map on the start screen and builds a playable draft from a continent', async () => {
    renderEditor();
    expect(screen.getByText('Start a map')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Testland'));

    await waitFor(() => expect(store().territories).toHaveLength(7));
    expect(screen.queryByText('Start a map')).toBeNull();
    const s = store();
    expect(s.mapName).toBe('Testland');
    // Every border connected, the island bridged by a sea lane, two regions priced.
    expect(s.connections.some((c) => c.type === 'sea' && (c.from === 't_ii' || c.to === 't_ii'))).toBe(true);
    expect(s.regions.map((r) => r.name).sort()).toEqual(['North', 'West']);
    expect(s.regions.every((r) => r.bonus >= 1)).toBe(true);
    expect(s.isDirty).toBe(true);
    expect(within(screen.getByTestId('map-health')).getByText('Ready to publish')).toBeInTheDocument();
    // The template is one undo step.
    act(() => {
      store().undo();
    });
    expect(store().territories).toHaveLength(0);
  });

  it('adds a searched country already connected to the neighbour it borders', async () => {
    renderEditor();
    fireEvent.click(screen.getByText('Blank globe'));
    expect(store().activeTool).toBe('country_pick');
    const search = screen.getByPlaceholderText('Add a country…');
    fireEvent.change(search, { target: { value: 'Aa' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.change(search, { target: { value: 'Bb' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    const s = store();
    expect(s.territories.map((t) => t.iso_codes?.[0])).toEqual(['AA', 'BB']);
    expect(s.connections).toEqual([expect.objectContaining({ to: s.territories[0].territory_id, type: 'land' })]);
    // The second pick selected it, so the territory panel is up with its one connection.
    expect(within(screen.getByTestId('territory-panel')).getByText('Connections (1)')).toBeInTheDocument();
  });

  it('lets Map health fix what it points at', async () => {
    renderEditor();
    fireEvent.click(screen.getByText('Blank globe'));
    act(() => {
      // One territory keeps Region 1 populated, so Ghost is the only empty region.
      store().addTerritory({ territory_id: 't_a', name: 'A', polygon: [[0, 0], [1, 0], [1, 1]], center_point: [0.5, 0.5], region_id: 'region_1', geo_polygon: [[0, 0], [1, 0], [1, 1]] });
      store().addRegion('Ghost');
    });
    const health = screen.getByTestId('map-health');
    expect(within(health).getByText('Region "Ghost" has no territories')).toBeInTheDocument();
    fireEvent.click(within(health).getByText('Remove region'));
    expect(store().regions).toHaveLength(1);
    expect(within(health).queryByText('Region "Ghost" has no territories')).toBeNull();
    fireEvent.click(within(health).getByText('Pick countries'));
    expect(store().activeTool).toBe('country_pick');
  });

  it('offers back an unsaved draft instead of the start screen, and restores it', () => {
    localStorage.setItem(editorDraftKey(null), JSON.stringify({
      v: 1,
      savedAt: Date.now() - 120_000,
      mapName: 'Kept',
      mapDescription: '',
      eraTheme: '',
      territories: [{ territory_id: 't_1', name: 'One', polygon: [[0, 0], [1, 0], [1, 1]], center_point: [0.5, 0.5], region_id: 'region_1', geo_polygon: [[0, 0], [1, 0], [1, 1]] }],
      connections: [],
      regions: [{ region_id: 'region_1', name: 'Region 1', bonus: 3 }],
    }));
    renderEditor();
    expect(screen.queryByText('Start a map')).toBeNull();
    expect(screen.getByText(/Unsaved changes from/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Restore'));
    expect(store().mapName).toBe('Kept');
    expect(store().territories).toHaveLength(1);
  });

  it('saves the document, clears the local snapshot and moves to the saved map', async () => {
    postMock.mockResolvedValue({ data: { map_id: 'm1', message: 'Draft saved.', warnings: ['Add 5 more territories'] } });
    getMock.mockImplementation((url: string) => {
      if (url === '/maps/me') return Promise.resolve({ data: [{ map_id: 'm1', moderation_status: 'draft' }] });
      if (url === '/maps/m1') {
        return Promise.resolve({ data: { map: { name: 'Sahel', description: 'd', era_theme: 'ancient', territories: store().territories, connections: [], regions: store().regions } } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderEditor();
    fireEvent.click(screen.getByText('Blank globe'));
    act(() => {
      store().beginEdit();
      store().setMapName('Sahel');
    });
    const search = screen.getByPlaceholderText('Add a country…');
    fireEvent.change(search, { target: { value: 'Aa' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(localStorage.getItem(editorDraftKey(null))).not.toBeNull(), { timeout: 2500 });

    fireEvent.click(screen.getByText('Save Map'));
    // Analytics beacons share the mock; only the save itself is of interest.
    const saves = () => postMock.mock.calls.filter(([url]) => url === '/maps');
    await waitFor(() => expect(saves()).toHaveLength(1));
    expect(saves()[0][1]).toEqual(expect.objectContaining({ name: 'Sahel', territories: expect.any(Array) }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/maps/m1'));
    expect(localStorage.getItem(editorDraftKey(null))).toBeNull();
    await waitFor(() => expect(store().isDirty).toBe(false));
    expect(store().mapName).toBe('Sahel');
    expect(store().eraTheme).toBe('ancient');
  });
});
