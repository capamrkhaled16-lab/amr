import { supabase } from '@/lib/supabase';
import type { Student, AttendanceRecord, HomeworkStatus, BehaviorEval } from '@/lib/types';

export type IncompleteItem = {
  type: 'attendance' | 'homework' | 'behavior';
  label: string;
};

export type IncompleteStudent = {
  student: Student;
  missing: IncompleteItem[];
};

export type CompletionCheckResult = {
  incomplete: IncompleteStudent[];
  totalStudents: number;
  checkedAt: string;
};

export async function checkDailyCompletion(
  groupId: string,
  students: Student[],
  todayDate: string
): Promise<CompletionCheckResult> {
  if (students.length === 0) {
    return { incomplete: [], totalStudents: 0, checkedAt: new Date().toISOString() };
  }

  const studentIds = students.map((s) => s.id);

  const [attRes, hwRes, behRes, homeworkRes] = await Promise.all([
    supabase
      .from('attendance')
      .select('student_id, status')
      .eq('group_id', groupId)
      .eq('attendance_date', todayDate)
      .in('student_id', studentIds),
    supabase
      .from('homework_status')
      .select('student_id, status, homework_id')
      .in('student_id', studentIds),
    supabase
      .from('behavior_eval')
      .select('student_id, eval_date')
      .eq('group_id', groupId)
      .eq('eval_date', todayDate)
      .in('student_id', studentIds),
    supabase
      .from('homework')
      .select('id, is_closed')
      .eq('group_id', groupId)
      .eq('due_date', todayDate)
      .eq('is_closed', false),
  ]);

  if (attRes.error || hwRes.error || behRes.error || homeworkRes.error) {
    throw new Error('Unable to check daily completion');
  }

  const attendanceRecords = (attRes.data as Pick<AttendanceRecord, 'student_id' | 'status'>[]) ?? [];
  const hwStatuses = (hwRes.data as Pick<HomeworkStatus, 'student_id' | 'status' | 'homework_id'>[]) ?? [];
  const behaviorEvals = (behRes.data as Pick<BehaviorEval, 'student_id' | 'eval_date'>[]) ?? [];
  const openHomework = (homeworkRes.data as { id: string; is_closed: boolean }[]) ?? [];

  const attendanceMap = new Map<string, string>();
  for (const a of attendanceRecords) {
    if (a.status && a.status !== 'unrecorded') {
      attendanceMap.set(a.student_id, a.status);
    }
  }

  const ABSENT_STATUSES = new Set(['absent', 'excused_absence']);

  const behaviorSet = new Set<string>();
  for (const b of behaviorEvals) {
    behaviorSet.add(b.student_id);
  }

  const openHomeworkIds = new Set(openHomework.map((h) => h.id));
  const hwRecordedStudents = new Set<string>();
  for (const hw of hwStatuses) {
    if (openHomeworkIds.has(hw.homework_id)) {
      hwRecordedStudents.add(hw.student_id);
    }
  }

  const hasOpenHomework = openHomeworkIds.size > 0;

  const incomplete: IncompleteStudent[] = [];

  for (const student of students) {
    const missing: IncompleteItem[] = [];

    if (!attendanceMap.has(student.id)) {
      missing.push({ type: 'attendance', label: 'الحضور' });
    }

    const isAbsent = ABSENT_STATUSES.has(attendanceMap.get(student.id) ?? '');

    if (hasOpenHomework && !hwRecordedStudents.has(student.id) && !isAbsent) {
      missing.push({ type: 'homework', label: 'الواجب' });
    }

    if (!behaviorSet.has(student.id) && !isAbsent) {
      missing.push({ type: 'behavior', label: 'السلوك' });
    }

    if (missing.length > 0) {
      incomplete.push({ student, missing });
    }
  }

  return {
    incomplete,
    totalStudents: students.length,
    checkedAt: new Date().toISOString(),
  };
}
