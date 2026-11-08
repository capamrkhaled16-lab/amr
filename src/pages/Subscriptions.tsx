import { useState, useEffect, useCallback } from 'react'
import { useReferenceData } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Select, Input, Spinner, EmptyState, Badge } from '../components/ui'
import type { Student, MonthlySubscription, Payment } from '../types'
import { currentMonthKey, currentMonthLabel } from '../lib/utils'
import { Wallet, Plus, Check } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function Subscriptions() {
  const { assistant } = useAuth()
  const { groups, gradeLevels, stages, loading: refLoading } = useReferenceData()
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [subscriptions, setSubscriptions] = useState<Record<string, MonthlySubscription>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const monthKey = currentMonthKey()
  const monthLabel = currentMonthLabel()
  const canManage = assistant?.can_manage_subscriptions || assistant?.can_view_finance
  const canView = assistant?.can_view_subscriptions || canManage

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) setSelectedGroupId(groups[0].id)
  }, [groups, selectedGroupId])

  const groupOptions = stages.flatMap(st =>
    gradeLevels.filter(gl => gl.stage_id === st.id).flatMap(gl =>
      groups.filter(g => g.grade_level_id === gl.id).map(g => ({ value: g.id, label: `${st.name} — ${gl.name} — ${g.name}` }))
    )
  )

  const fetchData = useCallback(async () => {
    if (!selectedGroupId) { setStudents([]); setSubscriptions({}); setLoading(false); return }
    setLoading(true)
    const { data: stuData } = await supabase.from('students').select('*').eq('group_id', selectedGroupId).eq('is_deleted', false).order('name')
    const studentsList = (stuData as Student[]) || []
    setStudents(studentsList)
    if (studentsList.length > 0) {
      const { data: subData } = await supabase.from('monthly_subscriptions').select('*').eq('month_key', monthKey).in('student_id', studentsList.map(s => s.id))
      if (subData) {
        const map: Record<string, MonthlySubscription> = {}
        for (const sub of subData as MonthlySubscription[]) { map[sub.student_id] = sub }
        setSubscriptions(map)
      }
    }
    setLoading(false)
  }, [selectedGroupId, monthKey])

  useEffect(() => { fetchData() }, [fetchData])

  const handlePay = async (student: Student, amount: number) => {
    if (!amount || amount <= 0) return
    setSaving(student.id); setError('')
    const existing = subscriptions[student.id]
    if (existing) {
      const newPaid = existing.amount_paid + amount
      const status = newPaid >= existing.amount_due ? 'paid' : 'partial'
      await supabase.from('monthly_subscriptions').update({
        amount_paid: newPaid, status, paid_date: new Date().toISOString(), recorded_by: assistant?.username,
      }).eq('id', existing.id)
      // Record payment
      await supabase.from('payments').insert({
        student_id: student.id, amount, payment_date: todayISODate(), recorded_by: assistant?.username, month_key: monthKey,
      })
    } else {
      // Create subscription if it doesn't exist
      const { data: newSub } = await supabase.from('monthly_subscriptions').insert({
        student_id: student.id, month: monthLabel, month_key: monthKey, amount_due: amount, amount_paid: amount,
        status: 'paid', paid_date: new Date().toISOString(), recorded_by: assistant?.username,
      }).select('*').single()
      await supabase.from('payments').insert({
        student_id: student.id, amount, payment_date: todayISODate(), recorded_by: assistant?.username, month_key: monthKey,
      })
    }
    await fetchData()
    setSaving(null)
  }

  if (refLoading) return <Spinner label="جارٍ تحميل البيانات..." />
  if (!canView) return <EmptyState message="ليس لديك صلاحية لعرض هذه الصفحة" />

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader title="الاشتراكات الشهرية" subtitle={monthLabel} />

      <Select value={selectedGroupId} onChange={setSelectedGroupId} options={groupOptions} placeholder="اختر المجموعة" className="min-w-[200px] flex-1" />

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}

      {loading ? <Spinner label="جارٍ تحميل الاشتراكات..." /> : students.length === 0 ? (
        <EmptyState message="لا يوجد طلاب" icon={<Wallet size={48} />} />
      ) : (
        <div className="space-y-2">
          {students.map(stu => {
            const sub = subscriptions[stu.id]
            const isExempt = stu.is_exempt || sub?.is_exempt
            const amountDue = sub?.amount_due ?? 0
            const amountPaid = sub?.amount_paid ?? 0
            const remaining = amountDue - amountPaid
            const status = sub?.status || (amountDue > 0 ? 'unpaid' : 'none')
            return (
              <Card key={stu.id} className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="flex-1 text-sm font-semibold text-white truncate">{stu.name}</span>
                  {isExempt ? <Badge color="gold">معفى</Badge> :
                    status === 'paid' ? <Badge color="green">مدفوع</Badge> :
                    status === 'partial' ? <Badge color="blue">جزئي</Badge> :
                    amountDue > 0 ? <Badge color="red">غير مدفوع</Badge> : <Badge>لا يوجد</Badge>}
                </div>
                {!isExempt && amountDue > 0 && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-white/40">المستحق: <span className="text-white font-semibold">{amountDue} ج</span></span>
                    <span className="text-white/40">المدفوع: <span className="text-accent font-semibold">{amountPaid} ج</span></span>
                    {remaining > 0 && <span className="text-white/40">المتبقي: <span className="text-red-400 font-semibold">{remaining} ج</span></span>}
                  </div>
                )}
                {canManage && !isExempt && remaining > 0 && (
                  <Button size="sm" className="mt-2" onClick={() => handlePay(stu, remaining)} disabled={saving === stu.id}>
                    <Check size={16} /> {saving === stu.id ? 'جارٍ...' : `تحصيل ${remaining} ج`}
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function todayISODate(): string {
  return new Date().toISOString().split('T')[0]
}
