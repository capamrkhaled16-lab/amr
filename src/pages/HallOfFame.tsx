import { useState, useEffect, useMemo } from 'react'
import { useHallOfFame, useReferenceData } from '../hooks/useData'
import { PageHeader, Card, Select, Spinner, EmptyState, Badge } from '../components/ui'
import { Trophy, Medal, Award } from 'lucide-react'
import { currentMonthLabel } from '../lib/utils'
import type { HallOfFameEntry } from '../types'

export default function HallOfFame() {
  const { groups, gradeLevels, stages, loading: refLoading } = useReferenceData()
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [scope, setScope] = useState<'all' | string>('all') // all or group_id

  const groupOptions = stages.flatMap(st =>
    gradeLevels
      .filter(gl => gl.stage_id === st.id)
      .flatMap(gl =>
        groups
          .filter(g => g.grade_level_id === gl.id)
          .map(g => ({ value: g.id, label: `${st.name} — ${gl.name} — ${g.name}` }))
      )
  )

  const { rankings, loading } = useHallOfFame(scope === 'all' ? undefined : scope)

  // Only show students with verifiable data (overall_score > 0 means they have actual activity)
  const verifiedRankings = useMemo(() => {
    return rankings.filter(r => (r.overall_score ?? 0) > 0 || (r.exams_taken ?? 0) > 0)
  }, [rankings])

  const rankIcon = (index: number) => {
    if (index === 0) return <Trophy size={20} className="text-gold" />
    if (index === 1) return <Medal size={20} className="text-gray-300" />
    if (index === 2) return <Medal size={20} className="text-orange-400" />
    return <span className="text-white/40 text-sm font-bold w-5 text-center">{index + 1}</span>
  }

  if (refLoading) {
    return <Spinner label="جارٍ تحميل البيانات..." />
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader
        title="لوحة الشرف"
        subtitle={`الترتيب الشهري — ${currentMonthLabel()}`}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={scope}
          onChange={(v) => setScope(v as 'all' | string)}
          options={[
            { value: 'all', label: 'كل المجموعات' },
            ...groupOptions,
          ]}
          className="min-w-[200px] flex-1"
        />
      </div>

      {loading ? (
        <Spinner label="جارٍ حساب الترتيب..." />
      ) : verifiedRankings.length === 0 ? (
        <EmptyState
          message="لا توجد بيانات كافية لحساب الترتيب هذا الشهر. يتم احتساب الترتيب بناءً على الامتحانات والحضور والواجبات والسلوك."
          icon={<Award size={48} />}
        />
      ) : (
        <div className="space-y-2">
          {/* Top 3 podium */}
          {verifiedRankings.length >= 3 && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[1, 0, 2].map((podiumIndex) => {
                const student = verifiedRankings[podiumIndex]
                if (!student) return <div key={podiumIndex} />
                const colors = ['bg-gray-300/10 border-gray-300/20', 'bg-gold/10 border-gold/20', 'bg-orange-500/10 border-orange-500/20']
                const heights = ['pt-4 pb-3', 'pt-5 pb-4', 'pt-4 pb-3']
                return (
                  <Card key={student.id} className={`${colors[podiumIndex]} ${heights[podiumIndex]} text-center`}>
                    <div className="flex justify-center mb-2">
                      {podiumIndex === 0 ? <Trophy size={28} className="text-gold" /> :
                       podiumIndex === 1 ? <Medal size={28} className="text-gray-300" /> :
                       <Medal size={28} className="text-orange-400" />}
                    </div>
                    <p className="text-sm font-bold text-white truncate">{student.name}</p>
                    <p className="text-xs text-white/40 truncate mt-0.5">{student.group_name}</p>
                    <p className="text-lg font-bold text-accent mt-1">{student.overall_score}</p>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Full ranking list */}
          {verifiedRankings.map((student, index) => (
            <Card key={student.id} className="p-4 flex items-center gap-3 hover:bg-bg-hover transition-colors">
              <div className="w-10 h-10 rounded-xl bg-bg-input flex items-center justify-center shrink-0">
                {rankIcon(index)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{student.name}</p>
                <p className="text-xs text-white/40 truncate">{student.group_name} — {student.grade_name}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center hidden sm:block">
                  <p className="text-xs text-white/30">الامتحانات</p>
                  <p className="text-sm font-semibold text-white">{student.exams_taken}</p>
                </div>
                <div className="text-center hidden sm:block">
                  <p className="text-xs text-white/30">الحضور</p>
                  <p className="text-sm font-semibold text-accent">{student.attendance_rate}%</p>
                </div>
                <div className="text-center hidden md:block">
                  <p className="text-xs text-white/30">الواجب</p>
                  <p className="text-sm font-semibold text-white">{student.homework_rate != null ? `${student.homework_rate}%` : '—'}</p>
                </div>
                <div className="text-left">
                  <p className="text-lg font-bold text-accent">{student.overall_score}</p>
                  <p className="text-xs text-white/30">نقطة</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
