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
  summary: { total: 4, up: 2, down: 1, with_comment: 3, bugs: 1, ideas: 0 },
  items: [
    {
      feedback_id: 'f3', created_at: '2026-10-29T10:00:00Z', updated_at: '2026-10-29T10:00:00Z',
      topic: 'general', source: 'menu', rating: null, category: 'bug', comment: 'Chat covers the map',
      game_id: null, turn_number: null, device: 'desktop', viewport: '1366x900', page: '/lobby',
      user_id: 'u3', username: 'Ossawatomix', is_guest: false,
    },
    {
      feedback_id: 'f2', created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:05:00Z',
      topic: 'galactic_age', source: 'game_over', rating: 'down', category: null, comment: '<b>The chart</b> covers End Turn',
      game_id: 'g9', turn_number: 14, device: 'phone', viewport: '390x844', page: null,
      user_id: 'u2', username: 'Guest_4821', is_guest: true,
    },
    {
      feedback_id: 'f1', created_at: '2026-10-27T10:00:00Z', updated_at: '2026-10-27T10:00:00Z',
      topic: 'galactic_age', source: 'beta_panel', rating: 'up', category: null, comment: null,
      game_id: null, turn_number: null, device: null, viewport: null, page: null,
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
    const bugsTile = screen.getAllByText('Bugs').find((el) => el.tagName === 'P');
    expect(bugsTile?.nextElementSibling?.textContent).toBe('1');
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toMatch(/Bug/);
    expect(items[0].textContent).toMatch(/Lobby menu/);
    expect(items[0].textContent).toMatch(/\/lobby · desktop · 1366×900/);
    expect(items[1].textContent).toMatch(/Guest_4821\(guest\)/);
    expect(items[1].textContent).toMatch(/Galactic Age · game over/);
    expect(items[1].textContent).toMatch(/phone · 390×844 · turn 14 · Replay/);
    expect(screen.getByRole('link', { name: 'Replay' })).toHaveAttribute('href', '/replay/g9');
    expect(items[2].textContent).toMatch(/Deleted account/);
    expect(items[2].textContent).toMatch(/No context/);
  });

  it('renders a comment as text, never as markup', async () => {
    const { container } = render(<MemoryRouter><AdminFeedbackPanel refreshKey={1} /></MemoryRouter>);
    await screen.findByText('<b>The chart</b> covers End Turn');
    expect(container.querySelector('li b')).toBeNull();
  });

  it('asks again for the window and thumb chosen', async () => {
    render(<MemoryRouter><AdminFeedbackPanel refreshKey={1} /></MemoryRouter>);
    await screen.findByTestId('admin-feedback-list');
    expect(get).toHaveBeenLastCalledWith('/admin/feedback', { params: { topic: 'all', days: 30 } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: 'general' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'bug' } });
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '0' } });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/admin/feedback', { params: { topic: 'general', category: 'bug' } }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: 'galactic_age' } });
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: 'down' } });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/admin/feedback', { params: { topic: 'galactic_age', rating: 'down' } }));
  });

  it('reads the share of thumbs up, or a dash before there are any', () => {
    expect(upShare({ total: 0, up: 0, down: 0, with_comment: 0, bugs: 0, ideas: 0 })).toBe('—');
    expect(upShare({ total: 4, up: 3, down: 1, with_comment: 0, bugs: 0, ideas: 0 })).toBe('75%');
  });
});
