import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { ShoppingBag, Coins, Package, Shirt, Sword, Layers, Image, CheckCircle, Lock } from 'lucide-react';
import SubpageShell from '../components/ui/SubpageShell';
import { RARITY_COLORS } from '@borderfall/shared';
import type { CosmeticRarity } from '@borderfall/shared';

interface CosmeticItem {
  cosmetic_id: string;
  type: string;
  name: string;
  description: string | null;
  asset_url: string | null;
  price_gems: number;
  is_premium: boolean;
  owned: boolean;
  rarity?: CosmeticRarity | null;
  /** Earned through gameplay (levels/seasons/achievements/…) — not claimable here. */
  earned_only?: boolean;
  /** Server-authoritative: item can't be acquired in the store right now and isn't owned. */
  locked?: boolean;
}

interface OwnedItem {
  cosmetic_id: string;
  type: string;
  name: string;
  description: string | null;
  asset_url: string | null;
}

type FilterType = 'all' | 'profile_banner' | 'unit_skin' | 'dice_skin' | 'map_theme' | 'map_marker' | 'profile_frame';

const TYPE_LABELS: Record<string, string> = {
  profile_banner: 'Banners',
  unit_skin: 'Unit Skins',
  dice_skin: 'Dice',
  map_theme: 'Map Themes',
  map_marker: 'Markers',
  profile_frame: 'Frames',
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  profile_banner: <Image className="w-3.5 h-3.5" />,
  unit_skin: <Sword className="w-3.5 h-3.5" />,
  dice_skin: <Layers className="w-3.5 h-3.5" />,
  map_theme: <Package className="w-3.5 h-3.5" />,
  map_marker: <Shirt className="w-3.5 h-3.5" />,
  profile_frame: <Image className="w-3.5 h-3.5" />,
};

const FILTER_CHIPS: { key: FilterType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'profile_frame', label: 'Frames' },
  { key: 'profile_banner', label: 'Banners' },
  { key: 'unit_skin', label: 'Unit Skins' },
  { key: 'dice_skin', label: 'Dice' },
  { key: 'map_theme', label: 'Map Themes' },
  { key: 'map_marker', label: 'Markers' },
];

