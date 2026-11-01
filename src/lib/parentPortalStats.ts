import type {
  AttendanceRecord,
  BehaviorEval,
  CenterExam,
  CenterGrade,
  Homework,
  HomeworkStatus,
  OnlineExam,
  OnlineGrade,
} from '@/lib/types';

export interface MonthlyRecords {
  attendance: AttendanceRecord[];
  centerGrades: CenterGrade[];
  centerExams: CenterExam[];
  onlineGrades: OnlineGrade[];
  onlineExams: OnlineExam[];
  behavior: BehaviorEval[];
  homework: Homework[];
  homeworkStatuses: HomeworkStatus[];
}

export interface MonthStats {
  monthKey: string;
  attendance: {
    total: number;
    present: number;
    absent: number;
    excused: number;
    late: number;
    rate: number | null;
    absenceRate: number | null;
  };
  homework: { total: number; done: number; incomplete: number; rate: number | null };
  exams: { count: number; average: number | null };
  behavior: { rated: number; positive: number; warnings: number; rate: number | null };
}

const DONE_HOMEWORK_STATUSES = ['done', 'complete', 'completed'];
const POSITIVE_BEHAVIOR = ['excellent', 'participatory'];
const WARNING_BEHAVIOR = ['needs_attention', 'disruptive'];

export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export function previousMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function computeMonthStats(records: MonthlyRecords, monthKey: string): MonthStats {
  const attendance = records.attendance.filter((a) => a.attendance_date.slice(0, 7) === monthKey);
  const present = attendance.filter((a) => a.status === 'present').length;
  const absent = attendance.filter((a) => a.status === 'absent').length;
  const excused = attendance.filter((a) => ['excused', 'excused_absence'].includes(a.status)).length;
  const late = attendance.filter((a) => a.status === 'late').length;

  const monthHomework = records.homework.filter((h) => h.due_date && h.due_date.slice(0, 7) === monthKey);
  const homeworkIds = new Set(monthHomework.map((h) => h.id));
  const monthStatuses = records.homeworkStatuses.filter((s) => homeworkIds.has(s.homework_id));
  const hwDone = monthStatuses.filter((s) => DONE_HOMEWORK_STATUSES.includes(s.status)).length;

  const examPercents: number[] = [];
  for (const grade of records.centerGrades) {
    const exam = records.centerExams.find((e) => e.id === grade.center_exam_id);
    if (exam && exam.max_score > 0 && exam.exam_date?.slice(0, 7) === monthKey) {
      examPercents.push((grade.score / exam.max_score) * 100);
    }
  }
  for (const grade of records.onlineGrades) {
    const exam = records.onlineExams.find((e) => e.id === grade.exam_id);
    const when = exam?.open_at ?? exam?.created_at;
    if (grade.max_score > 0 && when?.slice(0, 7) === monthKey) {
      examPercents.push((grade.score / grade.max_score) * 100);
    }
  }

  const rated = records.behavior.filter((b) => b.rating && b.eval_date?.slice(0, 7) === monthKey);
  const positive = rated.filter((b) => POSITIVE_BEHAVIOR.includes(b.rating ?? '')).length;
  const warnings = rated.filter((b) => WARNING_BEHAVIOR.includes(b.rating ?? '')).length;

  return {
    monthKey,
    attendance: {
      total: attendance.length,
      present,
      absent,
      excused,
      late,
      rate: percentOf(present, attendance.length),
      absenceRate: percentOf(absent, attendance.length),
    },
    homework: {
      total: monthStatuses.length,
      done: hwDone,
      incomplete: monthStatuses.length - hwDone,
      rate: percentOf(hwDone, monthStatuses.length),
    },
    exams: {
      count: examPercents.length,
      average: examPercents.length > 0 ? Math.round(examPercents.reduce((a, b) => a + b, 0) / examPercents.length) : null,
    },
    behavior: {
      rated: rated.length,
      positive,
      warnings,
      rate: percentOf(positive, rated.length),
    },
  };
}
