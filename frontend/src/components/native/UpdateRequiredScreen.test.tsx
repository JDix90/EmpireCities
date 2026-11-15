import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const checkNativeAppVersion = vi.fn();
vi.mock('../../services/nativeAppVersion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/nativeAppVersion')>()),
  checkNativeAppVersion: () => checkNativeAppVersion(),
}));

import UpdateRequiredScreen from './UpdateRequiredScreen';

beforeEach(() => {
  checkNativeAppVersion.mockReset().mockResolvedValue(undefined);
});

describe('UpdateRequiredScreen', () => {
  it('says why, says the account is safe, and links to the App Store listing', () => {
    render(<UpdateRequiredScreen info={{ platform: 'ios', minVersion: '1.2.0', storeUrl: 'https://apps.apple.com/app/id0000000000' }} />);
    expect(screen.getByRole('alertdialog', { name: 'Update required' })).toBeInTheDocument();
    expect(screen.getByText(/no longer supported/)).toBeInTheDocument();
    expect(screen.getByText(/your account,\s+games and progress are safe/)).toBeInTheDocument();
    const link = screen.getByTestId('update-required-store');
    expect(link).toHaveTextContent('Update in the App Store');
    // The scheme that opens the store app itself, not a web page about it.
    expect(link).toHaveAttribute('href', 'itms-apps://apps.apple.com/app/id0000000000');
    expect(screen.getByText('Version 1.2.0 or later is needed.')).toBeInTheDocument();
  });

  it('names Google Play on Android', () => {
    render(<UpdateRequiredScreen info={{ platform: 'android', minVersion: '2.0.0', storeUrl: 'https://play.google.com/store/apps/details?id=com.borderfall.app' }} />);
    expect(screen.getByTestId('update-required-store')).toHaveTextContent('Update in Google Play');
    expect(screen.getByTestId('update-required-store')).toHaveAttribute('href', 'market://details?id=com.borderfall.app');
  });

  it('still tells the player what to do when no store link is configured', () => {
    render(<UpdateRequiredScreen info={{ platform: 'ios', minVersion: '1.2.0', storeUrl: '' }} />);
    expect(screen.queryByTestId('update-required-store')).toBeNull();
    expect(screen.getByTestId('update-required-no-link')).toHaveTextContent('Open the App Store and update Borderfall.');
  });

  it('Check again asks the server once more', async () => {
    render(<UpdateRequiredScreen info={{ platform: 'ios', minVersion: '1.2.0', storeUrl: '' }} />);
    fireEvent.click(screen.getByTestId('update-required-recheck'));
    expect(screen.getByTestId('update-required-recheck')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('update-required-recheck')).toBeEnabled());
    expect(checkNativeAppVersion).toHaveBeenCalledTimes(1);
  });
});
