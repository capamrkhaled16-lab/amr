import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";
import { formatCurrency } from "../lib/dates";
import type { GradeLevel, Group, Student } from "../lib/types";
import { PDFButton } from "@/components/ui/PDFButton";
import { exportStudentListPDF } from "@/lib/pdfExport";

export default function Students() {
  const { showSuccess, showWarning } = useToast();
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredGrade, setFilteredGrade] = useState("");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    parent_phone: "",
    gender: "male",
    group_id: "",
  });

  useEffect(() => {
    supabase.from("grade_levels").select("*").order("sort_order").then(({ data }) => {
      if (data) setGradeLevels(data as GradeLevel[]);
    });
    supabase.from("groups").select("*").order("name").then(({ data }) => {
      if (data) setGroups(data as Group[]);
    });
    loadStudents();
  }, []);

  const loadStudents = async () => {
    const { data } = await supabase
      .from("students")
      .select("*")
      .eq("is_deleted", false)
      .order("name");
    setStudents(data as Student[] || []);
  };

  const groupName = (groupId: string | null) => {
    if (!groupId) return "بدون مجموعة";
    const g = groups.find((x) => x.id === groupId);
    return g?.name || "غير معروف";
  };

  const gradeName = (groupId: string | null) => {
    if (!groupId) return "";
    const g = groups.find((x) => x.id === groupId);
    if (!g) return "";
    const gl = gradeLevels.find((x) => x.id === g.grade_level_id);
    return gl?.name || "";
  };

  const filtered = students.filter((s) => {
    if (filteredGrade) {
      const g = groups.find((x) => x.id === s.group_id);
      if (!g || g.grade_level_id !== filteredGrade) return false;
    }
    if (search) {
      return s.name.includes(search) || (s.parent_phone || "").includes(search);
    }
    return true;
  });

  const handleSave = async () => {
    if (!form.name.trim() || !form.group_id || saving) return;
    setSaving(true);

    const group = groups.find((g) => g.id === form.group_id);
    const grade = gradeLevels.find((gl) => gl.id === group?.grade_level_id);
    const totalFees = grade?.base_subscription || 0;

    try {
      if (editing) {
        const { error } = await supabase
          .from("students")
          .update({
            name: form.name.trim(),
            phone: form.phone || null,
            parent_phone: form.parent_phone || null,
            gender: form.gender,
            group_id: form.group_id,
          })
          .eq("id", editing.id);

        if (error) throw error;
        showSuccess("تم حفظ التعديلات");
      } else {
        const { error } = await supabase.from("students").insert({
          name: form.name.trim(),
          phone: form.phone || null,
          parent_phone: form.parent_phone || null,
          gender: form.gender,
          group_id: form.group_id,
          total_fees: totalFees,
        });

        if (error) throw error;
        showSuccess("تم إضافة الطالب");
      }
      resetForm();
      await loadStudents();
    } catch (err) {
      console.error("[students] save error:", err);
      showWarning("لم يتم الحفظ، تحقق من البيانات");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (student: Student) => {
    setEditing(student);
    setForm({
      name: student.name,
      phone: student.phone || "",
      parent_phone: student.parent_phone || "",
      gender: student.gender,
      group_id: student.group_id || "",
    });
    setShowAdd(true);
  };

  const handleDelete = async (student: Student) => {
    if (!confirm(`حذف الطالب "${student.name}"؟`)) return;
    const { error } = await supabase
      .from("students")
      .update({ is_deleted: true, status: "deleted" })
      .eq("id", student.id);

    if (error) {
      showWarning("لم يتم الحذف");
    } else {
      showSuccess("تم حذف الطالب");
      await loadStudents();
    }
  };

  const resetForm = () => {
    setForm({ name: "", phone: "", parent_phone: "", gender: "male", group_id: "" });
    setEditing(null);
    setShowAdd(false);
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <input
            type="text"
            placeholder="بحث بالاسم أو رقم ولي الأمر..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-300 text-sm flex-1 max-w-xs"
          />
          <select
            value={filteredGrade}
            onChange={(e) => setFilteredGrade(e.target.value)}
            className="px-3 py-2 rounded-xl border border-gray-300 text-sm"
          >
            <option value="">كل الصفوف</option>
            {gradeLevels.map((gl) => (
              <option key={gl.id} value={gl.id}>{gl.name}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 items-center">
          <PDFButton
            label="تصدير PDF"
            size="sm"
            variant="primary"
            onClick={async () => {
              const enriched = filtered.map((s) => {
                const g = groups.find((x) => x.id === s.group_id);
                const gl = g ? gradeLevels.find((x) => x.id === g.grade_level_id) : undefined;
                return { ...s, group_name: g?.name, grade_name: gl?.name };
              });
              const gradeFilterName = filteredGrade ? gradeLevels.find((g) => g.id === filteredGrade)?.name : undefined;
              return exportStudentListPDF(enriched, { gradeName: gradeFilterName });
            }}
            disabled={filtered.length === 0}
          />
          <button
            onClick={() => { resetForm(); setShowAdd(true); }}
            className="px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition text-sm font-bold whitespace-nowrap"
          >
            + إضافة طالب
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-white rounded-2xl shadow-sm p-4 lg:p-5 animate-slide-up">
          <h3 className="text-base font-bold text-gray-800 mb-3">
            {editing ? "تعديل بيانات الطالب" : "إضافة طالب جديد"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="اسم الطالب *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            />
            <select
              value={form.group_id}
              onChange={(e) => setForm({ ...form, group_id: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            >
              <option value="">المجموعة *</option>
              {groups.map((g) => {
                const gl = gradeLevels.find((x) => x.id === g.grade_level_id);
                return (
                  <option key={g.id} value={g.id}>
                    {gl?.name} - {g.name}
                  </option>
                );
              })}
            </select>
            <input
              type="text"
              placeholder="رقم هاتف الطالب"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            />
            <input
              type="text"
              placeholder="رقم ولي الأمر"
              value={form.parent_phone}
              onChange={(e) => setForm({ ...form, parent_phone: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            />
            <select
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
              className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
            >
              <option value="male">ذكر</option>
              <option value="female">أنثى</option>
            </select>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleSave}
              disabled={saving || !form.name.trim() || !form.group_id}
              className="px-5 py-2.5 bg-success-600 text-white rounded-xl hover:bg-success-700 transition disabled:opacity-60 text-sm font-bold"
            >
              {saving ? "جاري الحفظ..." : "حفظ"}
            </button>
            <button
              onClick={resetForm}
              className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition text-sm font-semibold"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-right p-3 font-semibold text-gray-600">الاسم</th>
                <th className="text-right p-3 font-semibold text-gray-600 hidden sm:table-cell">الصف</th>
                <th className="text-right p-3 font-semibold text-gray-600">المجموعة</th>
                <th className="text-right p-3 font-semibold text-gray-600 hidden sm:table-cell">ولي الأمر</th>
                <th className="text-right p-3 font-semibold text-gray-600 hidden md:table-cell">الرسوم</th>
                <th className="text-right p-3 font-semibold text-gray-600">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((student) => (
                <tr key={student.id} className="hover:bg-gray-50 transition">
                  <td className="p-3 font-semibold text-gray-800">{student.name}</td>
                  <td className="p-3 text-gray-500 hidden sm:table-cell">{gradeName(student.group_id)}</td>
                  <td className="p-3 text-gray-600">{groupName(student.group_id)}</td>
                  <td className="p-3 text-gray-500 hidden sm:table-cell">{student.parent_phone || "—"}</td>
                  <td className="p-3 hidden md:table-cell">
                    <span className="text-gray-700">{formatCurrency(Number(student.paid_fees))}</span>
                    <span className="text-gray-400"> / {formatCurrency(Number(student.total_fees))}</span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleEdit(student)}
                        className="px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      >
                        تعديل
                      </button>
                      <button
                        onClick={() => handleDelete(student)}
                        className="px-2 py-1 text-xs font-semibold text-error-600 hover:bg-error-50 rounded-lg transition"
                      >
                        حذف
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm">لا يوجد طلاب</div>
        )}
      </div>
    </div>
  );
}
