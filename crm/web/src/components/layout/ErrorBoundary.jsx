import { Component } from 'react';

// A render error anywhere below this unmounts to a blank white screen with
// no clue why — this is what turns that into a visible, actionable message
// instead. Class component on purpose: this is the one thing hooks still
// can't do (there's no useErrorBoundary).
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error caught by ErrorBoundary:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="w-full max-w-md bg-surface border border-border p-6">
          <h1 className="text-lg font-bold text-danger mb-2">Something broke</h1>
          <p className="text-sm text-text-muted mb-4">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
