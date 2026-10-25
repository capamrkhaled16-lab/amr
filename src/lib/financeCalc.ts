import type { Student } from '@/lib/types';

export type PaymentCategory = 'fullyPaid' | 'partial' | 'unpaid' | 'collected' | 'exempt';

export interface FinancialSummary {
  collected: number;
  remaining: number;
  totalDue: number;
  fullyPaid: number;
  partialPaid: number;
  unpaid: number;
  exemptCount: number;
  studentCount: number;
}

/**
 * Classify a single student's payment status for a specific month.
 * This is the single source of truth — both the dashboard counters and the
 * drill-down modal must call this so their numbers always match exactly.
 *
 * Month-scoped exemption: if `monthExemptMap` contains the student's ID,
 * they are exempt for THIS month only. The global `is_exempt` flag is only
 * used as a fallback when no monthExemptMap is provided (backward compat).
 *
 * - Month-exempt students → 'fullyPaid' (nothing owed this month).
 * - Students with total_fees <= 0 → 'fullyPaid' (nothing owed).
 * - Deferred-fee students who haven't paid → 'partial' (excluded from unpaid).
 * - paid >= baseFees → 'fullyPaid'.
 * - paid > 0 but < baseFees → 'partial'.
 * - paid === 0 → 'unpaid'.
 */
export function classifyStudentPayment(
  s: Student,
  monthlyPaidMap: Map<string, number>,
  monthExemptMap?: Map<string, true>
): { category: PaymentCategory; paid: number; fees: number; remaining: number } {
  const isExempt = monthExemptMap
    ? monthExemptMap.has(s.id)
    : (s.is_exempt ?? false);
  const fees = s.total_fees ?? 0;
  const paid = monthlyPaidMap.get(s.id) ?? 0;
  const remaining = Math.max(0, fees - paid);
  const feeMode = (s as Student & { fee_mode?: string }).fee_mode ?? 'full';

  let category: PaymentCategory;

  if (isExempt) {
    category = 'exempt';
  } else if (fees <= 0) {
    category = 'fullyPaid';
  } else if (paid >= fees) {
    category = 'fullyPaid';
  } else if (feeMode === 'deferred' && paid === 0) {
    category = 'partial';
  } else if (paid > 0) {
    category = 'partial';
  } else {
    category = 'unpaid';
  }

  return { category, paid, fees, remaining };
}

/**
 * Single source of truth for all financial totals across the platform.
 * Every screen that shows collected/remaining/fullyPaid/partialPaid/unpaid
 * must call this with the same student list + paid map so numbers always agree.
 */
export function computeFinancialSummary(
  students: Student[],
  monthlyPaidMap: Map<string, number>,
  monthExemptMap?: Map<string, true>
): FinancialSummary {
  let collected = 0;
  let remaining = 0;
  let totalDue = 0;
  let fullyPaid = 0;
  let partialPaid = 0;
  let unpaid = 0;
  let exemptCount = 0;

  for (const s of students) {
    const isExempt = monthExemptMap
      ? monthExemptMap.has(s.id)
      : (s.is_exempt ?? false);
    const { category, paid, fees } = classifyStudentPayment(s, monthlyPaidMap, monthExemptMap);

    if (isExempt) {
      exemptCount++;
      continue;
    }

    if (category === 'fullyPaid') {
      fullyPaid++;
      collected += paid;
      totalDue += fees;
    } else if (category === 'partial') {
      partialPaid++;
      remaining += Math.max(0, fees - paid);
      totalDue += fees;
      collected += paid;
    } else {
      unpaid++;
      remaining += Math.max(0, fees - paid);
      totalDue += fees;
      collected += paid;
    }
  }

  return { collected, remaining, totalDue, fullyPaid, partialPaid, unpaid, exemptCount, studentCount: students.length };
}

/**
 * Determine whether a student is "حديث" (newly registered) for the given month.
 * A student is حديث only during the month they joined (join_month_key === monthKey).
 * This does NOT leak into subsequent months.
 */
export function isNewThisMonth(
  s: Student,
  monthKey: string
): boolean {
  const joinMonth = (s as Student & { join_month_key?: string | null }).join_month_key;
  if (!joinMonth) return false;
  return joinMonth === monthKey;
}

/**
 * Filter a student list by the stage/grade/group hierarchy.
 * Pass null/undefined for any level to skip that filter.
 */
export function filterStudentsByHierarchy<T extends Student>(
  students: T[],
  stageName: string | null | undefined,
  gradeName: string | null | undefined,
  groupId: string | null | undefined
): T[] {
  return students.filter((s) => {
    const sn = (s as Student & { stage_name?: string }).stage_name;
    const gn = (s as Student & { grade_name?: string }).grade_name;
    if (stageName && sn !== stageName) return false;
    if (gradeName && gn !== gradeName) return false;
    if (groupId && s.group_id !== groupId) return false;
    return true;
  });
}
