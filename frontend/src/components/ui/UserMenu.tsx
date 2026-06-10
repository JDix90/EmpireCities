import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { User, Settings, HelpCircle, FileText, LogOut, ChevronDown } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';

interface UserMenuProps {
  username: string;
  isGuest: boolean;
  onLogout: () => void;
  /** Class applied to the trigger so it matches sibling nav links. */
  triggerClassName: string;
  iconClassName: string;
}

/**
 * Account dropdown: collapses Profile/Settings/Help/Privacy/Logout into one
 * nav entry so the top bar stays focused on play destinations.
 */
export default function UserMenu({ username, isGuest, onLogout, triggerClassName, iconClassName }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEscapeClose(() => setOpen(false), open);

  // Close when clicking anywhere outside the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Navigating away always closes the menu.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const items = [
    { to: '/profile', label: 'Profile', icon: User },
    ...(isGuest ? [] : [{ to: '/settings', label: 'Settings', icon: Settings }]),
    { to: '/how-to-play', label: 'How to Play', icon: HelpCircle },
    { to: '/privacy', label: 'Privacy', icon: FileText },
  ];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Account"
      >
        <User className={iconClassName} /> {username}
        <ChevronDown className="w-3 h-3 ml-0.5" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-xl border border-bf-border bg-bf-surface shadow-xl py-1.5"
        >
          {items.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              role="menuitem"
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-bf-text hover:bg-white/5 hover:text-bf-gold"
            >
              <Icon className="w-4 h-4 text-bf-muted" aria-hidden /> {label}
            </Link>
          ))}
          <div className="my-1 border-t border-bf-border/70" />
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-bf-text hover:bg-red-500/10 hover:text-red-400 text-left"
          >
            <LogOut className="w-4 h-4 text-bf-muted" aria-hidden /> Logout
          </button>
        </div>
      )}
    </div>
  );
}
