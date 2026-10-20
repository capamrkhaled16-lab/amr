import { supabase } from '@/lib/supabase';
import { formatCurrency, formatArabicDate, formatTime, normalizePhoneForWhatsApp, getMonthLabel, openWhatsAppURL } from '@/lib/format';
import type { Student } from '@/lib/types';

export type PaymentSnapshot = {
  studentId: string;
  studentName: string;
  monthKey: string;
  thisPaymentAmount: number;
  totalFees: number;
  totalPaid: number;
  remaining: number;
  isExempt: boolean;
  paymentDate: string;
  recordedAt: string | null;
  receiptNumber?: string;
  collectorName?: string;
  groupName?: string;
  gradeName?: string;
  stageName?: string;
  parentPhone?: string;
  studentPhone?: string;
};

export type PaymentStatus = 'full' | 'partial' | 'exempt';

export async function resolvePaymentSnapshot(
  studentId: string,
  monthKey: string,
  thisPaymentAmount: number,
  paymentDate?: string,
  receiptNumber?: string,
): Promise<PaymentSnapshot | null> {
  const { data: student } = await supabase
    .from('students')
    .select('id, name, parent_phone, phone, total_fees, is_exempt, group:groups(name, grade_level:grade_levels(name, stage:academic_stages(name)))')
    .eq('id', studentId)
    .maybeSingle();

  if (!student) return null;

  const s = student as Student & {
    is_exempt?: boolean | null;
    group?: { name: string; grade_level?: { name: string; stage?: { name: string } } } | null;
  };

  const start = `${monthKey}-01`;
  const [y, m] = monthKey.split('-').map(Number);
  const nextMonthDate = new Date(y, m, 1);
  const end = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

  const { data: subData } = await supabase
    .from('monthly_subscriptions')
    .select('amount_due, is_exempt')
    .eq('student_id', studentId)
    .eq('month_key', monthKey)
    .maybeSingle();
  const sub = subData as { amount_due: number; is_exempt: boolean | null } | null;

  let totalFees = sub?.amount_due ?? s.total_fees ?? 0;

  if (!sub) {
    const { data: archData } = await supabase
      .from('monthly_archives')
      .select('archive_data')
      .eq('archive_month', monthKey)
      .maybeSingle();
    const archStudent = ((archData?.archive_data as Record<string, unknown[]> | null)?.students as (Student & { total_fees?: number })[] | undefined)?.find((st) => st.id === studentId);
    if (archStudent) {
      totalFees = archStudent.total_fees ?? totalFees;
    }
  }

  const { data: monthPayments } = await supabase
    .from('payments')
    .select('amount, month_key, payment_date, is_historical_payment, target_archive_month')
    .eq('student_id', studentId)
    .eq('is_deleted', false);
  const allPayments = (monthPayments ?? []) as { amount: number; month_key: string | null; payment_date: string | null; is_historical_payment: boolean | null; target_archive_month: string | null }[];

  // Only count payments for the exact target month. Historical payments
  // target an archive month and must not be double-counted here.
  const totalPaid = allPayments.reduce((sum, p) => {
    const rowMonth = p.month_key;
    const rowDate = p.payment_date ?? '';
    const isHistoricalForOtherMonth = p.is_historical_payment && p.target_archive_month !== monthKey;
    if (isHistoricalForOtherMonth) return sum;
    const matches = rowMonth === monthKey || (!rowMonth && rowDate >= start && rowDate < end);
    return matches ? sum + Number(p.amount ?? 0) : sum;
  }, 0);

  const isExempt = sub?.is_exempt ?? s.is_exempt ?? false;
  const remaining = isExempt ? 0 : Math.max(0, totalFees - totalPaid);

  const safePaymentAmount = typeof thisPaymentAmount === 'number' && isFinite(thisPaymentAmount) ? thisPaymentAmount : 0;

  return {
    studentId,
    studentName: s.name,
    monthKey,
    thisPaymentAmount: safePaymentAmount,
    totalFees,
    totalPaid,
    remaining,
    isExempt,
    paymentDate: paymentDate ?? new Date().toISOString().slice(0, 10),
    recordedAt: new Date().toISOString(),
    receiptNumber,
    collectorName: undefined,
    groupName: s.group?.name,
    gradeName: s.group?.grade_level?.name,
    stageName: s.group?.grade_level?.stage?.name,
    parentPhone: s.parent_phone ?? undefined,
    studentPhone: s.phone ?? undefined,
  };
}

