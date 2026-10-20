import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Trash2,
  Loader2,
  Search,
  Brain,
} from 'lucide-react';
import type { ExamLabQuestionBankItem } from '@/lib/examLabTypes';
import { QUESTION_TYPE_SHORT, DIFFICULTY_LABELS } from '@/lib/examLabTypes';
import { deleteExamLabQuestionBankItem } from '@/lib/examLabData';

type Props = {
  items: ExamLabQuestionBankItem[];
  loading: boolean;
  onBack: () => void;
  onRefresh: () => void;
};

export default function ExamLabQuestionBank({ items, loading, onBack, onRefresh }: Props) {
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('');

  const subjects = useMemo(() => {
    const s = new Set(items.map(i => i.subject).filter(Boolean));
    return Array.from(s);
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter(item => {
      if (search && !item.question_text.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterSubject && item.subject !== filterSubject) return false;
      return true;
    });
  }, [items, search, filterSubject]);

  async function handleDelete(id: string) {
    if (!confirm('حذف هذا السؤال من بنك الأسئلة؟')) return;
    try {
      await deleteExamLabQuestionBankItem(id);
      onRefresh();
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-amber-400" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition">
          <ArrowRight size={16} /> رجوع
        </button>
        <h2 className="text-lg font-bold text-white">بنك الأسئلة</h2>
      </div>

      {/* Filters */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search size={16} className="text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث في الأسئلة..."
            className="flex-1 bg-transparent text-sm text-white outline-none"
          />
        </div>
        <select
          value={filterSubject}
          onChange={e => setFilterSubject(e.target.value)}
          className="glass-light rounded-lg px-3 py-2 text-xs text-white outline-none"
        >
          <option value="" className="bg-slate-800">كل المواد</option>
          {subjects.map(s => <option key={s} value={s} className="bg-slate-800">{s}</option>)}
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center">
          <Brain size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">لا توجد أسئلة محفوظة في البنك بعد</p>
          <p className="text-xs text-slate-500 mt-1">عند اعتماد أسئلة في اختبار، يمكن حفظها في البنك لإعادة استخدامها</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className="glass-card rounded-xl p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{item.question_text}</p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400">{QUESTION_TYPE_SHORT[item.question_type]}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{item.marks} درجة</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400">{DIFFICULTY_LABELS[item.difficulty]}</span>
                    {item.subject && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300">{item.subject}</span>}
                    {item.lesson && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300">{item.lesson}</span>}
                  </div>
                  {item.answer && (
                    <p className="text-xs text-emerald-400/70 mt-2"><span className="font-bold">الإجابة:</span> {item.answer}</p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
