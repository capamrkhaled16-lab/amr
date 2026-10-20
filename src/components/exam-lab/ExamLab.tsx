import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FlaskConical,
  Plus,
  Library,
  Brain,
  ChevronLeft,
  WifiOff,
 Wifi,
} from 'lucide-react';
import { fetchExamLabExams, fetchExamLabQuestionBank, syncPendingOps } from '@/lib/examLabData';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { fetchStages } from '@/lib/data';
import type { AcademicStage } from '@/lib/types';
import type { ExamLabExam, ExamLabQuestionBankItem } from '@/lib/examLabTypes';
import type { ExtractedFile } from '@/lib/fileExtraction';
import ExamLabWizard from '@/components/exam-lab/ExamLabWizard';
import ExamLabLibrary from '@/components/exam-lab/ExamLabLibrary';
import ExamLabQuestionBank from '@/components/exam-lab/ExamLabQuestionBank';
import ExamLabEditor from '@/components/exam-lab/ExamLabEditor';

type View = 'home' | 'create' | 'library' | 'question-bank' | 'editor';

export default function ExamLab() {
  const [view, setView] = useState<View>('home');
  const [exams, setExams] = useState<ExamLabExam[]>([]);
  const [questionBank, setQuestionBank] = useState<ExamLabQuestionBankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<AcademicStage[]>([]);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const isOnline = useOnlineStatus();
  const [wizardData, setWizardData] = useState<{
    examInfo: Partial<ExamLabExam>;
    extractedContent: string;
    questionTypes: Partial<Record<string, number>>;
    difficulty: string;
    totalMarks: number | null;
    lessons: string;
    generationMode: string;
    extractedFiles?: ExtractedFile[];
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [examData, qbData, stageData] = await Promise.all([
        fetchExamLabExams(),
        fetchExamLabQuestionBank(),
        fetchStages(),
      ]);
      setExams(examData);
      setQuestionBank(qbData);
      setStages(stageData);
    } catch {
      setExams([]);
      setQuestionBank([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Safety: force-clear loading after 5s even if fetches hang
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 5000);
    return () => clearTimeout(t);
  }, [loading]);

  // Sync pending ops when coming back online
  useEffect(() => {
    if (isOnline) {
      syncPendingOps().then(() => loadData());
    }
  }, [isOnline]);

  function handleExamCreated(examId: string, data: typeof wizardData) {
    setEditingExamId(examId);
    setWizardData(data);
    setView('editor');
  }

  function handleEditExam(examId: string) {
    setEditingExamId(examId);
    setView('editor');
  }

  function handleBackToHome() {
    setView('home');
    setEditingExamId(null);
    setWizardData(null);
    loadData();
  }

  if (view === 'create') {
    return (
      <ExamLabWizard
        stages={stages}
        onBack={handleBackToHome}
        onExamCreated={handleExamCreated}
      />
    );
  }

  if (view === 'editor' && editingExamId) {
    return (
      <ExamLabEditor
        examId={editingExamId}
        stages={stages}
        wizardData={wizardData}
        onBack={handleBackToHome}
      />
    );
  }

  if (view === 'library') {
    return (
      <ExamLabLibrary
        exams={exams}
        loading={loading}
        onBack={() => setView('home')}
        onEditExam={handleEditExam}
        onRefresh={loadData}
      />
    );
  }

  if (view === 'question-bank') {
    return (
      <ExamLabQuestionBank
        items={questionBank}
        loading={loading}
        onBack={() => setView('home')}
        onRefresh={loadData}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Offline banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs font-bold"
          >
            <WifiOff size={14} />
            أنت تعمل بدون اتصال — يتم حفظ كل التغييرات محلياً وستتم مزامنتها عند عودة الاتصال
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-3xl p-6 sm:p-8 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-sky-500 via-blue-400 to-indigo-500" />
        <div className="absolute -top-20 -right-20 w-60 h-60 bg-sky-600/10 rounded-full blur-[80px]" />

        <div className="relative text-center">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="p-3 rounded-2xl bg-sky-500/15 border border-sky-400/20">
              <FlaskConical size={28} className="text-sky-400" />
            </div>
            <h2 className="text-2xl font-extrabold text-white">معمل الاختبارات</h2>
          </div>
          <p className="text-sm text-slate-400 max-w-2xl mx-auto">
            مختبر احترافي لإنشاء الاختبارات بالذكاء الاصطناعي وتوليد Prompts لـ Gemini Notebook من المحتوى التعليمي المرفوع
          </p>
        </div>
      </motion.div>

      {/* Action cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ActionCard
          icon={<Plus size={24} />}
          title="إنشاء اختبار جديد"
          subtitle="ابدأ بإنشاء اختبار جديد بالذكاء الاصطناعي أو Prompt لـ Gemini"
          color="sky"
          onClick={() => setView('create')}
        />
        <ActionCard
          icon={<Library size={24} />}
          title="بنك الاختبارات"
          subtitle={`${exams.length} اختبار محفوظ — عرض، تعديل، نسخ، طباعة`}
          color="emerald"
          onClick={() => setView('library')}
        />
        <ActionCard
          icon={<Brain size={24} />}
          title="بنك الأسئلة"
          subtitle={`${questionBank.length} سؤال محفوظ — أعد استخدام الأسئلة المعتمدة`}
          color="amber"
          onClick={() => setView('question-bank')}
        />
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  subtitle,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: 'sky' | 'emerald' | 'amber';
  onClick: () => void;
}) {
  const colorMap = {
    sky: 'border-sky-500/20 hover:border-sky-500/40 hover:bg-sky-500/5 text-sky-400',
    emerald: 'border-emerald-500/20 hover:border-emerald-500/40 hover:bg-emerald-500/5 text-emerald-400',
    amber: 'border-amber-500/20 hover:border-amber-500/40 hover:bg-amber-500/5 text-amber-400',
  };
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className={`glass-card rounded-2xl p-5 text-right border ${colorMap[color]} transition group cursor-pointer`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2.5 rounded-xl bg-white/[0.04] group-hover:bg-white/[0.08] transition">
          {icon}
        </div>
        <h3 className="text-base font-bold text-white">{title}</h3>
      </div>
      <p className="text-xs text-slate-400">{subtitle}</p>
      <div className="flex items-center gap-1 mt-3 text-xs font-bold opacity-60 group-hover:opacity-100 transition">
        <span>فتح</span>
        <ChevronLeft size={14} />
      </div>
    </motion.button>
  );
}
