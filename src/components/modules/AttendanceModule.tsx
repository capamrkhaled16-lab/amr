import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WifiOff, Info } from 'lucide-react';
import { Users, DollarSign, TriangleAlert as AlertTriangle, Plus, Trash as Trash2, Archive, Clock, Calendar, Check, CheckCheck, X, Factory as History, MessageSquare, Clock3, CircleCheck as CheckCircle2, Circle as XCircle, Download, Printer, FileText, Image, Loader as Loader2, MessageCircle, Phone, Save, Eye } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import type { ToastType } from '@/components/ui/Toast';
import { useLocation } from 'react-router-dom';
import type { Student, AttendanceStatus, AttendanceRecord, Session, MonthlyArchive } from '@/lib/types';
import { STATUS_META, ARABIC_MONTHS } from '@/lib/constants';
import {
  upsertAttendance,
  fetchAttendanceForDate,
  fetchAttendanceForStudent,
  fetchSessions,
  createSession,
  deleteSession,
  fetchArchives,
  createArchive,
  fetchGroupStats,
  searchStudents,
  fetchStudentsByIds,
  monthStart,
  nextMonthStart,
  fetchGroupMonthlyPaidMap,
  subscribeToAttendance,
  subscribeToSessions,
} from '@/lib/data';
import { todayDateString, formatTime, formatArabicDate, formatCurrency, normalizePhoneForWhatsApp, openWhatsAppURL, parseScheduledHour, formatArabicTime } from '@/lib/format';
import { exportToCSV, printDocument, buildAttendancePrintHTML, exportTableAsImage, buildMonthlyAttendanceHTML } from '@/lib/export';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportAttendancePDF } from '@/lib/pdfExport';
import { supabase } from '@/lib/supabase';
import StatCard from '@/components/ui/StatCard';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import StudentViewModal360 from '@/components/ui/StudentViewModal360';
import { useMonth } from '@/context/MonthContext';
import AttendanceRingChart from '@/components/ui/AttendanceRingChart';
import { useEventRefresh } from '@/hooks/useEventRefresh';

type AttendanceModuleProps = {
  groupId: string;
  students: Student[];
  groupName?: string;
  stageName?: string;
  gradeName?: string;
  focusStudentId?: string | null;
};

const STATUS_OPTIONS: { status: AttendanceStatus; label: string; activeClass: string }[] = [
  { status: 'present', label: 'حضر', activeClass: 'bg-emerald-600 text-white shadow-lg' },
  { status: 'absent', label: 'غاب', activeClass: 'bg-red-600 text-white shadow-lg' },
  { status: 'excused_absence', label: 'غائب بعذر', activeClass: 'bg-amber-600 text-white shadow-lg' },
  { status: 'late', label: 'تأخير', activeClass: 'bg-purple-600 text-white shadow-lg' },
  { status: 'makeup', label: 'حاضر تعويضي', activeClass: 'bg-teal-600 text-white shadow-lg' },
];

type ExternalStudent = Student & { group_name?: string; grade_name?: string; stage_name?: string };

