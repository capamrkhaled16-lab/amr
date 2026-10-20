import { useCallback, useEffect } from 'react';
import { useNotifications, type NotificationActionTarget, type NotificationCategory } from '@/context/NotificationContext';
import { supabase } from '@/lib/supabase';

type MissingDataOptions = {
  onNavigate: (groupId: string, groupName: string, tab: 'attendance' | 'tracking' | 'grades') => void;
};

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type SessionRow = { id: string; title: string; group_id: string; session_date: string };
type ExamRow = { id: string; title: string; category: string; exam_date: string; group_id: string; session_id: string | null };
type HomeworkRow = { id: string; title: string; due_date: string; group_id: string; session_id: string | null };
type GroupRow = { id: string; name: string; schedule: string | null };
type StudentRow = { id: string; name: string; group_id: string; enrollment_date?: string; created_at?: string };
type AttendanceRow = { student_id: string; status: string; session_id: string | null; group_id: string; attendance_date: string };

const ABSENT_STATUSES = new Set(['absent', 'excused_absence']);

const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function isGroupScheduledOn(schedule: string | null, dateStr: string): boolean {
  if (!schedule || !schedule.trim()) return true;
  const dayName = ARABIC_DAYS[new Date(dateStr).getDay()];
  return schedule.includes(dayName);
}

