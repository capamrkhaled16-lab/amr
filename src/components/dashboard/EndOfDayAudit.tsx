import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, XCircle, CheckCircle, MessageCircle, ChevronDown, ChevronUp, CheckCircle2, RefreshCw, CalendarClock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { upsertAttendance } from '@/lib/data';
import { todayDateString, formatArabicDate, normalizePhoneForWhatsApp, openWhatsAppURL } from '@/lib/format';
import { ARABIC_DAYS } from '@/lib/constants';
import { useToast } from '@/components/ui/Toast';
import type { Student, Group } from '@/lib/types';

function isGroupScheduledOn(schedule: string | null, dayName: string): boolean {
  if (!schedule || !schedule.trim()) return false;
  return schedule.includes(dayName);
}

function isGroupScheduledToday(schedule: string | null): boolean {
  const todayDayName = ARABIC_DAYS[new Date().getDay()];
  return isGroupScheduledOn(schedule, todayDayName);
}

function isGroupScheduledOnDate(schedule: string | null, dateStr: string): boolean {
  const dayName = ARABIC_DAYS[new Date(dateStr).getDay()];
  return isGroupScheduledOn(schedule, dayName);
}

type UnloggedStudent = Student & { group_id: string };

type DateGroup = {
  date: string;
  isToday: boolean;
  groups: GroupedMissing[];
};

type GroupedMissing = {
  groupId: string;
  groupName: string;
  groupSchedule: string | null;
  sessionId: string | null;
  students: UnloggedStudent[];
};

