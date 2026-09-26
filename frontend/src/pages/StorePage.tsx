import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Coins, ShoppingBag, X } from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import SubpageShell from '../components/ui/SubpageShell';
import GuestGate from '../components/GuestGate';
import { useCosmeticMotion } from '../components/cosmetics/useCosmetics';
import {
  markStoreRefundsSeen,
  storeRefundNoticeText,
  unseenStoreRefunds,
  type StoreRefund,
} from '../utils/storeRefundNotice';
import EarnedWall from '../components/store/EarnedWall';
import PurchaseDialog, { type PurchaseState } from '../components/store/PurchaseDialog';
import SetBand, { STORE_BAND_CARD } from '../components/store/SetBand';
import StoreItemCard from '../components/store/StoreItemCard';
import TryOnBar from '../components/store/TryOnBar';
import YourLook from '../components/store/YourLook';
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
} from '../components/store/storeCatalog';

const GUEST_BUY = 'Spending gold needs a free account — your balance carries over.';
const GUEST_EQUIP = 'Wearing items needs a free account — your unlocks carry over.';

/** Whether `ref`'s element is on screen. False where IntersectionObserver is missing. */
function useOnScreen(ref: React.RefObject<Element>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), { threshold: 0.3 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

/**
 * The store: every item shown large and lit by its rarity, the era sets on
 * their own backdrops with how much of each the player has, and Your look,
 * where anything can be tried on before it is bought or worn. Guests browse
 * everything; buying and wearing stay server-side `rejectGuest`.
 */
export default function StorePage() {
  const { user } = useAuthStore();
  const isGuest = Boolean(user?.is_guest);
  const initial = user?.username ?? '?';
  const motion = useCosmeticMotion();

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refunds, setRefunds] = useState<StoreRefund[]>([]);
  const [refundsDismissed, setRefundsDismissed] = useState(false);
  const [gold, setGold] = useState<number>(user?.gold ?? 0);
  const [worn, setWorn] = useState<Loadout>(() => loadoutOf(user));
  const [filter, setFilter] = useState<TypeFilter>('all');
  /** The item a request is in flight for (buy or wear). */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The slot a change to Your look is in flight for. */
  const [pendingSlot, setPendingSlot] = useState<Slot | null>(null);
  /** The purchase dialog: confirming, then the item just bought. */
  const [dialog, setDialog] = useState<PurchaseState | null>(null);
  /** The item being tried on in Your look. */
  const [trying, setTrying] = useState<string | null>(null);

  const lookRef = useRef<HTMLElement>(null);
  const lookOnScreen = useOnScreen(lookRef);

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
      if (!next) throw new Error('The server did not say what is worn');
      applyLoadout(next);
      // Worn now, so no longer only tried on.
      if (item) setTrying((current) => (current === item.cosmetic_id ? null : current));
      toast.success(item ? `Now wearing ${item.name}` : `${SLOT_LABELS[slot]} back to default`);
    } catch {
      toast.error(item ? 'Failed to wear item' : 'Failed to change your look');
    } finally {
      setPendingSlot(null);
      setBusyId(null);
    }
  };

  const equipItem = (item: CatalogItem) => {
    const slot = SLOT_BY_TYPE[item.type];
    if (slot) void setSlot(slot, item);
  };

  /** Try `item` on in Your look, or put it back when it already is. */
  const tryOn = (item: CatalogItem) => {
    const slot = SLOT_BY_TYPE[item.type];
    if (isGuest || !slot) return;
    // Already worn: there is nothing to try.
    if (worn[slot] === item.cosmetic_id) {
      setTrying(null);
      return;
    }
    setTrying((current) => (current === item.cosmetic_id ? null : item.cosmetic_id));
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

  const sections = useMemo(() => catalogSections(catalog, filter), [catalog, filter]);
  const tryingItem = useMemo(
    () => (trying ? catalog.find((i) => i.cosmetic_id === trying) ?? null : null),
    [catalog, trying],
  );
  const tryAction = tryingItem ? itemAction(tryingItem, { gold, worn, guest: isGuest }) : null;
  const showTryOnBar = Boolean(!isGuest && tryingItem && tryAction && !lookOnScreen && !dialog);

  const renderCard = (item: CatalogItem, variant: 'full' | 'compact', className?: string) => (
    <StoreItemCard
      key={item.cosmetic_id}
      item={item}
      action={itemAction(item, { gold, worn, guest: isGuest })}
      initial={initial}
      busy={busyId === item.cosmetic_id}
      trying={trying === item.cosmetic_id}
      onTryOn={isGuest ? undefined : () => tryOn(item)}
      onBuy={() => requestBuy(item)}
      onEquip={() => equipItem(item)}
      variant={variant}
      className={className}
    />
  );

  return (
    <SubpageShell
      title="STORE"
      icon={ShoppingBag}
      maxWidth="6xl"
      className={clsx(motion && 'store-motion')}
      headerRight={(
        <div className="flex items-center gap-1.5 rounded-full border border-bf-gold/35 bg-bf-gold/10 px-3 py-1.5 text-sm font-semibold text-[#f3d98b]">
          <Coins className="h-4 w-4" aria-hidden />
          <span className="tabular-nums">{gold.toLocaleString()}</span>
          <span className="font-normal text-[#c9b27a]">gold</span>
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
        <YourLook
          sectionRef={lookRef}
          worn={worn}
          catalog={catalog}
          trying={tryingItem}
          tryAction={tryAction}
          initial={initial}
          name={user?.username ?? 'Commander'}
          pending={pendingSlot}
          busy={!!busyId}
          motion={motion}
          onPick={(slot, item) => void setSlot(slot, item)}
          onPutBack={() => setTrying(null)}
          onWearTried={() => tryingItem && equipItem(tryingItem)}
          onBuyTried={() => tryingItem && requestBuy(tryingItem)}
        />
      )}

      <div className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap" role="group" aria-label="Show">
        {TYPE_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={clsx(
              'min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors sm:min-h-0 sm:py-1.5',
              filter === key
                ? 'border-bf-gold/50 bg-bf-gold/20 text-[#f3d98b]'
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
        <div className="flex flex-col gap-6 sm:gap-8">
          {sections.map((section) =>
            section.kind === 'earned' ? (
              <EarnedWall key={section.id} section={section} canTryOn={!isGuest}>
                {section.items.map((item) => renderCard(item, 'compact'))}
              </EarnedWall>
            ) : (
              <SetBand key={section.id} section={section}>
                {section.items.map((item) => renderCard(item, 'full', STORE_BAND_CARD))}
              </SetBand>
            ),
          )}
        </div>
      )}

      {showTryOnBar && tryingItem && tryAction && (
        <>
          {/* Room at the end of the page, so the bar never covers the last row. */}
          <div aria-hidden className="h-24" />
          <TryOnBar
            item={tryingItem}
            action={tryAction}
            initial={initial}
            busy={!!busyId}
            onPutBack={() => setTrying(null)}
            onBuy={() => requestBuy(tryingItem)}
            onWear={() => equipItem(tryingItem)}
          />
        </>
      )}

      <PurchaseDialog
        state={dialog}
        catalog={catalog}
        gold={gold}
        initial={initial}
        busy={!!busyId}
        motion={motion}
        onCancel={() => setDialog(null)}
        onConfirm={() => dialog && void buy(dialog.item)}
        onWear={() => {
          if (!dialog) return;
          const { item } = dialog;
          setDialog(null);
          equipItem(item);
        }}
      />
    </SubpageShell>
  );
}
