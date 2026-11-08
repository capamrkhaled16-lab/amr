export function formatMonthKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

const arabicMonths = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]

export function formatMonthLabel(date: Date): string {
  return `${arabicMonths[date.getMonth()]} ${date.getFullYear()}`
}

export function currentMonthKey(): string {
  return formatMonthKey(new Date())
}

export function currentMonthLabel(): string {
  return formatMonthLabel(new Date())
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('ar-EG', {
    month: 'short',
    day: 'numeric',
  })
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

export function arabishNumber(n: number): string {
  return n.toLocaleString('ar-EG')
}
