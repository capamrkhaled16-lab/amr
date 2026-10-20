import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Copy, Send, Phone, Link as LinkIcon, Check, Megaphone, X, Eye } from 'lucide-react';
import StudentViewModal from '@/components/ui/StudentViewModal';
import type { Student } from '@/lib/types';
import { fetchAllStudents, fetchStudentsByGroup, fetchMonthlySubscriptions, fetchAllMonthlyPaidMap, getMonthLabel, getMonthKey, resolvePaymentStatus, resolvePaymentStatusBatch } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { formatCurrency, normalizePhoneForWhatsApp, openWhatsAppURL } from '@/lib/format';
import WhatsAppReport from '@/components/modules/WhatsAppReport';

type ParentLinksModuleProps = {
  groupId?: string | null;
};

export default function ParentLinksModule({ groupId }: ParentLinksModuleProps) {
  const [students, setStudents] = useState<(Student & { group_name?: string; grade_name?: string; stage_name?: string })[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [whatsappTarget, setWhatsappTarget] = useState<Student | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifGroup, setNotifGroup] = useState<string>('all');
  const [notifStudents, setNotifStudents] = useState<(Student & { group_name?: string; grade_name?: string; stage_name?: string })[]>([]);
  const [monthlyPaidMap, setMonthlyPaidMap] = useState<Map<string, number>>(new Map());
  const [viewTarget, setViewTarget] = useState<Student | null>(null);

  const load = useCallback(async () => {
    if (groupId) {
      const { data: enriched } = await supabase
        .from('students')
        .select('*, group:groups(name, grade_level:grade_levels(name, stage:academic_stages(name)))')
        .eq('group_id', groupId)
        .eq('is_deleted', false)
        .order('name');
      if (enriched) {
        const mapped = (enriched as (Student & { group: { name: string; grade_level: { name: string; stage: { name: string } } } | null })[]).map((s) => ({
          ...s,
          group_name: s.group?.name,
          grade_name: s.group?.grade_level?.name,
          stage_name: s.group?.grade_level?.stage?.name,
        }));
        setStudents(mapped);
      } else {
        const data = await fetchStudentsByGroup(groupId);
        setStudents(data);
      }
    } else {
      const data = await fetchAllStudents();
      setStudents(data);
    }
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (students.length === 0) return;
    fetchAllMonthlyPaidMap().then(setMonthlyPaidMap).catch(() => {});
  }, [students, groupId]);

  function getPortalLink(student: Student): string {
    const baseUrl = window.location.origin;
    return `${baseUrl}/parent-portal?token=${student.parent_token}`;
  }

  async function copyLink(student: Student) {
    try {
      await navigator.clipboard.writeText(getPortalLink(student));
      setCopiedId(student.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = getPortalLink(student);
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedId(student.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  async function sendWhatsApp(student: Student) {
    const phone = student.parent_phone ?? student.phone;
    if (!phone) {
      alert('لا يوجد رقم هاتف لهذا الطالب');
      return;
    }
    const cleanPhone = normalizePhoneForWhatsApp(phone);
    const link = getPortalLink(student);

    const now = new Date();
    const monthKey = getMonthKey(now);
    const monthLabel = getMonthLabel(now);

    const status = await resolvePaymentStatus(student.id, monthKey, student.total_fees ?? 0, student.is_exempt);
    const isMonthPaid = status.isPaid;
    const monthRemaining = status.remaining;

    const financialText = isMonthPaid
      ? 'دفع كامل ✅'
      : monthRemaining >= (student.total_fees ?? 0)
        ? 'لم يدفع ❌'
        : 'سداد جزئي ⚠️';

    const message =
      `🌸 *ولي الأمر الكريم / عائلة ${student.name}*\n\n` +
      `يسعدنا متابعتكم الدورية لمستوى ابننا/ابنتنا خلال شهر *${monthLabel}*.\n\n` +
      `💰 *إيصالات الدفع:* ${financialText}${!isMonthPaid ? ` — المتبقي ${formatCurrency(monthRemaining)} ج.م` : ''}\n\n` +
      `📌 *تفاصيل الشهر (الحضور، الواجبات، السلوك والأكاديمي):*\n` +
      `${link}\n\n` +
      `✨ مع دائم التوفيق والتميز 🌟`;

    const text = encodeURIComponent(message);
    openWhatsAppURL(`https://wa.me/${cleanPhone}?text=${text}`);
  }

  const notifGroups = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of notifStudents) {
      if (s.group_id && s.group_name && !map.has(s.group_id)) {
        map.set(s.group_id, s.group_name);
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [notifStudents]);

  async function openNotifModal() {
    setNotifOpen(true);
    setNotifGroup('all');
    const data = await fetchAllStudents();
    setNotifStudents(data);
  }

  async function sendMassNotification() {
    const targets = notifGroup === 'all'
      ? notifStudents
      : notifStudents.filter((s) => s.group_id === notifGroup);
    if (targets.length === 0) {
      alert('لا توجد طلاب في المجموعة المحددة');
      return;
    }

    const now = new Date();
    const monthKey = getMonthKey(now);
    const monthLabel = getMonthLabel(now);
    const allIds = targets.map((s) => s.id);
    const studentInfoMap = new Map<string, { total_fees: number; is_exempt: boolean }>();
    for (const s of targets) {
      studentInfoMap.set(s.id, { total_fees: s.total_fees ?? 0, is_exempt: s.is_exempt });
    }
    const statusMap = await resolvePaymentStatusBatch(allIds, monthKey, studentInfoMap);

    let blocked = 0;
    let opened = 0;
    for (const student of targets) {
      const phone = student.parent_phone ?? student.phone;
      if (!phone) continue;
      const cleanPhone = normalizePhoneForWhatsApp(phone);
      const link = getPortalLink(student);

      const status = statusMap.get(student.id);
      const isMonthPaid = status?.isPaid ?? false;
      const monthRemaining = status?.remaining ?? 0;

      const financialText = isMonthPaid
        ? 'دفع كامل ✅'
        : monthRemaining >= (student.total_fees ?? 0)
          ? 'لم يدفع ❌'
          : 'سداد جزئي ⚠️';

      const message =
        `🌸 *ولي الأمر الكريم / عائلة ${student.name}*\n\n` +
        `يسعدنا متابعتكم الدورية لمستوى ابننا/ابنتنا خلال شهر *${monthLabel}*.\n\n` +
        `💰 *إيصالات الدفع:* ${financialText}${!isMonthPaid ? ` — المتبقي ${formatCurrency(monthRemaining)} ج.م` : ''}\n\n` +
        `📌 *تفاصيل الشهر (الحضور، الواجبات، السلوك والأكاديمي):*\n` +
        `${link}\n\n` +
        `✨ مع دائم التوفيق والتميز 🌟`;

      const text = encodeURIComponent(message);
      const result = openWhatsAppURL(`https://wa.me/${cleanPhone}?text=${text}`);
      if (!result.opened) blocked++;
      else opened++;
    }

    if (blocked > 0) {
      alert(`تم فتح ${opened} رابط واتساب، ولكن تم حظر ${blocked} نافذة منبثقة. يرجى السماح بالنوافذ المنبثقة لهذا الموقع وإعادة المحاولة.`);
    } else {
      setNotifOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-4 sm:p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">بوابة ولي الأمر وروابط التقارير</h2>
            <p className="text-xs text-slate-400 mt-1">
              لكل طالب رابط خاص يعرض ولي الأمر الحضور والدرجات والحالة المالية. انسخ الرابط أو أرسله عبر واتساب مباشرة.
            </p>
          </div>
          <button
            onClick={openNotifModal}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-1.5 shrink-0"
          >
            <Megaphone size={14} />
            <span className="hidden sm:inline">إرسال إشعار جماعي</span>
          </button>
        </div>

        {students.length === 0 ? (
          <div className="glass-light rounded-xl p-8 text-center text-slate-400">
            لا يوجد طلاب مسجلون.
          </div>
        ) : (
          <div className="space-y-3">
            {students.map((s) => {
              const remaining = (s.total_fees ?? 0) - (monthlyPaidMap.get(s.id) ?? 0);
              const isFull = s.is_exempt || remaining <= 0;
              return (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-light rounded-xl p-4"
                >
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-white text-sm">{s.name}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        ولي الأمر: {s.parent_phone ?? s.phone ?? '—'} • الحالة المالية:{' '}
                        <span className={isFull ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                          {isFull ? 'دفع كامل ✅' : `متبقي ${formatCurrency(remaining)} ج.م ⚠️`}
                        </span>
                      </p>
                      <div className="flex items-center gap-1.5 mt-2 text-[10px] text-slate-500">
                        <LinkIcon size={11} />
                        <span className="font-mono truncate max-w-xs">
                          {getPortalLink(s)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setViewTarget(s)}
                        className="px-3 py-2 glass-light hover:bg-sky-500/10 text-slate-300 hover:text-sky-400 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5"
                        title="عرض بيانات الطالب"
                      >
                        <Eye size={14} />
                        <span className="hidden sm:inline">عرض</span>
                      </button>
                      <button
                        onClick={() => copyLink(s)}
                        className="px-3 py-2 glass-light hover:bg-white/10 text-slate-200 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5"
                      >
                        {copiedId === s.id ? (
                          <><Check size={14} className="text-emerald-400" /> تم النسخ</>
                        ) : (
                          <><Copy size={14} /> نسخ الرابط</>
                        )}
                      </button>
                      <button
                        onClick={() => sendWhatsApp(s)}
                        className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
                      >
                        <Send size={14} />
                        <span className="hidden sm:inline">إرسال واتساب</span>
                      </button>
                      <button
                        onClick={() => setWhatsappTarget(s)}
                        className="px-3 py-2 glass-light hover:bg-green-500/10 text-slate-300 hover:text-green-400 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5"
                      >
                        <Phone size={14} />
                        <span className="hidden sm:inline">تقرير</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      <WhatsAppReport
        student={whatsappTarget ?? ({} as Student)}
        open={!!whatsappTarget}
        onClose={() => setWhatsappTarget(null)}
      />

      <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />

      {notifOpen && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 pointer-events-none">
          <div className="glass-card rounded-2xl p-4 sm:p-6 w-full max-w-lg space-y-4 pointer-events-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">إرسال إشعار جماعي</h3>
              <button
                onClick={() => setNotifOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">المجموعة المستهدفة</label>
                <select
                  value={notifGroup}
                  onChange={(e) => setNotifGroup(e.target.value)}
                  className="mt-1 w-full glass-light rounded-xl px-3 py-2 text-sm text-white outline-none"
                >
                  <option value="all">كل المجموعات</option>
                  {notifGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className="glass-light rounded-xl p-4 text-sm text-slate-300 leading-relaxed space-y-2">
                <p className="font-bold text-white">رسالة ذكية تلقائية:</p>
                <p>سيتم إرسال رسالة مخصصة لكل طالب تلقائياً تتضمن:</p>
                <ul className="list-disc pr-5 space-y-1 text-xs text-slate-400">
                  <li>اسم الطالب ورابطه المستقل لمتابعة الحضور والواجبات والسلوك</li>
                  <li>إذا كان الطالب مسدداً: رسالة ترحيبية راقية</li>
                  <li>إذا كان متأخراً: تذكير لطيف ومحترم بالمصروفات المستحقة للشهر الحالي</li>
                </ul>
              </div>

              <p className="text-[11px] text-slate-400">
                سيتم فتح رابط واتساب لكل ولي أمر في المجموعة المحددة. تأكد من السماح بالنوافذ المنبثقة لهذا الموقع.
              </p>

              <button
                onClick={sendMassNotification}
                className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2"
              >
                <Send size={16} />
                إرسال عبر واتساب
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
