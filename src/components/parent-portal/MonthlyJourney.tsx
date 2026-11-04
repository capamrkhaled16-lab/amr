import { TrendingUp, TrendingDown, Calendar, Award, CheckCircle2 } from 'lucide-react';
import { CARD, SectionTitle, Pill } from '@/components/parent-portal/ReportWidgets';
import { formatArabicDate, getMonthLabel } from '@/lib/format';

export interface JourneyEvent {
  date: string;
  title: string;
  kind: 'exam' | 'attendance' | 'behavior' | 'homework' | 'milestone';
  detail?: string | null;
  trend?: number | null;
}

export function MonthlyJourney({ monthKey, events, hasOverall, overall }: {
  monthKey: string;
  events: JourneyEvent[];
  hasOverall: boolean;
  overall: number | null;
}) {
  if (events.length === 0 && !hasOverall) {
    return (
      <section className={CARD}>
        <SectionTitle icon={<Calendar className="h-4 w-4" />}>رحلة الشهر</SectionTitle>
        <p className="rounded-2xl bg-[#F7F8F5] p-4 text-sm text-[#5F6B65]">لا توجد أحداث مسجلة كافية لعرض رحلة هذا الشهر.</p>
      </section>
    );
  }
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const milestoneIcon = { exam: Award, attendance: CheckCircle2, behavior: CheckCircle2, homework: CheckCircle2, milestone: TrendingUp } as const;
  return (
    <section className={CARD}>
      <SectionTitle icon={<Calendar className="h-4 w-4" />}>رحلة شهر {getMonthLabel(monthKey)}</SectionTitle>
      {hasOverall && overall !== null && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[#C69B35]/30 bg-[#FBF3DF] px-4 py-3">
          <div>
            <p className="text-[11px] font-bold text-[#8A6A1F]">النسبة العامة للشهر</p>
            <p className="text-xl font-black text-[#24332D]">{overall}%</p>
          </div>
          <Pill tone="gold">ملخص الشهر</Pill>
        </div>
      )}
      {sorted.length === 0 ? (
        <p className="rounded-2xl bg-[#F7F8F5] p-4 text-sm text-[#5F6B65]">لا توجد أحدات مفصلّة مسجلة في هذا الشهر.</p>
      ) : (
        <ol className="relative ps-7">
          <span aria-hidden="true" className="absolute bottom-3 top-3 start-[10px] w-px bg-[#D8DED9]" />
          {sorted.map((ev, i) => {
            const Icon = milestoneIcon[ev.kind] ?? CheckCircle2;
            return (
              <li key={`${ev.date}-${i}`} className="relative pb-4 last:pb-0">
                <span className="absolute -start-7 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-2 ring-[#087F5B]/25">
                  <Icon className="h-3 w-3 text-[#087F5B]" />
                </span>
                <div className="rounded-xl border border-[#E6EAE5] bg-[#F7F8F5] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold text-[#24332D]">{ev.title}</p>
                    <span className="shrink-0 text-[10px] font-bold text-[#77847D]">{formatArabicDate(ev.date)}</span>
                  </div>
                  {ev.detail && <p className="mt-1 text-[11px] text-[#5F6B65]">{ev.detail}</p>}
                  {ev.trend !== null && ev.trend !== undefined && (
                    <span className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold ${ev.trend >= 0 ? 'text-[#087F5B]' : 'text-[#B91C1C]'}`}>
                      {ev.trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {ev.trend >= 0 ? `+${ev.trend}%` : `${ev.trend}%`} عن الشهر السابق
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
