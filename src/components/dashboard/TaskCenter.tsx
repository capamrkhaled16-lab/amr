import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X, Bell, Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { supabase } from '@/lib/supabase';

type TaskPriority = 'action' | 'review' | 'info';
type TaskStatus = 'open' | 'resolved';

type Task = {
  id: string;
  priority: TaskPriority;
  title: string;
  description: string;
  action?: { label: string; tab: string };
  status: TaskStatus;
};

type TaskCenterProps = {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  allGroups: { id: string; name: string; grade_level_id: string }[];
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  action: { label: 'بحاجة لإجراء', icon: <AlertCircle size={14} />, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/25' },
  review: { label: 'بحاجة لمراجعة', icon: <CheckCircle2 size={14} />, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/25' },
  info: { label: 'معلومة', icon: <Info size={14} />, color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/25' },
};

export default function TaskCenter({ open, onClose, onNavigate, allGroups }: TaskCenterProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const found: Task[] = [];

    try {
      const [studentsRes, paymentsRes, attendanceRes, sessionsRes] = await Promise.all([
        supabase.from('students').select('id, name, group_id, total_fees, paid_fees, is_exempt').eq('status', 'active'),
        supabase.from('payments').select('student_id, amount').eq('month_key', monthKey).eq('is_deleted', false).eq('is_historical_payment', false).gt('amount', 0),
        supabase.from('attendance').select('student_id, group_id, attendance_date').eq('attendance_date', today),
        supabase.from('sessions').select('id, group_id, title, session_date').eq('is_deleted', false).eq('is_archived', false).limit(50),
      ]);

      const students = (studentsRes.data ?? []) as { id: string; name: string; group_id: string; total_fees: number; paid_fees: number; is_exempt: boolean }[];
      const payments = (paymentsRes.data ?? []) as { student_id: string; amount: number }[];
      const attendanceToday = (attendanceRes.data ?? []) as { student_id: string; group_id: string }[];
      const sessions = (sessionsRes.data ?? []) as { id: string; group_id: string; title: string; session_date: string }[];

      const paidMap = new Map<string, number>();
      for (const p of payments) paidMap.set(p.student_id, (paidMap.get(p.student_id) ?? 0) + p.amount);

      const unpaidCount = students.filter((s) => !s.is_exempt && (paidMap.get(s.id) ?? 0) < s.total_fees).length;
      if (unpaidCount > 0) {
        found.push({
          id: 'unpaid-students',
          priority: 'action',
          title: `${unpaidCount} طالب لم يكمل دفع المصاريف`,
          description: 'طلاب لديهم رسوم غير مدفوعة لهذا الشهر',
          action: { label: 'عرض المالية', tab: 'finances' },
          status: 'open',
        });
      }

      const studentsWithAttendance = new Set(attendanceToday.map((a) => a.student_id));
      const noAttendanceCount = students.length - studentsWithAttendance.size;
      if (noAttendanceCount > 0 && sessions.length > 0) {
        found.push({
          id: 'missing-attendance',
          priority: 'action',
          title: `${noAttendanceCount} طالب بدون تسجيل حضور اليوم`,
          description: 'لم يتم تسجيل الحضور لبعض الطلاب في حصة اليوم',
          action: { label: 'تسجيل الحضور', tab: 'attendance' },
          status: 'open',
        });
      }

      const todaySessions = sessions.filter((s) => s.session_date === today);
      if (todaySessions.length > 0) {
        found.push({
          id: 'today-sessions',
          priority: 'info',
          title: `${todaySessions.length} حصة مجدولة اليوم`,
          description: todaySessions.map((s) => s.title).join('، ').slice(0, 80),
          status: 'open',
        });
      }

      if (allGroups.length === 0) {
        found.push({
          id: 'no-groups',
          priority: 'review',
          title: 'لا توجد مجموعات مضافة',
          description: 'يجب إضافة مجموعات قبل تسجيل الحضور أو الدرجات',
          action: { label: 'إدارة المجموعات', tab: 'students' },
          status: 'open',
        });
      }
    } catch {
      found.push({
        id: 'load-error',
        priority: 'action',
        title: 'تعذّر تحميل المهام',
        description: 'حدث خطأ أثناء جلب بيانات المهام',
        status: 'open',
      });
    }

    setTasks(found);
    setLoading(false);
  }, [allGroups]);

  useEffect(() => {
    if (open) loadTasks();
  }, [open, loadTasks]);

  const actionTasks = tasks.filter((t) => t.priority === 'action');
  const reviewTasks = tasks.filter((t) => t.priority === 'review');
  const infoTasks = tasks.filter((t) => t.priority === 'info');

  function handleAction(task: Task) {
    if (task.action) {
      onNavigate(task.action.tab);
      onClose();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="مركز المهام" size="md">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-emerald-400" size={24} />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
          <p className="text-sm font-bold text-white">كل شيء على ما يرام</p>
          <p className="text-xs text-slate-400 mt-1">لا توجد مهام معلقة حالياً</p>
        </div>
      ) : (
        <div className="space-y-4">
          {actionTasks.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-amber-400 mb-2 px-1">بحاجة لإجراء</h3>
              <div className="space-y-2">
                {actionTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onAction={() => handleAction(task)} />
                ))}
              </div>
            </div>
          )}
          {reviewTasks.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-sky-400 mb-2 px-1">بحاجة لمراجعة</h3>
              <div className="space-y-2">
                {reviewTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onAction={() => handleAction(task)} />
                ))}
              </div>
            </div>
          )}
          {infoTasks.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-400 mb-2 px-1">معلومات</h3>
              <div className="space-y-2">
                {infoTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onAction={() => handleAction(task)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function TaskCard({ task, onAction }: { task: Task; onAction: () => void }) {
  const config = PRIORITY_CONFIG[task.priority];
  return (
    <div className={`glass-light rounded-xl p-3 border ${config.bg}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 ${config.color}`}>{config.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">{task.title}</p>
          <p className="text-xs text-slate-400 mt-0.5">{task.description}</p>
          {task.action && (
            <button
              onClick={onAction}
              className="mt-2 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
            >
              {task.action.label} ←
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
