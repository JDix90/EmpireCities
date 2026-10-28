import React from 'react';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import { APP_NAME, PRIVACY_LAST_UPDATED, SUPPORT_EMAIL } from '../constants/brand';

export default function PrivacyPage() {
  return (
    <SubpageShell
      titleAs="div"
      title="PRIVACY POLICY"
      icon={Shield}
      maxWidth="2xl"
      headerLeft={<BrandWordmark to="/lobby" className="text-xl" />}
      contentClassName="space-y-6 pb-safe"
    >
      <article className="text-bf-text space-y-6">
        <h1 className="font-display text-3xl text-bf-gold">Privacy Policy</h1>
        <p className="text-bf-muted text-sm">Last updated: {PRIVACY_LAST_UPDATED}</p>
        <p className="text-sm text-bf-muted leading-relaxed">
          This policy describes how {APP_NAME} collects and uses information when you use our websites,
          games, and related services. See also our{' '}
          <Link to="/terms" className="text-bf-gold hover:underline">Terms of Service</Link>.
        </p>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">What we collect</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            When you create or save an account, we store your email address, your username and, if you set one, a
            secure hash of your password.
            We also store game-related data (matches, stats, ratings, and saved game state) tied to your account so you can
            resume play and view your history, along with sign-in timestamps. If you enable push notifications, we store
            a device token to deliver alerts. Like most online services, our servers also process technical data needed to
            operate and secure the Service: IP addresses, browser type, and diagnostic logs (including for rate limiting
            and abuse prevention).
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            <span className="text-bf-text">Guest accounts:</span> playing as a guest creates an account with no email
            address or password. A cookie in your browser keeps you signed in to it for up to 30 days after your last
            visit; without that cookie there is no way back into it. Guest accounts that never play a game are deleted
            automatically within about 48 hours. Saving your account adds your email address (and a password, if you
            choose one) to the same account, so your progress is kept.
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            <span className="text-bf-text">In-game chat is ephemeral:</span> chat messages are delivered to players
            in your game and are not stored on our servers.
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            <span className="text-bf-text">Feedback:</span> if you send us feedback from inside a game, we store what
            you wrote and your rating with your account, along with the game, the turn, your device type (phone, tablet
            or desktop) and your screen size, so we can see what you saw. Deleting your account deletes it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">How we use it</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            Data is used to operate the game, authenticate you (including by emailing you a one-time sign-in link when
            you ask for one), compute rankings and statistics, deliver optional notifications (async turns, invites),
            understand how the game is used from usage records we keep ourselves, and improve stability. We do not
            sell your personal information.
            Error reports may be sent to our monitoring provider (e.g. Sentry) when configured.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Service providers and content delivery</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            Some features rely on third parties that receive limited data as part of how the web works:
            map graphics and fonts are loaded from content delivery networks (jsDelivr, Google Fonts), which see
            your IP address when your browser fetches them; GIF search in chat sends your search terms to Tenor;
            push notifications are delivered through Firebase Cloud Messaging; and transactional email (password
            resets, sign-in links, and the email confirming your account is saved) is sent through our email
            provider. These providers process data only to deliver
            their function — none of them receive your account credentials.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Cookies and tokens</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            We use an HTTP-only cookie to keep you signed in, for up to 30 days after your last visit, and store an
            access token in the app for API requests.
            Mobile apps using the same backend follow the same model.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Your choices</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            Registered users may delete their account from the profile page while logged in. That removes your user
            record and revokes sessions; some anonymized game rows may remain for integrity of historical matches.
            Guest accounts have no self-service deletion: guests who never played are removed automatically as
            described above, and guests with game history can contact us to request removal.
            Registered users may also export their data via the profile/API where enabled.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Children</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            The Service is not directed at children under 13. We do not knowingly collect personal information from
            children under 13. Contact us if you believe a child has provided personal data.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Contact</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            Privacy questions:{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-bf-gold hover:underline">{SUPPORT_EMAIL}</a>
          </p>
        </section>
      </article>
    </SubpageShell>
  );
}
