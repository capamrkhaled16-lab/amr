import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  X,
  ChevronLeft,
  RefreshCw,
  Users,
  BookOpen,
  ClipboardCheck,
  Award,
  CalendarClock,
  Eye,
  Ban,
  ArrowLeft,
  Loader2,
  GraduationCap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { todayDateString, formatArabicDate } from '@/lib/format';
import type { Group, Student } from '@/lib/types';
import StudentViewModal360 from '@/components/ui/StudentViewModal360';

type AttentionCategory = 'students_followup' | 'homework_incomplete' | 'attendance_missing' | 'grades_incomplete' | 'sessions_open';

type AttentionItem = {
  id: string;
  category: AttentionCategory;
  label: string;
  count: number;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
};

type DrillDownStudent = {
  studentId: string;
  studentName: string;
  groupName: string;
  reason: string;
};

type DrillDownHomework = {
  homeworkId: string;
  homeworkTitle: string;
  studentId: string;
  studentName: string;
  groupName: string;
  sessionTitle: string;
  date: string;
  status: string;
};

type DrillDownSession = {
  sessionId: string;
  groupName: string;
  sessionTitle: string;
  date: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  allGroups: Group[];
  onNavigate: (tab: string) => void;
};

export default function AttentionWidget({ open, onClose, allGroups, onNavigate }: Props) {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [drillCategory, setDrillCategory] = useState<AttentionCategory | null>(null);
  const [drillData, setDrillData] = useState<DrillDownStudent[] | DrillDownHomework[] | DrillDownSession[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [viewStudent, setViewStudent] = useState<Student | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const groupMap = new Map<string, Group>();
  for (const g of allGroups) groupMap.set(g.id, g);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const today = todayDateString();
      const result: AttentionItem[] = [];

      const [studentsRes, sessionsRes, hwRes] = await Promise.all([
        supabase.from('students').select('id, name, group_id').eq('status', 'active'),
        supabase.from('sessions').select('id, group_id, title, session_date').eq('session_date', today).eq('is_deleted', false),
        supabase.from('homework').select('id, group_id, title, session_id, is_closed').eq('is_closed', false),
      ]);

      const students = (studentsRes.data ?? []) as { id: string; name: string; group_id: string | null }[];
      const todaySessions = (sessionsRes.data ?? []) as { id: string; group_id: string; title: string; session_date: string | null }[];
      const openHw = (hwRes.data ?? []) as { id: string; group_id: string; title: string; session_id: string | null }[];

      const studentsByGroup = new Map<string, { id: string; name: string }[]>();
      for (const s of students) {
        if (!s.group_id) continue;
        if (!studentsByGroup.has(s.group_id)) studentsByGroup.set(s.group_id, []);
        studentsByGroup.get(s.group_id)!.push({ id: s.id, name: s.name });
      }

      // 1. Students needing follow-up: 2+ absences in last 14 days
      const { data: recentAbs } = await supabase
        .from('attendance')
        .select('student_id')
        .in('status', ['absent', 'excused_absence'])
        .gte('attendance_date', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10));
      const absentCounts = new Map<string, number>();
      for (const r of (recentAbs ?? []) as { student_id: string }[]) {
        absentCounts.set(r.student_id, (absentCounts.get(r.student_id) ?? 0) + 1);
      }
      const followUpIds = [...absentCounts.entries()].filter(([, c]) => c >= 2).map(([id]) => id);
      if (followUpIds.length > 0 && !dismissed.has('students_followup')) {
        result.push({
          id: 'students_followup',
          category: 'students_followup',
          label: `${followUpIds.length} طلاب يحتاجون متابعة`,
          count: followUpIds.length,
          color: 'text-red-400',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/20',
          icon: <Users size={16} className="text-red-400" />,
        });
      }

      // 2. Homework incomplete: only real homework with incomplete/late status
      let incompleteHwCount = 0;
      for (const hw of openHw) {
        const groupStudents = studentsByGroup.get(hw.group_id) ?? [];
        if (groupStudents.length === 0) continue;
        const { data: statuses } = await supabase
          .from('homework_status')
          .select('student_id, status')
          .eq('homework_id', hw.id);
        const statusMap = new Map<string, string>();
        for (const s of (statuses ?? []) as { student_id: string; status: string }[]) {
          statusMap.set(s.student_id, s.status);
        }
        for (const gs of groupStudents) {
          const st = statusMap.get(gs.id);
          if (st === 'incomplete' || st === 'late') {
            incompleteHwCount++;
          }
        }
      }
      if (incompleteHwCount > 0 && !dismissed.has('homework_incomplete')) {
        result.push({
          id: 'homework_incomplete',
          category: 'homework_incomplete',
          label: `${incompleteHwCount} واجب غير مكتمل`,
          count: incompleteHwCount,
          color: 'text-amber-400',
          bgColor: 'bg-amber-500/10',
          borderColor: 'border-amber-500/20',
          icon: <BookOpen size={16} className="text-amber-400" />,
        });
      }

      // 3. Groups with sessions today but no attendance
      let noAttCount = 0;
      for (const session of todaySessions) {
        const groupStudents = studentsByGroup.get(session.group_id) ?? [];
        if (groupStudents.length === 0) continue;
        const { count } = await supabase
          .from('attendance')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', session.id);
        if ((count ?? 0) === 0) noAttCount++;
      }
      if (noAttCount > 0 && !dismissed.has('attendance_missing')) {
        result.push({
          id: 'attendance_missing',
          category: 'attendance_missing',
          label: `${noAttCount} مجموعة تحتاج تسجيل حضور`,
          count: noAttCount,
          color: 'text-amber-400',
          bgColor: 'bg-amber-500/10',
          borderColor: 'border-amber-500/20',
          icon: <ClipboardCheck size={16} className="text-amber-400" />,
        });
      }

      // 4. Sessions open today (no data at all)
      let openSessions = 0;
      for (const session of todaySessions) {
        const groupStudents = studentsByGroup.get(session.group_id) ?? [];
        if (groupStudents.length === 0) continue;
        const [attRes, hwRes2, evalRes] = await Promise.all([
          supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('session_id', session.id),
          supabase.from('homework').select('id').eq('session_id', session.id),
          supabase.from('behavior_eval').select('id', { count: 'exact', head: true }).eq('session_id', session.id),
        ]);
        const hasData = (attRes.count ?? 0) > 0 || (hwRes2.data?.length ?? 0) > 0 || (evalRes.count ?? 0) > 0;
        if (!hasData) openSessions++;
      }
      if (openSessions > 0 && !dismissed.has('sessions_open')) {
        result.push({
          id: 'sessions_open',
          category: 'sessions_open',
          label: `${openSessions} حصة لم يتم إغلاقها`,
          count: openSessions,
          color: 'text-sky-400',
          bgColor: 'bg-sky-500/10',
          borderColor: 'border-sky-500/20',
          icon: <CalendarClock size={16} className="text-sky-400" />,
        });
      }

      setItems(result);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dismissed]);

  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  const loadDrillDown = useCallback(async (category: AttentionCategory) => {
    setDrillCategory(category);
    setDrillLoading(true);
    try {
      const today = todayDateString();

      if (category === 'students_followup') {
        const { data: recentAbs } = await supabase
          .from('attendance')
          .select('student_id, attendance_date, status')
          .in('status', ['absent', 'excused_absence'])
          .gte('attendance_date', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10))
          .order('attendance_date', { ascending: false });

        const absentCounts = new Map<string, number>();
        for (const r of (recentAbs ?? []) as { student_id: string }[]) {
          absentCounts.set(r.student_id, (absentCounts.get(r.student_id) ?? 0) + 1);
        }
        const followUpIds = [...absentCounts.entries()].filter(([, c]) => c >= 2).map(([id]) => id);

        const { data: studentRows } = await supabase
          .from('students')
          .select('id, name, group_id, group:groups(name)')
          .in('id', followUpIds)
          .eq('status', 'active');

        // Also check homework for these students
        const { data: hwStatuses } = await supabase
          .from('homework_status')
          .select('student_id, status')
          .in('student_id', followUpIds)
          .order('recorded_at', { ascending: false });

        const latestHwStatus = new Map<string, string>();
        for (const h of (hwStatuses ?? []) as { student_id: string; status: string }[]) {
          if (!latestHwStatus.has(h.student_id)) latestHwStatus.set(h.student_id, h.status);
        }

        const rows: DrillDownStudent[] = ((studentRows ?? []) as unknown as { id: string; name: string; group_id: string | null; group: { name: string } | null }[])
          .map((s) => {
            const absCount = absentCounts.get(s.id) ?? 0;
            const hwSt = latestHwStatus.get(s.id);
            const reasons: string[] = [`غياب ${absCount} مرات`];
            if (hwSt === 'incomplete' || hwSt === 'late') reasons.push('واجب غير مكتمل');
            return {
              studentId: s.id,
              studentName: s.name,
              groupName: s.group?.name ?? 'غير محدد',
              reason: reasons.join(' + '),
            };
          });
        setDrillData(rows);
      } else if (category === 'homework_incomplete') {
        const [studentsRes, hwRes] = await Promise.all([
          supabase.from('students').select('id, name, group_id').eq('status', 'active'),
          supabase.from('homework').select('id, group_id, title, session_id, due_date').eq('is_closed', false),
        ]);

        const students = (studentsRes.data ?? []) as { id: string; name: string; group_id: string | null }[];
        const openHw = (hwRes.data ?? []) as { id: string; group_id: string; title: string; session_id: string | null; due_date: string }[];
        const studentsByGroup = new Map<string, { id: string; name: string }[]>();
        for (const s of students) {
          if (!s.group_id) continue;
          if (!studentsByGroup.has(s.group_id)) studentsByGroup.set(s.group_id, []);
          studentsByGroup.get(s.group_id)!.push({ id: s.id, name: s.name });
        }

        // Fetch session titles
        const sessionIds = openHw.map((h) => h.session_id).filter(Boolean) as string[];
        let sessionMap = new Map<string, string>();
        if (sessionIds.length > 0) {
          const { data: sessions } = await supabase.from('sessions').select('id, title').in('id', sessionIds);
          for (const s of (sessions ?? []) as { id: string; title: string }[]) {
            sessionMap.set(s.id, s.title);
          }
        }

        const rows: DrillDownHomework[] = [];
        for (const hw of openHw) {
          const groupStudents = studentsByGroup.get(hw.group_id) ?? [];
          if (groupStudents.length === 0) continue;
          const { data: statuses } = await supabase
            .from('homework_status')
            .select('student_id, status')
            .eq('homework_id', hw.id);
          const statusMap = new Map<string, string>();
          for (const s of (statuses ?? []) as { student_id: string; status: string }[]) {
            statusMap.set(s.student_id, s.status);
          }
          const group = groupMap.get(hw.group_id);
          for (const gs of groupStudents) {
            const st = statusMap.get(gs.id);
            if (st === 'incomplete' || st === 'late') {
              rows.push({
                homeworkId: hw.id,
                homeworkTitle: hw.title,
                studentId: gs.id,
                studentName: gs.name,
                groupName: group?.name ?? 'غير محدد',
                sessionTitle: hw.session_id ? (sessionMap.get(hw.session_id) ?? '—') : '—',
                date: hw.due_date,
                status: st === 'incomplete' ? 'لم يتم' : 'غير مكتمل',
              });
            }
          }
        }
        setDrillData(rows);
      } else if (category === 'attendance_missing') {
        const { data: sessionsRes } = await supabase
          .from('sessions')
          .select('id, group_id, title, session_date')
          .eq('session_date', today)
          .eq('is_deleted', false);
        const todaySessions = (sessionsRes ?? []) as { id: string; group_id: string; title: string; session_date: string | null }[];

        const { data: studentsRes } = await supabase
          .from('students')
          .select('id, group_id')
          .eq('status', 'active');
        const studentsByGroup = new Map<string, number>();
        for (const s of (studentsRes ?? []) as { id: string; group_id: string | null }[]) {
          if (s.group_id) studentsByGroup.set(s.group_id, (studentsByGroup.get(s.group_id) ?? 0) + 1);
        }

        const rows: DrillDownSession[] = [];
        for (const session of todaySessions) {
          if ((studentsByGroup.get(session.group_id) ?? 0) === 0) continue;
          const { count } = await supabase
            .from('attendance')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', session.id);
          if ((count ?? 0) === 0) {
            const group = groupMap.get(session.group_id);
            rows.push({
              sessionId: session.id,
              groupName: group?.name ?? 'غير محدد',
              sessionTitle: session.title,
              date: today,
            });
          }
        }
        setDrillData(rows);
      } else if (category === 'sessions_open') {
        const { data: sessionsRes } = await supabase
          .from('sessions')
          .select('id, group_id, title, session_date')
          .eq('session_date', today)
          .eq('is_deleted', false);
        const todaySessions = (sessionsRes ?? []) as { id: string; group_id: string; title: string; session_date: string | null }[];

        const { data: studentsRes } = await supabase
          .from('students')
          .select('id, group_id')
          .eq('status', 'active');
        const studentsByGroup = new Map<string, number>();
        for (const s of (studentsRes ?? []) as { id: string; group_id: string | null }[]) {
          if (s.group_id) studentsByGroup.set(s.group_id, (studentsByGroup.get(s.group_id) ?? 0) + 1);
        }

        const rows: DrillDownSession[] = [];
        for (const session of todaySessions) {
          if ((studentsByGroup.get(session.group_id) ?? 0) === 0) continue;
          const [attRes, hwRes2, evalRes] = await Promise.all([
            supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('session_id', session.id),
            supabase.from('homework').select('id').eq('session_id', session.id),
            supabase.from('behavior_eval').select('id', { count: 'exact', head: true }).eq('session_id', session.id),
          ]);
          const hasData = (attRes.count ?? 0) > 0 || (hwRes2.data?.length ?? 0) > 0 || (evalRes.count ?? 0) > 0;
          if (!hasData) {
            const group = groupMap.get(session.group_id);
            rows.push({
              sessionId: session.id,
              groupName: group?.name ?? 'غير محدد',
              sessionTitle: session.title,
              date: today,
            });
          }
        }
        setDrillData(rows);
      }
    } catch {
      setDrillData([]);
    } finally {
      setDrillLoading(false);
    }
  }, [allGroups]);

  function handleDismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function handleOpenStudent(studentId: string, studentName: string) {
    // Find in allStudents — build minimal student object
    const st: Student = {
      id: studentId,
      name: studentName,
      group_id: null,
      phone: null,
      parent_phone: null,
      parent_token: '',
      enrollment_date: '',
      total_fees: 0,
      paid_fees: 0,
      is_deleted: false,
      status: 'active',
      gender: 'male',
      discount_type: null,
      discount_amount: 0,
      is_exempt: false,
      discount_mode: null,
      discount_percent: 0,
      fee_mode: 'full',
      pro_rata_sessions: 0,
      join_month_key: null,
      created_at: '',
    };
    setViewStudent(st);
  }

  const DRILL_TITLE: Record<AttentionCategory, string> = {
    students_followup: 'الطلاب الذين يحتاجون متابعة',
    homework_incomplete: 'الواجبات غير المكتملة',
    attendance_missing: 'مجموعات تحتاج تسجيل حضور',
    grades_incomplete: 'درجات ناقصة',
    sessions_open: 'حصص لم يتم إغلاقها',
  };

  if (!open) return null;

  return createPortal(
    <div data-portal-backdrop>
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[99999] flex pointer-events-none"
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
                  onClick={() => { setDrillCategory(null); setDrillData(null); }}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                >
                  <ArrowLeft size={16} />
                </button>
              ) : (
                <div className="p-2 bg-amber-500/15 rounded-xl">
                  <AlertCircle size={18} className="text-amber-400" />
                </div>
              )}
              <h3 className="text-sm font-black text-white">
                {drillCategory ? DRILL_TITLE[drillCategory] : 'ماذا يحتاج مني الآن؟'}
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={loadData}
                className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
                title="تحديث"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition"
              >
                <X size={16} />
              </button>
            </div>
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
              ) : !drillData || drillData.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">لا توجد عناصر.</p>
              ) : drillCategory === 'students_followup' ? (
                <div className="space-y-2">
                  {(drillData as DrillDownStudent[]).map((s, i) => (
                    <motion.div
                      key={s.studentId}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="glass-light rounded-xl p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="w-7 h-7 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                            {i + 1}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">{s.studentName}</p>
                            <p className="text-[11px] text-slate-400">المجموعة: {s.groupName}</p>
                            <p className="text-[11px] text-amber-400 mt-0.5">السبب: {s.reason}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleOpenStudent(s.studentId, s.studentName)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold transition active:scale-95"
                        >
                          <Eye size={12} /> فتح الطالب
                        </button>
                        <button
                          onClick={() => onNavigate('monitoring')}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition active:scale-95"
                        >
                          معالجة
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : drillCategory === 'homework_incomplete' ? (
                <div className="space-y-2">
                  {(drillData as DrillDownHomework[]).map((h, i) => (
                    <motion.div
                      key={`${h.homeworkId}-${h.studentId}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="glass-light rounded-xl p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="w-7 h-7 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                            {i + 1}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">{h.studentName}</p>
                            <p className="text-[11px] text-slate-400">المجموعة: {h.groupName}</p>
                            <p className="text-[11px] text-slate-400">الواجب: {h.homeworkTitle}</p>
                            <p className="text-[11px] text-slate-500">الحصة: {h.sessionTitle} — {formatArabicDate(h.date)}</p>
                            <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                              {h.status}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleOpenStudent(h.studentId, h.studentName)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold transition active:scale-95"
                        >
                          <Eye size={12} /> فتح الطالب
                        </button>
                        <button
                          onClick={() => onNavigate('tracking')}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-xs font-bold transition active:scale-95"
                        >
                          فتح الواجب
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {(drillData as DrillDownSession[]).map((s, i) => (
                    <motion.div
                      key={s.sessionId}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="glass-light rounded-xl p-3 space-y-2"
                    >
                      <div className="flex items-start gap-2">
                        <div className="w-7 h-7 rounded-full bg-sky-500/15 text-sky-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {i + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">{s.groupName}</p>
                          <p className="text-[11px] text-slate-400">الحصة: {s.sessionTitle}</p>
                          <p className="text-[11px] text-slate-500">{formatArabicDate(s.date)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => onNavigate('attendance')}
                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold transition active:scale-95"
                      >
                        <ClipboardCheck size={12} /> معالجة — تسجيل الحضور
                      </button>
                    </motion.div>
                  ))}
                </div>
              )
            ) : items.length === 0 ? (
              <div className="text-center py-12">
                <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-3">
                  <GraduationCap size={28} className="text-emerald-400" />
                </div>
                <p className="text-sm font-bold text-emerald-400">كل شيء على ما يرام</p>
                <p className="text-xs text-slate-400 mt-1">لا توجد مهام تحتاج تدخل الآن</p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item, i) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`rounded-xl border ${item.borderColor} ${item.bgColor} p-3 flex items-center gap-3 group cursor-pointer hover:bg-white/[0.06] transition`}
                    onClick={() => loadDrillDown(item.category)}
                  >
                    <div className="flex-shrink-0 p-2 rounded-lg bg-white/[0.04]">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-black ${item.color}`}>{item.label}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDismiss(item.id); }}
                      className="flex-shrink-0 p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-slate-300 transition"
                      title="تجاهل"
                    >
                      <Ban size={14} />
                    </button>
                    <ChevronLeft size={16} className="text-slate-600 group-hover:text-amber-400 transition flex-shrink-0" />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    </div>,
    document.body,
  );
}
