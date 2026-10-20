import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Plus,
  Trash2,
  ClipboardCheck,
  Calendar,
  History,
  X,
  Loader2,
  AlertTriangle,
  Eye,
  MessageCircle,
} from 'lucide-react';
import StudentViewModal from '@/components/ui/StudentViewModal';
import AbsenceBadge, { isAbsentStatus, absenceLabel } from '@/components/ui/AbsenceBadge';
import { Users, CheckCircle2, XCircle, AlertCircle, UserX, UserMinus, HelpCircle, Filter } from 'lucide-react';
import type {
  Student,
  Homework,
  HomeworkStatus,
  HomeworkStatusType,
  BehaviorRating,
  BehaviorEval,
  BehaviorScope,
  AttendanceStatus,
  AttendanceRecord,
} from '@/lib/types';
import {
  fetchHomework,
  createHomework,
  deleteHomework,
  deleteAllHomework,
  fetchHomeworkStatuses,
  upsertHomeworkStatus,
  deleteHomeworkStatus,
  fetchBehaviorEvals,
  fetchBehaviorEvalsBatch,
  upsertBehaviorEval,
  deleteBehaviorEval,
  subscribeToAttendance,
  fetchSessionsForGroup,
  fetchAttendanceBySession,
  fetchAttendanceForDate,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { todayDateString, formatArabicDate, normalizePhoneForWhatsApp, openWhatsAppURL } from '@/lib/format';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { useMonth } from '@/context/MonthContext';
import { usePersistedState, getPersistedId, setPersistedId } from '@/hooks/usePersistedState';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportHomeworkPDF, exportBehaviorPDF } from '@/lib/pdfExport';

type HomeworkBehaviorProps = {
  groupId: string;
  students: Student[];
  studentsLoading?: boolean;
  focusStudentId?: string | null;
};

const HOMEWORK_META: Record<HomeworkStatusType, { label: string; activeClass: string }> = {
  complete: { label: 'تم', activeClass: 'bg-emerald-600 text-white shadow-lg' },
  incomplete: { label: 'لم يتم', activeClass: 'bg-red-600 text-white shadow-lg' },
  late: { label: 'غير مكتمل', activeClass: 'bg-amber-600 text-white shadow-lg' },
};

const BEHAVIOR_OPTIONS: { rating: BehaviorRating; label: string; activeClass: string }[] = [
  { rating: 'excellent', label: 'ممتاز', activeClass: 'bg-emerald-600 text-white shadow-lg' },
  { rating: 'participatory', label: 'مشارك', activeClass: 'bg-blue-600 text-white shadow-lg' },
  { rating: 'quiet', label: 'هادئ', activeClass: 'bg-slate-600 text-white shadow-lg' },
  { rating: 'needs_attention', label: 'يحتاج اهتمام', activeClass: 'bg-amber-600 text-white shadow-lg' },
  { rating: 'disruptive', label: 'مزعج', activeClass: 'bg-red-600 text-white shadow-lg' },
];

const SCOPE_OPTIONS: { value: BehaviorScope; label: string }[] = [
  { value: 'monthly', label: 'شهري' },
  { value: 'weekly', label: 'أسبوعي' },
];

const inputCls =
  'w-full bg-slate-900/50 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition';

function isAbsent(status: AttendanceStatus | undefined): boolean {
  return status === 'absent' || status === 'excused_absence';
}

function absentLabel(status: AttendanceStatus | undefined): string {
  if (status === 'excused_absence') return 'غائب بعذر';
  if (status === 'absent') return 'غائب';
  return '';
}

