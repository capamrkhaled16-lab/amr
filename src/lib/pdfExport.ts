/**
 * Premium Universal PDF Export System
 * Generates real downloadable PDFs via hidden iframe + browser print engine.
 * Arabic RTL, multi-page tables, page numbers, A4 portrait/landscape, gold/amber/navy palette.
 */

import { formatCurrency, formatArabicDate } from './format';
import type { Student } from './types';

export type PDFOrientation = 'portrait' | 'landscape';
export type PDFPaperSize = 'A4' | 'A3';

export type PDFReportMeta = {
  title: string;
  subtitle?: string;
  stageName?: string;
  gradeName?: string;
  groupName?: string;
  monthLabel?: string;
  dateRange?: { from: string; to: string };
  generatedAt?: Date;
  orientation?: PDFOrientation;
  paperSize?: PDFPaperSize;
  fileName?: string;
};

type PDFColumn = {
  key: string;
  label: string;
  width?: string;
  align?: 'right' | 'center' | 'left';
};

type PDFRow = Record<string, string | number | null | undefined>;

const PLATFORM_NAME = 'منصة الخالد التعليمية';

const GOLD = '#D4AF37';
const GOLD_LIGHT = '#FDF8E8';
const AMBER = '#F59E0B';
const NAVY = '#0F172A';
const NAVY_LIGHT = '#1E293B';
const BORDER = '#E2E8F0';
const ZEBRA = '#F8FAFC';
const TEXT_DARK = '#0F172A';
const TEXT_MUTED = '#64748B';
const RED = '#B91C1C';
const GREEN = '#15803D';
const BLUE = '#1D4ED8';

let generating = false;

