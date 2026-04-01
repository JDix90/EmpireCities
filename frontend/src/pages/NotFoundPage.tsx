import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function NotFoundPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <div className="min-h-screen bg-cc-dark flex items-center justify-center text-center px-4">
      <div>
        <Link to={isAuthenticated ? '/lobby' : '/'} className="font-display text-2xl text-cc-gold tracking-widest hover:text-white transition-colors">
          CHRONOCONQUEST
        </Link>
        <h1 className="font-display text-8xl text-cc-gold mb-4 mt-8">404</h1>
        <h2 className="font-display text-2xl text-cc-text mb-4">Territory Not Found</h2>
        <p className="text-cc-muted mb-8">This land has not yet been conquered. Return to your command.</p>
        <Link to={isAuthenticated ? '/lobby' : '/'} className="btn-primary">Return to Base</Link>
      </div>
    </div>
  );
}
