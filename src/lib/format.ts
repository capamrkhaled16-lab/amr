import { ARABIC_DAYS, ARABIC_MONTHS } from './constants';

export function formatArabicDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  const dayName = ARABIC_DAYS[d.getDay()] ?? '—';
  const day = d.getDate();
  const month = ARABIC_MONTHS[d.getMonth()] ?? '—';
  const year = d.getFullYear();
  return `${dayName}، ${day} ${month} ${year}`;
}

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  let h = d.getHours();
  const period = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h.toString().padStart(2, '0')}:${m}:${s} ${period}`;
}

export function formatTransactionDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return `${formatArabicDate(d)} — ${formatTime(d)}`;
}

export function todayDateString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function generateSerialId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AKH-${ts}-${rand}`;
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير';
  if (hour < 17) return 'نهارك سعيد';
  if (hour < 21) return 'مساء الخير';
  return 'مساء الخير';
}

export type GradeRating = {
  label: string;
  color: string;
};

export function getGradeRating(score: number, maxScore: number): GradeRating {
  if (maxScore <= 0) return { label: '—', color: 'text-slate-400' };
  const pct = (score / maxScore) * 100;
  if (pct < 50) return { label: 'ضعيف', color: 'text-red-400' };
  if (pct === 50) return { label: 'مقبول', color: 'text-amber-400' };
  if (pct < 65) return { label: 'جيد', color: 'text-sky-400' };
  if (pct < 85) return { label: 'جيد جداً', color: 'text-emerald-400' };
  return { label: 'امتياز', color: 'text-emerald-300' };
}

export function formatCurrency(amount: number): string {
  const n = typeof amount === 'number' && isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Normalize an Egyptian phone number to E.164 format (without the +) for wa.me links.
 * - Strips all non-digit characters
 * - Replaces leading 0 with country code 20 (Egypt)
 * - If the number already starts with 20, keeps it as-is
 * - If it starts with another country code (no leading 0), keeps it as-is
 */
/**
 * Strip invisible Unicode characters that WhatsApp and Arabic text editors
 * can inject into shared links (BOM, BIDI marks, zero-width spaces, etc.).
 * Returns a trimmed, clean ASCII-safe token string.
 */
export function sanitizeToken(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    // Remove zero-width chars, BOM, BIDI controls, and other invisible format marks
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u180E]/g, '')
    // Remove any remaining non-printable control chars (except normal spaces/tabs)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

export function getMonthLabel(monthKey: string): string {
  if (!monthKey) return '—';
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return '—';
  return `${ARABIC_MONTHS[m - 1] ?? '—'} ${y}`;
}

export function getMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseScheduledHour(schedule: string | null): number | null {
  if (!schedule) return null;
  const match = schedule.match(/(\d{1,2})[:\.](\d{2})?/);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  if (h < 0 || h > 23) return null;
  const pmMatch = schedule.match(/(مساء|م\s|pm|PM)/);
  const amMatch = schedule.match(/(صباح|ص\s|am|AM)/);
  if (pmMatch && h < 12) h += 12;
  if (amMatch && h === 12) h = 0;
  return h;
}

export function formatArabicTime(hour: number, extraMinutes: number = 0): string {
  const totalMinutes = hour * 60 + extraMinutes;
  let h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h >= 12 ? 'م' : 'ص';
  h = h % 12 || 12;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${period}`;
}

export function normalizePhoneForWhatsApp(phone: string): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return '';
  // Egyptian numbers: handle 0020, +20, 20, 01xxxxxxxxx, 1xxxxxxxxx
  if (digits.startsWith('0020')) digits = '20' + digits.slice(4);
  else if (digits.startsWith('20')) { /* already has country code */ }
  else if (digits.startsWith('0')) digits = '20' + digits.slice(1);
  else if (digits.length === 10 && digits.startsWith('1')) digits = '20' + digits;
  // Non-Egyptian international numbers: return as-is if long enough
  return digits;
}

export type WhatsAppResult = {
  opened: boolean;
  url: string;
  message: string;
};

function normalizeWhatsAppUrl(url: string): string {
  // Convert wa.me links to api.whatsapp.com/send format for better cross-device compatibility
  const waMeMatch = url.match(/^https:\/\/wa\.me\/([^?]+)\?(.*)$/);
  if (waMeMatch) {
    const phone = waMeMatch[1];
    const params = waMeMatch[2];
    return `https://api.whatsapp.com/send?phone=${phone}&${params}`;
  }
  const waMeNoPhone = url.match(/^https:\/\/wa\.me\/\?(.*)$/);
  if (waMeNoPhone) {
    return `https://api.whatsapp.com/send?${waMeNoPhone[1]}`;
  }
  return url;
}

export function openWhatsAppURL(url: string, showToast?: (msg: string, type: 'success' | 'error' | 'info') => void): WhatsAppResult {
  const normalizedUrl = normalizeWhatsAppUrl(url);
  const message = normalizedUrl.includes('text=') ? decodeURIComponent(normalizedUrl.split('text=')[1] ?? '') : '';
  let opened = false;
  try {
    const win = window.open(normalizedUrl, '_blank');
    opened = !!win && !win.closed;
  } catch {
    opened = false;
  }
  if (!opened) {
    // Fallback: try location redirect first, then clipboard copy
    try {
      if (message) {
        navigator.clipboard?.writeText(message);
        showToast?.('تعذّر فتح واتساب تلقائياً — تم نسخ نص الإيصال. الصقه يدوياً في واتساب.', 'info');
      } else {
        navigator.clipboard?.writeText(normalizedUrl);
        showToast?.('تعذّر فتح واتساب تلقائياً — تم نسخ الرابط. الصقه في المتصفح يدوياً.', 'info');
      }
    } catch {
      showToast?.('تعذّر فتح واتساب — تأكد من السماح بالنوافذ المنبثقة.', 'error');
    }
  }
  return { opened, url: normalizedUrl, message };
}
