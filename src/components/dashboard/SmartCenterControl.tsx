import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Users, TrendingDown, FileWarning, DollarSign,
  RefreshCw, ChevronLeft, ClipboardCheck
} from 'lucide-react';
import { fetchAllStudents, fetchDashboardKPIs, fetchUnaccountedPayments } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import type { Student } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';
import StudentViewModal from '@/components/ui/StudentViewModal';

type Alert = {
  id: string;
  type: 'follow_up' | 'absence' | 'missing_grades' | 'financial' | 'unaccounted';
  title: string;
  description: string;
  studentId?: string;
  studentName?: string;
  groupId?: string;
  groupName?: string;
  amount?: number;
  date?: string;
};

type Props = {
  allGroups: { id: string; name: string }[];
  onNavigate?: (tab: string) => void;
};

export default function SmartCenterControl({ onNavigate }: Props) {
  const { showToast } = useToast();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewTarget, setViewTarget] = useState<Student | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const newAlerts: Alert[] = [];
      const today = new Date().toISOString().slice(0, 10);

      const [studentsRes, kpis, unaccountedRes] = await Promise.all([
        fetchAllStudents(),
        fetchDashboardKPIs(),
        fetchUnaccountedPayments(),
      ]);

      const students = studentsRes;

      // 1. Students needing follow-up (unpaid)
      const debtors = students.filter((s) => !s.is_exempt && (s.total_fees ?? 0) - (s.paid_fees ?? 0) > 0);
      for (const s of debtors.slice(0, 10)) {
        newAlerts.push({
          id: `follow-${s.id}`,
          type: 'follow_up',
          title: 'متابعة مالية',
          description: `${s.name} — مبلغ متبقي ${(s.total_fees ?? 0) - (s.paid_fees ?? 0)} ج.م`,
          studentId: s.id,
          studentName: s.name,
          groupName: s.group_name,
          amount: (s.total_fees ?? 0) - (s.paid_fees ?? 0),
        });
      }

      // 2. Groups with increased absence — check today's attendance
      try {
        const { data: todayAttendance } = await supabase
          .from('attendance')
          .select('student_id, status, group_id')
          .eq('attendance_date', today)
          .in('status', ['absent', 'excused_absence']);
        const absentByGroup: Record<string, number> = {};
        for (const a of (todayAttendance ?? []) as { student_id: string; status: string; group_id: string | null }[]) {
          const gName = students.find((s) => s.id === a.student_id)?.group_name ?? '';
          absentByGroup[gName] = (absentByGroup[gName] ?? 0) + 1;
        }
        for (const [gName, count] of Object.entries(absentByGroup)) {
          if (count >= 3) {
            newAlerts.push({
              id: `absence-${gName}`,
              type: 'absence',
              title: 'زيادة الغياب',
              description: `${count} طالب غائب اليوم في ${gName}`,
              groupName: gName,
              date: today,
            });
          }
        }
      } catch { /* attendance optional */ }

      // 3. Missing academic records — students with no grades at all
      try {
        const { data: gradeCount } = await supabase
          .from('center_grades')
          .select('student_id');
        const studentsWithGrades = new Set((gradeCount ?? []).map((g: { student_id: string }) => g.student_id));
        const noGrades = students.filter((s) => !studentsWithGrades.has(s.id));
        for (const s of noGrades.slice(0, 5)) {
          newAlerts.push({
            id: `no-grades-${s.id}`,
            type: 'missing_grades',
            title: 'درجات ناقصة',
            description: `${s.name} — لا توجد درجات مسجلة`,
            studentId: s.id,
            studentName: s.name,
            groupName: s.group_name,
          });
        }
      } catch { /* grades optional */ }

      // 4. Pending financial amounts
      const totalRemaining = kpis.fees.remaining;
      if (totalRemaining > 0) {
        newAlerts.push({
          id: 'pending-financial',
          type: 'financial',
          title: 'مبالغ معلقة',
          description: `إجمالي المبالغ المتبقية: ${totalRemaining} ج.م`,
          amount: totalRemaining,
        });
      }

      // 5. Unaccounted payments
      if (unaccountedRes.payments.length > 0) {
        newAlerts.push({
          id: 'unaccounted',
          type: 'unaccounted',
          title: 'دفعات غير محاسب عليها',
          description: `${unaccountedRes.payments.length} دفعة بمبلغ ${unaccountedRes.total} ج.م غير مدرجة في محاسبة`,
          amount: unaccountedRes.total,
        });
      }

      setAlerts(newAlerts);
    } catch {
      showToast('تعذّر تحميل بيانات المتابعة', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const iconForType = (type: Alert['type']) => {
    switch (type) {
      case 'follow_up': return <Users size={18} className="text-amber-400" />;
      case 'absence': return <TrendingDown size={18} className="text-red-400" />;
      case 'missing_grades': return <FileWarning size={18} className="text-sky-400" />;
      case 'financial': return <DollarSign size={18} className="text-emerald-400" />;
      case 'unaccounted': return <AlertTriangle size={18} className="text-orange-400" />;
    }
  };

  const borderForType = (type: Alert['type']) => {
    switch (type) {
      case 'follow_up': return 'border-amber-500/30';
      case 'absence': return 'border-red-500/30';
      case 'missing_grades': return 'border-sky-500/30';
      case 'financial': return 'border-emerald-500/30';
      case 'unaccounted': return 'border-orange-500/30';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck size={20} className="text-emerald-400" />
          <h2 className="text-lg font-bold text-white">مركز المتابعة</h2>
          {alerts.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">{alerts.length}</span>
          )}
        </div>
        <button onClick={load} disabled={loading} className="p-2 glass-light rounded-lg text-slate-400 hover:text-white transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="animate-spin text-emerald-400" size={24} />
        </div>
      ) : alerts.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center">
          <ClipboardCheck className="mx-auto text-emerald-400 mb-3" size={40} />
          <p className="text-sm text-slate-400">لا توجد عناصر تحتاج متابعة حالياً</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`glass-card rounded-xl p-3 border ${borderForType(alert.type)} flex items-start gap-3 cursor-pointer hover:bg-white/5 transition`}
              onClick={() => {
                if (alert.studentId) {
                  const st: Student = {
                    id: alert.studentId, name: alert.studentName ?? '', group_id: null,
                    phone: null, parent_phone: null, parent_token: '', enrollment_date: '',
                    total_fees: 0, paid_fees: 0, is_deleted: false, status: 'active',
                    gender: 'male', discount_type: null, discount_amount: 0, is_exempt: false,
                    discount_mode: null, discount_percent: 0, fee_mode: 'full',
                    pro_rata_sessions: 0, join_month_key: null, created_at: '',
                  };
                  setViewTarget(st);
                } else if (alert.type === 'unaccounted' && onNavigate) {
                  onNavigate('accounting');
                } else if (alert.type === 'financial' && onNavigate) {
                  onNavigate('finances');
                }
              }}
            >
              <div className="flex-shrink-0 mt-0.5">{iconForType(alert.type)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">{alert.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">{alert.description}</p>
                {alert.groupName && <span className="text-[10px] text-sky-400 mt-1 inline-block">{alert.groupName}</span>}
              </div>
              <ChevronLeft size={16} className="text-slate-600 flex-shrink-0 mt-1" />
            </motion.div>
          ))}
        </div>
      )}

      <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
