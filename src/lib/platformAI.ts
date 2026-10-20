/**
 * Platform AI — NLU engine for "اسأل المنصة"
 * Read-only conversational intelligence layer over the platform database.
 * No mutations. All data comes from Supabase via targeted queries.
 */

import { supabase } from './supabase';
import { ARABIC_MONTHS } from './constants';
import type { Student } from './types';
import { calcStudentAverages, type RawGrade } from './gradeCalc';

// ============================================================
// TYPES
// ============================================================

export type Intent =
  | 'student_count'
  | 'list_students'
  | 'attendance_absent'
  | 'attendance_most_absent'
  | 'attendance_recent'
  | 'grades_weak'
  | 'grades_strong'
  | 'grades_declining'
  | 'grades_improving'
  | 'grades_below_threshold'
  | 'grades_list'
  | 'payment_owes'
  | 'payment_not_paid'
  | 'payment_partial'
  | 'payment_total_remaining'
  | 'payment_total_collected'
  | 'payment_who_paid'
  | 'cross_absent_and_weak'
  | 'cross_absent_and_no_homework'
  | 'cross_owes_and_absent'
  | 'student_search'
  | 'group_count'
  | 'needs_followup'
  | 'exam_not_taken'
  | 'unknown';

export type EntityMap = {
  monthKey?: string | null;
  monthLabel?: string;
  groupId?: string | null;
  groupName?: string;
  gradeId?: string | null;
  gradeName?: string;
  stageName?: string;
  studentName?: string;
  subject?: string;
  threshold?: number;
  count?: number;
  examTitle?: string;
};

export type AIResult = {
  answer: string;
  records: AIRecord[];
  summary: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  intent: Intent;
  entities: EntityMap;
};

export type AIRecord = {
  student_id?: string;
  student_name?: string;
  group_name?: string;
  stage_name?: string;
  grade_name?: string;
  amount?: number;
  date?: string;
  status?: string;
  score?: number;
  max_score?: number;
  details?: string;
  reasons?: string[];
};

export type ConversationContext = {
  lastIntent?: Intent;
  lastEntities?: EntityMap;
  lastStudentIds?: string[];
  lastAnswer?: string;
};

// ============================================================
// MONTH / DATE UTILITIES
// ============================================================

const MONTH_NAME_MAP: Record<string, number> = {
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4,
  'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8,
  'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
};

function extractMonthKey(q: string): { monthKey: string; label: string } | null {
  const currentYear = new Date().getFullYear();
  for (const [name, num] of Object.entries(MONTH_NAME_MAP)) {
    if (q.includes(name)) {
      const mk = `${currentYear}-${String(num).padStart(2, '0')}`;
      return { monthKey: mk, label: name };
    }
  }
  const numMatch = q.match(/شهر\s*(\d{1,2})/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    if (num >= 1 && num <= 12) {
      const mk = `${currentYear}-${String(num).padStart(2, '0')}`;
      return { monthKey: mk, label: ARABIC_MONTHS[num - 1] ?? mk };
    }
  }
  // "الشهر ده" / "الشهر الحالي"
  if (q.includes('الشهر ده') || q.includes('الشهر الحالي') || q.includes('الشهر ده')) {
    const now = new Date();
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { monthKey: mk, label: ARABIC_MONTHS[now.getMonth()] ?? mk };
  }
  // "الشهر اللي فات"
  if (q.includes('الشهر اللي فات') || q.includes('الشهر الماضي')) {
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { monthKey: mk, label: ARABIC_MONTHS[now.getMonth()] ?? mk };
  }
  return null;
}

// ============================================================
// ACCOUNTING ACCESS BLOCK
// The Assistant must NEVER access Accounting data (accounting_cycles,
// month_closures, expenses, audit_logs). These are separate from
// Archive/Payments which the Assistant IS allowed to read.
// ============================================================

const ACCOUNTING_KEYWORDS = [
  'محاسبة', 'محاسب', 'دورة محاسبية', 'دورات محاسبية', 'إغلاق شهر', 'اغلاق شهر',
  'إغلاق محاسبي', 'اغلاق محاسبي', 'مصاريف إدارية', 'مصروفات', 'مصروف',
  'تدقيق', 'مراجعة محاسبية', 'audit', 'accounting', 'closure',
  'accounting_cycle', 'month_closure', 'expense', 'expenses',
];

function isAccountingQuestion(q: string): boolean {
  return ACCOUNTING_KEYWORDS.some((kw) => q.includes(kw));
}

// ============================================================
// INTENT DETECTION
// ============================================================

