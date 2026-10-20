import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  Trash2,
  Copy,
  Library,
  X,
  Filter,
  Check,
  Loader2,
} from 'lucide-react';
import {
  fetchQuestionBank,
  createQuestionBankItem,
  deleteQuestionBankItem,
} from '@/lib/data';
import type { QuestionBankItem, QuestionType, ExamQuestion } from '@/lib/types';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

type Props = {
  open: boolean;
  onClose: () => void;
  gradeLevelId?: string;
  onUseQuestion?: (q: QuestionBankItem) => void;
};

const inputCls =
  'w-full glass-light rounded-xl py-2.5 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm';

const TYPE_LABELS: Record<string, string> = {
  mcq: 'اختيارات',
  essay: 'مقالي',
  true_false: 'صح/خطأ',
  fill_blank: 'أكمل الفراغ',
  short_answer: 'إجابة قصيرة',
};

export default function QuestionBank({ open, onClose, gradeLevelId, onUseQuestion }: Props) {
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterSubject, setFilterSubject] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveForm, setSaveForm] = useState({
    subject: '',
    topic: '',
    type: 'mcq' as QuestionType,
    question_text: '',
    choices: ['', '', '', ''],
    correct_choice_index: 0,
    model_answer: '',
    accepted_answers: '',
    points: '1',
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchQuestionBank({
        search: search || undefined,
        type: (filterType || undefined) as QuestionType | undefined,
        gradeLevelId,
      });
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [search, filterType, gradeLevelId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleSave = async () => {
    if (!saveForm.question_text.trim()) return;
    setSaving(true);
    try {
      await createQuestionBankItem({
        subject: saveForm.subject.trim() || null,
        topic: saveForm.topic.trim() || null,
        grade_level_id: gradeLevelId ?? null,
        type: saveForm.type,
        question_text: saveForm.question_text.trim(),
        choices: saveForm.type === 'mcq' ? saveForm.choices.filter((c) => c.trim()) : null,
        correct_choice_index: saveForm.type === 'mcq' ? saveForm.correct_choice_index : null,
        model_answer: (saveForm.type === 'essay' || saveForm.type === 'fill_blank' || saveForm.type === 'short_answer')
          ? saveForm.model_answer.trim() || null : null,
        accepted_answers: saveForm.accepted_answers.trim()
          ? saveForm.accepted_answers.split(',').map((s) => s.trim()).filter(Boolean) : null,
        points: parseFloat(saveForm.points) || 1,
      });
      setSaveOpen(false);
      setSaveForm({
        subject: '', topic: '', type: 'mcq', question_text: '',
        choices: ['', '', '', ''], correct_choice_index: 0,
        model_answer: '', accepted_answers: '', points: '1',
      });
      load();
    } catch {
      /* toast */
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setItems((prev) => prev.filter((q) => q.id !== id));
    try { await deleteQuestionBankItem(id); } catch { load(); }
  };

  const subjects = [...new Set(items.map((i) => i.subject).filter(Boolean))] as string[];

  return (
    <Modal open={open} onClose={onClose} title="بنك الأسئلة" size="lg">
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-[180px] relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في الأسئلة..."
              className={`${inputCls} pr-9`}
            />
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="glass-light rounded-lg px-3 py-2 text-xs text-white border border-slate-700/50 focus:outline-none"
          >
            <option value="">كل الأنواع</option>
            <option value="mcq">اختيارات</option>
            <option value="essay">مقالي</option>
            <option value="true_false">صح/خطأ</option>
            <option value="fill_blank">أكمل الفراغ</option>
            <option value="short_answer">إجابة قصيرة</option>
          </select>
          <select
            value={filterSubject}
            onChange={(e) => setFilterSubject(e.target.value)}
            className="glass-light rounded-lg px-3 py-2 text-xs text-white border border-slate-700/50 focus:outline-none"
          >
            <option value="">كل المواد</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button size="sm" onClick={() => setSaveOpen(true)}>
            <Plus size={14} /> حفظ سؤال
          </Button>
        </div>

        {/* Items */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-emerald-400" size={24} />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-10 text-slate-500">
            <Library size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">لا توجد أسئلة محفوظة في البنك</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto modal-body">
            <AnimatePresence>
              {items
                .filter((i) => !filterSubject || i.subject === filterSubject)
                .map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="glass-light rounded-xl p-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-sky-300 bg-sky-500/15 px-2 py-0.5 rounded-full">
                          {TYPE_LABELS[item.type] ?? item.type}
                        </span>
                        {item.subject && <span className="text-[10px] text-slate-500">{item.subject}</span>}
                        {item.topic && <span className="text-[10px] text-slate-600">— {item.topic}</span>}
                        <span className="text-[10px] text-amber-400">{item.points} درجة</span>
                      </div>
                      <p className="text-xs text-white font-semibold leading-relaxed">{item.question_text}</p>
                      {item.type === 'mcq' && item.choices && (
                        <ul className="mt-1 space-y-0.5">
                          {item.choices.map((c, i) => (
                            <li key={i} className={`text-[10px] ${i === item.correct_choice_index ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                              {['أ', 'ب', 'ج', 'د'][i] ?? i}) {c}
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.model_answer && (
                        <p className="text-[10px] text-amber-400/80 mt-1">الإجابة: {item.model_answer}</p>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {onUseQuestion && (
                        <button
                          onClick={() => onUseQuestion(item)}
                          className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-400 transition"
                          title="استخدام هذا السؤال"
                        >
                          <Copy size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </motion.div>
                ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Save new question to bank */}
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="حفظ سؤال في البنك" size="md">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">المادة</label>
              <input
                type="text"
                value={saveForm.subject}
                onChange={(e) => setSaveForm({ ...saveForm, subject: e.target.value })}
                className={inputCls}
                placeholder="مثال: رياضيات"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">الموضوع</label>
              <input
                type="text"
                value={saveForm.topic}
                onChange={(e) => setSaveForm({ ...saveForm, topic: e.target.value })}
                className={inputCls}
                placeholder="مثال: الكسور"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">نوع السؤال</label>
            <div className="flex gap-2 flex-wrap">
              {(['mcq', 'true_false', 'fill_blank', 'short_answer', 'essay'] as QuestionType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setSaveForm({ ...saveForm, type: t })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${saveForm.type === t ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400'}`}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1 block">نص السؤال</label>
            <textarea
              value={saveForm.question_text}
              onChange={(e) => setSaveForm({ ...saveForm, question_text: e.target.value })}
              rows={2}
              className={`${inputCls} resize-none`}
              placeholder="اكتب السؤال..."
            />
          </div>

          {saveForm.type === 'mcq' && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">الاختيارات (اضغط على الحرف للصحيح)</label>
              <div className="grid grid-cols-2 gap-2">
                {saveForm.choices.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      onClick={() => setSaveForm({ ...saveForm, correct_choice_index: i })}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold border-2 flex-shrink-0 ${saveForm.correct_choice_index === i ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' : 'border-slate-600 text-slate-500'}`}
                    >
                      {saveForm.correct_choice_index === i ? <Check size={12} /> : (['أ', 'ب', 'ج', 'د'][i] ?? i)}
                    </button>
                    <input
                      type="text"
                      value={c}
                      onChange={(e) => {
                        const next = [...saveForm.choices];
                        next[i] = e.target.value;
                        setSaveForm({ ...saveForm, choices: next });
                      }}
                      className={inputCls}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(saveForm.type === 'essay' || saveForm.type === 'fill_blank' || saveForm.type === 'short_answer') && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                {saveForm.type === 'fill_blank' ? 'الإجابة الصحيحة' : 'الإجابة النموذجية'}
              </label>
              <textarea
                value={saveForm.model_answer}
                onChange={(e) => setSaveForm({ ...saveForm, model_answer: e.target.value })}
                rows={2}
                className={`${inputCls} resize-none`}
              />
            </div>
          )}

          {saveForm.type === 'fill_blank' && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">إجابات مقبولة أخرى (مفصولة بفاصلة)</label>
              <input
                type="text"
                value={saveForm.accepted_answers}
                onChange={(e) => setSaveForm({ ...saveForm, accepted_answers: e.target.value })}
                className={inputCls}
                placeholder="مثال: 5, خمسة"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">الدرجة:</label>
            <input
              type="number"
              value={saveForm.points}
              onChange={(e) => setSaveForm({ ...saveForm, points: e.target.value })}
              className={`${inputCls} w-24`}
              min={0.5}
              step={0.5}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="secondary" onClick={() => setSaveOpen(false)}>إلغاء</Button>
            <Button size="sm" onClick={handleSave} disabled={!saveForm.question_text.trim() || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} حفظ في البنك
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
