import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useToast } from "../lib/toast";
import { useAuth } from "../lib/auth";
import type { Settings as SettingsType } from "../lib/types";

export default function Settings() {
  const { assistant } = useAuth();
  const { showSuccess, showWarning } = useToast();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("settings").select("*").limit(1).single().then(({ data }) => {
      if (data) setSettings(data as SettingsType);
    });
  }, []);

  const handleSave = async () => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("settings")
        .update({
          platform_name: settings.platform_name,
          management_name: settings.management_name,
          teacher_name: settings.teacher_name,
        })
        .eq("id", settings.id);

      if (error) throw error;
      showSuccess("تم حفظ الإعدادات");
    } catch (err) {
      console.error("[settings] save error:", err);
      showWarning("لم يتم حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="p-8 text-center text-gray-400 text-sm">جاري التحميل...</div>;
  }

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl">
      <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
        <h3 className="font-bold text-gray-800">إعدادات المنصة</h3>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">اسم المنصة</label>
          <input
            type="text"
            value={settings.platform_name}
            onChange={(e) => setSettings({ ...settings, platform_name: e.target.value })}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">اسم الإدارة</label>
          <input
            type="text"
            value={settings.management_name}
            onChange={(e) => setSettings({ ...settings, management_name: e.target.value })}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">اسم المدرس</label>
          <input
            type="text"
            value={settings.teacher_name}
            onChange={(e) => setSettings({ ...settings, teacher_name: e.target.value })}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-success-600 text-white rounded-xl hover:bg-success-700 transition disabled:opacity-60 text-sm font-bold"
        >
          {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h3 className="font-bold text-gray-800 mb-3">معلومات الحساب</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">الاسم:</span><span className="font-semibold text-gray-700">{assistant?.display_name || assistant?.username}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">حالة الحساب:</span><span className="font-semibold text-success-600">نشط</span></div>
          <div className="flex justify-between"><span className="text-gray-500">عدد مرات الدخول:</span><span className="font-semibold text-gray-700">{assistant?.logins_count}</span></div>
        </div>
      </div>
    </div>
  );
}
