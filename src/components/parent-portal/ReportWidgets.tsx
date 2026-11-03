import type { ReactNode } from 'react';
import { Award, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Clock, AlertCircle, Receipt, Star, Target, Wallet } from 'lucide-react';
import { formatArabicDate, formatCurrency, getGradeRating, getMonthLabel } from '@/lib/format';
import type { AttendanceRecord, BehaviorEval, CenterExam, CenterGrade, Homework, HomeworkStatus, OnlineExam, OnlineGrade, Payment } from '@/lib/types';

export const CARD = 'rounded-[24px] border border-[#d4af37]/25 bg-[#0c1210]/95 p-5 sm:p-6 shadow-[0_18px_50px_rgba(0,0,0,0.45)]';
export const TILE = 'rounded-2xl border border-white/[0.06] bg-[#111815] p-3';

export const STATUS_COLORS = {
  present: '#10b981',
  absent: '#ef4444',
  excused: '#3b82f6',
  late: '#d4af37',
} as const;

const ATTENDANCE_TONE: Record<string, string> = {
  present: STATUS_COLORS.present,
  absent: STATUS_COLORS.absent,
  excused: STATUS_COLORS.excused,
  excused_absence: STATUS_COLORS.excused,
  late: STATUS_COLORS.late,
};

export function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2 text-sm font-black text-white">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#d4af37]/10 text-[#d4af37]">{icon}</span>
      {children}
    </div>
  );
}

export interface StudentInfo {
  name: string;
  status?: string;
  grade_name?: string;
  stage_name?: string;
  group_name?: string;
  group_schedule?: string | null;
}

export function ProfileCard({ student, rank, totalInGroup, monthLabel }: { student: StudentInfo; rank: number | null; totalInGroup: number; monthLabel: string }) {
  const rankText = rank !== null && totalInGroup > 0 ? rankLabel(rank) : null;
  return (
    <section className={`${CARD} relative overflow-hidden`}>
      <div className="pointer-events-none absolute -top-20 left-0 h-48 w-48 rounded-full bg-[#10b981]/10 blur-3xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.18em] text-[#d4af37]">ملف الطالب</p>
          <h2 className="mt-1 truncate text-2xl font-black text-white">{student.name}</h2>
          {rankText && <p className="mt-1 text-[11px] font-bold text-[#d4af37]">{rankText} في المجموعة</p>}
        </div>
        <div className="shrink-0 rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-3 py-2 text-center">
          <p className="text-[9px] text-slate-400">الشهر المستهدف</p>
          <p className="mt-0.5 text-xs font-black text-[#f0d27a]">{monthLabel}</p>
        </div>
      </div>
      <div className="relative mt-5 flex flex-wrap gap-2">
        {student.stage_name && <Pill tone="cyan">{student.stage_name}</Pill>}
        {student.grade_name && <Pill tone="gold">{student.grade_name}</Pill>}
        {student.group_name && <Pill tone="green">{student.group_name}</Pill>}
        {student.group_schedule && <Pill tone="green">{student.group_schedule}</Pill>}
        <Pill tone={student.status === 'active' ? 'green' : 'muted'}>{student.status === 'active' ? 'نشط' : 'غير نشط'}</Pill>
      </div>
    </section>
  );
}

function rankLabel(rank: number): string {
  const labels = ['المركز الأول', 'المركز الثاني', 'المركز الثالث', 'المركز الرابع', 'المركز الخامس', 'المركز السادس', 'المركز السابع', 'المركز الثامن', 'المركز التاسع', 'المركز العاشر'];
  return labels[rank - 1] ?? 'المركز الرسمي غير متاح';
}

const PILL_TONES = {
  green: 'border-[#10b981]/30 bg-[#10b981]/10 text-[#34d399]',
  cyan: 'border-[#06b6d4]/30 bg-[#06b6d4]/10 text-[#67e8f9]',
  gold: 'border-[#d4af37]/30 bg-[#d4af37]/10 text-[#f0d27a]',
  red: 'border-[#ef4444]/30 bg-[#ef4444]/10 text-[#fca5a5]',
  blue: 'border-[#3b82f6]/30 bg-[#3b82f6]/10 text-[#93c5fd]',
  muted: 'border-white/10 bg-white/[0.04] text-slate-400',
} as const;

