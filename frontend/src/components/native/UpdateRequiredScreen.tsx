import React, { useState } from 'react';
import { APP_NAME, APP_NAME_NAV } from '../../constants/brand';
import { checkNativeAppVersion, storeDeepLink, type UpdateRequiredInfo } from '../../services/nativeAppVersion';

/**
 * What the native app shows when the server no longer serves its build
 * (services/nativeAppVersion.ts): nothing of the game, the reason, and the way
 * to the update. It replaces the whole app, because every request this build
 * makes is being refused.
 *
 * "Check again" asks the server once more, so a player is not left here until
 * they restart the app if the minimum was set too high and has been lowered.
 */
export default function UpdateRequiredScreen({ info }: { info: UpdateRequiredInfo }) {
  const [checking, setChecking] = useState(false);
  const storeLink = storeDeepLink(info.storeUrl);
  const storeName = info.platform === 'android' ? 'Google Play' : 'the App Store';

  const checkAgain = async () => {
    setChecking(true);
    try {
      await checkNativeAppVersion();
    } finally {
      setChecking(false);
    }
  };

  return (
    <main
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
      className="fixed inset-0 z-[200] bg-bf-dark flex flex-col items-center justify-center px-6 pt-safe-6 pb-safe-6 text-center"
      data-testid="update-required"
    >
      <p className="font-display text-2xl text-bf-gold tracking-widest">{APP_NAME_NAV}</p>
      <h1 id="update-required-title" className="mt-8 font-display text-2xl text-bf-text">Update required</h1>
      <p className="mt-3 max-w-sm text-sm text-bf-muted leading-relaxed">
        This version of {APP_NAME} is no longer supported. Update the app to keep playing: your account,
        games and progress are safe and will be there when you come back.
      </p>

      <div className="mt-8 w-full max-w-xs space-y-3">
        {storeLink ? (
          <a
            href={storeLink}
            className="btn-primary w-full py-3 text-base inline-flex items-center justify-center"
            data-testid="update-required-store"
          >
            Update in {storeName}
          </a>
        ) : (
          <p className="text-sm text-bf-text" data-testid="update-required-no-link">
            Open {storeName} and update {APP_NAME}.
          </p>
        )}
        <button
          type="button"
          className="btn-secondary w-full py-3 text-base"
          onClick={() => void checkAgain()}
          disabled={checking}
          data-testid="update-required-recheck"
        >
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {info.minVersion && (
        <p className="mt-8 text-xs text-bf-muted">Version {info.minVersion} or later is needed.</p>
      )}
    </main>
  );
}
