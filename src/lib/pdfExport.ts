/**
 * Premium Universal PDF Export System
 * Generates real downloadable PDFs via hidden iframe + browser print engine.
 * Arabic RTL, multi-page tables, dynamic row fitting, page numbers,
 * embedded Arabic fonts, gold/amber/navy palette.
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

// ============ Student Sorting ============

const STAGE_ORDER: Record<string, number> = {
  'ابتدائي': 1,
  'الابتدائية': 1,
  'المرحلة الابتدائية': 1,
  'إعدادي': 2,
  'الإعدادية': 2,
  'المرحلة الإعدادية': 2,
  'preparatory': 2,
  'ثانوي': 3,
  'الثانوية': 3,
  'المرحلة الثانوية': 3,
};

function stageSortKey(stageName: string | undefined): number {
  if (!stageName) return 99;
  const key = stageName.trim();
  if (STAGE_ORDER[key] !== undefined) return STAGE_ORDER[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(STAGE_ORDER)) {
    if (lower.includes(k.toLowerCase()) || key.includes(k)) return v;
  }
  if (lower.includes('ابتدا') || lower.includes('primary')) return 1;
  if (lower.includes('إعدا') || lower.includes('prep')) return 2;
  if (lower.includes('ثانو') || lower.includes('second')) return 3;
  return 50;
}

function gradeSortKey(gradeName: string | undefined): number {
  if (!gradeName) return 99;
  const match = gradeName.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 99;
}

type EnrichedStudent = Student & {
  group_name?: string;
  group_schedule?: string | null;
  grade_name?: string;
  stage_name?: string;
};

export function sortStudentsForReport<T extends EnrichedStudent>(students: T[]): T[] {
  return [...students].sort((a, b) => {
    const stageA = stageSortKey(a.stage_name);
    const stageB = stageSortKey(b.stage_name);
    if (stageA !== stageB) return stageA - stageB;
    const gradeA = gradeSortKey(a.grade_name);
    const gradeB = gradeSortKey(b.grade_name);
    if (gradeA !== gradeB) return gradeA - gradeB;
    const groupA = a.group_name ?? '';
    const groupB = b.group_name ?? '';
    if (groupA !== groupB) return groupA.localeCompare(groupB, 'ar');
    return (a.name ?? '').localeCompare(b.name ?? '', 'ar');
  });
}

// ============ HTML Report Builder ============

// Group section for structuring rows by stage/grade/group with headings
type GroupSection = {
  label: string;
  sublabel?: string;
  rows: PDFRow[];
};

function buildReportHTML(
  meta: PDFReportMeta,
  columns: PDFColumn[],
  rows: PDFRow[],
  totalsRow?: PDFRow | null,
  summaryCards?: { label: string; value: string }[],
  groupSections?: GroupSection[]
): string {
  const genDate = meta.generatedAt ?? new Date();
  const orientation = meta.orientation ?? 'portrait';
  const paperSize = meta.paperSize ?? 'A4';
  const pageSize = paperSize === 'A3' ? 'A3' : 'A4';
  const pageMargin = orientation === 'landscape' ? '8mm 10mm 12mm 10mm' : '8mm 8mm 8mm 8mm';

  const metaParts: string[] = [];
  if (meta.stageName) metaParts.push(`المرحلة: ${escapeHtml(meta.stageName)}`);
  if (meta.gradeName) metaParts.push(`الصف: ${escapeHtml(meta.gradeName)}`);
  if (meta.groupName) metaParts.push(`المجموعة: ${escapeHtml(meta.groupName)}`);
  if (meta.monthLabel) metaParts.push(`الشهر: ${escapeHtml(meta.monthLabel)}`);
  if (meta.dateRange) metaParts.push(`الفترة: ${escapeHtml(meta.dateRange.from)} ← ${escapeHtml(meta.dateRange.to)}`);
  const metaLine = metaParts.join('  •  ');

  const totalColCount = columns.length;

  // Dynamic row sizing: calculate optimal font size and row height based on row count
  const rowCount = rows.length;
  let fontSize: string;
  let cellPadding: string;
  let lineHeight: string;

  if (orientation === 'landscape') {
    if (rowCount > 80) { fontSize = '12px'; cellPadding = '4px 6px'; lineHeight = '1.4'; }
    else if (rowCount > 50) { fontSize = '12.5px'; cellPadding = '5px 7px'; lineHeight = '1.45'; }
    else if (rowCount > 30) { fontSize = '13px'; cellPadding = '5px 8px'; lineHeight = '1.5'; }
    else { fontSize = '13.5px'; cellPadding = '6px 9px'; lineHeight = '1.5'; }
  } else {
    if (rowCount > 60) { fontSize = '12px'; cellPadding = '4px 6px'; lineHeight = '1.4'; }
    else if (rowCount > 40) { fontSize = '12.5px'; cellPadding = '5px 7px'; lineHeight = '1.45'; }
    else if (rowCount > 25) { fontSize = '13px'; cellPadding = '6px 8px'; lineHeight = '1.5'; }
    else { fontSize = '14px'; cellPadding = '7px 9px'; lineHeight = '1.55'; }
  }

  const headerFontSize = orientation === 'landscape'
    ? (rowCount > 60 ? '11px' : rowCount > 30 ? '11.5px' : '12px')
    : (rowCount > 50 ? '11px' : rowCount > 25 ? '12px' : '12.5px');

  const headerCells = columns
    .map((col) => {
      const align = col.align ?? 'right';
      const width = col.width ? `width:${col.width};` : '';
      return `<th style="${width}text-align:${align};">${escapeHtml(col.label)}</th>`;
    })
    .join('');

  function buildRowHTML(row: PDFRow, i: number): string {
    const bg = i % 2 === 1 ? `background:${ZEBRA};` : '';
    const cells = columns
      .map((col) => {
        const val = row[col.key];
        const align = col.align ?? 'right';
        const isNameCol = col.key === 'name';
        const nowrap = isNameCol
          ? 'word-wrap:break-word;overflow-wrap:break-word;'
          : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        const cls = col.key === 'status'
          ? (String(val ?? '').includes('مسدد') && !String(val ?? '').includes('غير') ? ' class="badge-paid"' : String(val ?? '').includes('غير') || String(val ?? '').includes('لم') ? ' class="badge-unpaid"' : String(val ?? '').includes('جزئي') ? ' class="badge-partial"' : String(val ?? '').includes('معفى') ? ' class="badge-exempt"' : '')
          : col.key === 'result'
          ? (String(val ?? '') === 'ناجح' ? ' class="badge-paid"' : String(val ?? '') === 'راسب' ? ' class="badge-unpaid"' : '')
          : '';
        return `<td style="text-align:${align};${nowrap}"${cls}>${escapeHtml(val ?? '')}</td>`;
      })
      .join('');
    return `<tr style="${bg}">${cells}</tr>`;
  }

  // If groupSections provided, render structured sections with headings;
  // otherwise fall back to flat table.
  let tableBodyHTML: string;

  if (groupSections && groupSections.length > 0) {
    tableBodyHTML = '';
    let globalIdx = 0;
    for (const section of groupSections) {
      // Group heading row — spans all columns, keep with next row
      const sublabelHTML = section.sublabel ? ` <span style="font-weight:400;color:${TEXT_MUTED};font-size:${headerFontSize};">— ${escapeHtml(section.sublabel)}</span>` : '';
      tableBodyHTML += `<tr class="group-heading"><td colspan="${totalColCount}">${escapeHtml(section.label)}${sublabelHTML} <span style="float:left;font-weight:500;font-size:${headerFontSize};">(${section.rows.length} طالب)</span></td></tr>`;
      for (const row of section.rows) {
        tableBodyHTML += buildRowHTML(row, globalIdx);
        globalIdx++;
      }
    }
  } else {
    tableBodyHTML = rows.map((row, i) => buildRowHTML(row, i)).join('');
  }

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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page {
    size: ${pageSize} ${orientation};
    margin: ${pageMargin};
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
    line-height: ${lineHeight};
    font-size: ${fontSize};
  }

  .report-header {
    border-bottom: 2px solid ${GOLD};
    padding-bottom: 8px;
    margin-bottom: 10px;
  }

  .header-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 5px;
  }

  .header-brand {
    font-size: 18px;
    font-weight: 800;
    color: ${NAVY};
    letter-spacing: 0.2px;
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
    line-height: 1.5;
  }

  .header-gen-date strong {
    color: ${NAVY};
  }

  .report-title {
    font-size: 16px;
    font-weight: 800;
    color: ${NAVY};
    padding: 4px 12px;
    background: ${GOLD_LIGHT};
    border-right: 3px solid ${GOLD};
    border-radius: 3px;
    display: inline-block;
  }

  .report-meta {
    font-size: 11px;
    color: ${TEXT_MUTED};
    margin-top: 4px;
  }

  .summary-box {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }

  .summary-card {
    flex: 1;
    min-width: 90px;
    border: 1px solid ${BORDER};
    border-top: 2px solid ${GOLD};
    border-radius: 4px;
    padding: 6px 10px;
    background: #FAFBFD;
  }

  .summary-card .label {
    font-size: 10px;
    color: ${TEXT_MUTED};
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .summary-card .value {
    font-size: 17px;
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
    background: #F8FAFC;
    color: ${NAVY};
    font-weight: 700;
    font-size: ${headerFontSize};
    padding: ${cellPadding};
    border-bottom: 2px solid ${GOLD};
    border-top: 1px solid ${BORDER};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  tbody td {
    padding: ${cellPadding};
    font-size: ${fontSize};
    border-bottom: 1px solid ${BORDER};
    vertical-align: middle;
  }

  tbody tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .group-heading td {
    background: #F0F4FF;
    color: ${NAVY};
    font-weight: 700;
    font-size: ${headerFontSize};
    padding: 5px 8px;
    border-bottom: 2px solid ${GOLD};
    border-top: 1px solid #C7D2FE;
    page-break-after: avoid;
    break-after: avoid;
  }

  .group-heading td span {
    color: ${TEXT_MUTED};
  }

  .totals-row td {
    background: #FFFBEB;
    font-weight: 800;
    font-size: ${headerFontSize};
    border-top: 2px solid ${GOLD};
    border-bottom: 1px solid ${GOLD};
    color: ${NAVY};
    padding: 6px 8px;
  }

  .badge-paid { color: ${GREEN}; font-weight: 700; }
  .badge-unpaid { color: ${RED}; font-weight: 700; }
  .badge-partial { color: ${AMBER}; font-weight: 700; }
  .badge-exempt { color: ${BLUE}; font-weight: 700; }

  .report-footer {
    margin-top: 12px;
    border-top: 1px solid ${BORDER};
    padding-top: 4px;
    font-size: 9px;
    color: ${TEXT_MUTED};
    text-align: center;
  }

  @media print {
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
  <tbody>${tableBodyHTML}${emptyHtml}${totalsHtml}</tbody>
</table>

<div class="report-footer">
  ${PLATFORM_NAME} — تم إنشاء هذا التقرير آلياً — ${escapeHtml(formatDate(genDate))}
</div>

</body>
</html>`;
}

// Build group sections from sorted enriched students for structured PDF rendering
function buildGroupSections<T extends EnrichedStudent>(
  sorted: T[],
  rowMapper: (s: T, idx: number) => PDFRow
): GroupSection[] {
  const sections: GroupSection[] = [];
  let currentKey = '';
  let currentSection: GroupSection | null = null;

  for (const s of sorted) {
    const stage = s.stage_name ?? 'غير محدد';
    const grade = s.grade_name ?? '—';
    const group = s.group_name ?? '—';
    const key = `${stage}|${grade}|${group}`;

    if (key !== currentKey) {
      currentKey = key;
      currentSection = {
        label: `${stage} — ${grade}`,
        sublabel: group,
        rows: [],
      };
      sections.push(currentSection);
    }

    currentSection!.rows.push(rowMapper(s, currentSection!.rows.length));
  }

  return sections;
}

export async function generatePDF(
  meta: PDFReportMeta,
  columns: PDFColumn[],
  rows: PDFRow[],
  totalsRow?: PDFRow | null,
  summaryCards?: { label: string; value: string }[],
  groupSections?: GroupSection[]
): Promise<boolean> {
  if (generating) return false;
  generating = true;

  let iframe: HTMLIFrameElement | null = null;

  try {
    const html = buildReportHTML(meta, columns, rows, totalsRow, summaryCards, groupSections);
    iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '0';
    const orientation = meta.orientation ?? 'portrait';
    // Use the actual print content width (page width minus side margins)
    // so no re-flow happens when the browser paginates during print.
    // Portrait: 210mm - 16mm = 194mm ≈ 733px; Landscape: 297mm - 20mm = 277mm ≈ 1046px
    iframe.style.width = orientation === 'landscape' ? '1046px' : '733px';
    iframe.style.height = '2000px';
    iframe.style.border = 'none';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      console.error('[PDF Export] No contentDocument');
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();

    // Wait for the iframe's fonts and content to fully load before printing.
    // The inline script's window.print() may not fire reliably in zero-size
    // iframes, so we also call print() explicitly from the parent.
    const cw = iframe.contentWindow;
    if (!cw) {
      console.error('[PDF Export] No contentWindow');
      return false;
    }

    // Wait for fonts to be ready (both parent and iframe document)
    await Promise.race([
      Promise.all([
        cw.document.fonts?.ready ?? Promise.resolve(),
        document.fonts?.ready ?? Promise.resolve(),
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);

    // Give the layout engine a final tick to settle pagination
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const cleanup = () => {
      setTimeout(() => {
        if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
      }, 2000);
    };

    cw.focus();
    cw.onafterprint = () => {
      cleanup();
      generating = false;
    };

    // Safety fallback: cleanup after 30s if onafterprint never fires
    setTimeout(() => {
      cleanup();
      generating = false;
    }, 30_000);

    // Actually call print — this is what was missing
    cw.print();

    return true;
  } catch (err) {
    console.error('[PDF Export] Error:', err);
    if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
    generating = false;
    return false;
  }
}

// ============ Report Builders ============

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

// Shared column set for student financial reports (paid + unpaid use same layout)
const FINANCIAL_COLUMNS: PDFColumn[] = [
  { key: 'idx', label: '#', width: '4%', align: 'center' },
  { key: 'name', label: 'اسم الطالب', width: '28%' },
  { key: 'stage', label: 'المرحلة', width: '10%' },
  { key: 'grade', label: 'الصف', width: '9%' },
  { key: 'group', label: 'المجموعة', width: '14%' },
  { key: 'paid', label: 'المدفوع', width: '10%', align: 'center' },
  { key: 'remaining', label: 'المتبقي', width: '10%', align: 'center' },
  { key: 'status', label: 'الحالة', width: '15%', align: 'center' },
];

export async function exportPaidStudentsPDF(
  students: EnrichedStudent[],
  monthlyPaidMap: Map<string, number>,
  monthExemptMap: Map<string, true>,
  meta: PDFReportMeta
): Promise<boolean> {
  const filtered = students.filter((s) => {
    if (monthExemptMap.has(s.id)) return false;
    const paid = safeNum(monthlyPaidMap.get(s.id));
    return safeNum(s.total_fees) > 0 && paid >= safeNum(s.total_fees);
  });

  const sorted = sortStudentsForReport(filtered);

  const sections = buildGroupSections(sorted, (s, i) => {
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

  const rows: PDFRow[] = sections.flatMap((sec) => sec.rows);

  const totalPaid = sorted.reduce((sum, s) => sum + safeNum(monthlyPaidMap.get(s.id)), 0);
  const totalRemaining = sorted.reduce((sum, s) => sum + Math.max(0, safeNum(s.total_fees) - safeNum(monthlyPaidMap.get(s.id))), 0);
  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${sorted.length} طالب)`,
    stage: '', grade: '', group: '',
    paid: formatCurrency(totalPaid),
    remaining: formatCurrency(totalRemaining),
    status: '',
  };

  const title = meta.monthLabel
    ? `تقرير الطلاب المسددين لشهر ${meta.monthLabel}`
    : 'كشف الطلاب المسددين بالكامل';

  const summaryCards = [
    { label: 'عدد الطلاب', value: String(sorted.length) },
    { label: 'إجمالي المحصل', value: `${formatCurrency(totalPaid)} ج.م` },
    { label: 'إجمالي المتبقي', value: `${formatCurrency(totalRemaining)} ج.م` },
  ];

  return generatePDF(
    { ...meta, title, subtitle: `عدد الطلاب: ${sorted.length}`, fileName: meta.fileName ?? 'الطلاب_المسددون' },
    FINANCIAL_COLUMNS, rows, totalsRow, summaryCards, sections
  );
}

export async function exportUnpaidStudentsPDF(
  students: EnrichedStudent[],
  monthlyPaidMap: Map<string, number>,
  monthExemptMap: Map<string, true>,
  meta: PDFReportMeta
): Promise<boolean> {
  const filtered = students.filter((s) => {
    if (monthExemptMap.has(s.id)) return false;
    const paid = safeNum(monthlyPaidMap.get(s.id));
    const remaining = safeNum(s.total_fees) - paid;
    return safeNum(s.total_fees) > 0 && remaining > 0;
  });

  const sorted = sortStudentsForReport(filtered);

  const sections = buildGroupSections(sorted, (s, i) => {
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

  const rows: PDFRow[] = sections.flatMap((sec) => sec.rows);

  const totalPaid = sorted.reduce((sum, s) => sum + safeNum(monthlyPaidMap.get(s.id)), 0);
  const totalRemaining = sorted.reduce((sum, s) => sum + Math.max(0, safeNum(s.total_fees) - safeNum(monthlyPaidMap.get(s.id))), 0);
  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${sorted.length} طالب)`,
    stage: '', grade: '', group: '',
    paid: formatCurrency(totalPaid),
    remaining: formatCurrency(totalRemaining),
    status: '',
  };

  const title = meta.monthLabel
    ? `تقرير الطلاب غير المسددين لشهر ${meta.monthLabel}`
    : 'كشف الطلاب غير المسددين';

  const summaryCards = [
    { label: 'عدد الطلاب', value: String(sorted.length) },
    { label: 'إجمالي المدفوع', value: `${formatCurrency(totalPaid)} ج.م` },
    { label: 'إجمالي المتبقي', value: `${formatCurrency(totalRemaining)} ج.م` },
  ];

  return generatePDF(
    { ...meta, title, subtitle: `عدد الطلاب: ${sorted.length}`, fileName: meta.fileName ?? 'الطلاب_غير_المسددين' },
    FINANCIAL_COLUMNS, rows, totalsRow, summaryCards, sections
  );
}

export async function exportMonthlyPaymentSummaryPDF(
  students: EnrichedStudent[],
  monthlyPaidMap: Map<string, number>,
  monthExemptMap: Map<string, true>,
  meta: PDFReportMeta
): Promise<boolean> {
  const sorted = sortStudentsForReport(students);

  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '4%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '28%' },
    { key: 'fees', label: 'المستحق', width: '10%', align: 'center' },
    { key: 'paid', label: 'المدفوع', width: '8%', align: 'center' },
    { key: 'remaining', label: 'المتبقي', width: '9%', align: 'center' },
    { key: 'status', label: 'الحالة', width: '8%', align: 'center' },
  ];

  const sections = buildGroupSections(sorted, (s, i) => {
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
      fees: isExempt ? 'معفى' : formatCurrency(fees),
      paid: formatCurrency(paid),
      remaining: isExempt ? '—' : formatCurrency(remaining),
      status: getStatusLabel(category),
    };
  });

  const rows: PDFRow[] = sections.flatMap((sec) => sec.rows);

  // Compute per-group, per-grade, per-stage, and overall totals
  function computeTotals(group: EnrichedStudent[]): { fees: number; paid: number; remaining: number } {
    let fees = 0, paid = 0, remaining = 0;
    for (const s of group) {
      if (monthExemptMap.has(s.id)) continue;
      const f = safeNum(s.total_fees);
      const p = safeNum(monthlyPaidMap.get(s.id));
      fees += f; paid += p; remaining += Math.max(0, f - p);
    }
    return { fees, paid, remaining };
  }

  // Build summary cards with hierarchical totals
  const overall = computeTotals(sorted);

  const summaryCards = [
    { label: 'إجمالي الطلاب', value: String(sorted.length) },
    { label: 'إجمالي المستحق', value: formatCurrency(overall.fees) },
    { label: 'إجمالي المحصل', value: formatCurrency(overall.paid) },
    { label: 'إجمالي المتبقي', value: formatCurrency(overall.remaining) },
  ];

  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي العام (${sorted.length} طالب)`,
    fees: formatCurrency(overall.fees), paid: formatCurrency(overall.paid),
    remaining: formatCurrency(overall.remaining), status: 'ج.م',
  };

  return generatePDF(
    { ...meta, title: 'ملخص المدفوعات الشهري', subtitle: `إجمالي الطلاب: ${sorted.length}` },
    columns, rows, totalsRow, summaryCards, sections
  );
}

export async function exportStudentListPDF(
  students: EnrichedStudent[],
  meta: PDFReportMeta
): Promise<boolean> {
  const sorted = sortStudentsForReport(students);

  const columns: PDFColumn[] = [
    { key: 'idx', label: '#', width: '4%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '30%' },
    { key: 'group', label: 'المجموعة', width: '14%' },
    { key: 'stage', label: 'المرحلة', width: '10%' },
    { key: 'grade', label: 'الصف', width: '9%' },
    { key: 'phone', label: 'هاتف الطالب', width: '16%', align: 'center' },
    { key: 'parent', label: 'هاتف ولي الأمر', width: '17%', align: 'center' },
  ];

  const sections = buildGroupSections(sorted, (s, i) => ({
    idx: i + 1, name: s.name,
    group: s.group_name ?? '—', stage: s.stage_name ?? '—',
    grade: s.grade_name ?? '—', phone: s.phone ?? '—', parent: s.parent_phone ?? '—',
  }));

  const rows: PDFRow[] = sections.flatMap((sec) => sec.rows);

  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${sorted.length} طالب)`,
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
    { ...meta, title: dynamicTitle, subtitle: `عدد الطلاب: ${sorted.length}` },
    columns, rows, totalsRow, undefined, sections
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

  const sorted = [...students].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ar'));

  const rows: PDFRow[] = sorted.map((s, i) => {
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
    { label: 'إجمالي الطلاب', value: String(sorted.length) },
    { label: 'الحاضرون', value: String(present) },
    { label: 'الغائبون', value: String(absent) },
    { label: 'المتأخرون', value: String(late) },
  ];

  const totalsRow: PDFRow = {
    idx: '', name: `الإجمالي (${sorted.length} طالب)`,
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

  const sorted = [...students].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ar'));

  const rows: PDFRow[] = sorted.map((s, i) => ({
    idx: i + 1, name: s.name,
    status: statusLabels[statuses[s.id]?.status] ?? 'غير مسجل',
    group: meta.groupName ?? '—',
    notes: '—',
  }));

  const complete = rows.filter((r) => r.status === 'اكتمل').length;
  const incomplete = rows.filter((r) => r.status === 'لم يكتمل').length;
  const late = rows.filter((r) => r.status === 'متأخر').length;

  const summaryCards = [
    { label: 'إجمالي الطلاب', value: String(sorted.length) },
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

  const sorted = [...students].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ar'));

  const rows: PDFRow[] = sorted.map((s, i) => {
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

// ============ SECRETARIAT REGISTER (كشف المدفوعات اليدوي) ============

export async function exportSecretariatRegisterPDF(
  students: EnrichedStudent[],
  meta: PDFReportMeta
): Promise<boolean> {
  if (generating) return false;
  generating = true;

  const sorted = sortStudentsForReport(students);

  const columns: PDFColumn[] = [
    { key: 'idx', label: 'م', width: '5%', align: 'center' },
    { key: 'name', label: 'اسم الطالب', width: '25%' },
    { key: 'monthDay', label: 'الشهر/اليوم', width: '14%', align: 'center' },
    { key: 'amount', label: 'المبلغ', width: '14%', align: 'center' },
    { key: 'received', label: 'المستلم', width: '14%', align: 'center' },
    { key: 'remaining', label: 'المتبقي', width: '14%', align: 'center' },
  ];

  // Build group sections with blank rows for handwriting
  const sections = buildGroupSections(sorted, (s, i) => ({
    idx: i + 1,
    name: s.name,
    monthDay: '',
    amount: '',
    received: '',
    remaining: '',
  }));

  const rows: PDFRow[] = sections.flatMap((sec) => sec.rows);

  const genDate = meta.generatedAt ?? new Date();
  const orientation = 'portrait';
  const pageSize = 'A4';
  const pageMargin = '8mm 8mm 8mm 8mm';

  // Larger row height for generous writing space
  const rowHeight = '38px';
  const fontSize = '14px';
  const headerFontSize = '12px';

  const headerCells = columns
    .map((col) => {
      const align = col.align ?? 'right';
      const width = col.width ? `width:${col.width};` : '';
      return `<th style="${width}text-align:${align};">${escapeHtml(col.label)}</th>`;
    })
    .join('');

  let tableBodyHTML = '';
  let globalIdx = 0;
  for (const section of sections) {
    const sublabelHTML = section.sublabel ? ` <span style="font-weight:400;color:${TEXT_MUTED};font-size:${headerFontSize};">— ${escapeHtml(section.sublabel)}</span>` : '';
    tableBodyHTML += `<tr class="group-heading"><td colspan="6">${escapeHtml(section.label)}${sublabelHTML}</td></tr>`;
    for (const row of section.rows) {
      const bg = globalIdx % 2 === 1 ? `background:${ZEBRA};` : '';
      const cells = columns
        .map((col) => {
          const val = row[col.key];
          const align = col.align ?? 'right';
          return `<td style="text-align:${align};height:${rowHeight};">${escapeHtml(val ?? '')}</td>`;
        })
        .join('');
      tableBodyHTML += `<tr style="${bg}">${cells}</tr>`;
      globalIdx++;
    }
  }

  const metaParts: string[] = [];
  if (meta.stageName) metaParts.push(`المرحلة: ${escapeHtml(meta.stageName)}`);
  if (meta.gradeName) metaParts.push(`الصف: ${escapeHtml(meta.gradeName)}`);
  if (meta.groupName) metaParts.push(`المجموعة: ${escapeHtml(meta.groupName)}`);
  if (meta.monthLabel) metaParts.push(`الشهر: ${escapeHtml(meta.monthLabel)}`);
  const metaLine = metaParts.join('  •  ');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>كشف المدفوعات</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 8mm 8mm 8mm 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { font-family: 'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif; color: ${TEXT_DARK}; background: #fff; line-height: 1.5; font-size: ${fontSize}; }
  .report-header { border-bottom: 2px solid ${GOLD}; padding-bottom: 8px; margin-bottom: 10px; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px; }
  .header-brand { font-size: 18px; font-weight: 800; color: ${NAVY}; }
  .header-brand-sub { font-size: 10px; color: ${TEXT_MUTED}; margin-top: 2px; }
  .header-gen-date { font-size: 10px; color: ${TEXT_MUTED}; text-align: left; }
  .report-title { font-size: 16px; font-weight: 800; color: ${NAVY}; padding: 4px 12px; background: ${GOLD_LIGHT}; border-right: 3px solid ${GOLD}; border-radius: 3px; display: inline-block; }
  .report-meta { font-size: 11px; color: ${TEXT_MUTED}; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  thead th { background: #F8FAFC; color: ${NAVY}; font-weight: 700; font-size: ${headerFontSize}; padding: 6px 8px; border-bottom: 2px solid ${GOLD}; border-top: 1px solid ${BORDER}; white-space: nowrap; }
  tbody td { padding: 4px 8px; font-size: ${fontSize}; border-bottom: 1px solid ${BORDER}; border-left: 1px solid ${BORDER}; vertical-align: middle; }
  tbody tr { page-break-inside: avoid; break-inside: avoid; }
  .group-heading td { background: #F0F4FF; color: ${NAVY}; font-weight: 700; font-size: ${headerFontSize}; padding: 5px 8px; border-bottom: 2px solid ${GOLD}; border-top: 1px solid #C7D2FE; page-break-after: avoid; break-after: avoid; }
  .report-footer { margin-top: 12px; border-top: 1px solid ${BORDER}; padding-top: 4px; font-size: 9px; color: ${TEXT_MUTED}; text-align: center; }
</style>
</head>
<body>
<div class="report-header">
  <div class="header-top">
    <div>
      <div class="header-brand">${PLATFORM_NAME}</div>
      <div class="header-brand-sub">كشف سجلات المدفوعات — للملء اليدوي</div>
    </div>
    <div class="header-gen-date">تاريخ الإصدار: <strong>${escapeHtml(formatDate(genDate))}</strong></div>
  </div>
  <div class="report-title">كشف المدفوعات</div>
  ${metaLine ? `<div class="report-meta">${metaLine}</div>` : ''}
</div>
<table>
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${tableBodyHTML}</tbody>
</table>
<div class="report-footer">${PLATFORM_NAME} — كشف سجلات للملء اليدوي — ${escapeHtml(formatDate(genDate))}</div>
</body>
</html>`;

  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '0';
    iframe.style.width = '733px';
    iframe.style.height = '2000px';
    iframe.style.border = 'none';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) { generating = false; return false; }
    doc.open();
    doc.write(html);
    doc.close();

    const cw = iframe.contentWindow;
    if (!cw) { generating = false; return false; }

    await Promise.race([
      Promise.all([
        cw.document.fonts?.ready ?? Promise.resolve(),
        document.fonts?.ready ?? Promise.resolve(),
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const cleanup = () => {
      setTimeout(() => { if (iframe?.parentNode) iframe.parentNode.removeChild(iframe); }, 2000);
    };

    cw.focus();
    cw.onafterprint = () => { cleanup(); generating = false; };
    setTimeout(() => { cleanup(); generating = false; }, 30_000);
    cw.print();
    return true;
  } catch (err) {
    console.error('[PDF Export] Secretariat register error:', err);
    if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
    generating = false;
    return false;
  }
}
