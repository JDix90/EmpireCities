import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MapOfTheWeekCard, { useFeaturedMap } from './MapOfTheWeekCard';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({ api: { get: vi.fn() } }));
vi.mock('./MapPreview', () => ({ default: () => <div data-testid="preview" /> }));

const featured = {
  week: '2026-W45',
  map: {
    map_id: 'm1',
    name: 'Sahel Kingdoms',
    description: 'Three empires on the river.',
    era_theme: 'medieval',
    territory_count: 14,
    region_count: 3,
    play_count: 120,
    rating: 4.6,
    rating_count: 9,
    creator_id: '11111111-2222-4333-8444-555555555555',
    creator_name: 'cartographer',
  },
};

describe('MapOfTheWeekCard', () => {
  it('shows the week\'s map with its author linked to their profile', () => {
    render(<MemoryRouter><MapOfTheWeekCard featured={featured} /></MemoryRouter>);
    expect(screen.getByText('Map of the week · week 45')).toBeInTheDocument();
    expect(screen.getByText('Sahel Kingdoms')).toBeInTheDocument();
    const author = screen.getByRole('link', { name: 'cartographer' });
    expect(author).toHaveAttribute('href', '/profile/11111111-2222-4333-8444-555555555555');
    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/maps/m1');
    expect(screen.getByText('Play This Map')).toBeInTheDocument();
  });

  it('renders nothing while loading or with no community maps yet', () => {
    const { container, rerender } = render(<MemoryRouter><MapOfTheWeekCard featured={null} /></MemoryRouter>);
    expect(container.querySelector('[data-testid="map-of-the-week"]')).toBeNull();
    rerender(<MemoryRouter><MapOfTheWeekCard featured={{ week: '2026-W45', map: null }} /></MemoryRouter>);
    expect(container.querySelector('[data-testid="map-of-the-week"]')).toBeNull();
  });
});

describe('useFeaturedMap', () => {
  it('asks the server for nothing while the showcase is switched off', () => {
    const { result } = renderHook(() => useFeaturedMap(false));
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current).toEqual({ week: '', map: null });
  });
});
