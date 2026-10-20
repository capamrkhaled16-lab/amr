import type {
  ExamLabExam,
  ExamLabQuestion,
  QuestionType,
  Difficulty,
  GenerationMode,
} from '@/lib/examLabTypes';
import { QUESTION_TYPE_LABELS, DIFFICULTY_LABELS } from '@/lib/examLabTypes';

// ============ AI SERVICE LAYER ============
// This module provides an isolated AI service layer for future API integration.
// It does NOT hard-code a fake AI service. When an AI provider is connected
// (via edge function or API key in secrets), it will be used here.
// For now, it provides the complete UI and service interface.

export type AIConfig = {
  provider: 'gemini' | 'openai' | 'none';
  apiKey?: string;
  endpoint?: string;
};

export type SourceMode = 'notes' | 'bank';

export type GenerateExamRequest = {
  extractedContent: string;
  examInfo: Partial<ExamLabExam>;
  questionTypes: Partial<Record<QuestionType, number>>;
  difficulty: Difficulty;
  totalQuestions: number;
  totalMarks: number;
  lessons: string;
  images?: string[];
  sourceMode?: SourceMode;
};

export type GenerateExamResponse = {
  questions: GeneratedQuestion[];
  warnings: string[];
  summary?: { type: string; label: string; requested: number; generated: number }[];
  allMatch?: boolean;
};

export type GeneratedQuestion = {
  question_text: string;
  question_type: QuestionType;
  marks: number;
  difficulty: Difficulty;
  source_lesson: string;
  choices: string[];
  correct_answer: string;
};

import { supabase } from './supabase';

// Check if AI provider is configured
export function getAIConfig(): AIConfig {
  return { provider: 'gemini' };
}

// Client-side text sanitizer — safety net for any artifacts the edge function misses
function sanitizeClientText(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  // Remove image filenames and screenshot artifacts
  cleaned = cleaned.replace(/(?:Samsung_[A-Za-z0-9_]+|Screenshot_[A-Za-z0-9_]+|IMG_[A-Za-z0-9_]+|DSC_[A-Za-z0-9_]+|image\d*)/gi, '');
  // Remove file extensions
  cleaned = cleaned.replace(/\.(?:png|jpg|jpeg|gif|bmp|webp|pdf|docx?)\b/gi, '');
  // Remove blob/data URLs
  cleaned = cleaned.replace(/(?:blob:|data:)[^\s\u0600-\u06FF]*/gi, '');
  // Remove "GRIER" and similar OCR garbage
  cleaned = cleaned.replace(/\b(?:GRIER|GREIER|grier)\b/gi, '');
  // Remove dashed line artifacts mixed into Arabic
  cleaned = cleaned.replace(/-{3,}/g, '');
  // Remove BOM/BIDI/invisible marks
  cleaned = cleaned.replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff\u00a0\u202a-\u202e\uFFFD\uFE0F]/g, '');
  // Remove stray Latin fragments inside Arabic text
  cleaned = cleaned.replace(/(?<![\u0600-\u06FFa-zA-Z])[a-z]{1,4}(?![\u0600-\u06FFa-zA-Z])/g, '');
  // Remove empty quotes
  cleaned = cleaned.replace(/[""\u201c\u201d]\s*[""\u201c\u201d]/g, '');
  // Normalize whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  return cleaned.trim();
}

// Client-side validation gate — rejects corrupted questions before they reach Preview
function isValidQuestion(q: GeneratedQuestion): boolean {
  const text = (q.question_text || '').trim();
  if (text.length < 10) return false;

  // Reject if filename artifacts remain after sanitization
  if (/Samsung_|Screenshot_|IMG_|DSC_|image\d*\./i.test(text)) return false;
  if (/(?:blob:|data:|https?:\/\/)[^\s\u0600-\u06FF]/i.test(text)) return false;
  if (/\.(?:png|jpg|jpeg|gif|bmp|webp|pdf|docx?)\b/i.test(text)) return false;
  if (/\bGRIER\b/i.test(text)) return false;
  if (/-{3,}/.test(text)) return false;

  // Reject truncated questions
  if (/^[\|\*\-#\>]/.test(text)) return false;
  if (text.length < 15 && !/[.!؟،؛:]$/.test(text)) return false;

  // Reject consecutive word repetition
  const words = text.split(/\s+/).filter(w => w.length >= 3);
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] === words[i + 1]) return false;
  }
  // Reject same word 3+ times in 8-word window
  for (let i = 0; i < words.length; i++) {
    let count = 0;
    for (let j = i; j < Math.min(i + 8, words.length); j++) {
      if (words[j] === words[i] && words[i].length >= 4) count++;
    }
    if (count >= 3) return false;
  }

  // Arabic quality gate
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicChars < text.length * 0.3) return false;

  // MCQ needs valid choices — if missing, downgrade to essay rather than reject
  if (q.question_type === 'mcq') {
    if (!q.choices || q.choices.length < 2) {
      q.question_type = 'essay';
      q.choices = [];
    } else {
      for (const c of q.choices) {
        if (/Samsung_|Screenshot_|IMG_|DSC_|\.(?:png|jpg|jpeg|gif|bmp|webp)/i.test(c)) return false;
        if (/\bGRIER\b/i.test(c)) return false;
      }
    }
  }

  return true;
}

