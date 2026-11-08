import { useState, useEffect, useCallback } from 'react'
import { useAllStudents } from '../hooks/useData'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner, EmptyState, Badge, Input } from '../components/ui'
import type { Certificate } from '../types'
import { Award, Search } from 'lucide-react'
import { formatDate } from '../lib/utils'

export default function Certificates() {
  const { students, loading: stuLoading } = useAllStudents()
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchCerts = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('certificates').select('*').order('issued_at', { ascending: false }).limit(100)
    setCertificates((data as Certificate[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchCerts() }, [fetchCerts])

  const studentName = (id: string) => students.find(s => s.id === id)?.name || '—'

  const filtered = certificates.filter(c =>
    studentName(c.student_id).toLowerCase().includes(search.toLowerCase()) ||
    (c.exam_title || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.serial_id || '').toLowerCase().includes(search.toLowerCase())
  )

  if (stuLoading || loading) return <Spinner label="جارٍ تحميل الشهادات..." />

  return (
    <div className="space-y-4 animate-fadeIn">
      <PageHeader title="الشهادات" subtitle={`${certificates.length} شهادة`} />

      <div className="relative max-w-sm">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30" />
        <Input value={search} onChange={setSearch} placeholder="بحث بالاسم أو الرقم..." className="w-full pr-9" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="لا توجد شهادات" icon={<Award size={48} />} />
      ) : (
        <div className="space-y-2">
          {filtered.map(cert => (
            <Card key={cert.id} className="p-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gold/10 flex items-center justify-center shrink-0">
                <Award size={24} className="text-gold" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{studentName(cert.student_id)}</p>
                {cert.exam_title && <p className="text-xs text-white/40 truncate mt-0.5">{cert.exam_title}</p>}
                <div className="flex items-center gap-2 mt-1">
                  <Badge color="gold">{cert.serial_id}</Badge>
                  <span className="text-xs text-white/30">{formatDate(cert.issued_at)}</span>
                </div>
              </div>
              {cert.score !== null && cert.max_score !== null && (
                <div className="text-left">
                  <p className="text-lg font-bold text-accent">{cert.score}</p>
                  <p className="text-xs text-white/30">من {cert.max_score}</p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
