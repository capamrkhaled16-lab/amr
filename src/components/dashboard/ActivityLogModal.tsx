import { useState, useEffect, useCallback } from 'react';
import Modal from '@/components/ui/Modal';
import { fetchAuditLogs, fetchRecentStudents } from '@/lib/data';
import { formatCurrency, formatArabicDate, formatTime, formatTransactionDateTime } from '@/lib/format';
import { History, RefreshCw, UserPlus, Users, Clock, Trash2, CreditCard, ClipboardCheck, Award, BookOpen, UserCog, FileText } from 'lucide-react';
import type { AuditLog, Student } from '@/lib/types';
import { Skeleton } from '@/components/ui/Skeleton';

type Props = {
  open: boolean;
  onClose: () => void;
};

type Tab = 'activity' | 'new-students';

const ACTION_META: Record<string, { label: string; icon: typeof CreditCard; color: string }> = {
  payment_create: { label: 'تسجيل دفعة', icon: CreditCard, color: 'bg-emerald-500/15 text-emerald-400' },
  payment_delete: { label: 'حذف دفعة', icon: Trash2, color: 'bg-red-500/15 text-red-400' },
  attendance_mark: { label: 'تسجيل حضور', icon: ClipboardCheck, color: 'bg-blue-500/15 text-blue-400' },
  grade_update: { label: 'تعديل درجة', icon: Award, color: 'bg-amber-500/15 text-amber-400' },
  student_create: { label: 'إضافة طالب', icon: UserPlus, color: 'bg-emerald-500/15 text-emerald-400' },
  student_update: { label: 'تعديل بيانات طالب', icon: UserCog, color: 'bg-sky-500/15 text-sky-400' },
  student_delete: { label: 'حذف طالب', icon: Trash2, color: 'bg-red-500/15 text-red-400' },
  subscription_pay: { label: 'سداد اشتراك', icon: CreditCard, color: 'bg-emerald-500/15 text-emerald-400' },
  subscription_archive: { label: 'أرشفة اشتراك', icon: FileText, color: 'bg-amber-500/15 text-amber-400' },
  exam_create: { label: 'إنشاء امتحان', icon: FileText, color: 'bg-blue-500/15 text-blue-400' },
  exam_publish: { label: 'نشر امتحان', icon: FileText, color: 'bg-blue-500/15 text-blue-400' },
  certificate_issue: { label: 'إصدار شهادة', icon: Award, color: 'bg-amber-500/15 text-amber-400' },
  behavior_eval: { label: 'تقييم سلوك', icon: BookOpen, color: 'bg-pink-500/15 text-pink-400' },
  homework_status: { label: 'تسجيل واجب', icon: BookOpen, color: 'bg-cyan-500/15 text-cyan-400' },
};

function formatTimeAgo(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return '—';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `منذ ${days} يوم`;
  return new Date(iso).toLocaleDateString('ar-EG');
}

function dayLabel(enrollmentDate: string): { label: string; color: string } {
  if (!enrollmentDate) return { label: '—', color: 'text-slate-400' };
  const diff = (Date.now() - new Date(enrollmentDate).getTime()) / 86400000;
  if (isNaN(diff)) return { label: '—', color: 'text-slate-400' };
  if (diff < 1) return { label: 'اليوم', color: 'text-emerald-400' };
  if (diff < 2) return { label: 'أمس', color: 'text-sky-400' };
  if (diff <= 14) return { label: `منذ ${Math.floor(diff)} يوم`, color: 'text-amber-400' };
  return { label: formatArabicDate(enrollmentDate), color: 'text-slate-400' };
}

