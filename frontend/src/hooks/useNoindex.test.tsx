import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useNoindex } from './useNoindex';

function Probe({ active }: { active: boolean }) {
  useNoindex(active);
  return null;
}

const robots = () => document.head.querySelectorAll('meta[name="robots"][content="noindex"]');

afterEach(() => {
  cleanup();
  document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
});

describe('useNoindex', () => {
  it('adds the tag while active', () => {
    render(<Probe active />);
    expect(robots()).toHaveLength(1);
  });

  it('adds nothing while inactive — a real page must stay indexable', () => {
    render(<Probe active={false} />);
    expect(robots()).toHaveLength(0);
  });

  it('removes the tag on unmount, so it cannot leak onto the next route', () => {
    const { unmount } = render(<Probe active />);
    expect(robots()).toHaveLength(1);
    unmount();
    expect(robots()).toHaveLength(0);
  });

  it('follows the flag when a page resolves from missing to found', () => {
    const { rerender } = render(<Probe active />);
    expect(robots()).toHaveLength(1);
    rerender(<Probe active={false} />);
    expect(robots()).toHaveLength(0);
  });

  it('does not stack tags across rerenders', () => {
    const { rerender } = render(<Probe active />);
    rerender(<Probe active />);
    rerender(<Probe active />);
    expect(robots()).toHaveLength(1);
  });

  it('leaves a robots tag it did not create alone', () => {
    const theirs = document.createElement('meta');
    theirs.name = 'robots';
    theirs.content = 'max-image-preview:large';
    document.head.appendChild(theirs);

    const { unmount } = render(<Probe active />);
    unmount();

    expect(document.head.contains(theirs)).toBe(true);
    expect(theirs.content).toBe('max-image-preview:large');
  });
});
