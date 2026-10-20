const ARABIC_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export function getMonthKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function getArabicMonth(date: Date = new Date()): string {
  return `${ARABIC_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function getMonthKeyFromArabic(arabicMonth: string): string {
  for (let i = 0; i < ARABIC_MONTHS.length; i++) {
    if (arabicMonth.startsWith(ARABIC_MONTHS[i])) {
      const year = arabicMonth.split(" ")[1];
      return `${year}-${String(i + 1).padStart(2, "0")}`;
    }
  }
  return getMonthKey();
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
}

export function formatCurrency(amount: number | null | undefined): string {
  const n = typeof amount === 'number' && isFinite(amount) ? amount : 0;
  return `${new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)} ج.م`;
}

export function getTodayISO(): string {
  return new Date().toISOString().split("T")[0];
}
