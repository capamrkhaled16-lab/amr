import { useSettings } from '@/context/SettingsContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useMonth } from '@/context/MonthContext';
import { GraduationCap, LogOut, Sun, Moon, Wallet, Archive, Calendar } from 'lucide-react';
import NotificationBell from './NotificationBell';
import GlobalSearch from './GlobalSearch';

type NavbarProps = {
  onLogout?: () => void;
  rightContent?: React.ReactNode;
  onSearchNavigate?: (student: { group_id: string | null; id: string; name: string }, target: 'finance' | 'group') => void;
  onOpenFinances?: () => void;
  onOpenArchive?: () => void;
};

export default function Navbar({ onLogout, rightContent, onSearchNavigate, onOpenFinances, onOpenArchive }: NavbarProps) {
  const { settings } = useSettings();
  const { role, assistant, isMaster } = useAuth();
  const { monthKey, setMonthKey, isCurrentMonth, monthOptions } = useMonth();

  return (
    <>
    <nav className="glass border-b border-white/[0.06] sticky top-0 z-40 premium-navbar safe-area-top">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex items-center gap-2 sm:gap-3">

        {/* 1. Logo + platform name — fixed, never shrinks */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {settings.logo_url ? (
            <img
              src={settings.logo_url}
              alt="لوجو"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover ring-2 ring-[#d4af37]/35 flex-shrink-0 shadow-lg shadow-black/30"
            />
          ) : (
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#d4af37]/10 flex items-center justify-center ring-2 ring-[#d4af37]/35 flex-shrink-0 border border-[#d4af37]/20">
              <GraduationCap className="text-[#e5c65a]" size={20} />
            </div>
          )}
          <div className="min-w-0 hidden md:block">
            <h1 className="text-sm sm:text-base font-bold text-white truncate leading-tight">
              {settings.platform_name}
            </h1>
            <p className="text-[10px] sm:text-xs text-[#d4af37]/70 truncate">
              {settings.management_name}
            </p>
          </div>
        </div>

        {/* 2. Month selector — always visible, never shrinks, guaranteed width */}
        <div className="relative flex-shrink-0" style={{ minWidth: '130px' }}>
          <Calendar size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#d4af37] pointer-events-none z-10" />
          <select
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
            className={`w-full appearance-none pr-8 pl-2 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border premium-interactive ${
              isCurrentMonth
                ? 'glass-light text-white border-transparent hover:bg-white/10'
                : 'bg-amber-500/10 text-amber-300 border-amber-500/20 hover:bg-amber-500/20'
            }`}
            title="اختر الشهر"
          >
            {monthOptions.map((m) => (
              <option key={m.key} value={m.key} className="bg-slate-800 text-white">
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Global search — fills remaining space on desktop */}
        <div className="flex-1 min-w-0 hidden sm:flex justify-center">
          <GlobalSearch onNavigate={onSearchNavigate} />
        </div>

        {/* 4. Action icons — scrollable row on mobile, wraps cleanly on desktop */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 overflow-x-auto premium-header-scroll touch-pan-x max-w-[45vw] sm:max-w-none">
          {/* Discreet finance button — master only */}
          {isMaster && onOpenFinances && (
            <button
              onClick={onOpenFinances}
              className="p-2 rounded-xl glass-light hover:bg-[#d4af37]/10 text-slate-400 hover:text-[#d4af37] transition flex-shrink-0 opacity-60 hover:opacity-100 premium-interactive"
              title="ملخص مالي سري"
            >
              <Wallet size={16} />
            </button>
          )}

          {/* Teacher/assistant badge */}
          {isMaster ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#d4af37]/10 border border-[#d4af37]/20 text-[#e5c65a] rounded-full text-xs font-bold flex-shrink-0">
              <GraduationCap size={14} />
              <span className="hidden sm:inline">المدرس</span>
            </span>
          ) : assistant ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-400/20 text-[#e5c65a] rounded-full text-xs font-bold flex-shrink-0">
              <span className="hidden sm:inline">{assistant.display_name ?? assistant.username}</span>
              <span className="sm:hidden">مساعد</span>
            </span>
          ) : null}

          {/* Archive button */}
          {onOpenArchive && (
            <button
              onClick={onOpenArchive}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 border border-amber-400/20 text-amber-300 rounded-full text-xs font-bold flex-shrink-0 hover:bg-amber-500/20 hover:text-amber-200 transition premium-interactive active:scale-95"
              title="الأرشيف"
              aria-label="الأرشيف"
            >
              <Archive size={14} />
              <span className="hidden sm:inline">الأرشيف</span>
            </button>
          )}

          <NotificationBell />

          {rightContent}

          <ThemeToggle />

          {onLogout && (
            <button
              onClick={onLogout}
              className="flex items-center gap-1 text-xs sm:text-sm text-slate-400 hover:text-red-400 transition px-2.5 py-2 rounded-xl hover:bg-red-500/10 flex-shrink-0 premium-interactive"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">خروج</span>
            </button>
          )}
        </div>
      </div>
    </nav>

    {/* Mobile search bar */}
    {onSearchNavigate && (
      <div className="sm:hidden glass border-b border-white/[0.06] px-3 py-2 sticky top-14 z-30 premium-navbar">
        <GlobalSearch onNavigate={onSearchNavigate} />
      </div>
    )}
    </>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="p-2 rounded-xl glass-light hover:bg-white/10 text-slate-400 hover:text-amber-400 transition flex-shrink-0 premium-interactive"
      title={theme === 'dark' ? 'التبديل للوضع النهاري' : 'التبديل للوضع الليلي'}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
