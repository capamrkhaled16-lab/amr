import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Printer, Copy, Check, FileText, Image as ImageIcon, FileDown, Loader2, Eye, EyeOff, QrCode, FlaskConical } from 'lucide-react';
import type { ExamLabExam, ExamLabQuestion, QuestionType } from '@/lib/examLabTypes';
import { QUESTION_TYPE_SHORT, QUESTION_TYPE_LABELS } from '@/lib/examLabTypes';

type Props = {
  exam: ExamLabExam;
  questions: ExamLabQuestion[];
  showAnswers: boolean;
  onClose: () => void;
};

type ModelLabel = 'A' | 'B' | 'C';

const MODEL_LABELS_AR: Record<ModelLabel, string> = {
  A: 'النموذج أ',
  B: 'النموذج ب',
  C: 'النموذج ج',
};

const SECTION_ORDER: QuestionType[] = [
  'mcq', 'true_false', 'complete', 'explain', 'mention', 'define',
  'compare', 'problem', 'image_question', 'order_match', 'essay',
];

const SECTION_HEADERS: Record<QuestionType, string> = {
  mcq: 'اختر الإجابة الصحيحة مما بين الأقواس',
  true_false: 'ضع علامة (✓) أمام العبارة الصحيحة و (✗) أمام العبارة الخاطئة',
  complete: 'أكمل العبارات التالية بما يناسبها علمياً',
  explain: 'علل لما يأتي تعليلاً علمياً دقيقاً',
  mention: 'اذكر ما يلي',
  define: 'عرّف المصطلحات التالية تعريفاً علمياً دقيقاً',
  compare: 'قارن بين ما يلي',
  problem: 'حل المسائل التالية موضحاً خطوات الحل',
  image_question: 'تأمل الأشكال التالية ثم أجب عن الأسئلة',
  order_match: 'صل بين ما في القائمة (أ) وما يناسبها في القائمة (ب)',
  essay: 'أجب عن الأسئلة التالية إجابة وافية',
};

const SECTION_TITLES_AR: Record<QuestionType, string> = {
  mcq: 'السؤال الأول',
  true_false: 'السؤال الثاني',
  complete: 'السؤال الثالث',
  explain: 'السؤال الرابع',
  mention: 'السؤال الخامس',
  define: 'السؤال السادس',
  compare: 'السؤال السابع',
  problem: 'السؤال الثامن',
  image_question: 'السؤال التاسع',
  order_match: 'السؤال العاشر',
  essay: 'السؤال الحادي عشر',
};

function shuffleArray<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleChoices(choices: string[], seed: number): { choices: string[]; mapping: number[] } {
  const indices = choices.map((_, i) => i);
  const shuffled = shuffleArray(indices, seed);
  return {
    choices: shuffled.map(i => choices[i]),
    mapping: shuffled,
  };
}

function groupByType(qs: ExamLabQuestion[]): { type: QuestionType; questions: ExamLabQuestion[] }[] {
  const groups = new Map<QuestionType, ExamLabQuestion[]>();
  for (const q of qs) {
    const arr = groups.get(q.question_type) || [];
    arr.push(q);
    groups.set(q.question_type, arr);
  }
  const result: { type: QuestionType; questions: ExamLabQuestion[] }[] = [];
  for (const t of SECTION_ORDER) {
    const arr = groups.get(t);
    if (arr && arr.length > 0) result.push({ type: t, questions: arr });
  }
  return result;
}

