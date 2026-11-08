import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditorGuide, { type GuideStep } from './EditorGuide';

const steps = (done: boolean[]): GuideStep[] =>
  ['Add territories', 'Connect them', 'Make regions'].map((title, i) => ({
    id: `s${i}`,
    title,
    detail: `How to ${title.toLowerCase()}`,
    done: done[i] ?? false,
  }));

beforeEach(() => localStorage.clear());

describe('EditorGuide', () => {
  it('ticks the finished steps and explains only the next one', () => {
    render(<EditorGuide steps={steps([true, false, false])} />);
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('How to connect them')).toBeInTheDocument();
    expect(screen.queryByText('How to make regions')).toBeNull();
    expect(screen.getByText('Add territories').className).toContain('line-through');
  });

  it('folds to a line once everything is done', () => {
    render(<EditorGuide steps={steps([true, true, true])} />);
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(screen.queryByText('Add territories')).toBeNull();
  });

  it('stays dismissed across mounts until the lightbulb brings it back', () => {
    const { unmount } = render(<EditorGuide steps={steps([false, false, false])} />);
    fireEvent.click(screen.getByLabelText('Hide the guide'));
    expect(screen.queryByText('Add territories')).toBeNull();
    unmount();
    render(<EditorGuide steps={steps([false, false, false])} />);
    expect(screen.queryByText('Add territories')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show the guide'));
    expect(screen.getByText('Add territories')).toBeInTheDocument();
  });
});
