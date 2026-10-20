import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'pwa_install_dismissed';
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000;

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - parseInt(dismissed, 10) < DISMISS_DURATION) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShow(true), 3000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      setDeferredPrompt(null);
      setShow(false);
    });
  }

  function handleDismiss() {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  }

  if (!show || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-[100001] animate-slide-up pointer-events-none">
      <div className="glass-card premium-card rounded-2xl p-4 flex items-center gap-3 shadow-glass-lg pointer-events-auto">
        <div className="w-10 h-10 rounded-xl bg-[#d4af37]/15 border border-[#d4af37]/25 flex items-center justify-center flex-shrink-0">
          <Download size={20} className="text-[#d4af37]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">تثبيت المنصة</p>
          <p className="text-xs text-slate-400 mt-0.5">أضف منصة الخالد إلى شاشتك الرئيسية للوصول السريع</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleInstall}
            className="px-3 py-1.5 rounded-lg bg-[#d4af37] text-black text-xs font-bold hover:bg-[#e5c65a] transition active:scale-95 min-h-[36px]"
          >
            تثبيت
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 transition min-h-[36px] min-w-[36px] flex items-center justify-center"
            aria-label="إغلاق"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
