import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, Star, TrendingUp, CalendarCheck, BookOpen, Heart, Award,
  ChevronDown, Loader2, AlertTriangle, CheckCircle2, XCircle, Minus, TrendingDown, User, Info,
} from 'lucide-react';
import type { HallOfFameEntry, Student } from '@/lib/types';
import { fetchHallOfFame, fetchRankBreakdown, fetchStudentsByIds } from '@/lib/data';
import { canonicalRankEntries, type RankedEntry } from '@/lib/leaderboardRank';
import { toNum } from '@/lib/leaderboardRank';
import { supabase } from '@/lib/supabase';
import { eventBus } from '@/lib/eventBus';
import { formatArabicDate } from '@/lib/format';
import Modal from '@/components/ui/Modal';
import { PDFButton } from '@/components/ui/PDFButton';
import { exportHallOfFamePDF } from '@/lib/pdfExport';

const RANK_EMOJI: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function rankBadge(rank: number): string {
  return RANK_EMOJI[rank] ?? `#${rank}`;
}

function buildRankExplanation(
  entry: HallOfFameEntry,
  rank: number,
  ranked: RankedEntry[],
  breakdown: BreakdownData | null
): string {
  const studentName = entry.name;
  const totalScore = toNum(entry.overall_score).toFixed(2);
  const avgExam = Math.round(toNum(entry.avg_score));
  const attRate = Math.round(toNum(entry.attendance_rate));
  const hwRate = entry.homework_rate != null ? Math.round(toNum(entry.homework_rate)) : null;
  const behScore = Math.round(toNum(entry.behavior_score));

  // Find the next-ranked student (different rank) to compute the gap
  const nextEntry = ranked.find((r) => r.rank === rank + 1);
  const gap = nextEntry ? (toNum(entry.overall_score) - toNum(nextEntry.overall_score)).toFixed(2) : null;
  // Find the previous-ranked student to compute the distance to climb
  const prevEntry = ranked.slice().reverse().find((r) => r.rank === rank - 1);
  const prevGap = prevEntry ? (toNum(prevEntry.overall_score) - toNum(entry.overall_score)).toFixed(2) : null;

  const rankLabelStr = rank === 1 ? 'الأول' : rank === 2 ? 'الثاني' : rank === 3 ? 'الثالث' : `الـ${rank}`;
  const rankEmoji = RANK_EMOJI[rank] ?? '';

  // Build criteria strengths/weaknesses from real data
  const strengths: string[] = [];
  const improvements: string[] = [];

  if (avgExam >= 85) strengths.push(`معدل امتحانات ممتاز (${avgExam}%)`);
  else if (avgExam < 50) improvements.push(`معدل الامتحانات يحتاج تحسين (${avgExam}%)`);

  if (attRate >= 90) strengths.push(`حضور ملتزم (${attRate}%)`);
  else if (attRate < 70) improvements.push(`نسبة الحضور تحتاج متابعة (${attRate}%)`);

  if (hwRate != null) {
    if (hwRate >= 90) strengths.push(`التزام كامل بالواجبات (${hwRate}%)`);
    else if (hwRate < 70) improvements.push(`إكمال الواجبات يحتاج تحسين (${hwRate}%)`);
  }

  if (behScore >= 85) strengths.push(`سلوك إيجابي ومشاركة (${behScore}%)`);
  else if (behScore < 60) improvements.push(`السلوك يحتاج اهتمام (${behScore}%)`);

  if (breakdown && breakdown.deductedPoints.length === 0) {
    strengths.push('لا توجد نقاط منقوصة');
  }

  const parts: string[] = [];

  // Opening
  if (rank === 1) {
    parts.push(`${rankEmoji} يستحق الطالب ${studentName} المركز الأول بفضل أدائه المتميز وفقًا لمعايير التقييم المعتمدة. حقق درجة إجمالية ${totalScore} من 100، وتفوّق في ${strengths.length > 0 ? strengths.join('، ') : 'معايير التقييم'}.`);
  } else {
    parts.push(`${rankEmoji} يستحق الطالب ${studentName} المركز ${rankLabelStr} بفضل أدائه الجيد وفقًا لمعايير التقييم المعتمدة. حقق درجة إجمالية ${totalScore} من 100${strengths.length > 0 ? `، وتميّز في ${strengths.join('، ')}` : ''}.`);
  }

  // Gap to next/prev
  if (rank === 1 && gap) {
    parts.push(`يتقدّم على صاحب المركز الثاني بفارق ${gap} نقطة.`);
  } else if (rank > 1 && prevGap) {
    parts.push(`الفارق بينه وبين صاحب المركز ${rank === 2 ? 'الأول' : rank === 3 ? 'الثاني' : `الـ${rank - 1}`} هو ${prevGap} نقطة.`);
    if (gap) {
      parts.push(`ويتقدّم على صاحب المركز التالي بفارق ${gap} نقطة.`);
    }
  }

  // Improvements
  if (improvements.length > 0) {
    if (rank === 1) {
      parts.push(`للحفاظ على الصدارة، يُنصح بتحسين: ${improvements.join('، ')}.`);
    } else {
      parts.push(`للتقدّم إلى مركز أعلى، يحتاج إلى تحسين: ${improvements.join('، ')}.`);
    }
  }

  // Formula note
  parts.push(`معادلة الترتيب: الامتحانات 35% + الحضور 25% + الواجبات 20% + السلوك 20%. في حال تساوي الدرجة الإجمالية، يُرجّح بمعدل الامتحانات ثم الحضور ثم الواجبات ثم السلوك.`);

  return parts.join(' ');
}

