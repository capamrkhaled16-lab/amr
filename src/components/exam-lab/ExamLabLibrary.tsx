import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Eye,
  Copy,
  Printer,
  Trash2,
  Award,
  Loader2,
  Search,
  FileText,
} from 'lucide-react';
import type { ExamLabExam } from '@/lib/examLabTypes';
import { copyExamLabExam, deleteExamLabExam, fetchExamLabQuestions } from '@/lib/examLabData';
import ExamLabPreview from '@/components/exam-lab/ExamLabPreview';

type Props = {
  exams: ExamLabExam[];
  loading: boolean;
  onBack: () => void;
  onEditExam: (examId: string) => void;
  onRefresh: () => void;
};

export default function ExamLabLibrary({ exams, loading, onBack, onEditExam, onRefresh }: Props) {
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [previewExam, setPreviewExam] = useState<ExamLabExam | null>(null);
  const [previewQuestions, setPreviewQuestions] = useState<any[]>([]);
  const [showAnswerKey, setShowAnswerKey] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);

  const subjects = useMemo(() => {
    const s = new Set(exams.map(e => e.subject).filter(Boolean));
    return Array.from(s);
  }, [exams]);

  const filtered = useMemo(() => {
    return exams.filter(e => {
      if (search && !e.exam_title.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterSubject && e.subject !== filterSubject) return false;
      if (filterStatus && e.status !== filterStatus) return false;
      return true;
    });
  }, [exams, search, filterSubject, filterStatus]);

  async function handleCopy(examId: string) {
    setCopying(examId);
    try {
      await copyExamLabExam(examId);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setCopying(null);
    }
  }

  async function handleDelete(examId: string) {
    if (!confirm('هل أنت متأكد من حذف هذا الاختبار؟')) return;
    try {
      await deleteExamLabExam(examId);
      onRefresh();
    } catch {
      // ignore
    }
  }

  async function handlePreview(exam: ExamLabExam, showAnswers: boolean) {
    try {
      const questions = await fetchExamLabQuestions(exam.id);
      setPreviewQuestions(questions);
      setPreviewExam(exam);
      setShowAnswerKey(showAnswers);
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-sky-400" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
          <ArrowRight size={16} /> رجوع
        </button>
        <h2 className="text-lg font-bold text-white">بنك الاختبارات</h2>
      </div>

      {/* Filters */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث بالعنوان..."
            className="flex-1 bg-transparent text-sm text-white outline-none"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filterSubject}
            onChange={e => setFilterSubject(e.target.value)}
            className="glass-light rounded-lg px-3 py-2 text-xs text-white outline-none"
          >
            <option value="" className="bg-slate-800">كل المواد</option>
            {subjects.map(s => <option key={s} value={s} className="bg-slate-800">{s}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="glass-light rounded-lg px-3 py-2 text-xs text-white outline-none"
          >
            <option value="" className="bg-slate-800">كل الحالات</option>
            <option value="draft" className="bg-slate-800">مسودة</option>
            <option value="approved" className="bg-slate-800">معتمد</option>
          </select>
        </div>
      </div>

      {/* Exam list */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center">
          <FileText size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">لا توجد اختبارات محفوظة بعد</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((exam, i) => (
            <motion.div
              key={exam.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="glass-card rounded-xl p-4 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-white truncate">{exam.exam_title || 'بدون عنوان'}</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {exam.subject} {exam.grade_name && `• ${exam.grade_name}`} {exam.group_name && `• ${exam.group_name}`}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-full font-bold flex-shrink-0 ${
                  exam.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
                }`}>
                  {exam.status === 'approved' ? 'معتمد' : 'مسودة'}
                </span>
              </div>

              <div className="flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                {exam.exam_date && <span>📅 {exam.exam_date}</span>}
                {exam.duration_minutes != null && <span>⏱ {exam.duration_minutes} د</span>}
                {exam.total_marks != null && <span>📊 {exam.total_marks} درجة</span>}
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                <button onClick={() => onEditExam(exam.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500/10 text-sky-400 text-[11px] font-bold hover:bg-sky-500/20 transition">
                  <Eye size={12} /> فتح
                </button>
                <button onClick={() => handleCopy(exam.id)} disabled={copying === exam.id} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg glass-light text-slate-300 text-[11px] font-bold hover:bg-white/10 transition disabled:opacity-50">
                  {copying === exam.id ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />} نسخ
                </button>
                <button onClick={() => handlePreview(exam, false)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg glass-light text-slate-300 text-[11px] font-bold hover:bg-white/10 transition">
                  <Printer size={12} /> طباعة
                </button>
                <button onClick={() => handlePreview(exam, true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg glass-light text-slate-300 text-[11px] font-bold hover:bg-white/10 transition">
                  <Award size={12} /> إجابة
                </button>
                <button onClick={() => handleDelete(exam.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-[11px] font-bold transition">
                  <Trash2 size={12} /> حذف
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Preview modal */}
      {previewExam && (
        <ExamLabPreview
          exam={previewExam}
          questions={previewQuestions}
          showAnswers={showAnswerKey}
          onClose={() => setPreviewExam(null)}
        />
      )}
    </div>
  );
}
