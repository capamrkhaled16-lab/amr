import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, Loader2, AlertTriangle, Check, X, Plus,
  Trash2, ChevronUp, ChevronDown, ClipboardPaste, Image as ImageIcon,
  Eye, EyeOff, ArrowRight, ArrowLeft, Wand2, Sparkles, ListChecks,
  Settings, Type, AlignRight, Award, Timer, BookOpen, Copy,
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { extractFiles, combineExtractedText, collectImageBase64 } from '@/lib/fileExtraction';
import { supabase } from '@/lib/supabase';
import type { QuestionType } from '@/lib/types';

export interface TranscribedQuestion {
  tempId: string;
  type: QuestionType;
  text: string;
  choices: string[];
  correct: number;
  marks: number;
  uncertain: boolean;
  flags: string[];
}

interface ExamImportTranscribeProps {
  open: boolean;
  onClose: () => void;
  onImport: (questions: TranscribedQuestion[]) => void;
  examTitle?: string;
  subject?: string;
  gradeName?: string;
}

type Phase = 'input' | 'setup' | 'processing' | 'review';

type SourceMode = 'extract' | 'generate' | 'both';

const SETUP_QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'mcq', label: 'اختيار من متعدد' },
  { value: 'true_false', label: 'صح/خطأ' },
  { value: 'fill_blank', label: 'أكمل' },
  { value: 'short_answer', label: 'إجابة قصيرة' },
  { value: 'essay', label: 'مقالي' },
];

type AIAction =
  | 'extract'
  | 'to_mcq'
  | 'to_essay'
  | 'to_true_false'
  | 'generate_answers'
  | 'rephrase'
  | 'generate_similar'
  | 'distribute_marks';

const ACTION_LABELS: Record<AIAction, string> = {
  extract: 'استخراج الأسئلة كما هي',
  to_mcq: 'تحويل إلى اختيار من متعدد',
  to_essay: 'تحويل إلى أسئلة مقالية',
  to_true_false: 'تحويل إلى صح وخطأ',
  generate_answers: 'إنشاء نموذج إجابة وتحديد الإجابات الصحيحة',
  rephrase: 'إعادة صياغة الأسئلة دون تغيير المعنى',
  generate_similar: 'إنشاء أسئلة جديدة مشابهة للمستوى الأصلي',
  distribute_marks: 'توزيع الدرجات على الأسئلة',
};

const ARABIC_CHOICE_LABELS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

