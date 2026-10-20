import { motion } from 'framer-motion';
import { GraduationCap } from 'lucide-react';

export default function PageLoader({ label = 'جاري التحميل...' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="glass-card rounded-2xl px-8 py-10 flex flex-col items-center gap-4 max-w-xs w-full"
      >
        <motion.div
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center"
        >
          <GraduationCap className="text-emerald-400" size={28} />
        </motion.div>
        <div className="text-center">
          <p className="text-sm font-bold text-white">منصة الخالد التعليمية</p>
          <p className="text-xs text-slate-400 mt-1">{label}</p>
        </div>
        <div className="w-full h-1 rounded-full bg-slate-700/50 overflow-hidden">
          <motion.div
            animate={{ x: ['-100%', '100%'] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
          />
        </div>
      </motion.div>
    </div>
  );
}
