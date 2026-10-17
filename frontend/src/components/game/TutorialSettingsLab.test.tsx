import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TutorialSettingsLab from './TutorialSettingsLab';

/**
 * The Advanced Settings lesson's lab. It used to start Diplomacy switched on
 * whatever the match had, and send its values the moment a second toggle
 * flipped: an option the player never touched was switched on for them, and
 * flips after the second never reached the match, though the lab and the card
 * both said the choices apply when the lab closes.
 */
const MATCH = {
  fog_of_war: false,
  factions_enabled: false,
  tech_trees_enabled: false,
  economy_enabled: false,
  events_enabled: false,
  diplomacy_enabled: false,
};

const toggleOf = (key: string) => within(screen.getByTestId(`lab-toggle-${key}`)).getByRole('switch');

function renderLab(initialValues: Partial<Record<string, boolean>> = MATCH) {
  const onSettingsExplored = vi.fn();
  const onClose = vi.fn();
  render(<TutorialSettingsLab initialValues={initialValues} onSettingsExplored={onSettingsExplored} onClose={onClose} />);
  return { onSettingsExplored, onClose };
}

describe('TutorialSettingsLab', () => {
  it('starts from what the match has on', () => {
    renderLab({ ...MATCH, fog_of_war: true });
    expect(toggleOf('fog_of_war')).toHaveAttribute('aria-checked', 'true');
    expect(toggleOf('diplomacy_enabled')).toHaveAttribute('aria-checked', 'false');
  });

  it('applies every value when it closes, flips after the second included', () => {
    const { onSettingsExplored, onClose } = renderLab();
    fireEvent.click(toggleOf('fog_of_war'));
    fireEvent.click(toggleOf('factions_enabled'));
    expect(onSettingsExplored).not.toHaveBeenCalled();
    fireEvent.click(toggleOf('events_enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'Close Settings Lab' }));
    expect(onSettingsExplored).toHaveBeenCalledTimes(1);
    expect(onSettingsExplored).toHaveBeenCalledWith({
      ...MATCH,
      fog_of_war: true,
      factions_enabled: true,
      events_enabled: true,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('changes nothing when it closes before two options were explored', () => {
    const { onSettingsExplored, onClose } = renderLab();
    fireEvent.click(toggleOf('fog_of_war'));
    fireEvent.click(screen.getByRole('button', { name: 'Close Settings Lab' }));
    expect(onSettingsExplored).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('counts an option flipped back and forth once', () => {
    const { onSettingsExplored } = renderLab();
    fireEvent.click(toggleOf('fog_of_war'));
    fireEvent.click(toggleOf('fog_of_war'));
    expect(screen.getByText(/1 of 2 explored/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Settings Lab' }));
    expect(onSettingsExplored).not.toHaveBeenCalled();
  });
});
