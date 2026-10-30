/**
 * Feedback about anything, from the lobby's menu (feedback_menu_enabled): the
 * desktop top bar's Feedback entry and the phone's More sheet both open the
 * same form, which sends a note, what it is about if the player says, and the
 * page and screen it came from.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FeedbackModal from './FeedbackModal';
import TopNavBar from '../ui/TopNavBar';
import MobileTabBar from '../ui/MobileTabBar';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { FEEDBACK_COMMENT_MAX } from './feedbackParts';

const post = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { post, get: vi.fn(() => new Promise(() => {})) } }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, feedback_menu_enabled: on } }));

function stubScreen() {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

describe('FeedbackModal', () => {
  beforeEach(() => {
    post.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    stubScreen();
  });

  it('sends nothing until there is a note', () => {
    render(<MemoryRouter><FeedbackModal open onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'An idea' }));
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled();
  });

  it('sends the note, what it is about, and the page and screen it came from', async () => {
    post.mockResolvedValue({ data: { ok: true } });
    const onClose = vi.fn();
    render(<MemoryRouter initialEntries={['/lobby']}><FeedbackModal open onClose={onClose} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Something’s broken' }));
    expect(screen.getByPlaceholderText(/What happened, and what did you expect/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: '  The chat covers the map.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/feedback', {
      topic: 'general',
      source: 'menu',
      category: 'bug',
      comment: 'The chat covers the map.',
      page: '/lobby',
      device: 'desktop',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('leaves the category out when none is picked, and a second tap unpicks one', async () => {
    post.mockResolvedValue({ data: { ok: true } });
    render(<MemoryRouter><FeedbackModal open onClose={() => {}} /></MemoryRouter>);
    const idea = screen.getByRole('button', { name: 'An idea' });
    fireEvent.click(idea);
    expect(idea).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(idea);
    expect(idea).toHaveAttribute('aria-pressed', 'false');
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'Love it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).not.toHaveProperty('category');
  });

  it('caps the note at what the server takes', () => {
    render(<MemoryRouter><FeedbackModal open onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText('Your note')).toHaveAttribute('maxLength', String(FEEDBACK_COMMENT_MAX));
  });

  it('keeps the note and says so when it did not go through', async () => {
    post.mockRejectedValue(new Error('offline'));
    const onClose = vi.fn();
    render(<MemoryRouter><FeedbackModal open onClose={onClose} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'Too slow on my laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Your note')).toHaveValue('Too slow on my laptop');
  });
});

describe('the Feedback entry in the lobby menu', () => {
  beforeEach(() => stubScreen());

  it('sits in the desktop top bar while its switch is on, and opens the form', () => {
    setFlag(true);
    render(<MemoryRouter initialEntries={['/lobby']}><TopNavBar user={{ username: 'Ossawatomix' }} onLogout={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Feedback/ }));
    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeTruthy();
  });

  it('is not in the desktop top bar while its switch is off', () => {
    setFlag(false);
    render(<MemoryRouter initialEntries={['/lobby']}><TopNavBar user={{ username: 'Ossawatomix' }} onLogout={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Feedback/ })).toBeNull();
  });

  it("sits in the phone's More sheet while its switch is on, and opens the form", () => {
    setFlag(true);
    render(<MemoryRouter initialEntries={['/lobby']}><MobileTabBar onCreateGame={() => {}} onLogout={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    fireEvent.click(screen.getByRole('button', { name: /Feedback/ }));
    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeTruthy();
  });

  it("is not in the phone's More sheet while its switch is off", () => {
    setFlag(false);
    render(<MemoryRouter initialEntries={['/lobby']}><MobileTabBar onCreateGame={() => {}} onLogout={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.queryByRole('button', { name: /Feedback/ })).toBeNull();
  });
});
