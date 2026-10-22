import { useMemo } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  RadialBarChart,
  RadialBar,
} from 'recharts';
import { TrendingUp, PieChart as PieIcon, BarChart3, Users } from 'lucide-react';
import { formatCurrency } from '@/lib/format';
import type { Student } from '@/lib/types';

type AnalyticsChartsProps = {
  allStudents: (Student & { grade_name?: string; stage_name?: string })[];
  monthlyPaidMap: Map<string, number>;
  fullyPaid: number;
  partialPaid: number;
  unpaidCount: number;
  totalCollected: number;
  totalRemaining: number;
  totalStudents: number;
};

const DARK_TOOLTIP_STYLE = {
  backgroundColor: 'rgba(10, 10, 12, 0.95)',
  border: '1px solid rgba(212, 175, 55, 0.25)',
  borderRadius: '12px',
  fontSize: '12px',
  color: '#fff',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  padding: '8px 12px',
};

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; payload?: { name?: string; value?: number; fill?: string } }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const name = item?.payload?.name ?? item?.name ?? label ?? '';
  const value = item?.payload?.value ?? item?.value ?? 0;
  return (
    <div style={DARK_TOOLTIP_STYLE}>
      <div className="font-bold text-white">{name}</div>
      <div className="text-[#d4af37] font-extrabold">{typeof value === 'number' ? formatCurrency(value) : value}</div>
    </div>
  );
}

function CountTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name?: string; value?: number; payload?: { name?: string; value?: number; fill?: string } }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const name = item?.payload?.name ?? item?.name ?? '';
  const value = item?.payload?.value ?? item?.value ?? 0;
  return (
    <div style={DARK_TOOLTIP_STYLE}>
      <div className="font-bold text-white">{name}</div>
      <div className="text-sky-300 font-extrabold">{value} طالب</div>
    </div>
  );
}

