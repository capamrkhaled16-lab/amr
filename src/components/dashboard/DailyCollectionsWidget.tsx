import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Wallet, Clock, Calendar, ChevronLeft, ChevronRight, RefreshCw, TrendingUp, Users, ArrowRight, X, Search, Filter, CheckCircle2, Edit2, Trash2, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatArabicDate, formatTime, formatTransactionDateTime, todayDateString } from '@/lib/format';
import { currentMonthKey } from '@/lib/data';
import { eventBus } from '@/lib/eventBus';
import { usePersistedState } from '@/hooks/usePersistedState';
import type { Payment, Student } from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';
import { editPayment, deletePaymentWithAudit } from '@/lib/data';
import { useToast } from '@/components/ui/Toast';
import StudentViewModal360 from '@/components/ui/StudentViewModal360';

type CollectionRow = Payment & {
  student: {
    id: string;
    name: string;
    phone: string | null;
    parent_phone: string | null;
    gender: string | null;
    enrollment_date: string;
    total_fees: number;
    paid_fees: number;
    is_exempt: boolean;
    parent_token: string;
    status: string;
    group: {
      id: string;
      name: string;
      grade_level: {
        id: string;
        name: string;
        stage: { id: string; name: string } | null;
      } | null;
    } | null;
  } | null;
};

