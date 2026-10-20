import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Pencil,
  LogIn,
  Calendar,
  Copy,
  Power,
  Check,
  Shield,
  Eye,
  Pencil as EditIcon,
  ChevronDown,
  Lock,
  Unlock,
} from 'lucide-react';
import type { Assistant, AssistantPermissions } from '@/lib/types';
import {
  fetchAssistants,
  createAssistant,
  updateAssistant,
  deleteAssistant,
} from '@/lib/data';
import { formatArabicDate } from '@/lib/format';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type PermGroup = {
  groupLabel: string;
  perms: { key: keyof AssistantPermissions; label: string; type: 'view' | 'edit' }[];
};

const PERM_GROUPS: PermGroup[] = [
  {
    groupLabel: 'الشهور (الإجمالي المالي)',
    perms: [
      { key: 'can_view_finance', label: 'رؤية الشهور', type: 'view' },
      { key: 'can_manage_subscriptions', label: 'تعديل الإجمالي', type: 'edit' },
      { key: 'can_view_subscriptions', label: 'رؤية إجمالي المجموعة', type: 'view' },
      { key: 'can_manage_exemptions', label: 'الإعفاءات والخصومات', type: 'edit' },
    ],
  },
  {
    groupLabel: 'الحضور',
    perms: [
      { key: 'can_view_attendance', label: 'رؤية الحضور', type: 'view' },
      { key: 'can_manage_attendance', label: 'تعديل الحضور', type: 'edit' },
    ],
  },
  {
    groupLabel: 'الطلاب',
    perms: [
      { key: 'can_view_students', label: 'رؤية الطلاب', type: 'view' },
      { key: 'can_manage_students', label: 'تعديل الطلاب', type: 'edit' },
    ],
  },
  {
    groupLabel: 'الامتحانات الإلكترونية',
    perms: [
      { key: 'can_view_exams', label: 'رؤية الامتحانات', type: 'view' },
      { key: 'can_manage_exams', label: 'تعديل الامتحانات', type: 'edit' },
      { key: 'can_edit_questions', label: 'تعديل الأسئلة', type: 'edit' },
      { key: 'can_live_monitor', label: 'المراقبة المباشرة', type: 'edit' },
      { key: 'can_grade_essay', label: 'تصحيح المقالي', type: 'edit' },
      { key: 'can_view_results_only', label: 'النتائج فقط', type: 'view' },
    ],
  },
  {
    groupLabel: 'الدرجات',
    perms: [
      { key: 'can_view_grades', label: 'رؤية الدرجات', type: 'view' },
      { key: 'can_edit_grades', label: 'تعديل الدرجات', type: 'edit' },
      { key: 'can_delete_evals', label: 'حذف التقييمات', type: 'edit' },
    ],
  },
  {
    groupLabel: 'الواجبات والسلوك',
    perms: [
      { key: 'can_view_tracking', label: 'رؤية الواجبات والسلوك', type: 'view' },
    ],
  },
  {
    groupLabel: 'الشهادات',
    perms: [
      { key: 'can_view_certificates', label: 'رؤية الشهادات', type: 'view' },
    ],
  },
  {
    groupLabel: 'أولياء الأمور',
    perms: [
      { key: 'can_view_parent_links', label: 'رؤية روابط أولياء الأمور', type: 'view' },
    ],
  },
  {
    groupLabel: 'قاعة المشاهير',
    perms: [
      { key: 'can_view_hall_of_fame', label: 'رؤية قاعة المشاهير', type: 'view' },
    ],
  },
  {
    groupLabel: 'التقارير',
    perms: [
      { key: 'can_print_reports', label: 'طباعة التقارير', type: 'edit' },
    ],
  },
];

const ALL_PERM_KEYS = PERM_GROUPS.flatMap((g) => g.perms.map((p) => p.key));

type FormState = {
  display_name: string;
  username: string;
  pin: string;
} & Record<keyof AssistantPermissions, boolean>;

function emptyForm(): FormState {
  const form: Partial<FormState> = {
    display_name: '',
    username: '',
    pin: '',
  };
  for (const key of ALL_PERM_KEYS) {
    (form as Record<string, boolean>)[key] = false;
  }
  return form as FormState;
}

function assistantToForm(a: Assistant): FormState {
  const form: Partial<FormState> = {
    display_name: a.display_name ?? '',
    username: a.username,
    pin: a.pin,
  };
  for (const key of ALL_PERM_KEYS) {
    (form as Record<string, boolean>)[key] = (a as Record<string, unknown>)[key] as boolean ?? false;
  }
  return form as FormState;
}