export default function AnalyticsCharts({
  allStudents,
  monthlyPaidMap,
  fullyPaid,
  partialPaid,
  unpaidCount,
  totalCollected,
  totalRemaining,
  totalStudents,
}: AnalyticsChartsProps) {
  const paymentData = useMemo(() => {
    const exemptCount = totalStudents - fullyPaid - partialPaid - unpaidCount;
    return [
      { name: 'دفع كامل', value: fullyPaid, fill: '#10b981' },
      { name: 'دفع جزئي', value: partialPaid, fill: '#f59e0b' },
      { name: 'لم يدفع', value: unpaidCount, fill: '#ef4444' },
      ...(exemptCount > 0 ? [{ name: 'معفى', value: exemptCount, fill: '#64748b' }] : []),
    ].filter((d) => d.value > 0);
  }, [fullyPaid, partialPaid, unpaidCount, totalStudents]);

  const gradeDistribution = useMemo(() => {
    const byGrade = new Map<string, { collected: number; remaining: number; count: number }>();
    for (const s of allStudents) {
      const gradeName = s.grade_name ?? s.stage_name ?? 'غير محدد';
      const existing = byGrade.get(gradeName) ?? { collected: 0, remaining: 0, count: 0 };
      const paid = monthlyPaidMap.get(s.id) ?? 0;
      existing.collected += paid;
      existing.remaining += Math.max(0, (s.total_fees ?? 0) - paid);
      existing.count += 1;
      byGrade.set(gradeName, existing);
    }
    return Array.from(byGrade.entries())
      .map(([name, v]) => ({
        name,
        collected: Math.round(v.collected),
        remaining: Math.round(v.remaining),
        count: v.count,
      }))
      .sort((a, b) => b.collected - a.collected)
      .slice(0, 6);
  }, [allStudents, monthlyPaidMap]);

  const collectionRate = useMemo(() => {
    const total = totalCollected + totalRemaining;
    if (total === 0) return 0;
    return Math.round((totalCollected / total) * 100);
  }, [totalCollected, totalRemaining]);

  const radialData = useMemo(() => [
    { name: 'نسبة التحصيل', value: collectionRate, fill: collectionRate >= 75 ? '#10b981' : collectionRate >= 50 ? '#f59e0b' : '#ef4444' },
  ], [collectionRate]);

  if (totalStudents === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
      {/* Payment Distribution Donut */}
      <div className="glass-card rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" />
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <PieIcon size={18} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">توزيع المدفوعات</h3>
            <p className="text-[10px] text-slate-400">حالة دفع الطلاب هذا الشهر</p>
          </div>
        </div>
        {paymentData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={paymentData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
                stroke="none"
              >
                {paymentData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<CountTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">لا توجد بيانات</div>
        )}
        <div className="flex flex-wrap gap-2 justify-center mt-2">
          {paymentData.map((d) => (
            <div key={d.name} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.fill, boxShadow: `0 0 8px ${d.fill}80` }} />
              <span className="text-[10px] text-slate-300 font-medium">{d.name}</span>
              <span className="text-[10px] font-bold" style={{ color: d.fill }}>{d.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Collection Rate Radial */}
      <div className="glass-card rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center">
            <TrendingUp size={18} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">نسبة التحصيل الكلي</h3>
            <p className="text-[10px] text-slate-400">المحصّل مقابل المتبقي</p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="65%"
            outerRadius="100%"
            barSize={16}
            data={radialData}
            startAngle={90}
            endAngle={-270}
          >
            <RadialBar
              background={{ fill: 'rgba(255,255,255,0.04)' }}
              dataKey="value"
              cornerRadius={10}
              fill={radialData[0].fill}
            />
            <Tooltip content={({ active: a, payload: p }) => {
              if (!a || !p || p.length === 0) return null;
              return (
                <div style={DARK_TOOLTIP_STYLE}>
                  <div className="font-bold text-white">نسبة التحصيل</div>
                  <div className="text-amber-300 font-extrabold">{p[0].value}%</div>
                </div>
              );
            }} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="text-center -mt-[120px] pointer-events-none relative z-10">
          <div className="text-3xl font-black" style={{ color: radialData[0].fill, textShadow: `0 0 20px ${radialData[0].fill}60` }}>
            {collectionRate}%
          </div>
          <div className="text-[10px] text-slate-400 mt-1">من إجمالي المصاريف</div>
        </div>
        <div className="flex justify-around mt-[100px] pt-3 border-t border-white/5">
          <div className="text-center">
            <div className="text-sm font-bold text-emerald-400">{formatCurrency(totalCollected)}</div>
            <div className="text-[9px] text-slate-500">محصّل</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold text-red-400">{formatCurrency(totalRemaining)}</div>
            <div className="text-[9px] text-slate-500">متبقي</div>
          </div>
        </div>
      </div>

      {/* Revenue by Grade Bar Chart */}
      <div className="glass-card rounded-2xl p-5 relative overflow-hidden lg:col-span-1">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-sky-400/40 to-transparent" />
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 flex items-center justify-center">
            <BarChart3 size={18} className="text-sky-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">التحصيل حسب الصف</h3>
            <p className="text-[10px] text-slate-400">المبالغ المحصّلة لكل صف دراسي</p>
          </div>
        </div>
        {gradeDistribution.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={gradeDistribution} layout="vertical" margin={{ left: 10, right: 10, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.6)' }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar
                dataKey="collected"
                fill="#0ea5e9"
                radius={[0, 6, 6, 0]}
                barSize={14}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-slate-500 text-sm">لا توجد بيانات</div>
        )}
        <div className="flex items-center justify-center gap-2 mt-2">
          <Users size={12} className="text-slate-500" />
          <span className="text-[10px] text-slate-400">إجمالي {totalStudents} طالب عبر {gradeDistribution.length} صف</span>
        </div>
      </div>
    </div>
  );
}
