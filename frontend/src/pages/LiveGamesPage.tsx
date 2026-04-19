import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, Users, Clock, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../services/api';

const ERA_LABELS: Record<string, string> = {
  ancient: 'Ancient',
  medieval: 'Medieval',
  discovery: 'Discovery',
  ww2: 'World War II',
  coldwar: 'Cold War',
  modern: 'Modern',
  acw: 'American Civil War',
  risorgimento: 'Risorgimento',
  space_age: 'Space Age',
};

interface LiveGame {
  game_id: string;
  era_id: string;
  map_id: string;
  turn_count: number;
  spectator_count: number;
  created_at: string;
  player_count: string;
  human_count: string;
  featured: boolean;
  players: Array<{ username: string; player_color: string; is_ai: boolean }>;
}

export default function LiveGamesPage() {
  const [games, setGames] = useState<LiveGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [eraFilter, setEraFilter] = useState<string>('');
  const navigate = useNavigate();

  const fetchLiveGames = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (eraFilter) params.era_id = eraFilter;
      const res = await api.get<LiveGame[]>('/games/live', { params });
      setGames(res.data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveGames();
    const interval = setInterval(fetchLiveGames, 15_000);
    return () => clearInterval(interval);
  }, [eraFilter]);

  return (
    <div className="min-h-screen bg-cc-dark">
      <nav className="border-b border-cc-border px-4 sm:px-6 py-4 flex items-center justify-between pt-safe px-safe">
        <Link to="/lobby" className="flex items-center gap-2 text-cc-muted hover:text-cc-text text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Lobby
        </Link>
        <h1 className="font-display text-xl text-cc-gold tracking-widest">LIVE GAMES</h1>
        <button onClick={fetchLiveGames} className="text-cc-muted hover:text-cc-text transition-colors" title="Refresh">
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Era filter chips */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setEraFilter('')}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
              !eraFilter
                ? 'bg-cc-gold/20 border-cc-gold/40 text-cc-gold'
                : 'border-cc-border text-cc-muted hover:text-cc-text',
            )}
          >
            All Eras
          </button>
          {Object.entries(ERA_LABELS).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setEraFilter(id)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                eraFilter === id
                  ? 'bg-cc-gold/20 border-cc-gold/40 text-cc-gold'
                  : 'border-cc-border text-cc-muted hover:text-cc-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Live games list */}
        {loading && games.length === 0 ? (
          <div className="py-16 text-center text-cc-muted animate-pulse">Searching for live games…</div>
        ) : games.length === 0 ? (
          <div className="py-16 text-center">
            <Eye className="w-12 h-12 text-cc-muted/30 mx-auto mb-4" />
            <p className="text-cc-muted">No live games right now</p>
            <p className="text-cc-muted/60 text-sm mt-1">Check back later or start your own game!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {games.some((game) => game.featured) && (
              <div>
                <p className="text-xs uppercase tracking-widest text-cc-gold mb-3">Featured</p>
                <div className="grid gap-3">
                  {games.filter((game) => game.featured).map((game) => (
                    <LiveGameCard key={`featured-${game.game_id}`} game={game} onOpen={() => navigate(`/spectate/${game.game_id}`)} />
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs uppercase tracking-widest text-cc-muted mb-3">All Live Games</p>
              <div className="grid gap-3">
                {games.map((game) => (
                  <LiveGameCard key={game.game_id} game={game} onOpen={() => navigate(`/spectate/${game.game_id}`)} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveGameCard({ game, onOpen }: { game: LiveGame; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className={clsx(
        'card p-4 text-left hover:border-cc-gold/30 transition-all group',
        game.featured && 'border-cc-gold/30 bg-gradient-to-r from-cc-gold/[0.06] to-transparent',
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-cc-gold/10 text-cc-gold border border-cc-gold/20">
            {ERA_LABELS[game.era_id] ?? game.era_id}
          </span>
          {game.featured && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-400/10 text-amber-300 border border-amber-400/20">
              Featured
            </span>
          )}
          <span className="text-cc-muted text-xs flex items-center gap-1">
            <Clock className="w-3 h-3" /> Turn {game.turn_count}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {game.spectator_count > 0 && (
            <span className="text-cc-muted text-xs flex items-center gap-1">
              <Eye className="w-3 h-3" /> {game.spectator_count}
            </span>
          )}
          <span className="text-cc-gold text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            <Eye className="w-3 h-3" /> Spectate
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {game.players.map((p, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 text-sm"
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.player_color }} />
            <span className={clsx('text-cc-text', p.is_ai && 'text-cc-muted')}>
              {p.username} {p.is_ai && <span className="text-cc-muted/60 text-xs">(AI)</span>}
            </span>
          </span>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-cc-muted">
        <Users className="w-3 h-3" /> {game.player_count} players · {game.human_count} human
      </div>
    </button>
  );
}
