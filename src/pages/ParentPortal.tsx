import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { getStudentByToken, getStudentRanking } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { Card, Spinner } from '../components/ui'
import type { Student, HallOfFameEntry } from '../types'
import { formatDate, currentMonthLabel } from '../lib/utils'
import { Trophy, Medal, Calendar, BookOpen, ClipboardCheck, Award, TrendingUp } from 'lucide-react'

export default function ParentPortal() {
  const { token } = useParams<{ token: string }>()
  const [student, setStudent] = useState<Student | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rank, setRank] = useState<number | null>(null)
  const [total, setTotal] = useState(0)
  const [entry, setEntry] = useState<HallOfFameEntry | null>(null)
  const [recentAttendance, setRecentAttendance] = useState<Array<{ status: string; attendance_date: string; session_id: string | null }>>([])
  const [groupName, setGroupName] = useState('—')
  const [gradeName, setGradeName] = useState('—')
  const [stageName, setStageName] = useState('—')

  useEffect(() => {
    if (!token) {
      setError('رابط غير صحيح')
      setLoading(false)
      return
    }

    (async () => {
      const { student: stu, error: stuError } = await getStudentByToken(token)
      if (stuError) {
        setError('تعذّر تحميل البيانات')
        setLoading(false)
        return
      }
      if (!stu) {
        setError('لم يتم العثور على الطالب. تأكد من صحة الرابط.')
        setLoading(false)
        return
      }

      setStudent(stu)

      // Get ranking — only shows a rank if the student has verifiable data
      const { rank: studentRank, total: totalStudents, entry: rankEntry } = await getStudentRanking(stu.id)
      setRank(studentRank)
      setTotal(totalStudents)
      setEntry(rankEntry)

      // Get group name
      if (stu.group_id) {
        const { data: groupData } = await supabase
          .from('groups')
          .select('name, grade_level_id')
          .eq('id', stu.group_id)
          .maybeSingle()

        if (groupData) {
          setGroupName((groupData as { name: string }).name)
          const { data: gradeData } = await supabase
            .from('grade_levels')
            .select('name, stage_id')
            .eq('id', (groupData as { grade_level_id: string }).grade_level_id)
            .maybeSingle()
          if (gradeData) {
            setGradeName((gradeData as { name: string }).name)
            const { data: stageData } = await supabase
              .from('academic_stages')
              .select('name')
              .eq('id', (gradeData as { stage_id: string }).stage_id)
              .maybeSingle()
            if (stageData) {
              setStageName((stageData as { name: string }).name)
            }
          }
        }
      }

      // Get recent attendance
      const { data: attData } = await supabase
        .from('attendance')
        .select('status, attendance_date, session_id')
        .eq('student_id', stu.id)
        .order('attendance_date', { ascending: false })
        .limit(10)

      if (attData) {
        setRecentAttendance(attData as Array<{ status: string; attendance_date: string; session_id: string | null }>)
      }

      setLoading(false)
    })()
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <Spinner label="جارٍ تحميل بيانات الطالب..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <Card className="p-6 text-center max-w-md">
          <p className="text-red-400">{error}</p>
        </Card>
      </div>
    )
  }

  if (!student) return null

  const hasRank = rank !== null && entry && (entry.overall_score ?? 0) > 0

  return (
    <div className="min-h-screen bg-bg p-4">
      <div className="max-w-2xl mx-auto space-y-4 animate-fadeIn">
        {/* Header */}
        <Card className="p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent/20 flex items-center justify-center mx-auto mb-3">
            <span className="text-accent text-2xl font-bold">{student.name.charAt(0)}</span>
          </div>
          <h1 className="text-xl font-bold text-white">{student.name}</h1>
          <p className="text-sm text-white/40 mt-1">{stageName} — {gradeName}</p>
          <p className="text-sm text-white/30">{groupName}</p>
        </Card>

        {/* Ranking */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trophy size={20} className="text-gold" />
            <h2 className="text-lg font-bold text-white">ترتيب الطالب</h2>
            <span className="text-xs text-white/30 mr-auto">{currentMonthLabel()}</span>
          </div>

          {hasRank ? (
            <div className="flex items-center gap-4">
              <div className={`w-20 h-20 rounded-2xl flex flex-col items-center justify-center ${
                rank === 1 ? 'bg-gold/20' : rank === 2 ? 'bg-gray-300/20' : rank === 3 ? 'bg-orange-500/20' : 'bg-bg-input'
              }`}>
                {rank === 1 ? <Trophy size={28} className="text-gold" /> :
                 rank === 2 ? <Medal size={28} className="text-gray-300" /> :
                 rank === 3 ? <Medal size={28} className="text-orange-400" /> :
                 <TrendingUp size={28} className="text-accent" />}
                <p className="text-2xl font-bold text-white mt-1">{rank}</p>
              </div>
              <div className="flex-1">
                <p className="text-sm text-white/60">
                  ترتيب الطالب رقم <span className="text-white font-bold">{rank}</span> من أصل <span className="text-white font-bold">{total}</span> طالب في المجموعة
                </p>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="bg-bg-input rounded-lg p-2 text-center">
                    <p className="text-xs text-white/30">النقاط</p>
                    <p className="text-sm font-bold text-accent">{entry?.overall_score}</p>
                  </div>
                  <div className="bg-bg-input rounded-lg p-2 text-center">
                    <p className="text-xs text-white/30">الحضور</p>
                    <p className="text-sm font-bold text-white">{entry?.attendance_rate}%</p>
                  </div>
                  <div className="bg-bg-input rounded-lg p-2 text-center">
                    <p className="text-xs text-white/30">الواجب</p>
                    <p className="text-sm font-bold text-white">{entry?.homework_rate != null ? `${entry.homework_rate}%` : '—'}</p>
                  </div>
                  <div className="bg-bg-input rounded-lg p-2 text-center">
                    <p className="text-xs text-white/30">الامتحانات</p>
                    <p className="text-sm font-bold text-white">{entry?.exams_taken}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-white/40 text-sm">
                لا توجد بيانات كافية لاحتساب ترتيب الطالب هذا الشهر.
              </p>
              <p className="text-white/30 text-xs mt-1">
                يبدأ الترتيب من أول امتحان أو حضور مسجل في الشهر الحالي.
              </p>
            </div>
          )}
        </Card>

        {/* Recent attendance */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck size={20} className="text-accent" />
            <h2 className="text-lg font-bold text-white">آخر الحضور</h2>
          </div>
          {recentAttendance.length === 0 ? (
            <p className="text-white/40 text-sm text-center py-3">لا توجد سجلات حضور</p>
          ) : (
            <div className="space-y-1.5">
              {recentAttendance.map((att, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-bg-border last:border-0">
                  <span className="text-sm text-white/60">{formatDate(att.attendance_date)}</span>
                  <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${
                    att.status === 'present' ? 'bg-accent/10 text-accent' :
                    att.status === 'absent' ? 'bg-red-500/10 text-red-400' :
                    att.status === 'late' ? 'bg-gold/10 text-gold' :
                    'bg-white/5 text-white/30'
                  }`}>
                    {att.status === 'present' ? 'حاضر' : att.status === 'absent' ? 'غائب' : att.status === 'late' ? 'متأخر' : 'غير مسجل'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
