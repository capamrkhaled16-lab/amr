import { supabase } from '@/lib/supabase';
import type { Student, AttendanceRecord, CenterGrade, HomeworkStatus, BehaviorEval } from '@/lib/types';
import { calcStudentAverages, type RawGrade } from '@/lib/gradeCalc';
import { monthStart, nextMonthStart } from '@/lib/data';

export type ActivityLevel = 'active' | 'low_attendance' | 'inactive';

export type StudentMonitorData = {
  studentId: string;
  consecutiveAbsences: number;
  totalSessions: number;
  presentCount: number;
  absentCount: number;
  lastPresentDate: string | null;
  activityLevel: ActivityLevel;
  isNewStudent: boolean;
  enrollmentDate: string;
};

export type PerformanceTrend = {
  studentId: string;
  trend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
  recentAvg: number;
  previousAvg: number;
  evaluationCount: number;
};

export type ReviewItem = {
  studentId: string;
  studentName: string;
  groupId: string | null;
  groupName: string | null;
  type: 'inactive' | 'absence_streak' | 'low_performance' | 'missing_data' | 'new_student';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  meta?: Record<string, string | number>;
};

const ABSENT_STATUSES = new Set(['absent', 'excused_absence']);
const PRESENT_STATUSES = new Set(['present', 'late', 'makeup']);

function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function fetchStudentMonitoringData(studentIds: string[]): Promise<Map<string, StudentMonitorData>> {
  const result = new Map<string, StudentMonitorData>();
  if (studentIds.length === 0) return result;

  const mStart = monthStart();
  const mEnd = nextMonthStart();
  const { data: attendance } = await supabase
    .from('attendance')
    .select('student_id, status, attendance_date, session_id, group_id')
    .in('student_id', studentIds)
    .gte('attendance_date', mStart)
    .lt('attendance_date', mEnd)
    .order('attendance_date', { ascending: false });

  const byStudent = new Map<string, AttendanceRecord[]>();
  for (const a of (attendance ?? []) as AttendanceRecord[]) {
    const arr = byStudent.get(a.student_id) ?? [];
    arr.push(a);
    byStudent.set(a.student_id, arr);
  }

  const today = dateStr(new Date());

  for (const sid of studentIds) {
    const records = byStudent.get(sid) ?? [];
    const recorded = records.filter((r) => r.status !== 'unrecorded');

    let consecutive = 0;
    let presentCount = 0;
    let absentCount = 0;
    let lastPresentDate: string | null = null;

    for (const r of recorded) {
      if (PRESENT_STATUSES.has(r.status)) {
        presentCount++;
        if (!lastPresentDate) lastPresentDate = r.attendance_date;
      }
      if (ABSENT_STATUSES.has(r.status)) {
        absentCount++;
        consecutive++;
      } else {
        consecutive = 0;
      }
    }

    const totalSessions = recorded.length;
    const attendanceRate = totalSessions > 0 ? presentCount / totalSessions : 0;

    let activityLevel: ActivityLevel = 'active';
    if (consecutive >= 5) activityLevel = 'inactive';
    else if (consecutive >= 3 || attendanceRate < 0.5) activityLevel = 'low_attendance';

    result.set(sid, {
      studentId: sid,
      consecutiveAbsences: consecutive,
      totalSessions,
      presentCount,
      absentCount,
      lastPresentDate,
      activityLevel,
      isNewStudent: false,
      enrollmentDate: today,
    });
  }

  return result;
}

