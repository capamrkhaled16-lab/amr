import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  FileText,
  Settings,
  Sparkles,
  X,
  Image as ImageIcon,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  ClipboardPenLine,
  Bot,
  Layers,
  AlertCircle,
  Copy,
  Check,
  WifiOff,
  Save,
  BookOpen,
  ListChecks,
  Tags,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchGradeLevels, fetchGroups } from '@/lib/data';
import { upsertExamLabExam, insertExamLabAsset } from '@/lib/examLabData';
import { generateGeminiPrompt, generateExamWithAI, type SourceMode } from '@/lib/examLabAI';
import { extractFiles, combineExtractedText, collectImageBase64, type ExtractedFile } from '@/lib/fileExtraction';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type {
  ExamLabExam,
  GenerationMode,
  ExamTemplate,
  Difficulty,
  QuestionType,
} from '@/lib/examLabTypes';
import { QUESTION_TYPE_LABELS, TEMPLATE_LABELS, DIFFICULTY_LABELS } from '@/lib/examLabTypes';

type Step = 'info' | 'upload' | 'content' | 'settings' | 'generate';

type Props = {
  stages: { id: string; name: string }[];
  onBack: () => void;
  onExamCreated: (examId: string, data: {
    examInfo: Partial<ExamLabExam>;
    extractedContent: string;
    questionTypes: Partial<Record<string, number>>;
    difficulty: string;
    totalMarks: number;
    lessons: string;
    generationMode: string;
    extractedFiles?: ExtractedFile[];
  }) => void;
};

const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: 'info', label: 'بيانات الامتحان', icon: <FileText size={16} /> },
  { id: 'upload', label: 'رفع المحتوى', icon: <Upload size={16} /> },
  { id: 'content', label: 'تحليل المحتوى', icon: <Sparkles size={16} /> },
  { id: 'settings', label: 'إعدادات الأسئلة', icon: <Settings size={16} /> },
  { id: 'generate', label: 'إنشاء الاختبار', icon: <Bot size={16} /> },
];

const QUESTION_TYPES: QuestionType[] = [
  'mcq', 'true_false', 'complete', 'explain', 'mention', 'define',
  'compare', 'problem', 'image_question', 'essay', 'order_match',
];

const TEMPLATES: ExamTemplate[] = ['classic', 'modern', 'clean', 'center'];

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'mixed'];

