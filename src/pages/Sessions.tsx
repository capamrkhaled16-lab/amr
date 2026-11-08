import { useState, useEffect, useCallback } from 'react'
import { useReferenceData, useGroupSessions, createSession, updateSession, deleteSession, invalidateCache } from '../hooks/useData'
import { PageHeader, Card, Button, Select, Input, Spinner, EmptyState, Badge } from '../components/ui'
import { supabase } from '../lib/supabase'
import type { Session } from '../types'
import { formatDateShort, todayISO, currentMonthLabel } from '../lib/utils'
import { Plus, Pencil, Trash2, Calendar, Check, AlertCircle } from 'lucide-react'

export default function Sessions() {
  const { groups, gradeLevels, stages, loading: refLoading } = useReferenceData()
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingSession, setEditingSession] = useState<Session | null>(null)
  const [formDate, setFormDate] = useState(todayISO())
  const [formTitle, setFormTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')

  // Auto-select first group
  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].id)
    }
  }, [groups, selectedGroupId])

  const { sessions, loading, refetch } = useGroupSessions(selectedGroupId || null)

  // Clear messages after 3 seconds
  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(''), 3000)
      return () => clearTimeout(timer)
    }
  }, [saveSuccess])

  const groupName = (gid: string) => groups.find(g => g.id === gid)?.name || '—'

  const groupOptions = stages.flatMap(st =>
    gradeLevels
      .filter(gl => gl.stage_id === st.id)
      .flatMap(gl =>
        groups
          .filter(g => g.grade_level_id === gl.id)
          .map(g => ({ value: g.id, label: `${st.name} — ${gl.name} — ${g.name}` }))
      )
  )

  const handleCreate = async () => {
    if (!selectedGroupId || !formDate) return
    setSaving(true)
    setSaveError('')
    setSaveSuccess('')

    const { data, error } = await createSession(selectedGroupId, formDate, formTitle.trim() || undefined)

    if (error) {
      setSaveError(`تعذّر حفظ الحصة: ${error}`)
      setSaving(false)
      return
    }

    // Confirm the session was actually saved by re-fetching
    await refetch()
    invalidateCache('sessions')

    setSaveSuccess(`تم حفظ الحصة "${data?.title}" بنجاح`)
    setShowForm(false)
    setFormTitle('')
    setFormDate(todayISO())
    setSaving(false)
  }

  const handleEdit = async () => {
    if (!editingSession) return
    setSaving(true)
    setSaveError('')
    setSaveSuccess('')

    const updates: { title?: string; session_date?: string } = {}
    if (formTitle.trim()) updates.title = formTitle.trim()
    if (formDate) updates.session_date = formDate

    const { error } = await updateSession(editingSession.id, updates)

    if (error) {
      setSaveError(`تعذّر تعديل الحصة: ${error}`)
      setSaving(false)
      return
    }

    await refetch()
    invalidateCache('sessions')
    setSaveSuccess('تم تعديل الحصة بنجاح')
    setEditingSession(null)
    setShowForm(false)
    setFormTitle('')
    setFormDate(todayISO())
    setSaving(false)
  }

  const handleDelete = async (session: Session) => {
    if (!confirm(`حذف الحصة "${session.title}"؟ سيتم إخفاؤها فقط دون فقدان البيانات.`)) return
    setSaving(true)
    const { error } = await deleteSession(session.id)
    if (error) {
      setSaveError(`تعذّر حذف الحصة: ${error}`)
    } else {
      await refetch()
      setSaveSuccess('تم حذف الحصة')
    }
    setSaving(false)
  }

  const openCreate = () => {
    setEditingSession(null)
    setFormDate(todayISO())
    setFormTitle('')
    setShowForm(true)
    setSaveError('')
  }

  const openEdit = (session: Session) => {
    setEditingSession(session)
    setFormDate(session.session_date || todayISO())
    setFormTitle(session.title)
    setShowForm(true)
    setSaveError('')
  }

  // Get attendance count per session (lazy, lightweight)
  const [attCounts, setAttCounts] = useState<Record<string, number>>({})
  const fetchAttCounts = useCallback(async (sessionIds: string[]) => {
    if (sessionIds.length === 0) return
    const { data, error } = await supabase
      .from('attendance')
      .select('session_id')
      .in('session_id', sessionIds)
    if (!error && data) {
      const counts: Record<string, number> = {}
      for (const row of data) {
        const sid = (row as { session_id: string }).session_id
        counts[sid] = (counts[sid] || 0) + 1
      }
      setAttCounts(counts)
    }
  }, [])

  useEffect(() => {
    setAttCounts({})
    if (sessions.length > 0) {
      fetchAttCounts(sessions.map(s => s.id))
    }
  }, [sessions, fetchAttCounts])

  if (refLoading) {
    return <Spinner label="جارٍ تحميل البيانات..." />
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader
        title="الحصص"
        subtitle={currentMonthLabel()}
        action={<Button onClick={openCreate} disabled={!selectedGroupId}><Plus size={18} /> حصة جديدة</Button>}
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
          onChange={setSelectedGroupId}
          options={groupOptions}
          placeholder="اختر المجموعة"
          className="min-w-[200px] flex-1"
        />
      </div>

      {showForm && (
        <Card className="p-4 space-y-3 animate-fadeIn">
          <h3 className="font-semibold text-white">{editingSession ? 'تعديل الحصة' : 'حصة جديدة'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1.5">تاريخ الحصة</label>
              <Input type="date" value={formDate} onChange={setFormDate} dir="ltr" className="w-full" />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1.5">عنوان الحصة (اختياري)</label>
              <Input value={formTitle} onChange={setFormTitle} placeholder="مثال: الحصة 5" className="w-full" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={editingSession ? handleEdit : handleCreate} disabled={saving || !formDate}>
              {saving ? 'جارٍ الحفظ...' : 'حفظ'}
            </Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditingSession(null) }}>
              إلغاء
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <Spinner label="جارٍ تحميل الحصص..." />
      ) : sessions.length === 0 ? (
        <EmptyState message="لا توجد حصص لهذه المجموعة بعد" icon={<Calendar size={48} />} />
      ) : (
        <div className="space-y-2">
          {sessions.map(session => (
            <Card key={session.id} className="p-4 flex items-center gap-3 hover:bg-bg-hover transition-colors">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex flex-col items-center justify-center shrink-0">
                <span className="text-accent text-sm font-bold">
                  {session.session_date ? new Date(session.session_date).getDate() : '—'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{session.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-white/40">{formatDateShort(session.session_date)}</span>
                  <span className="text-xs text-white/20">•</span>
                  <span className="text-xs text-white/40">{groupName(session.group_id)}</span>
                  {attCounts[session.id] > 0 && (
                    <>
                      <span className="text-xs text-white/20">•</span>
                      <Badge color="green">{attCounts[session.id]} حضور</Badge>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => openEdit(session)}>
                  <Pencil size={16} />
                </Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(session)}>
                  <Trash2 size={16} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
