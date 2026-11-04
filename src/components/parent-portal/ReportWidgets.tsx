import { useEffect, useState, type ReactNode } from 'react';
import { Award, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Clock, Phone, Receipt, Target } from 'lucide-react';
import { formatArabicDate, getGradeRating, getMonthLabel } from '@/lib/format';
import type { AttendanceRecord, BehaviorEval, CenterExam, CenterGrade, Homework, HomeworkStatus, OnlineExam, OnlineGrade } from '@/lib/types';

export const CARD = 'pp-flow-border rounded-[24px] border border-[#E6EAE5] bg-white/80 backdrop-blur-md p-5 shadow-[0_8px_30px_rgba(36,51,45,0.06)] transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_40px_rgba(36,51,45,0.10)] active:scale-[0.995] motion-reduce:transform-none motion-reduce:transition-none sm:p-6';
export const TILE = 'rounded-2xl border border-[#E6EAE5] bg-[#F7F8F5] transition duration-300 ease-out hover:-translate-y-0.5 hover:border-[#087F5B]/30 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none';

export const REPORT_SECTIONS = [
  { id: 'performance', label: 'الأداء' },
  { id: 'grades-homework', label: 'الواجبات والدرجات' },
  { id: 'attendance', label: 'الحضور' },
  { id: 'payments', label: 'المدفوعات' },
  { id: 'comparison', label: 'المقارنة' },
  { id: 'achievements', label: 'الإنجازات' },
];

const PILL_TONES = {
  green: 'border-[#087F5B]/20 bg-[#E8F5EF] text-[#087F5B]',
  sky: 'border-[#2B7BB9]/20 bg-[#EAF4FC] text-[#1D5E8C]',
  gold: 'border-[#C69B35]/30 bg-[#FBF3DF] text-[#8A6A1F]',
  red: 'border-[#EF4444]/25 bg-[#FEF2F2] text-[#B91C1C]',
  blue: 'border-[#2B7BB9]/20 bg-[#EAF4FC] text-[#1D5E8C]',
  muted: 'border-[#E6EAE5] bg-[#F7F8F5] text-[#5F6B65]',
} as const;

