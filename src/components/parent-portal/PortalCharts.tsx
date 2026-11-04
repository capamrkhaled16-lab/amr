import { Bar, BarChart, Cell, Pie, PieChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Activity, BarChart3, PieChart as PieIcon } from 'lucide-react';
import { CARD, SectionTitle } from '@/components/parent-portal/ReportWidgets';
import type { PortalTheme } from '@/components/parent-portal/portalTheme';

export interface RadarPoint {
  axis: string;
  value: number | null;
}

export function PerformanceRadar({ data, theme }: { data: RadarPoint[]; theme: PortalTheme }) {
  const axisColor = theme === 'dark' ? '#91A39A' : '#5F6B65';
  const gridColor = theme === 'dark' ? '#2B3B34' : '#E6EAE5';
  const filled = data.filter((d) => d.value !== null);
  if (filled.length < 3) {
    return (
      <section className={CARD}>
        <SectionTitle icon={<Activity className="h-4 w-4" />}>رسم راداري للأداء</SectionTitle>
        <p className="rounded-2xl bg-[#F7F8F5] p-4 text-sm text-[#5F6B65]">يحتاج الرسم الراداري إلى بيانات متاحة في ثلاثة جوانب على الأقل من أداء الطالب.</p>
      </section>
    );
  }
  const chartData = data.map((d) => ({ axis: d.axis, value: d.value ?? 0 }));
  return (
    <section className={CARD}>
      <SectionTitle icon={<Activity className="h-4 w-4" />}>رسم راداري للأداء</SectionTitle>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} outerRadius="62%">
            <PolarGrid stroke={gridColor} strokeDasharray="2 4" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: axisColor, fontSize: 10 }} />
            <Radar dataKey="value" stroke="#C69B35" fill="#C69B35" fillOpacity={0.18} strokeWidth={1.5} />
            <Tooltip formatter={(v) => `${v}%`} contentStyle={{ borderRadius: 8, direction: 'rtl', fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const DONUT_COLORS: Record<string, string> = {
  present: '#087F5B',
  absent: '#EF4444',
  late: '#C69B35',
  excused: '#2B7BB9',
};

const DONUT_LABELS: Record<string, string> = {
  present: 'حاضر',
  absent: 'غائب',
  late: 'متأخر',
  excused: 'بعذر',
};

export function AttendanceDonut({ counts }: { counts: { present: number; absent: number; excused: number; late: number } }) {
  const total = counts.present + counts.absent + counts.excused + counts.late;
  if (total === 0) {
    return (
      <section className={CARD}>
        <SectionTitle icon={<PieIcon className="h-4 w-4" />}>توزيع الحضور</SectionTitle>
        <p className="rounded-2xl bg-[#F7F8F5] p-4 text-sm text-[#5F6B65]">لا توجد سجلات حضور كافية لعرض التوزيع.</p>
      </section>
    );
  }
  const segments = (['present', 'absent', 'late', 'excused'] as const)
    .map((key) => ({ key, name: DONUT_LABELS[key], value: counts[key], fill: DONUT_COLORS[key] }))
    .filter((s) => s.value > 0);
  return (
    <section className={CARD}>
      <SectionTitle icon={<PieIcon className="h-4 w-4" />}>توزيع الحضور</SectionTitle>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="relative h-36 w-36 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={segments} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={60} paddingAngle={2} stroke="none">
                {segments.map((s) => <Cell key={s.key} fill={s.fill} />)}
              </Pie>
              <Tooltip formatter={(v) => `${v} حصة`} contentStyle={{ borderRadius: 12, direction: 'rtl' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-black tabular-nums text-[#24332D]">{total}</span>
            <span className="text-[9px] font-bold text-[#77847D]">حصة</span>
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center gap-2 rounded-xl border border-[#E6EAE5] bg-[#F7F8F5] px-3 py-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.fill }} />
              <span className="text-[11px] font-bold text-[#24332D]">{s.name}</span>
              <span className="mr-auto text-[11px] font-black tabular-nums text-[#5F6B65]">{s.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export interface BarPoint {
  label: string;
  value: number | null;
  color: string;
}

export function AcademicBars({ data }: { data: BarPoint[] }) {
  const hasAny = data.some((d) => d.value !== null);
  if (!hasAny) {
    return (
      <section className={CARD}>
        <SectionTitle icon={<BarChart3 className="h-4 w-4" />}>مقارنة المؤشرات الأكاديمية</SectionTitle>
        <p className="rounded-2xl bg-[#F7F8F5] p-4 text-sm text-[#5F6B65]">لا توجد درجات مسجلة لعرض المقارنة الأكاديمية هذا الشهر.</p>
      </section>
    );
  }
  const chartData = data.map((d) => ({ label: d.label, value: d.value ?? 0, color: d.color }));
  return (
    <section className={CARD}>
      <SectionTitle icon={<BarChart3 className="h-4 w-4" />}>مقارنة المؤشرات الأكاديمية</SectionTitle>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <Tooltip formatter={(v) => `${v}%`} contentStyle={{ borderRadius: 8, direction: 'rtl', fontSize: 12 }} cursor={{ fill: 'rgba(8,127,91,0.06)' }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={48}>
              {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {data.filter((d) => d.value !== null).map((d) => (
          <span key={d.label} className="inline-flex items-center gap-1.5 rounded-full border border-[#E6EAE5] bg-[#F7F8F5] px-3 py-1 text-[11px] font-bold text-[#24332D]">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />{d.label}: {d.value}%
          </span>
        ))}
      </div>
    </section>
  );
}