function detectIntent(q: string): Intent {
  // Cross-module patterns — check first (more specific)
  if ((q.includes('غاب') || q.includes('غياب') || q.includes('غايب')) &&
      (q.includes('درجات') || q.includes('ضعيف') || q.includes('ضعافة') || q.includes('مستوى') || q.includes('ضعف'))) return 'cross_absent_and_weak';
  if ((q.includes('غاب') || q.includes('غياب') || q.includes('غايب')) &&
      (q.includes('واجب') || q.includes('تسليم') || q.includes('مش بيسلم') || q.includes('لم يسلم'))) return 'cross_absent_and_no_homework';
  if ((q.includes('فلوس') || q.includes('عليه') || q.includes('مديون') || q.includes('لم يدفع') || q.includes('باقي')) &&
      (q.includes('غاب') || q.includes('غياب') || q.includes('حضور') || q.includes('مش بيحضر'))) return 'cross_owes_and_absent';

  // Needs followup / متابعة
  if (q.includes('متابعة') || q.includes('محتاج') || q.includes('خطر') || q.includes('تدخل')) return 'needs_followup';

  // Exam
  if ((q.includes('امتحان') || q.includes('امتحانات')) && (q.includes('لم يدخل') || q.includes('ما خشش') || q.includes('مش دخل') || q.includes('لم يؤد'))) return 'exam_not_taken';

  // Attendance
  if ((q.includes('اكتر') || q.includes('أكتر') || q.includes('أكثر') || q.includes('اكثر')) &&
      (q.includes('غياب') || q.includes('غاب') || q.includes('غايب') || q.includes('حضور'))) return 'attendance_most_absent';
  if (q.includes('الحصة اللي فاتت') || q.includes('اخر حصة') || q.includes('آخر حصة') || q.includes('امبارح') || q.includes('اليوم')) return 'attendance_recent';
  if (q.includes('غاب') || q.includes('غياب') || q.includes('غايب') || q.includes('غائب') || q.includes('حضور')) return 'attendance_absent';

  // Grades
  if ((q.includes('اتحسن') || q.includes('تحسن') || q.includes('اتطور') || q.includes('تطور') || q.includes('نزل') === false && q.includes('ارتفع'))) return 'grades_improving';
  if (q.includes('نزلت') || q.includes('نزل') || q.includes('قل') || q.includes('انخفض') || q.includes('تراجع')) return 'grades_declining';
  if (q.includes('اقل من') || q.includes('أقل من') || q.includes('ضعيف') || q.includes('ضعافة') || q.includes('وحش') || q.includes('ضعف') || q.includes('متأخر') || q.includes('دون')) return 'grades_weak';
  if (q.includes('اقوى') || q.includes('أقوى') || q.includes('ممتاز') || q.includes('متفوق') || q.includes('الأوائل') || q.includes('اوائل') || q.includes('أعلى') || q.includes('اعلى') || q.includes('الأفضل') || q.includes('افضل') || q.includes('أفضل')) return 'grades_strong';
  if (q.includes('درجات') || q.includes('درجة')) return 'grades_list';

  // Payment
  if ((q.includes('اجمالي المتبقي') || q.includes('إجمالي المتبقي') || q.includes('المتبقي') || q.includes('الباقي') || q.includes('المتبقى')) && !q.includes('مين')) return 'payment_total_remaining';
  if ((q.includes('محصل') || q.includes('تحصيل') || q.includes('اجمالي المدفوع') || q.includes('إجمالي المدفوع') || q.includes('المدفوع') || q.includes('اللي اتدفع'))) return 'payment_total_collected';
  if (q.includes('جزء') || q.includes('جزئي') || q.includes('دفع جزء')) return 'payment_partial';
  if (q.includes('دفع') && !q.includes('لم يدفع') && (q.includes('مين دفع') || q.includes('اللي دفع') || q.includes('مسدد'))) return 'payment_who_paid';
  if (q.includes('لم يدفع') || q.includes('مش دفع') || q.includes('عليه فلوس') || q.includes('عليه') || q.includes('مديون') || q.includes('فلوس') || q.includes('باقي') || q.includes('متبقي') || q.includes('متأخرات') || q.includes('مستحقات')) return 'payment_owes';

  // Student count
  if (q.includes('كام طالب') || q.includes('عدد الطلاب') || q.includes('كم طالب') || q.includes('كام واحد') || q.includes('عدد')) return 'student_count';

  // List students
  if (q.includes('عرض') || q.includes('اعرض') || q.includes('عرضلي') || q.includes('هاتلي') || q.includes('مين الطلاب') || q.includes('الطلاب اللي') || q.includes('الطلاب في')) return 'list_students';

  // Group count per group
  if (q.includes('كام طالب في كل مجموعة') || q.includes('عدد كل مجموعة')) return 'group_count';

  // Student search by name (fallback)
  return 'unknown';
}

// ============================================================
// ENTITY EXTRACTION
// ============================================================

function extractEntities(
  q: string,
  groups: { id: string; name: string }[],
  grades: { id: string; name: string }[],
  stages: { id: string; name: string }[],
  context?: ConversationContext
): EntityMap {
  const entities: EntityMap = {};

  // Month
  const month = extractMonthKey(q);
  if (month) {
    entities.monthKey = month.monthKey;
    entities.monthLabel = month.label;
  } else if (context?.lastEntities?.monthKey && (q.includes('نفس الشهر') || q.includes('الشهر ده'))) {
    entities.monthKey = context.lastEntities.monthKey;
    entities.monthLabel = context.lastEntities.monthLabel;
  }

  // Group
  for (const g of groups) {
    if (q.includes(g.name.toLowerCase()) || q.includes(g.name)) {
      entities.groupId = g.id;
      entities.groupName = g.name;
      break;
    }
  }
  if (!entities.groupId) {
    const groupMatch = q.match(/مجموعة\s*(\d+)/);
    if (groupMatch) {
      const idx = parseInt(groupMatch[1], 10) - 1;
      if (idx >= 0 && idx < groups.length) {
        entities.groupId = groups[idx].id;
        entities.groupName = groups[idx].name;
      }
    }
  }
  // Context: "المجموعة 2" after asking about a grade
  if (!entities.groupId && context?.lastEntities?.groupId && q.includes('المجموعة')) {
    const groupMatch = q.match(/المجموعة\s*(\d+)/);
    if (groupMatch) {
      const idx = parseInt(groupMatch[1], 10) - 1;
      if (idx >= 0 && idx < groups.length) {
        entities.groupId = groups[idx].id;
        entities.groupName = groups[idx].name;
      }
    }
  }

  // Grade / Stage
  for (const g of grades) {
    if (q.includes(g.name) || q.includes(g.name.toLowerCase())) {
      entities.gradeId = g.id;
      entities.gradeName = g.name;
      break;
    }
  }
  for (const s of stages) {
    if (q.includes(s.name) || q.includes(s.name.toLowerCase())) {
      entities.stageName = s.name;
      break;
    }
  }

  // Threshold (e.g., "أقل من 50" or "أقل من 50%")
  const thresholdMatch = q.match(/(?:اقل من|أقل من|تحت|دون)\s*(\d+(?:\.\d+)?)/);
  if (thresholdMatch) {
    entities.threshold = parseFloat(thresholdMatch[1]);
  }

  // Count (e.g., "أقل 5 طلاب")
  const countMatch = q.match(/(?:اقل|أقل|اخر|آخر|أكتر|اكتر|أكثر|اكثر)\s*(\d+)/);
  if (countMatch) {
    entities.count = parseInt(countMatch[1], 10);
  }

  // Subject
  const subjectPatterns = ['في الرياضيات', 'في العلوم', 'في العربية', 'في الانجليزي', 'في الإنجليزي', 'في التاريخ', 'في الجغرافيا', 'في الفيزياء', 'في الكيمياء', 'في الأحياء'];
  for (const sp of subjectPatterns) {
    if (q.includes(sp)) {
      entities.subject = sp.replace('في ', '').trim();
      break;
    }
  }

  return entities;
}

// ============================================================
// CONTEXT RESOLUTION
// ============================================================

