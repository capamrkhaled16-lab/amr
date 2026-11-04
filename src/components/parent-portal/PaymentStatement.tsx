import type { LucideIcon } from 'lucide-react';
import { AlertCircle, CheckCircle2, Clock, Info, Receipt, Wallet } from 'lucide-react';
import { CARD, SectionTitle } from '@/components/parent-portal/ReportWidgets';
import { ARABIC_DAYS, ARABIC_MONTHS } from '@/lib/constants';
import { formatCurrency, formatTime } from '@/lib/format';
import type { ParentFinance, ParentFinanceStatus, PaymentLedgerEntry } from '@/lib/parentPaymentLedger';

const STATUS_VISUAL: Record<ParentFinanceStatus, { label: string; className: string; icon: LucideIcon; barClass: string }> = {
  paid: {
    label: 'مسدد',
    className: 'border-[#087F5B]/30 bg-[#E8F5EF] text-[#087F5B]',
    icon: CheckCircle2,
    barClass: 'bg-[#10B981]',
  },
  partial: {
    label: 'مسدد جزئيًا',
    className: 'border-[#C69B35]/40 bg-[#FBF3DF] text-[#8A6A1F]',
    icon: Clock,
    barClass: 'bg-[#D4AF37]',
  },
  unpaid: {
    label: 'غير مسدد',
    className: 'border-[#EF4444]/30 bg-[#FEF2F2] text-[#B91C1C]',
    icon: AlertCircle,
    barClass: 'bg-[#EF4444]',
  },
  missing: {
    label: 'بيانات الرسوم غير متاحة',
    className: 'border-[#D8DED9] bg-[#F2F4F1] text-[#5F6B65]',
    icon: Info,
    barClass: 'bg-[#77847D]',
  },
  exempt: {
    label: 'معفى من الرسوم',
    className: 'border-[#087F5B]/30 bg-[#E8F5EF] text-[#087F5B]',
    icon: CheckCircle2,
    barClass: 'bg-[#10B981]',
  },
};

function money(amount: number): string {
  return `${formatCurrency(amount)} ج.م`;
}

function EmptyNote({ children }: { children: string }) {
  return <p className="rounded-2xl border border-dashed border-[#D8DED9] bg-[#F7F8F5] p-4 text-center text-xs text-[#5F6B65]">{children}</p>;
}

