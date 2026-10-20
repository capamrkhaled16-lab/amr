import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History, TrendingUp, TrendingDown, Minus, ChevronRight, X,
  GraduationCap, BookOpen, Heart, CalendarCheck, FileText, MessageSquare,
  Pencil, Check, Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatArabicDate } from '@/lib/format';
import { monthStart, nextMonthStart, upsertAttendance, upsertCenterGrade, upsertHomeworkStatus, upsertBehaviorEval } from '@/lib/data';
import { swrFetch, invalidateCache, invalidateByPrefix } from '@/lib/cache';
import { useToast } from '@/components/ui/Toast';
import type { Student, AttendanceRecord, HomeworkStatus, CenterGrade, BehaviorEval, CenterExam, AttendanceStatus, HomeworkStatusType, BehaviorRating, BehaviorScope } from '@/lib/types';

type TimelineEntry = {
  date: string;
  sessionTitle: string | null;
  sessionId: string | null;
  sessionNumber: number | null;
  attendance: { id: string; status: string } | null;
  homework: { id: string; homeworkId: string; status: string; note: string | null; title: string | null } | null;
  grade: { id: string; examId: string; score: number; maxScore: number; title: string; category: string | null } | null;
  behavior: { id: string; rating: string; note: string | null; scope: string | null } | null;
  note: string | null;
};

type FollowUpLevel = 'stable' | 'attention' | 'intervention';

type Props = {
  student: Student;
};

const EXCEPTION_LABELS: Record<string, string> = {
  absent: 'غائب',
  late: 'متأخر',
  excused_absence: 'غائب بعذر',
  excused: 'غائب بعذر',
  makeup: 'تعويضي',
  unrecorded: 'غير مسجل',
  present: 'حاضر',
};

const HOMEWORK_LABELS: Record<string, string> = {
  complete: 'تم',
  incomplete: 'لم يتم',
  late: 'غير مكتمل',
};

const BEHAVIOR_LABELS: Record<string, string> = {
  excellent: 'ممتاز',
  participatory: 'مشارك',
  quiet: 'هادئ',
  disruptive: 'مزعج',
  needs_attention: 'يحتاج اهتمام',
};

const CATEGORY_LABELS: Record<string, string> = {
  exam: 'امتحان',
  sheet: 'شيت',
  recitation: 'تسميع',
  behavior: 'سلوك',
};

const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'حاضر' },
  { value: 'absent', label: 'غائب' },
  { value: 'late', label: 'متأخر' },
  { value: 'excused_absence', label: 'غائب بعذر' },
  { value: 'makeup', label: 'تعويضي' },
];

const HOMEWORK_OPTIONS: { value: HomeworkStatusType; label: string }[] = [
  { value: 'complete', label: 'تم' },
  { value: 'incomplete', label: 'لم يتم' },
  { value: 'late', label: 'غير مكتمل' },
];

const BEHAVIOR_OPTIONS: { value: BehaviorRating; label: string }[] = [
  { value: 'excellent', label: 'ممتاز' },
  { value: 'participatory', label: 'مشارك' },
  { value: 'quiet', label: 'هادئ' },
  { value: 'needs_attention', label: 'يحتاج اهتمام' },
  { value: 'disruptive', label: 'مزعج' },
];

const selectCls = 'bg-slate-900/80 border border-slate-700/50 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50';
const inputCls = 'bg-slate-900/80 border border-slate-700/50 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/50 w-20';
const btnCls = 'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition active:scale-95';

