import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, Bot, User, Loader2, Sparkles, AlertCircle,
  TrendingDown, TrendingUp, Users, Wallet, ClipboardCheck,
  GraduationCap, Search, ChevronRight, RefreshCw,
} from 'lucide-react';
import { askPlatformAI } from '@/lib/platformAI';
import type { AIResult, ConversationContext } from '@/lib/platformAI';
import { useToast } from '@/components/ui/Toast';

type ChatMessage = {
  id: number;
  question: string;
  result: AIResult;
  isUser: boolean;
};

const SUGGESTED_QUESTIONS = [
  { icon: Users, text: 'عندي كام طالب في سادسة ابتدائي؟' },
  { icon: Search, text: 'عرضلي طلاب المجموعة 1' },
  { icon: ClipboardCheck, text: 'مين غاب في الحصة اللي فاتت؟' },
  { icon: TrendingDown, text: 'مين مستواه ضعيف؟' },
  { icon: Wallet, text: 'مين عليه فلوس شهر سبتمبر؟' },
  { icon: GraduationCap, text: 'مين محتاج متابعة؟' },
  { icon: TrendingUp, text: 'مين أكتر الطلاب غياباً؟' },
  { icon: Wallet, text: 'إجمالي المتبقي شهر سبتمبر كام؟' },
];

export default function AskPlatform() {
  const { showToast } = useToast();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const msgIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextRef = useRef<ConversationContext>({});

  useEffect(() => {
    if (loading) {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = setTimeout(() => {
        setLoading(false);
        showToast('استغرقت العملية وقتاً طويلاً — حاول مرة أخرى', 'error');
      }, 15000);
    } else {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    }
    return () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [loading, showToast]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  const ask = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setQuestion(trimmed);

    try {
      const result = await askPlatformAI(trimmed, contextRef.current);

      // Update context for follow-up questions
      contextRef.current = {
        lastIntent: result.intent,
        lastEntities: result.entities,
        lastStudentIds: result.records
          .filter((r) => r.student_id)
          .map((r) => r.student_id!),
        lastAnswer: result.answer,
      };

      msgIdRef.current += 1;
      setMessages((prev) => [
        ...prev,
        { id: msgIdRef.current, question: trimmed, result, isUser: false },
      ].slice(-20));
      setQuestion('');
    } catch {
      showToast('تعذّر معالجة السؤال', 'error');
    } finally {
      setLoading(false);
    }
  }, [loading, showToast]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ask(question);
    }
  };

  const resetConversation = () => {
    contextRef.current = {};
    setMessages([]);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <Bot size={20} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-1.5">
              اسأل المنصة
              <Sparkles size={14} className="text-amber-400" />
            </h2>
            <p className="text-xs text-slate-400">مساعد ذكي يجاوب على أي سؤال عن بيانات المنصة</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={resetConversation}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition glass-light rounded-lg px-3 py-1.5"
          >
            <RefreshCw size={12} /> محادثة جديدة
          </button>
        )}
      </div>

      {/* Input */}
      <div className="glass-card rounded-xl p-4 sticky top-0 z-10">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="اسأل عن أي حاجة في المنصة... مثال: مين غاب ومستواه ضعيف؟"
            className="flex-1 glass-light rounded-lg px-4 py-3 text-sm text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-60"
            disabled={loading}
            autoFocus
          />
          <button
            onClick={() => ask(question)}
            disabled={loading || !question.trim()}
            className="px-5 py-3 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50 flex-shrink-0"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>

        {/* Suggested questions */}
        {messages.length === 0 && !loading && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SUGGESTED_QUESTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.text}
                  onClick={() => ask(s.text)}
                  disabled={loading}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl glass-light text-sm text-slate-300 hover:text-white hover:bg-white/10 transition disabled:opacity-50 text-right group"
                >
                  <Icon size={16} className="text-emerald-400 flex-shrink-0 group-hover:scale-110 transition" />
                  <span className="flex-1">{s.text}</span>
                  <ChevronRight size={14} className="text-slate-600 group-hover:text-slate-400 transition" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Loading */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 py-4 px-2"
          >
            <Loader2 className="animate-spin text-emerald-400 flex-shrink-0" size={20} />
            <span className="text-sm text-slate-400">ببحث في بيانات المنصة...</span>
            <motion.div
              className="flex gap-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 1.5, 1] }}
                  transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                />
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="space-y-6">
        <AnimatePresence mode="popLayout">
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              {/* User question */}
              <div className="flex items-start gap-2 justify-end">
                <div className="glass-light rounded-xl rounded-tr-sm p-3 max-w-[80%] border border-sky-500/20">
                  <p className="text-sm text-white">{msg.question}</p>
                </div>
                <div className="w-9 h-9 rounded-full bg-sky-600/20 flex items-center justify-center flex-shrink-0">
                  <User size={16} className="text-sky-400" />
                </div>
              </div>

              {/* AI answer */}
              <div className="flex items-start gap-2">
                <div className="w-9 h-9 rounded-full bg-emerald-600/20 flex items-center justify-center flex-shrink-0">
                  {msg.result.needsClarification ? (
                    <AlertCircle size={16} className="text-amber-400" />
                  ) : (
                    <Bot size={16} className="text-emerald-400" />
                  )}
                </div>
                <div className={`glass-card rounded-xl rounded-tl-sm p-4 max-w-[85%] ${msg.result.needsClarification ? 'border border-amber-500/30' : 'border border-emerald-500/15'}`}>
                  <p className="text-sm font-bold text-white mb-1 leading-relaxed">{msg.result.answer}</p>
                  {msg.result.summary && (
                    <p className="text-xs text-slate-400 mt-2 glass-light rounded-lg p-2">{msg.result.summary}</p>
                  )}
                  {msg.result.needsClarification && msg.result.clarificationQuestion && (
                    <p className="text-xs text-amber-400 mt-2 flex items-center gap-1.5">
                      <AlertCircle size={12} /> {msg.result.clarificationQuestion}
                    </p>
                  )}
                </div>
              </div>

              {/* Records */}
              {msg.result.records.length > 0 && (
                <div className="ml-11 space-y-1.5">
                  <p className="text-xs text-slate-500 mb-1">{msg.result.records.length} نتيجة</p>
                  <div className="space-y-1.5 max-h-96 overflow-y-auto modal-body pr-1">
                    {msg.result.records.map((r, i) => (
                      <RecordRow key={i} record={r} />
                    ))}
                  </div>
                </div>
              )}

              {/* Follow-up suggestions */}
              {msg.result.records.length > 0 && !msg.result.needsClarification && (
                <div className="ml-11 flex flex-wrap gap-2">
                  <FollowUpButton text="مين منهم عليه فلوس؟" onClick={() => ask('مين منهم عليه فلوس؟')} />
                  <FollowUpButton text="مين منهم مستواه ضعيف؟" onClick={() => ask('مين منهم مستواه ضعيف؟')} />
                  <FollowUpButton text="مين منهم غاب كتير؟" onClick={() => ask('مين منهم غاب كتير؟')} />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Empty state */}
      {messages.length === 0 && !loading && (
        <div className="text-center py-8">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-3">
            <Bot size={32} className="text-emerald-400/60" />
          </div>
          <p className="text-sm text-slate-400">اكتب سؤالك أو اختر من الاقتراحات فوق</p>
          <p className="text-xs text-slate-600 mt-1">المساعد بيفهم العربية العادية وبيتذكر آخر سؤال</p>
        </div>
      )}
    </div>
  );
}