function resolveWithContext(
  intent: Intent,
  entities: EntityMap,
  q: string,
  context: ConversationContext | undefined
): { intent: Intent; entities: EntityMap; studentIdsFromContext?: string[] } {
  if (!context) return { intent, entities };

  // "منهم" / "ديل" / "دول" — refers to previous student list
  const refersToPrevious = q.includes('منهم') || q.includes('دول') || q.includes('ديل') || q.includes('بتوعهم');

  if (refersToPrevious && context.lastStudentIds && context.lastStudentIds.length > 0) {
    // Carry over context entities if not overridden
    const merged: EntityMap = {
      ...context.lastEntities,
      ...entities,
    };
    // If no month in current but had one before, keep it
    if (!entities.monthKey && context.lastEntities?.monthKey) {
      merged.monthKey = context.lastEntities.monthKey;
      merged.monthLabel = context.lastEntities.monthLabel;
    }
    return { intent, entities: merged, studentIdsFromContext: context.lastStudentIds };
  }

  // "المجموعة 2" after a grade-level question — narrow down
  if (entities.groupId && !entities.gradeId && context.lastEntities?.gradeId) {
    return {
      intent,
      entities: { ...context.lastEntities, ...entities },
    };
  }

  // Carry month from context if the question implies same time period
  if (!entities.monthKey && context.lastEntities?.monthKey && (q.includes('في نفس الوقت') || q.includes('نفس الفترة'))) {
    return {
      intent,
      entities: { ...entities, monthKey: context.lastEntities.monthKey, monthLabel: context.lastEntities.monthLabel },
    };
  }

  return { intent, entities };
}

// ============================================================
// DATA HELPERS
// ============================================================

type GroupInfo = { id: string; name: string; grade_level_id: string };
type GradeInfo = { id: string; name: string; stage_id: string };
type StageInfo = { id: string; name: string };
type StudentWithMeta = Student & { group_name?: string; grade_name?: string; stage_name?: string };

async function loadPlatformData() {
  // ONLY current active students — not deleted, not left, not archived
  // This is the authoritative student directory. Counts must derive from here alone.
  const [studentsRes, groupsRes, gradesRes, stagesRes] = await Promise.all([
    supabase.from('students').select('*').eq('is_deleted', false).eq('status', 'active'),
    supabase.from('groups').select('id, name, grade_level_id'),
    supabase.from('grade_levels').select('id, name, stage_id'),
    supabase.from('academic_stages').select('id, name'),
  ]);

  const rawStudents = (studentsRes.data ?? []) as Student[];
  const groups = (groupsRes.data ?? []) as GroupInfo[];
  const grades = (gradesRes.data ?? []) as GradeInfo[];
  const stages = (stagesRes.data ?? []) as StageInfo[];

  // Build lookup maps
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const gradeMap = new Map(grades.map((g) => [g.id, g]));
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  // Deduplicate by Student ID — a student appearing twice still counts as ONE
  const seenIds = new Set<string>();
  const deduped: Student[] = [];
  for (const s of rawStudents) {
    if (!s.id || seenIds.has(s.id)) continue;
    seenIds.add(s.id);
    deduped.push(s);
  }

  // Enrich students with group/grade/stage names
  const enriched: StudentWithMeta[] = deduped.map((s) => {
    const grp = groupMap.get(s.group_id ?? '');
    const grade = grp ? gradeMap.get(grp.grade_level_id) : undefined;
    const stage = grade ? stageMap.get(grade.stage_id) : undefined;
    return {
      ...s,
      group_name: grp?.name,
      grade_name: grade?.name,
      stage_name: stage?.name,
    };
  });

  return { students: enriched, groups, grades, stages, groupMap, gradeMap, stageMap };
}

function filterStudentsByEntities(students: StudentWithMeta[], entities: EntityMap, contextStudentIds?: string[]): StudentWithMeta[] {
  let filtered = students;

  if (contextStudentIds) {
    const idSet = new Set(contextStudentIds);
    filtered = filtered.filter((s) => idSet.has(s.id));
  }

  if (entities.groupId) {
    filtered = filtered.filter((s) => s.group_id === entities.groupId);
  }
  if (entities.gradeId && entities.gradeName) {
    filtered = filtered.filter((s) => s.grade_name === entities.gradeName);
  }
  if (entities.stageName) {
    filtered = filtered.filter((s) => s.stage_name === entities.stageName);
  }

  // Always deduplicate by ID as a final safety net
  const seen = new Set<string>();
  filtered = filtered.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return filtered;
}

// ============================================================
// INTENT HANDLERS
// ============================================================

async function handleStudentCount(students: StudentWithMeta[], entities: EntityMap): Promise<AIResult> {
  // Students are already deduped and filtered to active-only in loadPlatformData.
  // filterStudentsByEntities also deduplicates by ID as a safety net.
  const filtered = filterStudentsByEntities(students, entities);

  // Cross-check: verify the count is consistent with the authoritative student directory
  const uniqueIds = new Set(filtered.map((s) => s.id));
  const verifiedCount = uniqueIds.size;

  const scope = entities.groupName ? ` في ${entities.groupName}` : entities.gradeName ? ` في ${entities.gradeName}` : entities.stageName ? ` في ${entities.stageName}` : '';

  // Sanity check: if filtered.length !== verifiedCount, there's a data integrity issue
  if (filtered.length !== verifiedCount) {
    return {
      answer: `لقيت تعارض في بيانات الطلاب، لذلك مش هديك رقم غير مؤكد. العدد الموجود في سجل الطلاب الحالي هو ${verifiedCount} طالب${scope}.`,
      records: [],
      summary: 'تم الحساب من الطلاب الحاليين فقط، بدون المحذوفين أو السجلات المكررة.',
      intent: 'student_count',
      entities,
    };
  }

  return {
    answer: `عندك ${verifiedCount} طالب${scope}`,
    records: [],
    summary: 'تم الحساب من الطلاب الحاليين فقط، بدون المحذوفين أو السجلات المكررة.',
    intent: 'student_count',
    entities,
  };
}

async function handleListStudents(students: StudentWithMeta[], entities: EntityMap, contextStudentIds?: string[]): Promise<AIResult> {
  const filtered = filterStudentsByEntities(students, entities, contextStudentIds);
  const scope = entities.groupName ? ` في ${entities.groupName}` : entities.gradeName ? ` في ${entities.gradeName}` : '';
  if (filtered.length === 0) {
    return {
      answer: `مفيش طلاب${scope}`,
      records: [],
      summary: '',
      intent: 'list_students',
      entities,
    };
  }
  return {
    answer: `${filtered.length} طالب${scope}`,
    records: filtered.map((s) => ({
      student_id: s.id,
      student_name: s.name,
      group_name: s.group_name ?? '',
      stage_name: s.stage_name ?? '',
      grade_name: s.grade_name ?? '',
      details: `المجموعة: ${s.group_name ?? '—'} | الصف: ${s.grade_name ?? '—'}`,
    })),
    summary: '',
    intent: 'list_students',
    entities,
  };
}

