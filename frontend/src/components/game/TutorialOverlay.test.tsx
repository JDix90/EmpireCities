import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});
import TutorialOverlay, { renderTutorialText } from './TutorialOverlay';
import type { TutorialStep } from '../../tutorial';

const noop = () => {};

function overlay(steps: TutorialStep[], extra: Partial<React.ComponentProps<typeof TutorialOverlay>> = {}) {
  return render(
    <TutorialOverlay
      steps={steps}
      stepIndex={0}
      lessonModule="core"
      onAdvance={noop}
      onContinuePlaying={noop}
      onReturnToLobby={noop}
      {...extra}
    />,
  );
}

describe('renderTutorialText', () => {
  it('renders **bold** spans without literal asterisks', () => {
    render(<p>{renderTutorialText('Click the **Begin Attack →** button')}</p>);
    const strong = screen.getByText('Begin Attack →');
    expect(strong.tagName).toBe('STRONG');
    expect(document.body.textContent).not.toContain('**');
  });

  it('fills the {playerColor} token', () => {
    render(<p>{renderTutorialText('shown in **{playerColor}** on the map', 'blue')}</p>);
    expect(screen.getByText('blue').tagName).toBe('STRONG');
  });
});

describe('TutorialOverlay', () => {
  it('dims the backdrop on explain steps but not on interactive steps', () => {
    const { container, rerender } = overlay([
      { id: 'welcome', title: 'W', message: 'm' } as TutorialStep,
    ]);
    expect(container.querySelector('.bg-black\\/30')).not.toBeNull();

    rerender(
      <TutorialOverlay
        steps={[{ id: 'draft_do', title: 'D', message: 'm', requireAction: 'draft' } as TutorialStep]}
        stepIndex={0}
        lessonModule="core"
        onAdvance={noop}
        onContinuePlaying={noop}
        onReturnToLobby={noop}
      />,
    );
    expect(container.querySelector('.bg-black\\/30')).toBeNull();
  });

  it('shows a real Skip on the welcome step that jumps to the end', () => {
    const onSkip = vi.fn();
    overlay(
      [{ id: 'welcome', title: 'W', message: 'm' } as TutorialStep],
      { onSkipToEnd: onSkip },
    );
    fireEvent.click(screen.getByTestId('tutorial-skip-btn'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('uses neutral copy for action steps instead of "panel below"', () => {
    overlay([
      { id: 'draft_do', title: 'D', message: 'm', requireAction: 'draft' } as TutorialStep,
    ]);
    expect(screen.getByText('Complete the action to continue…')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Use the panel below');
  });
});
