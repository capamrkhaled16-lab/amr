import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, TrendingUp, TrendingDown, DollarSign, EyeOff, RefreshCw, X } from 'lucide-react';
import { fetchFinancialOverview } from '@/lib/data';
import { formatCurrency } from '@/lib/format';

type FinancialSummary = {
  expected: number;
  collected: number;
  remaining: number;
  activeStudents: number;
};

export default function SecretFinancialWidget({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchFinancialOverview();
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadSummary();
  }, [open, loadSummary]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100000] flex items-center justify-center p-4 pointer-events-none"
          onClick={() => onClose()}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 10 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-[22rem] max-w-[calc(100vw-2rem)] glass-card rounded-3xl border border-emerald-500/20 shadow-2xl shadow-black/50 overflow-hidden pointer-events-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-emerald-500/[0.04]">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                  <Wallet size={18} className="text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">الملخص المالي السري</h3>
                  <p className="text-[10px] text-slate-400">للمدرس فقط — نظرة لحظية</p>
                </div>
              </div>
              <button
                onClick={() => onClose()}
                className="p-2 rounded-xl hover:bg-white/10 text-slate-400 hover:text-red-400 transition active:scale-90"
                title="إخفاء فوري"
              >
                <EyeOff size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-slate-400">
                  <RefreshCw size={20} className="animate-spin" />
                  <span className="text-xs mr-2">جارٍ الحساب...</span>
                </div>
              ) : summary ? (
                <>
                  {/* Expected */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-blue-500/[0.06] border border-blue-500/15">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
                        <TrendingUp size={18} className="text-blue-400" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 font-medium">الإجمالي المتوقع</p>
                        <p className="text-[10px] text-slate-500">{summary.activeStudents} طالب × اشتراك الصف</p>
                      </div>
                    </div>
                    <p className="text-lg font-black text-blue-400">{formatCurrency(summary.expected)} <span className="text-[10px] font-normal text-slate-500">ج.م</span></p>
                  </div>

                  {/* Collected */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/15">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                        <DollarSign size={18} className="text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 font-medium">المحصّل فعلياً</p>
                        <p className="text-[10px] text-emerald-500/70">{summary.expected > 0 ? `${Math.round((summary.collected / summary.expected) * 100)}% من المتوقع` : '—'}</p>
                      </div>
                    </div>
                    <p className="text-lg font-black text-emerald-400">{formatCurrency(summary.collected)} <span className="text-[10px] font-normal text-slate-500">ج.م</span></p>
                  </div>

                  {/* Remaining */}
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-red-500/[0.06] border border-red-500/15">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                        <TrendingDown size={18} className="text-red-400" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 font-medium">المتبقي (متأخرات)</p>
                        <p className="text-[10px] text-red-400/70">{summary.expected > 0 ? `${Math.round((summary.remaining / summary.expected) * 100)}% من المتوقع` : '—'}</p>
                      </div>
                    </div>
                    <p className="text-lg font-black text-red-400">{formatCurrency(summary.remaining)} <span className="text-[10px] font-normal text-slate-500">ج.م</span></p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { setSummary(null); loadSummary(); }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl glass-light hover:bg-white/10 text-slate-400 text-xs font-semibold transition"
                    >
                      <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                      تحديث
                    </button>
                    <button
                      onClick={() => onClose()}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold transition"
                    >
                      <X size={13} />
                      إخفاء
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-center text-xs text-slate-400 py-8">لا توجد بيانات متاحة</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
