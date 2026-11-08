import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RegionsPanel from './RegionsPanel';
import { useMapEditorStore } from '../../store/mapEditorStore';
import type { EditorTerritory } from './editorGlobeData';

const store = () => useMapEditorStore.getState();

function territory(id: string, regionId: string): EditorTerritory {
  return {
    territory_id: id,
    name: id,
    polygon: [[0, 0], [1, 0], [1, 1]],
    center_point: [0.5, 0.5],
    region_id: regionId,
    geo_polygon: [[0, 0], [1, 0], [1, 1]],
  };
}

beforeEach(() => store().reset());

describe('RegionsPanel', () => {
  it('shows each region with its territory count, amber when a bonus region is thin', () => {
    store().addTerritory(territory('a', 'region_1'));
    render(<RegionsPanel />);
    const count = screen.getByText('1 territory');
    expect(count.className).toContain('text-amber-300');
  });

  it('picks up the paint bucket: the tool switches and the region becomes the target', () => {
    render(<RegionsPanel />);
    fireEvent.click(screen.getByLabelText('Paint territories into Region 1'));
    expect(store().activeTool).toBe('paint');
    expect(store().paintRegionId).toBe('region_1');
    // Clicking again puts the bucket down.
    fireEvent.click(screen.getByLabelText('Paint territories into Region 1'));
    expect(store().activeTool).toBe('select');
  });

  it('suggests a bonus from the region\'s size and borders, and applies it on click', () => {
    const west = store().addRegion('West', 1);
    const east = store().addRegion('East', 1);
    // Nine territories in West, three of them bordering East: the classic North America shape.
    for (let i = 0; i < 9; i++) store().addTerritory(territory(`w${i}`, west));
    for (let i = 0; i < 2; i++) store().addTerritory(territory(`e${i}`, east));
    store().addConnections([
      { from: 'w0', to: 'e0', type: 'land' },
      { from: 'w1', to: 'e0', type: 'sea' },
      { from: 'w2', to: 'e1', type: 'land' },
    ]);
    render(<RegionsPanel />);
    fireEvent.click(screen.getByText('Suggested: 5'));
    expect(store().regions.find((r) => r.region_id === west)?.bonus).toBe(5);
    expect(screen.queryByText('Suggested: 5')).toBeNull();
  });

  it('adds a region and starts painting into it', () => {
    render(<RegionsPanel />);
    fireEvent.click(screen.getByTitle('Add a region and start painting territories into it'));
    expect(store().regions).toHaveLength(2);
    expect(store().activeTool).toBe('paint');
    expect(store().paintRegionId).toBe(store().regions[1].region_id);
  });
});
