import type { AttendanceStatus } from '@/lib/types';

export function isAbsentStatus(status: AttendanceStatus | undefined): boolean {
  return status === 'absent' || status === 'excused_absence' || status === 'excused';
}

export function absenceLabel(status: AttendanceStatus | undefined): string {
  if (status === 'excused_absence' || status === 'excused') return 'غائب بعذر';
  if (status === 'absent') return 'غائب';
  return '';
}

type Props = {
  status: AttendanceStatus | undefined;
  size?: 'xs' | 'sm';
  sessionTitle?: string | null;
  sessionNumber?: number | null;
  date?: string | null;
};

export default function AbsenceBadge({ status, size = 'xs', sessionTitle, sessionNumber, date }: Props) {
  if (!isAbsentStatus(status)) return null;
  const isExcused = status === 'excused_absence' || status === 'excused';
  const sizeCls = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-[10px] px-1.5 py-0.5';
  const label = absenceLabel(status);
  const parts: string[] = [];
  if (sessionNumber) parts.push(`حصة ${sessionNumber}`);
  else if (sessionTitle) parts.push(sessionTitle);
  if (date) parts.push(date);
  const detail = parts.join(' — ');
  return (
    <span
      className={`inline-flex items-center ${sizeCls} font-bold rounded-full border ${isExcused ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'} flex-shrink-0`}
      title={detail || undefined}
    >
      {label}{detail ? ` — ${detail}` : ''}
    </span>
  );
}
