import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../hooks/useData'

export default function Login() {
  const { assistant, login, loading } = useAuth()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (assistant) navigate('/', { replace: true })
  }, [assistant, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !pin.trim()) {
      setError('يرجى إدخال اسم المستخدم والرمز')
      return
    }
    const { error: loginError } = await login(username, pin)
    if (loginError) {
      setError(loginError)
    } else {
      navigate('/', { replace: true })
    }
  }

  const logoUrl = settings?.logo_url
  const heading = settings?.login_heading || 'تسجيل دخول المعلم'
  const description = settings?.login_description || 'الوصول إلى لوحة التحكم'

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md">
        <div className="bg-bg-card rounded-2xl border border-bg-border p-8 shadow-2xl animate-fadeIn">
          <div className="flex flex-col items-center gap-4 mb-8">
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="w-20 h-20 rounded-xl object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-xl bg-accent/20 flex items-center justify-center">
                <span className="text-accent text-3xl font-bold">خ</span>
              </div>
            )}
            <div className="text-center">
              <h1 className="text-xl font-bold text-white">{settings?.platform_name || 'منصة الخالد التعليمية'}</h1>
              {settings?.management_name && (
                <p className="text-sm text-white/50 mt-1">{settings.management_name}</p>
              )}
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white text-center">{heading}</h2>
            <p className="text-sm text-white/40 text-center mt-1">{description}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-white/60 mb-2">اسم المستخدم</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-bg-input border border-bg-border rounded-xl px-4 py-3 text-white outline-none focus:border-accent transition-colors"
                placeholder="أدخل اسم المستخدم"
                autoComplete="off"
                dir="rtl"
              />
            </div>
            <div>
              <label className="block text-sm text-white/60 mb-2">الرمز السري</label>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full bg-bg-input border border-bg-border rounded-xl px-4 py-3 text-white outline-none focus:border-accent transition-colors tracking-widest"
                placeholder="••••"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'جارٍ الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