export default function HomeworkBehavior({ groupId, students, studentsLoading, focusStudentId }: HomeworkBehaviorProps) {
  const { showToast } = useToast();
  const { can, isMaster } = useAuth();
  const { monthKey } = useMonth();
  const canEdit = isMaster || can('can_edit_grades');
  const canDelete = isMaster || can('can_delete_evals');
  const persistKey = `hb_${groupId}`;
  const [tab, setTab] = usePersistedState<'homework' | 'behavior'>(`${persistKey}_tab`, 'homework');
  const [homeworkList, setHomeworkList] = useState<Homework[]>([]);
  const [selectedHw, setSelectedHw] = useState<string>('');
  const [statuses, setStatuses] = useState<Record<string, HomeworkStatus>>({});
  const [addHwOpen, setAddHwOpen] = useState(false);
  const [hwForm, setHwForm] = useState({ title: '', description: '', due_date: todayDateString(), session_id: '' });
  const [addingHw, setAddingHw] = useState(false);

  const [behaviorDate, setBehaviorDate] = useState(todayDateString());
  const [behaviorNote, setBehaviorNote] = useState('');
  const [behaviorScope, setBehaviorScope] = usePersistedState<BehaviorScope>(`${persistKey}_scope`, 'monthly');
  const [behavior, setBehavior] = useState<Record<string, BehaviorEval[]>>({});
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);
  const [historyRecords, setHistoryRecords] = useState<BehaviorEval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'homework' | 'behavior' | 'delete_all'; id: string; label?: string } | null>(null);
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const [hwWhatsAppTarget, setHwWhatsAppTarget] = useState<{ student: Student; status: HomeworkStatusType; homeworkTitle: string } | null>(null);
  const hwWhatsAppSentRef = useRef<Set<string>>(new Set());

  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>({});
  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [sessionNumber, setSessionNumber] = useState<number | null>(null);
  const [sessionDate, setSessionDate] = useState<string>('');
  const [currentSession, setCurrentSession] = useState<{ id: string; title: string } | null>(null);
  const [hwFilter, setHwFilter] = useState<'all' | 'complete' | 'incomplete' | 'late' | 'absent' | 'excused' | 'unrecorded'>('all');
  const statusesReqIdRef = useRef(0);
  const behaviorReqIdRef = useRef(0);
  const attForHwReqIdRef = useRef(0);

  useEffect(() => {
    if (!focusStudentId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-student-id="${focusStudentId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-emerald-400');
        setTimeout(() => el.classList.remove('ring-2', 'ring-emerald-400'), 3000);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [focusStudentId]);

  const loadHomework = useCallback(async () => {
    try {
      const data = await fetchHomework(groupId, false, monthKey);
      setHomeworkList(data);
      const savedHwId = getPersistedId(`${persistKey}_hw`);
      const match = savedHwId ? data.find((h) => h.id === savedHwId) : null;
      if (match) {
        setSelectedHw(match.id);
      } else if (data.length > 0) {
        setSelectedHw(data[0].id);
      } else {
        setSelectedHw('');
      }
    } catch {
      showToast('تعذّر تحميل الواجبات', 'error');
    }
  }, [groupId, persistKey, monthKey]);

  const studentIdsKey = students.map((s) => s.id).join(',');
  const loadBehavior = useCallback(async () => {
    const reqId = ++behaviorReqIdRef.current;
    try {
      const ids = students.map((s) => s.id);
      const batchMap = await fetchBehaviorEvalsBatch(ids);
      if (reqId !== behaviorReqIdRef.current) return;
      const map: Record<string, BehaviorEval[]> = {};
      for (const s of students) {
        map[s.id] = batchMap.get(s.id) ?? [];
      }
      setBehavior(map);
    } catch {
      if (reqId === behaviorReqIdRef.current) {
        showToast('تعذّر تحميل تقييمات السلوك', 'error');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentIdsKey]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchSessionsForGroup(groupId);
      const seen = new Set<string>();
      const unique = data.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
      setSessions(unique.map((s) => ({ id: s.id, title: s.title })));
    } catch {
      // sessions are non-critical for homework
    }
  }, [groupId]);

  // Resolve the current session: prefer the attendance module's active session,
  // but fall back to the first available session for the group so homework
  // creation works even when the teacher hasn't opened Attendance first.
  useEffect(() => {
    if (sessions.length === 0) {
      setCurrentSession(null);
      return;
    }
    const stored = sessionStorage.getItem(`attendance_active_session_${groupId}`);
    if (stored && sessions.some((s) => s.id === stored)) {
      const s = sessions.find((ss) => ss.id === stored);
      setCurrentSession(s ? { id: s.id, title: s.title } : null);
    } else {
      setCurrentSession({ id: sessions[0].id, title: sessions[0].title });
    }
  }, [groupId, sessions]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError(false);
    Promise.all([loadHomework(), loadBehavior(), loadSessions()])
      .then(() => {
        if (!active) return;
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadHomework, loadBehavior, loadSessions]);

  const loadStatuses = useCallback(async () => {
    if (!selectedHw) {
      setStatuses({});
      return;
    }
    const reqId = ++statusesReqIdRef.current;
    try {
      const data = await fetchHomeworkStatuses(selectedHw);
      if (reqId !== statusesReqIdRef.current) return;
      const map: Record<string, HomeworkStatus> = {};
      for (const s of data ?? []) map[s.student_id] = s;
      // Replace with fresh DB data — do NOT merge stale statuses
      setStatuses(map);
    } catch {
      if (reqId === statusesReqIdRef.current) {
        showToast('تعذّر تحميل حالات الواجب', 'error');
      }
    }
  }, [selectedHw]);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  useEffect(() => {
    setPersistedId(`${persistKey}_hw`, selectedHw || null);
  }, [selectedHw, persistKey]);

  // Load attendance for the selected homework's session
  const loadAttendanceForHw = useCallback(async () => {
    if (!selectedHw) {
      setAttendanceMap({});
      setSessionTitle('');
      setSessionNumber(null);
      setSessionDate('');
      return;
    }
    const hw = homeworkList.find((h) => h.id === selectedHw);
    if (!hw || !hw.session_id) {
      setAttendanceMap({});
      setSessionTitle('');
      setSessionNumber(null);
      setSessionDate('');
      return;
    }
    const reqId = ++attForHwReqIdRef.current;
    try {
      const records = await fetchAttendanceBySession(groupId, hw.session_id);
      if (reqId !== attForHwReqIdRef.current) return;
      const s = sessions.find((ss) => ss.id === hw.session_id);
      let sessData: { id: string; title: string; session_number?: number; session_date?: string } | null = null;
      if (!s) {
        const { data } = await supabase
          .from('sessions')
          .select('id, title, session_number, session_date')
          .eq('id', hw.session_id)
          .maybeSingle();
        sessData = data as typeof sessData | null;
        setSessionTitle(sessData?.title ?? '');
        setSessionNumber(sessData?.session_number ?? null);
        setSessionDate(sessData?.session_date ?? '');
      } else {
        setSessionTitle(s.title);
        setSessionNumber(null);
        setSessionDate('');
      }
      const map: Record<string, AttendanceStatus> = {};
      for (const r of records) {
        map[r.student_id] = r.status;
      }
      setAttendanceMap(map);
    } catch {
      // Keep existing data on error — do NOT wipe
    }
  }, [selectedHw, homeworkList, groupId, sessions]);

  useEffect(() => {
    loadAttendanceForHw();
  }, [loadAttendanceForHw]);

  // Compute homework summary counts
  const hwSummary = useMemo(() => {
    let complete = 0, incomplete = 0, late = 0, absent = 0, excused = 0, unrecorded = 0;
    for (const s of students) {
      const att = attendanceMap[s.id];
      if (att === 'absent') { absent++; continue; }
      if (att === 'excused_absence') { excused++; continue; }
      const st = statuses[s.id]?.status;
      if (st === 'complete') complete++;
      else if (st === 'incomplete') incomplete++;
      else if (st === 'late') late++;
      else unrecorded++;
    }
    return { total: students.length, complete, incomplete, late, absent, excused, unrecorded };
  }, [students, attendanceMap, statuses]);

  // Filter students by homework status filter
  const filteredHwStudents = useMemo(() => {
    if (hwFilter === 'all') return students;
    return students.filter((s) => {
      const att = attendanceMap[s.id];
      const st = statuses[s.id]?.status;
      if (hwFilter === 'absent') return att === 'absent';
      if (hwFilter === 'excused') return att === 'excused_absence';
      if (hwFilter === 'complete') return st === 'complete' && !isAbsent(att);
      if (hwFilter === 'incomplete') return st === 'incomplete' && !isAbsent(att);
      if (hwFilter === 'late') return st === 'late' && !isAbsent(att);
      if (hwFilter === 'unrecorded') return !st && !isAbsent(att);
      return true;
    });
  }, [students, hwFilter, attendanceMap, statuses]);

  const needsFollowUp = useMemo(() => {
    return hwSummary.incomplete + hwSummary.late + hwSummary.unrecorded;
  }, [hwSummary]);

  // Load attendance by behaviorDate for the behavior tab
  const [behaviorAttendanceMap, setBehaviorAttendanceMap] = useState<Record<string, AttendanceStatus>>({});
  useEffect(() => {
    if (tab !== 'behavior') return;
    let active = true;
    (async () => {
      try {
        const records = await fetchAttendanceForDate(groupId, behaviorDate);
        if (!active) return;
        const map: Record<string, AttendanceStatus> = {};
        for (const r of records) map[r.student_id] = r.status;
        setBehaviorAttendanceMap(map);
      } catch {
        // keep existing data on error — do NOT wipe
      }
    })();
    return () => { active = false; };
  }, [tab, groupId, behaviorDate]);

  // Real-time: subscribe to attendance changes for this group — debounced
  const attendanceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const sub = subscribeToAttendance(groupId, () => {
      if (attendanceDebounceRef.current) clearTimeout(attendanceDebounceRef.current);
      attendanceDebounceRef.current = setTimeout(() => {
        loadAttendanceForHw();
      }, 500);
    });
    return () => {
      sub.unsubscribe();
      if (attendanceDebounceRef.current) clearTimeout(attendanceDebounceRef.current);
    };
  }, [groupId, loadAttendanceForHw]);

  async function handleAddHomework() {
    if (!hwForm.title.trim()) {
      showToast('يرجى إدخال عنوان الواجب', 'error');
      return;
    }
    if (!currentSession && sessions.length === 0) {
      showToast('لا توجد حصات لهذه المجموعة — أنشئ حصة أولاً من صفحة الحضور', 'error');
      return;
    }
    const sessionId = hwForm.session_id || currentSession?.id || (sessions.length > 0 ? sessions[0].id : '');
    if (!sessionId) {
      showToast('لا توجد حصة صالحة لربط الواجب بها', 'error');
      return;
    }
    if (!hwForm.due_date) {
      showToast('يرجى اختيار موعد التسليم', 'error');
      return;
    }
    setAddingHw(true);
    try {
      const hw = await createHomework(groupId, hwForm.title.trim(), hwForm.description.trim() || null, hwForm.due_date, sessionId);
      if (hw) {
        setHwForm({ title: '', description: '', due_date: todayDateString(), session_id: '' });
        setAddHwOpen(false);
        await loadHomework();
        setSelectedHw(hw.id);
        showToast('تم إضافة الواجب بنجاح', 'success');
      } else {
        showToast('تعذّر إضافة الواجب — لم يتم إنشاء السجل', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? `تعذّر إضافة الواجب: ${err.message}` : 'تعذّر إضافة الواجب', 'error');
    } finally {
      setAddingHw(false);
    }
  }

  async function handleDeleteHomework(id: string) {
    try {
      await deleteHomework(id);
      if (selectedHw === id) setSelectedHw('');
      setHomeworkList((prev) => prev.filter((h) => h.id !== id));
      setStatuses({});
      setAttendanceMap({});
      setSessionTitle('');
      showToast('تم حذف الواجب', 'success');
    } catch (err) {
      showToast(err instanceof Error ? `تعذّر حذف الواجب: ${err.message}` : 'تعذّر حذف الواجب', 'error');
    }
  }

  async function handleDeleteAllHomework() {
    try {
      await deleteAllHomework(groupId);
      setHomeworkList([]);
      setSelectedHw('');
      setStatuses({});
      setAttendanceMap({});
      setSessionTitle('');
      showToast('تم حذف جميع الواجبات بنجاح', 'success');
    } catch {
      showToast('تعذّر حذف جميع الواجبات', 'error');
    }
  }

  const savingStatusRef = useRef<Set<string>>(new Set());
  async function handleSetStatus(student: Student, status: HomeworkStatusType) {
    if (!selectedHw) return;
    const saveKey = `${selectedHw}:${student.id}`;
    if (savingStatusRef.current.has(saveKey)) return;
    savingStatusRef.current.add(saveKey);
    const existing = statuses[student.id];
    if (existing && existing.status === status) {
      const prevStatus = existing;
      setStatuses((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
      try {
        await deleteHomeworkStatus(selectedHw, student.id);
      } catch {
        // Rollback: restore the previous status if delete failed
        setStatuses((prev) => ({ ...prev, [student.id]: prevStatus }));
        showToast('تعذّر تحديث الحالة', 'error');
      } finally {
        savingStatusRef.current.delete(saveKey);
      }
      return;
    }
    const newStatus: HomeworkStatus = {
      id: existing?.id ?? '',
      homework_id: selectedHw,
      student_id: student.id,
      status,
      teacher_note: existing?.teacher_note ?? null,
      recorded_at: new Date().toISOString(),
    };
    setStatuses((prev) => ({ ...prev, [student.id]: newStatus }));
    try {
      await upsertHomeworkStatus(selectedHw, student.id, status, existing?.teacher_note ?? null);
      // Show WhatsApp confirmation for incomplete/late — only if not already sent for this hw+student+status
      if (status === 'incomplete' || status === 'late') {
        const hw = homeworkList.find((h) => h.id === selectedHw);
        const hwTitle = hw?.title ?? 'الواجب';
        const sendKey = `${selectedHw}:${student.id}:${status}`;
        if (!hwWhatsAppSentRef.current.has(sendKey)) {
          hwWhatsAppSentRef.current.add(sendKey);
          setHwWhatsAppTarget({ student, status, homeworkTitle: hwTitle });
        }
      }
    } catch {
      setStatuses((prev) => {
        const next = { ...prev };
        if (existing) {
          next[student.id] = existing;
        } else {
          delete next[student.id];
        }
        return next;
      });
      showToast('تعذّر حفظ الحالة', 'error');
    } finally {
      savingStatusRef.current.delete(saveKey);
    }
  }

  async function handleSetBehavior(student: Student, rating: BehaviorRating) {
    const studentEvals = behavior[student.id] ?? [];
    const latest = studentEvals[0];
    if (latest && latest.rating === rating && latest.eval_date === behaviorDate) {
      setBehavior((prev) => ({
        ...prev,
        [student.id]: studentEvals.filter((e) => e.id !== latest.id),
      }));
      try {
        await deleteBehaviorEval(latest.id);
      } catch {
        showToast('تعذّر حذف التقييم', 'error');
      }
      return;
    }
    const newEval: BehaviorEval = {
      id: latest?.id ?? `temp-${Date.now()}`,
      student_id: student.id,
      group_id: groupId,
      rating,
      note: behaviorNote.trim() || null,
      eval_date: behaviorDate,
      scope: behaviorScope,
      created_at: new Date().toISOString(),
    };
    const prevEvals = behavior[student.id] ?? [];
    const dateMatchedEval = prevEvals.find((e) => e.eval_date === behaviorDate);
    setBehavior((prev) => ({ ...prev, [student.id]: [newEval, ...prevEvals.filter((e) => e.eval_date !== behaviorDate)] }));
    try {
      await upsertBehaviorEval(student.id, groupId, rating, behaviorNote.trim() || null, behaviorDate, behaviorScope);
    } catch {
      setBehavior((prev) => ({ ...prev, [student.id]: prevEvals }));
      showToast('تعذّر حفظ التقييم', 'error');
    }
  }

  function getLatestBehavior(studentId: string): BehaviorEval | null {
    const evals = behavior[studentId] ?? [];
    return evals.length > 0 ? evals[0] : null;
  }

  async function openHistory(student: Student) {
    setHistoryStudent(student);
    try {
      const evals = await fetchBehaviorEvals(student.id);
      setHistoryRecords(evals ?? []);
    } catch {
      showToast('تعذّر تحميل السجل', 'error');
      setHistoryRecords([]);
    }
  }



  if (loadError) {
    return (
      <div className="glass-card rounded-2xl p-8 text-center">
        <AlertTriangle className="mx-auto text-amber-400 mb-4" size={40} />
        <h3 className="text-lg font-bold text-white mb-2">تعذّر تحميل البيانات</h3>
        <p className="text-sm text-slate-400 mb-4">حدث خطأ. يرجى المحاولة مرة أخرى.</p>
        <Button onClick={() => {
          setLoadError(false);
          setIsLoading(true);
          Promise.all([loadHomework(), loadBehavior()])
            .catch(() => setLoadError(true))
            .finally(() => setIsLoading(false));
        }}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab('homework')}
          className={'flex-1 py-2.5 rounded-xl text-sm font-bold transition flex items-center justify-center gap-2 ' + (tab === 'homework' ? 'bg-emerald-600 text-white shadow-lg' : 'glass-light text-slate-400 hover:bg-white/10')}
        >
          <BookOpen size={16} /> الواجبات
        </button>
        <button
          onClick={() => setTab('behavior')}
          className={'flex-1 py-2.5 rounded-xl text-sm font-bold transition flex items-center justify-center gap-2 ' + (tab === 'behavior' ? 'bg-emerald-600 text-white shadow-lg' : 'glass-light text-slate-400 hover:bg-white/10')}
        >
          <ClipboardCheck size={16} /> السلوك
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {/* HOMEWORK TAB */}
          {tab === 'homework' && (
            <div className="space-y-3">
              <div className="glass-card rounded-2xl p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400">اختر واجب:</span>
                  {homeworkList.length === 0 ? (
                    <span className="text-xs text-slate-500">لا توجد واجبات بعد</span>
                  ) : (
                    <select
                      value={selectedHw}
                      onChange={(e) => setSelectedHw(e.target.value)}
                      className="glass-light rounded-lg px-3 py-1.5 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    >
                      {homeworkList.map((hw) => (
                        <option key={hw.id} value={hw.id} className="bg-slate-900">
                          {hw.title} — {formatArabicDate(hw.due_date)}
                        </option>
                      ))}
                    </select>
                  )}

                </div>
                <div className="flex gap-2">
                  <PDFButton
                    label="تصدير PDF"
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      const hw = homeworkList.find((h) => h.id === selectedHw);
                      return exportHomeworkPDF(students, statuses, hw?.title ?? 'الواجب', {});
                    }}
                    disabled={students.length === 0 || !selectedHw}
                  />
                  {canEdit && (
                    <Button size="sm" onClick={() => {
                      if (sessions.length === 0) {
                        showToast('لا توجد حصات لهذه المجموعة — أنشئ حصة أولاً من صفحة الحضور', 'error');
                        return;
                      }
                      const fallbackSession = currentSession ?? sessions[0];
                      setHwForm((prev) => ({ ...prev, session_id: fallbackSession.id }));
                      setAddHwOpen(true);
                    }}>
                      <Plus size={14} /> واجب جديد
                    </Button>
                  )}
                  {selectedHw && canDelete && (
                    <button
                      onClick={() => {
                        const hw = homeworkList.find((h) => h.id === selectedHw);
                        setDeleteConfirm({ type: 'homework', id: selectedHw, label: hw?.title });
                      }}
                      className="p-2 glass-light hover:bg-red-500/10 hover:text-red-400 text-slate-300 rounded-xl transition"
                      title="حذف الواجب"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  {homeworkList.length > 0 && canDelete && (
                    <button
                      onClick={() => setDeleteConfirm({ type: 'delete_all', id: '', label: '' })}
                      className="px-3 py-1.5 glass-light hover:bg-red-500/15 hover:text-red-400 text-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                      title="حذف كل الواجبات"
                    >
                      <Trash2 size={14} /> حذف كل الواجبات
                    </button>
                  )}
                </div>
              </div>

              {!selectedHw ? (
                <div className="glass-card rounded-2xl p-8 text-center">
                  <BookOpen className="mx-auto text-slate-600 mb-3" size={40} />
                  <p className="text-sm text-slate-400">لا يوجد واجب محدد. أنشئ واجباً جديداً لعرض الطلاب وتسجيل الحالات.</p>
                </div>
              ) : studentsLoading ? (
                <div className="glass-card rounded-2xl p-8 text-center">
                  <Loader2 className="mx-auto animate-spin text-emerald-400 mb-3" size={32} />
                  <p className="text-sm text-slate-400">جاري تحميل الطلاب...</p>
                </div>
              ) : students.length === 0 ? (
                <div className="glass-card rounded-2xl p-8 text-center">
                  <BookOpen className="mx-auto text-slate-600 mb-3" size={40} />
                  <p className="text-sm text-slate-400">لا يوجد طلاب في هذه المجموعة.</p>
                </div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                    {[
                      { label: 'إجمالي الطلاب', value: hwSummary.total, icon: Users, color: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
                      { label: 'تم', value: hwSummary.complete, icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
                      { label: 'لم يتم', value: hwSummary.incomplete, icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
                      { label: 'غير مكتمل', value: hwSummary.late, icon: AlertCircle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
                      { label: 'غائب', value: hwSummary.absent, icon: UserX, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
                      { label: 'غائب بعذر', value: hwSummary.excused, icon: UserMinus, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
                      { label: 'لم يُسجل', value: hwSummary.unrecorded, icon: HelpCircle, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
                    ].map((card) => (
                      <button
                        key={card.label}
                        onClick={() => setHwFilter('all')}
                        className={'glass-light rounded-xl p-2.5 border ' + card.border + ' flex flex-col items-center gap-1 transition hover:scale-[1.03] active:scale-95'}
                      >
                        <card.icon size={16} className={card.color} />
                        <span className={'text-lg font-bold ' + card.color}>{card.value}</span>
                        <span className="text-[10px] text-slate-400 text-center leading-tight">{card.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Smart filters */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Filter size={14} className="text-slate-500 flex-shrink-0" />
                    {([
                      { key: 'all', label: 'الكل' },
                      { key: 'complete', label: 'تم' },
                      { key: 'incomplete', label: 'لم يتم' },
                      { key: 'late', label: 'غير مكتمل' },
                      { key: 'absent', label: 'غائب' },
                      { key: 'excused', label: 'غائب بعذر' },
                      { key: 'unrecorded', label: 'لم يُسجل' },
                    ] as const).map((f) => (
                      <button
                        key={f.key}
                        onClick={() => setHwFilter(f.key)}
                        className={'px-2.5 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap ' + (hwFilter === f.key ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400 hover:bg-white/10')}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Follow-up indicator */}
                  {needsFollowUp > 0 && (
                    <button
                      onClick={() => setHwFilter(hwFilter === 'incomplete' ? 'all' : 'incomplete')}
                      className={'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition w-full ' + (hwFilter === 'incomplete' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'glass-light text-amber-400 hover:bg-amber-500/10 border border-amber-500/20')}
                    >
                      <AlertCircle size={14} />
                      {needsFollowUp} طالب يحتاج متابعة في واجب {sessionTitle || 'الحصة الحالية'}
                    </button>
                  )}

                  <div className="glass-card rounded-2xl p-4 space-y-2">
                    {sessionTitle && (
                      <p className="text-xs text-sky-400 mb-2">
                        مرتبط بالحصة: {sessionTitle}
                        {sessionNumber != null && ` (حصة ${sessionNumber})`}
                      </p>
                    )}
                    {filteredHwStudents.length === 0 && (
                      <p className="text-sm text-slate-500 text-center py-4">لا يوجد طلاب بهذه الحالة.</p>
                    )}
                    {filteredHwStudents.map((s) => {
                      const current = statuses[s.id]?.status;
                      const attStatus = attendanceMap[s.id];
                      const absent = isAbsent(attStatus);
                      const hw = selectedHw ? homeworkList.find((h) => h.id === selectedHw) : undefined;
                      const absenceDateStr = sessionDate ? formatArabicDate(sessionDate) : (hw?.due_date ? formatArabicDate(hw.due_date) : undefined);
                      return (
                        <div
                          key={s.id}
                          data-student-id={s.id}
                          className="glass-light rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm text-white font-medium truncate leading-snug">{s.name}</span>
                            <button onClick={() => setViewTarget(s)} className="p-1 rounded-lg glass-light hover:bg-sky-500/10 text-slate-400 hover:text-sky-400 transition flex-shrink-0" title="عرض">
                              <Eye size={14} />
                            </button>
                            {absent && (
                              <AbsenceBadge status={attStatus} sessionNumber={sessionNumber} sessionTitle={sessionNumber == null ? (sessionTitle || hw?.title) : undefined} date={absenceDateStr} />
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap justify-end">
                            {absent ? (
                              <span className={'text-xs font-bold px-3 py-1.5 rounded-lg ' + (attStatus === 'absent' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400')}>
                                {absenceLabel(attStatus)}
                              </span>
                            ) : !selectedHw ? (
                              <span className="text-xs text-slate-500">—</span>
                            ) : canEdit ? (
                              <div className="flex gap-1 flex-wrap sm:flex-nowrap">
                                {(Object.keys(HOMEWORK_META) as HomeworkStatusType[]).map((st) => {
                                  const meta = HOMEWORK_META[st];
                                  const isActive = current === st;
                                  return (
                                    <button
                                      key={st}
                                      onClick={() => handleSetStatus(s, st)}
                                      className={'px-2.5 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap ' + (isActive ? meta.activeClass : 'bg-white/5 text-slate-400 hover:bg-white/10')}
                                    >
                                      {meta.label}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">
                                {current ? HOMEWORK_META[current].label : 'لم يُسجل'}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Add homework modal */}
              <Modal open={addHwOpen} onClose={() => setAddHwOpen(false)} title="إضافة واجب جديد" size="md">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5">عنوان الواجب</label>
                    <input
                      type="text"
                      value={hwForm.title}
                      onChange={(e) => setHwForm({ ...hwForm, title: e.target.value })}
                      placeholder="مثال: واجب الوحدة الثانية"
                      autoFocus
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5">الوصف (اختياري)</label>
                    <textarea
                      value={hwForm.description}
                      onChange={(e) => setHwForm({ ...hwForm, description: e.target.value })}
                      rows={3}
                      placeholder="تفاصيل الواجب..."
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5">موعد التسليم</label>
                    <input
                      type="date"
                      value={hwForm.due_date}
                      onChange={(e) => {
                        setHwForm({ ...hwForm, due_date: e.target.value });
                      }}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5">الحصة المرتبطة</label>
                    {sessions.length > 0 ? (
                      <select
                        value={hwForm.session_id || currentSession?.id || sessions[0].id}
                        onChange={(e) => setHwForm((prev) => ({ ...prev, session_id: e.target.value }))}
                        className={inputCls}
                      >
                        {sessions.map((s) => (
                          <option key={s.id} value={s.id} className="bg-slate-900">{s.title}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-amber-400 py-2">لا توجد حصات لهذه المجموعة.</p>
                    )}
                  </div>
                  <div className="flex gap-3 justify-end">
                    <Button variant="secondary" onClick={() => setAddHwOpen(false)}>إلغاء</Button>
                    <Button onClick={handleAddHomework} disabled={!hwForm.title.trim() || sessions.length === 0 || addingHw}>
                      {addingHw ? <><Loader2 size={16} className="animate-spin" /> جاري الإضافة...</> : 'إضافة'}
                    </Button>
                  </div>
                </div>
              </Modal>
            </div>
          )}

          {/* BEHAVIOR TAB */}
          {tab === 'behavior' && (
            <div className="space-y-3">
              <div className="glass-card rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Calendar size={16} className="text-slate-400" />
                    <input
                      type="date"
                      value={behaviorDate}
                      onChange={(e) => setBehaviorDate(e.target.value)}
                      className="glass-light rounded-lg px-3 py-1.5 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-slate-400">نطاق التقييم:</span>
                      {SCOPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setBehaviorScope(opt.value)}
                          className={'px-3 py-1.5 rounded-lg text-xs font-bold transition ' + (behaviorScope === opt.value ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400 hover:bg-white/10')}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <PDFButton
                    label="تصدير PDF"
                    size="sm"
                    variant="primary"
                    onClick={async () => exportBehaviorPDF(students, behavior, {})}
                    disabled={students.length === 0}
                  />
                </div>
                <div>
                  <input
                    type="text"
                    value={behaviorNote}
                    onChange={(e) => setBehaviorNote(e.target.value)}
                    placeholder="ملاحظة سلوكية (اختياري)..."
                    className={inputCls}
                  />
                </div>
              </div>

              {studentsLoading ? (
                <div className="glass-card rounded-2xl p-8 text-center">
                  <Loader2 className="mx-auto animate-spin text-emerald-400 mb-3" size={32} />
                  <p className="text-sm text-slate-400">جاري تحميل الطلاب...</p>
                </div>
              ) : students.length === 0 ? (
                <div className="glass-card rounded-2xl p-8 text-center">
                  <ClipboardCheck className="mx-auto text-slate-600 mb-3" size={40} />
                  <p className="text-sm text-slate-400">لا يوجد طلاب في هذه المجموعة.</p>
                </div>
              ) : (
                <div className="glass-card rounded-2xl p-4 space-y-2">
                  <p className="text-xs text-slate-400 mb-2">
                    اضغط على التقييم لتبديله. اضغط مرة أخرى على التقييم المختار لإلغائه.
                  </p>
                  {students.map((s) => {
                    const latest = getLatestBehavior(s.id);
                    const behAbsent = isAbsent(behaviorAttendanceMap[s.id]);
                    return (
                      <div
                        key={s.id}
                        data-student-id={s.id}
                        className="glass-light rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <span className="text-sm text-white font-medium truncate leading-snug">{s.name}</span>
                          <button onClick={() => setViewTarget(s)} className="p-1 rounded-lg glass-light hover:bg-sky-500/10 text-slate-400 hover:text-sky-400 transition flex-shrink-0" title="عرض">
                            <Eye size={14} />
                          </button>
                          <AbsenceBadge status={behaviorAttendanceMap[s.id]} sessionTitle={undefined} date={formatArabicDate(behaviorDate)} />
                          {latest && (
                            <span className="text-[10px] text-slate-500 whitespace-nowrap">
                              آخر تقييم: {BEHAVIOR_OPTIONS.find((b) => b.rating === latest.rating)?.label}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1 flex-wrap sm:flex-nowrap justify-end">
                          {behAbsent ? (
                            <span className={'text-xs font-bold px-3 py-1.5 rounded-lg ' + (behaviorAttendanceMap[s.id] === 'absent' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400')}>
                              {absenceLabel(behaviorAttendanceMap[s.id])}
                            </span>
                          ) : canEdit ? (
                            <>
                              {BEHAVIOR_OPTIONS.map((opt) => {
                                const isActive = latest?.rating === opt.rating;
                                return (
                                  <button
                                    key={opt.rating}
                                    onClick={() => handleSetBehavior(s, opt.rating)}
                                    className={'px-2.5 py-1.5 rounded-lg text-xs font-bold transition ' + (isActive ? opt.activeClass : 'bg-white/5 text-slate-400 hover:bg-white/10')}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                              <button
                                onClick={() => openHistory(s)}
                                className="p-1.5 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition"
                                title="سجل السلوك"
                              >
                                <History size={14} />
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">
                              {latest
                                ? BEHAVIOR_OPTIONS.find((b) => b.rating === latest.rating)?.label
                                : isAbsentStatus(behaviorAttendanceMap[s.id])
                                  ? <span className={'font-bold ' + (behaviorAttendanceMap[s.id] === 'absent' ? 'text-red-400' : 'text-amber-400')}>{absenceLabel(behaviorAttendanceMap[s.id])}</span>
                                  : '—'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Behavior history modal */}
              <Modal
                open={!!historyStudent}
                onClose={() => setHistoryStudent(null)}
                title={'سجل السلوك — ' + (historyStudent?.name ?? '')}
                size="md"
              >
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {historyRecords.length === 0 ? (
                    <p className="text-center text-slate-400 py-6 text-sm">لا توجد تقييمات مسجلة.</p>
                  ) : (
                    historyRecords.map((ev) => (
                      <div key={ev.id} className="glass-light rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-white">
                            {BEHAVIOR_OPTIONS.find((b) => b.rating === ev.rating)?.label ?? ev.rating}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500">
                              {formatArabicDate(ev.eval_date)}
                              {ev.scope && ' • ' + (SCOPE_OPTIONS.find((o) => o.value === ev.scope)?.label ?? ev.scope)}
                            </span>
                            {canDelete && (
                              <button
                                onClick={() => setDeleteConfirm({ type: 'behavior', id: ev.id, label: BEHAVIOR_OPTIONS.find((b) => b.rating === ev.rating)?.label })}
                                className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition"
                                title="حذف"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                        {ev.note && <p className="text-xs text-slate-400 mt-1">{ev.note}</p>}
                      </div>
                    ))
                  )}
                </div>
              </Modal>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />

      <Modal
        open={!!hwWhatsAppTarget}
        onClose={() => setHwWhatsAppTarget(null)}
        title="إرسال رسالة واتساب لولي الأمر"
        size="sm"
      >
        {hwWhatsAppTarget && (() => {
          const phone = hwWhatsAppTarget.student.parent_phone ?? hwWhatsAppTarget.student.phone;
          const statusLabel = hwWhatsAppTarget.status === 'incomplete' ? 'لم يتم' : 'غير مكتمل';
          const message = `السلام عليكم ورحمة الله وبركاته 🌷\nولي أمر الطالب/ة ${hwWhatsAppTarget.student.name} المحترم،\nنحيط حضرتكم علمًا بأن واجب اليوم ${statusLabel}.\nنرجو من حضرتكم المتابعة مع الطالب/ة واستكمال الواجب، حرصًا على مستواه الدراسي وتقدمه.\nشكرًا لتعاونكم ودعمكم الدائم 🌷\n— تيم مستر عمرو خالد`;
          return (
            <div className="space-y-4">
              {!phone ? (
                <div className="glass-light rounded-xl p-4 border border-amber-500/30 flex items-center gap-2">
                  <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
                  <p className="text-sm text-amber-400">لا يوجد رقم هاتف لولي أمر هذا الطالب. لا يمكن إرسال رسالة واتساب.</p>
                </div>
              ) : (
                <div className="glass-light rounded-xl p-3 space-y-2">
                  <p className="text-xs text-slate-400">الطالب: <span className="text-white font-semibold">{hwWhatsAppTarget.student.name}</span></p>
                  <p className="text-xs text-slate-400">الواجب: <span className="text-white font-semibold">{hwWhatsAppTarget.homeworkTitle}</span></p>
                  <p className="text-xs text-slate-400">الحالة: <span className="text-white font-semibold">{statusLabel}</span></p>
                  <p className="text-xs text-slate-400">رقم ولي الأمر: <span className="text-emerald-400 font-mono" dir="ltr">{phone}</span></p>
                  <div className="border-t border-white/10 pt-2 mt-2">
                    <p className="text-[10px] text-slate-500 mb-1">معاينة الرسالة:</p>
                    <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">{message}</p>
                  </div>
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" onClick={() => setHwWhatsAppTarget(null)}>إلغاء</Button>
                {phone && (
                  <Button onClick={() => {
                    const cleanPhone = normalizePhoneForWhatsApp(phone);
                    openWhatsAppURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, showToast);
                    setHwWhatsAppTarget(null);
                  }}>
                    <MessageCircle size={16} /> إرسال
                  </Button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={async () => {
          if (!deleteConfirm) return;
          const { type, id } = deleteConfirm;
          setDeleteConfirm(null);
          if (type === 'homework') {
            await handleDeleteHomework(id);
          } else if (type === 'delete_all') {
            await handleDeleteAllHomework();
          } else if (type === 'behavior') {
            try {
              await deleteBehaviorEval(id);
              if (historyStudent) {
                const refreshed = await fetchBehaviorEvals(historyStudent.id);
                setHistoryRecords(refreshed ?? []);
              }
              await loadBehavior();
              showToast('تم حذف تقييم السلوك', 'success');
            } catch {
              showToast('تعذّر حذف التقييم', 'error');
            }
          }
        }}
        title={deleteConfirm?.type === 'delete_all' ? 'حذف كل الواجبات' : deleteConfirm?.type === 'homework' ? 'حذف الواجب' : 'حذف تقييم السلوك'}
        subtext={
          deleteConfirm?.type === 'delete_all'
            ? 'سيتم حذف جميع الواجبات وحالات الطلاب المرتبطة بها نهائياً لهذه المجموعة. هل أنت متأكد؟'
            : deleteConfirm?.type === 'homework'
              ? 'سيتم حذف الواجب «' + (deleteConfirm?.label ?? '') + '» وكل حالات الطلاب المرتبطة به نهائياً. هل أنت متأكد؟'
              : 'سيتم حذف تقييم السلوك «' + (deleteConfirm?.label ?? '') + '» نهائياً. هل أنت متأكد؟'
        }
        confirmLabel="تأكيد الحذف"
      />
    </div>
  );
}