export default function StudentTimeline({ student }: Props) {
  const { showToast } = useToast();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [followUp, setFollowUp] = useState<FollowUpLevel>('stable');
  const [loading, setLoading] = useState(true);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [attStats, setAttStats] = useState({ present: 0, absent: 0, excused: 0, totalSessions: 0 });
  const [editing, setEditing] = useState<{ field: 'attendance' | 'homework' | 'grade' | 'behavior'; entryIdx: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const mStart = monthStart();
      const mEnd = nextMonthStart();
      const sk = `tl_${student.id}_${mStart}`;

      const [attendance, homework, grades, behavior, sessions] = await Promise.all([
        swrFetch(`${sk}_att`, () =>
          supabase.from('attendance')
            .select('id, student_id, session_id, group_id, status, notes, attendance_date')
            .eq('student_id', student.id)
            .gte('attendance_date', mStart).lt('attendance_date', mEnd)
            .order('attendance_date', { ascending: false }).limit(30)
            .then((r) => (r.data ?? []) as AttendanceRecord[])
        ),
        swrFetch(`${sk}_hw`, () =>
          supabase.from('homework_status')
            .select('id, homework_id, student_id, status, teacher_note, recorded_at')
            .eq('student_id', student.id)
            .gte('recorded_at', mStart).lt('recorded_at', mEnd)
            .order('recorded_at', { ascending: false }).limit(30)
            .then((r) => (r.data ?? []) as HomeworkStatus[])
        ),
        swrFetch(`${sk}_grades`, () =>
          supabase.from('center_grades')
            .select('id, center_exam_id, student_id, score, updated_at, is_deleted')
            .eq('student_id', student.id).eq('is_deleted', false)
            .gte('updated_at', mStart).lt('updated_at', mEnd)
            .order('updated_at', { ascending: false }).limit(20)
            .then((r) => (r.data ?? []) as CenterGrade[])
        ),
        swrFetch(`${sk}_behavior`, () =>
          supabase.from('behavior_eval')
            .select('id, student_id, session_id, group_id, rating, note, eval_date, scope')
            .eq('student_id', student.id)
            .gte('eval_date', mStart).lt('eval_date', mEnd)
            .order('eval_date', { ascending: false }).limit(20)
            .then((r) => (r.data ?? []) as BehaviorEval[])
        ),
        swrFetch(`tl_sessions_${student.group_id ?? 'none'}_${mStart}`, () =>
          supabase.from('sessions')
            .select('id, title, session_date, session_number, group_id')
            .eq('group_id', student.group_id ?? '')
            .gte('session_date', mStart).lt('session_date', mEnd)
            .order('created_at', { ascending: false }).limit(100)
            .then((r) => (r.data ?? []) as { id: string; title: string; session_date: string | null; session_number: number | null; group_id: string }[])
        ),
      ]);

      const sessionMap = new Map<string, { title: string; date: string | null; number: number | null }>();
      for (const s of sessions) {
        sessionMap.set(s.id, { title: s.title, date: s.session_date, number: s.session_number ?? null });
      }

      const sessionByDate = new Map<string, { title: string; number: number | null }>();
      for (const s of sessions) {
        if (s.session_date) {
          sessionByDate.set(s.session_date, { title: s.title, number: s.session_number ?? null });
        }
      }

      let examMap = new Map<string, { title: string; maxScore: number; category: string | null }>();
      if (grades.length > 0) {
        const examIds = grades.map((g) => g.center_exam_id);
        const exams = await swrFetch(`tl_exams_${examIds.join('_').slice(0, 100)}`, () =>
          supabase.from('center_exams')
            .select('id, title, max_score, category')
            .in('id', examIds)
            .then((r) => (r.data ?? []) as CenterExam[])
        );
        for (const e of exams) {
          examMap.set(e.id, { title: e.title, maxScore: e.max_score, category: (e as { category?: string }).category ?? null });
        }
      }

      let hwTitleMap = new Map<string, string>();
      if (homework.length > 0) {
        const hwIds = homework.map((h) => h.homework_id);
        const hwData = await swrFetch(`tl_hw_titles_${hwIds.join('_').slice(0, 100)}`, () =>
          supabase.from('homework')
            .select('id, title')
            .in('id', hwIds)
            .then((r) => (r.data ?? []) as { id: string; title: string }[])
        );
        for (const h of hwData) {
          hwTitleMap.set(h.id, h.title);
        }
      }

      const byDate = new Map<string, TimelineEntry>();

      for (const a of attendance) {
        const dateKey = a.attendance_date;
        if (!byDate.has(dateKey)) {
          const sess = a.session_id ? sessionMap.get(a.session_id) : null;
          byDate.set(dateKey, {
            date: dateKey,
            sessionTitle: sess?.title ?? null,
            sessionId: a.session_id,
            sessionNumber: sess?.number ?? null,
            attendance: { id: a.id, status: a.status },
            homework: null,
            grade: null,
            behavior: null,
            note: a.notes,
          });
        } else {
          const entry = byDate.get(dateKey)!;
          if (!entry.attendance) entry.attendance = { id: a.id, status: a.status };
          if (!entry.sessionId && a.session_id) {
            entry.sessionId = a.session_id;
            const sess = sessionMap.get(a.session_id);
            entry.sessionTitle = sess?.title ?? null;
            entry.sessionNumber = sess?.number ?? null;
          }
        }
      }

      for (const h of homework) {
        const dateKey = (h.recorded_at ?? '').slice(0, 10);
        if (!dateKey) continue;
        if (!byDate.has(dateKey)) {
          const sess = sessionByDate.get(dateKey);
          byDate.set(dateKey, {
            date: dateKey,
            sessionTitle: sess?.title ?? null,
            sessionId: null,
            sessionNumber: sess?.number ?? null,
            attendance: null,
            homework: { id: h.id, homeworkId: h.homework_id, status: h.status, note: h.teacher_note, title: hwTitleMap.get(h.homework_id) ?? null },
            grade: null,
            behavior: null,
            note: null,
          });
        } else {
          byDate.get(dateKey)!.homework = { id: h.id, homeworkId: h.homework_id, status: h.status, note: h.teacher_note, title: hwTitleMap.get(h.homework_id) ?? null };
        }
      }

      for (const g of grades) {
        const dateKey = (g.updated_at ?? '').slice(0, 10);
        if (!dateKey) continue;
        const exam = examMap.get(g.center_exam_id);
        if (!byDate.has(dateKey)) {
          const sess = sessionByDate.get(dateKey);
          byDate.set(dateKey, {
            date: dateKey,
            sessionTitle: sess?.title ?? null,
            sessionId: null,
            sessionNumber: sess?.number ?? null,
            attendance: null,
            homework: null,
            grade: { id: g.id, examId: g.center_exam_id, score: g.score, maxScore: exam?.maxScore ?? 100, title: exam?.title ?? 'درجة', category: exam?.category ?? null },
            behavior: null,
            note: null,
          });
        } else {
          byDate.get(dateKey)!.grade = { id: g.id, examId: g.center_exam_id, score: g.score, maxScore: exam?.maxScore ?? 100, title: exam?.title ?? 'درجة', category: exam?.category ?? null };
        }
      }

      for (const b of behavior) {
        const dateKey = b.eval_date;
        if (!byDate.has(dateKey)) {
          const sess = b.session_id ? sessionMap.get(b.session_id) : sessionByDate.get(dateKey);
          byDate.set(dateKey, {
            date: dateKey,
            sessionTitle: sess?.title ?? null,
            sessionId: b.session_id,
            sessionNumber: sess?.number ?? null,
            attendance: null,
            homework: null,
            grade: null,
            behavior: { id: b.id, rating: b.rating, note: b.note, scope: b.scope },
            note: null,
          });
        } else {
          byDate.get(dateKey)!.behavior = { id: b.id, rating: b.rating, note: b.note, scope: b.scope };
        }
      }

      // Count actual sessions for this student's group this month
      const studentGroupId = student.group_id ?? null;
      const groupSessionCount = studentGroupId
        ? sessions.filter((s) => s.group_id === studentGroupId).length
        : sessions.length;

      // Cap attendance counters at actual session count
      const rawPresent = attendance.filter((a) => a.status === 'present' || a.status === 'late' || a.status === 'makeup').length;
      const rawAbsent = attendance.filter((a) => a.status === 'absent').length;
      const rawExcused = attendance.filter((a) => a.status === 'excused_absence' || a.status === 'excused').length;
      const rawTotal = rawPresent + rawAbsent + rawExcused;
      const cappedTotal = Math.min(rawTotal, groupSessionCount);
      const scale = rawTotal > 0 ? cappedTotal / rawTotal : 1;
      const presentCount = Math.round(rawPresent * scale);
      const absentCount = Math.round(rawAbsent * scale);
      const excusedCount = cappedTotal - presentCount - absentCount;
      setAttStats({ present: presentCount, absent: absentCount, excused: Math.max(0, excusedCount), totalSessions: groupSessionCount });

      const filtered = [...byDate.values()].filter((e) => {
        const day = new Date(e.date + 'T00:00:00').getDay();
        return day !== 5;
      });
      const sorted = filtered.sort((a, b) => b.date.localeCompare(a.date));
      setEntries(sorted.slice(0, 20));

      const attendanceRate = cappedTotal > 0 ? presentCount / cappedTotal : 1;

      const recentHw = homework.slice(0, 10);
      const completeHw = recentHw.filter((h) => h.status === 'complete').length;
      const hwRate = recentHw.length > 0 ? completeHw / recentHw.length : 1;

      const recentGrades = grades.slice(0, 5);
      const avgGradePct = recentGrades.length > 0
        ? recentGrades.reduce((s, g) => {
            const exam = examMap.get(g.center_exam_id);
            const max = exam?.maxScore ?? 100;
            return s + (max > 0 ? (g.score / max) * 100 : 0);
          }, 0) / recentGrades.length
        : 100;

      const recentBehavior = behavior.slice(0, 5);
      const negativeBehavior = recentBehavior.filter((b) => b.rating === 'disruptive' || b.rating === 'needs_attention').length;
      const behaviorRate = recentBehavior.length > 0 ? (recentBehavior.length - negativeBehavior) / recentBehavior.length : 1;

      const score = attendanceRate * 0.3 + hwRate * 0.25 + (avgGradePct / 100) * 0.25 + behaviorRate * 0.2;
      if (score >= 0.75) setFollowUp('stable');
      else if (score >= 0.5) setFollowUp('attention');
      else setFollowUp('intervention');
    } catch {
      setEntries([]);
      setFollowUp('stable');
      setAttStats({ present: 0, absent: 0, excused: 0, totalSessions: 0 });
    } finally {
      setLoading(false);
    }
  }, [student]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSaveAttendance(entry: TimelineEntry, newStatus: AttendanceStatus) {
    if (!entry.attendance) return;
    setSaving(true);
    try {
      await upsertAttendance(student.id, student.group_id ?? '', newStatus, entry.note ?? null, entry.date, entry.sessionId);
      invalidateByPrefix(`tl_${student.id}_`);
      showToast('تم تحديث الحضور', 'success');
      setEditing(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? `تعذّر الحفظ: ${err.message}` : 'تعذّر حفظ الحضور', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveHomework(entry: TimelineEntry, newStatus: HomeworkStatusType, newNote: string | null) {
    if (!entry.homework) return;
    setSaving(true);
    try {
      await upsertHomeworkStatus(entry.homework.homeworkId, student.id, newStatus, newNote);
      invalidateByPrefix(`tl_${student.id}_`);
      showToast('تم تحديث الواجب', 'success');
      setEditing(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? `تعذّر الحفظ: ${err.message}` : 'تعذّر حفظ الواجب', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveGrade(entry: TimelineEntry, newScore: number) {
    if (!entry.grade) return;
    setSaving(true);
    try {
      await upsertCenterGrade(entry.grade.examId, student.id, newScore);
      invalidateByPrefix(`tl_${student.id}_`);
      showToast('تم تحديث الدرجة', 'success');
      setEditing(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? `تعذّر الحفظ: ${err.message}` : 'تعذّر حفظ الدرجة', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBehavior(entry: TimelineEntry, newRating: BehaviorRating, newNote: string | null) {
    if (!entry.behavior) return;
    setSaving(true);
    try {
      await upsertBehaviorEval(student.id, student.group_id ?? null, newRating, newNote, entry.date, (entry.behavior.scope ?? 'monthly') as BehaviorScope, entry.sessionId);
      invalidateByPrefix(`tl_${student.id}_`);
      showToast('تم تحديث التقييم', 'success');
      setEditing(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? `تعذّر الحفظ: ${err.message}` : 'تعذّر حفظ التقييم', 'error');
    } finally {
      setSaving(false);
    }
  }

  const followUpConfig = {
    stable: { label: 'مستقر', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400', icon: <TrendingUp size={13} className="text-emerald-400" /> },
    attention: { label: 'يحتاج متابعة', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', dot: 'bg-amber-400', icon: <Minus size={13} className="text-amber-400" /> },
    intervention: { label: 'يحتاج تدخل', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', dot: 'bg-red-400', icon: <TrendingDown size={13} className="text-red-400" /> },
  };

  const cfg = followUpConfig[followUp];
  const isEditingThis = (field: string, idx: number) => editing?.field === field && editing.entryIdx === idx;

  return (
    <div className="space-y-3">
      <div className={`rounded-xl ${cfg.bg} border ${cfg.border} px-3 py-2.5 flex items-center gap-2`}>
        <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot} flex-shrink-0`} />
        <span className="text-xs font-bold text-slate-300">مؤشر المتابعة:</span>
        <span className={`text-xs font-black ${cfg.color} flex items-center gap-1`}>
          {cfg.icon} {cfg.label}
        </span>
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <History size={13} className="text-slate-500" />
          <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">السجل الزمني</span>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-light rounded-xl p-3 animate-pulse">
                <div className="h-3 w-24 bg-white/5 rounded mb-2" />
                <div className="h-2 w-16 bg-white/5 rounded" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-3">لا توجد سجلات لهذا الشهر.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2 text-[10px] flex-wrap">
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold">
                <CalendarCheck size={10} /> حاضر: {attStats.present}
              </span>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-bold">
                <X size={10} /> غائب: {attStats.absent}
              </span>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-bold">
                <Minus size={10} /> بعذر: {attStats.excused}
              </span>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 font-bold">
                <FileText size={10} /> إجمالي الحصص: {attStats.totalSessions}
              </span>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto modal-body">
            {entries.map((entry, i) => {
              const isExpanded = expandedIdx === i;
              const isPresent = entry.attendance?.status === 'present';
              const showAttendanceLabel = entry.attendance && !isPresent;
              return (
                <motion.div
                  key={`${entry.date}-${i}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="glass-light rounded-xl overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedIdx(isExpanded ? null : i)}
                    className="w-full text-right p-3 flex items-center justify-between gap-2 hover:bg-white/[0.03] transition"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs font-bold text-white flex-shrink-0">{formatArabicDate(entry.date)}</span>
                      {entry.sessionNumber !== null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-300 font-medium flex-shrink-0">
                          حصة {entry.sessionNumber}
                        </span>
                      )}
                      {entry.sessionTitle && (
                        <span className="text-[10px] text-slate-400 truncate">{entry.sessionTitle}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {showAttendanceLabel && entry.attendance && (
                        <span className={`text-[10px] font-semibold ${
                          entry.attendance.status === 'absent' ? 'text-red-400' : 'text-amber-400'
                        }`}>
                          {EXCEPTION_LABELS[entry.attendance.status] ?? entry.attendance.status}
                        </span>
                      )}
                      {entry.grade && (
                        <span className={`text-[10px] font-semibold ${
                          entry.grade.maxScore > 0 && (entry.grade.score / entry.grade.maxScore) >= 0.5 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {entry.grade.score}/{entry.grade.maxScore}
                        </span>
                      )}
                      {entry.homework && (
                        <span className={`text-[10px] font-semibold ${
                          entry.homework.status === 'complete' ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {HOMEWORK_LABELS[entry.homework.status] ?? entry.homework.status}
                        </span>
                      )}
                      {entry.behavior && (
                        <span className={`text-[10px] font-semibold ${
                          entry.behavior.rating === 'excellent' || entry.behavior.rating === 'participatory' ? 'text-emerald-400' :
                          entry.behavior.rating === 'disruptive' || entry.behavior.rating === 'needs_attention' ? 'text-red-400' : 'text-slate-400'
                        }`}>
                          {BEHAVIOR_LABELS[entry.behavior.rating] ?? entry.behavior.rating}
                        </span>
                      )}
                      <ChevronRight
                        size={14}
                        className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      />
                    </div>
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="border-t border-white/5 px-3 py-3 space-y-3"
                      >
                        {entry.sessionId && (
                          <div className="flex items-center gap-2 text-[10px] text-slate-500">
                            <span className="font-mono">ID: {entry.sessionId.slice(0, 8)}</span>
                          </div>
                        )}

                        {/* GRADE with inline edit */}
                        {entry.grade && (
                          <div className="flex items-start gap-2">
                            <GraduationCap size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-white">{entry.grade.title}</span>
                                <div className="flex items-center gap-1.5">
                                  {entry.grade.category && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-300 font-medium">
                                      {CATEGORY_LABELS[entry.grade.category] ?? entry.grade.category}
                                    </span>
                                  )}
                                  {!isEditingThis('grade', i) ? (
                                    <button onClick={() => setEditing({ field: 'grade', entryIdx: i })} className="p-0.5 rounded text-slate-500 hover:text-emerald-400 transition" title="تعديل">
                                      <Pencil size={11} />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              {isEditingThis('grade', i) ? (
                                <GradeEditor
                                  score={entry.grade.score}
                                  maxScore={entry.grade.maxScore}
                                  saving={saving}
                                  onSave={(score) => handleSaveGrade(entry, score)}
                                  onCancel={() => setEditing(null)}
                                />
                              ) : (
                                <>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-sm font-bold ${
                                      entry.grade.maxScore > 0 && (entry.grade.score / entry.grade.maxScore) >= 0.5 ? 'text-emerald-400' : 'text-red-400'
                                    }`}>
                                      {entry.grade.score} / {entry.grade.maxScore}
                                    </span>
                                    {entry.grade.maxScore > 0 && (
                                      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${(entry.grade.score / entry.grade.maxScore) >= 0.5 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                          style={{ width: `${Math.min(100, (entry.grade.score / entry.grade.maxScore) * 100)}%` }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )}

                        {/* HOMEWORK with inline edit */}
                        {entry.homework && (
                          <div className="flex items-start gap-2">
                            <BookOpen size={14} className="text-violet-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-white">
                                  {entry.homework.title ?? 'الواجب'}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {!isEditingThis('homework', i) ? (
                                    <>
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                        entry.homework.status === 'complete' ? 'bg-emerald-500/10 text-emerald-400' :
                                        entry.homework.status === 'late' ? 'bg-amber-500/10 text-amber-400' :
                                        'bg-red-500/10 text-red-400'
                                      }`}>
                                        {HOMEWORK_LABELS[entry.homework.status] ?? entry.homework.status}
                                      </span>
                                      <button onClick={() => setEditing({ field: 'homework', entryIdx: i })} className="p-0.5 rounded text-slate-500 hover:text-emerald-400 transition" title="تعديل">
                                        <Pencil size={11} />
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                              {isEditingThis('homework', i) ? (
                                <HomeworkEditor
                                  status={entry.homework.status as HomeworkStatusType}
                                  note={entry.homework.note}
                                  saving={saving}
                                  onSave={(status, note) => handleSaveHomework(entry, status, note)}
                                  onCancel={() => setEditing(null)}
                                />
                              ) : (
                                entry.homework.note && <p className="text-[10px] text-slate-400 mt-1">{entry.homework.note}</p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* BEHAVIOR with inline edit */}
                        {entry.behavior && (
                          <div className="flex items-start gap-2">
                            <Heart size={14} className="text-rose-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-white">
                                  {BEHAVIOR_LABELS[entry.behavior.rating] ?? entry.behavior.rating}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  {entry.behavior.scope && (
                                    <span className="text-[9px] text-slate-500">{entry.behavior.scope}</span>
                                  )}
                                  {!isEditingThis('behavior', i) ? (
                                    <button onClick={() => setEditing({ field: 'behavior', entryIdx: i })} className="p-0.5 rounded text-slate-500 hover:text-emerald-400 transition" title="تعديل">
                                      <Pencil size={11} />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              {isEditingThis('behavior', i) ? (
                                <BehaviorEditor
                                  rating={entry.behavior.rating as BehaviorRating}
                                  note={entry.behavior.note}
                                  saving={saving}
                                  onSave={(rating, note) => handleSaveBehavior(entry, rating, note)}
                                  onCancel={() => setEditing(null)}
                                />
                              ) : (
                                entry.behavior.note && <p className="text-[10px] text-slate-400 mt-1">{entry.behavior.note}</p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* ATTENDANCE with inline edit */}
                        {entry.attendance && (
                          <div className="flex items-start gap-2">
                            <CalendarCheck size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-white">
                                  {EXCEPTION_LABELS[entry.attendance.status] ?? entry.attendance.status}
                                </span>
                                {!isEditingThis('attendance', i) ? (
                                  <button onClick={() => setEditing({ field: 'attendance', entryIdx: i })} className="p-0.5 rounded text-slate-500 hover:text-emerald-400 transition" title="تعديل">
                                    <Pencil size={11} />
                                  </button>
                                ) : null}
                              </div>
                              {isEditingThis('attendance', i) ? (
                                <AttendanceEditor
                                  status={entry.attendance.status as AttendanceStatus}
                                  saving={saving}
                                  onSave={(status) => handleSaveAttendance(entry, status)}
                                  onCancel={() => setEditing(null)}
                                />
                              ) : null}
                            </div>
                          </div>
                        )}

                        {entry.note && !isEditingThis('attendance', i) && (
                          <div className="flex items-start gap-2">
                            <MessageSquare size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
                            <p className="text-[10px] text-slate-400 flex-1">{entry.note}</p>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
          </>
        )}
      </div>
    </div>
  );
}

function GradeEditor({ score, maxScore, saving, onSave, onCancel }: {
  score: number; maxScore: number; saving: boolean;
  onSave: (score: number) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(String(score));
  return (
    <div className="flex items-center gap-2 mt-1">
      <input
        type="number"
        step="0.5"
        min="0"
        max={maxScore}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={inputCls}
        autoFocus
      />
      <span className="text-xs text-slate-400">/ {maxScore}</span>
      <button
        disabled={saving}
        onClick={() => {
          const n = parseFloat(value);
          if (Number.isFinite(n) && n >= 0 && n <= maxScore) onSave(n);
        }}
        className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50`}
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} حفظ
      </button>
      <button onClick={onCancel} className={`${btnCls} glass-light text-slate-400 hover:text-white`}>إلغاء</button>
    </div>
  );
}

function HomeworkEditor({ status, note, saving, onSave, onCancel }: {
  status: HomeworkStatusType; note: string | null; saving: boolean;
  onSave: (status: HomeworkStatusType, note: string | null) => void; onCancel: () => void;
}) {
  const [st, setSt] = useState<HomeworkStatusType>(status);
  const [nt, setNt] = useState(note ?? '');
  return (
    <div className="space-y-2 mt-1">
      <select value={st} onChange={(e) => setSt(e.target.value as HomeworkStatusType)} className={selectCls}>
        {HOMEWORK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input
        type="text"
        value={nt}
        onChange={(e) => setNt(e.target.value)}
        placeholder="ملاحظة (اختياري)"
        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-lg px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
      />
      <div className="flex items-center gap-2">
        <button
          disabled={saving}
          onClick={() => onSave(st, nt.trim() || null)}
          className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50`}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} حفظ
        </button>
        <button onClick={onCancel} className={`${btnCls} glass-light text-slate-400 hover:text-white`}>إلغاء</button>
      </div>
    </div>
  );
}

function BehaviorEditor({ rating, note, saving, onSave, onCancel }: {
  rating: BehaviorRating; note: string | null; saving: boolean;
  onSave: (rating: BehaviorRating, note: string | null) => void; onCancel: () => void;
}) {
  const [rt, setRt] = useState<BehaviorRating>(rating);
  const [nt, setNt] = useState(note ?? '');
  return (
    <div className="space-y-2 mt-1">
      <select value={rt} onChange={(e) => setRt(e.target.value as BehaviorRating)} className={selectCls}>
        {BEHAVIOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input
        type="text"
        value={nt}
        onChange={(e) => setNt(e.target.value)}
        placeholder="ملاحظة (اختياري)"
        className="w-full bg-slate-900/80 border border-slate-700/50 rounded-lg px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
      />
      <div className="flex items-center gap-2">
        <button
          disabled={saving}
          onClick={() => onSave(rt, nt.trim() || null)}
          className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50`}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} حفظ
        </button>
        <button onClick={onCancel} className={`${btnCls} glass-light text-slate-400 hover:text-white`}>إلغاء</button>
      </div>
    </div>
  );
}

function AttendanceEditor({ status, saving, onSave, onCancel }: {
  status: AttendanceStatus; saving: boolean;
  onSave: (status: AttendanceStatus) => void; onCancel: () => void;
}) {
  const [st, setSt] = useState<AttendanceStatus>(status);
  return (
    <div className="flex items-center gap-2 mt-1">
      <select value={st} onChange={(e) => setSt(e.target.value as AttendanceStatus)} className={selectCls} autoFocus>
        {ATTENDANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button
        disabled={saving}
        onClick={() => onSave(st)}
        className={`${btnCls} bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50`}
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} حفظ
      </button>
      <button onClick={onCancel} className={`${btnCls} glass-light text-slate-400 hover:text-white`}>إلغاء</button>
    </div>
  );
}
