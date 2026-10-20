import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { Plus, X, Users, Pencil, Calendar, Bell, Send, FolderPlus, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Group } from '@/lib/types';
import { createGroup, deleteGroup, updateGroup, fetchStudentsByGroup } from '@/lib/data';
import { normalizePhoneForWhatsApp, openWhatsAppURL } from '@/lib/format';

type GroupManagerProps = {
  gradeLevelId: string;
  groups: Group[];
  loading?: boolean;
  selectedGroupId: string | null;
  onSelect: (group: Group) => void;
  onRefresh: () => void;
};

export default function GroupManager({
  gradeLevelId,
  groups,
  loading = false,
  selectedGroupId,
  onSelect,
  onRefresh,
}: GroupManagerProps) {
  const { showToast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null);
  const [editTarget, setEditTarget] = useState<Group | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // Mass notification state
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [notifyResult, setNotifyResult] = useState<{
    sent: { name: string; phone: string }[];
    skipped: { name: string; reason: string }[];
  } | null>(null);

  async function handleAdd() {
    if (!newLabel.trim()) return;
    showToast('تمت إضافة المجموعة بنجاح', 'success');
    setNewLabel('');
    setAddOpen(false);
    setSaving(false);
    createGroup(gradeLevelId, newLabel.trim(), null).then(() => onRefresh()).catch(() => showToast('تعذّر إضافة المجموعة', 'error'));
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    showToast('تم حذف المجموعة', 'success');
    setDeleteTarget(null);
    deleteGroup(deleteTarget.id).then(() => onRefresh()).catch(() => showToast('تعذّر حذف المجموعة', 'error'));
  }

  function openEdit(group: Group) {
    setEditTarget(group);
    setEditLabel(group.name);
  }

  async function handleEdit() {
    if (!editTarget || !editLabel.trim()) return;
    showToast('تم حفظ التعديلات', 'success');
    setEditTarget(null);
    setSaving(false);
    updateGroup(editTarget.id, { name: editLabel.trim(), schedule: null }).then(() => onRefresh()).catch(() => showToast('تعذّر حفظ التعديلات', 'error'));
  }

  async function openNotify() {
    const activeGroup = groups.find((g) => g.id === selectedGroupId);
    if (!activeGroup) return;
    setNotifyMessage(
      `مرحباً أولياء أمور مجموعة ${activeGroup.name}،\nنود إعلامكم بمستجدات الحصة القادمة.`
    );
    setNotifyResult(null);
    setNotifyOpen(true);
  }

  async function sendNotify() {
    const activeGroup = groups.find((g) => g.id === selectedGroupId);
    if (!activeGroup || !notifyMessage.trim()) return;
    setNotifyLoading(true);
    const students = await fetchStudentsByGroup(activeGroup.id);

    const sent: { name: string; phone: string }[] = [];
    const skipped: { name: string; reason: string }[] = [];

    for (const student of students) {
      const phone = student.parent_phone ?? student.phone;
      if (!phone) {
        skipped.push({ name: student.name, reason: 'لا يوجد رقم هاتف' });
        continue;
      }
      const cleanPhone = normalizePhoneForWhatsApp(phone);
      const text = encodeURIComponent(notifyMessage.trim());
      openWhatsAppURL(`https://wa.me/${cleanPhone}?text=${text}`, showToast);
      sent.push({ name: student.name, phone });
    }

    setNotifyLoading(false);
    setNotifyResult({ sent, skipped });
    if (sent.length > 0) {
      showToast(`تم فتح ${sent.length} محادثة واتساب للإرسال`, 'success');
    }
  }

  const activeGroup = groups.find((g) => g.id === selectedGroupId);
  const useCarousel = groups.length > 2;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-500/15 flex items-center justify-center ring-1 ring-teal-500/20">
            <Users className="text-teal-600" size={18} />
          </div>
          <h3 className="text-lg font-bold text-white">المجموعات</h3>
          {groups.length > 0 && (
            <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {groups.length}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {activeGroup && (
            <button
              onClick={openNotify}
              title="إشعار جماعي للمجموعة المحددة"
              className="w-9 h-9 rounded-xl bg-teal-500/15 ring-1 ring-teal-500/20 flex items-center justify-center text-teal-600 hover:bg-teal-500/25 hover:ring-teal-500/40 transition active:scale-90"
            >
              <Bell size={18} />
            </button>
          )}
          <button
            onClick={() => setAddOpen(true)}
            title="إضافة مجموعة"
            aria-label="إضافة مجموعة"
            className="w-9 h-9 rounded-xl bg-teal-500/15 ring-1 ring-teal-500/20 flex items-center justify-center text-teal-600 hover:bg-teal-500/25 hover:ring-teal-500/40 transition active:scale-90"
          >
            <Plus size={18} strokeWidth={2.5} className="shrink-0" />
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {loading && groups.length === 0 ? (
          <div className={useCarousel ? 'flex flex-row gap-4 overflow-x-auto pb-3' : 'flex flex-row gap-4'}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="rounded-2xl min-w-[200px] flex-1 h-[120px] shimmer bg-slate-100/60"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="glass-card rounded-2xl p-10 text-center"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-100 to-cyan-100 flex items-center justify-center ring-1 ring-teal-200/50">
                <FolderPlus className="text-teal-500" size={28} />
              </div>
              <div>
                <p className="text-slate-200 font-semibold text-sm mb-1">لا توجد مجموعات بعد</p>
                <p className="text-slate-400 text-xs">ابدأ بإنشاء أول مجموعة لتنظيم طلابك</p>
              </div>
              <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5 active:scale-95 transition">
                <Sparkles size={14} />
                إضافة مجموعة جديدة
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={
              useCarousel
                ? 'flex flex-row gap-4 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory scroll-smooth'
                : 'flex flex-row gap-4'
            }
          >
            {groups.map((group, idx) => {
              const isActive = selectedGroupId === group.id;
              return (
                <motion.div
                  key={group.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelect(group)}
                  className={`group relative rounded-2xl cursor-pointer overflow-hidden transition-all duration-300 min-w-[200px] flex-shrink-0 snap-start ${
                    useCarousel ? 'flex-1' : 'flex-1'
                  } ${
                    isActive
                      ? 'ring-2 ring-teal-500 shadow-lg shadow-teal-200/60 bg-gradient-to-br from-teal-50/90 to-cyan-50/70'
                      : 'glass-card glass-card-hover hover:ring-1 hover:ring-teal-300/40 hover:shadow-md'
                  }`}
                >
                  {/* Active accent glow */}
                  {isActive && (
                    <div className="absolute -top-12 -left-12 w-40 h-40 rounded-full bg-gradient-to-br from-teal-400/25 to-transparent blur-3xl opacity-80 pointer-events-none" />
                  )}

                  {/* Active check badge */}
                  {isActive && (
                    <div className="absolute top-2 right-2 z-10">
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500 text-white text-[10px] font-bold shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        نشطة
                      </div>
                    </div>
                  )}

                  {/* Mini action icons — top-left corner, tiny */}
                  <div className="absolute top-2 left-2 flex gap-0.5 z-10 opacity-60 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(group); }}
                      className={`p-1 rounded-md transition-all ${
                        isActive
                          ? 'text-teal-700 hover:bg-teal-500/15'
                          : 'text-slate-300 hover:text-teal-400 hover:bg-teal-500/10'
                      }`}
                      title="تعديل"
                    >
                      <Pencil size={11} strokeWidth={2.5} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(group); }}
                      className={`p-1 rounded-md transition-all ${
                        isActive
                          ? 'text-teal-700 hover:bg-teal-500/15'
                          : 'text-slate-300 hover:text-red-400 hover:bg-red-500/10'
                      }`}
                      title="حذف المجموعة"
                    >
                      <X size={11} strokeWidth={2.5} />
                    </button>
                  </div>

                  {/* Card content — centered, wide, readable */}
                  <div className="px-6 py-7 pl-10 flex flex-col items-center justify-center text-center min-h-[96px]">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <Calendar size={18} className={`flex-shrink-0 ${isActive ? 'text-teal-400' : 'text-teal-500/80'}`} />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">مجموعة</span>
                    </div>
                    <h4
                      className={`font-bold text-lg leading-relaxed ${isActive ? 'text-white' : 'text-slate-100'}`}
                      style={{ overflowWrap: 'normal', wordBreak: 'keep-all', whiteSpace: 'normal' }}
                    >
                      {group.name}
                    </h4>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Group Modal — single field */}
      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setNewLabel('');
        }}
        title="إضافة مجموعة جديدة"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              موعد المجموعة
            </label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="مثال: السبت والثلاثاء الساعة 6"
              autoFocus
              className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-400 border border-white/[0.06] focus:border-teal-500/50 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setAddOpen(false);
                setNewLabel('');
              }}
            >
              إلغاء
            </Button>
            <Button variant="primary" onClick={handleAdd} disabled={saving || !newLabel.trim()}>
              {saving ? 'جارٍ الحفظ...' : 'تأكيد الإضافة'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Group Modal — single field */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="تعديل المجموعة"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-2">
              موعد المجموعة
            </label>
            <input
              type="text"
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="مثال: السبت والثلاثاء الساعة 6"
              autoFocus
              className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-400 border border-white/[0.06] focus:border-teal-500/50 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition"
              onKeyDown={(e) => e.key === 'Enter' && handleEdit()}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setEditTarget(null)}>إلغاء</Button>
            <Button onClick={handleEdit} disabled={saving || !editLabel.trim()}>
              {saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Mass Notification Modal */}
      <Modal
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        title={`إشعار جماعي: ${activeGroup?.name ?? ''}`}
        size="md"
      >
        <div className="space-y-4">
          {!notifyResult ? (
            <>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-50 border border-teal-200/60">
                <Users size={15} className="text-teal-600 flex-shrink-0" />
                <p className="text-xs text-teal-700">
                  سيتم إرسال الإشعار تلقائياً لجميع طلاب المجموعة المحددة عبر واتساب.
                </p>
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-2">
                  نص الرسالة
                </label>
                <textarea
                  value={notifyMessage}
                  onChange={(e) => setNotifyMessage(e.target.value)}
                  placeholder="اكتب رسالتك هنا..."
                  rows={6}
                  autoFocus
                  className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-400 border border-white/[0.06] focus:border-teal-500/50 focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition resize-none leading-relaxed"
                />
                <p className="text-xs text-slate-400 mt-1.5">
                  يمكنك تعديل النص بحرية تامة قبل الإرسال — كل رسالة تُرسل بشكل مستقل لكل ولي أمر.
                </p>
              </div>
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" onClick={() => setNotifyOpen(false)}>
                  إلغاء
                </Button>
                <Button
                  onClick={sendNotify}
                  disabled={notifyLoading || !notifyMessage.trim()}
                  className="bg-green-600 hover:bg-green-500"
                >
                  {notifyLoading ? (
                    'جارٍ الإرسال...'
                  ) : (
                    <>
                      <Send size={16} />
                      إرسال للجميع
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-green-50 border border-green-200/60">
                  <Send size={16} className="text-green-600 flex-shrink-0" />
                  <p className="text-sm text-green-700 font-semibold">
                    تم فتح {notifyResult.sent.length} محادثة واتساب للإرسال
                  </p>
                </div>

                {notifyResult.sent.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-300 mb-2">
                      تم الإرسال ({notifyResult.sent.length}):
                    </p>
                    <div className="glass-light rounded-xl p-3 max-h-40 overflow-y-auto space-y-1.5">
                      {notifyResult.sent.map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-slate-700 font-medium">{s.name}</span>
                          <span className="text-slate-400 font-mono" dir="ltr">{s.phone}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {notifyResult.skipped.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-amber-600 mb-2">
                      لم يُرسل ({notifyResult.skipped.length}):
                    </p>
                    <div className="glass-light rounded-xl p-3 max-h-32 overflow-y-auto space-y-1.5">
                      {notifyResult.skipped.map((s, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-slate-700 font-medium">{s.name}</span>
                          <span className="text-amber-500">{s.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNotifyResult(null);
                    setNotifyMessage('');
                  }}
                >
                  إرسال رسالة أخرى
                </Button>
                <Button onClick={() => setNotifyOpen(false)}>إغلاق</Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="⚠️ تحذير: حذف المجموعة"
        subtext="هل أنت متأكد من حذف هذه المجموعة؟ سيؤدي ذلك إلى فك ربط جميع بيانات الطلاب الحالية المنسوبة لهذه المجموعة."
        confirmLabel="تأكيد الحذف النهائي"
      />
    </div>
  );
}