type HallOfFameProps = {
  groupId?: string;
  refreshKey?: number;
  onViewStudent?: (student: Student) => void;
};

const medalColors = ['from-amber-400 to-yellow-600', 'from-slate-300 to-slate-500', 'from-orange-400 to-orange-700'];

function rankLabel(rank: number): string {
  const labels: Record<number, string> = { 1: 'الأول', 2: 'الثاني', 3: 'الثالث' };
  return `المركز ${labels[rank] ?? rank}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  exam: 'امتحان',
  sheet: 'شيت',
  recitation: 'تسميع',
  behavior: 'سلوك',
};

const ATTENDANCE_LABELS: Record<string, string> = {
  present: 'حاضر',
  absent: 'غائب',
  late: 'تأخير',
  excused_absence: 'غائب بعذر',
  excused: 'غائب بعذر',
  makeup: 'تعويضي',
  unrecorded: 'غير مسجل',
};

const BEHAVIOR_LABELS: Record<string, string> = {
  excellent: 'ممتاز',
  participatory: 'مشارك',
  quiet: 'هادئ',
  disruptive: 'مزعج',
  needs_attention: 'يحتاج اهتمام',
};

const HW_LABELS: Record<string, string> = {
  complete: 'مكتمل',
  incomplete: 'غير مكتمل',
  late: 'متأخر',
};

type BreakdownData = {
  examBreakdown: { title: string; category: string; score: number; max_score: number; percentage: number; date: string }[];
  attendanceBreakdown: { date: string; status: string; session_title: string | null }[];
  homeworkBreakdown: { title: string; status: string; due_date: string }[];
  behaviorBreakdown: { rating: string; note: string | null; eval_date: string; scope: string }[];
  deductedPoints: { category: string; description: string; points_lost: number }[];
  maxPossibleScore: number;
};

export default function HallOfFame({ groupId, refreshKey = 0, onViewStudent }: HallOfFameProps) {
  const [rankedEntries, setRankedEntries] = useState<RankedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<HallOfFameEntry | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownData | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState(false);
  const reqIdRef = useRef(0);

  const load = useCallback(async (showLoading = false) => {
    if (!groupId) {
      setRankedEntries([]);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    if (showLoading) { setLoading(true); setLoadError(false); }
    try {
      const data = await fetchHallOfFame(groupId, 10);
      if (reqId !== reqIdRef.current) return;
      setRankedEntries(canonicalRankEntries(data));
      setLoadError(false);
    } catch {
      if (reqId !== reqIdRef.current) return;
      setLoadError(true);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    setRankedEntries([]);
    setLoadError(false);
    void load(true);
    if (!groupId) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 250);
    };
    const channel = supabase
      .channel(`hall-of-fame-${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'center_grades' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'online_grades' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework_status' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'behavior_eval' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exam_submissions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, refresh)
      .subscribe();
    const fallbackRefresh = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);

    const offAttendance = eventBus.on('attendance:changed', () => refresh());
    const offGrades = eventBus.on('grades:changed', () => refresh());
    const offHomework = eventBus.on('homework:changed', () => refresh());
    const offBehavior = eventBus.on('behavior:changed', () => refresh());
    const offSessions = eventBus.on('sessions:changed', () => refresh());
    const offStudents = eventBus.on('students:changed', () => refresh());

    return () => {
      if (timer) clearTimeout(timer);
      window.clearInterval(fallbackRefresh);
      offAttendance();
      offGrades();
      offHomework();
      offBehavior();
      offSessions();
      offStudents();
      void supabase.removeChannel(channel);
    };
  }, [groupId, load, refreshKey]);

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  async function openBreakdown(entry: HallOfFameEntry) {
    if (onViewStudent) {
      const students = await fetchStudentsByIds([entry.id]);
      if (students.length > 0) {
        onViewStudent(students[0]);
        return;
      }
    }
    setSelectedEntry(entry);
    setBreakdown(null);
    setBreakdownError(false);
    setBreakdownLoading(true);
    try {
      const data = await fetchRankBreakdown(entry.id, entry.group_id);
      setBreakdown(data);
    } catch {
      setBreakdown(null);
      setBreakdownError(true);
    } finally {
      setBreakdownLoading(false);
    }
  }

  if (!groupId) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center">
        <Trophy className="mx-auto text-amber-500/40 mb-3" size={32} />
        <h3 className="text-base font-bold text-white mb-1">لوحة شرف المجموعة</h3>
        <p className="text-xs text-slate-400">اختر مجموعة لعرض لوحة الشرف الخاصة بطلابها.</p>
      </div>
    );
  }

  if (loading && rankedEntries.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-40 bg-white/10 rounded" />
          <div className="h-20 bg-white/5 rounded-xl" />
        </div>
      </div>
    );
  }

  if (loadError && rankedEntries.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center">
        <AlertTriangle className="mx-auto text-amber-500/40 mb-3" size={32} />
        <h3 className="text-base font-bold text-white mb-1">لوحة شرف المجموعة</h3>
        <p className="text-xs text-slate-400 mb-3">تعذّر تحميل لوحة الشرف.</p>
        <button onClick={() => void load(true)} className="text-xs font-bold text-amber-400 hover:text-amber-300 transition">إعادة المحاولة</button>
      </div>
    );
  }

  if (rankedEntries.length === 0 && !loadError) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center">
        <Trophy className="mx-auto text-amber-500/40 mb-3" size={32} />
        <h3 className="text-base font-bold text-white mb-1">لوحة شرف المجموعة</h3>
        <p className="text-xs text-slate-400">ستظهر أسماء الطلاب المتميزين هنا تلقائياً بناءً على التقييم الشامل.</p>
      </div>
    );
  }

  return (
    <>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600" />
        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-amber-500/15 text-amber-400 rounded-xl"><Trophy size={22} /></div>
            <div className="flex-1">
              <h3 className="text-base font-extrabold text-white">لوحة شرف المجموعة</h3>
              <p className="text-[11px] text-slate-400">اضغط على اسم الطالب لمعرفة تفاصيل التكريم وتحليل الدرجة</p>
            </div>
            <PDFButton
              label="تصدير PDF"
              size="sm"
              variant="primary"
              onClick={async () => exportHallOfFamePDF(
                rankedEntries.map((e) => ({ id: e.id, name: e.name, rank: e.rank, overall_score: Number(e.overall_score), group_name: e.group_name })),
                { groupName: rankedEntries[0]?.group_name }
              )}
              disabled={rankedEntries.length === 0}
            />
          </div>
          <div className="flex flex-wrap gap-2 mb-4 text-[10px] text-slate-400">
            <span className="glass-light px-2 py-0.5 rounded-full flex items-center gap-1"><TrendingUp size={10} /> امتحانات 35%</span>
            <span className="glass-light px-2 py-0.5 rounded-full flex items-center gap-1"><CalendarCheck size={10} /> حضور 25%</span>
            <span className="glass-light px-2 py-0.5 rounded-full flex items-center gap-1"><BookOpen size={10} /> واجبات 20%</span>
            <span className="glass-light px-2 py-0.5 rounded-full flex items-center gap-1"><Heart size={10} /> سلوك 20%</span>
          </div>

          {/* Podium — top 3 students prominently displayed */}
          {rankedEntries.length >= 3 && (
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
              {/* 2nd place (left) */}
              <PodiumCard entry={rankedEntries.find((e) => e.rank === 2) ?? rankedEntries[1]} rank={2} onClick={() => openBreakdown(rankedEntries.find((e) => e.rank === 2) ?? rankedEntries[1])} />
              {/* 1st place (center, elevated) */}
              <PodiumCard entry={rankedEntries.find((e) => e.rank === 1) ?? rankedEntries[0]} rank={1} onClick={() => openBreakdown(rankedEntries.find((e) => e.rank === 1) ?? rankedEntries[0])} elevated />
              {/* 3rd place (right) */}
              <PodiumCard entry={rankedEntries.find((e) => e.rank === 3) ?? rankedEntries[2]} rank={3} onClick={() => openBreakdown(rankedEntries.find((e) => e.rank === 3) ?? rankedEntries[2])} />
            </div>
          )}

          {/* Remaining ranked students */}
          <div className="space-y-2.5">
            {rankedEntries
              .filter((e) => !(rankedEntries.length >= 3 && e.rank <= 3))
              .map((entry, index) => {
              const rank = entry.rank;
              return (
                <motion.button
                  key={entry.id}
                  type="button"
                  onClick={() => openBreakdown(entry)}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`w-full text-right flex items-center gap-3 p-3 rounded-xl transition hover:bg-amber-500/10 ${rank <= 3 ? 'bg-gradient-to-l from-amber-500/10 to-transparent border border-amber-500/20' : 'glass-light'}`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm flex-shrink-0 ${rank <= 3 ? `bg-gradient-to-br ${medalColors[rank - 1]} text-slate-900 shadow-lg` : 'bg-white/5 text-slate-400 border border-white/10'}`}>
                    {rank <= 3 ? <span className="text-lg leading-none">{RANK_EMOJI[rank]}</span> : rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white break-words leading-snug">{entry.name}</p>
                    <p className="text-[10px] text-amber-300 mt-0.5">{rankLabel(rank)}</p>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    <div className="text-center">
                      <div className="flex items-center gap-1 text-[10px] text-slate-500"><Star size={11} /><span className="hidden sm:inline">الإجمالي</span></div>
                      <span className="text-sm font-bold text-amber-300">{Number(entry.overall_score).toFixed(1)}</span>
                    </div>
                    <div className="text-center hidden sm:block">
                      <div className="flex items-center gap-1 text-[10px] text-slate-500"><TrendingUp size={11} /><span>المعدل</span></div>
                      <span className={`text-sm font-bold ${toNum(entry.avg_score) >= 85 ? 'text-emerald-400' : toNum(entry.avg_score) >= 70 ? 'text-amber-400' : 'text-slate-300'}`}>{Math.round(toNum(entry.avg_score))}%</span>
                    </div>
                    <div className="text-center hidden sm:block">
                      <div className="flex items-center gap-1 text-[10px] text-slate-500"><CalendarCheck size={11} /><span>الحضور</span></div>
                      <span className="text-sm font-bold text-slate-300">{Math.round(toNum(entry.attendance_rate))}%</span>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </motion.div>

      <Modal
        open={!!selectedEntry}
        onClose={() => { setSelectedEntry(null); setBreakdown(null); }}
        title="تحليل تفصيلي للترتيب"
        size="lg"
      >
        {selectedEntry && (() => {
          const selectedRank = rankedEntries.find((r) => r.id === selectedEntry.id)?.rank ?? 1;
          return (
          <div className="space-y-4 text-right">
            {/* Student header with rank badge */}
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-l from-amber-500/15 to-transparent border border-amber-500/20">
              <div className="p-3 rounded-2xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
                <span className="text-2xl leading-none">{RANK_EMOJI[selectedRank] ?? ''}</span>
                <Award size={20} className="mr-1" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-white text-lg">{selectedEntry.name}</h4>
                <p className="text-xs text-amber-300">
                  {selectedEntry.group_name} — {selectedEntry.grade_name} — {rankLabel(selectedRank)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-slate-500">الدرجة الإجمالية</p>
                <p className="text-2xl font-black text-amber-300">{toNum(selectedEntry.overall_score).toFixed(2)}</p>
                <p className="text-[9px] text-slate-500">من 100</p>
              </div>
            </div>

            {onViewStudent && (
              <button
                type="button"
                onClick={async () => {
                  const students = await fetchStudentsByIds([selectedEntry.id]);
                  if (students.length > 0) {
                    setSelectedEntry(null);
                    onViewStudent(students[0]);
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-bold hover:bg-emerald-500/20 transition flex items-center justify-center gap-2"
              >
                <User size={14} />
                عرض الملف الشامل 360°
              </button>
            )}

            <ScoreContributions entry={selectedEntry} />

            {/* Why does the student deserve this rank? */}
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-4 space-y-3 border border-amber-500/20">
              <h4 className="font-bold text-sm text-amber-300 flex items-center gap-2">
                <Info size={16} />
                لماذا يستحق هذا المركز؟
              </h4>
              <p className="text-sm text-slate-200 leading-relaxed">
                {buildRankExplanation(selectedEntry, selectedRank, rankedEntries, breakdown)}
              </p>
              {(() => {
                const nextEntry = rankedEntries.find((r) => r.rank === selectedRank + 1);
                const prevEntry = rankedEntries.slice().reverse().find((r) => r.rank === selectedRank - 1);
                if (!nextEntry && !prevEntry) return null;
                return (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {prevEntry && (
                      <div className="glass-light rounded-xl p-2.5 text-center">
                        <p className="text-[10px] text-slate-500">الفارق عن المركز الأعلى</p>
                        <p className="text-sm font-bold text-red-400">+{(toNum(prevEntry.overall_score) - toNum(selectedEntry.overall_score)).toFixed(2)}</p>
                        <p className="text-[9px] text-slate-600">{prevEntry.name}</p>
                      </div>
                    )}
                    {nextEntry && (
                      <div className="glass-light rounded-xl p-2.5 text-center">
                        <p className="text-[10px] text-slate-500">الفارق عن المركز التالي</p>
                        <p className="text-sm font-bold text-emerald-400">{(toNum(selectedEntry.overall_score) - toNum(nextEntry.overall_score)).toFixed(2)}</p>
                        <p className="text-[9px] text-slate-600">{nextEntry.name}</p>
                      </div>
                    )}
                  </div>
                );
              })()}
            </motion.div>

            {breakdownLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-amber-400" size={28} />
                <span className="text-sm text-slate-400 mr-3">جارٍ تحميل التفاصيل…</span>
              </div>
            ) : breakdownError ? (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
                <p className="text-xs text-amber-200 font-medium">تعذّر تحميل تفاصيل الترتيب. أغلق النافذة وأعد المحاولة.</p>
              </div>
            ) : breakdown ? (
              <AnimatePresence>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                  {/* Exam breakdown */}
                  {breakdown.examBreakdown.length > 0 && (
                    <BreakdownSection title="تفصيل الامتحانات والتقييمات" icon={<TrendingUp size={16} />} color="text-blue-400">
                      <div className="space-y-2">
                        {breakdown.examBreakdown.map((ex, i) => (
                          <div key={i} className="glass-light rounded-lg p-2.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-white block truncate">{ex.title}</span>
                              <span className="text-[10px] text-slate-500">
                                {CATEGORY_LABELS[ex.category] ?? ex.category} — {formatArabicDate(ex.date)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs text-slate-300 font-mono">{ex.score}/{ex.max_score}</span>
                              <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${ex.percentage >= 50 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                  style={{ width: `${Math.min(100, ex.percentage)}%` }}
                                />
                              </div>
                              <span className={`text-xs font-bold ${ex.percentage >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{ex.percentage}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </BreakdownSection>
                  )}

                  {/* Attendance breakdown */}
                  {breakdown.attendanceBreakdown.length > 0 && (
                    <BreakdownSection title="تفصيل الحضور والغياب" icon={<CalendarCheck size={16} />} color="text-emerald-400">
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {breakdown.attendanceBreakdown.map((att, i) => (
                          <div key={i} className="glass-light rounded-lg p-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs text-slate-300 flex-shrink-0">{formatArabicDate(att.date)}</span>
                              {att.session_title && (
                                <span className="text-[10px] text-emerald-400 font-medium truncate">— {att.session_title}</span>
                              )}
                            </div>
                            <AttendanceBadge status={att.status} />
                          </div>
                        ))}
                      </div>
                    </BreakdownSection>
                  )}

                  {/* Homework breakdown */}
                  {breakdown.homeworkBreakdown.length > 0 && (
                    <BreakdownSection title="تفصيل الواجبات" icon={<BookOpen size={16} />} color="text-violet-400">
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {breakdown.homeworkBreakdown.map((hw, i) => (
                          <div key={i} className="glass-light rounded-lg p-2 flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-300 truncate">{hw.title}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              hw.status === 'complete' ? 'bg-emerald-500/10 text-emerald-400' :
                              hw.status === 'late' ? 'bg-amber-500/10 text-amber-400' :
                              'bg-red-500/10 text-red-400'
                            }`}>
                              {HW_LABELS[hw.status] ?? hw.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </BreakdownSection>
                  )}

                  {/* Behavior breakdown */}
                  {breakdown.behaviorBreakdown.length > 0 && (
                    <BreakdownSection title="تفصيل السلوك والمشاركة" icon={<Heart size={16} />} color="text-rose-400">
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {breakdown.behaviorBreakdown.map((beh, i) => (
                          <div key={i} className="glass-light rounded-lg p-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-xs text-slate-300">{formatArabicDate(beh.eval_date)}</span>
                              {beh.note && <span className="text-[10px] text-slate-500 block truncate">— {beh.note}</span>}
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              beh.rating === 'excellent' || beh.rating === 'participatory' ? 'bg-emerald-500/10 text-emerald-400' :
                              beh.rating === 'quiet' ? 'bg-sky-500/10 text-sky-400' :
                              'bg-red-500/10 text-red-400'
                            }`}>
                              {BEHAVIOR_LABELS[beh.rating] ?? beh.rating}
                            </span>
                          </div>
                        ))}
                      </div>
                    </BreakdownSection>
                  )}

                  {/* Deducted points */}
                  {breakdown.deductedPoints.length > 0 && (
                    <BreakdownSection title="النقاط المنقوصة (أسباب خفض التقييم)" icon={<TrendingDown size={16} />} color="text-red-400">
                      <div className="space-y-2">
                        {breakdown.deductedPoints.map((dp, i) => (
                          <div key={i} className="glass-light rounded-lg p-2.5 flex items-center justify-between gap-2 border border-red-500/10">
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-red-400 block">{dp.category}</span>
                              <span className="text-[10px] text-slate-400">{dp.description}</span>
                            </div>
                            <span className="text-sm font-bold text-red-400 flex-shrink-0 flex items-center gap-1">
                              <Minus size={12} />{dp.points_lost}
                            </span>
                          </div>
                        ))}
                        <div className="text-center pt-1">
                          <span className="text-[10px] text-slate-500">
                            الدرجة النهائية = {breakdown.maxPossibleScore} — {breakdown.deductedPoints.reduce((s, d) => s + d.points_lost, 0).toFixed(1)} = <span className="text-amber-400 font-bold">{toNum(selectedEntry.overall_score).toFixed(2)}</span>
                          </span>
                        </div>
                      </div>
                    </BreakdownSection>
                  )}

                  {breakdown.deductedPoints.length === 0 && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                      <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
                      <p className="text-xs text-emerald-300 font-medium">لا توجد نقاط منقوصة — أداء ممتاز في جميع المجالات!</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            ) : null}
          </div>
        );
        })()}
      </Modal>
    </>
  );
}

