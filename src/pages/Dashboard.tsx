import { useReferenceData, useAllSessions, useAllStudents, useHallOfFame } from '../hooks/useData'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/ui'
import { Users, Calendar, Trophy, TrendingUp } from 'lucide-react'
import { currentMonthLabel } from '../lib/utils'
import type { LucideIcon } from 'lucide-react'

export default function Dashboard() {
  const { assistant } = useAuth()
  const { groups, loading: refLoading } = useReferenceData()
  const { sessions, loading: sessLoading } = useAllSessions()
  const { students, loading: stuLoading } = useAllStudents()
  const { rankings, loading: rankLoading } = useHallOfFame()

  const monthLabel = currentMonthLabel()
  const monthSessions = sessions.filter(s => s.month === monthLabel)
  const topStudents = rankings.filter(r => (r.overall_score ?? 0) > 0).slice(0, 5)

  const stats: Array<{ label: string; value: number | string; icon: LucideIcon; color: string }> = [
    { label: 'إجمالي الطلاب', value: students.length, icon: Users, color: 'text-blue-400' },
    { label: 'المجموعات', value: groups.length, icon: Users, color: 'text-accent' },
    { label: 'حصص هذا الشهر', value: monthSessions.length, icon: Calendar, color: 'text-gold' },
    { label: 'طلاب لوحة الشرف', value: rankings.filter(r => (r.overall_score ?? 0) > 0).length, icon: Trophy, color: 'text-purple-400' },
  ]

  const loading = refLoading || sessLoading || stuLoading || rankLoading

  if (loading) {
    return <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full spinner" /></div>
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-white">
          مرحباً، {assistant?.display_name || assistant?.username}
        </h1>
        <p className="text-sm text-white/40 mt-1">{monthLabel}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <stat.icon size={20} className={stat.color} />
            </div>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-white/40 mt-1">{stat.label}</p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={20} className="text-accent" />
          <h2 className="text-lg font-bold text-white">الأوائل هذا الشهر</h2>
        </div>
        {topStudents.length === 0 ? (
          <p className="text-white/40 text-sm py-4 text-center">لا توجد بيانات كافية للترتيب هذا الشهر</p>
        ) : (
          <div className="space-y-2">
            {topStudents.map((student, index) => (
              <div key={student.id} className="flex items-center gap-3 py-2 border-b border-bg-border last:border-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                  index === 0 ? 'bg-gold/20 text-gold' :
                  index === 1 ? 'bg-gray-300/20 text-gray-300' :
                  index === 2 ? 'bg-orange-500/20 text-orange-400' :
                  'bg-white/5 text-white/40'
                }`}>
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{student.name}</p>
                  <p className="text-xs text-white/40 truncate">{student.group_name}</p>
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-accent">{student.overall_score}</p>
                  <p className="text-xs text-white/30">نقطة</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