type PillTone = keyof typeof PILL_TONES;

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${PILL_TONES[tone]}`}>{children}</span>;
}

export function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2.5 text-sm font-black text-[#24332D]">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#E8F5EF] text-[#087F5B]">{icon}</span>
      {children}
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-[#D8DED9] bg-[#F7F8F5] p-4 text-center text-xs text-[#5F6B65]">{children}</p>;
}

export interface StudentInfo {
  name: string;
  phone?: string | null;
  status?: string;
  grade_name?: string;
  stage_name?: string;
  group_name?: string;
  group_schedule?: string | null;
}

function rankLabel(rank: number): string {
  const labels = ['المركز الأول', 'المركز الثاني', 'المركز الثالث', 'المركز الرابع', 'المركز الخامس', 'المركز السادس', 'المركز السابع', 'المركز الثامن', 'المركز التاسع', 'المركز العاشر'];
  return labels[rank - 1] ?? 'المركز الرسمي غير متاح';
}

export function ProfileCard({ student, rank, totalInGroup, monthLabel }: { student: StudentInfo; rank: number | null; totalInGroup: number; monthLabel: string }) {
  const rankText = rank !== null && totalInGroup > 0 ? rankLabel(rank) : null;
  const details = [
    { label: 'المرحلة', value: student.stage_name },
    { label: 'الصف', value: student.grade_name },
    { label: 'الموعد', value: student.group_schedule },
    { label: 'المجموعة', value: student.group_name },
    { label: 'الهاتف', value: student.phone || 'غير مسجل' },
  ];
  return (
    <section
      className="pp-flow-border relative overflow-hidden rounded-[24px] p-5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.22)] transition duration-300 ease-out hover:shadow-[0_18px_50px_rgba(212,175,55,0.18)] sm:p-6"
      style={{ background: 'rgba(15, 23, 20, 0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.18em] text-[#E7C65E]">ملف الطالب</p>
          <h2 className="mt-1.5 truncate text-2xl font-black text-white sm:text-3xl">{student.name}</h2>
          {rankText && <p className="mt-1.5 text-xs font-bold text-[#E7C65E]">{rankText} في المجموعة</p>}
        </div>
        <div className="shrink-0 rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-center">
          <p className="text-[10px] text-white/70">الشهر المستهدف</p>
          <p className="mt-0.5 text-xs font-black text-white">{monthLabel}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {details.filter((detail) => detail.value).map((detail) => (
          <span key={detail.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white">
            <span className="text-[#E7C65E]">{detail.label}:</span>
            <span>{detail.value}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

export function MonthSelector({ selectedMonth, onMonthChange, availableMonths }: { selectedMonth: string; onMonthChange: (m: string) => void; availableMonths: string[] }) {
  const currentIndex = availableMonths.indexOf(selectedMonth);
  const canGoBack = currentIndex < availableMonths.length - 1;
  const canGoForward = currentIndex > 0;
  const btn = 'flex h-11 w-11 items-center justify-center rounded-xl border border-[#E6EAE5] bg-white text-[#24332D] transition hover:border-[#087F5B]/40 hover:text-[#087F5B] active:scale-95 disabled:opacity-30 motion-reduce:transition-none';
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[#E6EAE5] bg-white px-4 py-3 shadow-sm">
      <button type="button" aria-label="الشهر السابق" disabled={!canGoBack} onClick={() => canGoBack && onMonthChange(availableMonths[currentIndex + 1])} className={btn}>
        <ChevronRight className="h-5 w-5" />
      </button>
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[9px] font-bold tracking-wide text-[#77847D]">الشهر المحدد</span>
        <div className="flex items-center gap-2 text-base font-black text-[#24332D]">
          <Calendar className="h-4 w-4 text-[#087F5B]" />
          {getMonthLabel(selectedMonth)}
        </div>
      </div>
      <button type="button" aria-label="الشهر التالي" disabled={!canGoForward} onClick={() => canGoForward && onMonthChange(availableMonths[currentIndex - 1])} className={btn}>
        <ChevronLeft className="h-5 w-5" />
      </button>
    </div>
  );
}

export function CalcNotesCard({ children }: { children: ReactNode }) {
  return (
    <section className={CARD}>
      <SectionTitle icon={<CheckCircle2 className="h-4 w-4" />}>كيف حُسبت النسبة</SectionTitle>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function AchievementsCard({ badges }: { badges: { label: string; criteria: string; achieved: boolean }[] }) {
  return (
    <section id="achievements" className={`${CARD} scroll-mt-32`}>
      <SectionTitle icon={<Target className="h-4 w-4" />}>الإنجازات</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {badges.map((b) => (
          <div
            key={b.label}
            className={`flex items-start gap-3 rounded-2xl border p-3.5 transition duration-300 motion-reduce:transition-none ${b.achieved ? 'border-[#C69B35]/40 bg-[#FBF3DF] hover:-translate-y-0.5' : 'border-[#E6EAE5] bg-[#F7F8F5] opacity-80'}`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${b.achieved ? 'bg-[#C69B35] text-white' : 'bg-[#E6EAE5] text-[#77847D]'}`}>
              <Award className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className={`text-xs font-black ${b.achieved ? 'text-[#8A6A1F]' : 'text-[#5F6B65]'}`}>{b.label}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-[#5F6B65]">{b.achieved ? b.criteria : `لم يتحقق بعد: ${b.criteria}`}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function gradeTone(pct: number): PillTone {
  if (pct >= 85) return 'green';
  if (pct >= 50) return 'gold';
  return 'red';
}

type GradeCategory = 'recitation' | 'sheet' | 'exam';
type GradeRow = { id: string; title: string; sub: string; score: number; max: number; category: GradeCategory };

