import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Sparkles } from 'lucide-react';
import { CARD, TILE } from '@/components/parent-portal/ReportWidgets';

export interface HeroMetric {
  label: string;
  value: number | null;
  previous: number | null;
  color: string;
  icon: LucideIcon;
  wide?: boolean;
}

export interface GradeBreakdown {
  recitation: { score: number; max: number; rate: number | null };
  sheet: { score: number; max: number; rate: number | null };
  exams: { score: number; max: number; rate: number | null };
  combined: number | null;
}

interface Tone {
  stroke: string;
  text: string;
  tint: string;
  label: string;
}

const NO_DATA_TONE: Tone = { stroke: '#D8DED9', text: '#5F6B65', tint: 'linear-gradient(160deg,#F7F8F5 0%,#FFFFFF 60%)', label: 'لا توجد بيانات كافية لحساب النسبة' };

function performanceTone(pct: number): Tone {
  if (pct >= 100) return { stroke: 'url(#pp-ring-full)', text: '#087F5B', tint: 'linear-gradient(160deg,#FBF3DF 0%,#E8F5EF 100%)', label: 'بطل الشهر — الدرجة الكاملة' };
  if (pct >= 85) return { stroke: '#10B981', text: '#087F5B', tint: 'linear-gradient(160deg,#E8F5EF 0%,#FFFFFF 60%)', label: 'أداء ممتاز' };
  if (pct >= 50) return { stroke: '#D4AF37', text: '#8A6A1F', tint: 'linear-gradient(160deg,#FBF3DF 0%,#FFFFFF 60%)', label: 'أداء جيد، واصل التقدم' };
  return { stroke: '#EF4444', text: '#B91C1C', tint: 'linear-gradient(160deg,#FEF2F2 0%,#FFFFFF 60%)', label: 'يحتاج متابعة ودعم' };
}

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

function lowestWeakMetric(metrics: HeroMetric[]): HeroMetric | null {
  const weak = metrics.filter((m) => m.value !== null && m.value < 85);
  if (weak.length === 0) return null;
  return weak.reduce((low, m) => ((m.value ?? 0) < (low.value ?? 0) ? m : low));
}

function motivationFor(pct: number, focus: HeroMetric | null): string {
  if (pct >= 100) return 'مليون مبروك يا بطل! جبت الدرجة النهائية 100%، إنجاز يستحق الفخر والتقدير. حافظ على تفوقك، والقمة دايمًا مستنياك!';
  const pool = pct >= 85 ? PRAISE_MESSAGES : pct >= 50 ? POSITIVE_MESSAGES : ENCOURAGEMENT_MESSAGES;
  const base = pool[Math.round(pct) % pool.length];
  return focus ? `${base} أولوية المتابعة القادمة: ${focus.label} (${focus.value}%).` : base;
}

function metricStatus(value: number): { text: string; className: string } {
  if (value >= 85) return { text: 'أداء ممتاز', className: 'bg-[#E8F5EF] text-[#087F5B]' };
  if (value >= 50) return { text: 'أداء جيد', className: 'bg-[#FBF3DF] text-[#8A6A1F]' };
  return { text: 'يحتاج متابعة', className: 'bg-[#FEF2F2] text-[#B91C1C]' };
}

function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted;
}

