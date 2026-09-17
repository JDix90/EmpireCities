import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * matchMedia that answers per query rather than `false` for everything, so a
 * test can describe a viewport that is wide but SHORT — the shape a portal
 * embed (itch.io, CrazyGames) and an unmaximised laptop both have, and the one
 * a width-only mock cannot express.
 */
function mockViewport({ short = false, mobile = false } = {}) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-height') ? short : query.includes('max-width') ? mobile : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  // Default: a roomy desktop, matching the previous blanket `matches: false`.
  mockViewport();
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

  describe('wrap-up reached by skipping', () => {
    const wrapup = {
      id: 'wrapup',
      title: "You're Ready!",
      message: 'You ran the full turn cycle and climbed an era.',
      skippedTitle: 'Jumping Straight In',
      skippedMessage: 'Here is the shape of it.',
      variant: 'wrapup',
    } as TutorialStep;

    it('shows the skip copy, never the recap of play that did not happen', () => {
      overlay([wrapup], { skipped: true });
      expect(screen.getByText('Jumping Straight In')).toBeInTheDocument();
      expect(screen.getByText('Here is the shape of it.')).toBeInTheDocument();
      expect(screen.queryByText(/climbed an era/)).toBeNull();
      expect(screen.queryByText("You're Ready!")).toBeNull();
    });

    it('keeps the earned copy when the player played through', () => {
      overlay([wrapup], { skipped: false });
      expect(screen.getByText("You're Ready!")).toBeInTheDocument();
      expect(screen.getByText(/climbed an era/)).toBeInTheDocument();
    });

    it('falls back to the normal copy on a step with no skip copy', () => {
      overlay([{ ...wrapup, skippedTitle: undefined, skippedMessage: undefined }], { skipped: true });
      expect(screen.getByText("You're Ready!")).toBeInTheDocument();
    });
  });

  it('uses neutral copy for action steps instead of "panel below"', () => {
    overlay([
      { id: 'draft_do', title: 'D', message: 'm', requireAction: 'draft' } as TutorialStep,
    ]);
    expect(screen.getByText('Complete the action to continue…')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Use the panel below');
  });

  describe('folding a docked card', () => {
    // `cardPosition: 'aside'` docks the card into the left gutter, which is
    // also where the territory panel opens — and the panel can run 500px tall.
    // Uncapped they overlapped and the card sat on the panel's Attack button.
    const asideStep = {
      id: 'choose_front',
      title: 'Pick Your Front',
      message: 'Attack something.',
      requireAction: 'end_phase',
      cardPosition: 'aside',
    } as TutorialStep;

    it('folds to a title strip while a territory panel is open', () => {
      overlay([asideStep], { territorySelected: true });
      expect(screen.getByTestId('tutorial-card-unfold')).toHaveTextContent('Pick Your Front');
      expect(screen.queryByText('Attack something.')).toBeNull();
    });

    it('unfolds again when the player taps the strip, and stays unfolded', () => {
      overlay([asideStep], { territorySelected: true });
      fireEvent.click(screen.getByTestId('tutorial-card-unfold'));
      expect(screen.getByText('Attack something.')).toBeInTheDocument();
    });

    it('can be folded by hand even with no panel open', () => {
      overlay([asideStep]);
      expect(screen.getByText('Attack something.')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('tutorial-card-fold'));
      expect(screen.queryByText('Attack something.')).toBeNull();
    });

    it('offers no fold control on an undocked card — nothing is competing for the space', () => {
      overlay([{ id: 'draft_do', title: 'D', message: 'm', requireAction: 'draft' } as TutorialStep]);
      expect(screen.queryByTestId('tutorial-card-fold')).toBeNull();
    });

    it('re-folds on the next step rather than carrying the choice forward', () => {
      const { rerender } = overlay([asideStep, { ...asideStep, id: 'later', message: 'Later copy.' }], {
        territorySelected: true,
      });
      fireEvent.click(screen.getByTestId('tutorial-card-unfold'));
      expect(screen.getByText('Attack something.')).toBeInTheDocument();
      rerender(
        <TutorialOverlay
          steps={[asideStep, { ...asideStep, id: 'later', message: 'Later copy.' } as TutorialStep]}
          stepIndex={1}
          lessonModule="core"
          onAdvance={noop}
          onContinuePlaying={noop}
          onReturnToLobby={noop}
          territorySelected
        />,
      );
      expect(screen.getByTestId('tutorial-card-unfold')).toBeInTheDocument();
      expect(screen.queryByText('Later copy.')).toBeNull();
    });
  });

  describe('a wide but short viewport', () => {
    // Reproduces the itch.io embed: ~1280x720, so every width-based breakpoint
    // says "desktop" while the height says otherwise. The bottom-center card
    // this used to fall back to covered the board its own copy points at, and
    // carried no fold control because folding was docked-only.
    const actionStep = {
      id: 'draft_do',
      title: 'Place Your Reinforcements',
      message: 'Click one of your territories.',
      requireAction: 'draft',
    } as TutorialStep;

    /** The positioned wrapper; when unfolded it is the only pointer-events-auto node. */
    const wrapperOf = (container: HTMLElement) => container.querySelector('.pointer-events-auto');

    it('docks into the gutter instead of sitting across the board', () => {
      mockViewport({ short: true });
      const { container } = overlay([actionStep]);
      const cls = wrapperOf(container)?.className ?? '';
      expect(cls).toContain('left-0');
      expect(cls).not.toContain('bottom-20');
    });

    it('offers the fold control, so the player can look underneath', () => {
      mockViewport({ short: true });
      overlay([actionStep]);
      fireEvent.click(screen.getByTestId('tutorial-card-fold'));
      expect(screen.queryByText('Click one of your territories.')).toBeNull();
      expect(screen.getByTestId('tutorial-card-unfold')).toHaveTextContent('Place Your Reinforcements');
    });

    it('leaves a tall desktop exactly as it was', () => {
      mockViewport({ short: false });
      const { container } = overlay([actionStep]);
      expect(wrapperOf(container)?.className ?? '').toContain('bottom-20');
      expect(screen.queryByTestId('tutorial-card-fold')).toBeNull();
    });

    it('trims a centered card\u2019s padding rather than spending 4rem of a short frame', () => {
      mockViewport({ short: true });
      const { container } = overlay([{ id: 'welcome', title: 'W', message: 'm' } as TutorialStep], {
        centered: true,
      });
      const card = container.querySelector('.rounded-2xl');
      expect(card?.className).toContain('p-5');
      expect(card?.className).not.toContain('p-8');
    });

    it('keeps the roomy centered padding on a tall desktop', () => {
      mockViewport({ short: false });
      const { container } = overlay([{ id: 'welcome', title: 'W', message: 'm' } as TutorialStep], {
        centered: true,
      });
      const card = container.querySelector('.rounded-2xl');
      expect(card?.className).toContain('p-8');
      expect(card?.className).not.toContain('p-5');
    });
  });
});
