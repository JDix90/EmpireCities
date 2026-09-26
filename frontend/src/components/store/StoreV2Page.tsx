import React, { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Coins, ShoppingBag, X } from 'lucide-react';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import SubpageShell from '../ui/SubpageShell';
import Modal from '../ui/Modal';
import GuestGate from '../GuestGate';
import CosmeticPreview from '../cosmetics/CosmeticPreview';
import {
  markStoreRefundsSeen,
  storeRefundNoticeText,
  unseenStoreRefunds,
  type StoreRefund,
} from '../../utils/storeRefundNotice';
import LoadoutPanel from './LoadoutPanel';
import StoreItemCard from './StoreItemCard';
import {
  SLOT_BY_TYPE,
  SLOT_KEY,
  SLOT_LABELS,
  TYPE_FILTERS,
  catalogSections,
  itemAction,
  loadoutOf,
  type CatalogItem,
  type Loadout,
  type Slot,
  type TypeFilter,
} from './storeCatalog';

const GUEST_BUY = 'Spending gold needs a free account — your balance carries over.';
const GUEST_EQUIP = 'Equipping needs a free account — your unlocks carry over.';

/**
 * The store with store_v2_enabled on: every item previewed as worn, rarity
 * and price on every card, how much more gold an item needs, equipping right
 * after a purchase, and the loadout (with Default) above the catalog. Guests
 * browse everything; buying and equipping stay server-side `rejectGuest`.
 */