export function Pill({ tone, children }: { tone: keyof typeof PILL_TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${PILL_TONES[tone]}`}>{children}</span>;
}

export function MonthSelector({ selectedMonth, onMonthChange, availableMonths }: { selectedMonth: string; onMonthChange: (m: string) => void; availableMonths: string[] }) {
  const currentIndex = availableMonths.indexOf(selectedMonth);
  const canGoBack = currentIndex < availableMonths.length - 1;
  const canGoForward = currentIndex > 0;
  const btn = 'flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-slate-300 transition hover:border-[#d4af37]/40 hover:text-white disabled:opacity-30';
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[#d4af37]/20 bg-[#0c1210] px-3 py-2.5">
      <button type="button" aria-label="الشهر السابق" disabled={!canGoBack} onClick={() => canGoBack && onMonthChange(availableMonths[currentIndex + 1])} className={btn}>
        <ChevronRight className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-2 text-sm font-black text-white">
        <Calendar className="h-4 w-4 text-[#10b981]" />
        {getMonthLabel(selectedMonth)}
      </div>
      <button type="button" aria-label="الشهر التالي" disabled={!canGoForward} onClick={() => canGoForward && onMonthChange(availableMonths[currentIndex - 1])} className={btn}>
        <ChevronLeft className="h-4 w-4" />
      </button>
    </div>
  );
}

export function FinanceCard({ isExempt, feesDue, feesPaid, feesRemaining, collectionRate }: {
  isExempt: boolean;
  feesDue: number;
  feesPaid: number;
  feesRemaining: number;
  collectionRate: number;
}) {
  const hasFees = !isExempt && feesDue > 0;
  return (
    <section className={CARD}>
      <SectionTitle icon={<Wallet className="h-4 w-4" />}>الملخص المالي وحالة السداد</SectionTitle>
      {isExempt ? (
        <Pill tone="green">معفى من الرسوم</Pill>
      ) : feesDue === 0 ? (
        <p className="text-sm text-slate-400">لا توجد رسوم مسجلة لهذا الشهر</p>
      ) : feesRemaining === 0 ? (
        <Pill tone="green"><CheckCircle2 className="h-3.5 w-3.5" /> مسدّد بالكامل</Pill>
      ) : feesPaid > 0 ? (
        <Pill tone="gold"><Clock className="h-3.5 w-3.5" /> مسدّد جزئياً</Pill>
      ) : (
        <Pill tone="red"><AlertCircle className="h-3.5 w-3.5" /> لم يُسدَّد</Pill>
      )}
      {hasFees && (
        <>
          <div className="mt-5 grid grid-cols-3 gap-2.5">
            <FinanceTile label="إجمالي الرسوم" value={formatCurrency(feesDue)} tone="text-white" />
            <FinanceTile label="المدفوع" value={formatCurrency(feesPaid)} tone="text-[#34d399]" />
            <FinanceTile label="المتبقي" value={formatCurrency(feesRemaining)} tone={feesRemaining > 0 ? 'text-[#fca5a5]' : 'text-[#34d399]'} />
          </div>
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-[11px] text-slate-400">
              <span>نسبة التحصيل</span>
              <span className="font-black text-[#34d399]">{collectionRate}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-[#10b981] to-[#06b6d4] transition-all duration-700" style={{ width: `${collectionRate}%` }} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function FinanceTile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={TILE + ' text-center'}>
      <p className="mb-1 text-[10px] text-slate-400">{label}</p>
      <p className={`text-sm font-black ${tone}`}>{value} <span className="text-[9px] font-bold text-slate-500">ج.م</span></p>
    </div>
  );
}

export function ReceiptCard({ payments }: { payments: Payment[] }) {
  return (
    <section className={CARD}>
      <SectionTitle icon={<Receipt className="h-4 w-4" />}>تفاصيل الإيصالات</SectionTitle>
      {payments.length === 0 ? (
        <p className={TILE + ' text-center text-xs text-slate-500'}>لا يوجد إيصال مسجل لهذا الشهر</p>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => (
            <article key={p.id} className={TILE}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-lg font-black text-white">{formatCurrency(p.amount)} <span className="text-xs text-slate-400">ج.م</span></p>
                <Pill tone="green">مسجل</Pill>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                <ReceiptField label="التاريخ" value={p.payment_date ? formatArabicDate(p.payment_date) : 'غير مسجل'} />
                <ReceiptField label="رقم الإيصال" value={p.receipt_number ?? 'غير مسجل'} />
                <ReceiptField label="المستلم" value={p.recorded_by ?? 'غير مسجل'} />
                <ReceiptField label="واتساب" value="غير مسجل" />
              </dl>
              {p.note && <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] text-slate-300">{p.note}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ReceiptField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-bold text-slate-200">{value}</dd>
    </div>
  );
}

export interface HeroMetric {
  label: string;
  value: number | null;
  previous: number | null;
  color: string;
}

const PERFORMANCE_BORDER = (pct: number) => (pct >= 90 ? '#10b981' : pct >= 50 ? '#d4af37' : '#ef4444');

const PRAISE_MESSAGES = [
  'برافو عليك يا بطل! مستواك ممتاز، حافظ على قوتك وخلينا نشوف إنجاز أكبر الشهر الجاي!',
  'أداء رائع وتعبك واضح! كمل بنفس الحماس، والقمة مستنياك!',
  'نتيجة تفرح، وفخور باجتهادك. مستني منك الأفضل دايمًا!',
];
const POSITIVE_MESSAGES = [
  'شاطر يا بطل! مستواك كويس، ومع شوية تركيز هتوصل لمستوى أعلى بكتير!',
  'أنت ماشي في الطريق الصح، كمل واجتهد، ومستني منك نتيجة أقوى المرة الجاية!',
  'تقدم جميل، وعندك فرصة تحقق أكتر. أنا واثق إنك تقدر!',
];
const ENCOURAGEMENT_MESSAGES = [
  'ولا يهمك يا بطل، لسه قدامك فرصة كبيرة تتحسن، وأنا مستني أشوف منك نتيجة تفرحك!',
  'أنت تقدر تعمل أحسن من كده، ابدأ خطوة خطوة وركز في اللي جاي، وأنا واثق فيك!',
  'النتيجة دي مش نهاية الطريق، شد حيلك، والشهر الجاي بإذن الله نشوف تقدم يفرحنا!',
];

function motivationFor(pct: number): string {
  if (pct >= 100) return 'مليون مبروك يا بطل! جبت الدرجة النهائية 100%، إنجاز يستحق الفخر والتقدير. حافظ على تفوقك، والقمة دايمًا مستنياك!';
  const pool = pct >= 85 ? PRAISE_MESSAGES : pct >= 50 ? POSITIVE_MESSAGES : ENCOURAGEMENT_MESSAGES;
  return pool[Math.round(pct) % pool.length];
}

export function PerformanceHero({ overall, monthLabel, metrics, trend }: {
  overall: number;
  monthLabel: string;
  metrics: HeroMetric[];
  trend: (number | null)[];
}) {
  const pct = Math.min(100, Math.max(0, Math.round(overall)));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const accent = PERFORMANCE_BORDER(pct);
  return (
    <section className={CARD} style={{ borderColor: `${accent}99`, boxShadow: `0 0 36px ${accent}22, 0 18px 50px rgba(0,0,0,0.45)` }}>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <div className="relative h-36 w-36 shrink-0">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
            <defs>
              <linearGradient id="hero-ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
            <circle cx="64" cy="64" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
            <circle
              cx="64" cy="64" r={radius} fill="none" stroke="url(#hero-ring)" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={circumference - (pct / 100) * circumference}
              style={{ transition: 'stroke-dashoffset 1.2s ease', filter: 'drop-shadow(0 0 8px rgba(16,185,129,0.5))' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black text-white">{pct}<span className="text-base text-slate-400">%</span></span>
            <span className="mt-1 text-[10px] text-slate-400">المستوى العام</span>
          </div>
        </div>
        <div className="w-full min-w-0 flex-1">
          <p className="text-[11px] font-bold text-[#d4af37]">{monthLabel}</p>
          <h3 className="mt-1 text-lg font-black text-white">المستوى العام للشهر</h3>
          <p className="mt-1 text-[11px] text-slate-400">مقارنة كل مؤشر بالشهر السابق</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {metrics.map((m) => <MetricCard key={m.label} metric={m} />)}
          </div>
        </div>
      </div>
      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
          <span>منحنى الحضور</span>
          <span>آخر {trend.length} أشهر</span>
        </div>
        <Sparkline values={trend} />
      </div>
      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[#10b981]/25 bg-[#10b981]/[0.06] p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#10b981]/15 text-[#34d399]">
          <Star className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-wider text-[#34d399]">رسالة تشجيع</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-100">{motivationFor(pct)}</p>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ metric }: { metric: HeroMetric }) {
  const { label, value, previous, color } = metric;
  const diff = value !== null && previous !== null ? Math.round(value - previous) : null;
  const deltaText = diff === null ? 'لا توجد مقارنة' : diff > 0 ? `+${diff}% زيادة` : diff < 0 ? `${diff}% انخفاض` : 'بدون تغيير';
  const deltaTone = diff === null || diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-[#34d399]' : 'text-[#fca5a5]';
  return (
    <div className={TILE}>
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black" style={{ color: value === null ? '#64748b' : color }}>
        {value === null ? '—' : `${value}%`}
      </p>
      <p className={`mt-1 text-[10px] font-bold ${deltaTone}`}>{deltaText}</p>
    </div>
  );
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (points.length < 2) return <p className="py-3 text-center text-[11px] text-slate-500">لا توجد بيانات كافية للمقارنة</p>;
  const last = values.length - 1 || 1;
  const coords = points.map((p) => `${(p.i / last) * 100},${40 - (Math.min(100, p.v) / 100) * 36}`).join(' ');
  const area = `0,40 ${coords} ${(points[points.length - 1].i / last) * 100},40`;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-16 w-full overflow-visible" aria-label="منحنى الحضور">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline points={coords} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 4px rgba(16,185,129,0.7))' }} />
    </svg>
  );
}

export function AttendanceMap({ records }: { records: AttendanceRecord[] }) {
  const sorted = [...records].sort((a, b) => a.attendance_date.localeCompare(b.attendance_date));
  return (
    <section className={CARD}>
      <SectionTitle icon={<Calendar className="h-4 w-4" />}>خريطة الحضور</SectionTitle>
      {sorted.length === 0 ? (
        <p className={TILE + ' text-center text-xs text-slate-500'}>لا توجد سجلات حضور محفوظة لهذا الشهر</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sorted.map((r) => (
            <span
              key={r.id}
              title={formatArabicDate(r.attendance_date)}
              className="h-5 w-5 rounded-md"
              style={{ backgroundColor: ATTENDANCE_TONE[r.status] ?? '#475569', boxShadow: `0 0 10px ${ATTENDANCE_TONE[r.status] ?? '#475569'}55` }}
            />
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-slate-400">
        <LegendDot color={STATUS_COLORS.present} label="حاضر" />
        <LegendDot color={STATUS_COLORS.absent} label="غائب" />
        <LegendDot color={STATUS_COLORS.excused} label="بعذر" />
        <LegendDot color={STATUS_COLORS.late} label="متأخر" />
      </div>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

export function PerformanceRadar({ axes }: { axes: { label: string; value: number }[] }) {
  const size = 240;
  const center = size / 2;
  const radius = 80;
  const angles = [-90, 0, 90, 180];
  const toPoint = (value: number, angle: number) => {
    const rad = (angle * Math.PI) / 180;
    const d = (radius * value) / 100;
    return { x: center + d * Math.cos(rad), y: center + d * Math.sin(rad) };
  };
  const ring = (scale: number) => angles.map((a) => toPoint(scale, a)).map((p) => `${p.x},${p.y}`).join(' ');
  const dataPoints = axes.map((a, i) => toPoint(Math.min(100, Math.max(0, a.value)), angles[i]));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto block w-full max-w-[260px]" role="img" aria-label="بصمة الأداء">
      {[25, 50, 75, 100].map((s) => (
        <polygon key={s} points={ring(s)} fill="none" stroke="rgba(212,175,55,0.12)" strokeWidth="1" />
      ))}
      {angles.map((a) => {
        const p = toPoint(100, a);
        return <line key={a} x1={center} y1={center} x2={p.x} y2={p.y} stroke="rgba(212,175,55,0.12)" strokeWidth="1" />;
      })}
      <polygon points={dataPoints.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(16,185,129,0.25)" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
      {dataPoints.map((p, i) => (
        <circle key={axes[i].label} cx={p.x} cy={p.y} r="4" fill="#d4af37" stroke="#071010" strokeWidth="2" />
      ))}
      {axes.map((a, i) => {
        const p = toPoint(118, angles[i]);
        return (
          <text key={a.label} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fill="#cbd5e1" style={{ fontSize: 11, fontWeight: 700 }}>
            {`${a.label} ${Math.round(a.value)}%`}
          </text>
        );
      })}
    </svg>
  );
}

export function PerformanceRadarCard({ axes }: { axes: { label: string; value: number }[] | null }) {
  return (
    <section className={CARD}>
      <SectionTitle icon={<Target className="h-4 w-4" />}>بصمة الأداء</SectionTitle>
      {axes ? (
        <PerformanceRadar axes={axes} />
      ) : (
        <p className={TILE + ' text-center text-xs text-slate-500'}>تظهر بصمة الأداء عند توفر بيانات الحضور والواجبات والامتحانات والسلوك لهذا الشهر</p>
      )}
    </section>
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

export function AchievementsCard({ badges }: { badges: { label: string; achieved: boolean }[] }) {
  return (
    <section className={CARD}>
      <SectionTitle icon={<Target className="h-4 w-4" />}>بطاقة الإنجاز</SectionTitle>
      <div className="grid grid-cols-2 gap-2.5">
        {badges.map((b) => (
          <div
            key={b.label}
            className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-[11px] font-bold ${b.achieved ? 'border-[#d4af37]/35 bg-[#d4af37]/10 text-[#f0d27a]' : 'border-white/[0.06] bg-[#111815] text-slate-600'}`}
          >
            <span className={`h-2 w-2 rounded-full ${b.achieved ? 'bg-[#d4af37] shadow-[0_0_8px_#d4af37]' : 'bg-slate-700'}`} />
            {b.label}
          </div>
        ))}
      </div>
    </section>
  );
}

