import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Group, GradeLevel, AcademicStage, Session, Student, Attendance, HallOfFameEntry, Settings } from '../types'
import { currentMonthKey, currentMonthLabel } from '../lib/utils'

// Cache to prevent redundant queries
const cache = new Map<string, { data: unknown; timestamp: number }>()
const CACHE_TTL = 60000 // 1 minute

// Timeout guard — prevents infinite spinners on slow/stalled connections
const LOAD_TIMEOUT = 15000 // 15 seconds

// Wraps a Supabase thenable into a real Promise with a timeout fallback
function withTimeout<T>(thenable: { then: (...args: never[]) => unknown } | Promise<T>): Promise<T> {
  const realPromise = Promise.resolve(thenable as Promise<T>)
  return Promise.race([
    realPromise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT)
    ),
  ])
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data as T
  }
  return null
}

function setCached(key: string, data: unknown) {
  cache.set(key, { data, timestamp: Date.now() })
}

export function invalidateCache(prefix?: string) {
  if (prefix) {
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) cache.delete(key)
    }
  } else {
    cache.clear()
  }
}

// Settings - loaded once
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const cachedSettings = getCached<Settings>('settings')
    if (cachedSettings) {
      setSettings(cachedSettings)
      setLoading(false)
      return
    }
    withTimeout(supabase.from('settings').select('*').limit(1).maybeSingle())
      .then(({ data }) => {
        if (cancelled) return
        if (data) {
          setSettings(data as Settings)
          setCached('settings', data)
        }
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return { settings, loading }
}

// Academic stages + grade levels + groups — static reference data
export function useReferenceData() {
  const [stages, setStages] = useState<AcademicStage[]>([])
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const cached = getCached<{stages: AcademicStage[], gradeLevels: GradeLevel[], groups: Group[]}>('reference')
    if (cached) {
      setStages(cached.stages)
      setGradeLevels(cached.gradeLevels)
      setGroups(cached.groups)
      setLoading(false)
      return
    }
    withTimeout(Promise.all([
      supabase.from('academic_stages').select('*').order('sort_order'),
      supabase.from('grade_levels').select('*').order('sort_order'),
      supabase.from('groups').select('*').order('name'),
    ])).then(([sRes, glRes, gRes]) => {
      if (cancelled) return
      const s = (sRes.data as AcademicStage[]) || []
      const gl = (glRes.data as GradeLevel[]) || []
      const g = (gRes.data as Group[]) || []
      setStages(s)
      setGradeLevels(gl)
      setGroups(g)
      setCached('reference', { stages: s, gradeLevels: gl, groups: g })
      setLoading(false)
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  return { stages, gradeLevels, groups, loading }
}

// Sessions for a specific group — efficient query with date filter
export function useGroupSessions(groupId: string | null) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!groupId) {
      setSessions([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data, error } = await withTimeout(supabase
        .from('sessions')
        .select('*')
        .eq('group_id', groupId)
        .eq('is_deleted', false)
        .order('session_date', { ascending: false, nullsFirst: false })
        .limit(50))
      if (!error && data) {
        setSessions(data as Session[])
      }
    } catch { /* timeout — keep existing data */ }
    setLoading(false)
  }, [groupId])

  useEffect(() => { fetch() }, [fetch])

  return { sessions, loading, refetch: fetch }
}

// All active sessions (lightweight: only id, group_id, title, session_date)
export function useAllSessions() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await withTimeout(supabase
        .from('sessions')
        .select('id, group_id, title, month, session_date, is_archived, is_deleted, created_at')
        .eq('is_deleted', false)
        .order('session_date', { ascending: false, nullsFirst: false })
        .limit(200))
      if (!error && data) {
        setSessions(data as Session[])
      }
    } catch { /* timeout */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { sessions, loading, refetch: fetch }
}

// Students by group
export function useGroupStudents(groupId: string | null) {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!groupId) {
      setStudents([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data, error } = await withTimeout(supabase
        .from('students')
        .select('*')
        .eq('group_id', groupId)
        .eq('is_deleted', false)
        .order('name'))
      if (!error && data) {
        setStudents(data as Student[])
      }
    } catch { /* timeout */ }
    setLoading(false)
  }, [groupId])

  useEffect(() => { fetch() }, [fetch])

  return { students, loading, refetch: fetch }
}

// All active students
export function useAllStudents() {
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await withTimeout(supabase
        .from('students')
        .select('*')
        .eq('is_deleted', false)
        .order('name'))
      if (!error && data) {
        setStudents(data as Student[])
      }
    } catch { /* timeout */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { students, loading, refetch: fetch }
}

// Attendance for a session
export function useSessionAttendance(sessionId: string | null) {
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!sessionId) {
      setAttendance([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data, error } = await withTimeout(supabase
        .from('attendance')
        .select('*')
        .eq('session_id', sessionId)
        .order('student_id'))
      if (!error && data) {
        setAttendance(data as Attendance[])
      }
    } catch { /* timeout */ }
    setLoading(false)
  }, [sessionId])

  useEffect(() => { fetch() }, [fetch])

  return { attendance, loading, refetch: fetch }
}

// Hall of Fame (rankings view)
export function useHallOfFame(groupId?: string) {
  const [rankings, setRankings] = useState<HallOfFameEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase.from('hall_of_fame').select('*')
      if (groupId) {
        query = query.eq('group_id', groupId)
      }
      const { data, error } = await withTimeout(query.order('overall_score', { ascending: false, nullsFirst: false }).limit(100))
      if (!error && data) {
        setRankings(data as HallOfFameEntry[])
      }
    } catch { /* timeout */ }
    setLoading(false)
  }, [groupId])

  useEffect(() => { fetch() }, [fetch])

  return { rankings, loading, refetch: fetch }
}