async function handleGroupCount(students: StudentWithMeta[], groups: GroupInfo[]): Promise<AIResult> {
  // Count UNIQUE active student IDs per group — never from attendance/payments/etc.
  const countedIds = new Set<string>();
  const counts = new Map<string, number>();
  for (const g of groups) {
    counts.set(g.name, 0);
  }
  for (const s of students) {
    if (!s.id || countedIds.has(s.id)) continue; // dedup by student ID
    if (s.group_id) {
      const g = groups.find((gg) => gg.id === s.group_id);
      if (g) {
        counts.set(g.name, (counts.get(g.name) ?? 0) + 1);
        countedIds.add(s.id);
      }
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const totalUnique = [...counts.values()].reduce((a, b) => a + b, 0);
  return {
    answer: `توزيع الطلاب على المجموعات:`,
    records: sorted.map(([name, count]) => ({
      group_name: name,
      details: `${count} طالب`,
    })),
    summary: `إجمالي ${totalUnique} طالب نشط في ${groups.length} مجموعة`,
    intent: 'group_count',
    entities: {},
  };
}

async function handleAttendanceAbsent(
  students: StudentWithMeta[],
  entities: EntityMap,
  groupMap: Map<string, GroupInfo>,
  contextStudentIds?: string[]
): Promise<AIResult> {
  let attQuery = supabase.from('attendance').select('id, student_id, status, attendance_date, group_id');
  if (entities.monthKey) {
    attQuery = attQuery.gte('attendance_date', `${entities.monthKey}-01`).lte('attendance_date', `${entities.monthKey}-31`);
  }
  const { data } = await attQuery;
  const records = (data ?? []) as { id: string; student_id: string; status: string; attendance_date: string; group_id: string | null }[];

  const excusedOnly = (entities.monthLabel === '' && false) || false; // keep for future
  let filtered = records.filter((a) => a.status === 'absent' || a.status === 'excused_absence');

  // Filter by group
  let scopeStudents = filterStudentsByEntities(students, entities, contextStudentIds);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));
  filtered = filtered.filter((a) => studentIdSet.has(a.student_id));

  // Deduplicate by student (count absences per student)
  const absenceByStudent = new Map<string, { count: number; lastDate: string; statuses: Set<string> }>();
  for (const a of filtered) {
    const existing = absenceByStudent.get(a.student_id);
    if (existing) {
      existing.count++;
      if (a.attendance_date > existing.lastDate) existing.lastDate = a.attendance_date;
      existing.statuses.add(a.status);
    } else {
      absenceByStudent.set(a.student_id, { count: 1, lastDate: a.attendance_date, statuses: new Set([a.status]) });
    }
  }

  const monthDesc = entities.monthKey ? ` في ${entities.monthLabel}` : '';
  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  const absentStudents = [...absenceByStudent.entries()].map(([sid, info]) => {
    const st = students.find((s) => s.id === sid);
    return {
      student_id: sid,
      student_name: st?.name ?? 'غير معروف',
      group_name: st?.group_name ?? groupMap.get(st?.group_id ?? '')?.name ?? '',
      date: info.lastDate,
      status: `غاب ${info.count} مرة`,
      details: `آخر غياب: ${info.lastDate} | عدد الغيابات: ${info.count}`,
    };
  });

  return {
    answer: absentStudents.length > 0
      ? `${absentStudents.length} طالب غابوا${monthDesc}${scope}`
      : `مفيش طلاب غابوا${monthDesc}${scope}`,
    records: absentStudents.sort((a, b) => parseInt(b.status.match(/\d+/)?.[0] ?? '0') - parseInt(a.status.match(/\d+/)?.[0] ?? '0')),
    summary: `إجمالي سجلات الغياب${monthDesc}: ${filtered.length}`,
    intent: 'attendance_absent',
    entities,
  };
}

async function handleMostAbsent(
  students: StudentWithMeta[],
  entities: EntityMap,
  groupMap: Map<string, GroupInfo>,
): Promise<AIResult> {
  const { data } = await supabase.from('attendance').select('student_id, status, attendance_date');
  const records = (data ?? []) as { student_id: string; status: string; attendance_date: string }[];
  const absences = records.filter((a) => a.status === 'absent' || a.status === 'excused_absence');

  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));

  const countByStudent = new Map<string, number>();
  for (const a of absences) {
    if (!studentIdSet.has(a.student_id)) continue;
    countByStudent.set(a.student_id, (countByStudent.get(a.student_id) ?? 0) + 1);
  }

  const sorted = [...countByStudent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, entities.count ?? 10);

  const topAbsent = sorted.map(([sid, count]) => {
    const st = students.find((s) => s.id === sid);
    return {
      student_id: sid,
      student_name: st?.name ?? 'غير معروف',
      group_name: st?.group_name ?? '',
      status: `${count} مرة غياب`,
      details: `عدد مرات الغياب: ${count}`,
    };
  });

  const scope = entities.groupName ? ` في ${entities.groupName}` : entities.gradeName ? ` في ${entities.gradeName}` : '';
  return {
    answer: topAbsent.length > 0
      ? `أكثر ${topAbsent.length} طلاب غياباً${scope}`
      : `مفيش بيانات غياب${scope}`,
    records: topAbsent,
    summary: '',
    intent: 'attendance_most_absent',
    entities,
  };
}

