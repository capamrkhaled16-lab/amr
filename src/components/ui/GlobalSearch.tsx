import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Users, Wallet, BookOpen, ClipboardList, FileText, User, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { searchStudents } from '@/lib/data';
import type { Student } from '@/lib/types';
import FloatingLayer from './FloatingLayer';
import StudentViewModal360 from './StudentViewModal360';

type SearchResult = Student & { group_name?: string; grade_name?: string; stage_name?: string; group_id?: string | null };

type SearchTarget = 'finance' | 'attendance' | 'homework' | 'exams' | 'profile';

type Props = {
  onNavigate?: (student: SearchResult, target: SearchTarget) => void;
};

export default function GlobalSearch({ onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [preview, setPreview] = useState<SearchResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const searchTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateDropdownPos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = 360;
    const top = spaceBelow < dropdownHeight && rect.top > dropdownHeight
      ? rect.top - dropdownHeight - 8
      : rect.bottom + 6;
    setDropdownPos({ top, left: rect.left, width: Math.max(rect.width, 320) });
  }, []);

  const runSearch = useCallback(async (q: string, isRetry = false) => {
    const trimmed = q.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setError(null);
      setOpen(false);
      return;
    }
    const token = ++searchTokenRef.current;
    setLoading(true);
    setError(null);
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const data = await searchStudents(trimmed);
      if (token !== searchTokenRef.current) return;
      setResults(data);
      setOpen(true);
      setHighlight(0);
      if (data.length === 0 && !isRetry) {
        setError(null);
      }
    } catch (err) {
      if (token !== searchTokenRef.current) return;
      if (ac.signal.aborted) return;
      setResults([]);
      setOpen(true);
      setError('تعذّر البحث — ضعيف في الإنترنت أو خطأ في الخادم');
    } finally {
      if (token === searchTokenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        (wrapRef.current && wrapRef.current.contains(target)) ||
        (dropdownRef.current && dropdownRef.current.contains(target))
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    updateDropdownPos();
    const onScroll = () => updateDropdownPos();
    const onResize = () => updateDropdownPos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, updateDropdownPos]);

  function handleSelect(s: SearchResult, target: SearchTarget) {
    setSelectedId(s.id);
    setOpen(false);
    if (target === 'profile') {
      setPreview(s);
    } else if (onNavigate) {
      onNavigate(s, target);
    } else {
      setPreview(s);
    }
  }

  function openPreview(s: SearchResult) {
    setSelectedId(s.id);
    setOpen(false);
    setPreview(s);
  }

  function reopenSearch() {
    setOpen(true);
    if (inputRef.current) inputRef.current.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openPreview(results[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const targetButtons: { target: SearchTarget; icon: typeof Wallet; label: string }[] = [
    { target: 'finance', icon: Wallet, label: 'ماليات' },
    { target: 'attendance', icon: BookOpen, label: 'حضور' },
    { target: 'homework', icon: ClipboardList, label: 'واجبات' },
    { target: 'exams', icon: FileText, label: 'امتحانات' },
    { target: 'profile', icon: User, label: 'الملف' },
  ];

  return (
    <>
      <div ref={wrapRef} className="relative flex-1 min-w-0 max-w-xs sm:max-w-sm">
        <div className="relative group">
          <Search
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none transition-colors group-focus-within:text-emerald-400"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(null); }}
            onKeyDown={onKeyDown}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            placeholder="ابحث بالاسم أو الرقم..."
            className="w-full bg-white/[0.03] border border-white/[0.06] rounded-full py-1.5 pr-8 pl-7 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40 focus:bg-white/[0.06] focus:ring-2 focus:ring-emerald-500/15 transition-all"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setResults([]);
                setError(null);
                setOpen(false);
              }}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {open && dropdownPos && (
          <FloatingLayer>
          <motion.div
            ref={dropdownRef}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, pointerEvents: 'auto' }}
            className="glass-card rounded-2xl border border-white/10 shadow-2xl shadow-black/50 max-h-[28rem] overflow-y-auto modal-body"
          >
              {loading ? (
                <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Search size={12} className="animate-pulse" /> جارٍ البحث...
                </div>
              ) : error ? (
                <div className="p-4 text-center space-y-3">
                  <div className="flex items-center justify-center gap-2 text-xs text-red-400">
                    <AlertCircle size={14} /> {error}
                  </div>
                  <button
                    onClick={() => runSearch(query, true)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-bold transition"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              ) : results.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  {query.trim() ? `لا توجد نتائج لـ «${query}»` : 'ابحث بالاسم أو رقم الطالب'}
                </div>
              ) : (
                <ul className="py-1">
                  {results.map((s, i) => {
                    const isSelected = selectedId === s.id;
                    return (
                      <li key={s.id}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => openPreview(s)}
                        className={`px-3 py-2.5 flex flex-col gap-2 transition cursor-pointer ${
                          isSelected
                            ? 'bg-[#d4af37]/15 border-l-2 border-[#d4af37] ring-1 ring-[#d4af37]/30'
                            : i === highlight
                              ? 'bg-[#d4af37]/10 border-l-2 border-[#d4af37]'
                              : 'hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 transition ${
                            isSelected || i === highlight ? 'bg-[#d4af37]/20 text-[#e5c65a]' : 'bg-emerald-500/15 text-emerald-400'
                          }`}>
                            {s.name.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-white font-semibold truncate">{s.name}</p>
                            <div className="flex items-center gap-1.5 text-[9px] text-slate-400 mt-0.5 flex-wrap">
                              {s.stage_name && (
                                <span className="flex items-center gap-0.5 text-emerald-300/70">
                                  <BookOpen size={8} /> {s.stage_name}
                                </span>
                              )}
                              {s.grade_name && (
                                <span className="text-sky-300/70">{s.grade_name}</span>
                              )}
                              {s.group_name && (
                                <span className="flex items-center gap-0.5">
                                  <Users size={9} /> {s.group_name}
                                </span>
                              )}
                              <span className="text-slate-600 font-mono" dir="ltr">{s.id.slice(0, 8)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-wrap pr-10">
                          {targetButtons.map(({ target, icon: Icon, label }) => (
                            <button
                              key={target}
                              onClick={(e) => { e.stopPropagation(); handleSelect(s, target); }}
                              className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[9px] font-bold bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition active:scale-95"
                              title={label}
                            >
                              <Icon size={11} /> {label}
                            </button>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
          </motion.div>
          </FloatingLayer>
        )}
      </div>

      <StudentViewModal360
        open={!!preview}
        student={preview}
        onClose={() => { setPreview(null); reopenSearch(); }}
      />
    </>
  );
}
