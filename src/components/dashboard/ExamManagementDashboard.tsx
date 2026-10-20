import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, Clock, Eye, EyeOff, Trash2, RefreshCw, Copy, Check,
  Calendar, BookOpen, Users, FileText, Loader2, Search,
  Lock, Unlock, Send, Plus, ChevronDown, ShieldAlert, Award,
  Pencil, Settings2, Save, Printer,
} from 'lucide-react';
import type { OnlineExam, ExamSubmission, ExamLifecycleStatus, ExamQuestion, ExamSection } from '@/lib/types';
import {
  fetchAllPublishedExams, updateOnlineExam, deleteOnlineExam,
  fetchExamQuestions, fetchExamSubmissionsForMonitor,
  updateExamQuestion, createExamQuestion, deleteExamQuestion,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import ExamPreview from '@/components/modules/ExamPreview';

type ExamWithMeta = OnlineExam & { submission_count?: number };

function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function examStatus(exam: OnlineExam): { label: string; color: string; icon: typeof Clock } {
  const now = Date.now();
  const open = exam.open_at ? new Date(exam.open_at).getTime() : null;
  const close = exam.close_at ? new Date(exam.close_at).getTime() : null;
  const status = (exam as OnlineExam & { lifecycle_status?: ExamLifecycleStatus }).lifecycle_status;

  if (status === 'draft' || exam.is_draft) return { label: 'مسودة', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: FileText };
  if (status === 'archived') return { label: 'مؤرشف', color: 'text-slate-500 bg-slate-500/10 border-slate-500/20', icon: Lock };
  if (status === 'closed') return { label: 'مغلق', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20', icon: Lock };
  if (!exam.is_published) return { label: 'غير منشور', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', icon: EyeOff };
  if (close && close < now) return { label: 'منتهي', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20', icon: Clock };
  if (open && open > now) return { label: 'مجدول', color: 'text-sky-400 bg-sky-500/10 border-sky-500/20', icon: Calendar };
  return { label: 'نشط', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: Send };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}

type ExamManagementDashboardProps = {
  onResumeExam?: (examId: string, gradeLevelId: string | null) => void;
};

export default function ExamManagementDashboard({ onResumeExam }: ExamManagementDashboardProps = {}) {
  const { isMaster, can } = useAuth();
  const canManage = isMaster || can('can_manage_exams');
  const { showToast } = useToast();
  const [exams, setExams] = useState<ExamWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'scheduled' | 'expired' | 'draft'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<ExamSubmission[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<OnlineExam | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cheatingSub, setCheatingSub] = useState<ExamSubmission | null>(null);
  const [extendingExam, setExtendingExam] = useState<OnlineExam | null>(null);
  const [extendHours, setExtendHours] = useState('24');
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [editingExam, setEditingExam] = useState<OnlineExam | null>(null);
  const [editForm, setEditForm] = useState({ title: '', subject: '', duration_minutes: '', open_at: '', close_at: '', instructions: '', per_question_time_seconds: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [examQuestions, setExamQuestions] = useState<ExamQuestion[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionSavingId, setQuestionSavingId] = useState<string | null>(null);
  const [newQuestion, setNewQuestion] = useState<{ question_text: string; choices: string[]; correct_choice: number; points: number; question_type: string } | null>(null);
  const [previewExam, setPreviewExam] = useState<OnlineExam | null>(null);
  const [previewQuestions, setPreviewQuestions] = useState<ExamQuestion[]>([]);
  const [previewSections, setPreviewSections] = useState<ExamSection[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadExams = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllPublishedExams();
      const withCounts = await Promise.all(
        data.map(async (ex) => {
          const { count } = await supabase
            .from('exam_submissions')
            .select('*', { count: 'exact', head: true })
            .eq('exam_id', ex.id);
          return { ...ex, submission_count: count ?? 0 };
        })
      );
      withCounts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setExams(withCounts);

      const qCounts: Record<string, number> = {};
      await Promise.all(
        data.map(async (ex) => {
          const qs = await fetchExamQuestions(ex.id);
          qCounts[ex.id] = qs.length;
        })
      );
      setQuestionCounts(qCounts);
    } catch {
      showToast('لم يتم تحميل بعض الامتحانات', 'info');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { void loadExams(); }, [loadExams]);

  const loadSubmissions = useCallback(async (examId: string) => {
    setLoadingSubs(true);
    try {
      const data = await fetchExamSubmissionsForMonitor(examId);
      setSubmissions(data as ExamSubmission[]);
    } catch {
      setSubmissions([]);
    }
    setLoadingSubs(false);
  }, []);

  function toggleExpand(examId: string) {
    if (expandedId === examId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(examId);
    void loadSubmissions(examId);
  }

  function getExamLink(exam: OnlineExam): string {
    const base = window.location.origin;
    return `${base}/exam-portal?code=${exam.access_code ?? ''}`;
  }

  async function copyLink(exam: OnlineExam) {
    try {
      await navigator.clipboard.writeText(getExamLink(exam));
      setCopiedCode(exam.id);
      showToast('تم نسخ رابط الامتحان', 'success');
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {

    }
  }

  async function copyCode(exam: OnlineExam) {
    try {
      await navigator.clipboard.writeText(exam.access_code ?? '');
      setCopiedCode(exam.id);
      showToast('تم نسخ كود الامتحان', 'success');
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {

    }
  }

  async function regenerateCode(exam: OnlineExam) {
    setRegeneratingId(exam.id);
    try {
      const newCode = generateAccessCode();
      await updateOnlineExam(exam.id, { access_code: newCode });
      setExams((prev) => prev.map((e) => e.id === exam.id ? { ...e, access_code: newCode } : e));
      showToast(`تم توليد كود جديد: ${newCode}`, 'success');
    } catch {

    }
    setRegeneratingId(null);
  }

  async function togglePublish(exam: OnlineExam) {
    try {
      await updateOnlineExam(exam.id, { is_published: !exam.is_published });
      setExams((prev) => prev.map((e) => e.id === exam.id ? { ...e, is_published: !e.is_published } : e));
      showToast(exam.is_published ? 'تم إيقاف نشر الامتحان' : 'تم نشر الامتحان', 'success');
    } catch {

    }
  }

  async function toggleResults(exam: OnlineExam) {
    try {
      await updateOnlineExam(exam.id, { show_results: !exam.show_results });
      setExams((prev) => prev.map((e) => e.id === exam.id ? { ...e, show_results: !e.show_results } : e));
      showToast(exam.show_results ? 'تم إخفاء النتائج' : 'تم إظهار النتائج', 'success');
    } catch {

    }
  }

  async function extendExam() {
    if (!extendingExam) return;
    try {
      const hours = parseInt(extendHours) || 24;
      const now = new Date();
      const currentClose = extendingExam.close_at ? new Date(extendingExam.close_at) : now;
      const base = currentClose > now ? currentClose : now;
      const newClose = new Date(base.getTime() + hours * 3600000);
      await updateOnlineExam(extendingExam.id, { close_at: newClose.toISOString(), is_published: true });
      setExams((prev) => prev.map((e) => e.id === extendingExam.id ? { ...e, close_at: newClose.toISOString(), is_published: true } : e));
      showToast(`تم تمديد الامتحان حتى ${formatDate(newClose.toISOString())}`, 'success');
      setExtendingExam(null);
    } catch {

    }
  }

  async function reopenExam(exam: OnlineExam) {
    try {
      const now = new Date();
      const newClose = new Date(now.getTime() + 24 * 3600000);
      await updateOnlineExam(exam.id, {
        is_published: true,
        close_at: newClose.toISOString(),
        open_at: exam.open_at ?? now.toISOString(),
      });
      setExams((prev) => prev.map((e) => e.id === exam.id ? { ...e, is_published: true, close_at: newClose.toISOString(), open_at: e.open_at ?? now.toISOString() } : e));
      showToast('تم إعادة فتح الامتحان لمدة 24 ساعة', 'success');
    } catch {

    }
  }

  function openEditExam(exam: OnlineExam) {
    setEditingExam(exam);
    setEditForm({
      title: exam.title ?? '',
      subject: exam.subject ?? '',
      duration_minutes: String(exam.duration_minutes ?? ''),
      open_at: exam.open_at ? exam.open_at.slice(0, 16) : '',
      close_at: exam.close_at ? exam.close_at.slice(0, 16) : '',
      instructions: exam.instructions ?? '',
      per_question_time_seconds: String(exam.per_question_time_seconds ?? ''),
    });
    setEditingQuestions(false);
  }

  async function openPreviewExam(exam: OnlineExam) {
    setPreviewExam(exam);
    setPreviewQuestions([]);
    setPreviewSections([]);
    setPreviewLoading(true);
    try {
      const [qs, secs] = await Promise.all([
        fetchExamQuestions(exam.id),
        supabase.from('exam_sections').select('*').eq('exam_id', exam.id).order('sort_order'),
      ]);
      setPreviewQuestions(qs);
      setPreviewSections((secs.data as ExamSection[]) ?? []);
    } catch {
      setPreviewQuestions([]);
      setPreviewSections([]);
    }
    setPreviewLoading(false);
  }

  async function saveExamSettings() {
    if (!editingExam) return;
    setEditSaving(true);
    try {
      const patch: Partial<OnlineExam> = {
        title: editForm.title.trim() || editingExam.title,
        subject: editForm.subject.trim() || null,
        instructions: editForm.instructions.trim() || null,
      };
      if (editForm.duration_minutes) patch.duration_minutes = parseInt(editForm.duration_minutes) || undefined;
      if (editForm.open_at) patch.open_at = new Date(editForm.open_at).toISOString();
      if (editForm.close_at) patch.close_at = new Date(editForm.close_at).toISOString();
      if (editForm.per_question_time_seconds) patch.per_question_time_seconds = parseInt(editForm.per_question_time_seconds) || undefined;
      await updateOnlineExam(editingExam.id, patch);
      setExams((prev) => prev.map((e) => e.id === editingExam.id ? { ...e, ...patch } : e));
      showToast('تم حفظ تعديلات الامتحان بنجاح', 'success');
    } catch {

    }
    setEditSaving(false);
  }

  async function loadExamQuestions(examId: string) {
    setQuestionsLoading(true);
    try {
      const qs = await fetchExamQuestions(examId);
      setExamQuestions(qs);
    } catch {
      setExamQuestions([]);
    }
    setQuestionsLoading(false);
  }

  async function saveQuestion(q: ExamQuestion, field: string, value: string | number) {
    setQuestionSavingId(q.id);
    try {
      const patch: Partial<ExamQuestion> = { [field]: value };
      if (field === 'points') patch.points = typeof value === 'string' ? parseInt(value) || 0 : value;
      if (field === 'correct_choice') patch.correct_choice = typeof value === 'string' ? parseInt(value) || 0 : value;
      await updateExamQuestion(q.id, patch);
      setExamQuestions((prev) => prev.map((qq) => qq.id === q.id ? { ...qq, ...patch } : qq));
      showToast('تم حفظ السؤال', 'success');
    } catch {

    }
    setQuestionSavingId(null);
  }

  async function saveQuestionChoices(q: ExamQuestion, choices: string[]) {
    setQuestionSavingId(q.id);
    try {
      await updateExamQuestion(q.id, { choices } as Partial<ExamQuestion>);
      setExamQuestions((prev) => prev.map((qq) => qq.id === q.id ? { ...qq, choices } as ExamQuestion : qq));
      showToast('تم حفظ الاختيارات', 'success');
    } catch {

    }
    setQuestionSavingId(null);
  }

  async function addQuestion() {
    if (!editingExam || !newQuestion || !newQuestion.question_text.trim()) return;
    setQuestionSavingId('new');
    try {
      const created = await createExamQuestion({
        exam_id: editingExam.id,
        question_text: newQuestion.question_text,
        question_type: newQuestion.question_type || 'mcq',
        choices: newQuestion.choices,
        correct_choice: newQuestion.correct_choice,
        points: newQuestion.points || 1,
        sort_order: examQuestions.length,
      });
      if (created) {
        setExamQuestions((prev) => [...prev, created]);
        setNewQuestion(null);
        showToast('تم إضافة السؤال', 'success');
      }
    } catch {

    }
    setQuestionSavingId(null);
  }

  async function removeQuestion(qId: string) {
    try {
      await deleteExamQuestion(qId);
      setExamQuestions((prev) => prev.filter((q) => q.id !== qId));
      showToast('تم حذف السؤال', 'success');
    } catch {

    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteOnlineExam(deleteTarget.id);
      setExams((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      showToast('تم حذف الامتحان', 'success');
      setDeleteTarget(null);
    } catch {
      showToast('لا يمكن حذف الامتحان لوجود محاولات مرتبطة', 'info');
    }
    setDeleting(false);
  }

  const filteredExams = exams.filter((ex) => {
    if (search) {
      const q = search.toLowerCase();
      if (!ex.title.toLowerCase().includes(q) && !(ex.subject ?? '').toLowerCase().includes(q) && !(ex.access_code ?? '').toLowerCase().includes(q)) return false;
    }
    if (filter === 'all') return true;
    const st = examStatus(ex);
    if (filter === 'active') return st.label === 'نشط';
    if (filter === 'scheduled') return st.label === 'مجدول';
    if (filter === 'expired') return st.label === 'منتهي';
    if (filter === 'draft') return st.label === 'مسودة' || st.label === 'غير منشور';
    return true;
  });

  const filterTabs: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'الكل' },
    { key: 'active', label: 'نشط' },
    { key: 'scheduled', label: 'مجدول' },
    { key: 'expired', label: 'منتهي' },
    { key: 'draft', label: 'مسودة' },
  ];

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="text-emerald-400" size={22} />
            <h2 className="text-lg font-bold text-white">لوحة إدارة الامتحانات الأونلاين</h2>
          </div>
          <button onClick={() => void loadExams()} className="p-2 rounded-lg glass-light hover:bg-white/10 text-slate-400 hover:text-emerald-400 transition" title="تحديث">
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالعنوان، المادة، أو كود الامتحان..."
            className="w-full glass-light rounded-xl py-2.5 pr-10 pl-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {filterTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition ${filter === t.key ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'glass-light text-slate-400 hover:bg-white/10'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span>جارٍ تحميل الامتحانات...</span>
          </div>
        ) : filteredExams.length === 0 ? (
          <p className="text-center text-slate-400 py-8">لا توجد امتحانات مطابقة.</p>
        ) : (
          <div className="space-y-2">
            {filteredExams.map((exam) => {
              const st = examStatus(exam);
              const Icon = st.icon;
              const qCount = questionCounts[exam.id] ?? 0;
              const subCount = exam.submission_count ?? 0;
              const isExpanded = expandedId === exam.id;
              return (
                <motion.div key={exam.id} layout className="glass-light rounded-xl border border-white/10 overflow-hidden">
                  {/* Exam row */}
                  <div className="p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/5 transition" onClick={() => toggleExpand(exam.id)}>
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                        <BookOpen className="text-emerald-400" size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-white text-sm truncate">{exam.title}</p>
                          <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${st.color}`}>
                            <Icon size={10} /> {st.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                          {exam.subject && <span>{exam.subject}</span>}
                          <span className="flex items-center gap-1"><FileText size={10} /> {qCount} سؤال</span>
                          <span className="flex items-center gap-1"><Users size={10} /> {subCount} محاولة</span>
                          {exam.duration_minutes && <span className="flex items-center gap-1"><Clock size={10} /> {exam.duration_minutes} د</span>}
                          {exam.access_code && <span className="text-amber-400/80 font-mono">{exam.access_code}</span>}
                        </div>
                      </div>
                    </div>
                    <ChevronDown className={`text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} size={18} />
                  </div>

                  {/* Expanded details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-white/10 overflow-hidden"
                      >
                        <div className="p-4 space-y-3">
                          {/* Dates */}
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="glass rounded-lg p-2.5">
                              <p className="text-slate-400 mb-0.5">تاريخ الفتح</p>
                              <p className="text-white font-semibold">{formatDate(exam.open_at)}</p>
                            </div>
                            <div className="glass rounded-lg p-2.5">
                              <p className="text-slate-400 mb-0.5">تاريخ الإغلاق</p>
                              <p className="text-white font-semibold">{formatDate(exam.close_at)}</p>
                            </div>
                          </div>

                          {/* Settings */}
                          <div className="flex items-center gap-2 flex-wrap text-[10px]">
                            <span className={`px-2 py-1 rounded-lg font-semibold ${exam.show_results ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'}`}>
                              {exam.show_results ? <><Eye size={10} className="inline" /> نتائج ظاهرة</> : <><EyeOff size={10} className="inline" /> نتائج مخفية</>}
                            </span>
                            {exam.shuffle_questions && <span className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-400 font-semibold">خلط الأسئلة</span>}
                            {exam.shuffle_choices && <span className="px-2 py-1 rounded-lg bg-sky-500/10 text-sky-400 font-semibold">خلط الاختيارات</span>}
                            {exam.is_random && <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 font-semibold">عشوائي</span>}
                          </div>

                          {/* Actions */}
                          {canManage && (
                            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/5">
                              <button onClick={(e) => { e.stopPropagation(); void copyLink(exam); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                {copiedCode === exam.id ? <><Check size={14} /> منسوخ</> : <><Copy size={14} /> نسخ الرابط</>}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); void copyCode(exam); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-amber-400 text-xs font-semibold transition">
                                <FileText size={14} /> نسخ الكود
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); void regenerateCode(exam); }}
                                disabled={regeneratingId === exam.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-sky-400 text-xs font-semibold transition disabled:opacity-50"
                              >
                                {regeneratingId === exam.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} كود جديد
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); void togglePublish(exam); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                {exam.is_published ? <><EyeOff size={14} /> إيقاف النشر</> : <><Send size={14} /> نشر</>}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); void toggleResults(exam); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                {exam.show_results ? <><EyeOff size={14} /> إخفاء النتائج</> : <><Eye size={14} /> إظهار النتائج</>}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); setExtendingExam(exam); setExtendHours('24'); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-sky-400 text-xs font-semibold transition">
                                <Calendar size={14} /> تمديد
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); openEditExam(exam); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-sky-400 text-xs font-semibold transition">
                                <Settings2 size={14} /> تعديل
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); void reopenExam(exam); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                <Unlock size={14} /> إعادة فتح
                              </button>
                              {onResumeExam && (st.label === 'مسودة' || st.label === 'غير منشور') && (
                                <button onClick={(e) => { e.stopPropagation(); openEditExam(exam); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-emerald-500/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                  <Pencil size={14} /> استكمال
                                </button>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); void openPreviewExam(exam); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-sky-400 text-xs font-semibold transition">
                                <Printer size={14} /> عرض الامتحان
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(exam); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-red-500/10 text-slate-300 hover:text-red-400 text-xs font-semibold transition">
                                <Trash2 size={14} /> حذف
                              </button>
                            </div>
                          )}

                          {/* Submissions list */}
                          <div className="pt-2 border-t border-white/5">
                            <p className="text-xs font-bold text-slate-400 mb-2">محاولات الطلاب ({submissions.length})</p>
                            {loadingSubs ? (
                              <div className="flex items-center gap-2 py-3 text-slate-400 text-xs">
                                <Loader2 size={14} className="animate-spin" /> جارٍ التحميل...
                              </div>
                            ) : submissions.length === 0 ? (
                              <p className="text-xs text-slate-500 py-2">لا توجد محاولات بعد.</p>
                            ) : (
                              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                                {submissions.map((sub) => {
                                  const name = (sub as ExamSubmission & { student?: { name: string } }).student?.name ?? sub.student_name ?? 'طالب';
                                  const isCheated = sub.status === 'cheated' || (sub.tab_switch_count ?? 0) >= 3;
                                  return (
                                    <div key={sub.id} className="flex items-center justify-between gap-2 rounded-lg p-2 bg-slate-800/30">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isCheated ? 'bg-red-500/20 text-red-400' : sub.status === 'submitted' || sub.status === 'auto_submitted' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-300'}`}>
                                          {name.charAt(0)}
                                        </div>
                                        <div className="min-w-0">
                                          <p className="text-sm text-white truncate">{name}</p>
                                          <p className="text-[10px] text-slate-500">
                                            {sub.status === 'submitted' || sub.status === 'auto_submitted' ? `الدرجة: ${sub.total_score}/${sub.max_score}` : sub.status === 'waiting' ? 'في الانتظار' : sub.status === 'in_progress' ? 'جاري الامتحان' : sub.status}
                                            {sub.submitted_at && ` • ${formatDate(sub.submitted_at)}`}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {(sub.tab_switch_count ?? 0) > 0 && (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setCheatingSub(sub); }}
                                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${isCheated ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'} hover:opacity-80 transition`}
                                          >
                                            <ShieldAlert size={10} /> {sub.tab_switch_count} خروج
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Extend Exam Modal */}
      <Modal
        open={!!extendingExam}
        onClose={() => setExtendingExam(null)}
        title="تمديد فترة الامتحان"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">اختر عدد الساعات لتمديد فترة الامتحان:</p>
          <div className="flex gap-2 flex-wrap">
            {['6', '12', '24', '48', '72'].map((h) => (
              <button
                key={h}
                onClick={() => setExtendHours(h)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition ${extendHours === h ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'glass-light text-slate-400'}`}
              >
                {h} ساعة
              </button>
            ))}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setExtendingExam(null)} className="px-4 py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-white/10 transition">إلغاء</button>
            <button onClick={() => void extendExam()} className="px-4 py-2 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-sm font-bold hover:bg-emerald-600/30 transition">تأكيد التمديد</button>
          </div>
        </div>
      </Modal>

      {/* Exam Settings Edit Modal */}
      <Modal
        open={!!editingExam}
        onClose={() => { setEditingExam(null); setEditingQuestions(false); setExamQuestions([]); }}
        title={editingExam ? `تعديل: ${editingExam.title}` : ''}
        size="lg"
      >
        {editingExam && (
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-2">
              <button
                onClick={() => setEditingQuestions(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${!editingQuestions ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'glass-light text-slate-400'}`}
              >
                <Settings2 size={12} className="inline ml-1" /> إعدادات الامتحان
              </button>
              <button
                onClick={() => { setEditingQuestions(true); void loadExamQuestions(editingExam.id); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${editingQuestions ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'glass-light text-slate-400'}`}
              >
                <FileText size={12} className="inline ml-1" /> الأسئلة ({examQuestions.length})
              </button>
            </div>

            {!editingQuestions ? (
              <>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">عنوان الامتحان</label>
                  <input
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    className="w-full glass-light rounded-xl p-3 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">المادة</label>
                  <input
                    value={editForm.subject}
                    onChange={(e) => setEditForm((f) => ({ ...f, subject: e.target.value }))}
                    className="w-full glass-light rounded-xl p-3 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">مدة الامتحان (دقائق)</label>
                    <input
                      type="number"
                      value={editForm.duration_minutes}
                      onChange={(e) => setEditForm((f) => ({ ...f, duration_minutes: e.target.value }))}
                      className="w-full glass-light rounded-xl p-3 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">وقت لكل سؤال (ثانية)</label>
                    <input
                      type="number"
                      value={editForm.per_question_time_seconds}
                      onChange={(e) => setEditForm((f) => ({ ...f, per_question_time_seconds: e.target.value }))}
                      className="w-full glass-light rounded-xl p-3 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">تاريخ ووقت الفتح</label>
                    <input
                      type="datetime-local"
                      value={editForm.open_at}
                      onChange={(e) => setEditForm((f) => ({ ...f, open_at: e.target.value }))}
                      className="w-full glass-light rounded-xl p-3 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">تاريخ ووقت الإغلاق</label>
                    <input
                      type="datetime-local"
                      value={editForm.close_at}
                      onChange={(e) => setEditForm((f) => ({ ...f, close_at: e.target.value }))}
                      className="w-full glass-light rounded-xl p-3 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">التعليمات</label>
                  <textarea
                    value={editForm.instructions}
                    onChange={(e) => setEditForm((f) => ({ ...f, instructions: e.target.value }))}
                    rows={3}
                    className="w-full glass-light rounded-xl p-3 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setEditingExam(null)} className="px-4 py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-white/10 transition">إلغاء</button>
                  <button onClick={() => void saveExamSettings()} disabled={editSaving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-sm font-bold hover:bg-emerald-600/30 transition disabled:opacity-50">
                    {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} حفظ
                  </button>
                </div>
              </>
            ) : (
              <>
                {questionsLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                    <Loader2 size={18} className="animate-spin" /> <span className="text-sm">جارٍ تحميل الأسئلة...</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {examQuestions.map((q, idx) => (
                      <QuestionEditor
                        key={q.id}
                        q={q}
                        index={idx}
                        savingId={questionSavingId}
                        onSave={saveQuestion}
                        onSaveChoices={saveQuestionChoices}
                        onDelete={removeQuestion}
                      />
                    ))}
                    {/* Add new question */}
                    {newQuestion ? (
                      <div className="glass-light rounded-xl p-3 border border-emerald-500/30 space-y-2">
                        <input
                          placeholder="نص السؤال الجديد"
                          value={newQuestion.question_text}
                          onChange={(e) => setNewQuestion((nq) => nq ? { ...nq, question_text: e.target.value } : null)}
                          className="w-full glass-light rounded-lg p-2 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                        />
                        <div className="space-y-1">
                          {newQuestion.choices.map((ch, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <input
                                type="radio"
                                checked={newQuestion.correct_choice === i}
                                onChange={() => setNewQuestion((nq) => nq ? { ...nq, correct_choice: i } : null)}
                                className="accent-emerald-500"
                              />
                              <input
                                placeholder={`اختيار ${i + 1}`}
                                value={ch}
                                onChange={(e) => setNewQuestion((nq) => nq ? { ...nq, choices: nq.choices.map((c, ci) => ci === i ? e.target.value : c) } : null)}
                                className="flex-1 glass-light rounded-lg p-2 text-xs text-white border border-slate-700/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            placeholder="الدرجة"
                            value={newQuestion.points}
                            onChange={(e) => setNewQuestion((nq) => nq ? { ...nq, points: parseInt(e.target.value) || 1 } : null)}
                            className="w-20 glass-light rounded-lg p-2 text-xs text-white border border-slate-700/50"
                          />
                          <button onClick={() => void addQuestion()} disabled={questionSavingId === 'new'} className="px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold hover:bg-emerald-600/30 transition disabled:opacity-50">
                            {questionSavingId === 'new' ? <Loader2 size={12} className="animate-spin" /> : 'إضافة'}
                          </button>
                          <button onClick={() => setNewQuestion(null)} className="px-3 py-1.5 rounded-lg glass-light text-slate-400 text-xs hover:bg-white/10">إلغاء</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setNewQuestion({ question_text: '', choices: ['', '', '', ''], correct_choice: 0, points: 1, question_type: 'mcq' })} className="w-full py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-emerald-500/10 hover:text-emerald-400 transition flex items-center justify-center gap-1.5">
                        <Plus size={14} /> إضافة سؤال جديد
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Cheating Details Modal */}
      <CheatingDetailsModal sub={cheatingSub} onClose={() => setCheatingSub(null)} />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        loading={deleting}
        title="حذف الامتحان"
        subtext={`سيتم حذف "${deleteTarget?.title}" وجميع أسئلته. لن يتم حذف محاولات الطلاب ونتائجهم المسجلة. هل أنت متأكد؟`}
        confirmLabel="تأكيد الحذف"
      />

      {/* Exam Preview for teachers */}
      {previewLoading ? (
        <Modal open={!!previewExam} onClose={() => setPreviewExam(null)} title="تحميل المعاينة" size="md">
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span>جارٍ تحميل الامتحان...</span>
          </div>
        </Modal>
      ) : (
        <ExamPreview
          open={!!previewExam}
          onClose={() => setPreviewExam(null)}
          exam={previewExam}
          questions={previewQuestions}
          sections={previewSections}
        />
      )}
    </div>
  );
}

function QuestionEditor({ q, index, savingId, onSave, onSaveChoices, onDelete }: {
  q: ExamQuestion;
  index: number;
  savingId: string | null;
  onSave: (q: ExamQuestion, field: string, value: string | number) => void;
  onSaveChoices: (q: ExamQuestion, choices: string[]) => void;
  onDelete: (id: string) => void;
}) {
  const [text, setText] = useState(q.question_text);
  const [choices, setChoices] = useState<string[]>((q as ExamQuestion & { choices?: string[] }).choices ?? []);
  const [correct, setCorrect] = useState(q.correct_choice ?? 0);
  const [points, setPoints] = useState(q.points);
  const [expanded, setExpanded] = useState(false);
  const isSaving = savingId === q.id;

  return (
    <div className="glass-light rounded-xl p-3 border border-white/10">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-emerald-500/15 flex items-center justify-center text-[10px] font-bold text-emerald-400 flex-shrink-0">{index + 1}</div>
        <p className="text-sm text-white flex-1 truncate cursor-pointer" onClick={() => setExpanded(!expanded)}>{text || 'سؤال بدون نص'}</p>
        <span className="text-[10px] text-slate-500 flex-shrink-0">{points} درجة</span>
        <button onClick={() => setExpanded(!expanded)} className="p-1 rounded text-slate-400 hover:text-white transition">
          <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text !== q.question_text && onSave(q, 'question_text', text)}
            rows={2}
            className="w-full glass-light rounded-lg p-2 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
          />
          <div className="space-y-1">
            {choices.map((ch, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={correct === i}
                  onChange={() => { setCorrect(i); onSave(q, 'correct_choice', i); }}
                  className="accent-emerald-500"
                />
                <input
                  value={ch}
                  onChange={(e) => setChoices((prev) => prev.map((c, ci) => ci === i ? e.target.value : c))}
                  onBlur={() => { const orig = ((q as ExamQuestion & { choices?: string[] }).choices ?? []); if (JSON.stringify(choices) !== JSON.stringify(orig)) onSaveChoices(q, choices); }}
                  placeholder={`اختيار ${i + 1}`}
                  className="flex-1 glass-light rounded-lg p-1.5 text-xs text-white border border-slate-700/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(parseInt(e.target.value) || 0)}
              onBlur={() => points !== q.points && onSave(q, 'points', points)}
              className="w-20 glass-light rounded-lg p-1.5 text-xs text-white border border-slate-700/50"
            />
            <span className="text-[10px] text-slate-500">درجة</span>
            {isSaving && <Loader2 size={12} className="animate-spin text-emerald-400" />}
            <button onClick={() => onDelete(q.id)} className="mr-auto p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheatingDetailsModal({ sub, onClose }: { sub: ExamSubmission | null; onClose: () => void }) {
  if (!sub) return null;
  const tabSwitches = sub.tab_switch_count ?? 0;
  const isCheated = sub.status === 'cheated' || tabSwitches >= 3;
  const name = sub.student_name ?? 'طالب';

  return (
    <Modal open={!!sub} onClose={onClose} title="تفاصيل المخالفة الأمنية" size="md">
      <div className="space-y-4">
        {/* Student info */}
        <div className="flex items-center gap-3 glass-light rounded-xl p-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold ${isCheated ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
            {name.charAt(0)}
          </div>
          <div>
            <p className="font-bold text-white">{name}</p>
            {sub.student_phone && <p className="text-xs text-slate-500">{sub.student_phone}</p>}
          </div>
        </div>

        {/* Ban status */}
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

        {/* Security events */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-400">الأحداث الأمنية المسجلة:</h4>
          <div className="glass-light rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Eye size={14} /> تبديل التبويب / فقدان التركيز</span>
              <span className={`font-bold ${tabSwitches >= 3 ? 'text-red-400' : tabSwitches > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                {tabSwitches} مرة
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Clock size={14} /> وقت بدء المحاولة</span>
              <span className="text-white font-semibold">{formatDate(sub.started_at)}</span>
            </div>
            {sub.submitted_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><Check size={14} /> وقت التسليم</span>
                <span className="text-white font-semibold">{formatDate(sub.submitted_at)}</span>
              </div>
            )}
            {sub.last_activity_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><RefreshCw size={14} /> آخر نشاط مسجل</span>
                <span className="text-white font-semibold">{formatDate(sub.last_activity_at)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><FileText size={14} /> حالة التسليم</span>
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

        {/* IDs */}
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