// Session operations — uses create_session_auto RPC for atomic, dedup-safe creation
export async function createSession(
  groupId: string,
  sessionDate: string,
  title?: string
): Promise<{ data: Session | null; error: string | null }> {
  const monthLabel = currentMonthLabel()
  const { data, error } = await supabase
    .rpc('create_session_auto', {
      p_group_id: groupId,
      p_month: monthLabel,
      p_session_date: sessionDate,
      p_title: title || null,
    })

  if (error) {
    return { data: null, error: error.message }
  }

  // RPC returns an array of session rows
  if (data && Array.isArray(data) && data.length > 0) {
    const created = data[0] as Session
    // Verify the session actually exists in the database by reading it back
    const { data: confirmed, error: confirmError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', created.id)
      .maybeSingle()
    if (confirmError || !confirmed) {
      return { data: null, error: 'تم الإنشاء لكن تعذّر التأكد من الحفظ' }
    }
    invalidateCache('sessions')
    return { data: confirmed as Session, error: null }
  }

  return { data: null, error: 'لم يتم إنشاء الحصة' }
}

// Edit session (update title and date)
export async function updateSession(
  sessionId: string,
  updates: { title?: string; session_date?: string }
): Promise<{ error: string | null }> {
  const updateData: Record<string, string> = {}
  if (updates.title !== undefined) updateData.title = updates.title
  if (updates.session_date !== undefined) updateData.session_date = updates.session_date

  const { error } = await supabase
    .from('sessions')
    .update(updateData)
    .eq('id', sessionId)

  if (error) {
    return { error: error.message }
  }

  // Verify the update was persisted by reading back
  const { data: confirmed, error: confirmError } = await supabase
    .from('sessions')
    .select('id, title, session_date')
    .eq('id', sessionId)
    .maybeSingle()
  if (confirmError || !confirmed) {
    return { error: 'تم الإرسال لكن تعذّر التأكد من الحفظ' }
  }
  invalidateCache('sessions')
  return { error: null }
}

// Soft delete session
export async function deleteSession(sessionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('sessions')
    .update({ is_deleted: true })
    .eq('id', sessionId)

  if (error) {
    return { error: error.message }
  }
  invalidateCache('sessions')
  return { error: null }
}

// Attendance upsert — uses the atomic upsert_attendance RPC
export async function saveAttendance(
  studentId: string,
  groupId: string,
  status: string,
  attendanceDate: string,
  sessionId: string,
  notes?: string | null,
  lateMinutes?: number | null
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .rpc('upsert_attendance', {
      p_student_id: studentId,
      p_group_id: groupId,
      p_status: status,
      p_notes: notes || null,
      p_attendance_date: attendanceDate,
      p_session_id: sessionId,
      p_recorded_at: new Date().toISOString(),
      p_late_minutes: lateMinutes ?? null,
    })

  if (error) {
    return { error: error.message }
  }
  return { error: null }
}

// Bulk attendance save
export async function saveBulkAttendance(
  records: Array<{
    student_id: string
    group_id: string
    status: string
    attendance_date: string
    session_id: string
    notes?: string | null
    late_minutes?: number | null
  }>
): Promise<{ errors: string[]; successCount: number }> {
  const errors: string[] = []
  let successCount = 0

  for (const record of records) {
    const { error } = await saveAttendance(
      record.student_id,
      record.group_id,
      record.status,
      record.attendance_date,
      record.session_id,
      record.notes,
      record.late_minutes
    )
    if (error) {
      errors.push(error)
    } else {
      successCount++
    }
  }

  return { errors, successCount }
}

// Get student ranking within their group — only among students with verifiable data
export async function getStudentRanking(studentId: string): Promise<{ rank: number | null; total: number; entry: HallOfFameEntry | null }> {
  const { data, error } = await supabase
    .from('hall_of_fame')
    .select('*')
    .order('overall_score', { ascending: false, nullsFirst: false })

  if (error || !data) {
    return { rank: null, total: 0, entry: null }
  }

  const entries = data as HallOfFameEntry[]
  const entry = entries.find(e => e.id === studentId)
  if (!entry) {
    return { rank: null, total: 0, entry: null }
  }

  // Only rank among students in the same group who have verifiable data
  // (overall_score > 0 OR exams_taken > 0 — meaning they actually have recorded activity this month)
  const groupEntries = entries.filter(
    e => e.group_id === entry.group_id && ((e.overall_score ?? 0) > 0 || (e.exams_taken ?? 0) > 0)
  )

  // If the student themselves have no verifiable data, they do not get a rank
  if ((entry.overall_score ?? 0) === 0 && (entry.exams_taken ?? 0) === 0) {
    return { rank: null, total: groupEntries.length, entry }
  }

  const groupRank = groupEntries.findIndex(e => e.id === studentId) + 1
  return { rank: groupRank > 0 ? groupRank : null, total: groupEntries.length, entry }
}

// Parent portal: get student by parent_token
export async function getStudentByToken(token: string): Promise<{ student: Student | null; error: string | null }> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('parent_token', token)
    .eq('is_deleted', false)
    .maybeSingle()

  if (error) {
    return { student: null, error: error.message }
  }
  return { student: (data as Student) || null, error: null }
}