export default function AssistantsManager() {
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Assistant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Assistant | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Assistant | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [expandedPerms, setExpandedPerms] = useState<Set<string>>(new Set());
  const [savingPermId, setSavingPermId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchAssistants();
    setAssistants(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(a: Assistant) {
    setEditTarget(a);
    setForm(assistantToForm(a));
  }

  async function handleSave() {
    if (!form.username.trim() || !form.pin.trim()) return;
    const payload = {
      ...form,
      display_name: form.display_name.trim() || null,
      username: form.username.trim(),
      pin: form.pin.trim(),
    };
    setForm(emptyForm());
    setEditTarget(null);
    setAddOpen(false);
    try {
      if (editTarget) {
        await updateAssistant(editTarget.id, payload);
      } else {
        await createAssistant(payload);
      }
      load();
    } catch {
      // reload to revert on error
      load();
    }
  }

  function toggleActive(a: Assistant) {
    setAssistants((prev) => prev.map((ast) => ast.id === a.id ? { ...ast, is_active: !a.is_active } : ast));
    updateAssistant(a.id, { is_active: !a.is_active }).then(() => load()).catch(() => load());
  }

  function copyLoginLink(a: Assistant) {
    const link = `${window.location.origin}/assistant/login`;
    navigator.clipboard.writeText(link).catch(() => {});
    setCopiedId(a.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function togglePerm(key: keyof AssistantPermissions) {
    setForm((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleExpandedPerms(astId: string) {
    setExpandedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(astId)) next.delete(astId); else next.add(astId);
      return next;
    });
  }

  async function quickTogglePerm(ast: Assistant, key: keyof AssistantPermissions) {
    const newValue = !(ast as Record<string, unknown>)[key] as boolean;
    setAssistants((prev) => prev.map((a) => a.id === ast.id ? { ...a, [key]: newValue } as Assistant : a));
    setSavingPermId(`${ast.id}-${key}`);
    try {
      await updateAssistant(ast.id, { [key]: newValue } as Partial<Assistant>);
    } catch {
      setAssistants((prev) => prev.map((a) => a.id === ast.id ? { ...a, [key]: !newValue } as Assistant : a));
    } finally {
      setSavingPermId(null);
    }
  }

  async function quickToggleAllPerms(ast: Assistant, value: boolean) {
    const updates: Partial<Assistant> = {};
    for (const key of ALL_PERM_KEYS) (updates as Record<string, unknown>)[key] = value;
    setAssistants((prev) => prev.map((a) => a.id === ast.id ? { ...a, ...updates } as Assistant : a));
    setSavingPermId(`${ast.id}-all`);
    try {
      await updateAssistant(ast.id, updates);
    } catch {
      load();
    } finally {
      setSavingPermId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/10 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Shield className="text-emerald-400" size={20} /> إدارة المساعدين والصلاحيات
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              تحكم كامل في صلاحيات كل مساعد — فعّل أو أوقف رؤية وتعديل كل قسم على حدة.
            </p>
          </div>
          <Button size="sm" onClick={() => { setForm(emptyForm()); setAddOpen(true); }}>
            <Plus size={16} /> إضافة مساعد
          </Button>
        </div>

        {assistants.length === 0 ? (
          <div className="glass-light rounded-xl p-8 text-center text-slate-400">
            لا يوجد مساعدون بعد. أضف مساعدًا جديدًا لمنح صلاحيات محددة.
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {assistants.map((ast) => {
                const activePerms = PERM_GROUPS.flatMap((g) => g.perms).filter((p) => (ast as Record<string, unknown>)[p.key] as boolean);
                return (
                  <motion.div
                    key={ast.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="glass-light rounded-2xl p-5 space-y-4"
                  >
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg ${ast.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                          {(ast.display_name ?? ast.username).charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">{ast.display_name ?? ast.username}</span>
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${ast.is_active ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                              {ast.is_active ? 'نشط' : 'معطّل'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                            <span>{ast.username}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <LogIn size={11} /> {ast.pin}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-400">
                            <span>مرات الدخول: <strong className="text-white">{ast.logins_count ?? 0}</strong></span>
                            {ast.last_login_at && (
                              <span className="flex items-center gap-1">
                                <Calendar size={11} /> {formatArabicDate(ast.last_login_at)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => copyLoginLink(ast)}
                          className="p-2.5 glass-light hover:bg-white/10 rounded-xl text-slate-300 transition"
                          title="نسخ رابط الدخول"
                        >
                          {copiedId === ast.id ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                        </button>
                        <button
                          onClick={() => openEdit(ast)}
                          className="px-3 py-2 glass-light hover:bg-white/10 rounded-xl text-slate-300 text-xs font-bold flex items-center gap-1.5 transition"
                        >
                          <Pencil size={13} /> تعديل
                        </button>
                        <button
                          onClick={() => setToggleTarget(ast)}
                          className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                            ast.is_active
                              ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
                              : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                          }`}
                        >
                          <Power size={13} /> {ast.is_active ? 'تعطيل' : 'تفعيل'}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(ast)}
                          className="px-3 py-2 bg-red-600/10 border border-red-500/20 rounded-xl hover:bg-red-600/20 text-red-400 text-xs font-bold flex items-center gap-1.5 transition"
                        >
                          <Trash2 size={13} /> حذف
                        </button>
                      </div>
                    </div>

                    <div className="glass-light rounded-xl px-4 py-2.5 flex justify-between items-center text-[11px]">
                      <span className="text-emerald-400 truncate font-mono">
                        {window.location.origin}/assistant/login
                      </span>
                      <span className="text-slate-500 shrink-0">رابط دخول المساعد</span>
                    </div>

                    {/* Permission badges + inline quick toggle */}
                    <div className="pt-2 border-t border-white/10 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex flex-wrap gap-2">
                          {activePerms.length === 0 ? (
                            <span className="text-[11px] text-slate-500">لا توجد صلاحيات مفعّلة</span>
                          ) : (
                            activePerms.map((p) => (
                              <span
                                key={p.key}
                                className={`px-3 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1 ${
                                  p.type === 'view'
                                    ? 'bg-sky-500/10 border border-sky-500/20 text-sky-400'
                                    : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                                }`}
                              >
                                {p.type === 'view' ? <Eye size={10} /> : <EditIcon size={10} />}
                                {p.label}
                              </span>
                            ))
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => quickToggleAllPerms(ast, true)}
                            disabled={savingPermId === `${ast.id}-all`}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition disabled:opacity-50"
                            title="تفعيل كل الصلاحيات"
                          >
                            <Unlock size={11} className="inline ml-1" /> الكل
                          </button>
                          <button
                            onClick={() => quickToggleAllPerms(ast, false)}
                            disabled={savingPermId === `${ast.id}-all`}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
                            title="إيقاف كل الصلاحيات"
                          >
                            <Lock size={11} className="inline ml-1" /> لا شيء
                          </button>
                          <button
                            onClick={() => toggleExpandedPerms(ast.id)}
                            className={`p-1.5 rounded-lg glass-light text-slate-400 hover:text-white transition ${expandedPerms.has(ast.id) ? 'bg-emerald-500/10 text-emerald-400' : ''}`}
                            title="تحكم سريع في الصلاحيات"
                          >
                            <ChevronDown size={14} className={`transition-transform ${expandedPerms.has(ast.id) ? 'rotate-180' : ''}`} />
                          </button>
                        </div>
                      </div>

                      {/* Inline quick permission panel */}
                      <AnimatePresence>
                        {expandedPerms.has(ast.id) && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-2 pt-2">
                              {PERM_GROUPS.map((group) => (
                                <div key={group.groupLabel} className="glass-light rounded-lg p-2.5 space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-slate-300">{group.groupLabel}</span>
                                    <button
                                      onClick={() => {
                                        const allOn = group.perms.every((p) => (ast as Record<string, unknown>)[p.key] as boolean);
                                        const updates: Partial<Assistant> = {};
                                        for (const p of group.perms) (updates as Record<string, unknown>)[p.key] = !allOn;
                                        setAssistants((prev) => prev.map((a) => a.id === ast.id ? { ...a, ...updates } as Assistant : a));
                                        updateAssistant(ast.id, updates).then(() => load()).catch(() => load());
                                      }}
                                      className="text-[10px] font-bold px-2 py-0.5 rounded-md glass-light text-slate-400 hover:text-white transition"
                                    >
                                      {group.perms.every((p) => (ast as Record<string, unknown>)[p.key] as boolean) ? 'إيقاف الكل' : 'تفعيل الكل'}
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                    {group.perms.map((p) => {
                                      const isOn = (ast as Record<string, unknown>)[p.key] as boolean;
                                      const saving = savingPermId === `${ast.id}-${p.key}`;
                                      return (
                                        <button
                                          key={p.key}
                                          onClick={() => quickTogglePerm(ast, p.key)}
                                          disabled={saving}
                                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition disabled:opacity-50 ${
                                            isOn
                                              ? p.type === 'view'
                                                ? 'bg-sky-500/15 border border-sky-500/30 text-sky-400'
                                                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                                              : 'glass-light border border-white/10 text-slate-500'
                                          }`}
                                        >
                                          <span className="flex items-center gap-1 truncate">
                                            {p.type === 'view' ? <Eye size={10} /> : <EditIcon size={10} />}
                                            <span className="truncate">{p.label}</span>
                                          </span>
                                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${isOn ? (p.type === 'view' ? 'bg-sky-500 border-sky-500' : 'bg-emerald-500 border-emerald-500') : 'border-slate-600'}`}>
                                            {isOn && <Check size={9} className="text-white" />}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal
        open={addOpen || !!editTarget}
        onClose={() => { setAddOpen(false); setEditTarget(null); setForm(emptyForm()); }}
        title={editTarget ? 'تعديل المساعد والصلاحيات' : 'إضافة مساعد جديد'}
      >
        <div className="space-y-4">
          {/* Account info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">الاسم المعروض</label>
              <input type="text" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="مثال: محمد إبراهيم" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1.5">اسم المستخدم</label>
              <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="username" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">الرقم السري (PIN)</label>
            <input type="text" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} placeholder="••••" inputMode="numeric" className={`${inputCls} w-32`} />
          </div>

          {/* Permission groups */}
          <div className="border-t border-white/10 pt-4">
            <label className="block text-sm font-bold text-white mb-3 flex items-center gap-2">
              <Shield size={16} className="text-emerald-400" /> الصلاحيات التفصيلية
            </label>
            <div className="space-y-3 max-h-96 overflow-y-auto modal-body pl-1">
              {PERM_GROUPS.map((group) => {
                const groupPerms = group.perms;
                const allOn = groupPerms.every((p) => form[p.key]);
                return (
                  <div key={group.groupLabel} className="glass-light rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300">{group.groupLabel}</span>
                      <button
                        onClick={() => {
                          const updates: Partial<FormState> = {};
                          for (const p of groupPerms) updates[p.key] = !allOn;
                          setForm((prev) => ({ ...prev, ...updates }));
                        }}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-lg transition ${allOn ? 'bg-emerald-500/15 text-emerald-400' : 'glass-light text-slate-400'}`}
                      >
                        {allOn ? 'الكل مفعّل' : 'تحديد الكل'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {groupPerms.map((p) => (
                        <button
                          key={p.key}
                          onClick={() => togglePerm(p.key)}
                          className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition ${
                            form[p.key]
                              ? p.type === 'view'
                                ? 'bg-sky-500/15 border border-sky-500/30 text-sky-400'
                                : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                              : 'glass-light border border-white/10 text-slate-400'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {p.type === 'view' ? <Eye size={12} /> : <EditIcon size={12} />}
                            {p.label}
                          </span>
                          <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${form[p.key] ? (p.type === 'view' ? 'bg-sky-500 border-sky-500 text-white' : 'bg-emerald-500 border-emerald-500 text-white') : 'border-slate-600'}`}>
                            {form[p.key] ? <Check size={10} /> : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2 border-t border-white/10">
            <Button variant="secondary" onClick={() => { setAddOpen(false); setEditTarget(null); setForm(emptyForm()); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={!form.username.trim() || !form.pin.trim()}>
              {editTarget ? 'حفظ التعديلات' : 'إضافة'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { const target = deleteTarget; setAssistants((prev) => prev.filter((a) => a.id !== target.id)); setDeleteTarget(null); deleteAssistant(target.id).then(() => load()).catch(() => load()); } }}
        title="⚠️ حذف المساعد"
        subtext={`سيتم حذف المساعد «${deleteTarget?.display_name ?? deleteTarget?.username ?? ''}» نهائيًا.`}
        confirmLabel="تأكيد الحذف"
      />

      <ConfirmDialog
        open={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        onConfirm={() => { if (toggleTarget) toggleActive(toggleTarget); }}
        title={toggleTarget?.is_active ? 'تعطيل المساعد' : 'تفعيل المساعد'}
        subtext={toggleTarget?.is_active
          ? `سيتم تعطيل وصول المساعد «${toggleTarget?.display_name ?? toggleTarget?.username}» — لن يتمكن من تسجيل الدخول.`
          : `سيتم إعادة تفعيل المساعد «${toggleTarget?.display_name ?? toggleTarget?.username}».`
        }
        confirmLabel={toggleTarget?.is_active ? 'تأكيد التعطيل' : 'تأكيد التفعيل'}
        variant={toggleTarget?.is_active ? 'danger' : 'primary'}
      />
    </div>
  );
}

const inputCls =
  'w-full glass-light rounded-xl py-2.5 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm';
