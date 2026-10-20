import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, AlertTriangle, CheckCircle2, Clock, Eye, Activity, RefreshCw, ShieldAlert, EyeOff, FileX, Monitor, Hourglass, Ban, Loader2, Navigation, Save, Award, X, ChevronDown, ChevronLeft } from 'lucide-react';
import type { OnlineExam, ExamSubmission, ExamQuestion, ExamAnswer } from '@/lib/types';
import { fetchExamsWithSubmissionCounts, fetchExamSubmissionsForMonitor, subscribeToExamSubmissions, fetchExamQuestions, fetchAnswers } from '@/lib/data';
import { formatTime } from '@/lib/format';
import Modal from '@/components/ui/Modal';

type LiveExamMonitorProps = {
  gradeLevelId: string;
  groupId?: string | null;
};

type MonitoredSubmission = ExamSubmission & {
  student?: { name: string; id: string };
};

type ExamWithCount = OnlineExam & { submission_count: number };

function displayName(sub: MonitoredSubmission): string {
  return sub.student?.name ?? sub.student_name ?? 'طالب';
}

function displayPhone(sub: MonitoredSubmission): string | null {
  return sub.student_phone ?? null;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5000) return 'الآن';
  if (diff < 60000) return `منذ ${Math.floor(diff / 1000)} ثانية`;
  if (diff < 3600000) return `منذ ${Math.floor(diff / 60000)} دقيقة`;
  return `منذ ${Math.floor(diff / 3600000)} ساعة`;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  waiting: { label: 'في الانتظار', color: 'text-slate-300', bg: 'bg-slate-500/15 border-slate-500/30', icon: Hourglass },
  in_progress: { label: 'جاري الامتحان', color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/30', icon: Activity },
  submitted: { label: 'تم التسليم', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30', icon: CheckCircle2 },
  cheated: { label: 'غش — حظر', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30', icon: Ban },
  auto_submitted: { label: 'تسليم تلقائي (انتهى الوقت)', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/30', icon: Clock },
};

function elapsedMinutes(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
}

function elapsedSeconds(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

export default function LiveExamMonitor({ gradeLevelId, groupId }: LiveExamMonitorProps) {
  const [exams, setExams] = useState<ExamWithCount[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<MonitoredSubmission[]>([]);
  const [loadingExams, setLoadingExams] = useState(true);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, setTick] = useState(0);
  const [cheatingSub, setCheatingSub] = useState<MonitoredSubmission | null>(null);
  const [detailSub, setDetailSub] = useState<MonitoredSubmission | null>(null);
  const [detailQuestions, setDetailQuestions] = useState<ExamQuestion[]>([]);
  const [detailAnswers, setDetailAnswers] = useState<ExamAnswer[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const selectedExam = exams.find((e) => e.id === selectedExamId) ?? null;
  const initialSelectionDone = useRef(false);

  const loadExams = useCallback(async () => {
    setLoadingExams(true);
    const data = await fetchExamsWithSubmissionCounts(gradeLevelId, groupId);
    setExams(data);
    if (data.length > 0 && !initialSelectionDone.current) {
      const best = [...data].sort((a, b) => b.submission_count - a.submission_count)[0];
      setSelectedExamId(best.id);
      initialSelectionDone.current = true;
    }
    if (data.length > 0 && selectedExamId && !data.some((e) => e.id === selectedExamId)) {
      setSelectedExamId(data[0].id);
    }
    setLoadingExams(false);
  }, [gradeLevelId, groupId, selectedExamId]);

  useEffect(() => { loadExams(); }, [loadExams]);

  const loadSubmissions = useCallback(async () => {
    if (!selectedExamId) return;
    setLoadingSubs(true);
    const data = await fetchExamSubmissionsForMonitor(selectedExamId);
    setSubmissions(data);
    setLoadingSubs(false);
  }, [selectedExamId]);

  useEffect(() => { loadSubmissions(); }, [loadSubmissions]);

  // Realtime subscription
  useEffect(() => {
    if (!selectedExamId) return;
    const sub = subscribeToExamSubmissions(selectedExamId, (payload) => {
      if (payload.eventType === 'INSERT' && payload.new) {
        const newSub = payload.new as MonitoredSubmission;
        setSubmissions((prev) => {
          if (prev.some((s) => s.id === newSub.id)) return prev;
          return [newSub, ...prev];
        });
      } else if (payload.eventType === 'UPDATE' && payload.new) {
        const updated = payload.new as MonitoredSubmission;
        setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
      } else if (payload.eventType === 'DELETE' && payload.old) {
        const deleted = payload.old as MonitoredSubmission;
        setSubmissions((prev) => prev.filter((s) => s.id !== deleted.id));
      }
    });
    return () => { sub.unsubscribe(); };
  }, [selectedExamId]);

  // Lighter polling — 5s instead of 3s to reduce load
  useEffect(() => {
    if (!autoRefresh || !selectedExamId) return;
    const interval = setInterval(() => { loadSubmissions(); }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedExamId, loadSubmissions]);

  // Tick every second to update elapsed time displays
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  async function openSubmissionDetail(sub: MonitoredSubmission) {
    setDetailSub(sub);
    setDetailLoading(true);
    setDetailQuestions([]);
    setDetailAnswers([]);
    try {
      const [qs, answers] = await Promise.all([
        fetchExamQuestions(sub.exam_id),
        fetchAnswers(sub.id),
      ]);
      setDetailQuestions(qs);
      setDetailAnswers(answers);
    } catch {
      setDetailQuestions([]);
      setDetailAnswers([]);
    }
    setDetailLoading(false);
  }

  function closeSubmissionDetail() {
    setDetailSub(null);
    setDetailQuestions([]);
    setDetailAnswers([]);
  }

  const waiting = submissions.filter((s) => s.status === 'waiting').length;
  const inProgress = submissions.filter((s) => s.status === 'in_progress').length;
  const submitted = submissions.filter((s) => s.status === 'submitted' || s.status === 'auto_submitted').length;
  const cheated = submissions.filter((s) => s.status === 'cheated').length;
  const flagged = submissions.filter((s) => (s.tab_switch_count ?? 0) > 0 && s.status === 'in_progress').length;
  const totalViolations = submissions.reduce((sum, s) => sum + (s.tab_switch_count ?? 0), 0);

  const violationLog = submissions
    .filter((s) => (s.tab_switch_count ?? 0) > 0)
    .sort((a, b) => (b.tab_switch_count ?? 0) - (a.tab_switch_count ?? 0));

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Radio className="text-red-400 animate-pulse" size={22} />
            <h2 className="text-lg font-bold text-white">المراقبة الحية للامتحانات</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => loadSubmissions()} className="p-2 rounded-lg glass-light hover:bg-white/10 text-slate-400 hover:text-emerald-400 transition" title="تحديث">
              <RefreshCw size={16} />
            </button>
            <button onClick={() => setAutoRefresh(!autoRefresh)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${autoRefresh ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'glass-light text-slate-400'}`}>
              {autoRefresh ? 'تحديث تلقائي (5ث)' : 'متوقف'}
            </button>
          </div>
        </div>

        {loadingExams ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span>جارٍ تحميل الامتحانات...</span>
          </div>
        ) : exams.length === 0 ? (
          <p className="text-center text-slate-400 py-8">لا توجد امتحانات منشورة في هذا الصف بعد.</p>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
              {exams.map((ex) => (
                <button key={ex.id} onClick={() => setSelectedExamId(ex.id)} className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${selectedExamId === ex.id ? 'bg-emerald-600/20 border border-emerald-500/40 text-emerald-400' : 'glass-light text-slate-400 hover:bg-white/10'}`}>
                  {ex.title}
                  {ex.submission_count > 0 && <span className="block text-[10px] text-amber-400 mt-0.5">{ex.submission_count} طالب</span>}
                </button>
              ))}
            </div>

            {selectedExam && (
              <div className="flex items-center gap-2 flex-wrap mb-4 text-xs">
                <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold ${selectedExam.show_results ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'}`}>
                  {selectedExam.show_results ? <><Eye size={12} /> النتائج ظاهرة</> : <><EyeOff size={12} /> النتائج مخفية</>}
                </span>
                {selectedExam.shuffle_questions && <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20"><Monitor size={12} /> خلط الأسئلة</span>}
                {selectedExam.shuffle_choices && <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20"><Monitor size={12} /> خلط الاختيارات</span>}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-4">
              <StatBox label="في الانتظار" value={waiting} icon={<Hourglass size={16} />} color="text-slate-300" bg="bg-slate-500/10" />
              <StatBox label="جاري الامتحان" value={inProgress} icon={<Activity size={16} />} color="text-blue-400" bg="bg-blue-500/10" />
              <StatBox label="تم التسليم" value={submitted} icon={<CheckCircle2 size={16} />} color="text-emerald-400" bg="bg-emerald-500/10" />
              <StatBox label="مشتبه (تبويب)" value={flagged} icon={<Eye size={16} />} color="text-amber-400" bg="bg-amber-500/10" />
              <StatBox label="غش مؤكد" value={cheated} icon={<Ban size={16} />} color="text-red-400" bg="bg-red-500/10" />
              <StatBox label="إجمالي المخالفات" value={totalViolations} icon={<ShieldAlert size={16} />} color="text-orange-400" bg="bg-orange-500/10" />
            </div>

            {violationLog.length > 0 && (
              <div className="mb-4 glass-light rounded-xl p-4 border border-orange-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldAlert size={18} className="text-orange-400" />
                  <h3 className="text-sm font-bold text-orange-400">سجل محاولات الغش</h3>
                  <span className="text-xs text-slate-500">({violationLog.length} طالب)</span>
                </div>
                <div className="space-y-2">
                  {violationLog.map((sub) => {
                    const count = sub.tab_switch_count ?? 0;
                    const isConfirmed = count >= 3 || sub.status === 'cheated';
                    return (
                      <div key={sub.id} className={`flex items-center justify-between gap-3 rounded-lg p-2.5 border ${isConfirmed ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/20'} cursor-pointer hover:bg-white/5 transition`} onClick={() => setCheatingSub(sub)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${isConfirmed ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                            {displayName(sub).charAt(0) ?? '?'}
                          </div>
                          <p className="font-semibold text-white text-sm truncate">{displayName(sub)}</p>
                        </div>
                        <span className={`text-xs font-bold flex-shrink-0 ${isConfirmed ? 'text-red-400' : 'text-amber-400'}`}>
                          {count} خروج
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {loadingSubs ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm">جارٍ تحميل بيانات الطلاب...</span>
                  </div>
                ) : submissions.length === 0 ? (
                  <p className="text-center text-slate-400 py-6 text-sm">لا يوجد طلاب بدؤوا الامتحان بعد.</p>
                ) : (
                  submissions.map((sub) => {
                    const meta = STATUS_META[sub.status] ?? STATUS_META.in_progress;
                    const Icon = meta.icon;
                    const isFlagged = (sub.tab_switch_count ?? 0) > 0 && sub.status === 'in_progress';
                    const isCheating = (sub.tab_switch_count ?? 0) >= 3 || sub.status === 'cheated';
                    const minutes = elapsedMinutes(sub.started_at);
                    const seconds = elapsedSeconds(sub.started_at);
                    const showGrade = (sub.status === 'submitted' || sub.status === 'auto_submitted' || sub.status === 'cheated') && (selectedExam?.show_results ?? true);
                    const qIdx = sub.current_question_index ?? 0;
                    const answered = sub.answered_count ?? 0;
                    const isActive = sub.status === 'in_progress';
                    const progressPct = selectedExam ? Math.round((answered / Math.max(1, (sub.max_score ?? 0) > 0 ? 10 : 10)) * 100) : 0;
                    return (
                      <motion.div key={sub.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`glass-light rounded-xl p-3 border ${isCheating ? 'border-red-500/50 ring-2 ring-red-500/20' : isFlagged ? 'border-amber-500/40 ring-1 ring-amber-500/20' : 'border-white/10'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${isCheating ? 'bg-red-500/20 text-red-400' : isFlagged ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700/50 text-slate-300'}`}>{displayName(sub).charAt(0) ?? '?'}</div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-white text-sm truncate">{displayName(sub)}</p>
                                {displayPhone(sub) && <span className="text-[10px] text-slate-500 bg-slate-700/30 px-1.5 py-0.5 rounded">{displayPhone(sub)}</span>}
                                {isCheating && <button onClick={() => setCheatingSub(sub)} className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/15 px-2 py-0.5 rounded-full animate-pulse hover:opacity-80 transition"><AlertTriangle size={10} /> غش</button>}
                                {isFlagged && !isCheating && <button onClick={() => setCheatingSub(sub)} className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-full hover:opacity-80 transition"><Eye size={10} /> تحذير</button>}
                              </div>
                              <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                                <span className="flex items-center gap-1"><Clock size={10} /> {isActive ? `${minutes}د ${seconds % 60}ث` : 'انتهى'}</span>
                                {sub.submitted_at && <span>سلمّى: {formatTime(sub.submitted_at)}</span>}
                                {showGrade && <span className="text-emerald-400 font-bold">الدرجة: {sub.total_score}/{sub.max_score}</span>}
                                {!showGrade && (sub.status === 'submitted' || sub.status === 'auto_submitted' || sub.status === 'cheated') && <span className="text-slate-500 font-bold flex items-center gap-1"><FileX size={10} /> مخفية</span>}
                                {isActive && <span className="flex items-center gap-1 text-sky-400"><Navigation size={10} /> س{qIdx + 1}</span>}
                                {isActive && <span className="flex items-center gap-1 text-emerald-400"><Save size={10} /> {answered} مجاب</span>}
                                {isActive && sub.last_activity_at && <span className="text-slate-400">{timeAgo(sub.last_activity_at)}</span>}
                              </div>
                              {isActive && (
                                <div className="mt-1.5 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                                  <div className="h-full bg-gradient-to-l from-emerald-500 to-teal-400 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, progressPct)}%` }} />
                                </div>
                              )}
                            </div>
                          </div>
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold flex-shrink-0 ${meta.bg} ${meta.color} border`}>
                            <Icon size={14} /> {meta.label}
                          </div>
                        </div>
                        <button
                          onClick={() => openSubmissionDetail(sub)}
                          className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-400 hover:text-emerald-400 text-[10px] font-bold transition"
                        >
                          <Eye size={11} /> عرض الإجابات
                        </button>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>

      <CheatingDetailsModal sub={cheatingSub} onClose={() => setCheatingSub(null)} />
      <SubmissionDetailModal
        sub={detailSub}
        questions={detailQuestions}
        answers={detailAnswers}
        loading={detailLoading}
        exam={selectedExam}
        onClose={closeSubmissionDetail}
      />
    </div>
  );
}

function SubmissionDetailModal({ sub, questions, answers, loading, exam, onClose }: {
  sub: MonitoredSubmission | null;
  questions: ExamQuestion[];
  answers: ExamAnswer[];
  loading: boolean;
  exam: OnlineExam | null;
  onClose: () => void;
}) {
  if (!sub) return null;
  const name = displayName(sub);
  const meta = STATUS_META[sub.status] ?? STATUS_META.in_progress;
  const answeredCount = answers.length;
  const totalQuestions = questions.length;
  const correctCount = answers.filter((a) => a.is_correct).length;
  const wrongCount = answers.filter((a) => !a.is_correct && a.selected_choice_index !== null).length;
  const unansweredCount = totalQuestions - answeredCount;
  const showGrades = exam?.show_results ?? true;
  const isActive = sub.status === 'in_progress';
  const elapsed = sub.started_at ? Math.floor((Date.now() - new Date(sub.started_at).getTime()) / 1000) : 0;
  const durationSec = (exam?.duration_minutes ?? 0) * 60;
  const remaining = Math.max(0, durationSec - elapsed);

  const answersByQuestion = new Map(answers.map((a) => [a.question_id, a]));

  return (
    <Modal open={!!sub} onClose={onClose} title={`تفاصيل محاولة: ${name}`} size="lg">
      <div className="space-y-4">
        {/* Status summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="glass-light rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 mb-1">الأسئلة</p>
            <p className="text-lg font-bold text-white">{totalQuestions}</p>
          </div>
          <div className="glass-light rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 mb-1">مُجاب</p>
            <p className="text-lg font-bold text-emerald-400">{answeredCount}</p>
          </div>
          <div className="glass-light rounded-xl p-3 text-center">
            <p className="text-[10px] text-slate-400 mb-1">بدون إجابة</p>
            <p className="text-lg font-bold text-amber-400">{unansweredCount}</p>
          </div>
        </div>

        {/* Score + timing */}
        <div className="glass-light rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400 flex items-center gap-1.5"><Activity size={14} /> الحالة</span>
            <span className={`font-bold ${meta.color}`}>{meta.label}</span>
          </div>
          {showGrades && !isActive && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Award size={14} /> الدرجة</span>
              <span className="font-bold text-emerald-400">{sub.total_score} / {sub.max_score}</span>
            </div>
          )}
          {showGrades && !isActive && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">صحيح / خطأ</span>
              <span className="font-bold text-white">{correctCount} / {wrongCount}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400 flex items-center gap-1.5"><Clock size={14} /> وقت بدء المحاولة</span>
            <span className="font-semibold text-white">{formatTime(sub.started_at)}</span>
          </div>
          {isActive ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Clock size={14} /> الوقت المتبقي</span>
              <span className={`font-bold ${remaining < 300 ? 'text-red-400' : 'text-amber-400'}`}>
                {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
              </span>
            </div>
          ) : (
            sub.submitted_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><CheckCircle2 size={14} /> وقت التسليم</span>
                <span className="font-semibold text-white">{formatTime(sub.submitted_at)}</span>
              </div>
            )
          )}
        </div>

        {/* Question-by-question answers */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">جارٍ تحميل الإجابات...</span>
          </div>
        ) : questions.length === 0 ? (
          <p className="text-center text-slate-400 py-4 text-sm">لا توجد أسئلة في هذا الامتحان.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {questions.map((q, idx) => {
              const ans = answersByQuestion.get(q.id);
              const hasAnswer = ans && (ans.selected_choice_index !== null || (ans.essay_answer ?? '').trim());
              const isCorrect = ans?.is_correct ?? false;
              const choices = (q as ExamQuestion & { choices?: string[] }).choices ?? [];
              return (
                <div key={q.id} className={`glass-light rounded-xl p-3 border ${hasAnswer ? isCorrect ? 'border-emerald-500/30' : 'border-red-500/30' : 'border-amber-500/20'}`}>
                  <div className="flex items-start gap-2">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${hasAnswer ? isCorrect ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium">{q.question_text}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">الدرجة: {q.points}</p>
                      {hasAnswer ? (
                        <div className="mt-2 space-y-1">
                          {ans!.selected_choice_index !== null && choices[ans!.selected_choice_index] && (
                            <p className="text-xs text-slate-300">
                              <span className="text-slate-500">الإجابة: </span>
                              {choices[ans!.selected_choice_index]}
                            </p>
                          )}
                          {ans!.essay_answer && ans!.essay_answer.trim() && (
                            <p className="text-xs text-slate-300">
                              <span className="text-slate-500">الإجابة: </span>
                              {ans!.essay_answer}
                            </p>
                          )}
                          {showGrades && !isActive && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isCorrect ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                                {isCorrect ? 'صحيح' : 'خطأ'}
                              </span>
                              <span className="text-[10px] text-slate-400">الدرجة: {ans!.awarded_score}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-amber-400 mt-1.5 flex items-center gap-1">
                          <FileX size={11} /> لم يُجب
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* IDs */}
        <div className="text-[10px] text-slate-600 space-y-0.5">
          <p>معرف المحاولة: {sub.id}</p>
          <p>معرف الامتحان: {sub.exam_id}</p>
          {sub.student_id && <p>معرف الطالب: {sub.student_id}</p>}
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-white/10 transition">إغلاق</button>
        </div>
      </div>
    </Modal>
  );
}

function StatBox({ label, value, icon, color, bg }: { label: string; value: number; icon: React.ReactNode; color: string; bg: string }) {
  return (
    <div className={`glass-light rounded-xl p-3 ${bg}`}>
      <div className="flex items-center justify-between mb-1"><span className="text-[10px] text-slate-400">{label}</span><span className={color}>{icon}</span></div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function CheatingDetailsModal({ sub, onClose }: { sub: MonitoredSubmission | null; onClose: () => void }) {
  if (!sub) return null;
  const tabSwitches = sub.tab_switch_count ?? 0;
  const isCheated = sub.status === 'cheated' || tabSwitches >= 3;
  const name = displayName(sub);

  return (
    <Modal open={!!sub} onClose={onClose} title="تفاصيل المخالفة الأمنية" size="md">
      <div className="space-y-4">
        <div className="flex items-center gap-3 glass-light rounded-xl p-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold ${isCheated ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
            {name.charAt(0)}
          </div>
          <div>
            <p className="font-bold text-white">{name}</p>
            {displayPhone(sub) && <p className="text-xs text-slate-500">{displayPhone(sub)}</p>}
          </div>
        </div>

        <div className={`rounded-xl p-4 border ${isCheated ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className={isCheated ? 'text-red-400' : 'text-amber-400'} size={20} />
            <h3 className={`font-bold ${isCheated ? 'text-red-400' : 'text-amber-400'}`}>
              {isCheated ? 'تم الحظر — غش مؤكد' : 'تحت المراقبة'}
            </h3>
          </div>
          <p className="text-sm text-slate-300">
            {isCheated
              ? 'تم تسجيل حالة غش مؤكدة بسبب تجاوز حد التحذيرات المسموح بها (3 مخالفات). تم تسليم الامتحان تلقائياً.'
              : `تم رصد ${tabSwitches} محاولة خروج من صفحة الامتحان. الحد المسموح هو مرتان قبل الحظر.`}
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-400">الأحداث الأمنية المسجلة:</h4>
          <div className="glass-light rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Eye size={14} /> تبديل التبويب / فقدان التركيز</span>
              <span className={`font-bold ${tabSwitches >= 3 ? 'text-red-400' : tabSwitches > 0 ? 'text-amber-400' : 'text-slate-400'}`}>{tabSwitches} مرة</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Clock size={14} /> وقت بدء المحاولة</span>
              <span className="text-white font-semibold">{formatTime(sub.started_at)}</span>
            </div>
            {sub.submitted_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><CheckCircle2 size={14} /> وقت التسليم</span>
                <span className="text-white font-semibold">{formatTime(sub.submitted_at)}</span>
              </div>
            )}
            {sub.last_activity_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><RefreshCw size={14} /> آخر نشاط</span>
                <span className="text-white font-semibold">{timeAgo(sub.last_activity_at)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Activity size={14} /> حالة التسليم</span>
              <span className="text-white font-semibold">
                {sub.status === 'cheated' ? 'تسليم بسبب غش' : sub.status === 'submitted' ? 'تسليم طبيعي' : sub.status === 'auto_submitted' ? 'تسليم تلقائي (انتهى الوقت)' : sub.status === 'in_progress' ? 'جاري الامتحان' : 'في الانتظار'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Award size={14} /> الدرجة</span>
              <span className="text-white font-semibold">{sub.total_score} / {sub.max_score}</span>
            </div>
          </div>
        </div>

        <div className="text-[10px] text-slate-600 space-y-0.5">
          <p>معرف الامتحان: {sub.exam_id}</p>
          <p>معرف المحاولة: {sub.id}</p>
          <p>معرف الطالب: {sub.student_id}</p>
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-white/10 transition">إغلاق</button>
        </div>
      </div>
    </Modal>
  );
}
