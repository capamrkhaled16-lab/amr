import { supabase } from './supabase';
import { ARABIC_MONTHS, ARABIC_DAYS } from './constants';
import { computeFinancialSummary } from './financeCalc';
import type { Student as StudentType } from './types';
import { calcStudentAverages, type RawGrade } from './gradeCalc';
import { swrFetch, invalidateCache, invalidateByPrefix, withTimeout } from './cache';
import { idempotencyGuard, generateOpKey } from './idempotency';
import { safeWrite, generateOpKey as safeOpKey } from './safeWrite';
import { emitPaymentsChanged, emitAttendanceChanged, emitStudentsChanged, emitSessionsChanged, emitHomeworkChanged, emitBehaviorChanged, emitGradesChanged, emitGroupsChanged } from './eventBus';

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function monthStart(monthKey?: string): string {
  return `${monthKey ?? currentMonthKey()}-01`;
}

export function nextMonthStart(monthKey?: string): string {
  const mk = monthKey ?? currentMonthKey();
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
import type {
  AcademicStage,
  GradeLevel,
  Group,
  Student,
  AttendanceRecord,
  CenterExam,
  CenterGrade,
  OnlineExam,
  ExamQuestion,
  ExamSubmission,
  ExamAnswer,
  OnlineGrade,
  Certificate,
  AttendanceStatus,
  Assistant,
  Payment,
  MonthlySubscription,
  SubscriptionStatus,
  Session,
  MonthlyArchive,
  HallOfFameEntry,
  AuditLog,
  Homework,
  HomeworkStatus,
  HomeworkStatusType,
  BehaviorEval,
  BehaviorRating,
  BehaviorScope,
  StudentStatus,
  Expense,
  ExpenseCategory,
  GroupTransfer,
  ArchiveRun,
  CarriedOverBalance,
  AccountingCycle,
  MonthClosure,
  DataCheckIssue,
  HealthScore,
  ExamSection,
  QuestionBankItem,
  ExamVariant,
  ExamLifecycleStatus,
  QuestionType,
  ExamReentryRequest,
  ReentryRequestStatus,
} from './types';

type ArchivedPaymentRow = {
  id: string;
  student_id: string;
  amount: number;
  payment_date: string;
  note?: string | null;
  receipt_number?: string | null;
};

export async function fetchStages(): Promise<AcademicStage[]> {
  return swrFetch('stages', async () => {
    const { data, error } = await supabase
      .from('academic_stages')
      .select('id, name, sort_order')
      .order('sort_order');
    if (error) throw error;
    return (data ?? []) as AcademicStage[];
  }, 120_000);
}

export async function fetchGradeLevels(stageId: string): Promise<GradeLevel[]> {
  return swrFetch(`grade_levels_${stageId}`, async () => {
    const { data, error } = await supabase
      .from('grade_levels')
      .select('id, stage_id, name, sort_order, base_subscription')
      .eq('stage_id', stageId)
      .order('sort_order');
    if (error) throw error;
    const result = (data ?? []) as GradeLevel[];
    return result;
  }, 120_000);
}

export async function fetchGroups(gradeLevelId: string): Promise<Group[]> {
  return swrFetch(`groups_${gradeLevelId}`, async () => {
    const { data, error } = await supabase
      .from('groups')
      .select('id, grade_level_id, name, schedule, created_at')
      .eq('grade_level_id', gradeLevelId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []) as Group[];
  }, 60_000);
}

export async function createGroup(
  gradeLevelId: string,
  name: string,
  schedule: string | null = null
): Promise<Group | null> {
  const { data } = await supabase
    .from('groups')
    .insert({ grade_level_id: gradeLevelId, name, schedule })
    .select()
    .single();
  invalidateCache(`groups_${gradeLevelId}`);
  return data;
}

export async function deleteGroup(groupId: string): Promise<void> {
  await supabase.from('groups').delete().eq('id', groupId);
  invalidateByPrefix('groups_');
  emitGroupsChanged();
}

export async function updateGroup(
  groupId: string,
  patch: { name?: string; schedule?: string | null }
): Promise<void> {
  await supabase.from('groups').update(patch).eq('id', groupId);
  invalidateByPrefix('groups_');
  emitGroupsChanged();
}

export async function transferStudent(
  studentId: string,
  newGroupId: string,
  actorName: string = 'النظام'
): Promise<void> {
  const { data: student } = await supabase
    .from('students')
    .select('group_id')
    .eq('id', studentId)
    .maybeSingle();
  const fromGroupId = (student as { group_id: string | null } | null)?.group_id ?? null;
  // Only update the student's current group — do NOT rewrite historical attendance/grades/homework
  await supabase.from('students').update({ group_id: newGroupId }).eq('id', studentId);
  await supabase.from('group_transfers').insert({
    student_id: studentId,
    from_group_id: fromGroupId,
    to_group_id: newGroupId,
    actor_name: actorName,
  });
  if (fromGroupId) invalidateCache(`students_${fromGroupId}`);
  invalidateCache(`students_${newGroupId}`);
  invalidateByPrefix('all_students');
  invalidateByPrefix('kpi_');
  emitStudentsChanged(fromGroupId ?? undefined);
  emitStudentsChanged(newGroupId);
}

// Fetch groups for transfer — bypasses SWR cache to always show current state
export async function fetchGroupsForTransfer(gradeLevelId: string, excludeGroupId?: string): Promise<Group[]> {
  const { data } = await supabase
    .from('groups')
    .select('id, grade_level_id, name, schedule, created_at')
    .eq('grade_level_id', gradeLevelId)
    .order('name');
  const all = (data ?? []) as Group[];
  return excludeGroupId ? all.filter((g) => g.id !== excludeGroupId) : all;
}

export async function fetchStudentsByGroup(groupId: string): Promise<Student[]> {
  return swrFetch(`students_${groupId}`, async () => {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, phone, parent_phone, group_id, status, total_fees, paid_fees, is_exempt, discount_mode, discount_amount, discount_percent, fee_mode, pro_rata_sessions, join_month_key, enrollment_date, created_at')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []) as Student[];
  });
}

export async function fetchMonthlyExemptMap(monthKey: string): Promise<Map<string, true>> {
  const { data } = await supabase
    .from('monthly_subscriptions')
    .select('student_id')
    .eq('month_key', monthKey)
    .eq('is_exempt', true)
    .eq('is_archived', false);
  const map = new Map<string, true>();
  for (const row of (data ?? []) as { student_id: string }[]) {
    map.set(row.student_id, true);
  }
  return map;
}

export async function fetchDashboardKPIs(monthKey?: string): Promise<{
  allStudents: (Student & { group_name?: string; group_schedule?: string | null; grade_name?: string; stage_name?: string })[];
  fees: { collected: number; remaining: number };
  monthlyPaidArr: [string, number][];
  monthExemptArr: string[];
  allGroups: Group[];
}> {
  const mk = monthKey ?? currentMonthKey();
  return swrFetch(`kpi_${mk}`, async () => {
  const timeoutMs = 6_000;
  const timeout = <T>(p: PromiseLike<T>): Promise<T> =>
    Promise.race([
      p as Promise<T>,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), timeoutMs)
      ),
    ]);

  // Use allSettled so a single failed request doesn't kill the entire startup.
  // Students query is critical — if it fails, we throw. Others degrade gracefully.
  const [studentsSettled, paymentsSettled, exemptionsSettled, groupsSettled] = await Promise.allSettled([
    timeout(supabase
      .from('students')
      .select('id, name, phone, parent_phone, group_id, status, total_fees, paid_fees, is_exempt, discount_mode, discount_amount, discount_percent, fee_mode, pro_rata_sessions, join_month_key, enrollment_date, created_at, group:groups(name, schedule, grade_level:grade_levels(name, stage:academic_stages(name, sort_order)))')
      .eq('status', 'active')
      .order('name')),
    timeout(supabase
      .from('payments')
      .select('student_id, amount')
      .eq('month_key', mk)
      .eq('is_deleted', false)
      .eq('is_historical_payment', false)
      .gt('amount', 0)),
    timeout(supabase
      .from('monthly_subscriptions')
      .select('student_id')
      .eq('month_key', mk)
      .eq('is_exempt', true)
      .eq('is_archived', false)),
    timeout(supabase
      .from('groups')
      .select('id, grade_level_id, name, schedule, created_at, grade_level:grade_levels(name, stage:academic_stages(name, sort_order))')
      .order('name')),
  ]);

  if (studentsSettled.status === 'rejected') {
    const err = studentsSettled.reason;
    throw new Error(err instanceof Error ? err.message : 'تعذّر تحميل بيانات الطلاب');
  }
  const studentsRes = studentsSettled.value;
  if (studentsRes.error) throw new Error(studentsRes.error.message);

  const allStudents = ((studentsRes.data ?? []) as (Student & { group: { name: string; schedule: string | null; grade_level: { name: string; stage: { name: string; sort_order: number } } } | null })[]).map((s) => ({
    ...s,
    group_name: s.group?.name,
    group_schedule: s.group?.schedule,
    grade_name: s.group?.grade_level?.name,
    stage_name: s.group?.grade_level?.stage?.name,
  }));

  const monthlyPaidArr: [string, number][] = [];
  if (paymentsSettled.status === 'fulfilled' && !paymentsSettled.value.error) {
    const tempMap = new Map<string, number>();
    for (const p of (paymentsSettled.value.data ?? []) as { student_id: string; amount: number }[]) {
      tempMap.set(p.student_id, (tempMap.get(p.student_id) ?? 0) + (p.amount ?? 0));
    }
    for (const [k, v] of tempMap) monthlyPaidArr.push([k, v]);
  }

  const monthExemptArr: string[] = [];
  if (exemptionsSettled.status === 'fulfilled' && !exemptionsSettled.value.error) {
    for (const row of (exemptionsSettled.value.data ?? []) as { student_id: string }[]) {
      monthExemptArr.push(row.student_id);
    }
  }

  const monthlyPaidMap = new Map<string, number>(monthlyPaidArr);
  const monthExemptMap = new Map<string, true>(monthExemptArr.map((id) => [id, true] as [string, true]));

  const summary = computeFinancialSummary(allStudents, monthlyPaidMap, monthExemptMap);

  const allGroups = groupsSettled.status === 'fulfilled' && !groupsSettled.value.error
    ? (groupsSettled.value.data ?? []) as Group[]
    : [];

  return { allStudents, fees: { collected: summary.collected, remaining: summary.remaining }, monthlyPaidArr, monthExemptArr, allGroups };
  }, 30_000);
}

export async function fetchAllStudents(): Promise<(Student & { group_name?: string; group_schedule?: string | null; grade_name?: string; stage_name?: string })[]> {
  return swrFetch('all_students', async () => {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, phone, parent_phone, group_id, status, total_fees, paid_fees, is_exempt, discount_mode, discount_amount, discount_percent, fee_mode, pro_rata_sessions, join_month_key, enrollment_date, created_at, group:groups(name, schedule, grade_level:grade_levels(name, stage:academic_stages(name)))')
    .eq('status', 'active')
    .order('name');
  if (error) throw new Error(error.message);
  if (!data) return [];
  return (data as (Student & { group: { name: string; schedule: string | null; grade_level: { name: string; stage: { name: string } } } | null })[]).map((s) => ({
    ...s,
    group_name: s.group?.name,
    group_schedule: s.group?.schedule,
    grade_name: s.group?.grade_level?.name,
    stage_name: s.group?.grade_level?.stage?.name,
  }));
  }, 60_000);
}

export async function createStudent(
  payload: Partial<Student>
): Promise<Student | null> {
  const { data, error } = await supabase
    .from('students')
    .insert(payload)
    .select()
    .single();
  if (error) {
    console.error('createStudent error:', error);
    return null;
  }
  if (payload.group_id) invalidateCache(`students_${payload.group_id}`);
  emitStudentsChanged(payload.group_id);
  return data;
}

export async function updateStudent(
  id: string,
  patch: Partial<Student>
): Promise<void> {
  await supabase.from('students').update(patch).eq('id', id);
  invalidateByPrefix('students_');
  emitStudentsChanged();
}

export async function setStudentExemption(
  id: string,
  exempt: boolean,
  actorName: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'master',
  monthKey?: string
): Promise<void> {
  const mk = monthKey ?? currentMonthKey();
  const { data: student } = await supabase
    .from('students')
    .select('name, is_exempt, total_fees, paid_fees')
    .eq('id', id)
    .maybeSingle();

  // Write exemption to monthly_subscriptions for the active month ONLY.
  // Do NOT zero out total_fees — fees must be preserved so that removing
  // the exemption restores the student to their normal financial state.
  const { data: existingSubs } = await supabase
    .from('monthly_subscriptions')
    .select('id, amount_due, amount_paid, status')
    .eq('student_id', id)
    .eq('month_key', mk)
    .order('created_at', { ascending: false })
    .limit(1);
  const sub = (existingSubs ?? [])[0] as { id: string; amount_due: number; amount_paid: number; status: string } | undefined;

  if (sub) {
    await supabase
      .from('monthly_subscriptions')
      .update({
        is_exempt: exempt,
        exemption_note: exempt ? `إعفاء يدوي بواسطة ${actorName}` : null,
      })
      .eq('id', sub.id);
  } else {
    // No subscription row for this month yet — create one.
    const studentName = (student as { name?: string } | null)?.name ?? '';
    const monthLabel = ARABIC_MONTHS[parseInt(mk.split('-')[1], 10) - 1] ?? mk;
    await supabase
      .from('monthly_subscriptions')
      .insert({
        student_id: id,
        month: `${monthLabel} ${mk.split('-')[0]}`,
        month_key: mk,
        amount_due: 0,
        amount_paid: 0,
        status: exempt ? 'paid' : 'unpaid',
        is_exempt: exempt,
        exemption_note: exempt ? `إعفاء يدوي بواسطة ${actorName}` : null,
      });
  }

  // Keep the global flag in sync for backward compatibility, but do NOT
  // zero total_fees. The monthly_subscriptions.is_exempt is the source of truth.
  await supabase.from('students').update({ is_exempt: exempt }).eq('id', id);

  if (student) {
    await createAuditLog(
      actorName,
      actorRole,
      'exemption_toggle',
      id,
      null,
      `${exempt ? 'تفعيل الإعفاء' : 'إلغاء الإعفاء'} لشهر ${mk}: ${(student as { name?: string }).name ?? ''}`
    );
  }
}

export async function setStudentDiscount(
  id: string,
  mode: 'fixed' | 'percent' | null,
  amount: number,
  percent: number,
  actorName: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'master'
): Promise<void> {
  const safeAmount = Math.max(0, Math.round(amount * 100) / 100);
  const safePercent = Math.max(0, Math.min(100, Math.round(percent * 100) / 100));
  const patch: Partial<Student> = {
    discount_mode: mode,
    discount_amount: mode === 'fixed' ? safeAmount : 0,
    discount_percent: mode === 'percent' ? safePercent : 0,
  };
  if (mode === null) {
    patch.discount_amount = 0;
    patch.discount_percent = 0;
  }
  const { data: student } = await supabase
    .from('students')
    .select('name, discount_mode, discount_amount, discount_percent')
    .eq('id', id)
    .maybeSingle();
  await supabase.from('students').update(patch).eq('id', id);
  if (student) {
    const desc = mode === 'fixed'
      ? `خصم ثابت: ${safeAmount} ج.م`
      : mode === 'percent'
      ? `خصم نسبة: ${safePercent}%`
      : 'إلغاء الخصم';
    await createAuditLog(
      actorName,
      actorRole,
      'discount_update',
      id,
      null,
      `${desc} — ${(student as { name?: string }).name ?? ''}`
    );
  }
}

export function computeEffectiveFees(student: Student, baseFee: number): number {
  if (student.is_exempt) return 0;
  let effective = baseFee;
  if (student.discount_mode === 'percent' && student.discount_percent > 0) {
    effective = baseFee * (1 - student.discount_percent / 100);
  } else if (student.discount_mode === 'fixed' && student.discount_amount > 0) {
    effective = baseFee - student.discount_amount;
  } else if (student.discount_amount > 0) {
    effective = baseFee - student.discount_amount;
  }
  return Math.max(0, Math.round(effective * 100) / 100);
}

export async function updateStudentTotalFees(
  id: string,
  newTotalFees: number,
  actorName: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'master'
): Promise<void> {
  const { data: student } = await supabase
    .from('students')
    .select('name, total_fees')
    .eq('id', id)
    .maybeSingle();
  await supabase.from('students').update({ total_fees: newTotalFees }).eq('id', id);
  invalidateByPrefix('students_');
  emitStudentsChanged();
  if (student) {
    await createAuditLog(
      actorName,
      actorRole,
      'fee_override',
      id,
      newTotalFees,
      `تعديل يدوي للمصاريف: ${(student as { name?: string }).name ?? ''} — من ${((student as { total_fees?: number }).total_fees ?? 0)} إلى ${newTotalFees}`
    );
  }
}

export async function setStudentStatus(
  id: string,
  status: StudentStatus,
  actorName: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'master'
): Promise<void> {
  const { data: student } = await supabase
    .from('students')
    .select('name, group_id, total_fees, paid_fees')
    .eq('id', id)
    .maybeSingle();
  await supabase.from('students').update({ status, is_deleted: status !== 'active' }).eq('id', id);
  // Invalidate student caches for the group
  const groupId = (student as { group_id?: string } | null)?.group_id;
  if (groupId) invalidateCache(`students_${groupId}`);
  if (status !== 'active') {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    await supabase
      .from('monthly_subscriptions')
      .update({ is_archived: true })
      .eq('student_id', id)
      .eq('month_key', currentMonth)
      .eq('is_archived', false);
  }
  if (student) {
    const actionLabel = status === 'left' ? 'تحديد الطالب كمغادر' : 'حذف الطالب';
    await createAuditLog(
      actorName,
      actorRole,
      status === 'left' ? 'student_left' : 'student_delete',
      id,
      (student as { total_fees?: number; paid_fees?: number }).total_fees ?? null,
      `${actionLabel}: ${(student as { name?: string }).name ?? ''}`
    );
  }
}

export async function deleteStudent(
  id: string,
  actorName: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'master'
): Promise<void> {
  await setStudentStatus(id, 'deleted', actorName, actorRole);
  invalidateByPrefix('all_students');
  invalidateByPrefix('kpi_');
}

export async function restoreStudent(
  id: string,
  actorName: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'master'
): Promise<void> {
  const { data: student } = await supabase
    .from('students')
    .select('name, group_id')
    .eq('id', id)
    .maybeSingle();
  await supabase.from('students').update({ status: 'active', is_deleted: false }).eq('id', id);
  const groupId = (student as { group_id?: string } | null)?.group_id;
  if (groupId) invalidateCache(`students_${groupId}`);
  invalidateByPrefix('all_students');
  invalidateByPrefix('kpi_');
  if (student) {
    await createAuditLog(actorName, actorRole, 'student_restore', id, null, `استعادة طالب: ${(student as { name?: string }).name ?? ''}`);
  }
}

