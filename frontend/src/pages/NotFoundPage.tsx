import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useAuthStoreHydrated } from '../hooks/useAuthStoreHydrated';
import BrandWordmark from '../components/ui/BrandWordmark';

export default function NotFoundPage() {
  const hydrated = useAuthStoreHydrated();
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // While the auth store rehydrates and the silent-refresh bootstrap runs,
  // `isAuthenticated` flickers from false to true. Showing a "Return to Base"
  // CTA pointing at "/" for ~150ms before swapping it to "/lobby" is jarring
  // and routinely sends authenticated users back to the marketing landing.
  // Holding a neutral skeleton until the auth state settles avoids that.
  if (!hydrated || !bootstrapped) {
    return (
      <div
        className="min-h-screen bg-bf-dark flex items-center justify-center text-center px-4"
        role="status"
        aria-label="Loading"
      >
        <div className="space-y-3">
          <div className="h-12 w-44 bg-bf-border/50 rounded animate-pulse mx-auto" />
          <div className="h-4 w-72 bg-bf-border/30 rounded animate-pulse mx-auto" />
        </div>
      </div>
    );
  }

  const target = isAuthenticated ? '/lobby' : '/';
  return (
    <div className="min-h-screen bg-bf-dark flex items-center justify-center text-center px-4">
      <div>
        <BrandWordmark to={target} className="text-2xl" />
        <h1 className="font-display text-8xl text-bf-gold mb-4 mt-8">404</h1>
        <h2 className="font-display text-2xl text-bf-text mb-4">Territory Not Found</h2>
        <p className="text-bf-muted mb-8">This land has not yet been conquered. Return to your command.</p>
        <Link to={target} className="btn-primary">Return to Base</Link>
      </div>
    </div>
  );
}
