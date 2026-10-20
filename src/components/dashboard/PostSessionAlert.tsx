import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Eye,
  ClipboardCheck,
  BookOpen,
  Award,
  Heart,
  Mic,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { todayDateString, formatArabicDate } from '@/lib/format';
import { ARABIC_DAYS } from '@/lib/constants';
import type { Group } from '@/lib/types';

type MissingType = 'attendance' | 'homework' | 'grades' | 'evaluations' | 'recitation';

type MissingItem = {
  type: MissingType;
  label: string;
  icon: React.ReactNode;
};

type GroupAlert = {
  groupId: string;
  groupName: string;
  sessionDate: string;
  sessionTitle: string;
  sessionId: string;
  missing: MissingItem[];
  affectedStudentCount: number;
};

type PostSessionAlertProps = {
  allGroups: Group[];
  onNavigate: (tab: string) => void;
  onNavigateToGroup?: (groupId: string) => void;
};

const GRACE_PERIOD_HOURS = 2;

function isGroupScheduledOn(schedule: string | null, dayName: string): boolean {
  if (!schedule || !schedule.trim()) return false;
  return schedule.includes(dayName);
}

function isGroupScheduledOnDate(schedule: string | null, dateStr: string): boolean {
  const dayName = ARABIC_DAYS[new Date(dateStr).getDay()];
  return isGroupScheduledOn(schedule, dayName);
}

