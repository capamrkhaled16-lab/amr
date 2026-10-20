export const MASTER_PIN_KEY = 'alkhaled_master_pin';
export const ASSISTANT_SESSION_KEY = 'alkhaled_assistant_session';
export const PARENT_TOKEN_KEY = 'alkhaled_parent_token';
export const SESSION_TIMESTAMP_KEY = 'alkhaled_session_ts';
export const SESSION_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes of inactivity

export const DEFAULT_MASTER_PIN = '0000';

export const STATUS_META: Record<
  string,
  { label: string; color: string; bg: string; ring: string; dot: string; emoji: string }
> = {
  present: {
    label: 'حاضر',
    color: 'text-emerald-700',
    bg: 'bg-emerald-500',
    ring: 'ring-emerald-400',
    dot: 'bg-emerald-500',
    emoji: '🟢',
  },
  absent: {
    label: 'غائب',
    color: 'text-red-700',
    bg: 'bg-red-500',
    ring: 'ring-red-400',
    dot: 'bg-red-500',
    emoji: '🔴',
  },
  late: {
    label: 'متأخر',
    color: 'text-amber-700',
    bg: 'bg-amber-500',
    ring: 'ring-amber-400',
    dot: 'bg-amber-500',
    emoji: '🟡',
  },
  excused_absence: {
    label: 'غائب بعذر',
    color: 'text-blue-700',
    bg: 'bg-blue-500',
    ring: 'ring-blue-400',
    dot: 'bg-blue-500',
    emoji: '🔵',
  },
  excused: {
    label: 'غائب بعذر',
    color: 'text-blue-700',
    bg: 'bg-blue-500',
    ring: 'ring-blue-400',
    dot: 'bg-blue-500',
    emoji: '🔵',
  },
  makeup: {
    label: 'حاضر تعويضي',
    color: 'text-teal-700',
    bg: 'bg-teal-500',
    ring: 'ring-teal-400',
    dot: 'bg-teal-500',
    emoji: '💠',
  },
  unrecorded: {
    label: 'غير مسجل',
    color: 'text-slate-500',
    bg: 'bg-slate-400',
    ring: 'ring-slate-300',
    dot: 'bg-slate-400',
    emoji: '⚪',
  },
};

export const ARABIC_DAYS = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

export const ARABIC_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];
