import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import clsx from 'clsx';

/**
 * "By playing, you agree to our Terms of Service and Privacy Policy." under
 * every button that starts a new player as a guest: the app's home screen,
 * the landing page, its Get Started dialog, an invite, a replay's Play free,
 * and the tutorial's lessons. A guest is made by that tap, with no form to
 * agree on, and the App Store expects players of an app with chat to agree to
 * terms that rule out objectionable content. Callers show it only to someone
 * not yet signed in: an account agreed when it was made.
 */
export default function PlayTermsNotice({ className }: { className?: string }) {
  const link = 'text-bf-gold/90 hover:text-bf-gold underline underline-offset-2';
  return (
    <p className={clsx('text-xs text-bf-muted', className)} data-testid="play-terms-notice">
      <Trans
        ns="common"
        i18nKey="playTerms"
        components={{
          terms: <Link to="/terms" className={link} />,
          privacy: <Link to="/privacy" className={link} />,
        }}
      />
    </p>
  );
}