function currentMonthLabel(): string {
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const now = new Date();
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

export default function AttendanceModule({ groupId, students, groupName, stageName, gradeName, focusStudentId }: AttendanceModuleProps) {
  const { showToast, showToastWithAction, showStickyToast } = useToast();
  const location = useLocation();
  const { monthKey } = useMonth();
  const [currentMonth, setCurrentMonth] = useState(currentMonthLabel());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({});
  const [autoSaveStatus, setAutoSaveStatus] = useState('تم الحفظ ✓');
  const [addSessionOpen, setAddSessionOpen] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<Session | null>(null);
  const [archiveMonthTarget, setArchiveMonthTarget] = useState<string | null>(null);
  const [archives, setArchives] = useState<MonthlyArchive[]>([]);
  const [viewArchive, setViewArchive] = useState<MonthlyArchive | null>(null);
  const [notesStudent, setNotesStudent] = useState<Student | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [timestampStudent, setTimestampStudent] = useState<Student | null>(null);
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);
  const [historyRecords, setHistoryRecords] = useState<AttendanceRecord[]>([]);
  const [unpaidOpen, setUnpaidOpen] = useState(false);
  const [statsStudent, setStatsStudent] = useState<Student | null>(null);
  const [groupStats, setGroupStats] = useState({ totalStudents: 0, collected: 0, remaining: 0, fullyPaid: 0, partialPaid: 0 });
  const [monthlyPaidMap, setMonthlyPaidMap] = useState<Map<string, number>>(new Map());
  const [date] = useState(todayDateString());
  const [selectedDate, setSelectedDate] = useState(todayDateString());
  const [makeupOpen, setMakeupOpen] = useState(false);
  const [makeupSearch, setMakeupSearch] = useState('');
  const [makeupResults, setMakeupResults] = useState<ExternalStudent[]>([]);
  const [makeupSearching, setMakeupSearching] = useState(false);
  const [extraMakeupStudents, setExtraMakeupStudents] = useState<ExternalStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [quickStudent, setQuickStudent] = useState<Student | null>(null);
  const [absenceConfirmationStudent, setAbsenceConfirmationStudent] = useState<Student | null>(null);
  const [lateErrorStudent, setLateErrorStudent] = useState<Student | null>(null);
  const lateSaveInFlight = useRef<Set<string>>(new Set());
  const [whatsappPreview, setWhatsappPreview] = useState<{ student: Student; message: string; phone: string; sessionDate: string | null; scheduledTime: string | null; arrivalTime: string | null; delayMinutes: number | null } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const isMounted = useRef(true);
  const sessionsReqIdRef = useRef(0);
  const recordsReqIdRef = useRef(0);
  const archivesReqIdRef = useRef(0);
  const groupStatsReqIdRef = useRef(0);
  const absencesReqIdRef = useRef(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [consecutiveAbsenceMap, setConsecutiveAbsenceMap] = useState<Record<string, number>>({});
  const [filterMode, setFilterMode] = useState<'all' | 'present' | 'absent' | 'unrecorded' | 'unpaid'>('all');
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const [groupSchedule, setGroupSchedule] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevGroupIdRef = useRef<string>(groupId);
  const prevRecordsRef = useRef<Record<string, AttendanceRecord>>({});

  // ── Scroll memory: restore position on mount/date change ──
  const scrollKey = `attendance_scroll_${groupId}_${selectedDate}`;
  useEffect(() => {
    const saved = sessionStorage.getItem(scrollKey);
    if (saved) {
      const y = parseInt(saved, 10);
      if (Number.isFinite(y) && y > 0) {
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
    }
    return () => {
      sessionStorage.setItem(scrollKey, String(window.scrollY));
    };
  }, [scrollKey]);

  // ── Session persistence: keep active session across navigation, tab close, and reopen ──
  const sessionPersistKey = `attendance_active_session_${groupId}`;
  useEffect(() => {
    const saved = localStorage.getItem(sessionPersistKey);
    if (saved && sessions.some((s) => s.id === saved)) {
      setActiveSessionId(saved);
    }
  }, [sessionPersistKey, sessions]);
  useEffect(() => {
    if (activeSessionId) localStorage.setItem(sessionPersistKey, activeSessionId);
  }, [activeSessionId, sessionPersistKey]);

  // Scroll to and highlight focused student (from notification navigation)
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

  // ── Offline caching ──
  const cacheKey = `attendance_${groupId}_${selectedDate}_${activeSessionId || 'no-session'}`;

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Save records to localStorage whenever they change
  useEffect(() => {
    if (Object.keys(records).length > 0) {
      localStorage.setItem(cacheKey, JSON.stringify(records));
    }
  }, [records, cacheKey]);

  // On session/date change, clear stale cache so old session data doesn't bleed in
  useEffect(() => {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Record<string, AttendanceRecord>;
        // Only restore if every record matches the current session_id and date
        const valid = Object.values(parsed).every(
          (r) => (r.session_id ?? null) === (activeSessionId || null) && r.attendance_date === selectedDate
        );
        if (valid) {
          setRecords(parsed);
        } else {
          setRecords({});
          localStorage.removeItem(cacheKey);
        }
      } catch {
        setRecords({});
        localStorage.removeItem(cacheKey);
      }
    } else {
      setRecords({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // Cleanup on unmount — prevents memory leaks when switching groups rapidly
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // ── Smart group-transfer alert: warn when switching groups with unsaved attendance ──
  // Skip on initial mount; only fire on actual group changes after mount.
  const isFirstMountRef = useRef(true);
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      prevGroupIdRef.current = groupId;
      return;
    }
    if (prevGroupIdRef.current !== groupId) {
      const hadUnsaved = Object.keys(prevRecordsRef.current).length > 0;
      if (hadUnsaved) {
        showStickyToast(
          `تم الانتقال لمجموعة جديدة — تأكد من حفظ حالات الحضور للمجموعة السابقة قبل المتابعة.`,
          'info',
          8000
        );
      }
      prevGroupIdRef.current = groupId;
      prevRecordsRef.current = {};
    }
  }, [groupId, showStickyToast]);

  // Track records for unsaved-state detection
  useEffect(() => {
    if (Object.keys(records).length > 0) {
      prevRecordsRef.current = records;
    }
  }, [records]);

  const loadSessions = useCallback(async () => {
    const reqId = ++sessionsReqIdRef.current;
    const gid = groupId;
    const month = currentMonth;
    try {
      const data = await fetchSessions(gid, month);
      if (!isMounted.current || reqId !== sessionsReqIdRef.current) return;
      const sorted = [...data].sort((a, b) => {
        const na = parseInt(a.title.match(/\d+/)?.[0] ?? '0', 10);
        const nb = parseInt(b.title.match(/\d+/)?.[0] ?? '0', 10);
        if (na !== nb) return na - nb;
        return (a.session_date ?? a.created_at).localeCompare(b.session_date ?? b.created_at);
      });
      setSessions(sorted);
      if (sorted.length > 0 && !activeSessionId) {
        setActiveSessionId(sorted[0].id);
      } else if (sorted.length === 0) {
        setActiveSessionId('');
      }
    } catch {
      if (isMounted.current && reqId === sessionsReqIdRef.current) showToast('تعذّر تحميل الحصص', 'error');
    }
  }, [groupId, currentMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadArchives = useCallback(async () => {
    const reqId = ++archivesReqIdRef.current;
    try {
      const data = await fetchArchives(groupId);
      if (!isMounted.current || reqId !== archivesReqIdRef.current) return;
      setArchives(data);
    } catch {
      // silent — archives are non-critical
    }
  }, [groupId]);

  const loadGroupStats = useCallback(async () => {
    const reqId = ++groupStatsReqIdRef.current;
    try {
      const [stats, paidMap] = await Promise.all([fetchGroupStats(groupId, monthKey), fetchGroupMonthlyPaidMap(groupId, monthKey)]);
      if (!isMounted.current || reqId !== groupStatsReqIdRef.current) return;
      setGroupStats(stats);
      setMonthlyPaidMap(paidMap);
    } catch {
      // silent — stats are non-critical
    }
  }, [groupId, monthKey]);

  useEffect(() => {
    setIsLoading(true);
    const timeout = setTimeout(() => { if (isMounted.current) setIsLoading(false); }, 8000);
    Promise.all([loadSessions(), loadArchives(), loadGroupStats()])
      .finally(() => { if (isMounted.current) { clearTimeout(timeout); setIsLoading(false); } });
    return () => clearTimeout(timeout);
  }, [loadSessions, loadArchives, loadGroupStats]);

  // Instant cross-screen sync: re-fetch sessions/stats when other modules change data
  const attendanceLoadRef = useRef(loadSessions);
  const attendanceStatsRef = useRef(loadGroupStats);
  attendanceLoadRef.current = loadSessions;
  attendanceStatsRef.current = loadGroupStats;
  useEventRefresh(['sessions:changed', 'attendance:changed', 'students:changed'], () => {
    if (isMounted.current) {
      void attendanceLoadRef.current();
      void attendanceStatsRef.current();
    }
  });

  useEffect(() => {
    supabase.from('groups').select('schedule').eq('id', groupId).maybeSingle().then(({ data }) => {
      if (data?.schedule) setGroupSchedule(data.schedule as string);
    });
  }, [groupId]);

  const loadRecords = useCallback(async () => {
    const reqId = ++recordsReqIdRef.current;
    const gid = groupId;
    const date = selectedDate;
    const sessId = activeSessionId || null;
    try {
      const data = await fetchAttendanceForDate(gid, date, sessId);
      if (!isMounted.current || reqId !== recordsReqIdRef.current) return;
      const map: Record<string, AttendanceRecord> = {};
      for (const r of data) {
        map[r.student_id] = r;
      }
      // Replace records entirely with the fresh DB data for this session/date.
      // Merging with prev causes stale records from a previous session to persist.
      setRecords(map);
      // Resolve any external (non-roster) students previously marked as makeup for this group/date
      const rosterIds = new Set(students.map((s) => s.id));
      const externalIds = Object.keys(map).filter((sid) => !rosterIds.has(sid));
      if (externalIds.length > 0) {
        const fetched = await fetchStudentsByIds(externalIds);
        if (!isMounted.current || reqId !== recordsReqIdRef.current) return;
        setExtraMakeupStudents(fetched.map((s) => ({ ...s, group_name: undefined, grade_name: undefined, stage_name: undefined })));
      } else {
        setExtraMakeupStudents([]);
      }
    } catch {
      if (isMounted.current && reqId === recordsReqIdRef.current) {
        showToast('تعذّر تحميل سجلات الحضور', 'error');
      }
    }
  }, [groupId, selectedDate, students, activeSessionId]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    const subscription = subscribeToAttendance(groupId, (payload) => {
      const changed = payload.new ?? payload.old;
      if (!changed || changed.attendance_date !== selectedDate) return;
      if ((changed.session_id ?? null) !== (activeSessionId || null)) return;

      setRecords((prev) => {
        const next = { ...prev };
        if (payload.eventType === 'DELETE') {
          delete next[changed.student_id];
        } else if (payload.new) {
          next[payload.new.student_id] = payload.new;
        }
        return next;
      });
    });

    return () => subscription.unsubscribe();
  }, [groupId, selectedDate, activeSessionId]);

  // Real-time session sync: refetch sessions when another user (teacher) creates/edits/deletes one
  useEffect(() => {
    const sub = subscribeToSessions(groupId, () => {
      if (isMounted.current) void loadSessions();
    });
    return () => sub.unsubscribe();
  }, [groupId, loadSessions]);

  useEffect(() => {
    const reqId = ++absencesReqIdRef.current;
    const fetchConsecutiveAbsences = async () => {
      try {
      const { data } = await supabase
        .from('attendance')
        .select('student_id, status, attendance_date')
        .eq('group_id', groupId)
        .gte('attendance_date', monthStart(monthKey))
        .lt('attendance_date', nextMonthStart(monthKey))
        .order('attendance_date', { ascending: false });
      if (!isMounted.current || reqId !== absencesReqIdRef.current) return;
      if (!data) return;
      const byStudent: Record<string, { status: string; date: string }[]> = {};
      for (const r of data as { student_id: string; status: string; attendance_date: string }[]) {
        if (!byStudent[r.student_id]) byStudent[r.student_id] = [];
        byStudent[r.student_id].push({ status: r.status, date: r.attendance_date });
      }
      const map: Record<string, number> = {};
      for (const [studentId, recs] of Object.entries(byStudent)) {
        recs.sort((a, b) => b.date.localeCompare(a.date));
        let count = 0;
        for (const r of recs) {
          if (r.status === 'absent') count++;
          else break;
        }
        if (count >= 3) map[studentId] = count;
      }
      setConsecutiveAbsenceMap(map);
      } catch {
        // Silently skip — absence map is non-critical
      }
    };
    fetchConsecutiveAbsences();
  }, [groupId, monthKey]);

  function triggerAutoSave() {
    setAutoSaveStatus('جاري الحفظ...');
    setTimeout(() => setAutoSaveStatus('تم الحفظ ✓'), 500);
  }

  function getStatus(studentId: string): AttendanceStatus {
    return records[studentId]?.status ?? 'unrecorded';
  }

  function isEnrolledBeforeSession(student: Student): boolean {
    const enrollDate = (student.enrollment_date || student.created_at || '').slice(0, 10);
    return enrollDate <= selectedDate;
  }

  const whatsappBusyRef = useRef(false);
  function buildLateMessage(student: Student, minutes: number): string {
    const dateStr = formatArabicDate(selectedDate);
    const scheduledHour = parseScheduledHour(groupSchedule ?? groupName ?? null);
    const scheduledTime = scheduledHour != null ? formatArabicTime(scheduledHour, 0) : null;
    const arrivalTime = scheduledHour != null ? formatArabicTime(scheduledHour, minutes) : null;
    let msg = `🌟 تنبيه من منصة الخالد التعليمية 🌟\n\nتحية طيبة وبعد،،\nنود إبلاغكم بأن الطالب/ة: ${student.name} قد تأخر عن حضور حصة اليوم (${dateStr}) بمدة ${minutes} دقيقة.`;
    if (scheduledTime) msg += `\n⏰ موعد الحصة: ${scheduledTime}`;
    if (arrivalTime) msg += `\n🕐 وقت الحضور: ${arrivalTime}`;
    msg += `\nنرجو من سيادتكم المتابعة لضمان انتظام الطالب في الحصص القادمة.\n\n🎓 مع تحيات / تيم مستر عمرو خالد\n📅 منصة الخالد التعليمية`;
    return msg;
  }
  function buildAbsenceMessage(student: Student): string {
    const dateStr = formatArabicDate(selectedDate);
    return `🌟 تنبيه هام من منصة الخالد التعليمية 🌟\n\nتحية طيبة وبعد،،\nنود إبلاغكم بكل أسف أن الطالب/ة: ${student.name} قد تغيب عن حضور حصة اليوم (${dateStr}).\nنرجو من سيادتكم المتابعة معنا لضمان مصلحة الطالب الدراسية.\n\n🎓 مع تحيات / تيم مستر عمرو خالد\n📅 منصة الخالد التعليمية`;
  }
  function prepareWhatsAppPreview(student: Student, message: string, sessionDate?: string | null, scheduledTime?: string | null, arrivalTime?: string | null, delayMinutes?: number | null) {
    const phone = student.parent_phone ?? student.phone;
    if (!phone) {
      showToast('لا يوجد رقم هاتف لولي أمر هذا الطالب', 'error');
      return;
    }
    const cleanPhone = normalizePhoneForWhatsApp(phone);
    if (!cleanPhone || cleanPhone.length < 10) {
      showToast('رقم هاتف ولي الأمر غير صحيح — تحقق من الرقم في ملف الطالب', 'error');
      return;
    }
    setWhatsappPreview({ student, message, phone: cleanPhone, sessionDate: sessionDate ?? null, scheduledTime: scheduledTime ?? null, arrivalTime: arrivalTime ?? null, delayMinutes: delayMinutes ?? null });
  }
  function executeWhatsAppSend() {
    if (!whatsappPreview || whatsappBusyRef.current) return;
    whatsappBusyRef.current = true;
    const { phone, message } = whatsappPreview;
    setWhatsappPreview(null);
    openWhatsAppURL(`https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`, showToast);
    setTimeout(() => { whatsappBusyRef.current = false; }, 1500);
  }

  async function setStatus(student: Student, status: AttendanceStatus, lateMinutes?: number | null, silent = false, suppressToast = false): Promise<boolean> {
    if (status === 'late' && lateMinutes != null && lateMinutes < 0) {
      showToast('عدد دقائق التأخير لا يمكن أن يكون سالباً', 'error');
      return false;
    }
    triggerAutoSave();
    const existing = records[student.id];
    const prevStatus = existing?.status ?? 'unrecorded';
    // When already 'late' and updating minutes, fall through to the update path instead of toggling off.
    if (existing && existing.status === status && !(status === 'late' && lateMinutes != null)) {
      setRecords((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
      // If clearing a makeup record for an external student, drop them from the extra list too
      if (status === 'makeup' && !students.some((s) => s.id === student.id)) {
        setExtraMakeupStudents((prev) => prev.filter((s) => s.id !== student.id));
      }
      try {
        await upsertAttendance(student.id, groupId, 'unrecorded', existing.notes ?? null, selectedDate, activeSessionId || null);
        showToastWithAction(`تم إلغاء حالة ${student.name}`, 'تراجع', () => setStatus(student, prevStatus));
        return true;
      } catch (err) {
        // Restore the record so the user doesn't lose their selection
        setRecords((prev) => ({ ...prev, [student.id]: { ...existing, status: prevStatus } }));
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('network') || msg.includes('fetch')) {
          // Silent — optimistic UI already shows the change; background retry will sync
        } else if (msg.includes('duplicate') || msg.includes('unique')) {
          showToast('يوجد سجل مكرر — يتم تحديث البيانات تلقائياً', 'error');
          void loadRecords();
        } else {
          showToast(`تعذّر حفظ الحضور: ${msg || 'خطأ غير معروف'}`, 'error');
        }
        return false;
      }
    }
    const sessionId = activeSessionId || null;
    const newRecord: AttendanceRecord = {
      id: existing?.id ?? '',
      student_id: student.id,
      group_id: groupId,
      session_id: sessionId,
      status,
      notes: existing?.notes ?? null,
      attendance_date: selectedDate,
      recorded_at: new Date().toISOString(),
      late_minutes: status === 'late' ? (lateMinutes ?? existing?.late_minutes ?? null) : null,
    };
    setRecords((prev) => ({ ...prev, [student.id]: newRecord }));
    try {
      await upsertAttendance(student.id, groupId, status, existing?.notes ?? null, selectedDate, sessionId, status === 'late' ? (lateMinutes ?? existing?.late_minutes ?? null) : null);
      if (prevStatus !== 'unrecorded' && !silent) {
        showToastWithAction(`تم تغيير ${student.name} إلى ${STATUS_META[status]?.label ?? status}`, 'تراجع', () => setStatus(student, prevStatus));
      }
      return true;
    } catch (err) {
      // Preserve user-entered late_minutes so they can retry without re-typing
      const preservedLateMinutes = status === 'late' ? (lateMinutes ?? existing?.late_minutes ?? null) : null;
      setRecords((prev) => {
        const next = { ...prev };
        if (prevStatus === 'unrecorded') {
          delete next[student.id];
        } else if (existing) {
          next[student.id] = { ...existing, status: prevStatus, late_minutes: preservedLateMinutes };
        }
        return next;
      });
      if (!suppressToast) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('network') || msg.includes('fetch')) {
          // Silent — optimistic UI already shows the change; background retry will sync
        } else if (msg.includes('duplicate') || msg.includes('unique')) {
          showToast('يوجد سجل مكرر لهذا الطالب في هذه الحصة — يتم تحديث البيانات', 'error');
          void loadRecords();
        } else if (msg.includes('RLS') || msg.includes('policy')) {
          showToast('لا تملك صلاحية لتعديل هذا السجل', 'error');
        } else {
          showToast(`تعذّر حفظ الحضور: ${msg || 'خطأ غير معروف'}`, 'error');
        }
      }
      return false;
    }
  }

  async function confirmLate(student: Student, minutes: number) {
    if (lateSaveInFlight.current.has(student.id)) return;
    if (minutes <= 0) return;
    lateSaveInFlight.current.add(student.id);
    setLateErrorStudent(null);
    const existing = records[student.id];
    const isUpdate = existing?.status === 'late';
    const saved = await setStatus(student, 'late', minutes, isUpdate, true);
    lateSaveInFlight.current.delete(student.id);
    if (!saved) {
      setLateErrorStudent(student);
    }
  }

  function sendLateWhatsApp(student: Student) {
    const rec = records[student.id];
    const minutes = rec?.late_minutes ?? null;
    if (!minutes || minutes <= 0) return;
    const sessionDate = selectedDate;
    const scheduledHour = parseScheduledHour(groupSchedule ?? groupName ?? null);
    const scheduledTime = scheduledHour != null ? formatArabicTime(scheduledHour, 0) : null;
    const arrivalTime = scheduledHour != null ? formatArabicTime(scheduledHour, minutes) : null;
    prepareWhatsAppPreview(student, buildLateMessage(student, minutes), sessionDate, scheduledTime, arrivalTime, minutes);
  }

  function requestStatusChange(student: Student, status: AttendanceStatus) {
    if (status === 'absent' && getStatus(student.id) !== 'absent') {
      setAbsenceConfirmationStudent(student);
      return;
    }
    void setStatus(student, status);
  }

  async function confirmAbsence() {
    if (!absenceConfirmationStudent) return;
    const student = absenceConfirmationStudent;
    setAbsenceConfirmationStudent(null);
    await setStatus(student, 'absent');
  }

  function sendAbsenceWhatsApp(student: Student) {
    prepareWhatsAppPreview(student, buildAbsenceMessage(student));
  }

  // Combined roster: the group's own students plus any external students marked as makeup today.
  const allStudents: Student[] = useMemo(
    () => [...students, ...extraMakeupStudents],
    [students, extraMakeupStudents]
  );

  async function handleMakeupSearch(query: string) {
    setMakeupSearch(query);
    if (query.trim().length < 2) {
      setMakeupResults([]);
      return;
    }
    setMakeupSearching(true);
    try {
      const results = await searchStudents(query.trim());
      const rosterIds = new Set(students.map((s) => s.id));
      setMakeupResults(results.filter((r) => !rosterIds.has(r.id)));
    } catch {
      setMakeupResults([]);
    } finally {
      setMakeupSearching(false);
    }
  }

  async function addMakeupStudent(student: ExternalStudent) {
    // Add the external student to the extra list and immediately mark them as makeup
    setExtraMakeupStudents((prev) => (prev.some((s) => s.id === student.id) ? prev : [...prev, student]));
    setMakeupOpen(false);
    setMakeupSearch('');
    setMakeupResults([]);
    await setStatus(student, 'makeup');
  }

  function openAddSession() {
    const nextNum = computeNextSessionNumber();
    setNewSessionTitle(`الحصة ${nextNum}`);
    setSelectedDate(todayDateString());
    setAddSessionOpen(true);
  }

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const na = parseInt(a.title.match(/\d+/)?.[0] ?? '0', 10);
      const nb = parseInt(b.title.match(/\d+/)?.[0] ?? '0', 10);
      if (na !== nb) return na - nb;
      return (a.session_date ?? a.created_at).localeCompare(b.session_date ?? b.created_at);
    });
  }, [sessions]);

  function computeNextSessionNumber(): number {
    let max = 0;
    for (const s of sessions) {
      const m = s.title.match(/\d+/);
      if (m) {
        const n = parseInt(m[0], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }

  const addingSessionRef = useRef(false);
  async function handleAddSession() {
    if (addingSessionRef.current) return;
    const lessonNumber = newSessionTitle.trim();
    if (!lessonNumber) {
      showToast('أدخل رقم الحصة أولاً', 'error');
      return;
    }
    addingSessionRef.current = true;
    const sessionMonth = monthLabelForDate(selectedDate);
    setNewSessionTitle('');
    setAddSessionOpen(false);
    try {
      const sess = await createSession(groupId, lessonNumber, sessionMonth, selectedDate);
      if (sess) {
        setCurrentMonth(sessionMonth);
        setActiveSessionId(sess.id);
        const refreshed = await fetchSessions(groupId, sessionMonth);
        setSessions(refreshed);
        showToast(`تم إنشاء الحصة بتاريخ ${formatArabicDate(selectedDate)}`, 'success');
      } else {
        showToast('تعذّر حفظ الحصة، حاول مرة أخرى', 'error');
      }
    } catch {
      showToast('تعذّر حفظ الحصة، حاول مرة أخرى', 'error');
    } finally {
      addingSessionRef.current = false;
    }
  }

  async function handleDeleteSession() {
    if (!deleteSessionTarget) return;
    const target = deleteSessionTarget;
    const prevSessions = sessions;
    setSessions((prev) => prev.filter((s) => s.id !== target.id));
    setDeleteSessionTarget(null);
    try {
      await deleteSession(target.id);
      await loadSessions();
    } catch {
      setSessions(prevSessions);
      showToast('تعذّر حذف الحصة', 'error');
    }
  }

  async function handleArchiveMonth() {
    if (!archiveMonthTarget) return;
    const monthPrefix = currentMonth;
    const [yearStr, monthStr] = (() => {
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = `${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        if (label === monthPrefix) return [String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0')];
      }
      return [String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0')];
    })();
    const monthDatePrefix = `${yearStr}-${monthStr}`;

    const monthSessions = sessions.filter((s) => s.month === monthPrefix);
    const sessionIds = monthSessions.map((s) => s.id);

    const { data: monthAttendance } = await supabase
      .from('attendance')
      .select('student_id, status, attendance_date, notes, recorded_at')
      .eq('group_id', groupId)
      .gte('attendance_date', `${monthDatePrefix}-01`)
      .lte('attendance_date', `${monthDatePrefix}-31`);

    const { data: monthExams } = await supabase
      .from('center_exams')
      .select('id, title, exam_date, max_score, category')
      .eq('group_id', groupId)
      .gte('exam_date', `${monthDatePrefix}-01`)
      .lte('exam_date', `${monthDatePrefix}-31`);

    const examIds = (monthExams ?? []).map((e: { id: string }) => e.id);
    let monthGrades: { center_exam_id: string; student_id: string; score: number }[] = [];
    if (examIds.length > 0) {
      const { data: g } = await supabase
        .from('center_grades')
        .select('center_exam_id, student_id, score')
        .in('center_exam_id', examIds);
      monthGrades = (g as { center_exam_id: string; student_id: string; score: number }[]) ?? [];
    }

    const { data: monthHomework } = await supabase
      .from('homework')
      .select('id, title, due_date')
      .eq('group_id', groupId)
      .gte('due_date', `${monthDatePrefix}-01`)
      .lte('due_date', `${monthDatePrefix}-31`);

    const hwIds = (monthHomework ?? []).map((h: { id: string }) => h.id);
    let monthHwStatuses: { homework_id: string; student_id: string; status: string }[] = [];
    if (hwIds.length > 0) {
      const { data: hs } = await supabase
        .from('homework_status')
        .select('homework_id, student_id, status')
        .in('homework_id', hwIds);
      monthHwStatuses = (hs as { homework_id: string; student_id: string; status: string }[]) ?? [];
    }

    const { data: monthBehavior } = await supabase
      .from('behavior_eval')
      .select('student_id, rating, note, eval_date, scope')
      .eq('group_id', groupId)
      .gte('eval_date', `${monthDatePrefix}-01`)
      .lte('eval_date', `${monthDatePrefix}-31`);

    const archiveData = {
      monthLabel: monthPrefix,
      monthDatePrefix,
      archivedAt: new Date().toISOString(),
      sessions: monthSessions.map((s) => ({ id: s.id, title: s.title, session_date: s.session_date ?? s.created_at })),
      students: students.map((s) => ({ id: s.id, name: s.name, parent_phone: s.parent_phone, phone: s.phone, enrollment_date: s.enrollment_date })),
      attendance: (monthAttendance ?? []).map((r: { student_id: string; status: string; attendance_date: string; notes: string | null; recorded_at: string | null }) => ({
        student_id: r.student_id, status: r.status, date: r.attendance_date, notes: r.notes, recorded_at: r.recorded_at,
      })),
      exams: (monthExams ?? []).map((e: { id: string; title: string; exam_date: string; max_score: number; category: string }) => ({
        id: e.id, title: e.title, exam_date: e.exam_date, max_score: e.max_score, category: e.category,
      })),
      grades: monthGrades.map((g) => ({ exam_id: g.center_exam_id, student_id: g.student_id, score: g.score })),
      homework: (monthHomework ?? []).map((h: { id: string; title: string; due_date: string }) => ({
        id: h.id, title: h.title, due_date: h.due_date,
      })),
      hwStatuses: monthHwStatuses.map((hs) => ({ hw_id: hs.homework_id, student_id: hs.student_id, status: hs.status })),
      behavior: (monthBehavior ?? []).map((b: { student_id: string; rating: string; note: string | null; eval_date: string; scope: string }) => ({
        student_id: b.student_id, rating: b.rating, note: b.note, eval_date: b.eval_date, scope: b.scope,
      })),
    };
    await createArchive(groupId, archiveMonthTarget, archiveData);
    setArchiveMonthTarget(null);
    await loadArchives();
    showToast('تم أرشفة الشهر بنجاح مع جميع البيانات الكاملة', 'success');
  }

  function getStudentStats(student: Student) {
    const studentRecords = Object.values(records).filter((r) => r.student_id === student.id);
    const enrollDate = (student.enrollment_date || student.created_at || '').slice(0, 10);
    const eligible = studentRecords.filter((r) => r.attendance_date >= enrollDate);
    const byDate = new Map<string, typeof eligible[number]>();
    for (const r of eligible) {
      const existing = byDate.get(r.attendance_date);
      if (!existing || (r.recorded_at ?? '') > (existing.recorded_at ?? '')) {
        byDate.set(r.attendance_date, r);
      }
    }
    const deduped = Array.from(byDate.values());
    return {
      present: deduped.filter((r) => r.status === 'present').length,
      absent: deduped.filter((r) => r.status === 'absent').length,
      excused: deduped.filter((r) => r.status === 'excused_absence').length,
      late: deduped.filter((r) => r.status === 'late').length,
    };
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === students.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(students.map((s) => s.id)));
    }
  }

  function bulkSetStatus(status: AttendanceStatus) {
    students.filter((s) => selectedIds.has(s.id)).forEach((s) => setStatus(s, status));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function sendAbsenceAlertWhatsApp(student: Student) {
    if (whatsappBusyRef.current) return;
    const phone = student.parent_phone ?? student.phone;
    if (!phone) {
      showToast('لا يوجد رقم هاتف لهذا الطالب', 'error');
      return;
    }
    const cleanPhone = normalizePhoneForWhatsApp(phone);
    if (!cleanPhone || cleanPhone.length < 10) {
      showToast('رقم هاتف ولي الأمر غير صحيح — تحقق من الرقم في ملف الطالب', 'error');
      return;
    }
    whatsappBusyRef.current = true;
    const count = consecutiveAbsenceMap[student.id] ?? 3;
    const message = `السلام عليكم،\nنود إخطاركم بأن الطالب ${student.name} قد تغيب عن ${count} حصص متتالية. نرجو التواصل لمراجعة حالته.\nمع تحيات منصة الخالد التعليمية.`;
    openWhatsAppURL(`https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`, showToast);
    setTimeout(() => { whatsappBusyRef.current = false; }, 1500);
  }

  async function openStatsModal(student: Student) {
    setStatsStudent(student);
    const hist = await fetchAttendanceForStudent(student.id);
    const enrollDate = (student.enrollment_date || student.created_at || '').slice(0, 10);
    const mStart = monthStart(monthKey);
    const mEnd = nextMonthStart(monthKey);
    const filtered = hist.filter((r) => r.attendance_date >= enrollDate && r.attendance_date >= mStart && r.attendance_date < mEnd && r.group_id === groupId);
    const byDate = new Map<string, typeof filtered[number]>();
    for (const r of filtered) {
      const existing = byDate.get(r.attendance_date);
      if (!existing || (r.recorded_at ?? '') > (existing.recorded_at ?? '')) byDate.set(r.attendance_date, r);
    }
    setHistoryRecords(Array.from(byDate.values()));
  }

  const unpaidStudents = students.filter((s) => !s.is_exempt && (monthlyPaidMap.get(s.id) ?? 0) <= 0 && (s.total_fees ?? 0) > 0);

  const enrolledStudents = useMemo(() => students.filter((s) => isEnrolledBeforeSession(s)), [students, selectedDate]);
  const counts = {
    present: enrolledStudents.filter((s) => getStatus(s.id) === 'present' || getStatus(s.id) === 'late' || getStatus(s.id) === 'makeup').length,
    absent: enrolledStudents.filter((s) => getStatus(s.id) === 'absent' || getStatus(s.id) === 'excused_absence').length,
    unrecorded: enrolledStudents.filter((s) => getStatus(s.id) === 'unrecorded').length,
  };
  const recordedCount = counts.present + counts.absent;
  const totalEnrolled = enrolledStudents.length;
  const rate = totalEnrolled > 0 ? Math.round((counts.present / totalEnrolled) * 100) : 0;

  const filteredStudents = useMemo(() => {
    const eligible = students.filter((s) => isEnrolledBeforeSession(s));
    if (filterMode === 'all') return eligible;
    if (filterMode === 'present') return eligible.filter((s) => getStatus(s.id) === 'present');
    if (filterMode === 'absent') return eligible.filter((s) => getStatus(s.id) === 'absent' || getStatus(s.id) === 'excused_absence');
    if (filterMode === 'unrecorded') return eligible.filter((s) => getStatus(s.id) === 'unrecorded');
    if (filterMode === 'unpaid') return eligible.filter((s) => !s.is_exempt && (monthlyPaidMap.get(s.id) ?? 0) <= 0 && (s.total_fees ?? 0) > 0);
    return eligible;
  }, [filterMode, students, records, unpaidStudents, selectedDate]);

  if (isLoading && sessions.length === 0 && students.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-slate-400 text-sm">جاري تحميل بيانات الحضور…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Offline indicator */}
      {!isOnline && (
        <div className="glass-card rounded-2xl p-3 flex items-center gap-2 border border-amber-500/30">
          <WifiOff size={16} className="text-amber-400 flex-shrink-0" />
          <p className="text-xs text-amber-400 font-semibold">
            أنت غير متصل بالإنترنت — يتم حفظ الحضور مؤقتاً على الجهاز وسيُرسل تلقائياً عند عودة الاتصال.
          </p>
        </div>
      )}

      {/* Control bar */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-black text-white truncate">جدول الحضور والغياب</h2>
              <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-bold flex-shrink-0">
                {autoSaveStatus}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 truncate">{currentMonth} — الحفظ تلقائي</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" onClick={openAddSession}>
              <Plus size={14} /> <span className="hidden xs:inline sm:inline">حصة جديدة</span>
            </Button>
            <button
              onClick={() => activeSessionId && setDeleteSessionTarget(sessions.find((s) => s.id === activeSessionId) ?? null)}
              className="p-2.5 glass-light hover:bg-red-500/10 hover:text-red-400 text-slate-300 rounded-xl transition flex-shrink-0"
              title="حذف الحصة الحالية"
              disabled={!activeSessionId}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Session selector — shows real date for each session */}
          {sessions.length > 0 && (
            <div className="relative flex-1 min-w-[140px]">
              <select
                value={activeSessionId}
                onChange={(e) => {
                  const sess = sessions.find((s) => s.id === e.target.value);
                  setActiveSessionId(e.target.value);
                  if (sess) {
                    const sessionDate = (sess.session_date ?? sess.created_at).slice(0, 10);
                    setSelectedDate(sessionDate);
                  }
                }}
                className="w-full glass-light border border-white/10 text-emerald-400 text-xs font-bold px-3 py-2.5 rounded-xl appearance-none pr-9 pl-3 focus:outline-none cursor-pointer"
              >
                {sortedSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} — {formatArabicDate((s.session_date ?? s.created_at).slice(0, 10))}
                  </option>
                ))}
              </select>
              <Clock size={14} className="text-emerald-400 absolute right-3 top-3 pointer-events-none" />
            </div>
          )}

          {/* Month selector */}
          <div className="relative flex-1 min-w-[120px]">
            <select
              value={currentMonth}
              onChange={(e) => { setCurrentMonth(e.target.value); setActiveSessionId(''); }}
              className="w-full glass-light border border-white/10 text-emerald-400 text-xs font-bold px-3 py-2.5 rounded-xl appearance-none pr-9 pl-3 focus:outline-none cursor-pointer"
            >
              {generateMonthOptions().map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <Calendar size={14} className="text-emerald-400 absolute right-3 top-3 pointer-events-none" />
          </div>

          {/* Date picker — past/future attendance */}
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                const newDate = e.target.value;
                setSelectedDate(newDate);
                const matchingSession = sessions.find((s) => (s.session_date ?? s.created_at).slice(0, 10) === newDate);
                if (matchingSession) {
                  setActiveSessionId(matchingSession.id);
                }
              }}
              className="glass-light border border-white/10 text-emerald-400 text-xs font-bold px-3 py-2.5 rounded-xl focus:outline-none cursor-pointer"
            />
          </div>

          <Button
            size="sm"
            onClick={() => {
              triggerAutoSave();
              showToast('تم حفظ الحضور يدوياً', 'success');
            }}
          >
            <Save size={14} /> حفظ
          </Button>
          <Button size="sm" variant="warning" onClick={() => setArchiveMonthTarget(currentMonth)}>
            <Archive size={14} /> <span className="hidden xs:inline sm:inline">أرشفة</span>
          </Button>

          {/* Export / Print actions */}
          {students.length > 0 && (
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  exportToCSV(
                    `الحضور_${groupName ?? 'المجموعة'}_${selectedDate}`,
                    ['#', 'اسم الطالب', 'الحالة', 'الوقت', 'ملاحظات'],
                    students.map((s, i) => [
                      i + 1,
                      s.name,
                      STATUS_META[getStatus(s.id)]?.label ?? 'غير مسجل',
                      records[s.id]?.recorded_at ? formatTime(records[s.id].recorded_at) : '-',
                      records[s.id]?.notes?.replace(/^session:[^|]+\|/, '') ?? '-',
                    ])
                  );
                }}
                className="p-2.5 glass-light hover:bg-emerald-500/10 hover:text-emerald-400 text-slate-300 rounded-xl transition flex-shrink-0"
                title="تصدير Excel"
              >
                <Download size={15} />
              </button>
              <button
                onClick={() => {
                  const rows = students.map((s) => ({
                    name: s.name,
                    status: STATUS_META[getStatus(s.id)]?.label ?? 'غير مسجل',
                    time: records[s.id]?.recorded_at ? formatTime(records[s.id].recorded_at) : '-',
                    notes: records[s.id]?.notes?.replace(/^session:[^|]+\|/, '') ?? '-',
                  }));
                  printDocument(
                    `سجل الحضور - ${groupName ?? ''}`,
                    buildAttendancePrintHTML(groupName ?? '', stageName ?? '', gradeName ?? '', formatArabicDate(selectedDate), students.map((s) => ({ name: s.name })), false)
                  );
                }}
                className="p-2.5 glass-light hover:bg-blue-500/10 hover:text-blue-400 text-slate-300 rounded-xl transition flex-shrink-0"
                title="طباعة / PDF"
              >
                <Printer size={15} />
              </button>
              <button
                onClick={async () => {
                  const monthLabel = `${ARABIC_MONTHS[new Date(selectedDate).getMonth()]} ${new Date(selectedDate).getFullYear()}`;
                  const recordsByStudent: Record<string, { date: string; status: string }[]> = {};
                  for (const s of students) {
                    const hist = await fetchAttendanceForStudent(s.id);
                    const monthRecords = hist
                      .filter((r) => r.attendance_date.startsWith(selectedDate.slice(0, 7)))
                      .map((r) => ({ date: r.attendance_date, status: r.status }));
                    if (monthRecords.length > 0) recordsByStudent[s.id] = monthRecords;
                  }
                  const html = buildMonthlyAttendanceHTML(
                    groupName ?? '',
                    stageName ?? '',
                    gradeName ?? '',
                    monthLabel,
                    students.map((s) => ({ id: s.id, name: s.name })),
                    recordsByStudent
                  );
                  await exportTableAsImage(`تقرير_الحضور_${groupName ?? 'group'}_${selectedDate.slice(0, 7)}`, `تقرير الحضور الشهري — ${groupName ?? ''}`, html);
                }}
                className="p-2.5 glass-light hover:bg-emerald-500/10 hover:text-emerald-400 text-slate-300 rounded-xl transition flex-shrink-0"
                title="تصدير كصورة (PNG)"
              >
                <Image size={15} />
              </button>
              <button
                onClick={() => {
                  printDocument(
                    `كشف حضور فارغ - ${groupName ?? ''}`,
                    buildAttendancePrintHTML(groupName ?? '', stageName ?? '', gradeName ?? '', formatArabicDate(selectedDate), students.map((s) => ({ name: s.name })), true)
                  );
                }}
                className="p-2.5 glass-light hover:bg-amber-500/10 hover:text-amber-400 text-slate-300 rounded-xl transition flex-shrink-0"
                title="طباعة كشف حضور فارغ"
              >
                <FileText size={15} />
              </button>
              <PDFButton
                label="PDF"
                size="sm"
                variant="primary"
                onClick={async () => {
                  const activeSession = sessions.find((s) => s.id === activeSessionId);
                  const recordMap: Record<string, { status: string; notes: string | null; recorded_at: string | null; late_minutes: number | null }> = {};
                  for (const s of students) {
                    const r = records[s.id];
                    if (r) recordMap[s.id] = { status: r.status, notes: r.notes, recorded_at: r.recorded_at, late_minutes: r.late_minutes };
                  }
                  return exportAttendancePDF(students, recordMap, {
                    groupName, stageName, gradeName,
                    monthLabel: currentMonth,
                    sessionTitle: activeSession?.title,
                    date: formatArabicDate(selectedDate),
                  });
                }}
                disabled={students.length === 0}
              />
            </div>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="إجمالي طلاب المجموعة" value={students.length} icon={<Users size={20} />} color="slate" />
        <StatCard label="الطلاب المسددين" value={groupStats.fullyPaid} icon={<DollarSign size={20} />} color="emerald" />
        <button
          onClick={() => setUnpaidOpen(true)}
          className="glass-card rounded-2xl p-5 flex items-center justify-between shadow-xl text-right hover:bg-red-500/5 transition group cursor-pointer border border-red-500/20"
        >
          <div>
            <p className="text-xs text-slate-400 group-hover:text-red-300">المتبقي (لم يدفعوا)</p>
            <h3 className="text-2xl font-black text-red-400 mt-1">{unpaidStudents.length} طالب</h3>
            <span className="text-[10px] text-red-400/80 underline">اضغط لعرض القائمة</span>
          </div>
          <div className="p-3.5 bg-red-500/10 text-red-400 rounded-2xl">
            <AlertTriangle size={22} />
          </div>
        </button>
      </div>

      {/* Archive status indicator for current month */}
      {(() => {
        const isCurrentMonthArchived = archives.some((a) => a.archive_month === currentMonth);
        const currentMonthLabelStr = currentMonthLabel();
        const isPastMonth = currentMonth !== currentMonthLabelStr;
        return (
          <div className={`glass-card rounded-2xl p-3 flex items-center gap-3 border ${isCurrentMonthArchived ? 'border-emerald-500/30' : isPastMonth ? 'border-amber-500/30' : 'border-white/10'}`}>
            {isCurrentMonthArchived ? (
              <>
                <Archive size={18} className="text-emerald-400 flex-shrink-0" />
                <p className="text-xs text-emerald-400 font-bold">هذا الشهر ({currentMonth}) مؤرشف — البيانات محفوظة للقراءة فقط</p>
              </>
            ) : isPastMonth ? (
              <>
                <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
                <p className="text-xs text-amber-400 font-bold flex-1">لم يتم أرشفة شهر {currentMonth} بعد — يُنصح بأرشفته لحفظ السجلات</p>
                <Button size="sm" variant="warning" onClick={() => setArchiveMonthTarget(currentMonth)}>
                  <Archive size={14} /> أرشفة الآن
                </Button>
              </>
            ) : (
              <>
                <Clock size={18} className="text-slate-400 flex-shrink-0" />
                <p className="text-xs text-slate-400 font-semibold">الشهر الحالي ({currentMonth}) نشط — سيتم أرشفته عند انتهائه</p>
              </>
            )}
          </div>
        );
      })()}
      <div className="flex flex-wrap gap-2">
        <FilterChip label="الكل" count={students.length} active={filterMode === 'all'} onClick={() => setFilterMode('all')} color="slate" />
        <FilterChip label="الحاضرون" count={counts.present} active={filterMode === 'present'} onClick={() => setFilterMode('present')} color="emerald" />
        <FilterChip label="الغائبون" count={counts.absent} active={filterMode === 'absent'} onClick={() => setFilterMode('absent')} color="red" />
        <FilterChip label="غير مسجل" count={counts.unrecorded} active={filterMode === 'unrecorded'} onClick={() => setFilterMode('unrecorded')} color="amber" />
        <FilterChip label="لم يدفع" count={unpaidStudents.length} active={filterMode === 'unpaid'} onClick={() => setFilterMode('unpaid')} color="orange" />
      </div>

      {/* Unrecorded warning */}
      {counts.unrecorded > 0 && students.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4 border border-amber-500/30 flex items-center gap-3"
        >
          <AlertTriangle size={20} className="text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-400">يوجد {counts.unrecorded} طالب لم يُسجل حضورهم بعد</p>
            <p className="text-xs text-slate-400 mt-0.5">يجب تسجيل حالة كل الطلاب قبل حفظ أو إغلاق الحصة.</p>
          </div>
          <Button size="sm" variant="warning" onClick={() => setFilterMode('unrecorded')}>عرض غير المسجلين</Button>
        </motion.div>
      )}

      {/* Attendance stats bar */}
      {/* Attendance stats bar with ring chart */}
      <div className="glass-card rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
        <AttendanceRingChart present={counts.present} absent={counts.absent} total={totalEnrolled} rate={rate} size={120} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 w-full">
          <StatCard label="إجمالي الطلاب" value={students.length} icon={<Users size={18} />} color="slate" />
          <StatCard label="الحاضرون" value={counts.present} icon={<CheckCircle2 size={18} />} color="emerald" />
          <StatCard label="الغائبون" value={counts.absent} icon={<XCircle size={18} />} color="red" />
          <StatCard label="غير مسجل" value={counts.unrecorded} icon={<Clock3 size={18} />} color="amber" />
        </div>
      </div>

      {/* Date display + day selector */}
      <div className="glass-light rounded-xl px-4 py-2 text-center text-sm text-slate-300">
        {formatArabicDate(selectedDate)}{selectedDate !== todayDateString() && <span className="mr-2 text-amber-400 font-bold">• يوم سابق/قادم</span>}
      </div>

      {/* Smart auto-progression: when all students recorded, offer next session */}
      {students.length > 0 && counts.unrecorded === 0 && activeSessionId && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4 border border-emerald-500/30 flex flex-col sm:flex-row items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
            <CheckCheck size={18} />
            تم تسجيل جميع الطلاب في هذه الحصة
          </div>
          <button
            onClick={openAddSession}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition text-sm font-bold active:scale-95"
          >
            <Plus size={16} /> بدء الحصة التالية
          </button>
        </motion.div>
      )}

      {/* Student cards with smart warnings */}
      {students.length === 0 ? (
        <div className="glass-light rounded-xl p-8 text-center text-slate-400">
          لا يوجد طلاب في هذه المجموعة.
        </div>
      ) : (
        <div className="space-y-3">
          <div ref={scrollRef} className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400 px-1">
            <span>تسجيل الحضور ({sessions.find((s) => s.id === activeSessionId)?.title ?? 'الحصة الحالية'}) — {currentMonth} — {formatArabicDate(selectedDate)}</span>
            <span className="hidden sm:inline">💡 اضغط على حالة الطالب مرة أخرى لإلغائها</span>
          </div>

          {/* Quick action buttons */}
          <div className="flex gap-2 flex-wrap items-center">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold glass-light text-slate-300 hover:bg-white/10 transition active:scale-95 min-h-[48px]"
            >
              <Check size={18} />
              {selectedIds.size === students.length && students.length > 0 ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
            </button>
            <button
              type="button"
              onClick={() => students.forEach((s) => setStatus(s, 'present'))}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/25 transition active:scale-95 min-h-[48px]"
            >
              <CheckCheck size={18} />
              الكل حاضر
            </button>
            <button
              type="button"
              onClick={() => students.forEach((s) => setStatus(s, 'absent'))}
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-red-600/15 border border-red-500/30 text-red-400 hover:bg-red-600/25 transition active:scale-95 min-h-[48px]"
            >
              <XCircle size={18} />
              الكل غائب
            </button>
          </div>

          {/* Bulk Action Toolbar */}
          <AnimatePresence>
            {selectedIds.size > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="glass-card rounded-2xl p-4 border border-emerald-500/30 flex flex-col sm:flex-row items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                  <CheckCheck size={18} />
                  تم تحديد {selectedIds.size} طالب
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => bulkSetStatus('present')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition text-xs font-bold active:scale-95"
                  >
                    <CheckCheck size={14} /> تحديد حاضر
                  </button>
                  <button
                    onClick={() => bulkSetStatus('absent')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 transition text-xs font-bold active:scale-95"
                  >
                    <XCircle size={14} /> تحديد غائب
                  </button>
                  <button
                    onClick={() => bulkSetStatus('excused_absence')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 transition text-xs font-bold active:scale-95"
                  >
                    <Clock size={14} /> غائب بعذر
                  </button>
                  <button
                    onClick={clearSelection}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg glass-light text-slate-400 hover:text-white transition text-xs font-bold active:scale-95"
                  >
                    <X size={14} /> إلغاء
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {filteredStudents.map((s) => {
              const status = getStatus(s.id);
              const meta = STATUS_META[status] ?? STATUS_META.unrecorded;
              const record = records[s.id];
              const enrolled = isEnrolledBeforeSession(s);
              const monthlyPaid = s.is_exempt ? (s.total_fees ?? 0) : (monthlyPaidMap.get(s.id) ?? 0);
              const totalFee = s.total_fees ?? 0;
              const isExempt = s.is_exempt ?? false;
              const isFullyPaid = isExempt || (totalFee > 0 && monthlyPaid >= totalFee);
              const isPartialPaid = !isExempt && totalFee > 0 && monthlyPaid > 0 && monthlyPaid < totalFee;
              const isUnpaid = !isExempt && totalFee > 0 && monthlyPaid <= 0;
              const stats = getStudentStats(s);
              const isFrequentAbsent = stats.absent >= 2;
              const hasWarning = isUnpaid || isPartialPaid || isFrequentAbsent;
              const cardBorder = isUnpaid
                ? 'border-red-500/40 ring-1 ring-red-500/20'
                : isPartialPaid
                  ? 'border-amber-500/40 ring-1 ring-amber-500/20'
                  : isFullyPaid
                    ? 'border-emerald-500/40 ring-1 ring-emerald-500/20'
                    : 'border-white/10';

              return (
                <motion.div
                  key={s.id}
                  data-student-id={s.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`glass-card rounded-xl p-4 border ${cardBorder}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    {/* Checkbox + Student info */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleSelect(s.id)}
                        disabled={!enrolled}
                        className="w-5 h-5 rounded-lg border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/30 cursor-pointer flex-shrink-0 disabled:opacity-30"
                      />
                      <div className={`w-2.5 h-2.5 rounded-full ${enrolled ? meta.dot : 'bg-slate-600'} flex-shrink-0`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => openStatsModal(s)}
                            className="font-semibold text-white hover:text-emerald-400 transition text-sm"
                          >
                            {s.name}
                          </button>
                          <button
                            onClick={() => setQuickStudent(s)}
                            className="p-1 rounded-lg glass-light hover:bg-blue-500/10 text-slate-400 hover:text-blue-400 transition flex-shrink-0"
                            title="تفاصيل الطالب"
                          >
                            <Info size={12} />
                          </button>
                          {!enrolled && (
                            <span className="px-2.5 py-0.5 bg-slate-500/10 border border-slate-500/30 text-slate-400 rounded-full text-[10px] font-bold flex items-center gap-1 flex-shrink-0">
                              <Clock size={11} />
                              لم يكن مسجلاً بعد
                            </span>
                          )}
                          {/* Smart alert: 3+ consecutive absences */}
                          {enrolled && consecutiveAbsenceMap[s.id] >= 3 && (
                            <button
                              onClick={() => sendAbsenceAlertWhatsApp(s)}
                              className="px-2 py-0.5 bg-red-500/20 border border-red-500/40 text-red-400 rounded-full text-[10px] font-bold flex items-center gap-1 active:scale-95 transition flex-shrink-0"
                            >
                              <AlertTriangle size={11} className="animate-pulse" />
                              {consecutiveAbsenceMap[s.id]} غياب متتالي
                            </button>
                          )}
                          {/* Smart auto warnings */}
                          {enrolled && hasWarning && (
                            <span className="px-2.5 py-0.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-full text-[10px] font-bold flex items-center gap-1 flex-shrink-0">
                              <AlertTriangle size={11} />
                              {isUnpaid && isFrequentAbsent
                                ? 'إنذار: لم يدفع + غياب متكرر!'
                                : isUnpaid
                                  ? 'لم يدفع'
                                  : isPartialPaid
                                    ? 'مسدد جزئي'
                                    : 'غياب متكرر'}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                          {enrolled ? (
                            <span className="block">
                              عدد مرات الغياب: {stats.absent} | الغياب بعذر: {stats.excused}
                              {status === 'absent' && activeSessionId && (
                                <span className="text-red-400 font-bold mr-1 block sm:inline">| غائب في {sessions.find((s2) => s2.id === activeSessionId)?.title ?? 'الحصة الحالية'}</span>
                              )}
                            </span>
                          ) : (
                            <span className="block">تاريخ الانضمام: {formatArabicDate((s.enrollment_date || s.created_at).slice(0, 10))}</span>
                          )}
                          {s.phone && <span className="block sm:inline mr-0 sm:mr-2">| {s.phone}</span>}
                        </p>
                      </div>
                    </div>

                    {/* Status toggle buttons — large & touch-friendly */}
                    {enrolled ? (
                      <div className="flex flex-col gap-2 w-full sm:w-auto flex-shrink-0">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {STATUS_OPTIONS.map((opt) => {
                            const isActive = status === opt.status;
                            return (
                              <button
                                key={opt.status}
                                type="button"
                                onClick={() => requestStatusChange(s, opt.status)}
                                className={`px-3 py-3 rounded-xl text-sm font-bold transition active:scale-95 min-h-[48px] ${
                                  isActive ? opt.activeClass : 'glass-light text-slate-300 hover:bg-white/10 border border-white/10'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                        {status === 'late' && (
                          <div className="flex flex-col gap-1.5 px-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Clock3 size={14} className="text-purple-400 flex-shrink-0" />
                              <div className="flex gap-1.5">
                                {[10, 15, 20].map((m) => (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => {
                                      setRecords((prev) => ({
                                      ...prev,
                                      [s.id]: { ...prev[s.id], late_minutes: m },
                                    }));
                                      void confirmLate(s, m);
                                    }}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-95 ${
                                      records[s.id]?.late_minutes === m
                                        ? 'bg-purple-600 text-white'
                                        : 'glass-light text-slate-300 hover:bg-purple-500/20 border border-purple-500/20'
                                    }`}
                                  >
                                    {m} د
                                  </button>
                                ))}
                              </div>
                              <div className="relative flex items-center">
                                <input
                                  type="number"
                                  min={1}
                                  max={120}
                                  value={records[s.id]?.late_minutes ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value ? parseInt(e.target.value, 10) : null;
                                    setRecords((prev) => ({
                                      ...prev,
                                      [s.id]: { ...prev[s.id], late_minutes: val && val > 0 ? val : null },
                                    }));
                                    if (lateErrorStudent?.id === s.id) setLateErrorStudent(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const lm = records[s.id]?.late_minutes ?? null;
                                      if (lm && lm > 0) void confirmLate(s, lm);
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  placeholder="أخرى"
                                  className="w-20 bg-white/[0.03] border border-purple-500/30 rounded-lg py-1.5 px-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50 transition"
                                />
                                <span className="text-[10px] text-slate-400 mr-1">دقيقة</span>
                                {(() => {
                                  const lm = records[s.id]?.late_minutes ?? null;
                                  return lm && lm > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => void confirmLate(s, lm)}
                                      className="flex items-center justify-center w-6 h-6 rounded-md bg-emerald-600 text-white transition active:scale-90 hover:bg-emerald-500 flex-shrink-0"
                                      title="تأكيد التأخير"
                                    >
                                      <Check size={12} />
                                    </button>
                                  ) : null;
                                })()}
                              </div>
                            </div>
                            {lateErrorStudent?.id === s.id && (
                              <p className="text-[10px] text-red-400 px-1">تعذّر حفظ التأخير — تحقق من الاتصال وأعد الضغط على ✓</p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center w-full sm:w-auto">
                        <span className="text-xs text-slate-500 font-semibold px-4 py-3 glass-light rounded-xl border border-slate-500/20">
                          غير مقيد في هذه الحصة
                        </span>
                      </div>
                    )}

                    {/* Action icons */}
                    {enrolled && (
                      <div className="flex gap-1 flex-wrap flex-shrink-0">
                        <button
                          onClick={() => setViewTarget(s)}
                          className="p-2 rounded-lg glass-light hover:bg-sky-500/10 text-slate-400 hover:text-sky-400 transition"
                          title="عرض"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => { setNotesStudent(s); setNotesValue(records[s.id]?.notes?.replace(/^session:[^|]+\|/, '') ?? ''); }}
                          className="p-2 rounded-lg glass-light hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400 transition"
                          title="ملاحظات"
                        >
                          <MessageSquare size={14} />
                        </button>
                        <button
                          onClick={() => setTimestampStudent(s)}
                          className="p-2 rounded-lg glass-light hover:bg-blue-500/10 text-slate-400 hover:text-blue-400 transition"
                          title="وقت التسجيل"
                        >
                          <Clock3 size={14} />
                        </button>
                        <button
                          onClick={async () => { setHistoryStudent(s); const hist = await fetchAttendanceForStudent(s.id); const enrollDate = (s.enrollment_date || s.created_at || '').slice(0, 10); const mStart = monthStart(monthKey); const mEnd = nextMonthStart(monthKey); const filtered = hist.filter((r) => r.attendance_date >= enrollDate && r.attendance_date >= mStart && r.attendance_date < mEnd && r.group_id === groupId); const byDate = new Map<string, typeof filtered[number]>(); for (const r of filtered) { const ex = byDate.get(r.attendance_date); if (!ex || (r.recorded_at ?? '') > (ex.recorded_at ?? '')) byDate.set(r.attendance_date, r); } setHistoryRecords(Array.from(byDate.values())); }}
                          className="p-2 rounded-lg glass-light hover:bg-purple-500/10 text-slate-400 hover:text-purple-400 transition"
                          title="السجل التفصيلي"
                        >
                          <History size={14} />
                        </button>
                        {status === 'late' && (records[s.id]?.late_minutes ?? 0) > 0 && (
                          <button
                            onClick={() => sendLateWhatsApp(s)}
                            className="p-2 rounded-lg glass-light hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400 transition"
                            title="إرسال رسالة واتساب لولي الأمر"
                          >
                            <MessageCircle size={14} />
                          </button>
                        )}
                        {status === 'absent' && (
                          <button
                            onClick={() => sendAbsenceWhatsApp(s)}
                            className="p-2 rounded-lg glass-light hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400 transition"
                            title="إرسال رسالة واتساب لولي الأمر"
                          >
                            <MessageCircle size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          </div>
        </div>
      )}

      {/* Monthly archive section */}
      {archives.length > 0 && (
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <h3 className="font-bold text-white flex items-center gap-2 text-sm">
            <Archive size={18} className="text-emerald-400" /> أرشيف الشهور السابقة
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {archives.map((arc) => (
              <button
                key={arc.id}
                onClick={() => setViewArchive(arc)}
                className="glass-light rounded-xl p-3 text-right hover:border-emerald-500/40 transition border border-white/10"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm flex items-center gap-1.5">
                    <Calendar size={14} className="text-emerald-400" /> {arc.archive_month}
                  </span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-bold">مؤرشف</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">يحتوي على الحصص والامتحانات وسجلات الحضور.</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add Session Modal */}
      <Modal open={addSessionOpen} onClose={() => { setAddSessionOpen(false); setNewSessionTitle(''); }} title="إضافة حصة جديدة" size="sm">
        <div className="space-y-4">
          <div className="glass-light rounded-xl p-4 text-sm text-slate-300 space-y-2">
            <p className="font-bold text-white">أدخل رقم الحصة يدوياً</p>
            <p>سيتم تعبئة تاريخ اليوم تلقائياً، ويمكنك تعديله عند الحاجة.</p>
          </div>
          <label className="block space-y-2">
            <span className="text-sm font-bold text-slate-300">رقم الحصة</span>
            <input
              type="text"
              value={newSessionTitle}
              onChange={(event) => setNewSessionTitle(event.target.value)}
              placeholder="مثال: الحصة 4"
              autoFocus
              className={inputCls}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-bold text-slate-300">تاريخ الحصة</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className={inputCls}
            />
          </label>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setAddSessionOpen(false); setNewSessionTitle(''); }}>إلغاء</Button>
            <Button onClick={handleAddSession}>تأكيد الإضافة</Button>
          </div>
        </div>
      </Modal>

      {/* Absence confirmation */}
      <ConfirmDialog
        open={!!absenceConfirmationStudent}
        onClose={() => setAbsenceConfirmationStudent(null)}
        onConfirm={confirmAbsence}
        title="تأكيد تسجيل الغياب"
        subtext={`هل أنت متأكد من تسجيل غياب الطالب ${absenceConfirmationStudent?.name ?? ''}${activeSessionId ? ` في ${sessions.find((s) => s.id === activeSessionId)?.title ?? 'الحصة الحالية'}؟` : '؟'}`}
        confirmLabel="تأكيد الغياب"
      />

      {/* WhatsApp preview & confirmation */}
      <Modal open={!!whatsappPreview} onClose={() => setWhatsappPreview(null)} title="تأكيد إرسال رسالة واتساب" size="sm">
        {whatsappPreview && (
          <div className="space-y-4">
            <div className="glass-light rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">الطالب:</span>
                <span className="font-bold text-white">{whatsappPreview.student.name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-400">رقم ولي الأمر:</span>
                <span className="font-bold text-emerald-400 font-mono" dir="ltr">{whatsappPreview.phone}</span>
              </div>
              {whatsappPreview.sessionDate && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">تاريخ الحصة:</span>
                  <span className="font-bold text-white">{formatArabicDate(whatsappPreview.sessionDate)}</span>
                </div>
              )}
              {whatsappPreview.scheduledTime ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">موعد الحصة:</span>
                  <span className="font-bold text-white">{whatsappPreview.scheduledTime}</span>
                </div>
              ) : (
                <p className="text-[10px] text-amber-400">موعد الحصة غير محدد — لا يمكن حساب وقت الحضور</p>
              )}
              {whatsappPreview.delayMinutes != null && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">مدة التأخير:</span>
                  <span className="font-bold text-purple-400">{whatsappPreview.delayMinutes} دقيقة</span>
                </div>
              )}
              {whatsappPreview.arrivalTime && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-400">وقت الحضور المتوقع:</span>
                  <span className="font-bold text-amber-400">{whatsappPreview.arrivalTime}</span>
                </div>
              )}
            </div>
            <div className="glass-light rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-2">نص الرسالة:</p>
              <p className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">{whatsappPreview.message}</p>
            </div>
            <p className="text-[10px] text-slate-500">ملاحظة: فتح واتساب لا يعني التسليم. يجب الضغط على إرسال داخل واتساب.</p>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setWhatsappPreview(null)}>إلغاء الإرسال</Button>
              <Button onClick={executeWhatsAppSend}>تأكيد وإرسال واتساب</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete session confirmation */}
      <ConfirmDialog
        open={!!deleteSessionTarget}
        onClose={() => setDeleteSessionTarget(null)}
        onConfirm={handleDeleteSession}
        title="⚠️ حذف الحصة"
        subtext={`سيتم إخفاء الحصة «${deleteSessionTarget?.title ?? ''}» مع الاحتفاظ بسجلاتها للمراجعة.`}
        confirmLabel="تأكيد الحذف"
      />

      {/* Archive month confirmation */}
      <ConfirmDialog
        open={!!archiveMonthTarget}
        onClose={() => setArchiveMonthTarget(null)}
        onConfirm={handleArchiveMonth}
        title="أرشفة الشهر"
        subtext={`سيتم أرشفة شهر «${archiveMonthTarget ?? ''}» بكل الحصص والامتحانات ونقله لقسم الأرشيف.`}
        confirmLabel="تأكيد الأرشفة"
        variant="primary"
      />

      {/* Unpaid students modal */}
      <Modal open={unpaidOpen} onClose={() => setUnpaidOpen(false)} title="الطلاب المتبقين (لم يدفعوا)" size="md">
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {unpaidStudents.length === 0 ? (
            <p className="text-emerald-400 text-center py-6 glass-light rounded-xl">رائع! جميع الطلاب قاموا بدفع المصروفات.</p>
          ) : (
            unpaidStudents.map((s) => (
              <div key={s.id} className="glass-light rounded-xl p-3 flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-white text-sm">{s.name}</span>
                  <span className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-lg text-xs font-bold">
                    متبقي {(s.total_fees ?? 0) - (monthlyPaidMap.get(s.id) ?? 0)} ج.م
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                  {stageName && <span>{stageName}</span>}
                  {gradeName && <><span>/</span><span>{gradeName}</span></>}
                  {groupName && <><span>/</span><span className="text-emerald-400">{groupName}</span></>}
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Per-student stats modal */}
      <Modal open={!!statsStudent} onClose={() => setStatsStudent(null)} title={`السجل التفصيلي: ${statsStudent?.name ?? ''}`}>
        {statsStudent && (
          <div className="space-y-4">
            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBox label="حضر" value={historyRecords.filter((r) => r.status === 'present').length} color="text-emerald-400" />
              <StatBox label="غاب" value={historyRecords.filter((r) => r.status === 'absent').length} color="text-red-400" />
              <StatBox label="غاب بعذر" value={historyRecords.filter((r) => r.status === 'excused_absence').length} color="text-amber-400" />
              <StatBox label="تأخير" value={historyRecords.filter((r) => r.status === 'late').length} color="text-purple-400" />
            </div>

            {/* History list */}
            <h4 className="font-bold text-xs text-slate-300 pt-2">سجل الحضور التاريخي:</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {historyRecords.length === 0 ? (
                <p className="text-center text-slate-400 py-4 text-sm">لا يوجد سجل بعد.</p>
              ) : (
                historyRecords.map((r) => {
                  const meta = STATUS_META[r.status] ?? STATUS_META.unrecorded;
                  const sessionTitle = (r as AttendanceRecord & { sessions?: { title: string } | null }).sessions?.title;
                  return (
                    <div key={r.id} className="glass-light rounded-xl p-3 flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="text-sm text-slate-300">{formatArabicDate(r.attendance_date)}</span>
                        {sessionTitle && <span className="text-[10px] text-emerald-400 mt-0.5">{sessionTitle}</span>}
                        {r.status === 'late' && r.late_minutes != null && (
                          <span className="text-[10px] text-purple-400 mt-0.5">تأخير {r.late_minutes} دقيقة</span>
                        )}
                      </div>
                      <span className={`text-xs font-bold ${meta.color} flex items-center gap-1`}>
                        {meta.emoji} {meta.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Notes modal */}
      <Modal open={!!notesStudent} onClose={() => setNotesStudent(null)} title={`ملاحظات: ${notesStudent?.name ?? ''}`} size="sm">
        <textarea
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          rows={4}
          placeholder="أضف ملاحظة..."
          className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition resize-none"
        />
        <div className="flex gap-3 justify-end mt-4">
          <Button variant="secondary" onClick={() => setNotesStudent(null)}>إلغاء</Button>
          <Button onClick={async () => {
            if (!notesStudent) { setNotesStudent(null); return; }
            const s = notesStudent;
            setNotesStudent(null);
            try {
              await upsertAttendance(s.id, groupId, getStatus(s.id), notesValue, selectedDate, activeSessionId || null);
              showToast('تم حفظ الملاحظة', 'success');
            } catch {
              showToast('تعذّر حفظ الملاحظة', 'error');
            }
          }}>حفظ</Button>
        </div>
      </Modal>

      {/* Timestamp modal */}
      <Modal open={!!timestampStudent} onClose={() => setTimestampStudent(null)} title={`وقت التسجيل: ${timestampStudent?.name ?? ''}`} size="sm">
        {timestampStudent && records[timestampStudent.id]?.recorded_at ? (
          <div className="space-y-3 text-center">
            <div className="glass-light rounded-xl p-4">
              <p className="text-sm text-slate-400 mb-1">التاريخ</p>
              <p className="text-white font-semibold">{formatArabicDate(records[timestampStudent.id].recorded_at)}</p>
            </div>
            <div className="glass-light rounded-xl p-4">
              <p className="text-sm text-slate-400 mb-1">وقت التسجيل</p>
              <p className="text-emerald-300 font-mono text-lg font-bold">{formatTime(records[timestampStudent.id].recorded_at)}</p>
            </div>
            <div className="glass-light rounded-xl p-4">
              <p className="text-sm text-slate-400 mb-1">الحالة</p>
              <p className="text-white font-semibold">{(STATUS_META[records[timestampStudent.id].status] ?? STATUS_META.unrecorded).label} {(STATUS_META[records[timestampStudent.id].status] ?? STATUS_META.unrecorded).emoji}</p>
            </div>
          </div>
        ) : (
          <p className="text-center text-slate-400 py-6">لم يتم تسجيل حضور بعد.</p>
        )}
      </Modal>

      {/* History modal */}
      <Modal open={!!historyStudent} onClose={() => setHistoryStudent(null)} title={`سجل الحضور: ${historyStudent?.name ?? ''}`}>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {historyRecords.length === 0 ? (
            <p className="text-center text-slate-400 py-6">لا يوجد سجل حضور بعد.</p>
          ) : (
            historyRecords.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.unrecorded;
              const sessionTitle = (r as AttendanceRecord & { sessions?: { title: string } | null }).sessions?.title;
              return (
                <div key={r.id} className="glass-light rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-emerald-400" />
                    <span className="text-sm text-slate-300">{formatArabicDate(r.attendance_date)}</span>
                    <span className="text-xs text-slate-500 font-mono">{formatTime(r.recorded_at)}</span>
                    {sessionTitle && <span className="text-[10px] text-emerald-400 font-medium">— {sessionTitle}</span>}
                    {r.status === 'late' && r.late_minutes != null && (
                      <span className="text-[10px] text-purple-400 font-bold">تأخير {r.late_minutes} دقيقة</span>
                    )}
                  </div>
                  <span className={`text-sm font-bold ${meta.color} flex items-center gap-1`}>{meta.emoji} {meta.label}</span>
                </div>
              );
            })
          )}
        </div>
      </Modal>

      {/* Quick student details modal */}
      <Modal open={!!quickStudent} onClose={() => setQuickStudent(null)} title="تفاصيل الطالب" size="sm">
        {quickStudent && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold ${quickStudent.gender === 'male' ? 'bg-blue-500/15 text-blue-400' : 'bg-pink-500/15 text-pink-400'}`}>
                {quickStudent.name.charAt(0)}
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white break-words leading-snug">{quickStudent.name}</h3>
                <p className="text-sm text-slate-400">{groupName ?? '—'}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="glass-light rounded-xl p-3 text-center">
                <p className="text-xs text-slate-400 mb-1">المبلغ المتبقي</p>
                <p className="text-lg font-bold text-amber-400">{formatCurrency((quickStudent.total_fees ?? 0) - (monthlyPaidMap.get(quickStudent.id) ?? 0))} ج.م</p>
              </div>
              <div className="glass-light rounded-xl p-3 text-center">
                <p className="text-xs text-slate-400 mb-1">الكود / الرقم التسلسلي</p>
                <p className="text-lg font-bold text-emerald-400 font-mono">{(quickStudent as Student & { access_code?: string; serial_id?: string }).access_code ?? (quickStudent as Student & { access_code?: string; serial_id?: string }).serial_id ?? '—'}</p>
              </div>
            </div>
            {quickStudent.phone && (
              <div className="glass-light rounded-xl p-3 flex items-center gap-2 text-sm text-slate-300">
                <Phone size={14} className="text-slate-500" />
                <span>{quickStudent.phone}</span>
              </div>
            )}
            {quickStudent.parent_phone && quickStudent.parent_phone !== quickStudent.phone && (
              <div className="glass-light rounded-xl p-3 flex items-center gap-2 text-sm text-slate-300">
                <Phone size={14} className="text-slate-500" />
                <span>ولي الأمر: {quickStudent.parent_phone}</span>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Archive view modal */}
      <Modal open={!!viewArchive} onClose={() => setViewArchive(null)} title={`أرشيف شهر: ${viewArchive?.archive_month ?? ''}`}>
        {viewArchive && (() => {
          const d = viewArchive.archive_data as Record<string, unknown[] | string>;
          const archiveSessions = (Array.isArray(d.sessions) ? d.sessions : []) as { title: string; session_date?: string }[];
          const archiveStudents = (Array.isArray(d.students) ? d.students : (Array.isArray(d.studentsData) ? d.studentsData : [])) as { id: string; name: string; parent_phone?: string; phone?: string; attendance?: string }[];
          const archiveAttendance = (Array.isArray(d.attendance) ? d.attendance : []) as { student_id: string; status: string; date: string }[];
          const archiveExams = (Array.isArray(d.exams) ? d.exams : []) as { id: string; title: string; exam_date?: string; max_score?: number; category?: string }[];
          const archiveGrades = (Array.isArray(d.grades) ? d.grades : []) as { exam_id: string; student_id: string; score: number }[];
          const archiveHomework = (Array.isArray(d.homework) ? d.homework : []) as { id: string; title: string; due_date?: string }[];
          const archiveHwStatuses = (Array.isArray(d.hwStatuses) ? d.hwStatuses : []) as { hw_id: string; student_id: string; status: string }[];
          const archiveBehavior = (Array.isArray(d.behavior) ? d.behavior : []) as { student_id: string; rating: string; note?: string; eval_date?: string }[];

          const hasComprehensive = archiveAttendance.length > 0 || archiveExams.length > 0 || archiveHomework.length > 0 || archiveBehavior.length > 0;
          const archivedAt = typeof d.archivedAt === 'string' ? d.archivedAt : viewArchive.created_at;

          const studentAttendanceSummary = (studentId: string) => {
            const recs = archiveAttendance.filter((r) => r.student_id === studentId);
            return {
              present: recs.filter((r) => r.status === 'present').length,
              absent: recs.filter((r) => r.status === 'absent').length,
              excused: recs.filter((r) => r.status === 'excused_absence').length,
              late: recs.filter((r) => r.status === 'late').length,
              total: recs.length,
            };
          };
          const studentGrades = (studentId: string) =>
            archiveGrades.filter((g) => g.student_id === studentId).map((g) => ({
              exam: archiveExams.find((e) => e.id === g.exam_id),
              score: g.score,
            }));

          return (
            <div className="space-y-4">
              <div className="glass-light rounded-xl p-3 flex items-center justify-between text-xs">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <Archive size={14} /> مؤرشف — للقراءة فقط
                </span>
                <span className="text-slate-500">تاريخ الأرشفة: {formatArabicDate(archivedAt.slice(0, 10))}</span>
              </div>

              {/* Sessions */}
              <div className="glass-light rounded-xl p-4">
                <h4 className="font-bold text-slate-300 text-sm mb-2 flex items-center gap-2">
                  <Calendar size={14} className="text-emerald-400" /> الحصص ({archiveSessions.length})
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {archiveSessions.map((sess, i) => (
                    <div key={i} className="text-xs text-slate-300 flex items-center gap-1.5">
                      <Check size={11} className="text-emerald-400" /> {sess.title}
                    </div>
                  ))}
                  {archiveSessions.length === 0 && <span className="text-xs text-slate-500">لا توجد حصص</span>}
                </div>
              </div>

              {hasComprehensive ? (
                <>
                  {/* Students with full summary */}
                  <div className="glass-light rounded-xl p-4">
                    <h4 className="font-bold text-slate-300 text-sm mb-3 flex items-center gap-2">
                      <Users size={14} className="text-emerald-400" /> الطلاب ({archiveStudents.length})
                    </h4>
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {archiveStudents.map((stu) => {
                        const att = studentAttendanceSummary(stu.id);
                        const grades = studentGrades(stu.id);
                        const behavior = archiveBehavior.filter((b) => b.student_id === stu.id);
                        const hw = archiveHwStatuses.filter((h) => h.student_id === stu.id);
                        return (
                          <div key={stu.id} className="glass-light rounded-lg p-2.5 border border-white/5">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-bold text-white text-sm">{stu.name}</span>
                              {stu.parent_phone && <span className="text-[10px] text-slate-500">{stu.parent_phone}</span>}
                            </div>
                            <div className="flex flex-wrap gap-1.5 text-[10px]">
                              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 rounded-full">حضور: {att.present}</span>
                              <span className="px-2 py-0.5 bg-red-500/10 text-red-400 rounded-full">غياب: {att.absent}</span>
                              <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full">بعذر: {att.excused}</span>
                              <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full">تأخير: {att.late}</span>
                              {grades.map((g, i) => (
                                <span key={i} className="px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full">
                                  {g.exam?.title ?? 'امتحان'}: {g.score}/{g.exam?.max_score ?? '?'}
                                </span>
                              ))}
                              {behavior.map((b, i) => (
                                <span key={i} className="px-2 py-0.5 bg-teal-500/10 text-teal-400 rounded-full">سلوك: {b.rating}</span>
                              ))}
                              {hw.map((h, i) => (
                                <span key={i} className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full">واجب: {h.status}</span>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Exams summary */}
                  {archiveExams.length > 0 && (
                    <div className="glass-light rounded-xl p-4">
                      <h4 className="font-bold text-slate-300 text-sm mb-2 flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-emerald-400" /> الامتحانات ({archiveExams.length})
                      </h4>
                      <div className="space-y-1.5">
                        {archiveExams.map((ex) => (
                          <div key={ex.id} className="text-xs text-slate-300 flex justify-between">
                            <span>{ex.title}</span>
                            <span className="text-slate-500">{ex.category ?? ''} — {ex.exam_date ? formatArabicDate(ex.exam_date.slice(0, 10)) : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Homework summary */}
                  {archiveHomework.length > 0 && (
                    <div className="glass-light rounded-xl p-4">
                      <h4 className="font-bold text-slate-300 text-sm mb-2 flex items-center gap-2">
                        <FileText size={14} className="text-emerald-400" /> الواجبات ({archiveHomework.length})
                      </h4>
                      <div className="space-y-1.5">
                        {archiveHomework.map((hw) => (
                          <div key={hw.id} className="text-xs text-slate-300 flex justify-between">
                            <span>{hw.title}</span>
                            <span className="text-slate-500">{hw.due_date ? formatArabicDate(hw.due_date.slice(0, 10)) : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="glass-light rounded-xl p-4">
                  <h4 className="font-bold text-slate-300 text-sm mb-2">بيانات الطلاب:</h4>
                  <div className="space-y-1.5">
                    {archiveStudents.map((stu, i) => (
                      <div key={i} className="text-xs text-slate-300 flex justify-between">
                        <span>{stu.name}</span>
                        <span className="text-slate-500">{stu.attendance ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <StudentViewModal360
        open={!!viewTarget}
        student={viewTarget ? { ...viewTarget, group_name: groupName, grade_name: gradeName, stage_name: stageName } : null}
        onClose={() => setViewTarget(null)}
      />
    </div>
  );
}

function FilterChip({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: 'slate' | 'emerald' | 'red' | 'amber' | 'orange' }) {
  const colorMap = {
    slate: active ? 'bg-slate-600 text-white border-slate-500' : 'glass-light text-slate-400 border-white/10',
    emerald: active ? 'bg-emerald-600 text-white border-emerald-500' : 'glass-light text-emerald-400 border-white/10',
    red: active ? 'bg-red-600 text-white border-red-500' : 'glass-light text-red-400 border-white/10',
    amber: active ? 'bg-amber-600 text-white border-amber-500' : 'glass-light text-amber-400 border-white/10',
    orange: active ? 'bg-orange-600 text-white border-orange-500' : 'glass-light text-orange-400 border-white/10',
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition active:scale-95 ${colorMap[color]}`}
    >
      {label}
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20' : 'bg-white/10'}`}>{count}</span>
    </button>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="glass-light rounded-xl p-3 text-center">
      <span className="text-xs text-slate-400 block mb-1">{label}</span>
      <span className={`text-base font-bold ${color}`}>{value}</span>
    </div>
  );
}

function monthLabelForDate(dateString: string): string {
  const [year, month] = dateString.split('-').map(Number);
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return `${months[(month ?? 1) - 1]} ${year}`;
}

function generateMonthOptions(): string[] {
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const now = new Date();
  const options: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push(`${months[d.getMonth()]} ${d.getFullYear()}`);
  }
  return options;
}

const inputCls =
  'w-full glass-light rounded-xl py-2.5 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm';