function generatePlainText(exam: ExamLabExam, questions: ExamLabQuestion[], showAnswers: boolean, modelLabel?: ModelLabel): string {
  const lines: string[] = [];
  lines.push(exam.exam_title || 'امتحان');
  if (modelLabel) lines.push(MODEL_LABELS_AR[modelLabel]);
  lines.push('='.repeat(50));
  if (exam.center_name) lines.push(`المركز: ${exam.center_name}`);
  if (exam.subject) lines.push(`المادة: ${exam.subject}`);
  if (exam.teacher_name) lines.push(`المدرس: ${exam.teacher_name}`);
  if (exam.stage_name) lines.push(`المرحلة: ${exam.stage_name}`);
  if (exam.grade_name) lines.push(`الصف: ${exam.grade_name}`);
  if (exam.group_name) lines.push(`المجموعة: ${exam.group_name}`);
  if (exam.exam_date) lines.push(`التاريخ: ${exam.exam_date}`);
  if (exam.duration_minutes != null) lines.push(`المدة: ${exam.duration_minutes} دقيقة`);
  if (exam.total_marks != null) lines.push(`الدرجة: ${exam.total_marks}`);
  lines.push('');
  lines.push('-'.repeat(50));
  lines.push('');

  const sections = groupByType(questions);
  let qNum = 0;
  for (const section of sections) {
    lines.push(`${SECTION_TITLES_AR[section.type]}: ${SECTION_HEADERS[section.type]}`);
    lines.push('');
    const sectionMarks = section.questions.reduce((s, q) => s + (q.marks ?? 0), 0);
    lines.push(`(${sectionMarks} درجة)`);
    lines.push('');
    for (const q of section.questions) {
      qNum++;
      lines.push(`${qNum}. ${q.question_text}`);
      if (q.question_type === 'mcq' && q.choices.length > 0) {
        q.choices.forEach((c, ci) => {
          const letter = String.fromCharCode(1571 + ci);
          lines.push(`   ${letter}) ${c}`);
        });
      }
      if (showAnswers && q.correct_answer) {
        lines.push(`   الإجابة: ${q.correct_answer}`);
      }
      lines.push('');
    }
    lines.push('');
  }

  lines.push('-'.repeat(50));
  lines.push('معمل الاختبارات — منصة الخالد التعليمية');
  if (showAnswers) lines.push('نموذج إجابة — للمعلم فقط');
  return lines.join('\n');
}

function generateDocxXml(exam: ExamLabExam, questions: ExamLabQuestion[], showAnswers: boolean, modelLabel?: ModelLabel): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const headerRows: string[] = [];
  if (exam.center_name) headerRows.push(`<w:t>المركز: ${esc(exam.center_name)}</w:t>`);
  if (exam.subject) headerRows.push(`<w:t>المادة: ${esc(exam.subject)}</w:t>`);
  if (exam.teacher_name) headerRows.push(`<w:t>المدرس: ${esc(exam.teacher_name)}</w:t>`);
  if (exam.grade_name) headerRows.push(`<w:t>الصف: ${esc(exam.grade_name)}</w:t>`);
  if (exam.exam_date) headerRows.push(`<w:t>التاريخ: ${esc(exam.exam_date)}</w:t>`);
  if (exam.duration_minutes != null) headerRows.push(`<w:t>المدة: ${exam.duration_minutes} دقيقة</w:t>`);
  if (exam.total_marks != null) headerRows.push(`<w:t>الدرجة: ${exam.total_marks}</w:t>`);

  const sections = groupByType(questions);
  let qNum = 0;
  const sectionParas: string[] = [];

  for (const section of sections) {
    const sectionMarks = section.questions.reduce((s, q) => s + (q.marks ?? 0), 0);
    sectionParas.push(`<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t xml:space="preserve">${esc(SECTION_TITLES_AR[section.type])}: ${esc(SECTION_HEADERS[section.type])}</w:t></w:r></w:p>`);
    sectionParas.push(`<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">(${sectionMarks} درجة)</w:t></w:r></w:p>`);

    for (const q of section.questions) {
      qNum++;
      sectionParas.push(`<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${qNum}. ${esc(q.question_text)}</w:t></w:r></w:p>`);
      if (q.question_type === 'mcq' && q.choices.length > 0) {
        q.choices.forEach((c, ci) => {
          const letter = String.fromCharCode(1571 + ci);
          sectionParas.push(`<w:p><w:pPr><w:bidi/><w:ind w:right="360"/></w:pPr><w:r><w:t xml:space="preserve">${letter}) ${esc(c)}</w:t></w:r></w:p>`);
        });
      }
      if (q.question_type === 'mcq' && !showAnswers) {
        sectionParas.push(`<w:p><w:pPr><w:bidi/><w:ind w:right="360"/></w:pPr><w:r><w:t xml:space="preserve">(     )</w:t></w:r></w:p>`);
      }
      if (q.question_type === 'true_false' && !showAnswers) {
        sectionParas.push(`<w:p><w:pPr><w:bidi/><w:ind w:right="360"/></w:pPr><w:r><w:t xml:space="preserve">(     )</w:t></w:r></w:p>`);
      }
      if (showAnswers && q.correct_answer) {
        sectionParas.push(`<w:p><w:pPr><w:bidi/><w:ind w:right="360"/></w:pPr><w:r><w:rPr><w:color w:val="008000"/></w:rPr><w:t xml:space="preserve">الإجابة: ${esc(q.correct_answer)}</w:t></w:r></w:p>`);
      }
      if (q.question_type !== 'mcq' && q.question_type !== 'true_false' && !showAnswers) {
        sectionParas.push(`<w:p><w:pPr><w:bidi/></w:pPr></w:p>`);
        sectionParas.push(`<w:p><w:pPr><w:bidi/></w:pPr></w:p>`);
      }
    }
  }

  const titleText = esc(exam.exam_title || 'امتحان') + (modelLabel ? ` — ${MODEL_LABELS_AR[modelLabel]}` : '');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t>${titleText}</w:t></w:r></w:p>
