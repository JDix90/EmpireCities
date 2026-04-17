import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home, Users, User, MoreHorizontal, X, HelpCircle,
  Map, Calendar, ShoppingBag, PenSquare, Trophy, Eye, FileText, LogOut,
} from 'lucide-react';
import clsx from 'clsx';
import { useIsLandscape } from '../../hooks/useIsLandscape';

interface MobileTabBarProps {
  isGuest?: boolean;
  onCreateGame: () => void;
  onLogout: () => void;
}

const PRIMARY_TABS = [
  { path: '/lobby', icon: Home, label: 'Home', guestHidden: false },
  { path: '/friends', icon: Users, label: 'Friends', guestHidden: true },
  { path: '/profile', icon: User, label: 'Profile', guestHidden: false },
] as const;

export default function MobileTabBar({ isGuest, onCreateGame, onLogout }: MobileTabBarProps) {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const isLandscape = useIsLandscape();

  // Hide tab bar in landscape to maximize screen real estate
  if (isLandscape) return null;

  return (
    <>
      {/* More sheet backdrop + panel */}
      {moreOpen && (
        <div className="fixed inset-0 z-[55] md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-[56px] inset-x-0 bg-cc-surface border-t border-cc-border rounded-t-2xl animate-slide-up pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center py-2">
              <div className="w-8 h-1 rounded-full bg-cc-border" />
            </div>
            <nav className="px-4 pb-4 grid grid-cols-3 gap-2">
              <MoreLink to="/how-to-play" icon={HelpCircle} label="How to Play" onClick={() => setMoreOpen(false)} />
              <MoreLink to="/maps" icon={Map} label="Map Hub" onClick={() => setMoreOpen(false)} />
              {!isGuest && <MoreLink to="/daily" icon={Calendar} label="Daily" onClick={() => setMoreOpen(false)} />}
              {!isGuest && <MoreLink to="/store" icon={ShoppingBag} label="Store" onClick={() => setMoreOpen(false)} />}
              {!isGuest && <MoreLink to="/editor" icon={PenSquare} label="Editor" onClick={() => setMoreOpen(false)} />}
              <MoreLink to="/leaderboards" icon={Trophy} label="Leaders" onClick={() => setMoreOpen(false)} />
              <MoreLink to="/live-games" icon={Eye} label="Live" onClick={() => setMoreOpen(false)} />
              <MoreLink to="/privacy" icon={FileText} label="Privacy" onClick={() => setMoreOpen(false)} />
              <MoreLink to="/" icon={Home} label="Landing" onClick={() => setMoreOpen(false)} />
              <button
                type="button"
                onClick={() => { setMoreOpen(false); onLogout(); }}
                className="flex flex-col items-center gap-1 py-3 rounded-lg bg-cc-dark text-cc-muted hover:text-red-400 transition-colors min-h-[44px]"
              >
                <LogOut className="w-5 h-5" />
                <span className="text-[10px]">Logout</span>
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-50 flex md:hidden items-center justify-around bg-cc-surface border-t border-cc-border pb-safe min-h-[56px]">
        {PRIMARY_TABS.map((tab) => {
          if (tab.guestHidden && isGuest) return null;
          const active = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={clsx(
                'flex flex-col items-center gap-0.5 py-1.5 px-3 min-h-[44px] justify-center transition-colors',
                active ? 'text-cc-gold' : 'text-cc-muted hover:text-cc-text',
              )}
            >
              <tab.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
        {/* Play button */}
        <button
          type="button"
          onClick={onCreateGame}
          className="flex flex-col items-center gap-0.5 py-1.5 px-3 min-h-[44px] justify-center text-cc-gold"
        >
          <div className="w-8 h-8 rounded-full bg-cc-gold text-cc-dark flex items-center justify-center text-lg font-bold">+</div>
          <span className="text-[10px] font-medium">Play</span>
        </button>
        {/* More */}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className={clsx(
            'flex flex-col items-center gap-0.5 py-1.5 px-3 min-h-[44px] justify-center transition-colors',
            moreOpen ? 'text-cc-gold' : 'text-cc-muted hover:text-cc-text',
          )}
        >
          {moreOpen ? <X className="w-5 h-5" /> : <MoreHorizontal className="w-5 h-5" />}
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  );
}

function MoreLink({ to, icon: Icon, label, onClick }: { to: string; icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex flex-col items-center gap-1 py-3 rounded-lg bg-cc-dark text-cc-muted hover:text-cc-text transition-colors min-h-[44px]"
    >
      <Icon className="w-5 h-5" />
      <span className="text-[10px]">{label}</span>
    </Link>
  );
}
