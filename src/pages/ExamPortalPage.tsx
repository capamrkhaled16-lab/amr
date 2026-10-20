import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, LogIn, FileText, Clock, Award, KeyRound, AlertCircle, UserCheck, Phone, User, ShieldCheck, RotateCcw, Hourglass, CheckCircle2, XCircle, Loader2, Send } from 'lucide-react';
import { useSettings } from '@/context/SettingsContext';
import { fetchExamByAccessCode, fetchExamQuestions, verifyStudentForExam, hasStudentTakenExam, createReentryRequest, fetchReentryRequestStatus, fetchExamSubmissionForStudent, reopenSubmissionForReentry } from '@/lib/data';
import type { OnlineExam, ExamQuestion, Student, ExamReentryRequest } from '@/lib/types';
import ExamTaker from '@/components/modules/ExamTaker';

type BlockedState =
  | { kind: 'blocked'; exam: OnlineExam; questions: ExamQuestion[]; student: Student | null; name: string; phone: string }
  | { kind: 'request_sent'; request: ExamReentryRequest }
  | { kind: 'request_pending'; request: ExamReentryRequest }
  | { kind: 'request_approved'; exam: OnlineExam; questions: ExamQuestion[]; student: Student | null; submissionId: string }
  | { kind: 'request_rejected'; request: ExamReentryRequest };

