import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, Award, Loader2, FileText, BookOpen, Mic, Heart, Pencil, Check, AlertTriangle, Link2, Eye, RotateCcw } from 'lucide-react';
import StudentViewModal from '@/components/ui/StudentViewModal';
import AbsenceBadge, { isAbsentStatus, absenceLabel } from '@/components/ui/AbsenceBadge';
import type { Student, CenterExam, CenterExamCategory, Session, CenterGrade, AttendanceStatus, AttendanceRecord } from '@/lib/types';
import {
  fetchCenterExams,
  createCenterExam,
  deleteCenterExam,
  fetchCenterGrades,
  upsertCenterGrade,
  updateCenterExamMaxScore,
  updateCenterExamTitle,
  fetchSessions,
  fetchAttendanceBySession,
  fetchAttendanceForDate,
  subscribeToAttendance,
} from '@/lib/data';
import { getGradeRating, formatArabicDate } from '@/lib/format';
import { calcExamAverage, type RawGrade } from '@/lib/gradeCalc';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { useMonth } from '@/context/MonthContext';
import { usePersistedState, getPersistedId, setPersistedId } from '@/hooks/usePersistedState';

type CenterGradesProps = {
  groupId: string;
  students: Student[];
  focusStudentId?: string | null;
};

const CATEGORIES: { id: CenterExamCategory; label: string; icon: typeof BookOpen }[] = [
  { id: 'exam', label: 'امتحانات', icon: BookOpen },
  { id: 'sheet', label: 'شيتات', icon: FileText },
  { id: 'recitation', label: 'تسميع', icon: Mic },
  { id: 'behavior', label: 'سلوك', icon: Heart },
];

