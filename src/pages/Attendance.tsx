import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";
import { getArabicMonth, getTodayISO } from "../lib/dates";
import type { AttendanceRecord, AttendanceStatus, GradeLevel, Group, Session, Student } from "../lib/types";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; color: string; bg: string }> = {
  present: { label: "حاضر", color: "text-success-700", bg: "bg-success-100 border-success-300" },
  absent: { label: "غائب", color: "text-error-700", bg: "bg-error-100 border-error-300" },
  late: { label: "متأخر", color: "text-warning-700", bg: "bg-warning-100 border-warning-300" },
  excused: { label: "غياب مرخص", color: "text-blue-700", bg: "bg-blue-100 border-blue-300" },
  unrecorded: { label: "غير مسجل", color: "text-gray-500", bg: "bg-gray-50 border-gray-200" },
};

const STATUS_ORDER: AttendanceStatus[] = ["present", "absent", "late", "excused"];

export default function Attendance() {
  const { showSuccess, showWarning } = useToast();

  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Map<string, AttendanceRecord>>(new Map());

  const [selectedGrade, setSelectedGrade] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [sessionDate, setSessionDate] = useState<string>(getTodayISO());

  const [loadingData, setLoadingData] = useState(false);
  const [showAddSession, setShowAddSession] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);
  const [savingStudents, setSavingStudents] = useState<Set<string>>(new Set());

  const requestIdRef = useRef(0);

  useEffect(() => {
    supabase.from("grade_levels").select("*").order("sort_order").then(({ data }) => {
      if (data) setGradeLevels(data as GradeLevel[]);
    });
  }, []);

  const loadGroups = useCallback((gradeId: string) => {
    supabase
      .from("groups")
      .select("*")
      .eq("grade_level_id", gradeId)
      .order("name")
      .then(({ data }) => {
        setGroups(data as Group[] || []);
      });
  }, []);

  const loadSessions = useCallback((groupId: string) => {
    supabase
      .from("sessions")
      .select("*")
      .eq("group_id", groupId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        setSessions(data as Session[] || []);
      });
  }, []);

  const loadStudents = useCallback((groupId: string) => {
    supabase
      .from("students")
      .select("*")
      .eq("group_id", groupId)
      .eq("is_deleted", false)
      .eq("status", "active")
      .order("name")
      .then(({ data }) => {
        setStudents(data as Student[] || []);
      });
  }, []);

  const loadAttendance = useCallback(async (sessionId: string, groupId: string, date: string) => {
    const myRequest = ++requestIdRef.current;
    setLoadingData(true);

    let query = supabase.from("attendance").select("*");
    if (sessionId) {
      query = query.eq("session_id", sessionId);
    } else {
      query = query.eq("group_id", groupId).eq("attendance_date", date).is("session_id", null);
    }

    const { data, error } = await query;

    if (myRequest !== requestIdRef.current) return;

    if (error) {
      console.error("[attendance] load error:", error.message);
      setAttendanceMap(new Map());
    } else {
      const map = new Map<string, AttendanceRecord>();
      for (const rec of data as AttendanceRecord[]) {
        map.set(rec.student_id, rec);
      }
      setAttendanceMap(map);
    }
    setLoadingData(false);
  }, []);

  const handleGradeChange = (gradeId: string) => {
    setSelectedGrade(gradeId);
    setSelectedGroup("");
    setSelectedSession("");
    setSessions([]);
    setStudents([]);
    setAttendanceMap(new Map());
    if (gradeId) loadGroups(gradeId);
  };

  const handleGroupChange = (groupId: string) => {
    setSelectedGroup(groupId);
    setSelectedSession("");
    setAttendanceMap(new Map());
    if (groupId) {
      loadSessions(groupId);
      loadStudents(groupId);
    }
  };

  const handleSessionChange = (sessionId: string) => {
    setSelectedSession(sessionId);
    setAttendanceMap(new Map());
    if (sessionId && selectedGroup) {
      loadAttendance(sessionId, selectedGroup, sessionDate);
    }
  };

  const handleCreateSession = async () => {
    if (!selectedGroup || creatingSession) return;
    setCreatingSession(true);

    const month = getArabicMonth(new Date(sessionDate + "T00:00:00"));

    const { data, error } = await supabase.rpc("create_session_auto", {
      p_group_id: selectedGroup,
      p_title: newSessionTitle.trim(),
      p_month: month,
      p_session_date: sessionDate,
    });

    if (error) {
      console.error("[session] create error:", error.message);
      showWarning("لم يتم إنشاء الحصة، تحقق من البيانات");
      setCreatingSession(false);
      return;
    }

    if (!data || data.length === 0) {
      showWarning("لم يتم إنشاء الحصة");
      setCreatingSession(false);
      return;
    }

    const newSession = data[0] as Session;
    setSessions((prev) => [newSession, ...prev]);
    setSelectedSession(newSession.id);
    setShowAddSession(false);
    setNewSessionTitle("");
    setCreatingSession(false);
    showSuccess("تم إنشاء الحصة بنجاح");

    loadAttendance(newSession.id, selectedGroup, sessionDate);
  };

  const handleStatusChange = async (studentId: string, newStatus: AttendanceStatus) => {
    if (savingStudents.has(studentId)) return;

    const existing = attendanceMap.get(studentId);
    if (existing && existing.status === newStatus) return;

    setSavingStudents((prev) => new Set(prev).add(studentId));

    const optimisticRecord: AttendanceRecord = existing
      ? { ...existing, status: newStatus }
      : {
          id: "",
          student_id: studentId,
          group_id: selectedGroup,
          status: newStatus,
          notes: null,
          attendance_date: sessionDate,
          recorded_at: new Date().toISOString(),
          session_id: selectedSession || null,
          late_minutes: newStatus === "late" ? 5 : null,
        };

    setAttendanceMap((prev) => {
      const next = new Map(prev);
      next.set(studentId, optimisticRecord);
      return next;
    });

    try {
      const { data, error } = await supabase.rpc("upsert_attendance", {
        p_student_id: studentId,
        p_session_id: selectedSession || null,
        p_group_id: selectedGroup,
        p_attendance_date: sessionDate,
        p_status: newStatus,
        p_late_minutes: newStatus === "late" ? 5 : null,
      });

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("empty upsert result");

      const saved = data[0] as AttendanceRecord;
      setAttendanceMap((prev) => {
        const next = new Map(prev);
        next.set(studentId, saved);
        return next;
      });
      showSuccess("تم الحفظ");
    } catch (err) {
      console.error("[attendance] save error:", err);
      setAttendanceMap((prev) => {
        const next = new Map(prev);
        if (existing) {
          next.set(studentId, existing);
        } else {
          next.delete(studentId);
        }
        return next;
      });
      showWarning("لم يتم حفظ التغيير");
    } finally {
      setSavingStudents((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
    }
  };

  const handleSetAll = async (status: AttendanceStatus) => {
    if (!students.length) return;
    for (const student of students) {
      await handleStatusChange(student.id, status);
    }
  };

  const counts = {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    unrecorded: 0,
  };
  for (const student of students) {
    const rec = attendanceMap.get(student.id);
    counts[rec?.status || "unrecorded"]++;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-sm p-4 lg:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">الصف الدراسي</label>
            <select
              value={selectedGrade}
              onChange={(e) => handleGradeChange(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-200 outline-none transition text-sm"
            >
              <option value="">اختر الصف</option>
              {gradeLevels.map((gl) => (
                <option key={gl.id} value={gl.id}>{gl.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">المجموعة</label>
            <select
              value={selectedGroup}
              onChange={(e) => handleGroupChange(e.target.value)}
              disabled={!selectedGrade}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-200 outline-none transition text-sm disabled:opacity-50"
            >
              <option value="">اختر المجموعة</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">الحصة</label>
            <div className="flex gap-2">
              <select
                value={selectedSession}
                onChange={(e) => handleSessionChange(e.target.value)}
                disabled={!selectedGroup}
                className="flex-1 px-3 py-2.5 rounded-xl border border-gray-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-200 outline-none transition text-sm disabled:opacity-50"
              >
                <option value="">اختر الحصة</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} - {s.session_date || "بدون تاريخ"}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setShowAddSession(true)}
                disabled={!selectedGroup}
                className="px-3 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition disabled:opacity-50 text-sm font-semibold whitespace-nowrap"
              >
                + حصة
              </button>
            </div>
          </div>
        </div>

        {selectedSession && (
          <div className="mt-3 flex items-center gap-3">
            <label className="text-sm font-semibold text-gray-700">تاريخ الحصة:</label>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
            />
          </div>
        )}
      </div>

      {showAddSession && (
        <div className="bg-white rounded-2xl shadow-sm p-4 lg:p-5 animate-slide-up">
          <h3 className="text-base font-bold text-gray-800 mb-3">إضافة حصة جديدة</h3>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newSessionTitle}
              onChange={(e) => setNewSessionTitle(e.target.value)}
              placeholder="اسم الحصة (اختياري - سيتم الترقيم تلقائياً)"
              className="flex-1 px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            />
            <button
              onClick={handleCreateSession}
              disabled={creatingSession}
              className="px-5 py-2.5 bg-success-600 text-white rounded-xl hover:bg-success-700 transition disabled:opacity-60 text-sm font-bold"
            >
              {creatingSession ? "جاري الإنشاء..." : "تأكيد الإضافة"}
            </button>
            <button
              onClick={() => { setShowAddSession(false); setNewSessionTitle(""); }}
              className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition text-sm font-semibold"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {selectedSession && students.length > 0 && (
        <>
          <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-wrap gap-3 items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map((status) => (
                <div
                  key={status}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-semibold ${STATUS_CONFIG[status].bg} ${STATUS_CONFIG[status].color}`}
                >
                  {STATUS_CONFIG[status].label}: {counts[status]}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleSetAll("present")}
                className="px-3 py-1.5 bg-success-50 text-success-700 rounded-lg text-sm font-semibold hover:bg-success-100 transition"
              >
                تعليم الكل حاضر
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {loadingData ? (
              <div className="p-8 text-center text-gray-400">
                <div className="inline-block w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin mb-2" />
                <p className="text-sm">جاري التحميل...</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {students.map((student) => {
                  const rec = attendanceMap.get(student.id);
                  const currentStatus = rec?.status || "unrecorded";
                  const isSaving = savingStudents.has(student.id);
                  return (
                    <div
                      key={student.id}
                      className="flex items-center justify-between p-3 lg:p-4 hover:bg-gray-50 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-sm font-bold text-gray-500 flex-shrink-0">
                          {student.name[0]}
                        </div>
                        <span className="text-sm font-semibold text-gray-800 truncate">{student.name}</span>
                        {isSaving && (
                          <div className="w-4 h-4 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {STATUS_ORDER.map((status) => (
                          <button
                            key={status}
                            onClick={() => handleStatusChange(student.id, status)}
                            disabled={isSaving}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border-2 transition disabled:opacity-50 ${
                              currentStatus === status
                                ? STATUS_CONFIG[status].bg + " " + STATUS_CONFIG[status].color
                                : "border-gray-200 text-gray-400 hover:border-gray-300"
                            }`}
                          >
                            {STATUS_CONFIG[status].label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {selectedGroup && !selectedSession && (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400">
          <p className="text-sm">اختر حصة لبدء تسجيل الحضور أو أنشئ حصة جديدة</p>
        </div>
      )}

      {!selectedGroup && (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400">
          <p className="text-sm">اختر الصف والمجموعة لبدء تسجيل الحضور</p>
        </div>
      )}
    </div>
  );
}
