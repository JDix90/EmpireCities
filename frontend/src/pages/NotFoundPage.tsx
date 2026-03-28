import React from 'react';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-cc-dark flex items-center justify-center text-center px-4">
      <div>
        <h1 className="font-display text-8xl text-cc-gold mb-4">404</h1>
        <h2 className="font-display text-2xl text-cc-text mb-4">Territory Not Found</h2>
        <p className="text-cc-muted mb-8">This land has not yet been conquered. Return to your command.</p>
        <Link to="/" className="btn-primary">Return to Base</Link>
      </div>
    </div>
  );
}
