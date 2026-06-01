import React from 'react';
import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import { APP_NAME, LEGAL_LAST_UPDATED, SUPPORT_EMAIL } from '../constants/brand';

export default function TermsPage() {
  return (
    <SubpageShell
      title="TERMS OF SERVICE"
      icon={Scale}
      maxWidth="2xl"
      headerLeft={<BrandWordmark to="/lobby" className="text-xl" />}
      contentClassName="space-y-6 pb-safe"
    >
      <article className="text-bf-text space-y-6">
        <h1 className="font-display text-3xl text-bf-gold">Terms of Service</h1>
        <p className="text-bf-muted text-sm">Last updated: {LEGAL_LAST_UPDATED}</p>
        <p className="text-sm text-bf-muted leading-relaxed">
          These Terms govern your use of {APP_NAME} websites, games, and related services (the &ldquo;Service&rdquo;).
          By creating an account or playing, you agree to these Terms and our{' '}
          <Link to="/privacy" className="text-bf-gold hover:underline">Privacy Policy</Link>.
        </p>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Eligibility</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            You must be at least 13 years old to register. The Service is not directed at children under 13.
            If you are under the age required in your jurisdiction, do not use the Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Your account</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            You are responsible for activity on your account and for keeping your credentials secure.
            Choose a unique username and do not impersonate others. You may delete your account from your profile;
            we may suspend or terminate accounts that violate these Terms or harm other players.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Acceptable use</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            Play fairly. Do not cheat, exploit bugs for advantage, automate gameplay, harass other players,
            upload unlawful content to community maps or chat, or attempt to disrupt servers or other users&apos;
            sessions. Report map or player issues through in-app tools where available.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Virtual items and gold</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            {APP_NAME} may award in-game gold, cosmetics, and other virtual items through gameplay.
            These have no real-world cash value, are not transferable outside the Service, and may be adjusted
            or reset for balance, moderation, or maintenance. At launch, the Service does not sell real-money
            purchases; if that changes, we will update these Terms and applicable store policies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">User content</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            Custom maps and other content you publish remain yours, but you grant us a license to host, display,
            and distribute that content as needed to operate the Service. Do not publish content you do not have
            rights to use.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Service availability</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            We provide the Service on an &ldquo;as is&rdquo; basis. Maintenance, updates, or outages may interrupt
            play. Live multiplayer sessions may be affected by server restarts; we use snapshots and reconnect
            logic where possible but do not guarantee uninterrupted real-time play.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Limitation of liability</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            To the fullest extent permitted by law, we are not liable for indirect or consequential damages arising
            from your use of the Service. Our total liability for any claim related to the Service is limited to
            the amount you paid us in the twelve months before the claim (which may be zero for free play).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Changes</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            We may update these Terms. Material changes will be reflected by updating the date above.
            Continued use after changes constitutes acceptance.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Contact</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            Questions about these Terms:{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-bf-gold hover:underline">{SUPPORT_EMAIL}</a>
          </p>
        </section>

        <p className="text-xs text-bf-muted pt-4 border-t border-bf-border">
          Have legal counsel review these Terms before a wide public launch or store submission in regulated markets.
        </p>
      </article>
    </SubpageShell>
  );
}
