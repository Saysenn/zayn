import { Component } from 'react';
import Button from '../buttons/Button';

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
        <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-bold text-danger mb-2">Something broke</h1>
          <p className="text-sm text-text-muted mb-4">
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <Button variant="primary" size="md" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
