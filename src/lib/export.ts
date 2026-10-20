/**
 * Export utilities: CSV (Excel-compatible) download and print-to-PDF.
 */

export function exportToCSV(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const escape = (val: string | number) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n');
  // Prepend BOM so Excel detects UTF-8 Arabic correctly
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function printDocument(title: string, bodyHTML: string): void {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { font-family: 'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif; box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: A4; margin: 12mm 10mm 16mm 10mm; }
    body { padding: 20px; color: #0F172A; background: #fff; font-size: 13px; line-height: 1.5; }
    h1 { font-size: 20px; text-align: center; margin-bottom: 4px; color: #0F172A; font-weight: 800; }
    .subtitle { text-align: center; font-size: 13px; color: #64748B; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; table-layout: fixed; }
    thead { display: table-header-group; }
    th, td { border: 1px solid #E2E8F0; padding: 8px 10px; text-align: right; font-size: 12px; }
    th { background: #F8FAFC; font-weight: 700; color: #0F172A; border-bottom: 2px solid #D4AF37; }
    tbody tr { page-break-inside: avoid; break-inside: avoid; }
    tbody tr:nth-child(even) { background: #F8FAFC; }
    .badge-paid { color: #15803D; font-weight: 700; }
    .badge-due { color: #B91C1C; font-weight: 700; }
    .footer { margin-top: 24px; text-align: center; font-size: 11px; color: #94A3B8; border-top: 1px solid #E2E8F0; padding-top: 8px; }
    .blank-cell { height: 32px; }
    @media print { body { padding: 0; } .no-print { display: none; } }
  </style></head><body>${bodyHTML}
  <div class="footer">منصة الخالد التعليمية — ${new Date().toLocaleDateString('ar-EG')}</div>
  <script>window.onload = function() { window.print(); }</script>
  </body></html>`);
  win.document.close();
}

export function buildAttendancePrintHTML(
  groupName: string,
  stageName: string,
  gradeName: string,
  date: string,
  students: { name: string }[],
  blank: boolean
): string {
  const headers = blank
    ? ['#', 'اسم الطالب', 'الحضور', 'الغياب', 'التأخير', 'ملاحظات']
    : ['#', 'اسم الطالب', 'الحالة', 'الوقت', 'ملاحظات'];
  const headerRow = headers.map((h) => `<th>${h}</th>`).join('');
  const bodyRows = students
    .map(
      (s, i) =>
        `<tr><td>${i + 1}</td><td>${s.name}</td>${
          blank
            ? '<td class="blank-cell"></td><td class="blank-cell"></td><td class="blank-cell"></td><td></td>'
            : '<td></td><td></td><td></td>'
        }</tr>`
    )
    .join('');
  return `
    <h1>${blank ? 'كشف حضور فارغ' : 'سجل الحضور'}</h1>
    <div class="subtitle">${stageName ?? ''} ${gradeName ? '— ' + gradeName : ''} ${groupName ? '— ' + groupName : ''} | ${date}</div>
    <table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>
  `;
}

export function buildUnpaidPrintHTML(
  students: { name: string; group_name?: string; group_schedule?: string | null; grade_name?: string; stage_name?: string; total_fees: number; paid_fees: number }[]
): string {
  const remaining = (s: { total_fees: number; paid_fees: number }) =>
    (s.total_fees ?? 0) - (s.paid_fees ?? 0);
  const bodyRows = students
    .map(
      (s, i) =>
        `<tr><td>${i + 1}</td><td>${s.name}</td><td>${s.group_name ?? '-'}</td><td>${s.group_schedule ?? '-'}</td><td>${s.stage_name ?? ''} ${s.grade_name ?? ''}</td><td>${remaining(s)}</td></tr>`
    )
    .join('');
  return `
    <h1>كشف الطلاب غير المسددين</h1>
    <div class="subtitle">إجمالي الطلاب غير المسددين: ${students.length} طالب</div>
    <table><thead><tr><th>#</th><th>اسم الطالب</th><th>المجموعة</th><th>الموعد</th><th>المرحلة</th><th>المتبقي (ج.م)</th></tr></thead><tbody>${bodyRows}</tbody></table>
  `;
}

export async function exportTableAsImage(filename: string, title: string, bodyHTML: string): Promise<void> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '800px';
  container.style.padding = '24px';
  container.style.background = '#ffffff';
  container.style.fontFamily = "'Segoe UI', Tahoma, Arial, sans-serif";
  container.style.direction = 'rtl';
  container.innerHTML = `<div style="text-align:center;margin-bottom:16px;"><h1 style="font-size:20px;color:#1a1a1a;margin:0;">${title}</h1></div><style>table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ccc;padding:8px 10px;text-align:right;font-size:13px;color:#1a1a1a;}th{background:#f0f4f0;font-weight:700;}tr:nth-child(even){background:#fafafa;}.present{color:#16a34a;font-weight:700;}.absent{color:#dc2626;font-weight:700;}.unrecorded{color:#999;}</style>${bodyHTML}`;
  document.body.appendChild(container);
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${container.offsetHeight}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:800px;padding:24px;background:#fff;font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;">${container.innerHTML}</div></foreignObject></svg>`;
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = container.offsetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(svgUrl);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(svgUrl); alert('تعذر تصدير الصورة. حاول استخدام ملف PDF بدلاً من ذلك.'); };
    img.src = svgUrl;
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Render an HTML receipt as a downloadable PNG image using canvas.
 * Returns a data URL (also triggers download if filename is provided).
 */
export async function renderReceiptAsImage(
  receiptHTML: string,
  filename?: string
): Promise<string | null> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '520px';
  container.style.background = '#ffffff';
  container.style.fontFamily = "'Segoe UI', Tahoma, Arial, sans-serif";
  container.style.direction = 'rtl';
  container.innerHTML = receiptHTML;
  document.body.appendChild(container);

  try {
    const height = Math.max(container.offsetHeight + 40, 200);
    const canvas = document.createElement('canvas');
    canvas.width = 520;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:520px;font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;background:#fff;">${container.innerHTML}</div></foreignObject></svg>`;
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    return await new Promise<string | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timeout = setTimeout(() => { URL.revokeObjectURL(svgUrl); resolve(null); }, 10000);
      img.onload = () => {
        clearTimeout(timeout);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(svgUrl);
        if (filename) {
          canvas.toBlob((blob) => {
            if (!blob) { resolve(null); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 'image/png');
        }
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { clearTimeout(timeout); URL.revokeObjectURL(svgUrl); resolve(null); };
      img.src = svgUrl;
    });
  } finally {
    document.body.removeChild(container);
  }
}

type AttendanceDayRecord = { date: string; status: string };

export function buildMonthlyAttendanceHTML(
  groupName: string, stageName: string, gradeName: string, monthLabel: string,
  students: { id: string; name: string }[],
  recordsByStudent: Record<string, AttendanceDayRecord[]>,
  consecutiveAbsenceThreshold = 3
): string {
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const parts = monthLabel.split(' ');
  const monthIdx = months.indexOf(parts[0]);
  const year = parseInt(parts[1] ?? String(new Date().getFullYear()));
  const daysInMonth = monthIdx >= 0 ? new Date(year, monthIdx + 1, 0).getDate() : 30;
  const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => `<th>${i + 1}</th>`).join('');

  function getConsecutiveAbsences(records: AttendanceDayRecord[]): number {
    let max = 0, current = 0;
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    for (const r of sorted) { if (r.status === 'absent') { current++; max = Math.max(max, current); } else { current = 0; } }
    return max;
  }

  const rows = students.map((s) => {
    const records = recordsByStudent[s.id] ?? [];
    const recordMap: Record<number, string> = {};
    for (const r of records) { const day = parseInt(r.date.split('-')[2] ?? '0'); if (day > 0) recordMap[day] = r.status; }
    const consecutive = getConsecutiveAbsences(records);
    const warnIcon = consecutive >= consecutiveAbsenceThreshold ? ' ⚠️' : '';
    const cells = Array.from({ length: daysInMonth }, (_, i) => {
      const status = recordMap[i + 1];
      const symbol = status === 'present' ? '<span class="present">✓</span>' : status === 'absent' ? '<span class="absent">✗</span>' : status === 'late' ? '<span style="color:#f59e0b;font-weight:700;">ت</span>' : status === 'excused_absence' ? '<span style="color:#3b82f6;font-weight:700;">ع</span>' : '<span class="unrecorded">—</span>';
      return `<td style="text-align:center;">${symbol}</td>`;
    }).join('');
    return `<tr><td>${s.name}${warnIcon}</td>${cells}</tr>`;
  }).join('');

  return `<h1>تقرير الحضور الشهري — ${groupName}</h1><div class="subtitle">${stageName} ${gradeName} — ${monthLabel}</div><div class="subtitle" style="font-size:11px;color:#666;">✓ حاضر &nbsp; ✗ غائب &nbsp; ت تأخير &nbsp; ع غياب بعذر &nbsp; — غير مسجل &nbsp; ⚠️ إنذار غياب متتالي</div><table style="font-size:10px;"><thead><tr><th>اسم الطالب</th>${dayHeaders}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function buildReceiptHTML(opts: {
  receiptNumber: string;
  studentName: string;
  amount: number;
  month?: string;
  date: string;
  groupName?: string;
  gradeName?: string;
  stageName?: string;
  note?: string | null;
  recordedBy?: string | null;
  platformName?: string;
  managementName?: string;
  baseSubscription?: number;
  discountAmount?: number;
}): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  const platformName = opts.platformName ?? 'منصة الخالد التعليمية';
  const managementName = opts.managementName ?? 'إدارة مستر عمرو خالد';
  const dateStr = new Date(opts.date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  const baseSubRow = opts.baseSubscription && opts.baseSubscription > 0
    ? `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;font-weight:600;">الاشتراك الأساسي</td><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;font-weight:600;">${fmt(opts.baseSubscription)} ج.م</td></tr>`
    : '';
  const discountRow = opts.discountAmount && opts.discountAmount > 0
    ? `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;font-weight:600;">خصم مسجل</td><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#dc2626;font-weight:600;">-${fmt(opts.discountAmount)} ج.م</td></tr>`
    : '';
  return `
    <div style="max-width:480px;margin:0 auto;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
      <div style="background:linear-gradient(135deg,#0f5132 0%,#198754 50%,#20c997 100%);border-radius:16px 16px 0 0;padding:28px 24px;text-align:center;color:#fff;position:relative;overflow:hidden;">
        <div style="position:absolute;top:-20px;right:-20px;width:80px;height:80px;background:rgba(255,255,255,0.06);border-radius:50%;"></div>
        <div style="position:absolute;bottom:-30px;left:-10px;width:60px;height:60px;background:rgba(255,255,255,0.04);border-radius:50%;"></div>
        <div style="position:relative;">
          <div style="width:52px;height:52px;background:rgba(255,255,255,0.15);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;border:1px solid rgba(255,255,255,0.2);">
            <span style="font-size:24px;">🎓</span>
          </div>
          <h1 style="font-size:20px;margin:0;font-weight:800;letter-spacing:0.5px;">${platformName}</h1>
          <p style="font-size:11px;margin:4px 0 0;opacity:0.8;letter-spacing:0.3px;">${managementName}</p>
          <div style="margin-top:14px;display:inline-block;padding:5px 18px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">PAYMENT RECEIPT • إيصال دفع</div>
        </div>
      </div>

      <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 16px 16px;overflow:hidden;">
        <div style="background:#f8f9fa;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #198754;">
          <div>
            <p style="font-size:10px;color:#999;margin:0;text-transform:uppercase;letter-spacing:0.5px;">Receipt No.</p>
            <p style="font-size:15px;font-weight:800;color:#1a1a1a;margin:2px 0 0;font-family:'Courier New',monospace;" dir="ltr">${opts.receiptNumber}</p>
          </div>
          <div style="text-align:left;">
            <p style="font-size:10px;color:#999;margin:0;text-transform:uppercase;letter-spacing:0.5px;">Date</p>
            <p style="font-size:13px;font-weight:700;color:#1a1a1a;margin:2px 0 0;">${dateStr}</p>
          </div>
        </div>

        <div style="padding:8px 24px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;font-weight:600;width:35%;">اسم الطالب</td>
              <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;font-weight:700;">${opts.studentName}</td>
            </tr>
            ${opts.groupName ? `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;font-weight:600;">المجموعة</td><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;font-weight:600;">${opts.groupName}</td></tr>` : ''}
            ${(opts.gradeName || opts.stageName) ? `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;font-weight:600;">الصف الدراسي</td><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;font-weight:600;">${[opts.stageName, opts.gradeName].filter(Boolean).join(' - ')}</td></tr>` : ''}
            ${opts.month ? `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;font-weight:600;">الشهر / السكند</td><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#1a1a1a;font-weight:600;">${opts.month}</td></tr>` : ''}
            ${baseSubRow}
            ${discountRow}
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;font-weight:600;">التاريخ</td>
              <td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#1a1a1a;">${dateStr} • ${timeStr}</td>
            </tr>
            ${opts.note ? `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;font-weight:600;">ملاحظة</td><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;">${opts.note}</td></tr>` : ''}
            ${opts.recordedBy ? `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;font-weight:600;">استلم بواسطة</td><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#555;">${opts.recordedBy}</td></tr>` : ''}
          </table>
        </div>

        <div style="margin:0 24px 16px;background:linear-gradient(135deg,#f0f4f0 0%,#e8f5e9 100%);border-radius:12px;padding:20px;text-align:center;border:1px solid #c8e6c9;">
          <p style="font-size:11px;color:#666;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;">المبلغ المدفوع • Amount Paid</p>
          <p style="font-size:32px;font-weight:900;color:#198754;margin:0;letter-spacing:-0.5px;">${fmt(opts.amount)} <span style="font-size:16px;font-weight:600;">ج.م</span></p>
          <div style="width:50px;height:3px;background:#198754;margin:10px auto 0;border-radius:2px;"></div>
        </div>

        <div style="padding:16px 24px;border-top:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:flex-end;">
          <div style="text-align:center;">
            <div style="width:80px;border-top:1px dashed #bbb;padding-top:6px;margin-bottom:4px;"></div>
            <span style="font-size:10px;color:#999;">استلام المدرس</span>
          </div>
          <div style="text-align:center;font-size:9px;color:#bbb;">
            <p style="margin:0;">هذا الإيصال صادر آلياً من</p>
            <p style="margin:1px 0 0;font-weight:600;color:#999;">${platformName}</p>
          </div>
          <div style="text-align:center;">
            <div style="width:80px;border-top:1px dashed #bbb;padding-top:6px;margin-bottom:4px;"></div>
            <span style="font-size:10px;color:#999;">توقيع ولي الأمر</span>
          </div>
        </div>
      </div>
    </div>
  `;
}
