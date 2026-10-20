import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, Award, Phone, User, Search, Download, ShieldAlert, Clock, CheckCircle2, Ban, Activity, Hourglass,
  Settings2, RefreshCw, Copy, Check, Calendar, EyeOff, Send, Unlock, Trash2, Loader2, ChevronDown,
  FileText, BookOpen, ClipboardList, X, Pencil, UserPlus, XCircle, Bell,
} from 'lucide-react';
import type { OnlineExam, ExamSubmission, SubmissionStatus, ExamLifecycleStatus, ExamReentryRequest } from '@/lib/types';
import {
  fetchAllExamSubmissions, fetchAllPublishedExams, updateOnlineExam, deleteOnlineExam,
  fetchExamQuestions, fetchExamSubmissionsForMonitor,
  fetchPendingReentryRequests, updateReentryRequest, reopenSubmissionForReentry,
} from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type SubmissionWithExam = ExamSubmission & { exam?: { title: string; subject: string | null } };

const STATUS_META: Record<SubmissionStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  waiting: { label: 'في الانتظار', color: 'text-slate-300 bg-slate-500/10', icon: Hourglass },
  in_progress: { label: 'قيد التقدم', color: 'text-amber-400 bg-amber-500/10', icon: Activity },
  submitted: { label: 'تم التسليم', color: 'text-blue-400 bg-blue-500/10', icon: CheckCircle2 },
  auto_submitted: { label: 'تسليم تلقائي', color: 'text-sky-400 bg-sky-500/10', icon: Clock },
  cheated: { label: 'غش — حظر', color: 'text-red-400 bg-red-500/10', icon: Ban },
};

const COMPLETED_STATUSES: SubmissionStatus[] = ['submitted', 'auto_submitted', 'cheated'];

function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function examStatusLabel(exam: OnlineExam): string {
  const now = Date.now();
  const open = exam.open_at ? new Date(exam.open_at).getTime() : null;
  const close = exam.close_at ? new Date(exam.close_at).getTime() : null;
  const status = (exam as OnlineExam & { lifecycle_status?: ExamLifecycleStatus }).lifecycle_status;
  if (status === 'draft' || exam.is_draft) return 'مسودة';
  if (status === 'archived') return 'مؤرشف';
  if (status === 'closed') return 'مغلق';
  if (!exam.is_published) return 'غير منشور';
  if (close && close < now) return 'منتهي';
  if (open && open > now) return 'مجدول';
  return 'نشط';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
}