type Props = {
  isMaster: boolean;
  /** When provided, renders as an embedded full-page view with a back button instead of a modal trigger button. */
  onBack?: () => void;
};

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export default function DailyCollectionsWidget({ isMaster, onBack }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedDate, setSelectedDate] = useState(todayDateString());
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [todayTotal, setTodayTotal] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [detailStudent, setDetailStudent] = useState<Student | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRow, setDetailRow] = useState<CollectionRow | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [filterCollector, setFilterCollector] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [accountingDate, setAccountingDate] = usePersistedState<string>('accounting_checkpoint_date', '');
  const [showAccounting, setShowAccounting] = useState(false);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollPos = useRef(0);
  const loadDayReqId = useRef(0);
  const [editTarget, setEditTarget] = useState<CollectionRow | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CollectionRow | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [profileTarget, setProfileTarget] = useState<Student | null>(null);
  const { showToast } = useToast();

  async function handleEditPayment() {
    if (!editTarget) return;
    const amount = parseFloat(editAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setEditSaving(true);
    try {
      await editPayment(editTarget.id, amount, editNote.trim() || null, 'المدرس', 'master');
      showToast('تم تعديل العملية بنجاح', 'success');
      setEditTarget(null);
      setEditAmount('');
      setEditNote('');
      await loadDay(selectedDate);
      await loadTodaySummary();
    } catch (err) {
      showToast(`فشل تعديل العملية: ${err instanceof Error ? err.message : 'تعذّر الاتصال بقاعدة البيانات'}. حاول مرة أخرى.`, 'error');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeletePayment() {
    if (!deleteTarget) return;
    setDeleteSaving(true);
    try {
      await deletePaymentWithAudit(deleteTarget.id, 'المدرس', 'master');
      showToast('تم حذف العملية بنجاح', 'success');
      setDeleteTarget(null);
      await loadDay(selectedDate);
      await loadTodaySummary();
    } catch (err) {
      showToast(`فشل حذف العملية: ${err instanceof Error ? err.message : 'تعذّر الاتصال بقاعدة البيانات'}. حاول مرة أخرى.`, 'error');
    } finally {
      setDeleteSaving(false);
    }
  }

  const embedded = onBack !== undefined;

  const loadDay = useCallback(async (dateStr: string) => {
    const reqId = ++loadDayReqId.current;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('payments')
        .select(`
          id, amount, payment_date, recorded_at, recorded_by, note, month_key,
          receipt_number, is_historical_payment, target_archive_month, created_at,
          student:students(
            id, name, phone, parent_phone, gender, enrollment_date,
            total_fees, paid_fees, is_exempt, parent_token, status,
            group:groups(
              id, name,
              grade_level:grade_levels(
                id, name,
                stage:academic_stages(id, name)
              )
            )
          )
        `)
        .eq('payment_date', dateStr)
        .eq('is_deleted', false)
        .gt('amount', 0)
        .order('recorded_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      if (reqId !== loadDayReqId.current) return;
      setRows((data as unknown as CollectionRow[]) ?? []);
    } catch {
      if (reqId === loadDayReqId.current) {
        // keep existing rows on transient error
      }
    } finally {
      if (reqId === loadDayReqId.current) setLoading(false);
    }
  }, []);

  const loadTodaySummary = useCallback(async () => {
    try {
      const today = todayDateString();
      const { data, error } = await supabase
        .from('payments')
        .select('amount')
        .eq('payment_date', today)
        .eq('is_deleted', false)
        .gt('amount', 0);
      if (error) throw error;
      const amounts = (data ?? []) as { amount: number }[];
      setTodayTotal(amounts.reduce((s, p) => s + (p.amount ?? 0), 0));
      setTodayCount(amounts.length);
    } catch {
      // keep existing summary on transient error
    }
  }, []);

  useEffect(() => {
    loadTodaySummary();
  }, [loadTodaySummary]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel('daily-collections-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          loadTodaySummary();
          const shouldReload = embedded || (open && view === 'list');
          if (shouldReload) loadDay(selectedDate);
        }, 500);
      })
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [loadTodaySummary, loadDay, open, view, selectedDate, embedded]);

  // Instant sync via eventBus — fires synchronously when a payment is created
  // in FinancesModule, so today's total updates without waiting for realtime.
  useEffect(() => {
    const off = eventBus.on('payments:changed', () => {
      loadTodaySummary();
      if (embedded || (open && view === 'list')) loadDay(selectedDate);
    });
    return off;
  }, [loadTodaySummary, loadDay, open, view, selectedDate, embedded]);

  useEffect(() => {
    if (embedded) {
      setView('list');
      setSelectedDate(todayDateString());
      loadDay(todayDateString());
    }
  }, [embedded, loadDay]);

  useEffect(() => {
    if (open) {
      setView('list');
      setSelectedDate(todayDateString());
      loadDay(todayDateString());
    }
  }, [open, loadDay]);

  // Reload when selectedDate changes (prev/next day, quick buttons, date picker)
  useEffect(() => {
    if (embedded || open) {
      loadDay(selectedDate);
    }
  }, [selectedDate, embedded, open, loadDay]);

  const dayTotal = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const isToday = selectedDate === todayDateString();

  // Collectors from loaded rows
  const collectors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.recorded_by) set.add(r.recorded_by);
    }
    return [...set].sort();
  }, [rows]);

  // Stages, grades, groups from loaded rows
  const stages = useMemo(() => [...new Set(rows.map((r) => r.student?.group?.grade_level?.stage?.name).filter(Boolean))] as string[], [rows]);
  const grades = useMemo(() => [...new Set(rows.map((r) => r.student?.group?.grade_level?.name).filter(Boolean))] as string[], [rows]);
  const groups = useMemo(() => [...new Set(rows.map((r) => r.student?.group?.name).filter(Boolean))] as string[], [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const name = r.student?.name?.toLowerCase() ?? '';
        const phone = (r.student?.phone ?? r.student?.parent_phone ?? '').toLowerCase();
        const sid = r.student?.id ?? '';
        if (!name.includes(q) && !phone.includes(q) && !sid.includes(q)) return false;
      }
      if (filterStage && r.student?.group?.grade_level?.stage?.name !== filterStage) return false;
      if (filterGrade && r.student?.group?.grade_level?.name !== filterGrade) return false;
      if (filterGroup && r.student?.group?.name !== filterGroup) return false;
      if (filterCollector && r.recorded_by !== filterCollector) return false;
      return true;
    });
  }, [rows, searchQuery, filterStage, filterGrade, filterGroup, filterCollector]);

  const filteredTotal = filteredRows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const hasFilters = searchQuery || filterStage || filterGrade || filterGroup || filterCollector;

  function clearFilters() {
    setSearchQuery('');
    setFilterStage('');
    setFilterGrade('');
    setFilterGroup('');
    setFilterCollector('');
  }

  // Accounting: payments before accounting date vs after
  const beforeAccounting = useMemo(() => {
    if (!accountingDate) return null;
    return rows.filter((r) => r.payment_date <= accountingDate);
  }, [rows, accountingDate]);
  const afterAccounting = useMemo(() => {
    if (!accountingDate) return null;
    return rows.filter((r) => r.payment_date > accountingDate);
  }, [rows, accountingDate]);

  async function openStudentDetail(row: CollectionRow) {
    if (!row.student) return;
    savedScrollPos.current = listScrollRef.current?.scrollTop ?? 0;
    setDetailRow(row);
    setView('detail');
    setDetailLoading(true);

    const [studentRes, monthPaymentsRes] = await Promise.all([
      supabase
        .from('students')
        .select('id, group_id, name, phone, parent_phone, gender, parent_token, enrollment_date, total_fees, paid_fees, is_deleted, status, discount_type, discount_amount, is_exempt, discount_mode, discount_percent, fee_mode, pro_rata_sessions, join_month_key, created_at')
        .eq('id', row.student.id)
        .single(),
      supabase
        .from('payments')
        .select('amount')
        .eq('student_id', row.student.id)
        .eq('is_deleted', false)
        .eq('is_historical_payment', false)
        .gt('amount', 0)
        .eq('month_key', row.month_key ?? currentMonthKey()),
    ]);

    const studentData = studentRes.data as Student | null;
    if (studentData && monthPaymentsRes.data) {
      const monthPaid = (monthPaymentsRes.data as { amount: number }[]).reduce((s, p) => s + (p.amount ?? 0), 0);
      // Override paid_fees with month-scoped verified amount so the detail view
      // shows only what was actually collected THIS month, not cumulative across all months
      (studentData as Student & { paid_fees: number }).paid_fees = monthPaid;
    }

    setDetailStudent(studentData);
    setDetailLoading(false);
  }

  function backToList() {
    setView('list');
    setDetailStudent(null);
    setDetailRow(null);
    requestAnimationFrame(() => {
      if (listScrollRef.current) {
        listScrollRef.current.scrollTop = savedScrollPos.current;
      }
    });
  }

  function handleClose() {
    setOpen(false);
    setTimeout(() => {
      setView('list');
      setDetailStudent(null);
      setDetailRow(null);
    }, 300);
  }

  if (!isMaster) return null;

  /* ── Embedded full-page mode ── */
  if (embedded) {
    return (
      <>
      <div className="glass-card rounded-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/[0.06] flex-shrink-0">
          {view === 'detail' ? (
            <button
              onClick={backToList}
              className="flex items-center gap-2 px-3 py-2 rounded-xl glass-light hover:bg-white/10 text-slate-300 hover:text-amber-400 transition text-sm font-bold"
            >
              <ArrowRight size={18} />
              رجوع للقائمة
            </button>
          ) : (
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-3 py-2 rounded-xl glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 transition text-sm font-bold"
            >
              <ArrowRight size={18} />
              رجوع
            </button>
          )}
          <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <Wallet size={20} className="text-amber-400" />
            المبالغ المحصلة اليوم
          </h3>
        </div>

        {/* Content */}
        {view === 'list' ? (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Date navigator + summary */}
            <div className="flex-shrink-0 p-4 sm:p-5 space-y-3 border-b border-white/[0.06]">
              <div className="flex items-center justify-between glass-light rounded-xl p-3">
                <button
                  onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
                  className="p-2 rounded-lg hover:bg-white/10 text-slate-300 transition active:scale-90"
                  title="اليوم السابق"
                >
                  <ChevronRight size={18} />
                </button>
                <div className="text-center flex-1">
                  <div className="flex items-center justify-center gap-2">
                    <Calendar size={14} className="text-amber-400" />
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      max={todayDateString()}
                      className="bg-transparent text-sm font-bold text-white text-center outline-none cursor-pointer"
                      style={{ colorScheme: 'dark' }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {isToday ? 'تحصيل اليوم' : formatArabicDate(selectedDate)}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
                  disabled={isToday}
                  className="p-2 rounded-lg hover:bg-white/10 text-slate-300 transition disabled:opacity-30 active:scale-90"
                  title="اليوم التالي"
                >
                  <ChevronLeft size={18} />
                </button>
              </div>

              {/* Quick day buttons */}
              <div className="flex gap-2">
                {[
                  { label: 'اليوم', offset: 0 },
                  { label: 'أمس', offset: -1 },
                  { label: 'أول أمس', offset: -2 },
                ].map((d) => {
                  const target = shiftDate(todayDateString(), d.offset);
                  const active = selectedDate === target;
                  return (
                    <button
                      key={d.offset}
                      onClick={() => setSelectedDate(target)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition active:scale-95 ${active ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'glass-light text-slate-400 hover:text-white hover:bg-white/10'}`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>

              {/* Day total + count */}
              <div className="relative bg-gradient-to-br from-amber-600/20 via-amber-500/10 to-transparent rounded-2xl p-4 border border-amber-500/20 overflow-hidden">
                <div className="absolute -top-10 -left-10 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <p className="text-xs text-amber-300/70 mb-1 flex items-center gap-1.5">
                      <TrendingUp size={12} /> إجمالي المحصل
                    </p>
                    <p className="text-2xl font-black text-amber-400">{formatCurrency(hasFilters ? filteredTotal : dayTotal)} <span className="text-sm">ج.م</span></p>
                  </div>
                  <div className="text-left">
                    <p className="text-xs text-slate-400 mb-1 flex items-center gap-1 justify-end">
                      <Users size={12} /> عدد العمليات
                    </p>
                    <p className="text-2xl font-black text-white">{rows.length}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">العمليات مرتبة من الأحدث للأقدم</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAccounting(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 transition text-xs font-bold"
                    title="نقطة المحاسبة"
                  >
                    <CheckCircle2 size={12} />
                    {accountingDate ? `محاسبة حتى ${formatArabicDate(accountingDate)}` : 'محاسبة'}
                  </button>
                  <button
                    onClick={() => loadDay(selectedDate)}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-amber-400 transition text-xs font-bold disabled:opacity-50 active:scale-95"
                  >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                    تحديث
                  </button>
                </div>
              </div>

              {/* Smart search + filters */}
              <div className="space-y-2">
                <div className="relative">
                  <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="بحث: اسم الطالب، رقم الهاتف، ID..."
                    className="w-full pr-9 pl-3 py-2.5 rounded-xl glass-light text-xs text-white placeholder:text-slate-500 border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setShowFilters((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition ${showFilters || hasFilters ? 'bg-amber-500/15 text-amber-400' : 'glass-light text-slate-400 hover:text-white'}`}
                  >
                    <Filter size={11} /> فلترة
                    {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  </button>
                  {hasFilters && (
                    <button
                      onClick={clearFilters}
                      className="text-[10px] font-bold text-red-400 hover:text-red-300 transition px-2 py-1"
                    >
                      مسح الفلاتر
                    </button>
                  )}
                </div>
                {showFilters && (
                  <div className="grid grid-cols-2 gap-2 p-2 glass-light rounded-xl">
                    <FilterSelect label="المرحلة" value={filterStage} options={stages} onChange={setFilterStage} />
                    <FilterSelect label="الصف" value={filterGrade} options={grades} onChange={setFilterGrade} />
                    <FilterSelect label="المجموعة" value={filterGroup} options={groups} onChange={setFilterGroup} />
                    <FilterSelect label="المحصّل" value={filterCollector} options={collectors} onChange={setFilterCollector} />
                  </div>
                )}
              </div>
            </div>

            {/* Scrollable transactions list */}
            <div
              ref={listScrollRef}
              className="flex-1 overflow-y-auto p-4 sm:p-5 pt-3 modal-body"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="glass-light rounded-xl p-3 flex items-center gap-3">
                      <Skeleton className="w-9 h-9 rounded-xl flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="glass-light rounded-xl p-8 text-center">
                  <Wallet className="mx-auto text-slate-600 mb-3" size={40} />
                  <p className="text-sm text-slate-400">{hasFilters ? 'لا توجد بيانات مطابقة للفلاتر الحالية.' : 'لا توجد عمليات تحصيل في هذا اليوم.'}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredRows.map((r, idx) => {
                    const studentName = r.student?.name ?? 'طالب';
                    const time = r.recorded_at ? formatTime(r.recorded_at) : '—';
                    const isLate = r.is_historical_payment;
                    const monthLabel = r.target_archive_month ?? r.month_key ?? '—';
                    const groupName = r.student?.group?.name ?? '—';
                    const gradeName = r.student?.group?.grade_level?.name ?? '—';
                    const stageName = r.student?.group?.grade_level?.stage?.name ?? '—';
                    return (
                      <div
                        key={r.id}
                        className="w-full glass-light rounded-xl p-3 flex items-start gap-3 hover:bg-white/[0.08] transition"
                      >
                        <button
                          onClick={() => openStudentDetail(r)}
                          className="flex-1 min-w-0 text-right flex items-start gap-3 active:scale-[0.98] cursor-pointer"
                        >
                        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center text-xs font-black text-amber-400">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-white text-sm">{studentName}</span>
                            <span className="text-sm font-black text-amber-400">{formatCurrency(r.amount)} ج.م</span>
                            {isLate && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400">متأخر</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-1 flex-wrap">
                            <span className="flex items-center gap-1"><Clock size={10} /> {time}</span>
                            {r.recorded_by && <span>• سجّلها: {r.recorded_by}</span>}
                            <span>• شهر: {monthLabel}</span>
                            {r.receipt_number && <span className="text-emerald-500">• إيصال: {r.receipt_number}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                            <span className="text-slate-400">{stageName}</span>
                            <span className="text-slate-600">›</span>
                            <span className="text-slate-400">{gradeName}</span>
                            <span className="text-slate-600">›</span>
                            <span className="text-slate-400">{groupName}</span>
                          </div>
                          {r.note && <p className="text-[10px] text-slate-500 mt-0.5">{r.note}</p>}
                        </div>
                        </button>
                        <div className="flex flex-col gap-1 flex-shrink-0 mt-1">
                          <button onClick={(e) => { e.stopPropagation(); setProfileTarget(r.student as unknown as Student); }} className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 transition" title="عرض الملف"><Eye size={13} /></button>
                          <button onClick={(e) => { e.stopPropagation(); setEditTarget(r); setEditAmount(String(r.amount)); setEditNote(r.note ?? ''); }} className="p-1.5 rounded-lg hover:bg-amber-500/15 text-slate-400 hover:text-amber-400 transition" title="تعديل"><Edit2 size={13} /></button>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }} className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition" title="حذف"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Detail view */
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 modal-body">
            {detailLoading ? (
              <div className="space-y-4">
                <div className="glass-light rounded-2xl p-5 flex items-center gap-4">
                  <Skeleton className="w-16 h-16 rounded-2xl flex-shrink-0" />
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-20 rounded-xl" />
                  <Skeleton className="h-20 rounded-xl" />
                </div>
                <Skeleton className="h-32 rounded-2xl" />
              </div>
            ) : detailStudent ? (
              <div className="space-y-4">
                {detailRow && (
                  <div className="bg-gradient-to-br from-amber-600/20 via-amber-500/10 to-transparent rounded-2xl p-4 border border-amber-500/20">
                    <p className="text-xs text-amber-300/70 mb-1">تفاصيل العملية</p>
                    <div className="flex items-center justify-between">
                      <p className="text-2xl font-black text-amber-400">{formatCurrency(detailRow.amount)} <span className="text-sm">ج.م</span></p>
                      <div className="text-left text-xs text-slate-400 space-y-0.5">
                        <p className="flex items-center gap-1 justify-end"><Clock size={11} /> {detailRow.recorded_at ? formatTransactionDateTime(detailRow.recorded_at) : '—'}</p>
                        {detailRow.recorded_by && <p>سجّلها: {detailRow.recorded_by}</p>}
                        {detailRow.receipt_number && <p className="text-emerald-400">إيصال: {detailRow.receipt_number}</p>}
                        {detailRow.note && <p className="text-slate-500">{detailRow.note}</p>}
                      </div>
                    </div>
                  </div>
                )}

                <div className="glass-light rounded-2xl p-5 flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center ring-2 ring-emerald-500/20 flex-shrink-0">
                    <span className="text-2xl font-bold text-emerald-400">{detailStudent.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-white break-words leading-snug">{detailStudent.name}</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      {detailRow?.student?.group?.grade_level?.stage?.name ?? '—'}
                      {' › '}
                      {detailRow?.student?.group?.grade_level?.name ?? '—'}
                      {' › '}
                      {detailRow?.student?.group?.name ?? '—'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="glass-light rounded-xl p-4 flex items-center gap-3">
                    <span className="text-slate-500 flex-shrink-0 text-sm font-bold">هاتف الطالب</span>
                    <span className="text-sm text-white truncate">{detailStudent.phone || 'غير مسجل'}</span>
                  </div>
                  <div className="glass-light rounded-xl p-4 flex items-center gap-3">
                    <span className="text-slate-500 flex-shrink-0 text-sm font-bold">هاتف ولي الأمر</span>
                    <span className="text-sm text-white truncate">{detailStudent.parent_phone || 'غير مسجل'}</span>
                  </div>
                </div>

                <div className="glass-light rounded-2xl p-5 space-y-3">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <Wallet size={16} className="text-emerald-400" />
                    الملخص المالي
                  </h4>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">إجمالي الرسوم</p>
                      <p className="text-base font-bold text-white">{formatCurrency(detailStudent.total_fees ?? 0)} ج.م</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">المسدد</p>
                      <p className="text-base font-bold text-emerald-400">{formatCurrency(detailStudent.paid_fees ?? 0)} ج.م</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 mb-1">المتبقي</p>
                      <p className={`text-base font-bold ${detailStudent.is_exempt ? 'text-sky-400' : ((detailStudent.total_fees ?? 0) - (detailStudent.paid_fees ?? 0)) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {detailStudent.is_exempt ? 'معفي' : `${formatCurrency((detailStudent.total_fees ?? 0) - (detailStudent.paid_fees ?? 0))} ج.م`}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-slate-400">تعذّر تحميل بيانات الطالب.</p>
                <button onClick={backToList} className="mt-3 text-sm font-bold text-amber-400 hover:text-amber-300 transition">
                  رجوع للقائمة
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {editTarget && (
        <div className="fixed inset-0 z-[100004] flex items-center justify-center p-4 pointer-events-none" onClick={() => setEditTarget(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
          <div className="relative w-full max-w-sm glass-card rounded-2xl shadow-glass-lg overflow-hidden pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Edit2 size={18} className="text-amber-400" />
                <h3 className="text-sm font-bold text-white">تعديل عملية تحصيل</h3>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">الطالب: {editTarget.student?.name ?? '—'}</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">المبلغ</label>
                <input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} min="0" step="0.01" className="w-full glass-light rounded-xl p-3 text-sm text-white text-center border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50" style={{ colorScheme: 'dark' }} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">ملاحظة</label>
                <input type="text" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="اختياري" className="w-full glass-light rounded-xl p-3 text-sm text-white text-center border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50" style={{ colorScheme: 'dark' }} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditTarget(null)} className="px-4 py-2.5 rounded-xl glass-light text-slate-300 text-sm font-bold hover:bg-white/10 transition active:scale-95">إلغاء</button>
                <button onClick={handleEditPayment} disabled={editSaving || !editAmount || parseFloat(editAmount) <= 0} className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-500 transition active:scale-95 disabled:opacity-50">{editSaving ? 'جاري الحفظ...' : 'حفظ التعديل'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100004] flex items-center justify-center p-4 pointer-events-none" onClick={() => !deleteSaving && setDeleteTarget(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
          <div className="relative w-full max-w-sm glass-card rounded-2xl shadow-glass-lg overflow-hidden pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Trash2 size={18} className="text-red-400" />
                <h3 className="text-sm font-bold text-white">تأكيد الحذف</h3>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-slate-300">سيتم حذف عملية تحصيل بقيمة <span className="font-black text-amber-400">{formatCurrency(deleteTarget.amount)} ج.م</span> للطالب <span className="font-bold text-white">{deleteTarget.student?.name ?? '—'}</span>.</p>
              <p className="text-[11px] text-slate-400">سيتم إعادة حساب الإجمالي والمتبقي تلقائيًا. لا يمكن التراجع بعد الحذف.</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteTarget(null)} disabled={deleteSaving} className="px-4 py-2.5 rounded-xl glass-light text-slate-300 text-sm font-bold hover:bg-white/10 transition active:scale-95">إلغاء</button>
                <button onClick={handleDeletePayment} disabled={deleteSaving} className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 transition active:scale-95 disabled:opacity-50">{deleteSaving ? 'جاري الحذف...' : 'حذف العملية'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <StudentViewModal360 open={!!profileTarget} student={profileTarget} onClose={() => setProfileTarget(null)} />
    </>
  );
  }

  /* ── Modal mode (trigger button + overlay) ── */
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass-light hover:bg-amber-500/10 text-slate-300 hover:text-amber-400 transition text-xs font-bold flex-shrink-0"
        title="المبالغ المحصلة اليوم"
      >
        <Wallet size={14} />
        <span className="hidden sm:inline">تحصيل اليوم:</span>
        <span className="font-black text-amber-400">{formatCurrency(todayTotal)} ج.م</span>
        {todayCount > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">{todayCount}</span>
        )}
      </button>

      {open && createPortal(
        <>
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 pointer-events-none">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md pointer-events-auto" onClick={handleClose} />

          <div className="glass-card relative w-full max-w-lg rounded-3xl shadow-glass-lg max-h-[92vh] flex flex-col overflow-hidden pointer-events-auto">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/[0.06] flex-shrink-0 glass-card rounded-t-3xl">
              {view === 'detail' ? (
                <>
                  <button
                    onClick={backToList}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl glass-light hover:bg-white/10 text-slate-300 hover:text-amber-400 transition text-sm font-bold"
                  >
                    <ArrowRight size={18} />
                    رجوع للقائمة
                  </button>
                  <button
                    onClick={handleClose}
                    className="p-2.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-all active:scale-90"
                    title="إغلاق"
                  >
                    <X size={20} />
                  </button>
                </>
              ) : (
                <>
                  <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <Wallet size={20} className="text-amber-400" />
                    المبالغ المحصلة اليوم
                  </h3>
                  <button
                    onClick={handleClose}
                    className="p-2.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-all active:scale-90"
                    title="إغلاق"
                  >
                    <X size={20} />
                  </button>
                </>
              )}
            </div>

            {view === 'list' ? (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-shrink-0 p-4 sm:p-5 space-y-3 border-b border-white/[0.06]">
                  <div className="flex items-center justify-between glass-light rounded-xl p-3">
                    <button
                      onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
                      className="p-2 rounded-lg hover:bg-white/10 text-slate-300 transition active:scale-90"
                      title="اليوم السابق"
                    >
                      <ChevronRight size={18} />
                    </button>
                    <div className="text-center flex-1">
                      <div className="flex items-center justify-center gap-2">
                        <Calendar size={14} className="text-amber-400" />
                        <input
                          type="date"
                          value={selectedDate}
                          onChange={(e) => setSelectedDate(e.target.value)}
                          max={todayDateString()}
                          className="bg-transparent text-sm font-bold text-white text-center outline-none cursor-pointer"
                          style={{ colorScheme: 'dark' }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {isToday ? 'تحصيل اليوم' : formatArabicDate(selectedDate)}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}
                      disabled={isToday}
                      className="p-2 rounded-lg hover:bg-white/10 text-slate-300 transition disabled:opacity-30 active:scale-90"
                      title="اليوم التالي"
                    >
                      <ChevronLeft size={18} />
                    </button>
                  </div>

                  {/* Quick day buttons */}
                  <div className="flex gap-2">
                    {[
                      { label: 'اليوم', offset: 0 },
                      { label: 'أمس', offset: -1 },
                      { label: 'أول أمس', offset: -2 },
                    ].map((d) => {
                      const target = shiftDate(todayDateString(), d.offset);
                      const active = selectedDate === target;
                      return (
                        <button
                          key={d.offset}
                          onClick={() => setSelectedDate(target)}
                          className={`flex-1 py-2 rounded-xl text-xs font-bold transition active:scale-95 ${active ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'glass-light text-slate-400 hover:text-white hover:bg-white/10'}`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="relative bg-gradient-to-br from-amber-600/20 via-amber-500/10 to-transparent rounded-2xl p-4 border border-amber-500/20 overflow-hidden">
                    <div className="absolute -top-10 -left-10 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl" />
                    <div className="relative flex items-center justify-between">
                      <div>
                        <p className="text-xs text-amber-300/70 mb-1 flex items-center gap-1.5">
                          <TrendingUp size={12} /> إجمالي المحصل
                        </p>
                        <p className="text-2xl font-black text-amber-400">{formatCurrency(hasFilters ? filteredTotal : dayTotal)} <span className="text-sm">ج.م</span></p>
                      </div>
                      <div className="text-left">
                        <p className="text-xs text-slate-400 mb-1 flex items-center gap-1 justify-end">
                          <Users size={12} /> عدد العمليات
                        </p>
                        <p className="text-2xl font-black text-white">{hasFilters ? filteredRows.length : rows.length}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-400">العمليات مرتبة من الأحدث للأقدم</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowAccounting(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 transition text-xs font-bold"
                      >
                        <CheckCircle2 size={12} />
                        {accountingDate ? `محاسبة حتى ${formatArabicDate(accountingDate)}` : 'محاسبة'}
                      </button>
                      <button
                        onClick={() => loadDay(selectedDate)}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-amber-400 transition text-xs font-bold disabled:opacity-50 active:scale-95"
                      >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                        تحديث
                      </button>
                    </div>
                  </div>

                  {/* Smart search + filters */}
                  <div className="space-y-2">
                    <div className="relative">
                      <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="بحث: اسم الطالب، رقم الهاتف، ID..."
                        className="w-full pr-9 pl-3 py-2.5 rounded-xl glass-light text-xs text-white placeholder:text-slate-500 border border-white/[0.06] focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setShowFilters((v) => !v)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition ${showFilters || hasFilters ? 'bg-amber-500/15 text-amber-400' : 'glass-light text-slate-400 hover:text-white'}`}
                      >
                        <Filter size={11} /> فلترة
                        {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                      </button>
                      {hasFilters && (
                        <button
                          onClick={clearFilters}
                          className="text-[10px] font-bold text-red-400 hover:text-red-300 transition px-2 py-1"
                        >
                          مسح الفلاتر
                        </button>
                      )}
                    </div>
                    {showFilters && (
                      <div className="grid grid-cols-2 gap-2 p-2 glass-light rounded-xl">
                        <FilterSelect label="المرحلة" value={filterStage} options={stages} onChange={setFilterStage} />
                        <FilterSelect label="الصف" value={filterGrade} options={grades} onChange={setFilterGrade} />
                        <FilterSelect label="المجموعة" value={filterGroup} options={groups} onChange={setFilterGroup} />
                        <FilterSelect label="المحصّل" value={filterCollector} options={collectors} onChange={setFilterCollector} />
                      </div>
                    )}
                  </div>
                </div>

                <div
                  ref={listScrollRef}
                  className="flex-1 overflow-y-auto p-4 sm:p-5 pt-3 modal-body"
                  style={{ WebkitOverflowScrolling: 'touch' }}
                >
                  {loading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="glass-light rounded-xl p-3 flex items-center gap-3">
                          <Skeleton className="w-9 h-9 rounded-xl flex-shrink-0" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-48" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : filteredRows.length === 0 ? (
                    <div className="glass-light rounded-xl p-8 text-center">
                      <Wallet className="mx-auto text-slate-600 mb-3" size={40} />
                      <p className="text-sm text-slate-400">لا توجد عمليات تحصيل في هذا اليوم.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredRows.map((r, idx) => {
                        const studentName = r.student?.name ?? 'طالب';
                        const time = r.recorded_at ? formatTime(r.recorded_at) : '—';
                        const isLate = r.is_historical_payment;
                        const monthLabel = r.target_archive_month ?? r.month_key ?? '—';
                        const groupName = r.student?.group?.name ?? '—';
                        const gradeName = r.student?.group?.grade_level?.name ?? '—';
                        const stageName = r.student?.group?.grade_level?.stage?.name ?? '—';
                        return (
                          <div
                            key={r.id}
                            className="w-full glass-light rounded-xl p-3 flex items-start gap-3 hover:bg-white/[0.08] transition"
                          >
                            <button
                              onClick={() => openStudentDetail(r)}
                              className="flex-1 min-w-0 text-right flex items-start gap-3 active:scale-[0.98] cursor-pointer"
                            >
                            <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center text-xs font-black text-amber-400">
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white text-sm">{studentName}</span>
                                <span className="text-sm font-black text-amber-400">{formatCurrency(r.amount)} ج.م</span>
                                {isLate && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400">متأخر</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-1 flex-wrap">
                                <span className="flex items-center gap-1"><Clock size={10} /> {time}</span>
                                {r.recorded_by && <span>• سجّلها: {r.recorded_by}</span>}
                                <span>• شهر: {monthLabel}</span>
                                {r.receipt_number && <span className="text-emerald-500">• إيصال: {r.receipt_number}</span>}
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                                <span className="text-slate-400">{stageName}</span>
                                <span className="text-slate-600">›</span>
                                <span className="text-slate-400">{gradeName}</span>
                                <span className="text-slate-600">›</span>
                                <span className="text-slate-400">{groupName}</span>
                              </div>
                              {r.note && <p className="text-[10px] text-slate-500 mt-0.5">{r.note}</p>}
                            </div>
                            </button>
                            <div className="flex flex-col gap-1 flex-shrink-0 mt-1">
                              <button onClick={(e) => { e.stopPropagation(); setProfileTarget(r.student as unknown as Student); }} className="p-1.5 rounded-lg hover:bg-sky-500/15 text-slate-400 hover:text-sky-400 transition" title="عرض الملف"><Eye size={13} /></button>
                              <button onClick={(e) => { e.stopPropagation(); setEditTarget(r); setEditAmount(String(r.amount)); setEditNote(r.note ?? ''); }} className="p-1.5 rounded-lg hover:bg-amber-500/15 text-slate-400 hover:text-amber-400 transition" title="تعديل"><Edit2 size={13} /></button>
                              <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }} className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-400 transition" title="حذف"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 modal-body">
                {detailLoading ? (
                  <div className="space-y-4">
                    <div className="glass-light rounded-2xl p-5 flex items-center gap-4">
                      <Skeleton className="w-16 h-16 rounded-2xl flex-shrink-0" />
                      <div className="space-y-2">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Skeleton className="h-20 rounded-xl" />
                      <Skeleton className="h-20 rounded-xl" />
                    </div>
                    <Skeleton className="h-32 rounded-2xl" />
                  </div>
                ) : detailStudent ? (
                  <div className="space-y-4">
                    {detailRow && (
                      <div className="bg-gradient-to-br from-amber-600/20 via-amber-500/10 to-transparent rounded-2xl p-4 border border-amber-500/20">
                        <p className="text-xs text-amber-300/70 mb-1">تفاصيل العملية</p>
                        <div className="flex items-center justify-between">
                          <p className="text-2xl font-black text-amber-400">{formatCurrency(detailRow.amount)} <span className="text-sm">ج.م</span></p>
                          <div className="text-left text-xs text-slate-400 space-y-0.5">
                            <p className="flex items-center gap-1 justify-end"><Clock size={11} /> {detailRow.recorded_at ? formatTransactionDateTime(detailRow.recorded_at) : '—'}</p>
                            {detailRow.recorded_by && <p>سجّلها: {detailRow.recorded_by}</p>}
                            {detailRow.receipt_number && <p className="text-emerald-400">إيصال: {detailRow.receipt_number}</p>}
                            {detailRow.note && <p className="text-slate-500">{detailRow.note}</p>}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="glass-light rounded-2xl p-5 flex items-center gap-4">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center ring-2 ring-emerald-500/20 flex-shrink-0">
                        <span className="text-2xl font-bold text-emerald-400">{detailStudent.name.charAt(0)}</span>
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-white break-words leading-snug">{detailStudent.name}</h3>
                        <p className="text-xs text-slate-400 mt-1">
                          {detailRow?.student?.group?.grade_level?.stage?.name ?? '—'}
                          {' › '}
                          {detailRow?.student?.group?.grade_level?.name ?? '—'}
                          {' › '}
                          {detailRow?.student?.group?.name ?? '—'}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="glass-light rounded-xl p-4 flex items-center gap-3">
                        <span className="text-slate-500 flex-shrink-0 text-sm font-bold">هاتف الطالب</span>
                        <span className="text-sm text-white truncate">{detailStudent.phone || 'غير مسجل'}</span>
                      </div>
                      <div className="glass-light rounded-xl p-4 flex items-center gap-3">
                        <span className="text-slate-500 flex-shrink-0 text-sm font-bold">هاتف ولي الأمر</span>
                        <span className="text-sm text-white truncate">{detailStudent.parent_phone || 'غير مسجل'}</span>
                      </div>
                    </div>

                    <div className="glass-light rounded-2xl p-5 space-y-3">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Wallet size={16} className="text-emerald-400" />
                        الملخص المالي
                      </h4>
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <p className="text-xs text-slate-400 mb-1">إجمالي الرسوم</p>
                          <p className="text-base font-bold text-white">{formatCurrency(detailStudent.total_fees ?? 0)} ج.م</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">المسدد</p>
                          <p className="text-base font-bold text-emerald-400">{formatCurrency(detailStudent.paid_fees ?? 0)} ج.م</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400 mb-1">المتبقي</p>
                          <p className={`text-base font-bold ${detailStudent.is_exempt ? 'text-sky-400' : ((detailStudent.total_fees ?? 0) - (detailStudent.paid_fees ?? 0)) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {detailStudent.is_exempt ? 'معفي' : `${formatCurrency((detailStudent.total_fees ?? 0) - (detailStudent.paid_fees ?? 0))} ج.م`}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-slate-400">تعذّر تحميل بيانات الطالب.</p>
                    <button onClick={backToList} className="mt-3 text-sm font-bold text-amber-400 hover:text-amber-300 transition">
                      رجوع للقائمة
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

      {/* Accounting checkpoint modal */}
      {showAccounting && (
        <div className="fixed inset-0 z-[100003] flex items-center justify-center p-4 pointer-events-none" onClick={() => setShowAccounting(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
          <div className="relative w-full max-w-sm glass-card rounded-2xl shadow-glass-lg overflow-hidden pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-400" />
                <h3 className="text-sm font-bold text-white">نقطة المحاسبة</h3>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">حدد تاريخ المحاسبة — لا يتم حذف أو تعديل أي سجل دفع.</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {accountingDate && (
                <div className="glass-light rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-400">تمت المحاسبة حتى</p>
                  <p className="text-sm font-bold text-emerald-400 mt-1">{formatArabicDate(accountingDate)}</p>
                </div>
              )}
              <label className="block text-xs text-slate-400">تاريخ المحاسبة</label>
              <input
                type="date"
                value={accountingDate}
                onChange={(e) => setAccountingDate(e.target.value)}
                max={todayDateString()}
                className="w-full glass-light rounded-xl p-3 text-sm text-white text-center border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                style={{ colorScheme: 'dark' }}
              />
              {accountingDate && beforeAccounting && afterAccounting && (
                <div className="space-y-2 pt-2">
                  <div className="glass-light rounded-xl p-3">
                    <p className="text-[10px] text-slate-400 mb-1">الفترة المحاسبية (قبل التاريخ)</p>
                    <p className="text-sm font-bold text-white">{beforeAccounting.length} عملية · {formatCurrency(beforeAccounting.reduce((s, r) => s + (r.amount ?? 0), 0))} ج.م</p>
                  </div>
                  <div className="glass-light rounded-xl p-3">
                    <p className="text-[10px] text-slate-400 mb-1">منذ آخر محاسبة (بعد التاريخ)</p>
                    <p className="text-sm font-bold text-amber-400">{afterAccounting.length} عملية · {formatCurrency(afterAccounting.reduce((s, r) => s + (r.amount ?? 0), 0))} ج.م</p>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                {accountingDate && (
                  <button
                    onClick={() => { setAccountingDate(''); setShowAccounting(false); }}
                    className="px-4 py-2.5 rounded-xl glass-light text-red-400 text-sm font-bold hover:bg-red-500/10 transition active:scale-95"
                  >
                    مسح
                  </button>
                )}
                <button
                  onClick={() => setShowAccounting(false)}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition active:scale-95"
                >
                  حفظ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editTarget && (
        <div className="fixed inset-0 z-[100004] flex items-center justify-center p-4 pointer-events-none" onClick={() => setEditTarget(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
          <div className="relative w-full max-w-sm glass-card rounded-2xl shadow-glass-lg overflow-hidden pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Edit2 size={18} className="text-amber-400" />
                <h3 className="text-sm font-bold text-white">تعديل عملية تحصيل</h3>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">الطالب: {editTarget.student?.name ?? '—'}</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">المبلغ</label>
                <input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} min="0" step="0.01" className="w-full glass-light rounded-xl p-3 text-sm text-white text-center border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50" style={{ colorScheme: 'dark' }} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">ملاحظة</label>
                <input type="text" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="اختياري" className="w-full glass-light rounded-xl p-3 text-sm text-white text-center border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-amber-500/50" style={{ colorScheme: 'dark' }} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditTarget(null)} className="px-4 py-2.5 rounded-xl glass-light text-slate-300 text-sm font-bold hover:bg-white/10 transition active:scale-95">إلغاء</button>
                <button onClick={handleEditPayment} disabled={editSaving || !editAmount || parseFloat(editAmount) <= 0} className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-500 transition active:scale-95 disabled:opacity-50">{editSaving ? 'جاري الحفظ...' : 'حفظ التعديل'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100004] flex items-center justify-center p-4 pointer-events-none" onClick={() => !deleteSaving && setDeleteTarget(null)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
          <div className="relative w-full max-w-sm glass-card rounded-2xl shadow-glass-lg overflow-hidden pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Trash2 size={18} className="text-red-400" />
                <h3 className="text-sm font-bold text-white">تأكيد الحذف</h3>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-slate-300">سيتم حذف عملية تحصيل بقيمة <span className="font-black text-amber-400">{formatCurrency(deleteTarget.amount)} ج.م</span> للطالب <span className="font-bold text-white">{deleteTarget.student?.name ?? '—'}</span>.</p>
              <p className="text-[11px] text-slate-400">سيتم إعادة حساب الإجمالي والمتبقي تلقائيًا. لا يمكن التراجع بعد الحذف.</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteTarget(null)} disabled={deleteSaving} className="px-4 py-2.5 rounded-xl glass-light text-slate-300 text-sm font-bold hover:bg-white/10 transition active:scale-95">إلغاء</button>
                <button onClick={handleDeletePayment} disabled={deleteSaving} className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-500 transition active:scale-95 disabled:opacity-50">{deleteSaving ? 'جاري الحذف...' : 'حذف العملية'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>,
      document.body
      )}
      <StudentViewModal360 open={!!profileTarget} student={profileTarget} onClose={() => setProfileTarget(null)} />
    </>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[9px] text-slate-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full glass-light rounded-lg px-2 py-1.5 text-[10px] text-white border border-white/[0.06] focus:outline-none focus:ring-1 focus:ring-amber-500/30"
        style={{ colorScheme: 'dark' }}
      >
        <option value="">الكل</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
