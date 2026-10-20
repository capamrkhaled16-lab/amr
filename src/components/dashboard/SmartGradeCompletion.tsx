import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3,
  Users,
  Check,
  X,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  Edit2,
  Plus,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';

type ArchivedExam = {
  id: string;
  title: string;
  max_score: number;
  pass_score: number;
  category?: string;
  group_id?: string | null;
};

type ArchivedGrade = {
  id: string;
  student_id: string;
  score: number;
  center_exam_id: string;
};

type ArchivedStudent = {
  id: string;
  name: string;
  phone?: string | null;
  parent_phone?: string | null;
  group_id?: string | null;
  total_fees?: number | null;
  paid_fees?: number | null;
  is_exempt?: boolean | null;
  parent_token?: string | null;
};

type ArchiveRow = {
  id: string;
  archive_month: string;
  archive_data: Record<string, unknown>;
  status: string;
  is_locked: boolean;
  archived_at: string | null;
  record_counts: Record<string, number>;
  created_at: string;
  updated_at: string;
};

type Group = {
  id: string;
  name: string;
};

type GradeEntry = {
  student_id: string;
  exam_id: string;
  score: string;
};

type Category = 'exam' | 'sheet' | 'recitation' | 'behavior';

const CATEGORY_LABELS: Record<string, string> = {
  exam: 'امتحان',
  sheet: 'شيت',
  recitation: 'تسميع',
  behavior: 'سلوك',
};

function categoryColor(cat?: string): string {
  switch (cat) {
    case 'recitation': return 'text-sky-400';
    case 'sheet': return 'text-teal-400';
    case 'behavior': return 'text-orange-400';
    default: return 'text-[#d4af37]';
  }
}

function categoryBg(cat?: string): string {
  switch (cat) {
    case 'recitation': return 'bg-sky-500/10 border-sky-500/20';
    case 'sheet': return 'bg-teal-500/10 border-teal-500/20';
    case 'behavior': return 'bg-orange-500/10 border-orange-500/20';
    default: return 'bg-[#d4af37]/10 border-[#d4af37]/20';
  }
}

