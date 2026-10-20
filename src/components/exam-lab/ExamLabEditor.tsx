import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  Plus,
  Trash2,
  Copy,
  Lock,
  Unlock,
  Eye,
  Download,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Bot,
  ClipboardCopy,
  FileDown,
  Printer,
  Award,
  Layers,
  Sparkles,
  Zap,
} from 'lucide-react';
import { fetchExamLabExam, fetchExamLabQuestions, upsertExamLabQuestion, deleteExamLabQuestion, reorderExamLabQuestions, fetchExamLabPrompt, upsertExamLabPrompt, upsertExamLabExam } from '@/lib/examLabData';
import { checkQuestionQuality, generateGeminiPrompt, generateExamWithAI } from '@/lib/examLabAI';
import type { ExamLabExam, ExamLabQuestion, QuestionType, Difficulty } from '@/lib/examLabTypes';
import type { SourceMode } from '@/lib/examLabAI';
import { collectImageBase64 } from '@/lib/fileExtraction';
import type { ExtractedFile } from '@/lib/fileExtraction';
import { QUESTION_TYPE_LABELS, QUESTION_TYPE_SHORT, DIFFICULTY_LABELS } from '@/lib/examLabTypes';
import ExamLabPreview from '@/components/exam-lab/ExamLabPreview';

type Props = {
  examId: string;
  stages: { id: string; name: string }[];
  wizardData: {
    examInfo: Partial<ExamLabExam>;
    extractedContent: string;
    questionTypes: Partial<Record<string, number>>;
    difficulty: string;
    totalMarks: number | null;
    lessons: string;
    generationMode: string;
    extractedFiles?: ExtractedFile[];
  } | null;
  onBack: () => void;
};

const QUESTION_TYPES: QuestionType[] = [
  'mcq', 'true_false', 'complete', 'explain', 'mention', 'define',
  'compare', 'problem', 'image_question', 'essay', 'order_match',
];

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'mixed'];

