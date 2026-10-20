import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarDays, ChevronRight, ChevronLeft, Users, CheckCircle2, XCircle, Clock, BookOpen, Award, Trash2 } from 'lucide-react';
import type { Session, Student, AttendanceRecord, HomeworkStatus, BehaviorEval, CenterGrade, OnlineGrade } from '@/lib/types';
import {
  fetchSessions,
  fetchStudentsByGroup,
  fetchAttendanceForDate,
  fetchHomework,
  fetchHomeworkStatuses,
  fetchBehaviorEvals,
  fetchCenterGradesByStudent,
  fetchOnlineGradesByStudent,
  deleteSession,
} from '@/lib/data';
import { formatArabicDate } from '@/lib/format';
import Modal from '@/components/ui/Modal';

const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

type StudentDetail = {
  student: Student;
  attendance: AttendanceRecord | null;
  homework: { title: string; status: string }[];
  behavior: BehaviorEval | null;
  centerGrades: { examTitle: string; score: number }[];
  onlineGrades: { examTitle: string; score: number }[];
};

export default function SessionCalendar({ groupId }: { groupId: string }) {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return `${ARABIC_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [studentDetails, setStudentDetails] = useState<StudentDetail[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSessions(groupId, viewMonth);
      setSessions(data);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [groupId, viewMonth]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  function shiftMonth(delta: number) {
    const [monthName, yearStr] = viewMonth.split(' ');
    const monthIdx = ARABIC_MONTHS.indexOf(monthName);
    const year = parseInt(yearStr, 10);
    const newDate = new Date(year, monthIdx + delta, 1);
    setViewMonth(`${ARABIC_MONTHS[newDate.getMonth()]} ${newDate.getFullYear()}`);
  }

  const [monthName, yearStr] = viewMonth.split(' ');
  const monthIdx = ARABIC_MONTHS.indexOf(monthName);
  const year = parseInt(yearStr, 10);
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const firstDay = new Date(year, monthIdx, 1);
  const startOffset = (firstDay.getDay() + 1) % 7;

  const sessionByDate: Record<string, Session> = {};
  for (const s of sessions) {
    const d = (s.session_date ?? s.created_at).slice(0, 10);
    sessionByDate[d] = s;
  }

  async function openSessionDetails(session: Session) {
    setSelectedSession(session);
    setDetailsLoading(true);
    try {
      const sessionDate = (session.session_date ?? session.created_at).slice(0, 10);
      const [students, attendanceData, homeworkList, behaviorData] = await Promise.all([
        fetchStudentsByGroup(groupId),
        fetchAttendanceForDate(groupId, sessionDate),
        fetchHomework(groupId),
        fetchBehaviorEvals(''),
      ]);

      const hwStatusMap = new Map<string, Map<string, string>>();
      for (const hw of homeworkList) {
        if (hw.session_id && hw.session_id !== session.id) continue;
        const statuses = await fetchHomeworkStatuses(hw.id);
        const inner = new Map<string, string>();
        for (const st of statuses) inner.set(st.student_id, st.status);
        hwStatusMap.set(hw.id, inner);
      }

      const studentGradePromises = students.map(async (student) => {
        const [centerGrades, onlineGrades] = await Promise.all([
          fetchCenterGradesByStudent(student.id),
          fetchOnlineGradesByStudent(student.id),
        ]);
        return { student, centerGrades, onlineGrades };
      });
      const studentGrades = await Promise.all(studentGradePromises);

      const details: StudentDetail[] = studentGrades.map(({ student, centerGrades, onlineGrades }) => {
        const att = attendanceData.find((a) => a.student_id === student.id) ?? null;
        const hwStatuses: { title: string; status: string }[] = [];
        for (const hw of homeworkList) {
          if (hw.session_id && hw.session_id !== session.id) continue;
          const st = hwStatusMap.get(hw.id)?.get(student.id);
          if (st) hwStatuses.push({ title: hw.title, status: st });
        }
        const behavior = behaviorData.find((b) => {
          if (b.session_id) return b.session_id === session.id && b.student_id === student.id;
          return b.student_id === student.id && b.eval_date === sessionDate;
        }) ?? null;
        return { student, attendance: att, homework: hwStatuses, behavior, centerGrades, onlineGrades };
      });
      setStudentDetails(details);
    } catch {
      setStudentDetails([]);
    } finally {
      setDetailsLoading(false);
    }
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarDays size={20} className="text-emerald-400" />
            <h2 className="text-lg font-black text-white">مواعيد الحصص</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => shiftMonth(-1)} className="p-2 glass-light rounded-lg hover:bg-white/10 text-slate-300 transition" title="الشهر السابق">
              <ChevronRight size={18} />
            </button>
            <span className="text-sm font-bold text-white min-w-[120px] text-center">{viewMonth}</span>
            <button onClick={() => shiftMonth(1)} className="p-2 glass-light rounded-lg hover:bg-white/10 text-slate-300 transition" title="الشهر التالي">
              <ChevronLeft size={18} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-2">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-bold text-slate-500 py-1">{d}</div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-slate-400 text-sm">جارٍ تحميل المواعيد…</span>
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {cells.map((day, idx) => {
              if (day === null) return <div key={idx} />;
              const dateStr = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const session = sessionByDate[dateStr];
              const isToday = dateStr === new Date().toISOString().slice(0, 10);
              return (
                <button
                  key={idx}
                  onClick={() => session && openSessionDetails(session)}
                  className={`relative aspect-square rounded-lg flex flex-col items-center justify-center transition text-xs overflow-hidden ${
                    session
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 cursor-pointer'
                      : 'glass-light text-slate-500'
                  } ${isToday ? 'ring-1 ring-amber-400/50' : ''}`}
                >
                  <span className={`font-bold ${session ? 'text-white' : ''}`}>{day}</span>
                  {session && <span className="text-[10px] text-emerald-400 truncate w-full text-center px-1 mt-0.5">{session.title}</span>}
                  {session && <span className="text-[9px] text-slate-400 mt-0.5 truncate w-full text-center px-1">{formatArabicDate(dateStr)}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={!!selectedSession} onClose={() => { setSelectedSession(null); setConfirmDelete(false); }} title={undefined} size="lg">
        {selectedSession && (
          <div className="mb-4">
            <h3 className="text-lg font-black text-white flex items-center gap-2">
              <CalendarDays size={20} className="text-emerald-400" />
              {selectedSession.title}
            </h3>
            <p className="text-sm text-slate-400 mt-1 flex items-center gap-1.5">
              <CalendarDays size={14} className="text-slate-500" />
              {formatArabicDate((selectedSession.session_date ?? selectedSession.created_at).slice(0, 10))}
            </p>
          </div>
        )}
        {/* Delete session bar */}
        {selectedSession && !confirmDelete && (
          <div className="flex justify-end mb-3">
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-bold hover:bg-red-500/20 transition disabled:opacity-50"
            >
              <Trash2 size={12} />
              حذف الحصة
            </button>
          </div>
        )}
        {selectedSession && confirmDelete && (
          <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-between gap-3">
            <span className="text-xs text-red-300 font-bold">تأكيد حذف هذه الحصة؟ سيتم حذفها نهائياً.</span>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition"
              >
                إلغاء
              </button>
              <button
                onClick={async () => {
                  if (!selectedSession || deleting) return;
                  setDeleting(true);
                  try {
                    await deleteSession(selectedSession.id);
                    setSelectedSession(null);
                    setConfirmDelete(false);
                    await loadSessions();
                  } catch {
                    // ignore
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition disabled:opacity-50"
              >
                {deleting ? 'جارٍ الحذف…' : 'حذف نهائي'}
              </button>
            </div>
          </div>
        )}
        {detailsLoading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-slate-400 text-sm">جاري تحميل تفاصيل الطلاب…</span>
          </div>
        ) : (
          <div className="space-y-3 max-h-[70vh] overflow-y-auto">
            {/* Hub summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <HubStat icon={<Users size={14} />} label="الحضور" value={`${studentDetails.filter((d) => d.attendance?.status === 'present').length}/${studentDetails.length}`} color="text-emerald-400" />
              <HubStat icon={<BookOpen size={14} />} label="الواجبات" value={`${studentDetails.reduce((s, d) => s + d.homework.length, 0)}`} color="text-amber-400" />
              <HubStat icon={<Award size={14} />} label="السلوك" value={`${studentDetails.filter((d) => d.behavior).length}`} color="text-pink-400" />
              <HubStat icon={<CheckCircle2 size={14} />} label="الامتحانات" value={`${studentDetails.reduce((s, d) => s + d.centerGrades.length + d.onlineGrades.length, 0)}`} color="text-blue-400" />
            </div>
            {studentDetails.length === 0 ? (
              <p className="text-center text-slate-400 py-6">لا يوجد طلاب في هذه المجموعة.</p>
            ) : (
              <AnimatePresence>
                {studentDetails.map((detail, i) => (
                  <motion.div
                    key={detail.student.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="glass-light rounded-xl p-4 space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${detail.student.gender === 'male' ? 'bg-blue-500/15 text-blue-400' : 'bg-pink-500/15 text-pink-400'}`}>
                        {detail.student.name.charAt(0)}
                      </div>
                      <h4 className="text-sm font-bold text-white">{detail.student.name}</h4>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <DetailChip
                        icon={<Users size={12} />}
                        label="الحضور"
                        value={detail.attendance ? attendanceLabel(detail.attendance.status) : 'غير مسجل'}
                        color={detail.attendance?.status === 'present' ? 'text-emerald-400' : detail.attendance?.status === 'absent' ? 'text-red-400' : 'text-slate-400'}
                      />
                      <DetailChip
                        icon={<BookOpen size={12} />}
                        label="الواجب"
                        value={detail.homework.length > 0 ? detail.homework.map((h) => hwLabel(h.status)).join('، ') : 'لا يوجد'}
                        color="text-amber-400"
                      />
                      <DetailChip
                        icon={<Award size={12} />}
                        label="السلوك"
                        value={detail.behavior ? behaviorLabel(detail.behavior.rating) : 'غير مقيّم'}
                        color="text-purple-400"
                      />
                      <DetailChip
                        icon={<CheckCircle2 size={12} />}
                        label="الامتحانات"
                        value={[
                          ...detail.centerGrades.map((g) => `${g.examTitle}: ${g.score}`),
                          ...detail.onlineGrades.map((g) => `${g.examTitle}: ${g.score}`),
                        ].join('، ') || 'لا يوجد'}
                        color="text-blue-400"
                      />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function DetailChip({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="glass-light rounded-lg p-2.5">
      <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1">{icon}<span>{label}</span></div>
      <p className={`text-xs font-bold ${color} break-words leading-snug`}>{value}</p>
    </div>
  );
}

function HubStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="glass-light rounded-xl p-3 flex items-center gap-2">
      <div className={`${color} flex-shrink-0`}>{icon}</div>
      <div>
        <p className="text-[10px] text-slate-500">{label}</p>
        <p className={`text-sm font-bold ${color}`}>{value}</p>
      </div>
    </div>
  );
}

function attendanceLabel(status: string): string {
  const map: Record<string, string> = {
    present: 'حاضر',
    absent: 'غائب',
    late: 'متأخر',
    excused_absence: 'غاب بعذر',
    excused: 'غاب بعذر',
    makeup: 'تعويض',
    unrecorded: 'غير مسجل',
  };
  return map[status] ?? status;
}

function hwLabel(status: string): string {
  const map: Record<string, string> = { complete: 'تم', incomplete: 'لم يتم', late: 'غير مكتمل' };
  return map[status] ?? status;
}

function behaviorLabel(rating: string): string {
  const map: Record<string, string> = {
    participatory: 'متفاعل',
    quiet: 'هادئ',
    disruptive: 'مشتت',
    excellent: 'ممتاز',
    needs_attention: 'يحتاج اهتمام',
  };
  return map[rating] ?? rating;
}
