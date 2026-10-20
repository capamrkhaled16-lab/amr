import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Archive, Lock, Clock as Unlock, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle2, Clock, CalendarDays, Users, Wallet, ChartBar as BarChart3, FileText, ChevronDown, RefreshCw, Inbox, Search, Plus, Zap, TrendingUp, Undo2, Mic, Heart, BookOpen, GraduationCap, Phone, MessageCircle, Link2, CreditCard as Edit2, Check, Trash as Trash2, X, Send, Bell, Printer, Award, CalendarRange } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { formatCurrency, formatArabicDate, normalizePhoneForWhatsApp, openWhatsAppURL } from '@/lib/format';
import { printDocument } from '@/lib/export';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportStudentListPDF, exportMonthlyPaymentSummaryPDF, exportPaidStudentsPDF, exportUnpaidStudentsPDF } from '@/lib/pdfExport';
import { triggerAutoArchive, createHistoricalPayment, fetchArchiveRuns, rollbackArchive, preArchiveValidation, resolvePaymentStatusFromDB, deleteStudent, type PreArchiveIssue } from '@/lib/data';
import SmartGradeCompletion from '@/components/dashboard/SmartGradeCompletion';
import DailyCollectionsWidget from '@/components/dashboard/DailyCollectionsWidget';
import AccountingCheckpoint from '@/components/dashboard/AccountingCheckpoint';
import AttendanceRingChart from '@/components/ui/AttendanceRingChart';
import GroupHierarchySelector from '@/components/ui/GroupHierarchySelector';
import { computeStudentAnalytics } from '@/lib/studentAnalytics';
import { useToast } from '@/components/ui/Toast';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { getCached, setCached, isCacheFresh, invalidateByPrefix } from '@/lib/cache';
import { emitPaymentsChanged } from '@/lib/eventBus';
import type { Group, ArchiveRun, CarriedOverBalance } from '@/lib/types';

type ArchiveStatus = 'open' | 'archived' | 'pending';

type ArchiveRow = {
  id: string;
  archive_month: string;
  archive_data: Record<string, unknown> | null;
  status: ArchiveStatus;
  is_locked: boolean;
  archived_at: string | null;
  record_counts: Record<string, number> | null;
  created_at: string;
  updated_at: string;
};

type ArchiveCacheData = {
  archives: ArchiveRow[];
  runs: ArchiveRun[];
  carried: CarriedOverBalance[];
  exams: ArchivedExam[];
  studentMap: Map<string, { name: string; phone: string | null; parent_phone: string | null; parent_token: string | null; is_deleted: boolean }>;
};

const ARCHIVE_CACHE_VERSION = 'v4';

type ArchivedStudent = {
  id: string;
  name: string;
  phone?: string | null;
  parent_phone?: string | null;
  group_id?: string | null;
  total_fees?: number | null;
  paid_fees?: number | null;
  is_exempt?: boolean | null;
  parent_token?: string | null;
  is_deleted?: boolean | null;
};

type ArchivedPayment = {
  id: string;
  student_id: string;
  amount: number;
  payment_date: string;
  note?: string | null;
  receipt_number?: string | null;
};

type ArchivedGrade = {
  id: string;
  student_id: string;
  score: number;
  center_exam_id?: string;
};

type ArchivedExam = {
  id: string;
  title: string;
  max_score: number;
  pass_score: number;
  category?: string;
  group_id?: string | null;
};

type ArchivedAttendance = {
  id: string;
  student_id: string;
  status: string;
  attendance_date: string;
  session_id?: string | null;
};

type ArchivedHomework = {
  id: string;
  student_id: string;
  status: string;
  title?: string;
  homework_id?: string;
  teacher_note?: string | null;
  recorded_at?: string;
};

type ArchivedHomeworkDefinition = {
  id: string;
  title: string;
  group_id?: string | null;
  due_date?: string;
  created_at?: string;
};

type ArchivedBehaviorFull = {
  id: string;
  student_id: string;
  rating?: string;
  note?: string;
  eval_date?: string;
  scope?: string;
  group_id?: string | null;
};

type ArchivedBehavior = ArchivedBehaviorFull;

const AR_MONTHS: Record<string, string> = {
  '01': 'يناير', '02': 'فبراير', '03': 'مارس', '04': 'أبريل',
  '05': 'مايو', '06': 'يونيو', '07': 'يوليو', '08': 'أغسطس',
  '09': 'سبتمبر', '10': 'أكتوبر', '11': 'نوفمبر', '12': 'ديسمبر',
};

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  return `${AR_MONTHS[m] ?? m} ${y}`;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function buildPaymentReminderLink(s: ArchivedStudent, row: ArchiveRow, paidTotal: number, remaining: number): string {
  const phone = normalizePhoneForWhatsApp(s.parent_phone ?? s.phone ?? '');
  if (!phone) return '';
  const monthLabel = formatMonthLabel(row.archive_month);
  const totalFees = s.total_fees ?? 0;
  const message =
    `السلام عليكم ورحمة الله وبركاته 🌷\n` +
    `ولي الأمر الكريم،\n` +
    `نود تذكير حضرتكم بالمصروفات الشهرية الخاصة بالطالب/ة ${s.name} عن شهر ${monthLabel}.\n` +
    `💰 المطلوب: ${formatCurrency(totalFees)} ج.م\n` +
    `💳 المدفوع: ${formatCurrency(paidTotal)} ج.م\n` +
    `📌 المتبقي: ${formatCurrency(remaining)} ج.م\n` +
    `شكرًا لثقتكم ودعمكم الدائم 🤍\n` +
    `وبإذن الله دايمًا نشوف أولادنا في أفضل صورة، ونجاحهم يفرّح قلوبكم قبل قلوبنا 🌟\n` +
    `تيم مستر عمرو خالد`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function buildParentPortalLink(s: ArchivedStudent, row: ArchiveRow, paidTotal?: number, remaining?: number): string {
  const phone = normalizePhoneForWhatsApp(s.parent_phone ?? s.phone ?? '');
  if (!phone) return '';
  const monthLabel = formatMonthLabel(row.archive_month);
  const baseUrl = window.location.origin;
  const portalLink = s.parent_token ? `${baseUrl}/parent-portal?token=${encodeURIComponent(s.parent_token)}&month=${row.archive_month}` : '';
  const totalFees = s.total_fees ?? 0;
  const hasBalance = !s.is_exempt && remaining != null && remaining > 0;
  const reminderLine = hasBalance
    ? `\n💰 إجمالي المصروفات: ${formatCurrency(totalFees)} ج.م\n🟩 المدفوع: ${formatCurrency(paidTotal ?? 0)} ج.م\n🤍 المتبقي: ${formatCurrency(remaining)} ج.م\nنكون ممتنين لسرعة السداد، وشكراً لتعاونكم 🌷\n`
    : '';
  const portalLine = portalLink
    ? `يمكنكم الاطلاع بكل تفصيل على (المستوى الأكاديمي، الحضور، الواجبات، والسلوك) من خلال الرابط المباشر الآمن التالي:\n${portalLink}\n`
    : `للاطلاع على المستوى الأكاديمي والحضور والواجبات، برجاء التواصل مع إدارة السنتر لاستلام رابط المتابعة الخاص بابنكم/ابنتكم.\n`;
  const message =
    `🌸 أهلاً بحضرتك يا فندم،\n` +
    `يسعدنا دائماً تذكيركم بمستوى ومتابعة ابننا/ابنتنا (${s.name}) خلال شهر (${monthLabel}) عبر منصة الخالد التعليمية.\n` +
    portalLine +
    reminderLine +
    `✨📚 مع تمنياتنا دوماً بالتوفيق والتميز.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function previousMonthKey(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const RANK_LABELS = ['المركز الأول', 'المركز الثاني', 'المركز الثالث', 'المركز الرابع', 'المركز الخامس'];
const RANK_STYLES = [
  'bg-amber-500/20 border-amber-400/40 text-amber-300',
  'bg-slate-300/15 border-slate-200/30 text-slate-200',
  'bg-orange-600/20 border-orange-500/40 text-orange-300',
  'bg-sky-500/15 border-sky-400/30 text-sky-300',
  'bg-teal-500/15 border-teal-400/30 text-teal-300',
];

function computeGroupRankings(row: ArchiveRow): Map<string, { rank: number; totalScore: number; examCount: number }> {
  const students = getArchivedStudentsStatic(row);
  const grades = getArchivedGradesStatic(row);
  const exams = getArchivedExamsStatic(row);
  const byGroup = new Map<string, { studentId: string; totalScore: number; examCount: number }[]>();

  for (const s of students) {
    if (!s.group_id) continue;
    const studentGrades = grades
      .filter((g) => g.student_id === s.id)
      .map((g) => {
        const exam = exams.find((e) => e.id === g.center_exam_id);
        return exam ? { score: g.score, maxScore: exam.max_score ?? 0 } : null;
      })
      .filter((x): x is { score: number; maxScore: number } => x !== null);

    if (studentGrades.length === 0) continue;
    const totalScore = studentGrades.reduce((sum, g) => sum + (g.maxScore > 0 ? (g.score / g.maxScore) * 100 : 0), 0);
    const entry = { studentId: s.id, totalScore, examCount: studentGrades.length };
    if (!byGroup.has(s.group_id)) byGroup.set(s.group_id, []);
    byGroup.get(s.group_id)!.push(entry);
  }

  const result = new Map<string, { rank: number; totalScore: number; examCount: number }>();
  for (const [, entries] of byGroup) {
    entries.sort((a, b) => b.totalScore - a.totalScore);
    let currentRank = 1;
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && entries[i].totalScore !== entries[i - 1].totalScore) {
        currentRank = i + 1;
      }
      result.set(entries[i].studentId, { rank: currentRank, totalScore: entries[i].totalScore, examCount: entries[i].examCount });
    }
  }
  return result;
}

function getArchivedStudentsStatic(row: ArchiveRow): ArchivedStudent[] {
  if (!row.archive_data?.students || !Array.isArray(row.archive_data.students)) return [];
  return (row.archive_data.students as ArchivedStudent[]).filter((s) => s && s.id);
}
function getArchivedExamsStatic(row: ArchiveRow): ArchivedExam[] {
  return (row.archive_data?.center_exams && Array.isArray(row.archive_data.center_exams)
    ? (row.archive_data.center_exams as ArchivedExam[]).filter((e) => e && e.id)
    : []);
}

function getArchivedGradesStatic(row: ArchiveRow): ArchivedGrade[] {
  if (!row.archive_data?.center_grades || !Array.isArray(row.archive_data.center_grades)) return [];
  return (row.archive_data.center_grades as ArchivedGrade[]).filter((g) => g && g.id);
}

function RankBadge({ rank }: { rank: number }) {
  if (rank < 1 || rank > 5) return null;
  const style = RANK_STYLES[rank - 1];
  const label = RANK_LABELS[rank - 1];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full border ${style}`}>
      <Award size={11} /> {label}
    </span>
  );
}

