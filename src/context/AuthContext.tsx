import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { safeStorage } from '../lib/safeStorage'
import type { Assistant } from '../types'

interface AuthContextType {
  assistant: Assistant | null
  loading: boolean
  login: (username: string, pin: string) => Promise<{ error: string | null }>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

const STORAGE_KEY = 'alkhaled_assistant'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [assistant, setAssistant] = useState<Assistant | null>(() => {
    try {
      const stored = safeStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(false)

  const login = useCallback(async (username: string, pin: string): Promise<{ error: string | null }> => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('assistants')
        .select('*')
        .eq('username', username.trim())
        .eq('pin', pin.trim())
        .eq('is_active', true)
        .maybeSingle()

      if (error) {
        return { error: 'حدث خطأ في الاتصال بقاعدة البيانات' }
      }

      if (!data) {
        return { error: 'اسم المستخدم أو الرمز غير صحيح' }
      }

      const assistantData = data as Assistant
      setAssistant(assistantData)
      safeStorage.setItem(STORAGE_KEY, JSON.stringify(assistantData))

      await supabase
        .from('assistants')
        .update({
          logins_count: (assistantData.logins_count || 0) + 1,
          last_login_at: new Date().toISOString(),
        })
        .eq('id', assistantData.id)

      return { error: null }
    } catch {
      return { error: 'تعذّر تسجيل الدخول. تحقق من الاتصال بالإنترنت.' }
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    setAssistant(null)
    safeStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{ assistant, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
