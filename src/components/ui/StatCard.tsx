import { type ReactNode } from 'react';

type StatCardProps = {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  color?: 'emerald' | 'amber' | 'blue' | 'red' | 'slate' | 'gold';
  subtitle?: string;
};

const colorMap = {
  gold: {
    glow: 'from-[#d4af37]/15 to-transparent',
    icon: 'text-[#e5c65a] bg-[#d4af37]/10 border border-[#d4af37]/20 shadow-lg shadow-black/30',
    value: 'text-[#e5c65a]',
  },
  emerald: {
    glow: 'from-emerald-500/15 to-transparent',
    icon: 'text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 shadow-lg shadow-emerald-900/20',
    value: 'text-emerald-300',
  },
  amber: {
    glow: 'from-amber-500/15 to-transparent',
    icon: 'text-amber-300 bg-amber-500/10 border border-amber-400/20 shadow-lg shadow-amber-900/20',
    value: 'text-amber-300',
  },
  blue: {
    glow: 'from-sky-500/15 to-transparent',
    icon: 'text-sky-300 bg-sky-500/10 border border-sky-400/20 shadow-lg shadow-sky-900/20',
    value: 'text-sky-300',
  },
  red: {
    glow: 'from-red-500/15 to-transparent',
    icon: 'text-red-300 bg-red-500/12 border border-red-400/15 shadow-lg shadow-red-900/20',
    value: 'text-red-300',
  },
  slate: {
    glow: 'from-slate-500/15 to-transparent',
    icon: 'text-slate-200 bg-slate-500/12 border border-slate-400/15 shadow-lg shadow-slate-900/20',
    value: 'text-slate-100',
  },
};

export default function StatCard({
  label,
  value,
  icon,
  color = 'gold',
  subtitle,
}: StatCardProps) {
  const c = colorMap[color];
  return (
    <div className="glass-card premium-card premium-hover-lift p-4 sm:p-5 relative overflow-hidden group">
      <div className={`absolute -top-12 -left-12 w-32 h-32 rounded-full bg-gradient-to-br ${c.glow} blur-3xl opacity-50 group-hover:opacity-70 transition-opacity duration-500`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-slate-300 mb-1 font-semibold tracking-wide">{label}</p>
          <p className={`text-xl sm:text-2xl premium-stat ${c.value}`}>{value}</p>
          {subtitle && (
            <p className="text-[10px] text-slate-400 mt-1.5 font-medium">{subtitle}</p>
          )}
        </div>
        <div className={`premium-floating-icon w-11 h-11 flex items-center justify-center ${c.icon} group-hover:scale-110`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