async function handleRecentAbsent(
  students: StudentWithMeta[],
  entities: EntityMap,
  groupMap: Map<string, GroupInfo>,
): Promise<AIResult> {
  // Get the most recent session date
  const { data: latestAtt } = await supabase
    .from('attendance')
    .select('attendance_date')
    .order('attendance_date', { ascending: false })
    .limit(1);

  if (!latestAtt || latestAtt.length === 0) {
    return {
      answer: 'مفيش حصة مسجلة في المنصة.',
      records: [],
      summary: '',
      intent: 'attendance_recent',
      entities,
    };
  }

  const latestDate = latestAtt[0].attendance_date;
  const { data } = await supabase
    .from('attendance')
    .select('student_id, status, attendance_date, group_id')
    .eq('attendance_date', latestDate);

  const records = (data ?? []) as { student_id: string; status: string; attendance_date: string; group_id: string | null }[];
  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));
  const absent = records.filter((a) => (a.status === 'absent' || a.status === 'excused_absence') && studentIdSet.has(a.student_id));

  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  return {
    answer: absent.length > 0
      ? `${absent.length} طالب غاب في الحصة الأخيرة (${latestDate})${scope}`
      : `مفيش غياب في الحصة الأخيرة (${latestDate})${scope}`,
    records: absent.map((a) => {
      const st = students.find((s) => s.id === a.student_id);
      return {
        student_id: a.student_id,
        student_name: st?.name ?? 'غير معروف',
        group_name: st?.group_name ?? '',
        date: a.attendance_date,
        status: a.status === 'excused_absence' ? 'غائب بعذر' : 'غائب',
      };
    }),
    summary: `تاريخ الحصة: ${latestDate}`,
    intent: 'attendance_recent',
    entities,
  };
}

async function handleGradesWeak(
  students: StudentWithMeta[],
  entities: EntityMap,
  groupMap: Map<string, GroupInfo>,
): Promise<AIResult> {
  const { data: gradesData } = await supabase
    .from('center_grades')
    .select('student_id, score, center_exam_id');
  const grades = (gradesData ?? []) as { student_id: string; score: number; center_exam_id: string }[];

  const { data: examsData } = await supabase.from('center_exams').select('id, max_score, title');
  const examMap = new Map((examsData ?? []).map((e: { id: string; max_score: number; title: string }) => [e.id, e]));

  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));

  const rawGrades: RawGrade[] = grades
    .filter((g) => studentIdSet.has(g.student_id))
    .map((g) => ({
      student_id: g.student_id,
      score: g.score,
      max_score: examMap.get(g.center_exam_id)?.max_score ?? 100,
      center_exam_id: g.center_exam_id,
    }));

  const studentAverages = calcStudentAverages(rawGrades);

  const threshold = entities.threshold ?? 50;
  const weakStudents = [...studentAverages.entries()]
    .filter(([, info]) => info.avgPercent < threshold)
    .sort(([, a], [, b]) => a.avgPercent - b.avgPercent);

  const scope = entities.groupName ? ` في ${entities.groupName}` : entities.gradeName ? ` في ${entities.gradeName}` : '';
  const records: AIRecord[] = weakStudents.map(([sid, info]) => {
    const st = students.find((s) => s.id === sid);
    return {
      student_id: sid,
      student_name: st?.name ?? 'غير معروف',
      group_name: st?.group_name ?? '',
      score: Math.round(info.avgPercent),
      details: `متوسط الدرجات: ${Math.round(info.avgPercent)}% | عدد الامتحانات: ${info.count}`,
      reasons: [`متوسط ${Math.round(info.avgPercent)}%`, `${info.count} امتحان`],
    };
  });

  return {
    answer: records.length > 0
      ? `${records.length} طالب مستواهم أقل من ${threshold}%${scope}`
      : `مفيش طلاب مستواهم أقل من ${threshold}%${scope}`,
    records,
    summary: records.length > 0 ? `أقل طالب: ${records[0].student_name} (${records[0].score}%)` : '',
    intent: 'grades_weak',
    entities,
  };
}

async function handleGradesStrong(
  students: StudentWithMeta[],
  entities: EntityMap,
): Promise<AIResult> {
  const { data: gradesData } = await supabase.from('center_grades').select('student_id, score, center_exam_id');
  const grades = (gradesData ?? []) as { student_id: string; score: number; center_exam_id: string }[];
  const { data: examsData } = await supabase.from('center_exams').select('id, max_score');
  const examMap = new Map((examsData ?? []).map((e: { id: string; max_score: number }) => [e.id, e]));

  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));

  const rawGrades: RawGrade[] = grades
    .filter((g) => studentIdSet.has(g.student_id))
    .map((g) => ({
      student_id: g.student_id,
      score: g.score,
      max_score: examMap.get(g.center_exam_id)?.max_score ?? 100,
      center_exam_id: g.center_exam_id,
    }));

  const studentAverages = calcStudentAverages(rawGrades);

  const topN = entities.count ?? 5;
  const strong = [...studentAverages.entries()]
    .sort(([, a], [, b]) => b.avgPercent - a.avgPercent)
    .slice(0, topN);

  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  return {
    answer: `أعلى ${strong.length} طلاب في الدرجات${scope}`,
    records: strong.map(([sid, info]) => {
      const st = students.find((s) => s.id === sid);
      return {
        student_id: sid,
        student_name: st?.name ?? 'غير معروف',
        group_name: st?.group_name ?? '',
        score: Math.round(info.avgPercent),
        details: `متوسط الدرجات: ${Math.round(info.avgPercent)}% | عدد الامتحانات: ${info.count}`,
      };
    }),
    summary: '',
    intent: 'grades_strong',
    entities,
  };
}

async function handlePaymentOwes(
  students: StudentWithMeta[],
  entities: EntityMap,
): Promise<AIResult> {
  if (!entities.monthKey) {
    return {
      answer: 'تقصد أي شهر؟ اذكر الشهر مثل: "مين عليه فلوس شهر سبتمبر؟"',
      records: [],
      summary: '',
      needsClarification: true,
      clarificationQuestion: 'أي شهر تقصد؟',
      intent: 'payment_owes',
      entities,
    };
  }

  const { data: subsRes } = await supabase
    .from('monthly_subscriptions')
    .select('student_id, amount_due, amount_paid, status')
    .eq('month_key', entities.monthKey);
  const subs = (subsRes ?? []) as { student_id: string; amount_due: number; amount_paid: number; status: string }[];
  const subByStudent = new Map(subs.map((s) => [s.student_id, s]));

  const scopeStudents = filterStudentsByEntities(students, entities);
  const debtors = scopeStudents.filter((s) => {
    if (s.is_exempt) return false;
    const sub = subByStudent.get(s.id);
    if (!sub) return true; // no subscription = owes full
    return sub.amount_paid < sub.amount_due;
  }).map((s) => {
    const sub = subByStudent.get(s.id);
    const due = sub?.amount_due ?? s.total_fees ?? 0;
    const paid = sub?.amount_paid ?? 0;
    const remaining = due - paid;
    return {
      student_id: s.id,
      student_name: s.name,
      group_name: s.group_name ?? '',
      amount: remaining,
      details: `رسوم الشهر: ${due} ج.م | المدفوع: ${paid} ج.م | المتبقي: ${remaining} ج.م | ${paid === 0 ? 'لم يدفع' : 'دفع جزئي'}`,
    };
  });

  const totalRemaining = debtors.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  return {
    answer: debtors.length > 0
      ? `${debtors.length} طالب عليه فلوس شهر ${entities.monthLabel}${scope}`
      : `جميع الطلاب سددوا شهر ${entities.monthLabel}${scope} بالكامل`,
    records: debtors,
    summary: `إجمالي المتبقي لشهر ${entities.monthLabel}: ${totalRemaining} ج.م`,
    intent: 'payment_owes',
    entities,
  };
}