export default function ExamLabWizard({ stages, onBack, onExamCreated }: Props) {
  const [step, setStep] = useState<Step>('info');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationSummary, setGenerationSummary] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  // Load persistent exam template defaults (teacher/center info saved once, reused for every new exam)
  const TEMPLATE_KEY = 'examLab_template_defaults';
  function loadTemplateDefaults(): Record<string, string> {
    try {
      const raw = localStorage.getItem(TEMPLATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function saveTemplateDefaults(data: Record<string, string>) {
    try {
      const existing = loadTemplateDefaults();
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify({ ...existing, ...data }));
    } catch { /* ignore */ }
  }

  const templateDefaults = loadTemplateDefaults();

  // Info state — pre-filled from persistent template defaults
  const [info, setInfo] = useState({
    teacher_name: templateDefaults.teacher_name ?? '',
    teacher_phone: templateDefaults.teacher_phone ?? '',
    center_name: templateDefaults.center_name ?? '',
    subject: templateDefaults.subject ?? '',
    stage_id: '',
    grade_level_id: '',
    group_id: '',
    stage_name: '',
    grade_name: '',
    group_name: '',
    book_name: templateDefaults.book_name ?? '',
    unit_name: '',
    chapter_name: '',
    lessons: '',
    exam_title: '',
    exam_date: '',
    duration_minutes: '' as string | number,
    total_marks: '' as string | number,
    template: 'classic' as ExamTemplate,
  });

  // Upload state
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [assetUrls, setAssetUrls] = useState<{ name: string; type: string; url: string }[]>([]);
  const [extractedFiles, setExtractedFiles] = useState<ExtractedFile[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const extractionRun = useRef(false);

  // Content state
  const [extractedContent, setExtractedContent] = useState('');

  // Settings state
  const [questionTypes, setQuestionTypes] = useState<Partial<Record<QuestionType, number>>>({});
  const [difficulty, setDifficulty] = useState<Difficulty>('mixed');
  const [smartDistribution, setSmartDistribution] = useState(true);
  const [sourceMode, setSourceMode] = useState<SourceMode>('notes');
  const [bankTypeMapping, setBankTypeMapping] = useState(false);

  // Generate state
  const [generationMode, setGenerationMode] = useState<GenerationMode>('both');
  const [modelCount, setModelCount] = useState(1);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [examId, setExamId] = useState<string | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState(false);
  const [previewPromptText, setPreviewPromptText] = useState('');
  const [templateSaved, setTemplateSaved] = useState(false);

  // Dependent dropdown data
  const [gradeLevels, setGradeLevels] = useState<{ id: string; name: string; stage_id: string }[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string; grade_level_id: string }[]>([]);
  const [gradesLoading, setGradesLoading] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // Fetch grades when stage changes — abort previous request on rapid switches
  useEffect(() => {
    if (!info.stage_id) {
      setGradeLevels([]);
      return;
    }
    let cancelled = false;
    setGradesLoading(true);
    fetchGradeLevels(info.stage_id)
      .then(data => { if (!cancelled) setGradeLevels(data); })
      .catch(() => { if (!cancelled) setGradeLevels([]); })
      .finally(() => { if (!cancelled) setGradesLoading(false); });
    return () => { cancelled = true; };
  }, [info.stage_id]);

  // Fetch groups when grade changes
  useEffect(() => {
    if (!info.grade_level_id) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    setGroupsLoading(true);
    fetchGroups(info.grade_level_id)
      .then(data => { if (!cancelled) setGroups(data); })
      .catch(() => { if (!cancelled) setGroups([]); })
      .finally(() => { if (!cancelled) setGroupsLoading(false); });
    return () => { cancelled = true; };
  }, [info.grade_level_id]);

  function handleStageChange(stageId: string) {
    const stage = stages.find(s => s.id === stageId);
    setInfo(prev => ({
      ...prev,
      stage_id: stageId,
      stage_name: stage?.name ?? '',
      grade_level_id: '',
      grade_name: '',
      group_id: '',
      group_name: '',
    }));
  }

  function handleGradeChange(gradeId: string) {
    const grade = gradeLevels.find(g => g.id === gradeId);
    setInfo(prev => ({
      ...prev,
      grade_level_id: gradeId,
      grade_name: grade?.name ?? '',
      group_id: '',
      group_name: '',
    }));
  }

  function handleGroupChange(groupId: string) {
    const group = groups.find(g => g.id === groupId);
    setInfo(prev => ({
      ...prev,
      group_id: groupId,
      group_name: group?.name ?? '',
    }));
  }

  async function handleFileUpload(newFiles: FileList | null) {
    if (!newFiles) return;
    const fileArr = Array.from(newFiles);
    setFiles(prev => [...prev, ...fileArr]);

    // Generate previews for image files immediately
    const previews: Record<string, string> = {};
    for (const f of fileArr) {
      if (f.type.startsWith('image/')) {
        previews[f.name] = URL.createObjectURL(f);
      }
    }
    setFilePreviews(prev => ({ ...prev, ...previews }));

    // Auto-extract content immediately (single pass — no double extraction)
    setExtracting(true);
    try {
      console.log('[ExamLab] Extracting', fileArr.length, 'new files');
      const results = await extractFiles(fileArr);
      console.log('[ExamLab] Extraction results:', results.map(r => ({ name: r.name, textLen: r.text.length, status: r.status })));

      const mergedExtracted = [...extractedFiles];
      for (const r of results) {
        const idx = mergedExtracted.findIndex(m => m.name === r.name && m.size === r.size);
        if (idx >= 0) mergedExtracted[idx] = r;
        else mergedExtracted.push(r);
      }
      setExtractedFiles(mergedExtracted);

      const combined = combineExtractedText(mergedExtracted);
      console.log('[ExamLab] Combined text length:', combined.length);
      if (combined.trim()) {
        setExtractedContent(combined);
      }
    } finally {
      setExtracting(false);
    }
  }

  function removeFile(index: number) {
    const removed = files[index];
    setFiles(prev => prev.filter((_, i) => i !== index));
    setExtractedFiles(prev => prev.filter((_, i) => i !== index));
    if (removed && filePreviews[removed.name]) {
      URL.revokeObjectURL(filePreviews[removed.name]);
      setFilePreviews(prev => { const n = { ...prev }; delete n[removed.name]; return n; });
    }
  }

  function moveFile(index: number, dir: -1 | 1) {
    setFiles(prev => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const uploadFiles = useCallback(async (examId: string) => {
    setUploading(true);
    const urls: { name: string; type: string; url: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Skip cloud upload when offline — files are still available locally for OCR/extraction
      if (!isOnline) {
        urls.push({ name: file.name, type: file.type, url: filePreviews[file.name] ?? '' });
        continue;
      }
      const ext = file.name.split('.').pop();
      const fileName = `exam-lab/${examId}/${Date.now()}-${i}.${ext}`;
      try {
        const { error } = await supabase.storage
          .from('exam-assets')
          .upload(fileName, file);
        if (!error) {
          const { data: { publicUrl } } = supabase.storage
            .from('exam-assets')
            .getPublicUrl(fileName);
          urls.push({ name: file.name, type: file.type, url: publicUrl });
          await insertExamLabAsset({
            exam_id: examId,
            file_name: file.name,
            file_type: file.type,
            file_url: publicUrl,
            file_order: i,
            extracted_text: '',
          });
        }
      } catch {
        // skip failed uploads
      }
    }
    setAssetUrls(urls);
    setUploading(false);
  }, [files, isOnline, filePreviews]);

  // Re-extract content from all current files (manual refresh)
  async function extractContent() {
    if (files.length === 0) {
      setStep('content');
      return;
    }
    setExtracting(true);
    try {
      const results = await extractFiles(files);
      setExtractedFiles(results);
      const combined = combineExtractedText(results);
      setExtractedContent(combined);
      setStep('content');
    } finally {
      setExtracting(false);
    }
  }

  function updateQuestionType(type: QuestionType, count: number) {
    setQuestionTypes(prev => {
      const next = { ...prev };
      if (count <= 0) {
        delete next[type];
      } else {
        next[type] = count;
      }
      return next;
    });
  }

  const totalQuestions = Object.values(questionTypes).reduce((s, c) => s + (c ?? 0), 0);

  async function handleGenerate() {
    if (generating) return; // duplicate-click protection
    setGenerating(true);
    setGenerationError(null);
    setGenerationSummary(null);
    try {
      // 0. Save teacher/center info as persistent defaults for future exams
      saveTemplateDefaults({
        teacher_name: info.teacher_name,
        teacher_phone: info.teacher_phone,
        center_name: info.center_name,
        subject: info.subject,
        book_name: info.book_name,
      });

      // 1. Save exam record
      const newExamId = await upsertExamLabExam({
        teacher_name: info.teacher_name,
        teacher_phone: info.teacher_phone,
        center_name: info.center_name,
        subject: info.subject,
        stage_id: info.stage_id || null,
        grade_level_id: info.grade_level_id || null,
        group_id: info.group_id || null,
        stage_name: info.stage_name,
        grade_name: info.grade_name,
        group_name: info.group_name,
        book_name: info.book_name,
        unit_name: info.unit_name,
        chapter_name: info.chapter_name,
        lessons: info.lessons,
        exam_title: info.exam_title || 'اختبار جديد',
        exam_date: info.exam_date || null,
        duration_minutes: info.duration_minutes === '' ? null : Number(info.duration_minutes),
        total_marks: info.total_marks === '' ? null : Number(info.total_marks),
        generation_mode: generationMode,
        template: info.template,
        status: 'draft',
        difficulty: difficulty,
        question_types: questionTypes,
        extracted_content: extractedContent,
      });
      setExamId(newExamId);
      // Clear any draft since exam is now saved
      localStorage.removeItem('examLab_draft');

      // 2. Upload files
      if (files.length > 0) {
        await uploadFiles(newExamId);
      }

      // Convert info fields to match ExamLabExam types (string|number → number|null)
      const examInfo: Partial<ExamLabExam> = {
        ...info,
        duration_minutes: info.duration_minutes === '' ? null : Number(info.duration_minutes),
        total_marks: info.total_marks === '' ? null : Number(info.total_marks),
      };

      // 3. Generate based on mode
      if (generationMode === 'platform' || generationMode === 'both') {
        const images = collectImageBase64(extractedFiles);
        const result = await generateExamWithAI({
          extractedContent,
          examInfo,
          questionTypes,
          difficulty,
          totalQuestions,
          totalMarks: info.total_marks === '' ? 0 : Number(info.total_marks),
          lessons: info.lessons,
          images,
          sourceMode,
        });

        // Persist generated questions to the database
        if (result.questions.length > 0) {
          const { upsertExamLabQuestion } = await import('@/lib/examLabData');
          for (let qi = 0; qi < result.questions.length; qi++) {
            const q = result.questions[qi];
            await upsertExamLabQuestion({
              exam_id: newExamId,
              question_text: q.question_text,
              question_type: q.question_type,
              marks: q.marks ?? 1,
              difficulty: q.difficulty || difficulty,
              source_lesson: q.source_lesson || info.lessons || '',
              choices: q.choices || [],
              correct_answer: q.correct_answer || '',
              sort_order: qi,
              is_approved: false,
              version_label: 'A',
            });
          }

          // Create shuffled model versions (B, C) if requested
          if (modelCount > 1) {
            const { insertExamLabVersion } = await import('@/lib/examLabData');
            const baseOrder = result.questions.map((_, i) => i.toString());
            const labels = ['A', 'B', 'C'];
            for (let m = 0; m < modelCount; m++) {
              const shuffled = shuffleArray(baseOrder);
              await insertExamLabVersion(newExamId, labels[m], shuffled);
            }
          }

          // Show generation summary
          if (result.summary && result.summary.length > 0) {
            const summaryLines = result.summary.map(s => `${s.label}: ${s.generated}/${s.requested}`);
            const totalGenerated = result.summary.reduce((sum, s) => sum + s.generated, 0);
            const totalRequested = result.summary.reduce((sum, s) => sum + s.requested, 0);
            summaryLines.push(`الإجمالي: ${totalGenerated}/${totalRequested} سؤال`);
            if (result.allMatch) {
              setGenerationError(null);
              setGenerationSummary(`تم إنشاء الأسئلة بنجاح ✓\n${summaryLines.join('\n')}`);
            } else {
              setGenerationSummary(`تم إنشاء الأسئلة بنجاح ✓\n${summaryLines.join('\n')}`);
            }
          }
        } else if (result.warnings.length > 0) {
          setGenerationError(result.warnings.join('\n'));
        }
      }

      if (generationMode === 'gemini' || generationMode === 'both') {
        const prompt = generateGeminiPrompt(
          examInfo,
          extractedContent,
          questionTypes,
          difficulty,
          info.total_marks === '' ? null : Number(info.total_marks),
          info.lessons,
        sourceMode,
      );
        setGeneratedPrompt(prompt);
        // Save prompt to DB
        const { upsertExamLabPrompt } = await import('@/lib/examLabData');
        await upsertExamLabPrompt(newExamId, prompt, false);
      }

      // Navigate to editor
      onExamCreated(newExamId, {
        examInfo: examInfo,
        extractedContent,
        questionTypes,
        difficulty,
        totalMarks: info.total_marks === '' ? null : Number(info.total_marks) ?? null,
        lessons: info.lessons,
        generationMode,
        extractedFiles,
      });
    } catch (err) {
      console.error('[ExamLab] Generation failed:', err);
      const msg = extractErrorMessage(err);
      setGenerationError(msg);
    } finally {
      setGenerating(false);
    }
  }

  // Offline notice for generate step

  // Draft/resume: restore unfinished exam on mount
  useEffect(() => {
    const draft = localStorage.getItem('examLab_draft');
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.info) setInfo(prev => ({ ...prev, ...parsed.info }));
        if (parsed.extractedContent) setExtractedContent(parsed.extractedContent);
        if (parsed.questionTypes) setQuestionTypes(parsed.questionTypes);
        if (parsed.difficulty) setDifficulty(parsed.difficulty);
        if (parsed.generationMode) setGenerationMode(parsed.generationMode);
      } catch { /* ignore corrupt draft */ }
    }
  }, []);

  // Auto-save draft when info changes
  useEffect(() => {
    const draft = {
      info,
      extractedContent,
      questionTypes,
      difficulty,
      generationMode,
    };
    localStorage.setItem('examLab_draft', JSON.stringify(draft));
  }, [info, extractedContent, questionTypes, difficulty, generationMode]);

  const canProceed = () => {
    switch (step) {
      case 'info': return info.teacher_name && info.subject && info.exam_title;
      case 'upload': return true; // files optional
      case 'content': return extractedContent.length > 0 || files.length > 0;
      case 'settings':
        if (sourceMode === 'bank' && !bankTypeMapping) return extractedContent.length > 0 || files.length > 0;
        return totalQuestions > 0;
      case 'generate': return true;
    }
  };

  const stepIndex = STEPS.findIndex(s => s.id === step);

  return (
    <div className="space-y-6">
      {/* Offline banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold"
          >
            <WifiOff size={14} />
            وضع عدم الاتصال — يتم حفظ كل البيانات محلياً وستتم مزامنتها عند عودة الإنترنت
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition"
        >
          <ArrowRight size={16} />
          رجوع
        </button>
        <h2 className="text-lg font-bold text-white">إنشاء اختبار جديد</h2>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => {
                if (i <= stepIndex || canProceed()) setStep(s.id);
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition ${
                step === s.id
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                  : i < stepIndex
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'glass-light text-slate-500'
              }`}
            >
              {i < stepIndex ? <CheckCircle2 size={14} /> : s.icon}
              {s.label}
            </button>
            {i < STEPS.length - 1 && <div className="w-4 h-px bg-white/10" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      <AnimatePresence mode="wait">
        {step === 'info' && (
          <motion.div
            key="info"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card rounded-2xl p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-white mb-4">بيانات الامتحان</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="اسم المدرس" value={info.teacher_name} onChange={v => setInfo(p => ({ ...p, teacher_name: v }))} required />
              <Field label="رقم الهاتف" value={info.teacher_phone} onChange={v => setInfo(p => ({ ...p, teacher_phone: v }))} />
              <Field label="اسم المركز" value={info.center_name} onChange={v => setInfo(p => ({ ...p, center_name: v }))} />
              <Field label="المادة" value={info.subject} onChange={v => setInfo(p => ({ ...p, subject: v }))} required />
              <SelectField label="المرحلة" value={info.stage_id} onChange={handleStageChange} options={stages.map(s => ({ value: s.id, label: s.name }))} placeholder="— اختر المرحلة —" />
              <DependentSelectField
                label="الصف"
                value={info.grade_level_id}
                onChange={handleGradeChange}
                options={gradeLevels.map(g => ({ value: g.id, label: g.name }))}
                loading={gradesLoading}
                disabled={!info.stage_id}
                emptyMessage="لا توجد صفوف متاحة لهذه المرحلة"
                placeholder="— اختر الصف —"
              />
              <DependentSelectField
                label="المجموعة"
                value={info.group_id}
                onChange={handleGroupChange}
                options={groups.map(g => ({ value: g.id, label: g.name }))}
                loading={groupsLoading}
                disabled={!info.grade_level_id}
                emptyMessage="لا توجد مجموعات متاحة لهذا الصف"
                placeholder="— اختر المجموعة —"
              />
              <Field label="اسم المذكرة / الكتاب" value={info.book_name} onChange={v => setInfo(p => ({ ...p, book_name: v }))} />
              <Field label="اسم الوحدة" value={info.unit_name} onChange={v => setInfo(p => ({ ...p, unit_name: v }))} />
              <Field label="اسم الفصل" value={info.chapter_name} onChange={v => setInfo(p => ({ ...p, chapter_name: v }))} />
              <Field label="الدروس المطلوبة" value={info.lessons} onChange={v => setInfo(p => ({ ...p, lessons: v }))} placeholder="مثال: الدرس الأول، الثاني، الثالث" />
              <Field label="عنوان الامتحان" value={info.exam_title} onChange={v => setInfo(p => ({ ...p, exam_title: v }))} required />
              <Field label="تاريخ الامتحان" type="date" value={info.exam_date} onChange={v => setInfo(p => ({ ...p, exam_date: v }))} />
              <Field label="مدة الامتحان (دقيقة)" type="number" value={info.duration_minutes === '' ? '' : String(info.duration_minutes)} onChange={v => setInfo(p => ({ ...p, duration_minutes: v === '' ? '' : parseInt(v) || '' }))} placeholder="مثال: 60" />
              <Field label="الدرجة النهائية" type="number" value={info.total_marks === '' ? '' : String(info.total_marks)} onChange={v => setInfo(p => ({ ...p, total_marks: v === '' ? '' : parseInt(v) || '' }))} placeholder="مثال: 50" />
              <div>
                <label className="text-xs text-slate-400 font-medium mb-1.5 block">قالب الامتحان</label>
                <select
                  value={info.template}
                  onChange={e => setInfo(p => ({ ...p, template: e.target.value as ExamTemplate }))}
                  className="w-full glass-light rounded-xl px-3 py-2.5 text-sm text-white outline-none border border-white/[0.06] focus:border-sky-500/40 transition"
                >
                  {TEMPLATES.map(t => <option key={t} value={t} className="bg-slate-800">{TEMPLATE_LABELS[t]}</option>)}
                </select>
              </div>
            </div>

            {/* Save as default template button */}
            <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
              <button
                onClick={() => {
                  saveTemplateDefaults({
                    teacher_name: info.teacher_name,
                    teacher_phone: info.teacher_phone,
                    center_name: info.center_name,
                    subject: info.subject,
                    book_name: info.book_name,
                  });
                  setTemplateSaved(true);
                  setTimeout(() => setTemplateSaved(false), 2500);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-xs font-bold hover:bg-emerald-500/20 transition border border-emerald-500/20"
              >
                {templateSaved ? <Check size={14} /> : <Save size={14} />}
                {templateSaved ? 'تم حفظ البيانات الثابتة' : 'حفظ كبيانات ثابتة للامتحانات القادمة'}
              </button>
              <span className="text-[11px] text-slate-500">سيتم تعبئة هذه البيانات تلقائياً في كل امتحان جديد</span>
            </div>
          </motion.div>
        )}

        {step === 'upload' && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card rounded-2xl p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-white">رفع المحتوى التعليمي</h3>
            <p className="text-xs text-slate-400">ارفع الصور وملفات PDF والمستندات — المحتوى المرفوع هو المصدر الأساسي لتوليد الأسئلة</p>

            {/* Drop zone */}
            <label className="block">
              <input
                type="file"
                multiple
                accept="image/*,application/pdf,.doc,.docx"
                onChange={e => handleFileUpload(e.target.files)}
                className="hidden"
              />
              <div className="border-2 border-dashed border-white/15 rounded-2xl p-8 text-center cursor-pointer hover:border-sky-500/40 hover:bg-sky-500/5 transition">
                <Upload size={32} className="mx-auto text-slate-500 mb-3" />
                <p className="text-sm text-slate-300 font-bold">اضغط لرفع الملفات</p>
                <p className="text-xs text-slate-500 mt-1">صور، PDF، مستندات — يمكن رفع ملفات متعددة</p>
              </div>
            </label>

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((file, i) => (
                  <div key={i} className="glass-light rounded-xl p-3 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-white/[0.04] flex-shrink-0">
                      {file.type.startsWith('image/') ? <ImageIcon size={16} className="text-sky-400" /> : <FileText size={16} className="text-amber-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium truncate">{file.name}</p>
                      <p className="text-[10px] text-slate-500">{(file.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => moveFile(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-white/10 text-slate-400 disabled:opacity-30 transition">▲</button>
                      <button onClick={() => moveFile(i, 1)} disabled={i === files.length - 1} className="p-1 rounded hover:bg-white/10 text-slate-400 disabled:opacity-30 transition">▼</button>
                      <button onClick={() => removeFile(i)} className="p-1.5 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {step === 'content' && (
          <motion.div
            key="content"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">المحتوى المستخرج</h3>
              <button
                onClick={extractContent}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-400 text-xs font-bold hover:bg-sky-500/20 transition"
              >
                <Sparkles size={14} /> استخراج المحتوى
              </button>
            </div>
            <p className="text-xs text-slate-400">راجع المحتوى المستخرج وعدله قبل توليد الأسئلة. الأسئلة ستُبنى على هذا المحتوى فقط.</p>
            <textarea
              value={extractedContent}
              onChange={e => setExtractedContent(e.target.value)}
              rows={12}
              className="w-full glass-light rounded-xl p-4 text-sm text-white outline-none border border-white/[0.06] focus:border-sky-500/40 transition resize-y"
              placeholder="المحتوى المستخرج من الملفات المرفوعة سيظهر هنا..."
            />
          </motion.div>
        )}

        {step === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card rounded-2xl p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-white">إعدادات الأسئلة</h3>

            {/* Source mode — notes vs raw questions (FIRST — controls everything below) */}
            <div className="glass-light rounded-xl p-4 space-y-3">
              <div>
                <p className="text-sm font-bold text-white">نوع المحتوى المرفوع</p>
                <p className="text-xs text-slate-400 mt-0.5">حدد نوع المحتوى لضبط طريقة توليد الأسئلة</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { setSourceMode('notes'); setBankTypeMapping(false); }}
                  className={`p-3 rounded-xl border text-right transition ${sourceMode === 'notes' ? 'bg-sky-500/10 border-sky-500/40' : 'border-white/[0.06] hover:bg-white/[0.04]'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen size={16} className={sourceMode === 'notes' ? 'text-sky-400' : 'text-slate-400'} />
                    <span className={`text-sm font-bold ${sourceMode === 'notes' ? 'text-sky-400' : 'text-slate-300'}`}>مذكرات / شرح</span>
                  </div>
                  <p className="text-[11px] text-slate-400">المحرك يولد أسئلة جديدة من الشرح مع توزيع الأنواع</p>
                </button>
                <button
                  onClick={() => setSourceMode('bank')}
                  className={`p-3 rounded-xl border text-right transition ${sourceMode === 'bank' ? 'bg-emerald-500/10 border-emerald-500/40' : 'border-white/[0.06] hover:bg-white/[0.04]'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <ListChecks size={16} className={sourceMode === 'bank' ? 'text-emerald-400' : 'text-slate-400'} />
                    <span className={`text-sm font-bold ${sourceMode === 'bank' ? 'text-emerald-400' : 'text-slate-300'}`}>أسئلة جاهزة</span>
                  </div>
                  <p className="text-[11px] text-slate-400">المحرك يصيغ وينسق الأسئلة المرفوعة فقط دون توليد</p>
                </button>
              </div>
            </div>

            {/* Bank mode: direct ingestion info banner */}
            {sourceMode === 'bank' && !bankTypeMapping && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <ListChecks size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-emerald-400">استخراج مباشر للأسئلة المرفوعة</p>
                    <p className="text-xs text-emerald-300/80 mt-1 leading-relaxed">
                      سيتم أخذ الأسئلة المرفوعة كما هي وتنسيقها مباشرة دون الحاجة لإدخال أعداد أو توزيع أنواع يدوياً.
                      المحرك سيقرأ المحتوى ويصيغ الأسئلة الموجودة فقط دون توليد أي أسئلة جديدة.
                    </p>
                  </div>
                </div>
                {/* Optional type-mapping toggle */}
                <div className="pt-2 border-t border-emerald-500/20">
                  <button
                    onClick={() => setBankTypeMapping(true)}
                    className="flex items-center gap-2 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition"
                  >
                    <Tags size={14} />
                    تحديد أنواع الأسئلة يدوياً (اختياري)
                  </button>
                  <p className="text-[11px] text-slate-400 mt-1">فعّل هذا الخيار إذا أردت تصنيف الأسئلة المرفوعة حسب نوعها بدقة</p>
                </div>
              </div>
            )}

            {/* Bank mode with type mapping active: show a banner + back button */}
            {sourceMode === 'bank' && bankTypeMapping && (
              <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Tags size={16} className="text-sky-400" />
                  <span className="text-xs font-bold text-sky-400">تحديد أنواع الأسئلة من المحتوى المرفوع</span>
                </div>
                <button
                  onClick={() => { setBankTypeMapping(false); setQuestionTypes({}); }}
                  className="text-xs text-slate-400 hover:text-white transition"
                >
                  العودة للاستخراج المباشر
                </button>
              </div>
            )}

            {/* Difficulty — always shown */}
            <div>
              <label className="text-xs text-slate-400 font-medium mb-2 block">مستوى الصعوبة</label>
              <div className="flex flex-wrap gap-2">
                {DIFFICULTIES.map(d => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition ${
                      difficulty === d ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40' : 'glass-light text-slate-400'
                    }`}
                  >
                    {DIFFICULTY_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>

            {/* Question types matrix — shown for notes mode OR bank mode with type mapping */}
            {(sourceMode === 'notes' || (sourceMode === 'bank' && bankTypeMapping)) && (
              <div>
                <label className="text-xs text-slate-400 font-medium mb-2 block">
                  {sourceMode === 'bank' ? 'حدد أنواع الأسئلة الموجودة وعددها' : 'أنواع الأسئلة وعددها'}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {QUESTION_TYPES.map(type => (
                    <div key={type} className="glass-light rounded-xl p-3 flex items-center gap-3">
                      <span className="text-sm text-slate-300 flex-1">{QUESTION_TYPE_LABELS[type]}</span>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={questionTypes[type] ?? ''}
                        onChange={e => updateQuestionType(type, parseInt(e.target.value) || 0)}
                        className="w-16 glass-light rounded-lg px-2 py-1.5 text-sm text-white text-center outline-none border border-white/[0.06] focus:border-sky-500/40"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Smart distribution — only for notes mode */}
            {sourceMode === 'notes' && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smartDistribution}
                    onChange={e => setSmartDistribution(e.target.checked)}
                    className="w-4 h-4 rounded accent-sky-500"
                  />
                  <span className="text-sm text-slate-300">توزيع ذكي للأسئلة على جميع الدروس</span>
                </label>
              </div>
            )}

            {/* Multi-model selector */}
            <div>
              <label className="text-xs text-slate-400 font-medium mb-2 block">عدد النماذج (تلقائي الترتيب)</label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3].map(n => (
                  <button
                    key={n}
                    onClick={() => setModelCount(n)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                      modelCount === n
                        ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                        : 'glass-light text-slate-400'
                    }`}
                  >
                    {n === 1 ? 'نموذج واحد' : n === 2 ? 'نموذجان (أ/ب)' : '٣ نماذج (أ/ب/ج)'}
                  </button>
                ))}
              </div>
              {modelCount > 1 && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  سيتم إنشاء نسخ متعددة بترتيب أسئلة وخيارات مختلفة تلقائياً مع نفس المحتوى والدرجات
                </p>
              )}
            </div>

            {/* Summary — hidden in bank direct-ingestion mode */}
            {(sourceMode === 'notes' || (sourceMode === 'bank' && bankTypeMapping)) && (
              <div className="glass-light rounded-xl p-4 flex items-center justify-between">
                <span className="text-sm text-slate-400">إجمالي الأسئلة</span>
                <span className="text-2xl font-black text-sky-400">{totalQuestions}</span>
              </div>
            )}
            {sourceMode === 'bank' && !bankTypeMapping && (
              <div className="glass-light rounded-xl p-4 flex items-center justify-between">
                <span className="text-sm text-slate-400">الأسئلة المرفوعة</span>
                <span className="text-sm font-bold text-emerald-400">سيتم استخراجها تلقائياً</span>
              </div>
            )}
          </motion.div>
        )}

        {step === 'generate' && (
          <motion.div
            key="generate"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="glass-card rounded-2xl p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-white">طريقة إنشاء الاختبار</h3>

            <div className="grid grid-cols-1 gap-3">
              <GenerationOption
                icon={<ClipboardPenLine size={20} />}
                title="إنشاء الامتحان داخل المنصة"
                description="توليد الأسئلة باستخدام الذكاء الاصطناعي داخل المنصة"
                selected={generationMode === 'platform'}
                onClick={() => setGenerationMode('platform')}
              />
              <GenerationOption
                icon={<Bot size={20} />}
                title="إنشاء Prompt لـ Gemini Notebook"
                description="توليد Prompt احترافي جاهز للنسخ إلى Gemini Notebook"
                selected={generationMode === 'gemini'}
                onClick={() => setGenerationMode('gemini')}
              />
              <GenerationOption
                icon={<Layers size={20} />}
                title="الاثنين معًا"
                description="توليد الامتحان داخل المنصة + Prompt لـ Gemini من نفس المصدر"
                selected={generationMode === 'both'}
                onClick={() => setGenerationMode('both')}
              />
            </div>

            {/* Preview Prompt button — show the generated prompt before creating */}
            {(generationMode === 'gemini' || generationMode === 'both') && (
              <div className="space-y-3">
                <button
                  onClick={() => {
                    const prompt = generateGeminiPrompt(
                      examInfo,
                      extractedContent,
                      questionTypes,
                      difficulty,
                      info.total_marks,
                      info.lessons,
                      sourceMode,
                    );
                    setPreviewPromptText(prompt);
                    setPreviewPrompt(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl glass-light text-sky-400 text-sm font-bold hover:bg-sky-500/10 transition border border-sky-500/20"
                >
                  <ClipboardPenLine size={16} />
                  معاينة البرومبت قبل الإنشاء
                </button>

                {previewPrompt && previewPromptText && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-3"
                  >
                    {/* One-click copy button */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(previewPromptText);
                            setPromptCopied(true);
                            setTimeout(() => setPromptCopied(false), 2500);
                          } catch {
                            // Fallback: select text
                            const ta = document.createElement('textarea');
                            ta.value = previewPromptText;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            setPromptCopied(true);
                            setTimeout(() => setPromptCopied(false), 2500);
                          }
                        }}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition active:scale-95 ${
                          promptCopied
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-sky-600 text-white hover:bg-sky-700'
                        }`}
                      >
                        {promptCopied ? (
                          <>
                            <Check size={16} />
                            تم النسخ بنجاح!
                          </>
                        ) : (
                          <>
                            <Copy size={16} />
                            نسخ البرومبت بضغطة واحدة
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => setPreviewPrompt(false)}
                        className="px-3 py-2 rounded-xl glass-light text-slate-400 text-sm hover:bg-white/10 transition"
                      >
                        إخفاء
                      </button>
                    </div>

                    {/* Prompt preview textarea */}
                    <textarea
                      value={previewPromptText}
                      onChange={e => setPreviewPromptText(e.target.value)}
                      rows={16}
                      className="w-full glass-light rounded-xl p-4 text-xs text-white outline-none border border-white/[0.06] focus:border-sky-500/40 transition resize-y font-mono leading-relaxed"
                      dir="rtl"
                    />
                    <p className="text-[11px] text-slate-500">
                      البرومبت جاهز للنسخ إلى Gemini Notebook أو أي نموذج ذكاء اصطناعي. يمكنك تعديله قبل النسخ.
                    </p>
                  </motion.div>
                )}
              </div>
            )}

            {generationSummary && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-emerald-400">تم إنشاء الأسئلة بنجاح</p>
                    <pre className="text-xs text-emerald-300/80 mt-1 whitespace-pre-wrap font-sans">{generationSummary}</pre>
                  </div>
                </div>
              </div>
            )}

            {generationError && (
              <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="text-red-300 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-red-200">فشل إنشاء الاختبار</p>
                    <p className="text-xs text-red-100/90 mt-1 whitespace-pre-wrap">{generationError}</p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-200 pr-6">يمكنك المتابعة بإضافة الأسئلة يدوياً من داخل المحرر. سيتم حفظ الامتحان محلياً.</p>
              </div>
            )}

            {/* Offline notice on generate step */}
            {!isOnline && (generationMode === 'platform' || generationMode === 'both') && (
              <div className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200 font-medium">
                <div className="flex items-center gap-2">
                  <WifiOff size={14} />
                  توليد الذكاء الاصطناعي غير متاح بدون اتصال — سيتم إنشاء الامتحان ويمكنك إضافة الأسئلة يدوياً.
                </div>
              </div>
            )}

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-sky-600 text-white text-sm font-bold hover:bg-sky-700 transition active:scale-95 disabled:opacity-50"
            >
              {generating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  جاري الإنشاء...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  إنشاء الاختبار
                </>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => stepIndex > 0 ? setStep(STEPS[stepIndex - 1].id) : onBack()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl glass-light text-slate-300 text-sm font-bold hover:bg-white/10 transition"
        >
          <ArrowRight size={16} />
          السابق
        </button>
        {stepIndex < STEPS.length - 1 && (
          <button
            onClick={() => canProceed() && setStep(STEPS[stepIndex + 1].id)}
            disabled={!canProceed()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-bold hover:bg-sky-700 transition active:scale-95 disabled:opacity-50"
          >
            التالي
            <ArrowLeft size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', required, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-300 font-medium mb-1.5 block">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full glass-light rounded-xl px-3 py-2.5 text-sm text-white outline-none border border-white/[0.06] focus:border-sky-500/40 transition"
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-300 font-medium mb-1.5 block">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full glass-light rounded-xl px-3 py-2.5 text-sm text-white outline-none border border-white/[0.06] focus:border-sky-500/40 transition"
      >
        <option value="" className="bg-slate-800">{placeholder ?? '— غير محدد —'}</option>
        {options.map(o => <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>)}
      </select>
    </div>
  );
}

function DependentSelectField({ label, value, onChange, options, loading, disabled, emptyMessage, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  loading: boolean;
  disabled: boolean;
  emptyMessage: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-slate-300 font-medium mb-1.5 block">{label}</label>
      {loading ? (
        <div className="flex items-center gap-2 glass-light rounded-xl px-3 py-2.5 text-sm text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          جاري التحميل...
        </div>
      ) : disabled ? (
        <select
          disabled
          className="w-full glass-light rounded-xl px-3 py-2.5 text-sm text-slate-400 outline-none border border-white/[0.06] opacity-60"
        >
          <option value="">{placeholder ?? '— غير محدد —'}</option>
        </select>
      ) : options.length === 0 ? (
        <div className="glass-light rounded-xl px-3 py-2.5 text-xs text-sky-300 border border-sky-500/20">
          {emptyMessage}
        </div>
      ) : (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full glass-light rounded-xl px-3 py-2.5 text-sm text-white outline-none border border-white/[0.06] focus:border-sky-500/40 transition"
        >
          <option value="" className="bg-slate-800">{placeholder ?? '— غير محدد —'}</option>
          {options.map(o => <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>)}
        </select>
      )}
    </div>
  );
}

function GenerationOption({ icon, title, description, selected, onClick }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-right p-4 rounded-xl border transition ${
        selected
          ? 'bg-sky-500/10 border-sky-500/40 text-sky-400'
          : 'glass-light border-white/[0.06] text-slate-300 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-xl ${selected ? 'bg-sky-500/15' : 'bg-white/[0.04]'}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm font-bold">{title}</p>
          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
        </div>
        {selected && <CheckCircle2 size={20} className="mr-auto text-sky-400" />}
      </div>
    </button>
  );
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    const msg = typeof e.message === 'string' ? e.message : '';
    if (msg.includes('user_id')) return 'فشل حفظ الامتحان: جلسة المستخدم غير متاحة. تأكد من تسجيل الدخول.';
    if (msg.includes('network') || msg.includes('fetch')) return 'فشل الاتصال بقاعدة البيانات. تحقق من الإنترنت.';
    if (msg) return msg;
    if (typeof e.error === 'string' && e.error) return e.error;
    if (typeof e.details === 'string' && e.details) return e.details;
  }
  if (typeof err === 'string') return err;
  return 'حدث خطأ غير متوقع — تحقق من الاتصال بالإنترنت وحاول مرة أخرى';
}