// Validate and filter questions, returning only valid ones
function validateQuestions(questions: GeneratedQuestion[]): GeneratedQuestion[] {
  return questions.filter(isValidQuestion);
}

// Generate exam by calling the exam-ai-generate edge function.
// The edge function uses GEMINI_API_KEY from Supabase secrets.
export async function generateExamWithAI(req: GenerateExamRequest): Promise<GenerateExamResponse> {
  // Offline check: skip network call entirely
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      questions: [],
      warnings: ['لا يوجد اتصال بالإنترنت — تم تخطي توليد الذكاء الاصطناعي. يمكنك إضافة الأسئلة يدوياً.'],
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('exam-ai-generate', {
      body: {
        extractedContent: req.extractedContent,
        examInfo: req.examInfo,
        questionTypes: req.questionTypes,
        difficulty: req.difficulty,
        totalQuestions: req.totalQuestions,
        totalMarks: req.totalMarks,
        lessons: req.lessons,
        images: req.images || [],
        sourceMode: req.sourceMode || 'notes',
      },
    });

    if (error) {
      return {
        questions: [],
        warnings: ['فشل الاتصال بخدمة الذكاء الاصطناعي: ' + (error.message ?? 'خطأ غير معروف') + ' — يمكنك إضافة الأسئلة يدوياً.'],
      };
    }

    if (!data || !Array.isArray(data.questions)) {
      return {
        questions: [],
        warnings: ['استجابة غير صالحة من خدمة الذكاء الاصطناعي — يمكنك إضافة الأسئلة يدوياً.'],
      };
    }

    const cleanedQuestions = data.questions.map((q: GeneratedQuestion) => ({
      ...q,
      question_text: sanitizeClientText(q.question_text),
      correct_answer: sanitizeClientText(q.correct_answer),
      choices: (q.choices || []).map(sanitizeClientText),
      source_lesson: sanitizeClientText(q.source_lesson || ''),
    }));

    // Client-side validation gate — reject corrupted questions
    const validQuestions = validateQuestions(cleanedQuestions);
    const rejectedCount = cleanedQuestions.length - validQuestions.length;
    const extraWarnings: string[] = [];
    if (rejectedCount > 0) {
      extraWarnings.push(`تم رفض ${rejectedCount} سؤال بسبب عدم صلاحية النص (أسماء ملفات، تكرار، أو اقتطاع).`);
    }

    return {
      questions: validQuestions,
      warnings: [...(data.warnings ?? []), ...extraWarnings],
      summary: data.summary,
      allMatch: data.allMatch && rejectedCount === 0,
    };
  } catch (err) {
    return {
      questions: [],
      warnings: ['فشل الاتصال بالخدمة — يمكنك إضافة الأسئلة يدوياً. (' + (err instanceof Error ? err.message : 'خطأ شبكي') + ')'],
    };
  }
}

// ============ GEMINI PROMPT GENERATOR (Elite A4-Ready Engine) ============