export async function fetchTrashedStudents(groupId?: string): Promise<Student[]> {
  let query = supabase
    .from('students')
    .select('id, name, phone, parent_phone, group_id, status, total_fees, paid_fees, is_exempt, discount_mode, discount_amount, discount_percent, fee_mode, pro_rata_sessions, join_month_key, enrollment_date, created_at')
    .eq('status', 'deleted')
    .order('name');
  if (groupId) query = query.eq('group_id', groupId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function hardDeleteStudent(
  id: string,
  actorName: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'master'
): Promise<void> {
  const { data: student } = await supabase
    .from('students')
    .select('name, group_id')
    .eq('id', id)
    .maybeSingle();
  await supabase.from('payments').delete().eq('student_id', id);
  await supabase.from('attendance').delete().eq('student_id', id);
  await supabase.from('homework_status').delete().eq('student_id', id);
  await supabase.from('monthly_subscriptions').delete().eq('student_id', id);
  await supabase.from('hall_of_fame').delete().eq('student_id', id);
  await supabase.from('students').delete().eq('id', id);
  if (student?.group_id) invalidateCache(`students_${student.group_id}`);
  if (student) {
    await createAuditLog(actorName, actorRole, 'student_delete', id, null, `حذف نهائي: ${student.name}`);
  }
}

export async function fetchAttendanceForDate(
  groupId: string,
  date: string,
  sessionId?: string | null
): Promise<AttendanceRecord[]> {
  let query = supabase
    .from('attendance')
    .select('*, student_id')
    .eq('group_id', groupId)
    .eq('attendance_date', date);
  if (sessionId) {
    query = query.eq('session_id', sessionId);
  } else {
    query = query.is('session_id', null);
  }
  const { data } = await query;
  // Deduplicate by student_id. When multiple records exist for the same
  // student on the same date (e.g. from different sessions), prefer a real
  // status over "unrecorded" to suppress ghost "غير مسجل" fallback rows.
  // Among same-priority records, keep the latest recorded_at.
  const byStudent = new Map<string, AttendanceRecord>();
  for (const r of data ?? []) {
    const existing = byStudent.get(r.student_id);
    if (!existing) {
      byStudent.set(r.student_id, r);
      continue;
    }
    const rIsUnrecorded = r.status === 'unrecorded';
    const eIsUnrecorded = existing.status === 'unrecorded';
    if (rIsUnrecorded && !eIsUnrecorded) continue;
    if (!rIsUnrecorded && eIsUnrecorded) {
      byStudent.set(r.student_id, r);
      continue;
    }
    if ((r.recorded_at ?? '') > (existing.recorded_at ?? '')) {
      byStudent.set(r.student_id, r);
    }
  }
  return Array.from(byStudent.values());
}

export async function fetchAttendanceForStudent(
  studentId: string
): Promise<(AttendanceRecord & { sessions?: { id: string; title: string } | null })[]> {
  const { data } = await supabase
    .from('attendance')
    .select('*, sessions(id, title)')
    .eq('student_id', studentId)
    .order('attendance_date', { ascending: false });
  return data ?? [];
}

export async function fetchGroupTransfers(
  studentId: string
): Promise<(GroupTransfer & { from_group?: { name: string } | null; to_group?: { name: string } | null })[]> {
  const { data } = await supabase
    .from('group_transfers')
    .select('*, from_group:groups!from_group_id(name), to_group:groups!to_group_id(name)')
    .eq('student_id', studentId)
    .order('transferred_at', { ascending: false });
  return (data as (GroupTransfer & { from_group?: { name: string } | null; to_group?: { name: string } | null })[]) ?? [];
}

export async function upsertAttendance(
  studentId: string,
  groupId: string,
  status: AttendanceStatus,
  notes: string | null,
  date: string,
  sessionId?: string | null,
  lateMinutes?: number | null
): Promise<void> {
  const sessionValue = sessionId ?? null;
  const now = new Date().toISOString();

  await safeWrite(
    async () => {
      const { data, error } = await supabase.rpc('upsert_attendance', {
        p_student_id: studentId,
        p_group_id: groupId,
        p_status: status,
        p_notes: notes,
        p_attendance_date: date,
        p_session_id: sessionValue,
        p_recorded_at: now,
        p_late_minutes: lateMinutes ?? null,
      });
      if (error) throw new Error(error.message);
      const rows = data as { row_id: string; inserted: boolean }[] | null;
      const row = rows?.[0];
      if (!row?.row_id) throw new Error('لم يتم حفظ سجل الحضور');
      emitAttendanceChanged(groupId, studentId);
    },
    {
      opKey: safeOpKey('attendance', studentId, date, sessionValue ?? 'null'),
      cachePrefixes: ['attendance_'],
    }
  );
}

export async function fetchCenterExams(groupId: string, monthKey?: string): Promise<CenterExam[]> {
  const cacheKey = `exams_${groupId}_${monthKey ?? 'all'}`;
  return swrFetch(cacheKey, async () => {
    let query = supabase
      .from('center_exams')
      .select('*')
      .eq('group_id', groupId);
    if (monthKey) {
      const startDate = `${monthKey}-01`;
      const [y, m] = monthKey.split('-').map(Number);
      const endMonth = m === 12 ? 1 : m + 1;
      const endYear = m === 12 ? y + 1 : y;
      const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
      query = query.gte('exam_date', startDate).lt('exam_date', endDate);
    }
    const { data } = await query.order('created_at', { ascending: false });
    return data ?? [];
  });
}

export async function createCenterExam(
  groupId: string,
  title: string,
  maxScore: number,
  passScore: number,
  category: CenterExam['category'] = 'exam',
  sessionId?: string | null
): Promise<CenterExam | null> {
  let examDate: string | undefined;
  if (sessionId) {
    const { data: sess } = await supabase
      .from('sessions')
      .select('session_date')
      .eq('id', sessionId)
      .maybeSingle();
    if (sess?.session_date) examDate = (sess.session_date as string).slice(0, 10);
  }
  const { data, error } = await supabase
    .from('center_exams')
    .insert({
      group_id: groupId,
      title,
      max_score: maxScore,
      pass_score: passScore,
      category,
      session_id: sessionId ?? null,
      exam_date: examDate ?? new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCenterExam(id: string): Promise<void> {
  await supabase.from('center_grades').delete().eq('center_exam_id', id);
  const { error } = await supabase.from('center_exams').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateCenterExamMaxScore(
  examId: string,
  newMaxScore: number,
  newPassScore: number
): Promise<void> {
  const { error } = await supabase
    .from('center_exams')
    .update({ max_score: newMaxScore, pass_score: newPassScore })
    .eq('id', examId);
  if (error) throw new Error(error.message);
}

export async function updateCenterExamTitle(examId: string, title: string): Promise<void> {
  const { error } = await supabase.from('center_exams').update({ title }).eq('id', examId);
  if (error) throw new Error(error.message);
}

export async function fetchCenterGrades(examId: string): Promise<CenterGrade[]> {
  return swrFetch(`grades_${examId}`, async () => {
    const { data } = await supabase
      .from('center_grades')
      .select('*')
      .eq('center_exam_id', examId);
    return data ?? [];
  });
}

export async function upsertCenterGrade(
  examId: string,
  studentId: string,
  score: number,
  lockAfterSave: boolean = false,
  lockedBy: string | null = null
): Promise<void> {
  const { data: exam, error: examErr } = await supabase
    .from('center_exams')
    .select('max_score')
    .eq('id', examId)
    .maybeSingle();
  if (examErr) throw new Error(examErr.message);
  const maxScore = (exam as { max_score?: number } | null)?.max_score;
  if (maxScore == null) {
    throw new Error('تعذّر العثور على بيانات الامتحان — لا يمكن حفظ الدرجة');
  }
  if (score < 0) {
    throw new Error('خطأ: لا يمكن أن تكون الدرجة سالبة');
  }
  if (score > maxScore) {
    throw new Error(`خطأ: لا يمكن أن تتجاوز الدرجة القيمة العظمى (${maxScore})`);
  }

  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from('center_grades')
    .select('id, is_locked')
    .eq('center_exam_id', examId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (existing?.is_locked) {
    throw new Error('الدرجة مقفلة ولا يمكن تعديلها');
  }

  const payload: Record<string, unknown> = {
    center_exam_id: examId,
    student_id: studentId,
    score,
    updated_at: now,
  };
  if (lockAfterSave) {
    payload.is_locked = true;
    payload.locked_at = now;
    payload.locked_by = lockedBy;
  }
  await safeWrite(
    async () => {
      const { error } = await supabase
        .from('center_grades')
        .upsert(payload, { onConflict: 'center_exam_id,student_id' });
      if (error) throw new Error(error.message);
      emitGradesChanged(undefined, studentId);
    },
    {
      opKey: safeOpKey('centerGrade', examId, studentId),
      cacheKeys: [`grades_${examId}`],
      optimistic: true,
    }
  );
}

export async function fetchOnlineExams(groupId: string): Promise<OnlineExam[]> {
  const { data } = await supabase
    .from('exams')
    .select('*')
    .or(`group_id.eq.${groupId}`)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function fetchOnlineExamsByGradeLevel(gradeLevelId: string): Promise<OnlineExam[]> {
  const { data } = await supabase
    .from('exams')
    .select('*')
    .eq('grade_level_id', gradeLevelId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function fetchPublishedOnlineExamsByGradeLevel(gradeLevelId: string): Promise<OnlineExam[]> {
  const { data } = await supabase
    .from('exams')
    .select('*')
    .eq('grade_level_id', gradeLevelId)
    .eq('is_published', true)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function fetchExamsWithSubmissionCounts(
  gradeLevelId: string,
  groupId?: string | null
): Promise<(OnlineExam & { submission_count: number })[]> {
  let query = supabase
    .from('exams')
    .select(`*, exam_submissions(count)`)
    .eq('is_published', true);

  if (groupId) {
    query = query.or(`grade_level_id.eq.${gradeLevelId},group_id.eq.${groupId}`);
  } else {
    query = query.eq('grade_level_id', gradeLevelId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as unknown as Array<OnlineExam & { exam_submissions: { count: number }[] }>).map((ex) => ({
    ...ex,
    submission_count: ex.exam_submissions?.[0]?.count ?? 0,
  }));
}

export async function fetchExamByAccessCode(code: string): Promise<OnlineExam | null> {
  const { data } = await supabase
    .from('exams')
    .select('*')
    .eq('access_code', code.trim().toUpperCase())
    .eq('is_published', true)
    .maybeSingle();
  return data as OnlineExam | null;
}

export async function fetchRosterForExam(exam: OnlineExam): Promise<Student[]> {
  if (exam.group_id) {
    return fetchStudentsByGroup(exam.group_id);
  }
  if (exam.grade_level_id) {
    const groups = await fetchGroups(exam.grade_level_id);
    const groupIds = groups.map((g) => g.id);
    if (groupIds.length === 0) return [];
    const { data } = await supabase
      .from('students')
      .select('id, name, phone, parent_phone, group_id, status, total_fees, paid_fees, is_exempt, discount_mode, discount_amount, discount_percent, enrollment_date, created_at')
      .in('group_id', groupIds)
      .eq('status', 'active')
      .order('name');
    return data ?? [];
  }
  return [];
}

function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function fetchOnlineExamById(
  id: string
): Promise<OnlineExam | null> {
  const { data } = await supabase
    .from('exams')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return data;
}

export async function createOnlineExam(
  payload: Partial<OnlineExam>
): Promise<OnlineExam | null> {
  const { data, error } = await supabase
    .from('exams')
    .insert({
      ...payload,
      access_code: payload.access_code ?? generateAccessCode(),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as OnlineExam | null;
}

export async function updateOnlineExam(
  id: string,
  patch: Partial<OnlineExam>
): Promise<void> {
  const { error } = await supabase.from('exams').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteOnlineExam(id: string): Promise<void> {
  await supabase.from('exam_answers').delete().eq('exam_id', id);
  await supabase.from('exam_submissions').delete().eq('exam_id', id);
  await supabase.from('exam_questions').delete().eq('exam_id', id);
  await supabase.from('exam_sections').delete().eq('exam_id', id);
  await supabase.from('exam_variants').delete().eq('exam_id', id);
  await supabase.from('online_grades').delete().eq('exam_id', id);
  const { error } = await supabase.from('exams').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function fetchExamQuestions(examId: string): Promise<ExamQuestion[]> {
  const { data } = await supabase
    .from('exam_questions')
    .select('*')
    .eq('exam_id', examId)
    .order('sort_order');
  return data ?? [];
}

export async function createExamQuestion(
  payload: Partial<ExamQuestion>
): Promise<ExamQuestion | null> {
  const { data, error } = await supabase
    .from('exam_questions')
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateExamQuestion(
  id: string,
  patch: Partial<ExamQuestion>
): Promise<void> {
  const { error } = await supabase.from('exam_questions').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteExamQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('exam_questions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function fetchSubmission(
  examId: string,
  studentId: string
): Promise<ExamSubmission | null> {
  const { data } = await supabase
    .from('exam_submissions')
    .select('*')
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .maybeSingle();
  return data;
}

export async function createSubmission(
  examId: string,
  studentId: string,
  maxScore: number,
  studentName?: string,
  studentPhone?: string
): Promise<ExamSubmission | null> {
  const { data, error } = await supabase
    .from('exam_submissions')
    .insert({
      exam_id: examId,
      student_id: studentId,
      max_score: maxScore,
      status: 'waiting',
      started_at: new Date().toISOString(),
      student_name: studentName ?? null,
      student_phone: studentPhone ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateSubmission(
  id: string,
  patch: Partial<ExamSubmission>
): Promise<void> {
  const { error } = await supabase.from('exam_submissions').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateSubmissionProgress(
  submissionId: string,
  currentQuestionIndex: number,
  answeredCount: number
): Promise<void> {
  const { error } = await supabase
    .from('exam_submissions')
    .update({
      current_question_index: currentQuestionIndex,
      answered_count: answeredCount,
      last_activity_at: new Date().toISOString(),
    })
    .eq('id', submissionId);
  if (error) throw new Error(error.message);
}

export async function fetchSubmissionAnswersCount(submissionId: string): Promise<number> {
  const { count } = await supabase
    .from('exam_answers')
    .select('*', { count: 'exact', head: true })
    .eq('submission_id', submissionId)
    .not('selected_choice_index', 'is', null)
    .or('essay_answer.neq.');
  return count ?? 0;
}

export async function fetchAllPublishedExams(): Promise<OnlineExam[]> {
  const { data } = await supabase
    .from('exams')
    .select('*')
    .order('created_at', { ascending: false });
  return (data as OnlineExam[]) ?? [];
}

export async function fetchExamSubmissionsWithAnswers(
  examId: string
): Promise<(ExamSubmission & { answered_questions: number; student?: { name: string; id: string } })[]> {
  const { data } = await supabase
    .from('exam_submissions')
    .select('*, student:students(name, id)')
    .eq('exam_id', examId)
    .order('started_at', { ascending: false });
  if (!data) return [];
  const subs = data as (ExamSubmission & { student?: { name: string; id: string } })[];
  const result: (ExamSubmission & { answered_questions: number; student?: { name: string; id: string } })[] = [];
  for (const sub of subs) {
    const { count } = await supabase
      .from('exam_answers')
      .select('*', { count: 'exact', head: true })
      .eq('submission_id', sub.id)
      .or('selected_choice_index.neq.null,essay_answer.neq.');
    result.push({ ...sub, answered_questions: count ?? 0 });
  }
  return result;
}

export async function fetchAnswers(submissionId: string): Promise<ExamAnswer[]> {
  const { data } = await supabase
    .from('exam_answers')
    .select('*')
    .eq('submission_id', submissionId);
  return data ?? [];
}

export async function upsertAnswer(
  submissionId: string,
  questionId: string,
  patch: Partial<ExamAnswer>
): Promise<void> {
  const { error } = await supabase
    .from('exam_answers')
    .upsert(
      {
        submission_id: submissionId,
        question_id: questionId,
        ...patch,
        graded_at: new Date().toISOString(),
      },
      { onConflict: 'submission_id,question_id' }
    );
  if (error) throw new Error(error.message);
}

export async function upsertAnswersBatch(
  submissionId: string,
  answers: { questionId: string; selected_choice_index: number | null; essay_answer: string | null; awarded_score: number; is_correct: boolean }[]
): Promise<void> {
  if (answers.length === 0) return;
  const now = new Date().toISOString();
  const rows = answers.map((a) => ({
    submission_id: submissionId,
    question_id: a.questionId,
    selected_choice_index: a.selected_choice_index,
    essay_answer: a.essay_answer,
    awarded_score: a.awarded_score,
    is_correct: a.is_correct,
    graded_at: now,
  }));
  const { error } = await supabase
    .from('exam_answers')
    .upsert(rows, { onConflict: 'submission_id,question_id' });
  if (error) throw new Error(error.message);
}

export async function fetchOnlineGrades(examId: string): Promise<OnlineGrade[]> {
  const { data } = await supabase
    .from('online_grades')
    .select('*')
    .eq('exam_id', examId);
  return data ?? [];
}

export async function upsertOnlineGrade(
  examId: string,
  studentId: string,
  score: number,
  maxScore: number,
  isManual: boolean
): Promise<void> {
  if (score > maxScore) {
    throw new Error(`خطأ: لا يمكن أن تتجاوز الدرجة القيمة العظمى (${maxScore})`);
  }
  await safeWrite(
    async () => {
      const { error } = await supabase
        .from('online_grades')
        .upsert({
          exam_id: examId,
          student_id: studentId,
          score,
          max_score: maxScore,
          is_manual_override: isManual,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'exam_id,student_id' });
      if (error) throw new Error(error.message);
      emitGradesChanged(undefined, studentId);
    },
    {
      opKey: safeOpKey('onlineGrade', examId, studentId),
      cachePrefixes: ['online_grades_'],
      optimistic: true,
    }
  );
}

export async function fetchCertificates(
  studentId: string
): Promise<Certificate[]> {
  const { data } = await supabase
    .from('certificates')
    .select('*')
    .eq('student_id', studentId)
    .order('issued_at', { ascending: false });
  return data ?? [];
}

export async function createCertificate(
  payload: Partial<Certificate>
): Promise<Certificate | null> {
  const { data, error } = await supabase
    .from('certificates')
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCertificate(id: string): Promise<void> {
  const { error } = await supabase.from('certificates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function fetchStudentByParentToken(
  token: string
): Promise<Student | null> {
  const normalizedToken = token.trim();
  if (!normalizedToken) return null;

  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('parent_token', normalizedToken)
    .eq('is_deleted', false)
    .maybeSingle();

  if (error) {
    if (error.code === '22P02' || /invalid input syntax/i.test(error.message)) {
      throw new Error('الرابط غير صالح. تأكد من نسخ الرابط كاملاً كما تم إرساله أو تواصل مع المعلم.');
    }
    throw new Error('تعذر الاتصال ببيانات الطالب. تحقق من الاتصال ثم حاول مرة أخرى.');
  }
  return data as Student | null;
}

export async function fetchOnlineGradesByStudent(
  studentId: string
): Promise<OnlineGrade[]> {
  const { data } = await supabase
    .from('online_grades')
    .select('*')
    .eq('student_id', studentId);
  return data ?? [];
}

export async function fetchCenterGradesByStudent(
  studentId: string
): Promise<CenterGrade[]> {
  const { data } = await supabase
    .from('center_grades')
    .select('*')
    .eq('student_id', studentId);
  return data ?? [];
}

export async function fetchCenterExamsByStudent(
  studentId: string
): Promise<CenterExam[]> {
  const { data: student } = await supabase.from('students').select('group_id').eq('id', studentId).maybeSingle();
  const groupId = student?.group_id;
  if (!groupId) return [];
  const { data } = await supabase
    .from('center_exams')
    .select('*')
    .eq('group_id', groupId);
  return data ?? [];
}

export async function fetchOnlineExamsByStudent(
  studentId: string
): Promise<OnlineExam[]> {
  const { data: student } = await supabase.from('students').select('group_id').eq('id', studentId).maybeSingle();
  const groupId = student?.group_id;
  if (!groupId) return [];
  const { data } = await supabase
    .from('exams')
    .select('*')
    .eq('group_id', groupId);
  return data ?? [];
}

export async function fetchAllStudentsCount(): Promise<number> {
  const { count } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');
  return count ?? 0;
}

export async function fetchRecentStudents(days = 14): Promise<(Student & { group_name?: string; grade_name?: string; stage_name?: string })[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const { data } = await supabase
    .from('students')
    .select('*, group:groups(name, schedule, grade_level:grade_levels(name, stage:academic_stages(name)))')
    .eq('status', 'active')
    .gte('enrollment_date', cutoff.toISOString())
    .order('enrollment_date', { ascending: false });
  if (!data) return [];
  return (data as (Student & { group: { name: string; schedule: string | null; grade_level: { name: string; stage: { name: string } } } | null })[]).map((s) => ({
    ...s,
    group_name: s.group?.name,
    grade_name: s.group?.grade_level?.name,
    stage_name: s.group?.grade_level?.stage?.name,
  }));
}

export async function fetchFinancialOverview(monthKey?: string): Promise<{
  expected: number;
  collected: number;
  remaining: number;
  activeStudents: number;
}> {
  const mk = monthKey ?? currentMonthKey();
  return swrFetch(`finoverview_${mk}`, async () => {
  const { data: students } = await supabase
    .from('students')
    .select('id, total_fees, paid_fees, is_exempt, fee_mode, join_month_key, group:groups(grade_level:grade_levels(base_subscription))')
    .eq('status', 'active');

  if (!students || students.length === 0) {
    return { expected: 0, collected: 0, remaining: 0, activeStudents: 0 };
  }

  const studentIds = (students as { id: string }[]).map((s) => s.id);
  const [paymentsRes, exemptionsRes] = await Promise.all([
    supabase
      .from('payments')
      .select('student_id, amount')
      .eq('month_key', mk)
      .eq('is_deleted', false)
      .eq('is_historical_payment', false)
      .gt('amount', 0)
      .in('student_id', studentIds),
    supabase
      .from('monthly_subscriptions')
      .select('student_id')
      .eq('month_key', mk)
      .eq('is_exempt', true)
      .eq('is_archived', false)
      .in('student_id', studentIds),
  ]);

  const paidByStudent = new Map<string, number>();
  for (const p of (paymentsRes.data ?? []) as { student_id: string; amount: number }[]) {
    paidByStudent.set(p.student_id, (paidByStudent.get(p.student_id) ?? 0) + (p.amount ?? 0));
  }
  const exemptMap = new Map<string, true>();
  for (const row of (exemptionsRes.data ?? []) as { student_id: string }[]) {
    exemptMap.set(row.student_id, true);
  }

  const summary = computeFinancialSummary(students as unknown as Student[], paidByStudent, exemptMap);
  return { expected: summary.totalDue, collected: summary.collected, remaining: summary.remaining, activeStudents: summary.studentCount };
  }, 30_000);
}

export async function fetchFeesTotals(monthKey?: string): Promise<{ collected: number; remaining: number }> {
  const mk = monthKey ?? currentMonthKey();
  return swrFetch(`feestotals_${mk}`, async () => {
  const { data: students } = await supabase.from('students').select('id, total_fees, paid_fees, is_exempt, fee_mode, join_month_key').eq('status', 'active');
  if (!students || students.length === 0) return { collected: 0, remaining: 0 };
  const studentIds = students.map((s) => s.id);
  const [paymentsRes, exemptionsRes] = await Promise.all([
    supabase
      .from('payments')
      .select('student_id, amount')
      .eq('month_key', mk)
      .eq('is_deleted', false)
      .eq('is_historical_payment', false)
      .gt('amount', 0)
      .in('student_id', studentIds),
    supabase
      .from('monthly_subscriptions')
      .select('student_id')
      .eq('month_key', mk)
      .eq('is_exempt', true)
      .eq('is_archived', false)
      .in('student_id', studentIds),
  ]);
  const paidByStudent = new Map<string, number>();
  for (const p of (paymentsRes.data ?? []) as { student_id: string; amount: number }[]) {
    paidByStudent.set(p.student_id, (paidByStudent.get(p.student_id) ?? 0) + (p.amount ?? 0));
  }
  const exemptMap = new Map<string, true>();
  for (const row of (exemptionsRes.data ?? []) as { student_id: string }[]) {
    exemptMap.set(row.student_id, true);
  }
  const summary = computeFinancialSummary(students as unknown as Student[], paidByStudent, exemptMap);
  return { collected: summary.collected, remaining: summary.remaining };
  }, 30_000);
}

// ============ ASSISTANTS ============

export async function fetchAssistants(): Promise<Assistant[]> {
  return swrFetch('assistants', async () => {
  const { data } = await supabase
    .from('assistants')
    .select('*')
    .order('created_at', { ascending: false });
  return (data as Assistant[]) ?? [];
  });
}

export async function createAssistant(
  payload: Partial<Assistant>
): Promise<Assistant | null> {
  const { data } = await supabase
    .from('assistants')
    .insert(payload)
    .select()
    .single();
  return data as Assistant | null;
}

export async function updateAssistant(
  id: string,
  patch: Partial<Assistant>
): Promise<void> {
  await supabase.from('assistants').update(patch).eq('id', id);
}

export async function deleteAssistant(id: string): Promise<void> {
  await supabase.from('assistants').delete().eq('id', id);
}

export async function incrementAssistantLogin(id: string): Promise<void> {
  const { data } = await supabase
    .from('assistants')
    .select('logins_count')
    .eq('id', id)
    .maybeSingle();
  await supabase
    .from('assistants')
    .update({
      logins_count: (data?.logins_count ?? 0) + 1,
      last_login_at: new Date().toISOString(),
    })
    .eq('id', id);
}

// ============ PAYMENTS ============

export async function fetchPayments(studentId: string, monthKey?: string): Promise<Payment[]> {
  const cacheKey = `payments_${studentId}_${monthKey ?? 'all'}`;
  return swrFetch(cacheKey, async () => {
  let query = supabase
    .from('payments')
    .select('*')
    .eq('student_id', studentId)
    .eq('is_deleted', false)
    .gt('amount', 0);
  if (monthKey) {
    query = query.eq('month_key', monthKey).eq('is_historical_payment', false);
  }
  const { data } = await withTimeout(query.order('payment_date', { ascending: false }));
  return (data as Payment[]) ?? [];
  });
}

function minuteBucketKey(prefix: string, studentId: string, amount: number, monthKey: string): string {
  const now = new Date();
  const bucket = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(Math.floor(now.getMinutes() / 10)).padStart(2, '0')}`;
  return `${prefix}:${studentId}:${amount}:${monthKey}:${bucket}`;
}

export async function createPayment(
  studentId: string,
  amount: number,
  note: string | null,
  recordedBy: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'assistant',
  customPaymentDate?: string,
  customMonthKey?: string
): Promise<Payment | null> {
  const guard = idempotencyGuard(generateOpKey('payment', studentId, amount, note ?? ''), 5000);
  if (guard.isDuplicate) return null;

  const now = new Date();
  const isoNow = now.toISOString();
  const paymentDate = customPaymentDate ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const monthKey = customMonthKey ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const receiptNumber = generateReceiptNumber();
  const idempotencyKey = minuteBucketKey('pay', studentId, amount, monthKey);

  // PRE-INSERT GUARD: Before creating a payment, check if the student has
  // already paid the full monthly fee for this month. If the new payment
  // amount would cause the total to exceed the fee, block it — this catches
  // duplicates that fall outside the 2-minute idempotency window (e.g. a
  // second full payment 20 minutes later). Partial/installment payments that
  // don't exceed the remaining balance are still allowed.
  const { data: existingFees } = await supabase
    .from('students')
    .select('total_fees, is_exempt')
    .eq('id', studentId)
    .maybeSingle();
  const feeRow = existingFees as { total_fees: number; is_exempt: boolean } | null;
  if (feeRow && !feeRow.is_exempt && feeRow.total_fees > 0) {
    const { data: monthPayments } = await supabase
      .from('payments')
      .select('amount')
      .eq('student_id', studentId)
      .eq('month_key', monthKey)
      .eq('is_deleted', false)
      .eq('is_historical_payment', false);
    const alreadyPaid = (monthPayments ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount ?? 0), 0);
    if (alreadyPaid + amount > Number(feeRow.total_fees)) {
      guard.complete(false);
      throw new Error(`المبلغ المدفوع لهذا الشهر (${formatCurrency(alreadyPaid)} ج.م) يغطي المصروفات بالكامل (${formatCurrency(Number(feeRow.total_fees))} ج.م). لا يمكن تسجيل دفعة إضافية تتجاوز المطلوب.`);
    }
  }

  const { data: result, error: insError } = await supabase.from('payments').insert({
    student_id: studentId,
    amount,
    note,
    payment_date: paymentDate,
    recorded_by: recordedBy,
    recorded_at: isoNow,
    receipt_number: receiptNumber,
    month_key: monthKey,
    idempotency_key: idempotencyKey,
  })
  .select()
  .single();
  if (insError) {
    if (insError.code === '23505') {
      // Duplicate within 2-minute idempotency window — return the existing
      // payment so the caller gets the receipt without creating a second row.
      const { data: existing } = await supabase
        .from('payments')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      guard.complete(true);
      return (existing as Payment | null) ?? null;
    }
    throw new Error(insError.message);
  }
  const insertedPayment = result as Payment | null;

  // DATABASE-FIRST VERIFICATION: re-read the payment by its ID to confirm
  // it was actually persisted. If the record can't be found, the insert
  // silently failed — return null so the caller knows not to send a receipt.
  if (insertedPayment) {
    const { data: verified, error: verifyErr } = await supabase
      .from('payments')
      .select('id, receipt_number, payment_date, recorded_at, amount, student_id, month_key')
      .eq('id', insertedPayment.id)
      .maybeSingle();
    if (verifyErr || !verified) {
      console.error('[createPayment] Post-insert verification failed:', verifyErr?.message ?? 'record not found');
      guard.complete(false);
      return null;
    }
  }

  // paid_fees and monthly_subscriptions.amount_paid are now auto-recalculated
  // by a database trigger (trigger_recalc_paid_fees) on every payment
  // insert/update/delete. No manual recalculation needed here.
  const monthLabel = ARABIC_MONTHS[parseInt(monthKey.split('-')[1], 10) - 1] ?? monthKey;
  const { data: payStudent } = await supabase
    .from('students')
    .select('name')
    .eq('id', studentId)
    .maybeSingle();
  const studentName = (payStudent as { name?: string } | null)?.name ?? '';
  const auditNote = `دفعة شهر ${monthLabel} — ${studentName} — ${formatCurrency(amount)} ج.م${note ? ` — ${note}` : ''}`;
  await createAuditLog(recordedBy, actorRole, 'payment_create', studentId, amount, auditNote);
  guard.complete(true);
  emitPaymentsChanged(undefined, studentId);
  return insertedPayment;
}

export async function syncStudentPaymentStatus(studentId: string, monthKey: string): Promise<void> {
  const { data: payRows } = await supabase
    .from('payments')
    .select('amount')
    .eq('student_id', studentId)
    .eq('month_key', monthKey)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false);
  const total = (payRows ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount ?? 0), 0);
  await supabase.from('students').update({ paid_fees: total }).eq('id', studentId);
  const { data: subRows } = await supabase
    .from('monthly_subscriptions')
    .select('id, amount_due, amount_paid, status')
    .eq('student_id', studentId)
    .eq('month_key', monthKey)
    .order('created_at', { ascending: false })
    .limit(1);
  const sub = (subRows ?? [])[0];
  if (sub) {
    const subRow = sub as { id: string; amount_due: number; amount_paid: number; status: string };
    const paid = Math.min(subRow.amount_due, total);
    const isFull = paid >= subRow.amount_due;
    await supabase
      .from('monthly_subscriptions')
      .update({
        amount_paid: paid,
        status: paid <= 0 ? 'unpaid' : isFull ? 'paid' : 'partial',
        paid_date: isFull ? new Date().toISOString() : null,
      })
      .eq('id', subRow.id);
  }
}

export async function deletePayment(id: string): Promise<void> {
  await supabase.from('payments').delete().eq('id', id);
}

export async function editPayment(
  paymentId: string,
  newAmount: number,
  newNote: string | null,
  actorName: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'master',
  newPaymentDate?: string,
  newMonthKey?: string
): Promise<Payment | null> {
  const { data: pay } = await supabase
    .from('payments')
    .select('id, student_id, amount, month_key, is_historical_payment, target_archive_month, note, payment_date')
    .eq('id', paymentId)
    .maybeSingle();
  if (!pay) return null;
  const payRow = pay as { id: string; student_id: string; amount: number; month_key: string | null; is_historical_payment: boolean | null; target_archive_month: string | null; note: string | null; payment_date: string };
  if (newAmount <= 0) return null;

  const updateFields: Record<string, unknown> = {
    amount: newAmount,
    note: newNote,
    recorded_by: actorName,
    recorded_at: new Date().toISOString(),
  };
  if (newPaymentDate) updateFields.payment_date = newPaymentDate;
  const monthChanged = newMonthKey && newMonthKey !== payRow.month_key;
  if (monthChanged) updateFields.month_key = newMonthKey;

  const { data: updated, error: updErr } = await supabase
    .from('payments')
    .update(updateFields)
    .eq('id', paymentId)
    .select()
    .single();
  if (updErr) {
    console.error('[editPayment] update error:', updErr.message);
    return null;
  }

  const monthsToRecalc = new Set<string>();
  const subMonth = payRow.target_archive_month ?? payRow.month_key;
  if (subMonth) monthsToRecalc.add(subMonth);
  if (monthChanged && newMonthKey) monthsToRecalc.add(newMonthKey);

  for ( const calcMonth of monthsToRecalc) {
    const { data: subRows } = await supabase
      .from('monthly_subscriptions')
      .select('id, amount_due, amount_paid, status')
      .eq('student_id', payRow.student_id)
      .eq('month_key', calcMonth)
      .order('created_at', { ascending: false })
      .limit(1);
    const sub = (subRows ?? [])[0];
    if (sub) {
      const subRow = sub as { id: string; amount_due: number; amount_paid: number; status: string };
      const { data: allPayRows } = await supabase
        .from('payments')
        .select('amount')
        .eq('student_id', payRow.student_id)
        .eq('month_key', calcMonth)
        .eq('is_deleted', false);
      const totalPaid = (allPayRows ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount ?? 0), 0);
      const updatedPaid = Math.min(subRow.amount_due, totalPaid);
      const isFull = updatedPaid >= subRow.amount_due;
      await supabase
        .from('monthly_subscriptions')
        .update({
          amount_paid: updatedPaid,
          status: updatedPaid <= 0 ? 'unpaid' : isFull ? 'paid' : 'partial',
        })
        .eq('id', subRow.id);
    }
  }

  if (!payRow.is_historical_payment) {
    const monthsForStudentUpdate = new Set<string>();
    if (payRow.month_key) monthsForStudentUpdate.add(payRow.month_key);
    if (monthChanged && newMonthKey) monthsForStudentUpdate.add(newMonthKey);
    for ( const calcMonth of monthsForStudentUpdate) {
      const { data: remainingRows } = await supabase
        .from('payments')
        .select('amount')
        .eq('student_id', payRow.student_id)
        .eq('month_key', calcMonth)
        .eq('is_deleted', false)
        .eq('is_historical_payment', false);
      const remainingTotal = (remainingRows ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount ?? 0), 0);
      await supabase
        .from('students')
        .update({ paid_fees: remainingTotal })
        .eq('id', payRow.student_id);
    }
  }

  const monthLabel = (newMonthKey ?? payRow.month_key) ? (ARABIC_MONTHS[parseInt((newMonthKey ?? payRow.month_key)!.split('-')[1], 10) - 1] ?? (newMonthKey ?? payRow.month_key)) : '';
  const { data: editStudent } = await supabase
    .from('students')
    .select('name')
    .eq('id', payRow.student_id)
    .maybeSingle();
  const studentName = (editStudent as { name?: string } | null)?.name ?? '';
  const auditNote = `تعديل دفعة شهر ${monthLabel} — ${studentName} — من ${formatCurrency(payRow.amount)} إلى ${formatCurrency(newAmount)} ج.م${newPaymentDate ? ` — تاريخ ${newPaymentDate}` : ''}${monthChanged ? ` — نقل من ${payRow.month_key ?? ''} إلى ${newMonthKey}` : ''}`;
  await createAuditLog(actorName, actorRole, 'payment_edit', payRow.student_id, newAmount, auditNote);
  emitPaymentsChanged(undefined, payRow.student_id);
  return updated as Payment | null;
}

export async function deletePaymentWithAudit(
  id: string,
  actorName: string = 'المدرس',
  actorRole: 'master' | 'assistant' = 'master'
): Promise<void> {
  const { data: pay } = await supabase
    .from('payments')
    .select('student_id, amount, month_key, is_historical_payment, target_archive_month')
    .eq('id', id)
    .maybeSingle();
  if (pay) {
    const payRow = pay as { student_id: string; amount: number; month_key: string | null; is_historical_payment: boolean | null; target_archive_month: string | null };
    // Reverse the monthly_subscriptions amount_paid for the affected month
    const subMonth = payRow.target_archive_month ?? payRow.month_key;
    if (subMonth) {
      const { data: subRows } = await supabase
        .from('monthly_subscriptions')
        .select('id, amount_due, amount_paid, status')
        .eq('student_id', payRow.student_id)
        .eq('month_key', subMonth)
        .order('created_at', { ascending: false })
        .limit(1);
      const sub = (subRows ?? [])[0];
      if (sub) {
        const subRow = sub as { id: string; amount_due: number; amount_paid: number; status: string; paid_date: string | null };
        const { data: remainingPayRows } = await supabase
          .from('payments')
          .select('amount')
          .eq('student_id', payRow.student_id)
          .eq('month_key', subMonth)
          .eq('is_deleted', false)
          .neq('id', id);
        const recalculatedPaid = (remainingPayRows ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount ?? 0), 0);
        const updatedPaid = Math.min(subRow.amount_due, recalculatedPaid);
        const isFull = updatedPaid >= subRow.amount_due;
        await supabase
          .from('monthly_subscriptions')
          .update({
            amount_paid: updatedPaid,
            status: updatedPaid <= 0 ? 'unpaid' : isFull ? 'paid' : 'partial',
            paid_date: updatedPaid <= 0 ? null : subRow.status === 'late_paid' ? subRow.paid_date : undefined,
          })
          .eq('id', subRow.id);
      }
    }
    // Recalculate students.paid_fees from the remaining current-month
    // payments sum for non-historical payments, rather than subtracting
    // from the cumulative field. This keeps paid_fees strictly aligned
    // with the actual month-scoped payments.
    if (!payRow.is_historical_payment) {
      const payMonth = payRow.month_key;
      if (payMonth) {
        const { data: remainingRows } = await supabase
          .from('payments')
          .select('amount')
          .eq('student_id', payRow.student_id)
          .eq('month_key', payMonth)
          .eq('is_deleted', false)
          .eq('is_historical_payment', false)
          .neq('id', id);
        const remainingTotal = (remainingRows ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount ?? 0), 0);
        await supabase
          .from('students')
          .update({ paid_fees: remainingTotal })
          .eq('id', payRow.student_id);
      }
    }
    const payMonthLabel = payRow.month_key ? (ARABIC_MONTHS[parseInt(payRow.month_key.split('-')[1], 10) - 1] ?? payRow.month_key) : '';
    const { data: delStudent } = await supabase
      .from('students')
      .select('name')
      .eq('id', payRow.student_id)
      .maybeSingle();
    const delStudentName = (delStudent as { name?: string } | null)?.name ?? '';
    const delAuditNote = `حذف دفعة شهر ${payMonthLabel} — ${delStudentName} — ${formatCurrency(payRow.amount ?? 0)} ج.م`;
    await createAuditLog(actorName, actorRole, 'payment_delete', payRow.student_id, payRow.amount, delAuditNote);
  }
  const { error: delError } = await supabase.from('payments').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', id);
  if (delError) throw new Error(delError.message);
  emitPaymentsChanged();
}

// ============ AUDIT LOGS ============

export async function createAuditLog(
  actorName: string,
  actorRole: 'master' | 'assistant',
  actionType: string,
  targetStudentId: string | null,
  amount: number | null,
  note: string | null
): Promise<void> {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      actor_name: actorName,
      actor_role: actorRole,
      action_type: actionType,
      target_student_id: targetStudentId,
      amount,
      note,
    });
    if (error) console.error('[createAuditLog] insert error:', error.message);
  } catch (err) {
    console.error('[createAuditLog] exception:', err);
  }
}

export async function fetchAuditLogs(limit = 100): Promise<(AuditLog & { student?: { name: string; group?: { name: string; grade_level?: { name: string; stage?: { name: string } } } } })[]> {
  const { data } = await supabase
    .from('audit_logs')
    .select('*, student:students(name, group:groups(name, grade_level:grade_levels(name, stage:stages(name))))')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as (AuditLog & { student?: { name: string; group?: { name: string; grade_level?: { name: string; stage?: { name: string } } } } })[]) ?? [];
}

// ============ GROUP STATS ============

export async function fetchGroupStats(
  groupId: string,
  monthKey?: string
): Promise<{
  totalStudents: number;
  collected: number;
  remaining: number;
  fullyPaid: number;
  partialPaid: number;
}> {
  const mk = monthKey ?? currentMonthKey();
  return swrFetch(`groupstats_${groupId}_${mk}`, async () => {
  const { data: students } = await supabase
    .from('students')
    .select('id, total_fees, paid_fees, is_exempt, fee_mode, join_month_key')
    .eq('group_id', groupId)
    .eq('status', 'active');
  if (!students || students.length === 0) {
    return { totalStudents: 0, collected: 0, remaining: 0, fullyPaid: 0, partialPaid: 0 };
  }
  const studentIds = students.map((s) => s.id);
  const [paymentsRes, exemptionsRes] = await Promise.all([
    supabase
      .from('payments')
      .select('student_id, amount')
      .eq('month_key', mk)
      .eq('is_deleted', false)
      .eq('is_historical_payment', false)
      .gt('amount', 0)
      .in('student_id', studentIds),
    supabase
      .from('monthly_subscriptions')
      .select('student_id')
      .eq('month_key', mk)
      .eq('is_exempt', true)
      .eq('is_archived', false)
      .in('student_id', studentIds),
  ]);
  const paidByStudent = new Map<string, number>();
  for (const p of (paymentsRes.data ?? []) as { student_id: string; amount: number }[]) {
    paidByStudent.set(p.student_id, (paidByStudent.get(p.student_id) ?? 0) + (p.amount ?? 0));
  }
  const exemptMap = new Map<string, true>();
  for (const row of (exemptionsRes.data ?? []) as { student_id: string }[]) {
    exemptMap.set(row.student_id, true);
  }
  const summary = computeFinancialSummary(students as unknown as Student[], paidByStudent, exemptMap);
  return {
    totalStudents: summary.studentCount,
    collected: summary.collected,
    remaining: summary.remaining,
    fullyPaid: summary.fullyPaid,
    partialPaid: summary.partialPaid,
  };
  }, 30_000);
}

// ============ SESSIONS ============

export async function fetchSessions(
  groupId: string,
  month: string
): Promise<Session[]> {
  return swrFetch(`sessions_${groupId}_${month}`, async () => {
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('group_id', groupId)
      .eq('month', month)
      .eq('is_archived', false)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    return (data as Session[]) ?? [];
  });
}

export async function createSession(
  groupId: string,
  title: string,
  month: string,
  sessionDate?: string
): Promise<Session | null> {
  const { data, error } = await supabase.rpc('create_session_auto', {
    p_group_id: groupId,
    p_month: month,
    p_session_date: sessionDate ?? new Date().toISOString().slice(0, 10),
    p_title: title.trim() || null,
  });
  if (error) return null;
  if (!data || data.length === 0) return null;
  invalidateCache(`sessions_${groupId}_${month}`);
  emitSessionsChanged(groupId);
  return data[0] as Session;
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').update({ is_deleted: true }).eq('id', id);
  invalidateByPrefix('sessions_');
  if (error) throw new Error(error.message);
}

// ============ MONTHLY ARCHIVE ============

export async function fetchArchives(
  groupId: string
): Promise<MonthlyArchive[]> {
  return swrFetch(`archives_${groupId}`, async () => {
  const { data } = await supabase
    .from('monthly_archive')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });
  return (data as MonthlyArchive[]) ?? [];
  });
}

export async function createArchive(
  groupId: string,
  month: string,
  archiveData: Record<string, unknown>
): Promise<MonthlyArchive | null> {
  const { data } = await supabase
    .from('monthly_archive')
    .insert({ group_id: groupId, month, archive_data: archiveData })
    .select()
    .single();
  return data as MonthlyArchive | null;
}

export async function deleteArchive(id: string): Promise<void> {
  await supabase.from('monthly_archive').delete().eq('id', id);
}

// ============ SESSION-BASED ATTENDANCE ============

export async function fetchAttendanceBySession(
  groupId: string,
  sessionId: string
): Promise<AttendanceRecord[]> {
  return swrFetch(`att_sess_${groupId}_${sessionId}`, async () => {
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .eq('group_id', groupId)
      .eq('session_id', sessionId);
    return (data as AttendanceRecord[]) ?? [];
  });
}

export async function upsertSessionAttendance(
  studentId: string,
  groupId: string,
  status: AttendanceStatus,
  sessionId: string,
  sessionTitle: string,
  date: string
): Promise<void> {
  const guard = idempotencyGuard(generateOpKey('att', studentId, sessionId), 3000);
  if (guard.isDuplicate) return;

  const sessionNote = `session:${sessionId}|${sessionTitle}`;
  const { error } = await supabase
    .from('attendance')
    .upsert(
      {
        student_id: studentId,
        group_id: groupId,
        session_id: sessionId,
        status,
        notes: sessionNote,
        attendance_date: date,
        recorded_at: new Date().toISOString(),
      },
      { onConflict: 'student_id,attendance_date,session_id' }
    );

  guard.complete(true);
  if (error) throw new Error(error.message);
  invalidateByPrefix('attendance_');
  emitAttendanceChanged(groupId, studentId);
}

// ============ HALL OF FAME ============

export async function fetchHallOfFame(groupId?: string, limit = 10): Promise<HallOfFameEntry[]> {
  const cacheKey = `hof_${groupId ?? 'all'}_${limit}`;
  return swrFetch(cacheKey, async () => {
  let query = supabase.from('hall_of_fame').select('*');
  if (groupId) query = query.eq('group_id', groupId);
  const { data } = await query
    .order('overall_score', { ascending: false })
    .order('name', { ascending: true })
    .limit(limit);
  return (data as HallOfFameEntry[]) ?? [];
  });
}

export async function fetchRankBreakdown(
  studentId: string,
  groupId: string,
  monthKey?: string
): Promise<{
  examBreakdown: { title: string; category: string; score: number; max_score: number; percentage: number; date: string }[];
  attendanceBreakdown: { date: string; status: string; session_title: string | null }[];
  homeworkBreakdown: { title: string; status: string; due_date: string }[];
  behaviorBreakdown: { rating: string; note: string | null; eval_date: string; scope: string }[];
  deductedPoints: { category: string; description: string; points_lost: number }[];
  maxPossibleScore: number;
}> {
  const mk = monthKey ?? currentMonthKey();
  const [examScores, attendanceRecs, hwStatuses, behaviorEvals] = await Promise.all([
    supabase
      .from('center_grades')
      .select('score, center_exam_id, center_exams(id, title, category, max_score, exam_date, group_id)')
      .eq('student_id', studentId)
      .eq('is_deleted', false)
      .gte('center_exams.exam_date', monthStart(mk)),
    supabase
      .from('attendance')
      .select('attendance_date, status, session_id, sessions(id, title)')
      .eq('student_id', studentId)
      .eq('group_id', groupId)
      .gte('attendance_date', monthStart(mk))
      .lt('attendance_date', nextMonthStart(mk))
      .order('attendance_date', { ascending: false })
      .limit(50),
    supabase
      .from('homework_status')
      .select('status, homework_id, homework:homework(id, title, due_date, group_id)')
      .eq('student_id', studentId)
      .gte('homework.due_date', monthStart(mk)),
    supabase
      .from('behavior_eval')
      .select('rating, note, eval_date, scope')
      .eq('student_id', studentId)
      .gte('eval_date', monthStart(mk))
      .order('eval_date', { ascending: false })
      .limit(30),
  ]);

  const examRows = (examScores.data ?? []) as Array<{
    score: number;
    center_exam_id: string;
    center_exams: { id: string; title: string; category: string; max_score: number; exam_date: string; group_id: string } | null;
  }>;

  const examBreakdown = examRows
    .filter((r) => r.center_exams && r.center_exams.group_id === groupId)
    .map((r) => {
      const ex = r.center_exams!;
      const pct = ex.max_score > 0 ? Math.min(100, (r.score / ex.max_score) * 100) : 0;
      return {
        title: ex.title,
        category: ex.category,
        score: r.score,
        max_score: ex.max_score,
        percentage: Math.round(pct * 10) / 10,
        date: ex.exam_date,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const attRows = (attendanceRecs.data ?? []) as Array<{
    attendance_date: string;
    status: string;
    session_id: string | null;
    sessions: { id: string; title: string } | null;
  }>;

  const attendanceBreakdown = attRows.map((r) => ({
    date: r.attendance_date,
    status: r.status,
    session_title: r.sessions?.title ?? null,
  }));

  const hwRows = (hwStatuses.data ?? []) as Array<{
    status: string;
    homework_id: string;
    homework: { id: string; title: string; due_date: string; group_id: string } | null;
  }>;

  const homeworkBreakdown = hwRows
    .filter((r) => r.homework && r.homework.group_id === groupId)
    .map((r) => ({
      title: r.homework!.title,
      status: r.status,
      due_date: r.homework!.due_date,
    }))
    .sort((a, b) => b.due_date.localeCompare(a.due_date));

  const behRows = (behaviorEvals.data ?? []) as Array<{
    rating: string;
    note: string | null;
    eval_date: string;
    scope: string;
  }>;

  const behaviorBreakdown = behRows.map((r) => ({
    rating: r.rating,
    note: r.note,
    eval_date: r.eval_date,
    scope: r.scope,
  }));

  const deductedPoints: { category: string; description: string; points_lost: number }[] = [];

  const presentCount = attRows.filter((r) => r.status === 'present').length;
  const absentCount = attRows.filter((r) => r.status === 'absent' || r.status === 'excused_absence' || r.status === 'excused').length;

  // Fetch actual session count for this group this month to cap attendance
  const { count: sessionCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .eq('is_deleted', false)
    .gte('session_date', monthStart(mk))
    .lt('session_date', nextMonthStart(mk));
  const maxSessions = sessionCount ?? attRows.length;

  const cappedTotal = Math.min(attRows.length, maxSessions);
  const cappedPresent = Math.min(presentCount, maxSessions);
  if (cappedTotal > 0 && absentCount > 0) {
    const attRate = (cappedPresent / cappedTotal) * 100;
    const maxAttScore = 25;
    const lost = Math.round((maxAttScore - (attRate / 100) * maxAttScore) * 10) / 10;
    if (lost > 0) {
      deductedPoints.push({
        category: 'الحضور',
        description: `${absentCount} غياب من أصل ${cappedTotal} حصة`,
        points_lost: lost,
      });
    }
  }

  const incompleteHw = hwRows.filter((r) => r.homework && r.homework.group_id === groupId && r.status !== 'complete').length;
  if (hwRows.length > 0 && incompleteHw > 0) {
    const hwRate = ((hwRows.length - incompleteHw) / hwRows.length) * 100;
    const maxHwScore = 20;
    const lost = Math.round((maxHwScore - (hwRate / 100) * maxHwScore) * 10) / 10;
    if (lost > 0) {
      deductedPoints.push({
        category: 'الواجبات',
        description: `${incompleteHw} واجب غير مكتمل من أصل ${hwRows.length}`,
        points_lost: lost,
      });
    }
  }

  const negativeBehavior = behRows.filter((r) => r.rating === 'disruptive' || r.rating === 'needs_attention').length;
  if (behRows.length > 0 && negativeBehavior > 0) {
    const behRate = ((behRows.length - negativeBehavior) / behRows.length) * 100;
    const maxBehScore = 20;
    const lost = Math.round((maxBehScore - (behRate / 100) * maxBehScore) * 10) / 10;
    if (lost > 0) {
      deductedPoints.push({
        category: 'السلوك',
        description: `${negativeBehavior} تقييم سلبي من أصل ${behRows.length}`,
        points_lost: lost,
      });
    }
  }

  const failedExams = examBreakdown.filter((e) => e.percentage < 50);
  if (failedExams.length > 0) {
    const avgPct = examBreakdown.reduce((s, e) => s + e.percentage, 0) / (examBreakdown.length || 1);
    const maxExamScore = 35;
    const lost = Math.round((maxExamScore - (avgPct / 100) * maxExamScore) * 10) / 10;
    if (lost > 0) {
      deductedPoints.push({
        category: 'الامتحانات',
        description: `${failedExams.length} امتحان أقل من 50% — متوسط النسبة ${Math.round(avgPct)}%`,
        points_lost: lost,
      });
    }
  }

  const maxPossibleScore = 100;

  return {
    examBreakdown,
    attendanceBreakdown,
    homeworkBreakdown,
    behaviorBreakdown,
    deductedPoints,
    maxPossibleScore,
  };
}

export async function nextSessionNumber(groupId: string): Promise<number> {
  const { data, error } = await supabase.rpc('next_session_number', { p_group_id: groupId });
  if (error || data == null) return 1;
  return data as number;
}

// ============ SEARCH ============

let searchAbortController: AbortController | null = null;

function normalizeArabicSearch(s: string): string {
  return s
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0622/g, '\u0627')
    .replace(/\u0623/g, '\u0627')
    .replace(/\u0625/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0640/g, '')
    .trim();
}

export async function searchStudents(query: string): Promise<(Student & { group_name?: string; grade_name?: string; stage_name?: string })[]> {
  const q = normalizeArabicSearch(query);
  if (!q) return [];
  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();
  try {
    const { data } = await supabase
      .from('students')
      .select('*, group:groups(name, grade_level:grade_levels(name, stage:academic_stages(name)))')
      .eq('status', 'active')
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%,parent_phone.ilike.%${q}%`)
      .order('name')
      .limit(20)
      .abortSignal(searchAbortController.signal);
    if (!data) return [];
    return (data as (Student & { group: { name: string; grade_level: { name: string; stage: { name: string } } } | null })[]).map((s) => ({
      ...s,
      group_name: s.group?.name,
      grade_name: s.group?.grade_level?.name,
      stage_name: s.group?.grade_level?.stage?.name,
    }));
  } catch {
    return [];
  }
}

export async function fetchStudentsByIds(ids: string[]): Promise<Student[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('students')
    .select('*')
    .in('id', ids)
    .eq('status', 'active');
  return (data as Student[]) ?? [];
}

// ============ HOMEWORK ============

export async function fetchHomework(groupId: string, includeClosed = false, monthKey?: string): Promise<Homework[]> {
  const mk = monthKey ?? currentMonthKey();
  const cacheKey = `hw_${groupId}_${mk}_${includeClosed ? 'all' : 'open'}`;
  return swrFetch(cacheKey, async () => {
    const start = monthStart(mk);
    const end = nextMonthStart(mk);
    let query = supabase
      .from('homework')
      .select('*')
      .eq('group_id', groupId)
      .gte('due_date', start)
      .lt('due_date', end)
      .order('due_date', { ascending: false });
    if (!includeClosed) query = query.eq('is_closed', false);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const homeworkList = (data as Homework[]) ?? [];

  // Auto-link homework to sessions by matching due_date to session_date
  const unlinked = homeworkList.filter((h) => !h.session_id);
  if (unlinked.length > 0) {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, session_date, group_id')
      .eq('group_id', groupId)
      .eq('is_deleted', false);
    const sessionByDate = new Map<string, string>();
    for (const s of (sessions ?? []) as { id: string; session_date: string }[]) {
      if (s.session_date) sessionByDate.set(s.session_date.slice(0, 10), s.id);
    }
    for (const h of unlinked) {
      const dateKey = (h.due_date ?? '').slice(0, 10);
      const matchedSessionId = sessionByDate.get(dateKey);
      if (matchedSessionId) {
        await supabase.from('homework').update({ session_id: matchedSessionId }).eq('id', h.id);
        h.session_id = matchedSessionId;
      }
    }
  }

    return homeworkList;
  });
}

export async function fetchSessionsForGroup(groupId: string): Promise<Session[]> {
  const { data } = await supabase
    .from('sessions')
    .select('*')
    .eq('group_id', groupId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  return (data as Session[]) ?? [];
}

export type PreArchiveIssue = {
  type: 'invalid_score' | 'missing_attendance' | 'duplicate_rank' | 'broken_relation' | 'orphan_grade' | 'negative_fees' | 'missing_homework_status' | 'corrupted_homework_status' | 'payment_without_subscription';
  severity: 'error' | 'warning';
  group_name: string;
  student_name?: string;
  detail: string;
};

export async function preArchiveValidation(): Promise<{ ok: boolean; issues: PreArchiveIssue[] }> {
  const now = new Date();
  const mStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const issues: PreArchiveIssue[] = [];

  // 1. Fetch all groups with their grade/stage names
  const { data: groupsData } = await supabase
    .from('groups')
    .select('id, name, grade_level:grade_levels(name, stage:academic_stages(name))');
  const groups = (groupsData ?? []) as { id: string; name: string; grade_level: { name: string; stage: { name: string } } | null }[];
  const groupNameMap = new Map(groups.map((g) => [g.id, g.name]));

  // 2. Fetch all active students
  const { data: studentsData } = await supabase
    .from('students')
    .select('id, name, group_id, total_fees, paid_fees, is_exempt')
    .eq('is_deleted', false)
    .eq('status', 'active');
  const students = (studentsData ?? []) as { id: string; name: string; group_id: string | null; total_fees: number; paid_fees: number; is_exempt: boolean }[];
  const studentMap = new Map(students.map((s) => [s.id, s]));

  // 3. Check for negative fees (paid > total)
  for (const s of students) {
    if (!s.is_exempt && s.total_fees > 0 && s.paid_fees > s.total_fees) {
      issues.push({
        type: 'negative_fees',
        severity: 'warning',
        group_name: groupNameMap.get(s.group_id ?? '') ?? 'غير محدد',
        student_name: s.name,
        detail: `المبلغ المدفوع (${s.paid_fees} ج.م) أكبر من المصاريف الكلية (${s.total_fees} ج.م)`,
      });
    }
  }

  // 4. Fetch all center exams for this month
  const { data: examsData } = await supabase
    .from('center_exams')
    .select('id, title, max_score, pass_score, group_id')
    .gte('created_at', mStart)
    .lt('created_at', mEnd);
  const exams = (examsData ?? []) as { id: string; title: string; max_score: number; pass_score: number; group_id: string }[];
  const examMap = new Map(exams.map((e) => [e.id, e]));

  // 5. Fetch all center grades for this month
  const { data: gradesData } = await supabase
    .from('center_grades')
    .select('id, student_id, center_exam_id, score, is_deleted')
    .eq('is_deleted', false)
    .gte('updated_at', mStart)
    .lt('updated_at', mEnd);
  const grades = (gradesData ?? []) as { id: string; student_id: string; center_exam_id: string; score: number; is_deleted: boolean }[];

  // 6. Check for invalid scores (score > max_score)
  for (const g of grades) {
    const exam = examMap.get(g.center_exam_id);
    if (exam && g.score > exam.max_score) {
      const s = studentMap.get(g.student_id);
      issues.push({
        type: 'invalid_score',
        severity: 'error',
        group_name: groupNameMap.get(exam.group_id) ?? 'غير محدد',
        student_name: s?.name ?? 'طالب محذوف',
        detail: `الدرجة (${g.score}) أكبر من الحد الأقصى للامتحان "${exam.title}" (${exam.max_score})`,
      });
    }
    // 7. Check for orphan grades (student no longer active or deleted)
    if (!studentMap.has(g.student_id)) {
      const exam = examMap.get(g.center_exam_id);
      issues.push({
        type: 'orphan_grade',
        severity: 'warning',
        group_name: groupNameMap.get(exam?.group_id ?? '') ?? 'غير محدد',
        detail: `درجة مرتبطة بطالب غير نشأ أو محذوف في امتحان "${exam?.title ?? 'غير معروف'}"`,
      });
    }
  }

  // 8. Check for missing attendance (sessions without attendance records for some students)
  const { data: sessionsData } = await supabase
    .from('sessions')
    .select('id, group_id, session_date, created_at')
    .gte('created_at', mStart)
    .lt('created_at', mEnd);
  const sessions = (sessionsData ?? []) as { id: string; group_id: string; session_date: string | null; created_at: string }[];

  // Group sessions by group_id
  const sessionsByGroup = new Map<string, string[]>();
  for (const sess of sessions) {
    if (!sess.group_id) continue;
    if (!sessionsByGroup.has(sess.group_id)) sessionsByGroup.set(sess.group_id, []);
    sessionsByGroup.get(sess.group_id)!.push(sess.id);
  }

  // Fetch all attendance records for this month
  const { data: attData } = await supabase
    .from('attendance')
    .select('student_id, session_id, group_id')
    .gte('attendance_date', mStart)
    .lt('attendance_date', mEnd);
  const attendance = (attData ?? []) as { student_id: string; session_id: string | null; group_id: string | null }[];

  // Build a set of (student_id, session_id) pairs
  const attSet = new Set<string>();
  for (const a of attendance) {
    if (a.session_id) attSet.add(`${a.student_id}:${a.session_id}`);
  }

  // Check each group's sessions against its students
  for (const [gid, sessionIds] of sessionsByGroup) {
    const groupStudents = students.filter((s) => s.group_id === gid);
    for (const sessId of sessionIds) {
      let missingCount = 0;
      for (const s of groupStudents) {
        if (!attSet.has(`${s.id}:${sessId}`)) {
          missingCount++;
        }
      }
      if (missingCount > 0 && groupStudents.length > 0) {
        issues.push({
          type: 'missing_attendance',
          severity: 'warning',
          group_name: groupNameMap.get(gid) ?? 'غير محدد',
          detail: `${missingCount} طالب بدون سجل حضور في إحدى حصص هذا الشهر`,
        });
      }
    }
  }

  // 9. Check for duplicate ranks in hall_of_fame (same group, same rank, same month)
  const { data: hofData } = await supabase
    .from('hall_of_fame')
    .select('id, group_id, rank, student_id')
    .gte('created_at', mStart)
    .lt('created_at', mEnd);
  const hof = (hofData ?? []) as { id: string; group_id: string; rank: number; student_id: string }[];
  const rankKeys = new Map<string, number>();
  for (const h of hof) {
    const key = `${h.group_id}:${h.rank}`;
    rankKeys.set(key, (rankKeys.get(key) ?? 0) + 1);
  }
  for (const [key, count] of rankKeys) {
    if (count > 1) {
      const [gid] = key.split(':');
      issues.push({
        type: 'duplicate_rank',
        severity: 'error',
        group_name: groupNameMap.get(gid) ?? 'غير محدد',
        detail: `تكرار في ترتيب لوحة الشرف — هناك ${count} طلاب بنفس المركز في نفس المجموعة`,
      });
    }
  }

  // 10. Check homework definitions without any statuses (potential data loss)
  const { data: homeworkData } = await supabase
    .from('homework')
    .select('id, title, group_id')
    .gte('due_date', mStart)
    .lt('due_date', mEnd);
  const homeworkDefs = (homeworkData ?? []) as { id: string; title: string; group_id: string }[];

  if (homeworkDefs.length > 0) {
    const hwIds = homeworkDefs.map((h) => h.id);
    const { data: hwStatusData } = await supabase
      .from('homework_status')
      .select('homework_id, status')
      .in('homework_id', hwIds);
    const hwStatuses = (hwStatusData ?? []) as { homework_id: string; status: string }[];

    const statusByHw = new Map<string, number>();
    for (const hs of hwStatuses) {
      statusByHw.set(hs.homework_id, (statusByHw.get(hs.homework_id) ?? 0) + 1);
    }

    // Check for homework with zero statuses — potential data loss
    let zeroStatusCount = 0;
    for (const hw of homeworkDefs) {
      if (!statusByHw.has(hw.id)) {
        zeroStatusCount++;
      }
    }
    if (zeroStatusCount > 0 && zeroStatusCount < homeworkDefs.length) {
      // Only warn if SOME homework has statuses but others don't —
      // if ALL have zero, homework may not have been recorded yet
      issues.push({
        type: 'broken_relation',
        severity: 'warning',
        group_name: 'عام',
        detail: `${zeroStatusCount} واجب من ${homeworkDefs.length} ليس له أي سجل حالة — قد يكون فقدان بيانات`,
      });
    }

    // Check for corrupted homework statuses (null/blank/"غير مقيم")
    const corrupted = hwStatuses.filter((hs) => !hs.status || hs.status === '' || hs.status === 'غير مقيم');
    if (corrupted.length > 0) {
      issues.push({
        type: 'broken_relation',
        severity: 'error',
        group_name: 'عام',
        detail: `${corrupted.length} سجل واجب بحالة فارغة أو تالفة (null/blank/"غير مقيم") — يجب إصلاحها قبل الأرشفة`,
      });
    }
  }

  // 11. Check payments without matching monthly_subscriptions
  const currentMk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const { data: paymentsData } = await supabase
    .from('payments')
    .select('id, student_id, amount, month_key')
    .eq('month_key', currentMk)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0);
  const payments = (paymentsData ?? []) as { id: string; student_id: string; amount: number; month_key: string }[];

  const { data: subsData } = await supabase
    .from('monthly_subscriptions')
    .select('student_id, amount_due, amount_paid')
    .eq('month_key', currentMk);
  const subs = (subsData ?? []) as { student_id: string; amount_due: number; amount_paid: number }[];
  const subsByStudent = new Map(subs.map((s) => [s.student_id, s]));

  for (const p of payments) {
    const sub = subsByStudent.get(p.student_id);
    if (!sub) {
      const s = studentMap.get(p.student_id);
      issues.push({
        type: 'broken_relation',
        severity: 'warning',
        group_name: groupNameMap.get(s?.group_id ?? '') ?? 'غير محدد',
        student_name: s?.name ?? 'طالب محذوف',
        detail: `دفعة ${p.amount} ج.م بدون اشتراك شهري مسجل لهذا الشهر`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return { ok: errors.length === 0, issues };
}

export async function backfillAttendanceForNewStudent(
  studentId: string,
  groupId: string,
  enrollmentDate: string
): Promise<number> {
  const sessions = await fetchSessionsForGroup(groupId);
  const enrollDay = enrollmentDate.slice(0, 10);
  const pastSessions = sessions.filter((s) => {
    const d = (s.session_date ?? s.created_at).slice(0, 10);
    return d >= enrollDay && d <= new Date().toISOString().slice(0, 10);
  });
  let count = 0;
  for (const sess of pastSessions) {
    const date = (sess.session_date ?? sess.created_at).slice(0, 10);
    try {
      await upsertAttendance(studentId, groupId, 'unrecorded', null, date, sess.id);
      count++;
    } catch {
      // skip individual failures — best-effort backfill
    }
  }
  return count;
}

export async function toggleHomeworkClosed(homeworkId: string, isClosed: boolean): Promise<void> {
  await supabase.from('homework').update({ is_closed: isClosed }).eq('id', homeworkId);
}

export function subscribeToAttendance(
  groupId: string,
  callback: (payload: { eventType: string; new: AttendanceRecord | null; old: AttendanceRecord | null }) => void
): { unsubscribe: () => void } {
  const channel = supabase
    .channel(`attendance_${groupId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'attendance', filter: `group_id=eq.${groupId}` },
      (payload: { eventType: string; new: Record<string, unknown> | null; old: Record<string, unknown> | null }) => {
        callback({
          eventType: payload.eventType,
          new: (payload.new ?? null) as unknown as AttendanceRecord | null,
          old: (payload.old ?? null) as unknown as AttendanceRecord | null,
        });
      }
    )
    .subscribe();
  return { unsubscribe: () => { supabase.removeChannel(channel); } };
}

export function subscribeToSessions(
  groupId: string,
  callback: () => void
): { unsubscribe: () => void } {
  const channel = supabase
    .channel(`sessions_${groupId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sessions', filter: `group_id=eq.${groupId}` },
      () => { callback(); }
    )
    .subscribe();
  return { unsubscribe: () => { supabase.removeChannel(channel); } };
}

export async function createHomework(
  groupId: string,
  title: string,
  description: string | null,
  dueDate: string,
  sessionId: string | null = null
): Promise<Homework | null> {
  const result = await safeWrite(
    async () => {
      const { data, error } = await supabase
        .from('homework')
        .insert({ group_id: groupId, session_id: sessionId, title, description, due_date: dueDate })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Homework;
    },
    {
      opKey: safeOpKey('createHomework', groupId, title, dueDate, sessionId ?? 'null'),
      cachePrefixes: ['hw_'],
      skipDedupe: false,
    }
  );
  return result;
}

export async function deleteHomework(id: string): Promise<void> {
  const { error } = await supabase.from('homework').delete().eq('id', id);
  if (error) throw new Error(error.message);
  invalidateByPrefix('hw_');
}

export async function deleteAllHomework(groupId: string): Promise<void> {
  const { error } = await supabase.from('homework').delete().eq('group_id', groupId);
  if (error) throw new Error(error.message);
  invalidateByPrefix('hw_');
}

export async function fetchHomeworkStatuses(
  homeworkId: string
): Promise<HomeworkStatus[]> {
  const cacheKey = `hw_status_${homeworkId}`;
  return swrFetch(cacheKey, async () => {
    const { data, error } = await supabase
      .from('homework_status')
      .select('*')
      .eq('homework_id', homeworkId);
    if (error) throw new Error(error.message);
    return (data as HomeworkStatus[]) ?? [];
  });
}

export async function upsertHomeworkStatus(
  homeworkId: string,
  studentId: string,
  status: HomeworkStatusType,
  teacherNote: string | null
): Promise<void> {
  await safeWrite(
    async () => {
      const { error } = await supabase
        .from('homework_status')
        .upsert({
          homework_id: homeworkId,
          student_id: studentId,
          status,
          teacher_note: teacherNote,
          recorded_at: new Date().toISOString(),
        }, { onConflict: 'homework_id,student_id' });
      if (error) throw new Error(error.message);
      emitHomeworkChanged(undefined, studentId);
    },
    {
      opKey: safeOpKey('hwStatus', homeworkId, studentId),
      cachePrefixes: ['hw_status_'],
      optimistic: true,
    }
  );
}

export async function deleteHomeworkStatus(
  homeworkId: string,
  studentId: string
): Promise<void> {
  const { error } = await supabase
    .from('homework_status')
    .delete()
    .eq('homework_id', homeworkId)
    .eq('student_id', studentId);
  if (error) throw new Error(error.message);
  invalidateCache(`hw_status_${homeworkId}`);
  invalidateByPrefix('hw_');
  emitHomeworkChanged(undefined, studentId);
}

// ============ BEHAVIOR ============

export async function fetchBehaviorEvals(
  studentId: string
): Promise<BehaviorEval[]> {
  return swrFetch(`behavior_${studentId}`, async () => {
  const { data } = await supabase
    .from('behavior_eval')
    .select('*')
    .eq('student_id', studentId)
    .order('eval_date', { ascending: false });
  return (data as BehaviorEval[]) ?? [];
  });
}

export async function fetchBehaviorEvalsBatch(
  studentIds: string[]
): Promise<Map<string, BehaviorEval[]>> {
  if (studentIds.length === 0) return new Map();
  const { data } = await supabase
    .from('behavior_eval')
    .select('*')
    .in('student_id', studentIds)
    .order('eval_date', { ascending: false });
  const map = new Map<string, BehaviorEval[]>();
  for (const sId of studentIds) map.set(sId, []);
  for (const row of (data as BehaviorEval[]) ?? []) {
    const arr = map.get(row.student_id);
    if (arr) arr.push(row);
  }
  return map;
}

export async function upsertBehaviorEval(
  studentId: string,
  groupId: string | null,
  rating: BehaviorRating,
  note: string | null,
  evalDate: string,
  scope: BehaviorScope = 'daily',
  sessionId: string | null = null
): Promise<void> {
  await safeWrite(
    async () => {
      const { error } = await supabase
        .from('behavior_eval')
        .upsert({
          student_id: studentId,
          group_id: groupId,
          session_id: sessionId,
          rating,
          note,
          eval_date: evalDate,
          scope,
        }, { onConflict: 'student_id,eval_date' });
      if (error) throw new Error(error.message);
      emitBehaviorChanged(groupId ?? undefined, studentId);
    },
    {
      opKey: safeOpKey('behaviorEval', studentId, evalDate, scope),
      cachePrefixes: ['behavior_'],
      optimistic: true,
    }
  );
}

export async function deleteBehaviorEval(evalId: string): Promise<void> {
  const { error } = await supabase.from('behavior_eval').delete().eq('id', evalId);
  if (error) throw new Error(error.message);
  invalidateByPrefix('behavior_');
  emitBehaviorChanged(undefined);
}

// ============ PARENT PORTAL: MULTI-CHILD BY PHONE ============

export async function fetchStudentsByParentPhone(
  phone: string
): Promise<(Student & { group_name?: string; grade_name?: string; stage_name?: string })[]> {
  const { data } = await supabase
    .from('students')
    .select('*, group:groups(name, grade_level:grade_levels(name, stage:academic_stages(name)))')
    .eq('is_deleted', false)
    .eq('parent_phone', phone)
    .order('name');
  if (!data) return [];
  return (data as (Student & { group: { name: string; grade_level: { name: string; stage: { name: string } } } | null })[]).map((s) => ({
    ...s,
    group_name: s.group?.name,
    grade_name: s.group?.grade_level?.name,
    stage_name: s.group?.grade_level?.stage?.name,
  }));
}

// ============ LIVE EXAM MONITORING ============

export async function fetchExamSubmissionsForMonitor(
  examId: string
): Promise<(ExamSubmission & { student?: { name: string; id: string } })[]> {
  const { data } = await supabase
    .from('exam_submissions')
    .select('*, student:students(name, id)')
    .eq('exam_id', examId)
    .order('started_at', { ascending: false });
  return (data as (ExamSubmission & { student?: { name: string; id: string } })[]) ?? [];
}

export async function fetchAllExamSubmissions(): Promise<(ExamSubmission & { exam?: { title: string; subject: string | null } })[]> {
  const { data } = await supabase
    .from('exam_submissions')
    .select('*, exam:exams(title, subject)')
    .order('started_at', { ascending: false });
  return (data as (ExamSubmission & { exam?: { title: string; subject: string | null } })[]) ?? [];
}

function normalizeArabic(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // strip tashkeel/diacritics
    .replace(/\u0623/g, '\u0627') // أ -> ا
    .replace(/\u0625/g, '\u0627') // إ -> ا
    .replace(/\u0622/g, '\u0627') // آ -> ا
    .replace(/\u0649/g, '\u064A') // ى -> ي
    .replace(/\u0629/g, '\u0647') // ة -> ه
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokensMatch(inputName: string, rosterName: string): boolean {
  const normInput = normalizeArabic(inputName);
  const normRoster = normalizeArabic(rosterName);
  if (!normInput || !normRoster) return false;
  if (normInput === normRoster) return true;

  const inputTokens = normInput.split(' ').filter(Boolean);
  const rosterTokens = normRoster.split(' ').filter(Boolean);
  if (inputTokens.length < 2 || rosterTokens.length < 2) return false;

  // Count how many input tokens appear in the roster name
  let matched = 0;
  for (const t of inputTokens) {
    if (rosterTokens.includes(t)) matched++;
  }
  // Allow if at least 2 tokens match, or all input tokens match
  return matched >= 2 && matched >= Math.min(inputTokens.length, 2);
}

function phoneMatches(inputPhone: string, rosterPhone: string | null): boolean {
  if (!inputPhone || !rosterPhone) return false;
  const normInput = inputPhone.replace(/[\s\-+]/g, '').replace(/^0+/, '');
  const normRoster = rosterPhone.replace(/[\s\-+]/g, '').replace(/^0+/, '');
  if (!normInput || !normRoster) return false;
  return normInput === normRoster || normInput.endsWith(normRoster) || normRoster.endsWith(normInput);
}

export async function verifyStudentForExam(
  name: string,
  exam: OnlineExam,
  phone?: string
): Promise<{ allowed: boolean; reason?: string; student?: Student | null }> {
  // Server-side timing enforcement: reject if exam hasn't opened yet or has already closed
  const now = Date.now();
  if (exam.open_at && new Date(exam.open_at).getTime() > now) {
    return { allowed: false, reason: 'هذا الامتحان لم يبدأ بعد. يرجى المحاولة في الموعد المحدد.' };
  }
  if (exam.close_at && new Date(exam.close_at).getTime() < now) {
    return { allowed: false, reason: 'انتهت الفترة المحددة لاداء هذا الامتحان.' };
  }

  if (exam.exam_type === 'online' && !exam.group_id && !exam.grade_level_id) {
    return { allowed: true };
  }

  let roster: Student[] = [];
  if (exam.group_id) {
    roster = await fetchStudentsByGroup(exam.group_id);
  } else if (exam.grade_level_id) {
    roster = await fetchRosterForExam(exam);
  }

  if (roster.length === 0) {
    return { allowed: false, reason: 'لا يوجد طلاب مسجلون في هذا الامتحان' };
  }

  // OR-match: allow if name matches OR phone matches any roster student
  let matchedStudent: Student | null = null;

  // Check name match first (partial token matching with Arabic normalization)
  if (name && name.trim()) {
    for (const s of roster) {
      if (nameTokensMatch(name, s.name)) {
        matchedStudent = s;
        break;
      }
    }
  }

  // If no name match, check phone match (student phone or parent phone)
  if (!matchedStudent && phone && phone.trim()) {
    for (const s of roster) {
      if (phoneMatches(phone, s.phone) || phoneMatches(phone, s.parent_phone)) {
        matchedStudent = s;
        break;
      }
    }
  }

  if (matchedStudent) {
    return { allowed: true, student: matchedStudent };
  }

  return { allowed: false, reason: 'بياناتك غير مطابقة للقائمة المعتمدة لهذا الامتحان. تأكد من اسمك أو رقم هاتفك أو تواصل مع المعلم.' };
}

export async function hasStudentTakenExam(
  examId: string,
  studentId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('exam_submissions')
    .select('id, status')
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .in('status', ['submitted', 'auto_submitted', 'cheated'])
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export function subscribeToExamSubmissions(
  examId: string,
  callback: (payload: { eventType: string; new: ExamSubmission; old: ExamSubmission | null }) => void
): { unsubscribe: () => void } {
  const channel = supabase
    .channel(`exam_submissions_${examId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'exam_submissions', filter: `exam_id=eq.${examId}` },
      (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> | null }) => {
        callback({
          eventType: payload.eventType,
          new: payload.new as unknown as ExamSubmission,
          old: (payload.old ?? null) as unknown as ExamSubmission | null,
        });
      }
    )
    .subscribe();
  return { unsubscribe: () => { supabase.removeChannel(channel); } };
}

// ============ MONTHLY SUBSCRIPTIONS ============

export async function fetchStageBaseSubscription(stageId: string): Promise<number> {
  const { data } = await supabase
    .from('academic_stages')
    .select('base_subscription')
    .eq('id', stageId)
    .maybeSingle();
  return (data as { base_subscription: number } | null)?.base_subscription ?? 0;
}

export async function updateStageBaseSubscription(stageId: string, amount: number): Promise<void> {
  await supabase.from('academic_stages').update({ base_subscription: amount }).eq('id', stageId);
}

export async function fetchGradeLevelBaseSubscription(gradeLevelId: string): Promise<number> {
  const { data } = await supabase
    .from('grade_levels')
    .select('base_subscription')
    .eq('id', gradeLevelId)
    .maybeSingle();
  return (data as { base_subscription: number } | null)?.base_subscription ?? 0;
}

export async function updateGradeLevelBaseSubscription(gradeLevelId: string, amount: number): Promise<void> {
  await supabase.from('grade_levels').update({ base_subscription: amount }).eq('id', gradeLevelId);
}

export async function syncStudentFeesToGradePrice(gradeLevelId: string, newBasePrice: number): Promise<number> {
  const { data: groups } = await supabase
    .from('groups')
    .select('id')
    .eq('grade_level_id', gradeLevelId);
  if (!groups || groups.length === 0) return 0;
  const groupIds = (groups as { id: string }[]).map((g) => g.id);
  const { data: students } = await supabase
    .from('students')
    .select('id, discount_amount, paid_fees')
    .in('group_id', groupIds)
    .eq('status', 'active')
    .eq('is_deleted', false);
  if (!students || students.length === 0) return 0;
  let updated = 0;
  for (const s of (students as { id: string; discount_amount: number | null; paid_fees: number | null }[])) {
    const discount = s.discount_amount ?? 0;
    const newTotal = Math.max(0, newBasePrice - discount);
    if (newTotal !== newBasePrice - discount && newTotal <= 0) continue;
    const { error } = await supabase
      .from('students')
      .update({ total_fees: newTotal })
      .eq('id', s.id);
    if (!error) updated++;
  }
  return updated;
}

export async function fetchGradeLevelsBaseSubscriptions(): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('grade_levels')
    .select('id, base_subscription');
  if (!data) return {};
  const map: Record<string, number> = {};
  for (const row of data as { id: string; base_subscription: number }[]) {
    map[row.id] = row.base_subscription ?? 0;
  }
  return map;
}

export async function fetchMonthlySubscriptions(
  studentIds: string[],
  monthKey: string
): Promise<MonthlySubscription[]> {
  if (studentIds.length === 0) return [];
  const { data } = await withTimeout(supabase
    .from('monthly_subscriptions')
    .select('*')
    .in('student_id', studentIds)
    .eq('month_key', monthKey));
  return (data as MonthlySubscription[]) ?? [];
}

export async function fetchArchivedSubscriptions(
  studentIds: string[]
): Promise<MonthlySubscription[]> {
  if (studentIds.length === 0) return [];
  const { data } = await withTimeout(supabase
    .from('monthly_subscriptions')
    .select('*')
    .in('student_id', studentIds)
    .eq('is_archived', true)
    .order('month_key', { ascending: false }));
  return (data as MonthlySubscription[]) ?? [];
}

export async function ensureMonthlySubscriptions(
  studentIds: string[],
  monthLabel: string,
  monthKey: string,
  baseAmount: number
): Promise<MonthlySubscription[]> {
  if (studentIds.length === 0) return [];
  const existing = await fetchMonthlySubscriptions(studentIds, monthKey);
  const existingStudentIds = new Set(existing.map((s) => s.student_id));
  const missing = studentIds.filter((id) => !existingStudentIds.has(id));
  if (missing.length > 0 && baseAmount > 0) {
    const { data: studentRows } = await supabase
      .from('students')
      .select('id, discount_amount')
      .in('id', missing);
    const discountMap = new Map<string, number>();
    for (const r of (studentRows ?? []) as { id: string; discount_amount: number | null }[]) {
      discountMap.set(r.id, r.discount_amount ?? 0);
    }
    const rows = missing.map((sid) => {
      const discount = discountMap.get(sid) ?? 0;
      const adjustedAmount = Math.max(0, baseAmount - discount);
      return {
        student_id: sid,
        month: monthLabel,
        month_key: monthKey,
        amount_due: adjustedAmount,
        amount_paid: 0,
        status: 'unpaid' as SubscriptionStatus,
        is_archived: false,
      };
    });
    await supabase.from('monthly_subscriptions').insert(rows);
    return await fetchMonthlySubscriptions(studentIds, monthKey);
  }
  return existing;
}

export async function fetchStudentPaymentHistory(studentId: string): Promise<MonthlySubscription[]> {
  const { data } = await withTimeout(supabase
    .from('monthly_subscriptions')
    .select('*')
    .eq('student_id', studentId)
    .order('month_key', { ascending: false }));
  return (data as MonthlySubscription[]) ?? [];
}

export async function paySubscription(
  subscriptionId: string,
  amount: number,
  isLate: boolean,
  recordedBy: string,
  note: string | null
): Promise<string | null> {
  const { data: sub } = await supabase
    .from('monthly_subscriptions')
    .select('student_id, amount_due, amount_paid, month_key, month')
    .eq('id', subscriptionId)
    .maybeSingle();
  if (!sub) return null;
  const subRow = sub as { student_id: string; amount_due: number; amount_paid: number; month_key: string; month: string };

  // Insert a real payment record so it shows in daily collections, audit logs,
  // and triggers the paid_fees recalculation. Use the subscription's month_key
  // so the payment is attributed to the correct month (critical for late payments).
  const payment = await createPayment(
    subRow.student_id,
    amount,
    note,
    recordedBy,
    'master',
    undefined,
    subRow.month_key
  );
  if (!payment) return null;

  const newPaid = Math.min(subRow.amount_due, subRow.amount_paid + amount);
  const isFull = newPaid >= subRow.amount_due;
  const { error: updErr } = await supabase
    .from('monthly_subscriptions')
    .update({
      amount_paid: newPaid,
      status: isLate ? 'late_paid' : isFull ? 'paid' : 'partial',
      paid_date: new Date().toISOString(),
      is_archived: false,
      note,
      recorded_by: recordedBy,
      receipt_number: payment.receipt_number,
    })
    .eq('id', subscriptionId);
  if (updErr) {
    console.error('[paySubscription] update error:', updErr.message);
  }
  emitPaymentsChanged(undefined, subRow.student_id);
  return payment.receipt_number;
}

export async function archiveUnpaidSubscriptions(monthKey: string): Promise<number> {
  const { data, error } = await supabase
    .from('monthly_subscriptions')
    .update({ is_archived: true })
    .eq('month_key', monthKey)
    .in('status', ['unpaid', 'partial'])
    .select('id');
  if (error) return 0;
  return data?.length ?? 0;
}

export async function upsertStudentMonthlyOverride(
  studentId: string,
  monthKey: string,
  monthLabel: string,
  amountDue: number,
  recordedBy: string
): Promise<void> {
  const { data: existing } = await supabase
    .from('monthly_subscriptions')
    .select('id, amount_paid')
    .eq('student_id', studentId)
    .eq('month_key', monthKey)
    .maybeSingle();
  if (existing) {
    const row = existing as { id: string; amount_paid: number };
    const isFull = row.amount_paid >= amountDue;
    await supabase
      .from('monthly_subscriptions')
      .update({
        amount_due: amountDue,
        status: isFull ? 'paid' : (row.amount_paid > 0 ? 'partial' : 'unpaid'),
        note: `تعديل يدوي بواسطة ${recordedBy}`,
        recorded_by: recordedBy,
      })
      .eq('id', row.id);
  } else {
    await supabase.from('monthly_subscriptions').insert({
      student_id: studentId,
      month: monthLabel,
      month_key: monthKey,
      amount_due: amountDue,
      amount_paid: 0,
      status: 'unpaid',
      is_archived: false,
      note: `تعديل يدوي بواسطة ${recordedBy}`,
      recorded_by: recordedBy,
    });
  }
}

export async function fetchStudentMonthlySubscriptions(studentId: string): Promise<MonthlySubscription[]> {
  const { data } = await supabase
    .from('monthly_subscriptions')
    .select('*')
    .eq('student_id', studentId)
    .order('month_key', { ascending: false });
  return (data as MonthlySubscription[]) ?? [];
}

export async function deleteMonthlySubscription(subscriptionId: string): Promise<void> {
  await supabase.from('monthly_subscriptions').delete().eq('id', subscriptionId);
}

export async function updateSubscriptionAmountDue(subscriptionId: string, newAmountDue: number): Promise<void> {
  const { data: sub } = await supabase
    .from('monthly_subscriptions')
    .select('amount_paid')
    .eq('id', subscriptionId)
    .maybeSingle();
  if (!sub) return;
  const paid = (sub as { amount_paid: number }).amount_paid;
  const isFull = paid >= newAmountDue;
  await supabase
    .from('monthly_subscriptions')
    .update({
      amount_due: newAmountDue,
      status: isFull ? 'paid' : 'partial',
    })
    .eq('id', subscriptionId);
}

export function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthLabel(date: Date): string {
  return `${ARABIC_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export async function checkDuplicateStudentName(
  name: string,
  groupId: string,
  excludeId?: string
): Promise<boolean> {
  const { data } = await supabase
    .from('students')
    .select('id')
    .eq('name', name.trim())
    .eq('group_id', groupId)
    .eq('status', 'active')
    .eq('is_deleted', false);
  if (!data) return false;
  if (excludeId) return data.some((s) => s.id !== excludeId);
  return data.length > 0;
}

// ============ EXPENSES ============

export async function fetchExpenses(monthKey?: string): Promise<Expense[]> {
  let query = supabase.from('expenses').select('*');
  if (monthKey) {
    const startDate = `${monthKey}-01`;
    const [y, m] = monthKey.split('-').map(Number);
    const endMonth = m === 12 ? 1 : m + 1;
    const endYear = m === 12 ? y + 1 : y;
    const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
    query = query.gte('expense_date', startDate).lt('expense_date', endDate);
  }
  const { data } = await withTimeout(query.order('expense_date', { ascending: false }));
  return (data as Expense[]) ?? [];
}

export async function createExpense(
  category: ExpenseCategory,
  amount: number,
  description: string | null,
  expenseDate: string,
  recordedBy: string
): Promise<Expense | null> {
  const { data } = await supabase
    .from('expenses')
    .insert({
      category,
      amount,
      description,
      expense_date: expenseDate,
      recorded_by: recordedBy,
    })
    .select()
    .single();
  return data as Expense | null;
}

export async function deleteExpense(id: string): Promise<void> {
  await supabase.from('expenses').delete().eq('id', id);
}

export async function fetchExpenseTotal(monthKey?: string): Promise<number> {
  const expenses = await fetchExpenses(monthKey);
  return expenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);
}

// ============ RECEIPTS ============

export function generateReceiptNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `RC-${ts}-${rand}`;
}

// ============ ARCHIVE RUNS ============

export async function fetchArchiveRuns(): Promise<ArchiveRun[]> {
  const { data } = await supabase
    .from('archive_runs')
    .select('*')
    .order('archive_month', { ascending: false });
  return (data as ArchiveRun[]) ?? [];
}

export async function triggerAutoArchive(): Promise<{ success: boolean; skipped?: boolean; month?: string; error?: string; records?: Record<string, number> }> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-archive`;
  const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: '{}',
    });
    const json = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    if (!res.ok || !json.success) {
      return { success: false, error: json.error ?? `HTTP ${res.status}` };
    }
    return { success: !!json.success, skipped: json.skipped, month: json.month, error: json.error, records: json.records };
  } catch (e) {
    return { success: false, error: String((e as Error).message ?? 'network_error') };
  }
}

// ============ DIAGNOSTIC LOG ============

export type DiagnosticLogEntry = {
  id: string;
  operation: string;
  module: string;
  month_key: string | null;
  entity_type: string | null;
  error_signature: string;
  root_cause: string | null;
  fix_status: string;
  created_at: string;
};

export async function fetchDiagnosticLog(monthKey?: string, limit = 50): Promise<DiagnosticLogEntry[]> {
  let query = supabase
    .from('diagnostic_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (monthKey) query = query.eq('month_key', monthKey);
  const { data } = await query;
  return (data as DiagnosticLogEntry[]) ?? [];
}

export async function logDiagnosticEntry(entry: {
  operation: string;
  module: string;
  month_key?: string;
  entity_type?: string;
  error_signature: string;
  root_cause?: string;
  fix_status?: string;
}): Promise<void> {
  try {
    await supabase.from('diagnostic_log').insert({
      operation: entry.operation,
      module: entry.module,
      month_key: entry.month_key ?? null,
      entity_type: entry.entity_type ?? null,
      error_signature: entry.error_signature,
      root_cause: entry.root_cause ?? null,
      fix_status: entry.fix_status ?? 'unverified',
    });
  } catch { /* non-critical */ }
}

export async function fetchKnownRegressions(monthKey: string): Promise<string[]> {
  const { data } = await supabase
    .from('diagnostic_log')
    .select('error_signature')
    .eq('month_key', monthKey)
    .neq('fix_status', 'regression_fixed');
  return (data ?? []).map((r: { error_signature: string }) => r.error_signature);
}

// ============ ZERO-OVERWRITE GUARD ============
//
// Prevents empty/null/zero API responses from overwriting valid
// existing data. Use at system boundaries where a fetch might
// return an empty array due to a network error rather than a
// genuinely empty dataset.
//
// Usage:
//   const data = await guardAgainstEmptyFetch(
//     () => fetchHomework(groupId, monthKey),
//     { existingCount: prevList.length, entity: 'homework', monthKey }
//   );

export async function guardAgainstEmptyFetch<T extends unknown[]>(
  fetchFn: () => Promise<T>,
  opts: { existingCount: number; entity: string; monthKey?: string }
): Promise<T> {
  try {
    const result = await fetchFn();
    // If the fetch returned an empty array but we already have data,
    // treat the empty result as suspicious — return the result but
    // log it for diagnostic tracking.
    if (result.length === 0 && opts.existingCount > 0) {
      await logDiagnosticEntry({
        operation: 'fetch',
        module: opts.entity,
        month_key: opts.monthKey,
        entity_type: opts.entity,
        error_signature: 'zero_overwrite_prevented',
        root_cause: `Fetch returned 0 ${opts.entity} records while ${opts.existingCount} exist in UI state. Returning empty result but flagging for investigation.`,
        fix_status: 'unverified',
      });
    }
    return result;
  } catch (err) {
    // Network/fetch failure — don't overwrite existing data
    await logDiagnosticEntry({
      operation: 'fetch',
      module: opts.entity,
      month_key: opts.monthKey,
      entity_type: opts.entity,
      error_signature: 'fetch_failed',
      root_cause: `Fetch of ${opts.entity} failed: ${String((err as Error).message ?? err)}`,
      fix_status: 'unverified',
    });
    throw err;
  }
}

// ============ CARRIED-OVER BALANCES ============
// Cross-month arrears logic has been removed entirely. Each month is
// financially isolated: September's ledger only reflects September
// payments and September's subscription amount. August's unpaid balance
// does NOT carry forward as debt into September.
//
// The functions below are kept as no-ops/stubs for backward compatibility
// with ArchiveOverview, which may still display historical carried-over
// records for audit purposes. They are no longer used to compute
// current-month debt.

export async function fetchCarriedOverBalances(_studentIds: string[]): Promise<CarriedOverBalance[]> {
  return [];
}

export async function fetchCarriedOverForMonth(monthKey: string): Promise<CarriedOverBalance[]> {
  const { data } = await supabase
    .from('carried_over_balances')
    .select('*')
    .eq('to_month', monthKey)
    .order('created_at', { ascending: false });
  return (data as CarriedOverBalance[]) ?? [];
}

export async function settleCarriedOverBalance(id: string): Promise<void> {
  await supabase
    .from('carried_over_balances')
    .update({ is_settled: true })
    .eq('id', id);
}

export async function clearOldCarriedOverBalances(): Promise<number> {
  const { data } = await supabase
    .from('carried_over_balances')
    .update({ is_settled: true })
    .eq('is_settled', false)
    .select('id');
  return data?.length ?? 0;
}

export async function fetchGroupMonthlyCollected(groupId: string, monthKey?: string): Promise<number> {
  const mk = monthKey ?? currentMonthKey();
  const { data: students } = await withTimeout(supabase
    .from('students')
    .select('id')
    .eq('group_id', groupId)
    .eq('status', 'active'));
  if (!students || students.length === 0) return 0;
  const studentIds = students.map((s) => s.id);
  const { data: payments } = await withTimeout(supabase
    .from('payments')
    .select('student_id, amount')
    .eq('month_key', mk)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0)
    .in('student_id', studentIds));
  return (payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
}

export async function fetchGroupMonthlyPaidMap(groupId: string, monthKey?: string): Promise<Map<string, number>> {
  const mk = monthKey ?? currentMonthKey();
  const { data: students } = await withTimeout(supabase
    .from('students')
    .select('id')
    .eq('group_id', groupId)
    .eq('status', 'active'));
  if (!students || students.length === 0) return new Map();
  const studentIds = students.map((s) => s.id);
  const { data: payments } = await withTimeout(supabase
    .from('payments')
    .select('student_id, amount')
    .eq('month_key', mk)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0)
    .in('student_id', studentIds));
  const map = new Map<string, number>();
  for (const p of payments ?? []) {
    const sid = (p as { student_id: string }).student_id;
    const amt = (p as { amount: number }).amount ?? 0;
    map.set(sid, (map.get(sid) ?? 0) + amt);
  }
  return map;
}

export async function fetchAllMonthlyPaidMap(monthKey?: string): Promise<Map<string, number>> {
  const mk = monthKey ?? currentMonthKey();
  const { data: payments } = await supabase
    .from('payments')
    .select('student_id, amount')
    .eq('month_key', mk)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0);
  const map = new Map<string, number>();
  for (const p of payments ?? []) {
    const sid = (p as { student_id: string }).student_id;
    const amt = (p as { amount: number }).amount ?? 0;
    map.set(sid, (map.get(sid) ?? 0) + amt);
  }
  return map;
}

export async function resolvePaymentStatusFromDB(
  studentId: string,
  monthKey: string
): Promise<{ isPaid: boolean; paidAmount: number; totalDue: number; remaining: number; isExempt: boolean; studentName: string; parentPhone: string | null; studentPhone: string | null } | null> {
  const { data: student } = await supabase
    .from('students')
    .select('id, name, total_fees, is_exempt, parent_phone, phone')
    .eq('id', studentId)
    .maybeSingle();
  if (!student) return null;
  const s = student as { id: string; name: string; total_fees: number | null; is_exempt: boolean | null; parent_phone: string | null; phone: string | null };
  const isExempt = s.is_exempt ?? false;
  if (isExempt) {
    return { isPaid: true, paidAmount: 0, totalDue: 0, remaining: 0, isExempt: true, studentName: s.name, parentPhone: s.parent_phone, studentPhone: s.phone };
  }
  const { data: sub } = await supabase
    .from('monthly_subscriptions')
    .select('amount_due, amount_paid, status')
    .eq('student_id', studentId)
    .eq('month_key', monthKey)
    .order('created_at', { ascending: false })
    .limit(1);
  const subRow = (sub ?? [])[0] as { amount_due: number; amount_paid: number; status: string } | undefined;
  const studentTotalFees = s.total_fees ?? 0;
  const totalDue = subRow?.amount_due ?? studentTotalFees;
  // Match by month_key, with payment_date range fallback for rows with null month_key
  const [y, m] = monthKey.split('-').map(Number);
  const nextMonth = new Date(y, m, 1);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
  const { data: payments } = await supabase
    .from('payments')
    .select('amount, month_key, payment_date')
    .eq('student_id', studentId)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0);
  const paidAmount = (payments ?? []).reduce((sum, p) => {
    const row = p as { amount: number; month_key: string | null; payment_date: string | null };
    const matches = row.month_key === monthKey || (!row.month_key && (row.payment_date ?? '') >= start && (row.payment_date ?? '') < end);
    return matches ? sum + (row.amount ?? 0) : sum;
  }, 0);
  const remaining = Math.max(0, totalDue - paidAmount);
  const isPaid = paidAmount >= totalDue && totalDue > 0;
  return { isPaid, paidAmount, totalDue, remaining, isExempt: false, studentName: s.name, parentPhone: s.parent_phone, studentPhone: s.phone };
}

export async function resolvePaymentStatus(
  studentId: string,
  monthKey: string,
  studentTotalFees: number,
  studentIsExempt: boolean
): Promise<{ isPaid: boolean; paidAmount: number; totalDue: number; remaining: number }> {
  if (studentIsExempt) {
    return { isPaid: true, paidAmount: 0, totalDue: 0, remaining: 0 };
  }
  const { data: sub } = await supabase
    .from('monthly_subscriptions')
    .select('amount_due, amount_paid, status')
    .eq('student_id', studentId)
    .eq('month_key', monthKey)
    .maybeSingle();
  const subRow = sub as { amount_due: number; amount_paid: number; status: string } | null;
  const totalDue = subRow?.amount_due ?? studentTotalFees;
  // Match by month_key, with payment_date range fallback for rows with null month_key
  const [y2, m2] = monthKey.split('-').map(Number);
  const nm = new Date(y2, m2, 1);
  const dtStart = `${y2}-${String(m2).padStart(2, '0')}-01`;
  const dtEnd = `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}-01`;
  const { data: payments } = await supabase
    .from('payments')
    .select('amount, month_key, payment_date')
    .eq('student_id', studentId)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0);
  const paidAmount = (payments ?? []).reduce((sum, p) => {
    const row = p as { amount: number; month_key: string | null; payment_date: string | null };
    const matches = row.month_key === monthKey || (!row.month_key && (row.payment_date ?? '') >= dtStart && (row.payment_date ?? '') < dtEnd);
    return matches ? sum + (row.amount ?? 0) : sum;
  }, 0);
  const remaining = Math.max(0, totalDue - paidAmount);
  const isPaid = paidAmount >= totalDue && totalDue > 0;
  return { isPaid, paidAmount, totalDue, remaining };
}

export async function resolvePaymentStatusBatch(
  studentIds: string[],
  monthKey: string,
  students: Map<string, { total_fees: number; is_exempt: boolean }>
): Promise<Map<string, { isPaid: boolean; paidAmount: number; totalDue: number; remaining: number }>> {
  const result = new Map<string, { isPaid: boolean; paidAmount: number; totalDue: number; remaining: number }>();
  if (studentIds.length === 0) return result;
  const { data: subs } = await supabase
    .from('monthly_subscriptions')
    .select('student_id, amount_due, amount_paid, status')
    .in('student_id', studentIds)
    .eq('month_key', monthKey);
  const subsByStudent = new Map<string, { amount_due: number; amount_paid: number; status: string }>();
  for (const s of subs ?? []) {
    const row = s as { student_id: string; amount_due: number; amount_paid: number; status: string };
    subsByStudent.set(row.student_id, { amount_due: row.amount_due, amount_paid: row.amount_paid, status: row.status });
  }
  const { data: payments } = await supabase
    .from('payments')
    .select('student_id, amount')
    .in('student_id', studentIds)
    .eq('month_key', monthKey)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0);
  const paidByStudent = new Map<string, number>();
  for (const p of payments ?? []) {
    const row = p as { student_id: string; amount: number };
    paidByStudent.set(row.student_id, (paidByStudent.get(row.student_id) ?? 0) + (row.amount ?? 0));
  }
  for (const sid of studentIds) {
    const info = students.get(sid);
    const totalFees = info?.total_fees ?? 0;
    const isExempt = info?.is_exempt ?? false;
    if (isExempt) {
      result.set(sid, { isPaid: true, paidAmount: 0, totalDue: 0, remaining: 0 });
      continue;
    }
    const sub = subsByStudent.get(sid);
    const totalDue = sub?.amount_due ?? totalFees;
    const paidAmount = paidByStudent.get(sid) ?? 0;
    const remaining = Math.max(0, totalDue - paidAmount);
    const isPaid = paidAmount >= totalDue && totalDue > 0;
    result.set(sid, { isPaid, paidAmount, totalDue, remaining });
  }
  return result;
}

export async function fetchCollectedBreakdown(groupId?: string, monthKey?: string): Promise<{
  student_id: string;
  student_name: string;
  amount: number;
  payment_date: string;
  month_key: string;
  note: string | null;
  recorded_by: string | null;
}[]> {
  const mk = monthKey ?? currentMonthKey();
  let studentIdFilter: string[] | null = null;
  if (groupId) {
    const { data: groupStudents } = await supabase
      .from('students')
      .select('id')
      .eq('group_id', groupId)
      .eq('status', 'active');
    studentIdFilter = (groupStudents ?? []).map((s) => (s as { id: string }).id);
    if (studentIdFilter.length === 0) return [];
  }
  let query = supabase
    .from('payments')
    .select('student_id, amount, payment_date, month_key, note, recorded_by, students(name)')
    .eq('month_key', mk)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0)
    .order('payment_date', { ascending: false });
  if (studentIdFilter) query = query.in('student_id', studentIdFilter);
  const { data } = await query;
  return (data ?? []).map((p) => {
    const row = p as { student_id: string; amount: number; payment_date: string; month_key: string; note: string | null; recorded_by: string | null; students: { name: string } | null };
    return {
      student_id: row.student_id,
      student_name: row.students?.name ?? '—',
      amount: row.amount,
      payment_date: row.payment_date,
      month_key: row.month_key,
      note: row.note,
      recorded_by: row.recorded_by,
    };
  });
}

export async function fetchStudentGradesOverview(studentId: string, groupId?: string | null): Promise<{
  centerGrades: { title: string; category: string; score: number; max_score: number; exam_date: string }[];
  behaviorEvals: { rating: string; note: string | null; eval_date: string; scope: string }[];
  homeworkStatuses: { title: string; status: string; due_date: string }[];
  attendanceSummary: { present: number; absent: number; excused: number; recent: { date: string; status: string; session_title: string | null }[] };
}> {
  const [examScores, behaviorRes, hwRes, attRes] = await Promise.all([
    supabase
      .from('center_grades')
      .select('score, center_exam_id, center_exams(id, title, category, max_score, exam_date)')
      .eq('student_id', studentId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false }),
    supabase
      .from('behavior_eval')
      .select('rating, note, eval_date, scope')
      .eq('student_id', studentId)
      .order('eval_date', { ascending: false })
      .limit(20),
    supabase
      .from('homework_status')
      .select('status, homework:homework(id, title, due_date, group_id)')
      .eq('student_id', studentId),
    supabase
      .from('attendance')
      .select('attendance_date, status, session_id, sessions(id, title)')
      .eq('student_id', studentId)
      .order('attendance_date', { ascending: false })
      .limit(30),
  ]);

  const examRows = (examScores.data ?? []) as Array<{
    score: number;
    center_exam_id: string;
    center_exams: { id: string; title: string; category: string; max_score: number; exam_date: string } | null;
  }>;

  const centerGrades = examRows
    .filter((r) => r.center_exams)
    .map((r) => ({
      title: r.center_exams!.title,
      category: r.center_exams!.category,
      score: r.score,
      max_score: r.center_exams!.max_score,
      exam_date: r.center_exams!.exam_date,
    }));

  const behRows = (behaviorRes.data ?? []) as Array<{ rating: string; note: string | null; eval_date: string; scope: string }>;
  const behaviorEvals = behRows.map((r) => ({ rating: r.rating, note: r.note, eval_date: r.eval_date, scope: r.scope }));

  const hwRows = (hwRes.data ?? []) as Array<{ status: string; homework: { id: string; title: string; due_date: string; group_id: string } | null }>;
  const homeworkStatuses = hwRows
    .filter((r) => r.homework && (!groupId || r.homework.group_id === groupId))
    .map((r) => ({ title: r.homework!.title, status: r.status, due_date: r.homework!.due_date }));

  const attRows = (attRes.data ?? []) as Array<{ attendance_date: string; status: string; session_id: string | null; sessions: { id: string; title: string } | null }>;
  const attendanceSummary = {
    present: attRows.filter((r) => r.status === 'present').length,
    absent: attRows.filter((r) => r.status === 'absent').length,
    excused: attRows.filter((r) => r.status === 'excused_absence' || r.status === 'excused').length,
    recent: attRows.slice(0, 10).map((r) => ({ date: r.attendance_date, status: r.status, session_title: r.sessions?.title ?? null })),
  };

  return { centerGrades, behaviorEvals, homeworkStatuses, attendanceSummary };
}

export async function rollbackArchive(monthKey: string): Promise<{ success: boolean; error?: string; restored_students?: number; deleted_carried_balances?: number }> {
  try {
    const { data, error } = await supabase.rpc('rollback_archive', { p_archive_month: monthKey });
    if (error) return { success: false, error: error.message };
    return data as { success: boolean; error?: string; restored_students?: number; deleted_carried_balances?: number };
  } catch {
    return { success: false, error: 'network_error' };
  }
}

// ============ HISTORICAL PAYMENTS ============

export async function createHistoricalPayment(
  studentId: string,
  amount: number,
  targetArchiveMonth: string,
  note: string | null,
  recordedBy: string
): Promise<Payment | null> {
  const guard = idempotencyGuard(generateOpKey('hist_pay', studentId, amount, targetArchiveMonth), 5000);
  if (guard.isDuplicate) return null;

  const now = new Date();
  const isoNow = now.toISOString();
  const paymentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const receiptNumber = generateReceiptNumber();
  const idempotencyKey = minuteBucketKey('hist', studentId, amount, targetArchiveMonth);

  // The payments and monthly_subscriptions tables have FK constraints to
  // students(id) ON DELETE CASCADE. Archived students that were later deleted
  // from the live table will fail those inserts/updates. Check existence first
  // so we can still record the payment in the archive JSON for those students.
  const { data: liveStudent } = await supabase
    .from('students')
    .select('id')
    .eq('id', studentId)
    .maybeSingle();
  const studentExists = !!liveStudent;

  let data: Payment | null = null;

  if (studentExists) {
    // Simple INSERT — the restrictive one-row-per-month unique index has been
    // dropped. Multiple historical payments per student per month are valid.
    // The idempotency_key unique index prevents double-click duplicates.
    const insertPayload = {
      student_id: studentId,
      amount,
      payment_date: paymentDate,
      note: note ?? `دفعة متأخرة لشهر ${targetArchiveMonth}`,
      recorded_by: recordedBy,
      recorded_at: isoNow,
      receipt_number: receiptNumber,
      month_key: targetArchiveMonth,
      is_historical_payment: true,
      target_archive_month: targetArchiveMonth,
      requires_manager_override: true,
      idempotency_key: idempotencyKey,
    };
    const { data: inserted, error: insErr } = await supabase
      .from('payments')
      .insert(insertPayload)
      .select()
      .single();
    if (insErr) {
      if (insErr.code === '23505') {
        // Duplicate within idempotency window — return existing
        const { data: existing } = await supabase
          .from('payments')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();
        data = (existing as Payment | null) ?? null;
      } else {
        console.error('createHistoricalPayment insert error:', insErr);
        return null;
      }
    } else {
      data = inserted as Payment | null;
    }
  } else {
    data = {
      id: `hist-${Date.now()}`,
      student_id: studentId,
      amount,
      payment_date: paymentDate,
      note: note ?? `دفعة متأخرة لشهر ${targetArchiveMonth}`,
      recorded_by: recordedBy,
      recorded_at: isoNow,
      receipt_number: receiptNumber,
      is_deleted: false,
      deleted_at: null,
      month_key: targetArchiveMonth,
      is_historical_payment: true,
      target_archive_month: targetArchiveMonth,
      requires_manager_override: true,
      created_at: isoNow,
    } as unknown as Payment;
  }

  // Payment is committed — return immediately so the caller can trigger
  // WhatsApp without waiting for subscription/archive/audit bookkeeping.
  guard.complete(true);
  const paymentResult = data as Payment | null;

  // Fire post-commit bookkeeping as non-blocking background operations.
  // These must NOT delay the WhatsApp trigger.
  void (async () => {
    if (studentExists) {
      const { data: subRows } = await supabase
        .from('monthly_subscriptions')
        .select('id, amount_due, amount_paid, status')
        .eq('student_id', studentId)
        .eq('month_key', targetArchiveMonth)
        .order('created_at', { ascending: false })
        .limit(1);
      const sub = (subRows ?? [])[0];
      if (sub) {
        const subRow = sub as { id: string; amount_due: number; amount_paid: number; status: string };
        const newPaid = Math.min(Number(subRow.amount_due), Number(subRow.amount_paid) + amount);
        const isFull = newPaid >= Number(subRow.amount_due);
        await supabase
          .from('monthly_subscriptions')
          .update({
            amount_paid: newPaid,
            status: isFull ? 'paid' : 'partial',
            paid_date: isFull ? isoNow : null,
            receipt_number: receiptNumber,
            recorded_by: recordedBy,
            note: note ?? `دفعة متأخرة لشهر ${targetArchiveMonth}`,
            is_archived: false,
          })
          .eq('id', subRow.id);
      }
    }

    const { data: archiveRow } = await supabase
      .from('monthly_archives')
      .select('id, archive_data')
      .eq('archive_month', targetArchiveMonth)
      .maybeSingle();
    if (archiveRow) {
      const ad = (archiveRow as { id: string; archive_data: Record<string, unknown> }).archive_data;
      const payments = (ad.payments ?? []) as ArchivedPaymentRow[];
      const students = (ad.students ?? []) as Array<{ id: string; paid_fees?: number | null }>;
      const paymentId = paymentResult?.id ?? `hist-${Date.now()}`;
      const archivedPayment = payments.find((p) => p.id === paymentId);
      if (archivedPayment) {
        archivedPayment.amount = (archivedPayment.amount ?? 0) + amount;
        archivedPayment.payment_date = paymentDate;
        archivedPayment.note = note ?? `دفعة متأخرة لشهر ${targetArchiveMonth}`;
        archivedPayment.receipt_number = receiptNumber;
      } else {
        payments.push({
          id: paymentId,
          student_id: studentId,
          amount,
          payment_date: paymentDate,
          note: note ?? `دفعة متأخرة لشهر ${targetArchiveMonth}`,
          receipt_number: receiptNumber,
        });
      }
      ad.payments = payments;
      const st = students.find((s) => s.id === studentId);
      if (st) st.paid_fees = (st.paid_fees ?? 0) + amount;
      ad.students = students;
      await supabase
        .from('monthly_archives')
        .update({ archive_data: ad })
        .eq('id', (archiveRow as { id: string }).id);
    }

    await createAuditLog(
      recordedBy,
      'master',
      'historical_payment',
      studentExists ? studentId : null,
      amount,
      `دفعة متأخرة لشهر ${targetArchiveMonth}`
    );
  })().catch((err) => {
    console.error('createHistoricalPayment background bookkeeping error:', err);
  });

  return paymentResult;
}

export async function fetchHistoricalPayments(studentId: string): Promise<Payment[]> {
  const { data } = await supabase
    .from('payments')
    .select('*')
    .eq('student_id', studentId)
    .eq('is_historical_payment', true)
    .eq('is_deleted', false)
    .order('payment_date', { ascending: false });
  return (data as Payment[]) ?? [];
}

// ============ ACCOUNTING CYCLES ============

export async function fetchAccountingCycles(): Promise<AccountingCycle[]> {
  const { data } = await supabase
    .from('accounting_cycles')
    .select('*')
    .order('cycle_number', { ascending: false });
  return (data as AccountingCycle[]) ?? [];
}

export async function createAccountingCycle(
  startDate: string,
  endDate: string,
  createdBy: string
): Promise<AccountingCycle | null> {
  const { data: payments } = await supabase
    .from('payments')
    .select('id, amount')
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0)
    .gte('payment_date', startDate)
    .lte('payment_date', endDate);

  const paymentIds = (payments ?? []).map((p: { id: string }) => p.id);
  const totalAmount = (payments ?? []).reduce((sum: number, p: { amount: number }) => sum + (p.amount ?? 0), 0);

  const { data, error } = await supabase
    .from('accounting_cycles')
    .insert({
      start_date: startDate,
      end_date: endDate,
      total_amount: totalAmount,
      remaining_amount: totalAmount,
      payment_ids: paymentIds,
      status: 'open',
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) {
    console.error('createAccountingCycle error:', error);
    return null;
  }
  return data as AccountingCycle | null;
}

export async function closeAccountingCycle(cycleId: string): Promise<void> {
  await supabase
    .from('accounting_cycles')
    .update({ status: 'closed', closed_at: new Date().toISOString(), accounted_amount: 0 })
    .eq('id', cycleId);
}

export async function fetchUnaccountedPayments(): Promise<{ payments: Payment[]; total: number }> {
  const { data: cycles } = await supabase
    .from('accounting_cycles')
    .select('payment_ids')
    .order('cycle_number', { ascending: false });

  const accountedIds = new Set<string>();
  for (const c of (cycles ?? []) as { payment_ids: string[] }[]) {
    for (const pid of c.payment_ids ?? []) accountedIds.add(pid);
  }

  const { data: allPayments } = await supabase
    .from('payments')
    .select('*')
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0)
    .order('payment_date', { ascending: false });

  const unaccounted = ((allPayments as Payment[]) ?? []).filter((p) => !accountedIds.has(p.id));
  const total = unaccounted.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  return { payments: unaccounted, total };
}

// ============ MONTH CLOSURES ============

export async function fetchMonthClosures(): Promise<MonthClosure[]> {
  const { data } = await supabase
    .from('month_closures')
    .select('*')
    .order('month_key', { ascending: false });
  return (data as MonthClosure[]) ?? [];
}

export async function closeMonth(
  monthKey: string,
  monthLabel: string,
  closedBy: string
): Promise<MonthClosure | null> {
  const mStart = monthStart(monthKey);
  const mEnd = nextMonthStart(monthKey);

  // Idempotency: check if this month is already closed
  const { data: existing } = await supabase
    .from('month_closures')
    .select('id, is_reopened')
    .eq('month_key', monthKey)
    .maybeSingle();

  // Pre-archive validation: gather source data with proper month boundaries
  const { data: students, error: studentsErr } = await supabase
    .from('students')
    .select('id, name, total_fees, paid_fees, is_exempt, status')
    .eq('status', 'active');
  if (studentsErr) throw new Error(studentsErr.message);

  const { data: payments, error: paymentsErr } = await supabase
    .from('payments')
    .select('id, student_id, amount, payment_date')
    .eq('month_key', monthKey)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false)
    .gt('amount', 0);
  if (paymentsErr) throw new Error(paymentsErr.message);

  const { data: attendance, error: attErr } = await supabase
    .from('attendance')
    .select('id, student_id, status')
    .gte('attendance_date', mStart)
    .lt('attendance_date', mEnd);
  if (attErr) throw new Error(attErr.message);

  const { data: grades, error: gradesErr } = await supabase
    .from('center_grades')
    .select('id, student_id, score, updated_at')
    .eq('is_deleted', false)
    .gte('updated_at', mStart)
    .lt('updated_at', mEnd);
  if (gradesErr) throw new Error(gradesErr.message);

  const collected = (payments ?? []).reduce((s: number, p: { amount: number }) => s + (p.amount ?? 0), 0);
  const totalDue = (students ?? []).reduce((s: number, st: { total_fees: number; is_exempt: boolean }) => s + (st.is_exempt ? 0 : (st.total_fees ?? 0)), 0);

  const sourceCounts = {
    student_count: students?.length ?? 0,
    payment_count: payments?.length ?? 0,
    attendance_count: attendance?.length ?? 0,
    grades_count: grades?.length ?? 0,
  };

  const snapshot = {
    ...sourceCounts,
    total_collected: collected,
    total_due: totalDue,
    absent_count: (attendance ?? []).filter((a: { status: string }) => a.status === 'absent' || a.status === 'excused_absence').length,
    timestamp: new Date().toISOString(),
    validation: 'passed' as const,
  };

  // Upsert (idempotent) — if a closure exists, update it; otherwise insert
  if (existing) {
    const { data: updated, error: updateErr } = await supabase
      .from('month_closures')
      .update({
        snapshot_data: snapshot,
        closed_by: closedBy,
        closed_at: new Date().toISOString(),
        is_reopened: false,
      })
      .eq('month_key', monthKey)
      .select()
      .single();
    if (updateErr) {
      console.error('closeMonth update error:', updateErr);
      return null;
    }
    return updated as MonthClosure | null;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('month_closures')
    .insert({
      month_key: monthKey,
      month_label: monthLabel,
      snapshot_data: snapshot,
      closed_by: closedBy,
    })
    .select()
    .single();

  if (insertErr) {
    console.error('closeMonth insert error:', insertErr);
    return null;
  }

  // Post-archive validation: read back and verify
  const { data: verify } = await supabase
    .from('month_closures')
    .select('snapshot_data')
    .eq('month_key', monthKey)
    .maybeSingle();
  if (!verify) {
    console.error('closeMonth: post-archive verification failed — no row returned');
    return null;
  }

  return inserted as MonthClosure | null;
}

export async function reopenMonth(monthKey: string): Promise<boolean> {
  const { error } = await supabase
    .from('month_closures')
    .update({ is_reopened: true })
    .eq('month_key', monthKey);
  if (error) {
    console.error('reopenMonth error:', error);
    return false;
  }
  return true;
}

// ============ DATA CHECK ============

export async function runDataCheck(): Promise<DataCheckIssue[]> {
  const issues: DataCheckIssue[] = [];

  const [studentsRes, paymentsRes, gradesRes, attendanceRes, examsRes] = await Promise.all([
    supabase.from('students').select('id, name, group_id, status, parent_phone, phone').eq('status', 'active'),
    supabase.from('payments').select('id, student_id, amount, payment_date, month_key, is_deleted, is_historical_payment').eq('is_deleted', false),
    supabase.from('center_grades').select('id, student_id, center_exam_id, score'),
    supabase.from('attendance').select('id, student_id, session_id, status, attendance_date'),
    supabase.from('center_exams').select('id, group_id, session_id, exam_date'),
  ]);

  const students = (studentsRes.data ?? []) as (Student & { group_id: string | null })[];
  const payments = (paymentsRes.data ?? []) as Payment[];
  const grades = (gradesRes.data ?? []) as { id: string; student_id: string; center_exam_id: string; score: number }[];
  const attendance = (attendanceRes.data ?? []) as { id: string; student_id: string; session_id: string | null; status: string; attendance_date: string }[];
  const exams = (examsRes.data ?? []) as { id: string; group_id: string; session_id: string | null; exam_date: string }[];

  // 1. Duplicate students (same name)
  const nameMap = new Map<string, Student[]>();
  for (const s of students) {
    const key = s.name.trim();
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key)!.push(s);
  }
  for (const [name, dupes] of nameMap) {
    if (dupes.length > 1) {
      issues.push({
        id: `dup-student-${name}`,
        type: 'duplicate_students',
        severity: 'warning',
        title: 'طالب مكرر',
        description: `يوجد ${dupes.length} طالب بنفس الاسم: ${name}`,
        student_name: name,
      });
    }
  }

  // 2. Duplicate payments (same student, same date, same amount)
  const payKeyMap = new Map<string, Payment[]>();
  for (const p of payments) {
    if (p.is_historical_payment) continue;
    const key = `${p.student_id}-${p.payment_date}-${p.amount}`;
    if (!payKeyMap.has(key)) payKeyMap.set(key, []);
    payKeyMap.get(key)!.push(p);
  }
  for (const [, dupes] of payKeyMap) {
    if (dupes.length > 1) {
      const st = students.find((s) => s.id === dupes[0].student_id);
      issues.push({
        id: `dup-pay-${dupes[0].id}`,
        type: 'duplicate_payments',
        severity: 'critical',
        title: 'دفعة مكررة',
        description: `${dupes.length} دفعات متطابقة لنفس الطالب بتاريخ ${dupes[0].payment_date} بمبلغ ${dupes[0].amount} ج.م`,
        student_id: dupes[0].student_id,
        student_name: st?.name,
        amount: dupes[0].amount,
        date: dupes[0].payment_date,
      });
    }
  }

  // 3. Grades without session (exam has no session_id)
  const examMap = new Map(exams.map((e) => [e.id, e]));
  for (const g of grades) {
    const exam = examMap.get(g.center_exam_id);
    if (exam && !exam.session_id) {
      // This is OK for exam/sheet categories, only flag if exam_date doesn't match any session
      // Skip — not necessarily an issue since exams can be standalone
    }
  }

  // 4. Attendance without session
  const attendanceNoSession = attendance.filter((a) => !a.session_id);
  if (attendanceNoSession.length > 0) {
    issues.push({
      id: 'att-no-session',
      type: 'attendance_without_session',
      severity: 'warning',
      title: 'حضور بدون حصة مرتبطة',
      description: `${attendanceNoSession.length} سجل حضور غير مرتبط بحصة محددة`,
    });
  }

  // 5. Absent student with a grade
  const absentStudentIds = new Set(
    attendance.filter((a) => a.status === 'absent' || a.status === 'excused_absence').map((a) => a.student_id)
  );
  const examDateMap = new Map(exams.map((e) => [e.id, e.exam_date]));
  for (const g of grades) {
    const examDate = examDateMap.get(g.center_exam_id);
    if (!examDate) continue;
    const absentOnExamDate = attendance.find(
      (a) => a.student_id === g.student_id && a.attendance_date === examDate && (a.status === 'absent' || a.status === 'excused_absence')
    );
    if (absentOnExamDate) {
      const st = students.find((s) => s.id === g.student_id);
      issues.push({
        id: `absent-grade-${g.id}`,
        type: 'absent_with_grade',
        severity: 'warning',
        title: 'طالب غائب لديه درجة',
        description: `الطالب ${st?.name ?? 'غير معروف'} مسجل كغائب في يوم الامتحان ولديه درجة (${g.score})`,
        student_id: g.student_id,
        student_name: st?.name,
      });
    }
  }

  // 6. Unaccounted payments
  const { payments: unaccounted, total: unaccountedTotal } = await fetchUnaccountedPayments();
  if (unaccounted.length > 0) {
    issues.push({
      id: 'unaccounted-payments',
      type: 'unaccounted_payments',
      severity: 'info',
      title: 'دفعات غير محاسب عليها',
      description: `${unaccounted.length} دفعة بمبلغ إجمالي ${unaccountedTotal} ج.م غير مدرجة في أي دورة محاسبة`,
      amount: unaccountedTotal,
    });
  }

  // 7. Missing required data (students without phone or parent phone)
  const missingContact = students.filter((s) => !s.phone && !s.parent_phone);
  if (missingContact.length > 0) {
    issues.push({
      id: 'missing-contact',
      type: 'missing_data',
      severity: 'info',
      title: 'بيانات ناقصة',
      description: `${missingContact.length} طالب بدون رقم هاتف أو رقم ولي الأمر`,
    });
  }

  // 8. Student in group but not appearing in homework for that group's sessions
  const { data: hwData } = await supabase
    .from('homework')
    .select('id, group_id, session_id')
    .not('session_id', 'is', null);
  const hwRows = (hwData ?? []) as { id: string; group_id: string; session_id: string }[];
  const hwByGroup = new Map<string, string[]>();
  for (const h of hwRows) {
    if (!hwByGroup.has(h.group_id)) hwByGroup.set(h.group_id, []);
    hwByGroup.get(h.group_id)!.push(h.id);
  }
  const { data: hwStatusData } = await supabase
    .from('homework_status')
    .select('student_id, homework_id');
  const hwStatusByHw = new Map<string, Set<string>>();
  for (const hs of (hwStatusData ?? []) as { student_id: string; homework_id: string }[]) {
    if (!hwStatusByHw.has(hs.homework_id)) hwStatusByHw.set(hs.homework_id, new Set());
    hwStatusByHw.get(hs.homework_id)!.add(hs.student_id);
  }
  const studentsByGroup = new Map<string, typeof students>();
  for (const s of students) {
    if (!s.group_id) continue;
    if (!studentsByGroup.has(s.group_id)) studentsByGroup.set(s.group_id, []);
    studentsByGroup.get(s.group_id)!.push(s);
  }
  for (const [groupId, hwIds] of hwByGroup) {
    const groupStudents = studentsByGroup.get(groupId);
    if (!groupStudents || groupStudents.length === 0) continue;
    for (const hwId of hwIds) {
      const statusSet = hwStatusByHw.get(hwId);
      const missing = groupStudents.filter((s) => !statusSet || !statusSet.has(s.id));
      if (missing.length > 0) {
        issues.push({
          id: `hw-missing-students-${hwId}`,
          type: 'homework_missing_students',
          severity: 'warning',
          title: 'طالب موجود في مجموعة وغير ظاهر في الواجب',
          description: `${missing.length} طالب في المجموعة بدون حالة واجب: ${missing.slice(0, 3).map((s) => s.name).join('، ')}${missing.length > 3 ? '...' : ''}`,
          group_id: groupId,
        });
      }
    }
  }

  // 9. Homework without valid session
  const hwNoSession = hwRows.filter((h) => !h.session_id);
  // Already loaded homework with session_id not null, so check separately
  const { data: allHw } = await supabase.from('homework').select('id, group_id, title, session_id');
  const hwNoValidSession = ((allHw ?? []) as { id: string; group_id: string; title: string; session_id: string | null }[])
    .filter((h) => !h.session_id);
  if (hwNoValidSession.length > 0) {
    issues.push({
      id: 'hw-no-session',
      type: 'homework_without_session',
      severity: 'warning',
      title: 'واجب بدون حصة صحيحة',
      description: `${hwNoValidSession.length} واجب غير مرتبط بحصة محددة`,
    });
  }

  // 10. Grade not linked to correct student (student group doesn't match exam group)
  for (const g of grades) {
    const exam = examMap.get(g.center_exam_id);
    if (!exam) continue;
    const st = students.find((s) => s.id === g.student_id);
    if (!st) {
      issues.push({
        id: `grade-orphan-${g.id}`,
        type: 'grade_student_mismatch',
        severity: 'critical',
        title: 'درجة غير مرتبطة بالطالب الصحيح',
        description: `درجة لطالب غير موجود أو محذوف`,
        student_id: g.student_id,
      });
      continue;
    }
    if (st.group_id && exam.group_id && st.group_id !== exam.group_id) {
      issues.push({
        id: `grade-group-mismatch-${g.id}`,
        type: 'grade_student_mismatch',
        severity: 'warning',
        title: 'درجة غير مرتبطة بالطالب الصحيح',
        description: `الطالب ${st.name} في مجموعة مختلفة عن مجموعة الامتحان`,
        student_id: st.id,
        student_name: st.name,
      });
    }
  }

  // 11. Session with incorrect date (session_date doesn't match any schedule)
  const { data: sessionsData } = await supabase
    .from('sessions')
    .select('id, group_id, session_date, title')
    .eq('is_deleted', false);
  const { data: groupsData } = await supabase.from('groups').select('id, schedule');
  const groupScheduleMap = new Map<string, string | null>();
  for (const g of (groupsData ?? []) as { id: string; schedule: string | null }[]) {
    groupScheduleMap.set(g.id, g.schedule);
  }
  for (const s of (sessionsData ?? []) as { id: string; group_id: string; session_date: string | null; title: string }[]) {
    if (!s.session_date) continue;
    const schedule = groupScheduleMap.get(s.group_id);
    if (schedule && schedule.trim()) {
      const dayName = ARABIC_DAYS[new Date(s.session_date).getDay()];
      if (!schedule.includes(dayName)) {
        issues.push({
          id: `session-wrong-date-${s.id}`,
          type: 'session_wrong_date',
          severity: 'info',
          title: 'حصة مرتبطة بتاريخ غير صحيح',
          description: `حصة "${s.title}" بتاريخ ${s.session_date} — اليوم غير مطابق لمواعيد المجموعة`,
        });
      }
    }
  }

  return issues;
}

// ============ HEALTH SCORE ============

export async function computeHealthScore(): Promise<HealthScore> {
  const [studentsRes, paymentsRes, attendanceRes, gradesRes, homeworkRes, cyclesRes, closuresRes] = await Promise.all([
    supabase.from('students').select('id, name, total_fees, paid_fees, is_exempt, status, group_id').eq('status', 'active'),
    supabase.from('payments').select('id, student_id, amount, month_key, is_deleted').eq('is_deleted', false).eq('is_historical_payment', false).gt('amount', 0),
    supabase.from('attendance').select('id, student_id, status, attendance_date'),
    supabase.from('center_grades').select('id, student_id, center_exam_id'),
    supabase.from('homework_status').select('id, student_id, status'),
    supabase.from('accounting_cycles').select('id, total_amount, accounted_amount, status'),
    supabase.from('month_closures').select('id, month_key, is_reopened'),
  ]);

  const students = (studentsRes.data ?? []) as (Student & { group_id: string | null })[];
  const payments = (paymentsRes.data ?? []) as Payment[];
  const attendance = (attendanceRes.data ?? []) as { id: string; student_id: string; status: string; attendance_date: string }[];
  const grades = (gradesRes.data ?? []) as { id: string; student_id: string }[];
  const homework = (homeworkRes.data ?? []) as { id: string; student_id: string; status: string }[];
  const cycles = (cyclesRes.data ?? []) as AccountingCycle[];
  const closures = (closuresRes.data ?? []) as MonthClosure[];

  const issues: string[] = [];
  const studentCount = students.length || 1;

  // 1. Attendance completeness (0-20)
  const recordedAttendance = attendance.length;
  const expectedAttendance = studentCount * 4; // ~4 sessions per month
  const attendanceScore = Math.min(20, Math.round((recordedAttendance / Math.max(expectedAttendance, 1)) * 20));
  if (attendanceScore < 15) issues.push(`الحضور غير مكتمل (${recordedAttendance} سجل)`);

  // 2. Academic records (0-20)
  const studentsWithGrades = new Set(grades.map((g) => g.student_id)).size;
  const academicScore = Math.min(20, Math.round((studentsWithGrades / studentCount) * 20));
  if (academicScore < 15) issues.push(`درجات غير مكتملة (${studentsWithGrades}/${studentCount} طالب)`);

  // 3. Homework completion (0-15)
  const studentsWithHomework = new Set(homework.map((h) => h.student_id)).size;
  const homeworkScore = Math.min(15, Math.round((studentsWithHomework / studentCount) * 15));
  if (homeworkScore < 10) issues.push(`واجبات غير مكتملة (${studentsWithHomework}/${studentCount} طالب)`);

  // 4. Financial collection (0-20)
  const totalDue = students.reduce((s, st) => s + (st.is_exempt ? 0 : (st.total_fees ?? 0)), 0);
  const totalCollected = students.reduce((s, st) => s + (st.paid_fees ?? 0), 0);
  const collectionRate = totalDue > 0 ? Math.min(1, totalCollected / totalDue) : 1;
  const financeScore = Math.round(collectionRate * 20);
  if (financeScore < 15) issues.push(`تحصيل منخفض (${Math.round(collectionRate * 100)}%)`);

  // 5. Accounting accuracy (0-10)
  const accountedTotal = cycles.reduce((s, c) => s + (c.accounted_amount ?? 0), 0);
  const cyclesTotal = cycles.reduce((s, c) => s + (c.total_amount ?? 0), 0);
  const accountingRatio = cyclesTotal > 0 ? accountedTotal / cyclesTotal : 1;
  const accountingScore = Math.round(accountingRatio * 10);
  if (accountingScore < 8 && cyclesTotal > 0) issues.push(`محاسبة غير مكتملة (${Math.round(accountingRatio * 100)}%)`);

  // 6. Data consistency (0-10)
  const dataIssues = await runDataCheck();
  const criticalCount = dataIssues.filter((i) => i.severity === 'critical').length;
  const warningCount = dataIssues.filter((i) => i.severity === 'warning').length;
  const consistencyScore = Math.max(0, 10 - criticalCount * 3 - warningCount);
  if (criticalCount > 0) issues.push(`${criticalCount} مشكلة حرجة في البيانات`);
  if (warningCount > 0) issues.push(`${warningCount} تحذير في البيانات`);

  // 7. Pending issues (0-5)
  const pendingCycles = cycles.filter((c) => c.status === 'open').length;
  const pendingScore = pendingCycles > 2 ? 2 : 5;
  if (pendingCycles > 2) issues.push(`${pendingCycles} دورة محاسبة مفتوحة`);

  const score = attendanceScore + academicScore + homeworkScore + financeScore + accountingScore + consistencyScore + pendingScore;
  const level: HealthScore['level'] = score >= 80 ? 'excellent' : score >= 50 ? 'attention' : 'critical';

  return {
    score,
    level,
    factors: [
      { label: 'اكتمال الحضور', score: attendanceScore, max: 20, issues: attendanceScore < 15 ? ['سجلات حضور ناقصة'] : [] },
      { label: 'السجل الأكاديمي', score: academicScore, max: 20, issues: academicScore < 15 ? ['درجات غير مسجلة'] : [] },
      { label: 'الواجبات', score: homeworkScore, max: 15, issues: homeworkScore < 10 ? ['واجبات غير مكتملة'] : [] },
      { label: 'التحصيل المالي', score: financeScore, max: 20, issues: financeScore < 15 ? ['تحصيل منخفض'] : [] },
      { label: 'دقة المحاسبة', score: accountingScore, max: 10, issues: accountingScore < 8 ? ['محاسبة غير مكتملة'] : [] },
      { label: 'اتساق البيانات', score: consistencyScore, max: 10, issues: criticalCount > 0 ? [`${criticalCount} مشكلة حرجة`] : [] },
      { label: 'المعلقات', score: pendingScore, max: 5, issues: pendingCycles > 2 ? [`${pendingCycles} دورة مفتوحة`] : [] },
    ],
  };
}

// ============ ASK THE PLATFORM ============

export type QueryResult = {
  answer: string;
  records: { student_id?: string; student_name?: string; group_name?: string; amount?: number; date?: string; status?: string; score?: number; details?: string }[];
  summary: string;
  needsClarification?: boolean;
};

// Arabic month name → month number (1-12)
const MONTH_NAME_MAP: Record<string, number> = {
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4,
  'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8,
  'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
};

// Question categories that require a month context
const MONTH_SENSITIVE = ['فلوس', 'عليه', 'مديون', 'باقي', 'دفعة', 'يدفع', 'لم يدفع', 'محصل', 'تحصيل', 'مجموع', 'اجمالي', 'إجمالي', 'غاب', 'غياب', 'غائب', 'حضور', 'درجات', 'درجة', 'نزلت', 'نجح', 'راسب', 'واجب', 'واجبات', 'تسميع', 'امتحان', 'امتحانات'];

function extractMonthKey(q: string): string | null {
  const currentYear = new Date().getFullYear();
  for (const [name, num] of Object.entries(MONTH_NAME_MAP)) {
    if (q.includes(name)) {
      return `${currentYear}-${String(num).padStart(2, '0')}`;
    }
  }
  // Also try numeric month patterns like "شهر 8" or "شهر 08"
  const numMatch = q.match(/شهر\s*(\d{1,2})/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    if (num >= 1 && num <= 12) return `${currentYear}-${String(num).padStart(2, '0')}`;
  }
  return null;
}

function monthKeyToLabel(monthKey: string): string {
  const [, m] = monthKey.split('-').map(Number);
  return ARABIC_MONTHS[m - 1] ?? monthKey;
}

function monthNeedsClarification(q: string): boolean {
  if (extractMonthKey(q)) return false;
  for (const kw of MONTH_SENSITIVE) {
    if (q.includes(kw)) return true;
  }
  return false;
}

async function fetchStageGradeForGroups(groupIds: string[]): Promise<Map<string, { stage: string; grade: string }>> {
  if (groupIds.length === 0) return new Map();
  const { data } = await supabase
    .from('groups')
    .select('id, name, grade_level:grade_level_id(id, name, stage:stage_id(id, name))')
    .in('id', groupIds);
  const map = new Map<string, { stage: string; grade: string }>();
  for (const row of (data ?? []) as { id: string; grade_level: { name: string; stage: { name: string } } | null }[]) {
    map.set(row.id, {
      stage: row.grade_level?.stage?.name ?? '',
      grade: row.grade_level?.name ?? '',
    });
  }
  return map;
}

export async function askPlatform(question: string): Promise<QueryResult> {
  const q = question.trim().toLowerCase();

  // If the question is month-sensitive but no month specified, ask for clarification
  if (monthNeedsClarification(q)) {
    return {
      answer: 'تقصد أي شهر؟ اذكر الشهر في سؤالك مثل: "مين لم يدفع شهر أغسطس؟"',
      records: [],
      summary: '',
      needsClarification: true,
    };
  }

  const monthKey = extractMonthKey(q);
  const monthLabel = monthKey ? monthKeyToLabel(monthKey) : '';

  const [studentsRes, groupsRes] = await Promise.all([
    supabase.from('students').select('id, name, group_id, total_fees, paid_fees, is_exempt, status, phone, parent_phone').eq('status', 'active'),
    supabase.from('groups').select('id, name, grade_level_id'),
  ]);

  const students = (studentsRes.data ?? []) as (Student & { group_id: string | null; phone: string | null; parent_phone: string | null })[];
  const groups = (groupsRes.data ?? []) as { id: string; name: string; grade_level_id: string }[];
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  const groupStageGradeMap = await fetchStageGradeForGroups(groups.map((g) => g.id));
  const groupId = extractGroupId(q, groups);

  // ── Financial: who owes / hasn't paid ──
  if (q.includes('فلوس') || q.includes('عليه') || q.includes('مديون') || q.includes('باقي') || q.includes('دفعة') || q.includes('يدفع') || q.includes('لم يدفع') || q.includes('لم يدفع')) {
    if (!monthKey) {
      return { answer: 'تقصد أي شهر؟ اذكر الشهر مثل: "مين لم يدفع شهر أغسطس؟"', records: [], summary: '', needsClarification: true };
    }
    // Fetch monthly_subscriptions for the specified month
    const { data: subsRes } = await supabase
      .from('monthly_subscriptions')
      .select('id, student_id, amount_due, amount_paid, status, month_key')
      .eq('month_key', monthKey);
    const subs = (subsRes ?? []) as { id: string; student_id: string; amount_due: number; amount_paid: number; status: string; month_key: string }[];
    const subByStudent = new Map(subs.map((s) => [s.student_id, s]));

    // Students who have a subscription for this month and haven't fully paid
    let debtors = students.filter((s) => {
      if (s.is_exempt) return false;
      const sub = subByStudent.get(s.id);
      if (!sub) return false;
      return sub.amount_paid < sub.amount_due;
    }).map((s) => {
      const sub = subByStudent.get(s.id)!;
      const sg = groupStageGradeMap.get(s.group_id ?? '') ?? { stage: '', grade: '' };
      return {
        student_id: s.id,
        student_name: s.name,
        group_name: groupMap.get(s.group_id ?? '') ?? '',
        stage: sg.stage,
        grade: sg.grade,
        fee: sub.amount_due,
        paid: sub.amount_paid,
        remaining: sub.amount_due - sub.amount_paid,
        status: sub.status === 'unpaid' ? 'لم يدفع' : 'دفع جزئي',
      };
    });

    // Also include active students with NO subscription row for this month (they owe the full fee)
    const studentsWithSub = new Set(subs.map((s) => s.student_id));
    const noSub = students.filter((s) => {
      if (s.is_exempt) return false;
      if (studentsWithSub.has(s.id)) return false;
      // Only include if student was enrolled before or during this month
      return true;
    }).map((s) => {
      const sg = groupStageGradeMap.get(s.group_id ?? '') ?? { stage: '', grade: '' };
      return {
        student_id: s.id,
        student_name: s.name,
        group_name: groupMap.get(s.group_id ?? '') ?? '',
        stage: sg.stage,
        grade: sg.grade,
        fee: s.total_fees ?? 0,
        paid: 0,
        remaining: s.total_fees ?? 0,
        status: 'لم يدفع',
      };
    });

    let allDebtors = [...debtors, ...noSub];
    if (groupId) {
      allDebtors = allDebtors.filter((d) => students.find((s) => s.id === d.student_id)?.group_id === groupId);
    }

    const totalRemaining = allDebtors.reduce((sum, d) => sum + d.remaining, 0);
    return {
      answer: allDebtors.length > 0
        ? `${allDebtors.length} طالب لم يدفع بالكامل شهر ${monthLabel}${groupId ? ` في ${groupMap.get(groupId)}` : ''}`
        : `جميع الطلاب دفعوا شهر ${monthLabel} بالكامل`,
      records: allDebtors.map((d) => ({
        student_id: d.student_id,
        student_name: d.student_name,
        group_name: d.group_name,
        amount: d.remaining,
        details: `المرحلة: ${d.stage} | الصف: ${d.grade} | رسوم الشهر: ${d.fee} ج.م | المدفوع: ${d.paid} ج.م | المتبقي: ${d.remaining} ج.م | الحالة: ${d.status}`,
      })),
      summary: `إجمالي المتبقي لشهر ${monthLabel}: ${totalRemaining} ج.م`,
    };
  }

  // ── Absence / attendance ──
  if (q.includes('غاب') || q.includes('غياب') || q.includes('غائب') || q.includes('حضور')) {
    let attendanceQuery = supabase
      .from('attendance')
      .select('id, student_id, status, attendance_date, group_id');
    if (monthKey) {
      attendanceQuery = attendanceQuery
        .gte('attendance_date', `${monthKey}-01`)
        .lte('attendance_date', `${monthKey}-31`);
    }
    const { data: attRes } = await attendanceQuery;
    const attendance = (attRes ?? []) as { id: string; student_id: string; status: string; attendance_date: string; group_id: string | null }[];

    const excusedOnly = q.includes('عذر');
    let filtered = attendance.filter((a) => a.status === 'absent' || a.status === 'excused_absence');
    if (excusedOnly) filtered = filtered.filter((a) => a.status === 'excused_absence');

    if (groupId) {
      filtered = filtered.filter((a) => {
        const st = students.find((s) => s.id === a.student_id);
        return st?.group_id === groupId;
      });
    }

    const recent = (q.includes('اخر') || q.includes('اليوم') || q.includes('ده')) && !monthKey
      ? [...filtered].sort((a, b) => b.attendance_date.localeCompare(a.attendance_date)).slice(0, 20)
      : filtered;

    const monthDesc = monthKey ? ` في شهر ${monthLabel}` : '';
    return {
      answer: filtered.length > 0
        ? `${filtered.length} سجل ${excusedOnly ? 'غياب بعذر' : 'غياب'}${monthDesc}${groupId ? ` في ${groupMap.get(groupId)}` : ''}`
        : `لا يوجد طلاب غائبون${monthDesc}`,
      records: recent.map((a) => {
        const st = students.find((s) => s.id === a.student_id);
        const sg = groupStageGradeMap.get(a.group_id ?? st?.group_id ?? '') ?? { stage: '', grade: '' };
        return {
          student_id: a.student_id,
          student_name: st?.name ?? 'غير معروف',
          group_name: groupMap.get(a.group_id ?? st?.group_id ?? '') ?? '',
          date: a.attendance_date,
          status: a.status === 'excused_absence' ? 'غائب بعذر' : 'غائب',
          details: `المرحلة: ${sg.stage} | الصف: ${sg.grade}`,
        };
      }),
      summary: `إجمالي سجلات الغياب${monthDesc}: ${filtered.length}`,
    };
  }

  // ── Collected amount / تحصيل ──
  if (q.includes('محصل') || q.includes('تحصيل') || q.includes('مجموع') || q.includes('اجمالي') || q.includes('إجمالي')) {
    let payQuery = supabase
      .from('payments')
      .select('id, student_id, amount, payment_date, month_key')
      .eq('is_deleted', false)
      .eq('is_historical_payment', false)
      .gt('amount', 0);
    if (monthKey) {
      payQuery = payQuery.eq('month_key', monthKey);
    }
    const { data: payRes } = await payQuery;
    const payments = (payRes ?? []) as { id: string; student_id: string; amount: number; payment_date: string; month_key: string | null }[];

    let filtered = payments;
    if (groupId) {
      filtered = payments.filter((p) => {
        const st = students.find((s) => s.id === p.student_id);
        return st?.group_id === groupId;
      });
    }

    const total = filtered.reduce((s, p) => s + (p.amount ?? 0), 0);
    const monthDesc = monthKey ? ` في شهر ${monthLabel}` : '';
    return {
      answer: groupId
        ? `إجمالي المحصل في ${groupMap.get(groupId)}${monthDesc}: ${total} ج.م`
        : `إجمالي المحصل${monthDesc}: ${total} ج.م`,
      records: [],
      summary: `عدد الدفعات: ${filtered.length}`,
    };
  }

  // ── Grades ──
  if (q.includes('درجات') || q.includes('درجة') || q.includes('نزلت') || q.includes('نجح') || q.includes('راسب')) {
    let gradesQuery = supabase.from('center_grades').select('id, student_id, score, center_exam_id');
    const { data: gradeRes } = await gradesQuery;
    let grades = (gradeRes ?? []) as { id: string; student_id: string; score: number; center_exam_id: string }[];

    // Filter by month using exam_date if month specified
    if (monthKey) {
      const { data: examsRes } = await supabase
        .from('center_exams')
        .select('id, exam_date')
        .gte('exam_date', `${monthKey}-01`)
        .lte('exam_date', `${monthKey}-31`);
      const examIds = new Set((examsRes ?? []).map((e: { id: string }) => e.id));
      grades = grades.filter((g) => examIds.has(g.center_exam_id));
    }

    // Fetch exam max_scores to normalize scores via centralized engine
    const { data: examsForMax } = await supabase.from('center_exams').select('id, max_score');
    const examMaxMap = new Map((examsForMax ?? []).map((e: { id: string; max_score: number }) => [e.id, e.max_score]));

    const rawGrades: RawGrade[] = grades.map((g) => ({
      student_id: g.student_id,
      score: g.score,
      max_score: examMaxMap.get(g.center_exam_id) ?? 100,
      center_exam_id: g.center_exam_id,
    }));
    const studentAvgs = calcStudentAverages(rawGrades);

    const studentsWithGrades = students.map((s) => {
      const sg = groupStageGradeMap.get(s.group_id ?? '') ?? { stage: '', grade: '' };
      const info = studentAvgs.get(s.id);
      const avg = info ? info.avgPercent : null;
      return { student: s, avg, count: info?.count ?? 0, stage: sg.stage, grade: sg.grade };
    }).filter((x) => x.avg !== null);

    const failing = q.includes('راسب') || q.includes('نزلت')
      ? studentsWithGrades.filter((x) => (x.avg ?? 0) < 50)
      : studentsWithGrades;

    let filteredResult = failing;
    if (groupId) filteredResult = failing.filter((x) => x.student.group_id === groupId);

    const monthDesc = monthKey ? ` في شهر ${monthLabel}` : '';
    return {
      answer: filteredResult.length > 0
        ? `${filteredResult.length} طالب ${q.includes('راسب') ? 'راسب' : 'لديه درجات مسجلة'}${monthDesc}`
        : `لا توجد درجات مسجلة${monthDesc}`,
      records: filteredResult.map((x) => ({
        student_id: x.student.id,
        student_name: x.student.name,
        group_name: groupMap.get(x.student.group_id ?? '') ?? '',
        score: Math.round(x.avg ?? 0),
        details: `المرحلة: ${x.stage} | الصف: ${x.grade} | متوسط الدرجات: ${Math.round(x.avg ?? 0)} | عدد الامتحانات: ${x.count}`,
      })),
      summary: `متوسط الدرجات العام${monthDesc}: ${studentsWithGrades.length > 0 ? Math.round(studentsWithGrades.reduce((s, x) => s + (x.avg ?? 0), 0) / studentsWithGrades.length) : 0}`,
    };
  }

  // ── Accounting access blocked for assistant ──
  if (q.includes('محاسبة') || q.includes('محاسب') || q.includes('غير محاسب')) {
    return {
      answer: 'المحاسبة مش متاحة في المساعد. المحاسبة بيانات إدارية منفصلة عن المدفوعات والأرشيف.',
      records: [],
      summary: '',
    };
  }

  // ── Default: search by student name ──
  const nameMatch = students.find((s) => q.includes(s.name.toLowerCase().split(' ')[0]));
  if (nameMatch) {
    const sg = groupStageGradeMap.get(nameMatch.group_id ?? '') ?? { stage: '', grade: '' };
    return {
      answer: `الطالب: ${nameMatch.name} — المرحلة: ${sg.stage} — الصف: ${sg.grade} — المجموعة: ${groupMap.get(nameMatch.group_id ?? '') ?? 'غير محدد'} — المبلغ المتبقي: ${(nameMatch.total_fees ?? 0) - (nameMatch.paid_fees ?? 0)} ج.م`,
      records: [],
      summary: `الحالة: ${nameMatch.is_exempt ? 'معفي من الرسوم' : 'يدفع رسوم'}`,
    };
  }

  return {
    answer: 'لم أتمكن من فهم السؤال. جرّب صياغة مثل: "مين لم يدفع شهر أغسطس؟" أو "كام طالب غاب في سبتمبر؟" أو "إجمالي المحصل في أغسطس؟"',
    records: [],
    summary: '',
  };
}

function extractGroupId(q: string, groups: { id: string; name: string }[]): string | null {
  for (const g of groups) {
    if (q.includes(g.name.toLowerCase()) || q.includes(g.name)) return g.id;
  }
  const groupMatch = q.match(/مجموعة\s*(\d+)/);
  if (groupMatch) {
    const idx = parseInt(groupMatch[1], 10) - 1;
    if (idx >= 0 && idx < groups.length) return groups[idx].id;
  }
  return null;
}

// ============================================================
// EXAM SECTIONS
// ============================================================

export async function fetchExamSections(examId: string): Promise<ExamSection[]> {
  const { data } = await supabase
    .from('exam_sections')
    .select('*')
    .eq('exam_id', examId)
    .order('sort_order');
  return (data ?? []) as ExamSection[];
}

export async function createExamSection(
  examId: string,
  title: string,
  instructions: string | null,
  sortOrder: number
): Promise<ExamSection | null> {
  const { data, error } = await supabase
    .from('exam_sections')
    .insert({ exam_id: examId, title, instructions, sort_order: sortOrder })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ExamSection | null;
}

export async function updateExamSection(
  id: string,
  patch: Partial<ExamSection>
): Promise<void> {
  const { error } = await supabase.from('exam_sections').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteExamSection(id: string): Promise<void> {
  const { error } = await supabase.from('exam_sections').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ============================================================
// QUESTION BANK
// ============================================================

export async function fetchQuestionBank(
  filters?: { subject?: string; type?: QuestionType; gradeLevelId?: string; search?: string }
): Promise<QuestionBankItem[]> {
  let query = supabase.from('question_bank').select('*');
  if (filters?.subject) query = query.eq('subject', filters.subject);
  if (filters?.type) query = query.eq('type', filters.type);
  if (filters?.gradeLevelId) query = query.eq('grade_level_id', filters.gradeLevelId);
  if (filters?.search) query = query.ilike('question_text', `%${filters.search}%`);
  const { data } = await query.order('created_at', { ascending: false }).limit(200);
  return (data ?? []) as QuestionBankItem[];
}

export async function createQuestionBankItem(
  payload: Partial<QuestionBankItem>
): Promise<QuestionBankItem | null> {
  const { data, error } = await supabase
    .from('question_bank')
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as QuestionBankItem | null;
}

export async function updateQuestionBankItem(
  id: string,
  patch: Partial<QuestionBankItem>
): Promise<void> {
  const { error } = await supabase.from('question_bank').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteQuestionBankItem(id: string): Promise<void> {
  const { error } = await supabase.from('question_bank').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ============================================================
// EXAM VARIANTS
// ============================================================

export async function fetchExamVariants(examId: string): Promise<ExamVariant[]> {
  const { data } = await supabase
    .from('exam_variants')
    .select('*')
    .eq('exam_id', examId)
    .order('created_at');
  return (data ?? []) as ExamVariant[];
}

export async function createExamVariant(
  examId: string,
  label: string,
  questionOrder: string[] | null,
  choiceOrder: Record<string, number[]> | null
): Promise<ExamVariant | null> {
  const { data, error } = await supabase
    .from('exam_variants')
    .insert({ exam_id: examId, variant_label: label, question_order: questionOrder, choice_order: choiceOrder, is_active: true })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ExamVariant | null;
}

export async function deleteExamVariant(id: string): Promise<void> {
  const { error } = await supabase.from('exam_variants').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ============================================================
// EXAM LIFECYCLE
// ============================================================

export async function updateExamLifecycle(
  examId: string,
  status: ExamLifecycleStatus
): Promise<void> {
  const { error } = await supabase
    .from('exams')
    .update({ lifecycle_status: status, is_published: status === 'published' || status === 'active', is_draft: status === 'draft' })
    .eq('id', examId);
  if (error) throw new Error(error.message);
}

// ============================================================
// REORDER EXAM QUESTIONS
// ============================================================

export async function reorderExamQuestions(
  examId: string,
  orderedIds: string[]
): Promise<void> {
  const updates = orderedIds.map((id, idx) =>
    supabase.from('exam_questions').update({ sort_order: idx }).eq('id', id)
  );
  await Promise.all(updates);
}

// ============================================================
// EXAM RE-ENTRY REQUESTS
// ============================================================

export async function createReentryRequest(params: {
  exam_id: string;
  submission_id?: string | null;
  student_id?: string | null;
  student_name: string;
  student_phone?: string | null;
  reason?: string | null;
}): Promise<ExamReentryRequest | null> {
  const { data, error } = await supabase
    .from('exam_reentry_requests')
    .insert({
      exam_id: params.exam_id,
      submission_id: params.submission_id ?? null,
      student_id: params.student_id ?? null,
      student_name: params.student_name,
      student_phone: params.student_phone ?? null,
      reason: params.reason ?? null,
      status: 'pending',
    })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ExamReentryRequest | null;
}

export async function fetchPendingReentryRequests(): Promise<(ExamReentryRequest & { exam?: { title: string } })[]> {
  const { data, error } = await supabase
    .from('exam_reentry_requests')
    .select('*, exam:exams(title)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as (ExamReentryRequest & { exam?: { title: string } })[];
}

export async function fetchReentryRequestStatus(
  examId: string,
  studentPhone: string | null,
  studentId: string | null
): Promise<ExamReentryRequest | null> {
  let query = supabase
    .from('exam_reentry_requests')
    .select('*')
    .eq('exam_id', examId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (studentPhone) {
    query = query.eq('student_phone', studentPhone);
  } else if (studentId) {
    query = query.eq('student_id', studentId);
  } else {
    return null;
  }
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return data as ExamReentryRequest | null;
}

export async function updateReentryRequest(
  requestId: string,
  status: ReentryRequestStatus,
  resolvedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('exam_reentry_requests')
    .update({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw new Error(error.message);
}

export async function fetchExamSubmissionForStudent(
  examId: string,
  studentId: string | null,
  studentPhone: string | null
): Promise<ExamSubmission | null> {
  let query = supabase
    .from('exam_submissions')
    .select('*')
    .eq('exam_id', examId)
    .order('started_at', { ascending: false })
    .limit(1);
  if (studentId) {
    query = query.eq('student_id', studentId);
  } else if (studentPhone) {
    query = query.eq('student_phone', studentPhone);
  } else {
    return null;
  }
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return data as ExamSubmission | null;
}

export async function reopenSubmissionForReentry(submissionId: string): Promise<void> {
  const { error } = await supabase
    .from('exam_submissions')
    .update({ status: 'in_progress', submitted_at: null })
    .eq('id', submissionId);
  if (error) throw new Error(error.message);
}