async function handlePaymentTotalRemaining(
  students: StudentWithMeta[],
  entities: EntityMap,
): Promise<AIResult> {
  if (!entities.monthKey) {
    return {
      answer: 'تقصد إجمالي المتبقي لأي شهر؟',
      records: [],
      summary: '',
      needsClarification: true,
      clarificationQuestion: 'أي شهر تقصد؟',
      intent: 'payment_total_remaining',
      entities,
    };
  }

  const { data: subsRes } = await supabase
    .from('monthly_subscriptions')
    .select('student_id, amount_due, amount_paid')
    .eq('month_key', entities.monthKey);
  const subs = (subsRes ?? []) as { student_id: string; amount_due: number; amount_paid: number }[];

  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));

  let totalDue = 0;
  let totalPaid = 0;
  for (const sub of subs) {
    if (!studentIdSet.has(sub.student_id)) continue;
    totalDue += sub.amount_due;
    totalPaid += sub.amount_paid;
  }
  // Students with no subscription row
  const subStudentIds = new Set(subs.map((s) => s.student_id));
  for (const s of scopeStudents) {
    if (s.is_exempt) continue;
    if (!subStudentIds.has(s.id)) {
      totalDue += s.total_fees ?? 0;
    }
  }

  const remaining = totalDue - totalPaid;
  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  return {
    answer: `إجمالي المتبقي شهر ${entities.monthLabel}${scope}: ${remaining} ج.م`,
    records: [],
    summary: `الإجمالي المطلوب: ${totalDue} ج.م | المدفوع: ${totalPaid} ج.م | المتبقي: ${remaining} ج.م`,
    intent: 'payment_total_remaining',
    entities,
  };
}

async function handlePaymentTotalCollected(
  students: StudentWithMeta[],
  entities: EntityMap,
): Promise<AIResult> {
  let payQuery = supabase.from('payments').select('student_id, amount, payment_date').eq('is_deleted', false).eq('is_historical_payment', false).gt('amount', 0);
  if (entities.monthKey) payQuery = payQuery.eq('month_key', entities.monthKey);
  const { data } = await payQuery;
  const payments = (data ?? []) as { student_id: string; amount: number; payment_date: string }[];

  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));
  const filtered = payments.filter((p) => studentIdSet.has(p.student_id));
  const total = filtered.reduce((s, p) => s + p.amount, 0);

  const monthDesc = entities.monthKey ? ` في ${entities.monthLabel}` : '';
  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  return {
    answer: `إجمالي المحصل${monthDesc}${scope}: ${total} ج.م`,
    records: [],
    summary: `عدد الدفعات: ${filtered.length}`,
    intent: 'payment_total_collected',
    entities,
  };
}

async function handleNeedsFollowup(
  students: StudentWithMeta[],
  entities: EntityMap,
): Promise<AIResult> {
  const [gradesRes, attRes, hwRes, examsRes] = await Promise.all([
    supabase.from('center_grades').select('student_id, score, center_exam_id'),
    supabase.from('attendance').select('student_id, status').eq('status', 'absent'),
    supabase.from('homework_status').select('student_id, status').in('status', ['not_submitted', 'late']),
    supabase.from('center_exams').select('id, max_score'),
  ]);

  const grades = (gradesRes.data ?? []) as { student_id: string; score: number; center_exam_id: string }[];
  const absences = (attRes.data ?? []) as { student_id: string }[];
  const hwMissing = (hwRes.data ?? []) as { student_id: string }[];
  const examMap = new Map((examsRes.data ?? []).map((e: { id: string; max_score: number }) => [e.id, e]));

  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));

  const rawGrades: RawGrade[] = grades
    .filter((g) => studentIdSet.has(g.student_id))
    .map((g) => ({
      student_id: g.student_id,
      score: g.score,
      max_score: examMap.get(g.center_exam_id)?.max_score ?? 100,
      center_exam_id: g.center_exam_id,
    }));
  const studentAverages = calcStudentAverages(rawGrades);

  const absenceCount = new Map<string, number>();
  for (const a of absences) {
    if (!studentIdSet.has(a.student_id)) continue;
    absenceCount.set(a.student_id, (absenceCount.get(a.student_id) ?? 0) + 1);
  }

  const hwCount = new Map<string, number>();
  for (const h of hwMissing) {
    if (!studentIdSet.has(h.student_id)) continue;
    hwCount.set(h.student_id, (hwCount.get(h.student_id) ?? 0) + 1);
  }

  const candidates: AIRecord[] = [];
  for (const s of scopeStudents) {
    const reasons: string[] = [];
    const gradeInfo = studentAverages.get(s.id);
    if (gradeInfo && gradeInfo.avgPercent < 50) {
      reasons.push(`متوسط الدرجات ${Math.round(gradeInfo.avgPercent)}%`);
    }
    const abs = absenceCount.get(s.id) ?? 0;
    if (abs >= 3) reasons.push(`غياب ${abs} مرات`);
    const hw = hwCount.get(s.id) ?? 0;
    if (hw >= 2) reasons.push(`${hw} واجب غير مسلم`);

    if (reasons.length >= 2) {
      candidates.push({
        student_id: s.id,
        student_name: s.name,
        group_name: s.group_name ?? '',
        details: reasons.join(' + '),
        reasons,
      });
    }
  }

  candidates.sort((a, b) => (b.reasons?.length ?? 0) - (a.reasons?.length ?? 0));

  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  return {
    answer: candidates.length > 0
      ? `${candidates.length} طالب محتاجين متابعة${scope}`
      : `مفيش طلاب محتاجين متابعة عاجلة${scope}`,
    records: candidates.slice(0, 20),
    summary: candidates.length > 0 ? 'مرتبين حسب عدد العوامل' : '',
    intent: 'needs_followup',
    entities,
  };
}