function GradeRows({ title, rows }: { title: string; rows: GradeRow[] }) {
  return (
    <div className="rounded-2xl border border-[#E6EAE5] bg-[#F7F8F5] p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-black text-[#24332D]">{title}</h3>
        <span className="text-[10px] font-bold text-[#77847D]">{rows.length} سجل</span>
      </div>
      {rows.length === 0 ? <EmptyNote>غير مسجل لهذا الشهر</EmptyNote> : (
        <div className="space-y-2">
          {rows.map((r) => {
            const pct = r.max > 0 ? Math.round((r.score / r.max) * 100) : 0;
            const rating = getGradeRating(r.score, r.max);
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#E6EAE5] bg-white p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-[#24332D]">{r.title}</p>
                  <p className="mt-0.5 text-[10px] text-[#5F6B65]">{r.sub}</p>
                </div>
                <div className="shrink-0 text-left">
                  <p className="text-sm font-black text-[#24332D]">{r.score}<span className="text-[10px] font-bold text-[#5F6B65]"> / {r.max}</span></p>
                  <Pill tone={gradeTone(pct)}>{pct}% · {rating.label}</Pill>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GradesList({ centerGrades, centerExams, onlineGrades, onlineExams, selectedMonth }: {
  centerGrades: CenterGrade[];
  centerExams: CenterExam[];
  onlineGrades: OnlineGrade[];
  onlineExams: OnlineExam[];
  selectedMonth: string;
}) {
  const rows: GradeRow[] = [
    ...centerGrades.flatMap((grade) => {
      const exam = centerExams.find((item) => item.id === grade.center_exam_id);
      if (!exam || !exam.exam_date || exam.exam_date.slice(0, 7) !== selectedMonth) return [];
      return [{ id: `c-${grade.id}`, title: exam.title ?? 'امتحان', sub: formatArabicDate(exam.exam_date), score: grade.score, max: exam.max_score, category: (exam.category === 'recitation' ? 'recitation' : exam.category === 'sheet' ? 'sheet' : 'exam') as GradeCategory }];
    }),
    ...onlineGrades.flatMap((grade) => {
      const exam = onlineExams.find((item) => item.id === grade.exam_id);
      const when = exam?.open_at ?? exam?.created_at ?? '';
      if (!exam || !when || when.slice(0, 7) !== selectedMonth) return [];
      return [{ id: `o-${grade.id}`, title: exam.title ?? 'امتحان إلكتروني', sub: exam.subject ?? 'امتحان إلكتروني', score: grade.score, max: grade.max_score, category: 'exam' as const }];
    }),
  ];
  return (
    <section id="grades-homework" className={`${CARD} scroll-mt-32`}>
      <SectionTitle icon={<Award className="h-4 w-4" />}>الدرجات المسجلة</SectionTitle>
      <div className="space-y-3">
        <GradeRows title="التسميع" rows={rows.filter((row) => row.category === 'recitation')} />
        <GradeRows title="الشيتات" rows={rows.filter((row) => row.category === 'sheet')} />
        <GradeRows title="الامتحانات" rows={rows.filter((row) => row.category === 'exam')} />
      </div>
    </section>
  );
}

export function HomeworkList({ homework, statuses, studentId }: { homework: Homework[]; statuses: HomeworkStatus[]; studentId: string }) {
  const statusLabel: Record<string, { label: string; tone: PillTone }> = {
    done: { label: 'تم', tone: 'green' },
    complete: { label: 'تم', tone: 'green' },
    completed: { label: 'تم', tone: 'green' },
    late: { label: 'متأخر', tone: 'gold' },
    incomplete: { label: 'غير مكتمل', tone: 'red' },
    not_done: { label: 'لم يتم', tone: 'red' },
    excused: { label: 'بعذر', tone: 'blue' },
  };
  return (
    <section className={`${CARD} scroll-mt-32`}>
      <SectionTitle icon={<Receipt className="h-4 w-4" />}>الواجبات</SectionTitle>
      {homework.length === 0 ? (
        <EmptyNote>لا توجد واجبات مسجلة لهذا الشهر</EmptyNote>
      ) : (
        <div className="space-y-2.5">
          {homework.map((hw) => {
            const status = statuses.find((s) => s.homework_id === hw.id && s.student_id === studentId);
            const cfg = status ? statusLabel[status.status] : undefined;
            return (
              <div key={hw.id} className={`${TILE} p-3`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#24332D]">{hw.title}</p>
                    {hw.description && <p className="mt-1 line-clamp-2 text-xs text-[#5F6B65]">{hw.description}</p>}
                    <p className="mt-1.5 text-[10px] text-[#77847D]">التسليم: {formatArabicDate(hw.due_date)}</p>
                    {status?.teacher_note && <p className="mt-1.5 rounded-lg bg-white px-2 py-1 text-[10px] text-[#24332D]">ملاحظة المعلم: {status.teacher_note}</p>}
                  </div>
                  <Pill tone={cfg?.tone ?? 'muted'}>{cfg?.label ?? 'لم يسجل'}</Pill>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const ATTENDANCE_BADGE: Record<string, { label: string; dot: string; tone: PillTone }> = {
  present: { label: 'حاضر', dot: '#087F5B', tone: 'green' },
  absent: { label: 'غائب', dot: '#EF4444', tone: 'red' },
  excused: { label: 'عذر', dot: '#2B7BB9', tone: 'blue' },
  excused_absence: { label: 'عذر', dot: '#2B7BB9', tone: 'blue' },
  late: { label: 'متأخر', dot: '#C69B35', tone: 'gold' },
};
const ATTENDANCE_FALLBACK = { label: 'لم يسجل', dot: '#A9B3AD', tone: 'muted' as PillTone };

export function AttendanceList({ records }: { records: (AttendanceRecord & { sessions?: { id: string; title: string } | null })[] }) {
  return (
    <section id="attendance" className={`${CARD} scroll-mt-32`}>
      <SectionTitle icon={<Calendar className="h-4 w-4" />}>سجل الحضور</SectionTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(ATTENDANCE_BADGE).filter(([key]) => key !== 'excused_absence').map(([key, badge]) => <Pill key={key} tone={badge.tone}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: badge.dot }} />{badge.label}</Pill>)}
      </div>
      {records.length === 0 ? (
        <EmptyNote>لا توجد سجلات حضور محفوظة لهذا الشهر</EmptyNote>
      ) : (
        <ol className="relative ps-8">
          <span aria-hidden="true" className="absolute bottom-3 top-3 start-[11px] w-px bg-[#D8DED9]" />
          {records.map((rec) => {
            const cfg = ATTENDANCE_BADGE[rec.status] ?? ATTENDANCE_FALLBACK;
            return (
              <li key={rec.id} className="relative pb-3 last:pb-0">
                <span className="absolute -start-8 top-4 h-6 w-6 rounded-full ring-4 ring-white/80" style={{ backgroundColor: cfg.dot }} />
                <div className={`${TILE} flex items-center justify-between gap-3 p-3`}>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#24332D]">{formatArabicDate(rec.attendance_date)}</p>
                    {rec.sessions?.title && <p className="mt-0.5 truncate text-[10px] text-[#5F6B65]">{rec.sessions.title}</p>}
                    {rec.notes && <p className="mt-0.5 text-[10px] text-[#77847D]">{rec.notes}</p>}
                  </div>
                  <Pill tone={cfg.tone}>{cfg.label}</Pill>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function BehaviorList({ records }: { records: BehaviorEval[] }) {
  const ratingLabel: Record<string, { label: string; tone: PillTone }> = {
    excellent: { label: 'ممتاز', tone: 'green' },
    participatory: { label: 'مشارك', tone: 'green' },
    quiet: { label: 'هادئ', tone: 'blue' },
    needs_attention: { label: 'يحتاج اهتمام', tone: 'gold' },
    disruptive: { label: 'مزعج', tone: 'red' },
  };
  return (
    <section className={`${CARD} scroll-mt-32`}>
      <SectionTitle icon={<Target className="h-4 w-4" />}>السلوك</SectionTitle>
      {records.length === 0 ? (
        <EmptyNote>لا توجد تقييمات سلوك لهذا الشهر</EmptyNote>
      ) : (
        <div className="space-y-2.5">
          {records.map((rec) => {
            const cfg = rec.rating ? ratingLabel[rec.rating] ?? { label: rec.rating, tone: 'muted' as PillTone } : null;
            return (
              <div key={rec.id} className={`${TILE} p-3`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#24332D]">{formatArabicDate(rec.eval_date)}</p>
                    {rec.note && <p className="mt-1 text-xs text-[#5F6B65]">{rec.note}</p>}
                    <p className="mt-1.5 text-[10px] text-[#77847D]">{rec.scope === 'session' ? 'تقييم حصة' : rec.scope === 'monthly' ? 'تقييم شهري' : 'تقييم يومي'}</p>
                  </div>
                  {cfg && <Pill tone={cfg.tone}>{cfg.label}</Pill>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function UpcomingExamsCard({ exams }: { exams: { title: string; date: string; type: string }[] }) {
  if (exams.length === 0) return null;
  return (
    <section className={CARD}>
      <SectionTitle icon={<Clock className="h-4 w-4" />}>امتحانات قادمة</SectionTitle>
      <div className="space-y-2.5">
        {exams.map((ex, i) => {
          const daysLeft = Math.ceil((new Date(ex.date).getTime() - Date.now()) / 86400000);
          const tone = daysLeft <= 3 ? 'bg-[#FEF2F2] text-[#B91C1C]' : daysLeft <= 7 ? 'bg-[#FBF3DF] text-[#8A6A1F]' : 'bg-[#E8F5EF] text-[#087F5B]';
          return (
            <div key={i} className={`${TILE} flex items-center gap-3 p-3`}>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black ${tone}`}>
                {daysLeft <= 0 ? '!' : daysLeft}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-[#24332D]">{ex.title}</p>
                <p className="mt-0.5 text-[10px] text-[#5F6B65]">{formatArabicDate(ex.date)}</p>
              </div>
              <Pill tone="muted">{ex.type === 'online' ? 'إلكتروني' : 'مركز'}</Pill>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? '');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const targets = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <nav aria-label="أقسام التقرير" className="sticky top-16 z-20 -mx-4 bg-[#F7F8F5]/95 px-4 py-2 backdrop-blur-md">
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => jump(item.id)}
              aria-current={isActive ? 'true' : undefined}
              className={`shrink-0 rounded-full border px-4 py-2 text-xs font-bold transition duration-200 active:scale-95 motion-reduce:transition-none ${isActive ? 'border-[#087F5B] bg-[#087F5B] text-white shadow-sm' : 'border-[#E6EAE5] bg-white text-[#24332D] hover:border-[#087F5B]/40'}`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function PortalSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 pb-28 lg:max-w-5xl" dir="rtl" lang="ar">
      <div className="h-10 animate-pulse rounded-2xl bg-[#E6EAE5]/60" />
      <div className="h-40 animate-pulse rounded-[24px] bg-[#E6EAE5]/50" />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="h-64 animate-pulse rounded-[24px] bg-[#E6EAE5]/50 lg:col-span-2" />
        <div className="h-64 animate-pulse rounded-[24px] bg-[#E6EAE5]/50 lg:col-span-3" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-[24px] bg-[#E6EAE5]/50" />
        <div className="h-48 animate-pulse rounded-[24px] bg-[#E6EAE5]/50" />
      </div>
    </div>
  );
}

export function TeacherMessage() {
  return (
    <section className="relative overflow-hidden rounded-[24px] border border-[#C69B35]/35 bg-white p-6 text-center shadow-[0_8px_30px_rgba(36,51,45,0.06)] sm:p-8">
      <p className="text-[10px] font-bold tracking-[0.2em] text-[#8A6A1F]">رسالة الختام</p>
      <p className="mt-4 text-sm leading-[2] text-[#24332D]">
        وفي النهاية، افتكر دايمًا إن النجاح مش خطوة واحدة، النجاح مشوار، وكل يوم بتتقدم فيه هو إنجاز جديد. ربنا يوفقك ويفرحنا بيك.
      </p>
      <div className="mt-6 border-t border-[#E6EAE5] pt-5">
        <p className="text-base font-black text-[#087F5B]">مستر عمرو خالد</p>
        <p className="mt-1 text-[11px] text-[#5F6B65]">مدرس ومؤسس المنصة</p>
      </div>
    </section>
  );
}
