export type StudentAnalyticsInput = {
  present: number;
  absent: number;
  excused?: number;
  late?: number;
  makeup?: number;
  grades: { score: number; maxScore: number }[];
  homework: { status: string }[];
};

export type StudentAnalytics = {
  attendanceRate: number;
  gradeRate: number;
  homeworkRate: number | null;
  overallPercentage: number;
  motivationalMessage: string;
  motivationalTone: 'excellent' | 'good' | 'average' | 'needs_improvement';
};

export function computeStudentAnalytics(input: StudentAnalyticsInput): StudentAnalytics {
  // present already includes late and makeup counts from the caller,
  // so totalAttendance must not add them again — that would double-count.
  const totalAttendance = input.present + input.absent + (input.excused ?? 0);
  const attendanceRate = totalAttendance > 0
    ? Math.round(((input.present + (input.makeup ?? 0)) / totalAttendance) * 1000) / 10
    : 0;

  const validGrades = input.grades.filter((g) => g.maxScore > 0);
  const gradeRate = validGrades.length > 0
    ? Math.round(validGrades.reduce((sum, g) => sum + (g.score / g.maxScore) * 100, 0) / validGrades.length * 10) / 10
    : 0;
  // Uses the same formula as the centralized gradeCalc engine: each score
  // normalized to its own max, then averaged. Never mixes max_score with score.

  const validHw = input.homework.filter((h) => h.status && h.status !== 'unrecorded' && h.status !== 'absent' && h.status !== 'excused');
  const hasHomeworkData = validHw.length > 0;
  // Weighted: complete/done/completed=1.0, late/incomplete=0.5 (partial credit),
  // not_done=0 (only truly not-submitted gets zero)
  const hwCredits = validHw.reduce((sum, h) => {
    if (h.status === 'done' || h.status === 'complete' || h.status === 'completed') return sum + 1.0;
    if (h.status === 'late' || h.status === 'incomplete') return sum + 0.5;
    return sum;
  }, 0);
  const homeworkRate = hasHomeworkData
    ? Math.round((hwCredits / validHw.length) * 1000) / 10
    : null;

  // When no homework data exists, redistribute the 20% homework weight
  // to the remaining components: attendance 30→37.5%, grades 50→62.5%.
  const overallPercentage = hasHomeworkData
    ? Math.round((attendanceRate * 0.3 + gradeRate * 0.5 + (homeworkRate as number) * 0.2) * 10) / 10
    : Math.round((attendanceRate * 0.375 + gradeRate * 0.625) * 10) / 10;

  let motivationalMessage: string;
  let motivationalTone: StudentAnalytics['motivationalTone'];

  if (overallPercentage >= 90) {
    motivationalTone = 'excellent';
    motivationalMessage = 'أداء رائع ومتميز! نرجو الاستمرار في الحصول على أعلى الدرجات والثبات على هذا المستوى الراقي.';
  } else if (overallPercentage >= 75) {
    motivationalTone = 'good';
    motivationalMessage = 'أداء جيد جداً! استمر في الاجتهاد والتفوق، أنت على الطريق الصحيح نحو القمة.';
  } else if (overallPercentage >= 60) {
    motivationalTone = 'average';
    motivationalMessage = 'أداء مقبول، لكن يحتاج إلى مزيد من الاهتمام والمثابرة للوصول إلى مستوى أفضل.';
  } else {
    motivationalTone = 'needs_improvement';
    motivationalMessage = 'منتظرين أحسن الشهر القادم! يحتاج الطالب إلى مزيد من المتابعة والتركيز لتحسين المستوى.';
  }

  return {
    attendanceRate,
    gradeRate,
    homeworkRate,
    overallPercentage,
    motivationalMessage,
    motivationalTone,
  };
}
