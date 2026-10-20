import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Sparkles, BookOpen, ClipboardCheck, BookCheck } from 'lucide-react';

export type MonthMetric = {
  monthLabel: string;
  attendance: number | null;
  grades: number | null;
  homework: number | null;
  overall: number | null;
};

type ProgressChartProps = {
  data: MonthMetric[];
};

const BAR_GRADIENTS = {
  attendance: { id: 'bar-att', from: '#f4d878', to: '#b88a1d' },
  grades: { id: 'bar-grades', from: '#e7c75d', to: '#9b7620' },
  homework: { id: 'bar-hw', from: '#d4af37', to: '#765713' },
};

const FADED = {
  attendance: 'rgba(212,175,55,0.08)',
  grades: 'rgba(212,175,55,0.06)',
  homework: 'rgba(212,175,55,0.045)',
};

const LABEL_COLORS = {
  attendance: 'text-[#e5c65a]',
  grades: 'text-[#d4af37]',
  homework: 'text-[#b88a1d]',
};

function TrendBadge({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null) return null;
  if (previous === null) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-semibold bg-white/[0.04] text-slate-400 border border-white/[0.06] backdrop-blur-md">
        بداية المتابعة
      </span>
    );
  }
  const diff = Math.round((current - previous) * 10) / 10;
  if (Math.abs(diff) < 0.5) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-semibold bg-white/[0.04] text-slate-300 border border-white/[0.06] backdrop-blur-md">
        <Minus size={11} /> مستقر
      </span>
    );
  }
  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-semibold bg-emerald-500/[0.08] text-emerald-300 border border-emerald-400/15 backdrop-blur-md">
        <TrendingUp size={11} /> +{diff}% عن الشهر السابق
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-semibold bg-rose-500/[0.08] text-rose-300 border border-rose-400/15 backdrop-blur-md">
      <TrendingDown size={11} /> {Math.abs(diff)}% عن الشهر السابق
    </span>
  );
}

function MetricCard({
  icon, label, value, gradientFrom, gradientTo, labelColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  gradientFrom: string;
  gradientTo: string;
  labelColor: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.05] backdrop-blur-md transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]">
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{ background: `linear-gradient(145deg, ${gradientFrom}, transparent 65%)` }}
      />
      <div className="relative p-3 sm:p-4">
        <div className="flex items-center gap-1.5 mb-2">
          <span className={labelColor}>{icon}</span>
          <span className="text-[9px] sm:text-[11px] font-medium text-slate-400 tracking-wide">{label}</span>
        </div>
        <p
          className="text-2xl sm:text-3xl font-black tracking-tight tabular-nums leading-none"
          style={{ color: gradientTo }}
        >
          {value === null ? '—' : `${value}%`}
        </p>
      </div>
    </div>
  );
}