function PodiumCard({ entry, rank, onClick, elevated = false }: { entry: HallOfFameEntry; rank: number; onClick: () => void; elevated?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      className={`flex flex-col items-center text-center min-w-0 rounded-2xl p-3 sm:p-4 border border-amber-500/25 bg-gradient-to-b from-amber-500/15 to-transparent transition hover:border-amber-400/50 ${elevated ? 'sm:-mt-4' : 'mt-3 sm:mt-6'}`}
    >
      <div className={`w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center bg-gradient-to-br ${medalColors[rank - 1]} text-slate-900 font-black text-lg shadow-lg mb-2`}>
        {rank}
      </div>
      <p className="text-xs sm:text-sm font-bold text-white break-words leading-snug line-clamp-2 w-full">{entry.name}</p>
      <p className="text-[10px] text-amber-300 mt-0.5">{rankLabel(rank)}</p>
      <p className="text-base sm:text-xl font-black text-amber-300 mt-1.5">{toNum(entry.overall_score).toFixed(1)}</p>
      <p className="text-[10px] text-slate-400">الإجمالي</p>
    </motion.button>
  );
}

function ScoreContributions({ entry }: { entry: HallOfFameEntry }) {
  const parts = [
    { label: 'الامتحانات', value: toNum(entry.avg_score), weight: 35, color: 'text-blue-400', bar: 'bg-blue-500' },
    { label: 'الحضور', value: toNum(entry.attendance_rate), weight: 25, color: 'text-emerald-400', bar: 'bg-emerald-500' },
    { label: 'الواجبات', value: toNum(entry.homework_rate), weight: 20, color: 'text-cyan-400', bar: 'bg-cyan-500' },
    { label: 'السلوك', value: toNum(entry.behavior_score), weight: 20, color: 'text-rose-400', bar: 'bg-rose-500' },
  ];
  const contributions = parts.map((p) => (p.value * p.weight) / 100);
  const sum = contributions.reduce((s, c) => s + c, 0);

  return (
    <div className="glass-light rounded-xl p-3 sm:p-4 space-y-3">
      <div className="space-y-2.5">
        {parts.map((p, i) => (
          <div key={p.label} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-bold ${p.color}`}>{p.label}</span>
              <span className="text-[11px] text-slate-400 font-mono tabular-nums" dir="ltr">
                {p.value.toFixed(1)}% × {p.weight}% = <strong className="text-white">{contributions[i].toFixed(2)}</strong>
              </span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${p.bar}`} style={{ width: `${Math.min(100, Math.max(0, p.value))}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-white/10 pt-3">
        <span className="text-xs text-slate-300">مجموع المساهمات</span>
        <span className="text-xs font-bold text-white font-mono tabular-nums" dir="ltr">{sum.toFixed(2)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-300">الدرجة النهائية المعتمدة</span>
        <span className="text-sm font-black text-amber-300 font-mono tabular-nums" dir="ltr">{toNum(entry.overall_score).toFixed(2)} / 100</span>
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        الدرجة = الامتحانات × 35% + الحضور × 25% + الواجبات × 20% + السلوك × 20%. قد يختلف المجموع عن الدرجة المعتمدة بنحو 0.01 بسبب تقريب نسبة الحضور لرقم عشري واحد.
      </p>
    </div>
  );
}

function BreakdownSection({ title, icon, color, children }: { title: string; icon: React.ReactNode; color: string; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <h4 className={`font-bold text-sm mb-3 flex items-center gap-2 ${color}`}>
        {icon}
        {title}
      </h4>
      {children}
    </div>
  );
}

function AttendanceBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    present: { label: 'حاضر', color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: <CheckCircle2 size={11} /> },
    absent: { label: 'غائب', color: 'text-red-400', bg: 'bg-red-500/10', icon: <XCircle size={11} /> },
    late: { label: 'تأخير', color: 'text-amber-400', bg: 'bg-amber-500/10', icon: <AlertTriangle size={11} /> },
    excused_absence: { label: 'بعذر', color: 'text-sky-400', bg: 'bg-sky-500/10', icon: <AlertTriangle size={11} /> },
    excused: { label: 'بعذر', color: 'text-sky-400', bg: 'bg-sky-500/10', icon: <AlertTriangle size={11} /> },
    makeup: { label: 'تعويضي', color: 'text-teal-400', bg: 'bg-teal-500/10', icon: <CheckCircle2 size={11} /> },
    unrecorded: { label: 'غير مسجل', color: 'text-slate-400', bg: 'bg-slate-500/10', icon: <Minus size={11} /> },
  };
  const c = config[status] ?? config.unrecorded;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.bg} ${c.color} flex items-center gap-1 flex-shrink-0`}>
      {c.icon}
      {c.label}
    </span>
  );
}