function escapeHtml(str: string | number | null | undefined): string {
  if (str == null) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(d: Date): string {
  return formatArabicDate(d);
}

function buildReportHTML(
  meta: PDFReportMeta,
  columns: PDFColumn[],
  rows: PDFRow[],
  totalsRow?: PDFRow | null,
  summaryCards?: { label: string; value: string }[]
): string {
  const genDate = meta.generatedAt ?? new Date();
  const orientation = meta.orientation ?? 'portrait';
  const paperSize = meta.paperSize ?? 'A4';
  const pageSize = paperSize === 'A3' ? 'A3' : 'A4';
  const pageMargin = orientation === 'landscape' ? '12mm 14mm 16mm 14mm' : '14mm 12mm 18mm 12mm';

  const metaParts: string[] = [];
  if (meta.stageName) metaParts.push(`المرحلة: ${escapeHtml(meta.stageName)}`);
  if (meta.gradeName) metaParts.push(`الصف: ${escapeHtml(meta.gradeName)}`);
  if (meta.groupName) metaParts.push(`المجموعة: ${escapeHtml(meta.groupName)}`);
  if (meta.monthLabel) metaParts.push(`الشهر: ${escapeHtml(meta.monthLabel)}`);
  if (meta.dateRange) metaParts.push(`الفترة: ${escapeHtml(meta.dateRange.from)} ← ${escapeHtml(meta.dateRange.to)}`);
  const metaLine = metaParts.join('  •  ');

  const totalColCount = columns.length;
  const fontSize = orientation === 'landscape' ? '11px' : '12px';
  const cellPadding = orientation === 'landscape' ? '5px 6px' : '6px 8px';

  const headerCells = columns
    .map((col) => {
      const align = col.align ?? 'right';
      const width = col.width ? `width:${col.width};` : '';
      return `<th style="${width}text-align:${align};">${escapeHtml(col.label)}</th>`;
    })
    .join('');

  const bodyRows = rows
    .map((row, i) => {
      const bg = i % 2 === 1 ? `background:${ZEBRA};` : '';
      const cells = columns
        .map((col) => {
          const val = row[col.key];
          const align = col.align ?? 'right';
          return `<td style="text-align:${align};">${escapeHtml(val ?? '')}</td>`;
        })
        .join('');
      return `<tr style="${bg}">${cells}</tr>`;
    })
    .join('');

  const totalsHtml = totalsRow
    ? (() => {
        const cells = columns
          .map((col) => {
            const val = totalsRow[col.key];
            const align = col.align ?? 'right';
            return `<td style="text-align:${align};">${escapeHtml(val ?? '')}</td>`;
          })
          .join('');
        return `<tr class="totals-row">${cells}</tr>`;
      })()
    : '';

  const emptyHtml =
    rows.length === 0
      ? `<tr><td colspan="${totalColCount}" style="text-align:center;padding:40px 0;color:${TEXT_MUTED};font-size:14px;">لا توجد بيانات لهذا التقرير</td></tr>`
      : '';

  const summaryHtml = summaryCards && summaryCards.length > 0
    ? `<div class="summary-box">${summaryCards.map((c) => `
         <div class="summary-card">
           <div class="label">${escapeHtml(c.label)}</div>
           <div class="value">${escapeHtml(c.value)}</div>
         </div>`).join('')}</div>`
    : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(meta.fileName ?? meta.title)}</title>
<style>
  @page {
    size: ${pageSize} ${orientation};
    margin: ${pageMargin};
    @bottom-right {
      content: "صفحة " counter(page) " من " counter(pages);
      font-family: 'Cairo', 'Tajawal', Tahoma, Arial, sans-serif;
      font-size: 9px;
      color: ${TEXT_MUTED};
    }
    @bottom-left {
      content: "${escapeHtml(PLATFORM_NAME)}";
      font-family: 'Cairo', 'Tajawal', Tahoma, Arial, sans-serif;
      font-size: 9px;
      color: ${TEXT_MUTED};
    }
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  html, body {
    font-family: 'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
    color: ${TEXT_DARK};
    background: #ffffff;
    line-height: 1.5;
    font-size: ${fontSize};
  }

  .report-header {
    border-bottom: 3px solid ${GOLD};
    padding-bottom: 12px;
    margin-bottom: 16px;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
  }

  .header-brand {
    font-size: 18px;
    font-weight: 800;
    color: ${NAVY};
    letter-spacing: 0.3px;
  }

  .header-brand-sub {
    font-size: 10px;
    color: ${TEXT_MUTED};
    margin-top: 2px;
  }

  .header-gen-date {
    font-size: 10px;
    color: ${TEXT_MUTED};
    text-align: left;
    line-height: 1.6;
  }

  .header-gen-date strong {
    color: ${NAVY};
  }

  .report-title {
    font-size: 16px;
    font-weight: 800;
    color: ${NAVY};
    padding: 4px 14px;
    background: ${GOLD_LIGHT};
    border-right: 4px solid ${GOLD};
    border-radius: 4px;
    display: inline-block;
  }

  .report-meta {
    font-size: 11px;
    color: ${TEXT_MUTED};
    margin-top: 8px;
  }

  .summary-box {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .summary-card {
    flex: 1;
    min-width: 110px;
    border: 1px solid ${GOLD};
    border-radius: 8px;
    padding: 10px 14px;
    background: ${GOLD_LIGHT};
  }

  .summary-card .label {
    font-size: 10px;
    color: ${TEXT_MUTED};
    margin-bottom: 4px;
  }

  .summary-card .value {
    font-size: 18px;
    font-weight: 800;
    color: ${NAVY};
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  thead {
    display: table-header-group;
  }

  thead th {
    background: ${NAVY};
    color: #ffffff;
    font-weight: 700;
    font-size: 11px;
    padding: ${cellPadding};
    border: 1px solid ${NAVY};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  tbody td {
    padding: ${cellPadding};
    font-size: 11px;
    border: 1px solid ${BORDER};
    word-wrap: break-word;
    vertical-align: middle;
  }

  tbody tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .totals-row td {
    background: ${GOLD_LIGHT};
    font-weight: 800;
    font-size: 12px;
    border: 1px solid ${GOLD};
    color: ${NAVY};
    padding: 9px 8px;
  }

  .badge-paid { color: ${GREEN}; font-weight: 700; }
  .badge-unpaid { color: ${RED}; font-weight: 700; }
  .badge-partial { color: ${AMBER}; font-weight: 700; }
  .badge-exempt { color: ${BLUE}; font-weight: 700; }

  .report-footer {
    margin-top: 20px;
    border-top: 1px solid ${BORDER};
    padding-top: 8px;
    font-size: 9px;
    color: ${TEXT_MUTED};
    text-align: center;
  }

  @media print {
    body { font-size: ${fontSize}; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>

<div class="report-header">
  <div class="header-top">
    <div>
      <div class="header-brand">${PLATFORM_NAME}</div>
      <div class="header-brand-sub">تقرير إداري — مولّد آلياً</div>
    </div>
    <div class="header-gen-date">
      تاريخ الإصدار: <strong>${escapeHtml(formatDate(genDate))}</strong><br>
      الوقت: <strong>${escapeHtml(genDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }))}</strong>
    </div>
  </div>
  <div class="report-title">${escapeHtml(meta.title)}</div>
  ${metaLine ? `<div class="report-meta">${metaLine}</div>` : ''}
  ${meta.subtitle ? `<div class="report-meta">${escapeHtml(meta.subtitle)}</div>` : ''}
</div>

${summaryHtml}

<table>
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${bodyRows}${emptyHtml}${totalsHtml}</tbody>
</table>

<div class="report-footer">
  ${PLATFORM_NAME} — تم إنشاء هذا التقرير آلياً — ${escapeHtml(formatDate(genDate))}
</div>

<script>
(function() {
  window.onload = function() {
    setTimeout(function() { window.print(); }, 200);
  };
})();
</script>
</body>
</html>`;
}

export async function generatePDF(
  meta: PDFReportMeta,
  columns: PDFColumn[],
  rows: PDFRow[],
  totalsRow?: PDFRow | null,
  summaryCards?: { label: string; value: string }[]
): Promise<boolean> {
  if (generating) return false;
  generating = true;

  try {
    const html = buildReportHTML(meta, columns, rows, totalsRow, summaryCards);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    await new Promise<void>((resolve) => {
      const doc = iframe.contentDocument;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();
        resolve();
      } else {
        resolve();
      }
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    };

    try {
      const cw = iframe.contentWindow;
      if (cw) {
        cw.focus();
        cw.onafterprint = cleanup;
      }
      setTimeout(cleanup, 5000);
    } catch {
      cleanup();
    }

    return true;
  } catch (err) {
    console.error('[PDF Export] Error:', err);
    generating = false;
    return false;
  } finally {
    setTimeout(() => { generating = false; }, 1500);
  }
}

// ============ Report Builders ============

type EnrichedStudent = Student & {
  group_name?: string;
  group_schedule?: string | null;
  grade_name?: string;
  stage_name?: string;
};

function getStatusLabel(category: string): string {
  switch (category) {
    case 'fullyPaid': return 'مسدد';
    case 'partial': return 'جزئي';
    case 'unpaid': return 'غير مسدد';
    case 'exempt': return 'معفى';
    default: return '—';
  }
}

function safeNum(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return n;
}

export async function exportPaidStudentsPDF(
  students: EnrichedStudent[],
  monthlyPaidMap: Map<string, number>,
  monthExemptMap: Map<string, true>,
  meta: PDFReportMeta
): Promise<boolean> {
  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '4%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '20%' },
    { key: 'stage', label: 'المرحلة', width: '12%' },
    { key: 'grade', label: 'الصف', width: '10%' },
    { key: 'group', label: 'المجموعة', width: '14%' },
    { key: 'paid', label: 'المدفوع', width: '12%', align: 'center' },
    { key: 'remaining', label: 'المتبقي', width: '12%', align: 'center' },
    { key: 'status', label: 'حالة السداد', width: '16%', align: 'center' },
  ];

  const filtered = students.filter((s) => {
    if (monthExemptMap.has(s.id)) return false;
    const paid = safeNum(monthlyPaidMap.get(s.id));
    return safeNum(s.total_fees) > 0 && paid >= safeNum(s.total_fees);
  });

  const rows: PDFRow[] = filtered.map((s, i) => {
    const paid = safeNum(monthlyPaidMap.get(s.id));
    const fees = safeNum(s.total_fees);
    const remaining = Math.max(0, fees - paid);
    return {
      idx: i + 1,
      name: s.name,
      stage: s.stage_name ?? '—',
      grade: s.grade_name ?? '—',
      group: s.group_name ?? '—',
      paid: formatCurrency(paid),
      remaining: formatCurrency(remaining),
      status: 'مسدد',
    };
  });

  const totalPaid = filtered.reduce((sum, s) => sum + safeNum(monthlyPaidMap.get(s.id)), 0);
  const totalRemaining = filtered.reduce((sum, s) => sum + Math.max(0, safeNum(s.total_fees) - safeNum(monthlyPaidMap.get(s.id))), 0);
  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${filtered.length} طالب)`,
    stage: '', grade: '', group: '',
    paid: formatCurrency(totalPaid),
    remaining: formatCurrency(totalRemaining),
    status: '',
  };

  const title = meta.monthLabel
    ? `تقرير الطلاب المسددين لشهر ${meta.monthLabel}`
    : 'كشف الطلاب المسددين بالكامل';

  const summaryCards = [
    { label: 'عدد الطلاب', value: String(filtered.length) },
    { label: 'إجمالي المحصل', value: `${formatCurrency(totalPaid)} ج.م` },
    { label: 'إجمالي المتبقي', value: `${formatCurrency(totalRemaining)} ج.م` },
  ];

  return generatePDF(
    { ...meta, title, subtitle: `عدد الطلاب: ${filtered.length}`, fileName: meta.fileName ?? 'الطلاب_المسددون', orientation: 'landscape' as PDFOrientation },
    columns, rows, totalsRow, summaryCards
  );
}

export async function exportUnpaidStudentsPDF(
  students: EnrichedStudent[],
  monthlyPaidMap: Map<string, number>,
  monthExemptMap: Map<string, true>,
  meta: PDFReportMeta
): Promise<boolean> {
  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '4%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '20%' },
    { key: 'stage', label: 'المرحلة', width: '12%' },
    { key: 'grade', label: 'الصف', width: '10%' },
    { key: 'group', label: 'المجموعة', width: '14%' },
    { key: 'paid', label: 'المدفوع', width: '12%', align: 'center' },
    { key: 'remaining', label: 'المتبقي', width: '12%', align: 'center' },
    { key: 'status', label: 'حالة السداد', width: '16%', align: 'center' },
  ];

  const filtered = students.filter((s) => {
    if (monthExemptMap.has(s.id)) return false;
    const paid = safeNum(monthlyPaidMap.get(s.id));
    const remaining = safeNum(s.total_fees) - paid;
    return safeNum(s.total_fees) > 0 && remaining > 0;
  });

  const rows: PDFRow[] = filtered.map((s, i) => {
    const paid = safeNum(monthlyPaidMap.get(s.id));
    const fees = safeNum(s.total_fees);
    const remaining = Math.max(0, fees - paid);
    const statusLabel = paid > 0 ? 'دفع جزئي' : 'غير مسدد';
    return {
      idx: i + 1, name: s.name,
      stage: s.stage_name ?? '—', grade: s.grade_name ?? '—',
      group: s.group_name ?? '—',
      paid: formatCurrency(paid),
      remaining: formatCurrency(remaining),
      status: statusLabel,
    };
  });

  const totalPaid = filtered.reduce((sum, s) => sum + safeNum(monthlyPaidMap.get(s.id)), 0);
  const totalRemaining = filtered.reduce((sum, s) => sum + Math.max(0, safeNum(s.total_fees) - safeNum(monthlyPaidMap.get(s.id))), 0);
  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${filtered.length} طالب)`,
    stage: '', grade: '', group: '',
    paid: formatCurrency(totalPaid),
    remaining: formatCurrency(totalRemaining),
    status: '',
  };

  const title = meta.monthLabel
    ? `تقرير الطلاب غير المسددين لشهر ${meta.monthLabel}`
    : 'كشف الطلاب غير المسددين';

  const summaryCards = [
    { label: 'عدد الطلاب', value: String(filtered.length) },
    { label: 'إجمالي المدفوع', value: `${formatCurrency(totalPaid)} ج.م` },
    { label: 'إجمالي المتبقي', value: `${formatCurrency(totalRemaining)} ج.م` },
  ];

  return generatePDF(
    { ...meta, title, subtitle: `عدد الطلاب: ${filtered.length}`, fileName: meta.fileName ?? 'الطلاب_غير_المسددين', orientation: 'landscape' as PDFOrientation },
    columns, rows, totalsRow, summaryCards
  );
}

export async function exportMonthlyPaymentSummaryPDF(
  students: EnrichedStudent[],
  monthlyPaidMap: Map<string, number>,
  monthExemptMap: Map<string, true>,
  meta: PDFReportMeta
): Promise<boolean> {
  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '5%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '20%' },
    { key: 'group', label: 'المجموعة', width: '14%' },
    { key: 'stage', label: 'المرحلة', width: '12%' },
    { key: 'grade', label: 'الصف', width: '10%' },
    { key: 'fees', label: 'المستحق', width: '10%', align: 'center' },
    { key: 'paid', label: 'المدفوع', width: '10%', align: 'center' },
    { key: 'remaining', label: 'المتبقي', width: '10%', align: 'center' },
    { key: 'status', label: 'الحالة', width: '9%', align: 'center' },
  ];

  const rows: PDFRow[] = students.map((s, i) => {
    const isExempt = monthExemptMap.has(s.id);
    const paid = safeNum(monthlyPaidMap.get(s.id));
    const fees = safeNum(s.total_fees);
    const remaining = Math.max(0, fees - paid);
    let category = 'unpaid';
    if (isExempt) category = 'exempt';
    else if (fees <= 0 || paid >= fees) category = 'fullyPaid';
    else if (paid > 0) category = 'partial';

    return {
      idx: i + 1, name: s.name,
      group: s.group_name ?? '—', stage: s.stage_name ?? '—',
      grade: s.grade_name ?? '—',
      fees: isExempt ? 'معفى' : formatCurrency(fees),
      paid: formatCurrency(paid),
      remaining: isExempt ? '—' : formatCurrency(remaining),
      status: getStatusLabel(category),
    };
  });

  const totalFees = students.reduce((sum, s) => sum + safeNum(s.total_fees), 0);
  const totalPaid = students.reduce((sum, s) => sum + safeNum(monthlyPaidMap.get(s.id)), 0);
  const totalRemaining = Math.max(0, totalFees - totalPaid);
  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${students.length} طالب)`,
    group: '', stage: '', grade: '',
    fees: formatCurrency(totalFees), paid: formatCurrency(totalPaid),
    remaining: formatCurrency(totalRemaining), status: 'ج.م',
  };

  const summaryCards = [
    { label: 'إجمالي الطلاب', value: String(students.length) },
    { label: 'إجمالي المستحق', value: formatCurrency(totalFees) },
    { label: 'إجمالي المحصل', value: formatCurrency(totalPaid) },
    { label: 'إجمالي المتبقي', value: formatCurrency(totalRemaining) },
  ];

  return generatePDF(
    { ...meta, title: 'ملخص المدفوعات الشهري', subtitle: `إجمالي الطلاب: ${students.length}` },
    columns, rows, totalsRow, summaryCards
  );
}