export default function StorePage() {
  const { user, setUser } = useAuthStore();
  const [tab, setTab] = useState<'catalog' | 'loadout'>('catalog');
  const [catalog, setCatalog] = useState<CosmeticItem[]>([]);
  const [owned, setOwned] = useState<OwnedItem[]>([]);
  const [filter, setFilter] = useState<FilterType | 'all'>('all');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingOwned, setLoadingOwned] = useState(false);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [equippingId, setEquippingId] = useState<string | null>(null);
  const [gold, setGold] = useState<number>(user?.gold ?? 0);
  const [equippedFrame, setEquippedFrame] = useState<string | null>(user?.equipped_frame ?? null);
  const [equippedMarker, setEquippedMarker] = useState<string | null>(user?.equipped_marker ?? null);
  const [equippedDice, setEquippedDice] = useState<string | null>(user?.equipped_dice ?? null);

  const fetchCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const res = await api.get('/store/catalog');
      setCatalog(res.data.catalog);
    } catch {
      toast.error('Failed to load store catalog');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const fetchOwned = useCallback(async () => {
    setLoadingOwned(true);
    try {
      const res = await api.get('/users/me/cosmetics');
      setOwned(res.data.cosmetics ?? res.data);
    } catch {
      toast.error('Failed to load your cosmetics');
    } finally {
      setLoadingOwned(false);
    }
  }, []);

  const fetchGold = useCallback(async () => {
    try {
      const res = await api.get('/users/me');
      const newGold = res.data.gold ?? 0;
      setGold(newGold);
      // Read from store imperatively to avoid capturing `user` as a dep (prevents re-render loop)
      const storeUser = useAuthStore.getState().user;
      if (storeUser) useAuthStore.getState().setUser({ ...storeUser, gold: newGold });
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    setEquippedFrame(user.equipped_frame ?? null);
    setEquippedMarker(user.equipped_marker ?? null);
    setEquippedDice(user.equipped_dice ?? null);
  }, [user?.user_id, user?.equipped_frame, user?.equipped_marker, user?.equipped_dice]);

  useEffect(() => {
    fetchCatalog();
    fetchGold();
  }, [fetchCatalog, fetchGold]);

  useEffect(() => {
    if (tab === 'loadout') fetchOwned();
  }, [tab, fetchOwned]);

  const handleBuy = async (item: CosmeticItem) => {
    if (buyingId) return;
    setBuyingId(item.cosmetic_id);
    try {
      const res = await api.post('/store/buy', { cosmetic_id: item.cosmetic_id });
      // Only mutate local gold when the server actually returned a new
      // authoritative balance. Free items (price_gems === 0) do not change
      // the balance and the server response omits `new_balance`; previously
      // we silently kept the stale value, which usually agreed with the
      // server but would diverge after gold was earned in another tab. For
      // paid items the server is authoritative; for free items we proactively
      // refetch in case background activity changed it.
      const serverNewBalance = res.data?.new_balance;
      if (typeof serverNewBalance === 'number') {
        setGold(serverNewBalance);
        if (user) setUser({ ...user, gold: serverNewBalance });
      } else {
        void fetchGold();
      }
      setCatalog((prev) =>
        prev.map((c) => (c.cosmetic_id === item.cosmetic_id ? { ...c, owned: true } : c)),
      );
      toast.success(`${item.name} added to your collection!`);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: { error?: string; balance?: number } } })?.response?.data;
      // 402 = insufficient gold — server returns the authoritative current
      // balance. Sync the UI immediately so the player sees why "Buy" is
      // failing and doesn't pile on retries.
      if (status === 402 && typeof data?.balance === 'number') {
        setGold(data.balance);
        if (user) setUser({ ...user, gold: data.balance });
      } else if (status === 409) {
        // Already owned — the catalog list is stale; refetch so the row flips
        // to "Collected" instead of leaving the "Buy" button hot.
        void fetchCatalog();
      } else {
        // For any other failure resync gold defensively — a 500 may have
        // committed the deduction even though the response failed.
        void fetchGold();
      }
      toast.error(data?.error ?? 'Purchase failed');
    } finally {
      setBuyingId(null);
    }
  };

  const handleEquip = async (item: OwnedItem) => {
    if (equippingId) return;
    const isFrame = item.type === 'profile_frame' || item.type === 'profile_banner';
    const isMarker = item.type === 'map_marker';
    const isDice = item.type === 'dice_skin';
    if (!isFrame && !isMarker && !isDice) {
      toast('This item type cannot be equipped yet.', { icon: 'ℹ️' });
      return;
    }
    setEquippingId(item.cosmetic_id);
    try {
      const payload = isFrame
        ? { frame_id: item.cosmetic_id }
        : isMarker
          ? { marker_id: item.cosmetic_id }
          : { dice_id: item.cosmetic_id };
      await api.put('/users/me/cosmetics/equip', payload);
      if (isFrame) {
        setEquippedFrame(item.cosmetic_id);
        if (user) setUser({ ...user, equipped_frame: item.cosmetic_id });
      } else if (isMarker) {
        setEquippedMarker(item.cosmetic_id);
        if (user) setUser({ ...user, equipped_marker: item.cosmetic_id });
      } else {
        setEquippedDice(item.cosmetic_id);
        if (user) setUser({ ...user, equipped_dice: item.cosmetic_id });
      }
      toast.success(`${item.name} equipped!`);
    } catch {
      toast.error('Failed to equip item');
    } finally {
      setEquippingId(null);
    }
  };

  const displayed = filter === 'all' ? catalog : catalog.filter((c) => c.type === filter);

  const groupedOwned = owned.reduce<Record<string, OwnedItem[]>>((acc, item) => {
    const key = item.type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <SubpageShell
      title="STORE"
      icon={ShoppingBag}
      maxWidth="4xl"
      headerRight={(
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bf-gold/10 border border-bf-gold/30 text-bf-gold text-sm font-medium">
          <Coins className="w-4 h-4" aria-hidden />
          <span className="tabular-nums">{gold.toLocaleString()}</span>
        </div>
      )}
    >
        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-1 bg-bf-dark rounded-lg w-fit border border-bf-border">
          {(['catalog', 'loadout'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
                tab === t
                  ? 'bg-bf-gold/15 text-bf-gold border border-bf-gold/30'
                  : 'text-bf-muted hover:text-bf-text border border-transparent'
              }`}
            >
              {t === 'catalog' ? 'Catalog' : 'My Loadout'}
            </button>
          ))}
        </div>

        {/* ── CATALOG TAB ── */}
        {tab === 'catalog' && (
          <>
            {/* Filter chips */}
            <div className="flex flex-wrap gap-2 mb-6">
              {FILTER_CHIPS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    filter === key
                      ? 'bg-bf-gold/20 border-bf-gold/50 text-bf-gold'
                      : 'border-bf-border text-bf-muted hover:text-bf-text hover:border-bf-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {loadingCatalog ? (
              <div className="text-center py-16 text-bf-muted">Loading store…</div>
            ) : displayed.length === 0 ? (
              <div className="text-center py-16 text-bf-muted">No items in this category.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayed.map((item) => {
                  // `locked` is computed server-side: earned-only rewards (levels,
                  // seasons, prestige, ratings, achievements) and legendary/mythic
                  // items that the player doesn't yet own. The backend is the
                  // authoritative gate; this just hides the dead "Get Free" button.
                  const locked = Boolean(item.locked);
                  return (
                  <div
                    key={item.cosmetic_id}
                    className={`card flex flex-col gap-3 ${
                      item.owned ? 'border-bf-gold/20 bg-bf-gold/5' : ''
                    }`}
                  >
                    {/* Type badge */}
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-xs text-bf-muted border border-bf-border rounded-full px-2 py-0.5">
                        {TYPE_ICON[item.type]}
                        {TYPE_LABELS[item.type] ?? item.type}
                      </span>
                      {item.owned && (
                        <span className="flex items-center gap-1 text-xs text-bf-gold">
                          <CheckCircle className="w-3.5 h-3.5" /> Owned
                        </span>
                      )}
                    </div>

                    {/* Name & description */}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-display text-bf-text">{item.name}</p>
                        {item.rarity && item.rarity !== 'common' && (
                          <span
                            className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{
                              color: RARITY_COLORS[item.rarity],
                              backgroundColor: `${RARITY_COLORS[item.rarity]}15`,
                              border: `1px solid ${RARITY_COLORS[item.rarity]}40`,
                            }}
                          >
                            {item.rarity}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-bf-muted text-xs mt-0.5">{item.description}</p>
                      )}
                    </div>

                    {/* Price / action */}
                    <div className="mt-auto pt-2 flex items-center justify-between">
                      {locked ? (
                        <span className="flex items-center gap-1 text-bf-muted text-xs font-medium">
                          <Lock className="w-3.5 h-3.5" />
                          Achievement reward
                        </span>
                      ) : item.price_gems === 0 ? (
                        <span className="text-xs text-green-400 font-medium">Free</span>
                      ) : (
                        <span className="flex items-center gap-1 text-bf-gold text-sm font-medium">
                          <Coins className="w-3.5 h-3.5" />
                          {item.price_gems.toLocaleString()}
                        </span>
                      )}

                      {item.owned ? (
                        <span className="text-xs text-bf-muted px-3 py-1 rounded border border-bf-border">
                          Collected
                        </span>
                      ) : locked ? (
                        <span
                          className="flex items-center gap-1 text-xs text-bf-muted px-3 py-1 rounded border border-bf-border"
                          title={item.description ?? 'Unlocked through gameplay achievements'}
                        >
                          <Lock className="w-3 h-3" /> Earn in game
                        </span>
                      ) : (
                        <button
                          onClick={() => handleBuy(item)}
                          disabled={buyingId === item.cosmetic_id}
                          className="btn-primary text-xs px-3 py-1 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {buyingId === item.cosmetic_id
                            ? 'Buying…'
                            : item.price_gems === 0
                            ? 'Get Free'
                            : 'Buy'}
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── MY LOADOUT TAB ── */}
        {tab === 'loadout' && (
          <>
            {loadingOwned ? (
              <div className="text-center py-16 text-bf-muted">Loading loadout…</div>
            ) : owned.length === 0 ? (
              <div className="text-center py-16 text-bf-muted">
                You don&apos;t own any cosmetics yet.{' '}
                <button
                  className="text-bf-gold underline"
                  onClick={() => setTab('catalog')}
                >
                  Browse the catalog
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {Object.entries(groupedOwned).map(([type, items]) => (
                  <div key={type}>
                    <h3 className="flex items-center gap-2 font-display text-bf-gold mb-3">
                      {TYPE_ICON[type]}
                      {TYPE_LABELS[type] ?? type}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {items.map((item) => {
                        const isEquipped =
                          ((type === 'profile_frame' || type === 'profile_banner') &&
                            equippedFrame === item.cosmetic_id) ||
                          (type === 'map_marker' && equippedMarker === item.cosmetic_id) ||
                          (type === 'dice_skin' && equippedDice === item.cosmetic_id);
                        const canEquip =
                          type === 'profile_frame' ||
                          type === 'profile_banner' ||
                          type === 'map_marker' ||
                          type === 'dice_skin';
                        return (
                          <div
                            key={item.cosmetic_id}
                            className={`card flex flex-col gap-2 ${
                              isEquipped ? 'border-bf-gold/40 bg-bf-gold/5' : ''
                            }`}
                          >
                            <p className="font-display text-bf-text text-sm">{item.name}</p>
                            {item.description && (
                              <p className="text-bf-muted text-xs">{item.description}</p>
                            )}
                            <div className="mt-auto pt-2">
                              {isEquipped ? (
                                <span className="flex items-center gap-1 text-xs text-bf-gold">
                                  <CheckCircle className="w-3.5 h-3.5" /> Equipped
                                </span>
                              ) : canEquip ? (
                                <button
                                  onClick={() => handleEquip(item)}
                                  disabled={equippingId === item.cosmetic_id}
                                  className="btn-secondary text-xs px-3 py-1 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {equippingId === item.cosmetic_id ? 'Equipping…' : 'Equip'}
                                </button>
                              ) : (
                                <span className="text-xs text-bf-muted">In collection</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
    </SubpageShell>
  );
}