export function GradesList({ centerGrades, centerExams, onlineGrades, onlineExams, selectedMonth }: {
  centerGrades: CenterGrade[];
  centerExams: CenterExam[];
  onlineGrades: OnlineGrade[];
  onlineExams: OnlineExam[];
  selectedMonth: string;
}) {
  const monthCenter = centerGrades.filter((g) => {
    const ex = centerExams.find((e) => e.id === g.center_exam_id);
    return ex?.exam_date && ex.exam_date.slice(0, 7) === selectedMonth;
  });
  const monthOnline = onlineGrades.filter((og) => {
    const ex = onlineExams.find((e) => e.id === og.exam_id);
    return ex && (ex.open_at ?? ex.created_at)?.slice(0, 7) === selectedMonth;
  });
  if (monthCenter.length === 0 && monthOnline.length === 0) return null;

  const rows = [
    ...monthCenter.map((g) => {
      const exam = centerExams.find((e) => e.id === g.center_exam_id);
      return { id: `c-${g.id}`, title: exam?.title ?? 'امتحان', sub: exam?.exam_date ? formatArabicDate(exam.exam_date) : 'غير مسجل', score: g.score, max: exam?.max_score ?? 0 };
    }),
    ...monthOnline.map((og) => {
      const exam = onlineExams.find((e) => e.id === og.exam_id);
      return { id: `o-${og.id}`, title: exam?.title ?? 'امتحان إلكتروني', sub: exam?.subject ?? 'امتحان إلكتروني', score: og.score, max: og.max_score };
    }),
  ];

  return (
    <section className={CARD}>
      <SectionTitle icon={<Award className="h-4 w-4" />}>الدرجات</SectionTitle>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const rating = getGradeRating(r.score, r.max);
          const pct = r.max > 0 ? Math.round((r.score / r.max) * 100) : 0;
          return (
            <div key={r.id} className={`${TILE} flex items-center justify-between gap-3`}>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">{r.title}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{r.sub}</p>
              </div>
              <div className="shrink-0 text-left">
                <p className="text-sm font-black text-white">{r.score}<span className="text-[10px] text-slate-400"> / {r.max}</span></p>
                <p className={`text-[10px] font-bold ${rating.color}`}>{pct}% · {rating.label}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HomeworkList({ homework, statuses, studentId }: { homework: Homework[]; statuses: HomeworkStatus[]; studentId: string }) {
  if (homework.length === 0) return null;
  const statusLabel: Record<string, { label: string; tone: 'green' | 'red' | 'gold' | 'blue' | 'muted' }> = {
    done: { label: 'تم', tone: 'green' },
    complete: { label: 'تم', tone: 'green' },
    completed: { label: 'تم', tone: 'green' },
    late: { label: 'متأخر', tone: 'gold' },
    incomplete: { label: 'غير مكتمل', tone: 'red' },
    not_done: { label: 'لم يتم', tone: 'red' },
    excused: { label: 'بعذر', tone: 'blue' },
  };
  return (
    <section className={CARD}>
      <SectionTitle icon={<Receipt className="h-4 w-4" />}>الواجبات</SectionTitle>
      <div className="space-y-2.5">
        {homework.map((hw) => {
          const status = statuses.find((s) => s.homework_id === hw.id && s.student_id === studentId);
          const cfg = status ? statusLabel[status.status] : undefined;
          return (
            <div key={hw.id} className={TILE}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white">{hw.title}</p>
                  {hw.description && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{hw.description}</p>}
                  <p className="mt-1.5 text-[10px] text-slate-500">التسليم: {formatArabicDate(hw.due_date)}</p>
                  {status?.teacher_note && <p className="mt-1.5 rounded-lg bg-white/[0.04] px-2 py-1 text-[10px] text-slate-300">ملاحظة المعلم: {status.teacher_note}</p>}
                </div>
                <Pill tone={cfg?.tone ?? 'muted'}>{cfg?.label ?? 'لم يسجل'}</Pill>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function AttendanceList({ records }: { records: (AttendanceRecord & { sessions?: { id: string; title: string } | null })[] }) {
  if (records.length === 0) return null;
  const statusLabel: Record<string, { label: string; tone: 'green' | 'red' | 'gold' | 'blue' | 'muted' }> = {
    present: { label: 'حاضر', tone: 'green' },
    absent: { label: 'غائب', tone: 'red' },
    excused: { label: 'بعذر', tone: 'blue' },
    excused_absence: { label: 'بعذر', tone: 'blue' },
    late: { label: 'متأخر', tone: 'gold' },
  };
  return (
    <section className={CARD}>
      <SectionTitle icon={<Calendar className="h-4 w-4" />}>سجل الحضور</SectionTitle>
      <div className="space-y-2">
        {records.map((rec) => {
          const cfg = statusLabel[rec.status] ?? { label: 'لم يسجل', tone: 'muted' as const };
          return (
            <div key={rec.id} className={`${TILE} flex items-center justify-between gap-3`}>
              <div className="min-w-0">
                <p className="text-sm font-bold text-white">{formatArabicDate(rec.attendance_date)}</p>
                {rec.sessions?.title && <p className="mt-0.5 text-[10px] text-slate-400">{rec.sessions.title}</p>}
                {rec.notes && <p className="mt-0.5 text-[10px] text-slate-500">{rec.notes}</p>}
              </div>
              <Pill tone={cfg.tone}>{cfg.label}</Pill>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function BehaviorList({ records }: { records: BehaviorEval[] }) {
  if (records.length === 0) return null;
  const ratingLabel: Record<string, { label: string; tone: 'green' | 'red' | 'gold' | 'blue' | 'muted' }> = {
    excellent: { label: 'ممتاز', tone: 'green' },
    participatory: { label: 'مشارك', tone: 'green' },
    quiet: { label: 'هادئ', tone: 'blue' },
    needs_attention: { label: 'يحتاج اهتمام', tone: 'gold' },
    disruptive: { label: 'مزعج', tone: 'red' },
  };
  return (
    <section className={CARD}>
      <SectionTitle icon={<Target className="h-4 w-4" />}>السلوك</SectionTitle>
      <div className="space-y-2.5">
        {records.map((rec) => {
          const cfg = rec.rating ? ratingLabel[rec.rating] ?? { label: rec.rating, tone: 'muted' as const } : null;
          return (
            <div key={rec.id} className={TILE}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white">{formatArabicDate(rec.eval_date)}</p>
                  {rec.note && <p className="mt-1 text-xs text-slate-400">{rec.note}</p>}
                  <p className="mt-1.5 text-[10px] text-slate-500">{rec.scope === 'session' ? 'تقييم حصة' : rec.scope === 'monthly' ? 'تقييم شهري' : 'تقييم يومي'}</p>
                </div>
                {cfg && <Pill tone={cfg.tone}>{cfg.label}</Pill>}
              </div>
            </div>
          );
        })}
      </div>
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
          return (
            <div key={i} className={`${TILE} flex items-center gap-3`}>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-black ${daysLeft <= 3 ? 'bg-red-500/15 text-red-300' : daysLeft <= 7 ? 'bg-[#d4af37]/15 text-[#f0d27a]' : 'bg-[#10b981]/15 text-[#34d399]'}`}>
                {daysLeft <= 0 ? '!' : daysLeft}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">{ex.title}</p>
                <p className="mt-0.5 text-[10px] text-slate-400">{formatArabicDate(ex.date)}</p>
              </div>
              <Pill tone="muted">{ex.type === 'online' ? 'إلكتروني' : 'مركز'}</Pill>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TeacherMessage() {
  return (
    <section className="relative overflow-hidden rounded-[24px] border border-[#d4af37]/35 bg-[#0c1210] p-6 text-center shadow-[0_18px_50px_rgba(0,0,0,0.45)] sm:p-8">
      <div className="pointer-events-none absolute -top-16 left-1/2 h-40 w-64 -translate-x-1/2 rounded-full bg-[#d4af37]/10 blur-3xl" />
      <p className="relative text-[10px] font-bold tracking-[0.2em] text-[#d4af37]">رسالة الختام</p>
      <p className="relative mt-4 text-sm leading-[2] text-slate-200">
        وفي النهاية، افتكر دايمًا إن النجاح مش خطوة واحدة، النجاح مشوار، وكل يوم بتتقدم فيه هو إنجاز جديد. ربنا يوفقك ويفرحنا بيك.
      </p>
      <div className="relative mt-6 border-t border-white/10 pt-5">
        <p className="text-base font-black text-[#d4af37]">مستر عمرو خالد</p>
        <p className="mt-1 text-[11px] text-slate-400">مدرس ومؤسس المنصة</p>
      </div>
    </section>
  );
}