export async function exportStudentListPDF(
  students: EnrichedStudent[],
  meta: PDFReportMeta
): Promise<boolean> {
  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '5%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '22%' },
    { key: 'group', label: 'المجموعة', width: '15%' },
    { key: 'stage', label: 'المرحلة', width: '13%' },
    { key: 'grade', label: 'الصف', width: '12%' },
    { key: 'phone', label: 'هاتف الطالب', width: '16%', align: 'center' },
    { key: 'parent', label: 'هاتف ولي الأمر', width: '17%', align: 'center' },
  ];

  const rows: PDFRow[] = students.map((s, i) => ({
    idx: i + 1, name: s.name,
    group: s.group_name ?? '—', stage: s.stage_name ?? '—',
    grade: s.grade_name ?? '—', phone: s.phone ?? '—', parent: s.parent_phone ?? '—',
  }));

  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${students.length} طالب)`,
    group: '', stage: '', grade: '', phone: '', parent: '',
  };

  const titleParts: string[] = [];
  if (meta.stageName) titleParts.push(meta.stageName);
  if (meta.gradeName) titleParts.push(meta.gradeName);
  if (meta.groupName) titleParts.push(meta.groupName);
  const dynamicTitle = titleParts.length > 0
    ? `كشف أسماء الطلاب — ${titleParts.join(' / ')}`
    : 'كشف أسماء الطلاب';

  return generatePDF(
    { ...meta, title: dynamicTitle, subtitle: `عدد الطلاب: ${students.length}` },
    columns, rows, totalsRow
  );
}

export async function exportDashboardSummaryPDF(
  meta: PDFReportMeta & {
    totalStudents: number;
    totalCollected: number;
    totalRemaining: number;
    fullyPaid: number;
    partialPaid: number;
    unpaidCount: number;
    groupsCount: number;
  }
): Promise<boolean> {
  const cards = [
    { label: 'إجمالي الطلاب', value: String(meta.totalStudents) },
    { label: 'عدد المجموعات', value: String(meta.groupsCount) },
    { label: 'دفع كامل', value: String(meta.fullyPaid) },
    { label: 'دفع جزئي', value: String(meta.partialPaid) },
    { label: 'لم يدفع', value: String(meta.unpaidCount) },
    { label: 'إجمالي المحصل', value: formatCurrency(meta.totalCollected) },
    { label: 'إجمالي المتبقي', value: formatCurrency(meta.totalRemaining) },
  ];

  const columns: PDFColumn[] = [
    { key: 'metric', label: 'المؤشر', width: '50%' },
    { key: 'value', label: 'القيمة', width: '50%', align: 'center' },
  ];

  const rows: PDFRow[] = [
    { metric: 'إجمالي الطلاب', value: String(meta.totalStudents) },
    { metric: 'عدد المجموعات', value: String(meta.groupsCount) },
    { metric: 'الطلاب المسددون بالكامل', value: String(meta.fullyPaid) },
    { metric: 'الطلاب بدفع جزئي', value: String(meta.partialPaid) },
    { metric: 'الطلاب غير المسددين', value: String(meta.unpaidCount) },
    { metric: 'إجمالي المبلغ المحصل (ج.م)', value: formatCurrency(meta.totalCollected) },
    { metric: 'إجمالي المبلغ المتبقي (ج.م)', value: formatCurrency(meta.totalRemaining) },
  ];

  return generatePDF(
    { ...meta, title: 'ملخص لوحة المعلومات', subtitle: meta.monthLabel },
    columns, rows, null, cards
  );
}

export async function exportAttendancePDF(
  students: Student[],
  records: Record<string, { status: string; notes: string | null; recorded_at: string | null; late_minutes: number | null }>,
  meta: PDFReportMeta & { sessionTitle?: string; date?: string }
): Promise<boolean> {
  const statusLabels: Record<string, string> = {
    present: 'حاضر', absent: 'غائب', late: 'متأخر',
    excused: 'مستبعد', excused_absence: 'غياب بعذر', makeup: 'تعويضي', unrecorded: 'غير مسجل',
  };

  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '6%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '30%' },
    { key: 'status', label: 'الحالة', width: '15%', align: 'center' },
    { key: 'time', label: 'الوقت', width: '15%', align: 'center' },
    { key: 'late', label: 'التأخير (د)', width: '12%', align: 'center' },
    { key: 'notes', label: 'ملاحظات', width: '22%' },
  ];

  const rows: PDFRow[] = students.map((s, i) => {
    const rec = records[s.id];
    const status = rec ? (statusLabels[rec.status] ?? rec.status) : 'غير مسجل';
    const time = rec?.recorded_at
      ? new Date(rec.recorded_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
      : '—';
    return {
      idx: i + 1, name: s.name, status,
      time, late: rec?.late_minutes ? String(rec.late_minutes) : '—',
      notes: rec?.notes ?? '—',
    };
  });

  const present = rows.filter((r) => r.status === 'حاضر').length;
  const absent = rows.filter((r) => r.status === 'غائب').length;
  const late = rows.filter((r) => r.status === 'متأخر').length;

  const summaryCards = [
    { label: 'إجمالي الطلاب', value: String(students.length) },
    { label: 'الحاضرون', value: String(present) },
    { label: 'الغائبون', value: String(absent) },
    { label: 'المتأخرون', value: String(late) },
  ];

  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${students.length} طالب)`,
    status: '', time: '', late: '', notes: '',
  };

  const fullMeta: PDFReportMeta = {
    ...meta,
    title: `تقرير الحضور — ${meta.sessionTitle ?? meta.groupName ?? ''}`,
    subtitle: meta.date ? `تاريخ: ${meta.date}` : undefined,
    orientation: 'landscape' as PDFOrientation,
  };

  return generatePDF(fullMeta, columns, rows, totalsRow, summaryCards);
}

