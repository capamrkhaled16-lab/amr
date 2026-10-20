import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Upload, User, Image as ImageIcon, Save, Check, DollarSign, Users, ArrowRight, Key } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@/context/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchStages, fetchGradeLevels, updateGradeLevelBaseSubscription, updateStageBaseSubscription, syncStudentFeesToGradePrice } from '@/lib/data';
import type { AcademicStage, GradeLevel } from '@/lib/types';
import { formatCurrency } from '@/lib/format';
import Button from '@/components/ui/Button';
import Navbar from '@/components/ui/Navbar';
import Watermark from '@/components/ui/Watermark';

export default function SettingsPage() {
  const { settings, update, refresh } = useSettings();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    platform_name: settings.platform_name,
    management_name: settings.management_name,
    teacher_name: settings.teacher_name,
  });
  const [masterPin, setMasterPin] = useState('0000');
  const [geminiKey, setGeminiKey] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [stages, setStages] = useState<AcademicStage[]>([]);
  const [gradeLevelsByStage, setGradeLevelsByStage] = useState<Record<string, GradeLevel[]>>({});
  const [gradeAmounts, setGradeAmounts] = useState<Record<string, string>>({});
  const [stageSaved, setStageSaved] = useState(false);
  const [stageSaving, setStageSaving] = useState(false);
  const [stageError, setStageError] = useState('');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMasterPin(localStorage.getItem('alkhaled_master_pin') ?? '0000');
    setGeminiKey(settings.gemini_api_key ?? '');
  }, []);

  const loadStages = useCallback(async () => {
    try {
      const data = await fetchStages();
      setStages(data);
      const allGradeAmounts: Record<string, string> = {};
      const byStage: Record<string, GradeLevel[]> = {};
      for (const s of data) {
        const grades = await fetchGradeLevels(s.id);
        byStage[s.id] = grades;
        grades.forEach((g) => { allGradeAmounts[g.id] = String(g.base_subscription ?? 0); });
      }
      setGradeLevelsByStage(byStage);
      setGradeAmounts(allGradeAmounts);
    } catch {
      /* keep defaults on error */
    }
  }, []);

  useEffect(() => { void loadStages(); }, [loadStages]);

  async function handleSave() {
    await update({
      platform_name: form.platform_name || 'منصة الخالد التعليمية',
      management_name: form.management_name || 'تحت إدارة ومتابعة مستر عمرو خالد',
      teacher_name: form.teacher_name || 'مستر عمرو خالد',
    });
    if (masterPin.trim()) {
      const currentDefault = settings.default_pin_active ?? true;
      const isChangingFromDefault = currentDefault && masterPin.trim() !== '0000';
      const patch: Record<string, unknown> = {
        master_pin: masterPin.trim(),
      };
      if (isChangingFromDefault) {
        patch.default_pin_active = false;
      }
      await supabase.from('settings').update(patch).neq('id', '00000000-0000-0000-0000-000000000000');
      localStorage.setItem('alkhaled_master_pin', masterPin.trim());
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await refresh();
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    const reader = new FileReader();
    reader.onerror = () => { setUploadingLogo(false); };
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        await update({ logo_url: dataUrl });
        await refresh();
      } catch {
        setSaveError('فشل رفع اللوجو. حاول مرة أخرى.');
      } finally {
        setUploadingLogo(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function uploadPhoto(file: File) {
    setUploadingPhoto(true);
    const reader = new FileReader();
    reader.onerror = () => { setUploadingPhoto(false); };
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        await update({ teacher_photo_url: dataUrl });
        await refresh();
      } catch {
        setSaveError('فشل رفع الصورة. حاول مرة أخرى.');
      } finally {
        setUploadingPhoto(false);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="min-h-screen pb-12">
      <Navbar onLogout={logout} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-[#d4af37] transition active:scale-95"
          >
            <ArrowRight size={20} />
            العودة
          </button>
          <h2 className="text-2xl font-bold text-white">الإعدادات</h2>
        </div>

        {/* Profile Photo Upload */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6"
        >
          <h3 className="font-bold text-white mb-4 flex items-center gap-2">
            <User size={18} className="text-[#d4af37]" />
            صورة المعلم
          </h3>
          <div className="flex items-center gap-6">
            <div className={`w-24 h-24 rounded-full overflow-hidden flex items-center justify-center bg-[#d4af37]/12 ${settings.teacher_photo_url ? 'premium-gold-glow' : ''}`}>
              {settings.teacher_photo_url ? (
                <img src={settings.teacher_photo_url} alt="المعلم" className="w-full h-full object-cover" />
              ) : (
                <User size={36} className="text-[#d4af37]" />
              )}
            </div>
            <div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }}
              />
              <Button variant="secondary" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>
                <Upload size={16} />
                {uploadingPhoto ? 'جارٍ الرفع...' : 'رفع صورة المعلم'}
              </Button>
              <p className="text-xs text-slate-500 mt-2">تظهر داخل حلقة زمردي مضيئة</p>
            </div>
          </div>
        </motion.div>

        {/* Logo Upload */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6"
        >
          <h3 className="font-bold text-white mb-4 flex items-center gap-2">
            <ImageIcon size={18} className="text-[#d4af37]" />
            لوجو الخالد
          </h3>
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-xl overflow-hidden flex items-center justify-center bg-[#d4af37]/12 ring-2 ring-[#d4af37]/30">
              {settings.logo_url ? (
                <img src={settings.logo_url} alt="اللوجو" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={36} className="text-[#d4af37]" />
              )}
            </div>
            <div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }}
              />
              <Button variant="secondary" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
                <Upload size={16} />
                {uploadingLogo ? 'جارٍ الرفع...' : 'رفع اللوجو'}
              </Button>
              <p className="text-xs text-slate-500 mt-2">يظهر في كل النوافذ والشهادات والتقارير</p>
            </div>
          </div>
        </motion.div>

        {/* Platform settings */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 space-y-4"
        >
          <h3 className="font-bold text-white mb-2">إعدادات المنصة</h3>
          <Field label="اسم المنصة">
            <input type="text" value={form.platform_name} onChange={(e) => setForm({ ...form, platform_name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="اسم الإدارة">
            <input type="text" value={form.management_name} onChange={(e) => setForm({ ...form, management_name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="اسم المعلم">
            <input type="text" value={form.teacher_name} onChange={(e) => setForm({ ...form, teacher_name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="الرقم السري للمعلم (PIN)">
            <input type="text" value={masterPin} onChange={(e) => setMasterPin(e.target.value)} className={`${inputCls} w-32`} inputMode="numeric" />
          </Field>
          <Button onClick={handleSave} className="w-full">
            {saved ? <><Check size={16} /> تم الحفظ</> : <><Save size={16} /> حفظ الإعدادات</>}
          </Button>
          {saveError && <p className="text-red-400 text-sm text-center">{saveError}</p>}
        </motion.div>

        {/* Gemini API Key (Optional) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 space-y-4"
        >
          <h3 className="font-bold text-white mb-2 flex items-center gap-2">
            <Key size={18} className="text-[#d4af37]" />
            مفتاح Gemini API (اختياري)
          </h3>
          <p className="text-xs text-slate-400">
            يعمل معمل الاختبارات تلقائياً بدون مفتاح باستخدام المحتوى المرفوع.
            لإضافة ذكاء اصطناعي متقدم، أضف مفتاح Gemini API من Google AI Studio — وهو اختياري تماماً.
          </p>
          <div className="flex items-center gap-2">
            <input
              type={showGeminiKey ? 'text' : 'password'}
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              className={inputCls}
              placeholder="AIza..."
              dir="ltr"
            />
            <button
              onClick={() => setShowGeminiKey(!showGeminiKey)}
              className="px-3 py-2.5 rounded-xl glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition whitespace-nowrap"
            >
              {showGeminiKey ? 'إخفاء' : 'إظهار'}
            </button>
          </div>
          <Button onClick={async () => {
            await update({ gemini_api_key: geminiKey.trim() });
            setKeySaved(true);
            setTimeout(() => setKeySaved(false), 2000);
            await refresh();
          }} className="w-full">
            {keySaved ? <><Check size={16} /> تم الحفظ</> : <><Save size={16} /> حفظ المفتاح</>}
          </Button>
        </motion.div>

        {/* Base subscription per grade level */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 space-y-4"
        >
          <h3 className="font-bold text-white mb-2 flex items-center gap-2"><DollarSign size={18} className="text-[#d4af37]" /> الاشتراك الأساسي الشهري لكل صف</h3>
          <p className="text-xs text-slate-400">يُستخدم هذا المبلغ تلقائياً عند توليد اشتراكات الشهور لطلاب كل صف بدلاً من إدخاله يدوياً.</p>
          {stages.map((stage) => (
            <div key={stage.id} className="space-y-2">
              <div className="text-sm font-bold text-[#d4af37] pt-2">{stage.name}</div>
              {(gradeLevelsByStage[stage.id] ?? []).map((g) => (
                <Field key={g.id} label={g.name}>
                  <div className="flex items-center gap-2">
                    <input type="number" value={gradeAmounts[g.id] ?? '0'} onChange={(e) => setGradeAmounts((prev) => ({ ...prev, [g.id]: e.target.value }))} className={inputCls} placeholder="0" />
                    <span className="text-sm text-slate-400 whitespace-nowrap">ج.م / شهر</span>
                  </div>
                </Field>
              ))}
              {stage.name === 'المرحلة الابتدائية' && (
                <div className="glass-light rounded-xl p-3 text-xs text-slate-400 flex items-center gap-2">
                  <Users size={14} className="text-[#d4af37]" /> الابتدائية مرحلة موحدة — يُنصح بتحديد نفس السعر لجميع الصفوف.
                </div>
              )}
            </div>
          ))}
          <Button onClick={async () => {
            setStageSaving(true);
            setStageError('');
            try {
              for (const stage of stages) {
                const grades = gradeLevelsByStage[stage.id] ?? [];
                const stageAmount = parseFloat(gradeAmounts[grades[0]?.id ?? ''] ?? '0') || 0;
                await updateStageBaseSubscription(stage.id, stageAmount);
                for (const g of grades) {
                  const amount = parseFloat(gradeAmounts[g.id] ?? '0') || 0;
                  await updateGradeLevelBaseSubscription(g.id, amount);
                  await syncStudentFeesToGradePrice(g.id, amount);
                }
              }
              setStageSaved(true);
              setTimeout(() => setStageSaved(false), 2000);
              await loadStages();
            } catch {
              setStageError('حدث خطأ أثناء الحفظ. حاول مرة أخرى.');
            } finally {
              setStageSaving(false);
            }
          }} disabled={stageSaving} className="w-full">
            {stageSaving ? 'جارٍ الحفظ...' : stageSaved ? <><Check size={16} /> تم الحفظ</> : <><Save size={16} /> حفظ الاشتراكات</>}
          </Button>
          {stageError && <p className="text-red-400 text-sm text-center">{stageError}</p>}
        </motion.div>
      </div>
      <Watermark />
    </div>
  );
}

const inputCls =
  'w-full glass-light rounded-xl py-2.5 px-4 text-white border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