type TooltipPayloadItem = {
  payload: {
    month: string;
    الحضور: number;
    الدرجات: number;
    الواجبات: number;
    _hasAtt: boolean;
    _hasGrades: boolean;
    _hasHw: boolean;
  };
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="glass-card rounded-xl px-3.5 py-2.5 shadow-2xl border border-white/[0.08]" dir="rtl">
      <p className="text-xs font-bold text-white mb-2">{d.month}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-6 text-[11px]">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2 h-2 rounded" style={{ background: `linear-gradient(180deg, ${BAR_GRADIENTS.attendance.from}, ${BAR_GRADIENTS.attendance.to})` }} />
            الحضور
          </span>
          <span className="font-bold text-[#e5c65a] tabular-nums">{d._hasAtt ? `${d.الحضور}%` : '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-6 text-[11px]">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2 h-2 rounded" style={{ background: `linear-gradient(180deg, ${BAR_GRADIENTS.grades.from}, ${BAR_GRADIENTS.grades.to})` }} />
            الدرجات
          </span>
          <span className="font-bold text-[#d4af37] tabular-nums">{d._hasGrades ? `${d.الدرجات}%` : '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-6 text-[11px]">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-2 h-2 rounded" style={{ background: `linear-gradient(180deg, ${BAR_GRADIENTS.homework.from}, ${BAR_GRADIENTS.homework.to})` }} />
            الواجبات
          </span>
          <span className="font-bold text-[#b88a1d] tabular-nums">{d._hasHw ? `${d.الواجبات}%` : '—'}</span>
        </div>
      </div>
    </div>
  );
}

function GradientDefs() {
  return (
    <defs>
      {Object.values(BAR_GRADIENTS).map((g) => (
        <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={g.from} stopOpacity={1} />
          <stop offset="100%" stopColor={g.to} stopOpacity={0.75} />
        </linearGradient>
      ))}
    </defs>
  );
}

export default function ProgressChart({ data }: ProgressChartProps) {
  const sorted = useMemo(() => [...data], [data]);
  const hasData = sorted.some((d) => d.overall !== null);
  if (!hasData) return null;

  const latest = sorted[sorted.length - 1];
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;

  const barData = sorted.map((d) => ({
    month: d.monthLabel,
    الحضور: d.attendance ?? 0,
    الدرجات: d.grades ?? 0,
    الواجبات: d.homework ?? 0,
    _hasAtt: d.attendance !== null,
    _hasGrades: d.grades !== null,
    _hasHw: d.homework !== null,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card rounded-3xl p-5 sm:p-7"
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <h3 className="font-bold text-white flex items-center gap-2.5 text-sm sm:text-lg tracking-tight">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-400/15 to-amber-600/5 border border-amber-400/15">
            <Sparkles size={16} className="text-amber-300" />
          </span>
          تطور مستوى الطالب
        </h3>
        {previous && <TrendBadge current={latest.overall} previous={previous.overall} />}
      </div>

      {/* Latest month metric cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
        <MetricCard
          icon={<ClipboardCheck size={14} />}
          label="الحضور"
          value={latest.attendance}
          gradientFrom={BAR_GRADIENTS.attendance.from}
          gradientTo={BAR_GRADIENTS.attendance.to}
          labelColor={LABEL_COLORS.attendance}
        />
        <MetricCard
          icon={<BookOpen size={14} />}
          label="الدرجات"
          value={latest.grades}
          gradientFrom={BAR_GRADIENTS.grades.from}
          gradientTo={BAR_GRADIENTS.grades.to}
          labelColor={LABEL_COLORS.grades}
        />
        <MetricCard
          icon={<BookCheck size={14} />}
          label="الواجبات"
          value={latest.homework}
          gradientFrom={BAR_GRADIENTS.homework.from}
          gradientTo={BAR_GRADIENTS.homework.to}
          labelColor={LABEL_COLORS.homework}
        />
      </div>

      {/* Gradient bar chart */}
      <div className="w-full">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={barData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barGap={2} barCategoryGap="32%">
            <GradientDefs />
            <XAxis
              dataKey="month"
              stroke="rgba(255,255,255,0.2)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={sorted.length > 3 ? -18 : 0}
              textAnchor={sorted.length > 3 ? 'end' : 'middle'}
              height={sorted.length > 3 ? 34 : 16}
              tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
            />
            <YAxis
              domain={[0, 100]}
              stroke="rgba(255,255,255,0.15)"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
              width={34}
              tick={{ fill: 'rgba(255,255,255,0.25)', fontSize: 9 }}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
            <Bar dataKey="الحضور" radius={[8, 8, 0, 0]} maxBarSize={16}>
              {barData.map((entry, i) => (
                <Cell key={`att-${i}`} fill={entry._hasAtt ? `url(#${BAR_GRADIENTS.attendance.id})` : FADED.attendance} />
              ))}
            </Bar>
            <Bar dataKey="الدرجات" radius={[8, 8, 0, 0]} maxBarSize={16}>
              {barData.map((entry, i) => (
                <Cell key={`gr-${i}`} fill={entry._hasGrades ? `url(#${BAR_GRADIENTS.grades.id})` : FADED.grades} />
              ))}
            </Bar>
            <Bar dataKey="الواجبات" radius={[8, 8, 0, 0]} maxBarSize={16}>
              {barData.map((entry, i) => (
                <Cell key={`hw-${i}`} fill={entry._hasHw ? `url(#${BAR_GRADIENTS.homework.id})` : FADED.homework} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-5 sm:gap-7 mt-4 flex-wrap">
        {[
          { label: 'الحضور', grad: BAR_GRADIENTS.attendance },
          { label: 'الدرجات', grad: BAR_GRADIENTS.grades },
          { label: 'الواجبات', grad: BAR_GRADIENTS.homework },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-2 text-[10px] sm:text-[11px] font-medium text-slate-400">
            <span
              className="w-2.5 h-2.5 rounded"
              style={{ background: `linear-gradient(180deg, ${item.grad.from}, ${item.grad.to})` }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </motion.div>
  );
}
