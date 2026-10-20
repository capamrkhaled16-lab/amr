import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Activity, RefreshCw, ChevronLeft } from 'lucide-react';
import { computeHealthScore } from '@/lib/data';
import type { HealthScore as HealthScoreType } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';

type Props = {
  onNavigate?: (tab: string) => void;
};

export default function HealthScoreWidget({ onNavigate }: Props) {
  const { showToast } = useToast();
  const [score, setScore] = useState<HealthScoreType | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await computeHealthScore();
      setScore(s);
    } catch {
      showToast('تعذّر حساب المؤشر', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const levelConfig = {
    excellent: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', ring: 'ring-emerald-500/40', label: 'ممتاز', emoji: '🟢' },
    attention: { color: 'text-amber-400', bg: 'bg-amber-500/20', ring: 'ring-amber-500/40', label: 'يحتاج انتباه', emoji: '🟡' },
    critical: { color: 'text-red-400', bg: 'bg-red-500/20', ring: 'ring-red-500/40', label: 'حرج', emoji: '🔴' },
  };

  const cfg = score ? levelConfig[score.level] : levelConfig.attention;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={20} className="text-emerald-400" />
          <h2 className="text-lg font-bold text-white">مؤشر صحة السنتر</h2>
        </div>
        <button onClick={load} disabled={loading} className="p-2 glass-light rounded-lg text-slate-400 hover:text-white transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading || !score ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="animate-spin text-emerald-400" size={24} />
        </div>
      ) : (
        <>
          {/* Score circle */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`glass-card rounded-2xl p-6 text-center ring-2 ${cfg.ring}`}
          >
            <div className={`inline-flex items-center justify-center w-24 h-24 rounded-full ${cfg.bg} mb-3`}>
              <span className={`text-3xl font-bold ${cfg.color}`}>{score.score}</span>
            </div>
            <p className={`text-lg font-bold ${cfg.color}`}>{cfg.emoji} {cfg.label}</p>
            <p className="text-xs text-slate-400 mt-1">من 100</p>
          </motion.div>

          {/* Factors */}
          <div className="space-y-2">
            {score.factors.map((f, i) => {
              const pct = (f.score / f.max) * 100;
              const factorColor = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
              return (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-card rounded-xl p-3"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-white">{f.label}</span>
                    <span className="text-xs text-slate-400">{f.score}/{f.max}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden">
                    <div className={`h-full ${factorColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  {f.issues.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {f.issues.map((issue, j) => (
                        <p key={j} className="text-[10px] text-amber-400">{issue}</p>
                      ))}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Link to data check */}
          <button
            onClick={() => onNavigate?.('data-check')}
            className="w-full glass-card rounded-xl p-3 flex items-center justify-between hover:bg-white/5 transition"
          >
            <span className="text-xs text-slate-400">عرض تفاصيل مشاكل البيانات</span>
            <ChevronLeft size={16} className="text-slate-600" />
          </button>
        </>
      )}
    </div>
  );
}
