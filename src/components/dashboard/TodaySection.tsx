import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Sun,
  ArrowLeft,
  Loader2,
  Calendar,
  ClipboardCheck,
  Users,
  BookOpen,
  TrendingUp,
  Eye,
  GraduationCap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { todayDateString, formatArabicDate } from '@/lib/format';
import type { Group, Student } from '@/lib/types';
import StudentViewModal360 from '@/components/ui/StudentViewModal360';

type TodayCategory = 'sessions' | 'present' | 'absent' | 'homework' | 'followup';

type TodayStat = {
  category: TodayCategory;
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
};

type DrillRow = {
  id: string;
  primary: string;
  secondary: string;
  tertiary?: string;
  badge?: string;
  badgeColor?: string;
  studentId?: string;
  studentName?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  allGroups: Group[];
  onNavigate: (tab: string) => void;
};

export default function TodaySection({ open, onClose, allGroups, onNavigate }: Props) {
  const [stats, setStats] = useState<TodayStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [drillCategory, setDrillCategory] = useState<TodayCategory | null>(null);
  const [drillData, setDrillData] = useState<DrillRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [viewStudent, setViewStudent] = useState<Student | null>(null);

  const groupMap = new Map<string, Group>();
  for (const g of allGroups) groupMap.set(g.id, g);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const today = todayDateString();

      const [sessionsRes, attRes, studentsRes, hwRes] = await Promise.all([
        supabase.from('sessions').select('id, group_id').eq('session_date', today).eq('is_deleted', false),
        supabase.from('attendance').select('student_id, status').eq('attendance_date', today),
        supabase.from('students').select('id, name, group_id').eq('status', 'active'),
        supabase.from('homework').select('id, group_id, title, is_closed').eq('is_closed', false),
      ]);

      const sessionCount = (sessionsRes.data ?? []).length;
      const attendance = (attRes.data ?? []) as { student_id: string; status: string }[];
      const presentCount = attendance.filter((a) => a.status === 'present').length;
      const absentCount = attendance.filter((a) => a.status === 'absent' || a.status === 'excused_absence').length;

      const students = (studentsRes.data ?? []) as { id: string; name: string; group_id: string | null }[];
      const studentsByGroup = new Map<string, { id: string; name: string }[]>();
      for (const s of students) {
        if (!s.group_id) continue;
        if (!studentsByGroup.has(s.group_id)) studentsByGroup.set(s.group_id, []);
        studentsByGroup.get(s.group_id)!.push({ id: s.id, name: s.name });
      }

      // Homework incomplete: only real homework with incomplete/late status
      const openHw = (hwRes.data ?? []) as { id: string; group_id: string; title: string }[];
      let hwIncomplete = 0;
      for (const hw of openHw) {
        const groupStudents = studentsByGroup.get(hw.group_id) ?? [];
        if (groupStudents.length === 0) continue;
        const { data: statuses } = await supabase
          .from('homework_status')
          .select('student_id, status')
          .eq('homework_id', hw.id);
        const sm = new Map<string, string>();
        for (const s of (statuses ?? []) as { student_id: string; status: string }[]) sm.set(s.student_id, s.status);
        for (const gs of groupStudents) {
          const st = sm.get(gs.id);
          if (st === 'incomplete' || st === 'late') hwIncomplete++;
        }
      }

      // Follow-up: 2+ absences in 14 days
      const { data: recentAbs } = await supabase
        .from('attendance')
        .select('student_id')
        .in('status', ['absent', 'excused_absence'])
        .gte('attendance_date', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10));
      const absentCounts = new Map<string, number>();
      for (const r of (recentAbs ?? []) as { student_id: string }[]) {
        absentCounts.set(r.student_id, (absentCounts.get(r.student_id) ?? 0) + 1);
      }
      const followUpCount = [...absentCounts.values()].filter((c) => c >= 2).length;

      setStats([
        { category: 'sessions', label: 'حصص اليوم', value: sessionCount, icon: <Calendar size={14} />, color: 'text-sky-400' },
        { category: 'present', label: 'حاضر', value: presentCount, icon: <ClipboardCheck size={14} />, color: 'text-emerald-400' },
        { category: 'absent', label: 'غائب', value: absentCount, icon: <Users size={14} />, color: 'text-red-400' },
        { category: 'homework', label: 'واجب غير مكتمل', value: hwIncomplete, icon: <BookOpen size={14} />, color: 'text-amber-400' },
        { category: 'followup', label: 'يحتاج متابعة', value: followUpCount, icon: <TrendingUp size={14} />, color: 'text-amber-400' },
      ]);
    } catch {
      setStats([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadStats();
  }, [open, loadStats]);

  const loadDrill = useCallback(async (cat: TodayCategory) => {
    setDrillCategory(cat);
    setDrillLoading(true);
    try {
      const today = todayDateString();

      if (cat === 'sessions') {
        const { data: sess } = await supabase
          .from('sessions')
          .select('id, group_id, title, session_date')
          .eq('session_date', today)
          .eq('is_deleted', false);
        const rows: DrillRow[] = ((sess ?? []) as { id: string; group_id: string; title: string; session_date: string | null }[]).map((s) => ({
          id: s.id,
          primary: s.title,
          secondary: `المجموعة: ${groupMap.get(s.group_id)?.name ?? 'غير محدد'}`,
          tertiary: formatArabicDate(s.session_date ?? today),
        }));
        setDrillData(rows);
      } else if (cat === 'present' || cat === 'absent') {
        const statusFilter = cat === 'present' ? ['present'] : ['absent', 'excused_absence'];
        const { data: att } = await supabase
          .from('attendance')
          .select('student_id, status, attendance_date')
          .eq('attendance_date', today)
          .in('status', statusFilter);
        const attRows = (att ?? []) as { student_id: string; status: string }[];
        const ids = attRows.map((a) => a.student_id);
        if (ids.length === 0) { setDrillData([]); return; }
        const { data: studentRows } = await supabase
          .from('students')
          .select('id, name, group_id, group:groups(name)')
          .in('id', ids);
        const rows: DrillRow[] = ((studentRows ?? []) as unknown as { id: string; name: string; group_id: string | null; group: { name: string } | null }[]).map((s) => ({
          id: s.id,
          primary: s.name,
          secondary: `المجموعة: ${s.group?.name ?? 'غير محدد'}`,
          studentId: s.id,
          studentName: s.name,
          badge: cat === 'present' ? 'حاضر' : 'غائب',
          badgeColor: cat === 'present' ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10',
        }));
        setDrillData(rows);
      } else if (cat === 'homework') {
        const [studentsRes, hwRes] = await Promise.all([
          supabase.from('students').select('id, name, group_id').eq('status', 'active'),
          supabase.from('homework').select('id, group_id, title, session_id, due_date').eq('is_closed', false),
        ]);
        const students = (studentsRes.data ?? []) as { id: string; name: string; group_id: string | null }[];
        const openHw = (hwRes.data ?? []) as { id: string; group_id: string; title: string; session_id: string | null; due_date: string }[];
        const sByGroup = new Map<string, { id: string; name: string }[]>();
        for (const s of students) {
          if (!s.group_id) continue;
          if (!sByGroup.has(s.group_id)) sByGroup.set(s.group_id, []);
          sByGroup.get(s.group_id)!.push({ id: s.id, name: s.name });
        }
        const rows: DrillRow[] = [];
        for (const hw of openHw) {
          const gs = sByGroup.get(hw.group_id) ?? [];
          if (gs.length === 0) continue;
          const { data: statuses } = await supabase
            .from('homework_status')
            .select('student_id, status')
            .eq('homework_id', hw.id);
          const sm = new Map<string, string>();
          for (const s of (statuses ?? []) as { student_id: string; status: string }[]) sm.set(s.student_id, s.status);
          const gname = groupMap.get(hw.group_id)?.name ?? 'غير محدد';
          for (const s of gs) {
            const st = sm.get(s.id);
            if (st === 'incomplete' || st === 'late') {
              rows.push({
                id: `${hw.id}-${s.id}`,
                primary: s.name,
                secondary: `المجموعة: ${gname}`,
                tertiary: `الواجب: ${hw.title}`,
                studentId: s.id,
                studentName: s.name,
                badge: st === 'incomplete' ? 'لم يتم' : 'غير مكتمل',
                badgeColor: 'text-red-400 bg-red-500/10',
              });
            }
          }
        }
        setDrillData(rows);
      } else if (cat === 'followup') {
        const { data: recentAbs } = await supabase
          .from('attendance')
          .select('student_id, attendance_date, status')
          .in('status', ['absent', 'excused_absence'])
          .gte('attendance_date', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10))
          .order('attendance_date', { ascending: false });
        const absCounts = new Map<string, number>();
        for (const r of (recentAbs ?? []) as { student_id: string }[]) {
          absCounts.set(r.student_id, (absCounts.get(r.student_id) ?? 0) + 1);
        }
        const fuIds = [...absCounts.entries()].filter(([, c]) => c >= 2).map(([id]) => id);
        if (fuIds.length === 0) { setDrillData([]); return; }
        const { data: studentRows } = await supabase
          .from('students')
          .select('id, name, group_id, group:groups(name)')
          .in('id', fuIds)
          .eq('status', 'active');
        const rows: DrillRow[] = ((studentRows ?? []) as unknown as { id: string; name: string; group_id: string | null; group: { name: string } | null }[]).map((s) => ({
          id: s.id,
          primary: s.name,
          secondary: `المجموعة: ${s.group?.name ?? 'غير محدد'}`,
          tertiary: `غياب ${absCounts.get(s.id) ?? 0} مرات`,
          studentId: s.id,
          studentName: s.name,
          badge: 'متابعة',
          badgeColor: 'text-amber-400 bg-amber-500/10',
        }));
        setDrillData(rows);
      }
    } catch {
      setDrillData([]);
    } finally {
      setDrillLoading(false);
    }
  }, [allGroups]);

  function handleOpenStudent(studentId: string, studentName: string) {
    const st: Student = {
      id: studentId, name: studentName, group_id: null, phone: null, parent_phone: null,
      parent_token: '', enrollment_date: '', total_fees: 0, paid_fees: 0, is_deleted: false,
      status: 'active', gender: 'male', discount_type: null, discount_amount: 0,
      is_exempt: false, discount_mode: null, discount_percent: 0, fee_mode: 'full',
      pro_rata_sessions: 0, join_month_key: null, created_at: '',
    };
    setViewStudent(st);
  }

  const DRILL_TITLE: Record<TodayCategory, string> = {
    sessions: 'حصص اليوم',
    present: 'الطلاب الحاضرون',
    absent: 'الطلاب الغائبون',
    homework: 'الواجبات غير المكتملة',
    followup: 'الطلاب الذين يحتاجون متابعة',
  };

  const DRILL_NAV: Record<TodayCategory, string> = {
    sessions: 'attendance',
    present: 'attendance',
    absent: 'attendance',
    homework: 'tracking',
    followup: 'monitoring',
  };

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[99998] flex pointer-events-none"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] pointer-events-auto" />

        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 350 }}
          onClick={(e) => e.stopPropagation()}
          className="relative mr-auto h-full w-full max-w-md glass-card shadow-2xl flex flex-col pointer-events-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
            <div className="flex items-center gap-2.5">
              {drillCategory ? (
                <button
                  onClick={() => { setDrillCategory(null); setDrillData([]); }}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                >
                  <ArrowLeft size={16} />
                </button>
              ) : (
                <div className="p-2 bg-amber-500/15 rounded-xl">
                  <Sun size={18} className="text-amber-400" />
                </div>
              )}
              <div>
                <h3 className="text-sm font-black text-white">
                  {drillCategory ? DRILL_TITLE[drillCategory] : 'اليوم'}
                </h3>
                {!drillCategory && (
                  <p className="text-[11px] text-slate-400">{formatArabicDate(new Date())}</p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto modal-body px-5 py-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-amber-400" size={24} />
              </div>
            ) : drillCategory ? (
              drillLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="animate-spin text-amber-400" size={24} />
                </div>
              ) : drillData.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">لا توجد عناصر.</p>
              ) : (
                <div className="space-y-2">
                  {drillData.map((row, i) => (
                    <motion.div
                      key={row.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="glass-light rounded-xl p-3 space-y-2"
                    >
                      <div className="flex items-start gap-2">
                        <div className="w-7 h-7 rounded-full bg-white/[0.06] text-slate-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {i + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-white truncate">{row.primary}</p>
                          <p className="text-[11px] text-slate-400">{row.secondary}</p>
                          {row.tertiary && <p className="text-[11px] text-slate-500 mt-0.5">{row.tertiary}</p>}
                          {row.badge && (
                            <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${row.badgeColor}`}>
                              {row.badge}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {row.studentId && (
                          <button
                            onClick={() => handleOpenStudent(row.studentId!, row.studentName!)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold transition active:scale-95"
                          >
                            <Eye size={12} /> فتح الطالب
                          </button>
                        )}
                        <button
                          onClick={() => onNavigate(DRILL_NAV[drillCategory])}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition active:scale-95"
                        >
                          معالجة
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )
            ) : stats.length === 0 ? (
              <div className="text-center py-12">
                <div className="inline-flex p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 mb-3">
                  <GraduationCap size={28} className="text-sky-400" />
                </div>
                <p className="text-sm font-bold text-sky-400">لا توجد بيانات لليوم</p>
                <p className="text-xs text-slate-400 mt-1">لم يتم تسجيل أي حصص أو حضور بعد</p>
              </div>
            ) : (
              <div className="space-y-2">
                {stats.map((stat, i) => (
                  <motion.button
                    key={stat.category}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => loadDrill(stat.category)}
                    disabled={stat.value === 0}
                    className={`w-full glass-light rounded-xl p-3.5 flex items-center gap-3 transition group ${
                      stat.value > 0 ? 'hover:bg-white/[0.06] cursor-pointer' : 'opacity-40 cursor-default'
                    }`}
                  >
                    <div className="flex-shrink-0 p-2 rounded-lg bg-white/[0.04]">
                      <span className="text-slate-400">{stat.icon}</span>
                    </div>
                    <div className="flex-1 text-right">
                      <p className="text-[11px] text-slate-400 font-medium">{stat.label}</p>
                      <p className={`text-2xl font-black ${stat.color} mt-0.5`}>{stat.value}</p>
                    </div>
                    {stat.value > 0 && (
                      <ArrowLeft size={16} className="text-slate-600 group-hover:text-amber-400 transition flex-shrink-0" />
                    )}
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