export function getPaymentStatus(snapshot: PaymentSnapshot): PaymentStatus {
  if (snapshot.isExempt) return 'exempt';
  return snapshot.remaining <= 0 ? 'full' : 'partial';
}

export function buildPaymentWhatsAppMessage(snapshot: PaymentSnapshot, platformName: string): string {
  const monthLabel = getMonthLabel(snapshot.monthKey);
  const status = getPaymentStatus(snapshot);
  const statusLabel = status === 'exempt'
    ? 'معفي من المصروفات ✅'
    : status === 'full'
      ? 'تم السداد بالكامل ✅'
      : 'دفعة جزئية — يوجد مبلغ متبقي';

  const dateDisplay = snapshot.paymentDate ? formatArabicDate(snapshot.paymentDate) : '';
  const timeDisplay = snapshot.recordedAt ? formatTime(snapshot.recordedAt) : '';
  const gradeLine = (snapshot.gradeName || snapshot.stageName)
    ? `🎓 الصف: ${[snapshot.stageName, snapshot.gradeName].filter(Boolean).join(' - ')}\n`
    : '';

  return (
    `💰 *إشعار سداد مصروفات — ${platformName}*\n\n` +
    `👤 اسم الطالب: ${snapshot.studentName}\n` +
    (snapshot.groupName ? `📚 المجموعة: ${snapshot.groupName}\n` : '') +
    gradeLine +
    `📅 الشهر: ${monthLabel}\n` +
    `💎 إجمالي المصروفات: ${formatCurrency(snapshot.totalFees)} ج.م\n` +
    `✨ إجمالي المدفوع حالياً: ${formatCurrency(snapshot.totalPaid)} ج.م\n` +
    `📌 المبلغ المتبقي: ${formatCurrency(snapshot.remaining)} ج.م\n` +
    (dateDisplay ? `📆 تاريخ المعاملة: ${dateDisplay}\n` : '') +
    (timeDisplay ? `🕐 وقت المعاملة: ${timeDisplay}\n` : '') +
    (snapshot.receiptNumber ? `🧾 رقم الإيصال: ${snapshot.receiptNumber}\n` : '') +
    `✅ حالة السداد: ${statusLabel}\n` +
    (snapshot.collectorName ? `✅ استلم بواسطة: ${snapshot.collectorName}\n` : '') +
    `\nشكراً لكم 🌸\n` +
    `${platformName}`
  );
}

export function buildUnpaidReminderMessage(snapshot: PaymentSnapshot): string {
  const monthLabel = getMonthLabel(snapshot.monthKey);
  const paidLabel = snapshot.totalPaid > 0 ? formatCurrency(snapshot.totalPaid) : '0';
  return (
    `🌷 السلام عليكم ورحمة الله وبركاته\n` +
    `ولي الأمر الكريم،\n` +
    `نود تذكيركم بالمصروفات الشهرية الخاصة بالطالب/ة ${snapshot.studentName} عن شهر ${monthLabel}.\n` +
    `💰 إجمالي المصروفات: ${formatCurrency(snapshot.totalFees)} ج.م\n` +
    `🟩 المدفوع: ${paidLabel} ج.م\n` +
    `🤍 شكرًا لثقتكم ودعمكم الدائم، وإذن الله دائمًا نشوف أولادنا في أعلى المراتب.`
  );
}

export function buildUnpaidReminderLink(snapshot: PaymentSnapshot): string {
  const msg = buildUnpaidReminderMessage(snapshot);
  const phone = normalizePhoneForWhatsApp(snapshot.parentPhone ?? snapshot.studentPhone ?? '');
  return phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

export function buildPaymentWhatsAppLink(snapshot: PaymentSnapshot, platformName: string): string {
  const msg = buildPaymentWhatsAppMessage(snapshot, platformName);
  const phone = normalizePhoneForWhatsApp(snapshot.parentPhone ?? snapshot.studentPhone ?? '');
  return phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

export function openPaymentWhatsApp(snapshot: PaymentSnapshot, platformName: string): void {
  const url = buildPaymentWhatsAppLink(snapshot, platformName);
  openWhatsAppURL(url);
}
