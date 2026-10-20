import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, CalendarCheck, UserPlus, DollarSign, ClipboardList, History } from 'lucide-react';

type Props = {
  onQuickAttendance: () => void;
  onQuickAddStudent: () => void;
  onGoFinances: () => void;
  onOpenActivityLog: () => void;
};

export default function FloatingActionButton({
  onQuickAttendance,
  onQuickAddStudent,
  onGoFinances,
  onOpenActivityLog,
}: Props) {
  const [open, setOpen] = useState(false);

  const actions = [
    { label: 'تسجيل حضور سريع', icon: <CalendarCheck size={18} />, onClick: onQuickAttendance, color: 'text-emerald-400' },
    { label: 'إضافة طالب', icon: <UserPlus size={18} />, onClick: onQuickAddStudent, color: 'text-blue-400' },
    { label: 'المصاريف والشهور', icon: <DollarSign size={18} />, onClick: onGoFinances, color: 'text-amber-400' },
    { label: 'سجل النشاطات', icon: <History size={18} />, onClick: onOpenActivityLog, color: 'text-purple-400' },
  ];

  return (
    <div className="fixed z-50 flex flex-col items-start gap-3" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)', left: 'calc(env(safe-area-inset-left) + 1.5rem)' }}>
      <AnimatePresence>
        {open && (
          <>
            {actions.map((action, i) => (
              <motion.button
                key={action.label}
                initial={{ opacity: 0, scale: 0.8, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: 6 }}
                transition={{ delay: i * 0.03, duration: 0.15, ease: 'easeOut' }}
                onClick={() => {
                  action.onClick();
                  setOpen(false);
                }}
                className="flex items-center gap-3 glass-card rounded-2xl pl-4 pr-3 py-2.5 group hover:bg-white/10 transition shadow-xl"
              >
                <span className={'w-9 h-9 rounded-xl glass-light flex items-center justify-center ' + action.color}>
                  {action.icon}
                </span>
                <span className="text-sm font-bold text-white whitespace-nowrap">{action.label}</span>
              </motion.button>
            ))}
          </>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setOpen(!open)}
        whileTap={{ scale: 0.9 }}
        className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-2xl shadow-emerald-900/50 text-white hover:shadow-emerald-700/60 transition-shadow"
        title="القائمة السريعة"
      >
        <motion.div animate={{ rotate: open ? 135 : 0 }} transition={{ duration: 0.15, ease: 'easeOut' }}>
          {open ? <X size={24} /> : <Plus size={24} />}
        </motion.div>
      </motion.button>
    </div>
  );
}
