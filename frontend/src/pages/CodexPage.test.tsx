/**
 * /codex renders from the generated codex, not from the network.
 *
 * It used to fire one API call per era on mount. That was slow, and — more
 * importantly — it meant the page's content existed only after JavaScript ran,
 * so the served HTML was the bare SPA shell carrying the shell's homepage
 * canonical. Google read the page as a duplicate of the landing page and never
 * indexed it. The prerendered HTML and this component now come from one file,
 * which is also what keeps crawler and visitor seeing the same thing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CodexPage from './CodexPage';
import { FACTION_CODEX } from '../marketing/factionCodex.generated.mjs';

const getMock = vi.fn();
vi.mock('../services/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a) },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <CodexPage />
    </MemoryRouter>,
  );
}

describe('CodexPage', () => {
  beforeEach(() => getMock.mockReset());

  it('renders every faction without touching the API', () => {
    renderPage();
    const total = FACTION_CODEX.reduce((n, e) => n + e.factions.length, 0);
    expect(screen.getAllByRole('button').length).toBe(total);
    // The regression this guards: ten era fetches on mount for static data.
    expect(getMock).not.toHaveBeenCalled();
  });

  it('shows content on first paint, with no loading state to wait through', () => {
    renderPage();
    expect(screen.getByText('Roman Republic')).toBeInTheDocument();
    expect(screen.queryByText(/Loading factions/i)).toBeNull();
  });

  it('groups factions under era headings', () => {
    renderPage();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.length).toBe(FACTION_CODEX.length);
    expect(headings[0]).toHaveTextContent('Ancient World');
  });

  it('opens the lore modal for a faction', () => {
    renderPage();
    fireEvent.click(screen.getByText('Roman Republic'));
    // The modal shows lore the card does not — proof the full record, not just
    // the summary shown in the grid, survived the move off the API.
    expect(screen.getByText(/A republic forged through citizen armies/)).toBeInTheDocument();
  });
});
