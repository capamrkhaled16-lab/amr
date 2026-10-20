import { useState, useEffect, useMemo, useRef } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Plus, Pencil, Trash2, Phone, UserCircle, MessageCircle, AlertTriangle, CheckCircle2, Percent, Clock, UserMinus, UserX, ArrowRightLeft, Sparkles, CalendarCheck, CalendarClock, RotateCcw, Wallet, CalendarRange, Eye, Search, X, Send, CheckSquare, Square, FileText, RotateCcw as RestoreIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportStudentListPDF } from '@/lib/pdfExport';
import type { Student, Gender, Group, MonthlySubscription } from '@/lib/types';
import { createStudent, updateStudent, hardDeleteStudent, deleteStudent, restoreStudent, fetchTrashedStudents, setStudentStatus, checkDuplicateStudentName, fetchGradeLevelBaseSubscription, fetchGroups, fetchGroupsForTransfer, transferStudent, fetchGroupMonthlyPaidMap, upsertStudentMonthlyOverride, fetchStudentMonthlySubscriptions, getMonthKey, getMonthLabel, backfillAttendanceForNewStudent } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/context/AuthContext';
import { useMonth } from '@/context/MonthContext';
import WhatsAppReport from '@/components/modules/WhatsAppReport';
import BulkWhatsAppReport from '@/components/modules/BulkWhatsAppReport';
import ManualReportModal from '@/components/dashboard/ManualReportModal';
import StudentViewModal360 from '@/components/ui/StudentViewModal360';
import { formatArabicDate, formatCurrency } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type StudentManagerProps = {
  groupId: string;
  gradeLevelId: string | null;
  students: Student[];
  loading?: boolean;
  onRefresh: () => void;
};