export async function fetchPerformanceTrends(
  studentIds: string[]
): Promise<Map<string, PerformanceTrend>> {
  const result = new Map<string, PerformanceTrend>();
  if (studentIds.length === 0) return result;

  const mStart = monthStart();
  const mEnd = nextMonthStart();
  const { data: grades } = await supabase
    .from('center_grades')
    .select('student_id, score, updated_at, center_exam_id')
    .in('student_id', studentIds)
    .eq('is_deleted', false)
    .gte('updated_at', mStart)
    .lt('updated_at', mEnd)
    .order('updated_at', { ascending: true });

  const examIds = new Set<string>();
  for (const g of (grades ?? []) as (CenterGrade & { center_exam_id: string })[]) {
    examIds.add(g.center_exam_id);
  }

  let maxScoreMap = new Map<string, number>();
  if (examIds.size > 0) {
    const { data: exams } = await supabase
      .from('center_exams')
      .select('id, max_score')
      .in('id', [...examIds]);
    maxScoreMap = new Map((exams ?? []).map((e: { id: string; max_score: number }) => [e.id, e.max_score]));
  }

  // Build RawGrade[] for centralized engine
  const rawGrades: RawGrade[] = (grades ?? []).map((g) => ({
    student_id: g.student_id,
    score: g.score,
    max_score: maxScoreMap.get(g.center_exam_id) ?? 100,
    center_exam_id: g.center_exam_id,
  }));
  const studentAvgs = calcStudentAverages(rawGrades);

  // Build per-student timeline for trend analysis
  const byStudentTimeline = new Map<string, { pct: number; updatedAt: string }[]>();
  for (const g of (grades ?? []) as (CenterGrade & { center_exam_id: string })[]) {
    const max = maxScoreMap.get(g.center_exam_id) ?? 100;
    const pct = max > 0 ? (g.score / max) * 100 : 0;
    const arr = byStudentTimeline.get(g.student_id) ?? [];
    arr.push({ pct, updatedAt: g.updated_at });
    byStudentTimeline.set(g.student_id, arr);
  }

  for (const [sid, timeline] of byStudentTimeline) {
    if (timeline.length < 3) {
      result.set(sid, {
        studentId: sid,
        trend: 'insufficient_data',
        recentAvg: 0,
        previousAvg: 0,
        evaluationCount: timeline.length,
      });
      continue;
    }

    timeline.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const percentages = timeline.map((t) => t.pct);
    const midpoint = Math.floor(percentages.length / 2);
    const recentAvg = percentages.slice(midpoint).reduce((a, b) => a + b, 0) / (percentages.length - midpoint);
    const previousAvg = percentages.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;

    const diff = recentAvg - previousAvg;
    let trend: PerformanceTrend['trend'] = 'stable';
    if (diff > 5) trend = 'improving';
    else if (diff < -10) trend = 'declining';

    result.set(sid, {
      studentId: sid,
      trend,
      recentAvg: Math.round(recentAvg),
      previousAvg: Math.round(previousAvg),
      evaluationCount: percentages.length,
    });
  }

  // Ensure students with grades but <3 entries are also covered
  for (const [sid, info] of studentAvgs) {
    if (!result.has(sid)) {
      result.set(sid, {
        studentId: sid,
        trend: 'insufficient_data',
        recentAvg: Math.round(info.avgPercent),
        previousAvg: 0,
        evaluationCount: info.count,
      });
    }
  }

  return result;
}

export async function fetchReviewItems(
  allStudents: (Student & { group_name?: string; grade_name?: string; stage_name?: string })[]
): Promise<ReviewItem[]> {
  if (allStudents.length === 0) return [];

  const activeStudents = allStudents.filter((s) => s.status === 'active' && !s.is_deleted);
  const studentIds = activeStudents.map((s) => s.id);

  const [monitorMap, trendMap] = await Promise.all([
    fetchStudentMonitoringData(studentIds),
    fetchPerformanceTrends(studentIds),
  ]);

  const items: ReviewItem[] = [];
  const today = new Date();
  const todayStr = dateStr(today);

  for (const student of activeStudents) {
    const mon = monitorMap.get(student.id);
    if (!mon) continue;

    const daysSinceEnrollment = Math.floor(
      (today.getTime() - new Date(student.enrollment_date || student.created_at).getTime()) / 86400000
    );
    const isNew = daysSinceEnrollment <= 14;

    if (isNew) {
      items.push({
        studentId: student.id,
        studentName: student.name,
        groupId: student.group_id,
        groupName: student.group_name ?? null,
        type: 'new_student',
        severity: 'info',
        title: `طالب حديث — ${student.name}`,
        description: `بدأ الحضور من ${student.enrollment_date || student.created_at}`,
        meta: { daysSinceEnrollment },
      });
      continue;
    }

    if (mon.consecutiveAbsences >= 5) {
      items.push({
        studentId: student.id,
        studentName: student.name,
        groupId: student.group_id,
        groupName: student.group_name ?? null,
        type: 'inactive',
        severity: 'critical',
        title: `الطالب ${student.name} غير نشط منذ فترة`,
        description: `لم يسجل حضورًا منذ ${mon.consecutiveAbsences} حصص — يحتاج مراجعة.`,
        meta: { consecutiveAbsences: mon.consecutiveAbsences },
      });
    } else if (mon.consecutiveAbsences >= 3) {
      items.push({
        studentId: student.id,
        studentName: student.name,
        groupId: student.group_id,
        groupName: student.group_name ?? null,
        type: 'absence_streak',
        severity: 'warning',
        title: `الطالب ${student.name} لم يسجل حضورًا منذ ${mon.consecutiveAbsences} حصص`,
        description: `غياب متكرر — يحتاج متابعة.`,
        meta: { consecutiveAbsences: mon.consecutiveAbsences },
      });
    }

    const trend = trendMap.get(student.id);
    if (trend && trend.trend === 'declining' && trend.recentAvg < 50) {
      items.push({
        studentId: student.id,
        studentName: student.name,
        groupId: student.group_id,
        groupName: student.group_name ?? null,
        type: 'low_performance',
        severity: 'warning',
        title: `الطالب ${student.name} يحتاج متابعة تعليمية`,
        description: `انخفاض مستمر في المستوى — المتوسط الأخير ${trend.recentAvg}%.`,
        meta: { recentAvg: trend.recentAvg, previousAvg: trend.previousAvg },
      });
    }

  }

  void todayStr;
  return items.sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });
}