export default function ActivityLogModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('activity');
  const [logs, setLogs] = useState<(AuditLog & { student?: { name: string; group?: { name: string; grade_level?: { name: string; stage?: { name: string } } } } })[]>([]);
  const [recentStudents, setRecentStudents] = useState<(Student & { group_name?: string; grade_name?: string; stage_name?: string })[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [logData, recentData] = await Promise.all([
        fetchAuditLogs(150),
        fetchRecentStudents(14),
      ]);
      setLogs(logData);
      setRecentStudents(recentData);
    } catch {
      setLogs([]);
      setRecentStudents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Modal open={open} onClose={onClose} title="سجل النشاطات والعمليات" size="lg">
      <div className="space-y-3">
        {/* Tab switcher */}
        <div className="flex gap-1 glass-light rounded-xl p-1">
          <button
            onClick={() => setTab('activity')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${tab === 'activity' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400 hover:text-slate-300'}`}
          >
            <History size={14} />
            سجل العمليات
          </button>
          <button
            onClick={() => setTab('new-students')}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${tab === 'new-students' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400 hover:text-slate-300'}`}
          >
            <UserPlus size={14} />
            الطلاب الجدد
            {recentStudents.length > 0 && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">{recentStudents.length}</span>
            )}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            {tab === 'activity' ? (
              <><History size={14} className="text-emerald-400" /> سجل لحظي لكل العمليات الهامة في المنصة</>
            ) : (
              <><UserPlus size={14} className="text-emerald-400" /> الطلاب المسجلون خلال آخر 14 يوم</>
            )}
          </p>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass-light hover:bg-white/10 text-slate-300 hover:text-emerald-400 transition text-xs font-bold disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-light rounded-xl p-3 flex items-center gap-3">
                <Skeleton className="w-9 h-9 rounded-xl flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-3 w-16 flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : tab === 'activity' ? (
          logs.length === 0 ? (
            <p className="text-center text-slate-400 py-8">لا توجد عمليات مسجلة بعد.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 modal-body">
              {logs.map((log) => {
                const meta = ACTION_META[log.action_type] ?? { label: log.action_type, icon: FileText, color: 'bg-slate-500/15 text-slate-400' };
                const Icon = meta.icon;
                return (
                  <div key={log.id} className="glass-light rounded-xl p-3 flex items-start gap-3 hover:bg-white/[0.08] transition-colors">
                    <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${meta.color}`}>
                      <Icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-sm">{meta.label}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full glass-light text-slate-400 flex items-center gap-1">
                          <UserCog size={9} /> {log.actor_name} ({log.actor_role === 'master' ? 'مدرس' : 'مساعد'})
                        </span>
                      </div>
                      {log.student?.name && (
                        <div className="mt-1 space-y-0.5">
                          <p className="text-xs text-slate-300 flex items-center gap-1">
                            <Users size={10} className="text-slate-500" /> {log.student.name}
                          </p>
                          {log.student.group && (
                            <p className="text-[10px] text-slate-500 flex items-center gap-1">
                              <BookOpen size={9} className="text-slate-600" />
                              {log.student.group.grade_level?.stage?.name && <span>{log.student.group.grade_level.stage.name} - </span>}
                              {log.student.group.grade_level?.name && <span>{log.student.group.grade_level.name} - </span>}
                              {log.student.group.name}
                            </p>
                          )}
                        </div>
                      )}
                      {log.amount != null && log.amount > 0 && (
                        <p className="text-xs text-emerald-400 mt-0.5 font-bold">{formatCurrency(log.amount)} ج.م</p>
                      )}
                      {log.note && (
                        <p className="text-[11px] text-slate-500 mt-0.5">{log.note}</p>
                      )}
                      <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                        <Clock size={9} /> {formatTransactionDateTime(log.created_at)}
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-400 flex-shrink-0 whitespace-nowrap font-bold">{formatTimeAgo(log.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* New Students tracker tab */
          recentStudents.length === 0 ? (
            <p className="text-center text-slate-400 py-8">لا يوجد طلاب مسجلون حديثاً.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-2 modal-body">
              {recentStudents.map((s) => {
                const dl = dayLabel(s.enrollment_date);
                const feeMode = (s.fee_mode ?? 'full') as 'full' | 'pro_rata' | 'deferred';
                const modeLabel = feeMode === 'deferred' ? 'مرحّل للشهر التالي' : feeMode === 'pro_rata' ? 'بالحصص الفعلية' : 'شهر كامل';
                const modeColor = feeMode === 'deferred' ? 'text-sky-400 bg-sky-500/10' : feeMode === 'pro_rata' ? 'text-amber-400 bg-amber-500/10' : 'text-emerald-400 bg-emerald-500/10';
                return (
                  <div key={s.id} className="glass-light rounded-xl p-3 flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${s.gender === 'male' ? 'bg-blue-500/15 text-blue-400' : 'bg-pink-500/15 text-pink-400'}`}>
                      {s.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-sm">{s.name}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${modeColor}`}>{modeLabel}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                        {s.group_name && <span><Users size={10} className="inline ml-0.5" />{s.group_name}</span>}
                        {s.grade_name && <span className="text-slate-500">{s.stage_name ? `${s.stage_name} - ` : ''}{s.grade_name}</span>}
                      </div>
                    </div>
                    <div className="text-left flex-shrink-0">
                      <div className={`text-[11px] font-bold ${dl.color} flex items-center gap-1 justify-end`}>
                        <Clock size={10} /> {dl.label}
                      </div>
                      <p className="text-[9px] text-slate-500 mt-0.5">{formatArabicDate(s.enrollment_date)}</p>
                      <p className="text-[9px] text-slate-500">{formatTime(s.enrollment_date)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