export async function exportHallOfFamePDF(
  entries: { id: string; name: string; rank: number; overall_score: number; group_name?: string }[],
  meta: PDFReportMeta
): Promise<boolean> {
  const columns: PDFColumn[] = [
    { key: 'rank', label: 'الترتيب', width: '10%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '35%' },
    { key: 'group', label: 'المجموعة', width: '20%' },
    { key: 'score', label: 'النسبة الكلية', width: '15%', align: 'center' },
    { key: 'grade', label: 'التقدير', width: '20%', align: 'center' },
  ];

  function gradeLabel(score: number): string {
    if (score >= 90) return 'ممتاز';
    if (score >= 80) return 'جيد جداً';
    if (score >= 70) return 'جيد';
    if (score >= 60) return 'مقبول';
    return 'ضعيف';
  }

  const rows: PDFRow[] = entries.map((e) => ({
    rank: e.rank, name: e.name,
    group: e.group_name ?? '—',
    score: `${e.overall_score.toFixed(1)}%`,
    grade: gradeLabel(e.overall_score),
  }));

  const totalsRow: PDFRow = {
    rank: '', name: `لوحة الشرف (${entries.length} طالب)`,
    group: '', score: '', grade: '',
  };

  return generatePDF(
    { ...meta, title: 'لوحة الشرف', subtitle: `عدد الطلاب: ${entries.length}` },
    columns, rows, totalsRow
  );
}

export async function exportHomeworkPDF(
  students: Student[],
  statuses: Record<string, { status: string }>,
  homeworkTitle: string,
  meta: PDFReportMeta
): Promise<boolean> {
  const statusLabels: Record<string, string> = {
    complete: 'اكتمل', incomplete: 'لم يكتمل', late: 'متأخر',
    absent: 'غائب', excused: 'مستبعد', unrecorded: 'غير مسجل',
  };

  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '8%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '40%' },
    { key: 'status', label: 'الحالة', width: '20%', align: 'center' },
    { key: 'group', label: 'المجموعة', width: '20%' },
    { key: 'notes', label: 'ملاحظات', width: '12%' },
  ];

  const rows: PDFRow[] = students.map((s, i) => ({
    idx: i + 1, name: s.name,
    status: statusLabels[statuses[s.id]?.status] ?? 'غير مسجل',
    group: meta.groupName ?? '—',
    notes: '—',
  }));

  const complete = rows.filter((r) => r.status === 'اكتمل').length;
  const incomplete = rows.filter((r) => r.status === 'لم يكتمل').length;
  const late = rows.filter((r) => r.status === 'متأخر').length;

  const summaryCards = [
    { label: 'إجمالي الطلاب', value: String(students.length) },
    { label: 'اكتمل', value: String(complete) },
    { label: 'لم يكتمل', value: String(incomplete) },
    { label: 'متأخر', value: String(late) },
  ];

  return generatePDF(
    { ...meta, title: `تقرير الواجب: ${homeworkTitle}`, subtitle: meta.monthLabel },
    columns, rows, null, summaryCards
  );
}