export type AbsentSessionDetail = {
  sessionId: string;
  sessionTitle: string;
  sessionNumber: number | null;
  sessionDate: string;
  status: string;
  groupName: string;
};

export async function fetchAbsentSessions(studentId: string): Promise<AbsentSessionDetail[]> {
  const mStart = monthStart();
  const mEnd = nextMonthStart();
  const { data: attendance } = await supabase
    .from('attendance')
    .select('id, session_id, status, attendance_date, group_id')
    .eq('student_id', studentId)
    .neq('status', 'unrecorded')
    .gte('attendance_date', mStart)
    .lt('attendance_date', mEnd)
    .order('attendance_date', { ascending: false })
    .limit(20);

  const records = (attendance ?? []) as { id: string; session_id: string | null; status: string; attendance_date: string; group_id: string }[];
  const absentRecords = records.filter((r) => ABSENT_STATUSES.has(r.status));
  if (absentRecords.length === 0) return [];

  const sessionIds = absentRecords.map((r) => r.session_id).filter(Boolean) as string[];
  const groupIds = [...new Set(absentRecords.map((r) => r.group_id))];

  const [sessionsRes, groupsRes] = await Promise.all([
    sessionIds.length > 0
      ? supabase.from('sessions').select('id, title, session_number, session_date').in('id', sessionIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('groups').select('id, name').in('id', groupIds),
  ]);

  const sessionMap = new Map((sessionsRes.data ?? []).map((s: { id: string; title: string; session_number: number | null; session_date: string }) => [s.id, s]));
  const groupMap = new Map((groupsRes.data ?? []).map((g: { id: string; name: string }) => [g.id, g.name]));

  const result: AbsentSessionDetail[] = [];
  for (const r of absentRecords) {
    const session = r.session_id ? sessionMap.get(r.session_id) : null;
    result.push({
      sessionId: r.session_id ?? '',
      sessionTitle: session?.title ?? 'حصة',
      sessionNumber: session?.session_number ?? null,
      sessionDate: r.attendance_date,
      status: r.status,
      groupName: groupMap.get(r.group_id) ?? '',
    });
  }
  return result;
}

export function getActivityBadge(level: ActivityLevel): { label: string; color: string; dot: string } {
  switch (level) {
    case 'active':
      return { label: 'نشط', color: 'text-emerald-400', dot: 'bg-emerald-400' };
    case 'low_attendance':
      return { label: 'قليل الحضور', color: 'text-amber-400', dot: 'bg-amber-400' };
    case 'inactive':
      return { label: 'غير نشط', color: 'text-red-400', dot: 'bg-red-400' };
  }
}

export const DEFAULT_PARENT_REPORT_MESSAGE = `ولي الأمر الكريم،

نود مشاركتكم ملاحظة بسيطة بخصوص مستوى الطالب [اسم الطالب].
خلال الفترة الأخيرة يحتاج الطالب إلى مزيد من المتابعة والاهتمام ببعض جوانب التحصيل الدراسي، ونسعى معكم لدعمه وتحسين مستواه خلال الفترة القادمة.
بالتعاون والمتابعة المستمرة بإذن الله يستطيع الطالب تحقيق تقدم أفضل.
شكرًا لاهتمامكم ودعمكم الدائم.`;
