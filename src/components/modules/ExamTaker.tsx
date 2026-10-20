import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  AlertTriangle,
  Eye,
  Send,
  CheckCircle2,
  XCircle,
  Award,
  PartyPopper,
  ShieldCheck,
  Lock,
  Rocket,
  Timer,
  GraduationCap,
  ArrowLeft,
  Ban,
  Flag,
  Grid3x3,
  Loader2,
  WifiOff,
  CloudOff,
  Cloud,
  Save,
  RefreshCw,
} from 'lucide-react';
import type { OnlineExam, ExamQuestion, ExamSubmission } from '@/lib/types';
import {
  fetchOnlineExamById,
  fetchExamQuestions,
  fetchSubmission,
  createSubmission,
  updateSubmission,
  updateSubmissionProgress,
  upsertAnswer,
  upsertAnswersBatch,
  fetchAnswers,
  upsertOnlineGrade,
  hasStudentTakenExam,
} from '@/lib/data';
import { useSettings } from '@/context/SettingsContext';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';

type ExamTakerProps = {
  examId: string;
  studentName: string;
  studentId?: string;
  studentPhone?: string;
  onExit: () => void;
  previewMode?: boolean;
};

type ResultData = {
  score: number;
  max: number;
  cheated: boolean;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  timeTaken: number;
};

type ShuffledQuestion = ExamQuestion & {
  _shuffledChoices?: string[];
  _choiceMap?: number[];
};

