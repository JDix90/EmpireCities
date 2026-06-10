import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Map, Calendar, PenSquare, Users, Trophy, Eye, Home, Swords, Shield, Coins
} from 'lucide-react';
import styles from './TopNavBar.module.css';
import UserMenu from './UserMenu';
import { useAuthStore, selectIsAdminFromToken } from '../../store/authStore';
import { useMapEditorEnabled } from '../../store/featureFlagsStore';
import { APP_NAME_NAV } from '../../constants/brand';

type NavItem = {
  to: string;
  label: string;
  icon: React.ElementType;
  title?: string;
  hideForGuest?: boolean;
  hideForNonAdmin?: boolean;
  requiresMapEditor?: boolean;
  exact?: boolean;
};

const mainNav: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, title: 'Home', exact: true },
  { to: '/maps', label: 'Map Hub', icon: Map, title: 'Map Hub' },
  { to: '/daily', label: 'Daily', icon: Calendar, title: 'Daily', hideForGuest: true },
  { to: '/campaign', label: 'Campaign', icon: Swords, title: 'Campaign', hideForGuest: true },
  { to: '/leaderboards', label: 'Leaderboards', icon: Trophy, title: 'Leaderboards' },
  { to: '/live-games', label: 'Live', icon: Eye, title: 'Live' },
  { to: '/editor', label: 'Map Editor', icon: PenSquare, title: 'Map Editor', hideForGuest: true, requiresMapEditor: true },
  { to: '/admin', label: 'Admin', icon: Shield, title: 'Admin', hideForNonAdmin: true },
];

export default function TopNavBar({ user, onLogout }: { user: any, onLogout: () => void }) {
  const location = useLocation();
  // Admin nav visibility is gated off the access-token claim, not the
  // persisted user.is_admin field — see selectIsAdminFromToken docstring.
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAdmin = selectIsAdminFromToken(accessToken);
  const mapEditorEnabled = useMapEditorEnabled();
  // Read gold from the store (not the prop) so it stays reactive after daily
  // claims, purchases, and game rewards update the balance elsewhere.
  const gold = useAuthStore((s) => s.user?.gold ?? 0);
  const isActive = (to: string, exact?: boolean) => {
    if (exact) return location.pathname === to;
    return location.pathname.startsWith(to) && to !== '/';
  };
  return (
    <nav className={styles.navBar}>
      {/* Logo/Brand */}
      <Link to="/lobby" className={styles.logo}>
        {APP_NAME_NAV}
      </Link>
      {/* Main nav groups */}
      <div className={styles.mainNav}>
        <div className={styles.navLinks}>
          {mainNav.map(({ to, label, icon: Icon, title, hideForGuest, hideForNonAdmin, requiresMapEditor, exact }) =>
            (!hideForGuest || !user?.is_guest)
            && (!hideForNonAdmin || isAdmin)
            && (!requiresMapEditor || mapEditorEnabled) && (
              <Link
                key={to}
                to={to}
                className={isActive(to, exact) ? `${styles.navLink} ${styles.active}` : styles.navLink}
                aria-current={isActive(to, exact) ? 'page' : undefined}
                title={title || label}
              >
                <Icon className={styles.icon} /> {label}
              </Link>
            )
          )}
        </div>
      </div>
      {/* Account & Help */}
      <div className={styles.accountNav}>
        {!user?.is_guest && (
          // Gold balance doubles as the Store entry point (standard game UX:
          // click your currency to open the shop). This is the single store
          // redirect now that the separate "Store" nav link is removed.
          <Link
            to="/store"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm font-medium transition-colors ${
              isActive('/store')
                ? 'bg-bf-gold/25 border-bf-gold/50 text-bf-gold'
                : 'bg-bf-gold/10 border-bf-gold/30 text-bf-gold hover:bg-bf-gold/20'
            }`}
            aria-current={isActive('/store') ? 'page' : undefined}
            title="Open Store"
            aria-label={`Open Store — ${gold.toLocaleString()} gold`}
          >
            <Coins className="w-4 h-4" aria-hidden />
            <span className="tabular-nums">{gold.toLocaleString()}</span>
          </Link>
        )}
        {!user?.is_guest && (
          <Link
            to="/friends"
            className={isActive('/friends') ? `${styles.navLink} ${styles.active}` : styles.navLink}
            aria-current={isActive('/friends') ? 'page' : undefined}
            title="Friends"
          >
            <Users className={styles.icon} /> Friends
          </Link>
        )}
        {/* Profile/Settings/Help/Privacy/Logout collapse into the account menu. */}
        <UserMenu
          username={user?.username ?? 'Profile'}
          isGuest={!!user?.is_guest}
          onLogout={onLogout}
          triggerClassName={isActive('/profile') ? `${styles.navLink} ${styles.active}` : styles.navLink}
          iconClassName={styles.icon}
        />
      </div>
    </nav>
  );
}
