import type { OnlineExam, ExamQuestion, ExamSection } from '@/lib/types';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildExamHTML(exam: OnlineExam, questions: ExamQuestion[], sections: ExamSection[], answerKey = false): string {
  const sorted = [...questions].sort((a, b) => a.sort_order - b.sort_order);
  const totalMarks = sorted.reduce((s, q) => s + (q.points ?? 0), 0);

  const sectionMap = new Map<string | null, ExamQuestion[]>();
  for (const q of sorted) {
    const key = q.section_id ?? null;
    if (!sectionMap.has(key)) sectionMap.set(key, []);
    sectionMap.get(key)!.push(q);
  }

  const letters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

  function renderQuestion(q: ExamQuestion, num: number): string {
    let html = `<div style="margin-bottom:16px;">
      <div style="display:flex;gap:8px;">
        <span style="font-weight:bold;flex-shrink:0;">${num}.</span>
        <div style="flex:1;">
          <span style="font-weight:600;">${escapeHtml(q.question_text)}</span>
          <span style="font-size:12px;color:#666;margin-right:6px;">(${q.points} درجة)</span>
        </div>
      </div>`;

    if (q.type === 'mcq' && q.choices) {
      html += '<ul style="margin-right:24px;margin-top:6px;list-style:none;padding:0;">';
      q.choices.forEach((c, i) => {
        const isCorrect = answerKey && i === q.correct_choice_index;
        html += `<li style="margin-bottom:4px;display:flex;align-items:center;gap:6px;">
          <span style="width:20px;height:20px;border:1px solid #999;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;">${letters[i] ?? i}</span>
          <span>${escapeHtml(c)}</span>
          ${isCorrect ? '<span style="color:#16a34a;font-weight:bold;font-size:12px;">✓ الإجابة الصحيحة</span>' : ''}
        </li>`;
      });
      html += '</ul>';
    }

    if (q.type === 'true_false') {
      html += `<div style="margin-right:24px;margin-top:4px;">
        <span>صح ( )</span> <span style="margin-right:16px;">خطأ ( )</span>
        ${answerKey && q.correct_choice_index !== null ? `<span style="color:#16a34a;font-weight:bold;font-size:12px;margin-right:8px;">الإجابة: ${q.correct_choice_index === 0 ? 'صح' : 'خطأ'}</span>` : ''}
      </div>`;
    }

    if (q.type === 'fill_blank') {
      html += `<div style="margin-right:24px;margin-top:4px;">${answerKey
        ? `<span style="color:#16a34a;font-weight:bold;font-size:12px;">الإجابة: ${escapeHtml(q.model_answer ?? '—')}</span>`
        : '<div style="height:24px;border-bottom:2px dotted #999;width:200px;"></div>'}</div>`;
    }

    if (q.type === 'short_answer') {
      html += `<div style="margin-right:24px;margin-top:4px;">${answerKey
        ? `<span style="color:#16a34a;font-weight:bold;font-size:12px;">الإجابة: ${escapeHtml(q.model_answer ?? 'تُصحّ يدوياً')}</span>`
        : '<div style="height:32px;border-bottom:1px solid #999;width:300px;"></div>'}</div>`;
    }

    if (q.type === 'essay') {
      html += `<div style="margin-right:24px;margin-top:4px;">${answerKey
        ? `<span style="color:#16a34a;font-weight:bold;font-size:12px;">الإجابة النموذجية: ${escapeHtml(q.model_answer ?? 'تُصحّ يدوياً')}</span>`
        : '<div style="height:64px;border:1px solid #ddd;border-radius:4px;"></div>'}</div>`;
    }

    html += '</div>';
    return html;
  }

  let questionsHTML = '';
  if (sections.length > 0) {
    let qNum = 0;
    for (const sec of sections) {
      const secQs = sectionMap.get(sec.id) ?? [];
      if (secQs.length === 0) continue;
      questionsHTML += `<div style="margin-bottom:20px;">
        <h2 style="font-size:16px;font-weight:bold;border-bottom:1px solid #ccc;padding-bottom:4px;">${escapeHtml(sec.title)}</h2>
        ${sec.instructions ? `<p style="font-size:12px;color:#666;margin-bottom:8px;">${escapeHtml(sec.instructions)}</p>` : ''}`;
      secQs.forEach((q) => { qNum++; questionsHTML += renderQuestion(q, qNum); });
      questionsHTML += '</div>';
    }
    const unsectioned = sectionMap.get(null) ?? [];
    unsectioned.forEach((q) => { qNum++; questionsHTML += renderQuestion(q, qNum); });
  } else {
    sorted.forEach((q, i) => { questionsHTML += renderQuestion(q, i + 1); });
  }

  return `
    <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #333;">
      ${exam.country ? `<p style="font-size:12px;color:#666;">${escapeHtml(exam.country)}</p>` : ''}
      <h1 style="font-size:22px;font-weight:bold;margin:4px 0;">${escapeHtml(exam.title)}</h1>
      ${exam.subject ? `<p style="font-size:14px;color:#555;">المادة: ${escapeHtml(exam.subject)}</p>` : ''}
      <div style="display:flex;justify-content:center;gap:24px;margin-top:8px;font-size:12px;color:#666;">
        ${exam.duration_minutes ? `<span>الزمن: ${exam.duration_minutes} دقيقة</span>` : ''}
        <span>الدرجة الكلية: ${totalMarks}</span>
        <span>عدد الأسئلة: ${sorted.length}</span>
      </div>
    </div>
    ${exam.description ? `<p style="font-size:13px;color:#666;text-align:center;margin-bottom:16px;">${escapeHtml(exam.description)}</p>` : ''}
    ${answerKey ? '<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:8px;text-align:center;margin-bottom:16px;font-weight:bold;color:#b45309;">مفتاح الإجابات — للمعلم فقط</div>' : ''}
    ${questionsHTML}
  `;
}

