import { useState, useEffect, useCallback } from 'react'
import { useReferenceData } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Select, Input, Spinner, EmptyState, Badge } from '../components/ui'
import type { Homework as HomeworkType, HomeworkStatus, Student, Session } from '../types'
import { formatDateShort, todayISO } from '../lib/utils'
import { Plus, BookOpen, Pencil, Trash2, Check } from 'lucide-react'

export default function HomeworkPage() {
  const { groups, gradeLevels, stages, loading: refLoading } = useReferenceData()
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [homeworks, setHomeworks] = useState<HomeworkType[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<HomeworkType | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formDueDate, setFormDueDate] = useState(todayISO())
  const [formSessionId, setFormSessionId] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedHwId, setSelectedHwId] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [hwStatuses, setHwStatuses] = useState<Record<string, string>>({})
  const [savingStatuses, setSavingStatuses] = useState(false)

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) setSelectedGroupId(groups[0].id)
  }, [groups, selectedGroupId])

  const groupOptions = stages.flatMap(st =>
    gradeLevels.filter(gl => gl.stage_id === st.id).flatMap(gl =>
      groups.filter(g => g.grade_level_id === gl.id).map(g => ({ value: g.id, label: `${st.name} — ${gl.name} — ${g.name}` }))
    )
  )

  const fetchHomeworks = useCallback(async () => {
    if (!selectedGroupId) { setHomeworks([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('homework').select('*').eq('group_id', selectedGroupId).order('due_date', { ascending: false }).limit(50)
    setHomeworks((data as HomeworkType[]) || [])
    setLoading(false)
  }, [selectedGroupId])

  const fetchSessions = useCallback(async () => {
    if (!selectedGroupId) { setSessions([]); return }
    const { data } = await supabase.from('sessions').select('*').eq('group_id', selectedGroupId).eq('is_deleted', false).order('session_date', { ascending: false }).limit(10)
    setSessions((data as Session[]) || [])
  }, [selectedGroupId])

  const fetchStudents = useCallback(async () => {
    if (!selectedGroupId) { setStudents([]); return }
    const { data } = await supabase.from('students').select('*').eq('group_id', selectedGroupId).eq('is_deleted', false).order('name')
    setStudents((data as Student[]) || [])
  }, [selectedGroupId])

  useEffect(() => { fetchHomeworks(); fetchSessions(); fetchStudents() }, [fetchHomeworks, fetchSessions, fetchStudents])

  const fetchStatuses = useCallback(async (hwId: string) => {
    const { data } = await supabase.from('homework_status').select('*').eq('homework_id', hwId)
    if (data) {
      const map: Record<string, string> = {}
      for (const s of data as HomeworkStatus[]) { map[s.student_id] = s.status }
      setHwStatuses(map)
    }
  }, [])

  useEffect(() => { if (selectedHwId) fetchStatuses(selectedHwId) }, [selectedHwId, fetchStatuses])

  const handleSave = async () => {
    if (!formTitle.trim() || !selectedGroupId || !formSessionId) { setError('يرجى إدخال العنوان واختيار الحصة'); return }
    setSaving(true); setError('')
    if (editing) {
      const { error: e } = await supabase.from('homework').update({
        title: formTitle.trim(), description: formDesc.trim() || null, due_date: formDueDate,
      }).eq('id', editing.id)
      if (e) { setError(e.message); setSaving(false); return }
    } else {
      const { error: e } = await supabase.from('homework').insert({
        group_id: selectedGroupId, title: formTitle.trim(), description: formDesc.trim() || null,
        due_date: formDueDate, session_id: formSessionId,
      })
      if (e) { setError(e.message); setSaving(false); return }
    }
    await fetchHomeworks()
    setShowForm(false); setEditing(null); setFormTitle(''); setFormDesc(''); setFormDueDate(todayISO()); setFormSessionId('')
    setSaving(false)
  }

  const handleDelete = async (hw: HomeworkType) => {
    if (!confirm(`حذف الواجب "${hw.title}"؟`)) return
    await supabase.from('homework').delete().eq('id', hw.id)
    await fetchHomeworks()
  }

  const handleSaveStatuses = async () => {
    if (!selectedHwId) return
    setSavingStatuses(true)
    for (const stu of students) {
      const status = hwStatuses[stu.id] || 'incomplete'
      await supabase.from('homework_status').upsert({
        homework_id: selectedHwId, student_id: stu.id, status, recorded_at: new Date().toISOString(),
      }, { onConflict: 'homework_id,student_id' })
    }
    await fetchStatuses(selectedHwId)
    setSavingStatuses(false)
  }

  if (refLoading) return <Spinner label="جارٍ تحميل البيانات..." />

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader title="الواجبات" action={<Button onClick={() => { setEditing(null); setFormTitle(''); setFormDesc(''); setFormDueDate(todayISO()); setFormSessionId(''); setShowForm(true) }} disabled={!selectedGroupId}><Plus size={18} /> واجب جديد</Button>} />

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

      <Select value={selectedGroupId} onChange={(v) => { setSelectedGroupId(v); setSelectedHwId('') }} options={groupOptions} placeholder="اختر المجموعة" className="min-w-[200px] flex-1" />

      {showForm && (
        <Card className="p-4 space-y-3 animate-fadeIn">
          <h3 className="font-semibold text-white">{editing ? 'تعديل واجب' : 'واجب جديد'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="block text-xs text-white/50 mb-1.5">العنوان</label><Input value={formTitle} onChange={setFormTitle} placeholder="واجب الفصل الأول" className="w-full" /></div>
            <div><label className="block text-xs text-white/50 mb-1.5">الحصة</label>
              <Select value={formSessionId} onChange={setFormSessionId} options={sessions.map(s => ({ value: s.id, label: `${s.title} — ${formatDateShort(s.session_date)}` }))} placeholder="اختر الحصة" className="w-full" />
            </div>
            <div><label className="block text-xs text-white/50 mb-1.5">تاريخ التسليم</label><Input type="date" value={formDueDate} onChange={setFormDueDate} dir="ltr" className="w-full" /></div>
            <div className="sm:col-span-2"><label className="block text-xs text-white/50 mb-1.5">الوصف</label><Input value={formDesc} onChange={setFormDesc} placeholder="تفاصيل الواجب" className="w-full" /></div>
          </div>
          <div className="flex gap-2"><Button onClick={handleSave} disabled={saving || !formTitle.trim()}>{saving ? 'جارٍ الحفظ...' : 'حفظ'}</Button><Button variant="ghost" onClick={() => setShowForm(false)}>إلغاء</Button></div>
        </Card>
      )}

      {loading ? <Spinner label="جارٍ تحميل الواجبات..." /> : homeworks.length === 0 ? (
        <EmptyState message="لا توجد واجبات" icon={<BookOpen size={48} />} />
      ) : (
        <div className="space-y-2">
          {homeworks.map(hw => (
            <Card key={hw.id} className={`p-4 cursor-pointer transition-colors ${selectedHwId === hw.id ? 'border-accent' : 'hover:bg-bg-hover'}`} >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0" onClick={() => setSelectedHwId(hw.id === selectedHwId ? '' : hw.id)}>
                  <p className="font-semibold text-white truncate">{hw.title}</p>
                  {hw.description && <p className="text-xs text-white/40 truncate mt-0.5">{hw.description}</p>}
                  <div className="flex items-center gap-2 mt-1"><span className="text-xs text-white/30">تسليم: {formatDateShort(hw.due_date)}</span>{hw.is_closed && <Badge color="red">مغلق</Badge>}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(hw); setFormTitle(hw.title); setFormDesc(hw.description || ''); setFormDueDate(hw.due_date || todayISO()); setFormSessionId(hw.session_id); setShowForm(true) }}><Pencil size={16} /></Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(hw)}><Trash2 size={16} /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selectedHwId && (
        <Card className="p-4 animate-fadeIn">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">حالة الواجبات</h3>
            <Button size="sm" onClick={handleSaveStatuses} disabled={savingStatuses}><Check size={16} /> {savingStatuses ? 'جارٍ الحفظ...' : 'حفظ'}</Button>
          </div>
          <div className="space-y-2">
            {students.map(stu => (
              <div key={stu.id} className="flex items-center gap-3 py-1.5 border-b border-bg-border last:border-0">
                <span className="flex-1 text-sm text-white truncate">{stu.name}</span>
                <div className="flex gap-1">
                  {['complete', 'incomplete', 'partial'].map(s => (
                    <button key={s} onClick={() => setHwStatuses(prev => ({ ...prev, [stu.id]: s }))}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        (hwStatuses[stu.id] || 'incomplete') === s
                          ? s === 'complete' ? 'bg-accent/20 text-accent' : s === 'incomplete' ? 'bg-red-500/20 text-red-400' : 'bg-gold/20 text-gold'
                          : 'bg-bg-input text-white/30 hover:bg-bg-hover'
                      }`}>
                      {s === 'complete' ? 'مكتمل' : s === 'incomplete' ? 'لم يفعل' : 'جزئي'}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