export async function exportParentPortalPDF(
  studentName: string,
  stageName: string | undefined,
  gradeName: string | undefined,
  groupName: string | undefined,
  monthLabel: string,
  summary: {
    attendanceRate: number;
    present: number;
    absent: number;
    excused: number;
    late: number;
    hwRate: number;
    hwDone: number;
    hwTotal: number;
    examAvg: number | null;
    feesDue: number;
    feesPaid: number;
    feesRemaining: number;
    isExempt: boolean;
  },
  grades: { examTitle: string; category: string; score: number; maxScore: number; passed: boolean }[],
  payments: { date: string; amount: number; note: string | null }[],
): Promise<boolean> {
  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '8%', align: 'center' },
    { key: 'exam', label: 'الامتحان', width: '35%' },
    { key: 'category', label: 'النوع', width: '15%', align: 'center' },
    { key: 'score', label: 'الدرجة', width: '15%', align: 'center' },
    { key: 'pct', label: 'النسبة', width: '12%', align: 'center' },
    { key: 'result', label: 'النتيجة', width: '15%', align: 'center' },
  ];

  const catLabels: Record<string, string> = {
    recitation: 'تسميع', sheet: 'شيت', behavior: 'سلوك', exam: 'امتحان', online: 'أونلاين',
  };

  const rows: PDFRow[] = grades.map((g, i) => ({
    idx: i + 1,
    exam: g.examTitle,
    category: catLabels[g.category] ?? g.category,
    score: `${g.score}/${g.maxScore}`,
    pct: g.maxScore > 0 ? `${Math.round((g.score / g.maxScore) * 100)}%` : '—',
    result: g.passed ? 'ناجح' : 'راسب',
  }));

  const summaryCards = [
    { label: 'نسبة الحضور', value: `${summary.attendanceRate}%` },
    { label: 'أيام الحضور', value: String(summary.present) },
    { label: 'أيام الغياب', value: String(summary.absent) },
    { label: 'نسبة الواجبات', value: `${summary.hwRate}%` },
    { label: 'المستوى العام', value: summary.examAvg !== null ? `${summary.examAvg}%` : '—' },
    { label: 'المبلغ المدفوع', value: `${formatCurrency(summary.feesPaid)} ج.م` },
    { label: 'المتبقي', value: summary.isExempt ? 'معفى' : `${formatCurrency(summary.feesRemaining)} ج.م` },
  ];

  const paymentRows: PDFRow[] = payments.map((p, i) => ({
    idx: i + 1,
    exam: formatArabicDate(p.date),
    category: 'دفعة',
    score: `${formatCurrency(p.amount)} ج.م`,
    pct: '',
    result: p.note ?? '—',
  }));

  const allRows = [...rows, ...paymentRows];

  return generatePDF(
    {
      title: `تقرير ولي الأمر — ${studentName}`,
      subtitle: monthLabel,
      stageName,
      gradeName,
      groupName,
      monthLabel,
    },
    columns,
    allRows,
    null,
    summaryCards,
  );
}

