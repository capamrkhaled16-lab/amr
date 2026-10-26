import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarDays, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, Clock, Archive, Plus, Factory as History, TrendingDown, DollarSign, Percent, Printer, Receipt, BookOpen, Send, Eye, MessageCircle, Copy } from 'lucide-react';
import StudentViewModal from '@/components/ui/StudentViewModal';
import type { Student, MonthlySubscription } from '@/lib/types';
import {
  fetchStudentsByGroup,
  fetchMonthlySubscriptions,
  fetchArchivedSubscriptions,
  ensureMonthlySubscriptions,
  paySubscription,
  updateSubscriptionAmountDue,
  archiveUnpaidSubscriptions,
  getMonthLabel,
  fetchStudentPaymentHistory,
} from '@/lib/data';
import { fetchGradeLevelBaseSubscription } from '@/lib/data';
import { formatCurrency, formatArabicDate, openWhatsAppURL } from '@/lib/format';
import { resolvePaymentSnapshot, buildPaymentWhatsAppMessage, buildPaymentWhatsAppLink, buildUnpaidReminderLink, openPaymentWhatsApp, type PaymentSnapshot } from '@/lib/whatsappPayment';
import { useToast } from '@/lib/toast';
import { ARABIC_MONTHS } from '@/lib/constants';
import { buildReceiptHTML, printDocument } from '@/lib/export';
import { invalidateByPrefix } from '@/lib/cache';
import { useAuth } from '@/context/AuthContext';
import { useMonth } from '@/context/MonthContext';
import { useSettings } from '@/context/SettingsContext';
import { supabase } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type Props = {
  groupId: string;
  stageId: string;
  gradeLevelId: string;
};

const inputCls = 'w-full glass-light rounded-xl py-2.5 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm';

