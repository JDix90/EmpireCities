/**
 * The map's stand-in when WebGL is missing: the website's wording is
 * unchanged, and the native app never tells a player to change browser.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Capacitor } from '@capacitor/core';
import MapUnavailable from './MapUnavailable';

afterEach(() => vi.restoreAllMocks());

describe('MapUnavailable', () => {
  it('on the website, names the browser and how to fix it there', () => {
    render(<MapUnavailable />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("This browser can't draw the map");
    expect(alert).toHaveTextContent("Turn on hardware acceleration in your browser's settings, restart the browser and reload this page, or try another browser.");
  });

  it('in the app, names the device and never mentions a browser', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    render(<MapUnavailable />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("This device can't draw the map");
    expect(alert).toHaveTextContent(/Close Borderfall completely and open it again/);
    expect(alert.textContent).not.toMatch(/browser|reload|WebGL/i);
  });
});
