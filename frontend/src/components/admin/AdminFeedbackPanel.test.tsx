/**
 * Admin → Feedback reads GET /api/admin/feedback: the counts, then each entry
 * with the context the player did not type. A comment is player text and must
 * render as text.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminFeedbackPanel, { upShare, type FeedbackReport } from './AdminFeedbackPanel';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { get } }));

const REPORT: FeedbackReport = {
  summary: { total: 3, up: 2, down: 1, with_comment: 2 },
  items: [
    {
      feedback_id: 'f2', created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:05:00Z',
      source: 'game_over', rating: 'down', comment: '<b>The chart</b> covers End Turn',
      game_id: 'g9', turn_number: 14, device: 'phone', viewport: '390x844',
      user_id: 'u2', username: 'Guest_4821', is_guest: true,
    },
    {
      feedback_id: 'f1', created_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T10:00:00Z',
      source: 'beta_panel', rating: 'up', comment: null,
      game_id: null, turn_number: null, device: null, viewport: null,
      user_id: 'u1', username: null, is_guest: false,
    },
  ],
};

describe('AdminFeedbackPanel', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: REPORT });
  });

  it('shows the counts, then each entry with its context', async () => {
    render(<MemoryRouter><AdminFeedbackPanel refreshKey={1} /></MemoryRouter>);
    await screen.findByTestId('admin-feedback-list');
    expect(screen.getByText('2 (67%)')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toMatch(/Guest_4821\(guest\)/);
    expect(items[0].textContent).toMatch(/phone · 390×844 · turn 14 · Replay/);
    expect(screen.getByRole('link', { name: 'Replay' })).toHaveAttribute('href', '/replay/g9');
    expect(items[1].textContent).toMatch(/Deleted account/);
    expect(items[1].textContent).toMatch(/No context/);
  });

  it('renders a comment as text, never as markup', async () => {
    const { container } = render(<MemoryRouter><AdminFeedbackPanel refreshKey={1} /></MemoryRouter>);
    await screen.findByText('<b>The chart</b> covers End Turn');
    expect(container.querySelector('li b')).toBeNull();
  });

  it('asks again for the window and thumb chosen', async () => {
    render(<MemoryRouter><AdminFeedbackPanel refreshKey={1} /></MemoryRouter>);
    await screen.findByTestId('admin-feedback-list');
    expect(get).toHaveBeenLastCalledWith('/admin/feedback', { params: { topic: 'galactic_age', days: 30 } });
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: 'down' } });
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '0' } });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/admin/feedback', { params: { topic: 'galactic_age', rating: 'down' } }));
  });

  it('reads the share of thumbs up, or a dash before there are any', () => {
    expect(upShare({ total: 0, up: 0, down: 0, with_comment: 0 })).toBe('—');
    expect(upShare({ total: 4, up: 3, down: 1, with_comment: 0 })).toBe('75%');
  });
});
