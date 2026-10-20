import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Pencil, FileText, Clock, Eye, EyeOff, Save, Shuffle,
  FileEdit, Timer, Calendar, BookOpen, Award, ListChecks, Link2, Copy,
  Check, ChevronLeft, GripVertical, Type, AlignRight, ShieldCheck, Globe,
  Building2, Monitor, PlayCircle, Library, Printer, CheckCircle2, AlertCircle,
  Layers, ArrowUp, ArrowDown, GitBranch, Loader2, Moon, Sun, MapPin,
  GraduationCap, Lock, Archive, Send, FileCheck, ClipboardList,
  Image as ImageIcon, ClipboardPaste,
} from 'lucide-react';
import type {
  OnlineExam, ExamQuestion, QuestionType, ExamType,
  ExamSection, QuestionBankItem, ExamVariant, ExamLifecycleStatus,
} from '@/lib/types';
import {
  fetchOnlineExamsByGradeLevel, createOnlineExam, updateOnlineExam,
  deleteOnlineExam, fetchExamQuestions, createExamQuestion, updateExamQuestion,
  deleteExamQuestion, reorderExamQuestions,
  fetchExamSections, createExamSection, updateExamSection, deleteExamSection,
  fetchQuestionBank, createQuestionBankItem,
  fetchExamVariants, createExamVariant, deleteExamVariant,
  updateExamLifecycle, fetchOnlineExamById,
} from '@/lib/data';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ExamTaker from '@/components/modules/ExamTaker';
import ExamPreview from '@/components/modules/ExamPreview';
import ExamPrintView from '@/components/modules/ExamPrintView';
import ExamQualityCheck from '@/components/modules/ExamQualityCheck';
import QuestionBank from '@/components/modules/QuestionBank';
import ExamImportTranscribe, { type TranscribedQuestion } from '@/components/modules/ExamImportTranscribe';
import {
  exportExamAsText, downloadText, exportExamAsPDF,
  exportExamAsImage, exportExamAsWord,
} from '@/lib/examExport';
import { useToast } from '@/components/ui/Toast';

// ============================================================
// TYPES & CONSTANTS
// ============================================================