const STATUS_META: Record<ArchiveStatus, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  archived: { label: 'مؤرشف', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  open: { label: 'مفتوح', color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/20', icon: Clock },
  pending: { label: 'لم يُؤرشف بعد', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: AlertTriangle },
};

const inputCls = 'w-full glass-light rounded-xl py-2.5 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm';

export default function ArchiveOverview({
  allGroups,
}: {
  allGroups: Group[];
}) {
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const { isMaster, assistant, can } = useAuth();
  const canEditAcademic = isMaster || can('can_edit_grades');
  const canEditExams = isMaster || can('can_manage_exams');
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [archives, setArchives] = useState<ArchiveRow[]>([]);
  const archivesReqIdRef = useRef(0);
  const [archiveRuns, setArchiveRuns] = useState<ArchiveRun[]>([]);
  const [carriedBalances, setCarriedBalances] = useState<CarriedOverBalance[]>([]);
  const [liveStudentMap, setLiveStudentMap] = useState<Map<string, { name: string; phone: string | null; parent_phone: string | null; parent_token: string | null; is_deleted: boolean }>>(new Map());
  const [loading, setLoading] = useState(true);
  const ARCHIVE_CACHE_KEY = `archive_overview_full_${ARCHIVE_CACHE_VERSION}`;
  const ARCHIVE_CACHE_TTL = 120_000;

  useEffect(() => {
    // Do NOT invalidate cache on mount — this destroys the SWR cache that
    // loadArchives relies on for instant display. loadArchives already
    // validates freshness via isCacheFresh().
  }, []);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [lockTarget, setLockTarget] = useState<ArchiveRow | null>(null);
  const [pinPromptOpen, setPinPromptOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pendingAction, setPendingAction] = useState<'lock' | 'unlock' | 'archive' | 'historical_payment' | 'rollback' | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ArchiveRow | null>(null);

  const [archiveMessage, setArchiveMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [validationIssues, setValidationIssues] = useState<PreArchiveIssue[] | null>(null);
  const [validating, setValidating] = useState(false);
  useEffect(() => {
    if (!validating) return;
    const t = setTimeout(() => setValidating(false), 8000);
    return () => clearTimeout(t);
  }, [validating]);
  const [pendingArchiveMonth, setPendingArchiveMonth] = useState<string | null>(null);
  const [reviewingRowId, setReviewingRowId] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [payTargetStudent, setPayTargetStudent] = useState<ArchivedStudent | null>(null);
  const [historicalAmount, setHistoricalAmount] = useState('');
  const [historicalNote, setHistoricalNote] = useState('');
  const [historicalMonth, setHistoricalMonth] = useState<string | null>(null);

  const [historicalOpen, setHistoricalOpen] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [archiveTrashTarget, setArchiveTrashTarget] = useState<ArchivedStudent | null>(null);
  const [detailStudent, setDetailStudent] = useState<{ student: ArchivedStudent; row: ArchiveRow } | null>(null);
  const [gradeLedgerRowId, setGradeLedgerRowId] = useState<string | null>(null);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [editMaxScore, setEditMaxScore] = useState('');
  const [editPassScore, setEditPassScore] = useState('');
  const [editingGradeId, setEditingGradeId] = useState<string | null>(null);
  const [editScore, setEditScore] = useState('');

  const [editingDetailGradeId, setEditingDetailGradeId] = useState<string | null>(null);
  const [editDetailScore, setEditDetailScore] = useState('');
 const [editingDetailExamId, setEditingDetailExamId] = useState<string | null>(null);
  const [editDetailMax, setEditDetailMax] = useState('');
  const [editDetailPass, setEditDetailPass] = useState('');
  const [addingGradeExamId, setAddingGradeExamId] = useState<string | null>(null);
  const [newGradeScore, setNewGradeScore] = useState('');
  const [editingHwId, setEditingHwId] = useState<string | null>(null);
  const [editHwStatus, setEditHwStatus] = useState('');
  const [addingHwOpen, setAddingHwOpen] = useState(false);
  const [newHwTitle, setNewHwTitle] = useState('');
  const [newHwStatus, setNewHwStatus] = useState('done');
  const [editingBehaviorId, setEditingBehaviorId] = useState<string | null>(null);
  const [editBehaviorRating, setEditBehaviorRating] = useState('');
  const [editBehaviorNote, setEditBehaviorNote] = useState('');
  const [addingBehaviorOpen, setAddingBehaviorOpen] = useState(false);
  const [newBehaviorRating, setNewBehaviorRating] = useState('excellent');
  const [newBehaviorNote, setNewBehaviorNote] = useState('');
  const [addingAssessmentOpen, setAddingAssessmentOpen] = useState(false);
  const [newAssessmentName, setNewAssessmentName] = useState('');
  const [newAssessmentCategory, setNewAssessmentCategory] = useState<'exam' | 'sheet' | 'recitation' | 'behavior'>('exam');
  const [newAssessmentMax, setNewAssessmentMax] = useState('');
  const [newAssessmentPass, setNewAssessmentPass] = useState('');
  const [newAssessmentScore, setNewAssessmentScore] = useState('');
  const [liveExams, setLiveExams] = useState<ArchivedExam[]>([]);
  const [archiveReceipt, setArchiveReceipt] = useState<{
    receiptNumber: string;
    studentName: string;
    amount: number;
    date: string;
    month: string;
    note: string | null;
    recordedBy: string;
    groupName?: string;
    gradeName?: string;
    stageName?: string;
    baseSubscription?: number;
    totalPaidAfter?: number;
    remainingAfter?: number;
    paymentId?: string;
    studentId?: string;
    parentPhone?: string | null;
    studentPhone?: string | null;
  } | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'grade' | 'exam' | 'hw' | 'behavior' | 'attendance'; id: string; row: ArchiveRow; label?: string } | null>(null);
  const [editingAttendanceId, setEditingAttendanceId] = useState<string | null>(null);
  const [editAttendanceStatus, setEditAttendanceStatus] = useState('');
  const [studentListModal, setStudentListModal] = useState<{
    row: ArchiveRow;
    kind: 'paid' | 'unpaid';
    students: ArchivedStudent[];
  } | null>(null);
  const [modalStudentSearch, setModalStudentSearch] = useState('');
  const [modalStageFilter, setModalStageFilter] = useState<string>('all');
  const [modalGradeFilter, setModalGradeFilter] = useState<string>('all');
  const [inlineEditStudentId, setInlineEditStudentId] = useState<string | null>(null);
  const [inlineEditFees, setInlineEditFees] = useState('');
  const [inlineEditPaid, setInlineEditPaid] = useState('');
  const [inlineEditExempt, setInlineEditExempt] = useState(false);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [archiveEditTarget, setArchiveEditTarget] = useState<{ student: ArchivedStudent; row: ArchiveRow } | null>(null);
  const [archiveEditPayments, setArchiveEditPayments] = useState<{ id: string; amount: string; payment_date: string; month_key: string }[]>([]);
  const [archiveEditSaving, setArchiveEditSaving] = useState(false);
  const [honorBoardOpen, setHonorBoardOpen] = useState(false);
  const [historicalSubmitting, setHistoricalSubmitting] = useState(false);
  const [reminderTarget, setReminderTarget] = useState<{ student: ArchivedStudent; monthLabel: string; remaining: number } | null>(null);
  const [reminderMessage, setReminderMessage] = useState('');
  const whatsappSentRef = useRef<Set<string>>(new Set());

  function startArchiveEdit(student: ArchivedStudent, row: ArchiveRow) {
    const studentPayments = getPaymentsForStudent(row, student.id);
    setArchiveEditTarget({ student, row });
    setArchiveEditPayments(studentPayments.map((p) => ({
      id: p.id,
      amount: String(p.amount),
      payment_date: p.payment_date,
      month_key: row.archive_month,
    })));
  }

  function cancelArchiveEdit() {
    setArchiveEditTarget(null);
    setArchiveEditPayments([]);
  }

  async function saveArchiveEdit() {
    if (!archiveEditTarget || archiveEditSaving) return;
    const { student, row } = archiveEditTarget;
    setArchiveEditSaving(true);
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const allPayments = (newData.payments as ArchivedPayment[] | undefined) ?? [];
    const updatedPayments = allPayments.map((p) => {
      const edit = archiveEditPayments.find((e) => e.id === p.id);
      if (!edit) return p;
      return { ...p, amount: parseFloat(edit.amount) || 0, payment_date: edit.payment_date };
    });
    newData.payments = updatedPayments;
    const studentPayments = updatedPayments.filter((p) => p.student_id === student.id);
    const newPaidFees = studentPayments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const students = (newData.students as ArchivedStudent[] | undefined) ?? [];
    newData.students = students.map((st) =>
      st.id === student.id ? { ...st, paid_fees: newPaidFees } : st
    );
    // Optimistic: update UI immediately, close modal, show success
    patchArchiveRow(row.id, newData);
    invalidateByPrefix('archive_');
    setArchiveEditSaving(false);
    cancelArchiveEdit();
    showToast('تم تعديل بيانات الدفع بنجاح', 'success');

    // Background sync to server — silent, no error shown to user
    void (async () => {
      try {
        await supabase.from('monthly_archives').update({ archive_data: newData }).eq('id', row.id);
      } catch { /* will be retried by realtime sync */ }
      for (const ep of archiveEditPayments) {
        try {
          const { data: existing } = await supabase.from('payments').select('id').eq('id', ep.id).maybeSingle();
          if (existing) {
            const updatePayload: Record<string, unknown> = {
              amount: parseFloat(ep.amount) || 0,
              payment_date: ep.payment_date,
            };
            if (ep.month_key !== row.archive_month) {
              updatePayload.month_key = ep.month_key;
            }
            await supabase.from('payments').update(updatePayload).eq('id', ep.id);
          }
        } catch { /* payment may not exist in live table */ }
      }
      void loadArchives({ silent: true });
    })();
  }

  function patchArchiveRow(rowId: string, newData: Record<string, unknown>) {
    setArchives((prev) => prev.map((r) => r.id === rowId ? { ...r, archive_data: newData } : r));
    if (detailStudent && detailStudent.row.id === rowId) {
      setDetailStudent((prev) => prev ? { ...prev, row: { ...prev.row, archive_data: newData } } : prev);
    }
    if (studentListModal && studentListModal.row.id === rowId) {
      setStudentListModal((prev) => prev ? { ...prev, row: { ...prev.row, archive_data: newData } } : prev);
    }
  }

  async function updateArchiveData(rowId: string, newData: Record<string, unknown>): Promise<boolean> {
    // Fire-and-forget: UI already updated optimistically via patchArchiveRow.
    // Server write happens in background — no error shown to user on transient failure.
    invalidateByPrefix('archive_');
    try {
      const { error } = await supabase.from('monthly_archives').update({ archive_data: newData }).eq('id', rowId);
      if (error) {
        // Non-transient error (e.g. RLS denial) — still don't block the user
        console.warn('Archive save failed:', error.message);
        return false;
      }
      return true;
    } catch {
      // Network error — realtime sync will reconcile when connection restores
      return false;
    }
  }

  function generateFallbackUUID(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    const rand2 = Math.random().toString(36).slice(2, 10);
    return `${ts}-${rand}-${rand2}`;
  }

  function startInlineEdit(student: ArchivedStudent) {
    setInlineEditStudentId(student.id);
    setInlineEditFees(String(student.total_fees ?? 0));
    setInlineEditPaid(String(student.paid_fees ?? 0));
    setInlineEditExempt(student.is_exempt ?? false);
  }

  function cancelInlineEdit() {
    setInlineEditStudentId(null);
    setInlineEditFees('');
    setInlineEditPaid('');
    setInlineEditExempt(false);
  }

  async function autoSaveInlineEdit(row: ArchiveRow, student: ArchivedStudent) {
    const newFees = parseFloat(inlineEditFees);
    const newPaid = parseFloat(inlineEditPaid);
    if (isNaN(newFees) || newFees < 0) return;
    if (isNaN(newPaid) || newPaid < 0) return;
    const origFees = student.total_fees ?? 0;
    const origPaid = student.paid_fees ?? 0;
    const origExempt = student.is_exempt ?? false;
    if (newFees === origFees && newPaid === origPaid && inlineEditExempt === origExempt) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const students = (newData.students as ArchivedStudent[] | undefined) ?? [];
    newData.students = students.map((st) =>
      st.id === student.id
        ? { ...st, total_fees: newFees, paid_fees: newPaid, is_exempt: inlineEditExempt }
        : st
    );
    patchArchiveRow(row.id, newData);
    invalidateByPrefix('archive_');
    setInlineSaving(false);
    setInlineEditStudentId(null);
    showToast('تم الحفظ', 'success');
    // Background sync — no error shown to user
    void updateArchiveData(row.id, newData);
    void syncStudentArchiveToLiveTables(row, student.id);
  }

  async function syncStudentArchiveToLiveTables(row: ArchiveRow, studentId: string): Promise<boolean> {
    const data = row.archive_data ?? {};
    const grades = ((data.center_grades ?? []) as ArchivedGrade[]).filter((g) => g.student_id === studentId);
    const behavior = ((data.behavior_eval ?? []) as ArchivedBehaviorFull[]).filter((b) => b.student_id === studentId);
    const hwStatus = ((data.homework_status ?? []) as ArchivedHomework[]).filter((h) => h.student_id === studentId);
    const exams = (data.center_exams ?? []) as ArchivedExam[];
    const hwDefs = (data.homework ?? []) as ArchivedHomeworkDefinition[];
    const errors: string[] = [];

    // Only UPDATE existing live records — never INSERT new rows.
    // Inserting archive records into live tables would contaminate the
    // current active month with past-month data. If a record no longer
    // exists in the live table (e.g. it was archived and removed), the
    // archive JSON is the sole source of truth and we leave it alone.
    // Payments are intentionally excluded — historical payments are
    // handled exclusively by createHistoricalPayment which correctly
    // sets month_key to the archive month and never touches
    // students.paid_fees, preventing any cross-month financial leak.

    const gradeOps = grades.map(async (g) => {
      const { data: ex } = await supabase.from('center_grades').select('id').eq('id', g.id).maybeSingle();
      if (!ex) return;
      const res = await supabase.from('center_grades').update({ score: g.score }).eq('id', g.id);
      if (res.error) errors.push(`grade ${g.id}: ${res.error.message}`);
    });

    const behaviorOps = behavior.filter((b) => b.id).map(async (b) => {
      const { data: ex } = await supabase.from('behavior_eval').select('id').eq('id', b.id).maybeSingle();
      if (!ex) return;
      const res = await supabase.from('behavior_eval')
        .update({ rating: b.rating ?? 'quiet', note: b.note ?? null, eval_date: b.eval_date ?? row.archive_month + '-15', scope: b.scope ?? 'monthly' })
        .eq('id', b.id);
      if (res.error) errors.push(`behavior ${b.id}: ${res.error.message}`);
    });

    const statusMap: Record<string, string> = { done: 'complete', complete: 'complete', incomplete: 'incomplete', late: 'late' };
    const hwOps = hwStatus.filter((h) => h.id).map(async (h) => {
      const homeworkId = h.homework_id ?? hwDefs.find((d) => d.title === h.title)?.id;
      if (!homeworkId) return;
      const { data: ex } = await supabase.from('homework_status').select('id').eq('id', h.id).maybeSingle();
      if (!ex) return;
      const res = await supabase.from('homework_status')
        .update({ status: statusMap[h.status] ?? h.status, teacher_note: h.teacher_note ?? null })
        .eq('id', h.id);
      if (res.error) errors.push(`hw ${h.id}: ${res.error.message}`);
    });

    const examOps = exams.filter((e) => e.id).map(async (e) => {
      const { data: ex } = await supabase.from('center_exams').select('id').eq('id', e.id).maybeSingle();
      if (!ex) return;
      const res = await supabase.from('center_exams')
        .update({ max_score: e.max_score, pass_score: e.pass_score, title: e.title, category: e.category ?? 'exam' })
        .eq('id', e.id);
      if (res.error) errors.push(`exam ${e.id}: ${res.error.message}`);
    });

    await Promise.all([...gradeOps, ...behaviorOps, ...hwOps, ...examOps]);

    if (errors.length > 0) {
      console.warn('Live table sync partial errors:', errors);
      setArchiveMessage({ type: 'error', text: `تم الحفظ في الأرشيف ولكن بعض البيانات لم تُزامن للجداول الحية: ${errors.slice(0, 2).join('; ')}` });
      return false;
    }
    return true;
  }

  const loadArchives = useCallback(async (opts?: { silent?: boolean }) => {
    const reqId = ++archivesReqIdRef.current;

    // SWR: if we have cached data, show it immediately and skip loading spinner
    const cached = getCached<ArchiveCacheData>(ARCHIVE_CACHE_KEY);
    const hasCached = cached !== null && Array.isArray(cached.archives) && cached.archives.length > 0;
    if (hasCached) {
      setArchives(cached.archives);
      setArchiveRuns(cached.runs);
      setCarriedBalances(cached.carried);
      setLiveExams(cached.exams);
      setLiveStudentMap(cached.studentMap instanceof Map ? cached.studentMap : new Map());
      if (!opts?.silent) setLoading(false);
    }

    // If cache is fresh and this is a non-silent load, skip network entirely
    if (hasCached && isCacheFresh(ARCHIVE_CACHE_KEY) && !opts?.silent) return;

    // Otherwise fetch from network
    if (!hasCached && !opts?.silent) setLoading(true);
    try {
      const [archRes, runsRes, carriedRes, examsRes, studentsRes] = await Promise.all([
        supabase.from('monthly_archives').select('*').order('archive_month', { ascending: false }),
        supabase.from('archive_runs').select('*').order('archive_month', { ascending: false }).limit(10),
        supabase.from('carried_over_balances').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('center_exams').select('id, title, max_score, pass_score, category, group_id'),
        supabase.from('students').select('id, name, phone, parent_phone, parent_token, is_deleted'),
      ]);
      if (reqId !== archivesReqIdRef.current) return;
      if (archRes.data) {
        const validArchives = (archRes.data as ArchiveRow[]).map((r) => ({
          ...r,
          archive_data: r.archive_data ?? {},
          record_counts: r.record_counts ?? {},
        }));
        setArchives(validArchives);
      }
      if (runsRes.data) setArchiveRuns(runsRes.data as ArchiveRun[]);
      if (carriedRes.data) setCarriedBalances(carriedRes.data as CarriedOverBalance[]);
      if (examsRes.data) setLiveExams(examsRes.data as ArchivedExam[]);
      if (studentsRes.data) {
        const map = new Map<string, { name: string; phone: string | null; parent_phone: string | null; parent_token: string | null; is_deleted: boolean }>();
        for (const s of studentsRes.data as { id: string; name: string; phone: string | null; parent_phone: string | null; parent_token: string | null; is_deleted: boolean }[]) {
          map.set(s.id, { name: s.name, phone: s.phone, parent_phone: s.parent_phone, parent_token: s.parent_token, is_deleted: s.is_deleted ?? false });
        }
        setLiveStudentMap(map);
      }
      // Persist to cache — only if we got real data back
      if (archRes.data && archRes.data.length > 0) {
        const studentMap = new Map<string, { name: string; phone: string | null; parent_phone: string | null; parent_token: string | null; is_deleted: boolean }>();
        if (studentsRes.data) {
          for (const s of studentsRes.data as { id: string; name: string; phone: string | null; parent_phone: string | null; parent_token: string | null; is_deleted: boolean }[]) {
            studentMap.set(s.id, { name: s.name, phone: s.phone, parent_phone: s.parent_phone, parent_token: s.parent_token, is_deleted: s.is_deleted ?? false });
          }
        }
        const archivesForCache = (archRes.data as ArchiveRow[]).map((r) => ({
          ...r,
          archive_data: r.archive_data ?? {},
          record_counts: r.record_counts ?? {},
        }));
        setCached(ARCHIVE_CACHE_KEY, {
          archives: archivesForCache,
          runs: (runsRes.data ?? []) as ArchiveRun[],
          carried: (carriedRes.data ?? []) as CarriedOverBalance[],
          exams: (examsRes.data ?? []) as ArchivedExam[],
          studentMap,
        }, ARCHIVE_CACHE_TTL);
      }
    } catch {
      /* keep existing/cached data on error */
    } finally {
      if (reqId === archivesReqIdRef.current && !opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadArchives();
    let debounced: ReturnType<typeof setTimeout> | null = null;
    const handleChanges = () => {
      if (debounced) clearTimeout(debounced);
      debounced = setTimeout(() => { void loadArchives({ silent: true }); }, 800);
    };
    const channel = supabase
      .channel('archive-overview-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_archives' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'center_grades' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'center_exams' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework_status' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'behavior_eval' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'archive_runs' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carried_over_balances' }, handleChanges)
      .subscribe();
    return () => { if (debounced) clearTimeout(debounced); void supabase.removeChannel(channel); };
  }, [loadArchives]);

  // Keep detailStudent and studentListModal in sync with realtime archive updates
  useEffect(() => {
    if (detailStudent) {
      const freshRow = archives.find((r) => r.id === detailStudent.row.id);
      if (freshRow && freshRow !== detailStudent.row) {
        const freshStudent = getArchivedStudents(freshRow).find((s) => s.id === detailStudent.student.id);
        if (freshStudent) {
          setDetailStudent({ student: freshStudent, row: freshRow });
        }
      }
    }
    if (studentListModal) {
      const freshRow = archives.find((r) => r.id === studentListModal.row.id);
      if (freshRow && freshRow !== studentListModal.row) {
        const allStudents = getArchivedStudents(freshRow);
        const filtered = selectedGroup ? allStudents.filter((s) => s.group_id === selectedGroup.id) : allStudents;
        const freshStudents = studentListModal.kind === 'paid'
          ? filtered.filter((s) => isStudentPaid(freshRow, s))
          : filtered.filter((s) => !s.is_deleted && !isStudentPaid(freshRow, s) && !s.is_exempt && (s.total_fees ?? 0) > 0);
        setStudentListModal({ ...studentListModal, row: freshRow, students: freshStudents });
      }
    }
  }, [archives, selectedGroup]);

  const curMonth = currentMonthKey();
  const prevMonth = previousMonthKey();
  const hasCurrent = archives.some((a) => a.archive_month === curMonth);
  const hasPrev = archives.some((a) => a.archive_month === prevMonth);

  async function createArchiveNow(monthKey: string) {
    setArchiveMessage(null);
    setValidating(true);
    setPendingArchiveMonth(monthKey);
    try {
      const validationResult = await preArchiveValidation();
      if (!validationResult.ok) {
        setValidationIssues(validationResult.issues);
        setValidating(false);
        return;
      }
      setValidating(false);
      await executeArchive(monthKey);
    } catch {
      setValidating(false);
      setArchiveMessage({ type: 'error', text: 'تعذّر التحقق من البيانات قبل الأرشفة. تأكد من الاتصال وحاول مجدداً.' });
    }
  }

  async function executeArchive(monthKey: string) {
    setArchiveMessage(null);
    try {
      const result = await triggerAutoArchive();
      if (result.success) {
        if (result.skipped) {
          setArchiveMessage({ type: 'info', text: `تمت أرشفة شهر ${formatMonthLabel(result.month ?? monthKey)} مسبقاً — لا حاجة للتكرار.` });
        } else {
          setArchiveMessage({ type: 'success', text: `تمت أرشفة شهر ${formatMonthLabel(result.month ?? monthKey)} بنجاح.` });
        }
        invalidateByPrefix('archive_');
        loadArchives();
      } else {
        setArchiveMessage({ type: 'error', text: `تعذّرت الأرشفة التلقائية: ${result.error ?? 'خطأ غير معروف'}. يمكن إعادة المحاولة.` });
      }
    } catch (err) {
      setArchiveMessage({ type: 'error', text: 'حدث خطأ أثناء الاتصال بخدمة الأرشفة.' });
      console.error('Archive trigger failed:', err);
    }
  }

  async function proceedArchiveDespiteWarnings() {
    setValidationIssues(null);
    if (pendingArchiveMonth) {
      await executeArchive(pendingArchiveMonth);
    }
  }

  async function handleRollback() {
    if (!rollbackTarget) return;
    setArchiveMessage(null);
    try {
      const result = await rollbackArchive(rollbackTarget.archive_month);
      if (result.success) {
        setArchiveMessage({
          type: 'success',
          text: `تم إلغاء أرشفة شهر ${formatMonthLabel(rollbackTarget.archive_month)} بنجاح — تمت استعادة ${result.restored_students ?? 0} طالب وحذف ${result.deleted_carried_balances ?? 0} ترحيل. الشهر أصبح نشطاً مرة أخرى.`,
        });
        setRollbackTarget(null);
        invalidateByPrefix('archive_');
        loadArchives();
      } else {
        setArchiveMessage({ type: 'error', text: `تعذّر إلغاء الأرشفة: ${result.error ?? 'خطأ غير معروف'}` });
      }
    } catch {
      setArchiveMessage({ type: 'error', text: 'حدث خطأ أثناء محاولة إلغاء الأرشفة.' });
    }
  }

  function requestLockToggle(row: ArchiveRow, action: 'lock' | 'unlock') {
    setLockTarget(row);
    setPendingAction(action);
    setPinPromptOpen(true);
  }

  function requestArchive(row: ArchiveRow) {
    setLockTarget(row);
    setPendingAction('archive');
    setPinPromptOpen(true);
  }

  async function confirmPinAction() {
    if (!lockTarget || !pendingAction) return;
    if (pinInput !== settings.master_pin) {
      setPinError('الرقم السري غير صحيح');
      return;
    }
    setPinError('');

    if (pendingAction === 'lock') {
      const { error: lockErr } = await supabase.from('monthly_archives').update({ is_locked: true }).eq('id', lockTarget.id);
      if (lockErr) { setArchiveMessage({ type: 'error', text: `تعذّر القفل: ${lockErr.message}` }); return; }
    } else if (pendingAction === 'unlock') {
      const { error: unlockErr } = await supabase.from('monthly_archives').update({ is_locked: false }).eq('id', lockTarget.id);
      if (unlockErr) { setArchiveMessage({ type: 'error', text: `تعذّر فتح القفل: ${unlockErr.message}` }); return; }
    } else if (pendingAction === 'archive') {
      await createArchiveNow(lockTarget.archive_month);
    }

    setPinPromptOpen(false);
    setPinInput('');
    setPinError('');
    setLockTarget(null);
    setPendingAction(null);
    invalidateByPrefix('archive_');
    loadArchives();
  }

  function openHistoricalPayment(student: ArchivedStudent, monthKey: string) {
    setPayTargetStudent(student);
    setHistoricalMonth(monthKey);
    setHistoricalAmount('');
    setHistoricalNote('');
    setHistoricalOpen(true);
  }

  async function handleHistoricalPayment() {
    if (!payTargetStudent || !historicalMonth || !historicalAmount) return;
    if (historicalSubmitting) return;
    const amount = parseFloat(historicalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setArchiveMessage({ type: 'error', text: 'برجاء إدخال مبلغ صحيح أكبر من صفر.' });
      return;
    }
    if (amount > (payTargetStudent.total_fees ?? 0) && (payTargetStudent.total_fees ?? 0) > 0) {
      setArchiveMessage({ type: 'error', text: `المبلغ المدخل (${formatCurrency(amount)} ج.م) أكبر من الاشتراك الأساسي (${formatCurrency(payTargetStudent.total_fees ?? 0)} ج.م).` });
      return;
    }
    const actorName = isMaster ? 'المدرس' : (assistant?.display_name || assistant?.username || 'مساعد');
    setHistoricalSubmitting(true);
    setHistoricalOpen(false);
    const targetStudent = payTargetStudent;
    const targetMonth = historicalMonth;
    const targetNote = historicalNote.trim() || null;
    try {
      const result = await createHistoricalPayment(
        targetStudent.id,
        amount,
        targetMonth,
        targetNote,
        actorName
      );
      if (result) {
        const group = allGroups.find((g) => g.id === targetStudent.group_id);
        const baseSub = targetStudent.total_fees ?? 0;
        const totalPaidAfter = (targetStudent.paid_fees ?? 0) + amount;
        const remainingAfter = Math.max(0, baseSub - totalPaidAfter);
        const paymentId = result.id;
        setArchiveReceipt({
          receiptNumber: result.receipt_number ?? '',
          studentName: targetStudent.name,
          amount,
          date: result.payment_date ?? new Date().toISOString().slice(0, 10),
          month: targetMonth,
          note: targetNote || `دفعة متأخرة لشهر ${formatMonthLabel(targetMonth)}`,
          recordedBy: actorName,
          groupName: group?.name,
          studentId: targetStudent.id,
          baseSubscription: baseSub,
          totalPaidAfter,
          remainingAfter,
          paymentId,
          parentPhone: targetStudent.parent_phone ?? null,
          studentPhone: targetStudent.phone ?? null,
        });
        setPayTargetStudent(null);
        setHistoricalAmount('');
        setHistoricalNote('');
        showToast(`تم تسجيل دفعة متأخرة بقيمة ${formatCurrency(amount)} ج.م للطالب ${targetStudent.name} لشهر ${formatMonthLabel(targetMonth)} — بواسطة ${actorName}`, 'success');
        setArchiveMessage({ type: 'success', text: `تم تسجيل دفعة متأخرة بقيمة ${formatCurrency(amount)} ج.م لشهر ${formatMonthLabel(targetMonth)} بنجاح.` });
        // Surgical update: patch the affected archive row in local state instead of full reload
        setArchives((prev) => prev.map((a) => {
          if (a.archive_month !== targetMonth) return a;
          const newData = JSON.parse(JSON.stringify(a.archive_data)) as Record<string, unknown>;
          const students = (newData.students ?? []) as ArchivedStudent[];
          const stu = students.find((s) => s.id === targetStudent.id);
          if (stu) {
            stu.paid_fees = (stu.paid_fees ?? 0) + amount;
          }
          const payments = (newData.payments ?? []) as unknown[];
          payments.push({ student_id: targetStudent.id, amount, payment_date: result.payment_date ?? new Date().toISOString().slice(0, 10), receipt_number: result.receipt_number ?? '', note: targetNote });
          newData.payments = payments;
          return { ...a, archive_data: newData };
        }));
        // Background silent refresh to sync any server-side changes
        invalidateByPrefix('archive_');
        void loadArchives({ silent: true });
        // Notify FinancesModule and other modules that a payment was recorded
        // so their counters and totals update instantly without a manual refresh.
        emitPaymentsChanged(targetStudent.group_id, targetStudent.id);
      } else {
        console.error('createHistoricalPayment returned null for student', targetStudent.id, 'month', targetMonth, 'amount', amount);
        setArchiveMessage({ type: 'error', text: 'تعذّر تسجيل الدفعة المتأخرة. قد يكون هناك تداخل في البيانات أو تكرار للدفعة. تحقق من سجل المدفوعات وحاول مجدداً.' });
      }
    } catch (err) {
      console.error('Unexpected error in handleHistoricalSubmit:', err);
      setArchiveMessage({ type: 'error', text: 'حدث خطأ غير متوقع أثناء تسجيل الدفعة. تأكد من اتصال الإنترنت وحاول مجدداً.' });
    } finally {
      setHistoricalSubmitting(false);
    }
  }

  function buildArchiveReceiptWhatsAppLink(r: NonNullable<typeof archiveReceipt>): string {
    const phone = normalizePhoneForWhatsApp(r.parentPhone ?? r.studentPhone ?? '');
    const dateStr = new Date(r.date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    const groupLine = r.groupName ? `📚 المجموعة: ${r.groupName}\n` : '';
    const baseSubLine = r.baseSubscription ? `📋 الاشتراك الأساسي: ${formatCurrency(r.baseSubscription)} ج.م\n` : '';
    const totalPaidLine = r.totalPaidAfter !== undefined ? `💵 إجمالي المدفوع: ${formatCurrency(r.totalPaidAfter)} ج.م\n` : '';
    const remainingLine = r.remainingAfter !== undefined ? `📊 المتبقي: ${formatCurrency(r.remainingAfter)} ج.م\n` : (r.baseSubscription ? `📊 المتبقي: ${formatCurrency(Math.max(0, r.baseSubscription - r.amount))} ج.م\n` : '');
    const msg =
      `🧾 *إيصال دفع متأخر — ${settings.platform_name}*\n\n` +
      `👤 الطالب: ${r.studentName}\n` +
      groupLine +
      `📅 الشهر: ${formatMonthLabel(r.month)}\n` +
      baseSubLine +
      `💰 المبلغ المدفوع: ${formatCurrency(r.amount)} ج.م\n` +
      totalPaidLine +
      remainingLine +
      `📅 التاريخ: ${dateStr}\n` +
      `🔢 رقم الإيصال: ${r.receiptNumber}\n` +
      (r.recordedBy ? `✅ استلم بواسطة: ${r.recordedBy}\n` : '') +
      (r.note ? `📝 ملاحظة: ${r.note}\n` : '') +
      `\nشكراً لكم 🌸`;
    return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  }

  const [whatsappConfirm, setWhatsappConfirm] = useState<{
    studentId: string;
    groupId: string | null;
    monthKey: string;
    studentName: string;
    parentPhone: string | null;
    studentPhone: string | null;
    paymentId: string;
    whatsappLink: string;
  } | null>(null);

  function handleConfirmWhatsApp() {
    if (!whatsappConfirm) return;
    if (whatsappSentRef.current.has(whatsappConfirm.paymentId)) {
      setWhatsappConfirm(null);
      return;
    }
    const phone = normalizePhoneForWhatsApp(whatsappConfirm.parentPhone ?? whatsappConfirm.studentPhone ?? '');
    if (!phone) {
      showToast('لا يوجد رقم هاتف مسجل لهذا الطالب — لا يمكن إرسال واتساب', 'error');
      return;
    }
    whatsappSentRef.current.add(whatsappConfirm.paymentId);
    openWhatsAppURL(whatsappConfirm.whatsappLink, showToast);
    setWhatsappConfirm(null);
  }

  function buildArchiveReceiptHTML(r: NonNullable<typeof archiveReceipt>): string {
    const dateStr = new Date(r.date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
    return `<div style="font-family:'Segoe UI',Tahoma,sans-serif;direction:rtl;max-width:420px;margin:0 auto;padding:32px 24px;color:#1e293b">
      <div style="text-align:center;margin-bottom:24px">
        <h1 style="font-size:22px;font-weight:800;color:#0f172a;margin:0">${settings.platform_name}</h1>
        <p style="font-size:12px;color:#64748b;margin:4px 0 0">إيصال دفع متأخر</p>
      </div>
      <div style="border:2px dashed #cbd5e1;border-radius:12px;padding:20px;background:#f8fafc">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">الطالب</span><span style="font-weight:700;font-size:14px">${r.studentName}</span></div>
        ${r.groupName ? `<div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">المجموعة</span><span style="font-weight:600;font-size:13px">${r.groupName}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">الشهر</span><span style="font-weight:600;font-size:13px">${formatMonthLabel(r.month)}</span></div>
        ${r.baseSubscription ? `<div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">الاشتراك الأساسي</span><span style="font-weight:600;font-size:13px">${formatCurrency(r.baseSubscription)} ج.م</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">المبلغ المدفوع</span><span style="font-weight:800;font-size:16px;color:#059669">${formatCurrency(r.amount)} ج.م</span></div>
        ${r.totalPaidAfter !== undefined ? `<div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">إجمالي المدفوع</span><span style="font-weight:600;font-size:13px;color:#059669">${formatCurrency(r.totalPaidAfter)} ج.م</span></div>` : ''}
        ${r.remainingAfter !== undefined ? `<div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">المتبقي</span><span style="font-weight:600;font-size:13px;color:${r.remainingAfter <= 0 ? '#059669' : '#d97706'}">${formatCurrency(r.remainingAfter)} ج.م</span></div>` : (r.baseSubscription ? `<div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">المتبقي</span><span style="font-weight:600;font-size:13px;color:${r.amount >= r.baseSubscription ? '#059669' : '#d97706'}">${formatCurrency(Math.max(0, r.baseSubscription - r.amount))} ج.م</span></div>` : '')}
        <div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">التاريخ</span><span style="font-weight:600;font-size:13px">${dateStr}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">رقم الإيصال</span><span style="font-weight:600;font-size:12px;font-family:monospace">${r.receiptNumber}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">استلم بواسطة</span><span style="font-weight:600;font-size:13px">${r.recordedBy}</span></div>
        ${r.note ? `<div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="color:#64748b;font-size:13px">ملاحظة</span><span style="font-weight:600;font-size:13px">${r.note}</span></div>` : ''}
      </div>
      <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:20px">شكراً لكم 🌸 — ${settings.platform_name}</p>
    </div>`;
  }

  function saveExamEdit(row: ArchiveRow, examId: string, newMax: number, newPass: number) {
    if (row.is_locked || !canEditExams) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    if (!newData.center_exams || !Array.isArray(newData.center_exams)) {
      newData.center_exams = liveExams.map((e) => ({ ...e }));
    }
    const exams = newData.center_exams as ArchivedExam[];
    const exam = exams.find((e) => e.id === examId);
    if (exam) {
      exam.max_score = newMax;
      exam.pass_score = newPass;
    }
    patchArchiveRow(row.id, newData); setEditingExamId(null);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) {
        showToast('تم الحفظ', 'success');
        if (exam && !exam.id.startsWith('arch-exam-')) {
          supabase.from('center_exams').update({ max_score: newMax, pass_score: newPass }).eq('id', examId).then(() => loadArchives({ silent: true }));
        }
      }
    });
  }

  function saveGradeEdit(row: ArchiveRow, gradeId: string, newScore: number) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const grades = (newData.center_grades ?? []) as ArchivedGrade[];
    const grade = grades.find((g) => g.id === gradeId);
    if (grade) {
      grade.score = newScore;
    }
    patchArchiveRow(row.id, newData); setEditingGradeId(null); setEditingDetailGradeId(null);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) {
        showToast('تم الحفظ', 'success');
        const g = grades.find((x) => x.id === gradeId);
        if (g) void syncStudentArchiveToLiveTables({ ...row, archive_data: newData }, g.student_id);
      }
    });
  }

  function saveDetailExamEdit(row: ArchiveRow, examId: string, newMax: number, newPass: number) {
    if (row.is_locked || !canEditExams) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    if (!newData.center_exams || !Array.isArray(newData.center_exams)) {
      newData.center_exams = liveExams.map((e) => ({ ...e }));
    }
    const exams = newData.center_exams as ArchivedExam[];
    const exam = exams.find((e) => e.id === examId);
    if (exam) {
      exam.max_score = newMax;
      exam.pass_score = newPass;
    }
    patchArchiveRow(row.id, newData); setEditingDetailExamId(null);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) {
        showToast('تم الحفظ', 'success');
        if (exam && !exam.id.startsWith('arch-exam-')) {
          supabase.from('center_exams').update({ max_score: newMax, pass_score: newPass }).eq('id', examId).then(() => loadArchives({ silent: true }));
        }
      }
    });
  }

  function addGradeForStudent(row: ArchiveRow, studentId: string, examId: string, score: number) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const grades = (newData.center_grades ?? []) as ArchivedGrade[];
    const newGrade: ArchivedGrade = {
      id: crypto.randomUUID?.() ?? generateFallbackUUID(),
      student_id: studentId,
      score,
      center_exam_id: examId,
    };
    grades.push(newGrade);
    newData.center_grades = grades;
    patchArchiveRow(row.id, newData); setAddingGradeExamId(null); setNewGradeScore('');
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) { showToast('تم الحفظ', 'success'); void syncStudentArchiveToLiveTables({ ...row, archive_data: newData }, studentId); }
    });
  }

  function deleteGradeFromArchive(row: ArchiveRow, gradeId: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const grades = (newData.center_grades ?? []) as ArchivedGrade[];
    const deletedGrade = grades.find((g) => g.id === gradeId);
    newData.center_grades = grades.filter((g) => g.id !== gradeId);
    patchArchiveRow(row.id, newData);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) {
        showToast('تم الحفظ', 'success');
        if (deletedGrade && !deletedGrade.id.startsWith('arch-grade-')) {
          supabase.from('center_grades').delete().eq('id', gradeId).then(() => loadArchives({ silent: true }));
        }
      }
    });
  }

  function deleteExamFromArchive(row: ArchiveRow, examId: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const exams = (newData.center_exams && Array.isArray(newData.center_exams) ? newData.center_exams : []) as ArchivedExam[];
    const deletedExam = exams.find((e) => e.id === examId);
    newData.center_exams = exams.filter((e) => e.id !== examId);
    const grades = (newData.center_grades ?? []) as ArchivedGrade[];
    newData.center_grades = grades.filter((g) => g.center_exam_id !== examId);
    patchArchiveRow(row.id, newData);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) {
        showToast('تم الحفظ', 'success');
        if (deletedExam && !deletedExam.id.startsWith('arch-exam-')) {
          supabase.from('center_grades').delete().eq('center_exam_id', examId).then(() => {
            supabase.from('center_exams').delete().eq('id', examId).then(() => loadArchives({ silent: true }));
          });
        }
      }
    });
  }

  function saveAttendanceEdit(row: ArchiveRow, attendanceId: string, newStatus: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const attendance = (newData.attendance ?? []) as ArchivedAttendance[];
    const rec = attendance.find((a) => a.id === attendanceId);
    if (rec) {
      rec.status = newStatus;
    }
    patchArchiveRow(row.id, newData); setEditingAttendanceId(null);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) {
        showToast('تم حفظ تعديل الحضور', 'success');
        if (rec && !rec.id.startsWith('arch-att-')) {
          supabase.from('attendance').update({ status: newStatus }).eq('id', attendanceId).then(() => loadArchives({ silent: true }));
        }
      }
    });
  }

  function deleteAttendanceFromArchive(row: ArchiveRow, attendanceId: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const attendance = (newData.attendance ?? []) as ArchivedAttendance[];
    const deleted = attendance.find((a) => a.id === attendanceId);
    newData.attendance = attendance.filter((a) => a.id !== attendanceId);
    patchArchiveRow(row.id, newData);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) {
        showToast('تم حذف سجل الحضور', 'success');
        if (deleted && !deleted.id.startsWith('arch-att-')) {
          supabase.from('attendance').delete().eq('id', attendanceId).then(() => loadArchives({ silent: true }));
        }
      }
    });
  }

  function saveHwEdit(row: ArchiveRow, hwId: string, newStatus: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const homeworkStatus = (newData.homework_status ?? []) as ArchivedHomework[];
    const hw = homeworkStatus.find((h) => h.id === hwId);
    if (hw) {
      hw.status = newStatus;
    }
    patchArchiveRow(row.id, newData); setEditingHwId(null);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) { showToast('تم الحفظ', 'success'); if (hw) void syncStudentArchiveToLiveTables({ ...row, archive_data: newData }, hw.student_id); }
    });
  }

  function addHwToArchive(row: ArchiveRow, studentId: string, title: string, status: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const homeworkStatus = (newData.homework_status ?? []) as ArchivedHomework[];
    const newHw: ArchivedHomework = {
      id: crypto.randomUUID?.() ?? generateFallbackUUID(),
      student_id: studentId,
      status,
      title,
    };
    homeworkStatus.push(newHw);
    newData.homework_status = homeworkStatus;
    patchArchiveRow(row.id, newData); setAddingHwOpen(false); setNewHwTitle(''); setNewHwStatus('done');
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) { showToast('تم الحفظ', 'success'); void syncStudentArchiveToLiveTables({ ...row, archive_data: newData }, studentId); }
    });
  }

  function deleteHwFromArchive(row: ArchiveRow, hwId: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const homeworkStatus = (newData.homework_status ?? []) as ArchivedHomework[];
    const deletedHw = homeworkStatus.find((h) => h.id === hwId);
    newData.homework_status = homeworkStatus.filter((h) => h.id !== hwId);
    patchArchiveRow(row.id, newData);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) {
        showToast('تم الحفظ', 'success');
        if (deletedHw && !deletedHw.id.startsWith('arch-hw-')) {
          supabase.from('homework_status').delete().eq('id', hwId).then(() => loadArchives({ silent: true }));
        }
      }
    });
  }

  function saveBehaviorEdit(row: ArchiveRow, behaviorId: string, newRating: string, newNote: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const behavior = (newData.behavior_eval ?? []) as ArchivedBehaviorFull[];
    const b = behavior.find((x) => x.id === behaviorId);
    if (b) {
      b.rating = newRating;
      b.note = newNote || undefined;
    }
    patchArchiveRow(row.id, newData); setEditingBehaviorId(null);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) { showToast('تم الحفظ', 'success'); if (b) void syncStudentArchiveToLiveTables({ ...row, archive_data: newData }, b.student_id); }
    });
  }

  function addBehaviorToArchive(row: ArchiveRow, studentId: string, groupId: string | null, rating: string, note: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const behavior = (newData.behavior_eval ?? []) as ArchivedBehaviorFull[];
    const newB: ArchivedBehaviorFull = {
      id: crypto.randomUUID?.() ?? generateFallbackUUID(),
      student_id: studentId,
      rating,
      note: note || undefined,
      eval_date: row.archive_month + '-15',
      scope: 'monthly',
      group_id: groupId ?? null,
    };
    behavior.push(newB);
    newData.behavior_eval = behavior;
    patchArchiveRow(row.id, newData); setAddingBehaviorOpen(false); setNewBehaviorRating('excellent'); setNewBehaviorNote('');
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) { showToast('تم الحفظ', 'success'); void syncStudentArchiveToLiveTables({ ...row, archive_data: newData }, studentId); }
    });
  }

  function deleteBehaviorFromArchive(row: ArchiveRow, behaviorId: string) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const behavior = (newData.behavior_eval ?? []) as ArchivedBehaviorFull[];
    const deletedBehavior = behavior.find((x) => x.id === behaviorId);
    newData.behavior_eval = behavior.filter((x) => x.id !== behaviorId);
    patchArchiveRow(row.id, newData);
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) {
        showToast('تم الحفظ', 'success');
        if (deletedBehavior && !deletedBehavior.id.startsWith('arch-beh-')) {
          supabase.from('behavior_eval').delete().eq('id', behaviorId).then(() => loadArchives({ silent: true }));
        }
      }
    });
  }

  function addCustomAssessmentToArchive(row: ArchiveRow, studentId: string, groupId: string | null, name: string, category: 'exam' | 'sheet' | 'recitation' | 'behavior', maxScore: number, passScore: number, score: number) {
    if (row.is_locked || !canEditAcademic) return;
    const newData = JSON.parse(JSON.stringify(row.archive_data ?? {})) as Record<string, unknown>;
    const examId = crypto.randomUUID?.() ?? generateFallbackUUID();
    const exams = (newData.center_exams && Array.isArray(newData.center_exams) ? newData.center_exams : []) as ArchivedExam[];
    if (!exams.find((e) => e.id === examId)) {
      exams.push({ id: examId, title: name, max_score: maxScore, pass_score: passScore, category, group_id: groupId ?? null });
      newData.center_exams = exams;
    }
    const grades = (newData.center_grades ?? []) as ArchivedGrade[];
    grades.push({ id: crypto.randomUUID?.() ?? generateFallbackUUID(), student_id: studentId, score, center_exam_id: examId });
    newData.center_grades = grades;
    patchArchiveRow(row.id, newData); setAddingAssessmentOpen(false); setNewAssessmentName(''); setNewAssessmentMax(''); setNewAssessmentPass(''); setNewAssessmentScore('');
    updateArchiveData(row.id, newData).then((ok) => {
      if (ok) { showToast('تم الحفظ', 'success'); void syncStudentArchiveToLiveTables({ ...row, archive_data: newData }, studentId); }
    });
  }

  const sortedArchives = [...archives].sort((a, b) => b.archive_month.localeCompare(a.archive_month));

  function getArchivedStudents(row: ArchiveRow): ArchivedStudent[] {
    if (!row.archive_data?.students || !Array.isArray(row.archive_data.students)) return [];
    return (row.archive_data.students as ArchivedStudent[]).filter((s) => s && s.id).map((s) => {
      const live = liveStudentMap.get(s.id);
      if (!live) return { ...s, is_deleted: s.is_deleted ?? false };
      return {
        ...s,
        name: live.name || s.name,
        phone: live.phone ?? s.phone,
        parent_phone: live.parent_phone ?? s.parent_phone,
        parent_token: live.parent_token ?? s.parent_token,
        is_deleted: live.is_deleted,
      };
    });
  }

  function getArchivedPayments(row: ArchiveRow): ArchivedPayment[] {
    if (!row.archive_data?.payments || !Array.isArray(row.archive_data.payments)) return [];
    return (row.archive_data.payments as ArchivedPayment[]).filter((p) => p && p.id);
  }

  function getArchivedExams(row: ArchiveRow): ArchivedExam[] {
    const archived = (row.archive_data?.center_exams && Array.isArray(row.archive_data.center_exams)
      ? (row.archive_data.center_exams as ArchivedExam[]).filter((e) => e && e.id)
      : []);
    if (archived.length > 0) return archived;
    // Fallback: use live center_exams when the archive snapshot is missing them.
    // Scope by group_ids present in the archived students to prevent cross-month
    // exam leakage from other archive periods.
    const rowGroupIds = new Set(
      getArchivedStudents(row).map((s) => s.group_id).filter(Boolean) as string[]
    );
    const gradeExamIds = new Set(
      getArchivedGrades(row).map((g) => g.center_exam_id).filter(Boolean) as string[]
    );
    return liveExams.filter((e) =>
      gradeExamIds.has(e.id) && (!e.group_id || rowGroupIds.has(e.group_id))
    );
  }

  function getArchivedGrades(row: ArchiveRow): ArchivedGrade[] {
    if (!row.archive_data?.center_grades || !Array.isArray(row.archive_data.center_grades)) return [];
    return (row.archive_data.center_grades as ArchivedGrade[]).filter((g) => g && g.id);
  }

  function getArchivedAttendance(row: ArchiveRow): ArchivedAttendance[] {
    if (!row.archive_data?.attendance || !Array.isArray(row.archive_data.attendance)) return [];
    return (row.archive_data.attendance as ArchivedAttendance[]).filter((a) => a && a.id);
  }

  function getArchivedHomeworkDefinitions(row: ArchiveRow): ArchivedHomeworkDefinition[] {
    if (!row.archive_data?.homework || !Array.isArray(row.archive_data.homework)) return [];
    return (row.archive_data.homework as ArchivedHomeworkDefinition[]).filter((d) => d && d.id);
  }

  function getArchivedHomework(row: ArchiveRow): ArchivedHomework[] {
    const defs = getArchivedHomeworkDefinitions(row);
    const rawStatuses = row.archive_data?.homework_status;
    const statuses = (Array.isArray(rawStatuses) ? rawStatuses : []) as unknown[];
    const result: ArchivedHomework[] = [];
    for (const raw of statuses) {
      if (!raw || typeof raw !== 'object') continue;
      const hs = raw as ArchivedHomework;
      if (!hs.id) continue;
      const def = defs.find((d) => d.id === hs.homework_id);
      result.push({ ...hs, title: hs.title ?? def?.title ?? 'واجب' });
    }
    return result;
  }

  function getArchivedBehavior(row: ArchiveRow): ArchivedBehavior[] {
    if (!row.archive_data?.behavior_eval || !Array.isArray(row.archive_data.behavior_eval)) return [];
    return (row.archive_data.behavior_eval as ArchivedBehavior[]).filter((b) => b && b.id);
  }

  function getPaymentsForStudent(row: ArchiveRow, studentId: string): ArchivedPayment[] {
    return getArchivedPayments(row).filter((p) => p.student_id === studentId);
  }

  function getPaidAmountForStudent(row: ArchiveRow, studentId: string): number {
    return getPaymentsForStudent(row, studentId).reduce((s, p) => s + (p.amount ?? 0), 0);
  }

  function isStudentPaid(row: ArchiveRow, s: ArchivedStudent): boolean {
    if (s.is_exempt) return true;
    if ((s.total_fees ?? 0) <= 0) return true;
    return getPaidAmountForStudent(row, s.id) >= (s.total_fees ?? 0);
  }

  function getAttendanceForStudent(row: ArchiveRow, studentId: string): { present: number; absent: number; excused: number; records: ArchivedAttendance[] } {
    const records = getArchivedAttendance(row).filter((a) => a.student_id === studentId);
    return {
      present: records.filter((a) => a.status === 'present').length,
      absent: records.filter((a) => a.status === 'absent').length,
      excused: records.filter((a) => a.status === 'excused_absence' || a.status === 'excused').length,
      records,
    };
  }

  function getGradesForStudent(row: ArchiveRow, studentId: string): { exam: ArchivedExam; score: number }[] {
    const grades = getArchivedGrades(row).filter((g) => g.student_id === studentId);
    const exams = getArchivedExams(row);
    return grades.map((g) => {
      const exam = exams.find((e) => e.id === g.center_exam_id);
      return exam ? { exam, score: g.score } : null;
    }).filter((x): x is { exam: ArchivedExam; score: number } => x !== null);
  }

  function getHomeworkForStudent(row: ArchiveRow, studentId: string): ArchivedHomework[] {
    return getArchivedHomework(row).filter((h) => h.student_id === studentId);
  }

  function getBehaviorForStudent(row: ArchiveRow, studentId: string): ArchivedBehavior[] {
    return getArchivedBehavior(row).filter((b) => b.student_id === studentId);
  }

  async function reviewFinances(row: ArchiveRow) {
    setReviewingRowId(row.id);
    setArchiveMessage(null);
    try {
      const { data, error } = await supabase
        .from('monthly_archives')
        .select('archive_data')
        .eq('id', row.id)
        .single();
      if (error) throw error;
      const ad = data?.archive_data as Record<string, unknown> | null;
      if (!ad) { setArchiveMessage({ type: 'error', text: 'تعذّر قراءة بيانات الأرشيف.' }); return; }
      const students = (ad.students as ArchivedStudent[] | undefined)?.filter((s) => s && s.id) ?? [];
      const payments = (ad.payments as ArchivedPayment[] | undefined)?.filter((p) => p && p.student_id) ?? [];
      const dbCollected = payments.reduce((s, p) => s + (p.amount ?? 0), 0);
      const dbTotalDue = students.reduce((s, st) => s + (st.is_exempt ? 0 : (st.total_fees ?? 0)), 0);
      const dbRemaining = students.reduce((s, st) => s + (st.is_exempt ? 0 : Math.max(0, (st.total_fees ?? 0) - payments.filter((p) => p.student_id === st.id).reduce((sum, p) => sum + (p.amount ?? 0), 0))), 0);
      const cachedCollected = getTotalCollected(row);
      const match = dbCollected === cachedCollected;
      setArchiveMessage({
        type: match ? 'success' : 'error',
        text: match
          ? `مراجعة الماليات لشهر ${formatMonthLabel(row.archive_month)}: المحصّل ${formatCurrency(dbCollected)} ج.م · المستحق ${formatCurrency(dbTotalDue)} ج.م · المتبقي ${formatCurrency(dbRemaining)} ج.م · ${students.length} طالب. الأرقام متطابقة مع قاعدة البيانات.`
          : `مراجعة الماليات: وُجد فرق بين الأرشيف المعروض (${formatCurrency(cachedCollected)} ج.م) وقاعدة البيانات (${formatCurrency(dbCollected)} ج.م). برجاء تحديث الصفحة.`,
      });
    } catch {
      const cachedCollected = getTotalCollected(row);
      const archivedStudents = getArchivedStudents(row);
      const dbTotalDue = archivedStudents.reduce((s, st) => s + (st.is_exempt ? 0 : (st.total_fees ?? 0)), 0);
      const dbRemaining = archivedStudents.reduce((s, st) => s + (st.is_exempt ? 0 : Math.max(0, (st.total_fees ?? 0) - getPaymentsForStudent(row, st.id).reduce((sum, p) => sum + (p.amount ?? 0), 0))), 0);
      setArchiveMessage({
        type: 'info',
        text: `مراجعة الماليات لشهر ${formatMonthLabel(row.archive_month)} (من البيانات المعروضة): المحصّل ${formatCurrency(cachedCollected)} ج.م · المستحق ${formatCurrency(dbTotalDue)} ج.م · المتبقي ${formatCurrency(dbRemaining)} ج.م · ${archivedStudents.length} طالب.`,
      });
    } finally {
      setReviewingRowId(null);
    }
  }

  function getTotalCollected(row: ArchiveRow): number {
    const payments = getArchivedPayments(row);
    return payments.reduce((s, p) => s + (p.amount ?? 0), 0);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-card rounded-2xl p-4 sm:p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                <Archive className="text-amber-400" size={22} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">الأرشيف الذكي</h2>
                <p className="text-xs text-slate-400">أرشفة تلقائية شهرية مع حفظ كامل لبيانات الطلاب</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DailyCollectionsWidget isMaster={isMaster} />
            <Button size="sm" variant="secondary" onClick={() => void loadArchives()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              تحديث
            </Button>
            {isMaster && (
              <Button size="sm" onClick={() => createArchiveNow(curMonth)}>
                <Zap size={14} />
                أرشفة الشهر الحالي الآن
              </Button>
            )}
          </div>
        </div>

        {/* Auto-archive indicator */}
        <div className="mt-4 flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-2.5">
          <Zap size={14} className="text-emerald-400 flex-shrink-0" />
          <p className="text-[11px] text-emerald-300">
            الأرشفة التلقائية مُفعّلة — تعمل في اليوم الأول من كل شهر الساعة 12:01 صباحاً تلقائياً
          </p>
        </div>

        {/* Archive message */}
        {archiveMessage && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`mt-3 flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium ${
              archiveMessage.type === 'success'
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                : archiveMessage.type === 'error'
                ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                : 'bg-sky-500/10 border border-sky-500/20 text-sky-300'
            }`}
          >
            {archiveMessage.type === 'success' ? <CheckCircle2 size={14} /> : archiveMessage.type === 'error' ? <AlertTriangle size={14} /> : <Clock size={14} />}
            {archiveMessage.text}
          </motion.div>
        )}

        {/* Status summary strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          <StatusPill label="مؤرشف" count={archives.filter((a) => a.status === 'archived').length} color="text-emerald-400" bg="bg-emerald-500/10" icon={CheckCircle2} />
          <StatusPill label="مفتوح" count={archives.filter((a) => a.status === 'open').length} color="text-sky-400" bg="bg-sky-500/10" icon={Clock} />
          <StatusPill label="لم يُؤرشف" count={!hasPrev ? 1 : archives.filter((a) => a.status === 'pending').length} color="text-amber-400" bg="bg-amber-500/10" icon={AlertTriangle} />
        </div>
      </div>

      {/* Accounting checkpoint — teacher only, organizational only */}
      {isMaster && <AccountingCheckpoint variant="card" />}

      {/* Carried-over balances summary */}
      {isMaster && carriedBalances.length > 0 && (
        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-amber-400" />
            <span className="text-sm font-bold text-white">المتأخرات المرحّلة</span>
            <span className="text-[10px] text-slate-500">({carriedBalances.filter((c) => !c.is_settled).length} غير مسدّد)</span>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {carriedBalances.slice(0, 10).map((c) => (
              <div key={c.id} className="flex items-center justify-between glass-light rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="text-xs text-slate-300 font-medium block">
                    ترحيل متأخرات شهر {formatMonthLabel(c.from_month)}
                  </span>
                  <span className="text-[10px] text-slate-500">إلى {formatMonthLabel(c.to_month)}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold text-amber-400">{formatCurrency(c.amount)} ج.م</span>
                  {c.is_settled ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">مسدّد</span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">غير مسدّد</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Archive run history */}
      {archiveRuns.length > 0 && (
        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-slate-400" />
            <span className="text-sm font-bold text-white">سجل عمليات الأرشفة</span>
          </div>
          <div className="space-y-2">
            {archiveRuns.slice(0, 5).map((run) => (
              <div key={run.id} className="flex items-center justify-between glass-light rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${run.status === 'completed' ? 'bg-emerald-400' : run.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <span className="text-xs text-slate-300 font-medium">{formatMonthLabel(run.archive_month)}</span>
                  <span className="text-[10px] text-slate-500">{run.run_type === 'auto' ? 'تلقائي' : 'يدوي'}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {isMaster && run.carried_over_count > 0 && (
                    <span className="text-[10px] text-amber-400">{run.carried_over_count} ترحيل ({formatCurrency(run.carried_over_total)} ج.م)</span>
                  )}
                  <span className="text-[10px] text-slate-500">{run.completed_at ? formatArabicDate(run.completed_at) : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending warning banner */}
      {!hasPrev && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4 border border-amber-500/30 flex items-center gap-3"
        >
          <AlertTriangle className="text-amber-400 flex-shrink-0" size={20} />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-300">لم يتم أرشفة شهر {formatMonthLabel(prevMonth)} بعد</p>
            <p className="text-xs text-amber-400/70 mt-0.5">سيتم أرشفته تلقائياً في أول الشهر القادم، أو يمكنك أرشفته يدوياً الآن.</p>
          </div>
          {isMaster && (
            <Button size="sm" onClick={() => createArchiveNow(prevMonth)}>
              <Archive size={14} />
              أرشفة الآن
            </Button>
          )}
        </motion.div>
      )}

      {/* Group filter — hierarchical */}
      {allGroups.length > 0 && (
        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-emerald-400" />
            <span className="text-sm font-bold text-white">تصفية حسب المرحلة ← الصف ← المجموعة</span>
          </div>
          <GroupHierarchySelector
            groups={allGroups}
            selectedGroupId={selectedGroup?.id ?? null}
            onSelect={(g) => { setSelectedGroup(g); setExpanded(null); }}
            allGroupsEnriched={allGroups as unknown as (Group & { grade_level?: { name: string; stage?: { name: string; sort_order: number } } })[]}
          />
          {selectedGroup && (
            <button
              onClick={() => setHonorBoardOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 px-3 py-1.5 rounded-lg transition"
            >
              <Award size={14} />
              لوحة الشرف
            </button>
          )}
        </div>
      )}

      {/* Archive list */}
      <div className="space-y-3">
        {loading ? (
          <div className="glass-card rounded-2xl p-8 text-center">
            <p className="text-sm text-slate-400">جارٍ تحميل الأرشيف…</p>
          </div>
        ) : sortedArchives.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <Inbox className="mx-auto text-slate-600 mb-4" size={48} />
            <h3 className="text-lg font-bold text-white mb-2">لا يوجد أرشيف بعد</h3>
            <p className="text-sm text-slate-400 mb-4">سيتم إنشاء الأرشيف تلقائياً في أول كل شهر، أو يمكنك تشغيله يدوياً.</p>
            {isMaster && (
              <Button onClick={() => createArchiveNow(curMonth)}>
                <Zap size={16} />
                تشغيل الأرشفة الآن
              </Button>
            )}
          </div>
        ) : (
          sortedArchives.map((row) => {
            const meta = STATUS_META[row.status] ?? STATUS_META.open;
            const StatusIcon = meta.icon;
            const isExpanded = expanded === row.id;
            const counts = row.record_counts ?? {};
            const totalRecords = Object.values(counts).reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0);
            const archivedStudents = getArchivedStudents(row);
            const filteredStudents = selectedGroup
              ? archivedStudents.filter((s) => s.group_id === selectedGroup.id)
              : archivedStudents;
            const searchQuery = studentSearch.trim().toLowerCase();
            const paymentFilteredStudents = paymentFilter === 'paid'
              ? filteredStudents.filter((s) => isStudentPaid(row, s))
              : paymentFilter === 'unpaid'
              ? filteredStudents.filter((s) => !s.is_deleted && !isStudentPaid(row, s) && !s.is_exempt && (s.total_fees ?? 0) > 0)
              : filteredStudents;
            const searchedStudents = searchQuery
              ? paymentFilteredStudents.filter((s) => s.name.toLowerCase().includes(searchQuery))
              : paymentFilteredStudents;
            const totalCollected = getTotalCollected(row);
            const rowRankings = computeGroupRankings(row);

            return (
              <motion.div key={row.id} layout className="glass-card rounded-2xl overflow-hidden">
                <button
                  onClick={() => {
                    const next = isExpanded ? null : row.id;
                    setExpanded(next);
                    setPaymentFilter('all');
                    setStudentSearch('');
                    setGradeLedgerRowId(null);
                  }}
                  className="w-full flex items-center justify-between p-4 sm:p-5 text-right hover:bg-white/[0.03] active:bg-white/[0.04] transition-colors duration-200"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={"w-11 h-11 rounded-xl border flex items-center justify-center flex-shrink-0 " + meta.bg + " transition-transform group-hover:scale-105"}>
                      <StatusIcon className={meta.color} size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm sm:text-base font-bold text-white">{formatMonthLabel(row.archive_month)}</h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.bg} ${meta.color}`}>
                          {meta.label}
                        </span>
                        {row.is_locked && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-500/10 border-red-500/20 text-red-400 flex items-center gap-1">
                            <Lock size={10} /> مقفل
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {totalRecords} سجل · {row.archived_at ? `أُرشف في ${new Date(row.archived_at).toLocaleDateString('ar-EG')}` : 'لم يُؤرشف بعد'}
                      </p>
                    </div>
                  </div>
                  <ChevronDown size={20} className={`text-slate-400 transition-transform duration-300 flex-shrink-0 ${isExpanded ? 'rotate-180 text-emerald-400' : ''}`} />
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-white/[0.06]"
                    >
                      <ErrorBoundary fallbackTitle="تعذّر تحميل تفاصيل هذا الشهر">
                      <div className="p-4 sm:p-5 space-y-4">
                        {/* Record counts grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                          <CountCard icon={Users} label="طلاب" count={counts.students ?? 0} color="text-emerald-400" />
                          <CountCard icon={CalendarDays} label="حضور" count={counts.attendance ?? 0} color="text-sky-400" />
                          <CountCard icon={BarChart3} label="درجات مركز" count={counts.center_grades ?? 0} color="text-violet-400" />
                          <CountCard icon={FileText} label="امتحانات مركز" count={counts.center_exams ?? 0} color="text-purple-400" />
                          <CountCard icon={Wallet} label="مدفوعات" count={counts.payments ?? 0} color="text-amber-400" />
                          <CountCard icon={FileText} label="شهادات" count={counts.certificates ?? 0} color="text-rose-400" />
                          <CountCard icon={BarChart3} label="درجات أونلاين" count={counts.online_grades ?? 0} color="text-indigo-400" />
                          <CountCard icon={FileText} label="واجبات" count={counts.homework ?? 0} color="text-teal-400" />
                          <CountCard icon={BarChart3} label="سلوك" count={counts.behavior_eval ?? 0} color="text-orange-400" />
                          <CountCard icon={CalendarDays} label="حصص" count={counts.sessions ?? 0} color="text-cyan-400" />
                        </div>

                        {/* Payments summary — fixed: uses actual archived payments */}
                        {isMaster && totalCollected > 0 && (
                          <div className="glass-light rounded-xl p-3 sm:p-3.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Wallet size={16} className="text-emerald-400" />
                              <span className="text-xs text-slate-400">إجمالي المحصّل في هذا الشهر</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-bold text-emerald-400">
                                {formatCurrency(totalCollected)} ج.م
                              </span>
                              <button
                                onClick={() => reviewFinances(row)}
                                disabled={reviewingRowId === row.id}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 px-2.5 py-1 rounded-lg transition disabled:opacity-50"
                                title="إعادة احتساب الإجماليات من قاعدة البيانات والتأكد من صحتها"
                              >
                                {reviewingRowId === row.id ? <RefreshCw size={11} className="animate-spin" /> : <BarChart3 size={11} />}
                                مراجعة الماليات
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Paid / Unpaid smart counters & filters */}
                        {isMaster && archivedStudents.length > 0 && (() => {
                          const paidStudents = filteredStudents.filter((s) => isStudentPaid(row, s));
                          const unpaidStudents = filteredStudents.filter((s) => !s.is_deleted && !isStudentPaid(row, s) && !s.is_exempt && (s.total_fees ?? 0) > 0);
                          return (
                            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                              <button
                                onClick={() => setStudentListModal({ row, kind: 'paid', students: paidStudents })}
                                className="glass-light rounded-xl p-3 sm:p-3.5 text-right transition border border-white/5 hover:bg-emerald-500/10 hover:border-emerald-500/30 group active:scale-[0.98]"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <CheckCircle2 size={16} className="text-emerald-400" />
                                    <span className="text-xs text-slate-400">طلاب مسدّدون</span>
                                  </div>
                                  <span className="text-lg font-black text-emerald-400">{paidStudents.length}</span>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-1 group-hover:text-emerald-400 transition">اضغط لعرض القائمة كاملة</p>
                              </button>
                              <button
                                onClick={() => setStudentListModal({ row, kind: 'unpaid', students: unpaidStudents })}
                                className="glass-light rounded-xl p-3 sm:p-3.5 text-right transition border border-white/5 hover:bg-amber-500/10 hover:border-amber-500/30 group active:scale-[0.98]"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle size={16} className="text-amber-400" />
                                    <span className="text-xs text-slate-400">طلاب غير مسدّدين</span>
                                  </div>
                                  <span className="text-lg font-black text-amber-400">{unpaidStudents.length}</span>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-1 group-hover:text-amber-400 transition">اضغط لعرض القائمة كاملة</p>
                              </button>
                            </div>
                          );
                        })()}

                        {/* Student details section */}
                        {archivedStudents.length > 0 && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Users size={14} className="text-emerald-400" />
                                <span className="text-xs font-bold text-white">تفاصيل الطلاب ({filteredStudents.length})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="relative">
                                  <Search size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                  <input
                                    type="text"
                                    value={studentSearch}
                                    onChange={(e) => setStudentSearch(e.target.value)}
                                    placeholder="بحث عن طالب…"
                                    className="w-36 sm:w-44 glass-light rounded-lg py-1.5 pr-8 pl-3 text-xs text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none transition"
                                  />
                                </div>
                                <PDFButton
                                  label="تصدير PDF"
                                  size="sm"
                                  variant="primary"
                                  disabled={filteredStudents.length === 0}
                                  onClick={async () => {
                                    const monthLabel = formatMonthLabel(row.archive_month);
                                    const grpName = selectedGroup?.name;
                                    const studentsForExport = filteredStudents.map((s) => ({
                                      id: s.id,
                                      name: s.name,
                                      phone: s.phone ?? null,
                                      parent_phone: s.parent_phone ?? null,
                                      group_id: s.group_id ?? null,
                                      total_fees: s.total_fees ?? 0,
                                      paid_fees: getPaymentsForStudent(row, s.id).reduce((sum, p) => sum + (p.amount ?? 0), 0),
                                      is_exempt: s.is_exempt ?? false,
                                    } as unknown as Student));
                                    return exportStudentListPDF(studentsForExport, {
                                      title: `أرشيف ${monthLabel} — قائمة الطلاب`,
                                      monthLabel,
                                      groupName: grpName,
                                    });
                                  }}
                                />
                                {isMaster && (
                                  <PDFButton
                                    label="ملخص المدفوعات"
                                    size="sm"
                                    disabled={filteredStudents.length === 0}
                                    onClick={async () => {
                                      const monthLabel = formatMonthLabel(row.archive_month);
                                      const grpName = selectedGroup?.name;
                                      const paidMap = new Map<string, number>();
                                      const exemptSet = new Set<string>();
                                      for (const s of filteredStudents) {
                                        const paid = getPaymentsForStudent(row, s.id).reduce((sum, p) => sum + (p.amount ?? 0), 0);
                                        paidMap.set(s.id, paid);
                                        if (s.is_exempt) exemptSet.add(s.id);
                                      }
                                      return exportMonthlyPaymentSummaryPDF(
                                        filteredStudents.map((s) => ({
                                          id: s.id,
                                          name: s.name,
                                          phone: s.phone ?? null,
                                          parent_phone: s.parent_phone ?? null,
                                          group_id: s.group_id ?? null,
                                          total_fees: s.total_fees ?? 0,
                                          paid_fees: 0,
                                          is_exempt: s.is_exempt ?? false,
                                        } as unknown as Student)),
                                        paidMap,
                                        exemptSet,
                                        { title: `أرشيف ${monthLabel} — ملخص المدفوعات`, monthLabel, groupName: grpName },
                                      );
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                            <div className="space-y-2 max-h-72 overflow-y-auto">
                              {searchedStudents.length === 0 ? (
                                <p className="text-center text-xs text-slate-500 py-4">لا يوجد طلاب مطابقون.</p>
                              ) : (
                                searchedStudents.slice(0, 30).map((s) => {
                                  const studentPayments = getPaymentsForStudent(row, s.id);
                                  const paidTotal = studentPayments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
                                  const attendanceInfo = getAttendanceForStudent(row, s.id);
                                  const grades = getGradesForStudent(row, s.id);
                                  const homework = getHomeworkForStudent(row, s.id);
                                  const behavior = getBehaviorForStudent(row, s.id);
                                  const remaining = s.is_exempt ? 0 : Math.max(0, (s.total_fees ?? 0) - paidTotal);
                                  const studentRank = rowRankings.get(s.id);
                                  return (
                                    <div key={s.id} className="glass-light rounded-xl p-3 space-y-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0 flex-1">
                                          <button
                                            onClick={() => setDetailStudent({ student: s, row })}
                                            className="text-sm font-bold text-white block break-words leading-snug hover:text-emerald-400 transition text-right"
                                          >
                                            {s.name}
                                          </button>
                                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                                            {studentRank && studentRank.rank <= 5 && (
                                              <RankBadge rank={studentRank.rank} />
                                            )}
                                            {isMaster && (() => {
                                              const isPaid = s.is_exempt || remaining <= 0;
                                              return (
                                                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                                  isPaid ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                                }`}>
                                                  {isPaid ? <><CheckCircle2 size={9} /> مسدّد</> : <><AlertTriangle size={9} /> متبقي {formatCurrency(remaining)}</>}
                                                </span>
                                              );
                                            })()}
                                          </div>
                                          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                                            <span className="flex items-center gap-1"><CalendarDays size={9} /> حضور: {attendanceInfo.present}</span>
                                            <span className="flex items-center gap-1 text-red-400"><CalendarDays size={9} /> غياب: {attendanceInfo.absent}</span>
                                            {isMaster && inlineEditStudentId === s.id ? (
                                              <span className="flex items-center gap-1.5 flex-wrap">
                                                <label className="flex items-center gap-1 text-[9px] text-slate-400">مصروفات:
                                                  <input type="number" value={inlineEditFees} onChange={(e) => setInlineEditFees(e.target.value)} onBlur={() => void autoSaveInlineEdit(row, s)} className="w-14 glass-light rounded px-1 py-0.5 text-[10px] text-white border border-white/10" />
                                                </label>
                                                <label className="flex items-center gap-1 text-[9px] text-slate-400">مدفوع:
                                                  <input type="number" value={inlineEditPaid} onChange={(e) => setInlineEditPaid(e.target.value)} onBlur={() => void autoSaveInlineEdit(row, s)} className="w-14 glass-light rounded px-1 py-0.5 text-[10px] text-white border border-white/10" />
                                                </label>
                                                <label className="flex items-center gap-1 text-[9px] text-slate-400">
                                                  <input type="checkbox" checked={inlineEditExempt} onChange={(e) => { setInlineEditExempt(e.target.checked); void autoSaveInlineEdit(row, s); }} className="w-3 h-3" /> معفى
                                                </label>
                                              </span>
                                            ) : (
                                              <>
                                                {isMaster && (
                                                  <span className="flex items-center gap-1"><Wallet size={9} /> مدفوع: {formatCurrency(paidTotal)} ج.م</span>
                                                )}
                                                {isMaster && remaining > 0 && !s.is_exempt && (
                                                  <span className="text-amber-400">متبقي: {formatCurrency(remaining)} ج.م</span>
                                                )}
                                                {s.is_exempt && <span className="text-emerald-400">معفى</span>}
                                              </>
                                            )}
                                            {homework.length > 0 && <span className="flex items-center gap-1"><FileText size={9} /> واجبات: {homework.length}</span>}
                                            {behavior.length > 0 && <span className="flex items-center gap-1"><Heart size={9} /> سلوك: {behavior.length}</span>}
                                          </div>
                                          {grades.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                              {grades.map(({ exam, score }, gi) => {
                                                const pct = (exam.max_score ?? 0) > 0 ? Math.round((score / (exam.max_score ?? 0)) * 100) : 0;
                                                const passed = score >= (exam.pass_score ?? 0);
                                                const catLabel = exam.category === 'recitation' ? 'تسميع' : exam.category === 'sheet' ? 'شيت' : exam.category === 'behavior' ? 'سلوك' : 'امتحان';
                                                return (
                                                  <span key={gi} className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${passed ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                                    {catLabel}: {score}/{exam.max_score ?? 0} ({pct}%)
                                                  </span>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                                          {(s.phone || s.parent_phone) && (() => {
                                            const payLink = buildPaymentReminderLink(s, row, paidTotal, remaining);
                                            return payLink ? (
                                              <a
                                                href={payLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 transition"
                                                title="تذكير بالمصروفات"
                                              >
                                                <Wallet size={12} />
                                              </a>
                                            ) : null;
                                          })()}
                                          {(s.phone || s.parent_phone) && (() => {
                                            const portalLink = buildParentPortalLink(s, row, paidTotal, remaining);
                                            return portalLink ? (
                                              <a
                                                href={portalLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="p-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition"
                                                title={remaining > 0 && !s.is_exempt ? 'إرسال رابط ولي الأمر مع تذكير بالمصروفات' : 'إرسال رابط ولي الأمر'}
                                              >
                                                <Link2 size={12} />
                                              </a>
                                            ) : null;
                                          })()}
                                          <button
                                            onClick={() => setDetailStudent({ student: s, row })}
                                            className="p-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition"
                                            title="عرض السجل الكامل"
                                          >
                                            <FileText size={12} />
                                          </button>
                                          {isMaster && !row.is_locked && inlineEditStudentId === s.id && (
                                            <button
                                              onClick={cancelInlineEdit}
                                              className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition"
                                              title="إلغاء"
                                            >
                                              <X size={12} />
                                            </button>
                                          )}
                                          {isMaster && !row.is_locked && inlineEditStudentId === s.id && inlineSaving && (
                                            <RefreshCw size={12} className="animate-spin text-emerald-400" />
                                          )}
                                          {isMaster && !row.is_locked && inlineEditStudentId !== s.id && (
                                            <button
                                              onClick={() => startInlineEdit(s)}
                                              className="p-1.5 rounded-lg hover:bg-violet-500/10 text-slate-400 hover:text-violet-400 transition"
                                              title="تعديل المصروفات والمدفوع"
                                            >
                                              <Edit2 size={12} />
                                            </button>
                                          )}

                                          {remaining > 0 && !s.is_exempt && (
                                            <Button
                                              size="sm"
                                              variant="secondary"
                                              onClick={() => openHistoricalPayment(s, row.archive_month)}
                                              title="تسجيل دفعة متأخرة لهذا الشهر المؤرشف"
                                            >
                                              <Plus size={12} /> دفعة متأخرة
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                      {studentPayments.length > 0 && (
                                        <div className="space-y-1 pt-1 border-t border-white/5">
                                          {studentPayments.map((p) => (
                                            <div key={p.id} className="flex items-center justify-between text-[10px] text-slate-400">
                                              <span>{formatArabicDate(p.payment_date)}</span>
                                              <span className="text-emerald-400 font-medium">{formatCurrency(p.amount)} ج.م</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                            {filteredStudents.length > 30 && (
                              <p className="text-center text-[10px] text-slate-500">عرض أول 30 طالب — استخدم البحث للتضييق</p>
                            )}
                          </div>
                        )}

                        {/* Smart Grade Completion — bulk fill missing assessments */}
                        {canEditAcademic && !row.is_locked && (
                          <div className="pt-2 border-t border-white/[0.06]">
                            <SmartGradeCompletion
                              row={row}
                              allGroups={allGroups}
                              canEditAcademic={canEditAcademic}
                              onSaved={loadArchives}
                            />
                          </div>
                        )}

                        {/* Grade Ledger per Group */}
                        <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                          <button
                            onClick={() => setGradeLedgerRowId(gradeLedgerRowId === row.id ? null : row.id)}
                            className="flex items-center gap-2 text-xs font-bold text-white hover:text-emerald-400 transition"
                          >
                            <BarChart3 size={14} className="text-violet-400" />
                            سجل الدرجات لكل مجموعة
                            <ChevronDown size={14} className={`transition-transform ${gradeLedgerRowId === row.id ? 'rotate-180' : ''}`} />
                          </button>
                          {gradeLedgerRowId === row.id && (
                            <div className="space-y-3 mt-2">
                              {(() => {
                                const allArchivedExams = getArchivedExams(row);
                                const allArchivedStudents = getArchivedStudents(row);
                                if (allArchivedExams.length === 0 && allArchivedStudents.length === 0) {
                                  return (
                                    <div className="glass-light rounded-xl p-4 text-center">
                                      <BarChart3 className="mx-auto text-slate-600 mb-2" size={24} />
                                      <p className="text-xs text-slate-500">لا توجد درجات أو امتحانات في هذا الشهر المؤرشف.</p>
                                    </div>
                                  );
                                }
                                return allGroups.filter(Boolean).map((grp) => {
                                const groupExams = allArchivedExams.filter((e) => e.group_id === grp.id);
                                const groupStudents = allArchivedStudents.filter((s) => s.group_id === grp.id);
                                if (groupExams.length === 0 && groupStudents.length === 0) return null;
                                return (
                                  <div key={grp.id} className="glass-light rounded-xl p-3 space-y-2">
                                    <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                                      <h5 className="text-xs font-bold text-emerald-400">{grp.name}</h5>
                                      <span className="text-[10px] text-slate-500">{groupStudents.length} طالب · {groupExams.length} امتحان</span>
                                    </div>
                                    {groupExams.length === 0 ? (
                                      <p className="text-[11px] text-slate-500 py-1">لا توجد امتحانات مسجّلة لهذه المجموعة في هذا الشهر.</p>
                                    ) : (
                                      groupExams.map((exam) => {
                                      const grades = getArchivedGrades(row).filter((g) => g.center_exam_id === exam.id);
                                      const studentsWithGrades = groupStudents.filter((s) => grades.some((g) => g.student_id === s.id));
                                      const studentsWithoutGrades = groupStudents.filter((s) => !grades.some((g) => g.student_id === s.id));
                                      const catLabel = exam.category === 'recitation' ? 'تسميع' : exam.category === 'sheet' ? 'شيت' : exam.category === 'behavior' ? 'سلوك' : 'امتحان';
                                      return (
                                        <div key={exam.id} className="space-y-1.5">
                                          <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">{catLabel}</span>
                                              <span className="text-xs text-white font-medium">{exam.title ?? 'بدون اسم'}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              {canEditExams && !row.is_locked && editingExamId === exam.id ? (
                                                <div className="flex items-center gap-1">
                                                  <input type="number" value={editMaxScore} onChange={(e) => setEditMaxScore(e.target.value)} className="w-14 glass-light rounded px-1.5 py-0.5 text-[10px] text-white border border-white/10" placeholder="عظمى" />
                                                  <input type="number" value={editPassScore} onChange={(e) => setEditPassScore(e.target.value)} className="w-14 glass-light rounded px-1.5 py-0.5 text-[10px] text-white border border-white/10" placeholder="نجاح" />
                                                  <button onClick={() => void saveExamEdit(row, exam.id, parseFloat(editMaxScore) || 0, parseFloat(editPassScore) || 0)} className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                                    {<Check size={10} />}
                                                  </button>
                                                </div>
                                              ) : (
                                                <>
                                                  <span className="text-[10px] text-slate-500">عظمى: {exam.max_score ?? 0} · نجاح: {exam.pass_score ?? 0}</span>
                                                  {canEditAcademic && !row.is_locked && (
                                                    <button onClick={() => { setEditingExamId(exam.id); setEditMaxScore(String(exam.max_score ?? 0)); setEditPassScore(String(exam.pass_score ?? 0)); }} className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-emerald-400">
                                                      <Edit2 size={10} />
                                                    </button>
                                                  )}
                                                  {canEditAcademic && !row.is_locked && (
                                                    <button onClick={() => setDeleteConfirm({ type: 'exam', id: exam.id, row, label: exam.title ?? 'بدون اسم' })} className="p-1 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-400">
                                                      <Trash2 size={10} />
                                                    </button>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          </div>
                                          <div className="space-y-0.5 pr-2">
                                            {studentsWithGrades.map((s) => {
                                              const grade = grades.find((g) => g.student_id === s.id);
                                              if (!grade) return null;
                                              const passed = grade.score >= (exam.pass_score ?? 0);
                                              return (
                                                <div key={s.id} className="flex items-center justify-between text-[11px]">
                                                  <span className="text-slate-300">{s.name}</span>
                                                  {canEditAcademic && !row.is_locked && editingGradeId === grade.id ? (
                                                    <div className="flex items-center gap-1">
                                                      <input type="number" value={editScore} onChange={(e) => setEditScore(e.target.value)} className="w-14 glass-light rounded px-1.5 py-0.5 text-[10px] text-white border border-white/10" autoFocus />
                                                      <button onClick={() => void saveGradeEdit(row, grade.id, parseFloat(editScore) || 0)} className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                                        {<Check size={10} />}
                                                      </button>
                                                    </div>
                                                  ) : (
                                                    <button
                                                      onClick={() => { if (canEditAcademic && !row.is_locked) { setEditingGradeId(grade.id); setEditScore(String(grade.score)); } }}
                                                      className={`font-bold ${passed ? 'text-emerald-400' : 'text-red-400'} ${canEditAcademic && !row.is_locked ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
                                                    >
                                                      {grade.score}/{exam.max_score ?? 0}
                                                    </button>
                                                  )}
                                                </div>
                                              );
                                            })}
                                            {studentsWithoutGrades.length > 0 && (
                                              <div className="pt-1 border-t border-white/5">
                                                <p className="text-[10px] text-slate-500 mb-0.5">لم يُسجّل ({studentsWithoutGrades.length}):</p>
                                                {studentsWithoutGrades.map((s) => (
                                                  <div key={s.id} className="flex items-center justify-between text-[11px] py-0.5">
                                                    <span className="text-slate-600">{s.name}</span>
                                                    {canEditAcademic && !row.is_locked && (
                                                      addingGradeExamId === s.id ? (
                                                        <div className="flex items-center gap-1">
                                                          <input type="number" value={newGradeScore} onChange={(e) => setNewGradeScore(e.target.value)} className="w-14 glass-light rounded px-1.5 py-0.5 text-[10px] text-white border border-white/10" placeholder="درجة" autoFocus />
                                                          <button onClick={() => void addGradeForStudent(row, s.id, exam.id, parseFloat(newGradeScore) || 0)} disabled={!newGradeScore} className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                                            {<Check size={10} />}
                                                          </button>
                                                          <button onClick={() => { setAddingGradeExamId(null); setNewGradeScore(''); }} className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">
                                                            <X size={10} />
                                                          </button>
                                                        </div>
                                                      ) : (
                                                        <button onClick={() => { setAddingGradeExamId(s.id); setNewGradeScore(''); }} className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold">
                                                          + إضافة درجة
                                                        </button>
                                                      )
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })
                                    )}
                                  </div>
                                );
                                });
                              })()}
                              {(() => {
                                const ungrouped = getArchivedExams(row).filter((e) => !e.group_id || !allGroups.some((g) => g.id === e.group_id));
                                if (ungrouped.length === 0) return null;
                                return (
                                  <div className="glass-light rounded-xl p-3 space-y-2">
                                    <h5 className="text-xs font-bold text-amber-400 border-b border-white/10 pb-1.5">بدون مجموعة محددة</h5>
                                    {ungrouped.map((exam) => {
                                      const grades = getArchivedGrades(row).filter((g) => g.center_exam_id === exam.id);
                                      const catLabel = exam.category === 'recitation' ? 'تسميع' : exam.category === 'sheet' ? 'شيت' : exam.category === 'behavior' ? 'سلوك' : 'امتحان';
                                      return (
                                        <div key={exam.id} className="space-y-1">
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">{catLabel}</span>
                                            <span className="text-xs text-white font-medium">{exam.title ?? 'بدون اسم'}</span>
                                            <span className="text-[10px] text-slate-500">عظمى: {exam.max_score ?? 0}</span>
                                            {canEditAcademic && !row.is_locked && (
                                              <button onClick={() => setDeleteConfirm({ type: 'exam', id: exam.id, row, label: exam.title ?? 'بدون اسم' })} className="p-1 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-400">
                                                <Trash2 size={10} />
                                              </button>
                                            )}
                                          </div>
                                          <div className="space-y-0.5 pr-2">
                                            {grades.map((g) => {
                                              const student = getArchivedStudents(row).find((s) => s.id === g.student_id);
                                              return (
                                                <div key={g.id} className="text-[11px] text-slate-300">
                                                  {student?.name ?? 'طالب'}: <span className={g.score >= (exam.pass_score ?? 0) ? 'text-emerald-400' : 'text-red-400'}>{g.score}/{exam.max_score ?? 0}</span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>

                        {/* Master actions */}
                        {isMaster && (
                          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
                            {row.status !== 'archived' && (
                              <Button size="sm" variant="secondary" onClick={() => requestArchive(row)}>
                                <Archive size={14} /> أرشفة هذا الشهر
                              </Button>
                            )}
                            {row.status === 'archived' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setRollbackTarget(row)}
                                className="text-amber-400 hover:bg-amber-500/10"
                               
                              >
                                {<Undo2 size={14} />}
                                إلغاء الأرشفة / تراجع
                              </Button>
                            )}
                            {row.is_locked ? (
                              <Button size="sm" variant="ghost" onClick={() => requestLockToggle(row, 'unlock')}>
                                <Unlock size={14} /> فتح القفل
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => requestLockToggle(row, 'lock')}>
                                <Lock size={14} /> قفل الأرشيف
                              </Button>
                            )}
                          </div>
                        )}

                        {!isMaster && row.is_locked && (
                          <div className="flex items-center gap-2 text-xs text-amber-400/80 pt-2 border-t border-white/[0.06]">
                            <Lock size={12} />
                            هذا الشهر مقفل — التعديل على الدرجات يتطلب صلاحية المدير فقط. تسجيل الدفعات المتأخرة متاح.
                          </div>
                        )}
                      </div>
                      </ErrorBoundary>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Student detail modal — full historical record */}
      <Modal
        open={!!detailStudent}
        onClose={() => setDetailStudent(null)}
        title={`السجل الكامل — ${detailStudent?.student.name ?? ''}`}
        size="lg"
        zIndex={100000}
      >
        {detailStudent && (() => {
          const { student: s, row } = detailStudent;
          const payments = getPaymentsForStudent(row, s.id);
          const paidTotal = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
          const attendanceInfo = getAttendanceForStudent(row, s.id);
          const grades = getGradesForStudent(row, s.id);
          const homework = getHomeworkForStudent(row, s.id);
          const behavior = getBehaviorForStudent(row, s.id);
          const remaining = s.is_exempt ? 0 : Math.max(0, (s.total_fees ?? 0) - paidTotal);
          const detailRank = computeGroupRankings(row).get(s.id);
          return (
            <>
            <div className="space-y-5">
              {/* Student header */}
              {(() => {
                const grp = allGroups.find((g) => g.id === s.group_id);
                const gd = grp as (Group & { grade_level?: { name?: string; stage?: { name?: string } } }) | undefined;
                const groupName = gd?.name;
                const gradeName = gd?.grade_level?.name;
                const stageName = gd?.grade_level?.stage?.name;
                return (
                <div className="glass-light rounded-xl p-4 flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center text-xl font-bold flex-shrink-0">
                    {s.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-white">{s.name}</h3>
                    {(stageName || gradeName || groupName) && (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {stageName && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-300 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full"><GraduationCap size={10} /> {stageName}</span>}
                        {gradeName && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-violet-300 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full"><BookOpen size={10} /> {gradeName}</span>}
                        {groupName && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full"><Users size={10} /> {groupName}</span>}
                      </div>
                    )}
                    {detailRank && detailRank.rank <= 5 && (
                      <div className="mt-1.5">
                        <RankBadge rank={detailRank.rank} />
                      </div>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1 flex-wrap">
                      {s.phone && <span className="flex items-center gap-1"><Phone size={10} /> {s.phone}</span>}
                      {s.parent_phone && <span className="flex items-center gap-1"><Phone size={10} /> {s.parent_phone}</span>}
                      {s.is_exempt && <span className="text-emerald-400 font-bold">معفى من الرسوم</span>}
                    </div>
                  </div>
                {(s.phone || s.parent_phone) && (() => {
                  const payLink = buildPaymentReminderLink(s, row, paidTotal, remaining);
                  return payLink ? (
                    <a
                      href={payLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 transition flex-shrink-0"
                      title="تذكير بالمصروفات"
                    >
                      <Wallet size={18} />
                    </a>
                  ) : null;
                })()}
                {(s.phone || s.parent_phone) && (() => {
                  const portalLink = buildParentPortalLink(s, row, paidTotal, remaining);
                  return portalLink ? (
                    <a
                      href={portalLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition flex-shrink-0"
                      title={remaining > 0 && !s.is_exempt ? 'إرسال رابط ولي الأمر مع تذكير بالمصروفات' : 'إرسال رابط ولي الأمر'}
                    >
                      <Link2 size={18} />
                    </a>
                  ) : null;
                })()}
              </div>
                );
              })()}

              {/* Monthly Overall Percentage & Motivational Feedback */}
              {(() => {
                const analytics = computeStudentAnalytics({
                  present: attendanceInfo.present,
                  absent: attendanceInfo.absent,
                  excused: attendanceInfo.excused,
                  grades: grades.map((g) => ({ score: g.score, maxScore: g.exam.max_score })),
                  homework: homework.map((h) => ({ status: h.status })),
                });
                const toneStyles = {
                  excellent: 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300',
                  good: 'bg-sky-600/20 border-sky-500/50 text-sky-300',
                  average: 'bg-amber-600/20 border-amber-500/50 text-amber-300',
                  needs_improvement: 'bg-red-600/20 border-red-500/50 text-red-300',
                };
                const toneSolidBg = {
                  excellent: 'bg-emerald-500/20',
                  good: 'bg-sky-500/20',
                  average: 'bg-amber-500/20',
                  needs_improvement: 'bg-red-500/20',
                };
                const toneText = {
                  excellent: 'text-emerald-300',
                  good: 'text-sky-300',
                  average: 'text-amber-300',
                  needs_improvement: 'text-red-300',
                };
                const toneIcon = analytics.motivationalTone === 'excellent' ? <Award size={18} className="text-emerald-400" />
                  : analytics.motivationalTone === 'good' ? <TrendingUp size={18} className="text-sky-400" />
                  : analytics.motivationalTone === 'average' ? <Clock size={18} className="text-amber-400" />
                  : <AlertTriangle size={18} className="text-red-400" />;
                return (
                  <div className={`rounded-xl border-2 p-4 ${toneStyles[analytics.motivationalTone]}`}>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm font-bold text-white flex items-center gap-2">
                        {toneIcon}
                        المستوى العام لشهر {formatMonthLabel(row.archive_month)}
                      </span>
                      <span className={`text-3xl font-black drop-shadow-lg ${toneText[analytics.motivationalTone]}`}>{analytics.overallPercentage}%</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="bg-slate-900/60 rounded-lg p-2.5 text-center border border-white/10">
                        <p className="text-lg font-black text-emerald-400">{analytics.attendanceRate}%</p>
                        <p className="text-[10px] font-semibold text-slate-200">الحضور</p>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2.5 text-center border border-white/10">
                        <p className="text-lg font-black text-violet-400">{analytics.gradeRate}%</p>
                        <p className="text-[10px] font-semibold text-slate-200">الدرجات</p>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2.5 text-center border border-white/10">
                        <p className="text-lg font-black text-teal-400">{analytics.homeworkRate == null ? '—' : `${analytics.homeworkRate}%`}</p>
                        <p className="text-[10px] font-semibold text-slate-200">الواجبات</p>
                      </div>
                    </div>
                    <div className={`rounded-lg p-3 ${toneSolidBg[analytics.motivationalTone]} border border-white/10`}>
                      <p className="text-xs font-bold text-white leading-relaxed">{analytics.motivationalMessage}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Payment status banner — master only */}
              {isMaster && (() => {
                const isPaid = s.is_exempt || remaining <= 0;
                return (
                  <div className={`rounded-xl border-2 p-3 flex items-center justify-between ${
                    isPaid ? 'bg-emerald-600/15 border-emerald-500/40' : 'bg-amber-600/15 border-amber-500/40'
                  }`}>
                    <span className={`text-sm font-bold flex items-center gap-2 ${isPaid ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {isPaid ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                      {s.is_exempt ? 'معفى من الرسوم' : isPaid ? 'مسدّد بالكامل' : `متبقي ${formatCurrency(remaining)} ج.م`}
                    </span>
                  </div>
                );
              })()}

              {/* Financial summary — master only */}
              {isMaster && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="glass-light rounded-xl p-3 text-center">
                    <p className="text-xs font-bold text-slate-200">إجمالي الرسوم</p>
                    <p className="text-lg font-black text-white">{formatCurrency(s.total_fees ?? 0)} ج.م</p>
                  </div>
                  <div className="glass-light rounded-xl p-3 text-center">
                    <p className="text-xs font-bold text-slate-200">المدفوع</p>
                    <p className="text-lg font-black text-emerald-400">{formatCurrency(paidTotal)} ج.م</p>
                  </div>
                  <div className="glass-light rounded-xl p-3 text-center">
                    <p className="text-xs font-bold text-slate-200">المتبقي</p>
                    <p className={`text-lg font-black ${remaining > 0 ? 'text-red-400' : 'text-white'}`}>{formatCurrency(Math.max(0, remaining))} ج.م</p>
                  </div>
                </div>
              )}

              {/* Payments detail — master only */}
              {isMaster && payments.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Wallet size={14} className="text-amber-400" /> سجل المدفوعات</h4>
                  <div className="space-y-1.5">
                    {payments.map((p) => (
                      <div key={p.id} className="glass-light rounded-lg px-3 py-2 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">{formatArabicDate(p.payment_date)}</span>
                          {p.receipt_number && <span className="text-[10px] text-slate-500">#{p.receipt_number}</span>}
                          {p.note && <span className="text-[10px] text-slate-500">— {p.note}</span>}
                        </div>
                        <span className="text-emerald-400 font-bold">{formatCurrency(p.amount)} ج.م</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Attendance detail */}
              {attendanceInfo.records.length > 0 && (() => {
                const total = attendanceInfo.present + attendanceInfo.absent + attendanceInfo.excused;
                const rate = total > 0 ? Math.round((attendanceInfo.present / total) * 100) : 0;
                const firstDate = attendanceInfo.records.reduce((min, a) => a.attendance_date < min ? a.attendance_date : min, attendanceInfo.records[0].attendance_date);
                return (
                <div>
                  <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><CalendarDays size={14} className="text-sky-400" /> سجل الحضور والغياب</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 items-center">
                    <div className="flex justify-center">
                      <AttendanceRingChart present={attendanceInfo.present} absent={attendanceInfo.absent + attendanceInfo.excused} total={total} rate={rate} size={100} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-slate-900/60 rounded-lg p-2 text-center border border-emerald-500/20">
                        <p className="text-sm font-black text-emerald-400">{attendanceInfo.present}</p>
                        <p className="text-[10px] font-bold text-slate-200">حاضر</p>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2 text-center border border-red-500/20">
                        <p className="text-sm font-black text-red-400">{attendanceInfo.absent}</p>
                        <p className="text-[10px] font-bold text-slate-200">غائب</p>
                      </div>
                      <div className="bg-slate-900/60 rounded-lg p-2 text-center border border-amber-500/20">
                        <p className="text-sm font-black text-amber-400">{attendanceInfo.excused}</p>
                        <p className="text-[10px] font-bold text-slate-200">غياب بعذر</p>
                      </div>
                    </div>
                  </div>
                  {firstDate && (
                    <div className="mb-2 text-[10px] text-slate-400 flex items-center gap-1">
                      <CalendarDays size={10} className="text-emerald-400" /> بداية الحضور من تاريخ: <span className="text-emerald-300 font-semibold">{formatArabicDate(firstDate)}</span>
                    </div>
                  )}
                  {(() => {
                    const seen = new Map<string, number>();
                    for (const a of attendanceInfo.records) {
                      const key = `${a.attendance_date}|${a.session_id ?? 'null'}`;
                      seen.set(key, (seen.get(key) ?? 0) + 1);
                    }
                    const dupes = Array.from(seen.entries()).filter(([, c]) => c > 1);
                    if (dupes.length === 0) return null;
                    return (
                      <div className="mb-2 flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />
                        <span className="text-[10px] text-amber-300">
                          يوجد {dupes.length} سجل حضور مكرر لنفس التاريخ والحصة. برجاء مراجعة السجلات وحذف المكرر يدوياً.
                        </span>
                      </div>
                    );
                  })()}
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {attendanceInfo.records.map((a) => (
                      <div key={a.id} className="glass-light rounded-lg px-3 py-1.5 flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">{formatArabicDate(a.attendance_date)}{a.session_id ? <span className="text-slate-600 text-[9px] mr-1">(حصة)</span> : null}</span>
                        <div className="flex items-center gap-1.5">
                          {canEditAcademic && !row.is_locked && editingAttendanceId === a.id ? (
                            <div className="flex items-center gap-1">
                              <select value={editAttendanceStatus} onChange={(e) => setEditAttendanceStatus(e.target.value)} className="glass-light rounded px-1.5 py-0.5 text-[10px] text-white border border-white/10">
                                <option value="present" className="bg-slate-900">حاضر</option>
                                <option value="absent" className="bg-slate-900">غائب</option>
                                <option value="excused" className="bg-slate-900">غياب بعذر</option>
                              </select>
                              <button onClick={() => void saveAttendanceEdit(row, a.id, editAttendanceStatus)} className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                {<Check size={10} />}
                              </button>
                              <button onClick={() => setEditingAttendanceId(null)} className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">
                                <X size={10} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className={`font-bold ${a.status === 'present' ? 'text-emerald-400' : a.status === 'absent' ? 'text-red-400' : 'text-amber-400'}`}>
                                {a.status === 'present' ? 'حاضر' : a.status === 'absent' ? 'غائب' : (a.status === 'excused_absence' || a.status === 'excused') ? 'غياب بعذر' : a.status}
                              </span>
                              {canEditAcademic && !row.is_locked && (
                                <>
                                  <button onClick={() => { setEditingAttendanceId(a.id); setEditAttendanceStatus(a.status === 'excused_absence' ? 'excused' : a.status); }} className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-emerald-400" title="تعديل">
                                    <Edit2 size={9} />
                                  </button>
                                  <button onClick={() => setDeleteConfirm({ type: 'attendance', id: a.id, row, label: formatArabicDate(a.attendance_date) })} className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400" title="حذف">
                                    <Trash2 size={9} />
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                );
              })()}

              {/* Grades detail */}
              <div>
                <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><BarChart3 size={14} className="text-violet-400" /> درجات الامتحانات والشيتات والتسميع</h4>
                {grades.length === 0 ? (
                  <p className="text-xs text-slate-500 glass-light rounded-lg px-3 py-2">لا توجد درجات مسجلة لهذا الطالب في هذا الشهر.</p>
                ) : (
                  <>
                    <div className="space-y-1.5">
                    {grades.map(({ exam, score }, i) => {
                      const grade = getArchivedGrades(row).find((g) => g.student_id === s.id && g.center_exam_id === exam.id);
                      return (
                        <div key={i} className="glass-light rounded-lg px-3 py-2 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {exam.category === 'recitation' && <Mic size={12} className="text-sky-400" />}
                            {exam.category === 'behavior' && <Heart size={12} className="text-orange-400" />}
                            {exam.category === 'exam' && <BookOpen size={12} className="text-violet-400" />}
                            {exam.category === 'sheet' && <FileText size={12} className="text-teal-400" />}
                            <span className="text-slate-300">{exam.title ?? 'بدون اسم'}</span>
                            {canEditExams && !row.is_locked && editingDetailExamId === exam.id ? (
                              <div className="flex items-center gap-1 mr-2">
                                <input type="number" value={editDetailMax} onChange={(e) => setEditDetailMax(e.target.value)} className="w-12 glass-light rounded px-1 py-0.5 text-[10px] text-white border border-white/10" placeholder="عظمى" />
                                <input type="number" value={editDetailPass} onChange={(e) => setEditDetailPass(e.target.value)} className="w-12 glass-light rounded px-1 py-0.5 text-[10px] text-white border border-white/10" placeholder="نجاح" />
                                <button onClick={() => void saveDetailExamEdit(row, exam.id, parseFloat(editDetailMax) || 0, parseFloat(editDetailPass) || 0)} className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                  {<Check size={10} />}
                                </button>
                                <button onClick={() => setEditingDetailExamId(null)} className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">
                                  <X size={10} />
                                </button>
                              </div>
                            ) : canEditAcademic && !row.is_locked ? (
                              <button onClick={() => { setEditingDetailExamId(exam.id); setEditDetailMax(String(exam.max_score ?? 0)); setEditDetailPass(String(exam.pass_score ?? 0)); }} className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-emerald-400">
                                <Edit2 size={9} />
                              </button>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            {canEditAcademic && !row.is_locked && grade && editingDetailGradeId === grade.id ? (
                              <div className="flex items-center gap-1">
                                <input type="number" value={editDetailScore} onChange={(e) => setEditDetailScore(e.target.value)} className="w-14 glass-light rounded px-1.5 py-0.5 text-[10px] text-white border border-white/10" autoFocus />
                                <button onClick={() => void saveGradeEdit(row, grade.id, parseFloat(editDetailScore) || 0)} className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                  {<Check size={10} />}
                                </button>
                                <button onClick={() => setEditingDetailGradeId(null)} className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">
                                  <X size={10} />
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => { if (canEditAcademic && !row.is_locked && grade) { setEditingDetailGradeId(grade.id); setEditDetailScore(String(score)); } }}
                                  className={`text-white font-bold ${canEditAcademic && !row.is_locked && grade ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
                                >
                                  {score}
                                </button>
                                <span className="text-[10px] text-slate-500">/ {exam.max_score ?? 0}</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${score >= (exam.pass_score ?? 0) ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                  {score >= (exam.pass_score ?? 0) ? 'ناجح' : 'راسب'}
                                </span>
                                {canEditAcademic && !row.is_locked && grade && (
                                  <button onClick={() => setDeleteConfirm({ type: 'grade', id: grade.id, row, label: exam.title ?? 'بدون اسم' })} className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400" title="حذف الدرجة">
                                    <Trash2 size={10} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                  })}
                  </div>
                  {/* Add grade for exams the student doesn't have */}
                  {canEditAcademic && !row.is_locked && (() => {
                    const allExams = getArchivedExams(row);
                    const studentExamIds = new Set(grades.map((g) => g.exam.id));
                    const missingExams = allExams.filter((e) => !studentExamIds.has(e.id));
                    if (missingExams.length === 0) return null;
                    return (
                      <div className="pt-2 border-t border-white/5">
                        <p className="text-[10px] text-slate-500 mb-1.5">إضافة درجة لامتحان غير مسجّل:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {missingExams.map((exam) => (
                            <div key={exam.id} className="flex items-center gap-1">
                              <button
                                onClick={() => setAddingGradeExamId(addingGradeExamId === exam.id ? null : exam.id)}
                                className={`text-[10px] px-2 py-1 rounded-lg font-bold transition ${addingGradeExamId === exam.id ? 'bg-emerald-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
                              >
                                {exam.title ?? 'بدون اسم'}
                              </button>
                              {addingGradeExamId === exam.id && (
                                <div className="flex items-center gap-1">
                                  <input type="number" value={newGradeScore} onChange={(e) => setNewGradeScore(e.target.value)} className="w-14 glass-light rounded px-1.5 py-0.5 text-[10px] text-white border border-white/10" placeholder="درجة" autoFocus />
                                  <button onClick={() => void addGradeForStudent(row, s.id, exam.id, parseFloat(newGradeScore) || 0)} disabled={!newGradeScore} className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                    {<Check size={10} />}
                                  </button>
                                  <button onClick={() => { setAddingGradeExamId(null); setNewGradeScore(''); }} className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">
                                    <X size={10} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  </>
                )}
              </div>

              {/* Add custom assessment */}
              {canEditAcademic && !row.is_locked && (
                <div className="pt-2 border-t border-white/5">
                  {addingAssessmentOpen ? (
                    <div className="glass-light rounded-xl p-3 space-y-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Plus size={14} className="text-emerald-400" />
                        <span className="text-xs font-bold text-white">إضافة تقييم جديد (امتحان / شيت / تسميع)</span>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">اسم التقييم</label>
                        <input type="text" value={newAssessmentName} onChange={(e) => setNewAssessmentName(e.target.value)} placeholder="مثال: امتحان الوحدة الأولى" className="w-full glass-light rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10" autoFocus />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">النوع</label>
                          <select value={newAssessmentCategory} onChange={(e) => setNewAssessmentCategory(e.target.value as 'exam' | 'sheet' | 'recitation' | 'behavior')} className="w-full glass-light rounded-lg px-2 py-1.5 text-xs text-white border border-white/10">
                            <option value="exam" className="bg-slate-900">امتحان</option>
                            <option value="sheet" className="bg-slate-900">شيت</option>
                            <option value="recitation" className="bg-slate-900">تسميع</option>
                            <option value="behavior" className="bg-slate-900">سلوك</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">الدرجة العظمى</label>
                          <input type="number" value={newAssessmentMax} onChange={(e) => setNewAssessmentMax(e.target.value)} placeholder="مثال: 20" className="w-full glass-light rounded-lg px-2 py-1.5 text-xs text-white border border-white/10" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">درجة النجاح (الصغرى)</label>
                          <input type="number" value={newAssessmentPass} onChange={(e) => setNewAssessmentPass(e.target.value)} placeholder="مثال: 10" className="w-full glass-light rounded-lg px-2 py-1.5 text-xs text-white border border-white/10" />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">درجة الطالب</label>
                          <input type="number" value={newAssessmentScore} onChange={(e) => setNewAssessmentScore(e.target.value)} placeholder="مثال: 15" className="w-full glass-light rounded-lg px-2 py-1.5 text-xs text-white border border-white/10" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => void addCustomAssessmentToArchive(row, s.id, s.group_id ?? null, newAssessmentName.trim() || 'تقييم', newAssessmentCategory, parseFloat(newAssessmentMax) || 0, parseFloat(newAssessmentPass) || 0, parseFloat(newAssessmentScore) || 0)}
                          disabled={!newAssessmentMax || !newAssessmentScore}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-xs font-bold flex items-center gap-1 disabled:opacity-50"
                        >
                          {<Check size={12} />} حفظ التقييم
                        </button>
                        <button onClick={() => { setAddingAssessmentOpen(false); setNewAssessmentName(''); setNewAssessmentMax(''); setNewAssessmentPass(''); setNewAssessmentScore(''); }} className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs font-bold flex items-center gap-1">
                          <X size={12} /> إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setAddingAssessmentOpen(true)} className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1">
                      <Plus size={12} /> إضافة تقييم جديد (امتحان / شيت / تسميع)
                    </button>
                  )}
                </div>
              )}

              {/* Homework detail */}
              <div>
                <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><FileText size={14} className="text-teal-400" /> الواجبات</h4>
                {homework.length === 0 && !(canEditAcademic && !row.is_locked) ? (
                  <p className="text-xs text-slate-500 glass-light rounded-lg px-3 py-2">لا توجد واجبات مسجلة لهذا الطالب.</p>
                ) : (
                  <div className="space-y-1.5">
                    {homework.map((h, i) => (
                      <div key={i} className="glass-light rounded-lg px-3 py-2 flex items-center justify-between text-xs">
                        <span className="text-slate-300">{h.title ?? 'واجب'}</span>
                        <div className="flex items-center gap-2">
                          {canEditAcademic && !row.is_locked && editingHwId === h.id ? (
                            <div className="flex items-center gap-1">
                              <select value={editHwStatus} onChange={(e) => setEditHwStatus(e.target.value)} className="glass-light rounded px-1.5 py-0.5 text-[10px] text-white border border-white/10">
                                <option value="done" className="bg-slate-900">تم</option>
                                <option value="not_done" className="bg-slate-900">لم يتم</option>
                                <option value="late" className="bg-slate-900">متأخر</option>
                              </select>
                              <button onClick={() => void saveHwEdit(row, h.id, editHwStatus)} className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                {<Check size={10} />}
                              </button>
                              <button onClick={() => setEditingHwId(null)} className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">
                                <X size={10} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => { if (canEditAcademic && !row.is_locked) { setEditingHwId(h.id); setEditHwStatus(h.status); } }}
                                className={`font-bold ${h.status === 'done' ? 'text-emerald-400' : h.status === 'not_done' ? 'text-red-400' : 'text-amber-400'} ${canEditAcademic && !row.is_locked ? 'hover:underline cursor-pointer' : 'cursor-default'}`}
                              >
                                {h.status === 'done' ? 'تم' : h.status === 'not_done' ? 'لم يتم' : h.status === 'late' ? 'متأخر' : h.status}
                              </button>
                              {canEditAcademic && !row.is_locked && (
                                <button onClick={() => setDeleteConfirm({ type: 'hw', id: h.id, row, label: h.title ?? 'واجب' })} className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400" title="حذف">
                                  <Trash2 size={10} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {canEditAcademic && !row.is_locked && (
                      addingHwOpen ? (
                        <div className="glass-light rounded-lg px-3 py-2.5 space-y-2">
                          <input type="text" value={newHwTitle} onChange={(e) => setNewHwTitle(e.target.value)} placeholder="عنوان الواجب" className="w-full glass-light rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10" autoFocus />
                          <div className="flex items-center gap-2">
                            <select value={newHwStatus} onChange={(e) => setNewHwStatus(e.target.value)} className="glass-light rounded px-1.5 py-1 text-[11px] text-white border border-white/10">
                              <option value="done" className="bg-slate-900">تم</option>
                              <option value="not_done" className="bg-slate-900">لم يتم</option>
                              <option value="late" className="bg-slate-900">متأخر</option>
                            </select>
                            <button onClick={() => void addHwToArchive(row, s.id, newHwTitle.trim() || 'واجب', newHwStatus)} className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-[11px] font-bold flex items-center gap-1">
                              {<Check size={10} />} حفظ
                            </button>
                            <button onClick={() => { setAddingHwOpen(false); setNewHwTitle(''); }} className="px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-[11px] font-bold flex items-center gap-1">
                              <X size={10} /> إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setAddingHwOpen(true)} className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1">
                          <Plus size={12} /> إضافة واجب
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* Behavior detail */}
              <div>
                <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-2"><Heart size={14} className="text-orange-400" /> تقييم السلوك</h4>
                {behavior.length === 0 && !(canEditAcademic && !row.is_locked) ? (
                  <p className="text-xs text-slate-500 glass-light rounded-lg px-3 py-2">لم يسجل السلوك لهذا الطالب.</p>
                ) : (
                  <div className="space-y-1.5">
                    {behavior.map((b, i) => (
                      <div key={i} className="glass-light rounded-lg px-3 py-2 text-xs">
                        {canEditAcademic && !row.is_locked && editingBehaviorId === b.id ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <select value={editBehaviorRating} onChange={(e) => setEditBehaviorRating(e.target.value)} className="glass-light rounded px-1.5 py-1 text-[11px] text-white border border-white/10">
                                <option value="excellent" className="bg-slate-900">ممتاز</option>
                                <option value="participatory" className="bg-slate-900">مشارك</option>
                                <option value="quiet" className="bg-slate-900">هادئ</option>
                                <option value="needs_attention" className="bg-slate-900">يحتاج اهتمام</option>
                                <option value="disruptive" className="bg-slate-900">مزعج</option>
                              </select>
                              <button onClick={() => void saveBehaviorEdit(row, b.id, editBehaviorRating, editBehaviorNote)} className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                                {<Check size={10} />}
                              </button>
                              <button onClick={() => setEditingBehaviorId(null)} className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30">
                                <X size={10} />
                              </button>
                            </div>
                            <input type="text" value={editBehaviorNote} onChange={(e) => setEditBehaviorNote(e.target.value)} placeholder="ملاحظة (اختياري)" className="w-full glass-light rounded px-2 py-1 text-[11px] text-white border border-white/10" />
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-slate-300">{b.rating === 'excellent' ? 'ممتاز' : b.rating === 'participatory' ? 'مشارك' : b.rating === 'quiet' ? 'هادئ' : b.rating === 'needs_attention' ? 'يحتاج اهتمام' : b.rating === 'disruptive' ? 'مزعج' : b.rating ?? 'تقييم'}</span>
                              {b.note && <p className="text-[10px] text-slate-500 mt-0.5">{b.note}</p>}
                            </div>
                            {canEditAcademic && !row.is_locked && (
                              <div className="flex items-center gap-1">
                                <button onClick={() => { setEditingBehaviorId(b.id); setEditBehaviorRating(b.rating ?? 'excellent'); setEditBehaviorNote(b.note ?? ''); }} className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-emerald-400">
                                  <Edit2 size={10} />
                                </button>
                                <button onClick={() => setDeleteConfirm({ type: 'behavior', id: b.id, row, label: b.rating ?? 'تقييم سلوك' })} className="p-1 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400">
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {canEditAcademic && !row.is_locked && (
                      addingBehaviorOpen ? (
                        <div className="glass-light rounded-lg px-3 py-2.5 space-y-2">
                          <div className="flex items-center gap-2">
                            <select value={newBehaviorRating} onChange={(e) => setNewBehaviorRating(e.target.value)} className="glass-light rounded px-1.5 py-1 text-[11px] text-white border border-white/10">
                              <option value="excellent" className="bg-slate-900">ممتاز</option>
                              <option value="participatory" className="bg-slate-900">مشارك</option>
                              <option value="quiet" className="bg-slate-900">هادئ</option>
                              <option value="needs_attention" className="bg-slate-900">يحتاج اهتمام</option>
                              <option value="disruptive" className="bg-slate-900">مزعج</option>
                            </select>
                            <button onClick={() => void addBehaviorToArchive(row, s.id, s.group_id ?? null, newBehaviorRating, newBehaviorNote)} className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 text-[11px] font-bold flex items-center gap-1">
                              {<Check size={10} />} حفظ
                            </button>
                            <button onClick={() => { setAddingBehaviorOpen(false); setNewBehaviorNote(''); }} className="px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-[11px] font-bold flex items-center gap-1">
                              <X size={10} /> إلغاء
                            </button>
                          </div>
                          <input type="text" value={newBehaviorNote} onChange={(e) => setNewBehaviorNote(e.target.value)} placeholder="ملاحظة (اختياري)" className="w-full glass-light rounded px-2 py-1 text-[11px] text-white border border-white/10" />
                        </div>
                      ) : (
                        <button onClick={() => setAddingBehaviorOpen(true)} className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1">
                          <Plus size={12} /> إضافة تقييم سلوك
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* Historical payment button */}
              {remaining > 0 && !s.is_exempt && (
                <div className="pt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setDetailStudent(null);
                      openHistoricalPayment(s, row.archive_month);
                    }}
                  >
                    <Plus size={14} /> تسجيل دفعة متأخرة لهذا الشهر
                  </Button>
                </div>
              )}
            </div>


          </>
          );
        })()}
      </Modal>

      {/* Rollback confirmation */}
      <ConfirmDialog
        open={!!rollbackTarget}
        onClose={() => setRollbackTarget(null)}
        onConfirm={handleRollback}
        title="إلغاء الأرشفة / تراجع"
        subtext={`سيتم إلغاء أرشفة شهر ${rollbackTarget ? formatMonthLabel(rollbackTarget.archive_month) : ''} واستعادة جميع البيانات لحالة النشاط. سيتم حذف سجلات الترحيل المرتبطة بهذا الشهر. هل أنت متأكد؟`}
        confirmLabel="تأكيد إلغاء الأرشفة"
      />

      {/* Historical payment modal */}
      <Modal
        open={historicalOpen}
        onClose={() => { setHistoricalOpen(false); setPayTargetStudent(null); setHistoricalAmount(''); setHistoricalNote(''); }}
        title={`دفعة متأخرة — ${payTargetStudent?.name ?? ''}`}
        size="sm"
      >
        <div className="space-y-4">
          <div className="glass-light rounded-xl p-3 flex items-center gap-2">
            <Wallet size={16} className="text-emerald-400 flex-shrink-0" />
            <p className="text-[11px] text-emerald-300">
              تسجيل دفعة لشهر {historicalMonth ? formatMonthLabel(historicalMonth) : ''} المؤرشف — سيتم توثيقها في سجل النشاطات.
            </p>
          </div>
          {isMaster && payTargetStudent && (
            <div className="glass-light rounded-xl p-3 text-center">
              <p className="text-xs text-slate-400">المتبقي للطالب في هذا الشهر</p>
              <p className="text-lg font-bold text-amber-400">
                {formatCurrency(payTargetStudent.is_exempt ? 0 : (payTargetStudent.total_fees ?? 0) - (payTargetStudent.paid_fees ?? 0))} ج.م
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">المبلغ (ج.م)</label>
            <input
              type="number"
              value={historicalAmount}
              onChange={(e) => setHistoricalAmount(e.target.value)}
              placeholder="0"
              autoFocus
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">ملاحظة (اختياري)</label>
            <input
              type="text"
              value={historicalNote}
              onChange={(e) => setHistoricalNote(e.target.value)}
              placeholder="مثال: دفعة متأخرة من ولي الأمر"
              className={inputCls}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setHistoricalOpen(false); setPayTargetStudent(null); }}>إلغاء</Button>
            <Button onClick={handleHistoricalPayment} disabled={!historicalAmount || parseFloat(historicalAmount) <= 0}>
              {<Plus size={14} />}
              تسجيل الدفعة المتأخرة
            </Button>
          </div>
        </div>
      </Modal>

      {/* Archive receipt modal */}
      <Modal
        open={!!archiveReceipt}
        onClose={() => setArchiveReceipt(null)}
        title="إيصال الدفعة المتأخرة"
        size="sm"
      >
        {archiveReceipt && (
          <div className="space-y-4">
            <div className="glass-light rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">الطالب</span><span className="text-white font-bold">{archiveReceipt.studentName}</span></div>
              {archiveReceipt.groupName && <div className="flex justify-between"><span className="text-slate-400">المجموعة</span><span className="text-slate-200">{archiveReceipt.groupName}</span></div>}
              <div className="flex justify-between"><span className="text-slate-400">الشهر</span><span className="text-slate-200">{formatMonthLabel(archiveReceipt.month)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">المبلغ</span><span className="text-emerald-400 font-bold">{formatCurrency(archiveReceipt.amount)} ج.م</span></div>
              {archiveReceipt.totalPaidAfter !== undefined && (
                <div className="flex justify-between"><span className="text-slate-400">إجمالي المدفوع</span><span className="text-emerald-400 font-bold">{formatCurrency(archiveReceipt.totalPaidAfter)} ج.م</span></div>
              )}
              {archiveReceipt.remainingAfter !== undefined && archiveReceipt.baseSubscription ? (
                <div className="flex justify-between"><span className="text-slate-400">المتبقي</span><span className={archiveReceipt.remainingAfter <= 0 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>{formatCurrency(archiveReceipt.remainingAfter)} ج.م</span></div>
              ) : null}
              <div className="flex justify-between"><span className="text-slate-400">حالة الدفع</span><span className={`font-bold ${(archiveReceipt.remainingAfter ?? 0) <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>{(archiveReceipt.remainingAfter ?? 0) <= 0 ? 'مسدّد بالكامل' : 'سداد جزئي'}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">رقم الإيصال</span><span className="text-slate-300 font-mono text-xs">{archiveReceipt.receiptNumber}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">استلم بواسطة</span><span className="text-slate-200">{archiveReceipt.recordedBy}</span></div>
              {archiveReceipt.note && <div className="flex justify-between"><span className="text-slate-400">ملاحظة</span><span className="text-slate-200">{archiveReceipt.note}</span></div>}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setArchiveReceipt(null)}>إغلاق</Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  if (!archiveReceipt.paymentId || !archiveReceipt.studentId) { setArchiveReceipt(null); return; }
                  setWhatsappConfirm({
                    studentId: archiveReceipt.studentId,
                    groupId: allGroups.find((g) => g.id === (payTargetStudent?.group_id ?? archiveReceipt.studentId))?.id ?? null,
                    monthKey: archiveReceipt.month,
                    studentName: archiveReceipt.studentName,
                    parentPhone: archiveReceipt.parentPhone ?? null,
                    studentPhone: archiveReceipt.studentPhone ?? null,
                    paymentId: archiveReceipt.paymentId,
                    whatsappLink: buildArchiveReceiptWhatsAppLink(archiveReceipt),
                  });
                  setArchiveReceipt(null);
                }}
              >
                <Send size={16} /> إرسال واتساب
              </Button>
              <Button className="flex-1" onClick={() => printDocument(`إيصال ${archiveReceipt.receiptNumber}`, buildArchiveReceiptHTML(archiveReceipt))}><Printer size={16} /> طباعة</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* WhatsApp confirmation modal — user must explicitly approve sending */}
      <Modal
        open={!!whatsappConfirm}
        onClose={() => setWhatsappConfirm(null)}
        title="تأكيد سداد المصروفات عبر واتساب"
        size="sm"
      >
        {whatsappConfirm && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-300">
                تم تسجيل الدفع بنجاح للطالب <span className="font-bold">{whatsappConfirm.studentName}</span> لشهر <span className="font-bold">{formatMonthLabel(whatsappConfirm.monthKey)}</span>.
                هل تريد إرسال تذكير بالمصروفات لولي الأمر عبر واتساب؟
              </p>
            </div>
            {!whatsappConfirm.parentPhone && !whatsappConfirm.studentPhone && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 text-red-400 text-xs">
                <AlertTriangle size={14} />
                لا يوجد رقم هاتف مسجل لهذا الطالب — لا يمكن إرسال واتساب.
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setWhatsappConfirm(null)}>إلغاء</Button>
              <Button
                className="flex-1"
                onClick={handleConfirmWhatsApp}
                disabled={!whatsappConfirm.parentPhone && !whatsappConfirm.studentPhone}
              >
                <Send size={16} />
                إرسال عبر واتساب
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* PIN prompt */}
      <Modal
        open={pinPromptOpen}
        onClose={() => { setPinPromptOpen(false); setPinInput(''); setPinError(''); setLockTarget(null); setPendingAction(null); }}
        title="تأكيد الرقم السري للمدير"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Lock size={20} className="text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-300">
              {pendingAction === 'archive' && 'لتأكيد أرشفة هذا الشهر، أدخل الرقم السري للمدير.'}
              {pendingAction === 'lock' && 'لقفل الأرشيف وحمايته من التعديل، أدخل الرقم السري للمدير.'}
              {pendingAction === 'unlock' && 'لفتح قفل الأرشيف، أدخل الرقم السري للمدير.'}
            </p>
          </div>
          {pinError && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 text-red-400 text-xs">
              <AlertTriangle size={14} /> {pinError}
            </div>
          )}
          <input
            type="password"
            value={pinInput}
            onChange={(e) => { setPinInput(e.target.value); setPinError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { void confirmPinAction(); } }}
            className="w-full glass-light rounded-xl py-3 px-4 text-white text-center text-2xl tracking-[0.5em] border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
            placeholder="••••"
            inputMode="numeric"
            maxLength={8}
            autoFocus
          />
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setPinPromptOpen(false); setPinInput(''); setPinError(''); setLockTarget(null); setPendingAction(null); }}>إلغاء</Button>
            <Button onClick={() => void confirmPinAction()} disabled={!pinInput}>تأكيد</Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation for grades, exams, homework, behavior */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={async () => {
          if (!deleteConfirm) return;
          const { type, id, row } = deleteConfirm;
          setDeleteConfirm(null);
          if (type === 'grade') await deleteGradeFromArchive(row, id);
          else if (type === 'exam') await deleteExamFromArchive(row, id);
          else if (type === 'hw') await deleteHwFromArchive(row, id);
          else if (type === 'behavior') await deleteBehaviorFromArchive(row, id);
          else if (type === 'attendance') deleteAttendanceFromArchive(row, id);
        }}
        title={
          deleteConfirm?.type === 'exam'
            ? 'حذف التقييم'
            : deleteConfirm?.type === 'grade'
            ? 'حذف الدرجة'
            : deleteConfirm?.type === 'hw'
            ? 'حذف الواجب'
            : deleteConfirm?.type === 'attendance'
            ? 'حذف سجل الحضور'
            : 'حذف تقييم السلوك'
        }
        subtext={
          deleteConfirm?.type === 'exam'
            ? `سيتم حذف «${deleteConfirm?.label ?? ''}» وكل درجاته نهائياً. هل أنت متأكد؟`
            : deleteConfirm?.type === 'grade'
            ? `سيتم حذف الدرجة من «${deleteConfirm?.label ?? ''}» نهائياً. هل أنت متأكد؟`
            : deleteConfirm?.type === 'hw'
            ? `سيتم حذف الواجب «${deleteConfirm?.label ?? ''}» نهائياً. هل أنت متأكد؟`
            : deleteConfirm?.type === 'attendance'
            ? `سيتم حذف سجل الحضور بتاريخ «${deleteConfirm?.label ?? ''}» نهائياً. لن يتأثر الطالب أو باقي السجلات. هل أنت متأكد؟`
            : `سيتم حذف تقييم السلوك «${deleteConfirm?.label ?? ''}» نهائياً. هل أنت متأكد؟`
        }
        confirmLabel="تأكيد الحذف"
      />

      {/* Large student list modal — archive only */}
      <Modal
        open={!!studentListModal}
        onClose={() => { setStudentListModal(null); setModalStudentSearch(''); setModalStageFilter('all'); setModalGradeFilter('all'); }}
        title={
          studentListModal
            ? studentListModal.kind === 'paid'
              ? `الطلاب المسدّدون — ${formatMonthLabel(studentListModal.row.archive_month)}`
              : `الطلاب غير المسدّدين — ${formatMonthLabel(studentListModal.row.archive_month)}`
            : ''
        }
        size="xl"
      >
        {studentListModal && (() => {
          const isPaid = studentListModal.kind === 'paid';
          const q = modalStudentSearch.trim().toLowerCase();

          const enrichedGroups = allGroups as unknown as (Group & { grade_level?: { name?: string; stage?: { name?: string; sort_order?: number } } })[];

          const stageMap = new Map<string, { name: string; sort_order: number }>();
          for (const g of enrichedGroups) {
            const st = g.grade_level?.stage;
            if (st?.name && !stageMap.has(st.name)) {
              stageMap.set(st.name, { name: st.name, sort_order: st.sort_order ?? 999 });
            }
          }
          const stages = Array.from(stageMap.values()).sort((a, b) => a.sort_order - b.sort_order);

          const gradesForStage = modalStageFilter === 'all'
            ? []
            : Array.from(new Set(
                enrichedGroups
                  .filter((g) => g.grade_level?.stage?.name === modalStageFilter)
                  .map((g) => g.grade_level?.name)
                  .filter(Boolean)
              )).sort();

          const groupToStageName = new Map<string, string>();
          const groupToGradeName = new Map<string, string>();
          for (const g of enrichedGroups) {
            if (g.grade_level?.stage?.name) groupToStageName.set(g.id, g.grade_level.stage.name);
            if (g.grade_level?.name) groupToGradeName.set(g.id, g.grade_level.name);
          }

          const filtered = studentListModal.students.filter((s) => {
            if (q && !s.name.toLowerCase().includes(q)) return false;
            if (modalStageFilter !== 'all') {
              const stName = s.group_id ? groupToStageName.get(s.group_id) : undefined;
              if (stName !== modalStageFilter) return false;
            }
            if (modalGradeFilter !== 'all') {
              const glName = s.group_id ? groupToGradeName.get(s.group_id) : undefined;
              if (glName !== modalGradeFilter) return false;
            }
            return true;
          });

          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${isPaid ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                  {isPaid ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {isPaid ? 'مسدّد' : 'غير مسدّد'} — {filtered.length} طالب
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 max-w-xs">
                    <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={modalStudentSearch}
                      onChange={(e) => setModalStudentSearch(e.target.value)}
                      placeholder="بحث عن طالب…"
                      autoFocus
                      className="w-full glass-light rounded-xl py-2.5 pr-9 pl-4 text-sm text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
                    />
                  </div>
                  <PDFButton
                    label="تصدير PDF"
                    size="sm"
                    variant={isPaid ? 'secondary' : 'primary'}
                    disabled={filtered.length === 0}
                    onClick={async () => {
                      const monthLabel = formatMonthLabel(studentListModal.row.archive_month);
                      const grpName = selectedGroup?.name;
                      const studentsForExport = filtered.map((s) => {
                        const grp = allGroups.find((g) => g.id === s.group_id);
                        const gd = grp as (Group & { grade_level?: { name?: string; stage?: { name?: string } } }) | undefined;
                        return {
                          id: s.id,
                          name: s.name,
                          phone: s.phone ?? null,
                          parent_phone: s.parent_phone ?? null,
                          group_id: s.group_id ?? null,
                          group_name: grp?.name,
                          stage_name: gd?.grade_level?.stage?.name,
                          grade_name: gd?.grade_level?.name,
                          total_fees: s.total_fees ?? 0,
                          paid_fees: getPaidAmountForStudent(studentListModal.row, s.id),
                          is_exempt: s.is_exempt ?? false,
                        } as unknown as Student & { group_name?: string; stage_name?: string; grade_name?: string };
                      });
                      const paidMap = new Map<string, number>();
                      const exemptSet = new Set<string>();
                      for (const s of studentsForExport) {
                        paidMap.set(s.id, getPaidAmountForStudent(studentListModal.row, s.id));
                        if (s.is_exempt) exemptSet.add(s.id);
                      }
                      const meta = {
                        monthLabel,
                        groupName: grpName,
                        fileName: isPaid ? 'الطلاب_المسددون' : 'الطلاب_غير_المسددين',
                      };
                      return isPaid
                        ? exportPaidStudentsPDF(studentsForExport, paidMap, exemptSet, meta)
                        : exportUnpaidStudentsPDF(studentsForExport, paidMap, exemptSet, meta);
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-slate-400 font-bold">فلترة حسب المرحلة والصف:</span>
                <select
                  value={modalStageFilter}
                  onChange={(e) => { setModalStageFilter(e.target.value); setModalGradeFilter('all'); }}
                  className="glass-light rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none cursor-pointer"
                >
                  <option value="all">جميع الطلاب</option>
                  {stages.map((st) => <option key={st.name} value={st.name}>{st.name}</option>)}
                </select>
                {modalStageFilter !== 'all' && (
                  <select
                    value={modalGradeFilter}
                    onChange={(e) => setModalGradeFilter(e.target.value)}
                    className="glass-light rounded-lg px-2.5 py-1.5 text-xs text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none cursor-pointer"
                  >
                    <option value="all">كل الصفوف</option>
                    {gradesForStage.map((gn) => <option key={gn} value={gn}>{gn}</option>)}
                  </select>
                )}
                {(modalStageFilter !== 'all' || modalGradeFilter !== 'all') && (
                  <button
                    onClick={() => { setModalStageFilter('all'); setModalGradeFilter('all'); }}
                    className="text-[11px] text-sky-400 hover:text-sky-300 font-bold transition"
                  >
                    إعادة تعيين
                  </button>
                )}
              </div>

              {(() => {
                const filteredCollected = filtered.reduce((sum, s) => sum + getPaidAmountForStudent(studentListModal.row, s.id), 0);
                const filteredRemaining = filtered.reduce((sum, s) => sum + (s.is_exempt ? 0 : Math.max(0, (s.total_fees ?? 0) - getPaidAmountForStudent(studentListModal.row, s.id))), 0);
                const hasFilter = modalStageFilter !== 'all' || modalGradeFilter !== 'all';
                return (
                  <div className={`glass-light rounded-xl p-3 flex items-center justify-between ${hasFilter ? 'border border-sky-500/20' : ''}`}>
                    <div className="flex items-center gap-2">
                      <Wallet size={16} className={hasFilter ? 'text-sky-400' : 'text-emerald-400'} />
                      <span className="text-xs text-slate-400">
                        {hasFilter ? 'إجمالي المحصّل للصف المحدد' : 'إجمالي المحصّل للقائمة'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-bold ${hasFilter ? 'text-sky-400' : 'text-emerald-400'}`}>
                        {formatCurrency(filteredCollected)} ج.م
                      </span>
                      <span className="text-[10px] text-slate-500">
                        ({isPaid ? 'مسدّد' : `متبقي ${formatCurrency(filteredRemaining)} ج.م`})
                      </span>
                    </div>
                  </div>
                );
              })()}

              {filtered.length === 0 ? (
                <div className="glass-light rounded-xl p-10 text-center">
                  <Users className="mx-auto text-slate-600 mb-3" size={36} />
                  <p className="text-sm text-slate-400">لا يوجد طلاب مطابقون.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full text-right text-sm">
                    <thead className="glass-light text-[11px] text-slate-400 uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-3 font-bold">#</th>
                        <th className="px-4 py-3 font-bold">الطالب</th>
                        <th className="px-4 py-3 font-bold">المجموعة</th>
                        <th className="px-4 py-3 font-bold">المرحلة / الصف</th>
                        <th className="px-4 py-3 font-bold text-left">{isPaid ? 'المدفوع' : 'المتبقي'}</th>
                        <th className="px-4 py-3 font-bold text-center">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filtered.map((s, idx) => {
                        const grp = allGroups.find((g) => g.id === s.group_id);
                        const gd = grp as (Group & { grade_level?: { name?: string; stage?: { name?: string } } }) | undefined;
                        const studentPaid = getPaidAmountForStudent(studentListModal.row, s.id);
                        const remaining = s.is_exempt ? 0 : Math.max(0, (s.total_fees ?? 0) - studentPaid);
                        return (
                          <tr key={s.id} className="hover:bg-white/[0.03] transition">
                            <td className="px-4 py-3 text-slate-500 text-xs">{idx + 1}</td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setDetailStudent({ student: s, row: studentListModal.row })}
                                className="font-bold text-white hover:text-emerald-400 transition text-right"
                              >
                                {s.name}
                              </button>
                              {s.is_exempt && <span className="block text-[10px] text-sky-400 mt-0.5">معفى</span>}
                            </td>
                            <td className="px-4 py-3 text-slate-300 text-xs">{grp?.name ?? '—'}</td>
                            <td className="px-4 py-3 text-slate-400 text-xs">
                              {gd?.grade_level?.stage?.name ? `${gd.grade_level.stage.name} — ` : ''}
                              {gd?.grade_level?.name ?? '—'}
                            </td>
                            <td className={`px-4 py-3 text-left font-bold text-xs ${isPaid ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {isPaid ? `${formatCurrency(studentPaid)} ج.م` : `${formatCurrency(remaining)} ج.م`}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => setDetailStudent({ student: s, row: studentListModal.row })}
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 px-2.5 py-1 rounded-lg transition"
                                >
                                  <FileText size={12} /> عرض
                                </button>
                                {isMaster && !studentListModal.row.is_locked && (
                                  <button
                                    onClick={() => startArchiveEdit(s, studentListModal.row)}
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-lg transition"
                                  >
                                    <Edit2 size={12} /> تعديل
                                  </button>
                                )}
                                {isMaster && !s.is_deleted && (
                                  <button
                                    onClick={() => setArchiveTrashTarget(s)}
                                    className="inline-flex items-center gap-1 text-[11px] font-bold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1 rounded-lg transition"
                                    title="حذف الطالب (نقل للسلة)"
                                  >
                                    <Trash2 size={12} /> حذف
                                  </button>
                                )}
                                {!isPaid && !s.is_deleted && (s.phone || s.parent_phone) && (() => {
                                  const phone = normalizePhoneForWhatsApp(s.parent_phone ?? s.phone ?? '');
                                  if (!phone) return null;
                                  return (
                                    <button
                                      onClick={() => {
                                        if (reminderTarget?.student.id === s.id) return;
                                        const monthLabel = formatMonthLabel(studentListModal.row.archive_month);
                                        const msg =
                                          `السلام عليكم ورحمة الله وبركاته 🌷\n\n` +
                                          `ولي أمر الطالب/ة ${s.name} المحترم،\n\n` +
                                          `نذكّركم بكل احترام بأن مصروف شهر ${monthLabel} لم يتم تسجيل سداده حتى الآن.\n\n` +
                                          `نرجو من حضرتكم التكرم بمراجعة المبلغ المستحق وتسويته في الوقت المناسب، ولو تم السداد بالفعل نرجو تجاهل الرسالة، مع خالص الشكر والتقدير لتعاونكم.\n\n` +
                                          `مع تحيات\n` +
                                          `تيم مستر عمرو خالد – مدرس العلوم`;
                                        setReminderTarget({ student: s, monthLabel, remaining });
                                        setReminderMessage(msg);
                                      }}
                                      className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded-lg transition"
                                    >
                                      <Bell size={12} /> تذكير بالشهر
                                    </button>
                                  );
                                })()}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Soft-delete confirmation for archived student list */}
      <ConfirmDialog
        open={!!archiveTrashTarget}
        onClose={() => setArchiveTrashTarget(null)}
        onConfirm={async () => {
          if (!archiveTrashTarget) return;
          const actorName = isMaster ? 'المدرس' : (assistant?.display_name || assistant?.username || 'مساعد');
          try {
            await deleteStudent(archiveTrashTarget.id, actorName, isMaster ? 'master' : 'assistant');
            showToast(`تم نقل الطالب «${archiveTrashTarget.name}» إلى سلة المحذوفات`, 'success');
            setArchiveTrashTarget(null);
            invalidateByPrefix('archives_');
            if (studentListModal) {
              setStudentListModal({
                ...studentListModal,
                students: studentListModal.students.filter((st) => st.id !== archiveTrashTarget.id),
              });
            }
            void loadArchives();
          } catch {
            showToast('تعذّر حذف الطالب', 'error');
          }
        }}
        title="🗑️ حذف الطالب (نقل للسلة)"
        subtext={`هل أنت متأكد من حذف الطالب «${archiveTrashTarget?.name ?? ''}»؟ سيتم نقله إلى سلة المحذوفات واستبعاده من الإحصائيات مع الاحتفاظ بجميع سجلاته (مدفوعات، حضور، درجات). يمكن استعادته لاحقاً.`}
        confirmLabel="نقل للسلة"
      />

      {/* Archive Payment Edit Modal — direct payment editing */}
      <Modal
        open={!!archiveEditTarget}
        onClose={cancelArchiveEdit}
        title={`تعديل الدفعات — ${archiveEditTarget?.student.name ?? ''}`}
        size="md"
      >
        {archiveEditTarget && (() => {
          const { student, row } = archiveEditTarget;
          const grp = allGroups.find((g) => g.id === student.group_id);
          const totalFees = student.total_fees ?? 0;
          const totalAfterEdit = archiveEditPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
          const remainingAfter = Math.max(0, totalFees - totalAfterEdit);
          const statusAfter = student.is_exempt ? 'معفى' : totalAfterEdit >= totalFees ? 'مسدد بالكامل' : totalAfterEdit > 0 ? 'دفع جزئي' : 'غير مسدد';
          const availableMonths = archives.map((a) => a.archive_month).sort().reverse();
          return (
            <div className="space-y-4">
              <div className="glass-light rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-slate-400">الطالب:</span><span className="font-bold text-white">{student.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">الشهر:</span><span className="font-bold text-white">{formatMonthLabel(row.archive_month)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المجموعة:</span><span className="font-bold text-white">{grp?.name ?? '—'}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">إجمالي المطلوب:</span><span className="font-bold text-white">{formatCurrency(totalFees)} ج.م</span></div>
              </div>

              {archiveEditPayments.length === 0 ? (
                <div className="glass-light rounded-xl p-4 text-center">
                  <p className="text-sm text-slate-400">لا توجد دفعات مسجلة لهذا الطالب في هذا الشهر.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-white flex items-center gap-2"><Wallet size={16} className="text-amber-400" /> الدفعات المسجلة ({archiveEditPayments.length})</p>
                  {archiveEditPayments.map((p, idx) => (
                    <div key={p.id} className="glass-light rounded-xl p-3 space-y-2 border border-white/5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-500">دفعة #{idx + 1}</span>
                        <span className="text-[10px] text-slate-500 font-mono" dir="ltr">{p.id.slice(0, 12)}</span>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">المبلغ المدفوع (ج.م)</label>
                        <input
                          type="number"
                          value={p.amount}
                          onChange={(e) => setArchiveEditPayments((prev) => prev.map((pp) => pp.id === p.id ? { ...pp, amount: e.target.value } : pp))}
                          className={inputCls}
                          autoFocus={idx === 0}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">تاريخ الدفع</label>
                        <input
                          type="date"
                          value={p.payment_date}
                          onChange={(e) => setArchiveEditPayments((prev) => prev.map((pp) => pp.id === p.id ? { ...pp, payment_date: e.target.value } : pp))}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">شهر الدفعة</label>
                        <select
                          value={p.month_key}
                          onChange={(e) => setArchiveEditPayments((prev) => prev.map((pp) => pp.id === p.id ? { ...pp, month_key: e.target.value } : pp))}
                          className={inputCls}
                        >
                          {availableMonths.map((mk) => (
                            <option key={mk} value={mk} className="bg-slate-800">{formatMonthLabel(mk)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="glass-light rounded-xl p-3 space-y-1.5 text-xs border border-emerald-500/10">
                <p className="text-sm font-bold text-white mb-1">بعد التعديل:</p>
                <div className="flex justify-between"><span className="text-slate-400">إجمالي المدفوع:</span><span className="font-bold text-emerald-400">{formatCurrency(totalAfterEdit)} ج.م</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المتبقي:</span><span className="font-bold text-amber-400">{formatCurrency(remainingAfter)} ج.م</span></div>
                <div className="flex justify-between"><span className="text-slate-400">الحالة:</span><span className="font-bold text-white">{statusAfter}</span></div>
              </div>

              <div className="flex gap-3 justify-end">
                <Button variant="secondary" onClick={cancelArchiveEdit}>إلغاء</Button>
                <Button onClick={saveArchiveEdit} loading={archiveEditSaving}>حفظ التعديلات</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Pre-Archive Validation Issues Modal */}
      <Modal
        open={!!validationIssues}
        onClose={() => { setValidationIssues(null); setPendingArchiveMonth(null); }}
        title="تنبيه: مشاكل في البيانات قبل الأرشفة"
      >
        {validationIssues && (() => {
          const errors = validationIssues.filter((i) => i.severity === 'error');
          const warnings = validationIssues.filter((i) => i.severity === 'warning');
          const ISSUE_LABELS: Record<string, string> = {
            invalid_score: 'درجة غير صحيحة',
            missing_attendance: 'حضور ناقص',
            duplicate_rank: 'تكرار في الترتيب',
            broken_relation: 'علاقة مكسورة',
            orphan_grade: 'درجة بدون طالب',
            negative_fees: 'مبالغ مالية غير متوازنة',
          };
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertTriangle size={20} className="text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-300">
                  تم اكتشاف <span className="font-bold">{errors.length}</span> خطأ يمنع الأرشفة
                  {warnings.length > 0 && <> و <span className="font-bold">{warnings.length}</span> تنبيه يحتاج مراجعة</>}.
                  برجاء إصلاح الأخطاء أولاً لضمان نقل بيانات سليمة 100%.
                </p>
              </div>

              {errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                    <X size={14} /> أخطاء يجب إصلاحها ({errors.length})
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {errors.map((issue, idx) => (
                      <div key={idx} className="glass-light rounded-xl p-3 border border-red-500/10">
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                            {ISSUE_LABELS[issue.type] ?? issue.type}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-white font-semibold">{issue.group_name}</p>
                            {issue.student_name && <p className="text-[11px] text-slate-400 mt-0.5">الطالب: {issue.student_name}</p>}
                            <p className="text-[11px] text-slate-300 mt-1">{issue.detail}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {warnings.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle size={14} /> تنبيهات للمراجعة ({warnings.length})
                  </p>
                  <div className="space-y-2 max-h-36 overflow-y-auto">
                    {warnings.map((issue, idx) => (
                      <div key={idx} className="glass-light rounded-xl p-3 border border-amber-500/10">
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full flex-shrink-0">
                            {ISSUE_LABELS[issue.type] ?? issue.type}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-white font-semibold">{issue.group_name}</p>
                            {issue.student_name && <p className="text-[11px] text-slate-400 mt-0.5">الطالب: {issue.student_name}</p>}
                            <p className="text-[11px] text-slate-300 mt-1">{issue.detail}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" onClick={() => { setValidationIssues(null); setPendingArchiveMonth(null); }}>
                  إغلاق وإصلاح الأخطاء
                </Button>
                {errors.length === 0 && warnings.length > 0 && (
                  <Button onClick={() => void proceedArchiveDespiteWarnings()}>
                    متابعة الأرشفة رغم التنبيهات
                  </Button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Honor Board Modal — top 10 students for selected group + month */}
      <Modal
        open={honorBoardOpen}
        onClose={() => setHonorBoardOpen(false)}
        title="🏆 لوحة الشرف"
        size="md"
        zIndex={100000}
      >
        {(() => {
          if (!selectedGroup) {
            return <p className="text-sm text-slate-400 text-center py-4">برجاء اختيار مجموعة أولاً.</p>;
          }
          const groupArchives = archives.filter((a) => {
            const students = getArchivedStudents(a);
            return students.some((s) => s.group_id === selectedGroup.id);
          });
          if (groupArchives.length === 0) {
            return <p className="text-sm text-slate-400 text-center py-4">لا يوجد أرشيف لهذه المجموعة بعد.</p>;
          }
          const latestArchive = groupArchives[0];
          const rankings = computeGroupRankings(latestArchive);
          const groupStudents = getArchivedStudents(latestArchive).filter((s) => s.group_id === selectedGroup.id);
          const ranked = groupStudents
            .map((s) => {
              const r = rankings.get(s.id);
              return r ? { student: s, rank: r.rank, totalScore: r.totalScore, examCount: r.examCount } : null;
            })
            .filter((x): x is { student: ArchivedStudent; rank: number; totalScore: number; examCount: number } => x !== null)
            .sort((a, b) => a.rank - b.rank || a.student.id.localeCompare(b.student.id))
            .slice(0, 10);
          if (ranked.length === 0) {
            return (
              <div className="text-center py-6">
                <Award className="mx-auto text-slate-600 mb-3" size={32} />
                <p className="text-sm text-slate-400">لا توجد بيانات تقييم كافية لهذا الشهر لعرض لوحة الشرف.</p>
              </div>
            );
          }
          const monthLabel = formatMonthLabel(latestArchive.archive_month);
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between glass-light rounded-xl px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-emerald-400" />
                  <span className="text-xs text-slate-300 font-medium">{selectedGroup.name}</span>
                </div>
                <span className="text-xs text-slate-400">{monthLabel}</span>
              </div>
              <div className="space-y-2">
                {ranked.map((entry, idx) => {
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
                  const bgClass = idx === 0 ? 'bg-amber-500/10 border-amber-500/30' : idx === 1 ? 'bg-slate-300/10 border-slate-300/20' : idx === 2 ? 'bg-orange-600/10 border-orange-500/20' : 'glass-light border-white/5';
                  return (
                    <div key={entry.student.id} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${bgClass}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-lg font-black flex-shrink-0 w-8 text-center">{medal}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">{entry.student.name}</p>
                          <p className="text-[10px] text-slate-500">{entry.examCount} تقييم</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-black text-emerald-400">{entry.totalScore.toFixed(1)}</span>
                        <span className="text-[10px] text-slate-500">نقطة</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Monthly Reminder Confirmation Dialog */}
      <Modal
        open={!!reminderTarget}
        onClose={() => { setReminderTarget(null); setReminderMessage(''); }}
        title="تأكيد إرسال تذكير بالشهر"
        size="md"
      >
        {reminderTarget && (() => {
          const phone = normalizePhoneForWhatsApp(reminderTarget.student.parent_phone ?? reminderTarget.student.phone ?? '');
          const displayPhone = reminderTarget.student.parent_phone ?? reminderTarget.student.phone ?? '';
          return (
            <div className="space-y-4">
              <div className="glass-light rounded-xl p-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-slate-400">الطالب:</span><span className="font-bold text-white">{reminderTarget.student.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">الشهر المتأخر:</span><span className="font-bold text-amber-400">{reminderTarget.monthLabel}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المتبقي:</span><span className="font-bold text-amber-400">{formatCurrency(reminderTarget.remaining)} ج.م</span></div>
                <div className="flex justify-between"><span className="text-slate-400">رقم ولي الأمر:</span><span className="font-bold text-white" dir="ltr">{displayPhone || 'غير متوفر'}</span></div>
              </div>
              {!phone ? (
                <div className="glass-light rounded-xl p-4 text-center border border-red-500/20">
                  <p className="text-sm text-red-400">لا يوجد رقم هاتف صالح لولي الأمر. لا يمكن إرسال التذكير.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">الرسالة (قابلة للتعديل):</label>
                    <textarea
                      value={reminderMessage}
                      onChange={(e) => setReminderMessage(e.target.value)}
                      rows={9}
                      className="w-full glass-light rounded-xl p-3 text-sm text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition resize-none leading-relaxed"
                    />
                  </div>
                  <div className="flex gap-3 justify-end">
                    <Button variant="secondary" onClick={() => { setReminderTarget(null); setReminderMessage(''); }}>
                      إلغاء
                    </Button>
                    <Button
                      onClick={() => {
                        const url = `https://wa.me/${phone}?text=${encodeURIComponent(reminderMessage)}`;
                        openWhatsAppURL(url, showToast);
                        setReminderTarget(null);
                        setReminderMessage('');
                      }}
                    >
                      <Send size={14} /> تأكيد وإرسال واتساب
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Validating spinner overlay */}
      {validating && (
        <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="glass-card rounded-2xl px-6 py-5 flex items-center gap-3 pointer-events-auto">
            <RefreshCw size={20} className="text-emerald-400 animate-spin" />
            <span className="text-sm text-white font-semibold">جارٍ فحص البيانات قبل الأرشفة…</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, count, color, bg, icon: Icon }: { label: string; count: number; color: string; bg: string; icon: typeof CheckCircle2 }) {
  return (
    <div className={`rounded-xl border p-3 flex items-center gap-2 ${bg} border-white/5`}>
      <Icon className={color} size={16} />
      <div>
        <p className={`text-lg font-black ${color}`}>{count}</p>
        <p className="text-[10px] text-slate-400">{label}</p>
      </div>
    </div>
  );
}

function CountCard({ icon: Icon, label, count, color }: { icon: typeof Users; label: string; count: number; color: string }) {
  return (
    <div className="glass-light rounded-xl p-3 flex items-center gap-2.5">
      <Icon className={color} size={16} />
      <div>
        <p className={`text-base font-bold ${color}`}>{count}</p>
        <p className="text-[10px] text-slate-400">{label}</p>
      </div>
    </div>
  );
}
