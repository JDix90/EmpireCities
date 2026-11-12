import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SurrenderOfferBanner from './SurrenderOfferBanner';

describe('SurrenderOfferBanner', () => {
  it('shows nothing without an offer', () => {
    render(<SurrenderOfferBanner offered={false} turnNumber={12} onAccept={() => {}} />);
    expect(screen.queryByText('Your rivals offer their surrender.')).toBeNull();
  });

  it('accepts once', () => {
    const onAccept = vi.fn();
    render(<SurrenderOfferBanner offered turnNumber={12} onAccept={onAccept} />);
    const accept = screen.getByRole('button', { name: 'Accept and win' });
    fireEvent.click(accept);
    fireEvent.click(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect((accept as HTMLButtonElement).disabled).toBe(true);
  });

  it('plays on until the next round, when a standing offer comes back', () => {
    const { rerender } = render(<SurrenderOfferBanner offered turnNumber={12} onAccept={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play on' }));
    expect(screen.queryByText('Your rivals offer their surrender.')).toBeNull();
    rerender(<SurrenderOfferBanner offered turnNumber={12} onAccept={() => {}} />);
    expect(screen.queryByText('Your rivals offer their surrender.')).toBeNull();
    rerender(<SurrenderOfferBanner offered turnNumber={13} onAccept={() => {}} />);
    expect(screen.getByText('Your rivals offer their surrender.')).toBeTruthy();
  });
});

describe('SurrenderOfferBanner in the strip (overlay_queue_enabled)', () => {
  it('sits in the strip above the bottom bar, and leaves "Play on" to the parent', () => {
    const onPlayOn = vi.fn();
    const { rerender } = render(
      <SurrenderOfferBanner offered turnNumber={12} onAccept={() => {}} placement="strip" playedOnTurn={null} onPlayOn={onPlayOn} />,
    );
    const banner = screen.getByTestId('surrender-offer');
    expect(banner.dataset.placement).toBe('strip');
    expect(banner.className).toContain('bottom-2');
    expect(banner.className).not.toContain('top-');
    fireEvent.click(screen.getByRole('button', { name: 'Play on' }));
    expect(onPlayOn).toHaveBeenCalledWith(12);
    rerender(<SurrenderOfferBanner offered turnNumber={12} onAccept={() => {}} placement="strip" playedOnTurn={12} onPlayOn={onPlayOn} />);
    expect(screen.queryByTestId('surrender-offer')).toBeNull();
  });
});
