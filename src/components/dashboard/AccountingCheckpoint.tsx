import { useState, useMemo, useCallback, useEffect } from 'react';
import { CheckCircle2, Calendar, X, TrendingUp, Wallet, Banknote } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatArabicDate, todayDateString } from '@/lib/format';
import { usePersistedState } from '@/hooks/usePersistedState';

type Props = {
  /** When true, renders as a compact summary card (for archive header). When false, just the button. */
  variant?: 'card' | 'button';
};

type PaymentRow = {
  id: string;
  amount: number;
  payment_date: string;
  recorded_at: string | null;
  recorded_by: string | null;
  is_deleted: boolean;
};

export default function AccountingCheckpoint({ variant = 'card' }: Props) {
  const [accountingDate, setAccountingDate] = usePersistedState<string>('accounting_checkpoint_date', '');
  const [accountedAmount, setAccountedAmount] = usePersistedState<string>('accounting_checkpoint_amount', '');
  const [showModal, setShowModal] = useState(false);
  const [beforeTotal, setBeforeTotal] = useState<number | null>(null);
  const [afterTotal, setAfterTotal] = useState<number | null>(null);
  const [beforeCount, setBeforeCount] = useState(0);
  const [afterCount, setAfterCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchTotals = useCallback(async (date: string) => {
    if (!date) {
      setBeforeTotal(null);
      setAfterTotal(null);
      setBeforeCount(0);
      setAfterCount(0);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('id, amount, payment_date, is_deleted')
        .eq('is_deleted', false)
        .gt('amount', 0);
      if (error) throw error;
      const rows = (data ?? []) as PaymentRow[];
      let before = 0;
      let after = 0;
      let bCount = 0;
      let aCount = 0;
      for (const r of rows) {
        if (r.payment_date <= date) {
          before += r.amount;
          bCount++;
        } else {
          after += r.amount;
          aCount++;
        }
      }
      setBeforeTotal(before);
      setAfterTotal(after);
      setBeforeCount(bCount);
      setAfterCount(aCount);
    } catch {
      setBeforeTotal(null);
      setAfterTotal(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showModal && accountingDate) {
      void fetchTotals(accountingDate);
    }
  }, [showModal, accountingDate, fetchTotals]);

  const hasDate = !!accountingDate;
  const accountedNum = parseFloat(accountedAmount) || 0;
  // "Since last accounting" = payments after the checkpoint date only,
  // NOT including the already-accounted amount.
  const sinceLast = afterTotal ?? 0;

  if (variant === 'button') {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 transition text-xs font-bold flex-shrink-0"
          title="نقطة المحاسبة"
        >
          <CheckCircle2 size={12} />
          {hasDate ? `محاسبة حتى ${formatArabicDate(accountingDate)}` : 'محاسبة'}
        </button>
        {showModal && (
          <AccountingModal
            accountingDate={accountingDate}
            setAccountingDate={setAccountingDate}
            accountedAmount={accountedAmount}
            setAccountedAmount={setAccountedAmount}
            onClose={() => setShowModal(false)}
            beforeTotal={beforeTotal}
            afterTotal={afterTotal}
            beforeCount={beforeCount}
            afterCount={afterCount}
            loading={loading}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="glass-card rounded-2xl p-4 border border-emerald-500/20">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="text-emerald-400" size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">نقطة المحاسبة</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {hasDate ? (
                  <>تمت المحاسبة حتى تاريخ: <span className="font-bold text-emerald-400">{formatArabicDate(accountingDate)}</span></>
                ) : (
                  <>لم يتم تحديد تاريخ المحاسبة بعد</>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-light hover:bg-emerald-500/10 text-slate-300 hover:text-emerald-400 transition text-xs font-bold flex-shrink-0"
          >
            <Calendar size={14} />
            {hasDate ? 'تغيير' : 'تحديد التاريخ'}
          </button>
        </div>

        {hasDate && beforeTotal !== null && afterTotal !== null && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div className="glass-light rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Wallet size={12} className="text-slate-400" />
                <p className="text-[10px] text-slate-400">الإيرادات (حتى {formatArabicDate(accountingDate)})</p>
              </div>
              <p className="text-sm font-bold text-white">
                {loading ? '…' : `${formatCurrency(beforeTotal)} ج.م`}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">{loading ? '' : `${beforeCount} عملية`}</p>
            </div>
            <div className="glass-light rounded-xl p-3 border border-emerald-500/20">
              <div className="flex items-center gap-1.5 mb-1">
                <Banknote size={12} className="text-emerald-400" />
                <p className="text-[10px] text-emerald-400">المبلغ المُحاسب (المسحوب)</p>
              </div>
              <p className="text-sm font-bold text-emerald-400">
                {accountedNum > 0 ? `${formatCurrency(accountedNum)} ج.م` : '—'}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">{accountedNum > 0 && beforeTotal !== null ? `متبقي غير محاسب: ${formatCurrency(Math.max(0, beforeTotal - accountedNum))} ج.م` : ''}</p>
            </div>
            <div className="glass-light rounded-xl p-3 border border-amber-500/20">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp size={12} className="text-amber-400" />
                <p className="text-[10px] text-amber-400">منذ آخر محاسبة (جديد)</p>
              </div>
              <p className="text-sm font-bold text-amber-400">
                {loading ? '…' : `${formatCurrency(sinceLast)} ج.م`}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">{loading ? '' : `${afterCount} عملية`}</p>
            </div>
          </div>
        )}

        {hasDate && (
          <p className="text-[10px] text-slate-500 mt-2">
            يتم تسجيل المبلغ الفعلي المسحوب/المُحاسب، وتبدأ خانة "منذ آخر محاسبة" في التجميع من الصفر للمدفوعات الجديدة فقط.
          </p>
        )}
      </div>

      {showModal && (
        <AccountingModal
          accountingDate={accountingDate}
          setAccountingDate={setAccountingDate}
          accountedAmount={accountedAmount}
          setAccountedAmount={setAccountedAmount}
          onClose={() => setShowModal(false)}
          beforeTotal={beforeTotal}
          afterTotal={afterTotal}
          beforeCount={beforeCount}
          afterCount={afterCount}
          loading={loading}
        />
      )}
    </>
  );
}

function AccountingModal({
  accountingDate,
  setAccountingDate,
  accountedAmount,
  setAccountedAmount,
  onClose,
  beforeTotal,
  afterTotal,
  beforeCount,
  afterCount,
  loading,
}: {
  accountingDate: string;
  setAccountingDate: (v: string) => void;
  accountedAmount: string;
  setAccountedAmount: (v: string) => void;
  onClose: () => void;
  beforeTotal: number | null;
  afterTotal: number | null;
  beforeCount: number;
  afterCount: number;
  loading: boolean;
}) {
  const [amountInput, setAmountInput] = useState(accountedAmount);
  const accountedNum = parseFloat(amountInput) || 0;
  const unaccounted = beforeTotal !== null ? Math.max(0, beforeTotal - accountedNum) : 0;

  return (
    <div className="fixed inset-0 z-[100003] flex items-center justify-center p-4 pointer-events-none" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
      <div className="relative w-full max-w-sm glass-card rounded-2xl shadow-glass-lg overflow-hidden pointer-events-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-400" />
              <h3 className="text-sm font-bold text-white">نقطة المحاسبة</h3>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition">
              <X size={16} />
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">حدد تاريخ المحاسبة والمبلغ الفعلي المسحوب — لا يتم حذف أو تعديل أي سجل دفع.</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          {accountingDate && (
            <div className="glass-light rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400">تمت المحاسبة حتى</p>
              <p className="text-sm font-bold text-emerald-400 mt-1">{formatArabicDate(accountingDate)}</p>
            </div>
          )}
          <label className="block text-xs text-slate-400">تاريخ المحاسبة</label>
          <input
            type="date"
            value={accountingDate}
            onChange={(e) => setAccountingDate(e.target.value)}
            max={todayDateString()}
            className="w-full glass-light rounded-xl p-3 text-sm text-white text-center border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            style={{ colorScheme: 'dark' }}
          />
          {accountingDate && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">المبلغ الفعلي المسحوب / المُحاسب (ج.م)</label>
              <input
                type="number"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0"
                min="0"
                autoFocus
                className="w-full glass-light rounded-xl p-3 text-sm text-white text-center border border-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              />
              {beforeTotal !== null && accountedNum > 0 && (
                <p className="text-[10px] text-slate-400 mt-1.5 text-center">
                  إجمالي الإيرادات: {formatCurrency(beforeTotal)} ج.م • المتبقي غير محاسب: <span className="font-bold text-amber-400">{formatCurrency(unaccounted)} ج.م</span>
                </p>
              )}
            </div>
          )}
          {accountingDate && beforeTotal !== null && afterTotal !== null && (
            <div className="space-y-2 pt-2">
              <div className="glass-light rounded-xl p-3">
                <p className="text-[10px] text-slate-400 mb-1">الإيرادات (قبل التاريخ)</p>
                <p className="text-sm font-bold text-white">
                  {loading ? '…' : `${beforeCount} عملية · ${formatCurrency(beforeTotal)} ج.م`}
                </p>
              </div>
              <div className="glass-light rounded-xl p-3 border border-amber-500/20">
                <p className="text-[10px] text-amber-400 mb-1">منذ آخر محاسبة (جديد — يبدأ من الصفر)</p>
                <p className="text-sm font-bold text-amber-400">
                  {loading ? '…' : `${afterCount} عملية · ${formatCurrency(afterTotal ?? 0)} ج.م`}
                </p>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            {accountingDate && (
              <button
                onClick={() => { setAccountingDate(''); setAccountedAmount(''); setAmountInput(''); onClose(); }}
                className="px-4 py-2.5 rounded-xl glass-light text-red-400 text-sm font-bold hover:bg-red-500/10 transition active:scale-95"
              >
                مسح
              </button>
            )}
            <button
              onClick={() => { setAccountedAmount(amountInput); onClose(); }}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition active:scale-95"
            >
              حفظ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
