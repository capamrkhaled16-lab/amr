import { useState, useEffect, useCallback } from 'react'
import { useReferenceData } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Select, Spinner, EmptyState } from '../components/ui'
import type { BehaviorEval, Student, Session } from '../types'
import { formatDateShort, todayISO } from '../lib/utils'
import { HeartPulse, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

const ratings: Array<{ value: string; label: string; color: string }> = [
  { value: 'excellent', label: 'ممتاز', color: 'bg-accent/20 text-accent' },
  { value: 'participatory', label: 'مشارك', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'quiet', label: 'هادئ', color: 'bg-white/10 text-white/60' },
  { value: 'disruptive', label: 'مزعج', color: 'bg-gold/20 text-gold' },
  { value: 'absent', label: 'غائب', color: 'bg-red-500/20 text-red-400' },
]

export default function Behavior() {
  const { assistant } = useAuth()
  const { groups, gradeLevels, stages, loading: refLoading } = useReferenceData()
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [evals, setEvals] = useState<BehaviorEval[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [localRatings, setLocalRatings] = useState<Record<string, string>>({})
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canDelete = assistant?.can_delete_evals === true

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) setSelectedGroupId(groups[0].id)
  }, [groups, selectedGroupId])

  const groupOptions = stages.flatMap(st =>
    gradeLevels.filter(gl => gl.stage_id === st.id).flatMap(gl =>
      groups.filter(g => g.grade_level_id === gl.id).map(g => ({ value: g.id, label: `${st.name} — ${gl.name} — ${g.name}` }))
    )
  )

  const fetchData = useCallback(async () => {
    if (!selectedGroupId) { setStudents([]); setSessions([]); setEvals([]); setLoading(false); return }
    setLoading(true)
    const [stuRes, sessRes] = await Promise.all([
      supabase.from('students').select('*').eq('group_id', selectedGroupId).eq('is_deleted', false).order('name'),
      supabase.from('sessions').select('*').eq('group_id', selectedGroupId).eq('is_deleted', false).order('session_date', { ascending: false }).limit(10),
    ])
    setStudents((stuRes.data as Student[]) || [])
    setSessions((sessRes.data as Session[]) || [])
    setLoading(false)
  }, [selectedGroupId])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) setSelectedSessionId(sessions[0].id)
    if (sessions.length === 0) setSelectedSessionId('')
  }, [sessions, selectedSessionId])

  const fetchEvals = useCallback(async () => {
    if (!selectedSessionId) { setEvals([]); return }
    const { data } = await supabase.from('behavior_eval').select('*').eq('session_id', selectedSessionId)
    if (data) {
      setEvals(data as BehaviorEval[])
      const rMap: Record<string, string> = {}
      const nMap: Record<string, string> = {}
      for (const ev of data as BehaviorEval[]) {
        rMap[ev.student_id] = ev.rating
        if (ev.note) nMap[ev.student_id] = ev.note
      }
      setLocalRatings(rMap)
      setLocalNotes(nMap)
    }
  }, [selectedSessionId])

  useEffect(() => { fetchEvals() }, [fetchEvals])

  const handleSave = async () => {
    if (!selectedSessionId || !selectedGroupId) return
    setSaving(true); setError('')
    const session = sessions.find(s => s.id === selectedSessionId)
    const evalDate = session?.session_date || todayISO()
    for (const stu of students) {
      const rating = localRatings[stu.id]
      if (!rating) continue
      await supabase.from('behavior_eval').upsert({
        student_id: stu.id, group_id: selectedGroupId, rating, note: localNotes[stu.id] || null,
        eval_date: evalDate, session_id: selectedSessionId, scope: 'daily',
      }, { onConflict: 'session_id,student_id' })
    }
    await fetchEvals()
    setSaving(false)
  }

  const handleDelete = async (ev: BehaviorEval) => {
    if (!canDelete) return
    await supabase.from('behavior_eval').delete().eq('id', ev.id)
    await fetchEvals()
  }

  if (refLoading) return <Spinner label="جارٍ تحميل البيانات..." />

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader title="تقييم السلوك" subtitle={ratings.map(r => r.label).join(' • ')} />

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedGroupId} onChange={(v) => { setSelectedGroupId(v); setSelectedSessionId('') }} options={groupOptions} placeholder="اختر المجموعة" className="min-w-[200px] flex-1" />
        {sessions.length > 0 && (
          <Select value={selectedSessionId} onChange={setSelectedSessionId} options={sessions.map(s => ({ value: s.id, label: `${s.title} — ${formatDateShort(s.session_date)}` }))} placeholder="اختر الحصة" className="min-w-[180px]" />
        )}
      </div>

      {loading ? <Spinner label="جارٍ التحميل..." /> : students.length === 0 ? (
        <EmptyState message="لا يوجد طلاب" icon={<HeartPulse size={48} />} />
      ) : !selectedSessionId ? (
        <EmptyState message="لا توجد حصص لهذه المجموعة" />
      ) : (
        <>
          {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}
          <div className="space-y-2">
            {students.map(stu => (
              <Card key={stu.id} className="p-3">
                <div className="flex items-center gap-3 mb-2">
                  <span className="flex-1 text-sm font-semibold text-white truncate">{stu.name}</span>
                  {canDelete && localRatings[stu.id] && (
                    <button onClick={() => { const ev = evals.find(e => e.student_id === stu.id); if (ev) handleDelete(ev) }} className="text-white/30 hover:text-red-400"><Trash2 size={14} /></button>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap">
                  {ratings.map(r => (
                    <button key={r.value} onClick={() => setLocalRatings(prev => ({ ...prev, [stu.id]: r.value }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${(localRatings[stu.id] || 'quiet') === r.value ? r.color : 'bg-bg-input text-white/30 hover:bg-bg-hover'}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <input
                  value={localNotes[stu.id] || ''}
                  onChange={(e) => setLocalNotes(prev => ({ ...prev, [stu.id]: e.target.value }))}
                  placeholder="ملاحظة..."
                  className="w-full mt-2 bg-bg-input border border-bg-border rounded-lg px-3 py-1.5 text-white text-xs outline-none focus:border-accent"
                />
              </Card>
            ))}
          </div>
          <button onClick={handleSave} disabled={saving} className="w-full bg-accent hover:bg-accent-hover text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50">
            {saving ? 'جارٍ الحفظ...' : 'حفظ التقييمات'}
          </button>
        </>
      )}
    </div>
  )
}