export default function StoreV2Page() {
  const { user } = useAuthStore();
  const isGuest = Boolean(user?.is_guest);
  const initial = user?.username ?? '?';

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refunds, setRefunds] = useState<StoreRefund[]>([]);
  const [refundsDismissed, setRefundsDismissed] = useState(false);
  const [gold, setGold] = useState<number>(user?.gold ?? 0);
  const [worn, setWorn] = useState<Loadout>(() => loadoutOf(user));
  const [filter, setFilter] = useState<TypeFilter>('all');
  /** The item a request is in flight for (buy or equip). */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The slot a loadout change is in flight for. */
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);
  /** The purchase dialog: confirming, then the item just bought. */
  const [dialog, setDialog] = useState<{ item: CatalogItem; bought: boolean } | null>(null);

  const syncUser = useCallback((patch: Record<string, unknown>) => {
    const current = useAuthStore.getState().user;
    if (current) useAuthStore.getState().setUser({ ...current, ...patch });
  }, []);

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await api.get('/store/catalog');
      setCatalog(Array.isArray(res.data?.catalog) ? res.data.catalog : []);
      setRefunds(Array.isArray(res.data?.refunds) ? res.data.refunds : []);
    } catch {
      toast.error('Failed to load the store');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMe = useCallback(async () => {
    try {
      const res = await api.get('/users/me');
      const newGold = res.data?.gold ?? 0;
      setGold(newGold);
      setWorn(loadoutOf(res.data));
      syncUser({ gold: newGold });
    } catch {
      // Non-critical: the auth store's copy stands.
    }
  }, [syncUser]);

  useEffect(() => {
    void fetchCatalog();
    void fetchMe();
  }, [fetchCatalog, fetchMe]);

  const applyLoadout = (next: Loadout) => {
    setWorn(next);
    syncUser({
      equipped_frame: next.frame,
      equipped_banner: next.banner,
      equipped_marker: next.marker,
      equipped_dice: next.dice,
    });
  };

  /** Put `item` in its slot, or empty `slot` (Default) when `item` is null. */
  const setSlot = async (slot: Slot, item: CatalogItem | null) => {
    if (isGuest) {
      toast(GUEST_EQUIP, { icon: '🪙' });
      return;
    }
    setPendingSlot(slot);
    if (item) setBusyId(item.cosmetic_id);
    try {
      const res = await api.put('/users/me/cosmetics/equip', { [SLOT_KEY[slot]]: item?.cosmetic_id ?? null });
      const next = (res.data as { equipped?: Loadout } | undefined)?.equipped;
      if (!next) throw new Error('The server did not say what is equipped');
      applyLoadout(next);
      toast.success(item ? `${item.name} equipped` : `${SLOT_LABELS[slot]} back to default`);
    } catch {
      toast.error(item ? 'Failed to equip item' : 'Failed to change your loadout');
    } finally {
      setPendingSlot(null);
      setBusyId(null);
    }
  };

  const equipItem = (item: CatalogItem) => {
    const slot = SLOT_BY_TYPE[item.type];
    if (slot) void setSlot(slot, item);
  };

  const requestBuy = (item: CatalogItem) => {
    if (busyId) return;
    // Answer before the dialog, so a guest isn't walked into a refusal.
    if (isGuest) {
      toast(GUEST_BUY, { icon: '🪙' });
      return;
    }
    setDialog({ item, bought: false });
  };

  const buy = async (item: CatalogItem) => {
    if (busyId) return;
    setBusyId(item.cosmetic_id);
    try {
      const res = await api.post('/store/buy', { cosmetic_id: item.cosmetic_id });
      const balance = res.data?.new_balance;
      if (typeof balance === 'number') {
        setGold(balance);
        syncUser({ gold: balance });
      } else {
        void fetchMe();
      }
      setCatalog((prev) => prev.map((c) => (c.cosmetic_id === item.cosmetic_id ? { ...c, owned: true, locked: false } : c)));
      setDialog({ item: { ...item, owned: true }, bought: true });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: { error?: string; balance?: number } } })?.response?.data;
      if (status === 402 && typeof data?.balance === 'number') {
        // The server's balance is authoritative: show why Buy failed.
        setGold(data.balance);
        syncUser({ gold: data.balance });
      } else if (status === 409) {
        void fetchCatalog();
      } else {
        // A failed response may still have committed; resync.
        void fetchMe();
      }
      setDialog(null);
      toast.error(data?.error ?? 'Purchase failed');
    } finally {
      setBusyId(null);
    }
  };

  const userId = user?.user_id;
  const shownRefunds = useMemo(() => {
    if (!userId || refundsDismissed) return [];
    try {
      return unseenStoreRefunds(refunds, window.localStorage, userId);
    } catch {
      return refunds; // storage blocked outright: nothing was remembered
    }
  }, [refunds, refundsDismissed, userId]);

  const dismissRefunds = () => {
    if (userId) {
      try {
        markStoreRefundsSeen(shownRefunds, window.localStorage, userId);
      } catch {
        // storage blocked outright: hidden for this visit only
      }
    }
    setRefundsDismissed(true);
  };

  const owned = useMemo(() => catalog.filter((i) => i.owned && SLOT_BY_TYPE[i.type]), [catalog]);
  const sections = useMemo(() => catalogSections(catalog, filter), [catalog, filter]);
  const dialogItem = dialog?.item;

  return (
    <SubpageShell
      title="STORE"
      icon={ShoppingBag}
      maxWidth="5xl"
      headerRight={(
        <div className="flex items-center gap-1.5 rounded-full border border-bf-gold/30 bg-bf-gold/10 px-3 py-1.5 text-sm font-medium text-bf-gold">
          <Coins className="h-4 w-4" aria-hidden />
          <span className="tabular-nums">{gold.toLocaleString()}</span>
          <span className="sr-only">gold</span>
        </div>
      )}
    >
      {isGuest && (
        <GuestGate
          className="mb-6"
          icon={Coins}
          title={gold > 0 ? `You have ${gold.toLocaleString()} gold banked` : 'Gold you earn is being saved'}
          description="Guest accounts earn gold but can't spend or equip it. Create a free account and the balance — and everything else you've earned — comes with you."
        />
      )}

      {shownRefunds.length > 0 && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-lg border border-bf-gold/30 bg-bf-gold/5 px-3 py-2 text-sm text-bf-text"
        >
          <Coins className="mt-0.5 h-4 w-4 shrink-0 text-bf-gold" aria-hidden />
          <p className="flex-1 py-0.5">{storeRefundNoticeText(shownRefunds)}</p>
          <button
            type="button"
            onClick={dismissRefunds}
            aria-label="Dismiss refund notice"
            className="-my-2 -mr-3 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-bf-muted hover:text-bf-text"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {!isGuest && (
        <LoadoutPanel worn={worn} owned={owned} initial={initial} pending={pendingSlot} onPick={(slot, item) => void setSlot(slot, item)} />
      )}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Show">
        {TYPE_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={clsx(
              'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors sm:min-h-0 sm:py-1.5',
              filter === key
                ? 'border-bf-gold/50 bg-bf-gold/20 text-bf-gold'
                : 'border-bf-border text-bf-muted hover:border-bf-muted hover:text-bf-text',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-bf-muted">Loading store…</div>
      ) : sections.length === 0 ? (
        <div className="py-16 text-center text-bf-muted">No items here yet.</div>
      ) : (
        sections.map((section) => (
          <section key={section.id} aria-labelledby={`store-section-${section.id}`} className="mb-8">
            <h2 id={`store-section-${section.id}`} className="font-display text-lg text-bf-gold">{section.title}</h2>
            <p className="mb-3 text-xs text-bf-muted">{section.subtitle}</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {section.items.map((item) => (
                <StoreItemCard
                  key={item.cosmetic_id}
                  item={item}
                  action={itemAction(item, { gold, worn })}
                  initial={initial}
                  busy={busyId === item.cosmetic_id}
                  onBuy={() => requestBuy(item)}
                  onEquip={() => equipItem(item)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {/* Purchase: confirm, then offer to wear it straight away. */}
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.bought ? 'Purchase complete' : 'Confirm purchase'}
        className="max-w-sm"
      >
        {dialogItem && (
          <div className="space-y-4">
            <CosmeticPreview cosmeticId={dialogItem.cosmetic_id} type={dialogItem.type} initial={initial} />
            {dialog?.bought ? (
              <>
                <p className="text-sm text-bf-text">
                  <span className="font-medium text-bf-gold">{dialogItem.name}</span> is yours.
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary min-h-11 px-4 text-sm" onClick={() => setDialog(null)}>
                    Done
                  </button>
                  {SLOT_BY_TYPE[dialogItem.type] && (
                    <button
                      type="button"
                      className="btn-primary min-h-11 px-4 text-sm disabled:opacity-60"
                      disabled={!!busyId}
                      onClick={() => {
                        setDialog(null);
                        equipItem(dialogItem);
                      }}
                    >
                      Equip now
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-bf-text">
                  Buy <span className="font-medium text-bf-gold">{dialogItem.name}</span> for{' '}
                  <span className="font-medium tabular-nums text-bf-gold">{dialogItem.price_gems.toLocaleString()} gold</span>?
                </p>
                <p className="text-xs text-bf-muted">
                  Balance after purchase:{' '}
                  <span className="tabular-nums">{Math.max(0, gold - dialogItem.price_gems).toLocaleString()} gold</span>
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary min-h-11 px-4 text-sm" onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary min-h-11 px-4 text-sm disabled:opacity-60"
                    disabled={!!busyId}
                    onClick={() => void buy(dialogItem)}
                  >
                    {busyId ? 'Buying…' : 'Buy'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </SubpageShell>
  );
}
