/**
 * The sub-page header. On a phone its back link shows only the chevron, so the
 * title has the room; the label must stay the link's name for a screen reader,
 * or the link would be an unnamed icon.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from 'lucide-react';
import SubpageShell from './SubpageShell';

const renderShell = (props: Partial<React.ComponentProps<typeof SubpageShell>> = {}) =>
  render(
    <MemoryRouter>
      <SubpageShell title="Settings" icon={Settings} {...props}>
        <p>Body</p>
      </SubpageShell>
    </MemoryRouter>,
  );

describe('SubpageShell header', () => {
  it('names the back link by its label, which only a phone hides from sight', () => {
    renderShell({ backHref: '/maps', backLabel: 'Map Hub' });
    const back = screen.getByRole('link', { name: 'Map Hub' });
    expect(back.getAttribute('href')).toBe('/maps');
    const label = screen.getByText('Map Hub');
    expect(label.className).toContain('sr-only');
    expect(label.className).toContain('sm:not-sr-only');
  });

  it('defaults the back link to the lobby', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Lobby' }).getAttribute('href')).toBe('/lobby');
  });

  it('keeps the whole title in the heading, with no icon in its name', () => {
    renderShell({ title: 'Commander Profile' });
    expect(screen.getByRole('heading', { level: 1, name: 'Commander Profile' })).toBeTruthy();
  });

  it('puts a custom header left in place of the back link', () => {
    renderShell({ headerLeft: <span>Wordmark</span> });
    expect(screen.queryByRole('link', { name: 'Lobby' })).toBeNull();
    expect(screen.getByText('Wordmark')).toBeTruthy();
  });
});