export function generateGeminiPrompt(
  examInfo: Partial<ExamLabExam>,
  extractedContent: string,
  questionTypes: Partial<Record<QuestionType, number>>,
  difficulty: Difficulty,
  totalMarks: number | null,
  lessons: string,
  sourceMode: SourceMode = 'notes',
): string {
  const examId = generateExamId(examInfo);
  const tm = totalMarks ?? 0;
  const dur = examInfo.duration_minutes ?? 0;
  const parts: string[] = [];

  // ═══════════════════════════════════════════
  // SECTION 1: ROLE & MISSION
  // ═══════════════════════════════════════════
  parts.push('أنت خبير تربوي متخصص في تصميم الامتحانات التعليمية الاحترافية،具备 معرفة عميقة بتصميم الأسئلة وفق Bloom\'s Taxonomy ومعايير القياس والتقويم التربوي.');
  parts.push('مهمتك: إنشاء امتحان احترافي جاهز للطباعة على ورق A4، مبني حصرياً على المحتوى التعليمي المرفوع.');

  // ═══════════════════════════════════════════
  // SECTION 2: STRICT SOURCE FIDELITY — MODE-AWARE
  // ═══════════════════════════════════════════
  if (sourceMode === 'bank') {
    // MODE B: Raw questions uploaded — parse & polish ONLY, never generate
    parts.push('\n═══ ⚠️ تعليمات صارمة للمصدر (أسئلة جاهزة) ═══');
    parts.push('• المحتوى المرفوع يحتوي على أسئلة جاهزة كتبها المدرس — مهمتك هي صياغتها وتنسيقها فقط.');
    parts.push('• ممنوع تماماً توليد أسئلة جديدة من عندك أو إضافة أنواع أسئلة غير موجودة.');
    parts.push('• ممنوع طلب عدد أسئلة "أكمل" أو "علل" أو "اشرح" — استخدم فقط ما هو موجود في النص.');
    parts.push('• اقرأ كل سؤال كما هو، أعد صياغته بلغة عربية فصحى واضحة، وصحح الأخطاء الإملائية.');
    parts.push('• وزع الأسئلة على الأنواع الموجودة فعلاً في النص (اختيار من متعدد، صح/خطأ، أكمل، علل، مقالي...).');
    parts.push('• إذا كان السؤال اختيار من متعدد، استخرج الخيارات كما هي من النص ولا تخترع خيارات جديدة.');
    parts.push('• إذا كان السؤال مقالي أو "علل"، اكتب إجابة نموذجية مبنية على ما ذكره المدرس.');
    parts.push('• لا تضف أي معلومة خارجية أو من معرفتك العام — أنت منسق ومصحح فقط، لا مؤلف.');
    parts.push('• إذا كان المحتوى غير كافٍ، أخرج ما هو متاح فقط دون إكمال بالأسئلة المخترعة.');
  } else {
    // MODE A: Notes uploaded — full generation authorized
    parts.push('\n═══ ⚠️ تعليمات صارمة للمصدر (مذكرات/شرح) ═══');
    parts.push('• استخدم المحتوى المرفوع كالمصدر الأساسي والأوحد للأسئلة.');
    parts.push('• لا تضف أي معلومة غير موجودة في المحتوى المرفوع.');
    parts.push('• لا تخترع معلومات خارجية أو من معرفتك العام.');
    parts.push('• كل سؤال يجب أن يكون مبنياً على نص أو شكل أو جدول من المحتوى المرفوع.');
    parts.push('• مطلوب منك توزيع أنواع الأسئلة (MCQ، صح/خطأ، أكمل، علل، مقالي) حسب الأعداد المحددة.');
    parts.push('• إذا كان المحتوى غير كافٍ لعدد الأسئلة المطلوب، وزع ما هو متاح وأشير في نهاية التقرير إلى القصور.');
  }

  // ═══════════════════════════════════════════
  // SECTION 3: A4 PRINT FORMAT HEADER
  // ═══════════════════════════════════════════
  parts.push('\n═══ 📄 تنسيق A4 احترافي (Portrait) ═══');
  parts.push('صمم الامتحان لورق A4 (Portrait) مع دعم كامل لـ RTL العربية:');
  parts.push('');
  parts.push('【ترويسة الامتحان — في أعلى الصفحة الأولى】');
  parts.push('┌─────────────────────────────────────────────────┐');
  parts.push('│  اسم المركز: ' + (examInfo.center_name || '________________') + '    معرف الامتحان: ' + examId + '  │');
  parts.push('│  المدرس: ' + (examInfo.teacher_name || '________________') + '    المادة: ' + (examInfo.subject || '________') + '  │');
  parts.push('│  الصف: ' + (examInfo.grade_name || '________') + '    المجموعة: ' + (examInfo.group_name || '________') + '  │');
  parts.push('│  التاريخ: ' + (examInfo.exam_date || '____/____/____') + '    المدة: ' + (dur || '___') + ' دقيقة    الدرجة: ' + (tm || '___') + '  │');
  parts.push('│  [QR Code Placeholder: ضع رمز QR يحتوي على معرف: ' + examId + ']              │');
  parts.push('└─────────────────────────────────────────────────┘');
  parts.push('');
  parts.push('• رقم الامتحان الفريد: ' + examId + ' (يظهر في الترويسة وفوق كل صفحة)');
  parts.push('• استخدم خطاً عربياً واضحاً (Cairo أو Tajawal) بحجم 14pt للأسئلة و 12pt للخيارات.');
  parts.push('• اترك هوامش: 2cm يمين/يسار، 2.5cm أعلى/أسفل.');
  parts.push('• رقم كل صفحة: "صفحة X من Y" في التذييل.');
  parts.push('• ضع معرف الامتحان ' + examId + ' في تذييل كل صفحة.');

  // ═══════════════════════════════════════════
  // SECTION 4: COGNITIVE LEVELS (Bloom's Taxonomy)
  // ═══════════════════════════════════════════
  parts.push('\n═══ 🧠 توزيع المستويات المعرفية (Bloom\'s Taxonomy) ═══');
  const totalQuestions = Object.values(questionTypes).reduce((s, c) => s + (c ?? 0), 0);
  if (totalQuestions > 0) {
    const remember = Math.round(totalQuestions * 0.30);
    const understand = Math.round(totalQuestions * 0.25);
    const apply = Math.round(totalQuestions * 0.25);
    const analyze = Math.round(totalQuestions * 0.12);
    const evaluate = Math.round(totalQuestions * 0.08);
    parts.push('وزع الأسئلة على مستويات التصنيف كالتالي:');
    parts.push('• التذكر (Remember): ~' + remember + ' سؤال — استرجاع المعلومات الأساسية، تعريفات، قوانين');
    parts.push('• الفهم (Understand): ~' + understand + ' سؤال — شرح، تلخيص، تفسير');
    parts.push('• التطبيق (Apply): ~' + apply + ' سؤال — حل مسائل، استخدام القوانين في مواقف جديدة');
    parts.push('• التحليل (Analyze): ~' + analyze + ' سؤال — مقارنة، تمييز العلاقات، ربط الأسباب بالنتائج');
    parts.push('• التقويم (Evaluate): ~' + evaluate + ' سؤال — إصدار أحكام، تبرير، نقد');
  } else {
    parts.push('وزع الأسئلة على مستويات التصنيف: 30% تذكر، 25% فهم، 25% تطبيق، 12% تحليل، 8% تقويم.');
  }
  parts.push('• اكتب المستوى المعرفي لكل سؤال بين قوسين مربعين بعد رقم السؤال، مثال: "س1 [تطبيق]..."');
  parts.push('• تأكد أن أسئلة "التحليل" و "التقويم" تتطلب تفكيراً عميقاً وليست مجرد استرجاع.');

  // ═══════════════════════════════════════════
  // SECTION 5: COMMON MISCONCEPTIONS
  // ═══════════════════════════════════════════
  parts.push('\n═══ 🎯 أسئلة تقيس الأخطاء الشائعة (Common Misconceptions) ═══');
  parts.push('• خصص 20% على الأقل من أسئلة الاختيار من متعدد (MCQ) لقياس الأخطاء الشائعة للطلاب.');
  parts.push('• الخيارات الخاطئة (Distractors) يجب أن تكون:');
  parts.push('  - خيارات منطقية قابلة للاعتقاد (وليست عشوائية أو ساذجة)');
  parts.push('  - مبنية على أخطاء شائعة يقع فيها الطلاب فعلاً (مثل: خلط المفاهيم، تطبيق قانون خطأ، وحدة قياس خاطئة)');
  parts.push('  - متساوية في الطول تقريباً لتجنب الإيحاء بالإجابة الصحيحة');
  parts.push('  - موزعة عشوائياً (لا تجعل الإجابة الصحيحة دائماً في نفس الموقع)');
  parts.push('• اكتب 4 خيارات (أ، ب، ج، د) لكل سؤال اختيار من متعدد.');
  parts.push('• في نموذج الإجابة، اشرح لماذا الخيارات الأخرى خاطئة وما الخطأ الشائع الذي يمثله كل خيار.');

  // ═══════════════════════════════════════════
  // SECTION 6: EXAM INFO
  // ═══════════════════════════════════════════
  parts.push('\n═══ 📋 بيانات الامتحان ═══');
  if (examInfo.exam_title) parts.push('• عنوان الامتحان: ' + examInfo.exam_title);
  parts.push('• المدة: ' + (dur || 'غير محدد') + ' دقيقة');
  parts.push('• الدرجة النهائية: ' + (tm || 'غير محدد') + ' درجة');
  parts.push('• مستوى الصعوبة: ' + DIFFICULTY_LABELS[difficulty]);
  if (examInfo.book_name) parts.push('• المذكرة/الكتاب: ' + examInfo.book_name);
  if (examInfo.unit_name) parts.push('• الوحدة: ' + examInfo.unit_name);
  if (examInfo.chapter_name) parts.push('• الفصل: ' + examInfo.chapter_name);
  if (lessons) parts.push('• الدروس: ' + lessons);

  // ═══════════════════════════════════════════
  // SECTION 7: QUESTION TYPES & COUNTS
  // ═══════════════════════════════════════════
  parts.push('\n═══ ❓ أنواع الأسئلة والأعداد ═══');
  if (sourceMode === 'bank') {
    parts.push('• استخرج أنواع الأسئلة من النص المرفوع فقط — لا تطلب أنواعاً غير موجودة.');
    parts.push('• وزع الدرجات على الأسئلة المستخرجة بحيث يساوي المجموع ' + (tm || 'الدرجة المحددة') + ' درجة.');
    parts.push('• إذا كان عدد الأسئلة المستخرجة أقل من المطلوب، اكتب ما هو متاح فقط.');
  } else {
    for (const [type, count] of Object.entries(questionTypes)) {
      if (count && count > 0) {
        const t = type as QuestionType;
        parts.push('• ' + QUESTION_TYPE_LABELS[t] + ': ' + count + ' سؤال');
      }
    }
    if (totalQuestions === 0) {
      parts.push('• (وزع الأسئلة بشكل متنوع ومناسب للمحتوى)');
    }
    parts.push('• إجمالي الأسئلة: ' + totalQuestions);
    parts.push('• مجموع الدرجات يجب أن يساوي ' + (tm || 'الدرجة المحددة') + ' درجة بالضبط.');
  }

  // ═══════════════════════════════════════════
  // SECTION 8: LESSON DISTRIBUTION
  // ═══════════════════════════════════════════
  if (lessons) {
    parts.push('\n═══ 📊 التوزيع على الدروس ═══');
    parts.push('• وزع الأسئلة بالتساوي على جميع الدروس المطلوبة.');
    parts.push('• لا تركز على درس واحد وتتجاهل الباقي.');
    parts.push('• تأكد من تغطية كل درس بأسئلة متناسبة مع حجمه وأهميته.');
    parts.push('• اكتب اسم الدرس المصدر بجانب كل سؤال في نموذج الإجابة.');
  }

  // ═══════════════════════════════════════════
  // SECTION 9: QUESTION QUALITY RULES
  // ═══════════════════════════════════════════
  parts.push('\n═══ ✅ قواعد جودة الأسئلة ═══');
  parts.push('• لا تكرر الأسئلة أو المعاني.');
  parts.push('• تجنب الأسئلة الغامضة أو ذات الإجابة المفتوحة (إلا في الأسئلة المقالية).');
  parts.push('• في أسئلة MCQ: إجابة صحيحة واحدة فقط، خيارات متساوية الطول، توزيع عشوائي.');
  parts.push('• في أسئلة الصح/الخطأ: تأكد من صحة الإجابة يقيناً.');
  parts.push('• في أسئلة "أكمل": الفراغ يجب أن يكون على الكلمة المفتاحية فقط.');
  parts.push('• في أسئلة "علل": السبب العلمي يجب أن يكون دقيقاً ومختصراً.');
  parts.push('• وزع الدرجات بشكل منطقي (سؤال التذكر درجة أقل من سؤال التطبيق).');
  parts.push('• اترك مساحة كافية للإجابة بعد كل سؤال مقالي أو مسألة (3-4 أسطر).');

  // ═══════════════════════════════════════════
  // SECTION 10: VISUAL/DIAGRAM REQUIREMENTS
  // ═══════════════════════════════════════════
  parts.push('\n═══ 🖼 الصور والأشكال العلمية ═══');
  parts.push('• إذا كان المحتوى يحتوي على أشكال أو جداول أو صور علمية، استخدمها في الأسئلة.');
  parts.push('• اكتب: "أمامك الشكل التالي، أجب عن الأسئلة..." ثم ضع وصفاً نصياً للشكل.');
  parts.push('• اترك مكاناً مخصصاً للصورة: [ضع الصورة هنا: وصف الصورة]');

  // ═══════════════════════════════════════════
  // SECTION 11: RTL ARABIC TYPOGRAPHY
  // ═══════════════════════════════════════════
  parts.push('\n═══ ✍️ التسلسل الكتابي العربي (RTL) ═══');
  parts.push('• اكتب جميع الأسئلة بالعربية الفصحى مع دعم RTL كامل.');
  parts.push('• استخدم ترقيم عربي للأسئلة: س1، س2، س3...');
  parts.push('• استخدم حروف عربية لخيارات MCQ: (أ) (ب) (ج) (د)');
  parts.push('• افصل بين أقسام الامتحان بفواصل واضحة وعناوين بارزة:');
  parts.push('  ▸ "السؤال الأول: اختر الإجابة الصحيحة"');
  parts.push('  ▸ "السؤال الثاني: ضع علامة (✓) أو (✗)"');
  parts.push('  ▸ "السؤال الثالث: أكمل العبارات التالية"');
  parts.push('  ▸ "السؤال الرابع: علل لما يأتي"');
  parts.push('  ▸ "السؤال الخامس: أجب عن الأسئلة التالية"');
  parts.push('  ▸ "السؤال السادس: حل المسائل التالية"');

  // ═══════════════════════════════════════════
  // SECTION 12: ANSWER KEY & PEDAGOGICAL EXPLANATION
  // ═══════════════════════════════════════════
  parts.push('\n═══ 🔑 نموذج الإجابة والشرح التربوي (قسم منفصل قابل للفصل) ═══');
  parts.push('أنشئ قسم "نموذج الإجابة" في نهاية الامتحان، مفصولاً بصفحة فارغة وعنوان بارز:');
  parts.push('');
  parts.push('╔══════════════════════════════════════════════╗');
  parts.push('║     نموذج الإجابة والشرح التربوي              ║');
  parts.push('║     معرف الامتحان: ' + examId + '                     ║');
  parts.push('╚══════════════════════════════════════════════╝');
  parts.push('');
  parts.push('لكل سؤال، اكتب:');
  parts.push('• رقم السؤال والإجابة الصحيحة.');
  parts.push('• شرح تربوي مختصر (سطر أو سطران) يوضح لماذا هذه هي الإجابة الصحيحة.');
  parts.push('• لأسئلة MCQ: اشرح لماذا كل خيار آخر خاطئ وما الخطأ الشائع الذي يمثله.');
  parts.push('• لأسئلة "علل": اكتب السبب العلمي الكامل.');
  parts.push('• لأسئلة المسائل: اكتب خطوات الحل بالتفصيل.');
  parts.push('• لا تعرض الإجابات في نسخة الامتحان نفسها — فقط في هذا القسم المنفصل.');

  // ═══════════════════════════════════════════
  // SECTION 13: SCIENTIFIC TERMINOLOGY
  // ═══════════════════════════════════════════
  parts.push('\n═══ 🔬 المصطلحات العلمية ═══');
  parts.push('• حافظ على دقة المصطلحات العلمية كما وردت في المحتوى المرفوع.');
  parts.push('• لا تستبدل مصطلحاً علمياً بمرادف عامي.');
  parts.push('• إذا كان المصطلح له اختصار، اكتب الاسم الكامل ثم الاختصار بين قوسين.');

  // ═══════════════════════════════════════════
  // SECTION 14: EXTRACTED CONTENT
  // ═══════════════════════════════════════════
  if (extractedContent) {
    parts.push('\n═══ 📄 المحتوى التعليمي المستخرج (المصدر) ═══');
    parts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    parts.push(extractedContent);
    parts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  // ═══════════════════════════════════════════
  // SECTION 15: REQUIRED OUTPUT FORMAT
  // ═══════════════════════════════════════════
  parts.push('\n═══ 🎯 المخرجات المطلوبة (بهذا الترتيب) ═══');
  parts.push('1. نسخة الامتحان (بدون إجابات) — جاهزة للطباعة على A4 Portrait.');
  parts.push('   - ترويسة كاملة مع معرف: ' + examId);
  parts.push('   - أقسام مرقمة بوضوح (س1، س2، س3...)');
  parts.push('   - المستوى المعرفي [بين قوسين] بعد كل رقم سؤال');
  parts.push('   - مساحات للإجابة');
  parts.push('   - تذييل بأرقام الصفحات ومعرف الامتحان');
  parts.push('');
  parts.push('2. نموذج الإجابة والشرح التربوي (قسم منفصل قابل للفصل).');
  parts.push('   - إجابة صحيحة لكل سؤال');
  parts.push('   - شرح تربوي + تحليل الأخطاء الشائعة');
  parts.push('   - خطوات حل المسائل');
  parts.push('');
  parts.push('3. جدول توازن الأسئلة (Specification Table):');
  parts.push('   | السؤال | المستوى المعرفي | الدرس المصدر | الدرجة |');
  parts.push('   - تأكد أن مجموع الدرجات = ' + (tm || 'الدرجة المحددة') + ' درجة بالضبط.');
  parts.push('   - تأكد أن جميع الدروس مغطاة.');

  return parts.join('\n');
}

function generateExamId(examInfo: Partial<ExamLabExam>): string {
  const year = new Date().getFullYear();
  const subjectCode = (examInfo.subject || 'EX').slice(0, 2).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `Exam-${year}-${subjectCode}-${random}`;
}

// ============ QUALITY CHECK ============

export type QualityIssue = {
  type: 'duplicate' | 'ambiguous' | 'missing_answer' | 'multiple_correct' | 'marks_mismatch' | 'outside_content' | 'poor_distribution' | 'excessive_repetition';
  severity: 'warning' | 'error';
  message: string;
  questionIndex?: number;
};

export function checkQuestionQuality(questions: ExamLabQuestion[], totalMarks: number): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // 1. Duplicate questions
  const seen = new Set<string>();
  for (let i = 0; i < questions.length; i++) {
    const text = questions[i].question_text.trim().toLowerCase();
    if (seen.has(text)) {
      issues.push({
        type: 'duplicate',
        severity: 'warning',
        message: `السؤال ${i + 1} مكرر — نفس نص سؤال سابق`,
        questionIndex: i,
      });
    }
    seen.add(text);
  }

  // 2. Missing answers
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.correct_answer && q.question_type !== 'essay') {
      issues.push({
        type: 'missing_answer',
        severity: 'error',
        message: `السؤال ${i + 1} ليس له إجابة محددة`,
        questionIndex: i,
      });
    }
  }

  // 3. Multiple correct MCQ answers
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (q.question_type === 'mcq' && q.choices.length > 0) {
      // Check if correct_answer matches multiple choices
      const matches = q.choices.filter(c => c.trim().toLowerCase() === q.correct_answer.trim().toLowerCase());
      if (matches.length > 1) {
        issues.push({
          type: 'multiple_correct',
          severity: 'error',
          message: `السؤال ${i + 1} له أكثر من إجابة صحيحة محتملة`,
          questionIndex: i,
        });
      }
    }
  }

  // 4. Marks mismatch
  const sumMarks = questions.reduce((s, q) => s + (q.marks ?? 0), 0);
  if (totalMarks > 0 && sumMarks !== totalMarks) {
    issues.push({
      type: 'marks_mismatch',
      severity: 'error',
      message: `مجموع الدرجات (${sumMarks}) لا يساوي الدرجة النهائية (${totalMarks})`,
    });
  }

  // 5. Poor distribution (all questions from one lesson)
  const lessons = new Set(questions.map(q => q.source_lesson).filter(Boolean));
  if (questions.length > 5 && lessons.size === 1) {
    issues.push({
      type: 'poor_distribution',
      severity: 'warning',
      message: 'جميع الأسئلة من درس واحد — وزع الأسئلة على دروس متعددة',
    });
  }

  // 6. Excessive repetition of similar wording
  const starts = new Map<string, number>();
  for (const q of questions) {
    const start = q.question_text.slice(0, 20).trim().toLowerCase();
    starts.set(start, (starts.get(start) ?? 0) + 1);
  }
  for (const [start, count] of starts) {
    if (count > 3) {
      issues.push({
        type: 'excessive_repetition',
        severity: 'warning',
        message: `تكرار مفرط في بداية الأسئلة: "${start}..." (${count} مرات)`,
      });
    }
  }

  return issues;
}
