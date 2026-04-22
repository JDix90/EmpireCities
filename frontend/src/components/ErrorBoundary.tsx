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
      return (
        <div className="min-h-screen bg-cc-dark flex items-center justify-center px-6">
          <div className="text-center max-w-md">
            <p className="font-display text-2xl text-cc-gold tracking-widest mb-4">Something went wrong</p>
            <p className="text-cc-muted text-sm mb-6">
              An unexpected error occurred. Refresh the page to continue.
            </p>
            {this.state.error && (
              <pre className="text-xs text-red-400 bg-cc-surface rounded-lg p-4 text-left overflow-auto mb-6">
                {this.state.error.message}
              </pre>
            )}
            <button
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