function ScoreRing({ pct, label, stroke, mounted }: { pct: number; label: string; stroke: string; mounted: boolean }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = mounted ? circumference - (pct / 100) * circumference : circumference;
  return (
    <div className="relative h-44 w-44 shrink-0 sm:h-48 sm:w-48">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id="pp-ring-full" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#D4AF37" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
        </defs>
        <circle cx="64" cy="64" r={radius} fill="none" stroke="#E6EAE5" strokeWidth="10" />
        <circle
          cx="64" cy="64" r={radius} fill="none" stroke={stroke} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-[1400ms] ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black tabular-nums text-[#24332D] sm:text-4xl">{label}</span>
        {label !== '—' && <span className="mt-1 text-[10px] font-bold text-[#77847D]">من 100</span>}
      </div>
    </div>
  );
}

function MetricCard({ metric }: { metric: HeroMetric }) {
  const { label, value, previous, color, icon: Icon, wide } = metric;
  const mounted = useMounted();
  const status = value === null ? null : metricStatus(value);
  const diff = value !== null && previous !== null ? Math.round((value - previous) * 10) / 10 : null;
  const deltaText = diff === null || diff === 0 ? null : diff > 0 ? `تحسن بنسبة +${diff}% عن الشهر السابق` : `تراجع بنسبة ${diff}% عن الشهر السابق`;
  const deltaTone = diff !== null && diff > 0 ? 'text-[#087F5B]' : 'text-[#B91C1C]';
  return (
    <div className={`${TILE} flex flex-col gap-3 p-4 ${wide ? 'col-span-2' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}1A`, color }}>
          <Icon className="h-4 w-4" />
        </span>
        {status && <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${status.className}`}>{status.text}</span>}
      </div>
      <div>
        <p className="text-xs font-bold text-[#5F6B65]">{label}</p>
        {value === null ? (
          <p className="mt-1 text-sm font-bold text-[#77847D]">لا توجد بيانات</p>
        ) : (
          <p className="mt-0.5 text-2xl font-black tabular-nums text-[#24332D]">{value}%</p>
        )}
      </div>
      {value !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[#E6EAE5]">
          <div
            className="h-full rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none"
            style={{ width: mounted ? `${Math.min(100, value)}%` : '0%', backgroundColor: color }}
          />
        </div>
      )}
      {deltaText && <p className={`text-[11px] font-bold ${deltaTone}`}>{deltaText}</p>}
    </div>
  );
}

export function PerformanceHero({ overall, monthLabel, metrics, gradeBreakdown }: { overall: number | null; monthLabel: string; metrics: HeroMetric[]; gradeBreakdown: GradeBreakdown }) {
  const mounted = useMounted();
  const hasOverall = overall !== null;
  const pct = hasOverall ? Math.min(100, Math.max(0, overall)) : 0;
  const tone = hasOverall ? performanceTone(pct) : NO_DATA_TONE;
  const valueText = hasOverall ? `${overall}%` : '—';
  const focus = hasOverall && pct < 100 ? lowestWeakMetric(metrics) : null;
  return (
    <section id="performance" className={`${CARD} scroll-mt-32`} style={{ backgroundImage: tone.tint }}>
      <div className="flex flex-col items-center gap-6 sm:flex-row">
        <ScoreRing pct={pct} label={valueText} stroke={tone.stroke} mounted={mounted} />
        <div className="w-full min-w-0 flex-1 text-center sm:text-start">
          <p className="text-[11px] font-bold text-[#5F6B65]">النسبة العامة للشهر</p>
          <p className="mt-1 text-5xl font-black tabular-nums" style={{ color: tone.text }}>{valueText}</p>
          <span className="mt-3 inline-flex rounded-full border border-[#E6EAE5] bg-white px-3 py-1 text-[11px] font-bold text-[#24332D] shadow-sm">{monthLabel}</span>
          <p className="mt-3 text-sm font-bold" style={{ color: tone.text }}>{tone.label}</p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => <MetricCard key={m.label} metric={m} />)}
      </div>
      <div className="mt-5 rounded-2xl border border-[#E6EAE5] bg-white/75 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-black text-[#24332D]">تفاصيل نسبة الدرجات والامتحانات</p>
          <span className="text-[10px] font-bold text-[#5F6B65]">التجميع من إجمالي الدرجات المسجلة</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { label: 'التلاوة', part: gradeBreakdown.recitation, color: '#C69B35' },
            { label: 'الورق', part: gradeBreakdown.sheet, color: '#087F5B' },
            { label: 'الدرجات والامتحانات', part: gradeBreakdown.exams, color: '#2B7BB9' },
          ].map(({ label, part, color }) => (
            <div key={label} className="rounded-xl border border-[#E6EAE5] bg-[#F7F8F5] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-[#5F6B65]">{label}</span>
                <span className="text-sm font-black text-[#24332D]">{part.rate === null ? 'غير مسجل' : `${part.rate}%`}</span>
              </div>
              <p className="mt-1 text-[10px] text-[#77847D]">{part.max > 0 ? `${part.score} من ${part.max} درجة` : 'لا توجد درجات مسجلة'}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#E6EAE5]">
                <div className="h-full rounded-full" style={{ width: `${part.rate ?? 0}%`, backgroundColor: color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {hasOverall && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#E6EAE5] bg-white p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FBF3DF] text-[#8A6A1F]">
            <Sparkles className="h-4 w-4" />
          </span>
          <p className="min-w-0 text-sm leading-relaxed text-[#24332D]">{motivationFor(pct, focus)}</p>
        </div>
      )}
    </section>
  );
}
