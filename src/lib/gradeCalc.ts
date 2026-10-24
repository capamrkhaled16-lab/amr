/**
 * Centralized Grade Calculation Engine
 *
 * Single source of truth for all grade average calculations across the platform.
 * Every module (Grades, Exams, Certificates, Dashboard, AskPlatform, etc.) must
 * use these functions — never reimplement its own average formula.
 *
 * Rules enforced:
 * - Maximum Grade ≠ Student Score ≠ Average Score ≠ Total Score
 * - Average = SUM(valid scores) / COUNT(valid scores)
 * - Never uses max_grade as a student score
 * - Never returns an individual student's score as the average
 * - Deduplicates by Student ID
 * - Excludes deleted/inactive students
 * - Excludes empty/non-numeric values
 * - Attendance absence does NOT auto-convert to zero
 */

// ============================================================
// TYPES
// ============================================================

export type RawGrade = {
  student_id: string;
  score: number;
  max_score: number;
  center_exam_id?: string;
  session_id?: string | null;
};

export type GradePercent = {
  student_id: string;
  percent: number;
  raw_score: number;
  max_score: number;
  session_id?: string | null;
};

export type GradeAverageResult = {
  averagePercent: number;
  averageScore: number;
  totalScore: number;
  count: number;
  maxScore: number;
};

export type GroupAverageResult = {
  averagePercent: number;
  averageScore: number;
  totalScore: number;
  studentCount: number;
  maxScore: number;
};

// ============================================================
// CORE: Normalize a single grade to percentage
// ============================================================

export function scoreToPercent(score: number, maxScore: number): number {
  if (!maxScore || maxScore <= 0) return 0;
  return (score / maxScore) * 100;
}

// ============================================================
// CORE: Deduplicate grades by Student ID
// ============================================================

