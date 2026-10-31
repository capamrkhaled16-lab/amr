import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Award, Printer, Download, Sparkles, Trophy, Eye, ArrowRight, GraduationCap, MapPin, Calendar, FileText, Trash2, Ban, User } from 'lucide-react';
import StudentViewModal from '@/components/ui/StudentViewModal';
import AbsenceBadge from '@/components/ui/AbsenceBadge';
import confetti from 'canvas-confetti';
import type { Student, AttendanceStatus } from '@/lib/types';
import { useSettings } from '@/context/SettingsContext';
import { generateSerialId, formatArabicDate } from '@/lib/format';
import { createCertificate, fetchCertificates, deleteCertificate, fetchAttendanceBySession, fetchSessions } from '@/lib/data';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { Certificate } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import Button from '@/components/ui/Button';

type CertificateModuleProps = {
  students: Student[];
};

type LeaderboardEntry = {
  student: Student;
  totalScore: number;
  maxScore: number;
  percentage: number;
};

type GradeInfo = {
  group_name: string | null;
  grade_name: string | null;
  stage_name: string | null;
};

export default function CertificateModule({ students }: CertificateModuleProps) {
  const { settings } = useSettings();
  const [certMode, setCertMode] = useState<'custom' | 'leaderboard'>('custom');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [gradeInfo, setGradeInfo] = useState<GradeInfo | null>(null);
  const [examTitle, setExamTitle] = useState('');
  const [score, setScore] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [serial, setSerial] = useState('');
  const [issued, setIssued] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [city, setCity] = useState('');
  const [certDate, setCertDate] = useState(formatArabicDate(new Date()));
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [issuedCerts, setIssuedCerts] = useState<Certificate[]>([]);
  const [revokeTarget, setRevokeTarget] = useState<Certificate | null>(null);
  const [viewTarget, setViewTarget] = useState<Student | null>(null);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceStatus>>({});
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadAttendance() {
      if (students.length === 0) return;
      const today = new Date();
      const monthLabel = `${['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][today.getMonth()]} ${today.getFullYear()}`;
      const groupIds = [...new Set(students.map((s) => s.group_id).filter(Boolean))] as string[];
      if (groupIds.length === 0) return;
      const map: Record<string, AttendanceStatus> = {};
      for (const gid of groupIds) {
        try {
          const sessions = await fetchSessions(gid, monthLabel);
          const latest = sessions[0];
          if (!latest) continue;
          const records = await fetchAttendanceBySession(gid, latest.id);
          for (const r of records) map[r.student_id] = r.status;
        } catch { /* skip */ }
      }
      setAttendanceMap(map);
    }
    loadAttendance();
  }, [students]);

  const loadLeaderboard = useCallback(async () => {
    if (students.length === 0) return;
    const { data: cg } = await supabase
      .from('center_grades')
      .select('student_id, score')
      .in('student_id', students.map((s) => s.id));
    const { data: og } = await supabase
      .from('online_grades')
      .select('student_id, score, max_score')
      .in('student_id', students.map((s) => s.id));

    const scoreMap: Record<string, { total: number; max: number }> = {};
    for (const g of cg ?? []) {
      if (!scoreMap[g.student_id]) scoreMap[g.student_id] = { total: 0, max: 0 };
      scoreMap[g.student_id].total += g.score;
      scoreMap[g.student_id].max += 100;
    }
    for (const g of og ?? []) {
      if (!scoreMap[g.student_id]) scoreMap[g.student_id] = { total: 0, max: 0 };
      scoreMap[g.student_id].total += g.score;
      scoreMap[g.student_id].max += g.max_score || 100;
    }

    const entries: LeaderboardEntry[] = students
      .map((s) => {
        const data = scoreMap[s.id] ?? { total: 0, max: 0 };
        return {
          student: s,
          totalScore: data.total,
          maxScore: data.max,
          percentage: data.max > 0 ? Math.round((data.total / data.max) * 100) : 0,
        };
      })
      .sort((a, b) => b.percentage - a.percentage);

    setLeaderboard(entries);
  }, [students]);

  useEffect(() => {
    if (certMode === 'leaderboard') loadLeaderboard();
  }, [certMode, loadLeaderboard]);

  const fetchGradeInfo = useCallback(async (groupId: string | null) => {
    if (!groupId) {
      setGradeInfo(null);
      return;
    }
    const { data } = await supabase
      .from('groups')
      .select('name, grade_level:grade_levels(name, stage:academic_stages(name))')
      .eq('id', groupId)
      .maybeSingle();
    if (data) {
      const g = data as unknown as { name: string; grade_level: { name: string; stage: { name: string } } };
      setGradeInfo({
        group_name: g.name,
        grade_name: g.grade_level?.name ?? null,
        stage_name: g.grade_level?.stage?.name ?? null,
      });
    } else {
      setGradeInfo(null);
    }
  }, []);

  function selectStudent(s: Student) {
    setSelected(s);
    setExamTitle('');
    setScore('');
    setMaxScore('100');
    setSerial(generateSerialId());
    setIssued(false);
    setPreviewing(false);
    fetchGradeInfo(s.group_id);
  }

  function selectLeader(s: LeaderboardEntry, rank: number) {
    setSelected(s.student);
    const isFemale = s.student.gender === 'female';
    setExamTitle(rank === 1 ? 'لوحة الشرف — المركز الأول' : `لوحة الشرف — المركز ${rank}`);
    setScore(String(s.totalScore));
    setMaxScore(String(s.maxScore));
    setSerial(generateSerialId());
    setIssued(false);
    setPreviewing(false);
    fetchGradeInfo(s.student.group_id);
  }

  function fireConfetti() {
    confetti({
      particleCount: 120,
      spread: 75,
      origin: { y: 0.6 },
      colors: ['#d4af37', '#f0d774', '#9a7d1f', '#fbbf24', '#e8d088'],
    });
  }

  async function handleIssue() {
    if (!selected) return;
    setPreviewing(false);
    setIssued(true);
    fireConfetti();
    await createCertificate({
      student_id: selected.id,
      exam_title: examTitle || null,
      score: parseFloat(score) || null,
      max_score: parseFloat(maxScore) || null,
      serial_id: serial,
    });
  }

  function handlePreview() {
    if (!selected) return;
    setSerial(generateSerialId());
    setPreviewing(true);
  }

  function handlePrint() {
    const portrait = orientation === 'portrait';
    const styleId = 'cert-print-orientation';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = `@media print { @page { size: A4 ${orientation}; margin: 0; } }`;
    const area = document.getElementById('certificate-print-area');
    if (area) {
      area.classList.toggle('cert-portrait', portrait);
    }
    // Defer print slightly to ensure CSS classes are applied
    setTimeout(() => window.print(), 50);
  }

  const loadIssuedCerts = useCallback(async () => {
    if (students.length === 0) return;
    const { data } = await supabase
      .from('certificates')
      .select('*')
      .in('student_id', students.map((s) => s.id))
      .order('issued_at', { ascending: false });
    setIssuedCerts((data as Certificate[]) ?? []);
  }, [students]);

  useEffect(() => {
    loadIssuedCerts();
  }, [loadIssuedCerts]);

  async function handleRevoke() {
    if (!revokeTarget) return;
    await deleteCertificate(revokeTarget.id);
    setIssuedCerts((prev) => prev.filter((c) => c.id !== revokeTarget.id));
    setRevokeTarget(null);
  }

  const isFemale = selected?.gender === 'female';

  const showCertificate = (selected && issued) || (selected && previewing);

  // Premium black-and-gold palette
  const COLORS = {
    black: '#0a0a0a',
    charcoal: '#1a1a1a',
    charcoalLight: '#222222',
    gold: '#d4af37',
    goldLight: '#f0d774',
    goldDark: '#9a7d1f',
    goldGlow: 'rgba(212,175,55,0.15)',
    white: '#f5f5f5',
    whiteDim: '#cccccc',
    whiteFaint: '#888888',
  };

  const isLandscape = orientation === 'landscape';

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Award className="text-amber-400" size={22} />
          <h3 className="text-lg font-bold text-white">شهادات التفوق</h3>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex gap-1 glass-light rounded-lg p-1">
            <button
              onClick={() => setOrientation('landscape')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${orientation === 'landscape' ? 'bg-amber-600/30 text-amber-400' : 'text-slate-400'}`}
              title="أفقي"
            >
              <svg width="20" height="14" viewBox="0 0 20 14" fill="none"><rect x="1" y="1" width="18" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="3" y="3" width="14" height="8" rx="0.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5"/></svg>
            </button>
            <button
              onClick={() => setOrientation('portrait')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${orientation === 'portrait' ? 'bg-amber-600/30 text-amber-400' : 'text-slate-400'}`}
              title="رأسي"
            >
              <svg width="14" height="20" viewBox="0 0 14 20" fill="none"><rect x="1" y="1" width="12" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="3" y="3" width="8" height="14" rx="0.5" stroke="currentColor" strokeWidth="0.8" opacity="0.5"/></svg>
            </button>
          </div>
          <button
            onClick={() => setCertMode('custom')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${certMode === 'custom' ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400'}`}
          >
            شهادة مخصصة
          </button>
          <button
            onClick={() => setCertMode('leaderboard')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${certMode === 'leaderboard' ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400'}`}
          >
            <Trophy size={14} /> لوحة الشرف التلقائية
          </button>
        </div>
      </div>

      {/* Leaderboard mode */}
      {certMode === 'leaderboard' && (
        <div className="glass-card rounded-2xl p-5 mb-4">
          <h4 className="font-bold text-white mb-3 flex items-center gap-2">
            <Trophy size={18} className="text-amber-400" />
            ترتيب الطلاب حسب الدرجات الكلية
          </h4>
          {leaderboard.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">لا توجد درجات مسجلة بعد.</p>
          ) : (
            <div className="space-y-2">
              {leaderboard.slice(0, 10).map((entry, i) => (
                <button
                  key={entry.student.id}
                  onClick={() => selectLeader(entry, i + 1)}
                  className={`w-full text-right p-3 rounded-xl flex items-center justify-between transition ${
                    selected?.id === entry.student.id
                      ? 'bg-emerald-600/20 border border-emerald-500/40'
                      : 'glass-light hover:bg-white/10 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      i === 0 ? 'bg-amber-500/20 text-amber-400' :
                      i === 1 ? 'bg-slate-400/20 text-slate-300' :
                      i === 2 ? 'bg-orange-700/20 text-orange-400' :
                      'glass-light text-slate-400'
                    }`}>
                      {i + 1}
                    </span>
                    <span className="font-semibold text-white text-sm break-words">{entry.student.name}</span>
                    <AbsenceBadge status={attendanceMap[entry.student.id]} />
                  </div>
                  <span className="text-sm font-bold text-emerald-400">
                    {entry.percentage}%
                    <span className="text-xs text-slate-500 font-normal mr-2">
                      ({entry.totalScore}/{entry.maxScore})
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {selected && certMode === 'leaderboard' && !showCertificate && (
            <div className="flex gap-2 mt-4 justify-center">
              <Button onClick={handlePreview} size="sm" variant="secondary">
                <Eye size={16} /> معاينة الشهادة
              </Button>
              <Button onClick={handleIssue} size="sm">
                <Sparkles size={16} /> إصدار الشهادة
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Student list + form — only show in custom mode */}
        {certMode === 'custom' && (
        <div className="lg:col-span-1 space-y-4">
          <div className="glass-card rounded-xl p-4">
            <p className="text-sm text-slate-400 mb-3">اختر الطالب:</p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {students.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-4">لا يوجد طلاب.</p>
              ) : (
                students.map((s) => (
                  <div key={s.id} className="flex items-center gap-1">
                    <button
                      onClick={() => selectStudent(s)}
                      className={`flex-1 text-right px-3 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${
                        selected?.id === s.id
                          ? 'bg-emerald-600 text-white'
                          : 'glass-light text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <span className="break-words">{s.name} {s.gender === 'female' && '(أنثى)'}</span>
                      <AbsenceBadge status={attendanceMap[s.id]} />
                    </button>
                    <button
                      onClick={() => setViewTarget(s)}
                      className="p-1.5 rounded-lg glass-light hover:bg-sky-500/10 text-slate-400 hover:text-sky-400 transition flex-shrink-0"
                      title="عرض"
                    >
                      <Eye size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {selected && (
            <div className="glass-card rounded-xl p-4 space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">عنوان الامتحان / سبب التكريم</label>
                <input
                  type="text"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                  placeholder="مثال: اختبار الوحدة الأولى"
                  className="w-full glass-light rounded-lg py-2 px-3 text-white placeholder-slate-500 border border-white/10 focus:border-amber-500/50 focus:outline-none text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">الدرجة</label>
                  <input
                    type="number"
                    value={score}
                    onChange={(e) => setScore(e.target.value)}
                    className="w-full glass-light rounded-lg py-2 px-3 text-white border border-white/10 focus:border-amber-500/50 focus:outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">العظمى</label>
                  <input
                    type="number"
                    value={maxScore}
                    onChange={(e) => setMaxScore(e.target.value)}
                    className="w-full glass-light rounded-lg py-2 px-3 text-white border border-white/10 focus:border-amber-500/50 focus:outline-none text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">المدينة</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="مثال: القاهرة"
                    className="w-full glass-light rounded-lg py-2 px-3 text-white placeholder-slate-500 border border-white/10 focus:border-amber-500/50 focus:outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">التاريخ</label>
                  <input
                    type="text"
                    value={certDate}
                    onChange={(e) => setCertDate(e.target.value)}
                    placeholder="مثال: ١٥ أغسطس ٢٠٢٦"
                    className="w-full glass-light rounded-lg py-2 px-3 text-white placeholder-slate-500 border border-white/10 focus:border-amber-500/50 focus:outline-none text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handlePreview} variant="secondary" className="flex-1" size="sm">
                  <Eye size={16} /> معاينة
                </Button>
                <Button onClick={handleIssue} className="flex-1" size="sm">
                  <Sparkles size={16} /> إصدار
                </Button>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Certificate preview / placeholder */}
        <div className={certMode === 'leaderboard' ? 'lg:col-span-3' : 'lg:col-span-2'}>
          {showCertificate ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              {/* Action buttons (no-print) */}
              <div className="flex gap-2 mb-3 no-print flex-wrap items-center">
                {previewing && !issued && (
                  <Button size="sm" variant="secondary" onClick={() => setPreviewing(false)}>
                    <ArrowRight size={16} /> رجوع للتعديل
                  </Button>
                )}
                {previewing && !issued && (
                  <Button size="sm" onClick={handleIssue}>
                    <Sparkles size={16} /> إصدار الشهادة
                  </Button>
                )}
                <Button size="sm" onClick={handlePrint}>
                  <Printer size={16} /> طباعة A4
                </Button>
                <Button size="sm" variant="secondary" onClick={handlePrint}>
                  <Download size={16} /> تحميل PDF
                </Button>
                {previewing && !issued && (
                  <span className="text-xs text-amber-400/80 flex items-center gap-1 mr-auto">
                    <Eye size={14} /> وضع المعاينة — لم يتم الحفظ بعد
                  </span>
                )}
              </div>

              {/* Certificate */}
              <div
                id="certificate-print-area"
                ref={printRef}
                className={`relative overflow-hidden mx-auto ${orientation === 'portrait' ? 'cert-portrait' : ''}`}
                style={{
                  aspectRatio: isLandscape ? '297 / 210' : '210 / 297',
                  maxWidth: '100%',
                  width: '100%',
                  background: `radial-gradient(ellipse at 50% 30%, ${COLORS.charcoalLight} 0%, ${COLORS.black} 70%)`,
                }}
              >
                {/* ── Geometric gold ambient pattern ── */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    opacity: 0.04,
                    backgroundImage: `radial-gradient(circle at 20% 20%, ${COLORS.gold} 1px, transparent 1px), radial-gradient(circle at 80% 80%, ${COLORS.gold} 1px, transparent 1px)`,
                    backgroundSize: '40px 40px',
                  }}
                />
                {/* ── Diagonal gold mesh ── */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    opacity: 0.03,
                    backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 30px, ${COLORS.gold} 30px, ${COLORS.gold} 31px), repeating-linear-gradient(-45deg, transparent, transparent 30px, ${COLORS.gold} 30px, ${COLORS.gold} 31px)`,
                  }}
                />

                {/* ── Outer ornate border (double-line gold) ── */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    inset: '30px',
                    border: `3px solid ${COLORS.gold}`,
                    borderRadius: '8px',
                    boxShadow: `inset 0 0 0 1px ${COLORS.goldLight}, inset 0 0 0 5px transparent, inset 0 0 0 6px ${COLORS.goldDark}`,
                  }}
                />
                {/* Inner thin border */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    inset: '38px',
                    border: `1px solid ${COLORS.goldDark}`,
                    borderRadius: '3px',
                  }}
                />
                {/* Innermost accent line */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    inset: '44px',
                    border: `0.5px solid ${COLORS.goldLight}`,
                    opacity: 0.4,
                    borderRadius: '2px',
                  }}
                />

                {/* ── Corner ornaments (Arabesque style) ── */}
                {[
                  { pos: 'top-[30px] right-[30px]', rotate: '0deg' },
                  { pos: 'top-[30px] left-[30px]', rotate: '270deg' },
                  { pos: 'bottom-[30px] right-[30px]', rotate: '90deg' },
                  { pos: 'bottom-[30px] left-[30px]', rotate: '180deg' },
                ].map((corner, i) => (
                  <div key={i} className={`absolute ${corner.pos} pointer-events-none`} style={{ transform: `rotate(${corner.rotate})` }}>
                    <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                      <path d="M4 4 Q28 4 28 28 Q4 28 4 4 Z" fill={COLORS.gold} opacity="0.08" />
                      <path d="M4 4 L4 24 M4 4 L24 4" stroke={COLORS.gold} strokeWidth="2.5" strokeLinecap="round" />
                      <circle cx="10" cy="10" r="3.5" fill={COLORS.gold} />
                      <circle cx="10" cy="10" r="6" stroke={COLORS.goldDark} strokeWidth="0.8" fill="none" />
                      <path d="M16 4 Q22 4 22 10" stroke={COLORS.gold} strokeWidth="1.5" fill="none" />
                      <path d="M4 16 Q4 22 10 22" stroke={COLORS.gold} strokeWidth="1.5" fill="none" />
                      <circle cx="22" cy="4" r="1.5" fill={COLORS.goldLight} />
                      <circle cx="4" cy="22" r="1.5" fill={COLORS.goldLight} />
                    </svg>
                  </div>
                ))}

                {/* ── Content ── */}
                <div
                  className="relative h-full flex flex-col items-center text-center"
                  style={{
                    padding: isLandscape ? '40px 60px' : '50px 50px',
                    fontFamily: "'Noto Naskh Arabic', 'Amiri', serif",
                    color: COLORS.white,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  }}
                >
                  {/* ── Header: Logo + Platform name ── */}
                  <div className="flex flex-col items-center mb-3">
                    <div className="mb-2">
                      {settings.logo_url ? (
                        <img
                          src={settings.logo_url}
                          alt="logo"
                          className="rounded-xl object-cover"
                          style={{
                            width: isLandscape ? '64px' : '72px',
                            height: isLandscape ? '64px' : '72px',
                            border: `2px solid ${COLORS.gold}`,
                            boxShadow: `0 2px 12px ${COLORS.goldGlow}`,
                          }}
                        />
                      ) : (
                        <div
                          className="rounded-xl flex items-center justify-center"
                          style={{
                            width: isLandscape ? '64px' : '72px',
                            height: isLandscape ? '64px' : '72px',
                            background: `linear-gradient(135deg, ${COLORS.charcoal}, ${COLORS.charcoalLight})`,
                            border: `2px solid ${COLORS.gold}`,
                            boxShadow: `0 2px 12px ${COLORS.goldGlow}`,
                          }}
                        >
                          <GraduationCap style={{ color: COLORS.gold }} size={32} />
                        </div>
                      )}
                    </div>
                    <h1
                      style={{
                        fontFamily: "'Reem Kufi', 'Cairo', sans-serif",
                        fontSize: isLandscape ? '18px' : '20px',
                        fontWeight: 700,
                        color: COLORS.gold,
                        letterSpacing: '0.5px',
                        lineHeight: 1.3,
                      }}
                    >
                      {settings.platform_name}
                    </h1>
                    <p
                      style={{
                        fontFamily: "'Noto Naskh Arabic', serif",
                        fontSize: '11px',
                        color: COLORS.whiteFaint,
                        marginTop: '2px',
                        fontWeight: 500,
                      }}
                    >
                      {settings.management_name}
                    </p>
                  </div>

                  {/* ── Ornamental divider ── */}
                  <div className="flex items-center gap-2 my-2">
                    <div style={{ width: '70px', height: '1px', background: `linear-gradient(to left, ${COLORS.gold}, transparent)` }} />
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                      <path d="M11 2 L13 9 L20 11 L13 13 L11 20 L9 13 L2 11 L9 9 Z" fill={COLORS.gold} opacity="0.9" />
                      <circle cx="11" cy="11" r="1.5" fill={COLORS.goldDark} />
                    </svg>
                    <div style={{ width: '70px', height: '1px', background: `linear-gradient(to right, ${COLORS.gold}, transparent)` }} />
                  </div>

                  {/* ── Main heading: Ornate calligraphic title ── */}
                  <h2
                    style={{
                      fontFamily: "'Amiri', 'Noto Naskh Arabic', serif",
                      fontSize: isLandscape ? '34px' : '38px',
                      fontWeight: 700,
                      color: COLORS.gold,
                      letterSpacing: '4px',
                      lineHeight: 1.2,
                      marginBottom: '4px',
                      textShadow: `0 0 20px ${COLORS.goldGlow}`,
                    }}
                  >
                    شهادة تقدير
                  </h2>
                  <p
                    style={{
                      fontFamily: "'Reem Kufi', sans-serif",
                      fontSize: '10px',
                      color: COLORS.goldDark,
                      letterSpacing: '5px',
                      marginBottom: isLandscape ? '18px' : '22px',
                      fontWeight: 500,
                    }}
                  >
                    CERTIFICATE OF APPRECIATION
                  </p>

                  {/* ── Opening text ── */}
                  <p
                    style={{
                      fontFamily: "'Noto Naskh Arabic', serif",
                      fontSize: isLandscape ? '15px' : '16px',
                      color: COLORS.whiteDim,
                      lineHeight: 1.9,
                      marginBottom: '16px',
                      maxWidth: '650px',
                    }}
                  >
                    تتقدم منصة الخالد التعليمية بخالص التقدير والاعتزاز إلى الطالب
                  </p>

                  {/* ── Recipient name ── */}
                  <div
                    style={{
                      marginBottom: isLandscape ? '18px' : '22px',
                      padding: '12px 56px',
                      borderTop: `2px solid ${COLORS.gold}`,
                      borderBottom: `2px solid ${COLORS.gold}`,
                      background: `linear-gradient(180deg, ${COLORS.goldGlow}, transparent, ${COLORS.goldGlow})`,
                    }}
                  >
                    <p
                      style={{
                        fontFamily: "'Amiri', serif",
                        fontSize: isLandscape ? '32px' : '36px',
                        fontWeight: 700,
                        color: COLORS.goldLight,
                        lineHeight: 1.3,
                        letterSpacing: '1px',
                        textShadow: `0 0 15px ${COLORS.goldGlow}`,
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {selected?.name ?? ''}
                    </p>
                  </div>

                  {/* ── Award reason ── */}
                  <p
                    style={{
                      fontFamily: "'Noto Naskh Arabic', serif",
                      fontSize: isLandscape ? '15px' : '16px',
                      color: COLORS.whiteDim,
                      lineHeight: 2,
                      maxWidth: '680px',
                      marginBottom: '10px',
                    }}
                  >
                    تقديرًا لاجتهاده وتميّزه وحرصه على التعلّم، مع أطيب الأمنيات بدوام النجاح والتفوّق.
                  </p>

                  {/* ── Grade info ── */}
                  {gradeInfo?.grade_name && (
                    <p
                      style={{
                        fontFamily: "'Noto Naskh Arabic', serif",
                        fontSize: '12px',
                        color: COLORS.whiteFaint,
                        marginBottom: '8px',
                      }}
                    >
                      المرحلة: {gradeInfo.stage_name} — {gradeInfo.grade_name}
                      {gradeInfo.group_name && ` — مجموعة ${gradeInfo.group_name}`}
                    </p>
                  )}

                  {/* ── Footer: Signatures + Seal + Date ── */}
                  <div
                    className="mt-auto w-full"
                    style={{ paddingTop: isLandscape ? '20px' : '30px' }}
                  >
                    {/* Divider line above signatures */}
                    <div
                      style={{
                        width: '80%',
                        margin: '0 auto 20px',
                        height: '1px',
                        background: `linear-gradient(to left, transparent, ${COLORS.gold}, transparent)`,
                      }}
                    />

                    <div
                      className="flex items-end justify-between"
                      style={{ fontSize: '11px', color: COLORS.whiteDim }}
                    >
                      {/* Right: Teacher signature */}
                      <div className="text-center flex flex-col items-center" style={{ minWidth: '140px' }}>
                        <div
                          style={{
                            width: '140px',
                            borderBottom: `1px solid ${COLORS.goldDark}`,
                            marginBottom: '6px',
                            paddingBottom: '4px',
                            fontFamily: "'Amiri', serif",
                            fontSize: '15px',
                            color: COLORS.goldLight,
                            fontWeight: 700,
                          }}
                        >
                          مستر عمرو خالد
                        </div>
                        <p style={{ fontFamily: "'Noto Naskh Arabic', serif", fontWeight: 600, color: COLORS.whiteDim, fontSize: '11px' }}>
                          مدرس العلوم
                        </p>
                      </div>

                      {/* Center: Date + City + Serial */}
                      <div className="text-center flex flex-col items-center gap-1">
                        <div className="flex items-center gap-1.5">
                          <MapPin size={12} style={{ color: COLORS.gold }} />
                          <span style={{ fontFamily: "'Noto Naskh Arabic', serif", fontSize: '11px', color: COLORS.whiteDim, fontWeight: 600 }}>
                            {city || '________'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar size={12} style={{ color: COLORS.gold }} />
                          <span style={{ fontFamily: "'Noto Naskh Arabic', serif", fontSize: '11px', color: COLORS.whiteDim, fontWeight: 600 }}>
                            {certDate}
                          </span>
                        </div>
                        <div
                          style={{
                            marginTop: '4px',
                            padding: '2px 10px',
                            border: `0.5px solid ${COLORS.gold}`,
                            borderRadius: '3px',
                            fontFamily: "'Courier New', monospace",
                            fontSize: '9px',
                            color: COLORS.goldLight,
                            fontWeight: 700,
                            letterSpacing: '1px',
                          }}
                        >
                          {serial}
                        </div>
                      </div>

                      {/* Left: Platform director signature + Seal */}
                      <div className="text-center flex flex-col items-center" style={{ minWidth: '140px' }}>
                        {/* Embossed circular seal */}
                        <div
                          style={{
                            width: '58px',
                            height: '58px',
                            borderRadius: '50%',
                            border: `2.5px solid ${COLORS.gold}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '4px',
                            background: `radial-gradient(circle, ${COLORS.goldGlow} 0%, transparent 100%)`,
                            boxShadow: `0 2px 8px ${COLORS.goldGlow}, inset 0 0 0 1px ${COLORS.goldDark}`,
                            position: 'relative',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              inset: '4px',
                              borderRadius: '50%',
                              border: `1px solid ${COLORS.goldDark}`,
                              borderStyle: 'dashed',
                            }}
                          />
                          <Award size={24} style={{ color: COLORS.gold }} />
                        </div>
                        <div
                          style={{
                            width: '120px',
                            borderBottom: `1px solid ${COLORS.goldDark}`,
                            marginBottom: '6px',
                            paddingBottom: '2px',
                            fontFamily: "'Amiri', serif",
                            fontSize: '13px',
                            color: COLORS.goldLight,
                            fontWeight: 700,
                          }}
                        >
                          {settings.management_name?.replace('تحت إدارة ومتابعة ', '') || 'إدارة المنصة'}
                        </div>
                        <p style={{ fontFamily: "'Noto Naskh Arabic', serif", fontWeight: 600, color: COLORS.whiteDim, fontSize: '11px' }}>
                          توقيع مدير المنصة
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : selected ? (
            <div className="glass-card rounded-2xl p-12 text-center">
              <Award className="mx-auto text-amber-400 mb-4" size={48} />
              <p className="text-slate-400 mb-2">
                تم اختيار {selected?.name}.
              </p>
              <p className="text-slate-500 text-xs mb-4">
                اضغط «معاينة» لمشاهدة التصميم، أو «إصدار» للحفظ والطباعة.
              </p>
              {certMode === 'leaderboard' && (
                <p className="text-xs text-amber-400/70">
                  استخدم أزرار المعاينة والإصدار من قسم لوحة الشرف أعلاه.
                </p>
              )}
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-12 text-center">
              <FileText className="mx-auto text-slate-600 mb-4" size={48} />
              <p className="text-slate-400">اختر طالبًا من القائمة لإنشاء شهادة.</p>
            </div>
          )}
        </div>
      </div>

      {/* Issued Certificates List with Revoke */}
      {issuedCerts.length > 0 && (
        <div className="glass-card rounded-2xl p-5 mt-4">
          <h4 className="font-bold text-white mb-3 flex items-center gap-2">
            <Award size={18} className="text-amber-400" />
            الشهادات المُصدرة ({issuedCerts.length})
          </h4>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {issuedCerts.map((cert) => {
              const studentName = students.find((s) => s.id === cert.student_id)?.name ?? 'طالب';
              return (
                <div
                  key={cert.id}
                  className="glass-light rounded-xl p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white text-sm break-words leading-snug">{studentName}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {cert.exam_title ?? 'شهادة تفوق'} • {cert.serial_id}
                    </p>
                    {cert.score !== null && (
                      <p className="text-xs text-amber-400/70 mt-0.5">
                        {cert.score}/{cert.max_score ?? 100}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => setRevokeTarget(cert)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600/15 text-red-400 hover:bg-red-600/25 transition text-xs font-bold active:scale-95 flex-shrink-0"
                  >
                    <Ban size={14} /> إلغاء الشهادة
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Revoke Confirmation Dialog */}
      <ConfirmDialog
        open={!!revokeTarget}
        title="إلغاء الشهادة"
        message="هل أنت متأكد من إلغاء هذه الشهادة؟ سيتم حذفها نهائياً من النظام ومن بوابة ولي الأمر."
        confirmLabel="إلغاء الشهادة"
        cancelLabel="تراجع"
        danger
        onConfirm={handleRevoke}
        onClose={() => setRevokeTarget(null)}
        onCancel={() => setRevokeTarget(null)}
      />
      <StudentViewModal open={!!viewTarget} student={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