export async function exportMonthlyCollectionSheetPDF(
  students: EnrichedStudent[],
  meta: PDFReportMeta
): Promise<boolean> {
  const columns: PDFColumn[] = [
    { key: 'idx', label: 'م', width: '5%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '25%' },
    { key: 'paid', label: 'المبلغ المدفوع', width: '15%', align: 'center' },
    { key: 'remaining', label: 'المتبقي', width: '15%', align: 'center' },
    { key: 'date', label: 'اليوم والتاريخ', width: '18%', align: 'center' },
    { key: 'receiver', label: 'المستلم', width: '22%', align: 'center' },
  ];

  const rows: PDFRow[] = students.map((s, i) => ({
    idx: i + 1,
    name: s.name,
    paid: '',
    remaining: '',
    date: '',
    receiver: '',
  }));

  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${students.length} طالب)`,
    paid: '', remaining: '', date: '', receiver: '',
  };

  const groupSchedule = (students[0]?.group_schedule ?? '') as string;
  const metaLineParts: string[] = [];
  if (meta.stageName) metaLineParts.push(`المرحلة: ${meta.stageName}`);
  if (meta.gradeName) metaLineParts.push(`الصف: ${meta.gradeName}`);
  if (meta.groupName) metaLineParts.push(`المجموعة: ${meta.groupName}`);
  if (groupSchedule) metaLineParts.push(`الميعاد: ${groupSchedule}`);
  if (meta.monthLabel) metaLineParts.push(`الشهر: ${meta.monthLabel}`);

  const customHTML = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(meta.fileName ?? 'سجل التحصيل الشهري')}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 14mm 10mm 16mm 10mm;
    @bottom-right {
      content: "صفحة " counter(page) " من " counter(pages);
      font-family: 'Cairo', 'Tajawal', Tahoma, Arial, sans-serif;
      font-size: 9px;
      color: ${TEXT_MUTED};
    }
    @bottom-left {
      content: "${escapeHtml(PLATFORM_NAME)}";
      font-family: 'Cairo', 'Tajawal', Tahoma, Arial, sans-serif;
      font-size: 9px;
      color: ${TEXT_MUTED};
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body {
    font-family: 'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
    color: ${TEXT_DARK};
    background: #ffffff;
    line-height: 1.5;
    font-size: 12px;
  }
  .report-header {
    border-bottom: 3px solid ${GOLD};
    padding-bottom: 12px;
    margin-bottom: 14px;
  }
  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
  }
  .header-brand {
    font-size: 20px;
    font-weight: 800;
    color: ${NAVY};
    letter-spacing: 0.3px;
  }
  .header-brand-sub {
    font-size: 10px;
    color: ${TEXT_MUTED};
    margin-top: 2px;
  }
  .header-gen-date {
    font-size: 10px;
    color: ${TEXT_MUTED};
    text-align: left;
    line-height: 1.6;
  }
  .header-gen-date strong { color: ${NAVY}; }
  .report-title {
    font-size: 16px;
    font-weight: 800;
    color: ${NAVY};
    padding: 4px 14px;
    background: ${GOLD_LIGHT};
    border-right: 4px solid ${GOLD};
    border-radius: 4px;
    display: inline-block;
  }
  .report-meta {
    font-size: 11px;
    color: ${TEXT_MUTED};
    margin-top: 8px;
    font-weight: 600;
  }
  .report-meta span { color: ${NAVY}; font-weight: 700; }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  thead { display: table-header-group; }
  thead th {
    background: ${NAVY};
    color: #ffffff;
    font-weight: 700;
    font-size: 12px;
    padding: 9px 6px;
    border: 1.5px solid ${NAVY};
    white-space: nowrap;
  }
  tbody td {
    padding: 11px 6px;
    font-size: 12px;
    border: 1px solid ${BORDER};
    vertical-align: middle;
    height: 32px;
  }
  tbody tr { page-break-inside: avoid; break-inside: avoid; }
  tbody tr:nth-child(even) { background: ${ZEBRA}; }
  .blank-cell { color: transparent; }
  .totals-row td {
    background: ${GOLD_LIGHT};
    font-weight: 800;
    font-size: 12px;
    border: 1px solid ${GOLD};
    color: ${NAVY};
    padding: 9px 6px;
  }
  .report-footer {
    margin-top: 18px;
    border-top: 1px solid ${BORDER};
    padding-top: 8px;
    font-size: 9px;
    color: ${TEXT_MUTED};
    text-align: center;
  }
  @media print { body { font-size: 12px; } .no-print { display: none !important; } }
</style>
</head>
<body>
<div class="report-header">
  <div class="header-top">
    <div>
      <div class="header-brand">${PLATFORM_NAME}</div>
      <div class="header-brand-sub">سجل التحصيل الشهري — للتعبئة اليدوية</div>
    </div>
    <div class="header-gen-date">
      تاريخ الإصدار: <strong>${escapeHtml(formatDate(new Date()))}</strong><br>
      الوقت: <strong>${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</strong>
    </div>
  </div>
  <div class="report-title">سجل التحصيل الشهري</div>
  <div class="report-meta">${metaLineParts.join('  •  ')}</div>
</div>
<table>
  <thead><tr>${columns.map((col) => `<th style="${col.width ? `width:${col.width};` : ''}text-align:${col.align ?? 'right'};">${escapeHtml(col.label)}</th>`).join('')}</tr></thead>
  <tbody>
    ${rows.map((row, i) => {
      const bg = i % 2 === 1 ? `background:${ZEBRA};` : '';
      const cells = columns.map((col) => {
        const val = row[col.key];
        const isEmpty = val === '';
        return `<td style="text-align:${col.align ?? 'right'};${bg}${isEmpty ? 'height:32px;' : ''}" class="${isEmpty ? 'blank-cell' : ''}">${escapeHtml(val ?? '')}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('')}
    <tr class="totals-row">
      <td colspan="2" style="text-align:right;">${escapeHtml(totalsRow.name as string)}</td>
      <td></td><td></td><td></td><td></td>
    </tr>
  </tbody>
