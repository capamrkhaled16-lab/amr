import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { MonthStats } from '@/lib/parentPortalStats';
import { getMonthLabel } from '@/lib/format';
import { CARD, SectionTitle } from '@/components/parent-portal/ReportWidgets';

interface MetricRow {
  key: string;
  label: string;
  higherIsBetter: boolean;
  current: number | null;
  previous: number | null;
}

type ComparableRow = MetricRow & { current: number; previous: number };

function buildRows(current: MonthStats, previous: MonthStats): MetricRow[] {
  return [
    { key: 'attendance', label: 'نسبة الحضور', higherIsBetter: true, current: current.attendance.rate, previous: previous.attendance.rate },
    { key: 'absence', label: 'نسبة الغياب', higherIsBetter: false, current: current.attendance.absenceRate, previous: previous.attendance.absenceRate },
    { key: 'homework', label: 'إنجاز الواجبات', higherIsBetter: true, current: current.homework.rate, previous: previous.homework.rate },
    { key: 'exams', label: 'متوسط الامتحانات', higherIsBetter: true, current: current.exams.average, previous: previous.exams.average },
    { key: 'behavior', label: 'السلوك الإيجابي', higherIsBetter: true, current: current.behavior.rate, previous: previous.behavior.rate },
  ];
}

function isComparable(row: MetricRow): row is ComparableRow {
  return row.current !== null && row.previous !== null;
}

function describeChange(row: ComparableRow): { text: string; improved: boolean | null } {
  const diff = Math.round((row.current - row.previous) * 10) / 10;
  if (diff === 0) return { text: 'بدون تغيير عن الشهر السابق', improved: null };
  const improved = row.higherIsBetter ? diff > 0 : diff < 0;
  const text = improved ? `+${Math.abs(diff)} نقطة تحسن عن الشهر السابق` : `-${Math.abs(diff)} نقطة تراجع عن الشهر السابق`;
  return { text, improved };
}

export function MonthComparison({ current, previous, currentKey, previousKey }: { current: MonthStats; previous: MonthStats; currentKey: string; previousKey: string }) {
  const rows = buildRows(current, previous).filter(isComparable);
  if (rows.length === 0) return null;
  return (
    <section id="comparison" className={`${CARD} scroll-mt-32`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionTitle icon={<TrendingUp className="h-4 w-4" />}>مقارنة مع الشهر السابق</SectionTitle>
        <span className="shrink-0 text-[10px] font-bold text-[#5F6B65]">{getMonthLabel(previousKey)} ← {getMonthLabel(currentKey)}</span>
      </div>
      <div className="space-y-3">
        {rows.map((row) => {
          const change = describeChange(row);
          const Icon = change.improved === null ? Minus : change.improved ? TrendingUp : TrendingDown;
          const tone = change.improved === null ? 'text-[#5F6B65]' : change.improved ? 'text-[#087F5B]' : 'text-[#B91C1C]';
          return (
            <div key={row.key} className="rounded-2xl border border-[#E6EAE5] bg-[#F7F8F5] p-3.5 transition duration-300 hover:border-[#087F5B]/30 motion-reduce:transition-none">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-[#24332D]">{row.label}</p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[#5F6B65]">{row.previous}%</span>
                  <span className="text-[#77847D]">←</span>
                  <span className="font-black text-[#24332D]">{row.current}%</span>
                </div>
              </div>
              <div className={`mt-1.5 flex items-start gap-1.5 text-[11px] font-bold ${tone}`}>
                <Icon className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="leading-relaxed">{change.text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CalcNote({ label, value, formula, detail }: { label: string; value: number | null; formula: string; detail: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-[#E6EAE5] bg-[#F7F8F5] p-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-[#24332D]">{label}</p>
        <p className="mt-1 text-[10px] leading-relaxed text-[#5F6B65]">{formula}</p>
        <p className="mt-0.5 text-[10px] text-[#77847D]">{detail}</p>
      </div>
      <span className="shrink-0 text-sm font-black text-[#8A6A1F]">{value === null ? 'لا توجد بيانات' : `${value}%`}</span>
    </div>
  );
}
