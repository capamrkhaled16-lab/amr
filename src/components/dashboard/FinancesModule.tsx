import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettings } from '@/context/SettingsContext';
import { Plus, Trash2, CheckCircle2, AlertTriangle, MessageCircle, Download, Printer, History, UserCog, Shield, Clock3, ChevronLeft, Receipt, TrendingDown, Wallet, Image, FileText, Send, Lock, Edit3, Pencil, X, Sparkles, CalendarClock, RotateCcw, Eye, Search, GraduationCap, Users, Loader2, Calendar } from 'lucide-react';
import StudentViewModal from '@/components/ui/StudentViewModal';
import type { Student, Payment, AuditLog, AcademicStage, GradeLevel, Group, Expense, ExpenseCategory } from '@/lib/types';
import { fetchAllStudents, fetchPayments, createPayment, editPayment, deletePaymentWithAudit, deleteStudent, fetchAuditLogs, fetchStages, fetchGradeLevels, fetchGroups, fetchStudentsByGroup, fetchExpenses, createExpense, deleteExpense, fetchExpenseTotal, updateStudentTotalFees, setStudentExemption, setStudentDiscount, fetchGroupMonthlyCollected, fetchGroupMonthlyPaidMap, fetchMonthlyExemptMap } from '@/lib/data';
import { computeFinancialSummary, isNewThisMonth } from '@/lib/financeCalc';
import { formatCurrency, formatArabicDate, formatTime, formatTransactionDateTime, getMonthLabel, getMonthKey, normalizePhoneForWhatsApp, openWhatsAppURL } from '@/lib/format';
import { ARABIC_MONTHS } from '@/lib/constants';
import { exportToCSV, printDocument, buildUnpaidPrintHTML, buildReceiptHTML } from '@/lib/export';
import { exportUnpaidStudentsPDF, exportPaidStudentsPDF, exportMonthlyPaymentSummaryPDF, exportStudentListPDF } from '@/lib/pdfExport';
import { PDFButton } from '@/components/ui/PDFButton';
import { invalidateByPrefix } from '@/lib/cache';
import { eventBus } from '@/lib/eventBus';

import { toPng } from 'html-to-image';
import { useAuth } from '@/context/AuthContext';
import { useMonth } from '@/context/MonthContext';
import { supabase } from '@/lib/supabase';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';

type EnrichedStudent = Student & {
  group_name?: string;
  group_schedule?: string | null;
  grade_name?: string;
  stage_name?: string;
};

const ACTION_LABELS: Record<string, string> = {
  payment_create: 'تسجيل دفعة',
  payment_delete: 'حذف دفعة',
  payment_edit: 'تعديل دفعة',
  student_delete: 'حذف طالب',
  attendance_delete: 'حذف سجل حضور',
  expense_create: 'تسجيل مصروف',
  expense_delete: 'حذف مصروف',
  fee_override: 'تعديل يدوي للمصاريف',
  exemption_toggle: 'تفعيل/إلغاء إعفاء',
  discount_update: 'تحديث خصم',
  historical_payment: 'دفعة متأخرة (أرشيف)',
};

const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: 'rent', label: 'إيجار' },
  { id: 'electricity', label: 'كهرباء' },
  { id: 'assistants', label: 'ملازم' },
  { id: 'other', label: 'أخرى' },
];

const inputCls = 'w-full glass-light rounded-xl py-2.5 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm';

type Props = {
  focusStageId?: string | null;
  focusGradeId?: string | null;
  focusGroupId?: string | null;
  focusStudentId?: string | null;
  onBack?: () => void;
};

function ReceiptRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-white/5">
      <span className="text-xs text-slate-400 font-medium">{label}</span>
      <span className={`text-sm ${bold ? 'text-white font-bold' : 'text-slate-200 font-medium'}`}>{value}</span>
    </div>
  );
}

