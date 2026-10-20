import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Lock,
  ClipboardCheck,
  BookOpen,
  Award,
  Mic,
  Heart,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { todayDateString, formatArabicDate } from '@/lib/format';
import type { Group, Session } from '@/lib/types';

type ChecklistItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  done: boolean;
  detail: string;
};

type Props = {
  open: boolean;
  group: Group | null;
  session: Session | null;
  studentCount: number;
  onClose: () => void;
  onClosed?: () => void;
};

export default function SessionCloseChecklist({ open, group, session, studentCount, onClose, onClosed }: Props) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);

  const loadChecklist = useCallback(async () => {
    if (!session || !group) return;
    setLoading(true);
    try {
      const sessionId = session.id;
      const date = session.session_date ?? todayDateString();

      const [attRes, hwRes, examRes, recitationRes, evalRes] = await Promise.all([
        supabase
          .from('attendance')
          .select('student_id, status')
          .eq('session_id', sessionId),
        supabase
          .from('homework')
          .select('id, title')
          .eq('session_id', sessionId),
        supabase
          .from('center_exams')
          .select('id, title')
          .eq('session_id', sessionId)
          .in('category', ['exam', 'sheet']),
        supabase
          .from('center_exams')
          .select('id, title')
          .eq('session_id', sessionId)
          .eq('category', 'recitation'),
        supabase
          .from('behavior_eval')
          .select('id')
          .eq('session_id', sessionId),
      ]);

      const attCount = (attRes.data ?? []).length;
      const hwList = (hwRes.data ?? []) as { id: string; title: string }[];
      const examList = (examRes.data ?? []) as { id: string; title: string }[];
      const recitationList = (recitationRes.data ?? []) as { id: string; title: string }[];
      const evalCount = (evalRes.data ?? []).length;

      // Check homework statuses
      let hwStatusCount = 0;
      if (hwList.length > 0) {
        const hwIds = hwList.map((h) => h.id);
        const { count } = await supabase
          .from('homework_status')
          .select('id', { count: 'exact', head: true })
          .in('homework_id', hwIds);
        hwStatusCount = count ?? 0;
      }

      // Check exam grades
      let examGradeCount = 0;
      if (examList.length > 0) {
        const examIds = examList.map((e) => e.id);
        const { count } = await supabase
          .from('center_grades')
          .select('id', { count: 'exact', head: true })
          .in('center_exam_id', examIds);
        examGradeCount = count ?? 0;
      }

      // Check recitation grades
      let recGradeCount = 0;
      if (recitationList.length > 0) {
        const recIds = recitationList.map((r) => r.id);
        const { count } = await supabase
          .from('center_grades')
          .select('id', { count: 'exact', head: true })
          .in('center_exam_id', recIds);
        recGradeCount = count ?? 0;
      }

      const items: ChecklistItem[] = [
        {
          key: 'attendance',
          label: 'الحضور',
          icon: <ClipboardCheck size={15} className="text-emerald-400" />,
          done: attCount >= studentCount && studentCount > 0,
          detail: attCount === 0
            ? 'لم يتم تسجيل الحضور'
            : `${attCount}/${studentCount} طالب`,
        },
        {
          key: 'homework',
          label: 'الواجب',
          icon: <BookOpen size={15} className="text-blue-400" />,
          done: hwList.length === 0 || hwStatusCount >= studentCount,
          detail: hwList.length === 0
            ? 'لا يوجد واجب لهذه الحصة'
            : hwStatusCount === 0
              ? 'لم يتم تسجيل حالات الواجب'
              : `${hwStatusCount}/${studentCount} طالب`,
        },
        {
          key: 'grades',
          label: 'الدرجات',
          icon: <Award size={15} className="text-amber-400" />,
          done: examList.length === 0 || examGradeCount >= studentCount,
          detail: examList.length === 0
            ? 'لا يوجد امتحان لهذه الحصة'
            : examGradeCount === 0
              ? 'لم يتم تسجيل الدرجات'
              : `${examGradeCount}/${studentCount} طالب`,
        },
        {
          key: 'recitation',
          label: 'التسميع',
          icon: <Mic size={15} className="text-purple-400" />,
          done: recitationList.length === 0 || recGradeCount >= studentCount,
          detail: recitationList.length === 0
            ? 'لا يوجد تسميع لهذه الحصة'
            : recGradeCount === 0
              ? 'لم يتم تسجيل التسميع'
              : `${recGradeCount}/${studentCount} طالب`,
        },
        {
          key: 'evaluations',
          label: 'تقييم السلوك',
          icon: <Heart size={15} className="text-pink-400" />,
          done: evalCount >= studentCount && studentCount > 0,
          detail: evalCount === 0
            ? 'لم يتم تسجيل تقييمات السلوك'
            : `${evalCount}/${studentCount} طالب`,
        },
      ];

      setChecklist(items);
    } catch {
      setChecklist([]);
    } finally {
      setLoading(false);
    }
  }, [session, group, studentCount]);

  // Load when opened
  const [prevOpen, setPrevOpen] = useState(false);
  if (open && !prevOpen) {
    setPrevOpen(true);
    void loadChecklist();
  }
  if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const allDone = checklist.length > 0 && checklist.every((c) => c.done);
  const incompleteCount = checklist.filter((c) => !c.done).length;

  async function handleClose() {
    if (!session) return;
    setClosing(true);
    try {
      // Mark all homework for this session as closed
      await supabase
        .from('homework')
        .update({ is_closed: true })
        .eq('session_id', session.id);
      onClosed?.();
      onClose();
    } catch {
      // ignore
    } finally {
      setClosing(false);
    }
  }

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 flex items-center justify-center p-4 z-[100000] pointer-events-none"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />

        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 16 }}
          transition={{ type: 'spring', damping: 28, stiffness: 380 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-md glass-card rounded-3xl shadow-2xl overflow-hidden pointer-events-auto"
        >
          {/* Header */}
          <div className="px-5 py-4 bg-gradient-to-br from-sky-600/15 via-transparent to-transparent border-b border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock size={18} className="text-sky-400" />
                <h3 className="text-base font-bold text-white">إغلاق الحصة</h3>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition">
                <X size={16} />
              </button>
            </div>
            {group && session && (
              <p className="text-xs text-slate-400 mt-2">
                {group.name} — {session.title} — {formatArabicDate(session.session_date ?? todayDateString())}
              </p>
            )}
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto modal-body">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-sky-400" size={24} />
              </div>
            ) : (
              <>
                {checklist.map((item) => (
                  <div
                    key={item.key}
                    className={`glass-light rounded-xl p-3 flex items-center gap-3 border ${
                      item.done ? 'border-emerald-500/20' : 'border-amber-500/20'
                    }`}
                  >
                    <div className="flex-shrink-0 p-1.5 rounded-lg bg-white/[0.04]">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white">{item.label}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">{item.detail}</p>
                    </div>
                    <div className="flex-shrink-0">
                      {item.done ? (
                        <CheckCircle2 size={18} className="text-emerald-400" />
                      ) : (
                        <AlertTriangle size={18} className="text-amber-400" />
                      )}
                    </div>
                  </div>
                ))}

                {/* Summary */}
                <div className={`rounded-xl p-4 text-center border ${
                  allDone
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-amber-500/10 border-amber-500/30'
                }`}>
                  {allDone ? (
                    <>
                      <CheckCircle2 className="mx-auto text-emerald-400 mb-2" size={28} />
                      <p className="text-sm font-bold text-emerald-400">الحصة مكتملة</p>
                      <p className="text-xs text-slate-400 mt-1">يمكنك إغلاق الحصة الآن</p>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="mx-auto text-amber-400 mb-2" size={28} />
                      <p className="text-sm font-bold text-amber-400">
                        يوجد {incompleteCount} عنصر ناقص
                      </p>
                      <p className="text-xs text-slate-400 mt-1">أكمل العناصر الناقصة قبل الإغلاق</p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          {!loading && (
            <div className="px-5 py-4 border-t border-white/[0.06]">
              <button
                onClick={handleClose}
                disabled={!allDone || closing}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition active:scale-95 ${
                  allDone
                    ? 'bg-sky-600 text-white hover:bg-sky-700'
                    : 'bg-white/5 text-slate-500 cursor-not-allowed'
                }`}
              >
                {closing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> جاري الإغلاق...
                  </span>
                ) : allDone ? (
                  'إغلاق الحصة'
                ) : (
                  'لا يمكن الإغلاق — أكمل النواقص'
                )}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
