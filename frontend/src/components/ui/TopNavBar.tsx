import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  HelpCircle, Map, Calendar, ShoppingBag, PenSquare, Users, Trophy, Eye, User, FileText, Home, LogOut, Plus
} from 'lucide-react';
import styles from './TopNavBar.module.css';

type NavItem = {
  to: string;
  label: string;
  icon: React.ElementType;
  title?: string;
  hideForGuest?: boolean;
  exact?: boolean;
};

const mainNav: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, title: 'Home', exact: true },
  { to: '/new-game', label: 'New Game', icon: Plus, title: 'New Game' },
  { to: '/maps', label: 'Map Hub', icon: Map, title: 'Map Hub' },
  { to: '/daily', label: 'Daily', icon: Calendar, title: 'Daily', hideForGuest: true },
  { to: '/store', label: 'Store', icon: ShoppingBag, title: 'Store', hideForGuest: true },
  { to: '/leaderboards', label: 'Leaderboards', icon: Trophy, title: 'Leaderboards' },
  { to: '/live-games', label: 'Live', icon: Eye, title: 'Live' },
  { to: '/editor', label: 'Map Editor', icon: PenSquare, title: 'Map Editor', hideForGuest: true },
];

const accountNav: NavItem[] = [
  { to: '/profile', label: '', icon: User, title: 'Profile' },
  { to: '/friends', label: 'Friends', icon: Users, title: 'Friends', hideForGuest: true },
  { to: '/privacy', label: 'Privacy', icon: FileText, title: 'Privacy' },
  { to: '/how-to-play', label: 'Help', icon: HelpCircle, title: 'How to Play' },
];

export default function TopNavBar({ user, onLogout }: { user: any, onLogout: () => void }) {
  const location = useLocation();
  const isActive = (to: string, exact?: boolean) => {
    if (exact) return location.pathname === to;
    return location.pathname.startsWith(to) && to !== '/';
  };
  return (
    <nav className={styles.navBar}>
      {/* Logo/Brand */}
      <Link to="/lobby" className={styles.logo}>
        ERAS OF EMPIRE
      </Link>
      {/* Main nav groups */}
      <div className={styles.mainNav}>
        <div className={styles.navLinks}>
          {mainNav.map(({ to, label, icon: Icon, title, hideForGuest, exact }) =>
            (!hideForGuest || !user?.is_guest) && (
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
