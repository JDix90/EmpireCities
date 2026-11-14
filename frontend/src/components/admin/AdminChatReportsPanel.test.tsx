import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminChatReportsPanel, { type ChatReportItem } from './AdminChatReportsPanel';

const getMock = vi.hoisted(() => vi.fn());
const postMock = vi.hoisted(() => vi.fn(async () => ({ data: { ok: true } })));
vi.mock('../../services/api', () => ({ api: { get: getMock, post: postMock } }));

const report = (over: Partial<ChatReportItem> = {}): ChatReportItem => ({
  report_id: 'r1', created_at: '2026-11-14T20:00:00Z', status: 'open', reason: 'harassment', details: 'all game long',
  channel: 'game', game_id: 'g1', message: 'you stink', message_verified: true,
  reported_id: 'u-rude', reported_username: 'RudeRaven', reported_is_banned: false, reported_open_reports: 2,
  reporter_id: 'u-me', reporter_username: 'KindKite', resolution_note: null, resolved_at: null, resolved_by_username: null,
  ...over,
});

const mount = () => render(<MemoryRouter><AdminChatReportsPanel refreshKey={1} /></MemoryRouter>);

describe('Admin → Reports', () => {
  beforeEach(() => { getMock.mockReset(); postMock.mockClear(); });

  it('shows what was said, why, by and about whom, and closes it with a note', async () => {
    getMock.mockResolvedValue({ data: { open: 1, items: [report()] } });
    mount();
    expect(await screen.findByText('you stink')).toBeInTheDocument();
    expect(screen.getByTestId('admin-chat-reports-open')).toHaveTextContent('1');
    expect(screen.getByText('Harassment')).toBeInTheDocument();
    expect(screen.getByText(/As sent \(the server’s copy\)\. Reported by KindKite\. 2 open reports against RudeRaven\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'warned' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actioned' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/admin/chat-reports/r1', { status: 'actioned', note: 'warned' }));
  });

  it('bans the sender through the existing ban action, after asking', async () => {
    getMock.mockResolvedValue({ data: { open: 1, items: [report()] } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Ban RudeRaven' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/admin/actions/ban', { user_id: 'u-rude' }));
    confirm.mockRestore();
  });

  it('says when the quote is the reporter\'s, and when the account is gone', async () => {
    getMock.mockResolvedValue({ data: { open: 1, items: [report({ message_verified: false, reported_id: null, reported_open_reports: 0 })] } });
    mount();
    expect(await screen.findByText(/As the reporter quoted it/)).toBeInTheDocument();
    expect(screen.getByText('(account deleted)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ban / })).toBeNull();
  });
});
