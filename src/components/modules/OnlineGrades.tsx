import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Edit3, Save, Wifi, Globe, AlertTriangle, Eye, Loader2, RotateCcw, Clock } from 'lucide-react';
import StudentViewModal from '@/components/ui/StudentViewModal';
import type { Student, OnlineExam, OnlineGrade } from '@/lib/types';
import {
  fetchOnlineExams,
  fetchOnlineGrades,
  upsertOnlineGrade,
} from '@/lib/data';
import { getGradeRating } from '@/lib/format';
import { calcExamAverage, type RawGrade } from '@/lib/gradeCalc';
import Button from '@/components/ui/Button';
import { usePersistedState, getPersistedId, setPersistedId } from '@/hooks/usePersistedState';
import { useToast } from '@/components/ui/Toast';

type OnlineGradesProps = {
  groupId: string;
  students: Student[];
};

export default function OnlineGrades({ groupId, students }: OnlineGradesProps) {
  const { showToast } = useToast();
  const persistKey = `og_${groupId}`;
  const [exams, setExams] = useState<OnlineExam[]>([]);
  const [selectedExam, setSelectedExam] = useState<OnlineExam | null>(null);
  const [grades, setGrades] = useState<Record<string, OnlineGrade>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [draftScore, setDraftScore] = useState<Record<string, string>>({});
  const [gradeFilter, setGradeFilter] = usePersistedState<'all' | 'submitted' | 'not_submitted' | 'passed' | 'failed'>(`${persistKey}_filter`, 'all');
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const gradesReqIdRef = useRef(0);

  const loadExams = useCallback(async () => {
    try {
      const data = await fetchOnlineExams(groupId);
      setExams(data);
      const savedId = getPersistedId(`${persistKey}_exam`);
      const match = savedId ? data.find((e) => e.id === savedId) : null;
      if (match) setSelectedExam(match);
      else if (data.length > 0 && !selectedExam) setSelectedExam(data[0]);
    } catch {
      showToast('تعذّر تحميل الامتحانات الإلكترونية', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [groupId, selectedExam, persistKey, showToast]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(false);
    setLoadTimedOut(false);
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setLoadTimedOut(true);
        setIsLoading(false);
      }
    }, 8000);
    loadExams().catch(() => { if (!cancelled) setLoadError(true); }).finally(() => { if (!cancelled) { clearTimeout(timeout); setIsLoading(false); } });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [loadExams]);

  useEffect(() => {
    setPersistedId(`${persistKey}_exam`, selectedExam?.id ?? null);
  }, [selectedExam, persistKey]);

  const loadGrades = useCallback(async () => {
    if (!selectedExam) return;
    const reqId = ++gradesReqIdRef.current;
    try {
      const data = await fetchOnlineGrades(selectedExam.id);
      if (reqId !== gradesReqIdRef.current) return;
      const map: Record<string, OnlineGrade> = {};
      for (const g of data) map[g.student_id] = g;
      setGrades(map);
    } catch {
      if (reqId === gradesReqIdRef.current) {
        showToast('تعذّر تحميل الدرجات', 'error');
      }
    }
  }, [selectedExam, showToast]);

  useEffect(() => {
    loadGrades();
  }, [loadGrades]);

  async function commitOverride(studentId: string) {
    if (!selectedExam) return;
    const raw = draftScore[studentId] ?? '';
    if (raw.trim() === '') return;
    const score = Number(raw);
    const maxScore = selectedExam.total_score ?? 100;
    if (!Number.isFinite(score) || score < 0) {
      showToast('خطأ: الدرجة يجب أن تكون رقماً موجباً', 'error');
      setEditing((prev) => ({ ...prev, [studentId]: false }));
      return;
    }
    if (score > maxScore) {
      showToast(`خطأ: لا يمكن أن تتجاوز الدرجة القيمة العظمى (${maxScore})`, 'error');
      setEditing((prev) => ({ ...prev, [studentId]: false }));
      setDraftScore((prev) => ({ ...prev, [studentId]: grades[studentId]?.score !== undefined ? String(grades[studentId].score) : '' }));
      return;
    }
    const newGrade: OnlineGrade = {
      id: grades[studentId]?.id ?? '',
      exam_id: selectedExam.id,
      student_id: studentId,
      score,
      max_score: maxScore,
      is_manual_override: true,
      updated_at: new Date().toISOString(),
    };
    const prevGrade = grades[studentId];
    setGrades((prev) => ({ ...prev, [studentId]: newGrade }));
    setEditing((prev) => ({ ...prev, [studentId]: false }));
    try {
      await upsertOnlineGrade(selectedExam.id, studentId, score, maxScore, true);
      showToast('تم حفظ التعديل اليدوي', 'success');
    } catch (err) {
      setGrades((prev) => {
        const next = { ...prev };
        if (prevGrade) next[studentId] = prevGrade; else delete next[studentId];
        return next;
      });
      showToast(err instanceof Error ? err.message : 'تعذّر حفظ التعديل', 'error');
    }
  }

  const maxScore = selectedExam ? (selectedExam.total_score ?? 100) : 100;
  const rawGrades: RawGrade[] = students
    .filter((s) => grades[s.id] && typeof grades[s.id].score === 'number')
    .map((s) => ({ student_id: s.id, score: grades[s.id].score, max_score: grades[s.id].max_score || maxScore }));
  const avgResult = calcExamAverage(rawGrades);
  const avg = avgResult.averageScore;
  const submitted = students.filter((s) => grades[s.id]).length;
  const notSubmitted = students.length - submitted;
  const passScore = selectedExam ? Math.round((maxScore * 0.5)) : 50;
  const passed = students.filter((s) => grades[s.id] && grades[s.id].score >= passScore).length;
  const failed = students.filter((s) => grades[s.id] && grades[s.id].score < passScore).length;

  const filteredStudents = useMemo(() => {
    if (!selectedExam) return students;
    if (gradeFilter === 'all') return students;
    if (gradeFilter === 'submitted') return students.filter((s) => grades[s.id]);
    if (gradeFilter === 'not_submitted') return students.filter((s) => !grades[s.id]);
    if (gradeFilter === 'passed') return students.filter((s) => grades[s.id] && grades[s.id].score >= passScore);
    if (gradeFilter === 'failed') return students.filter((s) => grades[s.id] && grades[s.id].score < passScore);
    return students;
  }, [gradeFilter, students, grades, selectedExam, passScore]);

  if (isLoading && exams.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-emerald-400" size={32} />
        <span className="text-slate-400 text-sm mr-3">جاري تحميل الامتحانات الإلكترونية...</span>
      </div>
    );
  }

  if (loadTimedOut && exams.length === 0 && !loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Clock size={32} className="text-amber-400" />
        <p className="text-slate-400 text-sm">استغرق التحميل وقتاً أطول من المتوقع.</p>
        <Button size="sm" variant="secondary" onClick={() => { setLoadTimedOut(false); setIsLoading(true); loadExams().catch(() => setLoadError(true)).finally(() => setIsLoading(false)); }}>
          <RotateCcw size={14} /> إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (loadError && exams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertTriangle size={32} className="text-red-400" />
        <p className="text-slate-400 text-sm">تعذّر تحميل الامتحانات الإلكترونية.</p>
        <Button size="sm" variant="secondary" onClick={() => { setLoadError(false); setIsLoading(true); loadExams().catch(() => setLoadError(true)).finally(() => setIsLoading(false)); }}>
          <RotateCcw size={14} /> إعادة المحاولة
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Auto-sync banner */}
      <div className="glass-light rounded-xl p-3 mb-4 flex items-center gap-2 text-sm text-blue-300">
        <Wifi size={16} className="animate-pulse" />
        <span>التزامن التلقائي مفعل — درجات الامتحانات الإلكترونية تُسجّل تلقائيًا عند تسليم الطالب للامتحان.</span>
      </div>

      {/* Exam tabs */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {exams.map((ex) => (
            <button
              key={ex.id}
              onClick={() => setSelectedExam(ex)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                selectedExam?.id === ex.id
                  ? 'bg-emerald-600 text-white'
                  : 'glass-light text-slate-400 hover:text-white'
              }`}
            >
              {ex.title}
            </button>
          ))}
          {exams.length === 0 && (
            <p className="text-slate-400 text-sm py-2">لا توجد امتحانات إلكترونية بعد.</p>
          )}
        </div>
      </div>

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
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xs text-slate-400">متوسط الدرجات</p>
            <p className="text-xl font-bold text-blue-300">{avg.toFixed(1)}</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xs text-slate-400">سُلّم</p>
            <p className="text-xl font-bold text-emerald-300">{submitted}</p>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <p className="text-xs text-slate-400">لم يُسلّم</p>
            <p className="text-xl font-bold text-amber-300">{students.length - submitted}</p>
          </div>
        </motion.div>
      )}

      {/* Incomplete warning */}
      {selectedExam && notSubmitted > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4 border border-amber-500/30 flex items-center gap-3 mb-4"
        >
          <AlertTriangle size={20} className="text-amber-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-400">تنبيه: يوجد {notSubmitted} طالب لم يُسلّم الامتحان</p>
            <p className="text-xs text-slate-400 mt-0.5">هؤلاء الطلاب لم يُسلّموا الامتحان — يمكن تعديل الدرجة يدوياً أو تسجيل الغياب.</p>
          </div>
          <button onClick={() => setGradeFilter('not_submitted')} className="px-3 py-2 rounded-lg bg-amber-600/20 text-amber-400 text-xs font-bold hover:bg-amber-600/30 transition active:scale-95">عرض الغائبين</button>
        </motion.div>
      )}

      {/* Smart filter buttons */}
      {selectedExam && students.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <OnlineFilterChip label="الكل" count={students.length} active={gradeFilter === 'all'} onClick={() => setGradeFilter('all')} color="slate" />
          <OnlineFilterChip label="سُلّم" count={submitted} active={gradeFilter === 'submitted'} onClick={() => setGradeFilter('submitted')} color="emerald" />
          <OnlineFilterChip label="لم يُسلّم" count={notSubmitted} active={gradeFilter === 'not_submitted'} onClick={() => setGradeFilter('not_submitted')} color="amber" />
          <OnlineFilterChip label="ناجح" count={passed} active={gradeFilter === 'passed'} onClick={() => setGradeFilter('passed')} color="emerald" />
          <OnlineFilterChip label="راسب" count={failed} active={gradeFilter === 'failed'} onClick={() => setGradeFilter('failed')} color="red" />
        </div>
      )}

      {/* Grade grid with manual override */}
      {selectedExam && students.length > 0 ? (
        <>
          {/* Desktop: table view */}
          <div className="hidden sm:block glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="text-right p-3 font-semibold">الطالب</th>
                  <th className="text-center p-3 font-semibold w-32">الدرجة</th>
                  <th className="text-center p-3 font-semibold w-28">التقدير</th>
                  <th className="text-center p-3 font-semibold w-28">المصدر</th>
                  <th className="text-center p-3 font-semibold w-24">تعديل</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s) => {
                  const grade = grades[s.id];
                  const isEditing = editing[s.id];
                  const rating = grade ? getGradeRating(grade.score, grade.max_score) : null;
                  return (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-3 text-white">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setViewTarget(s)} className="p-1 rounded-lg glass-light hover:bg-sky-500/10 text-slate-400 hover:text-sky-400 transition" title="عرض">
                            <Eye size={14} />
                          </button>
                          {s.name}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {isEditing ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draftScore[s.id] ?? (grade?.score !== undefined ? String(grade.score) : '')}
                            autoFocus
                            onChange={(e) => setDraftScore((prev) => ({ ...prev, [s.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') { void commitOverride(s.id); } }}
                            onBlur={() => { void commitOverride(s.id); }}
                            className="w-20 glass-light rounded-lg py-1.5 px-2 text-center text-white border border-emerald-500/50 focus:outline-none"
                          />
                        ) : (
                          <span className={`font-bold ${grade ? 'text-white' : 'text-slate-500'}`}>
                            {grade ? grade.score : '—'}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {rating ? <span className={`font-semibold ${rating.color}`}>{rating.label}</span> : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="p-3 text-center">
                        {grade?.is_manual_override ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                            <Edit3 size={12} /> يدوي
                          </span>
                        ) : grade ? (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-400">
                            <Globe size={12} /> تلقائي
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => {
                            setEditing((prev) => ({ ...prev, [s.id]: !prev[s.id] }));
                            setDraftScore((prev) => ({ ...prev, [s.id]: grade?.score !== undefined ? String(grade.score) : '' }));
                          }}
                          className="p-1.5 rounded-lg glass-light hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400 transition"
                          title="تعديل يدوي"
                        >
                          {isEditing ? <Save size={14} /> : <Edit3 size={14} />}
                        </button>
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
            const grade = grades[s.id];
            const isEditing = editing[s.id];
            const rating = grade ? getGradeRating(grade.score, grade.max_score) : null;
            return (
              <div key={s.id} className="glass-card rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setViewTarget(s)} className="p-1 rounded-lg glass-light hover:bg-sky-500/10 text-slate-400 transition flex-shrink-0" title="عرض">
                    <Eye size={14} />
                  </button>
                  <span className="text-sm font-medium text-white break-words leading-snug flex-1 min-w-0">{s.name}</span>
                  {grade?.is_manual_override ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 flex-shrink-0">
                      <Edit3 size={10} /> يدوي
                    </span>
                  ) : grade ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-blue-400 flex-shrink-0">
                      <Globe size={10} /> تلقائي
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={draftScore[s.id] ?? (grade?.score !== undefined ? String(grade.score) : '')}
                      autoFocus
                      onChange={(e) => setDraftScore((prev) => ({ ...prev, [s.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { void commitOverride(s.id); } }}
                      onBlur={() => { void commitOverride(s.id); }}
                      className="w-20 glass-light rounded-lg py-2 px-2 text-center text-white border border-emerald-500/50 focus:outline-none flex-shrink-0"
                    />
                  ) : (
                    <span className={`font-bold text-lg ${grade ? 'text-white' : 'text-slate-500'}`}>
                      {grade ? grade.score : '—'}
                    </span>
                  )}
                  {rating ? (
                    <span className={`text-sm font-semibold ${rating.color} flex-shrink-0`}>{rating.label}</span>
                  ) : (
                    <span className="text-slate-600 text-sm flex-shrink-0">—</span>
                  )}
                  <button
                    onClick={() => {
                      setEditing((prev) => ({ ...prev, [s.id]: !prev[s.id] }));
                      setDraftScore((prev) => ({ ...prev, [s.id]: grade?.score !== undefined ? String(grade.score) : '' }));
                    }}
                    className="p-1.5 rounded-lg glass-light hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400 transition flex-shrink-0 mr-auto"
                    title="تعديل يدوي"
                  >
                    {isEditing ? <Save size={14} /> : <Edit3 size={14} />}
                  </button>
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

      {selectedExam && (
        <p className="text-xs text-slate-500 mt-3 flex items-center gap-1.5">
          <Edit3 size={12} />
          لديك صلاحية كاملة لتعديل أي درجة إلكترونية يدويًا — يتم إعادة حساب وحفظ الدرجات فورًا.
        </p>
      )}

      <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}

function OnlineFilterChip({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: 'slate' | 'emerald' | 'red' | 'amber' }) {
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
