import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { MonthStats } from '@/lib/parentPortalStats';
import { getMonthLabel } from '@/lib/format';

type MetricKey = 'attendance' | 'absence' | 'homework' | 'exams' | 'behavior';

interface MetricRow {
  key: MetricKey;
  label: string;
  higherIsBetter: boolean;
  current: number | null;
  previous: number | null;
  currentDetail: string;
  previousDetail: string;
}

function buildRows(current: MonthStats, previous: MonthStats): MetricRow[] {
  return [
    {
      key: 'attendance',
      label: 'نسبة الحضور',
      higherIsBetter: true,
      current: current.attendance.rate,
      previous: previous.attendance.rate,
      currentDetail: `${current.attendance.present} حضور من ${current.attendance.total} حصة`,
      previousDetail: `${previous.attendance.present} حضور من ${previous.attendance.total} حصة`,
    },
    {
      key: 'absence',
      label: 'نسبة الغياب',
      higherIsBetter: false,
      current: current.attendance.absenceRate,
      previous: previous.attendance.absenceRate,
      currentDetail: `${current.attendance.absent} غياب من ${current.attendance.total} حصة`,
      previousDetail: `${previous.attendance.absent} غياب من ${previous.attendance.total} حصة`,
    },
    {
      key: 'homework',
      label: 'إنجاز الواجبات',
      higherIsBetter: true,
      current: current.homework.rate,
      previous: previous.homework.rate,
      currentDetail: `${current.homework.done} مكتمل من ${current.homework.total} واجب`,
      previousDetail: `${previous.homework.done} مكتمل من ${previous.homework.total} واجب`,
    },
    {
      key: 'exams',
      label: 'متوسط الامتحانات',
      higherIsBetter: true,
      current: current.exams.average,
      previous: previous.exams.average,
      currentDetail: `متوسط ${current.exams.count} امتحان`,
      previousDetail: `متوسط ${previous.exams.count} امتحان`,
    },
    {
      key: 'behavior',
      label: 'السلوك الإيجابي',
      higherIsBetter: true,
      current: current.behavior.rate,
      previous: previous.behavior.rate,
      currentDetail: `${current.behavior.positive} تقييم إيجابي من ${current.behavior.rated}`,
      previousDetail: `${previous.behavior.positive} تقييم إيجابي من ${previous.behavior.rated}`,
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
  const diff = row.current - row.previous;
  if (diff === 0) return { text: 'بدون تغيير عن الشهر السابق', improved: null };
  const improved = row.higherIsBetter ? diff > 0 : diff < 0;
  const direction = diff > 0 ? 'ارتفع' : 'انخفض';
  return {
    text: `${direction} بمقدار ${Math.abs(diff)} نقطة (${row.previousDetail} ← ${row.currentDetail})`,
    improved,
  };
}

export function MonthComparison({ current, previous, currentKey, previousKey }: { current: MonthStats; previous: MonthStats; currentKey: string; previousKey: string }) {
  const rows = buildRows(current, previous);
  return (
    <div className="pp-glass p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white">مقارنة مع الشهر السابق</h3>
        <span className="text-[10px] text-slate-400">{getMonthLabel(previousKey)} ← {getMonthLabel(currentKey)}</span>
      </div>
      <div className="space-y-3">
        {rows.map((row) => {
          const change = describeChange(row);
          const Icon = change.improved === null ? Minus : change.improved ? TrendingUp : TrendingDown;
          const tone = change.improved === null ? 'text-slate-400' : change.improved ? 'text-emerald-400' : 'text-red-400';
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

interface TrendPoint {
  monthKey: string;
  attendance: number | null;
  exams: number | null;
}

export function MonthlyTrendChart({ points }: { points: TrendPoint[] }) {
  const width = 320;
  const height = 160;
  const baseline = 130;
  const slot = points.length > 0 ? (width - 24) / points.length : 0;
  const barWidth = Math.min(16, slot / 3);

  return (
    <div className="pp-glass p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white">اتجاه الأداء الشهري</h3>
        <div className="flex items-center gap-3 text-[10px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400" />الحضور</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400" />الامتحانات</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="مخطط الحضور والامتحانات لكل شهر">
        <line x1="0" x2={width} y1={baseline} y2={baseline} stroke="rgba(255,255,255,0.12)" />
        {points.map((p, i) => {
          const x = 12 + i * slot + slot / 2;
          const bars = [
            { value: p.attendance, color: '#34d399', offset: -barWidth - 1 },
            { value: p.exams, color: '#fbbf24', offset: 1 },
          ];
          return (
            <g key={p.monthKey}>
              {bars.map((bar, j) => {
                if (bar.value === null) return null;
                const h = (bar.value / 100) * (baseline - 20);
                return (
                  <rect key={j} x={x + bar.offset} y={baseline - h} width={barWidth} height={h} rx="2" fill={bar.color}>
                    <title>{`${bar.value}%`}</title>
                  </rect>
                );
              })}
              {bars.map((bar, j) => (
                <text key={`t${j}`} x={x + bar.offset + barWidth / 2} y={bar.value === null ? baseline - 4 : baseline - (bar.value / 100) * (baseline - 20) - 3} textAnchor="middle" fontSize="8" fill="#e2e8f0">
                  {bar.value === null ? '—' : `${bar.value}`}
                </text>
              ))}
              <text x={x} y={baseline + 14} textAnchor="middle" fontSize="9" fill="#94a3b8">
                {p.monthKey.slice(5)}/{p.monthKey.slice(2, 4)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
        كل عمود يمثل شهراً واحداً محسوباً من سجلاته فقط. الرقم "—" يعني أنه لا توجد بيانات لهذا الشهر.
      </p>
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