export default function SubscriptionsModule({ groupId, gradeLevelId }: Props) {
  const { isMaster, assistant } = useAuth();
  const { monthKey, setMonthKey, monthOptions } = useMonth();
  const [students, setStudents] = useState<Student[]>([]);
  const [subs, setSubs] = useState<MonthlySubscription[]>([]);
  const [archived, setArchived] = useState<MonthlySubscription[]>([]);
  const [baseAmount, setBaseAmount] = useState(0);
  const [payTarget, setPayTarget] = useState<MonthlySubscription | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [isLate, setIsLate] = useState(false);
  const [discountTarget, setDiscountTarget] = useState<MonthlySubscription | null>(null);
  const [discountAmount, setDiscountAmount] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [payFilter, setPayFilter] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');
  const [lastReceipt, setLastReceipt] = useState<{ receiptNumber: string; studentName: string; amount: number; date: string; month?: string; note?: string | null; recordedBy?: string | null; groupName?: string; gradeName?: string; stageName?: string; baseSubscription?: number; studentId?: string } | null>(null);
  const [groupInfo, setGroupInfo] = useState<{ name?: string; gradeName?: string; stageName?: string }>({});
  const [ledgerTarget, setLedgerTarget] = useState<Student | null>(null);
  const [ledgerData, setLedgerData] = useState<MonthlySubscription[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [viewTarget, setViewTarget] = useState<Student | null>(null);

  const actorName = isMaster ? 'المدرس' : assistant?.display_name ?? assistant?.username ?? 'مساعد';
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [whatsappBusyId, setWhatsappBusyId] = useState<string | null>(null);
  const [receiptPreviewText, setReceiptPreviewText] = useState<string | null>(null);
  const [receiptPreviewLoading, setReceiptPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const allStudents = await fetchStudentsByGroup(groupId);
      setStudents(allStudents);
      const amount = await fetchGradeLevelBaseSubscription(gradeLevelId);
      setBaseAmount(amount);
      const now = new Date(monthKey + '-01');
      const monthLabel = getMonthLabel(now);
      const ensured = await ensureMonthlySubscriptions(
        allStudents.map((s) => s.id),
        monthLabel,
        monthKey,
        amount
      );
      setSubs(ensured);
      const arch = await fetchArchivedSubscriptions(allStudents.map((s) => s.id));
      setArchived(arch);
    } catch {
      // Silently skip — realtime subscription will retry
    }
  }, [groupId, gradeLevelId, monthKey]);

  useEffect(() => { load(); }, [load]);

  // Read-only refresh for realtime updates — does NOT call ensureMonthlySubscriptions to avoid write-on-read
  const refreshSubsOnly = useCallback(async () => {
    if (students.length === 0) return;
    try {
      const subsData = await fetchMonthlySubscriptions(students.map((s) => s.id), monthKey);
      setSubs(subsData);
      const arch = await fetchArchivedSubscriptions(students.map((s) => s.id));
      setArchived(arch);
    } catch {
      // Silently skip — will retry on next realtime event
    }
  }, [students, monthKey]);

  // Realtime: refresh when payments, subscriptions, or students change (including from other modules)
  useEffect(() => {
    let debounced: ReturnType<typeof setTimeout> | null = null;
    const triggerRefresh = () => {
      if (debounced) clearTimeout(debounced);
      debounced = setTimeout(() => { refreshSubsOnly(); }, 600);
    };
    const channel = supabase
      .channel('subscriptions-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, triggerRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_subscriptions' }, triggerRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, triggerRefresh)
      .subscribe();
    return () => { if (debounced) clearTimeout(debounced); void supabase.removeChannel(channel); };
  }, [refreshSubsOnly]);

  useEffect(() => {
    (async () => {
      const { data: g } = await supabase
        .from('groups')
        .select('name, grade_level:grade_levels(name, stage:academic_stages(name))')
        .eq('id', groupId)
        .maybeSingle();
      if (g) {
        const gd = g as unknown as { name: string; grade_level: { name: string; stage: { name: string } } };
        setGroupInfo({ name: gd.name, gradeName: gd.grade_level?.name, stageName: gd.grade_level?.stage?.name });
      }
    })();
  }, [groupId]);

  // Auto-generate the formatted receipt message text whenever a receipt is shown
  useEffect(() => {
    let cancelled = false;
    if (!lastReceipt) { setReceiptPreviewText(null); return; }
    setReceiptPreviewLoading(true);
    resolveReceiptSnapshot(lastReceipt)
      .then((snap) => {
        if (cancelled || !snap) { setReceiptPreviewText(null); return; }
        setReceiptPreviewText(buildPaymentWhatsAppMessage(snap, settings.platform_name));
      })
      .catch(() => !cancelled && setReceiptPreviewText(null))
      .finally(() => !cancelled && setReceiptPreviewLoading(false));
    return () => { cancelled = true; };
  }, [lastReceipt, settings.platform_name]);

  // WhatsApp is opened manually from the receipt modal's "واتساب" button,
  // after the user reviews the real payment details. No auto-open.

  async function handleFullPay(sub: MonthlySubscription) {
    const remaining = sub.amount_due - sub.amount_paid;
    if (remaining <= 0) return;
    const prevSubs = subs;
    setSubs((prev) => prev.map((s) => s.id === sub.id ? { ...s, amount_paid: s.amount_due, status: 'paid' } : s));
    try {
      const receiptNum = await paySubscription(sub.id, remaining, sub.is_archived, actorName, 'دفع كامل');
      if (receiptNum) {
        const studentName = students.find((s) => s.id === sub.student_id)?.name ?? 'طالب';
        setLastReceipt({ receiptNumber: receiptNum, studentName, amount: remaining, date: new Date().toISOString().slice(0, 10), month: sub.month, note: 'دفع كامل', recordedBy: actorName, groupName: groupInfo.name, gradeName: groupInfo.gradeName, stageName: groupInfo.stageName, baseSubscription: baseAmount, studentId: sub.student_id });
      }
      invalidateByPrefix('students_');
      invalidateByPrefix('payments_');
      invalidateByPrefix('monthly_');
      load();
    } catch {
      setSubs(prevSubs);
    }
  }

  async function handleHalfMonthPay(sub: MonthlySubscription) {
    const remaining = sub.amount_due - sub.amount_paid;
    if (remaining <= 0) return;
    const halfAmount = Math.ceil(baseAmount / 2);
    const payValue = Math.min(halfAmount, remaining);
    const prevSubs = subs;
    setSubs((prev) => prev.map((s) => s.id === sub.id ? { ...s, amount_paid: s.amount_paid + payValue, status: s.amount_paid + payValue >= s.amount_due ? 'paid' : 'partial' } : s));
    try {
      const receiptNum = await paySubscription(sub.id, payValue, sub.is_archived, actorName, 'دفع نصف شهر');
      if (receiptNum) {
        const studentName = students.find((s) => s.id === sub.student_id)?.name ?? 'طالب';
        setLastReceipt({ receiptNumber: receiptNum, studentName, amount: payValue, date: new Date().toISOString().slice(0, 10), month: sub.month, note: 'دفع نصف شهر', recordedBy: actorName, groupName: groupInfo.name, gradeName: groupInfo.gradeName, stageName: groupInfo.stageName, baseSubscription: baseAmount, studentId: sub.student_id });
      }
      invalidateByPrefix('students_');
      invalidateByPrefix('payments_');
      invalidateByPrefix('monthly_');
      load();
    } catch {
      setSubs(prevSubs);
    }
  }

  async function handleApplyDiscount() {
    if (!discountTarget) return;
    const newAmount = parseFloat(discountAmount);
    if (isNaN(newAmount) || newAmount < 0) return;
    const prevSubs = subs;
    setSubs((prev) => prev.map((s) => s.id === discountTarget.id ? { ...s, amount_due: newAmount } : s));
    setDiscountTarget(null);
    setDiscountAmount('');
    try {
      await updateSubscriptionAmountDue(discountTarget.id, newAmount);
      load();
    } catch {
      setSubs(prevSubs);
    }
  }

  async function handlePartialPay() {
    if (!payTarget || !payAmount) return;
    const amount = parseFloat(payAmount);
    if (amount <= 0) return;
    const prevSubs = subs;
    const target = payTarget;
    setSubs((prev) => prev.map((s) => s.id === target.id ? { ...s, amount_paid: s.amount_paid + amount, status: s.amount_paid + amount >= s.amount_due ? 'paid' : 'partial' } : s));
    setPayTarget(null);
    setPayAmount('');
    setPayNote('');
    setIsLate(false);
    try {
      const receiptNum = await paySubscription(target.id, amount, target.is_archived, actorName, payNote.trim() || null);
      if (receiptNum) {
        const studentName = students.find((s) => s.id === target.student_id)?.name ?? 'طالب';
        setLastReceipt({ receiptNumber: receiptNum, studentName, amount, date: new Date().toISOString().slice(0, 10), month: target.month, note: payNote.trim() || null, recordedBy: actorName, groupName: groupInfo.name, gradeName: groupInfo.gradeName, stageName: groupInfo.stageName, baseSubscription: baseAmount, studentId: target.student_id });
      }
      invalidateByPrefix('students_');
      invalidateByPrefix('payments_');
      invalidateByPrefix('monthly_');
      load();
    } catch {
      setSubs(prevSubs);
    }
  }

  async function openLedger(s: Student) {
    setLedgerTarget(s);
    setLedgerLoading(true);
    try {
      const history = await fetchStudentPaymentHistory(s.id);
      setLedgerData(history);
    } catch {
      setLedgerData([]);
    } finally {
      setLedgerLoading(false);
    }
  }

  function monthKeyFromMonthLabel(monthLabel?: string): string {
    if (!monthLabel) return monthKey;
    const parts = monthLabel.split(' ');
    if (parts.length < 2) return monthKey;
    return `${parts[1]}-${String(ARABIC_MONTHS.indexOf(parts[0]) + 1).padStart(2, '0')}`;
  }

  async function resolveReceiptSnapshot(r: { receiptNumber: string; studentName: string; amount: number; date: string; month?: string; note?: string | null; recordedBy?: string | null; groupName?: string; gradeName?: string; stageName?: string; baseSubscription?: number; studentId?: string }): Promise<PaymentSnapshot | null> {
    if (!r.studentId) {
      showToast('تعذّر تحديد الطالب', 'error');
      return null;
    }
    const snapshot = await resolvePaymentSnapshot(
      r.studentId,
      monthKeyFromMonthLabel(r.month),
      r.amount,
      r.date,
      r.receiptNumber,
    );
    if (!snapshot) {
      showToast('تعذّر جلب بيانات الدفع', 'error');
      return null;
    }
    return { ...snapshot, collectorName: r.recordedBy ?? snapshot.collectorName };
  }

  async function sendReceiptWhatsApp(r: { receiptNumber: string; studentName: string; amount: number; date: string; month?: string; note?: string | null; recordedBy?: string | null; groupName?: string; gradeName?: string; stageName?: string; baseSubscription?: number; studentId?: string }) {
    const snapshot = await resolveReceiptSnapshot(r);
    if (!snapshot) return;
    openPaymentWhatsApp(snapshot, settings.platform_name);
  }

  async function sendLatestPaymentWhatsApp(studentId: string) {
    if (whatsappBusyId === studentId) return;
    setWhatsappBusyId(studentId);
    try {
      const { data: latest, error } = await supabase
        .from('payments')
        .select('id, amount, payment_date, receipt_number, note, recorded_by, month_key')
        .eq('student_id', studentId)
        .eq('is_deleted', false)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !latest) {
        // No payment on record — fall back to an unpaid reminder so the
        // WhatsApp button is always useful, even before any payment exists.
        const reminderSnap = await resolvePaymentSnapshot(studentId, monthKey, 0);
        if (reminderSnap) {
          openWhatsAppURL(buildUnpaidReminderLink(reminderSnap));
        } else {
          showToast('لا توجد دفعة مسجلة لهذا الطالب', 'error');
        }
        return;
      }
      const pay = latest as { id: string; amount: number; payment_date: string; receipt_number: string | null; note: string | null; recorded_by: string | null; month_key: string | null };
      const receiptMonth = pay.month_key ?? monthKey;
      const snapshot = await resolvePaymentSnapshot(
        studentId,
        receiptMonth,
        pay.amount,
        pay.payment_date,
        pay.receipt_number ?? undefined,
      );
      if (!snapshot) {
        showToast('تعذّر جلب بيانات الدفع', 'error');
        return;
      }
      const enriched: PaymentSnapshot = { ...snapshot, collectorName: pay.recorded_by ?? snapshot.collectorName };
      openWhatsAppURL(buildPaymentWhatsAppLink(enriched, settings.platform_name));
    } catch {
      showToast('تعذّر إرسال رسالة واتساب', 'error');
    } finally {
      setWhatsappBusyId(null);
    }
  }

  async function handleArchiveMonth() {
    if (!archiveTarget) return;
    const prevSubs = subs;
    const prevArchived = archived;
    const newlyArchived = subs.filter((s) => s.status !== 'paid' && s.status !== 'late_paid');
    setArchived((prev) => [...prev, ...newlyArchived]);
    setSubs((prev) => prev.map((s) => s.status === 'paid' || s.status === 'late_paid' ? s : { ...s, is_archived: true }));
    setArchiveTarget(null);
    try {
      await archiveUnpaidSubscriptions(archiveTarget);
      load();
    } catch {
      setSubs(prevSubs);
      setArchived(prevArchived);
    }
  }

  const exemptIds = new Set(students.filter((s) => s.is_exempt).map((s) => s.id));
  const billableSubs = subs.filter((s) => !exemptIds.has(s.student_id) && s.amount_due > 0);
  const paidCount = billableSubs.filter((s) => s.status === 'paid' || s.status === 'late_paid').length;
  const partialCount = billableSubs.filter((s) => s.status === 'partial').length;
  const unpaidCount = billableSubs.filter((s) => s.status === 'unpaid').length;
  const totalCollected = billableSubs.reduce((sum, s) => sum + s.amount_paid, 0);
  const totalDue = billableSubs.reduce((sum, s) => sum + s.amount_due, 0);

  const subByStudent = new Map(subs.map((s) => [s.student_id, s]));
  const archivedByStudent = new Map(archived.map((s) => [s.student_id, s]));

  const filteredStudents = useMemo(() => {
    const billable = students.filter((s) => !s.is_exempt);
    if (payFilter === 'all') return billable;
    return billable.filter((s) => {
      const sub = subByStudent.get(s.id);
      if (!sub) return payFilter === 'unpaid';
      if (payFilter === 'paid') return sub.status === 'paid' || sub.status === 'late_paid';
      if (payFilter === 'partial') return sub.status === 'partial';
      if (payFilter === 'unpaid') return sub.status === 'unpaid';
      return true;
    });
  }, [students, payFilter, subs]);

  return (
    <div className="space-y-4">
      {/* Month selector + summary */}
      <div className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl"><CalendarDays size={20} /></div>
            <div>
              <h2 className="text-xl font-bold text-white">متابعة اشتراكات الشهور</h2>
              <p className="text-sm text-slate-300">الاشتراك الأساسي: {formatCurrency(baseAmount)} ج.م / شهر</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              className="glass-light border border-white/10 text-emerald-400 text-xs font-bold px-4 py-2.5 rounded-xl focus:outline-none cursor-pointer"
            >
              {monthOptions.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            {isMaster && (
              <Button size="sm" variant="warning" onClick={() => setArchiveTarget(monthKey)} title="أرشفة المتأخرات لهذا الشهر">
                <Archive size={14} /> أرشفة المتأخرات
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setArchiveOpen(true)}>
              <History size={14} /> الأرشيف ({archived.length})
            </Button>
          </div>
        </div>

        {/* Summary cards — financial counts visible to master only */}
        {isMaster ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryBox label="إجمالي الطلاب" value={`${billableSubs.length}`} color="text-white" />
            <SummaryBox label="دفع كامل" value={`${paidCount}`} color="text-emerald-400" icon={<CheckCircle2 size={16} />} />
            <SummaryBox label="دفع جزئي" value={`${partialCount}`} color="text-amber-400" icon={<Clock size={16} />} />
            <SummaryBox label="لم يدفع" value={`${unpaidCount}`} color="text-red-400" icon={<AlertTriangle size={16} />} />
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center py-2">ملخص أعداد الدفعات متاح للمدرس فقط.</p>
        )}
        {isMaster && (
          <div className="grid grid-cols-2 gap-3">
            <SummaryBox label="المحصل هذا الشهر" value={`${formatCurrency(totalCollected)} ج.م`} color="text-emerald-400" />
            <SummaryBox label="المتبقي هذا الشهر" value={`${formatCurrency(totalDue - totalCollected)} ج.م`} color="text-amber-400" />
          </div>
        )}
      </div>

      {/* Payment audit filters */}
      <div className="glass-card rounded-2xl p-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 ml-1">تصفية حسب السداد:</span>
        {([
          { key: 'all', label: 'الكل' },
          { key: 'paid', label: 'دفع كامل' },
          { key: 'partial', label: 'دفع جزئي' },
          { key: 'unpaid', label: 'لم يدفع' },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setPayFilter(f.key)}
            className={'px-3 py-1.5 rounded-lg text-xs font-bold transition ' + (payFilter === f.key
              ? 'bg-emerald-600 text-white shadow-lg'
              : 'glass-light text-slate-400 hover:bg-white/10')}
          >
            {f.label}
          </button>
        ))}
        <span className="text-[11px] text-slate-500 mr-auto">
          {filteredStudents.length} من {billableSubs.length} طالب
        </span>
      </div>

      {/* Students list */}
      {filteredStudents.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center text-slate-400">
          {students.length === 0 ? 'لا يوجد طلاب في هذه المجموعة.' : 'لا يوجد طلاب بهذه الفلترة.'}
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-4 sm:p-6 space-y-3">
          <div className="space-y-3">
            {filteredStudents.map((s) => {
              const sub = subByStudent.get(s.id);
              if (!sub) return null;
              const remaining = sub.amount_due - sub.amount_paid;
              const isFull = remaining <= 0;
              const pct = sub.amount_due > 0 ? Math.min(100, Math.round((sub.amount_paid / sub.amount_due) * 100)) : 0;
              const studentArchived = archivedByStudent.get(s.id);
              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`glass-light rounded-xl p-4 border ${isFull ? 'border-emerald-500/40' : remaining === sub.amount_due ? 'border-red-500/40' : 'border-amber-500/40'}`}
                >
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-white text-base">{s.name}</h4>
                        {isFull ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">
                            {sub.status === 'late_paid' ? <><Clock size={12} /> دفع متأخر</> : <><CheckCircle2 size={12} /> مسدد</>}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-red-400 bg-red-500/10 px-2.5 py-1 rounded-full animate-pulse"><AlertTriangle size={12} /> متبقي</span>
                        )}
                        {sub.is_archived && !isFull && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full"><Archive size={12} /> مديونية</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-300 mt-1">
                        الاشتراك: <span className="font-semibold text-white">{formatCurrency(sub.amount_due)} ج.م</span> • المدفوع: <span className="font-semibold text-emerald-400">{formatCurrency(sub.amount_paid)} ج.م</span> • المتبقي: <span className="font-bold text-amber-400">{formatCurrency(remaining)} ج.م</span>
                      </p>
                      <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isFull ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                      {studentArchived && studentArchived.student_id === s.id && studentArchived.amount_due > studentArchived.amount_paid && (
                        <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1 font-semibold"><TrendingDown size={12} /> متأخرات سابقة: {formatCurrency(studentArchived.amount_due - studentArchived.amount_paid)} ج.م</p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap items-center">
                      <Button size="sm" variant="secondary" onClick={() => setViewTarget(s)} title="عرض بيانات الطالب"><Eye size={14} /> عرض</Button>
                      {!isFull && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => handleFullPay(sub)} title="تسجيل دفع كامل"><CheckCircle2 size={14} /> دفع كامل</Button>
                          <Button size="sm" variant="secondary" onClick={() => handleHalfMonthPay(sub)} title="تسجيل دفع نصف شهر للطلاب المنضمين متأخراً"><Clock size={14} /> نصف الشهر</Button>
                          <Button size="sm" onClick={() => { setPayTarget(sub); setPayAmount(''); setPayNote(''); setIsLate(sub.is_archived); }}><Plus size={14} /> دفعة جزئية</Button>
                          <button
                            type="button"
                            onClick={() => sendLatestPaymentWhatsApp(s.id)}
                            disabled={whatsappBusyId === s.id}
                            title="إرسال إيصال الدفع أو تذكير السداد عبر واتساب"
                            aria-label="واتساب"
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-emerald-200 bg-emerald-500/20 border-2 border-emerald-400/50 hover:bg-emerald-500/30 hover:text-emerald-100 hover:border-emerald-300/70 shadow-sm shadow-emerald-500/10 transition disabled:opacity-50 disabled:cursor-wait"
                          >
                            {whatsappBusyId === s.id ? <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-300/40 border-t-emerald-300 rounded-full animate-spin" /> : <MessageCircle size={16} />}
                            واتساب
                          </button>
                          {isMaster && (
                            <Button size="sm" variant="secondary" onClick={() => { setDiscountTarget(sub); setDiscountAmount(String(sub.amount_due)); }} title="تعديل المبلغ المطلوب (خصم مخصص)"><Percent size={14} /> خصم</Button>
                          )}
                          <Button size="sm" variant="secondary" onClick={() => openLedger(s)} title="عرض كشف حساب الطالب"><BookOpen size={14} /> كشف حساب</Button>
                          {sub.is_archived && isMaster && (
                            <Button size="sm" variant="warning" onClick={() => { setPayTarget(sub); setPayAmount(''); setPayNote(''); setIsLate(true); }} title="تسجيل دفع متأخر للشهر المنتهي"><Clock size={14} /> دفع متأخر</Button>
                          )}
                        </>
                      )}
                      {isFull && (
                        <button
                          type="button"
                          onClick={() => sendLatestPaymentWhatsApp(s.id)}
                          disabled={whatsappBusyId === s.id}
                          title="إرسال إيصال الدفع عبر واتساب"
                          aria-label="واتساب"
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-emerald-200 bg-emerald-500/20 border-2 border-emerald-400/50 hover:bg-emerald-500/30 hover:text-emerald-100 hover:border-emerald-300/70 shadow-sm shadow-emerald-500/10 transition disabled:opacity-50 disabled:cursor-wait"
                        >
                          {whatsappBusyId === s.id ? <span className="inline-block w-3.5 h-3.5 border-2 border-emerald-300/40 border-t-emerald-300 rounded-full animate-spin" /> : <MessageCircle size={16} />}
                          واتساب
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Partial payment modal */}
      <Modal open={!!payTarget} onClose={() => { setPayTarget(null); setPayAmount(''); setPayNote(''); setIsLate(false); }} title={`تسجيل دفعة ${isLate ? 'متأخرة' : 'جزئية'}`} size="sm">
        <div className="space-y-4">
          {payTarget && (
            <div className="glass-light rounded-xl p-3 text-center text-sm text-slate-300">
              المتبقي: <span className="font-bold text-amber-400">{formatCurrency(payTarget.amount_due - payTarget.amount_paid)} ج.م</span>
              {isLate && <p className="text-[10px] text-amber-400 mt-1">هذا دفع متأخر لشهر منتهي — سيُسجّل في الأرشيف ويُضاف للخزينة.</p>}
            </div>
          )}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">المبلغ المدفوع (ج.م)</label>
            <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" autoFocus className={inputCls} />
            {payTarget && payAmount && parseFloat(payAmount) > 0 && (
              <p className="text-xs mt-2 text-amber-400">
                المتبقي بعد الدفع: {formatCurrency(Math.max(0, (payTarget.amount_due - payTarget.amount_paid) - parseFloat(payAmount)))} ج.م
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">ملاحظة (اختياري)</label>
            <input type="text" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="مثال: دفعة شهر أكتوبر" className={inputCls} />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setPayTarget(null); setPayAmount(''); setPayNote(''); setIsLate(false); }}>إلغاء</Button>
            <Button onClick={handlePartialPay} disabled={!payAmount || parseFloat(payAmount) <= 0}>تسجيل الدفعة</Button>
          </div>
        </div>
      </Modal>

      {/* Archive modal — shows all archived/debt subscriptions */}
      <Modal open={archiveOpen} onClose={() => setArchiveOpen(false)} title="أرشيف المتأخرات والمديونيات" size="md">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {archived.length === 0 ? (
            <p className="text-center text-slate-400 py-6">لا توجد متأخرات مؤرشفة.</p>
          ) : (
            archived.map((a) => {
              const studentName = students.find((s) => s.id === a.student_id)?.name ?? 'طالب';
              const remaining = a.amount_due - a.amount_paid;
              const isPaid = remaining <= 0;
              return (
                <div key={a.id} className="glass-light rounded-xl p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-bold text-white text-base">{studentName}</p>
                    <p className="text-sm text-slate-300 mt-1">{a.month}</p>
                    <div className="flex items-center gap-3 mt-1 text-sm flex-wrap">
                      <span className="text-slate-300">المطلوب: <span className="font-semibold text-white">{formatCurrency(a.amount_due)} ج.م</span></span>
                      <span className="text-emerald-400">المدفوع: <span className="font-semibold">{formatCurrency(a.amount_paid)} ج.م</span></span>
                      <span className={isPaid ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>المتبقي: {formatCurrency(remaining)} ج.م</span>
                    </div>
                    {isPaid && a.receipt_number && (
                      <button onClick={() => printDocument(`إيصال ${a.receipt_number}`, buildReceiptHTML({ receiptNumber: a.receipt_number!, studentName, amount: a.amount_paid, date: a.paid_date ?? a.created_at.slice(0, 10), month: a.month, recordedBy: a.recorded_by }))} className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 mt-1"><Printer size={10} /> طباعة إيصال</button>
                    )}
                  </div>
                  {remaining > 0 && (
                    <Button size="sm" variant="warning" onClick={() => { setArchiveOpen(false); setPayTarget(a); setPayAmount(''); setPayNote(''); setIsLate(true); }}>
                      <Clock size={14} /> دفع متأخر
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={handleArchiveMonth}
        title="أرشفة المتأخرات"
        subtext="سيتم ترحيل جميع الاشتراكات غير المدفوعة أو الجزئية لهذا الشهر إلى أرشيف المديونيات. يمكن استلام الدفعات المتأخرة لاحقاً."
        confirmLabel="تأكيد الأرشفة"
      />

      {/* Custom discount modal */}
      <Modal open={!!discountTarget} onClose={() => { setDiscountTarget(null); setDiscountAmount(''); }} title={`خصم مخصص: ${students.find((s) => s.id === discountTarget?.student_id)?.name ?? ''}`} size="sm">
        <div className="space-y-4">
          <div className="glass-light rounded-xl p-3 text-center text-sm text-slate-300">
            المبلغ الحالي المطلوب: <span className="font-bold text-white">{formatCurrency(discountTarget?.amount_due ?? 0)} ج.م</span>
            <p className="text-xs text-slate-400 mt-1">المدفوع حتى الآن: {formatCurrency(discountTarget?.amount_paid ?? 0)} ج.م</p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">المبلغ الجديد بعد الخصم (ج.م)</label>
            <input type="number" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} placeholder="0" autoFocus className={inputCls} />
            <p className="text-xs mt-2 text-amber-400">سيتم تحديث المبلغ المطلوب. إذا كان المدفوع يغطي المبلغ الجديد، سيُعتبر الطالب مسدداً بالكامل تلقائياً.</p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setDiscountTarget(null); setDiscountAmount(''); }}>إلغاء</Button>
            <Button onClick={handleApplyDiscount} disabled={!discountAmount || parseFloat(discountAmount) < 0}>تطبيق الخصم</Button>
          </div>
        </div>
      </Modal>

      {/* Receipt Modal */}
      <Modal open={!!lastReceipt} onClose={() => { setLastReceipt(null); setReceiptPreviewText(null); }} title="إيصال دفع" size="sm">
        {lastReceipt && (
          <div className="space-y-4">
            <div className="glass-light rounded-xl p-4 text-center">
              <div className="flex items-center justify-center gap-2 mb-3">
                <Receipt size={20} className="text-emerald-400" />
                <span className="text-sm font-bold text-emerald-400">تم تسجيل الدفعة بنجاح</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">رقم الإيصال:</span><span className="text-white font-bold" dir="ltr">{lastReceipt.receiptNumber}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">الطالب:</span><span className="text-white font-bold">{lastReceipt.studentName}</span></div>
                {lastReceipt.month && <div className="flex justify-between"><span className="text-slate-400">الشهر:</span><span className="text-white">{lastReceipt.month}</span></div>}
                <div className="flex justify-between"><span className="text-slate-400">المبلغ:</span><span className="text-emerald-400 font-bold text-lg">{formatCurrency(lastReceipt.amount)} ج.م</span></div>
                <div className="flex justify-between"><span className="text-slate-400">التاريخ:</span><span className="text-white">{formatArabicDate(lastReceipt.date)}</span></div>
                {lastReceipt.note && <div className="flex justify-between"><span className="text-slate-400">ملاحظة:</span><span className="text-white">{lastReceipt.note}</span></div>}
              </div>
            </div>
            <div className="glass-light rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                <MessageCircle size={14} />
                <span>معاينة نص الإيصال (واتساب)</span>
              </div>
              {receiptPreviewLoading ? (
                <p className="text-xs text-slate-400">جارٍ توليد النص...</p>
              ) : receiptPreviewText ? (
                <pre className="text-[11px] leading-relaxed text-slate-200 whitespace-pre-wrap break-words bg-black/20 rounded-lg p-2.5 max-h-44 overflow-y-auto premium-scroll" dir="rtl">{receiptPreviewText}</pre>
              ) : (
                <p className="text-xs text-slate-500">تعذّر توليد نص المعاينة.</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => { setLastReceipt(null); setReceiptPreviewText(null); }}>إغلاق</Button>
              <Button variant="secondary" className="flex-1" onClick={async () => {
                if (!lastReceipt) return;
                const snap = await resolveReceiptSnapshot(lastReceipt);
                if (!snap) return;
                try {
                  await navigator.clipboard.writeText(buildPaymentWhatsAppMessage(snap, settings.platform_name));
                  showToast('تم نسخ نص الإيصال', 'success');
                } catch {
                  showToast('تعذّر نسخ النص', 'error');
                }
              }}><Copy size={16} /> نسخ</Button>
              <Button variant="secondary" className="flex-1" onClick={() => lastReceipt && sendReceiptWhatsApp(lastReceipt)}><Send size={16} /> واتساب</Button>
              <Button className="flex-1" onClick={() => lastReceipt && printDocument(`إيصال ${lastReceipt.receiptNumber}`, buildReceiptHTML({ ...lastReceipt, platformName: settings.platform_name, managementName: settings.management_name }))}><Printer size={16} /> طباعة</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Quick Ledger Modal */}
      <Modal open={!!ledgerTarget} onClose={() => { setLedgerTarget(null); setLedgerData([]); }} title={`كشف حساب: ${ledgerTarget?.name ?? ''}`} size="md">
        {ledgerLoading ? (
          <p className="text-center text-slate-400 py-6">جارٍ تحميل الكشف...</p>
        ) : ledgerData.length === 0 ? (
          <p className="text-center text-slate-400 py-6">لا توجد سجلات اشتراكات لهذا الطالب.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {ledgerData.map((h) => {
              const remaining = h.amount_due - h.amount_paid;
              const isFull = remaining <= 0;
              return (
                <div key={h.id} className={`glass-light rounded-xl p-3 border ${isFull ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-white">{h.month}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isFull ? 'bg-emerald-500/10 text-emerald-400' : h.status === 'partial' ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400 animate-pulse'}`}>
                      {isFull ? (h.status === 'late_paid' ? 'دفع متأخر' : 'مسدد') : h.status === 'partial' ? 'جزئي' : 'متأخر'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-300 flex-wrap">
                    <span>المطلوب: <span className="font-semibold text-white">{formatCurrency(h.amount_due)} ج.م</span></span>
                    <span className="text-emerald-400">المدفوع: {formatCurrency(h.amount_paid)} ج.م</span>
                    <span className={isFull ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>المتبقي: {formatCurrency(remaining)} ج.م</span>
                  </div>
                  {h.paid_date && <p className="text-[10px] text-slate-500 mt-1">تاريخ الدفع: {formatArabicDate(h.paid_date.slice(0, 10))}{h.recorded_by ? ` • سجّلها: ${h.recorded_by}` : ''}</p>}
                  {h.receipt_number && <p className="text-[10px] text-emerald-500 mt-0.5">إيصال: {h.receipt_number}</p>}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}

function SummaryBox({ label, value, color, icon }: { label: string; value: string; color: string; icon?: React.ReactNode }) {
  return (
    <div className="glass-light rounded-xl p-4 text-center">
      {icon && <div className="flex items-center justify-center gap-1 mb-1 text-slate-400">{icon}</div>}
      <span className="text-xs text-slate-300 block mb-1">{label}</span>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}
