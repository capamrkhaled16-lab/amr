import { useState } from 'react';
import { Send, FileText } from 'lucide-react';
import type { Student } from '@/lib/types';
import { normalizePhoneForWhatsApp, openWhatsAppURL } from '@/lib/format';
import { useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

type ManualReportModalProps = {
  student: Student | null;
  open: boolean;
  onClose: () => void;
};

export default function ManualReportModal({ student, open, onClose }: ManualReportModalProps) {
  const { showToast } = useToast();
  const [reportText, setReportText] = useState('');
  const [sending, setSending] = useState(false);

  function handleClose() {
    setReportText('');
    onClose();
  }

  function sendWhatsApp() {
    if (!student) return;
    if (!reportText.trim()) {
      showToast('اكتب التقرير أولاً', 'error');
      return;
    }

    const phone = student.parent_phone ?? student.phone;
    if (!phone) {
      showToast('لا يوجد رقم هاتف لولي أمر هذا الطالب', 'error');
      return;
    }

    setSending(true);
    try {
      const cleanPhone = normalizePhoneForWhatsApp(phone);
      if (!cleanPhone) {
        showToast('رقم الهاتف غير صحيح', 'error');
        setSending(false);
        return;
      }

      const header = `🌟 منصة الخالد التعليمية 🌟\n\nالطالب/ة: ${student.name}\n\n`;
      const fullMessage = header + reportText.trim() + '\n\n— مع تحيات تيم مستر عمرو خالد';
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(fullMessage)}`;
      openWhatsAppURL(url, showToast);
      showToast(`تم فتح واتساب لإرسال تقرير ${student.name}`, 'success');
      setReportText('');
      onClose();
    } catch {
      showToast('تعذّر فتح واتساب', 'error');
    } finally {
      setSending(false);
    }
  }

  if (!student) return null;

  const phone = student.parent_phone ?? student.phone;

  return (
    <Modal open={open} onClose={handleClose} title={`تقرير يدوي: ${student.name}`} size="md">
      <div className="space-y-4">
        <div className="glass-light rounded-xl p-3 flex items-center gap-2">
          <FileText size={16} className="text-emerald-400 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{student.name}</p>
            <p className="text-[11px] text-slate-400">
              {phone ? `سيتم الإرسال لولي الأمر: ${phone}` : 'لا يوجد رقم هاتف مسجل'}
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-2">اكتب التقرير يدوياً</label>
          <textarea
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            rows={8}
            placeholder="اكتب تقرير الطالب هنا..."
            className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition text-sm resize-none modal-body"
            style={{ minHeight: '160px' }}
          />
          <p className="text-[10px] text-slate-500 mt-1.5">
            سيتم إرسال النص المكتوب فقط (دون تعديل) عبر واتساب لرقم ولي الأمر المسجل لهذا الطالب.
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={handleClose}>إلغاء</Button>
          <Button
            onClick={sendWhatsApp}
            disabled={!reportText.trim() || sending || !phone}
            className="bg-green-600 hover:bg-green-500"
          >
            <Send size={16} />
            {sending ? 'جارٍ الفتح...' : 'إرسال واتساب'}
          </Button>
        </div>

        {!phone && (
          <p className="text-xs text-amber-400 text-center">
            لا يوجد رقم هاتف لولي الأمر مسجل لهذا الطالب — لن يمكن إرسال التقرير.
          </p>
        )}
      </div>
    </Modal>
  );
}
