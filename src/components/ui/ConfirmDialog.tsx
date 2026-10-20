import { type ReactNode, useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import Button from './Button';

type ConfirmDialogProps = {
  open: boolean;
  onClose?: () => void;
  onConfirm: () => void;
  onCancel?: () => void;
  title: string;
  subtext?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  danger?: boolean;
  loading?: boolean;
};

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  onCancel,
  title,
  subtext,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  variant,
  danger,
  loading = false,
}: ConfirmDialogProps) {
  const confirmedRef = useRef(false);
  useEffect(() => {
    if (open) confirmedRef.current = false;
  }, [open]);
  const handleConfirm = () => {
    if (confirmedRef.current || loading) return;
    confirmedRef.current = true;
    onConfirm();
  };
  const handleClose = () => { if (loading) return; if (onCancel) onCancel(); onClose?.(); };
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100100] flex items-center justify-center p-4 pointer-events-none"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md pointer-events-auto" onClick={handleClose} aria-hidden="true" />
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 16 }}
            transition={{ type: 'spring', damping: 28, stiffness: 340 }}
            className="glass-card premium-card relative w-full max-w-md rounded-3xl p-6 sm:p-7 text-center pointer-events-auto"
          >
            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-500/8 border border-red-400/15 flex items-center justify-center mb-5">
              <AlertTriangle className="text-red-400" size={26} />
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-white mb-2 tracking-tight">{title}</h3>
            {(subtext || message) && (
              <p className="text-sm text-slate-400 mb-6 leading-relaxed">{subtext ?? message}</p>
            )}
            <div className="flex gap-3 flex-col-reverse sm:flex-row">
              <Button variant="secondary" onClick={handleClose} className="flex-1 w-full sm:w-auto py-3 sm:py-2" disabled={loading}>
                {cancelLabel}
              </Button>
              <Button variant={danger || variant === 'danger' ? 'danger' : 'primary'} onClick={handleConfirm} className="flex-1 w-full sm:w-auto py-3 sm:py-2" loading={loading}>
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