export default function OnlineExamGrades() {
  const { isMaster, can } = useAuth();
  const canManage = isMaster || can('can_manage_exams');
  const { showToast } = useToast();

  const [submissions, setSubmissions] = useState<SubmissionWithExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [examFilter, setExamFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Management section state
  const [mgmtOpen, setMgmtOpen] = useState(false);
  const [allExams, setAllExams] = useState<(OnlineExam & { submission_count?: number; question_count?: number })[]>([]);
  const [mgmtLoading, setMgmtLoading] = useState(false);
  const [expandedExamId, setExpandedExamId] = useState<string | null>(null);
  const [examSubs, setExamSubs] = useState<ExamSubmission[]>([]);
  const [loadingExamSubs, setLoadingExamSubs] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [extendingExam, setExtendingExam] = useState<OnlineExam | null>(null);
  const [extendHours, setExtendHours] = useState('24');
  const [deleteTarget, setDeleteTarget] = useState<OnlineExam | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cheatingSub, setCheatingSub] = useState<ExamSubmission | null>(null);
  const [resumeTarget, setResumeTarget] = useState<OnlineExam | null>(null);
  const [reentryRequests, setReentryRequests] = useState<(ExamReentryRequest & { exam?: { title: string } })[]>([]);
  const [reentryLoading, setReentryLoading] = useState(false);
  const [reentryActionId, setReentryActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllExamSubmissions();
      setSubmissions(data);
    } catch { setSubmissions([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadReentryRequests = useCallback(async () => {
    if (!canManage) return;
    setReentryLoading(true);
    try {
      const reqs = await fetchPendingReentryRequests();
      setReentryRequests(reqs);
    } catch { setReentryRequests([]); }
    setReentryLoading(false);
  }, [canManage]);

  useEffect(() => { if (canManage) { void loadReentryRequests(); } }, [canManage, loadReentryRequests]);

  const adminName = isMaster ? 'master' : (can('can_manage_exams') ? 'admin' : 'staff');

  async function handleApproveReentry(req: ExamReentryRequest) {
    setReentryActionId(req.id);
    try {
      await updateReentryRequest(req.id, 'approved', adminName);
      if (req.submission_id) {
        await reopenSubmissionForReentry(req.submission_id);
      }
      setReentryRequests((prev) => prev.filter((r) => r.id !== req.id));
      showToast('تمت الموافقة — يمكن للطالب إعادة الدخول الآن', 'success');
    } catch { /* silent */ }
    setReentryActionId(null);
  }

  async function handleRejectReentry(req: ExamReentryRequest) {
    setReentryActionId(req.id);
    try {
      await updateReentryRequest(req.id, 'rejected', adminName);
      setReentryRequests((prev) => prev.filter((r) => r.id !== req.id));
      showToast('تم رفض الطلب', 'success');
    } catch { /* silent */ }
    setReentryActionId(null);
  }

  const loadMgmtExams = useCallback(async () => {
    setMgmtLoading(true);
    try {
      const exams = await fetchAllPublishedExams();
      const enriched = await Promise.all(
        exams.map(async (ex) => {
          const { count } = await supabase
            .from('exam_submissions')
            .select('*', { count: 'exact', head: true })
            .eq('exam_id', ex.id);
          const qs = await fetchExamQuestions(ex.id);
          return { ...ex, submission_count: count ?? 0, question_count: qs.length };
        })
      );
      enriched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setAllExams(enriched);
    } catch { showToast('لم يتم تحميل بعض الامتحانات', 'info'); }
    setMgmtLoading(false);
  }, [showToast]);

  function toggleMgmt() {
    if (!mgmtOpen && allExams.length === 0) { void loadMgmtExams(); }
    setMgmtOpen(!mgmtOpen);
  }

  function loadExamSubs(examId: string) {
    if (expandedExamId === examId) { setExpandedExamId(null); return; }
    setExpandedExamId(examId);
    setLoadingExamSubs(true);
    fetchExamSubmissionsForMonitor(examId)
      .then((data) => setExamSubs(data as ExamSubmission[]))
      .catch(() => setExamSubs([]))
      .finally(() => setLoadingExamSubs(false));
  }

  function getExamLink(exam: OnlineExam): string {
    return `${window.location.origin}/exam-portal?code=${exam.access_code ?? ''}`;
  }

  async function copyText(text: string, id: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      showToast(`تم نسخ ${label}`, 'success');
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* silent */ }
  }

  async function regenerateCode(exam: OnlineExam) {
    setRegeneratingId(exam.id);
    try {
      const newCode = generateAccessCode();
      await updateOnlineExam(exam.id, { access_code: newCode });
      setAllExams((prev) => prev.map((e) => e.id === exam.id ? { ...e, access_code: newCode } : e));
      showToast(`كود جديد: ${newCode}`, 'success');
    } catch { /* silent */ }
    setRegeneratingId(null);
  }

  async function togglePublish(exam: OnlineExam) {
    try {
      await updateOnlineExam(exam.id, { is_published: !exam.is_published });
      setAllExams((prev) => prev.map((e) => e.id === exam.id ? { ...e, is_published: !e.is_published } : e));
      showToast(exam.is_published ? 'تم إيقاف النشر' : 'تم النشر', 'success');
    } catch { /* silent */ }
  }

  async function toggleResults(exam: OnlineExam) {
    try {
      await updateOnlineExam(exam.id, { show_results: !exam.show_results });
      setAllExams((prev) => prev.map((e) => e.id === exam.id ? { ...e, show_results: !e.show_results } : e));
      showToast(exam.show_results ? 'تم إخفاء النتائج' : 'تم إظهار النتائج', 'success');
    } catch { /* silent */ }
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
      setAllExams((prev) => prev.map((e) => e.id === extendingExam.id ? { ...e, close_at: newClose.toISOString(), is_published: true } : e));
      showToast(`تم التمديد حتى ${formatDate(newClose.toISOString())}`, 'success');
      setExtendingExam(null);
    } catch { /* silent */ }
  }

  async function reopenExam(exam: OnlineExam) {
    try {
      const now = new Date();
      const newClose = new Date(now.getTime() + 24 * 3600000);
      await updateOnlineExam(exam.id, { is_published: true, close_at: newClose.toISOString(), open_at: exam.open_at ?? now.toISOString() });
      setAllExams((prev) => prev.map((e) => e.id === exam.id ? { ...e, is_published: true, close_at: newClose.toISOString(), open_at: e.open_at ?? now.toISOString() } : e));
      showToast('تم إعادة فتح الامتحان لمدة 24 ساعة', 'success');
    } catch { /* silent */ }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteOnlineExam(deleteTarget.id);
      setAllExams((prev) => prev.filter((e) => e.id !== deleteTarget.id));
      showToast('تم حذف الامتحان', 'success');
      setDeleteTarget(null);
    } catch { showToast('لا يمكن حذف الامتحان لوجود محاولات مرتبطة', 'info'); }
    setDeleting(false);
  }

  function handleResume() {
    if (!resumeTarget) return;
    const gradeId = resumeTarget.grade_level_id;
    if (gradeId) localStorage.setItem(`exam_draft_${gradeId}`, resumeTarget.id);
    setResumeTarget(null);
    showToast('سيتم فتح الامتحان في منصة الامتحانات للاستكمال', 'success');
    window.location.hash = '#/dashboard';
    setTimeout(() => { localStorage.setItem('dash_tab', 'exams'); window.location.reload(); }, 100);
  }

  const examTitles = Array.from(new Set(submissions.map((s) => s.exam?.title).filter(Boolean))) as string[];

  const filtered = submissions.filter((s) => {
    const name = s.student_name ?? 'طالب';
    const phone = s.student_phone ?? '';
    const matchesSearch = !search.trim() || name.toLowerCase().includes(search.toLowerCase()) || phone.includes(search.trim());
    const matchesExam = examFilter === 'all' || s.exam?.title === examFilter;
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesExam && matchesStatus;
  });

  const completed = filtered.filter((s) => COMPLETED_STATUSES.includes(s.status));
  const avgScore = completed.length > 0 ? completed.reduce((sum, s) => sum + (s.total_score ?? 0), 0) / completed.length : 0;
  const cheatedCount = filtered.filter((s) => s.status === 'cheated').length;
  const inProgressCount = filtered.filter((s) => s.status === 'in_progress' || s.status === 'waiting').length;

  function exportCSV() {
    const rows = [['الاسم', 'الهاتف/الكود', 'الامتحان', 'الدرجة', 'الدرجة العظمى', 'النسبة', 'الحالة', 'مخالفات', 'تاريخ التسليم']];
    for (const s of filtered) {
      const meta = STATUS_META[s.status] ?? STATUS_META.in_progress;
      const pct = s.max_score ? Math.round((s.total_score / s.max_score) * 100) : 0;
      rows.push([
        s.student_name ?? '—', s.student_phone ?? '—', s.exam?.title ?? '—',
        String(s.total_score ?? 0), String(s.max_score ?? 0), `${pct}%`, meta.label,
        String(s.tab_switch_count ?? 0), s.submitted_at ? new Date(s.submitted_at).toLocaleString('ar-EG') : '—',
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'online_exam_grades.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="glass-light rounded-xl p-3 flex items-center gap-2 text-sm text-sky-300">
        <Globe size={16} className="animate-pulse" />
        <span>درجات امتحانات الأونلاين للطلاب الخارجيين — مستقلة عن سجلات المجموعات وبدون رقم ولي أمر.</span>
      </div>

      {/* Management Section */}
      {canManage && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <button
            onClick={toggleMgmt}
            className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="text-emerald-400" size={20} />
              <h2 className="text-base font-bold text-white">لوحة إدارة الامتحانات</h2>
              <span className="text-xs text-slate-500">— إدارة الأكواد، الروابط، التمديد، الحذف، استكمال</span>
            </div>
            <ChevronDown className={`text-slate-400 transition-transform ${mgmtOpen ? 'rotate-180' : ''}`} size={20} />
          </button>

          <AnimatePresence>
            {mgmtOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-white/10 overflow-hidden"
              >
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-400">جميع الامتحانات ({allExams.length})</p>
                    <button onClick={() => void loadMgmtExams()} className="p-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-400 hover:text-emerald-400 transition">
                      <RefreshCw size={14} />
                    </button>
                  </div>

                  {mgmtLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                      <Loader2 size={18} className="animate-spin" /> <span className="text-sm">جارٍ تحميل الامتحانات...</span>
                    </div>
                  ) : allExams.length === 0 ? (
                    <p className="text-center text-slate-400 py-4 text-sm">لا توجد امتحانات بعد.</p>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {allExams.map((exam) => {
                        const stLabel = examStatusLabel(exam);
                        const isExpanded = expandedExamId === exam.id;
                        const isDraft = stLabel === 'مسودة' || stLabel === 'غير منشور';
                        return (
                          <div key={exam.id} className="glass-light rounded-xl border border-white/10 overflow-hidden">
                            <div className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/5 transition" onClick={() => loadExamSubs(exam.id)}>
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                                  <BookOpen className="text-emerald-400" size={16} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-semibold text-white text-sm truncate">{exam.title}</p>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${stLabel === 'نشط' ? 'bg-emerald-500/10 text-emerald-400' : stLabel === 'منتهي' ? 'bg-slate-500/10 text-slate-400' : stLabel === 'مسودة' || stLabel === 'غير منشور' ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-500/10 text-slate-400'}`}>{stLabel}</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                                    {exam.subject && <span>{exam.subject}</span>}
                                    <span className="flex items-center gap-1"><FileText size={10} /> {exam.question_count ?? 0} سؤال</span>
                                    <span>{exam.submission_count ?? 0} محاولة</span>
                                    {exam.access_code && <span className="text-amber-400/80 font-mono">{exam.access_code}</span>}
                                  </div>
                                </div>
                              </div>
                              <ChevronDown className={`text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} size={16} />
                            </div>

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-white/10 overflow-hidden">
                                  <div className="p-3 space-y-2">
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                      <div className="glass rounded-lg p-2"><p className="text-slate-400 mb-0.5">الفتح</p><p className="text-white font-semibold">{formatDate(exam.open_at)}</p></div>
                                      <div className="glass rounded-lg p-2"><p className="text-slate-400 mb-0.5">الإغلاق</p><p className="text-white font-semibold">{formatDate(exam.close_at)}</p></div>
                                    </div>

                                    <div className="flex items-center gap-2 flex-wrap">
                                      <button onClick={(e) => { e.stopPropagation(); void copyText(getExamLink(exam), exam.id, 'الرابط'); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                        {copiedId === exam.id ? <><Check size={13} /> منسوخ</> : <><Copy size={13} /> نسخ الرابط</>}
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); void copyText(exam.access_code ?? '', exam.id + '_code', 'الكود'); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-amber-400 text-xs font-semibold transition">
                                        <FileText size={13} /> نسخ الكود
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); void regenerateCode(exam); }} disabled={regeneratingId === exam.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-sky-400 text-xs font-semibold transition disabled:opacity-50">
                                        {regeneratingId === exam.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} كود جديد
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); void togglePublish(exam); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                        {exam.is_published ? <><EyeOff size={13} /> إيقاف</> : <><Send size={13} /> نشر</>}
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); void toggleResults(exam); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                        {exam.show_results ? 'إخفاء النتائج' : 'إظهار النتائج'}
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); setExtendingExam(exam); setExtendHours('24'); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-sky-400 text-xs font-semibold transition">
                                        <Calendar size={13} /> تمديد
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); void reopenExam(exam); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                        <Unlock size={13} /> إعادة فتح
                                      </button>
                                      {isDraft && (
                                        <button onClick={(e) => { e.stopPropagation(); setResumeTarget(exam); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-light hover:bg-emerald-500/10 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition">
                                          <Pencil size={13} /> استكمال
                                        </button>
                                      )}
                                      <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(exam); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-light hover:bg-red-500/10 text-slate-300 hover:text-red-400 text-xs font-semibold transition">
                                        <Trash2 size={13} /> حذف
                                      </button>
                                    </div>

                                    {/* Submissions for this exam */}
                                    <div className="pt-2 border-t border-white/5">
                                      <p className="text-xs font-bold text-slate-400 mb-1.5">محاولات الطلاب ({examSubs.length})</p>
                                      {loadingExamSubs ? (
                                        <div className="flex items-center gap-2 py-2 text-slate-400 text-xs"><Loader2 size={14} className="animate-spin" /> جارٍ التحميل...</div>
                                      ) : examSubs.length === 0 ? (
                                        <p className="text-xs text-slate-500 py-1.5">لا توجد محاولات بعد.</p>
                                      ) : (
                                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                          {examSubs.map((sub) => {
                                            const name = sub.student_name ?? 'طالب';
                                            const isCheated = sub.status === 'cheated' || (sub.tab_switch_count ?? 0) >= 3;
                                            return (
                                              <div key={sub.id} className="flex items-center justify-between gap-2 rounded-lg p-2 bg-slate-800/30">
                                                <div className="flex items-center gap-2 min-w-0">
                                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${isCheated ? 'bg-red-500/20 text-red-400' : sub.status === 'submitted' || sub.status === 'auto_submitted' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-300'}`}>{name.charAt(0)}</div>
                                                  <div className="min-w-0">
                                                    <p className="text-xs text-white truncate">{name}</p>
                                                    <p className="text-[10px] text-slate-500">
                                                      {sub.status === 'submitted' || sub.status === 'auto_submitted' ? `${sub.total_score}/${sub.max_score}` : sub.status === 'cheated' ? 'غش' : sub.status}
                                                      {sub.submitted_at && ` • ${formatDate(sub.submitted_at)}`}
                                                    </p>
                                                  </div>
                                                </div>
                                                {(sub.tab_switch_count ?? 0) > 0 && (
                                                  <button onClick={(e) => { e.stopPropagation(); setCheatingSub(sub); }} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${isCheated ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'} hover:opacity-80 transition`}>
                                                    <ShieldAlert size={10} /> {sub.tab_switch_count} خروج
                                                  </button>
                                                )}
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
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Re-entry Requests Panel */}
      {canManage && reentryRequests.length > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden border border-amber-500/20">
          <div className="p-4 flex items-center gap-2 border-b border-white/10">
            <Bell className="text-amber-400 animate-pulse" size={20} />
            <h2 className="text-base font-bold text-white">طلبات إعادة الدخول</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400">{reentryRequests.length} pending</span>
            <button onClick={() => void loadReentryRequests()} className="mr-auto p-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-400 hover:text-amber-400 transition">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
            {reentryLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-slate-400">
                <Loader2 size={16} className="animate-spin" /> <span className="text-sm">جارٍ التحميل...</span>
              </div>
            ) : reentryRequests.map((req) => (
              <div key={req.id} className="glass-light rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                    <User className="text-amber-400" size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white text-sm truncate">{req.student_name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                      {req.student_phone && <span className="flex items-center gap-0.5"><Phone size={9} /> {req.student_phone}</span>}
                      <span className="flex items-center gap-0.5"><FileText size={9} /> {req.exam?.title ?? '—'}</span>
                      <span className="flex items-center gap-0.5"><Clock size={9} /> {formatDate(req.created_at)}</span>
                    </div>
                    {req.reason && <p className="text-xs text-slate-400 mt-1 truncate">السبب: {req.reason}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => void handleApproveReentry(req)}
                    disabled={reentryActionId === req.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 text-xs font-bold transition disabled:opacity-50"
                  >
                    {reentryActionId === req.id ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                    السماح
                  </button>
                  <button
                    onClick={() => void handleRejectReentry(req)}
                    disabled={reentryActionId === req.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600/15 hover:bg-red-600/25 text-red-400 text-xs font-bold transition disabled:opacity-50"
                  >
                    {reentryActionId === req.id ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                    رفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="glass-card rounded-xl p-3 text-center"><p className="text-xs text-slate-400">إجمالي المحاولات</p><p className="text-xl font-bold text-white">{submissions.length}</p></div>
        <div className="glass-card rounded-xl p-3 text-center"><p className="text-xs text-slate-400">مكتملة</p><p className="text-xl font-bold text-emerald-300">{completed.length}</p></div>
        <div className="glass-card rounded-xl p-3 text-center"><p className="text-xs text-slate-400">قيد التقدم</p><p className="text-xl font-bold text-amber-300">{inProgressCount}</p></div>
        <div className="glass-card rounded-xl p-3 text-center"><p className="text-xs text-slate-400">متوسط الدرجات</p><p className="text-xl font-bold text-blue-300">{avgScore.toFixed(1)}</p></div>
        <div className="glass-card rounded-xl p-3 text-center"><p className="text-xs text-slate-400">حالات غش</p><p className="text-xl font-bold text-red-300">{cheatedCount}</p></div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم أو الرقم..." className="w-full glass-light rounded-xl py-2.5 pr-10 pl-4 text-white placeholder-slate-500 border border-white/10 focus:border-sky-500/50 focus:outline-none text-sm" />
        </div>
        <select value={examFilter} onChange={(e) => setExamFilter(e.target.value)} className="glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-sky-500/50 focus:outline-none text-sm">
          <option value="all">كل الامتحانات</option>
          {examTitles.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-sky-500/50 focus:outline-none text-sm">
          <option value="all">كل الحالات</option>
          <option value="waiting">في الانتظار</option>
          <option value="in_progress">قيد التقدم</option>
          <option value="submitted">تم التسليم</option>
          <option value="auto_submitted">تسليم تلقائي</option>
          <option value="cheated">غش — حظر</option>
        </select>
        <button onClick={exportCSV} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl glass-light text-sm text-slate-300 hover:text-emerald-400 transition">
          <Download size={16} /> تصدير CSV
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="glass-light rounded-xl p-8 text-center text-slate-400">جارٍ التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="glass-light rounded-xl p-8 text-center text-slate-400">لا توجد نتائج لعرضها بعد. عندما يدخل الطلاب الخارجيون ويُسلّمون الامتحان، ستظهر نتائجهم هنا تلقائيًا.</div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="text-right p-3 font-semibold">الطالب</th>
                  <th className="text-right p-3 font-semibold">الهاتف / الكود</th>
                  <th className="text-right p-3 font-semibold">الامتحان</th>
                  <th className="text-center p-3 font-semibold w-28">الدرجة</th>
                  <th className="text-center p-3 font-semibold w-24">الحالة</th>
                  <th className="text-center p-3 font-semibold w-20">المخالفات</th>
                  <th className="text-center p-3 font-semibold w-40">تاريخ التسليم</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => {
                  const pct = s.max_score ? Math.round((s.total_score / s.max_score) * 100) : 0;
                  const meta = STATUS_META[s.status] ?? STATUS_META.in_progress;
                  const StatusIcon = meta.icon;
                  const isCompleted = COMPLETED_STATUSES.includes(s.status);
                  const violations = s.tab_switch_count ?? 0;
                  const isCheated = s.status === 'cheated' || violations >= 3;
                  return (
                    <motion.tr
                      key={s.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className={`border-b border-white/5 hover:bg-white/5 ${s.status === 'cheated' ? 'bg-red-500/5' : ''}`}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${s.status === 'cheated' ? 'bg-red-500/15 text-red-400' : 'bg-sky-500/15 text-sky-300'}`}>
                            {(s.student_name ?? '؟').charAt(0)}
                          </div>
                          <span className="text-white font-medium break-words leading-snug">{s.student_name ?? 'طالب'}</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-300">
                        <span className="flex items-center gap-1.5"><Phone size={12} className="text-slate-500" />{s.student_phone ?? '—'}</span>
                      </td>
                      <td className="p-3 text-slate-300">
                        <div className="flex flex-col">
                          <span className="text-sm">{s.exam?.title ?? '—'}</span>
                          {s.exam?.subject && <span className="text-xs text-slate-500">{s.exam.subject}</span>}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {isCompleted ? (
                          <><span className={`font-bold ${pct >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>{s.total_score ?? 0}</span><span className="text-slate-500 text-xs"> / {s.max_score ?? 0}</span></>
                        ) : <span className="text-slate-600 text-xs">—</span>}
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => (violations > 0 || s.status === 'cheated') && setCheatingSub(s)}
                          disabled={violations === 0 && s.status !== 'cheated'}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${meta.color} ${(violations > 0 || s.status === 'cheated') ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                        >
                          <StatusIcon size={12} /> {meta.label}
                        </button>
                      </td>
                      <td className="p-3 text-center">
                        {violations > 0 ? (
                          <button
                            onClick={() => setCheatingSub(s)}
                            className={`inline-flex items-center gap-1 text-xs font-bold ${violations >= 3 ? 'text-red-400' : 'text-amber-400'} hover:opacity-80 transition`}
                          >
                            <ShieldAlert size={12} /> {violations}
                          </button>
                        ) : <span className="text-slate-600 text-xs">0</span>}
                      </td>
                      <td className="p-3 text-center text-xs text-slate-400">{s.submitted_at ? new Date(s.submitted_at).toLocaleString('ar-EG') : '—'}</td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Extend Exam Modal */}
      <Modal open={!!extendingExam} onClose={() => setExtendingExam(null)} title="تمديد فترة الامتحان" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-400">اختر عدد الساعات لتمديد فترة الامتحان:</p>
          <div className="flex gap-2 flex-wrap">
            {['6', '12', '24', '48', '72'].map((h) => (
              <button key={h} onClick={() => setExtendHours(h)} className={`px-4 py-2 rounded-lg text-sm font-bold transition ${extendHours === h ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30' : 'glass-light text-slate-400'}`}>{h} ساعة</button>
            ))}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button onClick={() => setExtendingExam(null)} className="px-4 py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-white/10 transition">إلغاء</button>
            <button onClick={() => void extendExam()} className="px-4 py-2 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 text-sm font-bold hover:bg-emerald-600/30 transition">تأكيد</button>
          </div>
        </div>
      </Modal>

      {/* Resume Confirmation */}
      <ConfirmDialog
        open={!!resumeTarget}
        onClose={() => setResumeTarget(null)}
        onConfirm={() => void handleResume()}
        title="استكمال الامتحان"
        subtext={`سيتم فتح "${resumeTarget?.title}" في منصة الامتحانات لاستكماله. لن يتم إنشاء نسخة مكررة. هل تريد المتابعة؟`}
        confirmLabel="استكمال"
      />

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

      {/* Cheating Details Modal */}
      <CheatingDetailsModal sub={cheatingSub} onClose={() => setCheatingSub(null)} />
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
        <div className="flex items-center gap-3 glass-light rounded-xl p-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold ${isCheated ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>{name.charAt(0)}</div>
          <div>
            <p className="font-bold text-white">{name}</p>
            {sub.student_phone && <p className="text-xs text-slate-500">{sub.student_phone}</p>}
          </div>
        </div>

        <div className={`rounded-xl p-4 border ${isCheated ? 'bg-red-500/10 border-red-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className={isCheated ? 'text-red-400' : 'text-amber-400'} size={20} />
            <h3 className={`font-bold ${isCheated ? 'text-red-400' : 'text-amber-400'}`}>{isCheated ? 'تم الحظر — غش مؤكد' : 'تحت المراقبة'}</h3>
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
              <span className="text-slate-400 flex items-center gap-1.5"><Activity size={14} /> تبديل التبويب / فقدان التركيز</span>
              <span className={`font-bold ${tabSwitches >= 3 ? 'text-red-400' : tabSwitches > 0 ? 'text-amber-400' : 'text-slate-400'}`}>{tabSwitches} مرة</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Clock size={14} /> وقت بدء المحاولة</span>
              <span className="text-white font-semibold">{formatDate(sub.started_at)}</span>
            </div>
            {sub.submitted_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><CheckCircle2 size={14} /> وقت التسليم</span>
                <span className="text-white font-semibold">{formatDate(sub.submitted_at)}</span>
              </div>
            )}
            {sub.last_activity_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><RefreshCw size={14} /> آخر نشاط</span>
                <span className="text-white font-semibold">{formatDate(sub.last_activity_at)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><FileText size={14} /> حالة التسليم</span>
              <span className="text-white font-semibold">{sub.status === 'cheated' ? 'تسليم بسبب غش' : sub.status === 'submitted' ? 'تسليم طبيعي' : sub.status === 'auto_submitted' ? 'تسليم تلقائي' : sub.status === 'in_progress' ? 'جاري الامتحان' : 'في الانتظار'}</span>
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