export default function SmartGradeCompletion({
  row,
  allGroups,
  canEditAcademic,
  onSaved,
}: {
  row: ArchiveRow;
  allGroups: Group[];
  canEditAcademic: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [expandedExam, setExpandedExam] = useState<string | null>(null);
  const [bulkScore, setBulkScore] = useState('');

  const students = useMemo<ArchivedStudent[]>(() => {
    if (!row.archive_data?.students || !Array.isArray(row.archive_data.students)) return [];
    return (row.archive_data.students as ArchivedStudent[]).filter((s) => s && s.id);
  }, [row]);

  const exams = useMemo<ArchivedExam[]>(() => {
    const archived = (row.archive_data?.center_exams && Array.isArray(row.archive_data.center_exams)
      ? (row.archive_data.center_exams as ArchivedExam[]).filter((e) => e && e.id)
      : []);
    return archived;
  }, [row]);

  const grades = useMemo<ArchivedGrade[]>(() => {
    if (!row.archive_data?.center_grades || !Array.isArray(row.archive_data.center_grades)) return [];
    return (row.archive_data.center_grades as ArchivedGrade[]).filter((g) => g && g.id);
  }, [row]);

  // Build a map: examId -> Set of student IDs who have a grade
  const gradeMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const g of grades) {
      const set = m.get(g.center_exam_id) ?? new Set<string>();
      set.add(g.student_id);
      m.set(g.center_exam_id, set);
    }
    return m;
  }, [grades]);

  // For each exam, compute which students are missing grades
  const missingByExam = useMemo(() => {
    const result: { exam: ArchivedExam; missingStudents: ArchivedStudent[]; presentCount: number }[] = [];
    for (const exam of exams) {
      const gradedSet = gradeMap.get(exam.id) ?? new Set<string>();
      const groupStudents = exam.group_id
        ? students.filter((s) => s.group_id === exam.group_id)
        : students;
      const missing = groupStudents.filter((s) => !gradedSet.has(s.id));
      if (missing.length > 0 || groupStudents.length > 0) {
        result.push({ exam, missingStudents: missing, presentCount: groupStudents.length - missing.length });
      }
    }
    return result;
  }, [exams, students, gradeMap]);

  const totalMissing = useMemo(
    () => missingByExam.reduce((sum, e) => sum + e.missingStudents.length, 0),
    [missingByExam]
  );

  const entryKey = useCallback((studentId: string, examId: string) => `${studentId}__${examId}`, []);

  function getEntry(studentId: string, examId: string): string {
    return entries[entryKey(studentId, examId)] ?? '';
  }

  function setEntry(studentId: string, examId: string, value: string) {
    setEntries((prev) => ({ ...prev, [entryKey(studentId, examId)]: value }));
  }

  function applyBulkToExam(examId: string, score: string) {
    const exam = exams.find((e) => e.id === examId);
    if (!exam) return;
    const missing = missingByExam.find((m) => m.exam.id === examId)?.missingStudents ?? [];
    const newEntries = { ...entries };
    for (const s of missing) {
      newEntries[entryKey(s.id, examId)] = score;
    }
    setEntries(newEntries);
  }

  async function handleSave() {
    if (row.is_locked || !canEditAcademic) return;
    // Collect all non-empty entries
    const toSave: { studentId: string; examId: string; score: number }[] = [];
    for (const [key, val] of Object.entries(entries)) {
      const score = parseFloat(val);
      if (!Number.isFinite(score)) continue;
      const [studentId, examId] = key.split('__');
      toSave.push({ studentId, examId, score });
    }

    if (toSave.length === 0) {
      setSaveMessage({ type: 'error', text: 'لا توجد درجات صحيحة للإدخال.' });
      return;
    }

    const newData = JSON.parse(JSON.stringify(row.archive_data)) as Record<string, unknown>;
    const existingGrades = (newData.center_grades ?? []) as ArchivedGrade[];

    for (const entry of toSave) {
      const existingIdx = existingGrades.findIndex(
        (g) => g.student_id === entry.studentId && g.center_exam_id === entry.examId
      );
      if (existingIdx >= 0) {
        existingGrades[existingIdx].score = entry.score;
      } else {
        existingGrades.push({
          id: `arch-grade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          student_id: entry.studentId,
          score: entry.score,
          center_exam_id: entry.examId,
        });
      }
    }

    newData.center_grades = existingGrades;

    const { error } = await supabase
      .from('monthly_archives')
      .update({ archive_data: newData })
      .eq('id', row.id);

    if (error) {
      setSaveMessage({ type: 'error', text: `خطأ في الحفظ: ${error.message}` });
      return;
    }

    setSaveMessage({ type: 'success', text: `تم إدخال ${toSave.length} درجة بنجاح.` });
    setEntries({});
    setBulkScore('');
    setOpen(false);
    onSaved();
  }

  if (!canEditAcademic || row.is_locked) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-[11px] font-bold text-[#e5c65a] hover:text-violet-200 transition px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 hover:border-violet-500/40 w-full"
      >
        <Sparkles size={14} />
        إكمال الدرجات المفقودة
        <span className="mr-auto flex items-center gap-1.5">
          {totalMissing > 0 ? (
            <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full text-[10px]">{totalMissing} ناقصة</span>
          ) : (
            <span className="bg-emerald-500/20 text-[#e5c65a] px-1.5 py-0.5 rounded-full text-[10px]">مكتمل</span>
          )}
        </span>
      </button>

      <Modal
        open={open}
        onClose={() => { setOpen(false); setSaveMessage(null); }}
        title={`إكمال الدرجات المفقودة — ${totalMissing} درجة ناقصة`}
        size="xl"
      >
        <div className="space-y-4">
          {/* Explanation banner */}
          <div className="flex items-start gap-3 rounded-xl bg-[#d4af37]/5 border border-[#d4af37]/15 p-3">
            <Sparkles size={16} className="text-[#d4af37] flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-400 leading-relaxed">
              هذه الأداة تعرض التقييمات (امتحانات، أوراق، تسميع) التي يوجد بها طلاب بدون درجات. اضغط على أي تقييم لتوسيعه، أدخل الدرجات الناقصة، ثم اضغط «حفظ الدرجات» لإضافتها دفعة واحدة.
            </p>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="glass-light rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-[#d4af37]">{exams.length}</p>
              <p className="text-[10px] text-slate-400">تقييمات</p>
            </div>
            <div className="glass-light rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-[#d4af37]">{students.length}</p>
              <p className="text-[10px] text-slate-400">طلاب</p>
            </div>
            <div className="glass-light rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-amber-400">{totalMissing}</p>
              <p className="text-[10px] text-slate-400">درجات ناقصة</p>
            </div>
          </div>

          {totalMissing === 0 ? (
            <div className="glass-light rounded-xl p-8 text-center">
              <CheckCircle2 className="mx-auto text-[#d4af37] mb-3" size={40} />
              <p className="text-sm font-bold text-[#e5c65a]">جميع الطلاب لديهم درجات في جميع التقييمات!</p>
              <p className="text-xs text-slate-500 mt-1">لا توجد فجوات لإكمالها.</p>
            </div>
          ) : (
            <>
              {/* Save message */}
              {saveMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium ${
                    saveMessage.type === 'success'
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-[#e5c65a]'
                      : 'bg-red-500/10 border border-red-500/20 text-red-300'
                  }`}
                >
                  {saveMessage.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {saveMessage.text}
                </motion.div>
              )}

              {/* Exam list with missing grades */}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {missingByExam.map(({ exam, missingStudents, presentCount }) => {
                  if (missingStudents.length === 0) return null;
                  const isExpanded = expandedExam === exam.id;
                  const catLabel = CATEGORY_LABELS[exam.category ?? 'exam'] ?? 'امتحان';
                  const group = allGroups.find((g) => g.id === exam.group_id);

                  return (
                    <div key={exam.id} className="glass-light rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedExam(isExpanded ? null : exam.id)}
                        className="w-full flex items-center justify-between p-3 text-right hover:bg-white/[0.03] transition"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${categoryBg(exam.category)} ${categoryColor(exam.category)}`}>
                            {catLabel}
                          </span>
                          <span className="text-xs text-white font-medium truncate">{exam.title ?? 'بدون اسم'}</span>
                          {group && <span className="text-[10px] text-slate-500">· {group.name}</span>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] text-[#d4af37]">{presentCount} مسجّل</span>
                          <span className="text-[10px] text-amber-400 font-bold">{missingStudents.length} ناقص</span>
                          <ChevronDown size={14} className={`text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                          >
                            <div className="border-t border-white/[0.06] p-3 space-y-3">
                              {/* Bulk fill bar */}
                              <div className="flex items-center gap-2 p-2 rounded-lg bg-violet-500/5 border border-violet-500/10">
                                <Sparkles size={12} className="text-[#d4af37] flex-shrink-0" />
                                <span className="text-[10px] text-slate-400">تعبئة جماعية:</span>
                                <input
                                  type="number"
                                  value={bulkScore}
                                  onChange={(e) => setBulkScore(e.target.value)}
                                  placeholder="درجة"
                                  className="w-16 glass-light rounded px-2 py-1 text-[11px] text-white border border-white/10 focus:border-violet-500/50 focus:outline-none"
                                />
                                <button
                                  onClick={() => { if (bulkScore) applyBulkToExam(exam.id, bulkScore); }}
                                  disabled={!bulkScore}
                                  className="text-[10px] px-2 py-1 rounded-lg bg-violet-500/20 text-[#d4af37] hover:bg-violet-500/30 font-bold disabled:opacity-50"
                                >
                                  تطبيق على الكل
                                </button>
                                <span className="text-[10px] text-slate-500">عظمى: {exam.max_score ?? 0} · نجاح: {exam.pass_score ?? 0}</span>
                              </div>

                              {/* Student rows */}
                              <div className="space-y-1">
                                {missingStudents.map((s) => {
                                  const val = getEntry(s.id, exam.id);
                                  const numVal = parseFloat(val);
                                  const isValid = val && Number.isFinite(numVal) && numVal >= 0 && numVal <= (exam.max_score ?? 0);
                                  const isPassing = isValid && numVal >= (exam.pass_score ?? 0);
                                  return (
                                    <div key={s.id} className="flex items-center justify-between gap-2 py-1">
                                      <span className="text-[11px] text-slate-300 truncate flex-1">{s.name}</span>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <input
                                          type="number"
                                          value={val}
                                          onChange={(e) => setEntry(s.id, exam.id, e.target.value)}
                                          placeholder="0"
                                          className={`w-16 glass-light rounded px-2 py-1 text-[11px] text-white border text-center focus:outline-none ${
                                            val && !isValid
                                              ? 'border-red-500/40'
                                              : isValid
                                              ? isPassing
                                                ? 'border-emerald-500/40'
                                                : 'border-amber-500/40'
                                              : 'border-white/10 focus:border-violet-500/50'
                                          }`}
                                        />
                                        <span className="text-[10px] text-slate-500 w-8 text-center">/ {exam.max_score ?? 0}</span>
                                        {isValid && (
                                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                            isPassing ? 'bg-emerald-500/10 text-[#d4af37]' : 'bg-red-500/10 text-red-400'
                                          }`}>
                                            {isPassing ? 'ناجح' : 'راسب'}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between pt-3 border-t border-white/[0.06] gap-2 flex-wrap">
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <span className={'inline-block w-2 h-2 rounded-full ' + (Object.values(entries).some((v) => v && Number.isFinite(parseFloat(v))) ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600')} />
                  {Object.values(entries).filter((v) => v && Number.isFinite(parseFloat(v))).length} درجة جاهزة للحفظ
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEntries({}); setBulkScore(''); setSaveMessage(null); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:border-red-500/40 text-xs font-bold transition-all active:scale-95"
                  >
                    <X size={14} />
                    مسح الكل
                  </button>
                  <Button size="sm" onClick={handleSave}>
                    <Check size={14} />
                    حفظ الدرجات
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
