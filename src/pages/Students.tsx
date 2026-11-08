import { useState, useEffect } from 'react'
import { useReferenceData, useGroupStudents, useHallOfFame, invalidateCache } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Select, Input, Spinner, EmptyState, Badge } from '../components/ui'
import type { Student } from '../types'
import { Users, Plus, Copy, Check, Pencil, Search } from 'lucide-react'
import { todayISO } from '../lib/utils'

export default function Students() {
  const { groups, gradeLevels, stages, loading: refLoading } = useReferenceData()
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [formName, setFormName] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formParentPhone, setFormParentPhone] = useState('')
  const [formGender, setFormGender] = useState('male')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const [allRankings, setAllRankings] = useState<Record<string, { rank: number; total: number }>>({})

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].id)
    }
  }, [groups, selectedGroupId])

  const { students, loading, refetch } = useGroupStudents(selectedGroupId || null)

  const groupOptions = stages.flatMap(st =>
    gradeLevels
      .filter(gl => gl.stage_id === st.id)
      .flatMap(gl =>
        groups
          .filter(g => g.grade_level_id === gl.id)
          .map(g => ({ value: g.id, label: `${st.name} — ${gl.name} — ${g.name}` }))
      )
  )

  // Load rankings for all students to display rank badges
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('hall_of_fame')
        .select('*')
        .order('overall_score', { ascending: false, nullsFirst: false })
      if (data) {
        const byGroup: Record<string, Array<{ id: string; score: number }>> = {}
        for (const row of data as Array<{ id: string; group_id: string; overall_score: number | null }>) {
          if (!byGroup[row.group_id]) byGroup[row.group_id] = []
          byGroup[row.group_id].push({ id: row.id, score: row.overall_score ?? 0 })
        }
        const ranks: Record<string, { rank: number; total: number }> = {}
        for (const [gid, list] of Object.entries(byGroup)) {
          const verified = list.filter(s => s.score > 0)
          verified.forEach((s, i) => {
            ranks[s.id] = { rank: i + 1, total: verified.length }
          })
        }
        setAllRankings(ranks)
      }
    })()
  }, [students])

  const filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.parent_phone || '').includes(search)
  )

  const handleSave = async () => {
    if (!formName.trim() || !selectedGroupId) return
    setSaving(true)
    setError('')

    if (editingStudent) {
      const { error: updateError } = await supabase
        .from('students')
        .update({
          name: formName.trim(),
          phone: formPhone.trim() || null,
          parent_phone: formParentPhone.trim() || null,
          gender: formGender,
        })
        .eq('id', editingStudent.id)
      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }
    } else {
      const { error: insertError } = await supabase
        .from('students')
        .insert({
          name: formName.trim(),
          group_id: selectedGroupId,
          phone: formPhone.trim() || null,
          parent_phone: formParentPhone.trim() || null,
          gender: formGender,
          enrollment_date: todayISO(),
        })
      if (insertError) {
        setError(insertError.message)
        setSaving(false)
        return
      }
    }

    await refetch()
    invalidateCache('students')
    setShowForm(false)
    setEditingStudent(null)
    setFormName('')
    setFormPhone('')
    setFormParentPhone('')
    setFormGender('male')
    setSaving(false)
  }

  const copyParentLink = (student: Student) => {
    const link = `${window.location.origin}/parent/${student.parent_token}`
    navigator.clipboard.writeText(link)
    setCopiedId(student.id)
    setTimeout(() => setCopiedId(''), 2000)
  }

  const openCreate = () => {
    setEditingStudent(null)
    setFormName('')
    setFormPhone('')
    setFormParentPhone('')
    setFormGender('male')
    setShowForm(true)
  }

  const openEdit = (student: Student) => {
    setEditingStudent(student)
    setFormName(student.name)
    setFormPhone(student.phone || '')
    setFormParentPhone(student.parent_phone || '')
    setFormGender(student.gender)
    setShowForm(true)
  }

  if (refLoading) return <Spinner label="جارٍ تحميل البيانات..." />

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader
        title="الطلاب"
        subtitle={`${students.length} طالب`}
        action={<Button onClick={openCreate} disabled={!selectedGroupId}><Plus size={18} /> طالب جديد</Button>}
      />

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={selectedGroupId}
          onChange={setSelectedGroupId}
          options={groupOptions}
          placeholder="اختر المجموعة"
          className="min-w-[200px] flex-1"
        />
        <div className="relative flex-1 min-w-[150px]">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30" />
          <Input value={search} onChange={setSearch} placeholder="بحث..." className="w-full pr-9" />
        </div>
      </div>

      {showForm && (
        <Card className="p-4 space-y-3 animate-fadeIn">
          <h3 className="font-semibold text-white">{editingStudent ? 'تعديل طالب' : 'طالب جديد'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1.5">الاسم</label>
              <Input value={formName} onChange={setFormName} placeholder="اسم الطالب" className="w-full" />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1.5">النوع</label>
              <Select value={formGender} onChange={setFormGender} options={[{ value: 'male', label: 'ذكر' }, { value: 'female', label: 'أنثى' }]} className="w-full" />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1.5">هاتف الطالب</label>
              <Input value={formPhone} onChange={setFormPhone} placeholder="01xxxxxxxxx" dir="ltr" className="w-full" />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1.5">هاتف ولي الأمر</label>
              <Input value={formParentPhone} onChange={setFormParentPhone} placeholder="01xxxxxxxxx" dir="ltr" className="w-full" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || !formName.trim()}>{saving ? 'جارٍ الحفظ...' : 'حفظ'}</Button>
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditingStudent(null) }}>إلغاء</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <Spinner label="جارٍ تحميل الطلاب..." />
      ) : filtered.length === 0 ? (
        <EmptyState message="لا يوجد طلاب" icon={<Users size={48} />} />
      ) : (
        <div className="space-y-2">
          {filtered.map(student => {
            const rankInfo = allRankings[student.id]
            return (
              <Card key={student.id} className="p-3 flex items-center gap-3 hover:bg-bg-hover transition-colors">
                <div className="w-10 h-10 rounded-xl bg-bg-input flex items-center justify-center shrink-0">
                  <span className="text-white/60 text-sm font-bold">{student.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{student.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {student.parent_phone && <span className="text-xs text-white/30" dir="ltr">{student.parent_phone}</span>}
                    <Badge color={student.status === 'active' ? 'green' : 'default'}>{student.status === 'active' ? 'نشط' : student.status}</Badge>
                    {rankInfo && rankInfo.rank <= 3 && (
                      <Badge color={rankInfo.rank === 1 ? 'gold' : rankInfo.rank === 2 ? 'default' : 'default'}>
                        ترتيب {rankInfo.rank}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => copyParentLink(student)}>
                    {copiedId === student.id ? <Check size={16} className="text-accent" /> : <Copy size={16} />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(student)}>
                    <Pencil size={16} />
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