export default function StudentManager({
  groupId,
  gradeLevelId,
  students,
  loading = false,
  onRefresh,
}: StudentManagerProps) {
  const { isMaster, assistant } = useAuth();
  const { showToast } = useToast();
  const [monthlyPaidMap, setMonthlyPaidMap] = useState<Map<string, number>>(new Map());
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Student | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedStudents, setTrashedStudents] = useState<Student[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<Student | null>(null);
  const [leftTarget, setLeftTarget] = useState<Student | null>(null);
  const [transferTarget, setTransferTarget] = useState<Student | null>(null);
  const [transferGroups, setTransferGroups] = useState<Group[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferGroupId, setTransferGroupId] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [whatsappTarget, setWhatsappTarget] = useState<Student | null>(null);
  const [manualReportTarget, setManualReportTarget] = useState<Student | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<Student | null>(null);
  const [overrideMonthKey, setOverrideMonthKey] = useState('');
  const [overrideAmount, setOverrideAmount] = useState('');
  const [overrideSubs, setOverrideSubs] = useState<MonthlySubscription[]>([]);
  const viewReqIdRef = useRef(0);
  const paidMapReqIdRef = useRef(0);
  const { monthKey } = useMonth();
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [adding, setAdding] = useState(false);
  const [baseFee, setBaseFee] = useState(0);
  const [isHalfMonth, setIsHalfMonth] = useState(false);
  const [isCustomFee, setIsCustomFee] = useState(false);
  const [markAsPaid, setMarkAsPaid] = useState(false);
  const [feeMode, setFeeMode] = useState<'full' | 'pro_rata' | 'deferred'>('full');
  const [joinDate, setJoinDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [form, setForm] = useState({
    name: '',
    phone: '',
    parent_phone: '',
    gender: 'male' as Gender,
    total_fees: '0',
    discount_type: '' as string,
    discount_amount: '0',
  });

  // Auto-fetch base price when grade changes
  useEffect(() => {
    if (!gradeLevelId) { setBaseFee(0); return; }
    fetchGradeLevelBaseSubscription(gradeLevelId).then((amount) => {
      setBaseFee(amount);
      if (!isCustomFee && !isHalfMonth) {
        setForm((prev) => ({ ...prev, total_fees: String(amount) }));
      }
    });
  }, [gradeLevelId]);

  // Fetch current-month paid map for accurate monthly financial status
  // Race-guarded: rapid group/month switches won't stamp stale data
  useEffect(() => {
    if (!groupId) return;
    const reqId = ++paidMapReqIdRef.current;
    fetchGroupMonthlyPaidMap(groupId, monthKey)
      .then((map) => {
        if (reqId === paidMapReqIdRef.current) setMonthlyPaidMap(map);
      })
      .catch(() => {
        if (reqId === paidMapReqIdRef.current) setMonthlyPaidMap(new Map());
      });
  }, [groupId, monthKey]);

  function resetForm() {
    setForm({ name: '', phone: '', parent_phone: '', gender: 'male', total_fees: '0', discount_type: '', discount_amount: '0' });
    setIsHalfMonth(false);
    setIsCustomFee(false);
    setMarkAsPaid(false);
    setFeeMode('full');
    setJoinDate(new Date().toISOString().slice(0, 10));
  }

  function openAdd() {
    resetForm();
    if (baseFee > 0) {
      setForm((prev) => ({ ...prev, total_fees: String(baseFee) }));
    }
    setAddOpen(true);
  }

  async function openView(s: Student) {
    const reqId = ++viewReqIdRef.current;
    setViewTarget(s);
    try {
      const { data: groupData } = await supabase
        .from('groups')
        .select('id, name, grade_level:grade_levels(id, name, stage:academic_stages(id, name))')
        .eq('id', s.group_id ?? groupId)
        .maybeSingle();
      if (reqId !== viewReqIdRef.current) return;
      const g = groupData as { id: string; name: string; grade_level: { id: string; name: string; stage: { id: string; name: string } } | null } | null;
      if (g) {
        setViewTarget({
          ...s,
          group_name: g.name,
          grade_name: g.grade_level?.name ?? undefined,
          stage_name: g.grade_level?.stage?.name ?? undefined,
        });
      }
    } catch {
      // keep the original student object — modal still works with basic data
    }
  }

  async function openEdit(s: Student) {
    setEditTarget(s);
    setForm({
      name: s.name,
      phone: s.phone ?? '',
      parent_phone: s.parent_phone ?? '',
      gender: s.gender,
      total_fees: String(s.total_fees ?? 0),
      discount_type: s.discount_type ?? '',
      discount_amount: String(s.discount_amount ?? 0),
    });
    setIsHalfMonth(false);
    setIsCustomFee(false);
    setMarkAsPaid(false);
  }

  function handleFeeChange(value: string) {
    setIsCustomFee(true);
    setIsHalfMonth(false);
    setForm((prev) => ({ ...prev, total_fees: value }));
  }

  function toggleHalfMonth() {
    if (isHalfMonth) {
      // Turning off: restore full base fee
      setIsHalfMonth(false);
      setForm((prev) => ({ ...prev, total_fees: String(baseFee) }));
    } else {
      // Turning on: set half the base fee
      setIsHalfMonth(true);
      setIsCustomFee(false);
      setForm((prev) => ({ ...prev, total_fees: String(Math.round(baseFee / 2)) }));
    }
  }

  function resetToBaseFee() {
    setIsCustomFee(false);
    setIsHalfMonth(false);
    setForm((prev) => ({ ...prev, total_fees: String(baseFee) }));
  }

  async function handleAdd() {
    if (!form.name.trim()) return;
    if (adding) return;
    const dup = await checkDuplicateStudentName(form.name.trim(), groupId);
    if (dup) { setNameError('هذا الاسم مسجل بالفعل في هذه المجموعة والمرحلة. برجاء اختيار اسم آخر.'); return; }
    setNameError('');
    setAdding(true);
    const joinDateStr = joinDate || new Date().toISOString().slice(0, 10);
    const enrollTimestamp = new Date(joinDateStr + 'T' + new Date().toTimeString().slice(0, 8)).toISOString();
    const joinMonthKey = enrollTimestamp.slice(0, 7);
    const joinDay = new Date(joinDateStr).getDate();
    const effectiveFeeMode = feeMode === 'full' && joinDay >= 20 ? 'deferred' : feeMode;
    const totalFees = effectiveFeeMode === 'deferred' ? 0 : (parseFloat(form.total_fees) || 0);
    const paidFees = markAsPaid ? totalFees : 0;
    try {
      const student = await createStudent({
        group_id: groupId,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        parent_phone: form.parent_phone.trim() || null,
        gender: form.gender,
        total_fees: totalFees,
        paid_fees: paidFees,
        discount_type: form.discount_type || null,
        discount_amount: parseFloat(form.discount_amount) || 0,
        enrollment_date: enrollTimestamp,
        fee_mode: effectiveFeeMode,
        join_month_key: joinMonthKey,
        pro_rata_sessions: 0,
      });
      if (!student) {
        showToast('تعذّر إضافة الطالب — تأكد من الاتصال بالخادم', 'error');
        return;
      }
      const modeNote = effectiveFeeMode === 'deferred'
        ? ' — تم ترحيل مصاريف الشهر للشهر التالي (انضمام متأخر)'
        : effectiveFeeMode === 'pro_rata'
        ? ' — احتساب بنظام الحصص الفعلية'
        : '';
      showToast(`تمت إضافة الطالب بنجاح — تاريخ الانضمام: ${enrollTimestamp.slice(0, 10)}${modeNote}`, 'success');
      resetForm();
      setAddOpen(false);
      try {
        const backfilled = await backfillAttendanceForNewStudent(student.id, groupId, enrollTimestamp);
        if (backfilled > 0) {
          showToast(`تم إضافة الطالب وتسجيل حضور ${backfilled} حصة سابقة`, 'success');
        }
      } catch { /* best-effort */ }
      onRefresh();
    } catch {
      showToast('تعذّر إضافة الطالب', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleEdit() {
    if (!editTarget) return;
    const dup = await checkDuplicateStudentName(form.name.trim(), groupId, editTarget.id);
    if (dup) { setNameError('هذا الاسم مسجل بالفعل في هذه المجموعة والمرحلة. برجاء اختيار اسم آخر.'); return; }
    setNameError('');
    const totalFees = parseFloat(form.total_fees) || 0;
    const updates: Partial<Student> = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      parent_phone: form.parent_phone.trim() || null,
      gender: form.gender,
      total_fees: totalFees,
      discount_type: form.discount_type || null,
      discount_amount: parseFloat(form.discount_amount) || 0,
    };
    if (markAsPaid) {
      updates.paid_fees = totalFees;
    }
    try {
      await updateStudent(editTarget.id, updates);
      showToast('تم حفظ تعديلات الطالب', 'success');
      setEditTarget(null);
      resetForm();
      onRefresh();
    } catch {
      showToast('تعذّر حفظ التعديلات', 'error');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const actorName = isMaster ? 'المدرس' : assistant?.display_name ?? assistant?.username ?? 'مساعد';
    try {
      await deleteStudent(deleteTarget.id, actorName, isMaster ? 'master' : 'assistant');
      showToast(`تم نقل الطالب «${deleteTarget.name}» إلى سلة المحذوفات — يمكن استعادته`, 'success');
      setDeleteTarget(null);
      onRefresh();
    } catch {
      showToast('تعذّر حذف الطالب', 'error');
    }
  }

  async function openTrash() {
    setTrashOpen(true);
    setTrashLoading(true);
    try {
      const trashed = await fetchTrashedStudents(groupId);
      setTrashedStudents(trashed);
    } catch {
      setTrashedStudents([]);
    } finally {
      setTrashLoading(false);
    }
  }

  async function handleRestore(studentId: string, studentName: string) {
    const actorName = isMaster ? 'المدرس' : assistant?.display_name ?? assistant?.username ?? 'مساعد';
    try {
      await restoreStudent(studentId, actorName, isMaster ? 'master' : 'assistant');
      showToast(`تمت استعادة الطالب «${studentName}» بنجاح`, 'success');
      setTrashedStudents((prev) => prev.filter((s) => s.id !== studentId));
      onRefresh();
    } catch {
      showToast('تعذّر استعادة الطالب', 'error');
    }
  }

  async function handlePermanentDelete() {
    if (!permanentDeleteTarget) return;
    const actorName = isMaster ? 'المدرس' : assistant?.display_name ?? assistant?.username ?? 'مساعد';
    try {
      await hardDeleteStudent(permanentDeleteTarget.id, actorName, isMaster ? 'master' : 'assistant');
      showToast(`تم الحذف النهائي للطالب «${permanentDeleteTarget.name}» وجميع سجلاته`, 'success');
      setTrashedStudents((prev) => prev.filter((s) => s.id !== permanentDeleteTarget.id));
      setPermanentDeleteTarget(null);
      onRefresh();
    } catch {
      showToast('تعذّر الحذف النهائي', 'error');
    }
  }

  async function handleMarkLeft() {
    if (!leftTarget) return;
    const actorName = isMaster ? 'المدرس' : assistant?.display_name ?? assistant?.username ?? 'مساعد';
    try {
      await setStudentStatus(leftTarget.id, 'left', actorName, isMaster ? 'master' : 'assistant');
      showToast('تم تحديد الطالب كمغادر', 'success');
      setLeftTarget(null);
      onRefresh();
    } catch {
      showToast('تعذّر تحديث الحالة', 'error');
    }
  }

  async function openTransfer(s: Student) {
    setTransferTarget(s);
    setTransferGroupId('');
    setTransferGroups([]);
    setTransferLoading(true);
    try {
      // Always fetch fresh from DB — never rely on stale prop or SWR cache
      let gid = gradeLevelId;
      if (!gid) {
        // Resolve grade from the student's actual group via DB
        const { data: groupData } = await supabase
          .from('groups')
          .select('grade_level_id')
          .eq('id', groupId)
          .maybeSingle();
        gid = (groupData as { grade_level_id: string } | null)?.grade_level_id ?? null;
      }
      if (gid) {
        const groups = await fetchGroupsForTransfer(gid, groupId);
        setTransferGroups(groups);
      }
    } catch {
      setTransferGroups([]);
    } finally {
      setTransferLoading(false);
    }
  }

  async function handleTransfer() {
    if (!transferTarget || !transferGroupId) return;
    const actorName = isMaster ? 'المدرس' : assistant?.display_name ?? assistant?.username ?? 'مساعد';
    setTransferring(true);
    try {
      await transferStudent(transferTarget.id, transferGroupId, actorName);
      showToast('تم نقل الطالب بنجاح مع الحفاظ على سجل الحضور والواجبات التاريخي', 'success');
      setTransferTarget(null);
      setTransferGroupId('');
      onRefresh();
    } catch {
      showToast('تعذّر نقل الطالب', 'error');
    } finally {
      setTransferring(false);
    }
  }

  async function openOverride(s: Student) {
    setOverrideTarget(s);
    const now = new Date();
    setOverrideMonthKey(getMonthKey(now));
    setOverrideAmount(String(s.total_fees ?? 0));
    const subs = await fetchStudentMonthlySubscriptions(s.id);
    setOverrideSubs(subs);
  }

  async function handleSaveOverride() {
    if (!overrideTarget || !overrideMonthKey || !overrideAmount) return;
    const amount = parseFloat(overrideAmount);
    if (isNaN(amount) || amount < 0) return;
    setOverrideSaving(true);
    const actorName = isMaster ? 'المدرس' : assistant?.display_name ?? assistant?.username ?? 'مساعد';
    const [y, m] = overrideMonthKey.split('-').map(Number);
    const monthLabel = `${['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][m - 1] ?? overrideMonthKey} ${y}`;
    try {
      await upsertStudentMonthlyOverride(overrideTarget.id, overrideMonthKey, monthLabel, amount, actorName);
      showToast(`تم تعديل مصروفات ${overrideTarget.name} لشهر ${monthLabel} إلى ${amount} ج.م`, 'success');
      setOverrideTarget(null);
      onRefresh();
    } catch {
      showToast('تعذّر حفظ التعديل', 'error');
    } finally {
      setOverrideSaving(false);
    }
  }

  const [localSearch, setLocalSearch] = useState('');
  const displayFee = parseFloat(form.total_fees) || 0;
  const isDiscounted = isCustomFee && baseFee > 0 && displayFee < baseFee;

  const filteredStudents = useMemo(() => {
    const q = localSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, localSearch]);

  const allFilteredSelected = filteredStudents.length > 0 && filteredStudents.every((s) => selectedIds.has(s.id));

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const s of filteredStudents) next.delete(s.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const s of filteredStudents) next.add(s.id);
        return next;
      });
    }
  }

  function toggleStudent(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedStudents = students.filter((s) => selectedIds.has(s.id));

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="text-lg font-bold text-white">قائمة الطلاب ({students.length})</h3>
        <div className="flex items-center gap-2">
          {students.length > 6 && (
            <div className="relative">
              <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="بحث في القائمة..."
                className="bg-white/[0.03] border border-white/[0.06] rounded-full py-1.5 pr-8 pl-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/40 transition w-36 sm:w-48"
              />
              {localSearch && (
                <button
                  onClick={() => setLocalSearch('')}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <button
            onClick={openTrash}
            className="p-2 rounded-xl glass-light hover:bg-amber-500/15 text-slate-400 hover:text-amber-400 transition relative"
            title="سلة المحذوفات"
          >
            <Trash2 size={16} />
          </button>
          <Button size="sm" onClick={openAdd}>
            <Plus size={16} />
            إضافة طالب
          </Button>
          <PDFButton
            label="تصدير PDF"
            size="sm"
            variant="secondary"
            disabled={filteredStudents.length === 0}
            onClick={async () => exportStudentListPDF(filteredStudents, {
              title: 'قائمة طلاب المجموعة',
            })}
          />
        </div>
      </div>

      {localSearch && filteredStudents.length !== students.length && (
        <p className="text-xs text-slate-400 mb-3">
          عرض {filteredStudents.length} من {students.length} طالب
        </p>
      )}

      {students.length > 0 && (
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-light text-xs font-semibold text-slate-200 hover:text-white hover:bg-white/10 transition"
          >
            {allFilteredSelected ? <CheckSquare size={14} className="text-emerald-400" /> : <Square size={14} />}
            {allFilteredSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
          </button>
          {selectedIds.size > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2"
            >
              <span className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                {selectedIds.size} طالب محدد
              </span>
              <Button size="sm" onClick={() => setBulkOpen(true)} className="bg-green-600 hover:bg-green-500">
                <Send size={14} /> إرسال تقارير واتساب
              </Button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-slate-400 hover:text-white transition px-2"
              >
                مسح التحديد
              </button>
            </motion.div>
          )}
        </div>
      )}

      {loading && students.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="glass-card h-[120px] shimmer bg-slate-100/60"
              style={{ animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
      ) : students.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center ring-1 ring-emerald-400/20">
              <Plus className="text-emerald-400" size={28} />
            </div>
            <div>
              <p className="text-white font-semibold text-sm mb-1">لا يوجد طلاب في هذه المجموعة بعد</p>
              <p className="text-slate-300 text-xs">ابدأ بإضافة أول طالب للمجموعة</p>
            </div>
            <Button size="sm" onClick={openAdd} className="gap-1.5 active:scale-95 transition">
              <Sparkles size={14} />
              إضافة طالب جديد
            </Button>
          </div>
        </div>
      ) : filteredStudents.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Search className="mx-auto text-slate-400 mb-3" size={32} />
          <p className="text-sm text-slate-200">لا يوجد طالب بهذا الاسم في هذه المجموعة.</p>
          <button onClick={() => setLocalSearch('')} className="text-xs text-emerald-400 hover:text-emerald-300 mt-2 underline">
            مسح البحث
          </button>
        </div>
      ) : (
        <div className="-mx-1 px-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence>
            {filteredStudents.map((s) => {
              const monthlyPaid = monthlyPaidMap.get(s.id) ?? 0;
              const isFullyPaid = s.is_exempt || (monthlyPaid >= (s.total_fees ?? 0) && (s.total_fees ?? 0) > 0);
              const hasDue = !s.is_exempt && monthlyPaid < (s.total_fees ?? 0) && (s.total_fees ?? 0) > 0;
              const statusColor = isFullyPaid
                ? 'border-emerald-500/40 ring-1 ring-emerald-500/20'
                : hasDue
                  ? 'border-red-500/40 ring-1 ring-red-500/20'
                  : 'border-white/10';
              return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`glass-card p-4 hover:ring-1 hover:ring-emerald-500/30 transition border ${statusColor}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => toggleStudent(s.id)}
                      className={`flex-shrink-0 p-0.5 rounded-lg transition ${selectedIds.has(s.id) ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
                      title="تحديد الطالب"
                    >
                      {selectedIds.has(s.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${s.gender === 'male' ? 'bg-blue-500/15 text-blue-300' : 'bg-pink-500/15 text-pink-300'}`}>
                      {s.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-white break-words leading-snug">{s.name}</p>
                        {s.enrollment_date && (() => {
                          const days = (Date.now() - new Date(s.enrollment_date).getTime()) / 86400000;
                          return days <= 14 ? <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-sky-300 bg-sky-500/15 px-1.5 py-0.5 rounded-full border border-sky-500/25 flex-shrink-0"><Sparkles size={8} /> حديث</span> : null;
                        })()}
                      </div>
                      <p className="text-xs text-slate-300">
                        {s.gender === 'male' ? 'ذكر' : 'أنثى'}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/25">
                          <Wallet size={9} /> الاشتراك الأساسي: {formatCurrency(s.total_fees ?? 0)} ج.م
                        </span>
                      </div>
                      {hasDue && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-red-400 bg-red-500/15 px-2 py-0.5 rounded-full border border-red-500/25">
                          <AlertTriangle size={10} /> متبقي {(s.total_fees ?? 0) - (monthlyPaidMap.get(s.id) ?? 0)} ج.م
                        </span>
                      )}
                      {isFullyPaid && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/25">
                          <CheckCircle2 size={10} /> مسدد كامل
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end max-w-full">
                    <button onClick={(e) => { e.stopPropagation(); openView(s); }} className="relative z-10 p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 transition active:scale-90" title="عرض">
                      <Eye size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setWhatsappTarget(s); }} className="relative z-10 p-1.5 rounded-lg hover:bg-green-500/15 text-slate-400 hover:text-green-400 transition" title="واتساب ولي الأمر">
                      <MessageCircle size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setManualReportTarget(s); }} className="relative z-10 p-1.5 rounded-lg hover:bg-teal-500/15 text-slate-400 hover:text-teal-400 transition" title="تقرير يدوي">
                      <FileText size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="relative z-10 p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-emerald-400 transition">
                      <Pencil size={14} />
                    </button>
                    {isMaster && (
                      <button onClick={(e) => { e.stopPropagation(); openOverride(s); }} className="relative z-10 p-1.5 rounded-lg hover:bg-violet-500/15 text-slate-400 hover:text-violet-400 transition" title="تعديل مصروفات شهر محدد">
                        <CalendarRange size={14} />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); openTransfer(s); }} className="relative z-10 p-1.5 rounded-lg hover:bg-blue-500/15 text-slate-400 hover:text-blue-400 transition" title="نقل لمجموعة أخرى">
                      <ArrowRightLeft size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setLeftTarget(s); }} className="relative z-10 p-1.5 rounded-lg hover:bg-amber-500/15 text-slate-400 hover:text-amber-400 transition" title="تحديد كمغادر">
                      <UserMinus size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); }} className="relative z-10 p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition" title="حذف (نقل للسلة)">
                      <UserX size={14} />
                    </button>
                  </div>
                </div>
                {(s.phone || s.parent_phone) && (
                  <div className="mt-3 space-y-1 text-xs text-slate-300">
                    {s.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone size={12} /> {s.phone}
                      </div>
                    )}
                    {s.parent_phone && (
                      <div className="flex items-center gap-1.5">
                        <UserCircle size={12} /> ولي الأمر: {s.parent_phone}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={addOpen || !!editTarget}
        onClose={() => { setAddOpen(false); setEditTarget(null); resetForm(); setNameError(''); }}
        title={editTarget ? 'تعديل بيانات الطالب' : 'إضافة طالب جديد'}
      >
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={editTarget ? handleEdit : handleAdd} disabled={!form.name.trim()}>{editTarget ? 'حفظ التعديلات' : 'إضافة'}</Button>
          </div>
          <Field label="اسم الطالب">
            <input type="text" value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setNameError(''); }} className={inputClass} placeholder="الاسم الكامل" />
            {nameError && <p className="text-red-400 text-xs mt-1.5 flex items-center gap-1"><AlertTriangle size={12} /> {nameError}</p>}
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="النوع">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, gender: 'male' })}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                    form.gender === 'male'
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30'
                      : 'glass-light text-slate-400 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  ذكر
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, gender: 'female' })}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                    form.gender === 'female'
                      ? 'bg-pink-600 text-white shadow-lg shadow-pink-900/30'
                      : 'glass-light text-slate-400 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  أنثى
                </button>
              </div>
            </Field>
            <Field label="المصاريف الكلية (ج.م)">
              <input
                type="number"
                value={form.total_fees}
                onChange={(e) => handleFeeChange(e.target.value)}
                className={inputClass}
                placeholder="0"
              />
              {baseFee > 0 && (
                <p className="text-[10px] text-slate-500 mt-1">
                  السعر الأساسي للصف: {baseFee} ج.م
                  {(isCustomFee || isHalfMonth) && (
                    <button onClick={resetToBaseFee} className="text-emerald-400 hover:text-emerald-300 mr-2 underline">
                      إعادة للسعر الأساسي
                    </button>
                  )}
                </p>
              )}
            </Field>
          </div>

          {/* Quick actions for fee adjustment */}
          {baseFee > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={toggleHalfMonth}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  isHalfMonth
                    ? 'bg-amber-600 text-white shadow-lg'
                    : 'glass-light text-slate-400 border border-white/10 hover:bg-white/10'
                }`}
              >
                <Clock size={14} /> نصف الشهر
              </button>
              {isDiscounted && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-1 rounded-full">
                  <Percent size={10} /> خصم مخصص — تم تطبيقه
                </span>
              )}
            </div>
          )}

          {/* Late-joiner fee mode */}
          {!editTarget && (
            <div className="glass-light rounded-xl p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <CalendarClock size={14} className="text-amber-400" />
                <p className="text-sm text-white font-medium">قاعدة احتساب الشهر الأول</p>
              </div>
              <p className="text-[11px] text-slate-400">للطلاب المنضمين في أواخر الشهر، يمكن تأجيل المصاريف أو احتسابها بالحصص الفعلية لتجنب ظهورهم في المتأخرات.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => { setFeeMode('full'); setForm((prev) => ({ ...prev, total_fees: String(baseFee) })); }}
                  className={`px-2 py-2.5 rounded-xl text-xs font-bold transition ${feeMode === 'full' ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400' : 'glass-light border border-white/10 text-slate-400'}`}
                >شهر كامل</button>
                <button
                  type="button"
                  onClick={() => { setFeeMode('pro_rata'); setIsCustomFee(true); }}
                  className={`px-2 py-2.5 rounded-xl text-xs font-bold transition ${feeMode === 'pro_rata' ? 'bg-amber-500/15 border border-amber-500/30 text-amber-400' : 'glass-light border border-white/10 text-slate-400'}`}
                >بالحصص الفعلية</button>
                <button
                  type="button"
                  onClick={() => { setFeeMode('deferred'); setForm((prev) => ({ ...prev, total_fees: '0' })); }}
                  className={`px-2 py-2.5 rounded-xl text-xs font-bold transition ${feeMode === 'deferred' ? 'bg-sky-500/15 border border-sky-500/30 text-sky-400' : 'glass-light border border-white/10 text-slate-400'}`}
                >ترحيل للشهر التالي</button>
              </div>
              {feeMode === 'pro_rata' && (
                <p className="text-[10px] text-amber-400 flex items-center gap-1"><Clock size={10} /> سيتم احتساب المصاريف بناءً على عدد الحصص التي حضرها الطالب في الشهر الأول — أدخل المبلغ التقديري الآن وعدّله لاحقاً حسب الحضور الفعلي.</p>
              )}
              {feeMode === 'deferred' && (
                <p className="text-[10px] text-sky-400 flex items-center gap-1"><RotateCcw size={10} /> لن يظهر الطالب في قائمة المتأخرات هذا الشهر — تبدأ المصاريف من الشهر التالي.</p>
              )}
            </div>
          )}

          {/* Mark as fully paid option */}
          <div className="glass-light rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-sm text-white font-medium">تسديد كامل عند التسجيل</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {markAsPaid
                  ? 'سيتم تسجيل الطالب كمسدد كامل بدون أي مديونية'
                  : 'سيتم تسجيل الطالب بدون تسديد (دفع لاحقاً)'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMarkAsPaid(!markAsPaid)}
              className={`relative w-12 h-6 rounded-full transition ${markAsPaid ? 'bg-emerald-600' : 'bg-slate-700'}`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${markAsPaid ? 'left-0.5' : 'left-6'}`}
              />
            </button>
          </div>

          {markAsPaid && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 rounded-xl p-3">
              <CheckCircle2 size={14} />
              سيتم اعتبار المبلغ ({displayFee} ج.م) مدفوعاً بالكامل — لا مديونية ولا أرصدة مستحقة.
            </div>
          )}

          <Field label="نوع الخصم">
            <select
              value={form.discount_type}
              onChange={(e) => setForm({ ...form, discount_type: e.target.value })}
              className={inputClass}
            >
              <option value="">بدون خصم</option>
              <option value="sibling">خصم أخوة</option>
              <option value="grant">منحة دراسية</option>
              <option value="special">خصم خاص</option>
            </select>
          </Field>
          {form.discount_type && (
            <Field label="قيمة الخصم (ج.م)">
              <input
                type="number"
                value={form.discount_amount}
                onChange={(e) => setForm({ ...form, discount_amount: e.target.value })}
                className={inputClass}
                placeholder="0"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                سيتم خصم هذا المبلغ تلقائياً من الاشتراك الشهري عند الاحتساب.
              </p>
            </Field>
          )}

          <Field label="هاتف الطالب">
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} placeholder="01xxxxxxxxx" />
          </Field>
          <Field label="هاتف ولي الأمر">
            <input type="tel" value={form.parent_phone} onChange={(e) => setForm({ ...form, parent_phone: e.target.value })} className={inputClass} placeholder="01xxxxxxxxx" />
          </Field>

          {!editTarget && (
            <Field label="تاريخ الانضمام">
              <input
                type="date"
                value={joinDate}
                onChange={(e) => setJoinDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
              <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                <CalendarCheck size={11} className="flex-shrink-0" />
                حدد تاريخ انضمام الطالب. عند اختيار تاريخ سابق، سيتم تسجيله في الحصص السابقة لهذا الشهر تلقائياً.
              </p>
            </Field>
          )}
          {editTarget?.enrollment_date && (
            <Field label="تاريخ الانضمام (تلقائي)">
              <div className="glass-light rounded-xl py-2.5 px-4 text-emerald-400 text-sm font-semibold flex items-center gap-2">
                <CalendarCheck size={14} />
                {formatArabicDate(editTarget.enrollment_date.slice(0, 10))}
                <span className="text-[10px] text-slate-500 font-normal">
                  — {new Date(editTarget.enrollment_date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </Field>
          )}
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null); resetForm(); setNameError(''); }}>إلغاء</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!leftTarget}
        onClose={() => setLeftTarget(null)}
        onConfirm={handleMarkLeft}
        title="🚪 تحديد الطالب كمغادر"
        subtext={`هل أنت متأكد من تحديد الطالب «${leftTarget?.name ?? ''}» كمغادر للسنتر؟ سيتم استبعاده تلقائياً من جميع الإحصائيات والعدادات مع الاحتفاظ بسجلاته للمراجعة.`}
        confirmLabel="تأكيد المغادرة"
      />

      {/* Transfer Student Modal */}
      <Modal
        open={!!transferTarget}
        onClose={() => setTransferTarget(null)}
        title={`نقل الطالب: ${transferTarget?.name ?? ''}`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            اختر المجموعة الجديدة لنقل الطالب إليها. سيتم الاحتفاظ بجميع سجلات الطالب السابقة (الحضور، الامتحانات، المدفوعات) كما هي.
          </p>
          <div>
            <label className="block text-sm text-slate-400 mb-2">المجموعة الجديدة</label>
            {transferLoading ? (
              <p className="text-xs text-sky-300 glass-light rounded-xl p-3 text-center">
                جارٍ تحميل المجموعات المتاحة...
              </p>
            ) : transferGroups.length === 0 ? (
              <p className="text-xs text-sky-300 glass-light rounded-xl p-3 text-center">
                لا توجد مجموعات أخرى متاحة في هذا الصف. أضف مجموعة جديدة أولاً.
              </p>
            ) : (
              <select
                value={transferGroupId}
                onChange={(e) => setTransferGroupId(e.target.value)}
                className="w-full glass-light rounded-xl py-3 px-4 text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm"
              >
                <option value="">-- اختر المجموعة --</option>
                {transferGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}{g.schedule ? ` (${g.schedule})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setTransferTarget(null)}>إلغاء</Button>
            <Button onClick={handleTransfer} disabled={transferring || !transferGroupId}>
              {transferring ? 'جارٍ النقل...' : 'تأكيد النقل'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="🗑️ نقل الطالب إلى سلة المحذوفات"
        subtext={`هل أنت متأكد من حذف الطالب «${deleteTarget?.name ?? ''}»؟ سيتم نقله إلى سلة المحذوفات واستبعاده من الإحصائيات مع الاحتفاظ بجميع سجلاته (مدفوعات، حضور، درجات). يمكن استعادته لاحقاً من السلة.`}
        confirmLabel="نقل للسلة"
      />

      {/* Trash bin modal */}
      <Modal
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        title="سلة المحذوفات"
        size="md"
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            الطلاب المحذوفون من هذه المجموعة. يمكن استعادتهم أو حذفهم نهائياً. الحذف النهائي يزيل جميع السجلات المرتبطة (مدفوعات، حضور، درجات، سلوك).
          </p>
          {trashLoading ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-slate-400">جارٍ التحميل...</span>
            </div>
          ) : trashedStudents.length === 0 ? (
            <div className="glass-light rounded-xl p-8 text-center">
              <Trash2 className="mx-auto text-slate-500 mb-3" size={28} />
              <p className="text-sm text-slate-300">سلة المحذوفات فارغة</p>
              <p className="text-xs text-slate-500 mt-1">لا يوجد طلاب محذوفون في هذه المجموعة</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {trashedStudents.map((s) => (
                <div
                  key={s.id}
                  className="glass-light rounded-xl p-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${s.gender === 'male' ? 'bg-blue-500/15 text-blue-300' : 'bg-pink-500/15 text-pink-300'}`}>
                      {s.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-white text-sm truncate">{s.name}</p>
                      {s.parent_phone && (
                        <p className="text-[10px] text-slate-400">ولي الأمر: {s.parent_phone}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleRestore(s.id, s.name)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold transition"
                      title="استعادة الطالب"
                    >
                      <RestoreIcon size={13} />
                      استعادة
                    </button>
                    <button
                      onClick={() => setPermanentDeleteTarget(s)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold transition"
                      title="حذف نهائي"
                    >
                      <Trash2 size={13} />
                      نهائي
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={() => setTrashOpen(false)}>إغلاق</Button>
          </div>
        </div>
      </Modal>

      {/* Permanent deletion — two-step confirmation */}
      <ConfirmDialog
        open={!!permanentDeleteTarget}
        onClose={() => setPermanentDeleteTarget(null)}
        onConfirm={handlePermanentDelete}
        title="⚠️ حذف نهائي لا يمكن التراجع عنه"
        subtext={`سيتم حذف الطالب «${permanentDeleteTarget?.name ?? ''}» وجميع سجلاته نهائياً (مدفوعات، حضور، درجات، سلوك، قاعة المشاهير). لا يمكن استعادة هذه البيانات بعد الحذف. هل أنت متأكد تماماً؟`}
        confirmLabel="حذف نهائي"
      />

      {/* Inline Fee Override Modal */}
      <Modal
        open={!!overrideTarget}
        onClose={() => setOverrideTarget(null)}
        title={`تعديل مصروفات شهر محدد: ${overrideTarget?.name ?? ''}`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            حدد الشهر والمبلغ المخصص لهذا الطالب. سيتم تطبيق هذا المبلغ فوراً في بوابة ولي الأمر دون الحاجة لإعادة إرسال الرابط.
          </p>
          <Field label="الشهر">
            <input
              type="month"
              value={overrideMonthKey}
              onChange={(e) => setOverrideMonthKey(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="المبلغ المخصص (ج.م)">
            <input
              type="number"
              value={overrideAmount}
              onChange={(e) => setOverrideAmount(e.target.value)}
              className={inputClass}
              placeholder="0"
            />
            {baseFee > 0 && (
              <p className="text-[10px] text-slate-500 mt-1">السعر الأساسي للصف: {baseFee} ج.م</p>
            )}
          </Field>
          {overrideSubs.length > 0 && (
            <div className="glass-light rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
              <p className="text-[11px] text-slate-400 font-bold mb-1">الاشتراكات الحالية:</p>
              {overrideSubs.map((sub) => (
                <div key={sub.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">{sub.month}</span>
                  <span className={sub.status === 'paid' ? 'text-emerald-400 font-bold' : sub.status === 'partial' ? 'text-amber-400 font-bold' : 'text-red-400 font-bold'}>
                    {formatCurrency(sub.amount_due)} ج.م — {sub.status === 'paid' ? 'مسدد' : sub.status === 'partial' ? 'سداد جزئي' : 'غير مسدد'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setOverrideTarget(null)}>إلغاء</Button>
            <Button onClick={handleSaveOverride} disabled={overrideSaving || !overrideMonthKey || !overrideAmount}>
              {overrideSaving ? 'جارٍ الحفظ...' : 'حفظ التعديل'}
            </Button>
          </div>
        </div>
      </Modal>

      <WhatsAppReport
        student={whatsappTarget ?? ({} as Student)}
        open={!!whatsappTarget}
        onClose={() => setWhatsappTarget(null)}
      />

      <ManualReportModal
        student={manualReportTarget}
        open={!!manualReportTarget}
        onClose={() => setManualReportTarget(null)}
      />

      <BulkWhatsAppReport
        students={selectedStudents}
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
      />

      <StudentViewModal360
        open={!!viewTarget}
        student={viewTarget}
        onClose={() => setViewTarget(null)}
      />
    </div>
  );
}

const inputClass =
  'w-full glass-light rounded-xl py-2.5 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