</table>
<div class="report-footer">
  ${PLATFORM_NAME} — تم إنشاء هذا السجل آلياً للطباعة والتعبئة اليدوية — ${escapeHtml(formatDate(new Date()))}
</div>
<script>
(function() {
  window.onload = function() {
    setTimeout(function() { window.print(); }, 200);
  };
})();
</script>
</body>
</html>`;

  if (generating) return false;
  generating = true;

  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    await new Promise<void>((resolve) => {
      const doc = iframe.contentDocument;
      if (doc) {
        doc.open();
        doc.write(customHTML);
        doc.close();
        resolve();
      } else {
        resolve();
      }
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const cleanup = () => {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    };

    try {
      const cw = iframe.contentWindow;
      if (cw) {
        cw.focus();
        cw.onafterprint = cleanup;
      }
      setTimeout(cleanup, 5000);
    } catch {
      cleanup();
    }

    return true;
  } catch (err) {
    console.error('[PDF Export] Collection sheet error:', err);
    generating = false;
    return false;
  } finally {
    setTimeout(() => { generating = false; }, 1500);
  }
}

export async function exportBehaviorPDF(
  students: Student[],
  behavior: Record<string, { rating: string; note: string | null }[]>,
  meta: PDFReportMeta
): Promise<boolean> {
  const ratingLabels: Record<string, string> = {
    excellent: 'ممتاز', participatory: 'مشارك', quiet: 'هادئ',
    needs_attention: 'يحتاج اهتمام', disruptive: 'مزعج',
  };

  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '8%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '35%' },
    { key: 'rating', label: 'التقدير', width: '20%', align: 'center' },
    { key: 'count', label: 'عدد التقييمات', width: '15%', align: 'center' },
    { key: 'lastNote', label: 'آخر ملاحظة', width: '22%' },
  ];

  const rows: PDFRow[] = students.map((s, i) => {
    const evals = behavior[s.id] ?? [];
    const latest = evals[0];
    return {
      idx: i + 1, name: s.name,
      rating: latest ? (ratingLabels[latest.rating] ?? latest.rating) : 'غير مقيّم',
      count: String(evals.length),
      lastNote: latest?.note ?? '—',
    };
  });

  return generatePDF(
    { ...meta, title: 'تقرير السلوك', subtitle: meta.monthLabel },
    columns, rows
  );
}
