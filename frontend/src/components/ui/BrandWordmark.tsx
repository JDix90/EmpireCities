import React from 'react';
import { Link } from 'react-router-dom';
import { APP_NAME_NAV, APP_NAME_NAV_SHORT } from '../../constants/brand';

type BrandWordmarkProps = {
  to?: string;
  className?: string;
};

export default function BrandWordmark({ to = '/', className = '' }: BrandWordmarkProps) {
  const base =
    'font-display text-cc-gold tracking-widest hover:text-white transition-colors shrink-0';
  const merged = className ? `${base} ${className}` : base;

  return (
    <Link to={to} className={merged}>
      <span className="hidden sm:inline">{APP_NAME_NAV}</span>
      <span className="sm:hidden">{APP_NAME_NAV_SHORT}</span>
    </Link>
  );
}