export default function CenterGrades({ groupId, students, focusStudentId }: CenterGradesProps) {
  const { showToast } = useToast();
  const { can, isMaster } = useAuth();
  const { monthKey, monthLabel } = useMonth();
  const canEdit = isMaster || can('can_edit_grades');
  const canDelete = isMaster || can('can_delete_evals');
  const persistKey = `cg_${groupId}`;
  const [exams, setExams] = useState<CenterExam[]>([]);
  const [selectedExam, setSelectedExam] = useState<CenterExam | null>(null);
  const [activeCategory, setActiveCategory] = usePersistedState<CenterExamCategory>(`${persistKey}_cat`, 'exam');
  const [grades, setGrades] = useState<Record<string, number>>({});
  const [draftScores, setDraftScores] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CenterExam | null>(null);
  const [form, setForm] = useState<{ title: string; maxScore: string; passScore: string; category: CenterExamCategory; sessionId: string }>({ title: '', maxScore: '', passScore: '', category: 'exam', sessionId: '' });
  const [adding, setAdding] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [editMaxScoreOpen, setEditMaxScoreOpen] = useState(false);
  const [editMaxValue, setEditMaxValue] = useState('');
  const [editPassValue, setEditPassValue] = useState('');
  const [editTitleOpen, setEditTitleOpen] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [gradeFilter, setGradeFilter] = usePersistedState<'all' | 'graded' | 'ungraded' | 'passed' | 'failed'>(`${persistKey}_filter`, 'all');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>({});
  const gradesReqIdRef = useRef(0);
  const attendanceReqIdRef = useRef(0);

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

  const isRecitation = activeCategory === 'recitation';

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchSessions(groupId, monthLabel);
      const sorted = [...data].sort((a, b) => {
        const na = parseInt(a.title.match(/\d+/)?.[0] ?? '0', 10);
        const nb = parseInt(b.title.match(/\d+/)?.[0] ?? '0', 10);
        if (na !== nb) return nb - na;
        return (b.session_date ?? b.created_at).localeCompare(a.session_date ?? a.created_at);
      });
      setSessions(sorted);
    } catch (error) {
      setSessions([]);
      throw error;
    }
  }, [groupId, monthLabel]);

  const selectedExamRef = useRef<CenterExam | null>(null);
  selectedExamRef.current = selectedExam;

  const loadExams = useCallback(async () => {
    try {
      const data = await fetchCenterExams(groupId, monthKey);
      setExams(data);
      const filtered = data.filter((e) => (e.category ?? 'exam') === activeCategory);
      const savedId = getPersistedId(`${persistKey}_exam`);
      const match = savedId ? filtered.find((e) => e.id === savedId) : null;
      const current = selectedExamRef.current;
      if (match) {
        setSelectedExam(match);
      } else if (filtered.length > 0) {
        if (!current || !filtered.some((e) => e.id === current.id)) {
          setSelectedExam(filtered[0]);
        }
      } else {
        setSelectedExam(null);
      }
    } catch (error) {
      showToast('تعذّر تحميل التقييمات', 'error');
      throw error;
    }
  }, [groupId, activeCategory, persistKey, showToast, monthKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    Promise.all([loadExams(), loadSessions()])
      .then(() => { if (!cancelled) setLoadError(false); })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => {});
    return () => { cancelled = true; };
  }, [loadExams, loadSessions]);

  useEffect(() => {
    setPersistedId(`${persistKey}_exam`, selectedExam?.id ?? null);
  }, [selectedExam, persistKey]);

  const loadGrades = useCallback(async () => {
    if (!selectedExam) return;
    const reqId = ++gradesReqIdRef.current;
    try {
      const data = await fetchCenterGrades(selectedExam.id);
      if (reqId !== gradesReqIdRef.current) return;
      const map: Record<string, number> = {};
      for (const g of data as CenterGrade[]) {
        map[g.student_id] = g.score;
      }
      setGrades(map);
      const draftMap: Record<string, string> = {};
      for (const [sid, score] of Object.entries(map)) {
        draftMap[sid] = String(score);
      }
      setDraftScores(draftMap);
    } catch {
      if (reqId === gradesReqIdRef.current) {
        showToast('تعذّر تحميل الدرجات', 'error');
      }
    }
  }, [selectedExam]);

  useEffect(() => {
    loadGrades();
  }, [loadGrades]);

  const loadAttendance = useCallback(async () => {
    if (!selectedExam) {
      setAttendanceMap({});
      return;
    }
    const reqId = ++attendanceReqIdRef.current;
    try {
      let records: AttendanceRecord[];
      if (selectedExam.session_id) {
        records = await fetchAttendanceBySession(groupId, selectedExam.session_id);
      } else {
        const examDate = (selectedExam.exam_date || selectedExam.created_at).slice(0, 10);
        records = await fetchAttendanceForDate(groupId, examDate);
      }
      if (reqId !== attendanceReqIdRef.current) return;
      const map: Record<string, AttendanceStatus> = {};
      for (const r of records) {
        map[r.student_id] = r.status;
      }
      setAttendanceMap(map);
    } catch {
      if (reqId === attendanceReqIdRef.current) {
        setAttendanceMap({});
      }
    }
  }, [groupId, selectedExam]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  // Real-time: subscribe to attendance changes for this group so absence syncs live
  useEffect(() => {
    const sub = subscribeToAttendance(groupId, () => {
      loadAttendance();
    });
    return () => sub.unsubscribe();
  }, [groupId, loadAttendance]);

  function openAddModal() {
    if (isRecitation && sessions.length > 0) {
      const latest = sessions[0];
      setForm({ title: `تسميع ${latest.title}`, maxScore: '', passScore: '', category: 'recitation', sessionId: latest.id });
    } else {
      setForm({ title: '', maxScore: '', passScore: '', category: activeCategory, sessionId: '' });
    }
    setAddOpen(true);
  }

  async function handleAddExam() {
    if (!form.title.trim()) {
      showToast('يرجى إدخال عنوان التقييم', 'error');
      return;
    }
    const maxScoreNum = parseFloat(form.maxScore);
    if (!Number.isFinite(maxScoreNum) || maxScoreNum <= 0) {
      showToast('يرجى إدخال درجة عظمى صحيحة', 'error');
      return;
    }
    const passScoreNum = parseFloat(form.passScore);
    if (!Number.isFinite(passScoreNum) || passScoreNum < 0 || passScoreNum > maxScoreNum) {
      showToast('يرجى إدخال درجة نجاح صحيحة (بين 0 والدرجة العظمى)', 'error');
      return;
    }
    setAdding(true);
    try {
      const exam = await createCenterExam(
        groupId,
        form.title.trim(),
        maxScoreNum,
        passScoreNum,
        form.category,
        form.sessionId || null
      );
      if (exam) {
        setForm({ title: '', maxScore: '', passScore: '', category: 'exam', sessionId: '' });
        setAddOpen(false);
        await loadExams();
        setSelectedExam(exam);
        showToast('تم إضافة التقييم بنجاح — يرجى إدخال درجات الطلاب الآن', 'success');
      } else {
        showToast('تعذّر إضافة التقييم — لم يتم إنشاء السجل', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? `تعذّر إضافة التقييم: ${err.message}` : 'تعذّر إضافة التقييم', 'error');
    } finally {
      setAdding(false);
    }
  }

  function updateDraftScore(studentId: string, value: string) {
    setDraftScores((prev) => ({ ...prev, [studentId]: value }));
  }

  async function saveScore(studentId: string) {
    if (!selectedExam) return;
    const raw = (draftScores[studentId] ?? '').trim();
    if (raw === '') return;
    const score = parseFloat(raw);
    if (!Number.isFinite(score) || score < 0) {
      showToast('خطأ: الدرجة يجب أن تكون رقماً موجباً', 'error');
      setDraftScores((prev) => ({ ...prev, [studentId]: grades[studentId] === undefined ? '' : String(grades[studentId]) }));
      return;
    }
    if (score > maxScore) {
      showToast(`خطأ: لا يمكن أن تتجاوز الدرجة القيمة العظمى (${maxScore})`, 'error');
      setDraftScores((prev) => ({ ...prev, [studentId]: grades[studentId] === undefined ? '' : String(grades[studentId]) }));
      return;
    }
    const prevGrade = grades[studentId];
    const prevDraft = draftScores[studentId];
    setGrades((prev) => ({ ...prev, [studentId]: score }));
    setDraftScores((prev) => ({ ...prev, [studentId]: raw }));
    try {
      await upsertCenterGrade(selectedExam.id, studentId, score, false, 'center');
    } catch (err) {
      setGrades((prev) => {
        const next = { ...prev };
        if (prevGrade === undefined) delete next[studentId]; else next[studentId] = prevGrade;
        return next;
      });
      setDraftScores((prev) => ({ ...prev, [studentId]: prevDraft ?? '' }));
      showToast(err instanceof Error ? err.message : 'تعذّر حفظ الدرجة', 'error');
    }
  }

  async function handleEditMaxScore() {
    if (!selectedExam) return;
    const newMax = parseFloat(editMaxValue);
    const newPass = parseFloat(editPassValue);
    if (!Number.isFinite(newMax) || newMax <= 0) {
      showToast('الدرجة العظمى يجب أن تكون رقماً موجباً', 'error');
      return;
    }
    if (Number.isFinite(newPass) && (newPass < 0 || newPass > newMax)) {
      showToast('درجة النجاح يجب أن تكون بين 0 والدرجة العظمى', 'error');
      return;
    }
    try {
      await updateCenterExamMaxScore(
        selectedExam.id,
        newMax,
        Number.isFinite(newPass) ? newPass : Math.round(newMax / 2)
      );
      setEditMaxScoreOpen(false);
      await loadExams();
      showToast('تم تحديث الدرجة العظمى وتُعيد حساب النسب تلقائياً', 'success');
    } catch {
      showToast('تعذّر تحديث الدرجة العظمى', 'error');
    }
  }

  async function handleEditTitle() {
    if (!selectedExam) return;
    const newTitle = editTitleValue.trim();
    if (!newTitle) return;
    try {
      await updateCenterExamTitle(selectedExam.id, newTitle);
      setEditTitleOpen(false);
      await loadExams();
      showToast('تم تحديث عنوان التقييم', 'success');
    } catch {
      showToast('تعذّر تحديث العنوان', 'error');
    }
  }
  const categoryExams = exams.filter((e) => (e.category ?? 'exam') === activeCategory);
  const passScore = selectedExam?.pass_score ?? 50;
  const maxScore = selectedExam?.max_score ?? 100;
  const validScores = students.map((s) => grades[s.id]).filter((s): s is number => s !== undefined);
  const rawGrades: RawGrade[] = students
    .map((s) => ({ student_id: s.id, score: grades[s.id]!, max_score: maxScore, center_exam_id: selectedExam?.id }))
    .filter((g) => g.score !== undefined && g.score !== null) as RawGrade[];
  const avgResult = calcExamAverage(rawGrades);
  const avg = avgResult.averageScore;
  const passed = validScores.filter((s) => s >= passScore).length;
  const failed = validScores.filter((s) => s < passScore).length;
  const absentCount = students.filter((s) => isAbsentStatus(attendanceMap[s.id])).length;
  const ungradedCount = students.length - validScores.length - absentCount;

  const filteredStudents = useMemo(() => {
    if (!selectedExam) return students;
    if (gradeFilter === 'all') return students;
    if (gradeFilter === 'graded') return students.filter((s) => s.id in grades);
    if (gradeFilter === 'ungraded') return students.filter((s) => !(s.id in grades));
    if (gradeFilter === 'passed') return students.filter((s) => s.id in grades && grades[s.id] >= passScore);
    if (gradeFilter === 'failed') return students.filter((s) => s.id in grades && grades[s.id] < passScore);
    return students;
  }, [gradeFilter, students, grades, selectedExam, passScore]);

  const boundSession = useMemo(() => {
    if (!selectedExam?.session_id) return null;
    return sessions.find((s) => s.id === selectedExam.session_id) ?? null;
  }, [selectedExam, sessions]);

  const examDateLabel = selectedExam ? formatArabicDate((selectedExam.exam_date || selectedExam.created_at).slice(0, 10)) : '';

  if (loadError && exams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertTriangle size={32} className="text-red-400" />
        <p className="text-slate-400 text-sm">تعذّر تحميل التقييمات. يرجى المحاولة مرة أخرى.</p>
        <Button size="sm" variant="secondary" onClick={() => { setLoadError(false); Promise.all([loadExams(), loadSessions()]).catch(() => setLoadError(true)); }}>
          <RotateCcw size={14} /> إعادة المحاولة
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Recitation info banner */}
      {isRecitation && sessions.length > 0 && (
        <div className="glass-card rounded-2xl p-4 border border-sky-500/20 flex items-center gap-3 mb-4">
          <div className="p-2 bg-sky-500/15 text-sky-400 rounded-xl flex-shrink-0">
            <Mic size={18} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-sky-400">وضع التسميع</p>
            <p className="text-xs text-slate-400 mt-0.5">
              يتم ربط درجات التسميع تلقائياً بالحصة الحالية ({sessions[0]?.title}). يمكن تعديل أو حذف الدرجات في أي وقت.
            </p>
          </div>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const count = exams.filter((e) => (e.category ?? 'exam') === cat.id).length;
          return (
            <button
              key={cat.id}
              onClick={() => { setActiveCategory(cat.id); setSelectedExam(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                activeCategory === cat.id
                  ? 'bg-emerald-600 text-white'
                  : 'glass-light text-slate-400 hover:text-white'
              }`}
            >
              <Icon size={16} /> {cat.label}
              {count > 0 && <span className="text-[10px] opacity-70">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Exam tabs within category */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {categoryExams.map((ex) => (
            <button
              key={ex.id}
              onClick={() => setSelectedExam(ex)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 ${
                selectedExam?.id === ex.id
                  ? 'bg-emerald-600 text-white'
                  : 'glass-light text-slate-400 hover:text-white'
              }`}
            >
              {ex.category === 'recitation' && <Link2 size={12} className={selectedExam?.id === ex.id ? 'text-white' : 'text-sky-400'} />}
              {ex.title}
            </button>
          ))}
          {categoryExams.length === 0 && (
            <p className="text-slate-400 text-sm py-2">لا توجد {CATEGORIES.find((c) => c.id === activeCategory)?.label} بعد.</p>
          )}
        </div>
        {canEdit && (
          <Button size="sm" onClick={openAddModal}>
            <Plus size={16} /> إضافة
          </Button>
        )}
      </div>

      {/* Session binding badge for recitation exams */}
      {selectedExam?.category === 'recitation' && boundSession && (
        <div className="glass-light rounded-xl p-3 mb-4 flex items-center gap-2 text-xs">
          <Link2 size={14} className="text-sky-400" />
          <span className="text-slate-400">مرتبط بـ</span>
          <span className="text-sky-400 font-bold">{boundSession.title}</span>
          <span className="text-slate-500">— {formatArabicDate((boundSession.session_date ?? boundSession.created_at).slice(0, 10))}</span>
        </div>
      )}

      {/* Incomplete grades warning */}
      {selectedExam && ungradedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4 border border-amber-500/30 flex items-center gap-3 mb-4"
        >
          <AlertTriangle size={20} className="text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-400">تنبيه: يوجد {ungradedCount} طالب لم يتم إدخال درجاتهم</p>
            <p className="text-xs text-slate-400 mt-0.5">تم إنشاء «{selectedExam.title}» ولكن هناك درجات لم تُسجل بعد. هل تريد المتابعة؟</p>
          </div>
          <Button size="sm" variant="warning" onClick={() => setGradeFilter('ungraded')}>عرض غير مقيّمين</Button>
        </motion.div>
      )}

      {/* Smart filter buttons */}
      {selectedExam && students.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <GradeFilterChip label="الكل" count={students.length} active={gradeFilter === 'all'} onClick={() => setGradeFilter('all')} color="slate" />
          <GradeFilterChip label="مقيّم" count={validScores.length} active={gradeFilter === 'graded'} onClick={() => setGradeFilter('graded')} color="emerald" />
          <GradeFilterChip label="غير مقيّم" count={ungradedCount} active={gradeFilter === 'ungraded'} onClick={() => setGradeFilter('ungraded')} color="amber" />
          <GradeFilterChip label="ناجح" count={passed} active={gradeFilter === 'passed'} onClick={() => setGradeFilter('passed')} color="emerald" />
          <GradeFilterChip label="راسب" count={failed} active={gradeFilter === 'failed'} onClick={() => setGradeFilter('failed')} color="red" />
        </div>
      )}

      {/* Stats */}
      {selectedExam && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4"
        >
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xs text-slate-400">الدرجة العظمى</p>
            <p className="text-xl font-bold text-white">{maxScore}</p>
            <button
              onClick={() => { setEditMaxValue(String(selectedExam.max_score)); setEditPassValue(String(selectedExam.pass_score)); setEditMaxScoreOpen(true); }}
              className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 mx-auto mt-1"
            >
              <Pencil size={10} /> تعديل
            </button>
            {!canEdit && (
              <p className="text-[10px] text-slate-500 mt-1">للعرض فقط</p>
            )}
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xs text-slate-400">متوسط الدرجات</p>
            <p className="text-xl font-bold text-blue-300">{avg.toFixed(1)}</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xs text-slate-400">ناجح</p>
            <p className="text-xl font-bold text-emerald-300">{passed}</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xs text-slate-400">راسب</p>
            <p className="text-xl font-bold text-red-300">{failed}</p>
          </div>
        </motion.div>
      )}

      {/* Grade entry grid */}
      {selectedExam && students.length > 0 ? (
        <>
          {/* Desktop: table view (hidden on mobile) */}
          <div className="hidden sm:block glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="text-right p-3 font-semibold">الطالب</th>
                    <th className="text-center p-3 font-semibold w-32">الدرجة</th>
                    <th className="text-center p-3 font-semibold w-28">التقدير</th>
                    <th className="text-center p-3 font-semibold w-24">النتيجة</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => {
                    const hasGrade = s.id in grades;
                    const score = hasGrade ? grades[s.id] : undefined;
                    const isPass = score !== undefined && score >= passScore;
                    const rating = score !== undefined ? getGradeRating(score, maxScore) : null;
                    return (
                      <tr key={s.id} data-student-id={s.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="p-3 text-white">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button onClick={() => setViewTarget(s)} className="p-1 rounded-lg glass-light hover:bg-sky-500/10 text-slate-400 hover:text-sky-400 transition flex-shrink-0" title="عرض">
                              <Eye size={14} />
                            </button>
                            <span className="break-words">{s.name}</span>
                            {isNewStudent(s, selectedExam) && <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded-full border border-sky-500/20 flex-shrink-0">حديث</span>}
                            <AbsenceBadge status={attendanceMap[s.id]} sessionTitle={boundSession?.title ?? selectedExam?.title} date={boundSession ? formatArabicDate((boundSession.session_date ?? boundSession.created_at).slice(0, 10)) : examDateLabel} />
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          {!hasGrade && isAbsentStatus(attendanceMap[s.id]) ? (
                            <span className={`text-xs font-bold ${attendanceMap[s.id] === 'absent' ? 'text-red-400' : 'text-amber-400'}`}>{absenceLabel(attendanceMap[s.id])}</span>
                          ) : (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={draftScores[s.id] ?? ''}
                              placeholder="—"
                              onChange={(e) => updateDraftScore(s.id, e.target.value)}
                              onBlur={() => { void saveScore(s.id); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              disabled={!canEdit}
                              className="w-20 glass-light rounded-lg py-1.5 px-2 text-center text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {rating ? (
                            <span className={`font-semibold ${rating.color}`}>{rating.label}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {!hasGrade || score === undefined ? (
                            isAbsentStatus(attendanceMap[s.id]) ? (
                              <span className={`text-xs font-bold ${attendanceMap[s.id] === 'absent' ? 'text-red-400' : 'text-amber-400'}`}>{absenceLabel(attendanceMap[s.id])}</span>
                            ) : isNewStudent(s, selectedExam) ? (
                              <span className="text-sky-400 text-xs font-semibold">منضم حديثاً</span>
                            ) : (
                              <span className="text-slate-500 text-xs font-semibold">غير مقيّم</span>
                            )
                          ) : isPass ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                              <Award size={14} /> ناجح
                            </span>
                          ) : (
                            <span className="text-red-400 font-bold">راسب</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile: card-based view */}
          <div className="sm:hidden space-y-2">
            {filteredStudents.map((s) => {
              const hasGrade = s.id in grades;
              const score = hasGrade ? grades[s.id] : undefined;
              const isPass = score !== undefined && score >= passScore;
              const rating = score !== undefined ? getGradeRating(score, maxScore) : null;
              return (
                <div key={s.id} data-student-id={s.id} className="glass-card rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setViewTarget(s)} className="p-1 rounded-lg glass-light hover:bg-sky-500/10 text-slate-400 transition flex-shrink-0" title="عرض">
                      <Eye size={14} />
                    </button>
                    <span className="text-sm font-medium text-white break-words leading-snug flex-1 min-w-0">{s.name}</span>
                    {isNewStudent(s, selectedExam) && <span className="text-[9px] font-bold text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded-full border border-sky-500/20 flex-shrink-0">حديث</span>}
                    <AbsenceBadge status={attendanceMap[s.id]} sessionTitle={boundSession?.title ?? selectedExam?.title} date={boundSession ? formatArabicDate((boundSession.session_date ?? boundSession.created_at).slice(0, 10)) : examDateLabel} />
                  </div>
                  <div className="flex items-center gap-2">
                    {!hasGrade && isAbsentStatus(attendanceMap[s.id]) ? (
                      <span className={`text-xs font-bold flex-shrink-0 ${attendanceMap[s.id] === 'absent' ? 'text-red-400' : 'text-amber-400'}`}>{absenceLabel(attendanceMap[s.id])}</span>
                    ) : (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draftScores[s.id] ?? ''}
                        placeholder="—"
                        onChange={(e) => updateDraftScore(s.id, e.target.value)}
                        onBlur={() => { void saveScore(s.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        disabled={!canEdit}
                        className="w-20 glass-light rounded-lg py-2 px-2 text-center text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                      />
                    )}
                    {rating ? (
                      <span className={`text-sm font-semibold ${rating.color} flex-shrink-0`}>{rating.label}</span>
                    ) : (
                      <span className="text-slate-600 text-sm flex-shrink-0">—</span>
                    )}
                    {!hasGrade || score === undefined ? (
                      isAbsentStatus(attendanceMap[s.id]) ? (
                        <span className={`text-xs font-bold mr-auto ${attendanceMap[s.id] === 'absent' ? 'text-red-400' : 'text-amber-400'}`}>{absenceLabel(attendanceMap[s.id])}</span>
                      ) : isNewStudent(s, selectedExam) ? (
                        <span className="text-sky-400 text-xs font-semibold mr-auto">منضم حديثاً</span>
                      ) : (
                        <span className="text-slate-500 text-xs font-semibold mr-auto">غير مقيّم</span>
                      )
                    ) : isPass ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-bold text-sm mr-auto">
                        <Award size={14} /> ناجح
                      </span>
                    ) : (
                      <span className="text-red-400 font-bold text-sm mr-auto">راسب</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : selectedExam ? (
        <div className="glass-light rounded-xl p-8 text-center text-slate-400">
          لا يوجد طلاب في هذه المجموعة.
        </div>
      ) : null}

      {/* Edit Max Score Modal */}
      <Modal open={editMaxScoreOpen} onClose={() => setEditMaxScoreOpen(false)} title={`تعديل الدرجة العظمى: ${selectedExam?.title ?? ''}`} size="sm">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">سيتم تحديث الدرجة العظمى ودرجة النجاح، وتُعاد حساب نسب الدرجات تلقائياً.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">الدرجة العظمى الجديدة</label>
              <input
                type="number"
                value={editMaxValue}
                onChange={(e) => setEditMaxValue(e.target.value)}
                className="w-full glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">درجة النجاح الجديدة</label>
              <input
                type="number"
                value={editPassValue}
                onChange={(e) => setEditPassValue(e.target.value)}
                className="w-full glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
              />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setEditMaxScoreOpen(false)}>إلغاء</Button>
            <Button onClick={handleEditMaxScore} disabled={!editMaxValue || parseFloat(editMaxValue) <= 0}><Check size={16} /> حفظ</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Title Modal */}
      <Modal open={editTitleOpen} onClose={() => setEditTitleOpen(false)} title={`تعديل عنوان التقييم`} size="sm">
        <div className="space-y-4">
          <input
            type="text"
            value={editTitleValue}
            onChange={(e) => setEditTitleValue(e.target.value)}
            className="w-full glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
            autoFocus
          />
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setEditTitleOpen(false)}>إلغاء</Button>
            <Button onClick={handleEditTitle} disabled={!editTitleValue.trim()}><Check size={16} /> حفظ</Button>
          </div>
        </div>
      </Modal>

      {/* Add Exam Modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="إضافة تقييم جديد">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">نوع التقييم</label>
            <select
              value={form.category}
              onChange={(e) => {
                const cat = e.target.value as CenterExamCategory;
                if (cat === 'recitation' && sessions.length > 0) {
                  const latest = sessions[0];
                  setForm({ ...form, category: cat, title: `تسميع ${latest.title}`, sessionId: latest.id, maxScore: '', passScore: '' });
                } else {
                  setForm({ ...form, category: cat, sessionId: '' });
                }
              }}
              className="w-full glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
            >
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">عنوان التقييم</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="مثال: امتحان الوحدة الأولى"
              className="w-full glass-light rounded-xl py-2.5 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
            />
          </div>
          {form.category === 'recitation' && sessions.length > 0 && (
            <div>
              <label className="block text-sm text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Link2 size={14} className="text-sky-400" />
                الحصة المرتبط بها التسميع
              </label>
              <select
                value={form.sessionId}
                onChange={(e) => {
                  const sess = sessions.find((s) => s.id === e.target.value);
                  setForm({ ...form, sessionId: e.target.value, title: sess ? `تسميع ${sess.title}` : form.title });
                }}
                className="w-full glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
              >
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} — {formatArabicDate((s.session_date ?? s.created_at).slice(0, 10))}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-sky-400 mt-1.5 flex items-center gap-1">
                <Mic size={10} />
                سيتم ربط درجات التسميع بالحصة المختارة — يمكن تعديلها لاحقاً.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">الدرجة العظمى</label>
              <input
                type="number"
                value={form.maxScore}
                onChange={(e) => setForm({ ...form, maxScore: e.target.value })}
                className="w-full glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">درجة النجاح</label>
              <input
                type="number"
                value={form.passScore}
                onChange={(e) => setForm({ ...form, passScore: e.target.value })}
                className="w-full glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
              />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>إلغاء</Button>
            <Button onClick={handleAddExam} disabled={!form.title.trim() || adding}>
              {adding ? <><Loader2 size={16} className="animate-spin" /> جاري الإضافة...</> : 'إضافة'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Exam title and delete actions */}
      {selectedExam && (
        <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
          {canEdit && (
            <button
              onClick={() => { setEditTitleValue(selectedExam.title); setEditTitleOpen(true); }}
              className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 transition"
            >
              <Pencil size={12} /> تعديل عنوان التقييم
            </button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(selectedExam)}
              className="text-red-400 hover:bg-red-500/10"
            >
              <Trash2 size={14} /> حذف التقييم الحالي
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) {
            try {
              await deleteCenterExam(deleteTarget.id);
              setSelectedExam(null);
              setDeleteTarget(null);
              await loadExams();
              showToast('تم حذف التقييم بنجاح', 'success');
            } catch {
              showToast('تعذّر حذف التقييم', 'error');
              setDeleteTarget(null);
            }
          }
        }}
        title="⚠️ حذف التقييم"
        subtext={`سيتم حذف «${deleteTarget?.title ?? ''}» وكل درجاته نهائيًا.`}
        confirmLabel="تأكيد الحذف"
      />

      <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}

function isNewStudent(student: Student, exam: CenterExam): boolean {
  const enrollDate = student.enrollment_date || student.created_at;
  const examDate = exam.exam_date || exam.created_at;
  return enrollDate > examDate;
}

function GradeFilterChip({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: 'slate' | 'emerald' | 'red' | 'amber' }) {
  const colorMap = {
    slate: active ? 'bg-slate-600 text-white border-slate-500' : 'glass-light text-slate-400 border-white/10',
    emerald: active ? 'bg-emerald-600 text-white border-emerald-500' : 'glass-light text-emerald-400 border-white/10',
    red: active ? 'bg-red-600 text-white border-red-500' : 'glass-light text-red-400 border-white/10',
    amber: active ? 'bg-amber-600 text-white border-amber-500' : 'glass-light text-amber-400 border-white/10',
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border transition active:scale-95 ${colorMap[color]}`}
    >
      {label}
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20' : 'bg-white/10'}`}>{count}</span>
    </button>
  );
}
