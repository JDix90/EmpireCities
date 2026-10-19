import { useState } from 'react';
import { Gift } from 'lucide-react';
import { usePlayerLinksPlayEnabled } from '../../store/featureFlagsStore';
import { getPendingReferral } from '../../utils/pendingReferral';

/**
 * On the save-account and register pages: a friend's referral link is waiting
 * to apply (utils/pendingReferral.ts), so saying what the account adds tells
 * the player why to finish. Shown only with `player_links_play_enabled`, which
 * is also what redeems the code.
 */
export default function ReferralGoldNote({ action }: { action: 'save' | 'create' }) {
  const enabled = usePlayerLinksPlayEnabled();
  // Read once: the code only goes away when this page's own save redeems it.
  const [waiting] = useState(() => getPendingReferral() !== null);
  if (!enabled || !waiting) return null;
  return (
    <div className="mb-5 rounded-lg border border-bf-gold/30 bg-bf-gold/10 px-3 py-2.5 text-sm text-bf-text flex items-start gap-2">
      <Gift className="w-4 h-4 text-bf-gold shrink-0 mt-0.5" aria-hidden />
      {/* One text node before the gold: a page translated in the browser rewraps text nodes. */}
      <span>
        {`A friend invited you. ${action === 'save' ? 'Save' : 'Create'} your account to get `}
        <span className="text-bf-gold font-medium">25 gold</span>.
      </span>
    </div>
  );
}