export default function PostSessionAlert({ allGroups, onNavigate }: PostSessionAlertProps) {
  const [alerts, setAlerts] = useState<GroupAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  const [bannerVisible, setBannerVisible] = useState(true);

  const groupMap = new Map<string, Group>();
  for (const g of allGroups) groupMap.set(g.id, g);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const today = todayDateString();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      const datesToCheck = [today, yesterdayStr];

      const result: GroupAlert[] = [];

      for (const dateStr of datesToCheck) {
        const now = new Date();
        const sessionDate = new Date(dateStr + 'T23:59:59');
        const hoursSinceSession = (now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60);
        const isToday = dateStr === today;

        // For today's sessions, only alert after grace period since end of session day
        // For yesterday, always check
        if (isToday && hoursSinceSession < GRACE_PERIOD_HOURS) continue;

        const { data: sessionsData } = await supabase
          .from('sessions')
          .select('id, group_id, title, session_date')
          .eq('session_date', dateStr)
          .eq('is_deleted', false);

        const sessions = (sessionsData ?? []) as { id: string; group_id: string; title: string; session_date: string | null }[];
        if (sessions.length === 0) continue;

        for (const session of sessions) {
          const group = groupMap.get(session.group_id);
          if (!group) continue;
          if (!isGroupScheduledOnDate(group.schedule, dateStr)) continue;

          const missing: MissingItem[] = [];

          // Check attendance
          const { data: attData } = await supabase
            .from('attendance')
            .select('student_id')
            .eq('session_id', session.id);

          const attCount = (attData ?? []).length;

          // Get active student count for this group
          const { count: studentCount } = await supabase
            .from('students')
            .select('id', { count: 'exact', head: true })
            .eq('group_id', session.group_id)
            .eq('is_deleted', false)
            .neq('status', 'left');

          if (attCount === 0 && (studentCount ?? 0) > 0) {
            missing.push({
              type: 'attendance',
              label: 'الحضور والغياب',
              icon: <ClipboardCheck size={14} className="text-amber-400" />,
            });
          }

          // Check homework for this session
          const { data: hwData } = await supabase
            .from('homework')
            .select('id')
            .eq('session_id', session.id);

          // If homework exists for this session, check if statuses were recorded
          if (hwData && hwData.length > 0) {
            const hwIds = hwData.map((h: { id: string }) => h.id);
            const { count: hwStatusCount } = await supabase
              .from('homework_status')
              .select('id', { count: 'exact', head: true })
              .in('homework_id', hwIds);

            if ((hwStatusCount ?? 0) === 0) {
              missing.push({
                type: 'homework',
                label: 'حالة الواجبات',
                icon: <BookOpen size={14} className="text-blue-400" />,
              });
            }
          }

          // Check center grades/exams for this session (exam, sheet categories)
          const { data: examData } = await supabase
            .from('center_exams')
            .select('id')
            .eq('session_id', session.id)
            .in('category', ['exam', 'sheet']);

          if (examData && examData.length > 0) {
            const examIds = examData.map((e: { id: string }) => e.id);
            const { count: gradeCount } = await supabase
              .from('center_grades')
              .select('id', { count: 'exact', head: true })
              .in('center_exam_id', examIds);

            if ((gradeCount ?? 0) === 0) {
              missing.push({
                type: 'grades',
                label: 'الدرجات',
                icon: <Award size={14} className="text-amber-400" />,
              });
            }
          }

          // Check recitation for this session
          const { data: recitationData } = await supabase
            .from('center_exams')
            .select('id')
            .eq('session_id', session.id)
            .eq('category', 'recitation');

          if (recitationData && recitationData.length > 0) {
            const recIds = recitationData.map((r: { id: string }) => r.id);
            const { count: recGradeCount } = await supabase
              .from('center_grades')
              .select('id', { count: 'exact', head: true })
              .in('center_exam_id', recIds);

            if ((recGradeCount ?? 0) === 0) {
              missing.push({
                type: 'recitation',
                label: 'التسميع',
                icon: <Mic size={14} className="text-purple-400" />,
              });
            }
          }

          // Check behavior evaluations for this session
          const { count: evalCount } = await supabase
            .from('behavior_eval')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', session.id);

          if ((evalCount ?? 0) === 0 && (studentCount ?? 0) > 0) {
            missing.push({
              type: 'evaluations',
              label: 'تقييم السلوك',
              icon: <Heart size={14} className="text-pink-400" />,
            });
          }

          if (missing.length > 0) {
            result.push({
              groupId: session.group_id,
              groupName: group.name,
              sessionDate: dateStr,
              sessionTitle: session.title ?? `حصة ${dateStr}`,
              sessionId: session.id,
              missing,
              affectedStudentCount: studentCount ?? 0,
            });
          }
        }
      }

      setAlerts(result);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [allGroups]);

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 60000);
    return () => clearInterval(interval);
  }, [loadAlerts]);

  // Realtime: re-check when relevant tables change
  useEffect(() => {
    let debounced: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounced) clearTimeout(debounced);
      debounced = setTimeout(() => loadAlerts(), 2000);
    };
    const channel = supabase
      .channel('post-session-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework_status' }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'center_grades' }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'behavior_eval' }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'center_exams' }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework' }, trigger)
      .subscribe();

    return () => {
      if (debounced) clearTimeout(debounced);
      supabase.removeChannel(channel);
    };
  }, [loadAlerts]);

  function toggleCollapse(key: string) {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function dismissAlert(key: string) {
    setDismissedKeys((prev) => new Set(prev).add(key));
  }

  function handleViewData(item: MissingItem) {
    switch (item.type) {
      case 'attendance':
        onNavigate('attendance');
        break;
      case 'homework':
      case 'evaluations':
        onNavigate('tracking');
        break;
      case 'grades':
      case 'recitation':
        onNavigate('grades');
        break;
    }
  }

  const visibleAlerts = alerts.filter((a) => {
    const key = `${a.sessionId}`;
    return !dismissedKeys.has(key);
  });

  if (loading || visibleAlerts.length === 0 || !bannerVisible) return null;

  const totalMissing = visibleAlerts.reduce((sum, a) => sum + a.missing.length, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="glass-card rounded-2xl border border-amber-500/40 overflow-hidden"
    >
      <div className="bg-gradient-to-l from-amber-500/15 via-amber-500/10 to-transparent px-5 py-4 flex items-center justify-between gap-3 border-b border-amber-500/20">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/15 rounded-xl">
            <AlertTriangle size={22} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-black text-amber-400">تنبيه ما بعد الحصة — بيانات غير مكتملة</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {totalMissing} عنصر مفقود في {visibleAlerts.length} حصة
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadAlerts}
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

      <div className="p-4 space-y-3 max-h-[50vh] overflow-y-auto modal-body">
        {visibleAlerts.map((alert) => {
          const key = `${alert.sessionId}`;
          const isCollapsed = collapsedKeys.has(key);

          return (
            <div key={key} className="glass-light rounded-xl overflow-hidden border border-white/10">
              <div className="flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] transition">
                <button
                  onClick={() => toggleCollapse(key)}
                  className="flex items-center gap-2 text-sm font-bold text-white flex-1 text-right"
                >
                  {isCollapsed ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronUp size={16} className="text-slate-400" />}
                  <span>{alert.groupName}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-600/30 text-slate-300 font-medium">
                    {alert.sessionTitle}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-bold">
                    {alert.missing.length} مفقود
                  </span>
                </button>
                <button
                  onClick={() => dismissAlert(key)}
                  className="text-[11px] font-bold text-slate-400 hover:text-slate-200 transition px-2 py-1 rounded-lg hover:bg-white/5"
                >
                  تجاوز الرسالة
                </button>
              </div>

              <AnimatePresence>
                {!isCollapsed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-3 space-y-2">
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                        <span>التاريخ: {formatArabicDate(alert.sessionDate)}</span>
                        {alert.affectedStudentCount > 0 && (
                          <span className="text-slate-500">• عدد الطلاب: {alert.affectedStudentCount}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {alert.missing.map((item) => (
                          <div
                            key={item.type}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20"
                          >
                            {item.icon}
                            <span className="text-xs font-semibold text-amber-300">{item.label}</span>
                            <button
                              onClick={() => handleViewData(item)}
                              className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition px-1.5 py-0.5 rounded-md hover:bg-emerald-500/10 active:scale-95"
                            >
                              <Eye size={11} /> عرض البيانات
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