function makeTempId(): string {
  return `tq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function detectIssues(q: TranscribedQuestion, allQuestions?: TranscribedQuestion[]): string[] {
  const issues: string[] = [];
  if (!q.text.trim()) issues.push('نص السؤال فارغ');
  if (q.type === 'mcq') {
    const valid = q.choices.filter((c) => c.trim());
    if (valid.length < 2) issues.push('الخيارات أقل من اثنين');
    if (q.correct < 0 || q.correct >= q.choices.length || !q.choices[q.correct]?.trim()) {
      issues.push('لم يتم تحديد الإجابة الصحيحة');
    }
  }
  if (q.type === 'true_false' && q.correct < 0) {
    issues.push('لم يتم تحديد صح أو خطأ');
  }
  if (q.text.includes('[غير واضح]')) issues.push('يحتوي على نص غير واضح يحتاج مراجعة');
  if (allQuestions && q.text.trim()) {
    const dupCount = allQuestions.filter((other) => other !== q && other.text.trim() === q.text.trim()).length;
    if (dupCount > 0) issues.push('سؤال مكرر');
  }
  return issues;
}

export default function ExamImportTranscribe({
  open, onClose, onImport, examTitle, subject, gradeName,
}: ExamImportTranscribeProps) {
  const { showToast } = useToast();
  const [phase, setPhase] = useState<Phase>('input');
  const [pastedText, setPastedText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [extractedText, setExtractedText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [questions, setQuestions] = useState<TranscribedQuestion[]>([]);
  const [showAnswers, setShowAnswers] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [totalMarksInput, setTotalMarksInput] = useState('');
  // Setup config
  const [sourceMode, setSourceMode] = useState<SourceMode>('extract');
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [difficulty, setDifficulty] = useState('mixed');
  const [totalMarks, setTotalMarks] = useState('');
  const [lessons, setLessons] = useState('');
  const [preserveWording, setPreserveWording] = useState(true);
  const [generateAnswerKey, setGenerateAnswerKey] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase('input');
    setPastedText('');
    setFiles([]);
    setExtractedText('');
    setImages([]);
    setQuestions([]);
    setShowAnswers(false);
    setImporting(false);
    setActionLoading(false);
    setSelectedIds(new Set());
    setTotalMarksInput('');
    setSourceMode('extract');
    setTypeCounts({});
    setDifficulty('mixed');
    setTotalMarks('');
    setLessons('');
    setPreserveWording(true);
    setGenerateAnswerKey(true);
  }, []);

  function handleClose() {
    reset();
    onClose();
  }

  function handleFileSelect(selectedFiles: FileList | null) {
    if (!selectedFiles || selectedFiles.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(selectedFiles)]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function callEdgeFunction(action: AIAction, targetQuestions?: TranscribedQuestion[]) {
    const content = targetQuestions && targetQuestions.length > 0
      ? targetQuestions.map((q, i) => {
          let s = `السؤال ${i + 1}: ${q.text}`;
          if (q.choices.length > 0) s += '\n' + q.choices.map((c, ci) => `${ARABIC_CHOICE_LABELS[ci] || String(ci + 1)}) ${c}`).join('\n');
          if (q.correct >= 0 && q.choices[q.correct]) s += `\nالإجابة الصحيحة: ${q.choices[q.correct]}`;
          if (q.marks) s += `\nالدرجة: ${q.marks}`;
          return s;
        }).join('\n\n')
      : extractedText;

    // Build questionTypes from setup config when extracting
    const questionTypes = action === 'extract' && sourceMode !== 'extract'
      ? Object.fromEntries(Object.entries(typeCounts).filter(([, c]) => c > 0))
      : {};
    const totalQuestions = action === 'extract' && sourceMode !== 'extract'
      ? Object.values(typeCounts).reduce((sum, c) => sum + (c || 0), 0)
      : 0;

    const { data, error } = await supabase.functions.invoke('exam-ai-generate', {
      body: {
        extractedContent: content,
        images: action === 'extract' ? images : [],
        examInfo: {
          exam_title: examTitle || '',
          subject: subject || '',
          grade_name: gradeName || '',
        },
        questionTypes,
        difficulty,
        totalQuestions,
        totalMarks: totalMarks ? parseInt(totalMarks) : 0,
        lessons,
        sourceMode: sourceMode === 'generate' ? 'notes' : 'transcribe',
        aiAction: action,
        preserveWording,
        generateAnswerKey,
        totalMarksOverride: totalMarksInput ? parseInt(totalMarksInput) : (totalMarks ? parseInt(totalMarks) : 0),
      },
    });

    if (error) throw new Error(error.message);

    const result = data as {
      questions: Array<{
        question_text: string;
        question_type: string;
        marks: number;
        choices: string[];
        correct_answer: string;
        uncertain?: boolean;
      }>;
      warnings: string[];
    };

    if (!result.questions || result.questions.length === 0) {
      throw new Error('لم يتم العثور على أسئلة في الاستجابة');
    }

    return result;
  }

  async function handleTranscribe() {
    const hasText = pastedText.trim().length >= 10;
    const hasFiles = files.length > 0;
    if (!hasText && !hasFiles) {
      showToast('أضف نصاً أو ملفات للتفريغ', 'error');
      return;
    }

    setPhase('processing');

    let combinedText = pastedText.trim();
    let collectedImages: string[] = [];

    if (hasFiles) {
      try {
        const extracted = await extractFiles(files);
        combinedText += '\n\n' + combineExtractedText(extracted);
        collectedImages = collectImageBase64(extracted);
      } catch {
        showToast('فشل استخراج بعض الملفات — تأكد من أن الملف واضح وقابل للقراءة', 'error');
      }
    }

    setExtractedText(combinedText);
    setImages(collectedImages);

    try {
      const result = await callEdgeFunction('extract');

      const transcribed: TranscribedQuestion[] = result.questions.map((q) => {
        const isUncertain = q.uncertain === true || q.question_text.includes('[غير واضح]');
        let correctIdx = -1;
        if (q.correct_answer && q.choices.length > 0) {
          correctIdx = q.choices.findIndex(
            (c) => c.trim() === q.correct_answer.trim()
          );
        }
        return {
          tempId: makeTempId(),
          type: mapType(q.question_type) as QuestionType,
          text: q.question_text,
          choices: q.choices || [],
          correct: correctIdx,
          marks: q.marks || 1,
          uncertain: isUncertain,
          flags: [],
        };
      });

      setQuestions(transcribed);
      setPhase('review');

      if (result.warnings && result.warnings.length > 0) {
        showToast(result.warnings[0], 'info');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
      showToast(`فشل التفريغ: ${msg}. تأكد من اتصال الإنترنت ووضوح المحتوى`, 'error');
      setPhase('input');
    }
  }

  async function applyAction(action: AIAction) {
    const targets = selectedIds.size > 0
      ? questions.filter((q) => selectedIds.has(q.tempId))
      : questions;

    if (targets.length === 0) {
      showToast('لا توجد أسئلة محددة', 'error');
      return;
    }

    const isGlobal = selectedIds.size === 0;
    const targetDesc = isGlobal ? 'كل الأسئلة' : `${targets.length} سؤال محدد`;

    setActionLoading(true);
    try {
      const result = await callEdgeFunction(action, targets);

      const newQuestions: TranscribedQuestion[] = result.questions.map((q, i) => {
        const isUncertain = q.uncertain === true || q.question_text.includes('[غير واضح]');
        let correctIdx = -1;
        if (q.correct_answer && q.choices.length > 0) {
          correctIdx = q.choices.findIndex(
            (c) => c.trim() === q.correct_answer.trim()
          );
        }
        const existing = targets[i];
        return {
          tempId: existing?.tempId || makeTempId(),
          type: mapType(q.question_type) as QuestionType,
          text: q.question_text,
          choices: q.choices || [],
          correct: correctIdx,
          marks: q.marks || existing?.marks || 1,
          uncertain: isUncertain,
          flags: [],
        };
      });

      if (isGlobal) {
        setQuestions(newQuestions);
      } else {
        const targetIds = new Set(targets.map((t) => t.tempId));
        setQuestions((prev) => {
          const updated = [...prev];
          let replaceIdx = 0;
          for (let i = 0; i < updated.length; i++) {
            if (targetIds.has(updated[i].tempId) && replaceIdx < newQuestions.length) {
              updated[i] = newQuestions[replaceIdx++];
            }
          }
          return updated;
        });
      }

      showToast(`تم تطبيق "${ACTION_LABELS[action]}" على ${targetDesc}`, 'success');

      if (result.warnings && result.warnings.length > 0) {
        showToast(result.warnings[0], 'info');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطأ غير معروف';
      showToast(`فشل تطبيق الإجراء: ${msg}`, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  function toggleSelect(tempId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(questions.map((q) => q.tempId)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  function updateQuestion(tempId: string, updates: Partial<TranscribedQuestion>) {
    setQuestions((prev) =>
      prev.map((q) => (q.tempId === tempId ? { ...q, ...updates } : q))
    );
  }

  function removeQuestion(tempId: string) {
    setQuestions((prev) => prev.filter((q) => q.tempId !== tempId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(tempId);
      return next;
    });
  }

  function moveQuestion(idx: number, dir: 'up' | 'down') {
    setQuestions((prev) => {
      const next = [...prev];
      const target = dir === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function addEmptyQuestion() {
    setQuestions((prev) => [
      ...prev,
      {
        tempId: makeTempId(),
        type: 'mcq',
        text: '',
        choices: ['', '', '', ''],
        correct: -1,
        marks: 1,
        uncertain: false,
        flags: [],
      },
    ]);
  }

  function addChoice(tempId: string) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.tempId === tempId ? { ...q, choices: [...q.choices, ''] } : q
      )
    );
  }

  function removeChoice(tempId: string, choiceIdx: number) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.tempId !== tempId) return q;
        const newChoices = q.choices.filter((_, i) => i !== choiceIdx);
        let newCorrect = q.correct;
        if (q.correct === choiceIdx) newCorrect = -1;
        else if (q.correct > choiceIdx) newCorrect = q.correct - 1;
        return { ...q, choices: newChoices, correct: newCorrect };
      })
    );
  }

  function confirmImport() {
    const incomplete = questions.filter((q) => detectIssues(q, questions).length > 0);
    if (incomplete.length > 0) {
      showToast(`يوجد ${incomplete.length} سؤال غير مكتمل — راجعه قبل الاستيراد`, 'error');
      return;
    }
    setImporting(true);
    onImport(questions);
    setImporting(false);
    reset();
    onClose();
  }

  const totalQuestions = questions.length;
  const incompleteCount = questions.filter((q) => detectIssues(q, questions).length > 0).length;
  const uncertainCount = questions.filter((q) => q.uncertain).length;
  const selectedCount = selectedIds.size;

  // ── INPUT PHASE ──
  if (phase === 'input') {
    return (
      <Modal open={open} onClose={handleClose} title="تفريغ أسئلة من مصدر خارجي" size="lg">
        <div className="space-y-5">
          <div className="glass-light rounded-xl p-3 flex items-start gap-2 text-sm text-sky-300">
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
            <span>
              تفرغ الأداة الأسئلة من المصدر كما هي تماماً مع تصنيف دقيق لأنواع الأسئلة.
              الأسئلة ذات الخيارات (أ، ب، ج، د) تُصنف تلقائياً كاختيار من متعدد.
              الأجزاء غير الواضحة توضع بعلامة [غير واضح] لمراجعتها يدوياً.
            </span>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-white mb-2">
              <ClipboardPaste size={16} className="text-emerald-400" />
              لصق النص
            </label>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="الصق هنا الأسئلة المنسوخة من أي مصدر..."
              rows={6}
              dir="rtl"
              className="w-full glass-light rounded-xl p-3 text-sm text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition resize-y"
            />
          </div>

          <div className="flex items-center gap-3 text-slate-500 text-xs">
            <div className="flex-1 h-px bg-white/10" />
            <span>أو ارفع ملفات</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-white mb-2">
              <Upload size={16} className="text-sky-400" />
              رفع ملفات (صور، PDF، Word)
            </label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFileSelect(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                dragOver
                  ? 'border-emerald-500/50 bg-emerald-500/5'
                  : 'border-white/15 hover:border-white/25'
              }`}
            >
              <Upload className="mx-auto text-slate-400 mb-2" size={28} />
              <p className="text-sm text-slate-300">اسحب الملفات هنا أو اضغط للاختيار</p>
              <p className="text-xs text-slate-500 mt-1">JPG, PNG, PDF, DOCX</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.txt,.csv,.md"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
            </div>

            {files.length > 0 && (
              <div className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 glass-light rounded-lg p-2 text-xs">
                    {f.type.startsWith('image/') ? (
                      <ImageIcon size={14} className="text-sky-400 flex-shrink-0" />
                    ) : (
                      <FileText size={14} className="text-emerald-400 flex-shrink-0" />
                    )}
                    <span className="text-slate-300 truncate flex-1">{f.name}</span>
                    <span className="text-slate-500 flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      className="p-0.5 rounded text-slate-400 hover:text-red-400 transition"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-white/10">
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-white/10 transition"
            >
              إلغاء
            </button>
            <button
              onClick={() => setPhase('setup')}
              disabled={!pastedText.trim() && files.length === 0}
              className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <ArrowLeft size={16} />
              التالي: إعدادات الامتحان
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── SETUP PHASE ──
  if (phase === 'setup') {
    const totalRequested = Object.values(typeCounts).reduce((sum, c) => sum + (c || 0), 0);
    return (
      <Modal open={open} onClose={handleClose} title="إعدادات الاستخراج والتوليد" size="lg">
        <div className="space-y-5">
          {/* Source mode */}
          <div>
            <label className="flex items-center gap-2 text-sm font-bold text-white mb-2">
              <Settings size={16} className="text-emerald-400" />
              مصدر الأسئلة
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'extract', label: 'استخراج الأسئلة كما هي', desc: 'نسخ الأسئلة من المصدر دون تغيير' },
                { value: 'generate', label: 'توليد أسئلة جديدة', desc: 'إنشاء أسئلة جديدة من المحتوى' },
                { value: 'both', label: 'استخراج + توليد', desc: 'استخراج الأسئلة الموجودة ثم توليد إضافية' },
              ] as { value: SourceMode; label: string; desc: string }[]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSourceMode(opt.value)}
                  className={`rounded-xl p-3 text-center border-2 transition ${
                    sourceMode === opt.value
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                      : 'border-white/10 glass-light text-slate-400 hover:border-white/20'
                  }`}
                >
                  <p className="text-xs font-bold mb-1">{opt.label}</p>
                  <p className="text-[10px] text-slate-500">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Question type counts (only for generate/both) */}
          {sourceMode !== 'extract' && (
            <div className="glass-light rounded-xl p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-bold text-white">
                <Type size={16} className="text-sky-400" />
                أنواع وعدد الأسئلة المطلوب توليدها
              </label>
              <div className="space-y-2">
                {SETUP_QUESTION_TYPES.map((qt) => (
                  <div key={qt.value} className="flex items-center gap-3">
                    <span className="text-xs text-slate-300 flex-1">{qt.label}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setTypeCounts((prev) => ({ ...prev, [qt.value]: Math.max(0, (prev[qt.value] || 0) - 1) }))}
                        className="w-7 h-7 rounded-lg glass-light text-white hover:bg-white/10 transition text-sm font-bold"
                      >−</button>
                      <input
                        type="number"
                        min={0}
                        value={typeCounts[qt.value] || 0}
                        onChange={(e) => setTypeCounts((prev) => ({ ...prev, [qt.value]: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className="w-12 text-center glass-light rounded-lg px-1 py-1 text-xs text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                      />
                      <button
                        onClick={() => setTypeCounts((prev) => ({ ...prev, [qt.value]: (prev[qt.value] || 0) + 1 }))}
                        className="w-7 h-7 rounded-lg glass-light text-white hover:bg-white/10 transition text-sm font-bold"
                      >+</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs pt-2 border-t border-white/5">
                <span className="text-slate-400">إجمالي الأسئلة المطلوب توليدها:</span>
                <span className="font-bold text-emerald-400">{totalRequested} سؤال</span>
              </div>
            </div>
          )}

          {/* Exam config */}
          <div className="glass-light rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-2 text-sm font-bold text-white">
              <BookOpen size={16} className="text-amber-400" />
              معلومات الدرس والمستوى
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">الدروس/الموضوعات</label>
                <input
                  type="text"
                  dir="rtl"
                  value={lessons}
                  onChange={(e) => setLessons(e.target.value)}
                  placeholder="مثال: البناء الضوئي، التنفس"
                  className="w-full glass-light rounded-lg px-3 py-2 text-xs text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">مستوى الصعوبة</label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full glass-light rounded-lg px-3 py-2 text-xs text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                >
                  <option value="mixed">متنوع</option>
                  <option value="easy">سهل</option>
                  <option value="medium">متوسط</option>
                  <option value="hard">صعب</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">إجمالي الدرجات</label>
                <input
                  type="number"
                  min={0}
                  value={totalMarks}
                  onChange={(e) => setTotalMarks(e.target.value)}
                  placeholder="مثال: 20"
                  className="w-full glass-light rounded-lg px-3 py-2 text-xs text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="glass-light rounded-xl p-4 space-y-2">
            <label className="flex items-center gap-2 text-sm font-bold text-white mb-1">
              <AlignRight size={16} className="text-emerald-400" />
              خيارات الاستخراج
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={preserveWording}
                onChange={(e) => setPreserveWording(e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-500"
              />
              <span className="text-xs text-slate-300">الحفاظ على النص الأصلي للأسئلة (عدم إعادة الصياغة)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={generateAnswerKey}
                onChange={(e) => setGenerateAnswerKey(e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-500"
              />
              <span className="text-xs text-slate-300">إنشاء مفتاح إجابة وتحديد الإجابات الصحيحة</span>
            </label>
          </div>

          {/* Summary */}
          <div className="glass-light rounded-xl p-3 border border-emerald-500/20 text-xs space-y-1">
            <p className="text-slate-400">ملخص الإعدادات:</p>
            <p className="text-slate-300">
              المصدر: <span className="font-bold text-emerald-400">{sourceMode === 'extract' ? 'استخراج' : sourceMode === 'generate' ? 'توليد' : 'استخراج + توليد'}</span>
              {sourceMode !== 'extract' && totalRequested > 0 && (
                <> • عدد الأسئلة: <span className="font-bold text-emerald-400">{totalRequested}</span></>
              )}
              {lessons && <> • الدروس: <span className="text-sky-400">{lessons}</span></>}
              {totalMarks && <> • الدرجات: <span className="text-amber-400">{totalMarks}</span></>}
            </p>
          </div>

          <div className="flex justify-between gap-3 pt-2 border-t border-white/10">
            <button
              onClick={() => setPhase('input')}
              className="px-4 py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-white/10 transition flex items-center gap-1.5"
            >
              <ArrowRight size={16} /> رجوع للمصدر
            </button>
            <button
              onClick={() => void handleTranscribe()}
              className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition flex items-center gap-2"
            >
              <ArrowLeft size={16} />
              {sourceMode === 'extract' ? 'بدء الاستخراج' : 'بدء التوليد والاستخراج'}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // ── PROCESSING PHASE ──
  if (phase === 'processing') {
    return (
      <Modal open={open} onClose={handleClose} title="جارٍ التفريغ..." size="md">
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 size={40} className="animate-spin text-emerald-400" />
          <p className="text-slate-300 text-sm">جارٍ نسخ وتفريغ وتصنيف الأسئلة من المصدر...</p>
          <p className="text-slate-500 text-xs">قد يستغرق هذا بعض الوقت للملفات الكبيرة</p>
        </div>
      </Modal>
    );
  }

  // ── REVIEW PHASE ──
  return (
    <Modal open={open} onClose={handleClose} title="مراجعة الأسئلة المفرغة" size="lg">
      <div className="space-y-4">
        {/* Status bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span className="flex items-center gap-1.5 text-white font-bold">
              <Check size={16} className="text-emerald-400" />
              {totalQuestions} سؤال
            </span>
            {incompleteCount > 0 && (
              <span className="flex items-center gap-1.5 text-amber-400 text-xs">
                <AlertTriangle size={14} />
                {incompleteCount} غير مكتمل
              </span>
            )}
            {uncertainCount > 0 && (
              <span className="flex items-center gap-1.5 text-red-400 text-xs">
                <AlertTriangle size={14} />
                {uncertainCount} يحتاج مراجعة
              </span>
            )}
            {selectedCount > 0 && (
              <span className="flex items-center gap-1.5 text-sky-400 text-xs font-bold">
                <ListChecks size={14} />
                {selectedCount} محدد
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAnswers(!showAnswers)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light text-slate-300 hover:text-white text-xs font-semibold transition"
            >
              {showAnswers ? <><EyeOff size={14} /> إخفاء الإجابات</> : <><Eye size={14} /> إظهار الإجابات</>}
            </button>
            <button
              onClick={addEmptyQuestion}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light text-slate-300 hover:text-emerald-400 text-xs font-semibold transition"
            >
              <Plus size={14} /> إضافة سؤال
            </button>
          </div>
        </div>

        {/* AI Actions toolbar */}
        <div className="glass-light rounded-xl p-3 border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Wand2 size={15} className="text-emerald-400 flex-shrink-0" />
            <span className="text-xs font-bold text-white">
              إجراءات الذكاء الاصطناعي
            </span>
            <span className="text-[10px] text-slate-400 mr-auto">
              {selectedCount > 0 ? `يُطبق على ${selectedCount} سؤال محدد` : 'يُطبق على كل الأسئلة'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            <button
              onClick={selectedCount > 0 ? deselectAll : selectAll}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold glass-light text-slate-300 hover:text-white transition"
            >
              {selectedCount > 0 ? 'إلغاء التحديد' : 'تحديد الكل'}
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(Object.keys(ACTION_LABELS) as AIAction[]).filter((a) => a !== 'extract').map((action) => (
              <button
                key={action}
                onClick={() => void applyAction(action)}
                disabled={actionLoading || questions.length === 0}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25 border border-emerald-500/20 transition disabled:opacity-40 flex items-center gap-1"
              >
                {actionLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
          {actionLoading && (
            <div className="flex items-center gap-2 mt-2 text-xs text-emerald-400">
              <Loader2 size={12} className="animate-spin" />
              <span>جارٍ معالجة الأسئلة بالذكاء الاصطناعي...</span>
            </div>
          )}
          {/* Marks distribution input */}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5">
            <span className="text-[10px] text-slate-400">إجمالي الدرجات لتوزيعها:</span>
            <input
              type="number"
              min={0}
              value={totalMarksInput}
              onChange={(e) => setTotalMarksInput(e.target.value)}
              placeholder="مثال: 20"
              className="w-20 glass-light rounded-lg px-2 py-1 text-[11px] text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            />
            <span className="text-[10px] text-slate-500">(يستخدم مع إجراء توزيع الدرجات)</span>
          </div>
        </div>

        {questions.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">
            لم يتم العثور على أسئلة. عُد وأضف مصدراً آخر.
            <div className="mt-3">
              <button
                onClick={() => setPhase('setup')}
                className="px-4 py-2 rounded-lg glass-light text-slate-300 text-sm hover:bg-white/10 transition"
              >
                رجوع للمصدر
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            <AnimatePresence>
              {questions.map((q, idx) => {
                const issues = detectIssues(q, questions);
                const hasIssues = issues.length > 0;
                const isSelected = selectedIds.has(q.tempId);
                return (
                  <motion.div
                    key={q.tempId}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className={`glass-light rounded-xl p-3 border-2 ${
                      isSelected
                        ? 'border-sky-500/40 bg-sky-500/5'
                        : q.uncertain
                        ? 'border-red-500/30'
                        : hasIssues
                        ? 'border-amber-500/30'
                        : 'border-white/10'
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      {/* Selection checkbox */}
                      <button
                        onClick={() => toggleSelect(q.tempId)}
                        className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 transition ${
                          isSelected
                            ? 'bg-sky-500 text-white'
                            : 'glass-light text-slate-500 hover:bg-white/10'
                        }`}
                      >
                        {isSelected && <Check size={12} />}
                      </button>

                      <span className="w-6 h-6 rounded-lg bg-emerald-500/15 flex items-center justify-center text-[10px] font-bold text-emerald-400 flex-shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="flex-1 space-y-2">
                        {(q.uncertain || hasIssues) && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {q.uncertain && (
                              <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                                <AlertTriangle size={10} /> نص غير واضح
                              </span>
                            )}
                            {issues.map((issue, i) => (
                              <span key={i} className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                                <AlertTriangle size={10} /> {issue}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <select
                            value={q.type}
                            onChange={(e) => updateQuestion(q.tempId, { type: e.target.value as QuestionType })}
                            className="glass-light rounded-lg px-2 py-1 text-[11px] text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                          >
                            <option value="mcq">اختيارات</option>
                            <option value="true_false">صح/خطأ</option>
                            <option value="fill_blank">أكمل الفراغ</option>
                            <option value="short_answer">إجابة قصيرة</option>
                            <option value="essay">مقالي</option>
                          </select>
                          <span className="text-[10px] text-slate-500">الدرجة:</span>
                          <input
                            type="number"
                            min={0}
                            value={q.marks}
                            onChange={(e) => updateQuestion(q.tempId, { marks: parseInt(e.target.value) || 0 })}
                            className="w-16 glass-light rounded-lg p-1 text-xs text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                          />
                        </div>

                        <textarea
                          value={q.text}
                          onChange={(e) => updateQuestion(q.tempId, { text: e.target.value })}
                          rows={2}
                          dir="rtl"
                          className={`w-full glass-light rounded-lg p-2 text-sm text-white border focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition ${
                            q.uncertain ? 'border-red-500/30 bg-red-500/5' : 'border-white/10'
                          }`}
                        />

                        {(q.type === 'fill_blank' || q.type === 'short_answer' || q.type === 'essay') && (
                          <div>
                            <label className="text-[10px] text-slate-400 block mb-1">الإجابة النموذجية</label>
                            {q.type === 'essay' ? (
                              <textarea
                                value={q.choices[0] || ''}
                                onChange={(e) => updateQuestion(q.tempId, { choices: [e.target.value] })}
                                rows={2}
                                dir="rtl"
                                placeholder="اكتب الإجابة النموذجية هنا..."
                                className="w-full glass-light rounded-lg p-2 text-xs text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                              />
                            ) : (
                              <input
                                type="text"
                                dir="rtl"
                                value={q.choices[0] || ''}
                                onChange={(e) => updateQuestion(q.tempId, { choices: [e.target.value] })}
                                placeholder="الإجابة الصحيحة..."
                                className="w-full glass-light rounded-lg p-1.5 text-xs text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                              />
                            )}
                          </div>
                        )}

                        {(q.type === 'mcq' || q.type === 'true_false') && (
                          <div className="space-y-1.5">
                            {q.type === 'mcq' && q.choices.map((ch, ci) => (
                              <div key={ci} className="flex items-center gap-2">
                                <button
                                  onClick={() => updateQuestion(q.tempId, { correct: ci })}
                                  className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold transition flex-shrink-0 ${
                                    q.correct === ci
                                      ? 'bg-emerald-500 text-white'
                                      : 'glass-light text-slate-400 hover:bg-white/10'
                                  }`}
                                >
                                  {showAnswers && q.correct === ci ? <Check size={12} /> : ARABIC_CHOICE_LABELS[ci] || String(ci + 1)}
                                </button>
                                <input
                                  value={ch}
                                  dir="rtl"
                                  onChange={(e) => {
                                    const newChoices = [...q.choices];
                                    newChoices[ci] = e.target.value;
                                    updateQuestion(q.tempId, { choices: newChoices });
                                  }}
                                  placeholder={`اختيار ${ARABIC_CHOICE_LABELS[ci] || ci + 1}`}
                                  className="flex-1 glass-light rounded-lg p-1.5 text-xs text-white border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                                />
                                <button
                                  onClick={() => removeChoice(q.tempId, ci)}
                                  className="p-1 rounded text-slate-400 hover:text-red-400 transition"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                            {q.type === 'mcq' && q.choices.length < 6 && (
                              <button
                                onClick={() => addChoice(q.tempId)}
                                className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 transition"
                              >
                                <Plus size={12} /> إضافة خيار
                              </button>
                            )}
                            {q.type === 'true_false' && (
                              <div className="flex items-center gap-2">
                                {['صح', 'خطأ'].map((label, ci) => (
                                  <button
                                    key={ci}
                                    onClick={() => updateQuestion(q.tempId, { correct: ci, choices: ['صح', 'خطأ'] })}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                                      q.correct === ci
                                        ? 'bg-emerald-500 text-white'
                                        : 'glass-light text-slate-400 hover:bg-white/10'
                                    }`}
                                  >
                                    {showAnswers && q.correct === ci ? `✓ ${label}` : label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={() => {
                            const copy: TranscribedQuestion = {
                              ...q,
                              tempId: makeTempId(),
                              text: q.text,
                              choices: [...q.choices],
                            };
                            setQuestions((prev) => {
                              const next = [...prev];
                              next.splice(idx + 1, 0, copy);
                              return next;
                            });
                          }}
                          className="p-1 rounded text-slate-400 hover:text-sky-400 transition"
                          title="نسخ"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => moveQuestion(idx, 'up')}
                          disabled={idx === 0}
                          className="p-1 rounded text-slate-400 hover:text-white transition disabled:opacity-20"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => moveQuestion(idx, 'down')}
                          disabled={idx === questions.length - 1}
                          className="p-1 rounded text-slate-400 hover:text-white transition disabled:opacity-20"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          onClick={() => removeQuestion(q.tempId)}
                          className="p-1 rounded text-slate-400 hover:text-red-400 transition"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {questions.length > 0 && (
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/10">
            <button
              onClick={() => setPhase('setup')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-white/10 transition"
            >
              <ArrowRight size={16} /> رجوع للإعدادات
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-lg glass-light text-slate-400 text-sm hover:bg-white/10 transition"
              >
                إلغاء
              </button>
              <button
                onClick={confirmImport}
                disabled={importing || incompleteCount > 0}
                className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {importing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                استيراد {totalQuestions} سؤال
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function mapType(t: string): string {
  const lower = t.toLowerCase().trim();
  const map: Record<string, string> = {
    mcq: 'mcq',
    true_false: 'true_false',
    fill_blank: 'fill_blank',
    short_answer: 'short_answer',
    essay: 'essay',
    complete: 'fill_blank',
    explain: 'essay',
    mention: 'essay',
    define: 'essay',
    compare: 'essay',
    problem: 'short_answer',
    image_question: 'essay',
    order_match: 'essay',
  };
  return map[lower] || 'essay';
}
