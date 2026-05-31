import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      // Only surface the raw error.message in development. In production it
      // routinely contains internal context (component names, stack hints,
      // even API response bodies) that doesn't help end users and creates a
      // pasteable signal for support / griefing screenshots.
      const showDetails = import.meta.env.DEV && this.state.error;
      return (
        <div className="min-h-screen bg-bf-dark flex items-center justify-center px-6">
          <div className="text-center max-w-md">
            <p className="font-display text-2xl text-bf-gold tracking-widest mb-4">Something went wrong</p>
            <p className="text-bf-muted text-sm mb-6">
              An unexpected error occurred. Refresh the page to continue. If the problem
              persists, try clearing your browser cache for this site.
            </p>
            {showDetails && (
              <pre className="text-xs text-red-400 bg-bf-surface rounded-lg p-4 text-left overflow-auto mb-6">
                {this.state.error?.message}
              </pre>
            )}
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button
                className="btn-primary"
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  window.location.assign('/');
                }}
              >
                Go to home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