function RecordRow({ record }: { record: AIResult['records'][number] }) {
  const hasAmount = record.amount !== undefined && record.amount > 0;
  const hasScore = record.score !== undefined;
  const hasReasons = record.reasons && record.reasons.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="glass-light rounded-xl p-3 flex items-start justify-between gap-2 hover:bg-white/5 transition"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white truncate">
            {record.student_name ?? record.group_name ?? '—'}
          </p>
          {record.group_name && record.student_name && (
            <span className="text-[10px] text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full">{record.group_name}</span>
          )}
          {record.grade_name && (
            <span className="text-[10px] text-slate-500">{record.grade_name}</span>
          )}
        </div>
        {record.date && <p className="text-[10px] text-slate-500 mt-0.5">{record.date}</p>}
        {record.status && (
          <span className="inline-block text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full mt-1">{record.status}</span>
        )}
        {record.details && <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{record.details}</p>}
        {hasReasons && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {record.reasons!.map((reason, i) => (
              <span key={i} className="text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">{reason}</span>
            ))}
          </div>
        )}
      </div>
      <div className="text-left flex-shrink-0 flex flex-col items-end gap-1">
        {hasAmount && (
          <span className="text-sm font-bold text-amber-400">{record.amount} ج.م</span>
        )}
        {hasScore && (
          <span className={`text-sm font-bold ${(record.score ?? 0) < 50 ? 'text-red-400' : 'text-emerald-400'}`}>{record.score}%</span>
        )}
      </div>
    </motion.div>
  );
}

function FollowUpButton({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-3 py-1.5 rounded-lg glass-light text-xs text-emerald-400 hover:text-white hover:bg-emerald-500/10 transition border border-emerald-500/20"
    >
      <ChevronRight size={12} /> {text}
    </button>
  );
}
