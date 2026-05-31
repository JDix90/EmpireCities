import React from 'react';
import { Shield } from 'lucide-react';
import BrandWordmark from '../components/ui/BrandWordmark';
import SubpageShell from '../components/ui/SubpageShell';
import { APP_NAME } from '../constants/brand';

export default function PrivacyPage() {
  return (
    <SubpageShell
      title="PRIVACY POLICY"
      icon={Shield}
      maxWidth="2xl"
      headerLeft={<BrandWordmark to="/lobby" className="text-xl" />}
      contentClassName="space-y-6 pb-safe"
    >
      <article className="text-bf-text space-y-6">
        <h1 className="font-display text-3xl text-bf-gold">Privacy Policy</h1>
        <p className="text-bf-muted text-sm">Last updated: March 31, 2026</p>
        <p className="text-sm text-bf-muted leading-relaxed">
          This policy describes how {APP_NAME} collects and uses information when you use our websites,
          games, and related services.
        </p>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">What we collect</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            When you create an account, we store your email address, username, and a secure hash of your password.
            We also store game-related data (matches, stats, and saved game state) tied to your account so you can
            resume play and view your history.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">How we use it</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            Data is used to operate the game, authenticate you, compute rankings and statistics, and improve stability.
            We do not sell your personal information.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Cookies and tokens</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            We use HTTP-only cookies for session refresh and store an access token in the app for API requests.
            Mobile apps using the same backend follow the same model.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Your choices</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            You may delete your account from your profile while logged in. That removes your user record and revokes
            sessions; some anonymized game rows may remain for integrity of historical matches.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-display text-lg text-bf-gold">Contact</h2>
          <p className="text-sm text-bf-muted leading-relaxed">
            For privacy questions, contact the operator of the deployment you are using (self-hosted instances should
            list their own contact in the app or store listing).
          </p>
        </section>

        <p className="text-xs text-bf-muted pt-4">
          This is a template suitable for development and early release. Have legal counsel review before a wide public launch.
        </p>
      </article>
    </SubpageShell>
  );
}