type ExamBuilderProps = {
  gradeLevelId: string | null;
  groupId?: string;
  groupName?: string;
  stageName?: string;
  gradeName?: string;
  onNeedGrade?: () => void;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type ExamFormState = {
  title: string;
  subject: string;
  description: string;
  duration: string;
  secondsPerQuestion: string;
  totalScore: string;
  openAt: string;
  closeAt: string;
  isRandom: boolean;
  showResults: boolean;
  shuffleQuestions: boolean;
  shuffleChoices: boolean;
  examType: ExamType;
  country: string;
  educationSystem: string;
  language: string;
  academicYear: string;
  term: string;
};

const EMPTY_FORM: ExamFormState = {
  title: '', subject: '', description: '', duration: '',
  secondsPerQuestion: '', totalScore: '', openAt: '', closeAt: '',
  isRandom: false, showResults: true, shuffleQuestions: false,
  shuffleChoices: false, examType: 'online',
  country: '', educationSystem: '', language: 'ar', academicYear: '', term: '',
};

type DraftQuestion = {
  tempId: string;
  type: QuestionType;
  text: string;
  choices: string[];
  correct: number;
  modelAnswer: string;
  acceptedAnswers: string;
  points: string;
  timeSeconds: string;
  sectionId: string | null;
};

const QUESTION_TYPES: { value: QuestionType; label: string; icon: typeof Type }[] = [
  { value: 'mcq', label: 'اختيارات', icon: Type },
  { value: 'true_false', label: 'صح/خطأ', icon: Check },
  { value: 'fill_blank', label: 'أكمل الفراغ', icon: AlignRight },
  { value: 'short_answer', label: 'إجابة قصيرة', icon: AlignRight },
  { value: 'essay', label: 'مقالي', icon: AlignRight },
];

const LIFECYCLE_CONFIG: Record<ExamLifecycleStatus, { label: string; color: string; icon: typeof FileEdit }> = {
  draft:     { label: 'مسودة',    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',     icon: FileEdit },
  review:    { label: 'مراجعة',   color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',          icon: Eye },
  published: { label: 'منشور',    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: Send },
  active:    { label: 'نشط',      color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: PlayCircle },
  closed:    { label: 'مغلق',     color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',     icon: Lock },
  archived:  { label: 'مؤرشف',    color: 'text-slate-500 bg-slate-500/10 border-slate-500/20',     icon: Archive },
};

const LIFECYCLE_FLOW: ExamLifecycleStatus[] = ['draft', 'review', 'published', 'active', 'closed', 'archived'];

const COUNTRIES = [
  { value: '', label: '—' },
  { value: 'egypt', label: 'مصر' },
  { value: 'saudi', label: 'السعودية' },
  { value: 'uae', label: 'الإمارات' },
  { value: 'kuwait', label: 'الكويت' },
  { value: 'qatar', label: 'قطر' },
  { value: 'bahrain', label: 'البحرين' },
  { value: 'jordan', label: 'الأردن' },
  { value: 'other', label: 'أخرى' },
];

const inputCls =
  'w-full glass-light rounded-xl py-2.5 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm';

function toLocalDatetimeInput(isoUtc: string): string {
  const d = new Date(isoUtc);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

type BuilderMode = 'entry' | 'list' | 'track' | 'builder';

export default function ExamBuilder({
  gradeLevelId, groupId, groupName, stageName, gradeName, onNeedGrade,
}: ExamBuilderProps) {
  const [mode, setMode] = useState<BuilderMode>('entry');
  const [exams, setExams] = useState<OnlineExam[]>([]);
  const [selected, setSelected] = useState<OnlineExam | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [sections, setSections] = useState<ExamSection[]>([]);
  const [variants, setVariants] = useState<ExamVariant[]>([]);
  const [examForm, setExamForm] = useState<ExamFormState>(EMPTY_FORM);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [draftQuestions, setDraftQuestions] = useState<DraftQuestion[]>([]);
  const [editingQId, setEditingQId] = useState<string | null>(null);
  const [deleteExam, setDeleteExam] = useState<OnlineExam | null>(null);
  const [deleteQ, setDeleteQ] = useState<ExamQuestion | null>(null);
  const [copied, setCopied] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState(5);
  const [previewExamId, setPreviewExamId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [showAnswerKeyPrint, setShowAnswerKeyPrint] = useState(false);
  const [showQualityCheck, setShowQualityCheck] = useState(false);
  const [showQuestionBank, setShowQuestionBank] = useState(false);
  const [showTranscribe, setShowTranscribe] = useState(false);
  const [showSections, setShowSections] = useState(false);
  const [showVariants, setShowVariants] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [draggedQId, setDraggedQId] = useState<string | null>(null);
  const [editingLocked, setEditingLocked] = useState(false);
  const [activeSectionFilter, setActiveSectionFilter] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingQIds = useRef<Set<string>>(new Set());
  const { showToast } = useToast();

  const isLocked = useMemo(() => {
    if (!selected) return false;
    const status = (selected as OnlineExam & { lifecycle_status?: ExamLifecycleStatus }).lifecycle_status;
    return status === 'published' || status === 'active' || status === 'closed' || status === 'archived';
  }, [selected]);

  const loadExams = useCallback(async () => {
    if (!gradeLevelId) { setExams([]); return; }
    const data = await fetchOnlineExamsByGradeLevel(gradeLevelId);
    setExams(data);
  }, [gradeLevelId]);

  useEffect(() => { loadExams(); }, [loadExams]);

  // --- DRAFT RESUME: restore last active draft exam on mount ---
  const DRAFT_KEY = `exam_draft_${gradeLevelId ?? 'default'}`;
  useEffect(() => {
    if (!gradeLevelId) return;
    const savedId = localStorage.getItem(DRAFT_KEY);
    if (!savedId) return;
    let cancelled = false;
    (async () => {
      try {
        const ex = await fetchOnlineExamById(savedId);
        if (cancelled || !ex) { localStorage.removeItem(DRAFT_KEY); return; }
        const status = (ex as OnlineExam & { lifecycle_status?: ExamLifecycleStatus }).lifecycle_status;
        const isFinalized = status === 'published' || status === 'active' || status === 'closed' || status === 'archived';
        if (isFinalized) { localStorage.removeItem(DRAFT_KEY); return; }
        startEditExam(ex);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('Draft resume failed:', msg);
        localStorage.removeItem(DRAFT_KEY);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeLevelId]);

  const selectedId = selected?.id ?? null;
  const loadQuestions = useCallback(async () => {
    if (!selectedId) return;
    const [qData, sData] = await Promise.all([
      fetchExamQuestions(selectedId),
      fetchExamSections(selectedId),
    ]);
    setQuestions(qData);
    setSections(sData);
  }, [selectedId]);

  useEffect(() => { loadQuestions(); }, [loadQuestions]);

  const loadVariants = useCallback(async () => {
    if (!editingExamId) return;
    const data = await fetchExamVariants(editingExamId);
    setVariants(data);
  }, [editingExamId]);

  useEffect(() => { loadVariants(); }, [loadVariants]);

  // --- AUTO-SAVE ---
  const skipFirstAutoSave = useRef(true);
  const autoSave = useCallback(() => {
    if (!editingExamId || !examForm.title.trim()) return;
    if (isLocked && !editingLocked) return;
    if (skipFirstAutoSave.current) { skipFirstAutoSave.current = false; return; }
    setSaveStatus('saving');
    const payload: Partial<OnlineExam> = {
      title: examForm.title.trim(),
      subject: examForm.subject.trim() || null,
      description: examForm.description.trim() || null,
      duration_minutes: examForm.duration.trim() ? parseInt(examForm.duration) : null,
      seconds_per_question: examForm.secondsPerQuestion.trim() ? parseInt(examForm.secondsPerQuestion) : null,
      total_score: examForm.totalScore.trim() ? parseFloat(examForm.totalScore) : null,
      open_at: examForm.openAt ? new Date(examForm.openAt).toISOString() : null,
      close_at: examForm.closeAt ? new Date(examForm.closeAt).toISOString() : null,
      is_random: examForm.isRandom,
      show_results: examForm.showResults,
      shuffle_questions: examForm.shuffleQuestions,
      shuffle_choices: examForm.shuffleChoices,
      country: examForm.country || null,
      education_system: examForm.educationSystem || null,
      language: examForm.language,
      academic_year: examForm.academicYear || null,
      term: examForm.term || null,
    };
    updateOnlineExam(editingExamId, payload)
      .then(() => {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      })
      .catch(() => setSaveStatus('error'));
  }, [editingExamId, examForm, isLocked, editingLocked]);

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (mode === 'builder' && editingExamId && examForm.title.trim()) {
      saveTimerRef.current = setTimeout(() => autoSave(), 1500);
    }
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [examForm, mode, editingExamId, autoSave]);

  // --- ENTRY MODE ---
  function selectOnlinePath() {
    setExamForm({ ...EMPTY_FORM, examType: 'online' });
    setEditingExamId(null);
    setDraftQuestions([]);
    setSelected(null);
    setMode('builder');
    localStorage.removeItem(DRAFT_KEY);
  }

  function selectGroupPath() {
    if (!gradeLevelId) {
      if (onNeedGrade) onNeedGrade();
      return;
    }
    setMode('track');
  }

  // --- EXAM CRUD ---
  function startNewExam() {
    setExamForm(EMPTY_FORM);
    setEditingExamId(null);
    setDraftQuestions([]);
    setSelected(null);
    setMode('track');
    localStorage.removeItem(DRAFT_KEY);
  }

  function selectTrack(type: ExamType) {
    setExamForm((prev) => ({ ...prev, examType: type }));
    setMode('builder');
    skipFirstAutoSave.current = true;
  }

  function startEditExam(ex: OnlineExam) {
    const status = (ex as OnlineExam & { lifecycle_status?: ExamLifecycleStatus }).lifecycle_status;
    setExamForm({
      title: ex.title, subject: ex.subject ?? '', description: ex.description ?? '',
      duration: ex.duration_minutes != null ? String(ex.duration_minutes) : '',
      secondsPerQuestion: ex.seconds_per_question != null ? String(ex.seconds_per_question) : '',
      totalScore: ex.total_score != null ? String(ex.total_score) : '',
      openAt: ex.open_at ? toLocalDatetimeInput(ex.open_at) : '',
      closeAt: ex.close_at ? toLocalDatetimeInput(ex.close_at) : '',
      isRandom: ex.is_random ?? false, showResults: ex.show_results ?? true,
      shuffleQuestions: ex.shuffle_questions ?? false,
      shuffleChoices: ex.shuffle_choices ?? false,
      examType: ex.exam_type ?? 'online',
      country: (ex as OnlineExam & { country?: string }).country ?? '',
      educationSystem: (ex as OnlineExam & { education_system?: string }).education_system ?? '',
      language: (ex as OnlineExam & { language?: string }).language ?? 'ar',
      academicYear: (ex as OnlineExam & { academic_year?: string }).academic_year ?? '',
      term: (ex as OnlineExam & { term?: string }).term ?? '',
    });
    setEditingExamId(ex.id);
    setSelected(ex);
    setEditingLocked(false);
    setMode('builder');
    skipFirstAutoSave.current = true;
    const DRAFT_KEY = `exam_draft_${gradeLevelId ?? 'default'}`;
    localStorage.setItem(DRAFT_KEY, ex.id);
  }

  function saveExamAndContinue(): Promise<void> {
    if (!examForm.title.trim()) return Promise.resolve();
    const payload: Partial<OnlineExam> = {
      grade_level_id: gradeLevelId,
      group_id: null,
      title: examForm.title.trim(),
      subject: examForm.subject.trim() || null,
      description: examForm.description.trim() || null,
      duration_minutes: examForm.duration.trim() ? parseInt(examForm.duration) : null,
      seconds_per_question: examForm.secondsPerQuestion.trim() ? parseInt(examForm.secondsPerQuestion) : null,
      total_score: examForm.totalScore.trim() ? parseFloat(examForm.totalScore) : null,
      open_at: examForm.openAt ? new Date(examForm.openAt).toISOString() : null,
      close_at: examForm.closeAt ? new Date(examForm.closeAt).toISOString() : null,
      is_random: examForm.isRandom, show_results: examForm.showResults,
      shuffle_questions: examForm.shuffleQuestions, shuffle_choices: examForm.shuffleChoices,
      exam_type: examForm.examType, is_draft: true, is_published: false,
      country: examForm.country || null,
      education_system: examForm.educationSystem || null,
      language: examForm.language,
      academic_year: examForm.academicYear || null,
      term: examForm.term || null,
    };
    if (editingExamId) {
      return updateOnlineExam(editingExamId, payload)
        .then(() => {
          setSelected((prev) => prev ? { ...prev, ...payload } as OnlineExam : prev);
          setExams((prev) => prev.map((e) => e.id === editingExamId ? { ...e, ...payload } as OnlineExam : e));
        });
    } else {
      return createOnlineExam(payload).then((ex) => {
        if (ex) { setSelected(ex); setEditingExamId(ex.id); localStorage.setItem(DRAFT_KEY, ex.id); }
      });
    }
  }

  function validateQuestions(qs: ExamQuestion[]): string[] {
    const errors: string[] = [];
    qs.forEach((q, i) => {
      const num = i + 1;
      if (!q.question_text?.trim()) {
        errors.push(`السؤال ${num}: نص السؤال فارغ`);
        return;
      }
      if (q.type === 'mcq') {
        const choices = (q.choices ?? []).filter((c) => c?.trim());
        if (choices.length < 2) {
          errors.push(`السؤال ${num}: يحتاج لاختيارين على الأقل`);
        }
        if (q.correct_choice_index == null || q.correct_choice_index >= choices.length) {
          errors.push(`السؤال ${num}: لم يتم تحديد الإجابة الصحيحة`);
        }
        const seen = new Set<string>();
        for (const c of choices) {
          const lower = c.trim().toLowerCase();
          if (seen.has(lower)) {
            errors.push(`السؤال ${num}: يوجد اختيارات مكررة`);
            break;
          }
          seen.add(lower);
        }
      }
      if (q.type === 'true_false' && q.correct_choice_index == null) {
        errors.push(`السؤال ${num}: لم يتم تحديد الإجابة الصحيحة (صح/خطأ)`);
      }
      if ((q.type === 'essay' || q.type === 'fill_blank' || q.type === 'short_answer') && !q.model_answer?.trim()) {
        errors.push(`السؤال ${num}: الإجابة النموذجية فارغة`);
      }
      if (!q.points || q.points <= 0) {
        errors.push(`السؤال ${num}: الدرجة غير صحيحة`);
      }
    });
    return errors;
  }

  async function publishExam() {
    if (publishing) return;
    if (!editingExamId || !examForm.title.trim()) {
      showToast('يرجى إدخال عنوان الامتحان أولاً', 'error');
      return;
    }
    if (questions.length === 0) {
      showToast('لا يمكن نشر امتحان بدون أسئلة. أضف سؤالاً واحداً على الأقل.', 'error');
      return;
    }
    const validationErrors = validateQuestions(questions);
    if (validationErrors.length > 0) {
      showToast(`لا يمكن النشر — ${validationErrors.length} مشكلة: ${validationErrors.slice(0, 3).join('، ')}${validationErrors.length > 3 ? '...' : ''}`, 'error');
      return;
    }
    setPublishing(true);
    try {
      await saveExamAndContinue();
      await updateExamLifecycle(editingExamId, 'published');
      setExams((prev) => prev.map((e) => e.id === editingExamId ? {
        ...e, is_published: true, is_draft: false,
        ...( { lifecycle_status: 'published' } as Partial<OnlineExam>),
      } as OnlineExam : e));
      setSelected((prev) => prev ? { ...prev, is_published: true, is_draft: false, ...( { lifecycle_status: 'published' } as Partial<OnlineExam>) } as OnlineExam : prev);
      showToast('تم نشر الامتحان بنجاح', 'success');
      localStorage.removeItem(DRAFT_KEY);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`فشل نشر الامتحان: ${msg}`, 'error');
    } finally {
      setPublishing(false);
    }
  }

  async function changeLifecycle(status: ExamLifecycleStatus) {
    if (!editingExamId) return;
    try {
      await updateExamLifecycle(editingExamId, status);
      setSelected((prev) => prev ? { ...prev, ...( { lifecycle_status: status, is_published: status === 'published' || status === 'active', is_draft: status === 'draft' } as Partial<OnlineExam>) } as OnlineExam : prev);
      setExams((prev) => prev.map((e) => e.id === editingExamId ? { ...e, lifecycle_status: status, is_published: status === 'published' || status === 'active', is_draft: status === 'draft' } as OnlineExam : e));
      if (status !== 'draft') localStorage.removeItem(DRAFT_KEY);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`فشل تغيير حالة الامتحان: ${msg}`, 'error');
    }
  }

  function togglePublish(ex: OnlineExam) {
    const newPublished = !ex.is_published;
    setExams((prev) => prev.map((e) => e.id === ex.id ? { ...e, is_published: newPublished, is_draft: false } : e));
    setSelected((prev) => prev?.id === ex.id ? { ...prev, is_published: newPublished, is_draft: false } : prev);
    if (newPublished) localStorage.removeItem(DRAFT_KEY);
    updateOnlineExam(ex.id, { is_published: newPublished, is_draft: false }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`فشل تحديث حالة النشر: ${msg}`, 'error');
      setExams((prev) => prev.map((e) => e.id === ex.id ? { ...e, is_published: !newPublished, is_draft: false } : e));
      setSelected((prev) => prev?.id === ex.id ? { ...prev, is_published: !newPublished, is_draft: false } : prev);
    });
  }

  // --- QUESTION CRUD ---
  function addDraftQuestion() {
    const q: DraftQuestion = {
      tempId: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'mcq', text: '', choices: ['', '', '', ''], correct: 0,
      modelAnswer: '', acceptedAnswers: '', points: '1', timeSeconds: '',
      sectionId: activeSectionFilter,
    };
    setDraftQuestions((prev) => [...prev, q]);
  }

  function addBulkDraftQuestions(count: number) {
    const newQs: DraftQuestion[] = Array.from({ length: count }, (_, i) => ({
      tempId: `draft_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'mcq' as QuestionType, text: '', choices: ['', '', '', ''], correct: 0,
      modelAnswer: '', acceptedAnswers: '', points: '1', timeSeconds: '',
      sectionId: activeSectionFilter,
    }));
    setDraftQuestions((prev) => [...prev, ...newQs]);
    setBulkOpen(false);
  }

  function updateDraftQuestion(tempId: string, updates: Partial<DraftQuestion>) {
    setDraftQuestions((prev) => prev.map((q) => (q.tempId === tempId ? { ...q, ...updates } : q)));
  }

  function removeDraftQuestion(tempId: string) {
    setDraftQuestions((prev) => prev.filter((q) => q.tempId !== tempId));
  }

  function duplicateDraftQuestion(dq: DraftQuestion) {
    const copy: DraftQuestion = {
      ...dq,
      tempId: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text: dq.text, choices: [...dq.choices],
    };
    const idx = draftQuestions.findIndex((q) => q.tempId === dq.tempId);
    setDraftQuestions((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }

  function saveDraftQuestion(dq: DraftQuestion) {
    if (!dq.text.trim() || !editingExamId) return;
    if (savingQIds.current.has(dq.tempId)) return;
    savingQIds.current.add(dq.tempId);
    setDraftQuestions((prev) => prev.filter((q) => q.tempId !== dq.tempId));
    const payload: Partial<ExamQuestion> = {
      exam_id: editingExamId,
      section_id: dq.sectionId || null,
      type: dq.type,
      question_text: dq.text.trim(),
      choices: dq.type === 'mcq' ? dq.choices.filter((c) => c.trim()) : null,
      correct_choice_index: (dq.type === 'mcq' || dq.type === 'true_false') ? dq.correct : null,
      model_answer: (dq.type === 'essay' || dq.type === 'fill_blank' || dq.type === 'short_answer')
        ? dq.modelAnswer.trim() || null : null,
      accepted_answers: dq.acceptedAnswers.trim()
        ? dq.acceptedAnswers.split(',').map((s) => s.trim()).filter(Boolean) : null,
      points: parseFloat(dq.points) || 1,
      time_seconds: dq.timeSeconds.trim() ? parseInt(dq.timeSeconds) : null,
      sort_order: questions.length + draftQuestions.filter((q) => q !== dq).length,
    };
    createExamQuestion(payload).then(() => {
      savingQIds.current.delete(dq.tempId);
      loadQuestions();
    }).catch((err: unknown) => {
      savingQIds.current.delete(dq.tempId);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`فشل حفظ السؤال: ${msg}`, 'error');
      setDraftQuestions((prev) => [...prev, dq]);
    });
  }

  function saveExistingQuestion(q: ExamQuestion, updates: Partial<ExamQuestion>) {
    if (savingQIds.current.has(q.id)) return;
    savingQIds.current.add(q.id);
    setQuestions((prev) => prev.map((qq) => qq.id === q.id ? { ...qq, ...updates } as ExamQuestion : qq));
    setEditingQId(null);
    updateExamQuestion(q.id, updates).then(() => {
      savingQIds.current.delete(q.id);
      loadQuestions();
    }).catch((err: unknown) => {
      savingQIds.current.delete(q.id);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`فشل تحديث السؤال: ${msg}`, 'error');
      setQuestions((prev) => prev.map((qq) => qq.id === q.id ? q : qq));
    });
  }

  function duplicateExistingQuestion(q: ExamQuestion) {
    const dq: DraftQuestion = {
      tempId: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: q.type,
      text: q.question_text,
      choices: q.choices ?? ['', '', '', ''],
      correct: q.correct_choice_index ?? 0,
      modelAnswer: q.model_answer ?? '',
      acceptedAnswers: q.accepted_answers?.join(', ') ?? '',
      points: String(q.points),
      timeSeconds: q.time_seconds ? String(q.time_seconds) : '',
      sectionId: q.section_id,
    };
    setDraftQuestions((prev) => [...prev, dq]);
  }

  function copyLink(ex: OnlineExam) {
    const url = `${window.location.origin}/exam-portal?code=${ex.access_code ?? ''}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // --- DRAG & DROP REORDER ---
  function handleDragStart(qId: string) { setDraggedQId(qId); }
  function handleDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (draggedQId && draggedQId !== targetId) {
      setQuestions((prev) => {
        const dragged = prev.find((q) => q.id === draggedQId);
        const target = prev.find((q) => q.id === targetId);
        if (!dragged || !target) return prev;
        const draggedIdx = prev.indexOf(dragged);
        const targetIdx = prev.indexOf(target);
        const next = [...prev];
        next.splice(draggedIdx, 1);
        next.splice(targetIdx, 0, dragged);
        return next.map((q, i) => ({ ...q, sort_order: i }));
      });
    }
  }
  function handleDragEnd() {
    if (draggedQId && editingExamId) {
      reorderExamQuestions(editingExamId, questions.map((q) => q.id));
    }
    setDraggedQId(null);
  }

  function moveQuestion(qId: string, direction: 'up' | 'down') {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.id === qId);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next.map((q, i) => ({ ...q, sort_order: i }));
    });
    if (editingExamId) {
      setTimeout(() => reorderExamQuestions(editingExamId, questions.map((q) => q.id)), 100);
    }
  }

  // --- QUESTION BANK IMPORT ---
  function importFromBank(item: QuestionBankItem) {
    const dq: DraftQuestion = {
      tempId: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: item.type,
      text: item.question_text,
      choices: item.choices ?? (item.type === 'mcq' ? ['', '', '', ''] : []),
      correct: item.correct_choice_index ?? 0,
      modelAnswer: item.model_answer ?? '',
      acceptedAnswers: item.accepted_answers?.join(', ') ?? '',
      points: String(item.points),
      timeSeconds: '',
      sectionId: activeSectionFilter,
    };
    setDraftQuestions((prev) => [...prev, dq]);
    setShowQuestionBank(false);
  }

  // --- TRANSCRIBE IMPORT ---
  function importTranscribed(tqs: TranscribedQuestion[]) {
    const dqs: DraftQuestion[] = tqs.map((tq) => ({
      tempId: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: tq.type,
      text: tq.text,
      choices: tq.type === 'true_false' ? ['صح', 'خطأ'] : tq.choices,
      correct: tq.correct >= 0 ? tq.correct : 0,
      modelAnswer: '',
      acceptedAnswers: '',
      points: String(tq.marks || 1),
      timeSeconds: '',
      sectionId: activeSectionFilter,
    }));
    setDraftQuestions((prev) => [...prev, ...dqs]);
    setShowTranscribe(false);
    showToast(`تم استيراد ${dqs.length} سؤال`, 'success');
  }

  // --- SECTIONS ---
  async function addSection(title: string, instructions: string) {
    if (!editingExamId) return;
    const sec = await createExamSection(editingExamId, title, instructions || null, sections.length);
    if (sec) { setSections((prev) => [...prev, sec]); }
  }

  async function removeSection(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id));
    setQuestions((prev) => prev.map((q) => q.section_id === id ? { ...q, section_id: null } : q));
    try { await deleteExamSection(id); } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`فشل حذف القسم: ${msg}`, 'error');
      loadQuestions();
    }
  }

  // --- VARIANTS ---
  async function addVariant(label: string, randomizeQ: boolean, randomizeC: boolean) {
    if (!editingExamId) return;
    const qOrder = randomizeQ ? [...questions].sort(() => Math.random() - 0.5).map((q) => q.id) : null;
    const cOrder: Record<string, number[]> | null = randomizeC
      ? Object.fromEntries(questions.filter((q) => q.type === 'mcq' && q.choices).map((q) => {
          const indices = (q.choices ?? []).map((_, i) => i);
          return [q.id, indices.sort(() => Math.random() - 0.5)];
        }))
      : null;
    const v = await createExamVariant(editingExamId, label, qOrder, cOrder);
    if (v) setVariants((prev) => [...prev, v]);
  }

  async function removeVariant(id: string) {
    setVariants((prev) => prev.filter((v) => v.id !== id));
    try { await deleteExamVariant(id); } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`فشل حذف النسخة: ${msg}`, 'error');
      loadVariants();
    }
  }

  // --- COMPUTED ---
  const totalPoints = [...questions, ...draftQuestions].reduce((sum, q) => sum + (parseFloat(String(q.points)) || 0), 0);
  const currentLifecycle = (selected as OnlineExam & { lifecycle_status?: ExamLifecycleStatus })?.lifecycle_status ?? 'draft';

  const filteredQuestions = activeSectionFilter
    ? questions.filter((q) => q.section_id === activeSectionFilter)
    : questions;
  const filteredDrafts = activeSectionFilter
    ? draftQuestions.filter((q) => q.sectionId === activeSectionFilter)
    : draftQuestions;

  // ============ PREVIEW EXAM TAKER MODE ============
  if (previewExamId) {
    return (
      <ExamTaker
        examId={previewExamId}
        studentName="معاينة المعلم"
        onExit={() => setPreviewExamId(null)}
        previewMode
      />
    );
  }

  // ============ PRINT MODE ============
  if (showPrint || showAnswerKeyPrint) {
    return (
      <ExamPrintView
        exam={selected}
        questions={questions}
        sections={sections}
        onClose={() => { setShowPrint(false); setShowAnswerKeyPrint(false); }}
        answerKeyMode={showAnswerKeyPrint}
        stageName={stageName}
        gradeName={gradeName}
        groupName={groupName}
      />
    );
  }

  // ============ ENTRY MODE ============
  if (mode === 'entry') {
    return (
      <div className="space-y-4">
        <div className="glass-card rounded-2xl p-5 sm:p-8">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-white mb-2">منصة الامتحانات</h2>
            <p className="text-sm text-slate-400">اختر مسار الامتحانات للبدء</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <motion.button
              whileHover={{ scale: 1.02 }}
              onClick={selectOnlinePath}
              className="glass-light rounded-2xl p-6 text-center hover:border-sky-500/50 hover:bg-sky-500/5 border border-white/10 transition group"
            >
              <div className="mx-auto w-16 h-16 rounded-2xl bg-sky-500/15 flex items-center justify-center mb-4 group-hover:scale-110 transition">
                <Globe size={32} className="text-sky-400" />
              </div>
              <h4 className="text-lg font-bold text-white mb-1">منصة امتحانات الطلاب أونلاين</h4>
              <p className="text-xs text-slate-400 leading-relaxed">إنشاء ونشر امتحانات للطلاب أونلاين — لا يحتاج اختيار مجموعة.</p>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              onClick={selectGroupPath}
              className="glass-light rounded-2xl p-6 text-center hover:border-emerald-500/50 hover:bg-emerald-500/5 border border-white/10 transition group"
            >
              <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center mb-4 group-hover:scale-110 transition">
                <Building2 size={32} className="text-emerald-400" />
              </div>
              <h4 className="text-lg font-bold text-white mb-1">امتحانات المجموعات</h4>
              <p className="text-xs text-slate-400 leading-relaxed">امتحانات لطلاب المجموعات الحضورية — يتطلب اختيار المرحلة والصف.</p>
            </motion.button>
          </div>
          {exams.length > 0 && (
            <div className="text-center mt-6">
              <button
                onClick={() => setMode('list')}
                className="text-sm text-slate-400 hover:text-white transition flex items-center gap-1.5 mx-auto"
              >
                <FileText size={14} /> عرض الامتحانات الموجودة ({exams.length})
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============ TRACK SELECTION MODE ============
  if (mode === 'track') {
    return (
      <div className="space-y-4">
        <button onClick={() => setMode('entry')} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition">
          <ChevronLeft size={16} /> رجوع
        </button>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-5 sm:p-8">
          <div className="text-center mb-6">
            <h3 className="text-xl font-bold text-white mb-2">اختر نوع امتحان المجموعة</h3>
            <p className="text-sm text-slate-400">
              المرحلة: {stageName ?? '—'} • الصف: {gradeName ?? '—'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <button
              onClick={() => selectTrack('online')}
              className="glass-light rounded-2xl p-6 text-center hover:border-sky-500/50 hover:bg-sky-500/5 border border-white/10 transition group"
            >
              <div className="mx-auto w-16 h-16 rounded-2xl bg-sky-500/15 flex items-center justify-center mb-4 group-hover:scale-110 transition">
                <Globe size={32} className="text-sky-400" />
              </div>
              <h4 className="text-lg font-bold text-white mb-1">امتحان أونلاين</h4>
              <p className="text-xs text-slate-400">لطلاب الأونلاين في هذا الصف.</p>
            </button>
            <button
              onClick={() => selectTrack('center')}
              className="glass-light rounded-2xl p-6 text-center hover:border-emerald-500/50 hover:bg-emerald-500/5 border border-white/10 transition group"
            >
              <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/15 flex items-center justify-center mb-4 group-hover:scale-110 transition">
                <Building2 size={32} className="text-emerald-400" />
              </div>
              <h4 className="text-lg font-bold text-white mb-1">امتحان سنتر</h4>
              <p className="text-xs text-slate-400">لطلاب المجموعات الحضورية — يغطى جميع مجموعات الصف.</p>
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ============ BUILDER MODE ============
  if (mode === 'builder') {
    return (
      <div className="space-y-4">
        {/* Top bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button
            onClick={() => { setMode(gradeLevelId ? 'list' : 'entry'); setDraftQuestions([]); setEditingQId(null); }}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition"
          >
            <ChevronLeft size={16} /> رجوع
          </button>
          {/* Auto-save indicator */}
          {editingExamId && (
            <div className="flex items-center gap-2 text-xs">
              {saveStatus === 'saving' && <span className="flex items-center gap-1 text-amber-400"><Loader2 size={12} className="animate-spin" /> جاري الحفظ...</span>}
              {saveStatus === 'saved' && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 size={12} /> تم الحفظ</span>}
              {saveStatus === 'error' && <span className="flex items-center gap-1 text-red-400"><AlertCircle size={12} /> خطأ في الحفظ</span>}
            </div>
          )}
        </div>

        {/* Lifecycle badge + lock warning */}
        {editingExamId && selected && (
          <div className="flex items-center gap-2 flex-wrap">
            <LifecycleBadge status={currentLifecycle} />
            {isLocked && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg flex items-center gap-1">
                  <Lock size={10} /> الامتحان {LIFECYCLE_CONFIG[currentLifecycle].label} — محمي من التعديل
                </span>
                {!editingLocked ? (
                  <button
                    onClick={() => setEditingLocked(true)}
                    className="text-[10px] text-slate-400 hover:text-amber-400 transition flex items-center gap-1"
                  >
                    <Pencil size={10} /> تعديل بأمان
                  </button>
                ) : (
                  <button
                    onClick={() => setEditingLocked(false)}
                    className="text-[10px] text-slate-400 hover:text-emerald-400 transition flex items-center gap-1"
                  >
                    <Lock size={10} /> قفل التعديل
                  </button>
                )}
              </div>
            )}
            {/* Lifecycle transitions */}
            <div className="flex gap-1 mr-auto">
              {LIFECYCLE_FLOW.filter((s) => s !== currentLifecycle).map((s) => (
                <button
                  key={s}
                  onClick={() => changeLifecycle(s)}
                  className="text-[10px] px-2 py-1 rounded-lg glass-light text-slate-400 hover:text-white transition"
                >
                  {LIFECYCLE_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Exam Settings */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4 sm:p-6 space-y-5">
          <div className="flex items-center gap-2 text-emerald-400 mb-1">
            <span className="w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center text-sm font-bold">1</span>
            <h3 className="font-bold text-white">إعدادات الامتحان</h3>
            <span className={`mr-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${examForm.examType === 'online' ? 'bg-sky-500/15 text-sky-300 border border-sky-500/20' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'}`}>
              {examForm.examType === 'online' ? <><Globe size={12} /> أونلاين</> : <><Building2 size={12} /> سنتر — {gradeName ?? ''}</>}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="عنوان الامتحان" icon={<FileEdit size={14} />}>
              <input type="text" value={examForm.title} onChange={(e) => setExamForm({ ...examForm, title: e.target.value })} className={inputCls} placeholder="مثال: امتحان الفيزياء الشامل" />
            </Field>
            <Field label="المادة" icon={<BookOpen size={14} />}>
              <input type="text" value={examForm.subject} onChange={(e) => setExamForm({ ...examForm, subject: e.target.value })} className={inputCls} placeholder="مثال: فيزياء" />
            </Field>
          </div>

          {/* Multi-country / Education system fields */}
          <div className="glass-light rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-300 mb-1">
              <MapPin size={16} className="text-sky-400" /> الإعدادات الدولية
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="الدولة">
                <select value={examForm.country} onChange={(e) => setExamForm({ ...examForm, country: e.target.value })} className={inputCls}>
                  {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="نظام التعليم">
                <input type="text" value={examForm.educationSystem} onChange={(e) => setExamForm({ ...examForm, educationSystem: e.target.value })} className={inputCls} placeholder="مثال: عام" />
              </Field>
              <Field label="العام الدراسي">
                <input type="text" value={examForm.academicYear} onChange={(e) => setExamForm({ ...examForm, academicYear: e.target.value })} className={inputCls} placeholder="مثال: 2026-2027" />
              </Field>
              <Field label="الترم">
                <select value={examForm.term} onChange={(e) => setExamForm({ ...examForm, term: e.target.value })} className={inputCls}>
                  <option value="">—</option>
                  <option value="first">الأول</option>
                  <option value="second">الثاني</option>
                </select>
              </Field>
            </div>
          </div>

          {gradeLevelId && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="المرحلة"><input type="text" value={stageName ?? '—'} disabled className={`${inputCls} opacity-60`} /></Field>
              <Field label="الصف"><input type="text" value={gradeName ?? '—'} disabled className={`${inputCls} opacity-60`} /></Field>
            </div>
          )}

          <Field label="تعليمات ووصف الامتحان">
            <textarea value={examForm.description} onChange={(e) => setExamForm({ ...examForm, description: e.target.value })} rows={2} className={`${inputCls} resize-none`} placeholder="اكتب تعليمات الامتحان للطلاب..." />
          </Field>

          <div className="glass-light rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-300 mb-1">
              <Timer size={16} className="text-amber-400" /> محدد وقت الامتحان
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="المدة (دقائق)" icon={<Clock size={14} />}>
                <input type="number" value={examForm.duration} onChange={(e) => setExamForm({ ...examForm, duration: e.target.value })} className={inputCls} min={1} />
              </Field>
              <Field label="ثانية لكل سؤال" icon={<Timer size={14} />}>
                <input type="number" value={examForm.secondsPerQuestion} onChange={(e) => setExamForm({ ...examForm, secondsPerQuestion: e.target.value })} className={inputCls} min={5} />
              </Field>
              <Field label="الدرجة الكلية" icon={<Award size={14} />}>
                <input type="number" value={examForm.totalScore} onChange={(e) => setExamForm({ ...examForm, totalScore: e.target.value })} className={inputCls} min={1} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="توقيت بدء الامتحان" icon={<Calendar size={14} />}>
                <input type="datetime-local" value={examForm.openAt} onChange={(e) => setExamForm({ ...examForm, openAt: e.target.value })} className={inputCls} />
              </Field>
              <Field label="توقيت انتهاء الامتحان" icon={<Calendar size={14} />}>
                <input type="datetime-local" value={examForm.closeAt} onChange={(e) => setExamForm({ ...examForm, closeAt: e.target.value })} className={inputCls} />
              </Field>
            </div>
          </div>

          <div className="glass-light rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-300 mb-1">
              <ShieldCheck size={16} className="text-emerald-400" /> إعدادات الأمان والنتائج
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ToggleButton active={examForm.shuffleQuestions} onClick={() => setExamForm({ ...examForm, shuffleQuestions: !examForm.shuffleQuestions })} icon={<Shuffle size={15} />}>خلط الأسئلة</ToggleButton>
              <ToggleButton active={examForm.shuffleChoices} onClick={() => setExamForm({ ...examForm, shuffleChoices: !examForm.shuffleChoices })} icon={<Shuffle size={15} />}>خلط الاختيارات</ToggleButton>
              <ToggleButton active={examForm.showResults} onClick={() => setExamForm({ ...examForm, showResults: !examForm.showResults })} icon={examForm.showResults ? <Eye size={15} /> : <EyeOff size={15} />}>{examForm.showResults ? 'إظهار النتائج' : 'إخفاء النتائج'}</ToggleButton>
            </div>
          </div>

          {!editingExamId && (
            <Button onClick={saveExamAndContinue} disabled={!examForm.title.trim()} className="w-full">
              <Save size={16} /> حفظ الإعدادات والمتابعة
            </Button>
          )}

          {editingExamId && selected?.access_code && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-light rounded-xl p-4 space-y-3 border border-emerald-500/20">
              <div className="flex items-center gap-2 text-sm text-emerald-400 font-bold">
                <Link2 size={16} /> رابط وكود الامتحان
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-400">كود الدخول:</span>
                <code className="px-3 py-1.5 bg-emerald-500/10 text-emerald-300 font-mono font-bold rounded-lg text-lg tracking-wider">{selected.access_code}</code>
                <button onClick={() => copyLink(selected)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light text-sm text-slate-300 hover:text-emerald-400 transition">
                  {copied ? <><Check size={14} /> تم النسخ</> : <><Copy size={14} /> نسخ الرابط</>}
                </button>
              </div>
              <div className="mt-2 glass-light rounded-lg p-3 border border-emerald-500/10">
                <p className="text-xs text-slate-400 mb-1">رابط المشاركة المباشر للطالب:</p>
                <code className="text-xs text-emerald-300 bg-emerald-500/5 px-2 py-1 rounded font-mono break-all block">{window.location.origin}/exam-portal?code={selected.access_code}</code>
              </div>
            </motion.div>
          )}
        </motion.div>

        {/* Step 2: Sections (optional) */}
        {editingExamId && (
          <SectionManager
            sections={sections}
            activeSectionFilter={activeSectionFilter}
            onFilter={setActiveSectionFilter}
            onAdd={addSection}
            onRemove={removeSection}
            show={showSections}
            onToggle={() => setShowSections(!showSections)}
          />
        )}

        {/* Step 3: Questions */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-emerald-400">
              <span className="w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center text-sm font-bold">{showSections ? '3' : '2'}</span>
              <h3 className="font-bold text-white">أسئلة الامتحان</h3>
              <span className="text-xs text-slate-400 mr-2">({questions.length + draftQuestions.length} سؤال • {totalPoints} درجة)</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" onClick={() => setShowTranscribe(true)}>
                <ClipboardPaste size={14} /> تفريغ أسئلة
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowQuestionBank(true)}>
                <Library size={14} /> بنك الأسئلة
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowVariants(!showVariants)}>
                <GitBranch size={14} /> النسخ
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setShowQualityCheck(!showQualityCheck)}>
                <FileCheck size={14} /> فحص الجودة
              </Button>
            </div>
          </div>

          {/* Quality check panel */}
          {showQualityCheck && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
              <ExamQualityCheck exam={selected} questions={questions} />
            </motion.div>
          )}

          {/* Variants panel */}
          {showVariants && (
            <VariantManager
              variants={variants}
              onAdd={addVariant}
              onRemove={removeVariant}
              questionCount={questions.length}
            />
          )}

          {/* Questions list */}
          {filteredQuestions.length === 0 && filteredDrafts.length === 0 && (
            <div className="glass-light rounded-xl p-8 text-center text-slate-400">
              لا توجد أسئلة بعد. اضغط «إضافة سؤال» للبدء، أو استورد من بنك الأسئلة.
            </div>
          )}

          <div className="space-y-3">
            <AnimatePresence>
              {filteredQuestions.map((q, i) => (
                <QuestionCard
                  key={q.id}
                  index={questions.indexOf(q)}
                  question={q}
                  sectionTitle={sections.find((s) => s.id === q.section_id)?.title}
                  isEditing={editingQId === q.id}
                  canEdit={!isLocked || editingLocked}
                  onEdit={() => setEditingQId(q.id)}
                  onCancelEdit={() => setEditingQId(null)}
                  onSave={(updates) => saveExistingQuestion(q, updates)}
                  onDelete={() => setDeleteQ(q)}
                  onDuplicate={() => duplicateExistingQuestion(q)}
                  onMoveUp={() => moveQuestion(q.id, 'up')}
                  onMoveDown={() => moveQuestion(q.id, 'down')}
                  onDragStart={() => handleDragStart(q.id)}
                  onDragOver={(e) => handleDragOver(e, q.id)}
                  onDragEnd={handleDragEnd}
                  isDragging={draggedQId === q.id}
                />
              ))}
              {filteredDrafts.map((dq) => (
                <DraftQuestionCard
                  key={dq.tempId}
                  index={questions.length + draftQuestions.indexOf(dq)}
                  question={dq}
                  sections={sections}
                  onUpdate={(updates) => updateDraftQuestion(dq.tempId, updates)}
                  onSave={() => saveDraftQuestion(dq)}
                  onRemove={() => removeDraftQuestion(dq.tempId)}
                  onDuplicate={() => duplicateDraftQuestion(dq)}
                />
              ))}
            </AnimatePresence>
          </div>

          {/* Add question buttons */}
          <div className="flex gap-2 justify-center pt-3 flex-wrap">
            <Button size="sm" variant="secondary" onClick={() => setBulkOpen(true)}>
              <ListChecks size={16} /> إضافة دفعة
            </Button>
            <Button size="sm" onClick={addDraftQuestion} disabled={!editingExamId}>
              <Plus size={16} /> إضافة سؤال
            </Button>
          </div>

          {/* Preview + Print + Publish */}
          {editingExamId && (
            <div className="flex gap-3 justify-end pt-3 border-t border-white/10 flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => setShowPreview(true)} disabled={questions.length === 0}>
                <Monitor size={14} /> معاينة
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowPrint(true)} disabled={questions.length === 0}>
                <Printer size={14} /> طباعة
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowAnswerKeyPrint(true)} disabled={questions.length === 0}>
                <Printer size={14} /> مفتاح الإجابات
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPreviewExamId(editingExamId)} disabled={questions.length === 0}>
                <PlayCircle size={14} /> تجربة كطالب
              </Button>
              <Button variant="primary" size="sm" onClick={publishExam} disabled={publishing || !examForm.title.trim() || questions.length === 0}>
                {publishing ? <><Loader2 size={14} className="animate-spin" /> جارٍ النشر...</> : <><Send size={14} /> نشر</>}
              </Button>
            </div>
          )}

          {editingExamId && questions.length > 0 && (
            <div className="flex gap-2 justify-center pt-3 border-t border-white/10 flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => {
                try { downloadText(selected?.title ?? 'exam', exportExamAsText(selected!, questions, sections, false)); }
                catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  showToast(`فشل تصدير النص: ${msg}`, 'error');
                }
              }}>
                <FileText size={14} /> نص
              </Button>
              <Button variant="ghost" size="sm" disabled={exporting === 'pdf'} onClick={() => {
                setExporting('pdf');
                try { exportExamAsPDF(selected!, questions, sections, false); }
                catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  showToast(`فشل تصدير PDF: ${msg}`, 'error');
                }
                finally { setExporting(null); }
              }}>
                {exporting === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} PDF
              </Button>
              <Button variant="ghost" size="sm" disabled={exporting === 'image'} onClick={async () => {
                setExporting('image');
                try { await exportExamAsImage(selected!, questions, sections, false); }
                catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  showToast(`فشل تصدير الصورة: ${msg}`, 'error');
                }
                finally { setExporting(null); }
              }}>
                {exporting === 'image' ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />} صورة
              </Button>
              <Button variant="ghost" size="sm" disabled={exporting === 'word'} onClick={() => {
                setExporting('word');
                try { exportExamAsWord(selected!, questions, sections, false); }
                catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  showToast(`فشل تصدير Word: ${msg}`, 'error');
                }
                finally { setExporting(null); }
              }}>
                {exporting === 'word' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Word
              </Button>
            </div>
          )}
        </motion.div>

      <ExamImportTranscribe
        open={showTranscribe}
        onClose={() => setShowTranscribe(false)}
        onImport={importTranscribed}
        examTitle={examForm.title}
        subject={examForm.subject}
        gradeName={gradeName}
      />
      </div>
    );
  }

  // ============ LIST MODE ============
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <button onClick={() => setMode('entry')} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition">
          <ChevronLeft size={16} /> رجوع للاختيار
        </button>
        <div className="flex gap-2 flex-wrap">
          {exams.map((ex) => {
            const status = (ex as OnlineExam & { lifecycle_status?: ExamLifecycleStatus }).lifecycle_status ?? 'draft';
            return (
              <button
                key={ex.id}
                onClick={() => setSelected(ex)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${selected?.id === ex.id ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400 hover:text-white'}`}
              >
                <FileText size={14} />
                {ex.title}
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${LIFECYCLE_CONFIG[status].color}`}>
                  {LIFECYCLE_CONFIG[status].label}
                </span>
              </button>
            );
          })}
          {exams.length === 0 && <p className="text-slate-400 text-sm py-2">لا توجد امتحانات بعد.</p>}
        </div>
        <Button size="sm" onClick={startNewExam}>
          <Plus size={16} /> إنشاء امتحان جديد
        </Button>
      </div>

      {selected && (
        <div className="glass-card rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4 text-sm text-slate-300 flex-wrap">
              <span className="flex items-center gap-1.5"><Clock size={14} className="text-emerald-400" /> {selected.duration_minutes ?? '—'} دقيقة</span>
              <span className="flex items-center gap-1.5"><ListChecks size={14} className="text-blue-400" /> {questions.length} سؤال</span>
              <span className="flex items-center gap-1.5"><Award size={14} className="text-teal-400" /> {selected.total_score ?? '—'} درجة</span>
              {selected.subject && <span className="flex items-center gap-1.5"><BookOpen size={14} className="text-sky-400" /> {selected.subject}</span>}
              <span className={`flex items-center gap-1 ${selected.exam_type === 'center' ? 'text-emerald-400' : 'text-sky-400'}`}>
                {selected.exam_type === 'center' ? <><Building2 size={12} /> سنتر</> : <><Globe size={12} /> أونلاين</>}
              </span>
              <LifecycleBadge status={(selected as OnlineExam & { lifecycle_status?: ExamLifecycleStatus }).lifecycle_status ?? 'draft'} />
              {selected.access_code && <span className="flex items-center gap-1 text-emerald-300 font-mono"><Link2 size={12} /> {selected.access_code}</span>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" onClick={() => setPreviewExamId(selected.id)} disabled={questions.length === 0}>
                <PlayCircle size={14} /> معاينة
              </Button>
              <Button size="sm" variant="secondary" onClick={() => startEditExam(selected)}>
                <Pencil size={14} /> تعديل
              </Button>
              <Button size="sm" variant={selected.is_published ? 'warning' : 'primary'} onClick={() => togglePublish(selected)}>
                {selected.is_published ? <><EyeOff size={14} /> إلغاء النشر</> : <><Eye size={14} /> نشر</>}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-400 hover:bg-red-500/10" onClick={() => setDeleteExam(selected)}>
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          {selected.description && <p className="text-sm text-slate-400 mt-2">{selected.description}</p>}
        </div>
      )}

      {/* Modals & overlays */}
      <ExamPreview
        open={showPreview}
        onClose={() => setShowPreview(false)}
        exam={selected}
        questions={questions}
        sections={sections}
      />

      <QuestionBank
        open={showQuestionBank}
        onClose={() => setShowQuestionBank(false)}
        gradeLevelId={gradeLevelId ?? undefined}
        onUseQuestion={importFromBank}
      />

      <ExamImportTranscribe
        open={showTranscribe}
        onClose={() => setShowTranscribe(false)}
        onImport={importTranscribed}
        examTitle={examForm.title}
        subject={examForm.subject}
        gradeName={gradeName}
      />

      <ConfirmDialog
        open={!!deleteExam}
        onClose={() => setDeleteExam(null)}
        onConfirm={() => { if (deleteExam) { const target = deleteExam; setExams((prev) => prev.filter((e) => e.id !== target.id)); setSelected(null); setDeleteExam(null); localStorage.removeItem(DRAFT_KEY); deleteOnlineExam(target.id).then(() => loadExams()).catch((err: unknown) => { const msg = err instanceof Error ? err.message : String(err); showToast(`فشل حذف الامتحان: ${msg}`, 'error'); setExams((prev) => [...prev, target]); }); } }}
        title="⚠️ حذف الامتحان"
        subtext={`سيتم حذف «${deleteExam?.title ?? ''}» وكل أسئلته نهائيًا.`}
        confirmLabel="تأكيد الحذف"
      />
      <ConfirmDialog
        open={!!deleteQ}
        onClose={() => setDeleteQ(null)}
        onConfirm={() => { if (deleteQ) { const target = deleteQ; setQuestions((prev) => prev.filter((q) => q.id !== target.id)); setDeleteQ(null); deleteExamQuestion(target.id).then(() => loadQuestions()).catch((err: unknown) => { const msg = err instanceof Error ? err.message : String(err); showToast(`فشل حذف السؤال: ${msg}`, 'error'); setQuestions((prev) => [...prev, target]); }); } }}
        title="⚠️ حذف السؤال"
        subtext="سيتم حذف هذا السؤال نهائيًا."
        confirmLabel="تأكيد الحذف"
      />

      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} size="sm">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4"><ListChecks className="text-emerald-400" size={32} /></div>
          <h3 className="text-xl font-bold text-white mb-2">إضافة دفعة أسئلة</h3>
          <p className="text-slate-400 text-sm mb-4">حدد عدد الأسئلة التي تريد إضافتها دفعة واحدة.</p>
          <div className="flex items-center justify-center gap-3 mb-4">
            <button onClick={() => setBulkCount((c) => Math.max(1, c - 1))} className="w-10 h-10 rounded-xl glass-light text-white hover:bg-white/10 transition text-lg font-bold">−</button>
            <span className="text-3xl font-black text-emerald-400 min-w-[60px] text-center">{bulkCount}</span>
            <button onClick={() => setBulkCount((c) => Math.min(50, c + 1))} className="w-10 h-10 rounded-xl glass-light text-white hover:bg-white/10 transition text-lg font-bold">+</button>
          </div>
          <div className="flex gap-3 justify-center">
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>إلغاء</Button>
            <Button onClick={() => addBulkDraftQuestions(bulkCount)} disabled={bulkCount < 1}>
              <Plus size={16} /> إضافة {bulkCount} سؤال
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function QuestionCard({
  index, question, sectionTitle, isEditing, canEdit,
  onEdit, onCancelEdit, onSave, onDelete, onDuplicate,
  onMoveUp, onMoveDown, onDragStart, onDragOver, onDragEnd, isDragging,
}: {
  index: number;
  question: ExamQuestion;
  sectionTitle?: string;
  isEditing: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (updates: Partial<ExamQuestion>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const [text, setText] = useState(question.question_text);
  const [choices, setChoices] = useState(question.choices ?? ['', '', '', '']);
  const [correct, setCorrect] = useState(question.correct_choice_index ?? 0);
  const [modelAnswer, setModelAnswer] = useState(question.model_answer ?? '');
  const [acceptedAnswers, setAcceptedAnswers] = useState(question.accepted_answers?.join(', ') ?? '');
  const [points, setPoints] = useState(String(question.points));
  const [timeSeconds, setTimeSeconds] = useState(question.time_seconds ? String(question.time_seconds) : '');

  if (isEditing) {
    return (
      <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-card rounded-xl p-5 shadow-lg">
        <QuestionEditor
          type={question.type} text={text} choices={choices} correct={correct}
          modelAnswer={modelAnswer} acceptedAnswers={acceptedAnswers}
          points={points} timeSeconds={timeSeconds}
          onTextChange={setText} onChoicesChange={setChoices} onCorrectChange={setCorrect}
          onModelAnswerChange={setModelAnswer} onAcceptedAnswersChange={setAcceptedAnswers}
          onPointsChange={setPoints} onTimeSecondsChange={setTimeSeconds}
        />
        <div className="flex gap-2 justify-end mt-3">
          <Button size="sm" variant="secondary" onClick={onCancelEdit}>إلغاء</Button>
          <Button size="sm" onClick={() => onSave({
            question_text: text.trim(),
            choices: question.type === 'mcq' ? choices.filter((c) => c.trim()) : null,
            correct_choice_index: (question.type === 'mcq' || question.type === 'true_false') ? correct : null,
            model_answer: (question.type === 'essay' || question.type === 'fill_blank' || question.type === 'short_answer') ? modelAnswer.trim() || null : null,
            accepted_answers: acceptedAnswers.trim() ? acceptedAnswers.split(',').map((s) => s.trim()).filter(Boolean) : null,
            points: parseFloat(points) || 1,
            time_seconds: timeSeconds.trim() ? parseInt(timeSeconds) : null,
          })}>حفظ</Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: isDragging ? 0.5 : 1, y: 0 }}
      exit={{ opacity: 0 }}
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className="glass-card rounded-xl p-4 shadow-lg cursor-default"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {canEdit && <GripVertical size={14} className="text-slate-600 cursor-grab" />}
            <span className="flex items-center gap-1 text-xs font-bold w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-400 justify-center">{index + 1}</span>
            <TypeBadge type={question.type} />
            <span className="text-xs text-slate-500">{question.points} درجة</span>
            {question.time_seconds && <span className="text-xs text-amber-500/80">{question.time_seconds} ث</span>}
            {sectionTitle && <span className="text-[10px] text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full">{sectionTitle}</span>}
          </div>
          <p className="text-white font-semibold mb-2 leading-relaxed">{question.question_text}</p>
          {question.type === 'mcq' && question.choices && (
            <ul className="space-y-1.5 text-sm">
              {question.choices.map((c, ci) => (
                <li key={ci} className={`flex items-center gap-2 ${ci === question.correct_choice_index ? 'text-emerald-400' : 'text-slate-400'}`}>
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs border ${ci === question.correct_choice_index ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-600'}`}>
                    {['أ', 'ب', 'ج', 'د'][ci] ?? ci}
                  </span>
                  {c}
                  {ci === question.correct_choice_index && <Check size={12} className="text-emerald-400" />}
                </li>
              ))}
            </ul>
          )}
          {question.type === 'true_false' && (
            <p className="text-sm text-slate-400">
              الإجابة الصحيحة: <span className="font-bold text-emerald-400">{question.correct_choice_index === 0 ? 'صح' : 'خطأ'}</span>
            </p>
          )}
          {(question.type === 'fill_blank' || question.type === 'short_answer' || question.type === 'essay') && question.model_answer && (
            <div className="mt-2 text-sm">
              <p className="text-xs text-amber-400 mb-1">الإجابة النموذجية:</p>
              <p className="text-slate-300 glass-light rounded-lg p-2">{question.model_answer}</p>
              {question.accepted_answers && question.accepted_answers.length > 0 && (
                <p className="text-[10px] text-slate-500 mt-1">مقبول أيضاً: {question.accepted_answers.join('، ')}</p>
              )}
            </div>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-1 flex-shrink-0 flex-col">
            <div className="flex gap-0.5">
              <button onClick={onMoveUp} className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-white transition"><ArrowUp size={12} /></button>
              <button onClick={onMoveDown} className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-white transition"><ArrowDown size={12} /></button>
            </div>
            <div className="flex gap-0.5">
              <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-emerald-400 transition"><Pencil size={14} /></button>
              <button onClick={onDuplicate} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-sky-400 transition" title="نسخ"><Copy size={14} /></button>
              <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition"><Trash2 size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function DraftQuestionCard({
  index, question, sections, onUpdate, onSave, onRemove, onDuplicate,
}: {
  index: number;
  question: DraftQuestion;
  sections: ExamSection[];
  onUpdate: (updates: Partial<DraftQuestion>) => void;
  onSave: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass-card rounded-xl p-5 shadow-lg border border-emerald-500/20">
      <div className="flex items-center gap-2 mb-3">
        <span className="flex items-center gap-1 text-xs font-bold w-7 h-7 rounded-full bg-amber-500/15 text-amber-400 justify-center">{index + 1}</span>
        <span className="text-xs text-slate-500">سؤال جديد</span>
        {sections.length > 0 && (
          <select
            value={question.sectionId ?? ''}
            onChange={(e) => onUpdate({ sectionId: e.target.value || null })}
            className="mr-auto glass-light rounded-lg px-2 py-1 text-[10px] text-white border border-slate-700/50 focus:outline-none"
          >
            <option value="">بدون قسم</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        )}
      </div>
      <QuestionEditor
        type={question.type}
        text={question.text}
        choices={question.choices}
        correct={question.correct}
        modelAnswer={question.modelAnswer}
        acceptedAnswers={question.acceptedAnswers}
        points={question.points}
        timeSeconds={question.timeSeconds}
        onTextChange={(v) => onUpdate({ text: v })}
        onChoicesChange={(v) => onUpdate({ choices: v })}
        onCorrectChange={(v) => onUpdate({ correct: v })}
        onModelAnswerChange={(v) => onUpdate({ modelAnswer: v })}
        onAcceptedAnswersChange={(v) => onUpdate({ acceptedAnswers: v })}
        onPointsChange={(v) => onUpdate({ points: v })}
        onTimeSecondsChange={(v) => onUpdate({ timeSeconds: v })}
        onTypeChange={(t) => onUpdate({ type: t })}
      />
      <div className="flex gap-2 justify-end mt-3">
        <Button size="sm" variant="ghost" onClick={onDuplicate} title="نسخ"><Copy size={14} /></Button>
        <Button size="sm" variant="ghost" className="text-red-400" onClick={onRemove}><Trash2 size={14} /> حذف</Button>
        <Button size="sm" onClick={onSave} disabled={!question.text.trim()}><Save size={14} /> حفظ</Button>
      </div>
    </motion.div>
  );
}

function QuestionEditor({
  type, text, choices, correct, modelAnswer, acceptedAnswers, points, timeSeconds,
  onTextChange, onChoicesChange, onCorrectChange, onModelAnswerChange,
  onAcceptedAnswersChange, onPointsChange, onTimeSecondsChange, onTypeChange,
}: {
  type: QuestionType;
  text: string;
  choices: string[];
  correct: number;
  modelAnswer: string;
  acceptedAnswers: string;
  points: string;
  timeSeconds: string;
  onTextChange: (v: string) => void;
  onChoicesChange: (v: string[]) => void;
  onCorrectChange: (v: number) => void;
  onModelAnswerChange: (v: string) => void;
  onAcceptedAnswersChange: (v: string) => void;
  onPointsChange: (v: string) => void;
  onTimeSecondsChange: (v: string) => void;
  onTypeChange?: (v: QuestionType) => void;
}) {
  return (
    <div className="space-y-3">
      {onTypeChange && (
        <div className="flex gap-1.5 flex-wrap">
          {QUESTION_TYPES.map((qt) => {
            const Icon = qt.icon;
            return (
              <button
                key={qt.value}
                type="button"
                onClick={() => {
                  onTypeChange(qt.value);
                  if (qt.value === 'true_false') onChoicesChange(['صح', 'خطأ']);
                  if (qt.value !== 'mcq' && qt.value !== 'true_false') onChoicesChange([]);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${type === qt.value ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'glass-light text-slate-400'}`}
              >
                <Icon size={12} /> {qt.label}
              </button>
            );
          })}
        </div>
      )}
      <div>
        <label className="block text-sm text-slate-400 mb-1.5">نص السؤال</label>
        <textarea value={text} onChange={(e) => onTextChange(e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder="اكتب السؤال هنا..." />
      </div>

      {type === 'mcq' && (
        <div>
          <label className="block text-sm text-slate-400 mb-1.5">الاختيارات (اضغط على الحرف للصحيح)</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {choices.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onCorrectChange(i)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold border-2 transition flex-shrink-0 ${correct === i ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' : 'border-slate-600 text-slate-500'}`}
                >
                  {correct === i ? <Check size={15} /> : (['أ', 'ب', 'ج', 'د'][i] ?? i)}
                </button>
                <input
                  type="text"
                  value={c}
                  onChange={(e) => { const next = [...choices]; next[i] = e.target.value; onChoicesChange(next); }}
                  className={inputCls}
                  placeholder={`الاختيار ${['أ', 'ب', 'ج', 'د'][i] ?? i}`}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">الإجابة الصحيحة: <span className="font-bold text-emerald-400">{['أ', 'ب', 'ج', 'د'][correct] ?? correct}</span></p>
        </div>
      )}

      {type === 'true_false' && (
        <div>
          <label className="block text-sm text-slate-400 mb-1.5">الإجابة الصحيحة</label>
          <div className="flex gap-3">
            <button type="button" onClick={() => onCorrectChange(0)} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${correct === 0 ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'glass-light text-slate-400'}`}>صح</button>
            <button type="button" onClick={() => onCorrectChange(1)} className={`px-4 py-2 rounded-xl text-sm font-bold transition ${correct === 1 ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'glass-light text-slate-400'}`}>خطأ</button>
          </div>
        </div>
      )}

      {type === 'fill_blank' && (
        <>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">الإجابة الصحيحة</label>
            <input type="text" value={modelAnswer} onChange={(e) => onModelAnswerChange(e.target.value)} className={inputCls} placeholder="الإجابة الصحيحة..." />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">إجابات مقبولة أخرى (مفصولة بفاصلة)</label>
            <input type="text" value={acceptedAnswers} onChange={(e) => onAcceptedAnswersChange(e.target.value)} className={inputCls} placeholder="مثال: 5, خمسة" />
          </div>
        </>
      )}

      {type === 'short_answer' && (
        <div>
          <label className="block text-sm text-slate-400 mb-1.5">الإجابة النموذجية</label>
          <input type="text" value={modelAnswer} onChange={(e) => onModelAnswerChange(e.target.value)} className={inputCls} placeholder="الإجابة النموذجية..." />
        </div>
      )}

      {type === 'essay' && (
        <div>
          <label className="block text-sm text-slate-400 mb-1.5">الإجابة النموذجية</label>
          <textarea value={modelAnswer} onChange={(e) => onModelAnswerChange(e.target.value)} rows={3} className={`${inputCls} resize-none`} placeholder="اكتب الإجابة النموذجية..." />
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">درجة السؤال:</label>
          <input type="number" value={points} onChange={(e) => onPointsChange(e.target.value)} className={`${inputCls} w-24`} min={0.5} step={0.5} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">وقت السؤال (ثانية):</label>
          <input type="number" value={timeSeconds} onChange={(e) => onTimeSecondsChange(e.target.value)} className={`${inputCls} w-24`} min={5} placeholder="افتراضي" />
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: QuestionType }) {
  const labels: Record<QuestionType, string> = {
    mcq: 'اختيارات', essay: 'مقالي', true_false: 'صح/خطأ',
    fill_blank: 'أكمل', short_answer: 'إجابة قصيرة',
  };
  const colors: Record<QuestionType, string> = {
    mcq: 'text-sky-300 bg-sky-500/15 border-sky-500/20',
    essay: 'text-amber-300 bg-amber-500/15 border-amber-500/20',
    true_false: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/20',
    fill_blank: 'text-teal-300 bg-teal-500/15 border-teal-500/20',
    short_answer: 'text-purple-300 bg-purple-500/15 border-purple-500/20',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${colors[type]}`}>
      {labels[type]}
    </span>
  );
}

function LifecycleBadge({ status }: { status: ExamLifecycleStatus }) {
  const cfg = LIFECYCLE_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.color}`}>
      <Icon size={10} /> {cfg.label}
    </span>
  );
}

function ToggleButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${active ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400' : 'glass-light border border-white/10 text-slate-400'}`}
    >
      {icon} {children}
    </button>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm text-slate-400 mb-1.5">{icon}{label}</label>
      {children}
    </div>
  );
}

// ============================================================
// SECTION MANAGER
// ============================================================

function SectionManager({
  sections, activeSectionFilter, onFilter, onAdd, onRemove, show, onToggle,
}: {
  sections: ExamSection[];
  activeSectionFilter: string | null;
  onFilter: (id: string | null) => void;
  onAdd: (title: string, instructions: string) => void;
  onRemove: (id: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-emerald-400">
          <span className="w-7 h-7 rounded-full bg-emerald-500/15 flex items-center justify-center text-sm font-bold">2</span>
          <h3 className="font-bold text-white">أقسام الامتحان</h3>
          <span className="text-xs text-slate-400">اختياري</span>
        </div>
        <button onClick={onToggle} className="text-xs text-slate-400 hover:text-white transition">
          {show ? 'إخفاء' : 'إظهار'}
        </button>
      </div>

      {show && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-3 overflow-hidden">
          {/* Filter chips */}
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => onFilter(null)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${activeSectionFilter === null ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400'}`}
            >
              الكل
            </button>
            {sections.map((s) => (
              <div key={s.id} className="flex items-center gap-1">
                <button
                  onClick={() => onFilter(s.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${activeSectionFilter === s.id ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400'}`}
                >
                  {s.title}
                </button>
                <button onClick={() => onRemove(s.id)} className="p-0.5 rounded text-slate-500 hover:text-red-400 transition"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>

          {/* Add section form */}
          <div className="glass-light rounded-xl p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputCls}
                placeholder="اسم القسم (مثال: اختر الإجابة الصحيحة)"
              />
              <input
                type="text"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className={inputCls}
                placeholder="تعليمات القسم (اختياري)"
              />
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (title.trim()) { onAdd(title.trim(), instructions.trim()); setTitle(''); setInstructions(''); }
              }}
              disabled={!title.trim()}
            >
              <Plus size={14} /> إضافة قسم
            </Button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ============================================================
// VARIANT MANAGER
// ============================================================

function VariantManager({
  variants, onAdd, onRemove, questionCount,
}: {
  variants: ExamVariant[];
  onAdd: (label: string, randomizeQ: boolean, randomizeC: boolean) => void;
  onRemove: (id: string) => void;
  questionCount: number;
}) {
  const [label, setLabel] = useState('A');
  const [randQ, setRandQ] = useState(false);
  const [randC, setRandC] = useState(false);

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
      <div className="glass-light rounded-xl p-4 space-y-3 border border-sky-500/20">
        <div className="flex items-center gap-2 text-sm text-sky-400 font-bold">
          <GitBranch size={16} /> نسخ الامتحان
        </div>
        <p className="text-xs text-slate-400">أنشئ نسخاً مختلفة من الامتحان بترتيب أسئلة أو اختيارات مختلف — لا تغير المحتوى الأصلي.</p>

        {variants.length > 0 && (
          <div className="space-y-1.5">
            {variants.map((v) => (
              <div key={v.id} className="flex items-center justify-between glass-light rounded-lg p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-sky-300 bg-sky-500/15 px-2 py-0.5 rounded-full">نسخة {v.variant_label}</span>
                  <span className="text-[10px] text-slate-500">
                    {v.question_order ? 'ترتيب عشوائي' : 'ترتيب أصلي'}
                    {v.choice_order ? ' + اختيارات عشوائية' : ''}
                  </span>
                </div>
                <button onClick={() => onRemove(v.id)} className="p-1 rounded text-slate-500 hover:text-red-400 transition"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}

        {questionCount > 0 && (
          <div className="flex gap-2 flex-wrap items-end">
            <div>
              <label className="text-xs text-slate-400 block mb-1">اسم النسخة</label>
              <select value={label} onChange={(e) => setLabel(e.target.value)} className="glass-light rounded-lg px-3 py-2 text-xs text-white border border-slate-700/50">
                {['A', 'B', 'C', 'D'].map((l) => <option key={l} value={l}>نسخة {l}</option>)}
              </select>
            </div>
            <ToggleButton active={randQ} onClick={() => setRandQ(!randQ)} icon={<Shuffle size={14} />}>ترتيب أسئلة عشوائي</ToggleButton>
            <ToggleButton active={randC} onClick={() => setRandC(!randC)} icon={<Shuffle size={14} />}>ترتيب اختيارات عشوائي</ToggleButton>
            <Button size="sm" onClick={() => { onAdd(label, randQ, randC); }}>
              <Plus size={14} /> إنشاء نسخة
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
