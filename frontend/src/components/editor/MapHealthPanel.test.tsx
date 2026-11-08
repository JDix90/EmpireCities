import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MapHealthPanel from './MapHealthPanel';
import { evaluateMapHealth, type MapHealthInput } from '@borderfall/shared';

function draft(): MapHealthInput {
  return {
    name: 'Sahel',
    description: '',
    era_theme: '',
    territories: [
      { territory_id: 'a', name: 'Mali', region_id: 'r1' },
      { territory_id: 'b', name: 'Niger', region_id: 'r1' },
      { territory_id: 'c', name: 'Chad', region_id: 'r2' },
    ],
    connections: [{ from: 'a', to: 'b', type: 'land' }],
    regions: [
      { region_id: 'r1', name: 'West', bonus: 2 },
      { region_id: 'r2', name: 'East', bonus: 3 },
      { region_id: 'r3', name: 'Ghost', bonus: 1 },
    ],
  };
}

describe('MapHealthPanel', () => {
  it('groups blockers, warnings and tips, and counts what is left to fix', () => {
    const report = evaluateMapHealth(draft());
    render(<MapHealthPanel report={report} onHoverIssue={() => {}} onClickIssue={() => {}} fixes={[]} />);
    expect(screen.getByText(`${report.blockers.length} to fix`)).toBeInTheDocument();
    expect(screen.getByText('Must fix before publishing')).toBeInTheDocument();
    expect(screen.getByText('Worth a look')).toBeInTheDocument();
    expect(screen.getByText('Tips')).toBeInTheDocument();
    expect(screen.getByText('Region "Ghost" has no territories')).toBeInTheDocument();
  });

  it('offers a fix where one is wired, and points the globe at a row on hover', () => {
    const report = evaluateMapHealth(draft());
    const run = vi.fn();
    const hover = vi.fn();
    const click = vi.fn();
    render(
      <MapHealthPanel
        report={report}
        onHoverIssue={hover}
        onClickIssue={click}
        fixes={[{ code: 'empty_region', label: 'Remove region', run }]}
      />,
    );
    fireEvent.click(screen.getByText('Remove region'));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ code: 'empty_region', regionIds: ['r3'] }));

    const row = screen.getByText('Region "Ghost" has no territories');
    fireEvent.mouseEnter(row.closest('li')!);
    expect(hover).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'empty_region' }));
    fireEvent.mouseLeave(row.closest('li')!);
    expect(hover).toHaveBeenLastCalledWith(null);
    fireEvent.click(row);
    expect(click).toHaveBeenCalledWith(expect.objectContaining({ code: 'empty_region' }));
  });

  it('says ready when nothing blocks, and lists what only the server saw', () => {
    const input = draft();
    const ready = evaluateMapHealth({
      ...input,
      territories: Array.from({ length: 6 }, (_, i) => ({ territory_id: `t${i}`, name: `T${i}`, region_id: 'r1' })),
      connections: Array.from({ length: 6 }, (_, i) => ({ from: `t${i}`, to: `t${(i + 1) % 6}`, type: 'land' })),
      regions: [{ region_id: 'r1', name: 'Ring', bonus: 2 }],
      description: 'A ring',
      era_theme: 'ancient',
    });
    render(<MapHealthPanel report={ready} serverOnly={['Geometry code "FR" is used twice']} onHoverIssue={() => {}} onClickIssue={() => {}} fixes={[]} />);
    expect(screen.getByText('Ready to publish')).toBeInTheDocument();
    expect(screen.getByText('Also reported on save')).toBeInTheDocument();
    expect(screen.getByText('Geometry code "FR" is used twice')).toBeInTheDocument();
  });
});
