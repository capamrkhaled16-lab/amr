import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  GitBranch,
  Search,
  History,
  GitCompare,
  ChevronLeft,
  Loader2,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Info,
  Database,
  RefreshCw,
  Eye,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import { calcExamAverage, type RawGrade } from '@/lib/gradeCalc';

// ============================================================================
// TYPES — all read-only, derived from existing database tables
// ============================================================================

type ToolId = 'impact' | 'lineage' | 'forensic' | 'reconciliation';

type LoadingState = 'idle' | 'loading' | 'success' | 'error' | 'timeout';

type ImpactNode = {
  table: string;
  label: string;
  count: number;
  recordIds: string[];
  details: string;
};

type LineageStep = {
  source: string;
  label: string;
  count: number;
  detail: string;
};

type ForensicEvent = {
  field: string;
  label: string;
  currentValue: string;
  previousValue: string | null;
  changedAt: string;
  hasHistory: boolean;
};

type ReconciliationIssue = {
  id: string;
  severity: 'conflict' | 'review' | 'ok';
  category: string;
  title: string;
  explanation: string;
  recordIds: string[];
  evidence: string;
};

// ============================================================================
// SAFETY HOOK — guarantees loading never gets stuck
// ============================================================================

function useSafeLoading(timeoutMs = 12000) {
  const [state, setState] = useState<LoadingState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState('loading');
    timerRef.current = setTimeout(() => {
      setState('timeout');
    }, timeoutMs);
  }, [timeoutMs]);

  const succeed = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setState('success');
  }, []);

  const fail = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setState('error');
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setState('idle');
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return { state, start, succeed, fail, reset };
}

// ============================================================================
// SHARED UI
// ============================================================================

function StatusBadge({ state }: { state: LoadingState }) {
  if (state === 'idle') return null;
  if (state === 'loading') return <Loader2 size={14} className="animate-spin text-emerald-400" />;
  if (state === 'success') return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (state === 'error') return <AlertCircle size={14} className="text-red-400" />;
  if (state === 'timeout') return <AlertTriangle size={14} className="text-amber-400" />;
  return null;
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="text-slate-600 mb-2">{icon}</div>
      <p className="text-xs text-slate-500">{message}</p>
    </div>
  );
}

// ============================================================================
// 1. CHANGE IMPACT ENGINE — analyzes relationships of a record
// ============================================================================

const ENTITY_TABLES: Record<string, { table: string; label: string; fk: string; display: string }> = {
  student: { table: 'attendance', label: 'الحضور', fk: 'student_id', display: 'attendance_date' },
  group: { table: 'sessions', label: 'الحصص', fk: 'group_id', display: 'session_date' },
  session: { table: 'attendance', label: 'سجلات الحضور', fk: 'session_id', display: 'attendance_date' },
  payment: { table: 'payments', label: 'المدفوعات', fk: 'id', display: 'amount' },
};

const IMPACT_MAP: Record<string, { table: string; label: string; fk: string; displayCol: string }[]> = {
  student: [
    { table: 'attendance', label: 'الحضور', fk: 'student_id', displayCol: 'attendance_date' },
    { table: 'center_grades', label: 'الدرجات', fk: 'student_id', displayCol: 'score' },
    { table: 'payments', label: 'المدفوعات', fk: 'student_id', displayCol: 'amount' },
    { table: 'homework_status', label: 'حالة الواجبات', fk: 'student_id', displayCol: 'status' },
    { table: 'monthly_subscriptions', label: 'الاشتراكات', fk: 'student_id', displayCol: 'amount_due' },
    { table: 'behavior_eval', label: 'تقييم السلوك', fk: 'student_id', displayCol: 'rating' },
  ],
  group: [
    { table: 'students', label: 'الطلاب', fk: 'id', displayCol: 'name' },
    { table: 'sessions', label: 'الحصص', fk: 'id', displayCol: 'title' },
    { table: 'center_exams', label: 'الامتحانات', fk: 'id', displayCol: 'title' },
    { table: 'homework', label: 'الواجبات', fk: 'id', displayCol: 'title' },
  ],
  session: [
    { table: 'attendance', label: 'سجلات الحضور', fk: 'session_id', displayCol: 'attendance_date' },
    { table: 'center_grades', label: 'الدرجات المرتبطة', fk: 'session_id', displayCol: 'score' },
  ],
};

