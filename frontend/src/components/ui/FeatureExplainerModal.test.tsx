import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FeatureExplainerModal from './FeatureExplainerModal';

describe('FeatureExplainerModal', () => {
  beforeEach(() => localStorage.clear());

  it('shows once per browser', () => {
    const { unmount } = render(<FeatureExplainerModal featureKey="t" title="Once" description="d" />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    unmount();
    render(<FeatureExplainerModal featureKey="t" title="Once" description="d" />);
    expect(screen.queryByText('Once')).toBeNull();
  });

  it('offers the way onward in a new tab, and counts the explainer as read', () => {
    render(
      <MemoryRouter>
        <FeatureExplainerModal
          featureKey="g"
          title="T"
          description="d"
          link={{ to: '/tutorial?module=galaxy_primer&start=1', label: 'Primer' }}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Primer/ });
    expect(link.getAttribute('href')).toBe('/tutorial?module=galaxy_primer&start=1');
    expect(link.getAttribute('target')).toBe('_blank');
    fireEvent.click(link);
    expect(localStorage.getItem('explainer_seen_g')).toBe('1');
  });
});
