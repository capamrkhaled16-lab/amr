import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Users, CalendarPlus, FileText, Archive, BarChart3, UserPlus, X } from 'lucide-react';

type Command = {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
};

type CommandBarProps = {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  onSearchStudent: (query: string) => void;
};

export default function CommandBar({ open, onClose, onNavigate, onSearchStudent }: CommandBarProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = [
    { id: 'search', label: 'بحث عن طالب...', icon: <Search size={16} />, action: () => { if (query.trim()) onSearchStudent(query.trim()); onClose(); } },
    { id: 'add-student', label: 'إضافة طالب جديد', icon: <UserPlus size={16} />, action: () => { onNavigate('students'); onClose(); } },
    { id: 'attendance', label: 'تسجيل الحضور والغياب', icon: <CalendarPlus size={16} />, action: () => { onNavigate('attendance'); onClose(); } },
    { id: 'create-exam', label: 'إنشاء امتحان جديد', icon: <FileText size={16} />, action: () => { onNavigate('exams'); onClose(); } },
    { id: 'archive', label: 'فتح الأرشيف', icon: <Archive size={16} />, action: () => { onNavigate('archive'); onClose(); } },
    { id: 'reports', label: 'التقارير والإحصائيات', icon: <BarChart3 size={16} />, action: () => { onNavigate('reports'); onClose(); } },
    { id: 'grades', label: 'تسجيل الدرجات', icon: <Users size={16} />, action: () => { onNavigate('grades'); onClose(); } },
  { id: 'homework', label: 'الواجبات والسلوك', icon: <FileText size={16} />, action: () => { onNavigate('homework'); onClose(); } },
  { id: 'finances', label: 'الإدارة المالية', icon: <BarChart3 size={16} />, action: () => { onNavigate('finances'); onClose(); } },
  { id: 'settings', label: 'الإعدادات', icon: <Users size={16} />, action: () => { onNavigate('settings'); onClose(); } },
  ];

  const filtered = commands.filter((c) =>
    !query.trim() || c.label.includes(query.trim()) || c.id.includes(query.trim().toLowerCase())
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) cmd.action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filtered, selectedIndex, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 pointer-events-none"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto" />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            className="relative w-full max-w-lg glass-card rounded-2xl shadow-2xl overflow-hidden border border-white/10 pointer-events-auto"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
              <Search size={18} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث أو اختر إجراءً سريعاً..."
                className="flex-1 bg-transparent text-white placeholder:text-slate-500 text-sm focus:outline-none"
              />
              <kbd className="text-[10px] text-slate-500 glass-light px-1.5 py-0.5 rounded">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto modal-body py-2">
              {filtered.length === 0 ? (
                <p className="text-center text-slate-500 py-6 text-sm">لا توجد نتائج</p>
              ) : (
                filtered.map((cmd, i) => (
                  <button
                    key={cmd.id}
                    onClick={cmd.action}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-right transition ${
                      i === selectedIndex ? 'bg-emerald-500/15 text-white' : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <span className={i === selectedIndex ? 'text-emerald-400' : 'text-slate-500'}>
                      {cmd.icon}
                    </span>
                    <span className="text-sm font-semibold flex-1">{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="text-[10px] text-slate-500 glass-light px-1.5 py-0.5 rounded">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