function ChangeImpactEngine() {
  const { showToast } = useToast();
  const { state, start, succeed, fail, reset } = useSafeLoading();
  const [entityType, setEntityType] = useState<string>('student');
  const [entityId, setEntityId] = useState('');
  const [results, setResults] = useState<ImpactNode[]>([]);

  const analyze = useCallback(async () => {
    const id = entityId.trim();
    if (!id) { showToast('أدخل معرّف صحيح', 'error'); return; }

    const relations = IMPACT_MAP[entityType];
    if (!relations) { showToast('نوع غير مدعوم', 'error'); return; }

    start();
    setResults([]);

    try {
      const nodes: ImpactNode[] = [];
      for (const rel of relations) {
        let query = supabase.from(rel.table).select('*').eq(rel.fk, id);
        if (rel.table === 'students') query = query.eq('is_deleted', false) as typeof query;
        if (rel.table === 'center_grades') query = query.eq('is_deleted', false) as typeof query;
        const { data, error } = await query.limit(50);
        if (error) continue;
        const rows = data ?? [];
        if (rows.length > 0) {
          nodes.push({
            table: rel.table,
            label: rel.label,
            count: rows.length,
            recordIds: rows.slice(0, 5).map((r: Record<string, unknown>) => String(r.id ?? '')),
            details: rel.displayCol
              ? `${rel.label}: ${rows.length} سجل — أول: ${String((rows[0] as Record<string, unknown>)[rel.displayCol] ?? '—')}`
              : `${rel.label}: ${rows.length} سجل`,
          });
        }
      }
      setResults(nodes);
      succeed();
      if (nodes.length === 0) showToast('لا توجد سجلات مرتبطة', 'info');
      else showToast(`تم العثور على ${nodes.length} علاقة`, 'success');
    } catch {
      fail();
      showToast('تعذّر تحليل الأثر', 'error');
    }
  }, [entityType, entityId, start, succeed, fail, showToast]);

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <GitBranch size={18} className="text-emerald-400" />
          <h3 className="text-sm font-bold text-white">محرك أثر التغيير</h3>
          <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">تحليل فقط — لا تعديل</span>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          يحلل العلاقات المرتبطة بسجل معين قبل إجراء أي تغيير. يعرض الجداول المرتبطة وعدد السجلات في كل منها.
        </p>

        <div className="flex gap-2 mb-3">
          <select
            value={entityType}
            onChange={(e) => { setEntityType(e.target.value); setResults([]); reset(); }}
            className="glass-light rounded-lg px-3 py-2 text-xs text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            <option value="student">طالب</option>
            <option value="group">مجموعة</option>
            <option value="session">حصة</option>
          </select>
          <input
            type="text"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && analyze()}
            placeholder="أدخل المعرّف (UUID)..."
            className="flex-1 glass-light rounded-lg px-3 py-2 text-xs text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
          <button
            onClick={analyze}
            disabled={state === 'loading'}
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {state === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            تحليل
          </button>
        </div>

        {state === 'timeout' && (
          <div className="glass-light rounded-xl p-3 border border-amber-500/30 mb-3">
            <p className="text-xs text-amber-400">انتهت مهلة التحليل — قد تكون البيانات كبيرة. حاول مرة أخرى.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="glass-light rounded-xl p-3 border border-red-500/30 mb-3">
            <p className="text-xs text-red-400">تعذّر إكمال التحليل. تحقق من المعرّف وحاول مرة أخرى.</p>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-slate-500 mb-1">السجل المرتبط:</p>
            {results.map((node) => (
              <motion.div
                key={node.table}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="glass-light rounded-xl p-3 flex items-start gap-3"
              >
                <Database size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">{node.label}</span>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">
                      {node.count} سجل
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">{node.details}</p>
                  {node.recordIds.length > 0 && (
                    <p className="text-[9px] text-slate-600 mt-1 font-mono">معرّفات: {node.recordIds.join('، ').slice(0, 120)}</p>
                  )}
                </div>
              </motion.div>
            ))}
            <div className="glass-light rounded-xl p-3 border border-amber-500/20">
              <p className="text-[10px] text-amber-400/80 flex items-center gap-1.5">
                <AlertTriangle size={12} />
                هذه تحليل فقط — التغيير الفعلي يتم عبر الوحدات الموجودة في المنصة.
              </p>
            </div>
          </div>
        )}

        {state === 'success' && results.length === 0 && (
          <EmptyState icon={<CheckCircle2 size={28} />} message="لا توجد سجلات مرتبطة بهذا المعرّف" />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 2. DATA LINEAGE — traces where a value comes from
// ============================================================================

function DataLineage() {
  const { showToast } = useToast();
  const { state, start, succeed, fail, reset } = useSafeLoading();
  const [lineageType, setLineageType] = useState<'student_fees' | 'group_collected' | 'session_grades'>('student_fees');
  const [entityId, setEntityId] = useState('');
  const [steps, setSteps] = useState<LineageStep[]>([]);
  const [totalValue, setTotalValue] = useState<string>('');

  const trace = useCallback(async () => {
    const id = entityId.trim();
    if (!id) { showToast('أدخل معرّف صحيح', 'error'); return; }
    start();
    setSteps([]);
    setTotalValue('');

    try {
      const traced: LineageStep[] = [];

      if (lineageType === 'student_fees') {
        const { data: payments, error: e1 } = await supabase
          .from('payments').select('id, amount, payment_date, month_key')
          .eq('student_id', id).order('payment_date', { ascending: false }).limit(100);
        if (e1) throw e1;
        const total = (payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
        traced.push({ source: 'payments', label: 'سجلات المدفوعات', count: payments?.length ?? 0, detail: `إجمالي: ${formatCurrency(total)} ج.م` });
        setTotalValue(formatCurrency(total) + ' ج.م');

        const { data: subs, error: e2 } = await supabase
          .from('monthly_subscriptions').select('id, amount_due, amount_paid, month_key')
          .eq('student_id', id).limit(50);
        if (e2) throw e2;
        if (subs && subs.length > 0) {
          traced.push({ source: 'monthly_subscriptions', label: 'الاشتراكات الشهرية', count: subs.length, detail: `أشهر: ${subs.map(s => s.month_key).join('، ').slice(0, 60)}` });
        }

        const { data: student } = await supabase
          .from('students').select('total_fees, paid_fees, is_exempt').eq('id', id).single();
        if (student) {
          traced.push({ source: 'students', label: 'ملخص الطالب', count: 1, detail: `الرسوم: ${formatCurrency(student.total_fees ?? 0)} — المدفوع: ${formatCurrency(student.paid_fees ?? 0)} — معفي: ${student.is_exempt ? 'نعم' : 'لا'}` });
        }
      } else if (lineageType === 'group_collected') {
        const { data: students } = await supabase
          .from('students').select('id, name').eq('group_id', id).eq('is_deleted', false);
        const studentIds = (students ?? []).map(s => s.id);
        traced.push({ source: 'students', label: 'طلاب المجموعة', count: studentIds.length, detail: studentIds.length > 0 ? `طلاب: ${studentIds.length}` : 'لا طلاب' });

        if (studentIds.length > 0) {
          const { data: payments, error } = await supabase
            .from('payments').select('id, amount').in('student_id', studentIds).limit(500);
          if (error) throw error;
          const total = (payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
          traced.push({ source: 'payments', label: 'مدفوعات المجموعة', count: payments?.length ?? 0, detail: `إجمالي: ${formatCurrency(total)} ج.م` });
          setTotalValue(formatCurrency(total) + ' ج.م');
        }
      } else if (lineageType === 'session_grades') {
        const { data: grades, error } = await supabase
          .from('center_grades').select('id, student_id, score, is_absent, center_exam_id').eq('session_id', id).eq('is_deleted', false).limit(100);
        if (error) throw error;
        const validGrades = (grades ?? []).filter(g => !g.is_absent);
        // Fetch max_scores for the centralized engine
        const examIds = [...new Set(validGrades.map(g => (g as { center_exam_id?: string }).center_exam_id).filter(Boolean))] as string[];
        let examMaxMap = new Map<string, number>();
        if (examIds.length > 0) {
          const { data: exams } = await supabase.from('center_exams').select('id, max_score').in('id', examIds);
          examMaxMap = new Map((exams ?? []).map((e: { id: string; max_score: number }) => [e.id, e.max_score]));
        }
        const rawGrades: RawGrade[] = validGrades.map(g => ({
          student_id: g.student_id,
          score: g.score ?? 0,
          max_score: examMaxMap.get((g as { center_exam_id?: string }).center_exam_id ?? '') ?? 100,
        }));
        const avgResult = calcExamAverage(rawGrades);
        traced.push({ source: 'center_grades', label: 'درجات الحصة', count: grades?.length ?? 0, detail: `متوسط: ${avgResult.averageScore.toFixed(1)} / ${avgResult.maxScore} (${avgResult.averagePercent.toFixed(1)}%) — حاضر: ${validGrades.length} — غائب: ${(grades?.length ?? 0) - validGrades.length}` });
        setTotalValue(`${avgResult.averageScore.toFixed(1)} / ${avgResult.maxScore}`);
      }

      setSteps(traced);
      succeed();
      showToast(`تم تتبع المصدر: ${traced.length} خطوة`, 'success');
    } catch {
      fail();
      showToast('تعذّر تتبع المصدر', 'error');
    }
  }, [lineageType, entityId, start, succeed, fail, showToast]);

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <GitBranch size={18} className="text-sky-400" />
        <h3 className="text-sm font-bold text-white">تتبع مصدر القيم</h3>
        <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">قراءة فقط</span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        يعرض من أين جاءت القيمة المعروضة باستخدام السجلات الموجودة فعلاً — لا ينشئ نسخة جديدة.
      </p>

      <div className="flex gap-2 mb-3">
        <select
          value={lineageType}
          onChange={(e) => { setLineageType(e.target.value as typeof lineageType); setSteps([]); reset(); }}
          className="glass-light rounded-lg px-3 py-2 text-xs text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        >
          <option value="student_fees">مدفوعات طالب</option>
          <option value="group_collected">محصّل مجموعة</option>
          <option value="session_grades">درجات حصة</option>
        </select>
        <input
          type="text"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && trace()}
          placeholder="معرّف الطالب / المجموعة / الحصة..."
          className="flex-1 glass-light rounded-lg px-3 py-2 text-xs text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        />
        <button
          onClick={trace}
          disabled={state === 'loading'}
          className="px-3 py-2 rounded-lg bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 transition disabled:opacity-50 flex items-center gap-1.5"
        >
          {state === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          تتبع
        </button>
      </div>

      {state === 'timeout' && (
        <div className="glass-light rounded-xl p-3 border border-amber-500/30 mb-3">
          <p className="text-xs text-amber-400">انتهت المهلة — حاول مرة أخرى.</p>
        </div>
      )}

      {totalValue && state === 'success' && (
        <div className="glass-light rounded-xl p-3 mb-3 text-center border border-emerald-500/20">
          <p className="text-[10px] text-slate-400">القيمة النهائية</p>
          <p className="text-lg font-black text-emerald-400">{totalValue}</p>
        </div>
      )}

      {steps.length > 0 && (
        <div className="space-y-1">
          {steps.map((step, i) => (
            <motion.div
              key={`${step.source}-${i}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-2"
            >
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-6 h-6 rounded-full bg-sky-500/20 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-sky-400">{i + 1}</span>
                </div>
                {i < steps.length - 1 && <div className="w-px h-6 bg-slate-700" />}
              </div>
              <div className="glass-light rounded-lg p-2 flex-1 mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">{step.label}</span>
                  <span className="text-[9px] text-slate-500 font-mono">{step.source}</span>
                  <span className="text-[10px] bg-sky-500/10 text-sky-400 px-1.5 py-0.5 rounded-full">{step.count}</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">{step.detail}</p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {state === 'success' && steps.length === 0 && (
        <EmptyState icon={<Info size={28} />} message="لا توجد بيانات كافية لتتبع المصدر" />
      )}
    </div>
  );
}

// ============================================================================
// 3. FORENSIC MODE — shows available history for a record
// ============================================================================

function ForensicMode() {
  const { showToast } = useToast();
  const { state, start, succeed, fail, reset } = useSafeLoading();
  const [recordTable, setRecordTable] = useState('students');
  const [recordId, setRecordId] = useState('');
  const [events, setEvents] = useState<ForensicEvent[]>([]);
  const [recordInfo, setRecordInfo] = useState<{ id: string; created: string; updated: string } | null>(null);

  const investigate = useCallback(async () => {
    const id = recordId.trim();
    if (!id) { showToast('أدخل معرّف السجل', 'error'); return; }
    start();
    setEvents([]);
    setRecordInfo(null);

    try {
      const { data, error } = await supabase
        .from(recordTable).select('*').eq('id', id).single();
      if (error) throw error;
      if (!data) { succeed(); showToast('السجل غير موجود', 'info'); return; }

      const created = String((data as Record<string, unknown>).created_at ?? 'غير متاح');
      const updated = String((data as Record<string, unknown>).updated_at ?? 'غير متاح');
      setRecordInfo({ id, created, updated });

      // Show current state of key fields — no invented history
      const fieldsToShow = ['name', 'amount', 'status', 'score', 'attendance_date', 'exam_date', 'due_date', 'total_fees', 'paid_fees', 'group_id', 'student_id'];
      const forensics: ForensicEvent[] = [];
      for (const field of fieldsToShow) {
        const val = (data as Record<string, unknown>)[field];
        if (val !== undefined && val !== null) {
          forensics.push({
            field,
            label: field,
            currentValue: String(val),
            previousValue: null, // we never invent history
            changedAt: updated,
            hasHistory: false,
          });
        }
      }

      // Check audit_logs if available
      const { data: auditLogs, error: auditErr } = await supabase
        .from('audit_logs').select('*').eq('entity_id', id).order('created_at', { ascending: false }).limit(10);
      if (!auditErr && auditLogs && auditLogs.length > 0) {
        for (const log of auditLogs) {
          forensics.push({
            field: 'audit_log',
            label: `سجل تدقيق: ${String(log.action ?? 'غير محدد')}`,
            currentValue: String(log.details ?? ''),
            previousValue: null,
            changedAt: String(log.created_at ?? ''),
            hasHistory: true,
          });
        }
      }

      setEvents(forensics);
      succeed();
      showToast(`تم فحص السجل: ${forensics.length} حقل`, 'success');
    } catch {
      fail();
      showToast('تعذّر فحص السجل', 'error');
    }
  }, [recordTable, recordId, start, succeed, fail, showToast]);

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <History size={18} className="text-amber-400" />
        <h3 className="text-sm font-bold text-white">الوضع الجنائي — تاريخ السجل</h3>
        <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">قراءة فقط</span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        يعرض الحالة الحالية والسجل المتاح. لا يخترع تاريخاً غير موجود — إذا لم تكن البيانات السابقة متاحة، سيوضح ذلك.
      </p>

      <div className="flex gap-2 mb-3">
        <select
          value={recordTable}
          onChange={(e) => { setRecordTable(e.target.value); setEvents([]); reset(); }}
          className="glass-light rounded-lg px-3 py-2 text-xs text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        >
          <option value="students">طلاب</option>
          <option value="payments">مدفوعات</option>
          <option value="attendance">حضور</option>
          <option value="center_grades">درجات</option>
          <option value="sessions">حصص</option>
        </select>
        <input
          type="text"
          value={recordId}
          onChange={(e) => setRecordId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && investigate()}
          placeholder="معرّف السجل (UUID)..."
          className="flex-1 glass-light rounded-lg px-3 py-2 text-xs text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        />
        <button
          onClick={investigate}
          disabled={state === 'loading'}
          className="px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition disabled:opacity-50 flex items-center gap-1.5"
        >
          {state === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          فحص
        </button>
      </div>

      {state === 'timeout' && (
        <div className="glass-light rounded-xl p-3 border border-amber-500/30 mb-3">
          <p className="text-xs text-amber-400">انتهت المهلة — حاول مرة أخرى.</p>
        </div>
      )}

      {recordInfo && state === 'success' && (
        <div className="glass-light rounded-xl p-3 mb-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">معرّف السجل</span>
            <span className="text-[10px] text-white font-mono">{recordInfo.id.slice(0, 36)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">تاريخ الإنشاء</span>
            <span className="text-[10px] text-sky-400">{recordInfo.created !== 'غير متاح' ? new Date(recordInfo.created).toLocaleString('ar-EG') : 'غير متاح'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">آخر تحديث</span>
            <span className="text-[10px] text-amber-400">{recordInfo.updated !== 'غير متاح' ? new Date(recordInfo.updated).toLocaleString('ar-EG') : 'غير متاح'}</span>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-1.5">
          {events.map((ev, i) => (
            <motion.div
              key={`${ev.field}-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
              className="glass-light rounded-lg p-2.5"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-white">{ev.label}</span>
                {ev.hasHistory ? (
                  <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full">له سجل</span>
                ) : (
                  <span className="text-[9px] bg-slate-500/10 text-slate-500 px-1.5 py-0.5 rounded-full">الحالة الحالية فقط</span>
                )}
              </div>
              <p className="text-[10px] text-slate-400">القيمة الحالية: <span className="text-white font-semibold">{ev.currentValue.slice(0, 80)}</span></p>
              <p className="text-[9px] text-slate-600 mt-0.5">
                {ev.previousValue === null && !ev.hasHistory
                  ? 'القيمة السابقة غير متاحة في السجل الموجود.'
                  : `تغيّر في: ${ev.changedAt !== 'غير متاح' ? new Date(ev.changedAt).toLocaleString('ar-EG') : 'غير متاح'}`}
              </p>
            </motion.div>
          ))}
        </div>
      )}

      {state === 'success' && events.length === 0 && !recordInfo && (
        <EmptyState icon={<AlertCircle size={28} />} message="السجل غير موجود أو لا توجد بيانات" />
      )}
    </div>
  );
}

// ============================================================================
// 4. CROSS-SYSTEM RECONCILIATION ENGINE
// ============================================================================

function ReconciliationEngine() {
  const { showToast } = useToast();
  const { state, start, succeed, fail, reset } = useSafeLoading();
  const [issues, setIssues] = useState<ReconciliationIssue[]>([]);
  const [hasRun, setHasRun] = useState(false);

  const runChecks = useCallback(async () => {
    start();
    setIssues([]);
    setHasRun(true);

    try {
      const found: ReconciliationIssue[] = [];

      // Check 1: Attendance referencing missing students
      const { data: orphanAtt } = await supabase
        .from('attendance').select('student_id, session_id, attendance_date')
        .limit(200);
      if (orphanAtt && orphanAtt.length > 0) {
        const studentIds = [...new Set(orphanAtt.map(a => a.student_id))];
        const { data: existingStudents } = await supabase
          .from('students').select('id').in('id', studentIds);
        const existingSet = new Set((existingStudents ?? []).map(s => s.id));
        const missing = studentIds.filter(sid => !existingSet.has(sid));
        if (missing.length > 0) {
          found.push({
            id: 'orphan-attendance-students',
            severity: 'conflict',
            category: 'الحضور ↔ الطلاب',
            title: 'سجلات حضور تشير لطلاب غير موجودين',
            explanation: `تم العثور على ${missing.length} طالب في سجلات الحضور غير موجودين في جدول الطلاب. هذا يعني أن هناك حضور مسجل لطلاب ربما تم حذفهم.`,
            recordIds: missing.slice(0, 5),
            evidence: `سجلات حضور: ${orphanAtt.length} — طلاب فريدون: ${studentIds.length} — مفقودون: ${missing.length}`,
          });
        } else {
          found.push({ id: 'orphan-attendance-students', severity: 'ok', category: 'الحضور ↔ الطلاب', title: 'جميع سجلات الحضور تشير لطلاب موجودين', explanation: 'لا توجد سجلات حضور يتيمة.', recordIds: [], evidence: `${studentIds.length} طالب فحص — الكل موجود` });
        }
      }

      // Check 2: Grades referencing missing sessions
      const { data: grades } = await supabase
        .from('center_grades').select('id, session_id, student_id, is_deleted').eq('is_deleted', false).limit(200);
      if (grades && grades.length > 0) {
        const sessionIds = [...new Set(grades.filter(g => g.session_id).map(g => g.session_id))];
        if (sessionIds.length > 0) {
          const { data: existingSessions } = await supabase
            .from('sessions').select('id').in('id', sessionIds);
          const existingSet = new Set((existingSessions ?? []).map(s => s.id));
          const missingSessions = sessionIds.filter(sid => !existingSet.has(sid));
          if (missingSessions.length > 0) {
            found.push({
              id: 'grades-missing-sessions',
              severity: 'conflict',
              category: 'الدرجات ↔ الحصص',
              title: 'درجات تشير لحصص غير موجودة',
              explanation: `تم العثور على ${missingSessions.length} حصة في سجلات الدرجات غير موجودة في جدول الحصص. قد تكون هذه الحصص محذوفة أو مؤرشفة.`,
              recordIds: missingSessions.slice(0, 5),
              evidence: `درجات: ${grades.length} — حصص مرجعية: ${sessionIds.length} — مفقودة: ${missingSessions.length}`,
            });
          } else {
            found.push({ id: 'grades-missing-sessions', severity: 'ok', category: 'الدرجات ↔ الحصص', title: 'جميع الدرجات تشير لحصص موجودة', explanation: 'لا توجد درجات يتيمة.', recordIds: [], evidence: `${sessionIds.length} حصة فحص — الكل موجود` });
          }
        }
      }

      // Check 3: Payments referencing missing students
      const { data: payments } = await supabase
        .from('payments').select('id, student_id, amount').limit(200);
      if (payments && payments.length > 0) {
        const payStudentIds = [...new Set(payments.map(p => p.student_id))];
        const { data: existingPayStudents } = await supabase
          .from('students').select('id').in('id', payStudentIds);
        const existingSet = new Set((existingPayStudents ?? []).map(s => s.id));
        const missingPay = payStudentIds.filter(sid => !existingSet.has(sid));
        if (missingPay.length > 0) {
          found.push({
            id: 'payments-missing-students',
            severity: 'conflict',
            category: 'المدفوعات ↔ الطلاب',
            title: 'مدفوعات تشير لطلاب غير موجودين',
            explanation: `تم العثور على ${missingPay.length} طالب في المدفوعات غير موجودين في جدول الطلاب. قد تكون هذه مدفوعات لطلاب تم حذفهم.`,
            recordIds: missingPay.slice(0, 5),
            evidence: `مدفوعات: ${payments.length} — طلاب فريدون: ${payStudentIds.length} — مفقودون: ${missingPay.length}`,
          });
        } else {
          found.push({ id: 'payments-missing-students', severity: 'ok', category: 'المدفوعات ↔ الطلاب', title: 'جميع المدفوعات تشير لطلاب موجودين', explanation: 'لا توجد مدفوعات يتيمة.', recordIds: [], evidence: `${payStudentIds.length} طالب فحص — الكل موجود` });
        }
      }

      // Check 4: Students in non-existent groups
      const { data: activeStudents } = await supabase
        .from('students').select('id, name, group_id').eq('is_deleted', false).eq('status', 'active').limit(200);
      if (activeStudents && activeStudents.length > 0) {
        const groupIds = [...new Set(activeStudents.filter(s => s.group_id).map(s => s.group_id))];
        if (groupIds.length > 0) {
          const { data: existingGroups } = await supabase
            .from('groups').select('id').in('id', groupIds);
          const existingSet = new Set((existingGroups ?? []).map(g => g.id));
          const missingGroups = groupIds.filter(gid => !existingSet.has(gid));
          if (missingGroups.length > 0) {
            found.push({
              id: 'students-missing-groups',
              severity: 'review',
              category: 'الطلاب ↔ المجموعات',
              title: 'طلاب نشطون في مجموعات غير موجودة',
              explanation: `تم العثور على ${missingGroups.length} مجموعة مذكورة في سجلات الطلاب غير موجودة في جدول المجموعات. هؤلاء الطلاب قد يحتاجون لإعادة تصنيف.`,
              recordIds: missingGroups.slice(0, 5),
              evidence: `طلاب نشطون: ${activeStudents.length} — مجموعات فريدة: ${groupIds.length} — مفقودة: ${missingGroups.length}`,
            });
          } else {
            found.push({ id: 'students-missing-groups', severity: 'ok', category: 'الطلاب ↔ المجموعات', title: 'جميع الطلاب في مجموعات موجودة', explanation: 'لا توجد مجموعات مفقودة.', recordIds: [], evidence: `${groupIds.length} مجموعة فحص — الكل موجود` });
          }
        }
      }

      // Check 5: Homework status referencing missing homework
      const { data: hwStatus } = await supabase
        .from('homework_status').select('id, homework_id').limit(100);
      if (hwStatus && hwStatus.length > 0) {
        const hwIds = [...new Set(hwStatus.map(h => h.homework_id))];
        const { data: existingHw } = await supabase
          .from('homework').select('id').in('id', hwIds);
        const existingSet = new Set((existingHw ?? []).map(h => h.id));
        const missingHw = hwIds.filter(hid => !existingSet.has(hid));
        if (missingHw.length > 0) {
          found.push({
            id: 'hwstatus-missing-hw',
            severity: 'review',
            category: 'الواجبات ↔ حالة الواجبات',
            title: 'حالة واجبات تشير لواجبات غير موجودة',
            explanation: `تم العثور على ${missingHw.length} واجب في سجلات الحالة غير موجودة في جدول الواجبات.`,
            recordIds: missingHw.slice(0, 5),
            evidence: `سجلات حالة: ${hwStatus.length} — واجبات فريدة: ${hwIds.length} — مفقودة: ${missingHw.length}`,
          });
        }
      }

      setIssues(found);
      succeed();
      const conflicts = found.filter(f => f.severity === 'conflict').length;
      const reviews = found.filter(f => f.severity === 'review').length;
      showToast(`اكتمل: ${conflicts} تعارض، ${reviews} مراجعة`, conflicts > 0 ? 'error' : 'success');
    } catch {
      fail();
      showToast('تعذّر إكمال التطابق', 'error');
    }
  }, [start, succeed, fail, showToast]);

  const conflictCount = issues.filter(i => i.severity === 'conflict').length;
  const reviewCount = issues.filter(i => i.severity === 'review').length;
  const okCount = issues.filter(i => i.severity === 'ok').length;

  const sevConfig = {
    conflict: { icon: AlertCircle, color: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/10', label: 'تعارض' },
    review: { icon: AlertTriangle, color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10', label: 'مراجعة' },
    ok: { icon: CheckCircle2, color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', label: 'سليم' },
  };

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GitCompare size={18} className="text-red-400" />
          <h3 className="text-sm font-bold text-white">محرّك التطابق بين الأنظمة</h3>
          <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">كشف فقط — لا إصلاح</span>
        </div>
        <button
          onClick={runChecks}
          disabled={state === 'loading'}
          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition disabled:opacity-50 flex items-center gap-1.5"
        >
          {state === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          فحص التطابق
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        يفحص التناسق بين الجداول المختلفة. يكتشف التعارضات الحقيقية فقط — لا يخترع مشاكل ولا يصلحها تلقائياً.
      </p>

      {state === 'timeout' && (
        <div className="glass-light rounded-xl p-3 border border-amber-500/30 mb-3">
          <p className="text-xs text-amber-400">انتهت مهلة الفحص — حاول مرة أخرى.</p>
        </div>
      )}

      {!hasRun && state === 'idle' && (
        <EmptyState icon={<GitCompare size={32} />} message="اضغط «فحص التطابق» لبدء التحقق من تناسق البيانات" />
      )}

      {hasRun && issues.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="glass-light rounded-xl p-2 text-center border border-red-500/20">
              <p className="text-[10px] text-slate-400">تعارض</p>
              <p className="text-lg font-bold text-red-400">{conflictCount}</p>
            </div>
            <div className="glass-light rounded-xl p-2 text-center border border-amber-500/20">
              <p className="text-[10px] text-slate-400">مراجعة</p>
              <p className="text-lg font-bold text-amber-400">{reviewCount}</p>
            </div>
            <div className="glass-light rounded-xl p-2 text-center border border-emerald-500/20">
              <p className="text-[10px] text-slate-400">سليم</p>
              <p className="text-lg font-bold text-emerald-400">{okCount}</p>
            </div>
          </div>

          <div className="space-y-2">
            {issues.map((issue) => {
              const cfg = sevConfig[issue.severity];
              const Icon = cfg.icon;
              return (
                <motion.div
                  key={issue.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`glass-light rounded-xl p-3 border ${cfg.border}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex-shrink-0 mt-0.5 p-1 rounded-lg ${cfg.bg}`}>
                      <Icon size={14} className={cfg.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{issue.title}</span>
                        <span className={`text-[9px] ${cfg.color} font-bold`}>{cfg.label}</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">{issue.category}</p>
                      <p className="text-xs text-slate-300 mt-1">{issue.explanation}</p>
                      <p className="text-[9px] text-slate-500 mt-1 font-mono">الدليل: {issue.evidence}</p>
                      {issue.recordIds.length > 0 && (
                        <p className="text-[9px] text-slate-600 mt-0.5 font-mono">معرّفات: {issue.recordIds.join('، ').slice(0, 100)}</p>
                      )}
                      {issue.severity !== 'ok' && (
                        <p className="text-[10px] text-amber-400/80 mt-2 flex items-center gap-1">
                          <AlertTriangle size={10} />
                          مراجعة يدوية مطلوبة — لا يتم الإصلاح تلقائياً.
                        </p>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// MAIN — tabbed container, all read-only
// ============================================================================

const TOOLS: { id: ToolId; label: string; icon: React.ReactNode; description: string }[] = [
  { id: 'impact', label: 'أثر التغيير', icon: <GitBranch size={16} />, description: 'تحليل العلاقات قبل التغيير' },
  { id: 'lineage', label: 'تتبع المصدر', icon: <Search size={16} />, description: 'من أين جاءت القيمة' },
  { id: 'forensic', label: 'الوضع الجنائي', icon: <History size={16} />, description: 'تاريخ السجل المتاح' },
  { id: 'reconciliation', label: 'التطابق', icon: <GitCompare size={16} />, description: 'فحص التناسق بين الأنظمة' },
];

export default function PlatformIntelligence() {
  const [activeTool, setActiveTool] = useState<ToolId>('impact');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Brain size={22} className="text-emerald-400" />
          <h2 className="text-lg font-bold text-white">ذكاء المنصة</h2>
          <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full font-bold">طبقة تحليل — قراءة فقط</span>
        </div>
        <p className="text-xs text-slate-400">
          أدوات تحليلية تقرأ بيانات المنصة الموجودة وتحللها دون تعديل أي سجل. جميع النتائج للتوضيح والمراجعة فقط.
        </p>
      </div>

      {/* Tool selector tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition flex-shrink-0 ${
              activeTool === tool.id
                ? 'bg-emerald-600 text-white shadow-lg'
                : 'glass-light text-slate-400 hover:text-white hover:bg-white/10'
            }`}
          >
            {tool.icon}
            {tool.label}
          </button>
        ))}
      </div>

      {/* Active tool */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTool}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
        >
          {activeTool === 'impact' && <ChangeImpactEngine />}
          {activeTool === 'lineage' && <DataLineage />}
          {activeTool === 'forensic' && <ForensicMode />}
          {activeTool === 'reconciliation' && <ReconciliationEngine />}
        </motion.div>
      </AnimatePresence>

      {/* Footer disclaimer */}
      <div className="glass-card rounded-xl p-3 border border-sky-500/20">
        <div className="flex items-start gap-2">
          <Info size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
          <div className="text-[10px] text-slate-400 space-y-0.5">
            <p>جميع أدوات الذكاء تقرأ البيانات الموجودة فقط — لا تنشئ نسخة منافسة ولا تعدل أي سجل.</p>
            <p>إذا لم تتوفر بيانات كافية للتحقق، يظهر: «لا توجد بيانات كافية للتحقق».</p>
            <p>التغييرات الفعلية تتم فقط عبر الوحدات الموجودة في المنصة.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