export function useMissingDataDetector({ onNavigate: _onNavigate }: MissingDataOptions) {
  const { pushWarning, dismissByDismissKey, isDismissed } = useNotifications();

  const check = useCallback(async () => {
    const yesterday = yesterdayStr();

    // Only check past dates — never today, never future.
    // This approximates "post-session" since the session day has fully ended.
    const datesToCheck = [yesterday];

    try {
      const [sessionsRes, examsRes, homeworkRes, groupsRes, studentsRes] = await Promise.all([
        supabase.from('sessions')
          .select('id, title, group_id, session_date')
          .in('session_date', datesToCheck)
          .eq('is_deleted', false)
          .eq('is_archived', false),
        supabase.from('center_exams')
          .select('id, title, category, exam_date, group_id, session_id')
          .in('exam_date', datesToCheck),
        supabase.from('homework')
          .select('id, title, due_date, group_id, session_id')
          .in('due_date', datesToCheck),
        supabase.from('groups').select('id, name, schedule'),
        supabase.from('students')
          .select('id, name, group_id')
          .eq('status', 'active')
          .eq('is_deleted', false),
      ]);

      const sessions = (sessionsRes.data ?? []) as SessionRow[];
      const exams = (examsRes.data ?? []) as ExamRow[];
      const homework = (homeworkRes.data ?? []) as HomeworkRow[];
      const groups = (groupsRes.data ?? []) as GroupRow[];
      const students = (studentsRes.data ?? []) as StudentRow[];

      // Filter to groups actually scheduled on that date
      const groupScheduleMap = new Map(groups.map((g) => [g.id, g.schedule]));
      const validSessions = sessions.filter((s) => {
        const sd = s.session_date ?? yesterday;
        return isGroupScheduledOn(groupScheduleMap.get(s.group_id) ?? null, sd);
      });
      const validExams = exams.filter((e) => isGroupScheduledOn(groupScheduleMap.get(e.group_id) ?? null, e.exam_date));
      const validHomework = homework.filter((h) => isGroupScheduledOn(groupScheduleMap.get(h.group_id) ?? null, h.due_date));

      if (validSessions.length === 0 && validExams.length === 0 && validHomework.length === 0) return;

      const groupNameMap = new Map(groups.map((g) => [g.id, g.name]));
      const studentsByGroup = new Map<string, StudentRow[]>();
      for (const s of students) {
        const arr = studentsByGroup.get(s.group_id) ?? [];
        arr.push(s);
        studentsByGroup.set(s.group_id, arr);
      }

      // --- Fetch all attendance records for relevant groups ---
      const groupIds = new Set<string>();
      for (const s of validSessions) groupIds.add(s.group_id);
      for (const e of validExams) groupIds.add(e.group_id);
      for (const h of validHomework) groupIds.add(h.group_id);

      const attBatchRes = await supabase
        .from('attendance')
        .select('student_id, status, session_id, group_id, attendance_date')
        .in('group_id', [...groupIds])
        .in('attendance_date', datesToCheck);

      const allAttendance = (attBatchRes.data ?? []) as AttendanceRow[];

      const presentBySessionDate = new Set<string>();
      const presentByGroupDate = new Set<string>();
      const absentBySessionDate = new Set<string>();
      const absentByGroupDate = new Set<string>();
      const hasAttendanceForSession = new Set<string>();

      for (const a of allAttendance) {
        const aDate = a.attendance_date ?? yesterday;
        const isAbsent = ABSENT_STATUSES.has(a.status);
        const isRecorded = a.status !== 'unrecorded';

        if (isAbsent) {
          if (a.session_id) {
            absentBySessionDate.add(`${a.student_id}:${a.session_id}:${aDate}`);
          }
          absentByGroupDate.add(`${a.student_id}:${a.group_id}:${aDate}`);
        } else if (isRecorded) {
          if (a.session_id) {
            presentBySessionDate.add(`${a.student_id}:${a.session_id}:${aDate}`);
          }
          presentByGroupDate.add(`${a.student_id}:${a.group_id}:${aDate}`);
        }
        if (a.session_id && isRecorded) {
          hasAttendanceForSession.add(`${a.student_id}:${a.session_id}:${aDate}`);
        }
      }

      function isAbsentForSession(studentId: string, sessionId: string | null | undefined, checkDate: string): boolean {
        if (sessionId) return absentBySessionDate.has(`${studentId}:${sessionId}:${checkDate}`);
        return false;
      }
      function isAbsentForGroupOnDate(studentId: string, groupId: string, checkDate: string): boolean {
        return absentByGroupDate.has(`${studentId}:${groupId}:${checkDate}`);
      }
      function hasAttendedSession(studentId: string, sessionId: string, checkDate: string): boolean {
        if (hasAttendanceForSession.has(`${studentId}:${sessionId}:${checkDate}`)) return true;
        return false;
      }
      function isPresentForGroupOnDate(studentId: string, groupId: string, checkDate: string): boolean {
        if (presentByGroupDate.has(`${studentId}:${groupId}:${checkDate}`)) return true;
        return false;
      }

      // Track all seen dismiss keys so completed items get auto-dismissed
      const seenKeys = new Set<string>();

      type GroupedMissing = {
        date: string;
        category: string;
        label: string;
        items: { sessionTitle: string; groupName: string; groupId: string; count: number; names: string[]; sessionId?: string; examId?: string; homeworkId?: string }[];
      };
      const groupedByDateCategory = new Map<string, GroupedMissing>();

      function getOrCreateGroup(date: string, category: string, label: string): GroupedMissing {
        const gKey = `${category}:${date}`;
        if (!groupedByDateCategory.has(gKey)) {
          groupedByDateCategory.set(gKey, { date, category, label, items: [] });
        }
        return groupedByDateCategory.get(gKey)!;
      }

      // =================================================================
      // ATTENDANCE: collect missing students per session, group by date
      // =================================================================
      for (const session of validSessions) {
        const sd = session.session_date ?? yesterday;
        const groupStudents = studentsByGroup.get(session.group_id) ?? [];
        if (groupStudents.length === 0) continue;
        const gName = groupNameMap.get(session.group_id) ?? '';

        const missingStudents: StudentRow[] = [];
        for (const student of groupStudents) {
          const key = `attendance:${student.id}:${session.id}:${sd}`;
          seenKeys.add(key);

          if (hasAttendedSession(student.id, session.id, sd)) {
            dismissByDismissKey(key);
            continue;
          }

          if (isPresentForGroupOnDate(student.id, session.group_id, sd)) {
            dismissByDismissKey(key);
            continue;
          }

          missingStudents.push(student);
        }

        if (missingStudents.length > 0) {
          const group = getOrCreateGroup(sd, 'attendance', 'الحضور');
          group.items.push({
            sessionTitle: session.title,
            groupName: gName,
            groupId: session.group_id,
            count: missingStudents.length,
            names: missingStudents.map((s) => s.name),
            sessionId: session.id,
          });
        }
      }

      // =================================================================
      // EXAMS / RECITATION / SHEETS: collect missing, group by date+category
      // =================================================================
      for (const exam of validExams) {
        const ed = exam.exam_date;
        const groupStudents = studentsByGroup.get(exam.group_id) ?? [];
        if (groupStudents.length === 0) continue;

        const gradesRes = await supabase
          .from('center_grades')
          .select('student_id, is_absent')
          .eq('center_exam_id', exam.id)
          .eq('is_deleted', false);

        const graded = new Set((gradesRes.data ?? []).map((r) => (r as { student_id: string }).student_id));
        const gName = groupNameMap.get(exam.group_id) ?? '';
        const category = exam.category === 'recitation' ? 'recitation' : exam.category === 'sheet' ? 'sheet' : 'evaluation';
        const label = exam.category === 'recitation' ? 'التسميع' : exam.category === 'sheet' ? 'الشيت' : 'التقييم';

        const missingStudents: StudentRow[] = [];
        for (const student of groupStudents) {
          const key = `${category}:${student.id}:${exam.id}:${ed}`;
          seenKeys.add(key);

          if (graded.has(student.id)) {
            dismissByDismissKey(key);
            continue;
          }

          const absent = isAbsentForSession(student.id, exam.session_id, ed)
            || (!exam.session_id && isAbsentForGroupOnDate(student.id, exam.group_id, ed));
          if (absent) {
            dismissByDismissKey(key);
            continue;
          }

          missingStudents.push(student);
        }

        if (missingStudents.length > 0) {
          const group = getOrCreateGroup(ed, category, label);
          group.items.push({
            sessionTitle: exam.title,
            groupName: gName,
            groupId: exam.group_id,
            count: missingStudents.length,
            names: missingStudents.map((s) => s.name),
            examId: exam.id,
            sessionId: exam.session_id ?? undefined,
          });
        }
      }

      // =================================================================
      // HOMEWORK: collect missing, group by date
      // =================================================================
      for (const hw of validHomework) {
        const hd = hw.due_date;
        const groupStudents = studentsByGroup.get(hw.group_id) ?? [];
        if (groupStudents.length === 0) continue;

        const statusesRes = await supabase
          .from('homework_status')
          .select('student_id')
          .eq('homework_id', hw.id);

        const recorded = new Set((statusesRes.data ?? []).map((r) => (r as { student_id: string }).student_id));
        const gName = groupNameMap.get(hw.group_id) ?? '';

        const missingStudents: StudentRow[] = [];
        for (const student of groupStudents) {
          const key = `homework:${student.id}:${hw.id}:${hd}`;
          seenKeys.add(key);

          if (recorded.has(student.id)) {
            dismissByDismissKey(key);
            continue;
          }

          const absent = isAbsentForSession(student.id, hw.session_id, hd)
            || (!hw.session_id && isAbsentForGroupOnDate(student.id, hw.group_id, hd));
          if (absent) {
            dismissByDismissKey(key);
            continue;
          }

          missingStudents.push(student);
        }

        if (missingStudents.length > 0) {
          const group = getOrCreateGroup(hd, 'homework', 'الواجب');
          group.items.push({
            sessionTitle: hw.title,
            groupName: gName,
            groupId: hw.group_id,
            count: missingStudents.length,
            names: missingStudents.map((s) => s.name),
            homeworkId: hw.id,
            sessionId: hw.session_id ?? undefined,
          });
        }
      }

      // =================================================================
      // EMIT GROUPED NOTIFICATIONS — one per date+category
      // =================================================================
      for (const [gKey, group] of groupedByDateCategory) {
        const dismissKey = `${group.category}:date:${group.date}`;
        if (isDismissed(dismissKey)) continue;

        const totalCount = group.items.reduce((sum, it) => sum + it.count, 0);
        const firstItem = group.items[0];
        const tab: 'attendance' | 'tracking' | 'grades' =
          group.category === 'attendance' ? 'attendance'
          : group.category === 'homework' ? 'tracking'
          : 'grades';

        let message: string;
        if (group.items.length === 1) {
          const it = group.items[0];
          const names = it.names.slice(0, 3).join('، ');
          const suffix = it.count > 3 ? ` و ${it.count - 3} آخرين` : '';
          message = `${group.label} «${it.sessionTitle}» (${it.groupName}) بتاريخ ${group.date} — لم يتم تسجيله لـ${it.count} طالب: ${names}${suffix}`;
        } else {
          const sessionCount = group.items.length;
          message = `تم العثور على ${totalCount} سجل يحتاج مراجعة في ${sessionCount} حصة/نشاط بتاريخ ${group.date} (${group.label})`;
        }

        pushWarning(
          `تنبيه: ${group.label} غير مسجل`,
          message,
          {
            category: group.category as NotificationCategory,
            groupId: firstItem.groupId,
            groupName: firstItem.groupName,
            sessionDate: group.date,
            dismissKey,
            actionLabel: 'عرض التفاصيل',
            actionTarget: {
              tab,
              groupId: firstItem.groupId,
              groupName: firstItem.groupName,
              sessionId: firstItem.sessionId,
              examId: firstItem.examId,
              homeworkId: firstItem.homeworkId,
              sessionDate: group.date,
              category: group.category as NotificationCategory,
            } satisfies NotificationActionTarget,
          }
        );
      }

      // =================================================================
      // INACTIVE STUDENTS: 3+ or 5+ consecutive absences
      // =================================================================
      const allStudentIds = students.map((s) => s.id);
      if (allStudentIds.length > 0) {
        const recentAttRes = await supabase
          .from('attendance')
          .select('student_id, status, attendance_date')
          .in('student_id', allStudentIds)
          .neq('status', 'unrecorded')
          .order('attendance_date', { ascending: false })
          .limit(500);

        const recentAtt = (recentAttRes.data ?? []) as { student_id: string; status: string; attendance_date: string }[];
        const consecutiveByStudent = new Map<string, { count: number; lastDate: string | null }>();

        for (const a of recentAtt) {
          const existing = consecutiveByStudent.get(a.student_id);
          if (existing && !ABSENT_STATUSES.has(a.status)) continue;
          if (ABSENT_STATUSES.has(a.status)) {
            if (!existing) {
              consecutiveByStudent.set(a.student_id, { count: 1, lastDate: a.attendance_date });
            } else {
              existing.count++;
              consecutiveByStudent.set(a.student_id, existing);
            }
          }
        }

        for (const [sid, info] of consecutiveByStudent) {
          if (info.count < 3) continue;
          const studentRow = students.find((s) => s.id === sid);
          if (!studentRow) continue;

          // Skip new students — don't flag absences before enrollment date
          const enrollmentDate = studentRow.enrollment_date || studentRow.created_at;
          if (enrollmentDate) {
            const daysSinceEnrollment = Math.floor((Date.now() - new Date(enrollmentDate).getTime()) / 86400000);
            if (daysSinceEnrollment <= 14) continue;
          }

          const groupKey = `inactive:${sid}:${info.count >= 5 ? 'critical' : 'warning'}`;
          if (isDismissed(groupKey)) continue;

          if (info.count >= 5) {
            pushWarning(
              'طالب غير نشط',
              `الطالب ${studentRow.name} لم يسجل حضورًا منذ ${info.count} حصص — يحتاج مراجعة.`,
              {
                category: 'attendance',
                groupId: studentRow.group_id,
                groupName: groupNameMap.get(studentRow.group_id) ?? '',
                sessionDate: info.lastDate ?? yesterday,
                dismissKey: groupKey,
                actionLabel: 'عرض الطالب',
                actionTarget: {
                  tab: 'attendance',
                  groupId: studentRow.group_id,
                  groupName: groupNameMap.get(studentRow.group_id) ?? '',
                  sessionDate: info.lastDate ?? yesterday,
                  category: 'attendance',
                } satisfies NotificationActionTarget,
              }
            );
          } else if (info.count >= 3) {
            pushWarning(
              'غياب متكرر',
              `الطالب ${studentRow.name} لم يسجل حضورًا منذ ${info.count} حصص.`,
              {
                category: 'attendance',
                groupId: studentRow.group_id,
                groupName: groupNameMap.get(studentRow.group_id) ?? '',
                sessionDate: info.lastDate ?? yesterday,
                dismissKey: groupKey,
                actionLabel: 'عرض الطالب',
                actionTarget: {
                  tab: 'attendance',
                  groupId: studentRow.group_id,
                  groupName: groupNameMap.get(studentRow.group_id) ?? '',
                  sessionDate: info.lastDate ?? yesterday,
                  category: 'attendance',
                } satisfies NotificationActionTarget,
              }
            );
          }
        }

        // Auto-dismiss inactive notifications for students who are now present
        for (const [sid, info] of consecutiveByStudent) {
          if (info.count < 3) continue;
          const studentRow = students.find((s) => s.id === sid);
          if (!studentRow) continue;
          const criticalKey = `inactive:${sid}:critical`;
          const warningKey = `inactive:${sid}:warning`;
          // If the student has any non-absent record, they're no longer inactive
          const hasPresent = recentAtt.some(
            (a) => a.student_id === sid && !ABSENT_STATUSES.has(a.status)
          );
          if (hasPresent) {
            dismissByDismissKey(criticalKey);
            dismissByDismissKey(warningKey);
          }
        }
      }
    } catch {
      // Missing-data checks must never interrupt the user's work.
    }
  }, [pushWarning, dismissByDismissKey, isDismissed]);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 300000);

    const channel = supabase
      .channel('missing-data-global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => void check())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => void check())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'center_exams' }, () => void check())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'center_grades' }, () => void check())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework' }, () => void check())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework_status' }, () => void check())
      .subscribe();

    return () => {
      window.clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [check]);
}
