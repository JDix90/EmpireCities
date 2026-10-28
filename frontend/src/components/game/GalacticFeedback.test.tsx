/**
 * The Galactic Age beta's feedback: the BETA panel's form and the game-over
 * question. What matters is what reaches POST /api/feedback (the player's
 * answer, plus the game, turn, device and screen size they did not type) and
 * that the player is told when their words did not go through.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GalacticFeedbackModal, GalacticGameOverFeedback, FEEDBACK_COMMENT_MAX } from './GalacticFeedback';

const post = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { post } }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));

const GAME = '0b6f3c1e-9f7e-4f8f-8a43-0d3a3f1e2a11';

describe('GalacticFeedbackModal', () => {
  beforeEach(() => {
    post.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('sends nothing until there is a thumb or a note', () => {
    render(<GalacticFeedbackModal open onClose={() => {}} gameId={GAME} turn={7} />);
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Anything to tell us/), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
  });

  it('sends the answer with the game, turn, device and screen size, then closes', async () => {
    post.mockResolvedValue({ data: { ok: true } });
    const onClose = vi.fn();
    render(<GalacticFeedbackModal open onClose={onClose} gameId={GAME} turn={7} />);
    expect(screen.getByText(/Sent with this game, turn 7, and your screen size/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not for me yet' }));
    fireEvent.change(screen.getByLabelText(/Anything to tell us/), { target: { value: '  Lanes are hard to read on a phone.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/feedback', expect.objectContaining({
      topic: 'galactic_age',
      source: 'beta_panel',
      rating: 'down',
      comment: 'Lanes are hard to read on a phone.',
      game_id: GAME,
      turn: 7,
      device: 'desktop',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    }));
    expect(toast.success).toHaveBeenCalled();
  });

  it('caps the note at the length the server takes', () => {
    render(<GalacticFeedbackModal open onClose={() => {}} />);
    expect(screen.getByLabelText(/Anything to tell us/)).toHaveAttribute('maxLength', String(FEEDBACK_COMMENT_MAX));
  });

  it('keeps the note and says so when it did not go through', async () => {
    post.mockRejectedValue({ response: { status: 429 } });
    const onClose = vi.fn();
    render(<GalacticFeedbackModal open onClose={onClose} gameId={GAME} turn={7} />);
    fireEvent.change(screen.getByLabelText(/Anything to tell us/), { target: { value: 'Too slow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Try again in a few minutes/)));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Anything to tell us/)).toHaveValue('Too slow');
  });
});

describe('GalacticGameOverFeedback', () => {
  beforeEach(() => {
    post.mockReset();
    toast.error.mockReset();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it('records the thumb on the tap, then sends a note to the same answer', async () => {
    post.mockResolvedValue({ data: { ok: true } });
    render(<GalacticGameOverFeedback gameId={GAME} turn={21} />);
    fireEvent.click(screen.getByRole('button', { name: 'I like it' }));
    expect(post).toHaveBeenCalledWith('/feedback', expect.objectContaining({ source: 'game_over', rating: 'up', game_id: GAME, turn: 21 }));
    expect(post.mock.calls[0][1]).not.toHaveProperty('comment');

    fireEvent.change(screen.getByPlaceholderText('What did you enjoy?'), { target: { value: 'The Vault fight.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Thanks — we read every note.');
    expect(post).toHaveBeenLastCalledWith('/feedback', expect.objectContaining({ source: 'game_over', rating: 'up', comment: 'The Vault fight.' }));
  });

  it('asks nothing more until a thumb is chosen', () => {
    render(<GalacticGameOverFeedback gameId={GAME} turn={21} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says when a note did not go through', async () => {
    post.mockResolvedValueOnce({ data: { ok: true } }).mockRejectedValueOnce(new Error('offline'));
    render(<GalacticGameOverFeedback gameId={GAME} turn={21} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not for me yet' }));
    fireEvent.change(screen.getByPlaceholderText('What got in the way?'), { target: { value: 'Lost track of lanes.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByText('Thanks — we read every note.')).toBeNull();
  });
});
