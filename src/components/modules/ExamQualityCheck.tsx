import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  ListChecks,
} from 'lucide-react';
import type { OnlineExam, ExamQuestion } from '@/lib/types';

type Props = {
  exam: OnlineExam | null;
  questions: ExamQuestion[];
  onPublish?: () => void;
  canPublish?: boolean;
};

type CheckResult = {
  id: string;
  severity: 'error' | 'warning' | 'info' | 'ok';
  title: string;
  detail: string;
};

export default function ExamQualityCheck({ exam, questions }: Props) {
  const checks = useMemo<CheckResult[]>(() => {
    const results: CheckResult[] = [];
    if (!exam) return results;

    // 1. Missing title
    if (!exam.title.trim()) {
      results.push({ id: 'title', severity: 'error', title: 'عنوان الامتحان مفقود', detail: 'يجب إدخال عنوان للامتحان قبل النشر.' });
    } else {
      results.push({ id: 'title', severity: 'ok', title: 'عنوان الامتحان', detail: `«${exam.title}»` });
    }

    // 2. Missing duration
    if (!exam.duration_minutes || exam.duration_minutes < 1) {
      results.push({ id: 'duration', severity: 'error', title: 'مدة الامتحان غير صحيحة', detail: 'يجب تحديد مدة لا تقل عن دقيقة واحدة.' });
    } else {
      results.push({ id: 'duration', severity: 'ok', title: 'مدة الامتحان', detail: `${exam.duration_minutes} دقيقة` });
    }

    // 3. No questions
    if (questions.length === 0) {
      results.push({ id: 'no_questions', severity: 'error', title: 'لا توجد أسئلة', detail: 'يجب إضافة سؤال واحد على الأقل قبل النشر.' });
    } else {
      results.push({ id: 'no_questions', severity: 'ok', title: 'عدد الأسئلة', detail: `${questions.length} سؤال` });
    }

    // 4. Questions without marks
    const noMarks = questions.filter((q) => !q.points || q.points <= 0);
    if (noMarks.length > 0) {
      results.push({ id: 'no_marks', severity: 'warning', title: 'أسئلة بلا درجات', detail: `${noMarks.length} سؤال بدون درجة محددة. الدرجة الافتراضية 1.` });
    }

    // 5. Empty questions
    const empty = questions.filter((q) => !q.question_text?.trim());
    if (empty.length > 0) {
      results.push({ id: 'empty', severity: 'error', title: 'أسئلة فارغة', detail: `${empty.length} سؤال بنص فارغ. يجب تعبئتها أو حذفها.` });
    }

    // 6. MCQ without choices
    const mcqNoChoices = questions.filter((q) => q.type === 'mcq' && (!q.choices || q.choices.filter((c) => c?.trim()).length < 2));
    if (mcqNoChoices.length > 0) {
      results.push({ id: 'mcq_choices', severity: 'error', title: 'أسئلة اختيارات ناقصة', detail: `${mcqNoChoices.length} سؤال اختيارات يحتاج اختيارين على الأقل.` });
    }

    // 7. MCQ without correct answer
    const mcqNoCorrect = questions.filter((q) => q.type === 'mcq' && (q.correct_choice_index === null || q.correct_choice_index === undefined));
    if (mcqNoCorrect.length > 0) {
      results.push({ id: 'mcq_correct', severity: 'warning', title: 'إجابة صحيحة غير محددة', detail: `${mcqNoCorrect.length} سؤال اختيارات بدون تحديد الإجابة الصحيحة — لن يتم التصحيح التلقائي.` });
    }

    // 8. True/false without correct answer
    const tfNoCorrect = questions.filter((q) => q.type === 'true_false' && q.correct_choice_index === null);
    if (tfNoCorrect.length > 0) {
      results.push({ id: 'tf_correct', severity: 'warning', title: 'سؤال صح/خطأ بدون إجابة', detail: `${tfNoCorrect.length} سؤال صح/خطأ بدون تحديد الإجابة الصحيحة.` });
    }

    // 9. Fill blank without answer
    const fillNoAnswer = questions.filter((q) => q.type === 'fill_blank' && !q.model_answer?.trim());
    if (fillNoAnswer.length > 0) {
      results.push({ id: 'fill_answer', severity: 'warning', title: 'أسئلة أكمل الفراغ بدون إجابة', detail: `${fillNoAnswer.length} سؤال أكمل بدون إجابة نموذجية — لن يتم التصحيح التلقائي.` });
    }

    // 10. Total marks
    const totalMarks = questions.reduce((s, q) => s + (q.points ?? 0), 0);
    if (totalMarks > 0) {
      results.push({ id: 'total_marks', severity: 'ok', title: 'إجمالي الدرجات', detail: `${totalMarks} درجة` });
    }

    // 11. Total marks mismatch
    if (exam.total_score && totalMarks > 0 && Math.abs(exam.total_score - totalMarks) > 0.01) {
      results.push({ id: 'mismatch', severity: 'warning', title: 'عدم تطابق الدرجة الكلية', detail: `الدرجة الكلية المحددة: ${exam.total_score} — مجموع درجات الأسئلة: ${totalMarks}. قد يحتاج الطالب لمعرفة أيهما الصحيح.` });
    }

    // 12. Duplicate sort_order (question numbers)
    const sortOrders = questions.map((q) => q.sort_order);
    const dupes = sortOrders.filter((s, i) => sortOrders.indexOf(s) !== i);
    if (dupes.length > 0) {
      results.push({ id: 'dupes', severity: 'warning', title: 'ترقيم مكرر', detail: `${dupes.length} سؤال له نفس رقم الترتيب — قد تظهر بترتيب غير صحيح.` });
    }

    return results;
  }, [exam, questions]);

  const errors = checks.filter((c) => c.severity === 'error');
  const warnings = checks.filter((c) => c.severity === 'warning');
  const oks = checks.filter((c) => c.severity === 'ok');
  const canPublish = errors.length === 0;

  const sevConfig = {
    error: { icon: AlertCircle, color: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/10' },
    warning: { icon: AlertTriangle, color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10' },
    ok: { icon: CheckCircle2, color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10' },
    info: { icon: Info, color: 'text-sky-400', border: 'border-sky-500/30', bg: 'bg-sky-500/10' },
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <ListChecks size={18} className="text-emerald-400" />
        <h3 className="text-sm font-bold text-white">فحص جودة الامتحان</h3>
        <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">تحقق فقط — لا تعديل</span>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="glass-light rounded-xl p-2 text-center border border-red-500/20">
          <p className="text-[10px] text-slate-400">أخطاء</p>
          <p className="text-lg font-bold text-red-400">{errors.length}</p>
        </div>
        <div className="glass-light rounded-xl p-2 text-center border border-amber-500/20">
          <p className="text-[10px] text-slate-400">تحذيرات</p>
          <p className="text-lg font-bold text-amber-400">{warnings.length}</p>
        </div>
        <div className="glass-light rounded-xl p-2 text-center border border-emerald-500/20">
          <p className="text-[10px] text-slate-400">سليم</p>
          <p className="text-lg font-bold text-emerald-400">{oks.length}</p>
        </div>
      </div>

      {/* Publish readiness */}
      <div className={`glass-light rounded-xl p-3 border ${canPublish ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
        <p className={`text-sm font-bold ${canPublish ? 'text-emerald-400' : 'text-red-400'}`}>
          {canPublish ? 'الامتحان جاهز للنشر' : 'لا يمكن النشر — أصلح الأخطاء أولاً'}
        </p>
      </div>

      {/* Checks list */}
      <div className="space-y-1.5">
        {checks.map((check) => {
          const cfg = sevConfig[check.severity];
          const Icon = cfg.icon;
          return (
            <motion.div
              key={check.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`glass-light rounded-lg p-2.5 border ${cfg.border} flex items-start gap-2.5`}
            >
              <div className={`flex-shrink-0 mt-0.5 p-1 rounded-lg ${cfg.bg}`}>
                <Icon size={12} className={cfg.color} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white">{check.title}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{check.detail}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