export function FinanceSummaryCard({ finance }: { finance: ParentFinance }) {
  const { status, feesDue, feesPaid, feesRemaining, hasFees } = finance;
  const visual = STATUS_VISUAL[status];
  const StatusIcon = visual.icon;
  const percentPaid = hasFees ? Math.min(100, Math.round((feesPaid / feesDue) * 100)) : 0;
  const showFigures = status !== 'exempt';

  return (
    <section className={CARD}>
      <SectionTitle icon={<Wallet className="h-4 w-4" />}>الملخص المالي</SectionTitle>

      <div>
        <p className="text-[11px] font-bold text-[#5F6B65]">حالة السداد</p>
        <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${visual.className}`}>
          <StatusIcon className="h-3.5 w-3.5" />
          {visual.label}
        </span>
      </div>

      {showFigures && hasFees && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-[10px] font-bold text-[#5F6B65]">
            <span>نسبة السداد</span>
            <span className="tabular-nums">{percentPaid}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#E6EAE5]">
            <div className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${visual.barClass}`} style={{ width: `${percentPaid}%` }} />
          </div>
        </div>
      )}

      {status === 'exempt' && (
        <p className="mt-5 rounded-2xl border border-[#087F5B]/20 bg-[#E8F5EF] p-4 text-center text-sm font-bold text-[#087F5B]">الطالب معفى من الرسوم لهذا الشهر</p>
      )}

      {showFigures && (
        <div className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[#E6EAE5] bg-[#F7F8F5] p-4">
              <p className="text-[11px] font-bold text-[#5F6B65]">إجمالي الرسوم المطلوبة</p>
              <p className="mt-2 text-lg font-black tabular-nums text-[#24332D]">{hasFees ? money(feesDue) : '—'}</p>
            </div>
            <div className="rounded-2xl border border-[#E6EAE5] bg-[#F7F8F5] p-4">
              <p className="text-[11px] font-bold text-[#5F6B65]">إجمالي المبلغ المدفوع</p>
              <p className="mt-2 text-lg font-black tabular-nums text-[#087F5B]">{money(feesPaid)}</p>
            </div>
          </div>

          {!hasFees ? (
            <div className="rounded-2xl border border-[#D8DED9] bg-[#F2F4F1] p-4">
              <p className="text-[11px] font-bold text-[#5F6B65]">المبلغ المتبقي</p>
              <p className="mt-2 text-sm font-bold text-[#5F6B65]">بيانات الرسوم غير متاحة لهذا الشهر</p>
            </div>
          ) : feesRemaining > 0 ? (
            <div className="rounded-2xl border border-[#C69B35]/40 bg-[#FBF3DF] p-5">
              <p className="text-[11px] font-bold text-[#8A6A1F]">المبلغ المتبقي</p>
              <p className="mt-2 text-3xl font-black tabular-nums text-[#8A6A1F]">{money(feesRemaining)}</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#087F5B]/30 bg-[#E8F5EF] p-5">
              <p className="text-[11px] font-bold text-[#087F5B]">المبلغ المتبقي</p>
              <p className="mt-2 text-3xl font-black tabular-nums text-[#087F5B]">{money(0)}</p>
              <p className="mt-1 text-xs font-bold text-[#087F5B]">تم سداد الرسوم بالكامل</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ReceiptField({ label, value, emphasis }: { label: string; value: string; emphasis?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-[#F7F8F5] px-3 py-2">
      <dt className="text-[#5F6B65]">{label}</dt>
      <dd className={`text-end font-bold tabular-nums ${emphasis ?? 'text-[#24332D]'}`}>{value}</dd>
    </div>
  );
}

function formatPaymentDay(paymentDate: string): string {
  const d = new Date(`${paymentDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'غير مسجل';
  return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function weekdayOf(paymentDate: string): string {
  const d = new Date(`${paymentDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'غير مسجل';
  return ARABIC_DAYS[d.getDay()] ?? 'غير مسجل';
}

function paymentTimeOf(recordedAt: string | null | undefined): string {
  if (!recordedAt) return 'غير مسجل';
  const d = new Date(recordedAt);
  return Number.isNaN(d.getTime()) ? 'غير مسجل' : formatTime(d);
}

function ReceiptRow({
  entry,
  index,
  total,
  studentName,
  groupName,
  finance,
}: {
  entry: PaymentLedgerEntry;
  index: number;
  total: number;
  studentName: string;
  groupName: string | null;
  finance: ParentFinance;
}) {
  const { payment: p } = entry;
  const unknownFees = 'بيانات الرسوم غير متاحة';
  return (
    <article className="relative overflow-hidden rounded-2xl border border-dashed border-[#C69B35]/50 bg-white p-4">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#087F5B] to-[#C69B35]" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-[#8A6A1F]">الدفعة {index + 1} من {total}</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-[#087F5B]">{money(entry.amount)}</p>
          <p className="text-[10px] text-[#5F6B65]">المبلغ المدفوع في هذه العملية</p>
        </div>
        <div className="shrink-0 text-end">
          <p className="text-[10px] font-bold text-[#5F6B65]">رقم الإيصال</p>
          <p className="mt-0.5 break-all text-xs font-black tabular-nums text-[#24332D]" dir="ltr">{p.receipt_number ?? 'غير مسجل'}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
        <ReceiptField label="اسم الطالب" value={studentName} />
        {groupName && <ReceiptField label="المجموعة" value={groupName} />}
        <ReceiptField label="إجمالي الرسوم المطلوبة" value={finance.hasFees ? money(finance.feesDue) : unknownFees} />
        <ReceiptField label="إجمالي المدفوع حتى الآن" value={money(entry.runningPaid)} />
        <ReceiptField
          label="المتبقي بعد هذه الدفعة"
          value={entry.remainingAfter === null ? unknownFees : money(entry.remainingAfter)}
          emphasis={entry.remainingAfter && entry.remainingAfter > 0 ? 'text-[#8A6A1F]' : 'text-[#087F5B]'}
        />
        <ReceiptField label="اليوم" value={p.payment_date ? weekdayOf(p.payment_date) : 'غير مسجل'} />
        <ReceiptField label="تاريخ الدفع" value={p.payment_date ? formatPaymentDay(p.payment_date) : 'غير مسجل'} />
        <ReceiptField label="وقت الدفع" value={paymentTimeOf(p.recorded_at)} />
        <ReceiptField label="استلم بواسطة" value={p.recorded_by ?? 'غير مسجل'} />
      </dl>
      {p.note && <p className="mt-3 border-t border-[#E6EAE5] pt-3 text-[11px] text-[#5F6B65]">ملاحظة: {p.note}</p>}
    </article>
  );
}

export function ReceiptHistoryCard({ finance, studentName, groupName }: { finance: ParentFinance; studentName: string; groupName: string | null }) {
  const { ledger } = finance;
  return (
    <section className={CARD}>
      <SectionTitle icon={<Receipt className="h-4 w-4" />}>سجل الإيصالات</SectionTitle>
      {ledger.length === 0 ? (
        <EmptyNote>لا توجد دفعات مسجلة لهذا الشهر</EmptyNote>
      ) : (
        <div className="space-y-4">
          {ledger.map((entry, index) => (
            <ReceiptRow
              key={entry.payment.id}
              entry={entry}
              index={index}
              total={ledger.length}
              studentName={studentName}
              groupName={groupName}
              finance={finance}
            />
          ))}
        </div>
      )}
    </section>
  );
}
