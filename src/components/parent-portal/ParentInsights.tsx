import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { MonthStats } from '@/lib/parentPortalStats';
import { getMonthLabel } from '@/lib/format';
import { CARD } from '@/components/parent-portal/ReportWidgets';

interface MetricRow {
  key: string;
  label: string;
  higherIsBetter: boolean;
  current: number | null;
  previous: number | null;
}

function buildRows(current: MonthStats, previous: MonthStats): MetricRow[] {
  return [
    {
      key: 'attendance',
      label: 'نسبة الحضور',
      higherIsBetter: true,
      current: current.attendance.rate,
      previous: previous.attendance.rate,
    },
    {
      key: 'absence',
      label: 'نسبة الغياب',
      higherIsBetter: false,
      current: current.attendance.absenceRate,
      previous: previous.attendance.absenceRate,
    },
    {
      key: 'homework',
      label: 'إنجاز الواجبات',
      higherIsBetter: true,
      current: current.homework.rate,
      previous: previous.homework.rate,
    },
    {
      key: 'exams',
      label: 'متوسط الامتحانات',
      higherIsBetter: true,
      current: current.exams.average,
      previous: previous.exams.average,
    },
    {
      key: 'behavior',
      label: 'السلوك الإيجابي',
      higherIsBetter: true,
      current: current.behavior.rate,
      previous: previous.behavior.rate,
    },
  ];
}

function formatValue(value: number | null): string {
  return value === null ? 'لا توجد بيانات' : `${value}%`;
}

function describeChange(row: MetricRow): { text: string; improved: boolean | null } {
  if (row.current === null || row.previous === null) {
    return { text: 'لا يمكن المقارنة لعدم توفر بيانات لأحد الشهرين', improved: null };
  }
  const diff = Math.round((row.current - row.previous) * 10) / 10;
  if (diff === 0) return { text: 'بدون تغيير عن الشهر السابق', improved: null };
  const improved = row.higherIsBetter ? diff > 0 : diff < 0;
  const text = improved
    ? `تحسن بنسبة +${Math.abs(diff)}%`
    : `تراجع بنسبة -${Math.abs(diff)}%`;
  return { text, improved };
}

export function MonthComparison({ current, previous, currentKey, previousKey }: { current: MonthStats; previous: MonthStats; currentKey: string; previousKey: string }) {
  const rows = buildRows(current, previous);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white">مقارنة مع الشهر السابق</h3>
        <span className="text-[10px] text-slate-400">{getMonthLabel(previousKey)} ← {getMonthLabel(currentKey)}</span>
      </div>
      <div className="space-y-3">
        {rows.map((row) => {
          const change = describeChange(row);
          const Icon = change.improved === null ? Minus : change.improved ? TrendingUp : TrendingDown;
          const tone = change.improved === null ? 'text-slate-400' : change.improved ? 'text-emerald-400' : 'text-rose-400';
          return (
            <div key={row.key} className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.04]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-white">{row.label}</p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">{formatValue(row.previous)}</span>
                  <span className="text-slate-600">←</span>
                  <span className="font-black text-white">{formatValue(row.current)}</span>
                </div>
              </div>
              <div className={`flex items-start gap-1.5 mt-1.5 text-[10px] ${tone}`}>
                <Icon className="w-3 h-3 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{change.text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalcNote({ label, value, formula, detail }: { label: string; value: number | null; formula: string; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-3 bg-white/[0.03] rounded-xl p-3 border border-white/[0.05] mb-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-white">{label}</p>
        <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{formula}</p>
        <p className="text-[10px] text-slate-500 mt-0.5">{detail}</p>
      </div>
      <span className="text-sm font-black text-amber-300 shrink-0">{value === null ? 'لا توجد بيانات' : `${value}%`}</span>
    </div>
  );
}
