import { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <Loader2 className="w-8 h-8 text-accent spinner" />
      {label && <p className="text-white/40 text-sm">{label}</p>}
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm text-center">
      {message}
    </div>
  )
}

export function EmptyState({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
      {icon && <div className="text-white/20">{icon}</div>}
      <p className="text-white/40 text-sm">{message}</p>
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-white">{title}</h1>
        {subtitle && <p className="text-sm text-white/40 mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-bg-card border border-bg-border rounded-xl ${className}`}>
      {children}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  type = 'button',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
}) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm' }
  const variants = {
    primary: 'bg-accent hover:bg-accent-hover text-white',
    secondary: 'bg-bg-input border border-bg-border hover:bg-bg-hover text-white',
    danger: 'bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400',
    ghost: 'text-white/60 hover:bg-bg-hover hover:text-white',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-bg-input border border-bg-border rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-accent transition-colors ${className}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
  dir,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  className?: string
  dir?: 'rtl' | 'ltr'
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      dir={dir}
      className={`bg-bg-input border border-bg-border rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-accent transition-colors ${className}`}
    />
  )
}

export function Badge({ children, color = 'default' }: { children: ReactNode; color?: 'default' | 'green' | 'red' | 'gold' | 'blue' }) {
  const colors = {
    default: 'bg-white/10 text-white/60',
    green: 'bg-accent/10 text-accent',
    red: 'bg-red-500/10 text-red-400',
    gold: 'bg-gold/10 text-gold',
    blue: 'bg-blue-500/10 text-blue-400',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  )
}