export default function EndOfDayAudit({ allGroups }: { allGroups: Group[] }) {
  const { showToast } = useToast();
  const [dateGroups, setDateGroups] = useState<DateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [bannerVisible, setBannerVisible] = useState(true);

  const groupMap = new Map<string, Group>();
  for (const g of allGroups) groupMap.set(g.id, g);

  const loadMissing = useCallback(async () => {
    setLoading(true);
    try {
      const today = todayDateString();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

      const datesToCheck = [today, yesterdayStr];

      const sessionsByDate = new Map<string, Map<string, string>>();
      const groupIdsByDate = new Map<string, Set<string>>();

      for (const dateStr of datesToCheck) {
        const { data: sessionsData } = await supabase
          .from('sessions')
          .select('id, group_id')
          .eq('session_date', dateStr)
          .eq('is_deleted', false);

        const sessionMap = new Map<string, string>();
        const groupIds = new Set<string>();
        for (const s of (sessionsData ?? []) as { id: string; group_id: string }[]) {
          groupIds.add(s.group_id);
          if (!sessionMap.has(s.group_id)) sessionMap.set(s.group_id, s.id);
        }
        sessionsByDate.set(dateStr, sessionMap);
        groupIdsByDate.set(dateStr, groupIds);
      }

      if ([...groupIdsByDate.values()].every((s) => s.size === 0)) {
        setDateGroups([]);
        return;
      }

      const { data: studentsData } = await supabase
        .from('students')
        .select('id, name, group_id, parent_phone, phone, enrollment_date, created_at, status, is_deleted')
        .eq('is_deleted', false)
        .neq('status', 'left');

      if (!studentsData) return;

      const students = studentsData as Student[];

      const result: DateGroup[] = [];

      for (const dateStr of datesToCheck) {
        const groupIds = groupIdsByDate.get(dateStr) ?? new Set<string>();
        if (groupIds.size === 0) continue;

        const { data: attendanceData } = await supabase
          .from('attendance')
          .select('student_id')
          .eq('attendance_date', dateStr);

        const recordedIds = new Set((attendanceData ?? []).map((r: { student_id: string }) => r.student_id));
        const sessionMap = sessionsByDate.get(dateStr) ?? new Map<string, string>();

        const groupsForDate = new Map<string, GroupedMissing>();

        for (const s of students) {
          if (!s.group_id || !groupIds.has(s.group_id)) continue;
          if (recordedIds.has(s.id)) continue;

          const group = groupMap.get(s.group_id);
          if (!group) continue;

          if (dateStr === today && !isGroupScheduledToday(group.schedule)) continue;
          if (dateStr !== today && !isGroupScheduledOnDate(group.schedule, dateStr)) continue;

          if (!groupsForDate.has(s.group_id)) {
            groupsForDate.set(s.group_id, {
              groupId: s.group_id,
              groupName: group.name,
              groupSchedule: group.schedule,
              sessionId: sessionMap.get(s.group_id) ?? null,
              students: [],
            });
          }
          groupsForDate.get(s.group_id)!.students.push({ ...s, group_id: s.group_id });
        }

        const groups = Array.from(groupsForDate.values()).sort((a, b) => b.students.length - a.students.length);
        if (groups.length > 0) {
          result.push({ date: dateStr, isToday: dateStr === today, groups });
        }
      }

      setDateGroups(result);
    } catch {
      setDateGroups([]);
    } finally {
      setLoading(false);
    }
  }, [allGroups]);

  useEffect(() => {
    loadMissing();
  }, [loadMissing]);

  const totalMissing = dateGroups.reduce(
    (sum, dg) => sum + dg.groups.reduce((s, g) => s + g.students.filter((st) => !dismissedIds.has(st.id)).length, 0),
    0
  );

  async function markAttendance(student: UnloggedStudent, date: string, sessionId: string | null, status: 'present' | 'absent') {
    try {
      await upsertAttendance(student.id, student.group_id, status, null, date, sessionId);
      setDismissedIds((prev) => new Set(prev).add(student.id));
      showToast(`تم تسجيل ${status === 'present' ? 'حضور' : 'غياب'} ${student.name}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) return;
      showToast(`فشل تسجيل الحضور: ${msg || 'خطأ غير معروف'}. حاول مرة أخرى.`, 'error');
    }
  }

  function sendWhatsApp(student: UnloggedStudent) {
    const phone = student.parent_phone ?? student.phone;
    if (!phone) {
      showToast('لا يوجد رقم هاتف لولي أمر هذا الطالب', 'error');
      return;
    }
    const cleanPhone = normalizePhoneForWhatsApp(phone);
    const message = `🌟 تنبيه هام من منصة الخالد التعليمية 🌟\n\nتحية طيبة وبعد،،\nنود إبلاغكم بكل أسف أن الطالب/ة: ${student.name} قد تغيب عن حضور حصة اليوم.\nنرجو من سيادتكم المتابعة معنا لضمان مصلحة الطالب الدراسية.\n\n🎓 مع تحيات / تيم مستر عمرو خالد\n📅 منصة الخالد التعليمية`;
    openWhatsAppURL(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, showToast);
  }

  function dismissGroup(groupId: string, students: UnloggedStudent[]) {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const s of students) next.add(s.id);
      return next;
    });
  }

  function toggleCollapse(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading || totalMissing === 0 || !bannerVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="glass-card rounded-2xl border border-amber-500/40 overflow-hidden"
    >
      {/* Banner header */}
      <div className="bg-gradient-to-l from-amber-500/15 via-amber-500/10 to-transparent px-5 py-4 flex items-center justify-between gap-3 border-b border-amber-500/20">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/15 rounded-xl">
            <AlertTriangle size={22} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-black text-amber-400">تنبيه نهاية اليوم — طلاب لم يُسجّل حضورهم</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {totalMissing} طالب في {dateGroups.reduce((s, dg) => s + dg.groups.filter((g) => g.students.some((st) => !dismissedIds.has(st.id))).length, 0)} مجموعة
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadMissing}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition active:scale-90"
            title="تحديث"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setBannerVisible(false)}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition active:scale-90"
            title="إخفاء التنبيه"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Date-separated lists */}
      <div className="p-4 space-y-4 max-h-[50vh] overflow-y-auto modal-body">
        {dateGroups.map((dg) => {
          const visibleGroups = dg.groups.filter((g) => g.students.some((s) => !dismissedIds.has(s.id)));
          if (visibleGroups.length === 0) return null;

          return (
            <div key={dg.date} className="space-y-3">
              {/* Date header */}
              <div className="flex items-center gap-2 px-1">
                <CalendarClock size={14} className={dg.isToday ? 'text-amber-400' : 'text-slate-500'} />
                <span className={`text-xs font-black ${dg.isToday ? 'text-amber-400' : 'text-slate-400'}`}>
                  {dg.isToday ? 'حصص اليوم' : 'حصص أمس'} — {formatArabicDate(dg.date)}
                </span>
                <div className={`flex-1 h-px ${dg.isToday ? 'bg-amber-500/20' : 'bg-slate-700'}`} />
              </div>

              {/* Groups under this date */}
              {visibleGroups.map((group) => {
                const visibleStudents = group.students.filter((s) => !dismissedIds.has(s.id));
                if (visibleStudents.length === 0) return null;

                const collapseKey = `${dg.date}-${group.groupId}`;
                const isCollapsed = collapsedGroups.has(collapseKey);

                return (
                  <div key={group.groupId} className="glass-light rounded-xl overflow-hidden border border-white/10">
                    {/* Group header */}
                    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] transition">
                      <button
                        onClick={() => toggleCollapse(collapseKey)}
                        className="flex items-center gap-2 text-sm font-bold text-white flex-1 text-right"
                      >
                        {isCollapsed ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronUp size={16} className="text-slate-400" />}
                        <span>{group.groupName}</span>
                        {group.groupSchedule && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-600/30 text-slate-300 font-medium">{group.groupSchedule}</span>
                        )}
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-bold">{visibleStudents.length} طالب</span>
                      </button>
                      <button
                        onClick={() => dismissGroup(group.groupId, group.students)}
                        className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition px-2 py-1 rounded-lg hover:bg-emerald-500/10"
                      >
                        معالجة الكل
                      </button>
                    </div>

                    {/* Student list */}
                    <AnimatePresence>
                      {!isCollapsed && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 space-y-1.5">
                            {visibleStudents.map((s) => (
                              <div
                                key={s.id}
                                className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition group"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                                    <span className="text-[10px] font-bold text-amber-400">
                                      {s.name.charAt(0)}
                                    </span>
                                  </div>
                                  <span className="text-sm text-slate-200 font-medium break-words leading-snug">{s.name}</span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <button
                                    onClick={() => markAttendance(s, dg.date, group.sessionId, 'present')}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 transition text-[11px] font-bold active:scale-95"
                                    title="تسجيل حضور فوري"
                                  >
                                    <CheckCircle size={13} /> حضور
                                  </button>
                                  <button
                                    onClick={() => markAttendance(s, dg.date, group.sessionId, 'absent')}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600/15 hover:bg-red-600/25 text-red-400 transition text-[11px] font-bold active:scale-95"
                                    title="تسجيل غياب فوري"
                                  >
                                    <XCircle size={13} /> غياب
                                  </button>
                                  <button
                                    onClick={() => sendWhatsApp(s)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 transition text-[11px] font-bold active:scale-95"
                                    title="إرسال رسالة واتساب لولي الأمر"
                                  >
                                    <MessageCircle size={13} /> واتساب
                                  </button>
                                  <button
                                    onClick={() => setDismissedIds((prev) => new Set(prev).add(s.id))}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-slate-300 transition active:scale-90"
                                    title="إخفاء"
                                  >
                                    <CheckCircle2 size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
