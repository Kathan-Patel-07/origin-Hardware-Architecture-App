import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Contains a canvas failure — a render error, or the lazy chunk failing to load after a
 * deploy or while offline — to the Canvas tab. Without it React unmounts the whole Studio,
 * taking unsaved catalog, inventory and connection edits with it.
 */
export class CanvasErrorBoundary extends Component<
  { children: ReactNode; /** Called on Retry, e.g. to re-create a lazy component whose load failed. */ onRetry?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Canvas failed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Browsers cache a failed module import for the life of the page (whatwg/html#6768), so a
    // chunk that failed to load cannot be retried in place - only a reload fetches it again.
    const chunkFailed = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(
      this.state.error.message,
    );
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
        <p className="text-sm font-semibold text-slate-700">The canvas failed to load.</p>
        <p className="text-xs text-slate-500 max-w-md break-words">{this.state.error.message}</p>
        <p className="text-xs text-slate-400">The rest of the Studio is unaffected.</p>
        {chunkFailed ? (
          <>
            <p className="text-xs text-slate-500 max-w-md">
              The canvas code could not be downloaded (offline, or the Studio was updated). Reloading
              the page fetches it again — <strong>save or discard any unsaved changes in other tabs first</strong>,
              because a reload drops them.
            </p>
            <button
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 hover:bg-slate-100"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </>
        ) : (
          <button
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 hover:bg-slate-100"
            onClick={() => {
              this.props.onRetry?.();
              this.setState({ error: null });
            }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }
}
