import { useState, useEffect } from 'react'
import { useSettings, useReferenceData } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Spinner, Badge } from '../components/ui'
import type { AcademicStage, GradeLevel } from '../types'
import { Save, Check } from 'lucide-react'

export default function Settings() {
  const { settings, loading: settingsLoading } = useSettings()
  const { stages, gradeLevels, loading: refLoading } = useReferenceData()
  const [platformName, setPlatformName] = useState('')
  const [managementName, setManagementName] = useState('')
  const [teacherName, setTeacherName] = useState('')
  const [lateAlertDay, setLateAlertDay] = useState('5')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Stage pricing
  const [stagePricing, setStagePricing] = useState<Record<string, string>>({})

  useEffect(() => {
    if (settings) {
      setPlatformName(settings.platform_name || '')
      setManagementName(settings.management_name || '')
      setTeacherName(settings.teacher_name || '')
      setLateAlertDay(String(settings.late_payment_alert_day || 5))
    }
  }, [settings])

  useEffect(() => {
    const map: Record<string, string> = {}
    for (const s of stages) { map[s.id] = String(s.base_subscription) }
    for (const gl of gradeLevels) { map[gl.id] = String(gl.base_subscription) }
    setStagePricing(map)
  }, [stages, gradeLevels])

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false)
    if (settings) {
      const { error: e } = await supabase.from('settings').update({
        platform_name: platformName, management_name: managementName, teacher_name: teacherName,
        late_payment_alert_day: parseInt(lateAlertDay) || 5, updated_at: new Date().toISOString(),
      }).eq('id', settings.id)
      if (e) { setError(e.message); setSaving(false); return }
    }
    // Save stage pricing
    for (const s of stages) {
      const val = parseFloat(stagePricing[s.id])
      if (!isNaN(val)) await supabase.from('academic_stages').update({ base_subscription: val }).eq('id', s.id)
    }
    for (const gl of gradeLevels) {
      const val = parseFloat(stagePricing[gl.id])
      if (!isNaN(val)) await supabase.from('grade_levels').update({ base_subscription: val }).eq('id', gl.id)
    }
    setSaved(true)
    setSaving(false)
    setTimeout(() => setSaved(false), 3000)
  }

  if (settingsLoading || refLoading) return <Spinner label="جارٍ تحميل الإعدادات..." />

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader title="الإعدادات" action={<Button onClick={handleSave} disabled={saving}><Save size={18} /> {saving ? 'جارٍ الحفظ...' : 'حفظ'}</Button>} />

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>}
      {saved && <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 text-accent text-sm flex items-center gap-2"><Check size={18} /> تم حفظ الإعدادات بنجاح</div>}

      <Card className="p-5 space-y-4">
        <h2 className="text-lg font-bold text-white">معلومات المنصة</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block text-xs text-white/50 mb-1.5">اسم المنصة</label><Input value={platformName} onChange={setPlatformName} className="w-full" /></div>
          <div><label className="block text-xs text-white/50 mb-1.5">اسم الإدارة</label><Input value={managementName} onChange={setManagementName} className="w-full" /></div>
          <div><label className="block text-xs text-white/50 mb-1.5">اسم المعلم</label><Input value={teacherName} onChange={setTeacherName} className="w-full" /></div>
          <div><label className="block text-xs text-white/50 mb-1.5">يوم تنبيه تأخر السداد</label><Input type="number" value={lateAlertDay} onChange={setLateAlertDay} dir="ltr" className="w-full" /></div>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="text-lg font-bold text-white">أسعار الاشتراكات</h2>
        {stages.map((stage: AcademicStage) => (
          <div key={stage.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge color="blue">{stage.name}</Badge>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40">اشتراك المرحلة:</span>
                <input type="number" value={stagePricing[stage.id] ?? ''} onChange={(e) => setStagePricing(prev => ({ ...prev, [stage.id]: e.target.value }))} dir="ltr" className="w-24 bg-bg-input border border-bg-border rounded-lg px-3 py-1 text-white text-sm outline-none focus:border-accent text-center" />
                <span className="text-xs text-white/30">ج</span>
              </div>
            </div>
            <div className="pr-4 space-y-1.5">
              {gradeLevels.filter(gl => gl.stage_id === stage.id).map((gl: GradeLevel) => (
                <div key={gl.id} className="flex items-center gap-2">
                  <span className="text-xs text-white/50 flex-1">{gl.name}</span>
                  <input type="number" value={stagePricing[gl.id] ?? ''} onChange={(e) => setStagePricing(prev => ({ ...prev, [gl.id]: e.target.value }))} dir="ltr" className="w-24 bg-bg-input border border-bg-border rounded-lg px-3 py-1 text-white text-xs outline-none focus:border-accent text-center" />
                  <span className="text-xs text-white/30">ج</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
