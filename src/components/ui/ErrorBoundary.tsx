import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

type Props = { children: ReactNode; fallbackTitle?: string; fullPage?: boolean };
type State = { hasError: boolean; error: Error | null };

function clearStaleCache() {
  try {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('sb-') || key.startsWith('supabase.') || key === 'app-version') {
        localStorage.removeItem(key);
      }
    });
  } catch {
    /* ignore */
  }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    const msg = error.message ?? "";
    // Supabase realtime internal socket noise — not a real app crash
    if (msg.includes("Connect confirmed object to primitive value")) {
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  handleReset = () => {
    clearStaleCache();
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    clearStaleCache();
    window.location.reload();
  };

  handleHome = () => {
    clearStaleCache();
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const fullPage = this.props.fullPage;
    const containerCls = fullPage
      ? 'min-h-screen flex items-center justify-center p-4 bg-[#080808]'
      : 'glass-card rounded-2xl p-8 text-center max-w-md mx-auto mt-8';

    return (
      <div className={containerCls}>
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="text-red-400" size={32} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">
            {this.props.fallbackTitle ?? 'حدث خطأ غير متوقع'}
          </h3>
          <p className="text-sm text-slate-400 mb-2">
            تعذّر تحميل {fullPage ? 'المنصة' : 'هذا القسم'}. برجاء المحاولة مرة أخرى.
          </p>
          {this.state.error && (
            <p className="text-xs text-slate-600 mb-4 font-mono break-all max-h-24 overflow-y-auto bg-slate-900/50 rounded-lg p-2">
              {this.state.error.message}
            </p>
          )}
          <div className="flex gap-2 justify-center flex-wrap">
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition active:scale-95"
            >
              <RefreshCw size={16} /> إعادة المحاولة
            </button>
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-bold hover:bg-slate-600 transition active:scale-95"
            >
              <RefreshCw size={16} /> إعادة تحميل الصفحة
            </button>
            {fullPage && (
              <button
                onClick={this.handleHome}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm font-bold hover:bg-slate-700 transition active:scale-95"
              >
                <Home size={16} /> الصفحة الرئيسية
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
