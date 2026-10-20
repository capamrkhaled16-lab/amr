import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, MessageCircle, CheckCircle2, XCircle, AlertTriangle, Loader2, Users } from 'lucide-react';
import type { Student, Settings } from '@/lib/types';
import { generateStudentReport, openWhatsAppForStudent, type SendResult } from '@/lib/whatsappReport';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { useSettings } from '@/context/SettingsContext';
import { useMonth } from '@/context/MonthContext';
import type { ReportMonthContext } from '@/lib/whatsappReport';

type BulkWhatsAppReportProps = {
  students: Student[];
  open: boolean;
  onClose: () => void;
};

export default function BulkWhatsAppReport({ students, open, onClose }: BulkWhatsAppReportProps) {
  const { settings } = useSettings();
  const { monthKey } = useMonth();
  const [phase, setPhase] = useState<'confirm' | 'sending' | 'done'>('confirm');
  const [results, setResults] = useState<SendResult[]>([]);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [sending, setSending] = useState(false);

  const studentsWithPhone = students.filter((s) => s.parent_phone);
  const studentsWithoutPhone = students.filter((s) => !s.parent_phone);

  const sendAll = useCallback(async () => {
    setPhase('sending');
    setSending(true);
    const allResults: SendResult[] = [];

    for (const s of studentsWithoutPhone) {
      allResults.push({
        studentId: s.id,
        studentName: s.name,
        status: 'no_phone',
        message: 'لا يوجد رقم WhatsApp مسجل لولي الأمر',
      });
      setResults([...allResults]);
    }

    for (let i = 0; i < studentsWithPhone.length; i++) {
      const s = studentsWithPhone[i];
      setCurrentIdx(i);
      try {
        const report = await generateStudentReport(s, settings as Settings, { monthKey, groupId: s.group_id } as ReportMonthContext);
        const ok = openWhatsAppForStudent(s, report);
        allResults.push({
          studentId: s.id,
          studentName: s.name,
          status: ok ? 'success' : 'error',
          message: ok ? 'تم فتح واتساب للإرسال' : 'تعذّر فتح واتساب',
        });
      } catch {
        allResults.push({
          studentId: s.id,
          studentName: s.name,
          status: 'error',
          message: 'تعذّر إنشاء التقرير',
        });
      }
      setResults([...allResults]);
      await new Promise((r) => setTimeout(r, 800));
    }

    setCurrentIdx(-1);
    setSending(false);
    setPhase('done');
  }, [studentsWithPhone, studentsWithoutPhone, settings]);

  function handleClose() {
    if (sending) return;
    onClose();
    setTimeout(() => {
      setPhase('confirm');
      setResults([]);
      setCurrentIdx(-1);
    }, 300);
  }

  const successCount = results.filter((r) => r.status === 'success').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const noPhoneCount = results.filter((r) => r.status === 'no_phone').length;

  return (
    <Modal open={open} onClose={handleClose} title="إرسال جماعي لتقارير واتساب" size="md">
      <div className="space-y-4">
        {phase === 'confirm' && (
          <div className="text-center py-4">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-green-500/15 flex items-center justify-center mb-4">
              <Users className="text-green-400" size={32} />
            </div>
            <p className="text-white font-bold text-lg mb-2">إرسال تقرير المستوى العام</p>
            <p className="text-sm text-slate-400 mb-4">
              سيتم إنشاء تقرير مستقل لكل طالب وإرساله إلى ولي أمره عبر واتساب.
            </p>
            <div className="glass-light rounded-xl p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">إجمالي الطلاب المحددين:</span>
                <span className="text-white font-bold">{students.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">لديهم رقم واتساب:</span>
                <span className="text-emerald-400 font-bold">{studentsWithPhone.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">بدون رقم مسجل:</span>
                <span className="text-amber-400 font-bold">{studentsWithoutPhone.length}</span>
              </div>
            </div>
            {studentsWithoutPhone.length > 0 && (
              <p className="text-xs text-amber-400 mt-3 flex items-center justify-center gap-1.5">
                <AlertTriangle size={14} />
                {studentsWithoutPhone.length} طالب بدون رقم — سيتم تخطيهم في الإرسال
              </p>
            )}
            <div className="flex gap-3 justify-center mt-5">
              <Button variant="secondary" onClick={handleClose}>إلغاء</Button>
              <Button onClick={sendAll} disabled={students.length === 0} className="bg-green-600 hover:bg-green-500">
                <Send size={16} /> بدء الإرسال ({studentsWithPhone.length})
              </Button>
            </div>
          </div>
        )}

        {phase === 'sending' && (
          <div className="py-4">
            <div className="text-center mb-4">
              <Loader2 className="mx-auto text-green-400 mb-3 animate-spin" size={32} />
              <p className="text-white font-bold">جارٍ إنشاء وإرسال التقارير...</p>
              <p className="text-sm text-slate-400 mt-1">
                {results.length} / {students.length} مكتمل
              </p>
            </div>
            <div className="w-full bg-slate-700/30 rounded-full h-2 overflow-hidden mb-4">
              <motion.div
                className="h-full bg-green-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(results.length / students.length) * 100}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1.5">
              <AnimatePresence>
                {results.map((r, i) => (
                  <ResultRow key={i} result={r} />
                ))}
              </AnimatePresence>
              {currentIdx >= 0 && currentIdx < studentsWithPhone.length && (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-1">
                  <Loader2 size={14} className="animate-spin text-green-400" />
                  جارٍ معالجة: {studentsWithPhone[currentIdx].name}
                </div>
              )}
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="py-4">
            <div className="text-center mb-4">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-green-500/15 flex items-center justify-center mb-3">
                <CheckCircle2 className="text-green-400" size={32} />
              </div>
              <p className="text-white font-bold text-lg">اكتمل الإرسال</p>
              <div className="flex items-center justify-center gap-4 mt-3 text-sm">
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 size={14} /> {successCount} نجح
                </span>
                {noPhoneCount > 0 && (
                  <span className="text-amber-400 font-bold flex items-center gap-1">
                    <AlertTriangle size={14} /> {noPhoneCount} بدون رقم
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="text-red-400 font-bold flex items-center gap-1">
                    <XCircle size={14} /> {errorCount} فشل
                  </span>
                )}
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1.5">
              {results.map((r, i) => (
                <ResultRow key={i} result={r} />
              ))}
            </div>
            <div className="flex justify-center mt-4">
              <Button onClick={handleClose}>إغلاق</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultRow({ result }: { result: SendResult }) {
  const icon = result.status === 'success'
    ? <CheckCircle2 size={16} className="text-emerald-400" />
    : result.status === 'no_phone'
      ? <AlertTriangle size={16} className="text-amber-400" />
      : <XCircle size={16} className="text-red-400" />;

  const color = result.status === 'success'
    ? 'text-emerald-400'
    : result.status === 'no_phone'
      ? 'text-amber-400'
      : 'text-red-400';

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-2 glass-light rounded-lg px-3 py-2 text-sm"
    >
      {icon}
      <span className="text-white font-medium flex-1">{result.studentName}</span>
      <span className={color + ' text-xs'}>{result.message}</span>
    </motion.div>
  );
}
