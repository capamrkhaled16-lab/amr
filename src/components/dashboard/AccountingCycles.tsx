import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Calculator, Plus, RefreshCw, Lock, CheckCircle, Clock,
  TrendingUp, Wallet
} from 'lucide-react';
import {
  fetchAccountingCycles, createAccountingCycle, closeAccountingCycle,
  fetchUnaccountedPayments,
} from '@/lib/data';
import type { AccountingCycle } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

export default function AccountingCycles() {
  const { showToast } = useToast();
  const [cycles, setCycles] = useState<AccountingCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [unaccounted, setUnaccounted] = useState<{ payments: { id: string; student_id: string; amount: number; payment_date: string }[]; total: number }>({ payments: [], total: 0 });
  const [form, setForm] = useState({ startDate: '', endDate: '' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, u] = await Promise.all([fetchAccountingCycles(), fetchUnaccountedPayments()]);
      setCycles(c);
      setUnaccounted(u);
    } catch {
      showToast('تعذّر تحميل دورات المحاسبة', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!form.startDate || !form.endDate) return;
    setCreating(true);
    try {
      const cycle = await createAccountingCycle(form.startDate, form.endDate, 'المدرس');
      if (cycle) {
        showToast(`تم إنشاء دورة المحاسبة رقم ${cycle.cycle_number}`, 'success');
        setShowCreate(false);
        setForm({ startDate: '', endDate: '' });
        await load();
      } else {
        showToast('تعذّر إنشاء دورة المحاسبة', 'error');
      }
    } catch {
      showToast('تعذّر إنشاء دورة المحاسبة', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleClose(id: string) {
    try {
      await closeAccountingCycle(id);
      showToast('تم إغلاق دورة المحاسبة', 'success');
      await load();
    } catch {
      showToast('تعذّر إغلاق الدورة', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Calculator size={20} className="text-emerald-400" />
          <h3 className="text-base font-bold text-white">المحاسبة — دورات المحاسبة</h3>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="p-2 glass-light rounded-lg text-slate-400 hover:text-white transition">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> دورة جديدة
          </Button>
        </div>
      </div>

      {/* Unaccounted summary */}
      <div className="glass-card rounded-xl p-4 border border-amber-500/30">
        <div className="flex items-center gap-2 mb-1">
          <Wallet size={16} className="text-amber-400" />
          <span className="text-sm font-bold text-amber-400">دفعات غير محاسب عليها</span>
        </div>
        <p className="text-2xl font-bold text-white">{unaccounted.total} <span className="text-sm text-slate-400">ج.م</span></p>
        <p className="text-xs text-slate-400 mt-1">{unaccounted.payments.length} دفعة غير مدرجة في أي دورة محاسبة</p>
      </div>

      {/* Cycles list */}
      {cycles.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center">
          <Calculator className="mx-auto text-slate-600 mb-3" size={40} />
          <p className="text-sm text-slate-400">لا توجد دورات محاسبة بعد. أنشئ أول دورة محاسبة.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cycles.map((cycle, i) => (
            <motion.div
              key={cycle.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cycle.status === 'closed' ? 'bg-slate-700' : 'bg-emerald-600/20'}`}>
                    {cycle.status === 'closed'
                      ? <Lock size={16} className="text-slate-400" />
                      : <Calculator size={16} className="text-emerald-400" />}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">دورة محاسبة رقم {cycle.cycle_number}</p>
                    <p className="text-xs text-slate-400">{cycle.start_date} ← {cycle.end_date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {cycle.status === 'closed' ? (
                    <span className="px-2 py-1 rounded-lg bg-slate-700/50 text-slate-400 text-xs font-bold flex items-center gap-1">
                      <Lock size={12} /> مغلقة
                    </span>
                  ) : (
                    <button
                      onClick={() => handleClose(cycle.id)}
                      className="px-2 py-1 rounded-lg bg-emerald-600/20 text-emerald-400 text-xs font-bold hover:bg-emerald-600/30 transition flex items-center gap-1"
                    >
                      <CheckCircle size={12} /> إغلاق
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="glass-light rounded-lg p-2 text-center">
                  <p className="text-[10px] text-slate-400">إجمالي المبلغ</p>
                  <p className="text-sm font-bold text-white">{cycle.total_amount} ج.م</p>
                </div>
                <div className="glass-light rounded-lg p-2 text-center">
                  <p className="text-[10px] text-slate-400">المحاسب منه</p>
                  <p className="text-sm font-bold text-emerald-400">{cycle.accounted_amount} ج.م</p>
                </div>
                <div className="glass-light rounded-lg p-2 text-center">
                  <p className="text-[10px] text-slate-400">المتبقي</p>
                  <p className="text-sm font-bold text-amber-400">{cycle.remaining_amount} ج.م</p>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <Clock size={12} />
                <span>أُنشئت في {new Date(cycle.created_at).toLocaleDateString('ar-EG')}</span>
                <span>•</span>
                <span>{cycle.payment_ids.length} دفعة</span>
                {cycle.status === 'closed' && cycle.closed_at && (
                  <>
                    <span>•</span>
                    <span>أُغلقت في {new Date(cycle.closed_at).toLocaleDateString('ar-EG')}</span>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create cycle modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="إنشاء دورة محاسبة جديدة" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">تاريخ البداية</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="w-full glass-light rounded-lg px-3 py-2 text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">تاريخ النهاية</label>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              className="w-full glass-light rounded-lg px-3 py-2 text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
          </div>
          {form.startDate && form.endDate && (
            <div className="glass-light rounded-lg p-3 text-xs text-slate-400">
              <TrendingUp size={14} className="inline text-emerald-400 mb-0.5 ml-1" />
              سيتم تضمين جميع الدفعات من {form.startDate} إلى {form.endDate} في هذه الدورة.
              الدفعات المضافة لاحقاً ستبقى غير محاسب عليها.
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>إلغاء</Button>
            <Button onClick={handleCreate} disabled={!form.startDate || !form.endDate || creating}>
              {creating ? 'جاري الإنشاء...' : 'إنشاء الدورة'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
