import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
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

  it('shows Skip on a deep-dive card that opts in, and not on one that does not', () => {
    const onSkipToEnd = vi.fn();
    const { rerender } = overlay(
      [{ id: 'gls_welcome', title: 'W', message: 'm', skippable: true } as TutorialStep],
      { onSkipToEnd, lessonModule: 'galaxy_lane_sovereignty' },
    );
    fireEvent.click(screen.getByTestId('tutorial-skip-btn'));
    expect(onSkipToEnd).toHaveBeenCalledTimes(1);
    rerender(
      <TutorialOverlay
        steps={[{ id: 'fa_welcome', title: 'W', message: 'm' } as TutorialStep]}
        stepIndex={0}
        lessonModule="faction_ability"
        onAdvance={noop}
        onContinuePlaying={noop}
        onReturnToLobby={noop}
        onSkipToEnd={onSkipToEnd}
      />,
    );
    expect(screen.queryByTestId('tutorial-skip-btn')).toBeNull();
  });

  it('offers the lesson a card links to, and launches it', () => {
    const onLaunchModule = vi.fn();
    overlay(
      [{ id: 'gls_welcome', title: 'W', message: 'm', skippable: true, linkModule: 'galaxy_primer' } as TutorialStep],
      { onLaunchModule, onSkipToEnd: noop, lessonModule: 'galaxy_lane_sovereignty' },
    );
    const link = screen.getByTestId('tutorial-linked-lesson-btn');
    expect(link.textContent).toContain('Galactic Age: The Differences');
    fireEvent.click(link);
    expect(onLaunchModule).toHaveBeenCalledWith('galaxy_primer');
  });

  it('shows no link button on a card without one, or when nothing can launch a lesson', () => {
    const { rerender } = overlay(
      [{ id: 'gls_welcome', title: 'W', message: 'm' } as TutorialStep],
      { onLaunchModule: vi.fn(), lessonModule: 'galaxy_lane_sovereignty' },
    );
    expect(screen.queryByTestId('tutorial-linked-lesson-btn')).toBeNull();
    rerender(
      <TutorialOverlay
        steps={[{ id: 'gls_welcome', title: 'W', message: 'm', linkModule: 'galaxy_primer' } as TutorialStep]}
        stepIndex={0}
        lessonModule="galaxy_lane_sovereignty"
        onAdvance={noop}
        onContinuePlaying={noop}
        onReturnToLobby={noop}
      />,
    );
    expect(screen.queryByTestId('tutorial-linked-lesson-btn')).toBeNull();
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

  describe('wrap-up that leads into the first match', () => {
    const wrapup = { id: 'wrapup', title: "You're Ready!", message: 'm', variant: 'wrapup' } as TutorialStep;

    it('keeps "Continue playing" as the main button when no first-match handler is given', () => {
      overlay([wrapup]);
      expect(screen.getByTestId('tutorial-continue-btn')).toHaveTextContent('Continue playing');
      expect(screen.queryByTestId('tutorial-first-match-btn')).toBeNull();
      expect(screen.queryByTestId('tutorial-save-progress-btn')).toBeNull();
    });

    it('makes "Play your first match" the main button, with saving as a choice beside it', () => {
      const onPlayFirstMatch = vi.fn();
      const onSaveProgress = vi.fn();
      const onContinuePlaying = vi.fn();
      overlay([wrapup], { onPlayFirstMatch, onSaveProgress, onContinuePlaying });
      expect(screen.queryByTestId('tutorial-continue-btn')).toBeNull();
      const play = screen.getByTestId('tutorial-first-match-btn');
      expect(play).toHaveTextContent('Play your first match');
      expect(play.className).toContain('btn-primary');
      const save = screen.getByTestId('tutorial-save-progress-btn');
      expect(save.className).toContain('btn-secondary');
      fireEvent.click(play);
      expect(onPlayFirstMatch).toHaveBeenCalledTimes(1);
      fireEvent.click(save);
      expect(onSaveProgress).toHaveBeenCalledTimes(1);
      expect(onContinuePlaying).not.toHaveBeenCalled();
    });

    it('offers no save button when the player is not a guest', () => {
      overlay([wrapup], { onPlayFirstMatch: vi.fn() });
      expect(screen.getByTestId('tutorial-first-match-btn')).toBeInTheDocument();
      expect(screen.queryByTestId('tutorial-save-progress-btn')).toBeNull();
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

  describe('a phone with a full-screen panel open', () => {
    // The tech tree opens full screen with its gate rail, and the Advance
    // button in it, at the top. A waiting card pinned to the top of a phone
    // covered that rail: on a 390x844 screen a tap on the centre of
    // "Advance to Medieval Era" landed on the card.
    const research = {
      id: 'ea_research',
      title: 'Research Toward the Gate',
      message: 'Open the Tech Tree and research a tier-1 technology.',
      actionOpenTechTree: true,
      requireAction: 'tech_researched',
    } as TutorialStep;
    const advance = {
      id: 'ea_advance',
      title: 'Advance to Medieval',
      message: 'When every gate chip is green, hit Advance to Medieval.',
      requireAction: 'era_advanced',
    } as TutorialStep;
    const steps = [research, advance];

    function at(stepIndex: number, panelOpen: boolean) {
      return (
        <TutorialOverlay
          steps={steps}
          stepIndex={stepIndex}
          lessonModule="core"
          onAdvance={noop}
          onContinuePlaying={noop}
          onReturnToLobby={noop}
          onOpenTechTree={noop}
          panelOpen={panelOpen}
        />
      );
    }
    const wrapperOf = (container: HTMLElement) => container.querySelector('.pointer-events-auto');

    it('folds the card the player opened the panel from to a strip along the bottom that names the next action', () => {
      mockViewport({ mobile: true });
      const { container, rerender } = render(at(0, false));
      expect(wrapperOf(container)?.className).toContain('top-[');
      rerender(at(0, true));
      const strip = screen.getByTestId('tutorial-card-unfold');
      expect(strip.className).toContain('bottom-[');
      expect(strip.className).not.toContain('top-');
      expect(strip).toHaveTextContent('Research Toward the Gate');
      expect(strip).toHaveTextContent('Research a technology to continue…');
      expect(screen.queryByText(/research a tier-1 technology/)).toBeNull();
    });

    it('unfolds at the bottom when the strip is tapped', () => {
      mockViewport({ mobile: true });
      const { container, rerender } = render(at(0, false));
      rerender(at(0, true));
      fireEvent.click(screen.getByTestId('tutorial-card-unfold'));
      expect(screen.getByText(/research a tier-1 technology/)).toBeInTheDocument();
      expect(wrapperOf(container)?.className).toContain('bottom-[');
    });

    it('opens a card that arrives while the panel is open, at the bottom, and it folds by hand', () => {
      mockViewport({ mobile: true });
      const { container, rerender } = render(at(0, false));
      rerender(at(0, true));
      rerender(at(1, true));
      expect(screen.getByText(/hit Advance to Medieval/)).toBeInTheDocument();
      const cls = wrapperOf(container)?.className ?? '';
      expect(cls).toContain('bottom-[');
      expect(cls).not.toContain('top-[');
      expect(screen.getByText('Advance your era to continue…')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('tutorial-card-fold'));
      expect(screen.getByTestId('tutorial-card-unfold')).toHaveTextContent('Advance your era to continue…');
    });

    describe('with tutorial_phone_gate_visible_enabled', () => {
      afterEach(() => {
        useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, tutorial_phone_gate_visible_enabled: false } }));
      });
      const marked = [research, { ...advance, arrivesFoldedOverPanel: true }];
      function markedAt(stepIndex: number, panelOpen: boolean) {
        return (
          <TutorialOverlay
            steps={marked}
            stepIndex={stepIndex}
            lessonModule="core"
            onAdvance={noop}
            onContinuePlaying={noop}
            onReturnToLobby={noop}
            onOpenTechTree={noop}
            panelOpen={panelOpen}
          />
        );
      }

      it('keeps a marked card folded when it arrives over the open panel, naming its action', () => {
        mockViewport({ mobile: true });
        useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, tutorial_phone_gate_visible_enabled: true } }));
        const { rerender } = render(markedAt(0, false));
        rerender(markedAt(0, true));
        rerender(markedAt(1, true));
        const strip = screen.getByTestId('tutorial-card-unfold');
        expect(strip).toHaveTextContent('Advance to Medieval');
        expect(strip).toHaveTextContent('Advance your era to continue…');
        expect(screen.queryByText(/hit Advance to Medieval/)).toBeNull();
        fireEvent.click(strip);
        expect(screen.getByText(/hit Advance to Medieval/)).toBeInTheDocument();
      });

      it('opens the same card as before while the flag is off', () => {
        mockViewport({ mobile: true });
        const { rerender } = render(markedAt(0, false));
        rerender(markedAt(0, true));
        rerender(markedAt(1, true));
        expect(screen.getByText(/hit Advance to Medieval/)).toBeInTheDocument();
      });

      it('shows a brief card without its detail, hint or why on a phone only', () => {
        const briefStep = {
          id: 'economy_intro',
          title: 'Economy',
          message: 'The main message.',
          detail: 'The long detail.',
          hint: 'The hint.',
          whyItMatters: 'The reason.',
          phoneBrief: true,
        } as TutorialStep;
        mockViewport({ mobile: true });
        useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, tutorial_phone_gate_visible_enabled: true } }));
        const { unmount } = overlay([briefStep], { phoneLayout: true });
        expect(screen.getByText('The main message.')).toBeInTheDocument();
        expect(screen.queryByText('The long detail.')).toBeNull();
        expect(screen.queryByText('The hint.')).toBeNull();
        expect(screen.queryByText('Why this matters')).toBeNull();
        unmount();
        mockViewport();
        overlay([briefStep], { phoneLayout: false });
        expect(screen.getByText('The long detail.')).toBeInTheDocument();
      });
    });

    it('returns to the top of the board when the panel closes', () => {
      mockViewport({ mobile: true });
      const { container, rerender } = render(at(0, false));
      rerender(at(0, true));
      rerender(at(0, false));
      expect(screen.queryByTestId('tutorial-card-unfold')).toBeNull();
      expect(wrapperOf(container)?.className).toContain('top-[');
    });

    it('stops offering to open the panel that is already open', () => {
      mockViewport({ mobile: true });
      const { rerender } = render(at(0, false));
      expect(screen.getByRole('button', { name: 'Open Tech Tree' })).toBeInTheDocument();
      rerender(at(0, true));
      fireEvent.click(screen.getByTestId('tutorial-card-unfold'));
      expect(screen.queryByRole('button', { name: 'Open Tech Tree' })).toBeNull();
    });

    it('leaves the desktop dock beside the panel as it was, minus the redundant button', () => {
      mockViewport();
      const { container } = render(at(0, true));
      const cls = wrapperOf(container)?.className ?? '';
      expect(cls).toContain('bottom-20');
      expect(cls).toContain('left-0');
      expect(screen.queryByTestId('tutorial-card-unfold')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Open Tech Tree' })).toBeNull();
    });
  });

  describe('the phone layout', () => {
    // A phone has no sidebar: the same panels sit behind the bottom bar's
    // ☰ Menu, so a card that names a place carries a phone version of it.
    const step = {
      id: 'economy_intro',
      title: 'Your Empire Is Also an Economy',
      message: 'Your turn again.',
      detail: 'The Era panel in your sidebar shows the timeline.',
      detailPhone: 'The Era panel under ☰ Menu shows the timeline.',
    } as TutorialStep;

    it('reads the phone version of a card', () => {
      overlay([step], { phoneLayout: true });
      expect(screen.getByText(/under ☰ Menu/)).toBeInTheDocument();
      expect(screen.queryByText(/sidebar/)).toBeNull();
    });

    it('reads the desktop version everywhere else', () => {
      overlay([step]);
      expect(screen.getByText(/in your sidebar/)).toBeInTheDocument();
      expect(screen.queryByText(/☰ Menu/)).toBeNull();
    });

    it('falls back to the desktop copy where a card has no phone version', () => {
      overlay([{ ...step, detailPhone: undefined }], { phoneLayout: true });
      expect(screen.getByText(/in your sidebar/)).toBeInTheDocument();
    });
  });
});