export function deduplicateGrades(grades: RawGrade[]): RawGrade[] {
  const seen = new Set<string>();
  const result: RawGrade[] = [];
  for (const g of grades) {
    const key = `${g.student_id}:${g.center_exam_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(g);
  }
  return result;
}

// ============================================================
// CORE: Filter to valid numeric scores only
// ============================================================

export function filterValidGrades(grades: RawGrade[]): RawGrade[] {
  return grades.filter((g) =>
    typeof g.score === 'number' &&
    typeof g.max_score === 'number' &&
    !isNaN(g.score) &&
    !isNaN(g.max_score) &&
    g.max_score > 0
  );
}

// ============================================================
// CORE: Convert raw grades to percentages
// ============================================================

export function toPercentages(grades: RawGrade[]): GradePercent[] {
  return grades.map((g) => ({
    student_id: g.student_id,
    percent: scoreToPercent(g.score, g.max_score),
    raw_score: g.score,
    max_score: g.max_score,
    session_id: g.session_id ?? null,
  }));
}

// ============================================================
// MAIN: Calculate average for a single assessment (exam/sheet/etc.)
// ============================================================

export function calcExamAverage(grades: RawGrade[]): GradeAverageResult {
  const valid = filterValidGrades(deduplicateGrades(grades));
  const count = valid.length;
  if (count === 0) {
    return { averagePercent: 0, averageScore: 0, totalScore: 0, count: 0, maxScore: 0 };
  }
  const totalScore = valid.reduce((sum, g) => sum + g.score, 0);
  const maxScore = valid[0].max_score;
  const averageScore = totalScore / count;
  const averagePercent = scoreToPercent(averageScore, maxScore);
  return {
    averagePercent: Math.round(averagePercent * 100) / 100,
    averageScore: Math.round(averageScore * 100) / 100,
    totalScore: Math.round(totalScore * 100) / 100,
    count,
    maxScore,
  };
}

// ============================================================
// MAIN: Calculate average across multiple assessments for a group
// Normalizes each score to its own max, then averages the percentages.
// ============================================================

export function calcGroupAverage(grades: RawGrade[]): GroupAverageResult {
  const valid = filterValidGrades(deduplicateGrades(grades));
  const count = valid.length;
  if (count === 0) {
    return { averagePercent: 0, averageScore: 0, totalScore: 0, studentCount: 0, maxScore: 0 };
  }
  const percents = toPercentages(valid);
  const totalScore = valid.reduce((sum, g) => sum + g.score, 0);
  const averagePercent = percents.reduce((sum, p) => sum + p.percent, 0) / count;
  const uniqueStudents = new Set(valid.map((g) => g.student_id)).size;
  return {
    averagePercent: Math.round(averagePercent * 100) / 100,
    averageScore: Math.round((totalScore / count) * 100) / 100,
    totalScore: Math.round(totalScore * 100) / 100,
    studentCount: uniqueStudents,
    maxScore: 100,
  };
}

// ============================================================
// MAIN: Calculate per-student average across multiple assessments
// Returns a map of student_id → average percentage
// ============================================================

export function calcStudentAverages(grades: RawGrade[]): Map<string, { avgPercent: number; count: number; scores: number[] }> {
  const valid = filterValidGrades(deduplicateGrades(grades));
  const byStudent = new Map<string, { scores: number[]; maxes: number[] }>();
  for (const g of valid) {
    const entry = byStudent.get(g.student_id);
    if (entry) {
      entry.scores.push(g.score);
      entry.maxes.push(g.max_score);
    } else {
      byStudent.set(g.student_id, { scores: [g.score], maxes: [g.max_score] });
    }
  }
  const result = new Map<string, { avgPercent: number; count: number; scores: number[] }>();
  for (const [studentId, data] of byStudent) {
    const percents = data.scores.map((s, i) => scoreToPercent(s, data.maxes[i]));
    const avgPercent = percents.reduce((sum, p) => sum + p, 0) / percents.length;
    result.set(studentId, {
      avgPercent: Math.round(avgPercent * 100) / 100,
      count: data.scores.length,
      scores: data.scores,
    });
  }
  return result;
}

// ============================================================
// MAIN: Calculate grade/stage average across all groups
// Must be SUM(all valid scores) / COUNT(all valid scores), NOT average of group averages
// ============================================================

export function calcGradeLevelAverage(grades: RawGrade[]): GradeAverageResult {
  const valid = filterValidGrades(deduplicateGrades(grades));
  const count = valid.length;
  if (count === 0) {
    return { averagePercent: 0, averageScore: 0, totalScore: 0, count: 0, maxScore: 0 };
  }
  const percents = toPercentages(valid);
  const totalScore = valid.reduce((sum, g) => sum + g.score, 0);
  const averagePercent = percents.reduce((sum, p) => sum + p.percent, 0) / count;
  return {
    averagePercent: Math.round(averagePercent * 100) / 100,
    averageScore: Math.round((totalScore / count) * 100) / 100,
    totalScore: Math.round(totalScore * 100) / 100,
    count,
    maxScore: 100,
  };
}

// ============================================================
// ATTENDANCE: Check if a student was absent for a session
// Returns the attendance status if absent, null otherwise
// ============================================================

export type AttendanceLookup = Map<string, string>;

export function buildAttendanceLookup(
  attendanceRecords: { student_id: string; session_id: string | null; status: string }[]
): AttendanceLookup {
  const map = new Map<string, string>();
  for (const a of attendanceRecords) {
    if (!a.session_id) continue;
    const key = `${a.student_id}:${a.session_id}`;
    if (a.status === 'absent' || a.status === 'excused_absence') {
      map.set(key, a.status);
    }
  }
  return map;
}

export function getAbsenceStatus(
  lookup: AttendanceLookup,
  studentId: string,
  sessionId: string | null | undefined
): string | null {
  if (!sessionId) return null;
  return lookup.get(`${studentId}:${sessionId}`) ?? null;
}

// ============================================================
// VALIDATION: Cross-check a computed average
// ============================================================

export function validateAverage(result: GradeAverageResult): { valid: boolean; warning?: string } {
  if (result.count === 0) {
    return { valid: true, warning: 'لا توجد درجات مسجلة' };
  }
  if (result.averagePercent < 0 || result.averagePercent > 100) {
    return { valid: false, warning: 'النسبة خارج النطاق المسموح — قد تكون البيانات غير متسقة' };
  }
  if (result.maxScore <= 0) {
    return { valid: false, warning: 'الدرجة العظمى غير محددة — لا يمكن احتساب النسبة' };
  }
  return { valid: true };
}