async function handleCrossAbsentAndWeak(
  students: StudentWithMeta[],
  entities: EntityMap,
): Promise<AIResult> {
  const [attRes, gradesRes, examsRes] = await Promise.all([
    supabase.from('attendance').select('student_id, status').eq('status', 'absent'),
    supabase.from('center_grades').select('student_id, score, center_exam_id'),
    supabase.from('center_exams').select('id, max_score'),
  ]);

  const absences = (attRes.data ?? []) as { student_id: string }[];
  const grades = (gradesRes.data ?? []) as { student_id: string; score: number; center_exam_id: string }[];
  const examMap = new Map((examsRes.data ?? []).map((e: { id: string; max_score: number }) => [e.id, e]));

  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));

  const absenceCount = new Map<string, number>();
  for (const a of absences) {
    if (!studentIdSet.has(a.student_id)) continue;
    absenceCount.set(a.student_id, (absenceCount.get(a.student_id) ?? 0) + 1);
  }

  const rawGrades: RawGrade[] = grades
    .filter((g) => studentIdSet.has(g.student_id))
    .map((g) => ({
      student_id: g.student_id,
      score: g.score,
      max_score: examMap.get(g.center_exam_id)?.max_score ?? 100,
      center_exam_id: g.center_exam_id,
    }));
  const studentAverages = calcStudentAverages(rawGrades);

  const results: AIRecord[] = [];
  for (const s of scopeStudents) {
    const abs = absenceCount.get(s.id) ?? 0;
    const gradeInfo = studentAverages.get(s.id);
    if (abs > 0 && gradeInfo && gradeInfo.avgPercent < 50) {
      results.push({
        student_id: s.id,
        student_name: s.name,
        group_name: s.group_name ?? '',
        score: Math.round(gradeInfo.avgPercent),
        details: `متوسط ${Math.round(gradeInfo.avgPercent)}% + غياب ${abs} مرات`,
        reasons: [`متوسط ${Math.round(gradeInfo.avgPercent)}%`, `غياب ${abs} مرات`],
      });
    }
  }

  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  return {
    answer: results.length > 0
      ? `${results.length} طالب غابوا ومستواهم ضعيف${scope}`
      : `مفيش طلاب يجمعون بين الغياب وضعف المستوى${scope}`,
    records: results,
    summary: '',
    intent: 'cross_absent_and_weak',
    entities,
  };
}

async function handleCrossAbsentAndNoHomework(
  students: StudentWithMeta[],
  entities: EntityMap,
): Promise<AIResult> {
  const [attRes, hwRes] = await Promise.all([
    supabase.from('attendance').select('student_id, status').eq('status', 'absent'),
    supabase.from('homework_status').select('student_id, status').in('status', ['not_submitted', 'late']),
  ]);

  const absences = (attRes.data ?? []) as { student_id: string }[];
  const hwMissing = (hwRes.data ?? []) as { student_id: string }[];

  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));

  const absentIds = new Set(absences.filter((a) => studentIdSet.has(a.student_id)).map((a) => a.student_id));
  const hwIds = new Set(hwMissing.filter((h) => studentIdSet.has(h.student_id)).map((h) => h.student_id));

  const both = [...absentIds].filter((id) => hwIds.has(id));

  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  return {
    answer: both.length > 0
      ? `${both.length} طالب غابوا ومش بيسلموا الواجب${scope}`
      : `مفيش طلاب يجمعون بين الغياب وعدم تسليم الواجب${scope}`,
    records: both.map((id) => {
      const st = students.find((s) => s.id === id);
      return {
        student_id: id,
        student_name: st?.name ?? 'غير معروف',
        group_name: st?.group_name ?? '',
        details: 'غياب + واجب غير مسلم',
      };
    }),
    summary: '',
    intent: 'cross_absent_and_no_homework',
    entities,
  };
}

async function handleCrossOwesAndAbsent(
  students: StudentWithMeta[],
  entities: EntityMap,
): Promise<AIResult> {
  if (!entities.monthKey) {
    return {
      answer: 'تقصد أي شهر للفلوس؟',
      records: [],
      summary: '',
      needsClarification: true,
      clarificationQuestion: 'أي شهر تقصد؟',
      intent: 'cross_owes_and_absent',
      entities,
    };
  }

  const [subsRes, attRes] = await Promise.all([
    supabase.from('monthly_subscriptions').select('student_id, amount_due, amount_paid').eq('month_key', entities.monthKey),
    supabase.from('attendance').select('student_id, status').eq('status', 'absent'),
  ]);

  const subs = (subsRes.data ?? []) as { student_id: string; amount_due: number; amount_paid: number }[];
  const absences = (attRes.data ?? []) as { student_id: string }[];

  const scopeStudents = filterStudentsByEntities(students, entities);
  const studentIdSet = new Set(scopeStudents.map((s) => s.id));

  const debtors = new Set(subs.filter((sub) => {
    if (!studentIdSet.has(sub.student_id)) return false;
    return sub.amount_paid < sub.amount_due;
  }).map((s) => s.student_id));

  const absentIds = new Set(absences.filter((a) => studentIdSet.has(a.student_id)).map((a) => a.student_id));
  const both = [...debtors].filter((id) => absentIds.has(id));

  return {
    answer: both.length > 0
      ? `${both.length} طالب عليه فلوس شهر ${entities.monthLabel} وغايب`
      : `مفيش طلاب يجمعون بين المديونية والغياب`,
    records: both.map((id) => {
      const st = students.find((s) => s.id === id);
      const sub = subs.find((su) => su.student_id === id);
      return {
        student_id: id,
        student_name: st?.name ?? 'غير معروف',
        group_name: st?.group_name ?? '',
        amount: sub ? sub.amount_due - sub.amount_paid : 0,
        details: `متبقي ${sub ? sub.amount_due - sub.amount_paid : 0} ج.م + غياب مسجل`,
      };
    }),
    summary: '',
    intent: 'cross_owes_and_absent',
    entities,
  };
}