export function exportExamAsText(exam: OnlineExam, questions: ExamQuestion[], sections: ExamSection[], answerKey = false): string {
  const sorted = [...questions].sort((a, b) => a.sort_order - b.sort_order);
  const letters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
  let text = '';

  text += exam.title + '\n';
  if (exam.subject) text += `المادة: ${exam.subject}\n`;
  if (exam.duration_minutes) text += `الزمن: ${exam.duration_minutes} دقيقة\n`;
  text += `عدد الأسئلة: ${sorted.length}\n`;
  text += `الدرجة الكلية: ${sorted.reduce((s, q) => s + (q.points ?? 0), 0)}\n`;
  if (exam.description) text += `\n${exam.description}\n`;
  text += '\n' + '='.repeat(50) + '\n\n';

  let qNum = 0;
  const renderQ = (q: ExamQuestion): string => {
    qNum++;
    let s = `${qNum}. ${q.question_text} (${q.points} درجة)\n`;
    if (q.type === 'mcq' && q.choices) {
      q.choices.forEach((c, i) => {
        const mark = answerKey && i === q.correct_choice_index ? ' ✓' : '';
        s += `   ${letters[i] ?? i}) ${c}${mark}\n`;
      });
    }
    if (q.type === 'true_false') {
      s += '   صح ( )   خطأ ( )\n';
      if (answerKey && q.correct_choice_index !== null) s += `   الإجابة: ${q.correct_choice_index === 0 ? 'صح' : 'خطأ'}\n`;
    }
    if (q.type === 'fill_blank' || q.type === 'short_answer' || q.type === 'essay') {
      if (answerKey) s += `   الإجابة: ${q.model_answer ?? 'تُصحّ يدوياً'}\n`;
      else if (q.type === 'essay') s += '   _______________________________\n';
      else s += '   _______________________________\n';
    }
    return s + '\n';
  };

  if (sections.length > 0) {
    for (const sec of sections) {
      const secQs = sorted.filter((q) => q.section_id === sec.id);
      if (secQs.length === 0) continue;
      text += `\n【${sec.title}】\n`;
      if (sec.instructions) text += `${sec.instructions}\n\n`;
      secQs.forEach((q) => { text += renderQ(q); });
    }
    const unsectioned = sorted.filter((q) => !q.section_id);
    unsectioned.forEach((q) => { text += renderQ(q); });
  } else {
    sorted.forEach((q) => { text += renderQ(q); });
  }

  return text;
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.txt') ? filename : `${filename}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportExamAsPDF(exam: OnlineExam, questions: ExamQuestion[], sections: ExamSection[], answerKey = false): void {
  const html = buildExamHTML(exam, questions, sections, answerKey);
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('تعذر فتح نافذة الطباعة. يرجى السماح بالنوافذ المنبثقة.'); return; }
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(exam.title)}</title>
  <style>
    * { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; box-sizing: border-box; }
    body { padding: 32px; color: #1e293b; max-width: 800px; margin: 0 auto; }
    @page { margin: 1.5cm; }
    @media print { body { padding: 0; } }
  </style></head><body>${html}
  <script>window.onload = function() { window.print(); }</script>
  </body></html>`);
  win.document.close();
}

export async function exportExamAsImage(exam: OnlineExam, questions: ExamQuestion[], sections: ExamSection[], answerKey = false): Promise<void> {
  const html = buildExamHTML(exam, questions, sections, answerKey);
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { throw new Error('تعذر فتح نافذة المعاينة — يرجى السماح بالنوافذ المنبثقة'); }
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(exam.title)}</title>
  <style>
    * { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; box-sizing: border-box; }
    body { padding: 32px; color: #1e293b; max-width: 800px; margin: 0 auto; background: #fff; }
    .toolbar { position: fixed; top: 0; left: 0; right: 0; background: #1e293b; padding: 8px 16px; display: flex; justify-content: space-between; align-items: center; z-index: 999; }
    .toolbar button { padding: 6px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
    .toolbar .save { background: #2563eb; color: #fff; }
    .toolbar .close { background: #ef4444; color: #fff; }
    .exam-content { margin-top: 50px; }
  </style></head><body>
  <div class="toolbar">
    <button class="save" onclick="saveImage()">حفظ كصورة (PNG)</button>
    <button class="close" onclick="window.close()">إغلاق</button>
  </div>
  <div class="exam-content" id="examContent">${html}</div>
  <script>
    function saveImage() {
      var content = document.getElementById('examContent');
      var w = content.offsetWidth;
      var h = content.offsetHeight;
      var scale = 2;
      var canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      var data = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject width="100%" height="100%">' + new XMLSerializer().serializeToString(content) + '</foreignObject></svg>';
      var img = new Image();
      img.onload = function() {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(function(blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = '${(exam.title || 'exam').replace(/'/g, "\\'")}.png';
          a.click();
          URL.revokeObjectURL(url);
        }, 'image/png');
      };
      img.onerror = function() { alert('فشل إنشاء الصورة. استخدم لقطة الشاشة كبديل.'); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
    }
  </script>
  </body></html>`);
  win.document.close();
}

export function exportExamAsWord(exam: OnlineExam, questions: ExamQuestion[], sections: ExamSection[], answerKey = false): void {
  const html = buildExamHTML(exam, questions, sections, answerKey);
  const fullHTML = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(exam.title)}</title>
  <style>
    * { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
    body { color: #1e293b; }
  </style></head><body>${html}</body></html>`;
  const blob = new Blob(['\uFEFF' + fullHTML], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exam.title || 'exam'}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
