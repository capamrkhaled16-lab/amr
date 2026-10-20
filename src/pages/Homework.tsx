import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";
import type { GradeLevel, Group, Homework as HomeworkType, Session } from "../lib/types";

export default function Homework() {
  const { showSuccess, showWarning } = useToast();
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [homework, setHomework] = useState<HomeworkType[]>([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", session_id: "", due_date: new Date().toISOString().split("T")[0] });

  useEffect(() => {
    supabase.from("grade_levels").select("*").order("sort_order").then(({ data }) => {
      if (data) setGradeLevels(data as GradeLevel[]);
    });
    supabase.from("groups").select("*").order("name").then(({ data }) => {
      if (data) setGroups(data as Group[]);
    });
  }, []);

  const loadSessions = (groupId: string) => {
    supabase
      .from("sessions")
      .select("*")
      .eq("group_id", groupId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setSessions(data as Session[] || []));
  };

  const loadHomework = (groupId: string) => {
    supabase
      .from("homework")
      .select("*")
      .eq("group_id", groupId)
      .order("due_date", { ascending: false })
      .then(({ data }) => setHomework(data as HomeworkType[] || []));
  };

  const handleGroupChange = (groupId: string) => {
    setSelectedGroup(groupId);
    if (groupId) {
      loadSessions(groupId);
      loadHomework(groupId);
    } else {
      setSessions([]);
      setHomework([]);
    }
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.session_id || !selectedGroup || saving) return;
    setSaving(true);

    try {
      const { data, error } = await supabase
        .from("homework")
        .insert({
          group_id: selectedGroup,
          session_id: form.session_id,
          title: form.title.trim(),
          description: form.description || null,
          due_date: form.due_date,
        })
        .select()
        .single();

      if (error) throw error;

      setHomework((prev) => [data as HomeworkType, ...prev]);
      showSuccess("تم إضافة الواجب");
      setForm({ title: "", description: "", session_id: "", due_date: new Date().toISOString().split("T")[0] });
      setShowAdd(false);
    } catch (err) {
      console.error("[homework] save error:", err);
      showWarning("لم يتم حفظ الواجب");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleClose = async (hw: HomeworkType) => {
    const { error } = await supabase
      .from("homework")
      .update({ is_closed: !hw.is_closed })
      .eq("id", hw.id);

    if (error) {
      showWarning("لم يتم التحديث");
    } else {
      setHomework((prev) => prev.map((h) => h.id === hw.id ? { ...h, is_closed: !h.is_closed } : h));
      showSuccess("تم التحديث");
    }
  };

  const groupName = (gid: string) => groups.find((g) => g.id === gid)?.name || "";

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex gap-3 flex-1">
          <select
            value={selectedGroup}
            onChange={(e) => handleGroupChange(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-300 text-sm"
          >
            <option value="">اختر المجموعة</option>
            {groups.map((g) => {
              const gl = gradeLevels.find((x) => x.id === g.grade_level_id);
              return (
                <option key={g.id} value={g.id}>
                  {gl?.name} - {g.name}
                </option>
              );
            })}
          </select>
        </div>
        {selectedGroup && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition text-sm font-bold"
          >
            + واجب جديد
          </button>
        )}
      </div>

      {showAdd && selectedGroup && (
        <div className="bg-white rounded-2xl shadow-sm p-4 animate-slide-up space-y-3">
          <h3 className="font-bold text-gray-800">إضافة واجب</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="عنوان الواجب *"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            />
            <select
              value={form.session_id}
              onChange={(e) => setForm({ ...form, session_id: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            >
              <option value="">الحصة *</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.title} - {s.session_date}</option>
              ))}
            </select>
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            />
            <input
              type="text"
              placeholder="الوصف"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.title.trim() || !form.session_id}
              className="px-5 py-2.5 bg-success-600 text-white rounded-xl hover:bg-success-700 transition disabled:opacity-60 text-sm font-bold"
            >
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition text-sm font-semibold"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {selectedGroup && (
        <div className="space-y-2">
          {homework.map((hw) => (
            <div key={hw.id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="font-bold text-gray-800 text-sm">{hw.title}</h3>
                {hw.description && <p className="text-gray-500 text-xs mt-1">{hw.description}</p>}
                <p className="text-gray-400 text-xs mt-1">تاريخ التسليم: {hw.due_date}</p>
              </div>
              <button
                onClick={() => handleToggleClose(hw)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  hw.is_closed
                    ? "bg-gray-100 text-gray-500"
                    : "bg-success-50 text-success-700"
                }`}
              >
                {hw.is_closed ? "مغلق" : "مفتوح"}
              </button>
            </div>
          ))}
          {homework.length === 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">
              لا توجد واجبات لهذه المجموعة
            </div>
          )}
        </div>
      )}

      {!selectedGroup && (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400 text-sm">
          اختر مجموعة لعرض الواجبات
        </div>
      )}
    </div>
  );
}
