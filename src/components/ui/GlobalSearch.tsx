import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Users, Phone, Wallet, BookOpen } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { searchStudents } from '@/lib/data';
import type { Student } from '@/lib/types';
import FloatingLayer from './FloatingLayer';
import StudentViewModal360 from './StudentViewModal360';

type SearchResult = Student & { group_name?: string; grade_name?: string; stage_name?: string };

type Props = {
  onNavigate?: (student: SearchResult, target: 'finance' | 'group') => void;
};

export default function GlobalSearch({ onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [preview, setPreview] = useState<SearchResult | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const searchTokenRef = useRef(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateDropdownPos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = 320;
    const top = spaceBelow < dropdownHeight && rect.top > dropdownHeight
      ? rect.top - dropdownHeight - 8
      : rect.bottom + 6;
    setDropdownPos({ top, left: rect.left, width: rect.width });
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    const token = ++searchTokenRef.current;
    setLoading(true);
    try {
      const data = await searchStudents(q.trim());
      if (token !== searchTokenRef.current) return;
      setResults(data);
      setOpen(true);
      setHighlight(0);
    } catch {
      if (token !== searchTokenRef.current) return;
      setResults([]);
      setOpen(true);
    } finally {
      if (token === searchTokenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

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

  function handleSelect(s: SearchResult, target: 'finance' | 'group' = 'finance') {
    setOpen(false);
    setQuery('');
    setResults([]);
    if (onNavigate) {
      onNavigate(s, target);
    } else {
      // No external handler — open the student's full profile directly
      setPreview(s);
    }
  }

  function openPreview(s: SearchResult) {
    setOpen(false);
    setQuery('');
    setResults([]);
    setPreview(s);
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
      handleSelect(results[highlight], 'group');
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

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
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="ابحث عن اسم الطالب..."
            className="w-full bg-white/[0.03] border border-white/[0.06] rounded-full py-1.5 pr-8 pl-7 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40 focus:bg-white/[0.06] focus:ring-2 focus:ring-emerald-500/15 transition-all"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('');
                setResults([]);
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
            className="glass-card rounded-2xl border border-white/10 shadow-2xl shadow-black/50 max-h-80 overflow-y-auto modal-body"
          >
              {loading ? (
                <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                  <Search size={12} className="animate-pulse" /> جارٍ البحث...
                </div>
              ) : results.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  لا توجد نتائج لـ «{query}»
                </div>
              ) : (
                <ul className="py-1">
                  {results.map((s, i) => (
                    <li key={s.id}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => handleSelect(s, 'group')}
                      className={`px-3 py-2 flex items-center gap-2.5 transition cursor-pointer ${
                        i === highlight ? 'bg-emerald-500/10' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
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
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelect(s, 'group'); }}
                          className="p-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition"
                          title="البيانات الدراسية"
                        >
                          <BookOpen size={12} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSelect(s, 'finance'); }}
                          className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition"
                          title="الملف المالي والإيصالات"
                        >
                          <Wallet size={12} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </motion.div>
          </FloatingLayer>
        )}
      </div>

      <StudentViewModal360 open={!!preview} student={preview} onClose={() => setPreview(null)} />
    </>
  );
}
