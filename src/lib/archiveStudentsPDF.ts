import { escapeHtml } from './pdfExport';

export type ArchiveListStudent = {
  id: string;
  name: string;
  phone?: string | null;
  parent_phone?: string | null;
  total_fees?: number | null;
  stage_name?: string;
  grade_name?: string;
  group_name?: string;
};

export type ArchiveListMeta = {
  monthLabel?: string;
  fileName?: string;
};

export type ArchiveListKind = 'paid' | 'unpaid';

const TITLES: Record<ArchiveListKind, string> = {
  paid: 'كشف الطلاب المسددين',
  unpaid: 'كشف الطلاب غير المسددين',
};

const PAGE_CONTENT_MM = 262;
const PAGE_TITLE_MM = 14;
const COLUMN_HEADER_MM = 8;
const GROUP_HEADING_MM = 9;
const ROW_MM = 8;

type GroupSection = { stage: string; grade: string; group: string; continued: boolean; firstNumber: number; students: ArchiveListStudent[] };
type PageLayout = { sections: GroupSection[]; used: number };

function safeNum(n: number | null | undefined): number {
  return n == null || !Number.isFinite(n) ? 0 : n;
}

function compareAr(a: string, b: string): number {
  return a.localeCompare(b, 'ar');
}

function buildPages(groups: GroupSection[]): PageLayout[] {
  const pages: PageLayout[] = [];
  const startPage = (): PageLayout => {
    const page: PageLayout = { sections: [], used: PAGE_TITLE_MM + COLUMN_HEADER_MM };
    pages.push(page);
    return page;
  };
  let page = startPage();

  for (const group of groups) {
    if (group.students.length === 0) continue;
    if (page.used + GROUP_HEADING_MM + ROW_MM > PAGE_CONTENT_MM && page.sections.length > 0) {
      page = startPage();
    }
    let section: GroupSection = { ...group, continued: false, firstNumber: 1, students: [] };
    page.sections.push(section);
    page.used += GROUP_HEADING_MM;

    group.students.forEach((student, index) => {
      if (page.used + ROW_MM > PAGE_CONTENT_MM) {
        page = startPage();
        section = { ...group, continued: true, firstNumber: index + 1, students: [] };
        page.sections.push(section);
        page.used += GROUP_HEADING_MM;
      }
      section.students.push(student);
      page.used += ROW_MM;
    });
  }
  return pages;
}

function renderPage(page: PageLayout, pageNumber: number, pageCount: number, title: string, meta: ArchiveListMeta): string {
  const bodyRows = page.sections
    .map((section) => {
      const heading = `<tr class="group-row"><td colspan="4"><span class="group-title">${[section.stage, section.grade, section.group].filter(Boolean).map(escapeHtml).join(' — ') || '—'}</span>${section.continued ? '<span class="continued">(تابع)</span>' : ''}</td></tr>`;
      const rows = section.students
        .map((student, index) => {
          const number = section.firstNumber + index;
          return `<tr><td class="num">${number}</td><td class="name">${escapeHtml(student.name)}</td><td>${escapeHtml(student.phone ?? '—')}</td><td>${escapeHtml(student.parent_phone ?? '—')}</td></tr>`;
        })
        .join('');
      return heading + rows;
    })
    .join('');

  return `<section class="page">
  <header class="page-title">
    <div class="title">${title}${meta.monthLabel ? ` لشهر ${escapeHtml(meta.monthLabel)}` : ''}</div>
    <div class="meta">صفحة ${pageNumber} من ${pageCount}</div>
  </header>
  <table>
    <colgroup><col style="width:12mm"><col style="width:76mm"><col style="width:48mm"><col style="width:50mm"></colgroup>
    <thead><tr><th class="num">#</th><th>اسم الطالب</th><th>هاتف الطالب</th><th>هاتف ولي الأمر</th></tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</section>`;
}

function buildDocument(pages: PageLayout[], title: string, meta: ArchiveListMeta): string {
  const body = pages.map((page, i) => renderPage(page, i + 1, pages.length, title, meta)).join('\n');
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.fileName ?? title)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #0F172A; font-family: Tahoma, 'Segoe UI', Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; height: 297mm; padding: 12mm 12mm 0; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page-title { height: ${PAGE_TITLE_MM}mm; display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5px solid #D4AF37; }
  .title { font-size: 14pt; font-weight: 700; }
  .meta { font-size: 9pt; color: #64748B; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 2mm; font-size: 10pt; }
  thead th { height: ${COLUMN_HEADER_MM}mm; background: #0F172A; color: #fff; font-weight: 700; text-align: right; padding: 0 3mm; }
  tbody tr { height: ${ROW_MM}mm; }
  tbody td { padding: 0 3mm; border-bottom: 0.5px solid #E2E8F0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
  tbody td.num, thead th.num { text-align: center; }
  tbody td.name { font-weight: 600; }
  tr.group-row td { height: ${GROUP_HEADING_MM}mm; background: #FDF8E8; border-bottom: 1px solid #D4AF37; border-top: 1px solid #D4AF37; font-weight: 700; color: #0F172A; }
  .group-title { font-size: 11pt; }
  .continued { color: #64748B; font-weight: 400; font-size: 9pt; margin-inline-start: 3mm; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function printHtml(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    const cw = iframe.contentWindow;
    cw?.focus();
    cw?.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 300);
}

function isListed(kind: ArchiveListKind, student: ArchiveListStudent, paidAmount: number): boolean {
  const fee = safeNum(student.total_fees);
  if (fee <= 0) return false;
  return kind === 'paid' ? paidAmount >= fee : paidAmount < fee;
}

export function exportArchiveStudentsPDF(
  kind: ArchiveListKind,
  students: ArchiveListStudent[],
  monthlyPaidMap: Map<string, number>,
  monthExemptMap: Set<string>,
  meta: ArchiveListMeta
): boolean {
  const listed = students.filter((s) => !monthExemptMap.has(s.id) && isListed(kind, s, safeNum(monthlyPaidMap.get(s.id))));

  const sorted = [...listed].sort(
    (a, b) =>
      compareAr(a.stage_name ?? '', b.stage_name ?? '') ||
      compareAr(a.grade_name ?? '', b.grade_name ?? '') ||
      compareAr(a.group_name ?? '', b.group_name ?? '') ||
      compareAr(a.name, b.name)
  );

  const groups: GroupSection[] = [];
  for (const student of sorted) {
    const stage = student.stage_name ?? '';
    const grade = student.grade_name ?? '';
    const group = student.group_name ?? '';
    const last = groups[groups.length - 1];
    if (last && last.stage === stage && last.grade === grade && last.group === group) {
      last.students.push(student);
    } else {
      groups.push({ stage, grade, group, continued: false, firstNumber: 1, students: [student] });
    }
  }

  if (groups.length === 0) return false;
  printHtml(buildDocument(buildPages(groups), TITLES[kind], meta));
  return true;
}
