import { useState } from 'react';
import { MessageCircle, Send, AlertTriangle, Loader2, FileText, X } from 'lucide-react';
import type { Student } from '@/lib/types';
import { useSettings } from '@/context/SettingsContext';
import { useMonth } from '@/context/MonthContext';
import { generateStudentReport, openWhatsAppForStudent, validateStudentMonthData, type MissingComponent, type ReportMonthContext } from '@/lib/whatsappReport';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

type WhatsAppReportProps = {
  student: Student;
  open: boolean;
  onClose: () => void;
};

export default function WhatsAppReport({ student, open, onClose }: WhatsAppReportProps) {
  const { settings } = useSettings();
  const { monthKey } = useMonth();
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [validationGaps, setValidationGaps] = useState<MissingComponent[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [proceedDespiteGaps, setProceedDespiteGaps] = useState(false);

  async function runValidation(): Promise<boolean> {
    setValidating(true);
    try {
      const result = await validateStudentMonthData(student.id, student.group_id, monthKey);
      setValidationGaps(result.hasGaps ? result.gaps : []);
      return result.hasGaps;
    } catch {
      setValidationGaps([]);
      return false;
    } finally {
      setValidating(false);
    }
  }

  async function generate() {
    if (!proceedDespiteGaps) {
      const hasGaps = await runValidation();
      if (hasGaps) return;
    }
    setLoading(true);
    try {
      const monthContext: ReportMonthContext = { monthKey, groupId: student.group_id };
      const text = await generateStudentReport(student, settings, monthContext);
      setReport(text);
    } catch {
      setReport('تعذّر إنشاء التقرير');
    }
    setLoading(false);
  }

  function sendWhatsApp() {
    if (sent) return;
    if (openWhatsAppForStudent(student, report)) setSent(true);
  }

  function handleClose() {
    setReport('');
    setSent(false);
    setValidationGaps(null);
    setProceedDespiteGaps(false);
    onClose();
  }

  function proceedAnyway() {
    setProceedDespiteGaps(true);
    setValidationGaps(null);
    void generate();
  }

  function cancelValidation() {
    setValidationGaps(null);
  }

  const hasPhone = !!student.parent_phone;

  const [y, m] = monthKey.split('-').map(Number);
  const monthLabel = `${['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][m - 1] ?? monthKey} ${y}`;

  return (
    <Modal open={open} onClose={handleClose} title={`تقرير واتساب: ${student.name}`}>
      <div className="space-y-4">
        {/* Month context indicator */}
        <div className="glass-light rounded-xl p-3 flex items-center gap-2 text-sm">
          <FileText size={16} className="text-emerald-400 flex-shrink-0" />
          <span className="text-slate-300">
            سيتم إنشاء التقرير لشهر <span className="font-bold text-white">{monthLabel}</span>
          </span>
        </div>

        {/* Smart validation warning */}
        {validationGaps && validationGaps.length > 0 && (
          <div className="rounded-2xl p-5 bg-amber-500/10 border-2 border-amber-500/30">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-amber-400" />
              <h3 className="text-sm font-bold text-amber-300">تنبيه ذكي</h3>
            </div>
            <p className="text-sm text-slate-300 mb-1">
              الطالب: <span className="font-bold text-white">{student.name}</span>
            </p>
            <p className="text-sm text-slate-300 mb-3">
              الشهر: <span className="font-bold text-white">{monthLabel}</span>
            </p>
            <p className="text-sm text-amber-200 mb-2">يوجد نقص في البيانات:</p>
            <ul className="space-y-1.5 mb-4">
              {validationGaps.map((gap, i) => (
                <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                  <span className="text-amber-400 mt-0.5">•</span>
                  <span>
                    <span className="font-semibold text-amber-200">{gap.label}:</span> {gap.detail}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-400 mb-4">هل تريد استكمال البيانات أم المتابعة رغم وجود النقص؟</p>
            <div className="flex gap-2 flex-wrap">
              <Button variant="secondary" onClick={cancelValidation} className="text-xs">
                استكمال البيانات
              </Button>
              <Button onClick={proceedAnyway} className="bg-amber-600 hover:bg-amber-500 text-xs">
                المتابعة رغم النقص
              </Button>
              <Button variant="secondary" onClick={handleClose} className="text-xs">
                <X size={14} /> إلغاء
              </Button>
            </div>
          </div>
        )}

        {!report && !validationGaps && (
          <div className="text-center py-6">
            <MessageCircle className="mx-auto text-green-400 mb-4" size={48} />
            <p className="text-slate-400 mb-4">
              سيتم إنشاء تقرير شامل عن الحضور والدرجات لشهر {monthLabel} وإرساله عبر واتساب لولي الأمر.
            </p>
            {validating ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                <Loader2 size={16} className="animate-spin text-emerald-400" />
                جارٍ التحقق من اكتمال البيانات...
              </div>
            ) : (
              <Button onClick={generate} disabled={loading}>
                {loading ? 'جارٍ الإنشاء...' : 'إنشاء التقرير'}
              </Button>
            )}
          </div>
        )}

        {report && (
          <>
            <div className="glass-light rounded-xl p-4 max-h-60 overflow-y-auto">
              <pre className="text-sm text-slate-200 whitespace-pre-wrap font-sans">{report}</pre>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => { setReport(''); setProceedDespiteGaps(false); }}>تعديل</Button>
              <Button onClick={sendWhatsApp} disabled={!hasPhone || sent} className="bg-green-600 hover:bg-green-500">
                <Send size={16} /> {sent ? 'تم فتح واتساب' : 'إرسال عبر واتساب'}
              </Button>
            </div>
            {!hasPhone && (
              <p className="text-xs text-amber-400 text-center">لا يوجد رقم WhatsApp مسجل لولي الأمر — لن يمكن إرسال التقرير.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
