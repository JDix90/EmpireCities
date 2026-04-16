import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';
import { ShoppingBag, Coins, Package, Shirt, Sword, Layers, Image, ChevronLeft, CheckCircle } from 'lucide-react';
import { RARITY_COLORS } from '@erasofempire/shared';
import type { CosmeticRarity } from '@erasofempire/shared';

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
}

interface OwnedItem {
  cosmetic_id: string;
  type: string;
  name: string;
  description: string | null;
  asset_url: string | null;
}

type FilterType = 'all' | 'profile_banner' | 'unit_skin' | 'dice_skin' | 'map_theme' | 'map_marker';

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
  { key: 'profile_banner', label: 'Banners' },
  { key: 'unit_skin', label: 'Unit Skins' },
  { key: 'dice_skin', label: 'Dice' },
  { key: 'map_theme', label: 'Map Themes' },
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
      const newBalance = res.data.new_balance ?? gold;
      setGold(newBalance);
      if (user) setUser({ ...user, gold: newBalance });
      setCatalog((prev) =>
        prev.map((c) => (c.cosmetic_id === item.cosmetic_id ? { ...c, owned: true } : c)),
      );
      toast.success(`${item.name} added to your collection!`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Purchase failed';
      toast.error(msg);
    } finally {
      setBuyingId(null);
    }
  };

  const handleEquip = async (item: OwnedItem) => {
    if (equippingId) return;
    const isFrame = item.type === 'profile_frame' || item.type === 'profile_banner';
    if (!isFrame) {
      toast('This item type cannot be equipped yet.', { icon: 'ℹ️' });
      return;
    }
    setEquippingId(item.cosmetic_id);
    try {
      await api.put('/users/me/cosmetics/equip', { frame_id: item.cosmetic_id });
      setEquippedFrame(item.cosmetic_id);
      if (user) setUser({ ...user, equipped_frame: item.cosmetic_id });
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
    <div className="min-h-screen bg-cc-dark">
      {/* Header */}
      <nav className="border-b border-cc-border px-4 sm:px-6 py-4 flex items-center justify-between pt-safe px-safe">
        <div className="flex items-center gap-3">
          <Link to="/lobby" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <ChevronLeft className="w-4 h-4" /> Lobby
          </Link>
          <span className="text-cc-border">|</span>
          <span className="flex items-center gap-2 font-display text-cc-gold tracking-widest text-lg">
            <ShoppingBag className="w-5 h-5" /> STORE
          </span>
        </div>
        {/* Gold balance */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cc-gold/10 border border-cc-gold/30 text-cc-gold text-sm font-medium">
          <Coins className="w-4 h-4" />
          {gold.toLocaleString()} Gold
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-1 bg-cc-dark rounded-lg w-fit border border-cc-border">
          {(['catalog', 'loadout'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
                tab === t
                  ? 'bg-cc-gold/15 text-cc-gold border border-cc-gold/30'
                  : 'text-cc-muted hover:text-cc-text border border-transparent'
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
                      ? 'bg-cc-gold/20 border-cc-gold/50 text-cc-gold'
                      : 'border-cc-border text-cc-muted hover:text-cc-text hover:border-cc-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {loadingCatalog ? (
              <div className="text-center py-16 text-cc-muted">Loading store…</div>
            ) : displayed.length === 0 ? (
              <div className="text-center py-16 text-cc-muted">No items in this category.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayed.map((item) => (
                  <div
                    key={item.cosmetic_id}
                    className={`card flex flex-col gap-3 ${
                      item.owned ? 'border-cc-gold/20 bg-cc-gold/5' : ''
                    }`}
                  >
                    {/* Type badge */}
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-xs text-cc-muted border border-cc-border rounded-full px-2 py-0.5">
                        {TYPE_ICON[item.type]}
                        {TYPE_LABELS[item.type] ?? item.type}
                      </span>
                      {item.owned && (
                        <span className="flex items-center gap-1 text-xs text-cc-gold">
                          <CheckCircle className="w-3.5 h-3.5" /> Owned
                        </span>
                      )}
                    </div>

                    {/* Name & description */}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-display text-cc-text">{item.name}</p>
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
                        <p className="text-cc-muted text-xs mt-0.5">{item.description}</p>
                      )}
                    </div>

                    {/* Price / action */}
                    <div className="mt-auto pt-2 flex items-center justify-between">
                      {item.price_gems === 0 ? (
                        <span className="text-xs text-green-400 font-medium">Free</span>
                      ) : (
                        <span className="flex items-center gap-1 text-cc-gold text-sm font-medium">
                          <Coins className="w-3.5 h-3.5" />
                          {item.price_gems.toLocaleString()}
                        </span>
                      )}

                      {item.owned ? (
                        <span className="text-xs text-cc-muted px-3 py-1 rounded border border-cc-border">
                          Collected
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
                ))}
              </div>
            )}
          </>
        )}

        {/* ── MY LOADOUT TAB ── */}
        {tab === 'loadout' && (
          <>
            {loadingOwned ? (
              <div className="text-center py-16 text-cc-muted">Loading loadout…</div>
            ) : owned.length === 0 ? (
              <div className="text-center py-16 text-cc-muted">
                You don&apos;t own any cosmetics yet.{' '}
                <button
                  className="text-cc-gold underline"
                  onClick={() => setTab('catalog')}
                >
                  Browse the catalog
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {Object.entries(groupedOwned).map(([type, items]) => (
                  <div key={type}>
                    <h3 className="flex items-center gap-2 font-display text-cc-gold mb-3">
                      {TYPE_ICON[type]}
                      {TYPE_LABELS[type] ?? type}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {items.map((item) => {
                        const isEquipped =
                          (type === 'profile_frame' || type === 'profile_banner') &&
                          equippedFrame === item.cosmetic_id;
                        const canEquip = type === 'profile_frame' || type === 'profile_banner';
                        return (
                          <div
                            key={item.cosmetic_id}
                            className={`card flex flex-col gap-2 ${
                              isEquipped ? 'border-cc-gold/40 bg-cc-gold/5' : ''
                            }`}
                          >
                            <p className="font-display text-cc-text text-sm">{item.name}</p>
                            {item.description && (
                              <p className="text-cc-muted text-xs">{item.description}</p>
                            )}
                            <div className="mt-auto pt-2">
                              {isEquipped ? (
                                <span className="flex items-center gap-1 text-xs text-cc-gold">
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
                                <span className="text-xs text-cc-muted">In collection</span>
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
      </div>
    </div>
  );
}