export default function ExamPortalPage() {
  const { settings } = useSettings();
  const [accessCode, setAccessCode] = useState('');
  const [exam, setExam] = useState<OnlineExam | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'register' | 'exam'>('register');
  const [blocked, setBlocked] = useState<BlockedState | null>(null);
  const [reentryReason, setReentryReason] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let code = params.get('code');
    if (!code && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
      code = hashParams.get('code');
    }
    if (code) setAccessCode(code.toUpperCase());
  }, []);

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!studentName.trim()) { setError('برجاء إدخال اسمك بالكامل'); return; }
    if (!studentPhone.trim()) { setError('برجاء إدخال رقم الهاتف / الرقم التعريفي'); return; }
    if (!accessCode.trim()) { setError('برجاء إدخال كود الامتحان'); return; }

    setLoading(true);

    try {
      const ex = await fetchExamByAccessCode(accessCode);
      if (!ex) { setError('كود الامتحان غير صحيح أو الامتحان غير منشور'); return; }
      const qs = await fetchExamQuestions(ex.id);
      if (qs.length === 0) { setError('لا توجد أسئلة في هذا الامتحان بعد'); return; }

      const now = Date.now();
      if (ex.open_at && new Date(ex.open_at).getTime() > now) { setError('لم يبدأ هذا الامتحان بعد.'); return; }
      if (ex.close_at && new Date(ex.close_at).getTime() < now) { setError('انتهت الفترة المحددة لاداء هذا الامتحان.'); return; }

      let verifiedStudent: Student | null = null;

      if (ex.group_id || ex.grade_level_id) {
        const verification = await verifyStudentForExam(studentName, ex, studentPhone);
        if (!verification.allowed) { setError(verification.reason ?? 'لا يمكنك دخول هذا الامتحان'); return; }

        if (verification.student) {
          verifiedStudent = verification.student;
          const alreadyTaken = await hasStudentTakenExam(ex.id, verification.student.id);
          if (alreadyTaken) {
            // Check if there's an existing re-entry request
            const existingReq = await fetchReentryRequestStatus(ex.id, studentPhone.trim(), verification.student.id);
            if (existingReq) {
              if (existingReq.status === 'pending') {
                setBlocked({ kind: 'request_pending', request: existingReq });
              } else if (existingReq.status === 'approved') {
                // Find the existing submission and resume it
                const sub = await fetchExamSubmissionForStudent(ex.id, verification.student.id, studentPhone.trim());
                if (sub) {
                  await reopenSubmissionForReentry(sub.id);
                  setExam(ex); setQuestions(qs); setSelectedStudent(verification.student);
                  setStep('exam');
                } else {
                  setBlocked({ kind: 'blocked', exam: ex, questions: qs, student: verification.student, name: studentName, phone: studentPhone });
                }
              } else {
                setBlocked({ kind: 'request_rejected', request: existingReq });
              }
            } else {
              setBlocked({ kind: 'blocked', exam: ex, questions: qs, student: verification.student, name: studentName, phone: studentPhone });
            }
            return;
          }
        }

        setSelectedStudent(verifiedStudent);
      } else {
        // Open online exam — check by phone for existing attempts
        const existingReq = await fetchReentryRequestStatus(ex.id, studentPhone.trim(), null);
        if (existingReq && existingReq.status === 'pending') {
          setBlocked({ kind: 'request_pending', request: existingReq });
          return;
        }
        if (existingReq && existingReq.status === 'rejected') {
          setBlocked({ kind: 'request_rejected', request: existingReq });
          return;
        }

        // Check if already taken (for open exams, match by phone)
        const sub = await fetchExamSubmissionForStudent(ex.id, null, studentPhone.trim());
        if (sub && (sub.status === 'submitted' || sub.status === 'auto_submitted' || sub.status === 'cheated')) {
          if (existingReq && existingReq.status === 'approved') {
            await reopenSubmissionForReentry(sub.id);
            setExam(ex); setQuestions(qs); setSelectedStudent(null);
            setStep('exam');
            return;
          }
          setBlocked({ kind: 'blocked', exam: ex, questions: qs, student: null, name: studentName, phone: studentPhone });
          return;
        }

        setSelectedStudent(null);
      }

      setExam(ex);
      setQuestions(qs);
      setStep('exam');
    } catch {
      setError('حدث خطأ أثناء التحقق. تأكد من اتصالك بالإنترنت وحاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestReentry() {
    if (blocked?.kind !== 'blocked') return;
    setSubmittingRequest(true);
    try {
      const req = await createReentryRequest({
        exam_id: blocked.exam.id,
        student_id: blocked.student?.id ?? null,
        student_name: blocked.name,
        student_phone: blocked.phone,
        reason: reentryReason.trim() || null,
      });
      if (req) {
        setBlocked({ kind: 'request_sent', request: req });
      } else {
        setError('تعذر إرسال الطلب. حاول مرة أخرى.');
      }
    } catch {
      setError('تعذر إرسال الطلب. حاول مرة أخرى.');
    }
    setSubmittingRequest(false);
  }

  async function handleCheckRequestStatus() {
    if (!blocked || (blocked.kind !== 'request_sent' && blocked.kind !== 'request_pending')) return;
    const req = blocked.request;
    const ex = await fetchExamByAccessCode(accessCode);
    if (!ex) return;
    const latest = await fetchReentryRequestStatus(ex.id, req.student_phone, req.student_id);
    if (!latest) return;
    if (latest.status === 'approved') {
      const qs = await fetchExamQuestions(ex.id);
      const sub = await fetchExamSubmissionForStudent(ex.id, latest.student_id, latest.student_phone);
      if (sub) {
        await reopenSubmissionForReentry(sub.id);
        setExam(ex); setQuestions(qs); setSelectedStudent(null);
        setBlocked(null); setStep('exam');
      }
    } else if (latest.status === 'rejected') {
      setBlocked({ kind: 'request_rejected', request: latest });
    } else {
      setBlocked({ kind: 'request_pending', request: latest });
    }
  }

  function handleExit() {
    setStep('register');
    setExam(null);
    setQuestions([]);
    setSelectedStudent(null);
    setStudentName('');
    setStudentPhone('');
    setAccessCode('');
    setError('');
    setBlocked(null);
    setReentryReason('');
  }

  if (step === 'exam' && exam) {
    return (
      <ExamTaker
        examId={exam.id}
        studentName={selectedStudent?.name ?? (studentName.trim() || 'طالب أونلاين')}
        studentId={selectedStudent?.id}
        studentPhone={selectedStudent?.phone ?? (studentPhone.trim() || undefined)}
        onExit={handleExit}
      />
    );
  }

  if (blocked) {
    return (
      <BlockedScreen
        blocked={blocked}
        settings={settings}
        reentryReason={reentryReason}
        setReentryReason={setReentryReason}
        onSubmitRequest={handleRequestReentry}
        submittingRequest={submittingRequest}
        onCheckStatus={handleCheckRequestStatus}
        onBack={handleExit}
        examTitle={blocked.kind === 'blocked' || blocked.kind === 'request_approved' ? blocked.exam.title : ''}
        error={error}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card relative w-full max-w-md rounded-3xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center mb-6">
          {settings.logo_url ? (
            <img src={settings.logo_url} alt="logo" className="w-20 h-20 rounded-2xl object-cover ring-4 ring-emerald-500/40 mb-3" />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-emerald-600/20 flex items-center justify-center ring-4 ring-emerald-500/40 mb-3 animate-pulse-glow">
              <GraduationCap className="text-emerald-400" size={40} />
            </div>
          )}
          <h1 className="text-2xl font-extrabold gradient-text text-center">{settings.platform_name}</h1>
          <p className="text-sm text-emerald-400/70 mt-1 text-center">{settings.management_name}</p>
        </div>

        <div className="mb-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mb-3">
            <UserCheck className="text-emerald-400" size={28} />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">بوابة الامتحانات الإلكترونية</h2>
          <p className="text-sm text-slate-400">أدخل بياناتك للدخول إلى الامتحان</p>
        </div>

        <form onSubmit={handleRegisterSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2 flex items-center gap-1.5"><User size={14} /> الاسم بالكامل</label>
            <input type="text" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="مثال: محمد أحمد علي" className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition" autoComplete="off" autoFocus />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2 flex items-center gap-1.5"><Phone size={14} /> رقم الهاتف / الرقم التعريفي</label>
            <input type="tel" value={studentPhone} onChange={(e) => setStudentPhone(e.target.value)} placeholder="مثال: 01012345678" className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition" autoComplete="off" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2 flex items-center gap-1.5"><KeyRound size={14} /> كود الامتحان</label>
            <input type="text" value={accessCode} onChange={(e) => setAccessCode(e.target.value.toUpperCase())} placeholder="مثال: AB3X9K" maxLength={8} className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition font-mono font-bold text-lg tracking-widest text-center uppercase" autoComplete="off" />
          </div>

          {error && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center text-sm text-red-400 flex items-center justify-center gap-2">
              <AlertCircle size={16} /> {error}
            </motion.div>
          )}

          <button type="submit" disabled={loading || !studentName.trim() || !studentPhone.trim() || !accessCode.trim()} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3.5 rounded-xl font-semibold transition flex items-center justify-center gap-2 disabled:opacity-50">
            <LogIn size={18} />
            {loading ? 'جارٍ التحقق...' : 'دخول الامتحان'}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-2 text-xs text-amber-400/70 bg-amber-500/5 border border-amber-500/10 rounded-xl py-2.5 px-3">
          <ShieldCheck size={14} />
          <span>يتم التحقق من بياناتك مقابل القائمة المعتمدة. يُسمح بمحاولة واحدة فقط.</span>
        </div>

        {exam && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 glass-light rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold"><FileText size={16} /> {exam.title}</div>
            {exam.subject && <p className="text-xs text-slate-400">المادة: {exam.subject}</p>}
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1"><Clock size={12} /> {exam.duration_minutes} دقيقة</span>
              <span className="flex items-center gap-1"><Award size={12} /> {exam.total_score ?? 100} درجة</span>
              <span className="flex items-center gap-1"><FileText size={12} /> {questions.length} سؤال</span>
            </div>
            {exam.description && <p className="text-xs text-slate-500 mt-1">{exam.description}</p>}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

function BlockedScreen({ blocked, settings, reentryReason, setReentryReason, onSubmitRequest, submittingRequest, onCheckStatus, onBack, examTitle, error }: {
  blocked: BlockedState;
  settings: { platform_name: string; management_name: string; logo_url: string | null };
  reentryReason: string;
  setReentryReason: (v: string) => void;
  onSubmitRequest: () => void;
  submittingRequest: boolean;
  onCheckStatus: () => void;
  onBack: () => void;
  examTitle: string;
  error: string;
}) {
  const kind = blocked.kind;
  const title = kind === 'blocked' ? blocked.exam.title
    : kind === 'request_sent' || kind === 'request_pending' || kind === 'request_rejected'
      ? 'طلب إعادة دخول'
      : blocked.exam.title;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-amber-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-red-600/10 rounded-full blur-[100px]" />
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card relative w-full max-w-md rounded-3xl p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-6">
          {settings.logo_url ? (
            <img src={settings.logo_url} alt="logo" className="w-16 h-16 rounded-2xl object-cover ring-4 ring-amber-500/30 mb-3" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-amber-600/20 flex items-center justify-center ring-4 ring-amber-500/30 mb-3">
              <GraduationCap className="text-amber-400" size={32} />
            </div>
          )}
          <h1 className="text-xl font-extrabold gradient-text text-center">{settings.platform_name}</h1>
        </div>

        {/* Blocked — show request form */}
        {kind === 'blocked' && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mb-3">
                <RotateCcw className="text-amber-400" size={28} />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">لقد قمت بأداء هذا الامتحان بالفعل</h2>
              <p className="text-sm text-slate-400">{title}</p>
              <p className="text-xs text-slate-500 mt-2">يمكنك طلب الإذن من المعلم لإعادة الدخول. سيتم إشعار المعلم بطلبك.</p>
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-2">سبب طلب إعادة الدخول (اختياري)</label>
              <textarea
                value={reentryReason}
                onChange={(e) => setReentryReason(e.target.value)}
                placeholder="مثال: انقطع الاتصال، خطأ تقني، لم أتمكن من التسليم..."
                rows={3}
                className="w-full glass-light rounded-xl py-3 px-4 text-white placeholder-slate-500 border border-white/10 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition text-sm resize-none"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center text-sm text-red-400 flex items-center justify-center gap-2">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <button
              onClick={onSubmitRequest}
              disabled={submittingRequest}
              className="w-full bg-amber-600 hover:bg-amber-500 text-white py-3.5 rounded-xl font-semibold transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submittingRequest ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              {submittingRequest ? 'جارٍ إرسال الطلب...' : 'طلب السماح بإعادة الدخول'}
            </button>
            <button onClick={onBack} className="w-full glass-light text-slate-400 py-3 rounded-xl text-sm hover:bg-white/10 transition">رجوع</button>
          </div>
        )}

        {/* Request sent — confirmation */}
        {kind === 'request_sent' && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-sky-500/15 flex items-center justify-center mb-3">
              <CheckCircle2 className="text-sky-400" size={28} />
            </div>
            <h2 className="text-lg font-bold text-white">تم إرسال طلبك بنجاح</h2>
            <p className="text-sm text-slate-400">تم إشعار المعلم بطلبك. سيتمكن من الموافقة أو الرفض من لوحة التحكم.</p>
            <p className="text-xs text-slate-500">وقت الطلب: {new Date(blocked.request.created_at).toLocaleString('ar-EG')}</p>
            <button onClick={onCheckStatus} className="w-full bg-sky-600 hover:bg-sky-500 text-white py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2">
              <RotateCcw size={16} /> التحقق من حالة الطلب
            </button>
            <button onClick={onBack} className="w-full glass-light text-slate-400 py-3 rounded-xl text-sm hover:bg-white/10 transition">رجوع</button>
          </div>
        )}

        {/* Request pending — waiting */}
        {kind === 'request_pending' && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mb-3">
              <Hourglass className="text-amber-400 size-7 animate-pulse" />
            </div>
            <h2 className="text-lg font-bold text-white">طلبك قيد المراجعة</h2>
            <p className="text-sm text-slate-400">لم يتخذ المعلم قراراً بعد. يمكنك التحقق مرة أخرى لاحقاً.</p>
            <p className="text-xs text-slate-500">وقت الطلب: {new Date(blocked.request.created_at).toLocaleString('ar-EG')}</p>
            <button onClick={onCheckStatus} className="w-full bg-amber-600 hover:bg-amber-500 text-white py-3 rounded-xl font-semibold transition flex items-center justify-center gap-2">
              <RotateCcw size={16} /> التحقق من حالة الطلب
            </button>
            <button onClick={onBack} className="w-full glass-light text-slate-400 py-3 rounded-xl text-sm hover:bg-white/10 transition">رجوع</button>
          </div>
        )}

        {/* Request rejected */}
        {kind === 'request_rejected' && (
          <div className="space-y-4 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mb-3">
              <XCircle className="text-red-400" size={28} />
            </div>
            <h2 className="text-lg font-bold text-white">تم رفض طلبك</h2>
            <p className="text-sm text-slate-400">رفض المعلم طلب إعادة الدخول. لا يمكنك إعادة هذا الامتحان.</p>
            {blocked.request.resolved_at && (
              <p className="text-xs text-slate-500">وقت الرفض: {new Date(blocked.request.resolved_at).toLocaleString('ar-EG')}</p>
            )}
            <button onClick={onBack} className="w-full glass-light text-slate-400 py-3 rounded-xl text-sm hover:bg-white/10 transition">رجوع</button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
