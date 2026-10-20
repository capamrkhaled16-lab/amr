import { useMemo } from 'react';
import { Clock, Award, FileText, Printer } from 'lucide-react';
import type { OnlineExam, ExamQuestion, ExamSection } from '@/lib/types';

type Props = {
  exam: OnlineExam | null;
  questions: ExamQuestion[];
  sections: ExamSection[];
  onClose: () => void;
  answerKeyMode?: boolean;
  stageName?: string;
  gradeName?: string;
  groupName?: string;
};

export default function ExamPrintView({
  exam,
  questions,
  sections,
  onClose,
  answerKeyMode = false,
  stageName,
  gradeName,
  groupName,
}: Props) {
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

  if (!exam) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white print:bg-white print:static print:z-auto" style={{ color: '#1e293b' }}>
      {/* Toolbar — hidden when printing */}
      <div className="flex items-center justify-between p-3 border-b bg-slate-100 print:hidden sticky top-0">
        <h3 className="text-sm font-bold text-slate-700">
          {answerKeyMode ? 'طباعة مفتاح الإجابات' : 'طباعة الامتحان'}
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1.5"
          >
            <Printer size={14} /> طباعة
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-300 transition"
          >
            إغلاق
          </button>
        </div>
      </div>

      {/* Print page */}
      <div className="max-w-3xl mx-auto p-8 print:p-10" dir="rtl">
        {/* Header */}
        <div className="text-center mb-6 pb-4 border-b-2 border-slate-300">
          {exam.country && <p className="text-xs text-slate-500 mb-1">{exam.country}</p>}
          <h1 className="text-2xl font-bold text-slate-800">{exam.title}</h1>
          {exam.subject && <p className="text-sm text-slate-600 mt-1">المادة: {exam.subject}</p>}
          <div className="flex items-center justify-center gap-6 mt-3 text-xs text-slate-600">
            <span className="flex items-center gap-1"><Clock size={12} /> الزمن: {exam.duration_minutes} دقيقة</span>
            <span className="flex items-center gap-1"><Award size={12} /> الدرجة الكلية: {totalMarks}</span>
            {sortedQuestions.length > 0 && <span className="flex items-center gap-1"><FileText size={12} /> عدد الأسئلة: {sortedQuestions.length}</span>}
          </div>
        </div>

        {/* Student info fields */}
        {!answerKeyMode && (
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div className="border border-slate-300 rounded-lg p-2">
              <span className="text-slate-500 text-xs">اسم الطالب:</span>
              <div className="h-5" />
            </div>
            <div className="border border-slate-300 rounded-lg p-2">
              <span className="text-slate-500 text-xs">المجموعة/الفصل:</span>
              <div className="h-5" />
            </div>
            <div className="border border-slate-300 rounded-lg p-2">
              <span className="text-slate-500 text-xs">التاريخ:</span>
              <div className="h-5" />
            </div>
            <div className="border border-slate-300 rounded-lg p-2">
              <span className="text-slate-500 text-xs">الدرجة:</span>
              <div className="h-5" />
            </div>
          </div>
        )}

        {/* Answer Key header */}
        {answerKeyMode && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-center">
            <p className="text-sm font-bold text-amber-700">مفتاح الإجابات — للمعلم فقط</p>
          </div>
        )}

        {/* Exam description / instructions */}
        {exam.description && (
          <p className="text-sm text-slate-600 mb-4 text-center">{exam.description}</p>
        )}

        {/* Sections + Questions */}
        {sections.length > 0 ? (
          <div className="space-y-6">
            {sections.map((section) => {
              const sectionQs = questionsBySection.get(section.id) ?? [];
              const firstQ = sectionQs[0];
              const globalIdx = firstQ ? sortedQuestions.findIndex((q) => q.id === firstQ.id) : 0;
              return (
                <div key={section.id}>
                  <div className="mb-2">
                    <h2 className="text-base font-bold text-slate-800 border-b border-slate-300 pb-1">{section.title}</h2>
                    {section.instructions && <p className="text-xs text-slate-500 mt-1">{section.instructions}</p>}
                  </div>
                  <div className="space-y-3">
                    {sectionQs.map((q, i) => (
                      <PrintQuestion key={q.id} question={q} number={globalIdx + i + 1} answerKey={answerKeyMode} />
                    ))}
                  </div>
                </div>
              );
            })}
            {(() => {
              const unsectioned = questionsBySection.get(null) ?? [];
              if (unsectioned.length === 0) return null;
              const startIdx = sortedQuestions.length - unsectioned.length;
              return (
                <div className="space-y-3">
                  {unsectioned.map((q, i) => (
                    <PrintQuestion key={q.id} question={q} number={startIdx + i + 1} answerKey={answerKeyMode} />
                  ))}
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedQuestions.map((q, i) => (
              <PrintQuestion key={q.id} question={q} number={i + 1} answerKey={answerKeyMode} />
            ))}
          </div>
        )}

        {sortedQuestions.length === 0 && (
          <p className="text-center text-slate-400 py-8">لا توجد أسئلة</p>
        )}

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-slate-300 text-center text-xs text-slate-400">
          {stageName && gradeName && <p>{stageName} — {gradeName}</p>}
          {groupName && <p>{groupName}</p>}
          {exam.academic_year && <p>العام الدراسي: {exam.academic_year}</p>}
          {exam.term && <p>الترم: {exam.term}</p>}
        </div>
      </div>

      <style>{`
        @media print {
          body { background: white !important; }
          @page { margin: 1.5cm; }
        }
      `}</style>
    </div>
  );
}

function PrintQuestion({ question, number, answerKey }: { question: ExamQuestion; number: number; answerKey: boolean }) {
  const typeLabels: Record<string, string> = {
    mcq: 'اختيارات',
    essay: 'مقالي',
    true_false: 'صح/خطأ',
    fill_blank: 'أكمل',
    short_answer: 'إجابة قصيرة',
  };

  return (
    <div className="text-sm">
      <div className="flex items-start gap-2">
        <span className="font-bold text-slate-700 flex-shrink-0">{number}.</span>
        <div className="flex-1">
          <p className="font-semibold text-slate-800">{question.question_text}</p>
          <span className="text-xs text-slate-400 ml-2">({question.points} درجة)</span>
        </div>
      </div>

      {question.type === 'mcq' && question.choices && (
        <ul className="mt-2 mr-6 space-y-1">
          {question.choices.map((c, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded border border-slate-400 flex items-center justify-center text-[10px] flex-shrink-0">
                {['أ', 'ب', 'ج', 'د'][i] ?? i}
              </span>
              <span className="text-slate-700">{c}</span>
              {answerKey && i === question.correct_choice_index && (
                <span className="text-emerald-600 font-bold text-xs">✓ الإجابة الصحيحة</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {question.type === 'true_false' && (
        <div className="mt-1 mr-6 flex gap-4">
          <span className="text-slate-700">صح ( )</span>
          <span className="text-slate-700">خطأ ( )</span>
          {answerKey && question.correct_choice_index !== null && (
            <span className="text-emerald-600 font-bold text-xs">
              الإجابة: {question.correct_choice_index === 0 ? 'صح' : 'خطأ'}
            </span>
          )}
        </div>
      )}

      {question.type === 'fill_blank' && (
        <div className="mt-1 mr-6">
          {!answerKey ? (
            <div className="h-6 border-b-2 border-dotted border-slate-400" />
          ) : (
            <p className="text-emerald-600 font-bold text-xs">
              الإجابة: {question.model_answer ?? '—'}
              {question.accepted_answers && question.accepted_answers.length > 0 && (
                <span className="text-slate-500"> (مقبول أيضاً: {question.accepted_answers.join('، ')})</span>
              )}
            </p>
          )}
        </div>
      )}

      {question.type === 'short_answer' && (
        <div className="mt-1 mr-6">
          {!answerKey ? (
            <div className="h-8 border-b border-slate-400" />
          ) : (
            <p className="text-emerald-600 font-bold text-xs">الإجابة: {question.model_answer ?? 'تُصحّ يدوياً'}</p>
          )}
        </div>
      )}

      {question.type === 'essay' && (
        <div className="mt-1 mr-6">
          {!answerKey ? (
            <div className="h-16 border border-slate-200 rounded" />
          ) : (
            <p className="text-emerald-600 font-bold text-xs">الإجابة النموذجية: {question.model_answer ?? 'تُصحّ يدوياً'}</p>
          )}
        </div>
      )}
    </div>
  );
}
