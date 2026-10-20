import type { Student, AttendanceRecord, OnlineGrade, CenterGrade, OnlineExam, CenterExam, HomeworkStatus, BehaviorEval, Settings } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { formatArabicDate, normalizePhoneForWhatsApp, openWhatsAppURL } from '@/lib/format';
import { calcStudentAverages, type RawGrade } from '@/lib/gradeCalc';

const BEHAVIOR_LABELS_SHORT: Record<string, string> = {
  participatory: 'مشارك',
  quiet: 'هادئ',
  disruptive: 'مشاغب',
  excellent: 'ممتاز',
  needs_attention: 'يحتاج متابعة',
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function gradePercentages(
  onlineGrades: (OnlineGrade & { exam?: OnlineExam })[],
  centerGrades: (CenterGrade & { exam?: CenterExam })[]
): { pct: number; date: string }[] {
  const online = onlineGrades.map((g) => ({
    pct: g.max_score > 0 ? (g.score / g.max_score) * 100 : 0,
    date: g.updated_at,
  }));
  const center = centerGrades.map((g) => ({
    pct: (g.exam?.max_score ?? 100) > 0 ? (g.score / (g.exam?.max_score ?? 100)) * 100 : 0,
    date: g.updated_at,
  }));
  return [...online, ...center].sort((a, b) => a.date.localeCompare(b.date));
}

function monthStart(monthKey: string): string {
  return `${monthKey}-01`;
}
function nextMonthStart(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export type ReportMonthContext = {
  monthKey: string;
  groupId: string | null;
};

export type MissingComponent = {
  category: 'attendance' | 'homework' | 'exams' | 'behavior' | 'recitation';
  label: string;
  detail: string;
};

export type ValidationResult = {
  hasGaps: boolean;
  gaps: MissingComponent[];
};

/**
 * Validate that a student has the expected records for a specific month.
 * Only flags genuinely missing records — not zero scores, not absences,
 * not optional assessments that weren't scheduled.
 */
export async function validateStudentMonthData(
  studentId: string,
  groupId: string | null,
  monthKey: string
): Promise<ValidationResult> {
  const start = monthStart(monthKey);
  const end = nextMonthStart(monthKey);
  const gaps: MissingComponent[] = [];

  // Fetch sessions for this group in this month
  let sessionCount = 0;
  if (groupId) {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, session_date')
      .eq('group_id', groupId)
      .eq('is_deleted', false)
      .eq('is_archived', false)
      .gte('session_date', start)
      .lt('session_date', end);
    sessionCount = (sessions ?? []).length;

    // Check attendance: does the student have ANY attendance record in this month?
    const { data: att } = await supabase
      .from('attendance')
      .select('id, status')
      .eq('student_id', studentId)
      .gte('attendance_date', start)
      .lt('attendance_date', end)
      .neq('status', 'unrecorded')
      .limit(1);
    const hasAttendance = (att ?? []).length > 0;

    if (sessionCount > 0 && !hasAttendance) {
      // Check if ALL sessions have the student marked absent (that's still recorded)
      const { data: absentAtt } = await supabase
        .from('attendance')
        .select('id')
        .eq('student_id', studentId)
        .eq('status', 'absent')
        .gte('attendance_date', start)
        .lt('attendance_date', end)
        .limit(1);
      if ((absentAtt ?? []).length === 0) {
        gaps.push({
          category: 'attendance',
          label: 'الحضور',
          detail: `لا يوجد سجل حضور للطالب في ${sessionCount} حصة هذا الشهر`,
        });
      }
    }
  }

  // Check center grades (exams/sheets/recitation) for this month
  const { data: centerExams } = await supabase
    .from('center_exams')
    .select('id, title, category, exam_date, group_id')
    .eq('group_id', groupId ?? '')
    .gte('exam_date', start)
    .lt('exam_date', end);
  const monthExams = (centerExams ?? []) as { id: string; title: string; category: string; exam_date: string; group_id: string }[];

  if (monthExams.length > 0) {
    const examIds = monthExams.map((e) => e.id);
    const { data: grades } = await supabase
      .from('center_grades')
      .select('student_id, center_exam_id, is_absent')
      .eq('student_id', studentId)
      .in('center_exam_id', examIds)
      .eq('is_deleted', false);
    const gradedExamIds = new Set((grades ?? []).map((g) => (g as { center_exam_id: string }).center_exam_id));

    const missingExams = monthExams.filter((e) => !gradedExamIds.has(e.id));
    const missingRegular = missingExams.filter((e) => e.category === 'exam' || !e.category);
    const missingRecitation = missingExams.filter((e) => e.category === 'recitation');
    const missingSheet = missingExams.filter((e) => e.category === 'sheet');

    if (missingRegular.length > 0) {
      gaps.push({
        category: 'exams',
        label: 'الامتحانات',
        detail: `لم يتم تسجيل درجات في ${missingRegular.length} امتحان: ${missingRegular.map((e) => e.title).join('، ')}`,
      });
    }
    if (missingRecitation.length > 0) {
      gaps.push({
        category: 'recitation',
        label: 'التسميع',
        detail: `لم يتم تسجيل ${missingRecitation.length} تسميع: ${missingRecitation.map((e) => e.title).join('، ')}`,
      });
    }
    if (missingSheet.length > 0) {
      gaps.push({
        category: 'exams',
        label: 'الشيتات',
        detail: `لم يتم تسجيل ${missingSheet.length} شيت: ${missingSheet.map((e) => e.title).join('، ')}`,
      });
    }
  }

  // Check homework for this month
  const { data: homework } = await supabase
    .from('homework')
    .select('id, title, due_date, group_id')
    .eq('group_id', groupId ?? '')
    .gte('due_date', start)
    .lt('due_date', end);
  const monthHw = (homework ?? []) as { id: string; title: string; due_date: string; group_id: string }[];

  if (monthHw.length > 0) {
    const hwIds = monthHw.map((h) => h.id);
    const { data: hwStatus } = await supabase
      .from('homework_status')
      .select('student_id, homework_id')
      .eq('student_id', studentId)
      .in('homework_id', hwIds);
    const recordedHwIds = new Set((hwStatus ?? []).map((h) => (h as { homework_id: string }).homework_id));
    const missingHw = monthHw.filter((h) => !recordedHwIds.has(h.id));

    if (missingHw.length > 0) {
      gaps.push({
        category: 'homework',
        label: 'الواجبات',
        detail: `لم يتم تسجيل حالة ${missingHw.length} واجب: ${missingHw.map((h) => h.title).join('، ')}`,
      });
    }
  }

  // Check behavior evaluations for this month
  const { data: behavior } = await supabase
    .from('behavior_eval')
    .select('id, eval_date')
    .eq('student_id', studentId)
    .gte('eval_date', start)
    .lt('eval_date', end)
    .limit(1);
  const hasBehavior = (behavior ?? []).length > 0;

  // Only flag behavior as missing if there were sessions (i.e. the student was active)
  if (!hasBehavior && sessionCount > 0) {
    gaps.push({
      category: 'behavior',
      label: 'السلوك',
      detail: 'لم يتم تسجيل أي تقييم سلوكي للطالب هذا الشهر',
    });
  }

  return { hasGaps: gaps.length > 0, gaps };
}

export async function generateStudentReport(
  student: Student,
  settings: Settings,
  monthContext?: ReportMonthContext
): Promise<string> {
  const mk = monthContext?.monthKey ?? currentMonthKey();
  const start = monthStart(mk);
  const end = nextMonthStart(mk);

  // Month-scoped queries — only fetch records belonging to the target month
  const { data: att } = await supabase
    .from('attendance')
    .select('*')
    .eq('student_id', student.id)
    .gte('attendance_date', start)
    .lt('attendance_date', end)
    .order('attendance_date', { ascending: false });
  const attendance = (att as AttendanceRecord[]) ?? [];

  // Center grades scoped by exam_date in this month
  const { data: cg } = await supabase
    .from('center_grades')
    .select('*, exam:center_exams(*)')
    .eq('student_id', student.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  const allCenterGrades = (cg as (CenterGrade & { exam?: CenterExam })[]) ?? [];
  const centerGrades = allCenterGrades.filter((g) => {
    const ed = g.exam?.exam_date;
    return ed && ed >= start && ed < end;
  });

  // Online grades scoped by exam open_at in this month
  const { data: og } = await supabase
    .from('online_grades')
    .select('*, exam:exams(*)')
    .eq('student_id', student.id);
  const allOnlineGrades = (og as (OnlineGrade & { exam?: OnlineExam })[]) ?? [];
  const onlineGrades = allOnlineGrades.filter((g) => {
    const d = g.exam?.open_at ?? g.updated_at;
    return d && d.slice(0, 7) === mk;
  });

  // Homework status scoped by homework due_date in this month
  const { data: hwStatus } = await supabase
    .from('homework_status')
    .select('*, homework:homework(title, due_date)')
    .eq('student_id', student.id)
    .order('recorded_at', { ascending: true });
  const allHwStatuses = (hwStatus as (HomeworkStatus & { homework?: { title: string; due_date: string } })[]) ?? [];
  const homeworkStatuses = allHwStatuses.filter((h) => {
    const dd = h.homework?.due_date;
    return dd && dd >= start && dd < end;
  });

  // Behavior scoped by eval_date in this month
  const { data: beh } = await supabase
    .from('behavior_eval')
    .select('*')
    .eq('student_id', student.id)
    .gte('eval_date', start)
    .lt('eval_date', end)
    .order('eval_date', { ascending: false });
  const behaviorEvals = (beh as BehaviorEval[]) ?? [];

  const present = attendance.filter((a) => a.status === 'present' || a.status === 'late' || a.status === 'makeup').length;
  const absent = attendance.filter((a) => a.status === 'absent' || a.status === 'excused_absence').length;
  const rate = attendance.length > 0 ? Math.round((present / attendance.length) * 100) : 0;

  const hwComplete = homeworkStatuses.filter((h) => h.status === 'complete' || h.status === 'done').length;
  const hwRate = homeworkStatuses.length > 0 ? Math.round((hwComplete / homeworkStatuses.length) * 100) : 0;

  const behaviorLabel = behaviorEvals.length > 0
    ? (BEHAVIOR_LABELS_SHORT[behaviorEvals[0].rating] ?? '—')
    : '—';

  const allGrades = gradePercentages(onlineGrades, centerGrades);
  const avgPct = allGrades.length > 0 ? Math.round(average(allGrades.map((g) => g.pct))) : 0;
  void avgPct;

  const rawGrades: RawGrade[] = [
    ...onlineGrades.map((g) => ({ student_id: g.student_id, score: g.score, max_score: g.max_score })),
    ...centerGrades.map((g) => ({ student_id: g.student_id, score: g.score, max_score: g.exam?.max_score ?? 100 })),
  ];
  const studentAvgs = calcStudentAverages(rawGrades);
  const studentAvg = studentAvgs.get(student.id);
  const centralizedAvgPct = studentAvg ? Math.round(studentAvg.avgPercent) : 0;

  const lines: string[] = [];
  lines.push(`*${settings.platform_name}*`);
  lines.push(`${settings.management_name}`);
  lines.push('━━━━━━━━━━━━━');
  lines.push(`👤 *${student.name}*`);

  // Show the report month label
  const [y, m] = mk.split('-').map(Number);
  const monthLabel = `${['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][m - 1] ?? mk} ${y}`;
  lines.push(`📅 شهر ${monthLabel}`);
  lines.push('');
  lines.push(`📊 *ملخص الأداء:*`);
  if (attendance.length > 0) {
    lines.push(`• الحضور: ${rate}% (${present} حضور، ${absent} غياب)`);
  } else {
    lines.push(`• الحضور: لا يوجد سجل`);
  }
  if (allGrades.length > 0) {
    lines.push(`• الدرجات: ${centralizedAvgPct}%`);
  } else {
    lines.push(`• الدرجات: لا يوجد درجات مسجلة`);
  }
  if (homeworkStatuses.length > 0) {
    lines.push(`• الواجبات: ${hwRate}%`);
  } else {
    lines.push(`• الواجبات: لا يوجد سجل`);
  }
  lines.push(`• السلوك: ${behaviorLabel}`);
  lines.push('');

  // Financial summary — compute from actual payment receipts for this month
  // to prevent any doubling. The monthly_subscriptions row is used for
  // amount_due, but paid amount is always derived from SUM(payments).
  const { data: subData } = await supabase
    .from('monthly_subscriptions')
    .select('amount_due, amount_paid, is_paid')
    .eq('student_id', student.id)
    .eq('month_key', mk)
    .maybeSingle();
  const sub = subData as { amount_due: number; amount_paid: number; is_paid: boolean } | null;

  let totalFees = sub?.amount_due ?? student.total_fees ?? 0;
  let paidFees = 0;

  // Always compute paidFees from actual receipts for this month — never use
  // the cumulative students.paid_fees or subscription.amount_paid, which can
  // drift or include cross-month totals. Match by month_key first, then fall
  // back to payment_date range for payments that have null month_key.
  const { data: monthPayments } = await supabase
    .from('payments')
    .select('amount, month_key, payment_date')
    .eq('student_id', student.id)
    .eq('is_deleted', false)
    .eq('is_historical_payment', false);
  paidFees = (monthPayments ?? []).reduce((s, p) => {
    const row = p as { amount: number; month_key: string | null; payment_date: string | null };
    const rowMonth = row.month_key;
    const rowDate = row.payment_date ?? '';
    const matches = rowMonth === mk || (!rowMonth && rowDate >= start && rowDate < end);
    return matches ? s + Number(row.amount ?? 0) : s;
  }, 0);

  // If no subscription row, check archive snapshot for amount_due
  if (!sub) {
    const { data: archData } = await supabase
      .from('monthly_archives')
      .select('archive_data')
      .eq('archive_month', mk)
      .maybeSingle();
    const archStudent = ((archData?.archive_data as Record<string, unknown[]> | null)?.students as (Student & { total_fees?: number; paid_fees?: number; is_exempt?: boolean })[] | undefined)?.find((s) => s.id === student.id);
    if (archStudent) {
      totalFees = archStudent.total_fees ?? totalFees;
    }
    // For archived months, also add historical payments (post-archive)
    const { data: histPayments } = await supabase
      .from('payments')
      .select('amount')
      .eq('student_id', student.id)
      .eq('month_key', mk)
      .eq('is_deleted', false)
      .eq('is_historical_payment', true);
    paidFees += (histPayments ?? []).reduce((s, p) => s + Number((p as { amount: number }).amount ?? 0), 0);
  }

  const isExempt = student.is_exempt;
  const remaining = isExempt ? 0 : Math.max(0, totalFees - paidFees);
  const isFullyPaid = isExempt || remaining <= 0;

  if (isExempt) {
    lines.push(`💰 *الماليات:* معفي من المصروفات`);
  } else if (isFullyPaid) {
    lines.push(`💰 *الماليات:* دفع كامل (${paidFees} ج.م)`);
    lines.push(`🙏 شكراً لكم لسداد المصروفات بالكامل. جزاكم الله خيراً.`);
  } else {
    lines.push(`💰 *الماليات:* مدفوع ${paidFees} ج.م / المتبقي ${remaining} ج.م`);
    lines.push(`💡 نود التذكير اللطيف بخصوص مصاريف الشهر المتبقية بقيمة ${remaining} ج.م، ولكم جزيل الشكر.`);
  }
  lines.push('');

  if (centerGrades.length > 0) {
    lines.push(`📝 *درجات السنتر:*`);
    for (const g of centerGrades) {
      lines.push(`• ${g.exam?.title ?? 'امتحان'}: ${g.score}/${g.exam?.max_score ?? 100}`);
    }
    lines.push('');
  }

  if (onlineGrades.length > 0) {
    lines.push(`💻 *الامتحانات الإلكترونية:*`);
    for (const g of onlineGrades) {
      lines.push(`• ${g.exam?.title ?? 'امتحان'}: ${g.score}/${g.max_score}`);
    }
    lines.push('');
  }

  const remarks = rate >= 80
    ? 'أداء ممتاز، واصل التفوق 🌟'
    : rate >= 60
      ? 'أداء جيد، استمر في الاجتهاد 💪'
      : 'يحتاج لمزيد من الالتزام 📚';
  lines.push(`💬 ${remarks}`);
  lines.push('');
  lines.push(`— ${settings.management_name}`);

  return lines.join('\n');
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export type SendResult = {
  studentId: string;
  studentName: string;
  status: 'success' | 'no_phone' | 'error';
  message: string;
};

export function openWhatsAppForStudent(student: Student, reportText: string): boolean {
  if (!student.parent_phone) return false;
  const cleanPhone = normalizePhoneForWhatsApp(student.parent_phone);
  if (!cleanPhone) return false;
  const text = encodeURIComponent(reportText);
  const result = openWhatsAppURL(`https://wa.me/${cleanPhone}?text=${text}`);
  return result.opened;
}
