import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { lockBodyScroll, unlockBodyScroll, resetBodyScrollLock } from '@/lib/bodyScrollLock';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  zIndex?: number;
};

const sizeMap = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export default function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  zIndex = 100000,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    setMounted(true);
    return () => {
      resetBodyScrollLock();
      document.body.style.overflow = '';
      // Only remove THIS modal's portal backdrop, not all of them
      const ownBackdrop = document.querySelector('[data-portal-backdrop]');
      if (ownBackdrop && !ownBackdrop.querySelector('.glass-card, .premium-card')) {
        ownBackdrop.remove();
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      scrollRef.current = window.scrollY;
      lockBodyScroll();
      return () => { unlockBodyScroll(); };
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div data-portal-backdrop>
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 flex items-center justify-center p-3 sm:p-4 pointer-events-none`}
          style={{ zIndex }}
        >
          <div
            className="absolute inset-0 bg-black/60 pointer-events-auto"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={`glass-card premium-card relative w-full ${sizeMap[size]} rounded-3xl max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto`}
          >
            {title && (
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/[0.05] flex-shrink-0 sticky top-0 z-10 bg-white/[0.02]">
                <h3 className="text-sm sm:text-base font-bold text-white truncate tracking-tight">{title}</h3>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/[0.08] text-slate-400 hover:text-white transition-all active:scale-90 flex-shrink-0 premium-interactive"
                  aria-label="إغلاق"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <div className="p-4 sm:p-6 overflow-y-auto modal-body premium-scroll">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>,
    document.body
  );
}
