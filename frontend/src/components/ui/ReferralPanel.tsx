import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Share2, Copy, Users, Coins, CheckCircle } from 'lucide-react';
import { api } from '../../services/api';
import toast from 'react-hot-toast';

interface ReferralData {
  referral_code: string;
  total_referrals: number;
  completed_referrals: number;
  total_gold_earned: number;
  referrals: Array<{
    referee_username: string;
    status: string;
    created_at: string;
    completed_at: string | null;
  }>;
}

interface ReferralPanelProps {
  className?: string;
}

export default function ReferralPanel({ className }: ReferralPanelProps) {
  const [data, setData] = useState<ReferralData | null>(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    api.get('/progression/referral')
      .then((res) => setData(res.data))
      .catch(() => {});
  }, []);

  const copyCode = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.referral_code).then(() => {
      toast.success('Referral code copied!');
    }).catch(() => {});
  };

  const shareLink = () => {
    if (!data) return;
    const url = `${window.location.origin}?ref=${data.referral_code}`;
    if (navigator.share) {
      navigator.share({
        title: 'Join Eras of Empire!',
        text: `Play Eras of Empire with me! Use my referral code: ${data.referral_code}`,
        url,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        toast.success('Referral link copied!');
      }).catch(() => {});
    }
  };

  const handleRedeem = async () => {
    if (!redeemCode.trim() || redeeming) return;
    setRedeeming(true);
    try {
      await api.post('/progression/referral/redeem', { code: redeemCode.trim() });
      toast.success('Referral code redeemed! You received 25 gold.');
      setRedeemCode('');
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Failed to redeem code');
    } finally {
      setRedeeming(false);
    }
  };

  if (!data) return null;

  return (
    <div className={clsx('rounded-xl bg-cc-surface border border-cc-border p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Users size={16} className="text-cc-gold" />
        <span className="font-display text-sm text-cc-gold">Refer a Friend</span>
      </div>

      {/* Your code */}
      <div className="rounded-lg bg-cc-dark border border-cc-border p-3 mb-3">
        <p className="text-[10px] text-cc-muted uppercase tracking-wider mb-1">Your Code</p>
        <div className="flex items-center gap-2">
          <code className="text-lg font-mono font-bold text-cc-gold tracking-widest flex-1">
            {data.referral_code}
          </code>
          <button
            onClick={copyCode}
            className="p-1.5 rounded-md hover:bg-cc-border/50 text-cc-muted hover:text-cc-text transition-colors"
            title="Copy code"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={shareLink}
            className="p-1.5 rounded-md hover:bg-cc-border/50 text-cc-muted hover:text-cc-text transition-colors"
            title="Share link"
          >
            <Share2 size={14} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center rounded-md bg-cc-dark/50 border border-cc-border p-2">
          <p className="text-lg font-display text-cc-text">{data.total_referrals}</p>
          <p className="text-[10px] text-cc-muted">Referred</p>
        </div>
        <div className="text-center rounded-md bg-cc-dark/50 border border-cc-border p-2">
          <p className="text-lg font-display text-cc-text">{data.completed_referrals}</p>
          <p className="text-[10px] text-cc-muted">Completed</p>
        </div>
        <div className="text-center rounded-md bg-cc-dark/50 border border-cc-border p-2">
          <p className="text-lg font-display text-cc-gold">{data.total_gold_earned}</p>
          <p className="text-[10px] text-cc-muted">Gold Earned</p>
        </div>
      </div>

      {/* Referral list */}
      {data.referrals.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] text-cc-muted uppercase tracking-wider mb-1">Your Referrals</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {data.referrals.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs rounded-md bg-cc-dark/30 px-2 py-1.5">
                <span className="text-cc-text">{r.referee_username}</span>
                <span className={clsx(
                  'flex items-center gap-1',
                  r.status === 'completed' ? 'text-green-400' : 'text-cc-muted',
                )}>
                  {r.status === 'completed' && <CheckCircle size={10} />}
                  {r.status === 'completed' ? 'Completed' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Redeem a code */}
      <div className="pt-3 border-t border-cc-border">
        <p className="text-[10px] text-cc-muted uppercase tracking-wider mb-1">Have a Code?</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
            placeholder="Enter code"
            maxLength={16}
            className="flex-1 bg-cc-dark border border-cc-border rounded-md px-3 py-1.5 text-sm text-cc-text placeholder:text-cc-muted/50 focus:outline-none focus:border-cc-gold/50"
          />
          <button
            onClick={handleRedeem}
            disabled={!redeemCode.trim() || redeeming}
            className="px-3 py-1.5 rounded-md bg-cc-gold/20 border border-cc-gold/30 text-cc-gold text-sm font-medium hover:bg-cc-gold/30 transition-colors disabled:opacity-50"
          >
            {redeeming ? '...' : 'Redeem'}
          </button>
        </div>
        <p className="text-[10px] text-cc-muted mt-1">
          <Coins size={10} className="inline" /> You get 25 gold · Your friend gets 50 gold after 3 games
        </p>
      </div>
    </div>
  );
}
