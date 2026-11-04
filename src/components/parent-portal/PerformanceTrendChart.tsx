import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { CARD, SectionTitle } from '@/components/parent-portal/ReportWidgets';
import type { PortalTheme } from '@/components/parent-portal/portalTheme';

export interface TrendPoint {
  month: string;
  attendance: number | null;
  homework: number | null;
  exams: number | null;
}

const SERIES = [
  { key: 'attendance', label: 'الحضور', color: '#2B7BB9' },
  { key: 'homework', label: 'الواجبات', color: '#C69B35' },
  { key: 'exams', label: 'الامتحانات', color: '#087F5B' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

function latestChange(data: TrendPoint[], key: SeriesKey): number | null {
  const values = data.map((point) => point[key]).filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  return Math.round(values[values.length - 1] - values[values.length - 2]);
}

export function PerformanceTrendChart({ data, theme }: { data: TrendPoint[]; theme: PortalTheme }) {
  const axisColor = theme === 'dark' ? '#91A39A' : '#5F6B65';
  const gridColor = theme === 'dark' ? '#2B3B34' : '#E6EAE5';
  const hasEnoughMonths = data.length >= 2;

  return (
    <section className={CARD}>
      <SectionTitle icon={<TrendingUp className="h-4 w-4" />}>تطور الأداء عبر الشهور</SectionTitle>
      {hasEnoughMonths && (
        <div className="mb-4 flex flex-wrap gap-2">
          {SERIES.map((series) => {
            const change = latestChange(data, series.key);
            if (change === null) return null;
            const up = change >= 0;
            return (
              <span key={series.key} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-black ${up ? 'bg-[#E8F5EF] text-[#087F5B]' : 'bg-[#FEF2F2] text-[#B91C1C]'}`}>
                {series.label}: {change > 0 ? '+' : ''}{change}% {up ? 'تحسن' : 'تراجع'}
              </span>
            );
          })}
        </div>
      )}
      {hasEnoughMonths ? (
        <div className="h-48 w-full sm:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
              <defs>
                {SERIES.map((series) => (
                  <linearGradient key={series.key} id={`pp-trend-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={series.color} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={series.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="2 6" stroke={gridColor} vertical={false} horizontal={false} />
              <XAxis dataKey="month" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} unit="%" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip formatter={(value) => `${value}%`} contentStyle={{ borderRadius: 8, direction: 'rtl', fontSize: 12 }} />
              {SERIES.map((series) => (
                <Area
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={series.color}
                  strokeWidth={2}
                  fill={`url(#pp-trend-${series.key})`}
                  connectNulls={false}
                  dot={{ r: 2 }}
                  activeDot={{ r: 4 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-2xl bg-[#F7F8F5] p-4 text-sm text-[#5F6B65]">تحتاج الرسوم البيانية إلى بيانات شهرين على الأقل لعرض التطور.</p>
      )}
    </section>
  );
}
