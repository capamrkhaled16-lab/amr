import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, RefreshCw, AlertTriangle, CheckCircle, DollarSign } from 'lucide-react';
import {
  fetchAllStudents, fetchAccountingCycles, fetchUnaccountedPayments,
} from '@/lib/data';
import type { AccountingCycle, Payment } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';

type Scope = 'all' | 'student' | 'group' | 'stage' | 'grade';

export default function FinancialInvestigation() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<{ id: string; name: string; group_id: string | null; group_name?: string; stage_name?: string; grade_name?: string; total_fees: number; paid_fees: number; is_exempt: boolean }[]>([]);
  const [cycles, setCycles] = useState<AccountingCycle[]>([]);
  const [unaccounted, setUnaccounted] = useState<{ payments: Payment[]; total: number }>({ payments: [], total: 0 });
  const [scope, setScope] = useState<Scope>('all');
  const [selectedStudent, setSelectedStudent] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [result, setResult] = useState<{ totalRecorded: number; totalAccounted: number; difference: number; unaccountedPayments: Payment[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, u] = await Promise.all([fetchAllStudents(), fetchAccountingCycles(), fetchUnaccountedPayments()]);
      setStudents(s as typeof students);
      setCycles(c);
      setUnaccounted(u);
    } catch {
      showToast('تعذّر تحميل البيانات', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const groups = [...new Set(students.map((s) => s.group_name).filter(Boolean))] as string[];

  function runInvestigation() {
    let filteredStudents = students;
    if (scope === 'student' && selectedStudent) {
      filteredStudents = students.filter((s) => s.id === selectedStudent);
    } else if (scope === 'group' && selectedGroup) {
      filteredStudents = students.filter((s) => s.group_name === selectedGroup);
    } else if (scope === 'stage') {
      filteredStudents = students.filter((s) => s.stage_name === selectedGroup);
    } else if (scope === 'grade') {
      filteredStudents = students.filter((s) => s.grade_name === selectedGroup);
    }

    const studentIds = new Set(filteredStudents.map((s) => s.id));

    // Total recorded payments for these students
    const totalRecorded = filteredStudents.reduce((sum, s) => sum + (s.paid_fees ?? 0), 0);

    // Total accounted — from cycles' payment_ids
    let totalAccounted = 0;
    const accountedPaymentIds = new Set<string>();
    for (const c of cycles) {
      for (const pid of c.payment_ids ?? []) accountedPaymentIds.add(pid);
    }

    // Unaccounted payments for these students
    const unaccountedForStudents = unaccounted.payments.filter((p) => studentIds.has(p.student_id));
    const unaccountedTotal = unaccountedForStudents.reduce((sum, p) => sum + (p.amount ?? 0), 0);

    setResult({
      totalRecorded,
      totalAccounted: totalRecorded - unaccountedTotal,
      difference: unaccountedTotal,
      unaccountedPayments: unaccountedForStudents,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search size={20} className="text-sky-400" />
        <h3 className="text-base font-bold text-white">مراجعة المحاسبة — التحقق من المبالغ</h3>
      </div>

      {/* Scope selector */}
      <div className="glass-card rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['all', 'student', 'group', 'stage', 'grade'] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${scope === s ? 'bg-sky-600 text-white' : 'glass-light text-slate-400 hover:bg-white/10'}`}
            >
              {s === 'all' ? 'الكل' : s === 'student' ? 'طالب' : s === 'group' ? 'مجموعة' : s === 'stage' ? 'مرحلة' : 'صف'}
            </button>
          ))}
        </div>

        {scope === 'student' && (
          <select value={selectedStudent} onChange={(e) => setSelectedStudent(e.target.value)} className="w-full glass-light rounded-lg px-3 py-2 text-sm text-white border border-slate-700/50 focus:outline-none">
            <option value="">اختر طالب...</option>
            {students.map((s) => (
              <option key={s.id} value={s.id} className="bg-slate-900">{s.name} — {s.group_name}</option>
            ))}
          </select>
        )}

        {(scope === 'group' || scope === 'stage' || scope === 'grade') && (
          <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)} className="w-full glass-light rounded-lg px-3 py-2 text-sm text-white border border-slate-700/50 focus:outline-none">
            <option value="">اختر {scope === 'group' ? 'مجموعة' : scope === 'stage' ? 'مرحلة' : 'صف'}...</option>
            {groups.map((g) => (
              <option key={g} value={g} className="bg-slate-900">{g}</option>
            ))}
          </select>
        )}

        <button
          onClick={runInvestigation}
          disabled={scope !== 'all' && !selectedStudent && !selectedGroup}
          className="w-full py-2 rounded-lg bg-sky-600 text-white text-sm font-bold hover:bg-sky-700 transition disabled:opacity-50"
        >
          تشغيل المراجعة
        </button>
      </div>

      {/* Results */}
      {result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="glass-card rounded-xl p-3 text-center">
              <DollarSign size={16} className="mx-auto text-emerald-400 mb-1" />
              <p className="text-[10px] text-slate-400">إجمالي المسجل</p>
              <p className="text-sm font-bold text-white">{result.totalRecorded} ج.م</p>
            </div>
            <div className="glass-card rounded-xl p-3 text-center">
              <CheckCircle size={16} className="mx-auto text-sky-400 mb-1" />
              <p className="text-[10px] text-slate-400">المحاسب منه</p>
              <p className="text-sm font-bold text-sky-400">{result.totalAccounted} ج.م</p>
            </div>
            <div className="glass-card rounded-xl p-3 text-center">
              <AlertTriangle size={16} className="mx-auto text-amber-400 mb-1" />
              <p className="text-[10px] text-slate-400">غير محاسب</p>
              <p className="text-sm font-bold text-amber-400">{result.difference} ج.م</p>
            </div>
          </div>

          {result.difference > 0 ? (
            <div className="glass-card rounded-xl p-4 border border-amber-500/30">
              <p className="text-sm font-bold text-amber-400 mb-2">فرق محاسبي: {result.difference} ج.م</p>
              <p className="text-xs text-slate-400 mb-3">{result.unaccountedPayments.length} دفعة غير مدرجة في دورات المحاسبة:</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {result.unaccountedPayments.map((p) => {
                  const st = students.find((s) => s.id === p.student_id);
                  return (
                    <div key={p.id} className="glass-light rounded-lg p-2 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-white">{st?.name ?? 'غير معروف'}</p>
                        <p className="text-[10px] text-slate-500">{p.payment_date}</p>
                      </div>
                      <span className="text-sm font-bold text-amber-400">{p.amount} ج.م</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="glass-card rounded-xl p-4 text-center border border-emerald-500/30">
              <CheckCircle className="mx-auto text-emerald-400 mb-2" size={32} />
              <p className="text-sm text-emerald-400 font-bold">لا يوجد فرق محاسبي — جميع الدفعات محاسب عليها</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
