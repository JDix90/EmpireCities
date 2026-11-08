import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PublishPanel from './PublishPanel';
import { evaluateMapHealth } from '@borderfall/shared';

const ready = evaluateMapHealth({
  name: 'Ring',
  description: 'A ring',
  era_theme: 'ancient',
  territories: Array.from({ length: 6 }, (_, i) => ({ territory_id: `t${i}`, name: `T${i}`, region_id: 'r1' })),
  connections: Array.from({ length: 6 }, (_, i) => ({ from: `t${i}`, to: `t${(i + 1) % 6}`, type: 'land' })),
  regions: [{ region_id: 'r1', name: 'Ring', bonus: 2 }],
});
const blocked = evaluateMapHealth({ name: 'Two', territories: [], connections: [], regions: [{ region_id: 'r1', name: 'R', bonus: 1 }] });

function renderPanel(overrides: Partial<React.ComponentProps<typeof PublishPanel>> = {}) {
  const onSubmit = vi.fn();
  const onShare = vi.fn();
  render(
    <PublishPanel
      status="draft"
      report={ready}
      isDirty={false}
      submitting={false}
      previewMap={null}
      mapName="Ring"
      mapDescription="A ring"
      eraLabel="Ancient World"
      onSubmit={onSubmit}
      onShare={onShare}
      {...overrides}
    />,
  );
  return { onSubmit, onShare };
}

describe('PublishPanel', () => {
  it('walks the timeline and opens a preflight before submitting', () => {
    const { onSubmit } = renderPanel();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('In review')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Submit for review'));
    expect(screen.getByText('Passes every publish check')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('keeps Submit shut while the map is dirty or blocked, and says why', () => {
    renderPanel({ isDirty: true });
    const dirty = screen.getByText('Submit for review').closest('button')!;
    expect(dirty).toBeDisabled();
    expect(dirty.title).toBe('Save your changes first');
  });

  it('names what review will block on', () => {
    renderPanel({ report: blocked });
    const button = screen.getByText('Submit for review').closest('button')!;
    expect(button).toBeDisabled();
    // Six territories short, five connections short, an empty region.
    expect(button.title).toMatch(/Map health lists 3 things/);
  });

  it('shows the reviewer\'s note on a map sent back, and offers to submit again', () => {
    renderPanel({ status: 'rejected', reason: 'Two regions share a name' });
    expect(screen.getByText('Sent back')).toBeInTheDocument();
    expect(screen.getByText(/Two regions share a name/)).toBeInTheDocument();
    expect(screen.getByText('Submit again')).toBeInTheDocument();
  });

  it('offers the share link once the map exists, and copies on click', () => {
    const { onShare } = renderPanel({ status: 'approved' });
    fireEvent.click(screen.getByText('Share link'));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Submit for review')).toBeNull();
  });
});
