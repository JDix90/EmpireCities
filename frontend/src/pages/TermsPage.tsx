import React from 'react';
import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import { APP_NAME, LEGAL_LAST_UPDATED, SUPPORT_EMAIL } from '../constants/brand';
import { useChatSafetyEnabled } from '../store/featureFlagsStore';

export default function TermsPage() {
  // How to report and block depends on chat_safety_enabled, as on the Privacy
  // Policy: with it off there is no ⋯ menu in chat, so reports go by email.
  const chatSafety = useChatSafetyEnabled();
  return (
    <SubpageShell
      titleAs="div"
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
          These Terms govern your use of {APP_NAME} websites, games, and related services (the &ldquo;Service&rdquo;),
          operated by the Borderfall operator. By creating an account or playing, you agree to these Terms and our{' '}
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
            Play fairly. Do not cheat, exploit bugs for advantage, automate gameplay, or attempt to disrupt servers
            or other users&apos; sessions.
          </p>
        </section>

        {/* The App Store requires an app with chat to say there is no tolerance
            for objectionable content or abusive users, and that reports are acted on. */}
        <section className="space-y-3" data-testid="terms-conduct">
          <h2 className="font-display text-lg text-bf-gold">Chat, player content and reports</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            There is no tolerance for objectionable content or abusive players on {APP_NAME}. Do not post or share
            anything hateful, harassing, threatening, sexually explicit, graphically violent, or otherwise
            objectionable, whether in chat, in your username, in a custom map, or anywhere else in the Service.
            Do not bully, abuse, or impersonate other players.
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            Chat is filtered for offensive language, and community maps are reviewed before they are published,
            but filters can miss things.{' '}
            {chatSafety ? (
              <>
                If you see something objectionable, report it: tap &#8943; beside a chat message and choose Report
                message, or email us at{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-bf-gold hover:underline">{SUPPORT_EMAIL}</a>.
                You can also block a player from the same menu, so their chat no longer reaches you; Settings lists
                the players you have blocked.
              </>
            ) : (
              <>
                If you see something objectionable, report it by emailing us at{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-bf-gold hover:underline">{SUPPORT_EMAIL}</a>{' '}
                with the player&apos;s name and what they posted.
              </>
            )}
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            We review every report within 24 hours. When content breaks these rules, we remove it and act against
            the player who posted it, from a warning to a permanent ban of their account, without notice where the
            case is serious.
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
            play. Game state is persisted so that sessions can survive server restarts, and clients reconnect and
            resynchronize automatically where possible — but we do not guarantee uninterrupted real-time play.
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

        {/* Chosen by the operator: Colorado law, and binding individual arbitration
            rather than court, with a small-claims exception, a 30-day opt-out and a
            carve-out where local consumer law forbids it. */}
        <section className="space-y-3" data-testid="terms-disputes">
          <h2 className="font-display text-lg text-bf-gold">Governing law and disputes</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            These Terms are governed by the laws of the State of Colorado, USA, without regard to its
            conflict-of-law rules. The Federal Arbitration Act governs the agreement to arbitrate below.
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            <strong className="text-bf-text">Talk to us first.</strong> Before starting a formal dispute, email us at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-bf-gold hover:underline">{SUPPORT_EMAIL}</a>{' '}
            with what went wrong and what you would like us to do. We will try to resolve it with you within 30 days.
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            <strong className="text-bf-text">Binding individual arbitration.</strong> If we cannot resolve it, any
            dispute arising out of or relating to these Terms or the Service will be settled by binding arbitration
            administered by the American Arbitration Association under its Consumer Arbitration Rules, instead of in
            court. The arbitration may be held by video, by phone or on written submissions; any in-person hearing
            will be in Colorado or in the county where you live, as you choose. Either of us may instead bring an
            individual claim in small claims court, or ask a court to stop the infringement or misuse of
            intellectual property.
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            <strong className="text-bf-text">No class actions.</strong> You and we each bring claims only
            individually, and not as a plaintiff or class member in any class, collective or representative
            proceeding. If this waiver is found unenforceable for a claim, that claim will be decided by the state or
            federal courts located in Colorado, not in arbitration.
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            <strong className="text-bf-text">Opting out.</strong> You may opt out of arbitration by emailing{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-bf-gold hover:underline">{SUPPORT_EMAIL}</a>{' '}
            with the subject &ldquo;Arbitration opt-out&rdquo; within 30 days of first accepting these Terms (if you
            joined before November 21, 2026, within 30 days of that date). Your disputes then go to the state or
            federal courts located in Colorado.
          </p>
          <p className="text-sm text-bf-muted leading-relaxed">
            If you live in the European Economic Area, the United Kingdom, or anywhere else whose law does not allow
            these provisions for consumers, this section applies only as far as that law permits, and you keep the
            protections of the law where you live.
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
      </article>
    </SubpageShell>
  );
}