async function handleExamNotTaken(
  students: StudentWithMeta[],
  entities: EntityMap,
): Promise<AIResult> {
  // Find online exams, then check submissions
  let examQuery = supabase.from('exams').select('id, title, is_published').eq('is_published', true);
  if (entities.monthKey) {
    examQuery = examQuery.gte('created_at', `${entities.monthKey}-01`).lte('created_at', `${entities.monthKey}-31`);
  }
  const { data: examsData } = await examQuery;
  const exams = (examsData ?? []) as { id: string; title: string }[];

  if (exams.length === 0) {
    return {
      answer: 'مفيش امتحانات منشورة' + (entities.monthKey ? ` في ${entities.monthLabel}` : ''),
      records: [],
      summary: '',
      intent: 'exam_not_taken',
      entities,
    };
  }

  const { data: subData } = await supabase.from('exam_submissions').select('exam_id, student_id');
  const submissions = (subData ?? []) as { exam_id: string; student_id: string }[];

  const scopeStudents = filterStudentsByEntities(students, entities);
  const submittedByStudent = new Set(submissions.map((s) => s.student_id));
  const notTaken = scopeStudents.filter((s) => !submittedByStudent.has(s.id));

  const scope = entities.groupName ? ` في ${entities.groupName}` : '';
  return {
    answer: notTaken.length > 0
      ? `${notTaken.length} طالب لم يدخل امتحان${entities.monthKey ? ` ${entities.monthLabel}` : ''}${scope}`
      : `كل الطلاب دخلوا الامتحان${scope}`,
    records: notTaken.slice(0, 30).map((s) => ({
      student_id: s.id,
      student_name: s.name,
      group_name: s.group_name ?? '',
      details: 'لم يسجل أي محاولة امتحان',
    })),
    summary: `إجمالي الامتحانات المنشورة: ${exams.length}`,
    intent: 'exam_not_taken',
    entities,
  };
}

async function handleStudentSearch(
  students: StudentWithMeta[],
  q: string,
  entities: EntityMap,
): Promise<AIResult> {
  // Try to find student by first name
  for (const s of students) {
    const firstName = s.name.split(' ')[0].toLowerCase();
    if (q.includes(firstName) || q.includes(s.name.toLowerCase())) {
      const remaining = (s.total_fees ?? 0) - (s.paid_fees ?? 0);
      return {
        answer: `${s.name} — ${s.stage_name ?? ''} / ${s.grade_name ?? ''} / ${s.group_name ?? 'غير محدد'}`,
        records: [{
          student_id: s.id,
          student_name: s.name,
          group_name: s.group_name ?? '',
          stage_name: s.stage_name ?? '',
          grade_name: s.grade_name ?? '',
          amount: remaining,
          details: `المتبقي: ${remaining} ج.م | ${s.is_exempt ? 'معفي' : 'يدفع رسوم'} | حالة: ${s.status}`,
        }],
        summary: `الحالة: ${s.is_exempt ? 'معفي من الرسوم' : 'يدفع رسوم'}`,
        intent: 'student_search',
        entities,
      };
    }
  }

  return {
    answer: 'لم أتمكن من فهم السؤال. جرّب صياغة مثل: "مين غاب في الحصة اللي فاتت؟" أو "مين مستواه ضعيف؟" أو "مين عليه فلوس شهر سبتمبر؟" أو "عندي كام طالب في سادسة ابتدائي؟"',
    records: [],
    summary: '',
    intent: 'unknown',
    entities,
  };
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export async function askPlatformAI(
  question: string,
  context?: ConversationContext
): Promise<AIResult> {
  const q = question.trim().toLowerCase();

  if (!q) {
    return {
      answer: 'اكتب سؤالاً للبدء.',
      records: [],
      summary: '',
      intent: 'unknown',
      entities: {},
    };
  }

  // Block accounting questions before any data access
  if (isAccountingQuestion(q)) {
    return {
      answer: 'المحاسبة مش متاحة في المساعد. المحاسبة بيانات إدارية منفصلة عن المدفوعات والأرشيف.',
      records: [],
      summary: '',
      intent: 'unknown',
      entities: {},
    };
  }

  // Load platform data
  const { students, groups, grades, stages, groupMap } = await loadPlatformData();

  // Detect intent
  let intent = detectIntent(q);

  // Extract entities
  let entities = extractEntities(q, groups, grades, stages, context);

  // Resolve with context
  const resolved = resolveWithContext(intent, entities, q, context);
  intent = resolved.intent;
  entities = resolved.entities;
  const contextStudentIds = resolved.studentIdsFromContext;

  // Dispatch to handler
  switch (intent) {
    case 'student_count':
      return handleStudentCount(students, entities);
    case 'list_students':
      return handleListStudents(students, entities, contextStudentIds);
    case 'group_count':
      return handleGroupCount(students, groups);
    case 'attendance_absent':
      return handleAttendanceAbsent(students, entities, groupMap, contextStudentIds);
    case 'attendance_most_absent':
      return handleMostAbsent(students, entities, groupMap);
    case 'attendance_recent':
      return handleRecentAbsent(students, entities, groupMap);
    case 'grades_weak':
      return handleGradesWeak(students, entities, groupMap);
    case 'grades_strong':
      return handleGradesStrong(students, entities);
    case 'grades_list':
      return handleGradesWeak(students, { ...entities, threshold: 100 }, groupMap);
    case 'grades_declining':
      return handleGradesWeak(students, { ...entities, threshold: 50 }, groupMap);
    case 'grades_improving':
      return handleGradesStrong(students, entities);
    case 'grades_below_threshold':
      return handleGradesWeak(students, entities, groupMap);
    case 'payment_owes':
      return handlePaymentOwes(students, entities);
    case 'payment_not_paid':
      return handlePaymentOwes(students, entities);
    case 'payment_partial':
      return handlePaymentOwes(students, { ...entities, threshold: 0 });
    case 'payment_total_remaining':
      return handlePaymentTotalRemaining(students, entities);
    case 'payment_total_collected':
      return handlePaymentTotalCollected(students, entities);
    case 'payment_who_paid':
      return handlePaymentTotalCollected(students, entities);
    case 'cross_absent_and_weak':
      return handleCrossAbsentAndWeak(students, entities);
    case 'cross_absent_and_no_homework':
      return handleCrossAbsentAndNoHomework(students, entities);
    case 'cross_owes_and_absent':
      return handleCrossOwesAndAbsent(students, entities);
    case 'needs_followup':
      return handleNeedsFollowup(students, entities);
    case 'exam_not_taken':
      return handleExamNotTaken(students, entities);
    case 'student_search':
      return handleStudentSearch(students, q, entities);
    default:
      return handleStudentSearch(students, q, entities);
  }
}
