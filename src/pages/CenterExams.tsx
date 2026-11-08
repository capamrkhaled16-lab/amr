import { useState, useEffect, useCallback } from 'react'
import { useReferenceData } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Select, Input, Spinner, EmptyState, Badge } from '../components/ui'
import type { CenterExam, CenterGrade, Student } from '../types'
import { formatDateShort, todayISO } from '../lib/utils'
import { Plus, FileText, Pencil, Trash2, Check } from 'lucide-react'

export default function CenterExams() {
  const { groups, gradeLevels, stages, loading: refLoading } = useReferenceData()
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [exams, setExams] = useState<CenterExam[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingExam, setEditingExam] = useState<CenterExam | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formDate, setFormDate] = useState(todayISO())
  const [formMaxScore, setFormMaxScore] = useState('100')
  const [formPassScore, setFormPassScore] = useState('50')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [gradesByExam, setGradesByExam] = useState<Record<string, CenterGrade[]>>({})
  const [students, setStudents] = useState<Student[]>([])
  const [selectedExamId, setSelectedExamId] = useState('')
  const [gradeInputs, setGradeInputs] = useState<Record<string, string>>({})
  const [savingGrades, setSavingGrades] = useState(false)

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) setSelectedGroupId(groups[0].id)
  }, [groups, selectedGroupId])

  const groupOptions = stages.flatMap(st =>
    gradeLevels.filter(gl => gl.stage_id === st.id).flatMap(gl =>
      groups.filter(g => g.grade_level_id === gl.id).map(g => ({ value: g.id, label: `${st.name} — ${gl.name} — ${g.name}` }))
    )
  )

  const fetchExams = useCallback(async () => {
    if (!selectedGroupId) { setExams([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('center_exams').select('*').eq('group_id', selectedGroupId).order('exam_date', { ascending: false })
    setExams((data as CenterExam[]) || [])
    setLoading(false)
  }, [selectedGroupId])

  const fetchStudents = useCallback(async () => {
    if (!selectedGroupId) { setStudents([]); return }
    const { data } = await supabase.from('students').select('*').eq('group_id', selectedGroupId).eq('is_deleted', false).order('name')
    setStudents((data as Student[]) || [])
  }, [selectedGroupId])

  useEffect(() => { fetchExams(); fetchStudents() }, [fetchExams, fetchStudents])

  const fetchGrades = useCallback(async (examId: string) => {
    const { data } = await supabase.from('center_grades').select('*').eq('center_exam_id', examId).eq('is_deleted', false)
    if (data) {
      const map: Record<string, CenterGrade[]> = {}
      for (const g of data as CenterGrade[]) {
        if (!map[g.center_exam_id]) map[g.center_exam_id] = []
        map[g.center_exam_id].push(g)
      }
      setGradesByExam(prev => ({ ...prev, ...map }))
      // Sync to inputs
      const inputs: Record<string, string> = {}
      for (const g of data as CenterGrade[]) {
        inputs[g.student_id] = String(g.score)
      }
      setGradeInputs(inputs)
    }
  }, [])

  useEffect(() => {
    if (selectedExamId) fetchGrades(selectedExamId)
  }, [selectedExamId, fetchGrades])

  const handleSaveExam = async () => {
    if (!formTitle.trim() || !selectedGroupId) return
    setSaving(true); setError('')
    if (editingExam) {
      const { error: e } = await supabase.from('center_exams').update({
        title: formTitle.trim(), exam_date: formDate, max_score: parseFloat(formMaxScore) || 100, pass_score: parseFloat(formPassScore) || 50,
      }).eq('id', editingExam.id)
      if (e) { setError(e.message); setSaving(false); return }
    } else {
      const { error: e } = await supabase.from('center_exams').insert({
        group_id: selectedGroupId, title: formTitle.trim(), exam_date: formDate,
        max_score: parseFloat(formMaxScore) || 100, pass_score: parseFloat(formPassScore) || 50, category: 'exam',
      })
      if (e) { setError(e.message); setSaving(false); return }
    }
    await fetchExams()
    setShowForm(false); setEditingExam(null); setFormTitle(''); setFormDate(todayISO()); setFormMaxScore('100'); setFormPassScore('50')
    setSaving(false)
  }

  const handleDeleteExam = async (exam: CenterExam) => {
    if (!confirm(`حذف امتحان "${exam.title}"؟`)) return
    await supabase.from('center_exams').delete().eq('id', exam.id)
    await fetchExams()
  }

  const handleSaveGrades = async () => {
    if (!selectedExamId) return
    setSavingGrades(true)
    const exam = exams.find(e => e.id === selectedExamId)
    if (!exam) { setSavingGrades(false); return }
    for (const student of students) {
      const scoreStr = gradeInputs[student.id]
      if (scoreStr === undefined || scoreStr === '') continue
      const score = parseFloat(scoreStr)
      if (isNaN(score)) continue
      await supabase.from('center_grades').upsert({
        center_exam_id: selectedExamId, student_id: student.id, score, updated_at: new Date().toISOString(),
      }, { onConflict: 'center_exam_id,student_id' })
    }
    await fetchGrades(selectedExamId)
    setSavingGrades(false)
  }

  if (refLoading) return <Spinner label="جارٍ تحميل البيانات..." />

  const selectedExam = exams.find(e => e.id === selectedExamId)
  const examGrades = selectedExamId ? gradesByExam[selectedExamId] || [] : []

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader title="امتحانات السنتر" action={<Button onClick={() => { setEditingExam(null); setFormTitle(''); setFormDate(todayISO()); setFormMaxScore('100'); setFormPassScore('50'); setShowForm(true) }} disabled={!selectedGroupId}><Plus size={18} /> امتحان جديد</Button>} />

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

      <Select value={selectedGroupId} onChange={(v) => { setSelectedGroupId(v); setSelectedExamId('') }} options={groupOptions} placeholder="اختر المجموعة" className="min-w-[200px] flex-1" />

      {showForm && (
        <Card className="p-4 space-y-3 animate-fadeIn">
          <h3 className="font-semibold text-white">{editingExam ? 'تعديل امتحان' : 'امتحان جديد'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="block text-xs text-white/50 mb-1.5">العنوان</label><Input value={formTitle} onChange={setFormTitle} placeholder="امتحان الفصل الأول" className="w-full" /></div>
            <div><label className="block text-xs text-white/50 mb-1.5">التاريخ</label><Input type="date" value={formDate} onChange={setFormDate} dir="ltr" className="w-full" /></div>
            <div><label className="block text-xs text-white/50 mb-1.5">الدرجة العظمى</label><Input type="number" value={formMaxScore} onChange={setFormMaxScore} dir="ltr" className="w-full" /></div>
            <div><label className="block text-xs text-white/50 mb-1.5">درجة النجاح</label><Input type="number" value={formPassScore} onChange={setFormPassScore} dir="ltr" className="w-full" /></div>
          </div>
          <div className="flex gap-2"><Button onClick={handleSaveExam} disabled={saving || !formTitle.trim()}>{saving ? 'جارٍ الحفظ...' : 'حفظ'}</Button><Button variant="ghost" onClick={() => setShowForm(false)}>إلغاء</Button></div>
        </Card>
      )}

      {loading ? <Spinner label="جارٍ تحميل الامتحانات..." /> : exams.length === 0 ? (
        <EmptyState message="لا توجد امتحانات" icon={<FileText size={48} />} />
      ) : (
        <div className="space-y-2">
          {exams.map(exam => (
            <Card key={exam.id} className={`p-4 flex items-center gap-3 cursor-pointer transition-colors ${selectedExamId === exam.id ? 'border-accent' : 'hover:bg-bg-hover'}`} >
              <div className="flex-1 min-w-0" onClick={() => setSelectedExamId(exam.id === selectedExamId ? '' : exam.id)}>
                <p className="font-semibold text-white truncate">{exam.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-white/40">{formatDateShort(exam.exam_date)}</span>
                  <Badge color="blue">من {exam.max_score}</Badge>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setEditingExam(exam); setFormTitle(exam.title); setFormDate(exam.exam_date || todayISO()); setFormMaxScore(String(exam.max_score)); setFormPassScore(String(exam.pass_score)); setShowForm(true) }}><Pencil size={16} /></Button>
              <Button variant="danger" size="sm" onClick={() => handleDeleteExam(exam)}><Trash2 size={16} /></Button>
            </Card>
          ))}
        </div>
      )}

      {selectedExam && (
        <Card className="p-4 animate-fadeIn">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white">درجات: {selectedExam.title}</h3>
            <Button size="sm" onClick={handleSaveGrades} disabled={savingGrades}><Check size={16} /> {savingGrades ? 'جارٍ الحفظ...' : 'حفظ الدرجات'}</Button>
          </div>
          <div className="space-y-2">
            {students.map(stu => {
              const grade = examGrades.find(g => g.student_id === stu.id)
              return (
                <div key={stu.id} className="flex items-center gap-3 py-1.5 border-b border-bg-border last:border-0">
                  <span className="flex-1 text-sm text-white truncate">{stu.name}</span>
                  <input
                    type="number"
                    value={gradeInputs[stu.id] ?? ''}
                    onChange={(e) => setGradeInputs(prev => ({ ...prev, [stu.id]: e.target.value }))}
                    placeholder="—"
                    dir="ltr"
                    className="w-20 bg-bg-input border border-bg-border rounded-lg px-3 py-1.5 text-white text-sm outline-none focus:border-accent text-center"
                  />
                  <span className="text-xs text-white/30">/ {selectedExam.max_score}</span>
                  {grade && parseFloat(String(grade.score)) >= selectedExam.pass_score && <Badge color="green">ناجح</Badge>}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
