import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, Smartphone, X, Clock, Award, FileText } from 'lucide-react';
import type { OnlineExam, ExamQuestion, ExamSection } from '@/lib/types';

type Props = {
  open: boolean;
  onClose: () => void;
  exam: OnlineExam | null;
  questions: ExamQuestion[];
  sections: ExamSection[];
};

export default function ExamPreview({ open, onClose, exam, questions, sections }: Props) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  const sortedQuestions = useMemo(
    () => [...questions].sort((a, b) => a.sort_order - b.sort_order),
    [questions]
  );

  const totalMarks = useMemo(
    () => sortedQuestions.reduce((s, q) => s + (q.points ?? 0), 0),
    [sortedQuestions]
  );

  const questionsBySection = useMemo(() => {
    const map = new Map<string | null, ExamQuestion[]>();
    for (const q of sortedQuestions) {
      const key = q.section_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(q);
    }
    return map;
  }, [sortedQuestions]);

  if (!open || !exam) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-4 pointer-events-none">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-slate-900 rounded-2xl border border-white/10 w-full max-w-4xl my-8 shadow-2xl pointer-events-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 sticky top-0 bg-slate-900 rounded-t-2xl z-10">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-white">معاينة الامتحان</h3>
            <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">معاينة فقط — لا تعديل</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 glass-light rounded-lg p-0.5">
              <button
                onClick={() => setDevice('desktop')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${device === 'desktop' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
              >
                <Monitor size={14} className="inline ml-1" /> سطح المكتب
              </button>
              <button
                onClick={() => setDevice('mobile')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${device === 'mobile' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
              >
                <Smartphone size={14} className="inline ml-1" /> جوال
              </button>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Preview body */}
        <div className={`p-6 transition-all ${device === 'mobile' ? 'max-w-sm mx-auto' : 'max-w-full'}`}>
          {/* Exam header as student sees it */}
          <div className="text-center mb-6 pb-4 border-b border-white/10">
            <h2 className="text-xl font-bold text-white mb-1">{exam.title}</h2>
            {exam.subject && <p className="text-sm text-sky-400">{exam.subject}</p>}
            {exam.description && <p className="text-xs text-slate-400 mt-2">{exam.description}</p>}
            <div className="flex items-center justify-center gap-4 mt-3 text-xs text-slate-400">
              <span className="flex items-center gap-1"><Clock size={12} className="text-amber-400" /> {exam.duration_minutes} دقيقة</span>
              <span className="flex items-center gap-1"><Award size={12} className="text-teal-400" /> {totalMarks} درجة</span>
              <span className="flex items-center gap-1"><FileText size={12} className="text-blue-400" /> {sortedQuestions.length} سؤال</span>
            </div>
          </div>

          {/* Sections + Questions */}
          {sections.length > 0 ? (
            <div className="space-y-6">
              {sections.map((section) => {
                const sectionQs = questionsBySection.get(section.id) ?? [];
                const globalIndex = sortedQuestions.findIndex((q) => q.id === (sectionQs[0]?.id ?? ''));
                return (
                  <div key={section.id}>
                    <div className="glass-light rounded-xl p-3 mb-3 border border-emerald-500/20">
                      <h3 className="text-sm font-bold text-emerald-300">{section.title}</h3>
                      {section.instructions && <p className="text-xs text-slate-400 mt-1">{section.instructions}</p>}
                    </div>
                    <div className="space-y-4">
                      {sectionQs.map((q, i) => (
                        <PreviewQuestion key={q.id} question={q} number={globalIndex + i + 1} />
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* Questions without a section */}
              {(() => {
                const unsectioned = questionsBySection.get(null) ?? [];
                if (unsectioned.length === 0) return null;
                const startIdx = sortedQuestions.length - unsectioned.length;
                return (
                  <div className="space-y-4">
                    {unsectioned.map((q, i) => (
                      <PreviewQuestion key={q.id} question={q} number={startIdx + i + 1} />
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="space-y-4">
              {sortedQuestions.map((q, i) => (
                <PreviewQuestion key={q.id} question={q} number={i + 1} />
              ))}
            </div>
          )}

          {sortedQuestions.length === 0 && (
            <div className="text-center py-10 text-slate-500">
              <FileText size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">لا توجد أسئلة لعرضها في المعاينة</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function PreviewQuestion({ question, number }: { question: ExamQuestion; number: number }) {
  const typeLabels: Record<string, string> = {
    mcq: 'اختيارات',
    essay: 'مقالي',
    true_false: 'صح/خطأ',
    fill_blank: 'أكمل الفراغ',
    short_answer: 'إجابة قصيرة',
  };

  return (
    <div className="glass-light rounded-xl p-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs font-bold">
          {number}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-relaxed">{question.question_text}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">{typeLabels[question.type] ?? question.type}</span>
            <span className="text-[10px] text-amber-400">{question.points} درجة</span>
          </div>
        </div>
      </div>

      {question.type === 'mcq' && question.choices && (
        <ul className="space-y-2 mr-10">
          {question.choices.map((c, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
              <span className="w-6 h-6 rounded-lg border border-slate-600 flex items-center justify-center text-xs flex-shrink-0">
                {['أ', 'ب', 'ج', 'د'][i] ?? i}
              </span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}

      {question.type === 'true_false' && (
        <div className="flex gap-3 mr-10">
          <span className="text-sm text-slate-300 px-3 py-1 rounded-lg border border-slate-600">صح</span>
          <span className="text-sm text-slate-300 px-3 py-1 rounded-lg border border-slate-600">خطأ</span>
        </div>
      )}

      {question.type === 'fill_blank' && (
        <div className="mr-10 mt-1">
          <div className="h-8 rounded-lg border-b-2 border-dashed border-slate-600" />
        </div>
      )}

      {question.type === 'short_answer' && (
        <div className="mr-10 mt-1">
          <div className="h-8 rounded-lg border border-slate-600/50 bg-white/5" />
        </div>
      )}

      {question.type === 'essay' && (
        <div className="mr-10 mt-1">
          <div className="h-20 rounded-lg border border-slate-600/50 bg-white/5" />
        </div>
      )}
    </div>
  );
}