export default function FinancesModule({ focusStageId, focusGradeId, focusGroupId, focusStudentId, onBack }: Props = {}) {
  const { isMaster, assistant } = useAuth();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const { monthKey } = useMonth();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [stages, setStages] = useState<AcademicStage[]>([]);
  const [selectedStage, setSelectedStage] = useState<AcademicStage | null>(null);
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [students, setStudents] = useState<EnrichedStudent[]>([]);
  const [payStudent, setPayStudent] = useState<Student | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payments, setPayments] = useState<Payment[]>([]);
  const [deletePaymentTarget, setDeletePaymentTarget] = useState<Payment | null>(null);
  const [editPaymentTarget, setEditPaymentTarget] = useState<Payment | null>(null);
  const [editPayAmount, setEditPayAmount] = useState('');
  const [editPayNote, setEditPayNote] = useState('');
  const [editPayDate, setEditPayDate] = useState('');
  const [editPayMonth, setEditPayMonth] = useState('');
  const [editPaySaving, setEditPaySaving] = useState(false);
  const [historyStudent, setHistoryStudent] = useState<Student | null>(null);
  const [unpaidOpen, setUnpaidOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<(AuditLog & { student?: { name: string } })[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<EnrichedStudent | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expForm, setExpForm] = useState<{ category: ExpenseCategory; amount: string; description: string; date: string }>({ category: 'rent', amount: '', description: '', date: new Date().toISOString().slice(0, 10) });
  const [deleteExpenseTarget, setDeleteExpenseTarget] = useState<Expense | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ receiptNumber: string; studentName: string; studentId?: string; amount: number; date: string; month?: string; monthKey?: string; note?: string | null; recordedBy?: string | null; groupName?: string; gradeName?: string; stageName?: string; baseSubscription?: number; discountAmount?: number; paymentId?: string; recordedAt?: string | null; totalDueAtPayment?: number; totalPaidAtPayment?: number } | null>(null);
  const [receiptSending, setReceiptSending] = useState<'image' | 'text' | null>(null);
  const [receiptWhatsappConfirm, setReceiptWhatsappConfirm] = useState<typeof lastReceipt | null>(null);
  const [whatsappSending, setWhatsappSending] = useState(false);
  const [overrideUnlocked, setOverrideUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [pinPromptFor, setPinPromptFor] = useState<'override' | null>(null);
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null);
  const [feeEditValue, setFeeEditValue] = useState('');
  const [feeSaving, setFeeSaving] = useState(false);
  const [exemptTarget, setExemptTarget] = useState<EnrichedStudent | null>(null);
  const [discountTarget, setDiscountTarget] = useState<EnrichedStudent | null>(null);
  const [discountMode, setDiscountMode] = useState<'fixed' | 'percent' | null>(null);
  const [discountInput, setDiscountInput] = useState('');
  const [discountSaving, setDiscountSaving] = useState(false);
  const [monthlyPaidMap, setMonthlyPaidMap] = useState<Map<string, number>>(new Map());
  const [monthExemptMap, setMonthExemptMap] = useState<Map<string, true>>(new Map());
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const [deleteStudentTarget, setDeleteStudentTarget] = useState<EnrichedStudent | null>(null);
  const [deleteStudentLoading, setDeleteStudentLoading] = useState(false);
  const [studentQuery, setStudentQuery] = useState('');
  const [receiptPickerStudent, setReceiptPickerStudent] = useState<EnrichedStudent | null>(null);
  const [receiptPickerPayments, setReceiptPickerPayments] = useState<Payment[]>([]);
  const [receiptPickerLoading, setReceiptPickerLoading] = useState(false);
  useEffect(() => { setStudentQuery(''); }, [selectedGroup]);
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [deletePayLoading, setDeletePayLoading] = useState(false);
  const submittingRef = useRef(false);
  const studentsEpochRef = useRef(0);
  const collectedEpochRef = useRef(0);
  const paidMapEpochRef = useRef(0);
  const paymentsEpochRef = useRef(0);
  const receiptCardRef = useRef<HTMLDivElement>(null);
  const confirmSentRef = useRef<Set<string>>(new Set());

  const canManageExemptions = isMaster || (assistant?.can_manage_exemptions ?? false);

  const actorName = isMaster ? 'المدرس' : assistant?.display_name ?? assistant?.username ?? 'مساعد';

  const loadStages = useCallback(async () => {
    try {
      const data = await fetchStages();
      setStages(data);
      if (focusStageId) {
        const found = data.find((s) => s.id === focusStageId);
        if (found) setSelectedStage(found);
      } else if (data.length > 0) setSelectedStage(data[0]);
    } catch { setStages([]); }
  }, [focusStageId]);

  useEffect(() => { loadStages(); }, [loadStages]);

  const loadGradeLevels = useCallback(async () => {
    if (!selectedStage) return;
    try {
      const data = await fetchGradeLevels(selectedStage.id);
      setGradeLevels(data);
      if (focusGradeId) {
        const found = data.find((g) => g.id === focusGradeId);
        if (found) setSelectedGrade(found);
      } else if (data.length > 0) setSelectedGrade(data[0]);
    } catch { setGradeLevels([]); }
  }, [selectedStage, focusGradeId]);

  useEffect(() => { loadGradeLevels(); }, [loadGradeLevels]);

  const loadGroups = useCallback(async () => {
    if (!selectedGrade) return;
    try {
      const data = await fetchGroups(selectedGrade.id);
      setGroups(data);
      if (focusGroupId) {
        const found = data.find((g) => g.id === focusGroupId);
        if (found) setSelectedGroup(found);
      } else if (data.length > 0) setSelectedGroup(data[0]);
    } catch { setGroups([]); }
  }, [selectedGrade, focusGroupId]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const loadStudents = useCallback(async () => {
    if (!selectedGroup) { setStudents([]); return; }
    const epoch = ++studentsEpochRef.current;
    try {
      const data = await fetchStudentsByGroup(selectedGroup.id);
      if (epoch !== studentsEpochRef.current) return;
      const enriched: EnrichedStudent[] = data.map((s) => ({
        ...s,
        group_name: selectedGroup.name,
        grade_name: selectedGrade?.name,
        stage_name: selectedStage?.name,
      }));
      setStudents(enriched);
    } catch {
      if (epoch === studentsEpochRef.current) setStudents([]);
    }
  }, [selectedGroup, selectedGrade, selectedStage]);

  useEffect(() => { loadStudents(); }, [loadStudents]);

  // Realtime: refresh when payments, students, or expenses change (including from other modules)
  useEffect(() => {
    let debounced: ReturnType<typeof setTimeout> | null = null;
    const triggerRefresh = () => {
      if (debounced) clearTimeout(debounced);
      debounced = setTimeout(() => {
        loadStudents();
        if (selectedGroup) {
          const cEpoch = ++collectedEpochRef.current;
          fetchGroupMonthlyCollected(selectedGroup.id, monthKey).then((data) => {
            if (cEpoch === collectedEpochRef.current) setMonthlyCollected(data);
          });
          const pEpoch = ++paidMapEpochRef.current;
          fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
            if (pEpoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
          });
        }
        loadExpenses();
        if (historyStudent) loadPayments(historyStudent);
      }, 600);
    };
    const channel = supabase
      .channel('finances-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, triggerRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, triggerRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, triggerRefresh)
      .subscribe();
    return () => { if (debounced) clearTimeout(debounced); void supabase.removeChannel(channel); };
  }, [loadStudents, selectedGroup, historyStudent, monthKey, loadExpenses, loadPayments]);

  // Cross-module eventBus sync: when another module (Subscriptions, Archive, etc.)
  // emits payments:changed, refresh our data immediately.
  useEffect(() => {
    const off = eventBus.on('payments:changed', () => {
      invalidateByPrefix('students_');
      invalidateByPrefix('payments_');
      invalidateByPrefix('monthly_');
      loadStudents();
      if (selectedGroup) {
        const cEpoch = ++collectedEpochRef.current;
        fetchGroupMonthlyCollected(selectedGroup.id, monthKey).then((data) => {
          if (cEpoch === collectedEpochRef.current) setMonthlyCollected(data);
        });
        const pEpoch = ++paidMapEpochRef.current;
        fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
          if (pEpoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
        });
      }
    });
    return off;
  }, [loadStudents, selectedGroup, monthKey]);

  useEffect(() => {
    if (focusStudentId && students.length > 0) {
      const exists = students.find((s) => s.id === focusStudentId);
      if (exists) {
        setHighlightId(focusStudentId);
        setTimeout(() => setHighlightId(null), 3000);
        setTimeout(() => {
          const el = document.getElementById(`fin-student-${focusStudentId}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    }
  }, [focusStudentId, students]);

  const financialSummary = computeFinancialSummary(students, monthlyPaidMap, monthExemptMap);
  const fullyPaid = financialSummary.fullyPaid;
  const unpaidStudents = students.filter((s) => !monthExemptMap.has(s.id) && (monthlyPaidMap.get(s.id) ?? 0) < (s.total_fees ?? 0) && (s.total_fees ?? 0) > 0 && (s.fee_mode ?? 'full') !== 'deferred' && !isNewThisMonth(s, monthKey));

  const filteredStudents = studentQuery.trim()
    ? students.filter((s) => {
        const q = studentQuery.trim().toLowerCase();
        return s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
      })
    : students;

  function isNewStudent(s: EnrichedStudent): boolean {
    return isNewThisMonth(s, monthKey);
  }

  function getFeeModeBadge(s: EnrichedStudent): { label: string; color: string; bg: string; icon: typeof Sparkles } | null {
    const mode = (s.fee_mode ?? 'full') as 'full' | 'pro_rata' | 'deferred';
    if (mode === 'deferred') return { label: 'مرحّل للشهر التالي', color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/20', icon: RotateCcw };
    if (mode === 'pro_rata') return { label: 'احتساب بالحصص', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: CalendarClock };
    if (isNewStudent(s)) return { label: 'مسجل حديثاً — لا متأخرات', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: Sparkles };
    return null;
  }

  async function handleEditPayment() {
    if (!editPaymentTarget || editPaySaving) return;
    const amount = parseFloat(editPayAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setEditPaySaving(true);
    const target = editPaymentTarget;
    const oldAmount = target.amount ?? 0;
    const studentId = target.student_id;
    const newNote = editPayNote.trim() || null;
    const newDate = editPayDate || undefined;
    const newMonth = editPayMonth && editPayMonth !== (target.month_key ?? '') ? editPayMonth : undefined;
    const monthChanged = !!newMonth;
    const oldMonthKey = target.month_key ?? monthKey;
    // Optimistic update: adjust monthlyPaidMap immediately so the card updates
    // without waiting for the DB round-trip.
    setMonthlyPaidMap((prev) => {
      const m = new Map(prev);
      if (monthChanged) {
        // Remove old amount from old month, add new amount to new month
        m.set(studentId, Math.max(0, (m.get(studentId) ?? 0) - oldAmount));
      } else {
        m.set(studentId, Math.max(0, (m.get(studentId) ?? 0) - oldAmount + amount));
      }
      return m;
    });
    try {
      const result = await editPayment(target.id, amount, newNote, actorName, isMaster ? 'master' : 'assistant', newDate, newMonth);
      if (!result) {
        // Revert optimistic update on failure
        setMonthlyPaidMap((prev) => {
          const m = new Map(prev);
          if (monthChanged) {
            m.set(studentId, (m.get(studentId) ?? 0) + oldAmount);
          } else {
            m.set(studentId, Math.max(0, (m.get(studentId) ?? 0) + oldAmount - amount));
          }
          return m;
        });
        showToast('لم يتم تعديل الدفعة — قد تكون الدفعة غير موجودة أو ليس لديك صلاحية. تحقق من سجل المدفوعات وحاول مجدداً.', 'error');
        setEditPaySaving(false);
        return;
      }
      setPayments((prev) => prev.map((p) => p.id === target.id ? { ...p, amount, note: newNote, recorded_by: actorName, recorded_at: new Date().toISOString(), payment_date: newDate ?? p.payment_date, month_key: newMonth ?? p.month_key } : p));
      setEditPaymentTarget(null);
      setEditPayAmount('');
      setEditPayNote('');
      setEditPayDate('');
      setEditPayMonth('');
      invalidateByPrefix('students_');
      invalidateByPrefix('payments_');
      invalidateByPrefix('monthly_');
      loadStudents();
      if (historyStudent) loadPayments(historyStudent);
      if (selectedGroup) {
        const cEpoch = ++collectedEpochRef.current;
        fetchGroupMonthlyCollected(selectedGroup.id, monthKey).then((data) => {
          if (cEpoch === collectedEpochRef.current) setMonthlyCollected(data);
        });
        const pEpoch = ++paidMapEpochRef.current;
        fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
          if (pEpoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
        });
      }
      const studentName = historyStudent?.name ?? students.find((s) => s.id === studentId)?.name ?? '';
      showToast(`تم تعديل دفعة ${studentName} من ${formatCurrency(oldAmount)} إلى ${formatCurrency(amount)} ج.م`, 'success');
    } catch (err) {
      showToast(`تعذّر تعديل الدفعة: ${err instanceof Error ? err.message : 'خطأ غير معروف'}`, 'error');
    } finally {
      setEditPaySaving(false);
    }
  }

  async function loadPayments(student: Student) {
    const epoch = ++paymentsEpochRef.current;
    try {
      const data = await fetchPayments(student.id, monthKey);
      if (epoch !== paymentsEpochRef.current) return;
      setPayments(data);
    } catch {
      if (epoch === paymentsEpochRef.current) setPayments([]);
    }
  }

  function verifyPin(): boolean {
    const pin = settings.master_pin ?? '0000';
    if (pinInput.trim() === pin) {
      setPinError(false);
      setPinInput('');
      return true;
    }
    setPinError(true);
    return false;
  }

  function handlePinConfirm() {
    if (!verifyPin()) return;
    if (pinPromptFor === 'override') {
      setOverrideUnlocked(true);
    }
    setPinPromptFor(null);
  }

  function openPayStudent(s: Student) {
    setOverrideUnlocked(false);
    setPayStudent(s);
    setPayDate(new Date().toISOString().slice(0, 10));
    const baseSub = selectedGrade?.base_subscription ?? 0;
    if (baseSub > 0) {
      setPayAmount(String(baseSub));
    } else {
      setPayAmount('');
    }
  }

  async function handleAddPayment() {
    if (!payStudent || !payAmount) return;
    if (submittingRef.current) return;
    const amount = parseFloat(payAmount);
    if (amount <= 0) return;
    const baseSub = selectedGrade?.base_subscription ?? 0;
    const isOverriding = baseSub > 0 && amount !== baseSub && amount !== Math.round(baseSub / 2) && amount !== ((payStudent.total_fees ?? 0) - (monthlyPaidMap.get(payStudent.id) ?? 0));
    if (isOverriding && !overrideUnlocked) {
      setPinPromptFor('override');
      return;
    }
    submittingRef.current = true;
    setPaySubmitting(true);
    const discountAmt = (payStudent.total_fees ?? 0) > 0 && baseSub > 0 ? Math.max(0, baseSub - (payStudent.total_fees ?? 0)) : 0;
    const paidBeforeThisPayment = monthlyPaidMap.get(payStudent.id) ?? 0;
    setMonthlyPaidMap((prev) => { const m = new Map(prev); m.set(payStudent.id, (m.get(payStudent.id) ?? 0) + amount); return m; });
    const savedStudent = payStudent;
    const savedNote = payNote.trim();
    try {
      const payment = await createPayment(savedStudent.id, amount, savedNote || null, actorName, isMaster ? 'master' : 'assistant', payDate, monthKey);
      if (!payment) {
        // Duplicate request blocked by idempotency guard — not an error.
        if (selectedGroup) {
          const pEpoch = ++paidMapEpochRef.current;
          fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
            if (pEpoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
          });
        }
        showToast('تم تسجيل هذه الدفعة من قبل — لا يوجد تكرار', 'success');
        return;
      }
      if (!payment.receipt_number) {
        throw new Error('لم يتم حفظ الدفعة بشكل صحيح — رقم الإيصال مفقود');
      }
      const totalDueAtPayment = savedStudent.total_fees ?? 0;
      const totalPaidAtPayment = paidBeforeThisPayment + amount;
      setLastReceipt({
          receiptNumber: payment.receipt_number,
          studentName: savedStudent.name,
          studentId: savedStudent.id,
          amount,
          date: payment.payment_date,
          monthKey,
          note: savedNote || null,
          recordedBy: actorName,
          groupName: selectedGroup?.name,
          gradeName: selectedGrade?.name,
          stageName: selectedStage?.name,
          baseSubscription: baseSub,
          discountAmount: discountAmt,
          paymentId: payment.id,
          recordedAt: payment.recorded_at,
          totalDueAtPayment,
          totalPaidAtPayment,
      });
      setPayAmount(''); setPayNote(''); setPayDate(new Date().toISOString().slice(0, 10)); setPayStudent(null);
      invalidateByPrefix('students_');
      invalidateByPrefix('payments_');
      invalidateByPrefix('monthly_');
      loadStudents();
      if (historyStudent) loadPayments(historyStudent);
      if (selectedGroup) {
        const cEpoch = ++collectedEpochRef.current;
        fetchGroupMonthlyCollected(selectedGroup.id, monthKey).then((data) => {
          if (cEpoch === collectedEpochRef.current) setMonthlyCollected(data);
        });
        const pEpoch = ++paidMapEpochRef.current;
        fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
          if (pEpoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
        });
      }
      const monthLabel = getMonthLabel(monthKey);
      showToast(`تم تسجيل دفع مصروفات شهر ${monthLabel} للطالب ${savedStudent.name} — المبلغ ${formatCurrency(amount)} ج.م — بواسطة ${actorName}`, 'success');
      sendReceiptWhatsAppText({
        receiptNumber: payment.receipt_number,
        studentName: savedStudent.name,
        studentId: savedStudent.id,
        amount,
        date: payment.payment_date,
        monthKey,
        note: savedNote || null,
        recordedBy: actorName,
        groupName: selectedGroup?.name,
        gradeName: selectedGrade?.name,
        stageName: selectedStage?.name,
        recordedAt: payment.recorded_at,
        totalDueAtPayment,
        totalPaidAtPayment,
      });
    } catch (err) {
      console.error('[handleAddPayment] Payment save failed:', err);
      setMonthlyPaidMap((prev) => { const m = new Map(prev); m.set(savedStudent.id, Math.max(0, (m.get(savedStudent.id) ?? 0) - amount)); return m; });
      showToast(`تعذّر تسجيل الدفعة: ${err instanceof Error ? err.message : 'خطأ غير معروف'}`, 'error');
    } finally {
      submittingRef.current = false;
      setPaySubmitting(false);
    }
  }

  async function handleQuickFullPay(student: Student) {
    if (submittingRef.current) return;
    const remaining = (student.total_fees ?? 0) - (monthlyPaidMap.get(student.id) ?? 0);
    if (remaining <= 0) return;
    submittingRef.current = true;
    setPaySubmitting(true);
    const baseSub = selectedGrade?.base_subscription ?? 0;
    const discountAmt = (student.total_fees ?? 0) > 0 && baseSub > 0 ? Math.max(0, baseSub - (student.total_fees ?? 0)) : 0;
    const paidBeforeThisPayment = monthlyPaidMap.get(student.id) ?? 0;
    setMonthlyPaidMap((prev) => { const m = new Map(prev); m.set(student.id, (m.get(student.id) ?? 0) + remaining); return m; });
    try {
      const payment = await createPayment(student.id, remaining, 'دفع كامل', actorName, isMaster ? 'master' : 'assistant', undefined, monthKey);
      if (!payment) {
        if (selectedGroup) {
          const pEpoch = ++paidMapEpochRef.current;
          fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
            if (pEpoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
          });
        }
        showToast('تم تسجيل هذه الدفعة من قبل — لا يوجد تكرار', 'success');
        return;
      }
      if (!payment.receipt_number) {
        throw new Error('لم يتم حفظ الدفعة بشكل صحيح — رقم الإيصال مفقود');
      }
      const totalDueAtPayment = student.total_fees ?? 0;
      const totalPaidAtPayment = paidBeforeThisPayment + remaining;
      setLastReceipt({
          receiptNumber: payment.receipt_number,
          studentName: student.name,
          studentId: student.id,
          amount: remaining,
          date: payment.payment_date,
          monthKey,
          note: 'دفع كامل',
          recordedBy: actorName,
          groupName: selectedGroup?.name,
          gradeName: selectedGrade?.name,
          stageName: selectedStage?.name,
          baseSubscription: baseSub,
          discountAmount: discountAmt,
          paymentId: payment.id,
          recordedAt: payment.recorded_at,
          totalDueAtPayment,
          totalPaidAtPayment,
      });
      invalidateByPrefix('students_');
      invalidateByPrefix('payments_');
      invalidateByPrefix('monthly_');
      loadStudents();
      if (historyStudent) loadPayments(historyStudent);
      if (selectedGroup) {
        const cEpoch = ++collectedEpochRef.current;
        fetchGroupMonthlyCollected(selectedGroup.id, monthKey).then((data) => {
          if (cEpoch === collectedEpochRef.current) setMonthlyCollected(data);
        });
        const pEpoch = ++paidMapEpochRef.current;
        fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
          if (pEpoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
        });
      }
      const monthLabel = getMonthLabel(monthKey);
      showToast(`تم دفع كامل مصروفات شهر ${monthLabel} للطالب ${student.name} — المبلغ ${formatCurrency(remaining)} ج.م — بواسطة ${actorName}`, 'success');
      sendReceiptWhatsAppText({
        receiptNumber: payment.receipt_number,
        studentName: student.name,
        studentId: student.id,
        amount: remaining,
        date: payment.payment_date,
        monthKey,
        note: 'دفع كامل',
        recordedBy: actorName,
        groupName: selectedGroup?.name,
        gradeName: selectedGrade?.name,
        stageName: selectedStage?.name,
        recordedAt: payment.recorded_at,
        totalDueAtPayment,
        totalPaidAtPayment,
      });
    } catch (err) {
      console.error('[handleQuickFullPay] Payment save failed:', err);
      setMonthlyPaidMap((prev) => { const m = new Map(prev); m.set(student.id, Math.max(0, (m.get(student.id) ?? 0) - remaining)); return m; });
      showToast(`تعذّر تسجيل الدفعة: ${err instanceof Error ? err.message : 'خطأ غير معروف'}`, 'error');
    } finally {
      submittingRef.current = false;
      setPaySubmitting(false);
    }
  }

  async function loadExpenses() {
    try {
      const data = await fetchExpenses(monthKey);
      setExpenses(data);
    } catch {
      setExpenses([]);
    }
  }

  async function handleAddExpense() {
    const amount = parseFloat(expForm.amount);
    if (!amount || amount <= 0) return;
    const tempExpense: Expense = {
      id: `temp-${Date.now()}`,
      category: expForm.category,
      amount,
      description: expForm.description.trim() || null,
      expense_date: expForm.date,
      recorded_by: actorName,
      created_at: new Date().toISOString(),
    };
    setExpenses((prev) => [...prev, tempExpense]);
    setExpForm({ category: 'rent', amount: '', description: '', date: new Date().toISOString().slice(0, 10) });
    setExpenseOpen(false);
    try {
      await createExpense(expForm.category, amount, expForm.description.trim() || null, expForm.date, actorName);
      loadExpenses();
      showToast(`تم تسجيل مصروف (${EXPENSE_CATEGORIES.find((c) => c.id === expForm.category)?.label ?? expForm.category}) بقيمة ${formatCurrency(amount)} ج.م — بواسطة ${actorName}`, 'success');
    } catch (err) {
      setExpenses((prev) => prev.filter((e) => e.id !== tempExpense.id));
      showToast(`فشل تسجيل المصروف: ${err instanceof Error ? err.message : 'خطأ في الاتصال بقاعدة البيانات'}. حاول مرة أخرى.`, 'error');
    }
  }

  async function handleDeleteExpense() {
    if (!deleteExpenseTarget) return;
    const target = deleteExpenseTarget;
    const prevExpenses = expenses;
    setExpenses((prev) => prev.filter((e) => e.id !== target.id));
    setDeleteExpenseTarget(null);
    try {
      await deleteExpense(target.id);
      showToast(`تم حذف مصروف (${EXPENSE_CATEGORIES.find((c) => c.id === target.category)?.label ?? target.category}) بقيمة ${formatCurrency(target.amount)} ج.م — بواسطة ${actorName}`, 'success');
    } catch (err) {
      setExpenses(prevExpenses);
      showToast(`فشل حذف المصروف: ${err instanceof Error ? err.message : 'تعذّر الاتصال بقاعدة البيانات'}. تمت استعادة المصروف.`, 'error');
    }
  }

  function printReceipt(r: { receiptNumber: string; studentName: string; amount: number; date: string; month?: string; note?: string | null; recordedBy?: string | null; groupName?: string; gradeName?: string; stageName?: string; baseSubscription?: number; discountAmount?: number }) {
    printDocument(`إيصال ${r.receiptNumber}`, buildReceiptHTML({ ...r, platformName: settings.platform_name, managementName: settings.management_name }));
  }

  function sendReceiptWhatsAppText(r: { receiptNumber: string; studentName: string; studentId?: string; amount: number; date: string; month?: string; monthKey?: string; note?: string | null; recordedBy?: string | null; recordedAt?: string | null; groupName?: string; gradeName?: string; stageName?: string; baseSubscription?: number; discountAmount?: number; totalDueAtPayment?: number; totalPaidAtPayment?: number }) {
    if (!r.studentId) {
      const student = students.find((s) => s.name === r.studentName);
      if (!student) return;
      r.studentId = student.id;
    }
    const student = students.find((s) => s.id === r.studentId);
    const phone = normalizePhoneForWhatsApp(student?.parent_phone || student?.phone || '');
    const mk = r.monthKey ?? monthKey;
    const monthLabel = getMonthLabel(mk);
    const totalFees = r.totalDueAtPayment ?? student?.total_fees ?? 0;
    const totalPaid = r.totalPaidAtPayment ?? monthlyPaidMap.get(r.studentId) ?? 0;
    const remaining = Math.max(0, totalFees - totalPaid);
    const isFull = remaining <= 0;
    const statusLabel = isFull ? 'تم السداد بالكامل ✅' : 'دفعة جزئية — يوجد مبلغ متبقي';
    const dateDisplay = r.date ? formatArabicDate(r.date) : '';
    const gradeLine = (r.gradeName || r.stageName || student?.grade_name || student?.stage_name)
      ? `🎓 الصف: ${[r.stageName ?? student?.stage_name, r.gradeName ?? student?.grade_name].filter(Boolean).join(' - ')}\n`
      : '';
    const groupLine = r.groupName ?? student?.group_name ?? selectedGroup?.name;

    const msg =
      `💰 *إشعار سداد مصروفات — ${settings.platform_name}*\n\n` +
      `👤 اسم الطالب: ${r.studentName}\n` +
      (groupLine ? `📚 المجموعة: ${groupLine}\n` : '') +
      gradeLine +
      `📅 الشهر: ${monthLabel}\n` +
      (totalFees > 0 ? `💎 إجمالي المصروفات: ${formatCurrency(totalFees)} ج.م\n` : '') +
      `✨ إجمالي المدفوع حالياً: ${formatCurrency(totalPaid)} ج.م\n` +
      (remaining > 0 ? `📌 المبلغ المتبقي: ${formatCurrency(remaining)} ج.م\n` : '') +
      (dateDisplay ? `📆 تاريخ المعاملة: ${dateDisplay}\n` : '') +
      (r.receiptNumber ? `🧾 رقم الإيصال: ${r.receiptNumber}\n` : '') +
      `✅ حالة السداد: ${statusLabel}\n` +
      (r.recordedBy ? `✅ استلم بواسطة: ${r.recordedBy}\n` : '') +
      `\nشكراً لكم 🌸\n` +
      `${settings.platform_name}`;

    const waUrl = phone
      ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    openWhatsAppURL(waUrl, showToast);
  }

  async function sendReceiptAsImage(r: { receiptNumber: string; studentName: string; studentId?: string; amount: number; date: string; month?: string; note?: string | null; recordedBy?: string | null; groupName?: string; gradeName?: string; stageName?: string }) {
    setReceiptSending('image');
    try {
      const student = r.studentId ? students.find((s) => s.id === r.studentId) : students.find((s) => s.name === r.studentName);
      const phone = normalizePhoneForWhatsApp(student?.parent_phone || student?.phone || '');
      // Open WhatsApp synchronously FIRST to avoid pop-up blocker
      const imgMsg =
        `🧾 *إيصال دفع — ${settings.platform_name}*
` +
        `👤 الطالب: ${r.studentName}
` +
        `💰 المبلغ المدفوع: ${formatCurrency(r.amount)} ج.م
` +
        `📅 تاريخ الدفع: ${formatArabicDate(r.date || new Date().toISOString().slice(0, 10))}
` +
        `🕐 وقت الدفع: ${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
` +
        `🔢 رقم الإيصال: ${r.receiptNumber}`;
      const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(imgMsg)}` : `https://wa.me/?text=${encodeURIComponent(imgMsg)}`;
      openWhatsAppURL(waUrl, showToast);
      let blob: Blob | null = null;
      const cardEl = receiptCardRef.current;
      if (cardEl) {
        const dataUrl = await Promise.race([
          toPng(cardEl, {
            pixelRatio: 2,
            backgroundColor: '#0a0f1a',
            cacheBust: true,
            style: { transform: 'none', borderRadius: '16px' },
          }),
          new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (dataUrl) {
          const res = await fetch(dataUrl);
          blob = await res.blob();
        }
      }
      if (blob) {
        const filename = `receipt_${r.receiptNumber}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: `إيصال دفع — ${r.studentName} — ${formatCurrency(r.amount)} ج.م` });
        } else {
          const a = document.createElement('a');
          const url = URL.createObjectURL(blob);
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
      if (!blob) {
        showToast('تعذّر إنشاء صورة الإيصال — تم إرسال النص بدلاً من ذلك', 'error');
        sendReceiptWhatsAppText(r);
      }
    } catch {
      showToast('تعذّر إنشاء صورة الإيصال — تم إرسال النص بدلاً من ذلك', 'error');
      sendReceiptWhatsAppText(r);
    } finally {
      setReceiptSending(null);
    }
  }

  async function handleDeletePayment() {
    if (!deletePaymentTarget || deletePayLoading) return;
    const target = deletePaymentTarget;
    setDeletePayLoading(true);
    setMonthlyPaidMap((prev) => { const m = new Map(prev); m.set(target.student_id, Math.max(0, (m.get(target.student_id) ?? 0) - (target.amount ?? 0))); return m; });
    setPayments((prev) => prev.filter((p) => p.id !== target.id));
    setDeletePaymentTarget(null);
    try {
      await deletePaymentWithAudit(target.id, actorName, isMaster ? 'master' : 'assistant');
      invalidateByPrefix('students_');
      invalidateByPrefix('payments_');
      invalidateByPrefix('monthly_');
      loadStudents();
      if (historyStudent) loadPayments(historyStudent);
      if (selectedGroup) {
        const cEpoch = ++collectedEpochRef.current;
        fetchGroupMonthlyCollected(selectedGroup.id, monthKey).then((data) => {
          if (cEpoch === collectedEpochRef.current) setMonthlyCollected(data);
        });
        const pEpoch = ++paidMapEpochRef.current;
        fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
          if (pEpoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
        });
      }
      const delStudent = students.find((s) => s.id === target.student_id);
      showToast(`تم حذف دفعة بقيمة ${formatCurrency(target.amount ?? 0)} ج.م للطالب ${delStudent?.name ?? ''} — بواسطة ${actorName}`, 'success');
    } catch (err) {
      setMonthlyPaidMap((prev) => { const m = new Map(prev); m.set(target.student_id, (m.get(target.student_id) ?? 0) + (target.amount ?? 0)); return m; });
      setPayments((prev) => [...prev, target].sort((a, b) => b.payment_date.localeCompare(a.payment_date)));
      showToast(`فشل حذف الدفعة: ${err instanceof Error ? err.message : 'تعذّر الاتصال بقاعدة البيانات'}. تمت استعادة الدفعة.`, 'error');
    } finally {
      setDeletePayLoading(false);
    }
  }

  function startEditFee(s: EnrichedStudent) {
    setEditingFeeId(s.id);
    setFeeEditValue(String(s.total_fees ?? 0));
  }

  function cancelEditFee() {
    setEditingFeeId(null);
    setFeeEditValue('');
  }

  async function saveEditFee(studentId: string) {
    const val = parseFloat(feeEditValue);
    if (isNaN(val) || val < 0) return;
    const prevStudents = students;
    setStudents((prev) => prev.map((s) => s.id === studentId ? { ...s, total_fees: val } : s));
    setEditingFeeId(null);
    setFeeEditValue('');
    setFeeSaving(true);
    try {
      await updateStudentTotalFees(studentId, val, actorName, isMaster ? 'master' : 'assistant');
      await loadStudents();
      const feeStudent = students.find((s) => s.id === studentId);
      showToast(`تم تعديل المصاريف للطالب ${feeStudent?.name ?? ''} إلى ${formatCurrency(val)} ج.م — بواسطة ${actorName}`, 'success');
    } catch (err) {
      setStudents(prevStudents);
      showToast(`فشل حفظ المصاريف: ${err instanceof Error ? err.message : 'تعذّر الاتصال بقاعدة البيانات'}. تمت استعادة القيمة السابقة.`, 'error');
    } finally {
      setFeeSaving(false);
    }
  }

  async function toggleExemption() {
    if (!exemptTarget) return;
    const target = exemptTarget;
    const prevStudents = students;
    const wasExempt = monthExemptMap.has(target.id);
    setMonthExemptMap((prev) => { const m = new Map(prev); if (wasExempt) m.delete(target.id); else m.set(target.id, true); return m; });
    setExemptTarget(null);
    try {
      await setStudentExemption(target.id, !wasExempt, actorName, isMaster ? 'master' : 'assistant', monthKey);
      loadStudents();
      const monthLabel = getMonthLabel(monthKey);
      showToast(`${wasExempt ? 'تم إلغاء إعفاء' : 'تم تفعيل إعفاء'} الطالب ${target.name} لشهر ${monthLabel} — بواسطة ${actorName}`, 'success');
    } catch (err) {
      setMonthExemptMap((prev) => { const m = new Map(prev); if (wasExempt) m.set(target.id, true); else m.delete(target.id); return m; });
      showToast(`فشل تحديث الإعفاء: ${err instanceof Error ? err.message : 'تعذّر الاتصال بقاعدة البيانات'}. تمت استعادة الحالة السابقة.`, 'error');
    }
  }

  function openDiscountModal(s: EnrichedStudent) {
    setDiscountTarget(s);
    setDiscountMode(s.discount_mode ?? null);
    setDiscountInput(
      s.discount_mode === 'percent'
        ? String(s.discount_percent ?? 0)
        : s.discount_mode === 'fixed'
        ? String(s.discount_amount ?? 0)
        : ''
    );
  }

  async function saveDiscount() {
    if (!discountTarget) return;
    const raw = parseFloat(discountInput) || 0;
    if (raw < 0) return;
    const target = discountTarget;
    const prevStudents = students;
    const mode = discountMode;
    const pct = mode === 'percent' ? Math.min(100, raw) : 0;
    const fixedAmt = mode === 'fixed' ? raw : 0;
    setStudents((prev) => prev.map((s) => {
      if (s.id !== target.id) return s;
      const newFees = mode === 'percent'
        ? Math.round((target.total_fees ?? 0) * (1 - pct / 100))
        : mode === 'fixed'
        ? Math.max(0, (target.total_fees ?? 0) - fixedAmt)
        : target.total_fees;
      return { ...s, discount_mode: mode, discount_percent: pct, discount_amount: fixedAmt, total_fees: newFees };
    }));
    setDiscountSaving(true);
    setDiscountTarget(null);
    setDiscountMode(null);
    setDiscountInput('');
    try {
      const newFees = mode === 'percent'
        ? Math.round((target.total_fees ?? 0) * (1 - pct / 100))
        : mode === 'fixed'
        ? Math.max(0, (target.total_fees ?? 0) - fixedAmt)
        : target.total_fees;
      if (mode === 'percent') {
        await setStudentDiscount(target.id, 'percent', 0, pct, actorName, isMaster ? 'master' : 'assistant');
      } else if (mode === 'fixed') {
        await setStudentDiscount(target.id, 'fixed', fixedAmt, 0, actorName, isMaster ? 'master' : 'assistant');
      } else {
        await setStudentDiscount(target.id, null, 0, 0, actorName, isMaster ? 'master' : 'assistant');
      }
      await updateStudentTotalFees(target.id, newFees, actorName, isMaster ? 'master' : 'assistant');
      loadStudents();
      const discLabel = mode === 'percent' ? `خصم ${pct}%` : mode === 'fixed' ? `خصم ${formatCurrency(fixedAmt)} ج.م` : 'إلغاء الخصم';
      showToast(`${discLabel} للطالب ${target.name} — بواسطة ${actorName}`, 'success');
    } catch (err) {
      setStudents(prevStudents);
      showToast(`فشل تطبيق الخصم: ${err instanceof Error ? err.message : 'تعذّر الاتصال بقاعدة البيانات'}. تمت استعادة القيمة السابقة.`, 'error');
    } finally {
      setDiscountSaving(false);
    }
  }

  function openAuditLogs() {
    setAuditOpen(true);
    setAuditLogs([]);
    setAuditLoading(true);
    fetchAuditLogs(100).then((logs) => setAuditLogs(logs)).catch(() => {}).finally(() => setAuditLoading(false));
  }

  async function handleAdjustDues() {
    if (!adjustTarget) return;
    const amt = parseFloat(adjustAmount);
    if (!amt || amt <= 0) return;
    setAdjustSaving(true);
    try {
      const currentFees = adjustTarget.total_fees ?? 0;
      const newFees = Math.max(0, currentFees - amt);
      await updateStudentTotalFees(adjustTarget.id, newFees, actorName, isMaster ? 'master' : 'assistant');
      const student = students.find((s) => s.id === adjustTarget.id);
      if (student) student.total_fees = newFees;
      setStudents([...students]);
      const epoch = ++paidMapEpochRef.current;
      fetchGroupMonthlyPaidMap(selectedGroup?.id ?? '', monthKey).then((data) => {
        if (epoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
      });
      showToast(`تم خصم ${formatCurrency(amt)} ج.م من مستحقات الطالب ${adjustTarget.name} — بواسطة ${actorName}`, 'success');
      setAdjustTarget(null);
      setAdjustAmount('');
      setAdjustNote('');
    } catch (err) {
      showToast(`فشل خصم المستحقات: ${err instanceof Error ? err.message : 'تعذّر الاتصال بقاعدة البيانات'}. حاول مرة أخرى.`, 'error');
    } finally {
      setAdjustSaving(false);
    }
  }

  function sendWhatsAppReminder(s: EnrichedStudent) {
    const phone = normalizePhoneForWhatsApp(s.parent_phone || s.phone || '');
    if (!phone) {
      showToast('لا يوجد رقم هاتف مسجل لهذا الطالب', 'error');
      return;
    }
    const totalFees = s.total_fees ?? 0;
    const totalPaid = monthlyPaidMap.get(s.id) ?? 0;
    const remaining = Math.max(0, totalFees - totalPaid);
    const monthLabel = getMonthLabel(monthKey);
    const message =
      `السلام عليكم ورحمة الله وبركاته 🌷\n` +
      `ولي الأمر الكريم،\n` +
      `نود تذكير حضرتكم بلطف بمصروفات شهر ${monthLabel} المتأخرة الخاصة بالطالب/ة ${s.name}.\n\n` +
      `📅 الشهر: ${monthLabel}\n` +
      `💰 إجمالي المصروفات: ${formatCurrency(totalFees)} ج.م\n` +
      `✨ إجمالي المدفوع: ${formatCurrency(totalPaid)} ج.م\n` +
      `📌 المتبقي: ${formatCurrency(remaining)} ج.م\n\n` +
      `برجاء السداد في أقرب وقت لتجنب تراكم المصروفات.\n` +
      `شكرًا لثقتكم ودعمكم الدائم 🤍\n` +
      `وبإذن الله دايمًا نشوف أولادنا في أفضل صورة 🌟\n\n` +
      `تيم ${settings.platform_name}`;
    const url = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
    openWhatsAppURL(url, showToast);
  }

  function sendMonthReminder(s: EnrichedStudent) {
    const paid = monthlyPaidMap.get(s.id) ?? 0;
    const totalFees = s.total_fees ?? 0;
    const remaining = Math.max(0, totalFees - paid);
    const phone = normalizePhoneForWhatsApp(s.parent_phone || s.phone || '');
    const monthLabel = getMonthLabel(monthKey);
    const message =
      `السلام عليكم ورحمة الله وبركاته 🌷\n` +
      `ولي الأمر الكريم،\n` +
      `تذكير بمصروفات شهر ${monthLabel} للطالب/ة ${s.name}.\n\n` +
      `📅 الشهر: ${monthLabel}\n` +
      `💰 إجمالي المصروفات: ${formatCurrency(totalFees)} ج.م\n` +
      `💳 المدفوع: ${formatCurrency(paid)} ج.م\n` +
      `📌 المتبقي: ${formatCurrency(remaining)} ج.م\n\n` +
      `برجاء السداد في أقرب وقت.\n` +
      `شكرًا لكم 🌸`;
    const url = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;
    openWhatsAppURL(url, showToast);
  }

  function sendPaymentConfirmationWhatsApp(r: {
    studentId?: string;
    studentName: string;
    monthKey?: string;
    paymentId?: string;
    receiptNumber?: string;
    paymentDate?: string;
    recordedAt?: string | null;
    amount?: number;
    totalDueAtPayment?: number;
    totalPaidAtPayment?: number;
  }) {
    if (!r.studentId) return;
    const dedupKey = `${r.studentId}-${r.monthKey ?? monthKey}-${r.paymentId ?? ''}`;
    if (confirmSentRef.current.has(dedupKey)) return;
    confirmSentRef.current.add(dedupKey);

    sendReceiptWhatsAppText({
      receiptNumber: r.receiptNumber ?? '',
      studentName: r.studentName,
      studentId: r.studentId,
      amount: r.amount ?? 0,
      date: r.paymentDate ?? new Date().toISOString().slice(0, 10),
      monthKey: r.monthKey ?? monthKey,
      recordedBy: actorName,
      recordedAt: r.recordedAt,
      totalDueAtPayment: r.totalDueAtPayment,
      totalPaidAtPayment: r.totalPaidAtPayment,
    });
    showToast('تم فتح واتساب — الرجاء الضغط على زر الإرسال داخل واتساب لتأكيد التوصيل', 'info');
  }

  async function openReceiptPicker(s: EnrichedStudent) {
    setReceiptPickerStudent(s);
    setReceiptPickerPayments([]);
    setReceiptPickerLoading(true);
    try {
      const data = await fetchPayments(s.id, monthKey);
      setReceiptPickerPayments(data);
    } catch {
      setReceiptPickerPayments([]);
    } finally {
      setReceiptPickerLoading(false);
    }
  }

  function sendExistingReceiptWhatsApp(s: EnrichedStudent, p: Payment) {
    const totalFees = s.total_fees ?? 0;
    const totalPaid = monthlyPaidMap.get(s.id) ?? 0;
    sendReceiptWhatsAppText({
      receiptNumber: p.receipt_number ?? '',
      studentName: s.name,
      studentId: s.id,
      amount: p.amount ?? 0,
      date: p.payment_date ?? '',
      monthKey: p.month_key ?? monthKey,
      note: p.note ?? null,
      recordedBy: p.recorded_by ?? actorName,
      groupName: s.group_name ?? selectedGroup?.name,
      gradeName: s.grade_name ?? selectedGrade?.name,
      stageName: s.stage_name ?? selectedStage?.name,
      recordedAt: p.recorded_at ?? null,
      totalDueAtPayment: totalFees,
      totalPaidAtPayment: totalPaid,
    });
    setReceiptPickerStudent(null);
    setReceiptPickerPayments([]);
  }

  useEffect(() => { loadExpenses(); }, []);

  const [monthlyCollected, setMonthlyCollected] = useState(0);
  useEffect(() => {
    if (!selectedGroup) { setMonthlyCollected(0); return; }
    const epoch = ++collectedEpochRef.current;
    fetchGroupMonthlyCollected(selectedGroup.id, monthKey).then((data) => {
      if (epoch === collectedEpochRef.current) setMonthlyCollected(data);
    });
  }, [selectedGroup, monthKey]);
  useEffect(() => {
    if (!selectedGroup) { setMonthlyPaidMap(new Map()); return; }
    const epoch = ++paidMapEpochRef.current;
    fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
      if (epoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
    });
  }, [selectedGroup, monthKey]);
  useEffect(() => {
    setMonthExemptMap(new Map());
    if (!selectedGroup) return;
    fetchMonthlyExemptMap(monthKey).then((data) => {
      setMonthExemptMap(data);
    });
  }, [selectedGroup, monthKey]);
  const totalCollected = monthlyCollected;
  const totalRemaining = students.reduce((s, st) => s + (monthExemptMap.has(st.id) ? 0 : Math.max(0, (st.total_fees ?? 0) - (monthlyPaidMap.get(st.id) ?? 0))), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  const netProfit = totalCollected - totalExpenses;

  return (
    <div className="space-y-6">
      {onBack && (
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-emerald-400 transition active:scale-95"
        >
          <ChevronLeft size={18} />
          العودة للرئيسية
        </button>
      )}
      {/* Net profit summary */}
      {isMaster && selectedGroup && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4 sm:p-6 border border-emerald-500/20">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl"><Wallet size={22} /></div>
              <div>
                <h2 className="text-lg font-bold text-white">صافي الأرباح</h2>
                <p className="text-xs text-slate-400">الإيرادات ناقص المصروفات</p>
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setExpenseOpen(true)}><Plus size={14} /> مصروف جديد</Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-light rounded-xl p-3 text-center hover:bg-white/[0.08] transition cursor-pointer" onClick={() => setPaidOpen(true)}>
              <p className="text-xs text-slate-400">الإيرادات</p>
              <p className="text-lg font-bold text-emerald-400 mt-1">{formatCurrency(totalCollected)} ج.م</p>
            </div>
            <div className="glass-light rounded-xl p-3 text-center hover:bg-white/[0.08] transition cursor-pointer" onClick={() => setExpenseOpen(true)}>
              <p className="text-xs text-slate-400">المصروفات</p>
              <p className="text-lg font-bold text-red-400 mt-1">{formatCurrency(totalExpenses)} ج.م</p>
            </div>
            <button className="glass-light rounded-xl p-3 text-center hover:bg-white/[0.08] transition cursor-pointer" onClick={() => setUnpaidOpen(true)} disabled={unpaidStudents.length === 0}>
              <p className="text-xs text-slate-400">المتبقي</p>
              <p className="text-lg font-bold text-amber-400 mt-1">{formatCurrency(totalRemaining)} ج.م</p>
            </button>
            <div className="glass-light rounded-xl p-3 text-center border border-emerald-500/30">
              <p className="text-xs text-slate-400">صافي الربح</p>
              <p className={`text-lg font-bold mt-1 ${netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(netProfit)} ج.م</p>
            </div>
          </div>
          {expenses.length > 0 && (
            <div className="mt-4 space-y-2 max-h-40 overflow-y-auto">
              {expenses.slice(0, 5).map((e) => (
                <div key={e.id} className="glass-light rounded-lg p-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingDown size={14} className="text-red-400" />
                    <span className="text-sm text-white font-semibold">{EXPENSE_CATEGORIES.find((c) => c.id === e.category)?.label ?? e.category}</span>
                    {e.description && <span className="text-xs text-slate-400">— {e.description}</span>}
                    <span className="text-[10px] text-slate-500">{formatArabicDate(e.expense_date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-red-400">{formatCurrency(e.amount)} ج.م</span>
                    <button onClick={() => setDeleteExpenseTarget(e)} className="p-1 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Hierarchical selector */}
      <div className="glass-card rounded-2xl p-5 space-y-4">
        <h2 className="text-lg font-bold text-white">الشهور — اختر المجموعة</h2>
        <p className="text-xs text-slate-400">يتم عرض طلاب المجموعة المحددة فقط، لتتبع مالي دقيق دون تداخل.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">المرحلة</label>
            <select
              value={selectedStage?.id ?? ''}
              onChange={(e) => { const s = stages.find((st) => st.id === e.target.value) ?? null; setSelectedStage(s); setSelectedGrade(null); setSelectedGroup(null); }}
              className={inputCls}
            >
              <option value="">— اختر —</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">الصف</label>
            <select
              value={selectedGrade?.id ?? ''}
              onChange={(e) => { const g = gradeLevels.find((gl) => gl.id === e.target.value) ?? null; setSelectedGrade(g); setSelectedGroup(null); }}
              className={inputCls}
              disabled={!selectedStage}
            >
              <option value="">— اختر —</option>
              {gradeLevels.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">المجموعة</label>
            <select
              value={selectedGroup?.id ?? ''}
              onChange={(e) => { const g = groups.find((gr) => gr.id === e.target.value) ?? null; setSelectedGroup(g); }}
              className={inputCls}
              disabled={!selectedGrade}
            >
              <option value="">— اختر —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>

        {selectedGroup && students.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="بحث عن طالب داخل المجموعة المحددة..."
                className="w-full glass-light rounded-xl py-2.5 pr-9 pl-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm"
              />
              {studentQuery && (
                <button
                  onClick={() => setStudentQuery('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <PDFButton label="المسددون PDF" size="sm" disabled={fullyPaid === 0} onClick={async () => exportPaidStudentsPDF(students, monthlyPaidMap, monthExemptMap, { stageName: selectedStage?.name, gradeName: selectedGrade?.name, groupName: selectedGroup?.name, monthLabel: getMonthLabel(monthKey) })} />
              <PDFButton label="غير المسددين PDF" size="sm" disabled={unpaidStudents.length === 0} onClick={async () => exportUnpaidStudentsPDF(students, monthlyPaidMap, monthExemptMap, { stageName: selectedStage?.name, gradeName: selectedGrade?.name, groupName: selectedGroup?.name, monthLabel: getMonthLabel(monthKey) })} />
            </div>
          </div>
        )}
      </div>

      {!selectedGroup ? (
        <div className="glass-card rounded-2xl p-5 sm:p-8 text-center text-slate-400">برجاء اختيار المرحلة والصف والمجموعة لعرض بيانات الشهور.</div>
      ) : (
        <>
          {/* Unpaid banner — visible to master only */}
          {isMaster && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-red-500/20">
              <div className="flex items-center gap-4">
                <div className="p-3.5 bg-red-500/10 text-red-400 rounded-2xl"><AlertTriangle size={24} /></div>
                <div>
                  <h2 className="text-lg font-bold text-white">المبالغ الإجمالية الغير مدفوعة</h2>
                  <p className="text-xs text-slate-400 mt-0.5">عدد الطلاب غير المسددين: <button className="font-bold text-red-400 hover:underline cursor-pointer" onClick={() => setUnpaidOpen(true)}>{unpaidStudents.length} طالب</button></p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="secondary" size="sm" onClick={openAuditLogs}><Shield size={16} /> سجل العمليات</Button>
                <Button variant="warning" onClick={() => setUnpaidOpen(true)} disabled={unpaidStudents.length === 0}>عرض القائمة الكاملة</Button>
              </div>
            </motion.div>
          )}

          {/* Students list */}
          <div id="fin-student-list" className="glass-card rounded-2xl p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-bold text-white">سجل الشهور والمدفوعات — {selectedGroup.name}</h2>
                <p className="text-xs text-slate-400">تتبع دقيق لمدفوعات الشهور والمبالغ المتبقية لكل طالب.</p>
              </div>
              <button className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5 hover:underline cursor-pointer" onClick={() => setPaidOpen(true)}><CheckCircle2 size={14} /> مسدد كامل: {fullyPaid} طالب</button>
            </div>

            {students.length === 0 ? (
              <div className="glass-light rounded-xl p-8 text-center text-slate-400">لا يوجد طلاب مسجلون في هذه المجموعة.</div>
            ) : filteredStudents.length === 0 ? (
              <div className="glass-light rounded-xl p-8 text-center text-slate-400">لا يوجد طالب مطابق داخل المجموعة المحددة</div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {filteredStudents.map((s) => {
                    const monthlyPaid = monthlyPaidMap.get(s.id) ?? 0;
                    const remaining = (s.total_fees ?? 0) - monthlyPaid;
                    const isFull = remaining <= 0;
                    const pct = s.total_fees > 0 ? Math.min(100, Math.round((monthlyPaid / s.total_fees) * 100)) : 0;
                    return (
                      <motion.div id={`fin-student-${s.id}`} key={s.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`glass-light rounded-xl p-4 border ${highlightId === s.id ? 'border-[#d4af37] ring-2 ring-[#d4af37]/40 shadow-lg shadow-[#d4af37]/20' : isFull ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : 'border-red-500/40 ring-1 ring-red-500/20'}`}>
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-bold text-white text-sm">{s.name}</h4>
                              {monthExemptMap.has(s.id) && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full"><Shield size={10} /> معفى</span>}
                              {(() => {
                                const badge = getFeeModeBadge(s);
                                if (!badge) return null;
                                const BadgeIcon = badge.icon;
                                return <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.bg} ${badge.color}`}><BadgeIcon size={10} /> {badge.label}</span>;
                              })()}
                              {isNewStudent(s) && !monthExemptMap.has(s.id) && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20"><Sparkles size={10} /> حديث</span>}
                              {monthExemptMap.has(s.id) ? null : isFull ? <button onClick={() => { setHistoryStudent(s); loadPayments(s); }} className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full hover:bg-emerald-500/20 transition cursor-pointer" title="عرض تفاصيل الدفع"><CheckCircle2 size={10} /> دفع كامل</button> : (s.fee_mode ?? 'full') === 'deferred' ? null : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full"><AlertTriangle size={10} /> متبقي</span>}
                              {s.discount_mode === 'percent' && s.discount_percent > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full"><TrendingDown size={10} /> خصم {s.discount_percent}%</span>}
                              {s.discount_mode === 'fixed' && s.discount_amount > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full"><TrendingDown size={10} /> خصم {formatCurrency(s.discount_amount)} ج.م</span>}
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5 break-words">
                              المصاريف:{' '}
                              {editingFeeId === s.id ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <input
                                    type="number"
                                    value={feeEditValue}
                                    onChange={(e) => setFeeEditValue(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') saveEditFee(s.id); if (e.key === 'Escape') cancelEditFee(); }}
                                    autoFocus
                                    className="w-24 glass-light rounded-lg py-1 px-2 text-white text-xs border border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                                    disabled={feeSaving}
                                  />
                                  <button
                                    onClick={() => saveEditFee(s.id)}
                                    disabled={feeSaving}
                                    className="p-1 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition disabled:opacity-50"
                                    title="حفظ"
                                  >
                                    <CheckCircle2 size={14} />
                                  </button>
                                  <button
                                    onClick={cancelEditFee}
                                    disabled={feeSaving}
                                    className="p-1 rounded-lg bg-red-500/10 text-slate-400 hover:text-red-400 hover:bg-red-500/15 transition disabled:opacity-50"
                                    title="إلغاء"
                                  >
                                    <X size={14} />
                                  </button>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <span>{formatCurrency(s.total_fees ?? 0)} ج.م</span>
                                  {isMaster && (
                                    <button
                                      onClick={() => startEditFee(s)}
                                      className="p-0.5 rounded text-slate-500 hover:text-amber-400 transition"
                                      title="تعديل المصاريف يدوياً"
                                    >
                                      <Pencil size={11} />
                                    </button>
                                  )}
                                </span>
                              )}
                              {' • '}المدفوع:{' '}
                              <button onClick={() => { setHistoryStudent(s); loadPayments(s); }} className="text-emerald-400 font-bold hover:underline cursor-pointer" title="عرض تفاصيل الحركات">{formatCurrency(monthlyPaidMap.get(s.id) ?? 0)} ج.م</button>
                              {' • '}<span className={isFull ? 'text-emerald-400' : 'text-amber-400'}>{isFull ? 'دفع كامل' : `متبقي ${formatCurrency(remaining)} ج.م`}</span>
                            </p>
                            <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all ${isFull ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                          <div className="flex gap-2 flex-wrap w-full sm:w-auto">
                            <Button size="sm" variant="secondary" onClick={() => setViewTarget(s)} title="عرض بيانات الطالب"><Eye size={14} /> عرض</Button>
                            <Button size="sm" variant="secondary" onClick={() => { setHistoryStudent(s); loadPayments(s); }}><History size={14} /> السجل</Button>
                            <Button size="sm" variant="secondary" onClick={() => openPayStudent(s)} title="إضافة دفعة / تعديل سريع"><Plus size={14} /></Button>
                            <Button size="sm" variant="secondary" onClick={() => openReceiptPicker(s)} title="إرسال إيصال واتساب لدفعة موجودة"><MessageCircle size={14} /></Button>
                            {isMaster && (
                              <Button size="sm" variant="ghost" onClick={() => setDeleteStudentTarget(s)} title="حذف الطالب" className="text-red-400 hover:bg-red-500/10"><Trash2 size={14} /></Button>
                            )}
                            {canManageExemptions && (
                              <>
                                <Button size="sm" variant={monthExemptMap.has(s.id) ? 'primary' : 'secondary'} onClick={() => setExemptTarget(s)} title={monthExemptMap.has(s.id) ? 'إلغاء الإعفاء' : 'إعفاء تام'}><Shield size={14} /> {monthExemptMap.has(s.id) ? 'إلغاء الإعفاء' : 'إعفاء'}</Button>
                                <Button size="sm" variant="secondary" onClick={() => openDiscountModal(s)} title="خصم مرن"><TrendingDown size={14} /> خصم</Button>
                              </>
                            )}
                            {!monthExemptMap.has(s.id) && !isFull && (
                              <>
                                <Button size="sm" variant="secondary" onClick={() => handleQuickFullPay(s)} loading={paySubmitting} title="تسجيل دفع كامل للمبلغ المتبقي"><CheckCircle2 size={14} /> دفع كامل</Button>
                                <Button size="sm" onClick={() => openPayStudent(s)}><Plus size={14} /> دفعة جزئية</Button>
                              </>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </>
      )}

      <Modal open={unpaidOpen} onClose={() => setUnpaidOpen(false)} title="المبالغ الإجمالية الغير مدفوعة" size="md">
        <div className="space-y-4">
          <div className="glass-light rounded-xl p-4 text-center">
            <p className="text-xs text-slate-400">إجمالي الطلاب غير المسددين</p>
            <p className="text-3xl font-black text-red-400 mt-1">{unpaidStudents.length} طالب</p>
          </div>
          {unpaidStudents.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="secondary" onClick={() => exportToCSV('الطلاب_غير_المسددين', ['#', 'اسم الطالب', 'المجموعة', 'الموعد', 'المرحلة', 'المتبقي (ج.م)'], unpaidStudents.map((s, i) => [i + 1, s.name, s.group_name ?? '-', s.group_schedule ?? '-', `${s.stage_name ?? ''} ${s.grade_name ?? ''}`.trim(), (s.total_fees ?? 0) - (monthlyPaidMap.get(s.id) ?? 0)]))}><Download size={14} /> تصدير Excel</Button>
              <Button size="sm" variant="secondary" onClick={() => printDocument('كشف الطلاب غير المسددين', buildUnpaidPrintHTML(unpaidStudents))}><Printer size={14} /> طباعة / PDF</Button>
              <PDFButton label="PDF احترافي" size="sm" disabled={unpaidStudents.length === 0} onClick={async () => exportUnpaidStudentsPDF(students, monthlyPaidMap, monthExemptMap, { stageName: selectedStage?.name, gradeName: selectedGrade?.name, groupName: selectedGroup?.name, monthLabel: getMonthLabel(monthKey) })} />
            </div>
          )}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {unpaidStudents.length === 0 ? (
              <p className="text-emerald-400 text-center py-6 glass-light rounded-xl">رائع! جميع الطلاب قاموا بدفع المصروفات.</p>
            ) : (
              unpaidStudents.map((s) => {
                const remaining = (s.total_fees ?? 0) - (monthlyPaidMap.get(s.id) ?? 0);
                return (
                  <div key={s.id} className="glass-light rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <span className="font-bold text-white text-sm block">{s.name}</span>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-1 flex-wrap">
                          {s.group_name && <span className="bg-white/5 px-2 py-0.5 rounded">المجموعة: {s.group_name}</span>}
                          {s.group_schedule && <span className="bg-white/5 px-2 py-0.5 rounded">الموعد: {s.group_schedule}</span>}
                          {s.grade_name && <span className="bg-white/5 px-2 py-0.5 rounded">{s.stage_name ? `${s.stage_name} - ` : ''}{s.grade_name}</span>}
                        </div>
                      </div>
                      <span className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0">متبقي {formatCurrency(remaining)} ج.م</span>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => sendWhatsAppReminder(s)} className="flex items-center justify-center gap-2 flex-1 px-3 py-2.5 rounded-xl text-sm font-bold bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/25 transition active:scale-95 min-h-[44px]"><MessageCircle size={16} /> إرسال تذكير واتساب</button>
                      <button type="button" onClick={() => sendMonthReminder(s)} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold bg-amber-600/15 border border-amber-500/30 text-amber-400 hover:bg-amber-600/25 transition active:scale-95 min-h-[44px]" title="تذكير بالشهر"><Calendar size={16} /></button>
                      {isMaster && (
                        <button type="button" onClick={() => setDeleteStudentTarget(s)} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold bg-red-600/15 border border-red-500/30 text-red-400 hover:bg-red-600/25 transition active:scale-95 min-h-[44px]" title="حذف الطالب"><Trash2 size={16} /></button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Modal>

      {/* Paid Students Modal — organized by Stage → Grade → Group */}
      <Modal open={paidOpen} onClose={() => setPaidOpen(false)} title="الطلاب المسددون بالكامل" size="md">
        {(() => {
          const paidStudents = students.filter((s) => {
            if (monthExemptMap.has(s.id)) return false;
            const paid = monthlyPaidMap.get(s.id) ?? 0;
            return (s.total_fees ?? 0) > 0 && paid >= (s.total_fees ?? 0);
          });
          const exemptStudents = students.filter((s) => monthExemptMap.has(s.id));
          if (paidStudents.length === 0 && exemptStudents.length === 0) {
            return <p className="text-center text-slate-400 py-6 glass-light rounded-xl">لا يوجد طلاب مسددون بالكامل بعد.</p>;
          }
          const totalCollectedPaid = paidStudents.reduce((sum, s) => sum + (monthlyPaidMap.get(s.id) ?? 0), 0);
          const byStage = new Map<string, EnrichedStudent[]>();
          for (const s of paidStudents) {
            const stage = s.stage_name ?? 'غير محدد';
            if (!byStage.has(stage)) byStage.set(stage, []);
            byStage.get(stage)!.push(s);
          }
          return (
            <div className="space-y-4">
              <div className="glass-light rounded-xl p-4 text-center">
                <p className="text-xs text-slate-400">إجمالي الطلاب المسددين</p>
                <p className="text-3xl font-black text-emerald-400 mt-1">{paidStudents.length} طالب</p>
                <p className="text-sm text-emerald-400 mt-1">إجمالي المحصل: {formatCurrency(totalCollectedPaid)} ج.م</p>
                {exemptStudents.length > 0 && <p className="text-xs text-sky-400 mt-1.5 flex items-center justify-center gap-1"><Shield size={12} /> طلاب معفون: {exemptStudents.length}</p>}
              </div>
              <div className="flex gap-2 flex-wrap">
                <PDFButton label="PDF احترافي" size="sm" disabled={fullyPaid === 0} onClick={async () => exportPaidStudentsPDF(students, monthlyPaidMap, monthExemptMap, { stageName: selectedStage?.name, gradeName: selectedGrade?.name, groupName: selectedGroup?.name, monthLabel: getMonthLabel(monthKey) })} />
                <PDFButton label="ملخص المدفوعات" size="sm" onClick={async () => exportMonthlyPaymentSummaryPDF(students, monthlyPaidMap, monthExemptMap, { stageName: selectedStage?.name, gradeName: selectedGrade?.name, groupName: selectedGroup?.name, monthLabel: getMonthLabel(monthKey) })} />
                <PDFButton label="كشف أسماء" size="sm" onClick={async () => exportStudentListPDF(students, { stageName: selectedStage?.name, gradeName: selectedGrade?.name, groupName: selectedGroup?.name, monthLabel: getMonthLabel(monthKey) })} />
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {Array.from(byStage.entries()).map(([stageName, stageStudents]) => {
                  const byGrade = new Map<string, EnrichedStudent[]>();
                  for (const s of stageStudents) {
                    const grade = s.grade_name ?? 'غير محدد';
                    if (!byGrade.has(grade)) byGrade.set(grade, []);
                    byGrade.get(grade)!.push(s);
                  }
                  const stageTotal = stageStudents.reduce((sum, s) => sum + (monthlyPaidMap.get(s.id) ?? 0), 0);
                  return (
                    <div key={stageName} className="glass-light rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-white flex items-center gap-2"><GraduationCap size={16} className="text-amber-400" /> {stageName}</h4>
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">{stageStudents.length} طالب — {formatCurrency(stageTotal)} ج.م</span>
                      </div>
                      {Array.from(byGrade.entries()).map(([gradeName, gradeStudents]) => {
                        const byGroup = new Map<string, EnrichedStudent[]>();
                        for (const s of gradeStudents) {
                          const group = s.group_name ?? 'غير محدد';
                          if (!byGroup.has(group)) byGroup.set(group, []);
                          byGroup.get(group)!.push(s);
                        }
                        const gradeTotal = gradeStudents.reduce((sum, s) => sum + (monthlyPaidMap.get(s.id) ?? 0), 0);
                        return (
                          <div key={gradeName} className="space-y-1.5">
                            <div className="flex items-center justify-between pr-2">
                              <span className="text-xs font-semibold text-slate-300">{gradeName}</span>
                              <span className="text-[10px] text-slate-500">{gradeStudents.length} طالب — {formatCurrency(gradeTotal)} ج.م</span>
                            </div>
                            {Array.from(byGroup.entries()).map(([groupName, groupStudents]) => {
                              const groupTotal = groupStudents.reduce((sum, s) => sum + (monthlyPaidMap.get(s.id) ?? 0), 0);
                              return (
                                <div key={groupName} className="bg-white/[0.03] rounded-lg p-2 space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1"><Users size={12} /> {groupName}</span>
                                    <span className="text-[10px] text-slate-500">{groupStudents.length} طالب — {formatCurrency(groupTotal)} ج.م</span>
                                  </div>
                                  {groupStudents.map((s) => (
                                    <div key={s.id} className="flex items-center justify-between pr-3 py-0.5">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />
                                        <span className="text-xs text-white truncate">{s.name}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <span className="text-[10px] text-emerald-400 font-bold">{formatCurrency(monthlyPaidMap.get(s.id) ?? 0)} ج.م</span>
                                        {isMaster && (
                                          <button onClick={() => { setHistoryStudent(s); loadPayments(s); setPaidOpen(false); }} className="p-1 rounded-lg hover:bg-amber-500/10 text-slate-400 hover:text-amber-400 transition" title="تعديل / حذف دفعة"><Pencil size={11} /></button>
                                        )}
                                        {isMaster && (
                                          <button onClick={() => setDeleteStudentTarget(s)} className="p-1 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition" title="حذف الطالب"><Trash2 size={11} /></button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={!!payStudent} onClose={() => { setPayStudent(null); setPayAmount(''); setPayNote(''); setPayDate(new Date().toISOString().slice(0, 10)); setOverrideUnlocked(false); }} title={`تسجيل دفعة: ${payStudent?.name ?? ''}`} size="sm">
        <div className="space-y-4">
          <div className="glass-light rounded-xl p-3 text-center text-sm text-slate-300">المتبقي:{' '}<span className="font-bold text-amber-400">{payStudent ? formatCurrency((payStudent.total_fees ?? 0) - (monthlyPaidMap.get(payStudent.id) ?? 0)) : 0} ج.م</span></div>
          {selectedGrade && selectedGrade.base_subscription > 0 && (
            <div className="glass-light rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-sm text-white font-medium">السعر الأساسي للصف: {formatCurrency(selectedGrade.base_subscription)} ج.م</p>
                <p className="text-xs text-slate-500 mt-0.5">القيمة المسجلة في الإعدادات — تُطبق تلقائياً</p>
              </div>
              {overrideUnlocked ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
                  <Lock size={10} /> تعديل مفعّل
                </span>
              ) : (
                <button
                  onClick={() => setPinPromptFor('override')}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full hover:bg-amber-500/20 transition"
                >
                  <Edit3 size={10} /> تعديل المبلغ
                </button>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">المبلغ المدفوع (ج.م)</label>
            <input
              type="number"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder={selectedGrade ? String(selectedGrade.base_subscription) : '0'}
              autoFocus
              className={inputCls}
              disabled={!overrideUnlocked && selectedGrade != null && selectedGrade.base_subscription > 0}
            />
            {!overrideUnlocked && selectedGrade != null && selectedGrade.base_subscription > 0 && (
              <p className="text-[10px] text-slate-500 mt-1">القيمة محمية برمز المدير — اضغط «تعديل المبلغ» للتغيير</p>
            )}
            {payStudent && payAmount && parseFloat(payAmount) > 0 && (
              <p className="text-xs mt-2 text-amber-400">المتبقي بعد الدفع: {formatCurrency(Math.max(0, (payStudent.total_fees ?? 0) - (monthlyPaidMap.get(payStudent.id) ?? 0) - parseFloat(payAmount)))} ج.م — {parseFloat(payAmount) >= ((payStudent.total_fees ?? 0) - (monthlyPaidMap.get(payStudent.id) ?? 0)) ? 'دفع كامل' : 'دفع جزئي / متبقي'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">تاريخ الدفع</label>
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={inputCls} />
            <p className="text-[10px] text-slate-500 mt-1">الافتراضي هو تاريخ اليوم — يمكن تغييره لتسجيل دفعة سابقة</p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">ملاحظة (اختياري)</label>
            <input type="text" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="مثال: دفعة شهر أكتوبر" className={inputCls} />
          </div>
          <div className="flex gap-3 justify-end"><Button variant="secondary" onClick={() => { setPayStudent(null); setPayAmount(''); setPayNote(''); setPayDate(new Date().toISOString().slice(0, 10)); setOverrideUnlocked(false); }}>إلغاء</Button><Button onClick={handleAddPayment} loading={paySubmitting} disabled={!payAmount || parseFloat(payAmount) <= 0}>تسجيل الدفعة</Button></div>
        </div>
      </Modal>

      {/* PIN Prompt Modal */}
      <Modal open={!!pinPromptFor} onClose={() => { setPinPromptFor(null); setPinInput(''); setPinError(false); }} title="رمز المدير (PIN)" size="sm">
        <div className="space-y-4">
          <div className="flex items-center gap-3 glass-light rounded-xl p-3">
            <Shield size={20} className="text-emerald-400" />
            <p className="text-sm text-slate-300">
              {pinPromptFor === 'override'
                ? 'لتعديل المبلغ يدوياً، أدخل رمز المدير'
                : 'لحذف دفعة مسجلة، أدخل رمز المدير'}
            </p>
          </div>
          <div>
            <input
              type="password"
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value); setPinError(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePinConfirm(); }}
              placeholder="••••"
              inputMode="numeric"
              autoFocus
              className={`${inputCls} text-center text-2xl tracking-[0.5em] ${pinError ? 'border-red-500/50' : ''}`}
            />
            {pinError && <p className="text-red-400 text-xs mt-1.5 flex items-center gap-1"><AlertTriangle size={12} /> رمز غير صحيح</p>}
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setPinPromptFor(null); setPinInput(''); setPinError(false); }}>إلغاء</Button>
            <Button onClick={handlePinConfirm} disabled={!pinInput.trim()}>تأكيد</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!historyStudent} onClose={() => setHistoryStudent(null)} title={`سجل المدفوعات التفصيلي: ${historyStudent?.name ?? ''}`}>
        {payments.length === 0 ? (
          <div className="space-y-4">
            <p className="text-center text-slate-400 py-6">لا توجد دفعات مسجلة.</p>
            {isMaster && historyStudent && !monthExemptMap.has(historyStudent.id) && (
              <Button variant="warning" className="w-full" onClick={() => { setAdjustTarget(historyStudent); }}><TrendingDown size={16} /> خصم / تعديل المستحقات</Button>
            )}
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            <AnimatePresence>
              {payments.map((p) => (
                <motion.div key={p.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-light rounded-xl p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-bold text-emerald-400">{formatCurrency(p.amount)} ج.م</p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatArabicDate(p.payment_date)}</p>
                    {p.recorded_at && <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1"><Clock3 size={10} /> {formatTime(p.recorded_at)}</p>}
                    {p.recorded_by && <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1"><UserCog size={10} /> سجّلها: {p.recorded_by}</p>}
                    {p.note && <p className="text-xs text-slate-500 mt-1">{p.note}</p>}
                    {isMaster && <p className="text-[9px] text-slate-600 mt-0.5 font-mono" dir="ltr">ID: {p.id.slice(0, 8)}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isMaster && <button onClick={() => { setEditPaymentTarget(p); setEditPayAmount(String(p.amount ?? 0)); setEditPayNote(p.note ?? ''); setEditPayDate(p.payment_date ?? ''); setEditPayMonth(p.month_key ?? ''); }} className="p-1.5 rounded-lg hover:bg-amber-500/10 text-slate-400 hover:text-amber-400 transition" title="تعديل هذه الدفعة"><Pencil size={14} /></button>}
                    <button onClick={() => setDeletePaymentTarget(p)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition" title="حذف هذه الحركة"><Trash2 size={14} /></button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div className="glass-light rounded-xl p-3 text-center border-t border-white/10 mt-2">
              <p className="text-xs text-slate-400">الإجمالي المحصل لهذا الطالب</p>
              <p className="text-lg font-black text-emerald-400">{formatCurrency(payments.reduce((sum, p) => sum + (p.amount ?? 0), 0))} ج.م</p>
            </div>
            {isMaster && historyStudent && !monthExemptMap.has(historyStudent.id) && (
              <Button variant="warning" className="w-full" onClick={() => { setAdjustTarget(historyStudent); }}><TrendingDown size={16} /> خصم / تعديل المستحقات</Button>
            )}
          </div>
        )}
      </Modal>

      <Modal open={auditOpen} onClose={() => setAuditOpen(false)} title="سجل العمليات الخفي (للمسؤول فقط)" size="md">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {auditLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-slate-400"><Loader2 size={18} className="animate-spin" /> جاري التحميل...</div>
          ) : auditLogs.length === 0 ? (
            <p className="text-center text-slate-400 py-6">لا توجد عمليات مسجلة.</p>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="glass-light rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">{ACTION_LABELS[log.action_type] ?? log.action_type}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${log.actor_role === 'master' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'}`}>{log.actor_role === 'master' ? 'المدرس' : 'مساعد'}</span>
                </div>
                <div className="text-xs text-slate-400 mt-1 space-y-0.5">
                  <p>المستخدم: {log.actor_name}</p>
                  {log.student?.name && <p>الطالب: {log.student.name}</p>}
                  {log.amount != null && <p>المبلغ: {formatCurrency(log.amount)} ج.م</p>}
                  <p className="text-slate-500">{formatTransactionDateTime(log.created_at)}</p>
                  {log.note && <p className="text-slate-500">{log.note}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <Modal open={!!editPaymentTarget} onClose={() => {
        const isDirty = editPaymentTarget && (
          String(editPayAmount) !== String(editPaymentTarget.amount ?? '') ||
          editPayNote !== (editPaymentTarget.note ?? '') ||
          editPayDate !== (editPaymentTarget.payment_date ?? '') ||
          editPayMonth !== (editPaymentTarget.month_key ?? '')
        );
        if (isDirty && !confirm('يوجد تعديلات غير محفوظة. هل تريد الإغلاق بدون حفظ؟')) return;
        setEditPaymentTarget(null); setEditPayAmount(''); setEditPayNote(''); setEditPayDate(''); setEditPayMonth('');
      }} title="تعديل دفعة" size="sm">
        {editPaymentTarget && (() => {
          const student = historyStudent ?? students.find((s) => s.id === editPaymentTarget.student_id) ?? null;
          const totalFees = student?.total_fees ?? 0;
          const otherPaymentsTotal = payments.filter((p) => p.id !== editPaymentTarget.id).reduce((sum, p) => sum + (p.amount ?? 0), 0);
          const newAmount = parseFloat(editPayAmount) || 0;
          const totalPaidAfter = otherPaymentsTotal + newAmount;
          const remainingAfter = Math.max(0, totalFees - totalPaidAfter);
          const statusAfter = remainingAfter <= 0 ? 'مسدد' : totalPaidAfter > 0 ? 'دفع جزئي' : 'غير مسدد';
          return (
            <div className="space-y-4">
              <div className="glass-light rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-slate-400">الطالب:</span><span className="font-bold text-white">{student?.name ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">الشهر:</span><span className="font-bold text-white">{getMonthLabel(monthKey)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المصروفات:</span><span className="font-bold text-white">{formatCurrency(totalFees)} ج.م</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المدفوع الحالي:</span><span className="font-bold text-emerald-400">{formatCurrency(otherPaymentsTotal + (editPaymentTarget.amount ?? 0))} ج.م</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المتبقي الحالي:</span><span className="font-bold text-amber-400">{formatCurrency(Math.max(0, totalFees - (otherPaymentsTotal + (editPaymentTarget.amount ?? 0))))} ج.م</span></div>
                <div className="flex justify-between pt-1 border-t border-white/10"><span className="text-slate-400">Payment ID:</span><span className="font-mono text-slate-300 text-[10px]" dir="ltr">{editPaymentTarget.id.slice(0, 12)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">تاريخ الدفع:</span><span className="font-bold text-white text-[10px]" dir="ltr">{editPaymentTarget.payment_date}</span></div>
                {editPaymentTarget.recorded_at && <div className="flex justify-between"><span className="text-slate-400">وقت الدفع:</span><span className="font-bold text-white text-[10px]" dir="ltr">{formatTime(editPaymentTarget.recorded_at)}</span></div>}
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">المبلغ الجديد (ج.م)</label>
                <input
                  type="number"
                  value={editPayAmount}
                  onChange={(e) => setEditPayAmount(e.target.value)}
                  autoFocus
                  className={inputCls}
                  placeholder={String(editPaymentTarget.amount ?? 0)}
                />
                {newAmount > 0 && (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="text-slate-400">بعد التعديل:</p>
                    <p className="text-emerald-400">المدفوع: {formatCurrency(totalPaidAfter)} ج.م</p>
                    <p className="text-amber-400">المتبقي: {formatCurrency(remainingAfter)} ج.م</p>
                    <p className="text-white font-bold">الحالة: {statusAfter}</p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">تاريخ الدفع</label>
                <input type="date" value={editPayDate} onChange={(e) => setEditPayDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">تعديل الشهر</label>
                <select value={editPayMonth} onChange={(e) => setEditPayMonth(e.target.value)} className={inputCls}>
                  {Array.from({ length: 12 }, (_, i) => {
                    const now = new Date();
                    const y = now.getFullYear();
                    const mk = `${y}-${String(i + 1).padStart(2, '0')}`;
                    return <option key={mk} value={mk}>{ARABIC_MONTHS[i]} {y}</option>;
                  })}
                </select>
                {editPayMonth !== (editPaymentTarget.month_key ?? '') && (
                  <p className="text-[10px] text-amber-400 mt-1">سيتم نقل الدفعة من {editPaymentTarget.month_key ?? ''} إلى {editPayMonth}</p>
                )}
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1.5">ملاحظة (اختياري)</label>
                <input type="text" value={editPayNote} onChange={(e) => setEditPayNote(e.target.value)} placeholder="ملاحظة على الدفعة" className={inputCls} />
              </div>
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" onClick={() => {
                  const isDirty = editPaymentTarget && (
                    String(editPayAmount) !== String(editPaymentTarget.amount ?? '') ||
                    editPayNote !== (editPaymentTarget.note ?? '') ||
                    editPayDate !== (editPaymentTarget.payment_date ?? '') ||
                    editPayMonth !== (editPaymentTarget.month_key ?? '')
                  );
                  if (isDirty && !confirm('يوجد تعديلات غير محفوظة. هل تريد الإغلاق بدون حفظ؟')) return;
                  setEditPaymentTarget(null); setEditPayAmount(''); setEditPayNote(''); setEditPayDate(''); setEditPayMonth('');
                }}>إلغاء</Button>
                <Button onClick={handleEditPayment} loading={editPaySaving} disabled={!editPayAmount || parseFloat(editPayAmount) <= 0}>حفظ التعديل</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        open={!!deletePaymentTarget}
        onClose={() => setDeletePaymentTarget(null)}
        onConfirm={handleDeletePayment}
        loading={deletePayLoading}
        title="⚠️ حذف الدفعة"
        subtext={deletePaymentTarget
          ? `الطالب: ${historyStudent?.name ?? ''} — المبلغ: ${formatCurrency(deletePaymentTarget.amount ?? 0)} ج.م — التاريخ: ${formatArabicDate(deletePaymentTarget.payment_date ?? '')}. سيتم حذف هذه الدفعة نهائياً وخصم المبلغ من المدفوعات والإيرادات. هل أنت متأكد؟`
          : 'سيتم حذف هذه الدفعة نهائياً وخصم المبلغ من المدفوعات والإيرادات. هل أنت متأكد؟'}
        confirmLabel="تأكيد الحذف"
      />

      <ConfirmDialog open={!!deleteExpenseTarget} onClose={() => setDeleteExpenseTarget(null)} onConfirm={handleDeleteExpense} title="⚠️ حذف المصروف" subtext="سيتم حذف هذا المصروف نهائياً." confirmLabel="تأكيد الحذف" />

      <Modal open={!!adjustTarget} onClose={() => { setAdjustTarget(null); setAdjustAmount(''); setAdjustNote(''); }} title={`خصم / تعديل المستحقات: ${adjustTarget?.name ?? ''}`} size="sm">
        <div className="space-y-4">
          <div className="glass-light rounded-xl p-3 text-center text-xs text-slate-300">
            المستحقات الحالية: <span className="font-bold text-white">{adjustTarget ? formatCurrency(adjustTarget.total_fees ?? 0) : 0} ج.م</span>
            <br />
            المدفوع: <span className="font-bold text-emerald-400">{adjustTarget ? formatCurrency(monthlyPaidMap.get(adjustTarget.id) ?? 0) : 0} ج.م</span>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">مبلغ الخصم / التعديل (ج.م)</label>
            <input
              type="number"
              value={adjustAmount}
              onChange={(e) => setAdjustAmount(e.target.value)}
              placeholder="0"
              min="0"
              autoFocus
              className={inputCls}
            />
            {adjustTarget && adjustAmount && parseFloat(adjustAmount) > 0 && (
              <p className="text-xs text-amber-400 mt-2">المستحقات بعد الخصم: {formatCurrency(Math.max(0, (adjustTarget.total_fees ?? 0) - parseFloat(adjustAmount)))} ج.م</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">سبب الخصم (اختياري)</label>
            <input type="text" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="مثال: خصم خاص، تنازل، تصحيح حسابي" className={inputCls} />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setAdjustTarget(null); setAdjustAmount(''); setAdjustNote(''); }}>إلغاء</Button>
            <Button onClick={handleAdjustDues} loading={adjustSaving} disabled={!adjustAmount || parseFloat(adjustAmount) <= 0}>تطبيق الخصم</Button>
          </div>
        </div>
      </Modal>

      {/* Exemption Confirmation Modal */}
      <ConfirmDialog
        open={!!exemptTarget}
        onClose={() => setExemptTarget(null)}
        onConfirm={toggleExemption}
        title={(exemptTarget && monthExemptMap.has(exemptTarget.id)) ? 'إلغاء الإعفاء' : 'تفعيل الإعفاء'}
        subtext={(exemptTarget && monthExemptMap.has(exemptTarget.id))
          ? `سيتم إلغاء إعفاء الطالب «${exemptTarget?.name ?? ''}» لشهر ${monthKey} وستعود المصاريف المستحقة كما كانت.`
          : `سيتم إعفاء الطالب «${exemptTarget?.name ?? ''}» من المصاريف لشهر ${monthKey} فقط. لن يتأثر شهر آخر.`}
        confirmLabel={(exemptTarget && monthExemptMap.has(exemptTarget.id)) ? 'إلغاء الإعفاء' : 'تفعيل الإعفاء'}
        variant={(exemptTarget && monthExemptMap.has(exemptTarget.id)) ? 'danger' : 'primary'}
      />

      {/* Flexible Discount Modal */}
      <Modal open={!!discountTarget} onClose={() => { setDiscountTarget(null); setDiscountMode(null); setDiscountInput(''); }} title={`خصم مرن: ${discountTarget?.name ?? ''}`} size="sm">
        <div className="space-y-4">
          <div className="glass-light rounded-xl p-3 text-center text-xs text-slate-300">
            المصاريف الحالية: <span className="font-bold text-white">{discountTarget ? formatCurrency(discountTarget.total_fees ?? 0) : 0} ج.م</span>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">نوع الخصم</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                onClick={() => { setDiscountMode('fixed'); setDiscountInput(discountTarget?.discount_mode === 'fixed' ? String(discountTarget.discount_amount ?? 0) : ''); }}
                className={`px-3 py-2.5 rounded-xl text-xs font-bold transition ${discountMode === 'fixed' ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400' : 'glass-light border border-white/10 text-slate-400'}`}
              >مبلغ ثابت</button>
              <button
                onClick={() => { setDiscountMode('percent'); setDiscountInput(discountTarget?.discount_mode === 'percent' ? String(discountTarget.discount_percent ?? 0) : ''); }}
                className={`px-3 py-2.5 rounded-xl text-xs font-bold transition ${discountMode === 'percent' ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400' : 'glass-light border border-white/10 text-slate-400'}`}
              >نسبة مئوية</button>
              <button
                onClick={() => { setDiscountMode(null); setDiscountInput(''); }}
                className={`px-3 py-2.5 rounded-xl text-xs font-bold transition ${discountMode === null ? 'bg-red-500/15 border border-red-500/30 text-red-400' : 'glass-light border border-white/10 text-slate-400'}`}
              >إلغاء الخصم</button>
            </div>
          </div>
          {discountMode && (
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">
                {discountMode === 'percent' ? 'نسبة الخصم (%)' : 'مبلغ الخصم (ج.م)'}
              </label>
              <input
                type="number"
                value={discountInput}
                onChange={(e) => { const v = parseFloat(e.target.value); setDiscountInput(v < 0 ? '0' : e.target.value); }}
                placeholder="0"
                min="0"
                max={discountMode === 'percent' ? '100' : undefined}
                autoFocus
                className={inputCls}
              />
              {discountMode === 'percent' && discountInput && parseFloat(discountInput) > 100 && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> النسبة لا يمكن تجاوز 100%</p>
              )}
              {discountTarget && discountInput && parseFloat(discountInput) >= 0 && (
                <p className="text-xs text-amber-400 mt-2">
                  {discountMode === 'percent'
                    ? `المبلغ بعد الخصم: ${formatCurrency(Math.max(0, (discountTarget.total_fees ?? 0) * (1 - Math.min(100, parseFloat(discountInput)) / 100)))} ج.م`
                    : `المبلغ بعد الخصم: ${formatCurrency(Math.max(0, (discountTarget.total_fees ?? 0) - parseFloat(discountInput)))} ج.م`}
                </p>
              )}
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setDiscountTarget(null); setDiscountMode(null); setDiscountInput(''); }}>إلغاء</Button>
            <Button onClick={saveDiscount} disabled={discountSaving || (discountMode !== null && (!discountInput || parseFloat(discountInput) < 0))}>
              {discountMode === null ? 'إلغاء الخصم' : 'تطبيق الخصم'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Expense Modal */}
      <Modal open={expenseOpen} onClose={() => setExpenseOpen(false)} title="تسجيل مصروف جديد" size="sm">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">نوع المصروف</label>
            <select value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value as ExpenseCategory })} className={inputCls}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">المبلغ (ج.م)</label>
            <input type="number" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} className={inputCls} autoFocus />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">التاريخ</label>
            <input type="date" value={expForm.date} onChange={(e) => setExpForm({ ...expForm, date: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">وصف (اختياري)</label>
            <input type="text" value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder="مثال: إيجار شهر أكتوبر" className={inputCls} />
          </div>
          <div className="flex gap-3 justify-end"><Button variant="secondary" onClick={() => setExpenseOpen(false)}>إلغاء</Button><Button onClick={handleAddExpense} disabled={!expForm.amount || parseFloat(expForm.amount) <= 0}>تسجيل</Button></div>
        </div>
      </Modal>

      {/* Premium Receipt Modal */}
      <Modal open={!!lastReceipt} onClose={() => setLastReceipt(null)} title="" size="sm">
        {lastReceipt && (
          <div className="space-y-0">
            {/* Premium receipt card */}
            <div ref={receiptCardRef} className="rounded-2xl overflow-hidden">
              {/* Header band */}
              <div className="relative bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 px-4 sm:px-6 py-4 sm:py-5 text-center text-white overflow-hidden">
                <div className="absolute -top-6 -right-6 w-20 h-20 bg-white/[0.06] rounded-full" />
                <div className="absolute -bottom-8 -left-4 w-16 h-16 bg-white/[0.04] rounded-full" />
                <div className="relative">
                  <div className="w-12 h-12 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center mx-auto mb-2">
                    <Receipt size={24} className="text-white" />
                  </div>
                  <h3 className="text-lg font-extrabold tracking-wide">منصة الخالد التعليمية</h3>
                  <p className="text-[10px] text-white/70 mt-0.5">إدارة مستر عمرو خالد</p>
                  <div className="inline-block mt-2 px-4 py-1 bg-white/12 border border-white/20 rounded-full text-[10px] font-bold tracking-widest uppercase">Payment Receipt • إيصال دفع</div>
                </div>
              </div>

              {/* Body */}
              <div className="glass-light rounded-b-2xl px-5 py-4 space-y-3">
                <div className="flex items-center justify-between pb-3 border-b-2 border-emerald-500/30">
                  <div>
                    <p className="text-[9px] text-slate-500 uppercase tracking-wide">Receipt No.</p>
                    <p className="text-sm font-bold text-white font-mono" dir="ltr">{lastReceipt.receiptNumber}</p>
                  </div>
                  <div className="text-left">
                    <p className="text-[9px] text-slate-500 uppercase tracking-wide">Date</p>
                    <p className="text-xs font-semibold text-white">{formatArabicDate(lastReceipt.date)}</p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <ReceiptRow label="اسم الطالب" value={lastReceipt.studentName} bold />
                  {lastReceipt.groupName && <ReceiptRow label="المجموعة" value={lastReceipt.groupName} />}
                  {(lastReceipt.gradeName || lastReceipt.stageName) && <ReceiptRow label="الصف الدراسي" value={[lastReceipt.stageName, lastReceipt.gradeName].filter(Boolean).join(' - ')} />}
                  {lastReceipt.baseSubscription !== undefined && lastReceipt.baseSubscription > 0 && <ReceiptRow label="الاشتراك الأساسي" value={`${formatCurrency(lastReceipt.baseSubscription)} ج.م`} />}
                  {lastReceipt.discountAmount && lastReceipt.discountAmount > 0 && <ReceiptRow label="خصم مسجل" value={`${formatCurrency(lastReceipt.discountAmount)} ج.م`} />}
                  {lastReceipt.note && <ReceiptRow label="ملاحظة" value={lastReceipt.note} />}
                  {lastReceipt.recordedBy && <ReceiptRow label="استلم بواسطة" value={lastReceipt.recordedBy} />}
                </div>

                {/* Amount box */}
                <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20 rounded-xl py-4 text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">المبلغ المدفوع • Amount Paid</p>
                  <p className="text-3xl font-black text-emerald-400">{formatCurrency(lastReceipt.amount)} <span className="text-base font-semibold">ج.م</span></p>
                  <div className="w-10 h-0.5 bg-emerald-500 mx-auto mt-2 rounded-full" />
                </div>

                {/* Signature row */}
                <div className="flex justify-between items-end pt-2">
                  <div className="text-center"><div className="w-16 border-t border-dashed border-slate-600 pt-1 mb-1" /><span className="text-[9px] text-slate-500">استلام المدرس</span></div>
                  <div className="text-[8px] text-slate-600 text-center"><p>صادر آلياً من</p><p className="font-semibold text-slate-500">منصة الخالد</p></div>
                  <div className="text-center"><div className="w-16 border-t border-dashed border-slate-600 pt-1 mb-1" /><span className="text-[9px] text-slate-500">توقيع ولي الأمر</span></div>
                </div>
              </div>
            </div>

            {/* Action buttons — 3 sending options */}
            <div className="space-y-3 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <button
                  onClick={() => setReceiptWhatsappConfirm(lastReceipt)}
                  disabled={false}
                  className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl bg-gradient-to-br from-emerald-600/20 to-emerald-700/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/25 transition active:scale-95 disabled:opacity-50"
                >
                  <Send size={18} />
                  <span className="text-[11px] font-bold">تأكيد السداد</span>
                </button>
                <button
                  onClick={() => lastReceipt && sendReceiptAsImage(lastReceipt)}
                  disabled={receiptSending === 'image'}
                  className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl bg-gradient-to-br from-emerald-600/20 to-emerald-700/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/25 transition active:scale-95 disabled:opacity-50"
                >
                  <Image size={18} />
                  <span className="text-[11px] font-bold">إرسال كصورة</span>
                </button>
                <button
                  onClick={() => lastReceipt && sendReceiptWhatsAppText(lastReceipt)}
                  className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl bg-gradient-to-br from-green-600/20 to-green-700/10 border border-green-500/30 text-green-300 hover:bg-green-600/25 transition active:scale-95"
                >
                  <FileText size={18} />
                  <span className="text-[11px] font-bold">رسالة نصية</span>
                </button>
                <button
                  onClick={() => lastReceipt && printReceipt(lastReceipt)}
                  className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl bg-gradient-to-br from-blue-600/20 to-blue-700/10 border border-blue-500/30 text-blue-300 hover:bg-blue-600/25 transition active:scale-95"
                >
                  <Printer size={18} />
                  <span className="text-[11px] font-bold">طباعة</span>
                </button>
              </div>
              <Button variant="secondary" className="w-full" onClick={() => setLastReceipt(null)}>إغلاق</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* WhatsApp confirmation modal */}
      <Modal
        open={!!receiptWhatsappConfirm}
        onClose={() => setReceiptWhatsappConfirm(null)}
        title="تأكيد إرسال إيصال الواتساب"
        size="sm"
      >
        {receiptWhatsappConfirm && (() => {
          const student = receiptWhatsappConfirm.studentId ? students.find((s) => s.id === receiptWhatsappConfirm.studentId) : null;
          const phone = normalizePhoneForWhatsApp(student?.parent_phone || student?.phone || '');
          const hasPhone = !!phone;
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0" />
                <p className="text-xs text-emerald-300">
                  تم تسجيل الدفع بنجاح للطالب <span className="font-bold">{receiptWhatsappConfirm.studentName}</span>.
                  هل تريد إرسال إيصال الدفع عبر واتساب لولي الأمر؟
                </p>
              </div>
              {!hasPhone && (
                <div className="rounded-xl p-4 bg-amber-500/10 border border-amber-500/30 space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
                    <p className="text-sm font-bold text-amber-300">هذا الرقم غير مسجل أو ليس لديه رقم</p>
                  </div>
                  <p className="text-xs text-slate-300">الرجاء تسجيل رقم هاتف لولي الأمر لتمكين إرسال الإيصال عبر واتساب.</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      if (student) {
                        setReceiptWhatsappConfirm(null);
                        setLastReceipt(null);
                        setViewTarget(student);
                      }
                    }}
                  >
                    <UserCog size={14} /> الذهاب لبيانات الطالب لتسجيل الرقم
                  </Button>
                </div>
              )}
              {hasPhone && (
                <div className="glass-light rounded-xl p-3 text-center text-xs text-slate-400">
                  سيتم الإرسال إلى الرقم: <span className="font-bold text-white" dir="ltr">{phone}</span>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setReceiptWhatsappConfirm(null)}>إلغاء</Button>
                <Button
                  className="flex-1"
                  disabled={!hasPhone || whatsappSending}
                  onClick={() => {
                    if (!hasPhone || !receiptWhatsappConfirm) return;
                    setWhatsappSending(true);
                    setReceiptWhatsappConfirm(null);
                    sendPaymentConfirmationWhatsApp({
                      studentId: receiptWhatsappConfirm.studentId,
                      studentName: receiptWhatsappConfirm.studentName,
                      monthKey: receiptWhatsappConfirm.monthKey,
                      paymentId: receiptWhatsappConfirm.paymentId,
                      receiptNumber: receiptWhatsappConfirm.receiptNumber,
                      paymentDate: receiptWhatsappConfirm.date,
                      recordedAt: receiptWhatsappConfirm.recordedAt,
                      amount: receiptWhatsappConfirm.amount,
                      totalDueAtPayment: receiptWhatsappConfirm.totalDueAtPayment,
                      totalPaidAtPayment: receiptWhatsappConfirm.totalPaidAtPayment,
                    });
                    setWhatsappSending(false);
                  }}
                >
                  {whatsappSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  إرسال عبر واتساب
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        open={!!deleteStudentTarget}
        onClose={() => setDeleteStudentTarget(null)}
        onConfirm={async () => {
          if (!deleteStudentTarget || deleteStudentLoading) return;
          const target = deleteStudentTarget;
          setDeleteStudentLoading(true);
          const prevStudents = students;
          setStudents((prev) => prev.filter((s) => s.id !== target.id));
          setDeleteStudentTarget(null);
          try {
            await deleteStudent(target.id, actorName, isMaster ? 'master' : 'assistant');
            invalidateByPrefix('students_');
            invalidateByPrefix('payments_');
            invalidateByPrefix('monthly_');
            loadStudents();
            if (selectedGroup) {
              const cEpoch = ++collectedEpochRef.current;
              fetchGroupMonthlyCollected(selectedGroup.id, monthKey).then((data) => {
                if (cEpoch === collectedEpochRef.current) setMonthlyCollected(data);
              });
              const pEpoch = ++paidMapEpochRef.current;
              fetchGroupMonthlyPaidMap(selectedGroup.id, monthKey).then((data) => {
                if (pEpoch === paidMapEpochRef.current) setMonthlyPaidMap(data);
              });
            }
            showToast(`تم حذف الطالب ${target.name} بنجاح — بواسطة ${actorName}`, 'success');
          } catch {
            setStudents(prevStudents);
            showToast('تعذّر حذف الطالب — تأكد من الصلاحيات وحاول مجدداً', 'error');
          } finally {
            setDeleteStudentLoading(false);
          }
        }}
        loading={deleteStudentLoading}
        title="⚠️ حذف الطالب"
        subtext={`سيتم حذف الطالب «${deleteStudentTarget?.name ?? ''}» نهائياً باستخدام معرّفه الفريد (Student ID). لا يؤثر على أي طالب آخر حتى لو كان له نفس الاسم. سيتم التعامل مع البيانات المرتبطة (الحضور، الدفعات، الواجبات) وفق العلاقات الحالية بدون كسر البيانات التاريخية. هل أنت متأكد؟`}
        confirmLabel="تأكيد الحذف"
      />

      <Modal
        open={!!receiptPickerStudent}
        onClose={() => { setReceiptPickerStudent(null); setReceiptPickerPayments([]); }}
        title={`إرسال إيصال واتساب — ${receiptPickerStudent?.name ?? ''}`}
        size="sm"
      >
        <div className="space-y-3">
          {receiptPickerLoading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-slate-400"><Loader2 size={18} className="animate-spin" /> جاري تحميل الدفعات...</div>
          ) : receiptPickerPayments.length === 0 ? (
            <p className="text-center text-slate-400 py-6 glass-light rounded-xl">لا توجد دفعات مسجلة لهذا الطالب في هذا الشهر.</p>
          ) : (
            <>
              <p className="text-xs text-slate-400 text-center">اختر الدفعة التي تريد إرسال إيصالها عبر واتساب:</p>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {receiptPickerPayments.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => sendExistingReceiptWhatsApp(receiptPickerStudent!, p)}
                    className="w-full glass-light rounded-xl p-3 flex items-center justify-between hover:bg-white/[0.08] transition active:scale-[0.98] text-right"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-emerald-400 text-sm">{formatCurrency(p.amount ?? 0)} ج.م</p>
                      <p className="text-xs text-slate-400 mt-0.5">{formatArabicDate(p.payment_date)}</p>
                      {p.receipt_number && <p className="text-[10px] text-slate-500 mt-0.5 font-mono" dir="ltr">{p.receipt_number}</p>}
                    </div>
                    <MessageCircle size={18} className="text-emerald-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </Modal>

      <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