${headerRows.map(r => `<w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/></w:rPr>${r}</w:p>`).join('')}
<w:p><w:pPr><w:bidi/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr></w:pPr></w:p>
${sectionParas.join('')}
<w:p><w:pPr><w:bidi/><w:pBdr><w:top w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>
<w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="666666"/></w:rPr><w:t>معمل الاختبارات — منصة الخالد التعليمية</w:t></w:r></w:p>
${showAnswers ? '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="008000"/></w:rPr><w:t>نموذج إجابة — للمعلم فقط</w:t></w:r></w:p>' : ''}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body>
</w:document>`;
}

function generateDocxPackage(exam: ExamLabExam, questions: ExamLabQuestion[], showAnswers: boolean, modelLabel?: ModelLabel): Blob {
  const documentXml = generateDocxXml(exam, questions, showAnswers, modelLabel);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const wordRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const files: { name: string; content: string }[] = [
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rels },
    { name: 'word/_rels/document.xml.rels', content: wordRels },
    { name: 'word/document.xml', content: documentXml },
  ];

  return buildZip(files);
}

function buildZip(files: { name: string; content: string }[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(localHeader.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, dataBytes.length, true);
    dv.setUint32(22, dataBytes.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(centralHeader.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, dataBytes.length, true);
    cdv.setUint32(24, dataBytes.length, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    chunks.push(localHeader, dataBytes);
    central.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);

  const allParts = [...chunks, ...central, eocd];
  return new Blob(allParts as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export default function ExamLabPreview({ exam, questions, showAnswers: initialShowAnswers, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState(initialShowAnswers);
  const [activeModel, setActiveModel] = useState<ModelLabel>('A');

  const modelQuestions = useMemo(() => {
    if (questions.length === 0) return { A: [], B: [], C: [] as ExamLabQuestion[] };

    const baseSeed = questions.reduce((s, q) => s + (q.id?.charCodeAt(0) || 0), 0);
    const models: Record<ModelLabel, ExamLabQuestion[]> = {
      A: questions,
      B: shuffleArray(questions, baseSeed + 1).map((q, qi) => {
        if (q.question_type === 'mcq' && q.choices.length > 0) {
          const { choices } = shuffleChoices(q.choices, baseSeed + qi + 10);
          return { ...q, choices };
        }
        return q;
      }),
      C: shuffleArray(questions, baseSeed + 2).map((q, qi) => {
        if (q.question_type === 'mcq' && q.choices.length > 0) {
          const { choices } = shuffleChoices(q.choices, baseSeed + qi + 20);
          return { ...q, choices };
        }
        return q;
      }),
    };
    return models;
  }, [questions]);

  const displayQuestions = modelQuestions[activeModel] || [];
  const availableModels = Object.keys(modelQuestions).filter(m => modelQuestions[m as ModelLabel].length > 0) as ModelLabel[];
  const sections = useMemo(() => groupByType(displayQuestions), [displayQuestions]);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyText = () => {
    const text = generatePlainText(exam, displayQuestions, showAnswers, activeModel);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadImage = async () => {
    setExporting('image');
    try {
      const el = document.getElementById('exam-print-area');
      if (!el) return;
      const { default: htmlToImage } = await import('html-to-image');
      const dataUrl = await htmlToImage.toPng(el, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: { direction: 'rtl' },
      });
      const link = document.createElement('a');
      link.download = `${exam.exam_title || 'exam'}-${activeModel}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      window.print();
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadWord = () => {
    setExporting('word');
    try {
      const blob = generateDocxPackage(exam, displayQuestions, showAnswers, activeModel);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${exam.exam_title || 'exam'}-${activeModel}.docx`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadPDF = async () => {
    setExporting('pdf');
    try {
      const el = document.getElementById('exam-print-area');
      if (!el) return;
      const { default: htmlToImage } = await import('html-to-image');
      const { jsPDF } = await import('jspdf');
      const dataUrl = await htmlToImage.toPng(el, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      });
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const imgHeight = (el.offsetHeight / el.offsetWidth) * imgWidth;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(dataUrl, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= 297;
      while (heightLeft > 0) {
        position -= 297;
        pdf.addPage();
        pdf.addImage(dataUrl, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= 297;
      }
      pdf.save(`${exam.exam_title || 'exam'}-${activeModel}.pdf`);
    } catch {
      window.print();
    } finally {
      setExporting(null);
    }
  };

  const totalMarks = displayQuestions.reduce((s, q) => s + (q.marks ?? 0), 0);
  let globalQNum = 0;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100001] flex items-start justify-center p-4 overflow-y-auto exam-preview-overlay pointer-events-none"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/60 pointer-events-auto" />

        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="relative w-full max-w-4xl my-8 pointer-events-auto"
        >
          {/* Toolbar */}
          <div className="glass-card rounded-2xl p-4 mb-4 space-y-3 no-print">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold text-white">
                  {showAnswers ? 'نموذج الإجابة والشرح' : 'معاينة الطباعة A4'}
                </h3>
                {availableModels.length > 1 && (
                  <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-400 text-xs font-bold border border-sky-500/30">
                    {MODEL_LABELS_AR[activeModel]}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {availableModels.length > 1 && (
                  <div className="flex items-center gap-1 glass-light rounded-xl p-1">
                    {availableModels.map(m => (
                      <button
                        key={m}
                        onClick={() => setActiveModel(m)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                          activeModel === m
                            ? 'bg-sky-500/20 text-sky-400'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {MODEL_LABELS_AR[m]}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => setShowAnswers(!showAnswers)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition ${
                    showAnswers
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'glass-light text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {showAnswers ? <Eye size={14} /> : <EyeOff size={14} />}
                  {showAnswers ? 'إخفاء الإجابات' : 'عرض الإجابات'}
                </button>

                <button onClick={handleCopyText} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition">
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copied ? 'تم النسخ' : 'نسخ'}
                </button>
                <button onClick={handleDownloadImage} disabled={exporting === 'image'} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition disabled:opacity-50">
                  {exporting === 'image' ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                  صورة
                </button>
                <button onClick={handleDownloadPDF} disabled={exporting === 'pdf'} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition disabled:opacity-50">
                  {exporting === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                  PDF
                </button>
                <button onClick={handleDownloadWord} disabled={exporting === 'word'} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600/20 text-sky-400 text-xs font-bold hover:bg-sky-600/30 transition border border-sky-500/30 disabled:opacity-50">
                  {exporting === 'word' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                  تصدير Word
                </button>
                <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass-light text-slate-300 text-xs font-bold hover:bg-white/10 transition">
                  <Printer size={14} /> طباعة
                </button>
                <button onClick={onClose} className="p-2 rounded-xl glass-light text-slate-400 hover:text-white transition">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 text-[11px] text-slate-400">
              <span>{displayQuestions.length} سؤال</span>
              <span>{totalMarks} درجة</span>
              {exam.duration_minutes != null && <span>{exam.duration_minutes} دقيقة</span>}
              <span>{sections.length} أقسام</span>
            </div>
          </div>

          {/* A4 Paper */}
          <div
            className="bg-white text-black rounded-lg shadow-2xl mx-auto exam-print-paper"
            style={{ width: '210mm', minHeight: '297mm', padding: '18mm 16mm', direction: 'rtl', fontFamily: "'Cairo','Tajawal','Arial',sans-serif" }}
            id="exam-print-area"
          >
            {/* Header */}
            <div className="exam-header border-b-2 border-black pb-3 mb-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 text-center">
                  <h1 className="text-xl font-bold mb-1 leading-tight">{exam.exam_title || 'امتحان'}</h1>
                  {availableModels.length > 1 && (
                    <span className="inline-block px-3 py-0.5 rounded bg-slate-100 text-xs font-bold border border-slate-300">
                      {MODEL_LABELS_AR[activeModel]}
                    </span>
                  )}
                </div>
                <div className="flex-shrink-0 w-14 h-14 border-2 border-black rounded flex flex-col items-center justify-center text-[7px] text-gray-400">
                  <QrCode size={24} className="text-gray-300" />
                  <span className="mt-0.5">QR</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1 text-xs text-center leading-relaxed">
                {exam.center_name && <div><span className="font-bold">المركز:</span> {exam.center_name}</div>}
                {exam.subject && <div><span className="font-bold">المادة:</span> {exam.subject}</div>}
                {exam.teacher_name && <div><span className="font-bold">المدرس:</span> {exam.teacher_name}</div>}
                {exam.stage_name && <div><span className="font-bold">المرحلة:</span> {exam.stage_name}</div>}
                {exam.grade_name && <div><span className="font-bold">الصف:</span> {exam.grade_name}</div>}
                {exam.group_name && <div><span className="font-bold">المجموعة:</span> {exam.group_name}</div>}
                {exam.exam_date && <div><span className="font-bold">التاريخ:</span> {exam.exam_date}</div>}
                {exam.duration_minutes != null && <div><span className="font-bold">المدة:</span> {exam.duration_minutes} دقيقة</div>}
                {exam.total_marks != null && <div><span className="font-bold">الدرجة:</span> {exam.total_marks}</div>}
              </div>
            </div>

            {/* Content info */}
            {(exam.book_name || exam.unit_name || exam.chapter_name || exam.lessons) && (
              <div className="text-xs mb-4 pb-2 border-b border-gray-300 leading-relaxed">
                {exam.book_name && <div><span className="font-bold">المذكرة:</span> {exam.book_name}</div>}
                {exam.unit_name && <div><span className="font-bold">الوحدة:</span> {exam.unit_name}</div>}
                {exam.chapter_name && <div><span className="font-bold">الفصل:</span> {exam.chapter_name}</div>}
                {exam.lessons && <div><span className="font-bold">الدروس:</span> {exam.lessons}</div>}
              </div>
            )}

            {/* Questions grouped by type — Egyptian worksheet structure */}
            <div className="space-y-6" dir="rtl" style={{ direction: 'rtl', unicodeBidi: 'isolate' }}>
              {sections.map((section, sIdx) => {
                const sectionMarks = section.questions.reduce((s, q) => s + (q.marks ?? 0), 0);
                return (
                  <div key={section.type} className="exam-section" style={{ breakInside: 'avoid' }}>
                    {/* Section header */}
                    <div className="border-b border-black pb-1.5 mb-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">
                          {SECTION_TITLES_AR[section.type]}: <span className="font-normal">{SECTION_HEADERS[section.type]}</span>
                        </h3>
                        <span className="text-xs font-bold text-gray-600">({sectionMarks} درجة)</span>
                      </div>
                    </div>

                    {/* Questions in this section — numbering resets per section */}
                    <div className="space-y-3">
                      {section.questions.map((q, qIdx) => {
                        globalQNum++;
                        const localNum = qIdx + 1;
                        return (
                          <div key={q.id || globalQNum} className="exam-question text-sm leading-relaxed" style={{ breakInside: 'avoid', direction: 'rtl', unicodeBidi: 'isolate' }}>
                            <div className="flex items-start gap-1.5">
                              <span className="font-bold flex-shrink-0">{localNum}.</span>
                              <div className="flex-1">
                                <p className="font-medium leading-relaxed">{q.question_text}</p>

                                {/* MCQ choices */}
                                {q.question_type === 'mcq' && q.choices.length > 0 && !showAnswers && (
                                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 pr-4" dir="rtl" style={{ direction: 'rtl' }}>
                                    {q.choices.map((c, ci) => (
                                      <div key={ci} className="flex items-center gap-1.5 text-xs" style={{ direction: 'rtl', unicodeBidi: 'isolate' }}>
                                        <span className="font-bold flex-shrink-0">{String.fromCharCode(1571 + ci)})</span>
                                        <span>{c}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* MCQ choices with answer key */}
                                {q.question_type === 'mcq' && q.choices.length > 0 && showAnswers && (
                                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 pr-4" dir="rtl" style={{ direction: 'rtl' }}>
                                    {q.choices.map((c, ci) => (
                                      <div key={ci} className={`flex items-center gap-1.5 text-xs ${c === q.correct_answer ? 'font-bold text-green-700' : ''}`} style={{ direction: 'rtl', unicodeBidi: 'isolate' }}>
                                        <span className="font-bold flex-shrink-0">{String.fromCharCode(1571 + ci)})</span>
                                        <span>{c}</span>
                                        {c === q.correct_answer && <Check size={12} className="text-green-600" />}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* True/False answer brackets */}
                                {q.question_type === 'true_false' && !showAnswers && (
                                  <div className="mt-1.5 pr-4">
                                    <span className="text-xs font-bold">(     )</span>
                                  </div>
                                )}

                                {/* Show answer for non-MCQ */}
                                {showAnswers && q.correct_answer && q.question_type !== 'mcq' && (
                                  <div className="mt-1.5 pr-4">
                                    <div className="bg-green-50 border border-green-300 rounded px-2 py-1 text-xs inline-block">
                                      <span className="font-bold">الإجابة:</span> {q.correct_answer}
                                    </div>
                                  </div>
                                )}

                                {/* Answer lines for non-MCQ, non-true_false when not showing answers */}
                                {!showAnswers && q.question_type !== 'mcq' && q.question_type !== 'true_false' && (
                                  <div className="mt-2 space-y-3">
                                    <div className="border-b border-dashed border-gray-400 h-4" />
                                    <div className="border-b border-dashed border-gray-400 h-4" />
                                  </div>
                                )}

                                {/* Marks */}
                                <div className="text-[10px] text-gray-500 mt-1">
                                  ({q.marks ?? '-'} درجة)
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Answer key section (toggleable) */}
            {showAnswers && (
              <div className="mt-8 pt-4 border-t-2 border-gray-400" style={{ breakInside: 'avoid' }}>
                <div className="text-center mb-4">
                  <h2 className="text-base font-bold bg-gray-100 inline-block px-6 py-1 rounded">
                    نموذج الإجابة والشرح التربوي
                  </h2>
                </div>
                {sections.map((section) => (
                  <div key={`ans-section-${section.type}`} dir="rtl" style={{ direction: 'rtl' }}>
                    <h3 className="text-sm font-bold mb-2 mt-3">{SECTION_TITLES_AR[section.type]}:</h3>
                    {section.questions.map((q, qIdx) => {
                      return (
                        <div key={`ans-${q.id || qIdx}`} className="text-xs mb-3 pb-2 border-b border-gray-200" style={{ direction: 'rtl', unicodeBidi: 'isolate' }}>
                          <p className="font-bold">س{qIdx + 1}. {q.question_text}</p>
                          <div className="mt-1 pr-4">
                            <p><span className="font-bold text-green-700">الإجابة الصحيحة:</span> {q.correct_answer || '—'}</p>
                            {q.source_lesson && <p className="text-gray-500 mt-0.5">الدرس المصدر: {q.source_lesson}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* Footer — branding locked at bottom */}
            <div className="exam-footer mt-8 pt-3 border-t border-gray-300 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
                <FlaskConical size={14} className="text-gray-400" />
                <span>معمل الاختبارات — منصة الخالد التعليمية</span>
              </div>
              {showAnswers && <p className="font-bold mt-1 text-green-700 text-xs">نموذج إجابة — للمعلم فقط</p>}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
