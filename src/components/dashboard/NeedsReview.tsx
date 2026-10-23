import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  UserX,
  TrendingDown,
  UserPlus,
  Eye,
  RefreshCw,
  MessageSquare,
  ChevronDown,
  Calendar,
} from 'lucide-react';
import { fetchReviewItems, fetchAbsentSessions, type ReviewItem, type AbsentSessionDetail, DEFAULT_PARENT_REPORT_MESSAGE } from '@/lib/studentMonitoring';
import { StudentViewModal360 } from '@/components/ui/StudentViewModal360';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatArabicDate, openWhatsAppURL } from '@/lib/format';
import { useMonth } from '@/context/MonthContext';
import type { Student } from '@/lib/types';

type EnrichedStudent = Student & { group_name?: string; grade_name?: string; stage_name?: string };

type Props = {
  allStudents: EnrichedStudent[];
};

const TYPE_META: Record<ReviewItem['type'], { icon: typeof AlertCircle; color: string; bg: string }> = {
  inactive: { icon: UserX, color: 'text-red-400', bg: 'bg-red-500/10' },
  absence_streak: { icon: AlertCircle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  low_performance: { icon: TrendingDown, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  missing_data: { icon: AlertCircle, color: 'text-sky-400', bg: 'bg-sky-500/10' },
  new_student: { icon: UserPlus, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
};

export default function NeedsReview({ allStudents }: Props) {
  const { monthKey } = useMonth();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [viewStudent, setViewStudent] = useState<Student | null>(null);
  const [reportItem, setReportItem] = useState<ReviewItem | null>(null);
  const [reportMsg, setReportMsg] = useState('');
  const [absenceItem, setAbsenceItem] = useState<ReviewItem | null>(null);
  const [absentSessions, setAbsentSessions] = useState<AbsentSessionDetail[]>([]);
  const [absenceLoading, setAbsenceLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchReviewItems(allStudents, monthKey);
      setItems(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [allStudents, monthKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  const handleView = (item: ReviewItem) => {
    const student = allStudents.find((s) => s.id === item.studentId);
    if (student) setViewStudent(student);
  };

  const handleSendReport = (item: ReviewItem) => {
    const student = allStudents.find((s) => s.id === item.studentId);
    const msg = DEFAULT_PARENT_REPORT_MESSAGE.replace('[اسم الطالب]', item.studentName);
    setReportMsg(msg);
    setReportItem(item);
    void student;
  };

  const sendWhatsApp = () => {
    if (!reportItem) return;
    const student = allStudents.find((s) => s.id === reportItem.studentId);
    const phone = student?.parent_phone ?? '';
    const cleanPhone = phone.replace(/\D/g, '');
    const encoded = encodeURIComponent(reportMsg);
    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    openWhatsAppURL(url);
    setReportItem(null);
  };

  const handleViewSessions = async (item: ReviewItem) => {
    setAbsenceItem(item);
    setAbsentSessions([]);
    setAbsenceLoading(true);
    try {
      const sessions = await fetchAbsentSessions(item.studentId, monthKey);
      setAbsentSessions(sessions);
    } catch {
      setAbsentSessions([]);
    } finally {
      setAbsenceLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <AlertCircle size={18} className="text-amber-400" />
          <Skeleton className="h-5 w-40" />
        </div>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card rounded-2xl p-5 text-center">
        <AlertCircle className="mx-auto text-amber-400 mb-2" size={24} />
        <p className="text-sm text-slate-400 mb-3">تعذّر تحميل بيانات المراجعة.</p>
        <button onClick={load} className="text-sm font-bold text-emerald-400 hover:text-emerald-300 transition inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> إعادة المحاولة
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-5 text-center"
      >
        <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
          <AlertCircle size={24} className="text-emerald-400" />
        </div>
        <p className="text-sm font-bold text-white mb-1">لا يوجد طلاب يحتاجون مراجعة حاليًا</p>
        <p className="text-xs text-slate-400">جميع الطلاب في حالة جيدة.</p>
      </motion.div>
    );
  }

  const criticalCount = items.filter((i) => i.severity === 'critical').length;
  const warningCount = items.filter((i) => i.severity === 'warning').length;

  return (
    <>
      <div className="glass-card rounded-2xl overflow-hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <AlertCircle size={18} className="text-amber-400" />
            </div>
            <div className="text-right">
              <h3 className="text-sm font-bold text-white">يحتاجون مراجعة</h3>
              <p className="text-[11px] text-slate-400">
                {items.length} حالة
                {criticalCount > 0 && ` · ${criticalCount} حرجة`}
                {warningCount > 0 && ` · ${warningCount} تحذير`}
              </p>
            </div>
          </div>
          <ChevronDown size={18} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 space-y-2 max-h-[400px] overflow-y-auto modal-body">
                {items.map((item, idx) => {
                  const meta = TYPE_META[item.type];
                  const Icon = meta.icon;
                  return (
                    <motion.div
                      key={`${item.studentId}-${item.type}-${idx}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      className="glass-light rounded-xl p-3 flex items-start gap-3"
                    >
                      <div className={`w-8 h-8 rounded-lg ${meta.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Icon size={15} className={meta.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white leading-snug">{item.title}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{item.description}</p>
                        {item.groupName && (
                          <span className="inline-block text-[10px] text-slate-500 mt-1">{item.groupName}</span>
                        )}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <button
                            onClick={() => handleView(item)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition"
                          >
                            <Eye size={12} /> عرض الطالب
                          </button>
                          {(item.type === 'inactive' || item.type === 'absence_streak') && (
                            <button
                              onClick={() => handleViewSessions(item)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 hover:text-amber-300 transition"
                            >
                              <Calendar size={12} /> عرض الحصص
                            </button>
                          )}
                          {item.type === 'low_performance' && (
                            <button
                              onClick={() => handleSendReport(item)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-300 transition"
                            >
                              <MessageSquare size={12} /> متابعة لولي الأمر
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <StudentViewModal360
        open={!!viewStudent}
        student={viewStudent as EnrichedStudent | null}
        onClose={() => setViewStudent(null)}
      />

      {/* Parent report modal */}
      <AnimatePresence>
        {reportItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
            style={{ zIndex: 100001 }}
            onClick={() => setReportItem(null)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md glass-card rounded-2xl shadow-glass-lg overflow-hidden pointer-events-auto"
            >
              <div className="px-5 pt-5 pb-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <MessageSquare size={18} className="text-sky-400" />
                  <h3 className="text-sm font-bold text-white">إرسال متابعة لولي الأمر</h3>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">الطالب: {reportItem.studentName}</p>
              </div>
              <div className="px-5 py-4 space-y-3">
                <label className="block text-xs text-slate-400">الرسالة (قابلة للتعديل)</label>
                <textarea
                  value={reportMsg}
                  onChange={(e) => setReportMsg(e.target.value)}
                  rows={7}
                  dir="rtl"
                  className="w-full glass-light rounded-xl p-3 text-xs text-white border border-slate-700/50 focus:outline-none focus:ring-2 focus:ring-sky-500/50 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={sendWhatsApp}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition active:scale-95 flex items-center justify-center gap-2"
                  >
                    <MessageSquare size={15} /> إرسال عبر واتساب
                  </button>
                  <button
                    onClick={() => setReportItem(null)}
                    className="px-4 py-2.5 rounded-xl glass-light text-slate-400 text-sm font-bold hover:bg-white/5 transition active:scale-95"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Absence sessions detail modal */}
      <AnimatePresence>
        {absenceItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
            style={{ zIndex: 100002 }}
            onClick={() => setAbsenceItem(null)}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto" />
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md glass-card rounded-2xl shadow-glass-lg overflow-hidden max-h-[80vh] flex flex-col pointer-events-auto"
            >
              <div className="px-5 pt-5 pb-3 border-b border-white/[0.06] flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Calendar size={18} className="text-amber-400" />
                  <h3 className="text-sm font-bold text-white">حصص الغياب</h3>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">الطالب: {absenceItem.studentName}</p>
              </div>
              <div className="overflow-y-auto modal-body flex-1 px-5 py-4">
                {absenceLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="glass-light rounded-xl p-3 h-14" />
                    ))}
                  </div>
                ) : absentSessions.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-xs text-slate-400">لا توجد حصص غياب مطابقة.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {absentSessions.map((s, idx) => (
                      <div key={`${s.sessionId}-${idx}`} className="glass-light rounded-xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${(s.status === 'excused_absence' || s.status === 'excused') ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>
                            {(s.status === 'excused_absence' || s.status === 'excused') ? 'غائب بعذر' : 'غائب'}
                          </span>
                          <div>
                            <p className="text-xs font-bold text-white">
                              {s.sessionNumber ? `حصة ${s.sessionNumber}` : s.sessionTitle}
                            </p>
                            <p className="text-[10px] text-slate-400">{formatArabicDate(s.sessionDate)}{s.groupName ? ` — ${s.groupName}` : ''}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const student = allStudents.find((s) => s.id === absenceItem.studentId);
                        setAbsenceItem(null);
                        if (student) setViewStudent(student);
                      }}
                      className="w-full mt-2 py-2 rounded-xl glass-light text-emerald-400 text-xs font-bold hover:bg-emerald-500/10 transition flex items-center justify-center gap-1.5"
                    >
                      <Eye size={13} /> عرض الطالب
                    </button>
                  </div>
                )}
              </div>
              <div className="px-5 pb-4 flex-shrink-0 border-t border-white/[0.06] pt-3">
                <button
                  onClick={() => setAbsenceItem(null)}
                  className="w-full py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition text-sm font-semibold active:scale-95"
                >
                  إغلاق
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