describe('tutorial card fade (tutorial_card_fade_enabled)', () => {
  const setFade = (on: boolean) =>
    useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, tutorial_card_fade_enabled: on } }));
  const welcome = [{ id: 'welcome', title: 'Welcome', message: 'A long welcome.' } as TutorialStep];
  let spies: Array<{ mockRestore: () => void }> = [];

  /** jsdom has no layout: give every element the prose's scroll metrics. */
  function proseOf(scrollHeight: number, clientHeight: number) {
    spies = [
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight),
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight),
    ];
  }

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies = [];
    setFade(false);
  });

  it('fades the last lines while the prose runs past the card, until scrolled to the end', () => {
    setFade(true);
    proseOf(600, 300);
    overlay(welcome, { centered: true });
    const fade = screen.getByTestId('tutorial-prose-fade');
    expect(fade).toBeTruthy();
    // Scroll the prose to its end: the fade goes.
    const prose = fade.previousElementSibling as HTMLElement;
    prose.scrollTop = 300;
    fireEvent.scroll(prose);
    expect(screen.queryByTestId('tutorial-prose-fade')).toBeNull();
  });

  it('shows no fade when the prose fits', () => {
    setFade(true);
    proseOf(200, 300);
    overlay(welcome, { centered: true });
    expect(screen.queryByTestId('tutorial-prose-fade')).toBeNull();
  });

  it('is the card as before with the flag off', () => {
    setFade(false);
    proseOf(600, 300);
    overlay(welcome, { centered: true });
    expect(screen.queryByTestId('tutorial-prose-fade')).toBeNull();
  });
});