export default function ExamLabEditor({ examId, wizardData, onBack }: Props) {
  const [exam, setExam] = useState<ExamLabExam | null>(null);
  const [questions, setQuestions] = useState<ExamLabQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingQ, setEditingQ] = useState<ExamLabQuestion | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showAnswerKey, setShowAnswerKey] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptText, setPromptText] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [qualityIssues, setQualityIssues] = useState<{ type: string; severity: string; message: string; questionIndex?: number }[]>([]);
  const [activeTab, setActiveTab] = useState<'questions' | 'prompt' | 'review'>('questions');

  const loadExam = useCallback(async () => {
    setLoading(true);
    try {
      const [examData, questionData] = await Promise.all([
        fetchExamLabExam(examId),
        fetchExamLabQuestions(examId),
      ]);
      setExam(examData);
      setQuestions(questionData);

      // Load or generate prompt
      if (wizardData?.generationMode === 'gemini' || wizardData?.generationMode === 'both') {
        const existingPrompt = await fetchExamLabPrompt(examId);
        if (existingPrompt) {
          setPromptText(existingPrompt.prompt_text);
        } else if (wizardData) {
          const prompt = generateGeminiPrompt(
            wizardData.examInfo,
            wizardData.extractedContent,
            wizardData.questionTypes as Partial<Record<QuestionType, number>>,
            wizardData.difficulty as Difficulty,
            wizardData.totalMarks,
            wizardData.lessons,
          );
          setPromptText(prompt);
          await upsertExamLabPrompt(examId, prompt, false);
        }
      }

      // Quality check
      if (examData) {
        const issues = checkQuestionQuality(questionData, examData.total_marks ?? 0);
        setQualityIssues(issues);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [examId]); // wizardData intentionally excluded — it's static for this editor session

  useEffect(() => {
    loadExam();
  }, [loadExam]);

  // Auto-save questions
  const [saving, setSaving] = useState(false);
  const saveQuestion = useCallback(async (q: Partial<ExamLabQuestion> & { exam_id: string; id?: string }) => {
    setSaving(true);
    try {
      const id = await upsertExamLabQuestion(q);
      await loadExam();
      return id;
    } finally {
      setSaving(false);
    }
  }, [loadExam]);

  const [autoExtracting, setAutoExtracting] = useState(false);
  const [autoExtractError, setAutoExtractError] = useState<string | null>(null);
  const [extractStage, setExtractStage] = useState<string>('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('notes');

  async function handleAddQuestion() {
    const newQ: Partial<ExamLabQuestion> & { exam_id: string } = {
      exam_id: examId,
      question_text: '',
      question_type: 'mcq',
      marks: null,
      difficulty: 'medium',
      source_lesson: '',
      choices: [],
      correct_answer: '',
      sort_order: questions.length,
      is_approved: false,
      version_label: 'A',
    };
    const id = await saveQuestion(newQ);
    const created = { ...newQ, id } as ExamLabQuestion;
    setEditingQ(created);
  }

  async function handleSmartAutoExtract() {
    if (autoExtracting) return;
    setAutoExtracting(true);
    setAutoExtractError(null);
    setExtractStage('جاري قراءة المحتوى...');
    try {
      const content = wizardData?.extractedContent || exam?.extracted_content || '';
      // Collect base64 images from wizard data (files that had empty OCR text)
      const images = wizardData?.extractedFiles
        ? collectImageBase64(wizardData.extractedFiles)
        : [];

      if (!content || content.trim().length < 10) {
        if (images.length > 0) {
          setExtractStage('جاري قراءة الصور بالذكاء الاصطناعي...');
        } else {
          setAutoExtractError('لا يوجد محتوى تعليمي. ارفع صور أو ملفات تحتوي على نص تعليمي في معمل الاختبارات أولاً.');
          return;
        }
      }

      setExtractStage(content.trim().length < 10 ? 'جاري قراءة الصور بالذكاء الاصطناعي...' : 'جاري إنشاء الأسئلة بالذكاء الاصطناعي...');
      const result = await generateExamWithAI({
        extractedContent: content,
        examInfo: exam || wizardData?.examInfo || {},
        questionTypes: (wizardData?.questionTypes || exam?.question_types || {}) as Partial<Record<QuestionType, number>>,
        difficulty: (wizardData?.difficulty || exam?.difficulty || 'mixed') as Difficulty,
        totalQuestions: Object.values(wizardData?.questionTypes || exam?.question_types || {}).reduce((s, c) => s + (c ?? 0), 0) || 10,
        totalMarks: exam?.total_marks ?? wizardData?.totalMarks ?? 0,
        lessons: wizardData?.lessons || exam?.lessons || '',
        images,
        sourceMode,
      });
      if (result.questions.length === 0) {
        const reason = result.warnings[0] || 'لم يتمكن النظام من توليد أسئلة من المحتوى.';
        setAutoExtractError(reason);
        return;
      }
      // Show per-type summary if available
      if (result.summary && result.summary.length > 0) {
        const lines = result.summary.map(s => `${s.label}: ${s.generated}/${s.requested}`);
        const totalGen = result.summary.reduce((sum, s) => sum + s.generated, 0);
        const totalReq = result.summary.reduce((sum, s) => sum + s.requested, 0);
        lines.push(`الإجمالي: ${totalGen}/${totalReq} سؤال`);
        setExtractStage(result.allMatch ? `تم إنشاء الأسئلة بنجاح` : `تم إنشاء ${totalGen}/${totalReq} سؤال`);
        if (!result.allMatch && result.warnings.length > 0) {
          setAutoExtractError(result.warnings.join('\n'));
        }
      }
      setExtractStage(`جاري حفظ ${result.questions.length} سؤال...`);
      let savedCount = 0;
      for (let qi = 0; qi < result.questions.length; qi++) {
        const q = result.questions[qi];
        if (!q.question_text || q.question_text.trim().length < 3) continue;
        if (q.question_type === 'mcq' && (!q.choices || q.choices.length < 2)) {
          q.question_type = 'essay';
          q.choices = [];
        }
        await upsertExamLabQuestion({
          exam_id: examId,
          question_text: q.question_text.trim(),
          question_type: q.question_type,
          marks: q.marks ?? 1,
          difficulty: q.difficulty || 'medium',
          source_lesson: q.source_lesson || '',
          choices: q.choices || [],
          correct_answer: q.correct_answer || '',
          sort_order: questions.length + savedCount,
          is_approved: false,
          version_label: 'A',
        });
        savedCount++;
      }
      setExtractStage(`تم إنشاء ${savedCount} سؤال`);
      await loadExam();
      if (savedCount === 0) {
        setAutoExtractError('تم توليد أسئلة لكنها جميعاً غير صالحة. تأكد من جودة المحتوى المرفوع.');
      }
    } catch (err) {
      setAutoExtractError(err instanceof Error ? err.message : 'فشل الاستخراج التلقائي — تحقق من الاتصال وحاول مرة أخرى');
    } finally {
      setAutoExtracting(false);
      setExtractStage('');
    }
  }

  async function handleDeleteQuestion(id: string) {
    await deleteExamLabQuestion(id);
    await loadExam();
  }

  async function handleDuplicateQuestion(q: ExamLabQuestion) {
    const { id, ...rest } = q;
    await saveQuestion({ ...rest, sort_order: questions.length, is_approved: false });
  }

  async function handleToggleApprove(q: ExamLabQuestion) {
    await saveQuestion({ ...q, is_approved: !q.is_approved });
  }

  async function handleRegeneratePrompt() {
    if (!wizardData || !exam) return;
    const prompt = generateGeminiPrompt(
      exam,
      wizardData.extractedContent,
      wizardData.questionTypes as Partial<Record<QuestionType, number>>,
      wizardData.difficulty as Difficulty,
      wizardData.totalMarks,
      wizardData.lessons,
    );
    setPromptText(prompt);
    await upsertExamLabPrompt(examId, prompt, false);
  }

  async function handleSavePrompt() {
    await upsertExamLabPrompt(examId, promptText, true);
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(promptText);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  }

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  async function handleApproveExam() {
    if (!exam || approving) return;
    setApproving(true);
    setApproveError(null);
    try {
      await upsertExamLabExam({ ...exam, status: 'approved' });
      localStorage.removeItem('examLab_draft');
      await loadExam();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل اعتماد الامتحان';
      setApproveError(msg);
    } finally {
      setApproving(false);
    }
  }

  async function handleMoveQuestion(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= questions.length) return;
    const ordered = [...questions];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    const ids = ordered.map(q => q.id);
    setQuestions(ordered);
    await reorderExamLabQuestions(examId, ids);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-sky-400" size={32} />
      </div>
    );
  }

  const totalMarks = questions.reduce((s, q) => s + (q.marks ?? 0), 0);
  const approvedCount = questions.filter(q => q.is_approved).length;
  const errors = qualityIssues.filter(i => i.severity === 'error');
  const warnings = qualityIssues.filter(i => i.severity === 'warning');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
            <ArrowRight size={16} /> رجوع
          </button>
          <h2 className="text-lg font-bold text-white">{exam?.exam_title ?? 'محرر الاختبار'}</h2>
          {exam && (
            <span className={`text-xs px-2 py-1 rounded-full font-bold ${
              exam.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
            }`}>
              {exam.status === 'approved' ? 'معتمد' : 'مسودة'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowPreview(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition">
            <Eye size={14} /> معاينة
          </button>
          <button onClick={() => setShowAnswerKey(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition">
            <Award size={14} /> نموذج الإجابة
          </button>
          {promptText && (
            <button onClick={() => { setShowPrompt(true); setActiveTab('prompt'); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition">
              <Bot size={14} /> Prompt
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {(['questions', 'prompt', 'review'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === t ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' : 'glass-light text-slate-400'
            }`}
          >
            {t === 'questions' ? 'الأسئلة' : t === 'prompt' ? 'Gemini Prompt' : 'مراجعة'}
          </button>
        ))}
      </div>

      {/* Questions tab */}
      {activeTab === 'questions' && (
        <div className="space-y-3">
          {/* Stats bar */}
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="glass-light rounded-lg px-3 py-1.5 text-slate-300">{questions.length} سؤال</span>
            <span className="glass-light rounded-lg px-3 py-1.5 text-slate-300">{totalMarks} / {exam?.total_marks ?? 0} درجة</span>
            <span className="glass-light rounded-lg px-3 py-1.5 text-emerald-400">{approvedCount} معتمد</span>
            {errors.length > 0 && <span className="glass-light rounded-lg px-3 py-1.5 text-red-400">{errors.length} خطأ</span>}
            {warnings.length > 0 && <span className="glass-light rounded-lg px-3 py-1.5 text-amber-400">{warnings.length} تحذير</span>}
          </div>

          {/* Source mode selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">نوع المصدر:</span>
            <button
              onClick={() => setSourceMode('notes')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                sourceMode === 'notes' ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' : 'glass-light text-slate-400'
              }`}
            >
              ملاحظات / شرح
            </button>
            <button
              onClick={() => setSourceMode('bank')}
              className={`px-3 py-1.5 rounded-lg font-bold transition ${
                sourceMode === 'bank' ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' : 'glass-light text-slate-400'
              }`}
            >
              بنك أسئلة جاهز
            </button>
          </div>

          {/* Dual-mode add buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={handleSmartAutoExtract}
              disabled={autoExtracting}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-sky-500/10 text-sky-400 text-sm font-bold hover:bg-sky-500/20 transition border border-sky-500/30 disabled:opacity-50"
            >
              {autoExtracting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {autoExtracting ? (extractStage || 'جاري الاستخراج...') : 'إضافة تلقائية ذكية'}
            </button>
            <button
              onClick={handleAddQuestion}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-white/15 text-slate-400 text-sm font-bold hover:border-emerald-500/40 hover:text-emerald-400 transition"
            >
              <Zap size={16} /> إضافة يدوية سريعة
            </button>
          </div>
          {autoExtractError && (
            <div className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200 font-medium">
              {autoExtractError}
            </div>
          )}

          {/* Questions list */}
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              question={q}
              index={i}
              isEditing={editingQ?.id === q.id}
              onStartEdit={() => setEditingQ(q)}
              onStopEdit={() => setEditingQ(null)}
              onSave={saveQuestion}
              onDelete={() => handleDeleteQuestion(q.id)}
              onDuplicate={() => handleDuplicateQuestion(q)}
              onToggleApprove={() => handleToggleApprove(q)}
              onMoveUp={() => handleMoveQuestion(i, -1)}
              onMoveDown={() => handleMoveQuestion(i, 1)}
            />
          ))}

          {questions.length === 0 && (
            <div className="glass-card rounded-2xl p-8 text-center space-y-2">
              <Sparkles size={28} className="mx-auto text-sky-400/60" />
              <p className="text-sm text-slate-200 font-medium">لا توجد أسئلة بعد. استخدم "إضافة تلقائية ذكية" لاستخراج الأسئلة من المحتوى المرفوع، أو "إضافة يدوية سريعة" لكتابة سؤال جديد.</p>
            </div>
          )}
        </div>
      )}

      {/* Prompt tab */}
      {activeTab === 'prompt' && (
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Gemini Notebook Prompt</h3>
            <div className="flex items-center gap-2">
              <button onClick={handleRegeneratePrompt} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition">
                <RefreshCw size={14} /> إعادة إنشاء
              </button>
              <button onClick={handleCopyPrompt} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/10 text-sky-400 text-xs font-bold hover:bg-sky-500/20 transition">
                {promptCopied ? <CheckCircle2 size={14} /> : <ClipboardCopy size={14} />}
                {promptCopied ? 'تم النسخ' : 'نسخ Prompt'}
              </button>
            </div>
          </div>
          <textarea
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            rows={20}
            className="w-full glass-light rounded-xl p-4 text-sm text-white outline-none border border-white/[0.06] focus:border-sky-500/40 transition resize-y font-mono"
          />
          <button onClick={handleSavePrompt} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition">
            حفظ التعديلات
          </button>
        </div>
      )}

      {/* Review tab */}
      {activeTab === 'review' && (
        <div className="space-y-4">
          <div className="glass-card rounded-2xl p-6 space-y-3">
            <h3 className="text-base font-bold text-white mb-4">مراجعة ذكية</h3>
            <ReviewItem label="عدد الأسئلة" value={questions.length} ok={questions.length > 0} />
            <ReviewItem label="الدرجة النهائية" value={`${totalMarks} / ${exam?.total_marks ?? 0}`} ok={totalMarks === (exam?.total_marks ?? 0)} />
            <ReviewItem label="الأسئلة المعتمدة" value={`${approvedCount} / ${questions.length}`} ok={approvedCount === questions.length && questions.length > 0} />
            <ReviewItem label="أخطاء الجودة" value={errors.length} ok={errors.length === 0} />
            <ReviewItem label="تحذيرات الجودة" value={warnings.length} ok={warnings.length === 0} />

            {qualityIssues.length > 0 && (
              <div className="space-y-2 mt-4">
                {qualityIssues.map((issue, i) => (
                  <div key={i} className={`rounded-xl p-3 text-xs ${issue.severity === 'error' ? 'bg-red-500/15 text-red-200 font-medium' : 'bg-amber-500/15 text-amber-200 font-medium'}`}>
                    <div className="flex items-center gap-2">
                      {issue.severity === 'error' ? <AlertTriangle size={14} /> : <AlertTriangle size={14} />}
                      {issue.message}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleApproveExam}
              disabled={questions.length === 0 || errors.length > 0 || approving}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition active:scale-95 disabled:opacity-50 mt-4"
            >
              {approving ? <><Loader2 size={16} className="animate-spin" /> جاري الاعتماد...</> : <><CheckCircle2 size={16} /> اعتماد الامتحان</>}
            </button>
            {approveError && <p className="text-xs text-red-400 mt-2 text-center">{approveError}</p>}
          </div>
        </div>
      )}

      {/* Preview modal */}
      {showPreview && exam && (
        <ExamLabPreview exam={exam} questions={questions} showAnswers={false} onClose={() => setShowPreview(false)} />
      )}
      {showAnswerKey && exam && (
        <ExamLabPreview exam={exam} questions={questions} showAnswers={true} onClose={() => setShowAnswerKey(false)} />
      )}
    </div>
  );
}

function QuestionCard({ question: q, index, isEditing, onStartEdit, onStopEdit, onSave, onDelete, onDuplicate, onToggleApprove, onMoveUp, onMoveDown }: {
  question: ExamLabQuestion;
  index: number;
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onSave: (q: Partial<ExamLabQuestion> & { exam_id: string; id?: string }) => Promise<string>;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleApprove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [editText, setEditText] = useState(q.question_text);
  const [editType, setEditType] = useState<QuestionType>(q.question_type);
  const [editMarks, setEditMarks] = useState<number | null>(q.marks);
  const [editDifficulty, setEditDifficulty] = useState<Difficulty>(q.difficulty);
  const [editLesson, setEditLesson] = useState(q.source_lesson);
  const [editAnswer, setEditAnswer] = useState(q.correct_answer);
  const [editChoices, setEditChoices] = useState<string[]>(q.choices.length > 0 ? q.choices : ['', '', '', '']);

  async function handleSave() {
    await onSave({
      exam_id: q.exam_id,
      id: q.id,
      question_text: editText,
      question_type: editType,
      marks: editMarks,
      difficulty: editDifficulty,
      source_lesson: editLesson,
      choices: editType === 'mcq' ? editChoices.filter(c => c.trim()) : [],
      correct_answer: editAnswer,
      sort_order: q.sort_order,
      is_approved: q.is_approved,
      version_label: q.version_label,
    });
    onStopEdit();
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card rounded-xl p-4 border ${q.is_approved ? 'border-emerald-500/20' : 'border-white/[0.06]'}`}
    >
      {!isEditing ? (
        <>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center text-xs font-bold flex-shrink-0">
              {index + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium">{q.question_text || '(سؤال فارغ)'}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400">{QUESTION_TYPE_SHORT[q.question_type]}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{q.marks ?? '-'} درجة</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400">{DIFFICULTY_LABELS[q.difficulty]}</span>
                {q.source_lesson && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300">{q.source_lesson}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={onMoveUp} className="p-1 rounded hover:bg-white/10 text-slate-400 transition text-xs">▲</button>
              <button onClick={onMoveDown} className="p-1 rounded hover:bg-white/10 text-slate-400 transition text-xs">▼</button>
              <button onClick={onStartEdit} className="p-1.5 rounded hover:bg-white/10 text-slate-400 transition">
                <Eye size={14} />
              </button>
              <button onClick={onDuplicate} className="p-1.5 rounded hover:bg-white/10 text-slate-400 transition">
                <Copy size={14} />
              </button>
              <button onClick={onToggleApprove} className={`p-1.5 rounded hover:bg-white/10 transition ${q.is_approved ? 'text-emerald-400' : 'text-slate-400'}`}>
                {q.is_approved ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
              <button onClick={onDelete} className="p-1.5 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <textarea
            value={editText}
            onChange={e => setEditText(e.target.value)}
            rows={3}
            placeholder="نص السؤال"
            className="w-full glass-light rounded-xl p-3 text-sm text-white outline-none border border-white/[0.06] focus:border-sky-500/40"
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 mb-1 block">النوع</label>
              <select value={editType} onChange={e => setEditType(e.target.value as QuestionType)} className="w-full glass-light rounded-lg px-2 py-2 text-xs text-white outline-none border border-white/[0.06]">
                {QUESTION_TYPES.map(t => <option key={t} value={t} className="bg-slate-800">{QUESTION_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 mb-1 block">الدرجات</label>
              <input type="number" value={editMarks ?? ''} onChange={e => setEditMarks(e.target.value === '' ? null : parseFloat(e.target.value))} className="w-full glass-light rounded-lg px-2 py-2 text-xs text-white outline-none border border-white/[0.06]" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 mb-1 block">الصعوبة</label>
              <select value={editDifficulty} onChange={e => setEditDifficulty(e.target.value as Difficulty)} className="w-full glass-light rounded-lg px-2 py-2 text-xs text-white outline-none border border-white/[0.06]">
                {DIFFICULTIES.map(d => <option key={d} value={d} className="bg-slate-800">{DIFFICULTY_LABELS[d]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 mb-1 block">الدرس</label>
              <input value={editLesson} onChange={e => setEditLesson(e.target.value)} className="w-full glass-light rounded-lg px-2 py-2 text-xs text-white outline-none border border-white/[0.06]" />
            </div>
          </div>
          {editType === 'mcq' && (
            <div className="space-y-2">
              <label className="text-[10px] text-slate-400">الاختيارات</label>
              {editChoices.map((c, i) => (
                <input
                  key={i}
                  value={c}
                  onChange={e => {
                    const next = [...editChoices];
                    next[i] = e.target.value;
                    setEditChoices(next);
                  }}
                  placeholder={`اختيار ${i + 1}`}
                  className="w-full glass-light rounded-lg px-3 py-2 text-xs text-white outline-none border border-white/[0.06]"
                />
              ))}
            </div>
          )}
          <div>
            <label className="text-[10px] text-slate-400 mb-1 block">الإجابة الصحيحة</label>
            <input value={editAnswer} onChange={e => setEditAnswer(e.target.value)} className="w-full glass-light rounded-lg px-3 py-2 text-sm text-white outline-none border border-white/[0.06]" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition">
              <CheckCircle2 size={14} /> حفظ
            </button>
            <button onClick={onStopEdit} className="px-4 py-2 rounded-lg glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition">
              إلغاء
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ReviewItem({ label, value, ok }: { label: string; value: string | number; ok: boolean }) {
  return (
    <div className="flex items-center justify-between glass-light rounded-xl p-3">
      <span className="text-sm text-slate-300">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-white">{value}</span>
        {ok ? <CheckCircle2 size={16} className="text-emerald-400" /> : <AlertTriangle size={16} className="text-amber-400" />}
      </div>
    </div>
  );
}
