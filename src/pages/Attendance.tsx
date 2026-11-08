import { useState, useEffect } from 'react'
import { useReferenceData, useGroupSessions, useGroupStudents, useSessionAttendance, saveBulkAttendance, invalidateCache } from '../hooks/useData'
import { PageHeader, Card, Button, Select, Spinner, EmptyState, Badge } from '../components/ui'
import { supabase } from '../lib/supabase'
import type { Session, Student, Attendance as AttendanceType } from '../types'
import { formatDateShort, todayISO, currentMonthLabel } from '../lib/utils'
import { Check, AlertCircle, ClipboardCheck, Users } from 'lucide-react'

type StatusValue = 'present' | 'absent' | 'late' | 'unrecorded'

const statusConfig: Record<StatusValue, { label: string; color: string; badge: 'green' | 'red' | 'gold' | 'default' }> = {
  present: { label: 'حاضر', color: 'text-accent', badge: 'green' },
  absent: { label: 'غائب', color: 'text-red-400', badge: 'red' },
  late: { label: 'متأخر', color: 'text-gold', badge: 'gold' },
  unrecorded: { label: 'غير مسجل', color: 'text-white/30', badge: 'default' },
}

export default function Attendance() {
  const { groups, gradeLevels, stages, loading: refLoading } = useReferenceData()
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')
  const [localAttendance, setLocalAttendance] = useState<Record<string, StatusValue>>({})

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].id)
    }
  }, [groups, selectedGroupId])

  const { sessions, loading: sessLoading } = useGroupSessions(selectedGroupId || null)
  const { students, loading: stuLoading } = useGroupStudents(selectedGroupId || null)
  const { attendance, loading: attLoading, refetch } = useSessionAttendance(selectedSessionId || null)

  // Auto-select latest session
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0].id)
    }
    if (sessions.length === 0) {
      setSelectedSessionId('')
    }
  }, [sessions, selectedSessionId])

  // Sync attendance from DB to local state
  useEffect(() => {
    const map: Record<string, StatusValue> = {}
    for (const att of attendance) {
      map[att.student_id] = (att.status as StatusValue) || 'unrecorded'
    }
    setLocalAttendance(map)
  }, [attendance])

  // Clear messages
  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [saveSuccess])

  const groupOptions = stages.flatMap(st =>
    gradeLevels
      .filter(gl => gl.stage_id === st.id)
      .flatMap(gl =>
        groups
          .filter(g => g.grade_level_id === gl.id)
          .map(g => ({ value: g.id, label: `${st.name} — ${gl.name} — ${g.name}` }))
      )
  )

  const sessionOptions = sessions.map(s => ({
    value: s.id,
    label: `${s.title} — ${formatDateShort(s.session_date)}`,
  }))

  const selectedSession = sessions.find(s => s.id === selectedSessionId)

  const setStudentStatus = (studentId: string, status: StatusValue) => {
    setLocalAttendance(prev => ({ ...prev, [studentId]: status }))
  }

  const handleSave = async () => {
    if (!selectedSession || !selectedGroupId) return
    setSaving(true)
    setSaveError('')
    setSaveSuccess('')

    const records = students.map(student => ({
      student_id: student.id,
      group_id: selectedGroupId,
      status: localAttendance[student.id] || 'unrecorded',
      attendance_date: selectedSession.session_date || todayISO(),
      session_id: selectedSession.id,
    }))

    // Only save students with a status set
    const toSave = records.filter(r => r.status !== 'unrecorded')

    if (toSave.length === 0) {
      setSaveError('لم يتم تحديد أي حالة حضور')
      setSaving(false)
      return
    }

    const { errors, successCount } = await saveBulkAttendance(toSave)

    if (errors.length > 0) {
      setSaveError(`تم حفظ ${successCount} سجل، ولكن فشل ${errors.length} سجل`)
    } else {
      setSaveSuccess(`تم حفظ حضور ${successCount} طالب بنجاح في قاعدة البيانات`)
    }

    // Re-fetch from DB to confirm what was actually saved
    await refetch()
    invalidateCache('attendance')
    setSaving(false)
  }

  const setAllPresent = () => {
    const map: Record<string, StatusValue> = {}
    for (const s of students) {
      map[s.id] = 'present'
    }
    setLocalAttendance(map)
  }

  if (refLoading) {
    return <Spinner label="جارٍ تحميل البيانات..." />
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader
        title="الحضور والانصراف"
        subtitle={currentMonthLabel()}
        action={
          <Button onClick={handleSave} disabled={saving || !selectedSession || students.length === 0}>
            <Check size={18} /> {saving ? 'جارٍ الحفظ...' : 'حفظ الحضور'}
          </Button>
        }
      />

      {saveError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle size={18} /> {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 text-accent text-sm flex items-center gap-2">
          <Check size={18} /> {saveSuccess}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={selectedGroupId}
          onChange={(v) => { setSelectedGroupId(v); setSelectedSessionId('') }}
          options={groupOptions}
          placeholder="اختر المجموعة"
          className="min-w-[200px] flex-1"
        />
        {sessionOptions.length > 0 && (
          <Select
            value={selectedSessionId}
            onChange={setSelectedSessionId}
            options={sessionOptions}
            placeholder="اختر الحصة"
            className="min-w-[180px]"
          />
        )}
      </div>

      {sessLoading || stuLoading || attLoading ? (
        <Spinner label="جارٍ تحميل الحضور..." />
      ) : students.length === 0 ? (
        <EmptyState message="لا يوجد طلاب في هذه المجموعة" icon={<Users size={48} />} />
      ) : !selectedSession ? (
        <EmptyState message="لا توجد حصص لهذه المجموعة. أنشئ حصة أولاً" icon={<ClipboardCheck size={48} />} />
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-white/40">
              {selectedSession.title} — {formatDateShort(selectedSession.session_date)}
            </p>
            <Button variant="secondary" size="sm" onClick={setAllPresent}>
              تعليم الكل حاضر
            </Button>
          </div>

          <div className="space-y-2">
            {students.map(student => {
              const status = localAttendance[student.id] || 'unrecorded'
              const config = statusConfig[status]
              return (
                <Card key={student.id} className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{student.name}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge color={config.badge}>{config.label}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {(['present', 'absent', 'late'] as StatusValue[]).map(s => (
                      <button
                        key={s}
                        onClick={() => setStudentStatus(student.id, s)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          status === s
                            ? s === 'present' ? 'bg-accent/20 text-accent border border-accent/40'
                              : s === 'absent' ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                              : 'bg-gold/20 text-gold border border-gold/40'
                            : 'bg-bg-input text-white/40 border border-transparent hover:bg-bg-hover'
                        }`}
                      >
                        {statusConfig[s].label}
                      </button>
                    ))}
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
