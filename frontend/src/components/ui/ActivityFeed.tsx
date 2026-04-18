import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, ArrowUpCircle, Medal, Share2, Swords, Star, Zap } from 'lucide-react';
import { api } from '../../services/api';
// import { fetchMapById, getTerritoryById, getTerritoriesInRegion } from '../../services/mapService';

interface ActivityEvent {
  id: string;
  user_id: string;
  username: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

interface ActivityFeedResponse {
  activities?: ActivityEvent[];
}

const EVENT_CONFIG: Record<string, { icon: typeof Trophy; color: string; label: (d: Record<string, unknown>) => string }> = {
  game_won: {
    icon: Trophy,
    color: 'text-cc-gold',
    label: (d) => `Won a game${d.era ? ` (${d.era})` : ''}`,
  },
  level_up: {
    icon: ArrowUpCircle,
    color: 'text-emerald-400',
    label: (d) => `Reached level ${d.level ?? '?'}`,
  },
  achievement_unlocked: {
    icon: Medal,
    color: 'text-purple-400',
    label: (d) => `Unlocked "${d.name ?? 'achievement'}"`,
  },
  tier_promoted: {
    icon: Star,
    color: 'text-amber-400',
    label: (d) => `Promoted to ${d.tier ?? 'new tier'}`,
  },
  game_shared: {
    icon: Share2,
    color: 'text-blue-400',
    label: () => 'Shared a game replay',
  },
  challenge_completed: {
    icon: Zap,
    color: 'text-orange-400',
    label: () => 'Completed the daily challenge',
  },
  // Add more event types as needed, using lookup for territory/region
};

// Utility to display natural language territory/region name if present (stub: needs map context)
function displayLocationName(eventData: Record<string, unknown>): string {
  // TODO: Use map context for lookup if available
  if (eventData.territory_name && typeof eventData.territory_name === 'string') return eventData.territory_name;
  if (eventData.region_name && typeof eventData.region_name === 'string') return eventData.region_name;
  if (eventData.territory_id && typeof eventData.territory_id === 'string') return eventData.territory_id;
  if (eventData.region_id && typeof eventData.region_id === 'string') return eventData.region_id;
  return '';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ActivityFeed({ className = '' }: { className?: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .get<ActivityFeedResponse | ActivityEvent[]>('/feed', { params: { limit: 20 } })
      .then((res) => {
        const payload = Array.isArray(res.data) ? res.data : res.data.activities;
        setEvents(Array.isArray(payload) ? payload : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className={`card p-4 ${className}`}>
        <h3 className="font-display text-sm text-cc-gold mb-3">Friend Activity</h3>
        <div className="text-cc-muted text-xs animate-pulse">Loading…</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={`card p-4 ${className}`}>
        <h3 className="font-display text-sm text-cc-gold mb-3">Friend Activity</h3>
        <p className="text-cc-muted text-xs">No recent activity from friends.</p>
      </div>
    );
  }

  return (
    <div className={`card p-4 ${className}`}>
      <h3 className="font-display text-sm text-cc-gold mb-3">Friend Activity</h3>
      <div className="space-y-2.5 max-h-64 overflow-y-auto">
        {events.map((ev) => {
          const cfg = EVENT_CONFIG[ev.event_type] ?? {
            icon: Swords,
            color: 'text-cc-muted',
            label: (d: Record<string, unknown>, lookup: (d: Record<string, unknown>) => string) => ev.event_type.replace(/_/g, ' '),
          };
          const Icon = cfg.icon;
          // Use displayLocationName for territory/region if present
          const location = displayLocationName(ev.event_data);
          return (
            <div key={ev.id} className="flex items-start gap-2.5 text-xs">
              <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
              <div className="min-w-0 flex-1">
                <span className="text-cc-text">
                  <Link to={`/profile/${ev.user_id}`} className="font-medium hover:text-cc-gold transition-colors">
                    {ev.username}
                  </Link>{' '}
                  <span className="text-cc-muted">
                    {cfg.label(ev.event_data)}
                    {location && ` (${location})`}
                  </span>
                </span>
                <div className="text-cc-muted/60 mt-0.5">{timeAgo(ev.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
