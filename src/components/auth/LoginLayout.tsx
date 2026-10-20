import { type ReactNode, useState } from 'react';
import { motion } from 'framer-motion';
import { useSettings } from '@/context/SettingsContext';
import { GraduationCap, Lock, User } from 'lucide-react';

type LoginLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  error?: string;
  primaryLabel: string;
  primaryHref?: string;
  primaryText: string;
  onPrimaryClick?: () => void;
};

export default function LoginLayout({
  title,
  subtitle,
  children,
  error,
  primaryLabel,
  primaryHref,
  primaryText,
  onPrimaryClick,
}: LoginLayoutProps) {
  const { settings } = useSettings();

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-600/12 rounded-full blur-[120px] animate-float" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-teal-600/10 rounded-full blur-[100px] animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-emerald-500/8 rounded-full blur-[80px] animate-float" style={{ animationDelay: '2s' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass-card relative w-full max-w-md rounded-3xl p-8 shadow-glass-lg"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          {settings.logo_url ? (
            <img
              src={settings.logo_url}
              alt="لوجو الخالد"
              className="w-20 h-20 rounded-2xl object-cover ring-4 ring-emerald-500/40 mb-4 shadow-lg shadow-emerald-900/30"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center ring-4 ring-emerald-500/40 mb-4 animate-pulse-glow border border-emerald-400/15">
              <GraduationCap className="text-emerald-400" size={40} />
            </div>
          )}
          <h1 className="text-2xl font-extrabold gradient-text text-center">
            {settings.platform_name}
          </h1>
          <p className="text-sm text-emerald-400/70 mt-1 text-center">
            {settings.management_name}
          </p>
        </div>

        <div className="mb-6">
          <h2 className="text-xl font-bold text-white text-center mb-1">
            {title}
          </h2>
          <p className="text-sm text-slate-400 text-center">{subtitle}</p>
        </div>

        {children}

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-4 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center text-sm text-red-400"
          >
            {error}
          </motion.div>
        )}

        <div className="mt-6 text-center">
          <span className="text-sm text-slate-500">{primaryLabel} </span>
          {primaryHref ? (
            <a
              href={primaryHref}
              className="text-sm text-emerald-400 hover:text-emerald-300 font-semibold transition"
            >
              {primaryText}
            </a>
          ) : (
            <button
              onClick={onPrimaryClick}
              className="text-sm text-emerald-400 hover:text-emerald-300 font-semibold transition"
            >
              {primaryText}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export function PinInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
        size={18}
      />
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'الرقم السري (PIN)'}
        inputMode="numeric"
        className="w-full glass-input rounded-xl py-3 pr-10 pl-12 text-white placeholder-slate-500"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs transition"
      >
        {show ? 'إخفاء' : 'إظهار'}
      </button>
    </div>
  );
}

export function UserInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <User
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
        size={18}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full glass-input rounded-xl py-3 pr-10 pl-4 text-white placeholder-slate-500"
      />
    </div>
  );
}
