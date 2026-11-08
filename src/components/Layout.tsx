import { useState, ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../hooks/useData'
import {
  LayoutDashboard, Calendar, ClipboardCheck, Users, Trophy,
  FileText, BookOpen, HeartPulse, Wallet, Award, Settings as SettingsIcon,
  LogOut, Menu, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permission?: keyof typeof perms
}

const perms = {
  can_manage_attendance: true,
  can_view_attendance: true,
  can_manage_students: true,
  can_view_students: true,
  can_view_hall_of_fame: true,
  can_view_exams: true,
  can_view_grades: true,
  can_view_tracking: true,
  can_view_finance: true,
  can_view_subscriptions: true,
  can_view_certificates: true,
}

const navItems: NavItem[] = [
  { to: '/', label: 'الرئيسية', icon: LayoutDashboard },
  { to: '/sessions', label: 'الحصص', icon: Calendar },
  { to: '/attendance', label: 'الحضور والانصراف', icon: ClipboardCheck, permission: 'can_view_attendance' },
  { to: '/students', label: 'الطلاب', icon: Users, permission: 'can_view_students' },
  { to: '/hall-of-fame', label: 'لوحة الشرف', icon: Trophy, permission: 'can_view_hall_of_fame' },
  { to: '/center-exams', label: 'امتحانات السنتر', icon: FileText, permission: 'can_view_exams' },
  { to: '/homework', label: 'الواجبات', icon: BookOpen, permission: 'can_view_tracking' },
  { to: '/behavior', label: 'السلوك', icon: HeartPulse, permission: 'can_view_tracking' },
  { to: '/subscriptions', label: 'الاشتراكات', icon: Wallet, permission: 'can_view_subscriptions' },
  { to: '/certificates', label: 'الشهادات', icon: Award, permission: 'can_view_certificates' },
  { to: '/settings', label: 'الإعدادات', icon: SettingsIcon },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { assistant, logout } = useAuth()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const visibleItems = navItems.filter(item => {
    if (!item.permission) return true
    if (item.permission === 'can_view_finance') return assistant?.can_view_finance
    const permValue = assistant?.[item.permission as keyof typeof assistant]
    return permValue === true
  })

  const logoUrl = settings?.logo_url

  return (
    <div className="min-h-screen bg-bg flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 right-0 h-screen w-64 bg-bg-card border-l border-bg-border flex flex-col z-40 transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-4 border-b border-bg-border flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="w-10 h-10 rounded-lg object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center shrink-0">
              <span className="text-accent font-bold">خ</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white truncate">{settings?.platform_name || 'منصة الخالد'}</p>
            {assistant?.display_name && (
              <p className="text-xs text-white/40 truncate">{assistant.display_name}</p>
            )}
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent font-semibold'
                    : 'text-white/60 hover:bg-bg-hover hover:text-white'
                }`
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-bg-border">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/60 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut size={20} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden sticky top-0 z-20 bg-bg-card border-b border-bg-border px-4 py-3 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="text-white/60 hover:text-white">
            <Menu size={24} />
          </button>
          <span className="text-sm font-semibold text-white">{settings?.platform_name || 'منصة الخالد'}</span>
        </header>
        <main className="flex-1 p-4 lg:p-6 max-w-7xl mx-auto w-full">{children}</main>
      </div>
    </div>
  )
}
