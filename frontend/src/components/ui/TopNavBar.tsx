import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  HelpCircle, Map, Calendar, ShoppingBag, PenSquare, Users, Trophy, Eye, User, FileText, Home, LogOut, Swords, Shield
} from 'lucide-react';
import styles from './TopNavBar.module.css';
import { useAuthStore, selectIsAdminFromToken } from '../../store/authStore';
import { APP_NAME_NAV } from '../../constants/brand';

type NavItem = {
  to: string;
  label: string;
  icon: React.ElementType;
  title?: string;
  hideForGuest?: boolean;
  hideForNonAdmin?: boolean;
  exact?: boolean;
};

const mainNav: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, title: 'Home', exact: true },
  { to: '/maps', label: 'Map Hub', icon: Map, title: 'Map Hub' },
  { to: '/daily', label: 'Daily', icon: Calendar, title: 'Daily', hideForGuest: true },
  { to: '/campaign', label: 'Campaign', icon: Swords, title: 'Campaign', hideForGuest: true },
  { to: '/store', label: 'Store', icon: ShoppingBag, title: 'Store', hideForGuest: true },
  { to: '/leaderboards', label: 'Leaderboards', icon: Trophy, title: 'Leaderboards' },
  { to: '/live-games', label: 'Live', icon: Eye, title: 'Live' },
  { to: '/editor', label: 'Map Editor', icon: PenSquare, title: 'Map Editor', hideForGuest: true },
  { to: '/admin', label: 'Admin', icon: Shield, title: 'Admin', hideForNonAdmin: true },
];

export default function TopNavBar({ user, onLogout }: { user: any, onLogout: () => void }) {
  const location = useLocation();
  // Admin nav visibility is gated off the access-token claim, not the
  // persisted user.is_admin field — see selectIsAdminFromToken docstring.
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAdmin = selectIsAdminFromToken(accessToken);
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
          {mainNav.map(({ to, label, icon: Icon, title, hideForGuest, hideForNonAdmin, exact }) =>
            (!hideForGuest || !user?.is_guest) && (!hideForNonAdmin || isAdmin) && (
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
        <Link
          to="/profile"
          className={isActive('/profile') ? `${styles.navLink} ${styles.active}` : styles.navLink}
          aria-current={isActive('/profile') ? 'page' : undefined}
          title="Profile"
        >
          <User className={styles.icon} /> {user?.username ?? 'Profile'}
        </Link>
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
        <Link
          to="/privacy"
          className={isActive('/privacy') ? `${styles.navLink} ${styles.active}` : styles.navLink}
          aria-current={isActive('/privacy') ? 'page' : undefined}
          title="Privacy"
        >
          <FileText className={styles.icon} /> Privacy
        </Link>
        <Link
          to="/how-to-play"
          className={isActive('/how-to-play') ? `${styles.navLink} ${styles.active}` : styles.navLink}
          aria-current={isActive('/how-to-play') ? 'page' : undefined}
          title="How to Play"
        >
          <HelpCircle className={styles.icon} /> Help
        </Link>
        <button type="button" onClick={onLogout} className={styles.navLink + ' hover:text-red-400'} title="Logout">
          <LogOut className={styles.icon} /> Logout
        </button>
      </div>
    </nav>
  );
}