type AnswerState = { choice: number | null; essay: string };

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function fmtSec(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const MAX_WARNINGS = 2;

function generateStableUuid(input: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = ((h1 >>> 8) ^ 0x6a09e667).toString(16).padStart(8, '0');
  const hex3 = ((h1 >>> 16) ^ 0xbb67ae85).toString(16).padStart(8, '0');
  const hex4 = ((h1 >>> 24) ^ 0x3c6ef372).toString(16).padStart(8, '0');
  const full = (hex + hex2 + hex3 + hex4).padEnd(32, '0').slice(0, 32);
  return `${full.slice(0, 8)}-${full.slice(8, 12)}-4${full.slice(13, 16)}-a${full.slice(17, 20)}-${full.slice(20, 32)}`;
}

export default function ExamTaker({ examId, studentName, studentId, studentPhone, onExit, previewMode }: ExamTakerProps) {
  const { settings } = useSettings();
  const [exam, setExam] = useState<OnlineExam | null>(null);
  const [rawQuestions, setRawQuestions] = useState<ExamQuestion[]>([]);
  const [submission, setSubmission] = useState<ExamSubmission | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [questionTimeLeft, setQuestionTimeLeft] = useState<number | null>(null);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const [result, setResult] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>('');
  const [retryCount, setRetryCount] = useState(0);
  const loadingRef = useRef(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [visitedQuestions, setVisitedQuestions] = useState<Set<number>>(new Set([0]));
  const [markedForReview, setMarkedForReview] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [startTime] = useState(Date.now());
  const [phase, setPhase] = useState<'countdown' | 'welcome' | 'exam' | 'result' | 'locked'>('welcome');
  const [lockdownError, setLockdownError] = useState(false);
  const [countdown, setCountdown] = useState({ h: 0, m: 0, s: 0, total: 0 });
  const [lockedReason, setLockedReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [online, setOnline] = useState(navigator.onLine);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answersRef = useRef(answers);
  const submissionRef = useRef(submission);
  const phaseRef = useRef(phase);
  const submittingRef = useRef(false);
  const lastSavedAnswersRef = useRef<Record<string, string>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { submissionRef.current = submission; }, [submission]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Online/offline tracking
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // LocalStorage key for offline answer recovery
  const localStorageKey = useMemo(() => `exam_answers_${examId}_${studentId ?? studentName}`, [examId, studentId, studentName]);

  // Save answers to localStorage as offline backup
  const saveToLocal = useCallback(() => {
    try {
      localStorage.setItem(localStorageKey, JSON.stringify(answersRef.current));
    } catch { /* ignore quota errors */ }
  }, [localStorageKey]);

  // Load answers from localStorage
  const loadFromLocal = useCallback((): Record<string, AnswerState> => {
    try {
      const raw = localStorage.getItem(localStorageKey);
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, AnswerState>;
    } catch {
      return {};
    }
  }, [localStorageKey]);

  const fetchWithTimeout = useCallback(async <T,>(fn: () => Promise<T>, ms = 15000): Promise<T> => {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms)
      ),
    ]);
  }, []);

  const load = useCallback(async (isRetry = false) => {
    if (loadingRef.current && !isRetry) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError('');

    try {
      const ex = await fetchWithTimeout(() => fetchOnlineExamById(examId));
      if (!ex) { setLoadError('لم يتم العثور على الامتحان.'); setLoading(false); loadingRef.current = false; return; }
      setExam(ex);

      const qs = await fetchWithTimeout(() => fetchExamQuestions(examId));
      setRawQuestions(qs);

      const initial: Record<string, AnswerState> = {};
      for (const q of qs) initial[q.id] = { choice: null, essay: '' };

      if (!previewMode) {
        const submissionStudentId = studentId ?? generateStableUuid(`${examId}_${studentName}`);
        let sub = await fetchWithTimeout(() => fetchSubmission(examId, submissionStudentId));

        if (sub && ['submitted', 'auto_submitted', 'cheated'].includes(sub.status)) {
          setLockedReason('لقد قمت بأداء هذا الامتحان بالفعل. لا يُسمح بإعادته.');
          setPhase('locked');
          setLoading(false); loadingRef.current = false; return;
        }

        if (studentPhone) {
          const taken = await fetchWithTimeout(() => hasStudentTakenExam(examId, submissionStudentId));
          if (taken) {
            setLockedReason('لقد قمت بأداء هذا الامتحان بالفعل. لا يُسمح بإعادته.');
            setPhase('locked');
            setLoading(false); loadingRef.current = false; return;
          }
        }

        if (!sub) {
          const maxScore = qs.reduce((s, q) => s + q.points, 0);
          sub = await fetchWithTimeout(() => createSubmission(examId, submissionStudentId, maxScore, studentName, studentPhone));
        }
        if (sub) {
          setSubmission(sub);
          setTabSwitches(sub.tab_switch_count ?? 0);

          try {
            const savedAnswers = await fetchWithTimeout(() => fetchAnswers(sub!.id));
            for (const sa of savedAnswers) {
              if (sa.question_id && initial[sa.question_id]) {
                initial[sa.question_id] = {
                  choice: sa.selected_choice_index ?? null,
                  essay: sa.essay_answer ?? '',
                };
              }
            }
          } catch { /* ignore — will use empty answers */ }
        }
      }

      const localAnswers = loadFromLocal();
      for (const qId of Object.keys(initial)) {
        if (localAnswers[qId]) {
          const local = localAnswers[qId];
          if (local.choice !== null || local.essay?.trim()) {
            initial[qId] = local;
          }
        }
      }

      setAnswers(initial);
      answersRef.current = initial;
      setTimeLeft((ex.duration_minutes ?? 0) * 60);

      if (ex.open_at && !previewMode && new Date(ex.open_at).getTime() > Date.now()) {
        setPhase('countdown');
      }

      if (ex.close_at && !previewMode) {
        const closeTime = new Date(ex.close_at).getTime();
        if (closeTime < Date.now()) {
          setLockedReason('انتهت الفترة المحددة لاداء هذا الامتحان.');
          setPhase('locked');
        }
      }

      setLoading(false);
      loadingRef.current = false;
      setRetryCount(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ExamTaker] load failed:', msg);
      setLoading(false);
      loadingRef.current = false;
      setLoadError(msg === 'timeout'
        ? 'انتهت مهلة الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.'
        : 'تعذر تحميل الامتحان. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.'
      );
    }
  }, [examId, studentName, studentId, studentPhone, previewMode, loadFromLocal, fetchWithTimeout]);

  useEffect(() => { void load(); }, [load]);

  const handleRetry = useCallback(() => {
    setRetryCount((c) => c + 1);
    void load(true);
  }, [load]);

  const questions: ShuffledQuestion[] = useMemo(() => {
    if (!exam || rawQuestions.length === 0) return rawQuestions;
    let qs = [...rawQuestions];
    if (exam.shuffle_questions || exam.is_random) {
      qs = shuffleArray(qs);
    }
    if (exam.shuffle_choices) {
      qs = qs.map((q) => {
        if (q.type !== 'mcq' || !q.choices) return q;
        const indices = q.choices.map((_, i) => i);
        const shuffledIndices = shuffleArray(indices);
        const shuffledChoices = shuffledIndices.map((i) => q.choices![i]);
        return { ...q, _shuffledChoices: shuffledChoices, _choiceMap: shuffledIndices };
      });
    }
    return qs;
  }, [exam, rawQuestions]);

  // Countdown timer
  useEffect(() => {
    if (phase !== 'countdown' || !exam?.open_at) return;
    function tick() {
      if (!exam?.open_at) return;
      const openTime = new Date(exam.open_at).getTime();
      const diff = Math.max(0, openTime - Date.now());
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown({ h, m, s, total: diff });
      if (diff <= 0) setPhase('welcome');
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phase, exam]);

  // Main exam timer
  useEffect(() => {
    if (phase !== 'exam' || result) return;
    if (!previewMode && !submission) return;
    timerRef.current = setInterval(() => {
      if (exam?.close_at && new Date(exam.close_at).getTime() <= Date.now()) {
        if (timerRef.current) clearInterval(timerRef.current);
        handleSubmit('auto_submitted');
        return;
      }
      setTimeLeft((t) => {
        if (t <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleSubmit('auto_submitted');
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, result, phase, exam]);

  // Per-question timer
  useEffect(() => {
    if (phase !== 'exam' || result) return;
    const q = questions[currentIdx];
    if (!q) { setQuestionTimeLeft(null); return; }
    const perQ = q.time_seconds ?? (exam?.seconds_per_question ?? 0);
    if (!perQ || perQ <= 0) { setQuestionTimeLeft(null); return; }
    setQuestionTimeLeft(perQ);
    if (qTimerRef.current) clearInterval(qTimerRef.current);
    qTimerRef.current = setInterval(() => {
      setQuestionTimeLeft((t) => {
        if (t === null) return null;
        if (t <= 1) {
          if (qTimerRef.current) clearInterval(qTimerRef.current);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => { if (qTimerRef.current) clearInterval(qTimerRef.current); };
  }, [currentIdx, phase, result, questions, exam]);

  // Smart auto-save: only save answers that changed since last save
  const doAutoSave = useCallback(async () => {
    if (previewMode || !submissionRef.current) return;
    const sub = submissionRef.current;
    const current = answersRef.current;
    const changed: { questionId: string; selected_choice_index: number | null; essay_answer: string | null; awarded_score: number; is_correct: boolean }[] = [];

    for (const q of questions) {
      const ans = current[q.id];
      if (!ans) continue;
      const signature = `${ans.choice ?? ''}|${ans.essay ?? ''}`;
      const lastSig = lastSavedAnswersRef.current[q.id];
      if (signature === lastSig) continue;
      changed.push({
        questionId: q.id,
        selected_choice_index: ans.choice,
        essay_answer: ans.essay || null,
        awarded_score: 0,
        is_correct: false,
      });
      lastSavedAnswersRef.current[q.id] = signature;
    }

    if (changed.length === 0) return;

    setSaveStatus('saving');
    try {
      if (!navigator.onLine) throw new Error('offline');
      await upsertAnswersBatch(sub.id, changed);
      setSaveStatus('saved');
      saveToLocal();
      reportProgress(currentIdx);
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      saveToLocal();
    }
  }, [questions, previewMode, saveToLocal]);

  // Auto-save: debounced on answer change + periodic interval
  useEffect(() => {
    if (phase !== 'exam' || !submission || previewMode) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void doAutoSave(); }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [answers, phase, submission, previewMode, doAutoSave]);

  useEffect(() => {
    if (phase !== 'exam' || !submission || previewMode) return;
    autoSaveRef.current = setInterval(() => { void doAutoSave(); }, 15000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [phase, submission, previewMode, doAutoSave]);

  // Sync when back online
  useEffect(() => {
    if (online && phase === 'exam' && saveStatus === 'error') {
      void doAutoSave();
    }
  }, [online, phase, saveStatus, doAutoSave]);

  // Anti-cheat: copy/paste/cut/context menu/keyboard shortcuts
  useEffect(() => {
    if (phase !== 'exam' || !submission || result || previewMode) return;
    function preventDefault(e: Event) { e.preventDefault(); return false; }
    function onContextmenu(e: MouseEvent) { e.preventDefault(); return false; }
    function onKeyCombination(e: KeyboardEvent) {
      const blocked = ['c', 'v', 'x', 'a', 's', 'u', 'p', 'j', 'k', 'i', 'h', 'r', 't', 'n', 'w', 'f'];
      if ((e.ctrlKey && blocked.includes(e.key.toLowerCase())) || e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) || (e.metaKey && blocked.includes(e.key.toLowerCase()))) {
        e.preventDefault(); return false;
      }
    }
    function onDrag(e: DragEvent) { e.preventDefault(); return false; }
    document.addEventListener('copy', preventDefault);
    document.addEventListener('paste', preventDefault);
    document.addEventListener('cut', preventDefault);
    document.addEventListener('contextmenu', onContextmenu);
    document.addEventListener('keydown', onKeyCombination);
    document.addEventListener('dragstart', onDrag);
    return () => {
      document.removeEventListener('copy', preventDefault);
      document.removeEventListener('paste', preventDefault);
      document.removeEventListener('cut', preventDefault);
      document.removeEventListener('contextmenu', onContextmenu);
      document.removeEventListener('keydown', onKeyCombination);
      document.removeEventListener('dragstart', onDrag);
    };
  }, [submission, result, phase]);

  // Anti-cheat: visibility/blur/fullscreen
  useEffect(() => {
    if (phase !== 'exam' || !submission || result || previewMode) return;

    function recordViolation() {
      setTabSwitches((prev) => {
        const next = prev + 1;
        const sub = submissionRef.current;
        if (sub) updateSubmission(sub.id, { tab_switch_count: next, status: next > MAX_WARNINGS ? 'cheated' : 'in_progress' });
        if (next > MAX_WARNINGS) {
          handleSubmit('cheated');
        } else {
          setWarningCount(next);
          setWarningOpen(true);
          document.documentElement.requestFullscreen?.().catch(() => {});
        }
        return next;
      });
    }

    function onVisibility() { if (document.hidden) recordViolation(); }
    function onBlur() { recordViolation(); }
    function onFullscreenChange() { if (!document.fullscreenElement) recordViolation(); }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.documentElement.requestFullscreen?.().catch(() => { setLockdownError(true); });

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission, result, phase]);

  const watermarks = useMemo(() => Array.from({ length: 8 }, (_, i) => ({
    top: `${(i * 23) % 90 + 5}%`,
    left: `${(i * 37) % 80 + 10}%`,
  })), []);

  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  async function handleSubmit(status: 'submitted' | 'auto_submitted' | 'cheated') {
    const currentSubmission = submissionRef.current;
    const currentAnswers = answersRef.current;
    if (!exam || result || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    if (!previewMode && !currentSubmission) return;
    if (timerRef.current) clearInterval(timerRef.current);
    if (qTimerRef.current) clearInterval(qTimerRef.current);
    if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    // Final save of all answers before grading
    if (!previewMode && currentSubmission) {
      setSaveStatus('saving');
      const allAnswers = questions.map((q) => {
        const ans = currentAnswers[q.id];
        const mappedChoice = ans?.choice !== null && ans?.choice !== undefined && q._choiceMap ? q._choiceMap[ans.choice] : ans?.choice;
        return {
          questionId: q.id,
          selected_choice_index: mappedChoice ?? null,
          essay_answer: ans?.essay || null,
          awarded_score: 0,
          is_correct: false,
        };
      });
      try { await upsertAnswersBatch(currentSubmission.id, allAnswers); } catch { /* will grade anyway */ }
      setSaveStatus('saved');
    }

    let totalScore = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    const maxScore = questions.reduce((s, q) => s + q.points, 0);

    for (const q of questions) {
      const ans = currentAnswers[q.id];
      const mappedChoice = ans?.choice !== null && ans?.choice !== undefined && q._choiceMap ? q._choiceMap[ans.choice] : ans?.choice;
      let awarded = 0;
      let isCorrect = false;
      if (q.type === 'mcq' && mappedChoice !== null && mappedChoice !== undefined) {
        if (mappedChoice === q.correct_choice_index) {
          awarded = q.points; isCorrect = true; correctCount++;
        } else { wrongCount++; }
      } else if (q.type === 'true_false' && mappedChoice !== null && mappedChoice !== undefined) {
        if (mappedChoice === q.correct_choice_index) {
          awarded = q.points; isCorrect = true; correctCount++;
        } else { wrongCount++; }
      } else { unansweredCount++; }
      totalScore += awarded;
      if (!previewMode && currentSubmission) {
        try {
          await upsertAnswer(currentSubmission.id, q.id, {
            selected_choice_index: mappedChoice ?? null,
            essay_answer: ans?.essay ?? null,
            awarded_score: awarded,
            is_correct: isCorrect,
          });
        } catch { /* continue grading */ }
      }
    }

    const timeTaken = Math.round((Date.now() - startTime) / 1000);

    if (!previewMode && currentSubmission) {
      await updateSubmission(currentSubmission.id, {
        status,
        total_score: totalScore,
        max_score: maxScore,
        submitted_at: new Date().toISOString(),
      });
      await upsertOnlineGrade(exam.id, currentSubmission.student_id, totalScore, maxScore, status === 'cheated');
      // Clear localStorage backup after successful submission
      try { localStorage.removeItem(localStorageKey); } catch { /* ignore */ }
    }

    setResult({ score: totalScore, max: maxScore, cheated: status === 'cheated', correctCount, wrongCount, unansweredCount, timeTaken });
    if (status === 'cheated' && !previewMode) {
      setLockedReason('تم إنهاء امتحانك تلقائياً بسبب تجاوز حد التحذيرات (3 مخالفات). تم تسجيل إجاباتك وقد تم قفلك من الامتحان.');
      setPhase('locked');
    } else {
      setPhase('result');
    }
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  function setChoice(qId: string, choice: number) {
    setAnswers((prev) => ({ ...prev, [qId]: { ...prev[qId], choice } }));
  }
  function setEssay(qId: string, text: string) {
    setAnswers((prev) => ({ ...prev, [qId]: { ...prev[qId], essay: text } }));
  }

  const reportProgress = useCallback((idx: number) => {
    if (previewMode || !submissionRef.current) return;
    const current = answersRef.current;
    let answered = 0;
    for (const qq of questions) {
      const a = current[qq.id];
      if (qq.type === 'mcq' || qq.type === 'true_false') {
        if (a?.choice !== null && a?.choice !== undefined) answered++;
      } else if (a?.essay?.trim()) answered++;
    }
    updateSubmissionProgress(submissionRef.current.id, idx, answered).catch(() => {});
  }, [previewMode, questions]);

  function goToQuestion(idx: number) {
    setCurrentIdx(idx);
    setVisitedQuestions((prev) => new Set(prev).add(idx));
    setPaletteOpen(false);
    reportProgress(idx);
  }

  function toggleMarkForReview(qId: string) {
    setMarkedForReview((prev) => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId);
      else next.add(qId);
      return next;
    });
  }

  const q = questions[currentIdx];
  const isLast = currentIdx === questions.length - 1;

  const isCurrentAnswered = q ? (q.type === 'mcq'
    ? answers[q.id]?.choice !== null && answers[q.id]?.choice !== undefined
    : q.type === 'true_false'
    ? answers[q.id]?.choice !== null && answers[q.id]?.choice !== undefined
    : answers[q.id]?.essay?.trim()) : false;

  const answeredCount = questions.filter((qq) => {
    const a = answers[qq.id];
    return qq.type === 'mcq' || qq.type === 'true_false'
      ? a?.choice !== null && a?.choice !== undefined
      : a?.essay?.trim();
  }).length;
  const progressPct = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-emerald-400" />
          <p className="text-slate-400 text-sm">جارٍ تحميل الامتحان...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass-card rounded-3xl p-8 max-w-md text-center">
          <div className="mx-auto w-20 h-20 rounded-full bg-amber-500/15 flex items-center justify-center mb-4">
            <WifiOff className="text-amber-400" size={40} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">تعذر تحميل الامتحان</h2>
          <p className="text-slate-400 text-sm mb-6">{loadError}</p>
          {retryCount > 0 && <p className="text-xs text-slate-500 mb-4">محاولة رقم {retryCount}</p>}
          <div className="flex gap-3 justify-center">
            <Button variant="secondary" onClick={onExit}><ArrowLeft size={16} /> العودة</Button>
            <Button onClick={handleRetry} disabled={loading}><RefreshCw size={16} /> إعادة المحاولة</Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ============ COUNTDOWN SCREEN ============
  if (phase === 'countdown' && exam) {
    const totalSec = countdown.total > 0 ? Math.ceil(countdown.total / 1000) : 0;
    const pct = exam.open_at ? Math.min(100, Math.round(((1 - countdown.total / (new Date(exam.open_at).getTime() - startTime)) * 100))) : 0;
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-slate-950">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-emerald-600/10 rounded-full blur-[150px]" />
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px]" />
        </div>
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }} />
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass-card relative w-full max-w-xl rounded-3xl p-10 shadow-2xl text-center z-10">
          <div className="flex flex-col items-center mb-6">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt="logo" className="w-16 h-16 rounded-2xl object-cover ring-2 ring-emerald-500/30 mb-2" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-emerald-600/20 flex items-center justify-center ring-2 ring-emerald-500/30 mb-2">
                <GraduationCap className="text-emerald-400" size={32} />
              </div>
            )}
            <h1 className="text-xl font-extrabold gradient-text">{settings.platform_name}</h1>
          </div>
          <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 2, repeat: Infinity }} className="mx-auto w-20 h-20 rounded-full bg-amber-500/15 flex items-center justify-center mb-5 ring-4 ring-amber-500/20">
            <Lock className="text-amber-400" size={36} />
          </motion.div>
          <h2 className="text-2xl font-extrabold text-white mb-2">الامتحان لم يبدأ بعد</h2>
          <p className="text-sm text-slate-400 mb-1">امتحان: <span className="text-emerald-400 font-bold">{exam.title}</span></p>
          {exam.subject && <p className="text-xs text-slate-500 mb-1">المادة: {exam.subject}</p>}
          <p className="text-xs text-slate-500 mb-6">يبدأ في: {exam.open_at ? new Date(exam.open_at).toLocaleString('ar-EG', { dateStyle: 'full', timeStyle: 'short' }) : '—'}</p>
          <div className="flex items-center justify-center gap-3 sm:gap-4 mb-6">
            {[
              { label: 'ساعة', value: countdown.h },
              { label: 'دقيقة', value: countdown.m },
              { label: 'ثانية', value: countdown.s },
            ].map((unit, idx) => (
              <div key={unit.label} className="flex items-center gap-3 sm:gap-4">
                <div className="flex flex-col items-center">
                  <motion.div key={unit.value} initial={{ scale: 1.2, opacity: 0.5 }} animate={{ scale: 1, opacity: 1 }} className={`w-20 h-24 sm:w-24 sm:h-28 rounded-2xl flex items-center justify-center font-mono font-black text-4xl sm:text-5xl ${unit.label === 'ثانية' ? 'bg-emerald-500/15 text-emerald-400 ring-2 ring-emerald-500/30' : 'glass-light text-white ring-1 ring-white/10'}`}>
                    {String(unit.value).padStart(2, '0')}
                  </motion.div>
                  <span className="text-xs text-slate-400 mt-2 font-semibold">{unit.label}</span>
                </div>
                {idx < 2 && <span className="text-3xl text-slate-600 font-black -mt-6">:</span>}
              </div>
            ))}
          </div>
          <div className="glass-light rounded-full h-2 overflow-hidden mb-6">
            <motion.div className="h-full bg-gradient-to-l from-emerald-500 to-teal-400 rounded-full" animate={{ width: `${pct}%` }} transition={{ duration: 1 }} />
          </div>
          <div className="glass-light rounded-xl p-4 space-y-2 text-right mb-6">
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">المدة</span><span className="text-white font-bold">{exam.duration_minutes} دقيقة</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">عدد الأسئلة</span><span className="text-white font-bold">{rawQuestions.length} سؤال</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">الدرجة الكلية</span><span className="text-white font-bold">{exam.total_score ?? 100} درجة</span></div>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-amber-400/80 mb-4"><ShieldCheck size={14} /><span>الامتحان مقفل حتى يحين موعد البدء — ترقب العداد!</span></div>
          <Button onClick={onExit} variant="secondary" className="w-full"><ArrowLeft size={16} /> العودة للبوابة</Button>
        </motion.div>
      </div>
    );
  }

  // ============ LOCKED SCREEN ============
  if (phase === 'locked' && exam) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-slate-950">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-red-600/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-red-600/5 rounded-full blur-[100px]" />
        </div>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass-card relative w-full max-w-md rounded-3xl p-8 shadow-2xl text-center z-10">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15, type: 'spring' }} className="mx-auto w-24 h-24 rounded-full bg-red-500/15 flex items-center justify-center mb-5 ring-4 ring-red-500/20">
            <Ban className="text-red-400" size={48} />
          </motion.div>
          <h2 className="text-2xl font-extrabold text-red-400 mb-3">تم قفل الامتحان</h2>
          <p className="text-sm text-slate-300 leading-relaxed mb-6">{lockedReason}</p>
          <Button onClick={onExit} className="w-full"><ArrowLeft size={16} /> العودة للبوابة</Button>
        </motion.div>
      </div>
    );
  }

  // ============ WELCOME SCREEN ============
  if (phase === 'welcome' && exam) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-slate-950">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-600/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px]" />
        </div>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass-card relative w-full max-w-lg rounded-3xl p-8 shadow-2xl text-center">
          <div className="flex flex-col items-center mb-6">
            {settings.logo_url ? (
              <img src={settings.logo_url} alt="logo" className="w-16 h-16 rounded-2xl object-cover ring-2 ring-emerald-500/30 mb-2" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-emerald-600/20 flex items-center justify-center ring-2 ring-emerald-500/30 mb-2">
                <GraduationCap className="text-emerald-400" size={32} />
              </div>
            )}
            <h1 className="text-xl font-extrabold gradient-text">{settings.platform_name}</h1>
          </div>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2, type: 'spring' }} className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center mb-5 ring-4 ring-emerald-500/30">
            <Rocket className="text-emerald-400" size={40} />
          </motion.div>
          <p className="text-lg text-white font-bold leading-relaxed mb-2">أهلاً بك يا بطل في منصة الخالد</p>
          <p className="text-base text-emerald-400 font-semibold leading-relaxed mb-6">هل أنت مستعد لخوض التحدي؟ ركز جيداً، تمنياتي لك بالتوفيق!</p>
          <div className="glass-light rounded-xl p-4 mb-6 space-y-2 text-right">
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">عنوان الامتحان</span><span className="text-white font-bold">{exam.title}</span></div>
            {exam.subject && <div className="flex items-center justify-between text-sm"><span className="text-slate-400">المادة</span><span className="text-white font-bold">{exam.subject}</span></div>}
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">المدة</span><span className="text-white font-bold">{exam.duration_minutes} دقيقة</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">عدد الأسئلة</span><span className="text-white font-bold">{rawQuestions.length} سؤال</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-slate-400">الدرجة الكلية</span><span className="text-white font-bold">{exam.total_score ?? 100} درجة</span></div>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-amber-400/80 mb-6"><ShieldCheck size={14} /><span>سيبدأ الامتحان في وضع آمان مُقفل — يُمنع الخروج أو التبديل (مرتان كحد أقصى)</span></div>
          {lockdownError && <p className="text-xs text-amber-400 mb-4">تنبيه: تعذّر تفعيل وضع ملء الشاشة، لكن نظام الحماية يعمل.</p>}
          <Button onClick={() => {
            if (!previewMode && submission) void updateSubmission(submission.id, { status: 'in_progress' });
            if (!previewMode) document.documentElement.requestFullscreen?.().catch(() => setLockdownError(true));
            setPhase('exam');
          }} className="w-full text-lg py-4">
            <Rocket size={20} /> {previewMode ? 'بدء المعاينة' : 'ابدأ الامتحان'}
          </Button>
          {previewMode && (
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-xl py-2.5 px-3">
              <Eye size={14} /><span>وضع المعاينة — لن يتم حفظ أو تسجيل أي بيانات.</span>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  // ============ RESULT SCREEN ============
  if (phase === 'result' && result) {
    const showResults = exam?.show_results ?? true;
    const percent = result.max > 0 ? Math.round((result.score / result.max) * 100) : 0;
    const isCelebration = percent >= 85 && !result.cheated;
    const isPass = percent >= 50 && !result.cheated;

    let motivationalMsg = '';
    let motivationalColor = '';
    if (result.cheated) { motivationalMsg = 'تم إنهاء الامتحان بسبب تجاوز حد التحذيرات'; motivationalColor = 'text-red-400'; }
    else if (percent >= 85) { motivationalMsg = 'أحسنت يا بطل، أداء ممتاز! تستحق التقدير والاحترام'; motivationalColor = 'text-emerald-400'; }
    else if (percent >= 65) { motivationalMsg = 'عمل رائع، نتيجة جيدة جداً! واصل التألق'; motivationalColor = 'text-emerald-400'; }
    else if (percent >= 50) { motivationalMsg = 'أحسنت، لقد نجحت! بقليل من التركيز ستصل للقمة'; motivationalColor = 'text-blue-400'; }
    else { motivationalMsg = 'لا بأس، يمكنك التعويض في المرة القادمة، استمر في المحاولة!'; motivationalColor = 'text-amber-400'; }

    if (!showResults && !result.cheated) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-950">
          <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-card rounded-3xl p-8 max-w-md text-center">
            <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4"><CheckCircle2 className="text-emerald-400" size={48} /></div>
            <h2 className="text-2xl font-bold text-white mb-2">تم استلام إجاباتك</h2>
            <p className="text-slate-400 mb-6">شكراً لك يا {studentName.split(' ')[0]}! تم تسليم امتحانك بنجاح. ستظهر النتيجة لاحقاً بعد مراجعة المعلم.</p>
            <Button onClick={onExit} className="w-full">الخروج</Button>
          </motion.div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-slate-950">
        {isCelebration && <Confetti />}
        <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-card rounded-3xl p-8 max-w-md text-center relative z-10">
          {result.cheated ? (
            <>
              <div className="mx-auto w-20 h-20 rounded-full bg-red-500/15 flex items-center justify-center mb-4"><AlertTriangle className="text-red-400" size={48} /></div>
              <h2 className="text-2xl font-bold text-red-400 mb-2">تم تسليم الامتحان تلقائيًا</h2>
              <p className="text-slate-400 mb-4">تم رصد محاولة غش (تجاوز حد التحذيرات).</p>
            </>
          ) : isCelebration ? (
            <>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2, type: 'spring' }} className="mx-auto w-20 h-20 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4">
                <PartyPopper className="text-emerald-400" size={48} />
              </motion.div>
              <h2 className="text-2xl font-bold text-white mb-1">ممتاز يا {studentName.split(' ')[0]}!</h2>
            </>
          ) : isPass ? (
            <>
              <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4"><CheckCircle2 className="text-emerald-400" size={48} /></div>
              <h2 className="text-2xl font-bold text-white mb-1">أحسنت يا {studentName.split(' ')[0]}!</h2>
            </>
          ) : (
            <>
              <div className="mx-auto w-20 h-20 rounded-full bg-amber-500/15 flex items-center justify-center mb-4"><Award className="text-amber-400" size={48} /></div>
              <h2 className="text-2xl font-bold text-white mb-1">تم تسليم الامتحان</h2>
            </>
          )}
          <p className={`text-base font-semibold mb-4 ${motivationalColor}`}>{motivationalMsg}</p>
          <div className="glass-light rounded-2xl p-6 mb-4">
            <div className="relative inline-block">
              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgb(30,41,59)" strokeWidth="10" />
                <motion.circle cx="60" cy="60" r="52" fill="none" stroke={percent >= 50 ? 'rgb(16,185,129)' : 'rgb(245,158,11)'} strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 52}`} initial={{ strokeDashoffset: 2 * Math.PI * 52 }} animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - percent / 100) }} transition={{ duration: 1, delay: 0.3 }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-extrabold text-white">{percent}%</span>
                <span className="text-xs text-slate-400">{result.score} / {result.max}</span>
              </div>
            </div>
          </div>
          {!result.cheated && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              <StatBox icon={<CheckCircle2 size={18} />} value={result.correctCount} label="صحيحة" color="text-emerald-400" />
              <StatBox icon={<XCircle size={18} />} value={result.wrongCount} label="خاطئة" color="text-red-400" />
              <StatBox icon={<Clock size={18} />} value={fmtSec(result.timeTaken)} label="الوقت" color="text-blue-400" />
            </div>
          )}
          <Button onClick={onExit} className="w-full">الخروج</Button>
        </motion.div>
      </div>
    );
  }

  if (!exam) return null;

  // ============ EXAM TAKING SCREEN ============
  return (
    <div className="min-h-screen bg-slate-950 relative overflow-hidden">
      {watermarks.map((w, i) => (
        <div key={i} className="exam-watermark" style={{ top: w.top, left: w.left }}>{studentName}</div>
      ))}

      {/* Header */}
      <div className="glass border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <div className="flex items-center gap-2 flex-shrink-0">
              {settings.logo_url ? (
                <img src={settings.logo_url} alt="logo" className="w-8 h-8 rounded-lg object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-emerald-600/20 flex items-center justify-center">
                  <GraduationCap className="text-emerald-400" size={18} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-center">
              <Lock size={14} className="text-emerald-400 flex-shrink-0" />
              <span className="text-sm font-bold text-white truncate">{exam.title}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Save status indicator */}
              {saveStatus === 'saving' && <span className="flex items-center gap-1 text-[10px] text-amber-400"><Loader2 size={10} className="animate-spin" /> حفظ</span>}
              {saveStatus === 'saved' && <span className="flex items-center gap-1 text-[10px] text-emerald-400"><Cloud size={10} /> تم الحفظ</span>}
              {saveStatus === 'error' && <span className="flex items-center gap-1 text-[10px] text-red-400" title="محفوظ محلياً، سيتم مزامنته عند عودة الاتصال"><CloudOff size={10} /> غير متزامن</span>}
              {!online && <span className="flex items-center gap-1 text-[10px] text-amber-400"><WifiOff size={10} /> غير متصل</span>}
              <div className="flex items-center gap-1">
                {[0, 1].map((i) => (
                  <span key={i} className={`w-2 h-2 rounded-full ${i < tabSwitches ? 'bg-red-500' : 'bg-slate-600'}`} />
                ))}
              </div>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono font-bold text-sm ${timeLeft < 60 ? 'bg-red-500/20 text-red-400' : 'glass-light text-white'}`}>
                <Clock size={14} />{fmtSec(timeLeft)}
              </div>
            </div>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <motion.div className="h-full bg-gradient-to-l from-emerald-500 to-teal-500 rounded-full" animate={{ width: `${progressPct}%` }} transition={{ duration: 0.3 }} />
          </div>
        </div>
      </div>

      {/* Question content */}
      <div className="max-w-3xl mx-auto px-4 py-6 pb-44 relative z-10">
        {questions.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center text-slate-400">لا توجد أسئلة في هذا الامتحان.</div>
        ) : q ? (
          <AnimatePresence mode="wait">
            <motion.div key={q.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.2 }} className="glass-card rounded-2xl p-6 shadow-xl">
              {questionTimeLeft !== null && (
                <div className={`flex items-center justify-center gap-2 mb-4 py-2 rounded-xl ${questionTimeLeft <= 10 ? 'bg-red-500/15 text-red-400' : 'bg-sky-500/10 text-sky-300'}`}>
                  <Timer size={18} className={questionTimeLeft <= 10 ? 'animate-pulse' : ''} />
                  <span className="text-sm font-bold">وقت هذا السؤال: {fmtSec(questionTimeLeft)}</span>
                </div>
              )}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-400 font-bold text-sm flex items-center justify-center">{currentIdx + 1}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${q.type === 'mcq' ? 'text-sky-300 bg-sky-500/15 border-sky-500/20' : q.type === 'true_false' ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/20' : 'text-amber-300 bg-amber-500/15 border-amber-500/20'}`}>
                    {q.type === 'mcq' ? 'اختيارات' : q.type === 'true_false' ? 'صح/خطأ' : q.type === 'essay' ? 'مقالي' : q.type === 'fill_blank' ? 'أكمل' : 'إجابة قصيرة'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleMarkForReview(q.id)} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition ${markedForReview.has(q.id) ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'glass-light text-slate-400 border border-white/10 hover:text-amber-400'}`}>
                    <Flag size={12} /> {markedForReview.has(q.id) ? 'مُعلّم' : 'علام للمراجعة'}
                  </button>
                  <span className="text-xs text-slate-500">{q.points} درجة</span>
                </div>
              </div>
              <p className="text-white font-semibold text-lg mb-5 leading-relaxed">{q.question_text}</p>

              {q.type === 'mcq' && (q._shuffledChoices ?? q.choices) && (
                <div className="space-y-2.5">
                  {(q._shuffledChoices ?? q.choices)!.slice(0, 4).map((c, ci) => {
                    const isSelected = answers[q.id]?.choice === ci;
                    return (
                      <label key={ci} className={`w-full text-right px-4 py-3.5 rounded-xl border-2 transition-all flex items-center gap-3 cursor-pointer ${isSelected ? 'border-emerald-500 bg-gradient-to-l from-emerald-500/20 to-emerald-500/5 text-white' : 'border-white/10 glass-light text-slate-300 hover:border-white/25'}`}>
                        <span className="relative w-6 h-6 flex-shrink-0">
                          <input type="radio" name={`q_${q.id}`} checked={isSelected} onChange={() => setChoice(q.id, ci)} className="sr-only" />
                          <span className={`absolute inset-0 rounded-full border-2 flex items-center justify-center transition ${isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-slate-500'}`}>
                            {isSelected && <span className="w-2.5 h-2.5 rounded-full bg-white" />}
                          </span>
                        </span>
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 transition ${isSelected ? 'bg-emerald-500/20 text-emerald-400' : 'glass-light text-slate-400'}`}>
                          {['أ', 'ب', 'ج', 'د'][ci] ?? ci}
                        </span>
                        <span className="flex-1">{c}</span>
                        {isSelected && <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />}
                      </label>
                    );
                  })}
                </div>
              )}

              {q.type === 'true_false' && (
                <div className="space-y-2.5">
                  {[{ label: 'صح', val: 0 }, { label: 'خطأ', val: 1 }].map((opt) => {
                    const isSelected = answers[q.id]?.choice === opt.val;
                    return (
                      <label key={opt.val} className={`w-full text-right px-4 py-3.5 rounded-xl border-2 transition-all flex items-center gap-3 cursor-pointer ${isSelected ? 'border-emerald-500 bg-gradient-to-l from-emerald-500/20 to-emerald-500/5 text-white' : 'border-white/10 glass-light text-slate-300 hover:border-white/25'}`}>
                        <span className="relative w-6 h-6 flex-shrink-0">
                          <input type="radio" name={`q_${q.id}`} checked={isSelected} onChange={() => setChoice(q.id, opt.val)} className="sr-only" />
                          <span className={`absolute inset-0 rounded-full border-2 flex items-center justify-center transition ${isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-slate-500'}`}>
                            {isSelected && <span className="w-2.5 h-2.5 rounded-full bg-white" />}
                          </span>
                        </span>
                        <span className="text-lg font-bold flex-1">{opt.label}</span>
                        {isSelected && <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />}
                      </label>
                    );
                  })}
                </div>
              )}

              {(q.type === 'essay' || q.type === 'short_answer' || q.type === 'fill_blank') && (
                <textarea value={answers[q.id]?.essay ?? ''} onChange={(e) => setEssay(q.id, e.target.value)} rows={q.type === 'essay' ? 6 : 3} placeholder="اكتب إجابتك هنا..." className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition resize-none" />
              )}
            </motion.div>
          </AnimatePresence>
        ) : null}
      </div>

      {/* Sticky Action Bar */}
      <div className="fixed bottom-8 left-0 right-0 glass border-t border-white/10 z-30">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setPaletteOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light border border-white/10 text-slate-300 hover:text-white transition text-xs font-semibold">
              <Grid3x3 size={14} /> لوحة الأسئلة
            </button>
            <span className="text-xs text-slate-400 hidden sm:block">سؤال {currentIdx + 1} / {questions.length}</span>
          </div>
          <div className="flex items-center gap-2">
            {currentIdx > 0 && (
              <Button size="sm" variant="secondary" onClick={() => { setCurrentIdx(currentIdx - 1); setVisitedQuestions((prev) => new Set(prev).add(currentIdx - 1)); }}>
                السابق
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={() => setConfirmSubmitOpen(true)} disabled={submitting}>
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} إنهاء الامتحان
              </Button>
            ) : (
              <Button size="sm" onClick={() => {
                const next = Math.min(questions.length - 1, currentIdx + 1);
                setCurrentIdx(next);
                setVisitedQuestions((prev) => new Set(prev).add(next));
              }}>
                التالي
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Question Palette Drawer */}
      <AnimatePresence>
        {paletteOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 pointer-events-none" onClick={() => setPaletteOpen(false)}>
            <div className="absolute inset-0 bg-black/50 pointer-events-auto" />
            <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'tween', duration: 0.25 }} onClick={(e) => e.stopPropagation()} className="fixed top-0 bottom-0 left-0 w-80 glass-card z-50 overflow-y-auto p-5 pointer-events-auto">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Grid3x3 size={18} /> لوحة الأسئلة</h3>
                <button onClick={() => setPaletteOpen(false)} className="text-slate-400 hover:text-white transition"><ArrowLeft size={20} /></button>
              </div>
              <div className="space-y-2 mb-5 text-xs">
                <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-emerald-500" /> <span className="text-slate-300">مُجاب</span></div>
                <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-amber-500" /> <span className="text-slate-300">مُعلّم للمراجعة</span></div>
                <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-slate-600" /> <span className="text-slate-300">غير مُجاب</span></div>
                <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-sky-500 ring-2 ring-sky-300" /> <span className="text-slate-300">السؤال الحالي</span></div>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {questions.map((qq, idx) => {
                  const a = answers[qq.id];
                  const isAnswered = qq.type === 'mcq' || qq.type === 'true_false' ? a?.choice !== null && a?.choice !== undefined : a?.essay?.trim();
                  const isMarked = markedForReview.has(qq.id);
                  const isCurrent = idx === currentIdx;
                  const bgClass = isCurrent ? 'bg-sky-500 text-white ring-2 ring-sky-300' : isAnswered ? 'bg-emerald-500/80 text-white' : isMarked ? 'bg-amber-500/80 text-white' : 'bg-slate-600/50 text-slate-300';
                  return <button key={qq.id} onClick={() => goToQuestion(idx)} className={`aspect-square rounded-lg font-bold text-sm transition hover:scale-105 ${bgClass}`}>{idx + 1}</button>;
                })}
              </div>
              <div className="mt-5 glass-light rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">إجمالي الأسئلة</span><span className="text-white font-bold">{questions.length}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">مُجاب</span><span className="text-emerald-400 font-bold">{answeredCount}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">مُعلّم للمراجعة</span><span className="text-amber-400 font-bold">{markedForReview.size}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">غير مُجاب</span><span className="text-slate-300 font-bold">{questions.length - answeredCount}</span></div>
              </div>
              <div className="mt-4">
                <Button size="sm" className="w-full" onClick={() => { setPaletteOpen(false); setConfirmSubmitOpen(true); }} disabled={submitting}>
                  <Send size={14} /> تسليم الامتحان
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm submit modal */}
      <Modal open={confirmSubmitOpen} onClose={() => setConfirmSubmitOpen(false)} size="sm">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4"><Send className="text-emerald-400" size={32} /></div>
          <h3 className="text-xl font-bold text-white mb-2">تأكيد تسليم الامتحان</h3>
          {questions.length - answeredCount > 0 ? (
            <p className="text-amber-400 text-sm mb-2 flex items-center justify-center gap-1.5">
              <AlertTriangle size={14} />
              لديك {questions.length - answeredCount} سؤال بدون إجابة
            </p>
          ) : (
            <p className="text-emerald-400 text-sm mb-2 flex items-center justify-center gap-1.5">
              <CheckCircle2 size={14} />
              تمت الإجابة على جميع الأسئلة
            </p>
          )}
          <p className="text-slate-400 text-sm mb-4">هل أنت متأكد من تسليم الامتحان؟ لا يمكنك إعادته بعد التسليم.</p>
          <div className="flex gap-3 justify-center">
            <Button variant="secondary" onClick={() => setConfirmSubmitOpen(false)}>إلغاء</Button>
            <Button onClick={() => { setConfirmSubmitOpen(false); void handleSubmit('submitted'); }} disabled={submitting}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} تأكيد التسليم
            </Button>
          </div>
        </div>
      </Modal>

      {/* Tab switch warning */}
      <Modal open={warningOpen} onClose={() => setWarningOpen(false)} size="sm">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center mb-4"><AlertTriangle className="text-red-400" size={32} /></div>
          <h3 className="text-xl font-bold text-red-300 mb-2">تحذير: مغادرة نافذة الامتحان</h3>
          <p className="text-slate-400 text-sm mb-2">تم رصد خروجك من نافذة الامتحان.</p>
          <p className="text-slate-300 text-sm mb-4">هذا التحذير رقم <span className="font-bold text-amber-400">{warningCount}</span> من {MAX_WARNINGS}. في المخالفة الثالثة سيتم إنهاء الامتحان تلقائياً وقفلك نهائياً كحالة غش.</p>
          <Button onClick={() => setWarningOpen(false)}><Eye size={16} /> العودة للامتحان</Button>
        </div>
      </Modal>
    </div>
  );
}

function StatBox({ icon, value, label, color }: { icon: React.ReactNode; value: React.ReactNode; label: string; color: string }) {
  return (
    <div className="glass-light rounded-xl p-3 text-center">
      <div className={`flex items-center justify-center mb-1 ${color}`}>{icon}</div>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}

function Confetti() {
  const colors = ['#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#06b6d4'];
  const pieces = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 2}s`,
    duration: `${2 + Math.random() * 2}s`,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: `${6 + Math.random() * 8}px`,
    rotate: `${Math.random() * 360}deg`,
  }));
  return (
    <div className="fixed inset-0 pointer-events-none z-20 overflow-hidden">
      {pieces.map((p) => (
        <motion.div key={p.id} initial={{ y: -20, opacity: 1, rotate: 0 }} animate={{ y: '100vh', opacity: [1, 1, 0], rotate: parseInt(p.rotate) }} transition={{ duration: parseFloat(p.duration), delay: parseFloat(p.delay), repeat: Infinity, ease: 'easeOut' }} style={{ position: 'absolute', left: p.left, width: p.size, height: p.size, backgroundColor: p.color, borderRadius: Math.random() > 0.5 ? '50%' : '2px' }} />
      ))}
    </div>
  );
}
