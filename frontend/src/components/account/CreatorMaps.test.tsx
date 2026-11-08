import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreatorMaps from './CreatorMaps';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const getMock = vi.fn();
vi.mock('../../services/api', () => ({ api: { get: (...a: unknown[]) => getMock(...a) } }));

const row = (map_id: string, name: string, play_count: number) => ({
  map_id, name, description: '', era_theme: 'medieval', territory_count: 12, region_count: 3, play_count, rating: 4.5, rating_count: 2,
});

beforeEach(() => {
  getMock.mockReset();
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, map_editor_enabled: true } }));
});

describe('CreatorMaps', () => {
  it('lists a creator\'s published maps with their plays', async () => {
    getMock.mockResolvedValue({ data: { maps: [row('m1', 'Sahel Kingdoms', 40), row('m2', 'Baltic', 2)] } });
    render(<MemoryRouter><CreatorMaps userId="u1" isOwn={false} /></MemoryRouter>);
    expect(await screen.findByText('Sahel Kingdoms')).toBeInTheDocument();
    expect(screen.getByText('2 maps · 42 plays in all')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/maps/by-creator/u1');
    expect(screen.getAllByText('Details')).toHaveLength(2);
  });

  it('shows nothing on another player\'s empty shelf, and points the owner to the editor', async () => {
    getMock.mockResolvedValue({ data: { maps: [] } });
    const { unmount } = render(<MemoryRouter><CreatorMaps userId="u1" isOwn={false} /></MemoryRouter>);
    await Promise.resolve();
    expect(screen.queryByTestId('creator-maps')).toBeNull();
    unmount();
    render(<MemoryRouter><CreatorMaps userId="u1" isOwn /></MemoryRouter>);
    expect(await screen.findByText('Map Editor')).toBeInTheDocument();
  });
});
