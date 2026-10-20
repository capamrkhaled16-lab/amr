// Exam AI Generate v2 — strict per-type generation, count enforcement, Arabic gate
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface QuestionTypeCounts {
  [key: string]: number;
}

interface ExamInfo {
  exam_title?: string;
  subject?: string;
  grade_name?: string;
  teacher_name?: string;
  center_name?: string;
  book_name?: string;
  unit_name?: string;
  chapter_name?: string;
  duration_minutes?: number | null;
  total_marks?: number | null;
}

interface GenerateRequest {
  extractedContent: string;
  examInfo: ExamInfo;
  questionTypes: QuestionTypeCounts;
  difficulty: string;
  totalQuestions: number;
  totalMarks: number;
  lessons: string;
  images?: string[];
  sourceMode?: "notes" | "bank" | "transcribe";
  aiAction?: "extract" | "to_mcq" | "to_essay" | "to_true_false" | "generate_answers" | "rephrase" | "generate_similar" | "distribute_marks";
  selectedQuestions?: string[];
  totalMarksOverride?: number;
  preserveWording?: boolean;
  generateAnswerKey?: boolean;
}

interface GeneratedQuestion {
  question_text: string;
  question_type: string;
  marks: number;
  difficulty: string;
  source_lesson: string;
  choices: string[];
  correct_answer: string;
}

const TYPE_LABELS: Record<string, string> = {
  mcq: "اختيار من متعدد",
  true_false: "صح/خطأ",
  complete: "أكمل",
  explain: "علل",
  mention: "اذكر",
  define: "ما المقصود بـ",
  compare: "قارن",
  problem: "مسائل",
  essay: "مقالية",
  image_question: "رسومات/أشكال",
  order_match: "ترتيب/توصيل",
};

const MAX_RETRIES_PER_TYPE = 2;

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body: GenerateRequest = await req.json();
    const sourceMode = body.sourceMode || "notes";
    const hasImages = body.images && body.images.length > 0;
    const hasText = body.extractedContent && body.extractedContent.trim().length >= 10;

    if (!hasText && !hasImages) {
      return jsonResponse({ questions: [], warnings: ["لا يوجد محتوى تعليمي — ارفع ملفات أو صور تحتوي على نص تعليمي واضح."] });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || await getGeminiKeyFromDB();
    const useFallback = !GEMINI_API_KEY;

    const allQuestions: GeneratedQuestion[] = [];
    const warnings: string[] = [];
    const summary: { type: string; requested: number; generated: number }[] = [];
    const globalSeenTexts = new Set<string>();

    const requestedTypes = Object.entries(body.questionTypes || {}).filter(([, c]) => c && c > 0);

    // ── Bank direct-ingestion path: no type counts provided, parse questions as-is ──
    if ((sourceMode === "bank" || sourceMode === "transcribe") && requestedTypes.length === 0) {
      let bankQuestions: GeneratedQuestion[] = [];

      if (useFallback) {
        bankQuestions = parseBankQuestionsLocal(body.extractedContent || "", body, globalSeenTexts);
      } else if (sourceMode === "transcribe") {
        bankQuestions = await generateTranscription(body, GEMINI_API_KEY!, globalSeenTexts);
        if (bankQuestions.length === 0) {
          bankQuestions = parseBankQuestionsLocal(body.extractedContent || "", body, globalSeenTexts);
        }
      } else {
        bankQuestions = await generateBankDirectIngestion(body, GEMINI_API_KEY!, globalSeenTexts);
        if (bankQuestions.length === 0) {
          bankQuestions = parseBankQuestionsLocal(body.extractedContent || "", body, globalSeenTexts);
        }
      }

      const detectedTypes = new Set(bankQuestions.map((q) => q.question_type));
      for (const t of detectedTypes) {
        const count = bankQuestions.filter((q) => q.question_type === t).length;
        summary.push({ type: t, requested: count, generated: count });
      }

      if (bankQuestions.length === 0) {
        warnings.push("لم يتم العثور على أسئلة واضحة في المحتوى المرفوع. تأكد من أن النص يحتوي على أسئلة فعلية.");
      }

      if (useFallback && bankQuestions.length > 0) {
        warnings.unshift("تم استخراج الأسئلة باستخدام المحرك المحلي. لإضافة ذكاء اصطناعي متقدم، يمكن إضافة مفتاح Gemini API من الإعدادات — وهو اختياري.");
      }

      return jsonResponse({
        questions: bankQuestions,
        warnings,
        summary: summary.map((s) => ({
          type: s.type,
          label: TYPE_LABELS[s.type] || s.type,
          requested: s.requested,
          generated: s.generated,
        })),
        allMatch: bankQuestions.length > 0,
      });
    }

    for (const [qType, count] of requestedTypes) {
      const needed = count as number;

      // Skip image_question type if no images were uploaded — generate essay instead
      if (qType === "image_question" && !hasImages) {
        warnings.push(`لا توجد صور مرفوعة — تم تخطي أسئلة الأشكال. أرفع صوراً للحصول على أسئلة شكلية.`);
        summary.push({ type: qType, requested: needed, generated: 0 });
        continue;
      }

      let generated: GeneratedQuestion[] = [];

      if (useFallback) {
        const raw = await generateLocalFallback(body, qType, needed, globalSeenTexts);
        generated = validateAndFilter(raw, qType, needed, globalSeenTexts);
        // Retry once with more sentences if validation rejected some
        if (generated.length < needed) {
          const deficit = needed - generated.length;
          const retryRaw = await generateLocalFallback(body, qType, deficit, globalSeenTexts);
          generated.push(...validateAndFilter(retryRaw, qType, deficit, globalSeenTexts));
        }
      } else {
        // generateTypeBatch already calls validateAndFilter internally
        generated = await generateTypeBatch(body, qType, needed, GEMINI_API_KEY!, sourceMode, globalSeenTexts);
        let attempt = 0;
        while (generated.length < needed && attempt < MAX_RETRIES_PER_TYPE) {
          attempt++;
          const deficit = needed - generated.length;
          const retryBatch = await generateTypeBatch(body, qType, deficit, GEMINI_API_KEY!, sourceMode, globalSeenTexts);
          generated.push(...retryBatch);
        }
        if (generated.length < needed) {
          const deficit = needed - generated.length;
          const fbRaw = await generateLocalFallback(body, qType, deficit, globalSeenTexts);
          generated.push(...validateAndFilter(fbRaw, qType, deficit, globalSeenTexts));
        }
      }

      generated = generated.slice(0, needed);
      allQuestions.push(...generated);
      summary.push({ type: qType, requested: needed, generated: generated.length });

      if (generated.length < needed) {
        const label = TYPE_LABELS[qType] || qType;
        warnings.push(
          `تعذر إنشاء ${needed - generated.length} سؤال إضافي من نوع "${label}" من المحتوى المرفوع. تم إنشاء ${generated.length}/${needed}. يرجى إضافة محتوى أكثر أو تعديل النوع.`,
        );
      }
    }

    if (useFallback && allQuestions.length > 0) {
      warnings.unshift("تم توليد الأسئلة باستخدام المحرك المحلي من المحتوى المرفوع. لإضافة ذكاء اصطناعي متقدم، يمكن إضافة مفتاح Gemini API من الإعدادات — وهو اختياري.");
    }

    const allMatch = summary.every((s) => s.generated === s.requested);

    return jsonResponse({
      questions: allQuestions,
      warnings: allMatch ? [] : warnings,
      summary: summary.map((s) => ({
        type: s.type,
        label: TYPE_LABELS[s.type] || s.type,
        requested: s.requested,
        generated: s.generated,
      })),
      allMatch,
    });
  } catch (err) {
    return jsonResponse({
      questions: [],
      warnings: [`خطأ في المعالجة: ${err instanceof Error ? err.message : "خطأ غير معروف"}`],
    });
  }
});

// ============ DB FALLBACK FOR GEMINI KEY ============
async function getGeminiKeyFromDB(): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return null;
    const res = await fetch(`${supabaseUrl}/rest/v1/settings?select=gemini_api_key&limit=1`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0].gemini_api_key) {
      return data[0].gemini_api_key as string;
    }
    return null;
  } catch {
    return null;
  }
}

// ============ LOCAL FALLBACK GENERATOR (no API key needed) ============
// Generates questions directly from the extracted text using sentence-splitting
// and type-specific transformation rules. Respects each question type strictly.
async function generateLocalFallback(
  body: GenerateRequest,
  qType: string,
  count: number,
  seenTexts: Set<string>,
): Promise<GeneratedQuestion[]> {
  const content = (body.extractedContent || "").trim();
  if (content.length < 10) return [];

  const sentences = content
    .split(/[.\n؟!؛،]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15 && /[\u0600-\u06FF]/.test(s));

  if (sentences.length === 0) return [];

  // Deterministic shuffle from content
  const shuffled = [...sentences];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const hash = content.charCodeAt(i % content.length) + i * 31;
    const j = hash % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const results: GeneratedQuestion[] = [];
  let sentenceIdx = 0;

  // Request more sentences than needed to account for validation rejections
  const requestCount = Math.min(count * 2, shuffled.length);
  for (let i = 0; i < requestCount && sentenceIdx < shuffled.length; i++) {
    const sentence = shuffled[sentenceIdx++];
    let q: GeneratedQuestion | null = null;

    switch (qType) {
      case "mcq":
        q = makeMCQFromSentence(sentence, body, i);
        break;
      case "true_false":
        q = makeTrueFalseFromSentence(sentence, body, i);
        break;
      case "complete":
      case "fill_blank":
        q = makeCompleteFromSentence(sentence, body, i);
        break;
      case "explain":
        q = makeExplainFromSentence(sentence, body, i);
        break;
      case "mention":
      case "short_answer":
        q = makeMentionFromSentence(sentence, body, i);
        break;
      case "define":
        q = makeDefineFromSentence(sentence, body, i);
        break;
      case "compare":
        q = makeCompareFromSentence(sentence, body, i);
        break;
      case "problem":
        q = makeProblemFromSentence(sentence, body, i);
        break;
      case "essay":
        q = makeEssayFromSentence(sentence, body, i);
        break;
      case "image_question":
        q = makeImageQuestionFromSentence(sentence, body, i);
        break;
      case "order_match":
        q = makeOrderMatchFromSentence(sentence, body, i);
        break;
      default:
        q = makeEssayFromSentence(sentence, body, i);
    }

    if (q) {
      const text = sanitizeArabicText(q.question_text);
      if (text.length < 5) continue;
      const textKey = text.slice(0, 80).toLowerCase();
      if (seenTexts.has(textKey)) {
        continue;
      }
      // Do NOT add to seenTexts here — validateAndFilter owns that responsibility.
      // Adding here would cause validateAndFilter to reject all results as duplicates.
      q.question_text = text;
      q.question_type = qType;
      q.difficulty = normalizeDifficulty(body.difficulty);
      q.source_lesson = sanitizeArabicText(body.lessons || "");
      results.push(q);
      if (results.length >= count) break;
    }
  }

  return results;
}

// Stopwords excluded from keyword extraction to pick meaningful scientific terms
const ARABIC_STOPWORDS = new Set([
  "الذي", "التي", "الذين", "اللاتي", "اللاتي", "هذا", "هذه", "ذلك", "تلك",
  "عن", "من", "في", "على", "إلى", "حتى", "مع", "بين", "أو", "إما",
  "قد", "كان", "كانت", "يكون", "تكون", "هو", "هي", "هم", "هن",
  "ما", "ماذا", "لماذا", "كيف", "أين", "متى", "كم", "أي",
  "ال", "لا", "لم", "لن", "إن", "أن", "إذ", "إذا",
  "بعض", "كل", "جميع", "كافة", "غير", "سوى",
  "عند", "عندما", "حيث", "بحيث", "كما", "وقد", "وأن", "وفي",
  "أيضا", "فقط", "وحده", "ذاته", "ذاتها",
  "يكون", "تكون", "أصبح", "أصبحت", "ظل", "ظلت", "صار", "صارت",
  "يجب", "يمكن", "تستطيع", "يستطيع",
  "مثل", "أمام", "خلف", "فوق", "تحت", "يمين", "يسار",
  "بعد", "قبل", "خلال", "أثناء", "رغم", "ربما",
  "تم", "تمت", "يتم", "تتم", "نجد", "نرى",
]);

function extractKeyword(sentence: string): { keyword: string; rest: string } {
  const words = sentence
    .split(/\s+/)
    .filter((w) => w.length >= 4 && /[\u0600-\u06FF]/.test(w))
    .filter((w) => !ARABIC_STOPWORDS.has(w.replace(/^(?:ال|وال|بال|لل|في|من|على|إلى)/, "")));
  if (words.length === 0) return { keyword: "", rest: sentence };
  // Pick the most meaningful term: longest, but prefer nouns (not verbs)
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const keyword = sorted[0];
  const rest = sentence.replace(keyword, "______");
  return { keyword, rest };
}

// Extract multiple significant terms from a sentence for MCQ distractors
function extractSignificantTerms(content: string, exclude: string, maxCount: number): string[] {
  return content
    .split(/\s+/)
    .filter((w) => w.length >= 4 && /[\u0600-\u06FF]/.test(w) && w !== exclude)
    .filter((w) => !ARABIC_STOPWORDS.has(w.replace(/^(?:ال|وال|بال|لل|في|من|على|إلى)/, "")))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => b.length - a.length)
    .slice(0, maxCount);
}

function makeMCQFromSentence(sentence: string, body: GenerateRequest, idx: number): GeneratedQuestion | null {
  const { keyword } = extractKeyword(sentence);
  if (!keyword) return null;
  const questionText = `اختر الإجابة الصحيحة مما بين الأقواس: ${sentence.replace(keyword, "(______)")}`;
  const distractors = extractSignificantTerms(body.extractedContent || "", keyword, 3);
  if (distractors.length < 2) return null;
  const choices = [keyword, ...distractors].slice(0, 4);
  for (let i = choices.length - 1; i > 0; i--) {
    const j = (idx + i * 7) % (i + 1);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return {
    question_text: questionText,
    question_type: "mcq",
    marks: 2,
    difficulty: normalizeDifficulty(body.difficulty),
    source_lesson: "",
    choices,
    correct_answer: keyword,
  };
}

function makeTrueFalseFromSentence(sentence: string, _body: GenerateRequest, idx: number): GeneratedQuestion | null {
  const isTrue = idx % 2 === 0;
  if (isTrue) {
    return { question_text: sentence, question_type: "true_false", marks: 1, difficulty: "medium", source_lesson: "", choices: [], correct_answer: "صح" };
  } else {
    // Create a plausible false statement by inserting a negation
    const negated = sentence.replace(/^(ال\S+)/, "$1 لا");
    const falseText = negated !== sentence && negated.length > 10
      ? negated
      : sentence.replace(/\s+ي\S+\s/, " لا ");
    return { question_text: falseText.length > 10 ? falseText : `${sentence} (عبارة خاطئة)`, question_type: "true_false", marks: 1, difficulty: "medium", source_lesson: "", choices: [], correct_answer: "خطأ" };
  }
}

function makeCompleteFromSentence(sentence: string, body: GenerateRequest, _idx: number): GeneratedQuestion | null {
  const { keyword, rest } = extractKeyword(sentence);
  if (!keyword) return null;
  return { question_text: rest, question_type: "complete", marks: 1, difficulty: normalizeDifficulty(body.difficulty), source_lesson: "", choices: [], correct_answer: keyword };
}

function makeExplainFromSentence(sentence: string, _body: GenerateRequest, _idx: number): GeneratedQuestion | null {
  // Rephrase as a "why" question that requires a causal explanation
  const whyText = sentence.replace(/^([^،؛.]+)(.*)/, "علل لما يأتي: $1$2");
  return { question_text: whyText, question_type: "explain", marks: 2, difficulty: "medium", source_lesson: "", choices: [], correct_answer: `لأن ${sentence}` };
}

function makeMentionFromSentence(sentence: string, _body: GenerateRequest, _idx: number): GeneratedQuestion | null {
  const words = sentence.split(/\s+/).filter((w) => w.length >= 3);
  return { question_text: `اذكر العناصر الرئيسية الواردة في العبارة التالية: "${sentence}"`, question_type: "mention", marks: 2, difficulty: "easy", source_lesson: "", choices: [], correct_answer: words.slice(0, 4).join("، ") };
}

function makeDefineFromSentence(sentence: string, _body: GenerateRequest, _idx: number): GeneratedQuestion | null {
  const { keyword } = extractKeyword(sentence);
  if (!keyword) return null;
  // Use the full sentence as the definition from the source
  return { question_text: `ما المقصود بـ \u201c${keyword}\u201d؟`, question_type: "define", marks: 2, difficulty: "medium", source_lesson: "", choices: [], correct_answer: sentence };
}

function makeCompareFromSentence(sentence: string, _body: GenerateRequest, _idx: number): GeneratedQuestion | null {
  // Extract two significant terms for comparison
  const terms = extractSignificantTerms(sentence, "", 2);
  if (terms.length < 2) return null;
  return { question_text: `قارن بين \u201c${terms[0]}\u201d و \u201c${terms[1]}\u201d من حيث المفهوم والخصائص كما ورد في المحتوى.`, question_type: "compare", marks: 3, difficulty: "medium", source_lesson: "", choices: [], correct_answer: sentence };
}

function makeProblemFromSentence(sentence: string, _body: GenerateRequest, _idx: number): GeneratedQuestion | null {
  return { question_text: `بناءً على العبارة التالية، حل المسألة المطلوبة موضحاً خطوات الحل: "${sentence}"`, question_type: "problem", marks: 3, difficulty: "hard", source_lesson: "", choices: [], correct_answer: sentence };
}

function makeEssayFromSentence(sentence: string, _body: GenerateRequest, _idx: number): GeneratedQuestion | null {
  // Reformulate as an analytical essay prompt
  return { question_text: `تحدث بإسهاب عن ما يلي مع ذكر الأمثلة من المحتوى: ${sentence}`, question_type: "essay", marks: 3, difficulty: "hard", source_lesson: "", choices: [], correct_answer: sentence };
}

function makeImageQuestionFromSentence(sentence: string, _body: GenerateRequest, _idx: number): GeneratedQuestion | null {
  const { keyword } = extractKeyword(sentence);
  const label = keyword || "الشكل";
  return { question_text: `تأمل الشكل المقابل الذي يمثل \u201c${label}\u201d ثم أجب عن المطلوب موضحاً إجابتك.`, question_type: "image_question", marks: 2, difficulty: "medium", source_lesson: "", choices: [], correct_answer: sentence };
}

function makeOrderMatchFromSentence(sentence: string, _body: GenerateRequest, _idx: number): GeneratedQuestion | null {
  const terms = extractSignificantTerms(sentence, "", 4);
  if (terms.length < 2) return null;
  return { question_text: `صل بين كل عنصر في القائمة (أ) وما يناسبه في القائمة (ب):\nالقائمة (أ): ${terms.join("، ")}`, question_type: "order_match", marks: 2, difficulty: "medium", source_lesson: "", choices: [], correct_answer: terms.join("، ") };
}

// ============ PER-TYPE BATCH GENERATION ============
async function generateTypeBatch(
  body: GenerateRequest,
  qType: string,
  count: number,
  apiKey: string,
  sourceMode: "notes" | "bank",
  seenTexts: Set<string>,
): Promise<GeneratedQuestion[]> {
  const prompt = buildTypeSpecificPrompt(body, qType, count, sourceMode);
  const parts: { text?: string; inline_data?: { mime_type: string; data: string } }[] = [];
  parts.push({ text: prompt });

  if (body.images && body.images.length > 0) {
    const maxImages = Math.min(body.images.length, 3);
    for (let i = 0; i < maxImages; i++) {
      parts.push({ inline_data: { mime_type: "image/png", data: body.images[i] } });
    }
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: sourceMode === "bank" ? 0.3 : 0.7,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!response.ok) return [];

    const data = await response.json();
    const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) return [];

    let raw: GeneratedQuestion[] = [];
    try {
      const parsed = JSON.parse(textContent);
      raw = Array.isArray(parsed.questions) ? parsed.questions : Array.isArray(parsed) ? parsed : [];
    } catch {
      const jsonMatch = textContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try { raw = JSON.parse(jsonMatch[0]); } catch { return []; }
      }
    }

    // Force the requested type on every question — no silent type changes
    for (const q of raw) {
      q.question_type = qType;
    }

    return validateAndFilter(raw, qType, count, seenTexts);
  } catch {
    return [];
  }
}

// ============ TYPE-SPECIFIC PROMPTS ============
function buildTypeSpecificPrompt(
  req: GenerateRequest,
  qType: string,
  count: number,
  sourceMode: "notes" | "bank",
): string {
  const label = TYPE_LABELS[qType] || qType;
  const parts: string[] = [];

  parts.push("أنت خبير تربوي متخصص في تصميم الامتحانات التعليمية العربية بمستوى احترافي عالي.");
  parts.push("مهمتك: توليد أسئلة امتحان من المحتوى التعليمي المرفق فقط.");
  parts.push("لا تخترع معلومات غير موجودة في المحتوى.");
  parts.push("كل سؤال يجب أن يكون مبنياً على معلومة فعلية موجودة في النص.");
  parts.push("اكتب جميع الأسئلة بالعربية الفصحى الواضحة. لا تستخدم كلمات إنجليزية أو حروف لاتينية.");
  parts.push("يجب أن تكون الأسئلة ذات جودة علمية عالية تعكس فهم عميق للمنهج — لا أسئلة سطحية أو عامة.");
  parts.push("تجنب تماماً أسماء الملفات أو مسارات الصور أو أي نصوص غير عربية داخل الأسئلة أو الخيارات.");
  parts.push("اجعل جميع النصوص بالعربية الفصحى مع التزام كامل باتجاه الكتابة من اليمين إلى اليسار (RTL).");
  parts.push("");
  parts.push(`═══ نوع الأسئلة المطلوب: ${label} ═══`);
  parts.push(`عدد الأسئلة المطلوب بالضبط: ${count}`);
  parts.push(`لا تنشئ أي سؤال من نوع آخر. كل الأسئلة يجب أن تكون من نوع "${label}" فقط.`);
  parts.push("محظورات صارمة:");
  parts.push("- لا تحول أي سؤال إلى نوع مختلف عما طُلب.");
  parts.push("- لا تستخدم صيغة 'أكمل' في أسئلة الاختيار أو الصح/خطأ أو التعريف.");
  parts.push("- لا تستخدم صيغة 'اختيار من متعدد' في أسئلة العلل أو التعريف أو المقالية.");
  parts.push("- كل سؤال يجب أن يطابق نوعه تماماً في الصياغة والبنية.");
  parts.push("");

  // Type-specific instructions
  switch (qType) {
    case "mcq":
      parts.push("تعليمات أسئلة الاختيار من متعدد:");
      parts.push("- اكتب سؤالاً واضحاً ومحدداً.");
      parts.push("- وفر 4 خيارات (أ، ب، ج، د).");
      parts.push("- إجابة صحيحة واحدة فقط.");
      parts.push("- لا تجعل الإجابة الصحيحة دائماً في نفس الموقع.");
      parts.push("- الخيارات الخاطئة يجب أن تكون منطقية وقابلة للاعتقاد.");
      parts.push("- متساوية الطول تقريباً.");
      break;
    case "true_false":
      parts.push("تعليمات أسئلة الصح والخطأ:");
      parts.push("- اكتب عبارة علمية واضحة صحيحة أو خاطئة.");
      parts.push('- correct_answer يجب أن تكون "صح" أو "خطأ".');
      parts.push("- choices فارغة.");
      parts.push("- تأكد من صحة العبارة يقيناً.");
      break;
    case "complete":
      parts.push("تعليمات أسئلة أكمل:");
      parts.push("- اكتب جملة علمية صحيحة بها فراغ واضح باستخدام ______.");
      parts.push("- الفراغ يجب أن يكون على الكلمة المفتاحية.");
      parts.push("- لا تحولها إلى سؤال اختيار من متعدد.");
      parts.push("- لا تستخدم أكثر من فراغ واحد.");
      parts.push("- correct_answer هو الكلمة الناقصة.");
      parts.push("- choices فارغة.");
      break;
    case "explain":
      parts.push("تعليمات أسئلة علل:");
      parts.push('- صياغة سؤال "علل" أو "لماذا" أو "اذكر السبب".');
      parts.push("- الإجابة يجب أن تكون سبباً علمياً مباشراً ومختصراً.");
      parts.push("- لا تحولها إلى اختيار من متعدد أو أكمل.");
      parts.push("- choices فارغة.");
      break;
    case "mention":
      parts.push("تعليمات أسئلة اذكر:");
      parts.push('- صياغة سؤال "اذكر" أو "عدد".');
      parts.push("- الإجابة قائمة بعناصر محددة من المحتوى.");
      parts.push("- choices فارغة.");
      break;
    case "define":
      parts.push("تعليمات أسئلة التعريف / ما المقصود:");
      parts.push('- صياغة سؤال "ما المقصود بـ" أو "عرّف".');
      parts.push("- الإجابة تعريف علمي دقيق.");
      parts.push('- لا تحولها إلى "أكمل" أو اختيار من متعدد.');
      parts.push("- choices فارغة.");
      break;
    case "compare":
      parts.push("تعليمات أسئلة المقارنة:");
      parts.push("- صياغة سؤال مقارنة بين مفهومين أو أكثر.");
      parts.push("- الإجابة ذكر أوجه التشابه والاختلاف.");
      parts.push("- choices فارغة.");
      break;
    case "problem":
      parts.push("تعليمات أسئلة المسائل:");
      parts.push("- صياغة مسألة حسابية أو تطبيقية مبنية على المحتوى.");
      parts.push("- الإجابة خطوات الحل والنتيجة النهائية.");
      parts.push("- choices فارغة.");
      break;
    case "essay":
      parts.push("تعليمات الأسئلة المقالية:");
      parts.push("- سؤال يحتاج إجابة تفسيرية أو وصفية مطولة.");
      parts.push("- لا تختصره إلى سؤال قصير من نوع آخر.");
      parts.push("- choices فارغة.");
      break;
    case "image_question":
      parts.push("تعليمات أسئلة الرسومات والأشكال:");
      parts.push("- السؤال متعلق برسم أو شكل أو تسمية أجزاء أو تفسير رسم.");
      parts.push("- إذا كان المحتوى لا يحتوي على رسومات، اكتب سؤالاً قابلاً للتنفيذ عن مفهوم بصري من الدرس.");
      parts.push("- لا تستبدل الرسم بـ أكمل.");
      parts.push("- choices فارغة.");
      break;
    case "order_match":
      parts.push("تعليمات أسئلة الترتيب والتوصيل:");
      parts.push("- صياغة سؤال ترتيب أو توصيل بين عناصر.");
      parts.push("- choices فارغة. correct_answer تحتوي على الترتيب الصحيح.");
      break;
  }

  parts.push("");
  if (req.examInfo.subject) parts.push(`المادة: ${req.examInfo.subject}`);
  if (req.examInfo.grade_name) parts.push(`الصف: ${req.examInfo.grade_name}`);
  if (req.difficulty) parts.push(`مستوى الصعوبة: ${req.difficulty}`);
  if (req.lessons) parts.push(`الدروس: ${req.lessons}`);

  parts.push("");
  parts.push("═══ المحتوى التعليمي المصدر ═══");
  parts.push(req.extractedContent || "(الصور المرفقة تحتوي على المحتوى)");

  parts.push("");
  parts.push('أرجع JSON بهذا الشكل:');
  const jsonTemplate = qType === "mcq"
    ? '{"questions": [{"question_text": "...", "question_type": "mcq", "marks": 2, "difficulty": "medium", "source_lesson": "", "choices": ["خيار أ", "خيار ب", "خيار ج", "خيار د"], "correct_answer": "خيار أ"}]}'
    : `{"questions": [{"question_text": "...", "question_type": "${qType}", "marks": 2, "difficulty": "medium", "source_lesson": "", "choices": [], "correct_answer": "..."}]}`;
  parts.push(jsonTemplate);

  return parts.join("\n");
}

// ============ ARABIC SANITIZATION (Expert-Grade) ============
function sanitizeArabicText(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();
  // Remove mojibake / corrupted byte sequences
  cleaned = cleaned.replace(/[\ufffd\u00ef\u00bf\u00bd]/g, "");
  // Remove BOM and invisible / control / BIDI marks
  cleaned = cleaned.replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff\u00a0\u202a-\u202e]/g, "");
  // Remove image filenames and screenshot artifacts (Samsung_..., Screenshot_..., IMG_..., etc.)
  cleaned = cleaned.replace(/(?:Samsung_[A-Za-z0-9_]+|Screenshot_[A-Za-z0-9_]+|IMG_[A-Za-z0-9_]+|DSC_[A-Za-z0-9_]+|image\d*|\.(?:png|jpg|jpeg|gif|bmp|webp|pdf|docx?))[^\u0600-\u06FF]*/gi, "");
  // Remove file paths and storage URLs
  cleaned = cleaned.replace(/(?:blob:|data:|https?:\/\/)[^\u0600-\u06FF\s]*/gi, "");
  cleaned = cleaned.replace(/[A-Za-z]:\\[^\u0600-\u06FF\s]*/gi, "");
  // Remove "GRIER" and other known OCR garbage tokens
  cleaned = cleaned.replace(/\b(?:GRIER|GREIER|GRIER_|grier)\b/gi, "");
  // Remove dashed line artifacts (------, ----, ----...) when mixed into Arabic
  cleaned = cleaned.replace(/(?<=[\u0600-\u06FF])\s*-{2,}\s*(?=[\u0600-\u06FF]|$)/g, " ");
  cleaned = cleaned.replace(/^-{2,}$/gm, "");
  // Remove stray short Latin word fragments (OCR noise) — keep legitimate uppercase science terms (DNA, ATP)
  cleaned = cleaned.replace(/(?<![\u0600-\u06FFa-zA-Z])[a-z]{1,4}(?:\s+[a-z]{1,4}){0,2}(?![\u0600-\u06FFa-zA-Z])/g, "");
  // Remove stray Latin characters mixed inside Arabic text (common OCR artifacts)
  cleaned = cleaned.replace(/(?<=[\u0600-\u06FF])[a-zA-Z]+(?=[\u0600-\u06FF\s،؛؟.])/g, "");
  // Remove replacement chars and unknown symbols
  cleaned = cleaned.replace(/[\uFFFD\uFE0F\u200D]/g, "");
  // Remove excessive underscores left from blank removals
  cleaned = cleaned.replace(/_{3,}(?!\s)/g, "______");
  // Normalize multiple spaces
  cleaned = cleaned.replace(/\s{2,}/g, " ");
  // Fix spacing around Arabic punctuation
  cleaned = cleaned.replace(/\s*([،؛؟!])\s*/g, "$1 ");
  cleaned = cleaned.replace(/\s*([()\[\]{}])/g, " $1 ");
  // Remove empty quotes left after artifact removal
  cleaned = cleaned.replace(/[""\u201c\u201d]\s*[""\u201c\u201d]/g, "");
  // Remove leading/trailing whitespace per line, drop empty lines
  cleaned = cleaned.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).join("\n");
  return cleaned.trim();
}

// ============ VALIDATION & DEDUP ============

// Detect accidental word repetition: "كلمة كلمة" or phrase repetition
function hasRepetition(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => w.length >= 3);
  // Check consecutive duplicate words
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] === words[i + 1]) return true;
  }
  // Check 2-word phrase repeated consecutively
  for (let i = 0; i < words.length - 3; i++) {
    if (words[i] === words[i + 2] && words[i + 1] === words[i + 3]) return true;
  }
  // Check same word 3+ times in a short window
  const windowSize = 8;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let count = 0;
    for (let j = i; j < Math.min(i + windowSize, words.length); j++) {
      if (words[j] === w) count++;
    }
    if (count >= 3 && w.length >= 4) return true;
  }
  return false;
}

// Detect truncated or incomplete questions
function isTruncated(text: string, qType: string): boolean {
  const trimmed = text.trim();
  // Too short for any meaningful question
  const minLen = qType === "essay" ? 15 : qType === "explain" ? 12 : 10;
  if (trimmed.length < minLen) return true;
  // Starts with broken markdown / parser artifacts
  if (/^[\|\*\-#\>]/.test(trimmed)) return true;
  // Ends abruptly mid-word (no terminal punctuation and very short)
  if (trimmed.length < 20 && !/[.!؟،؛:]$/.test(trimmed)) return true;
  // Contains unmatched formatting markers
  if (/\*[^*]*$/.test(trimmed) || /\|[^|]*$/.test(trimmed)) return true;
  // Contains broken JSON artifacts
  if (/[{}[\]:,""]/.test(trimmed) && !/[\u0600-\u06FF]/.test(trimmed.slice(0, 10))) return true;
  return false;
}

// Check if any filename/path artifacts remain
function hasFilenameArtifacts(text: string): boolean {
  if (/Samsung_|Screenshot_|IMG_|DSC_|image\d*\./i.test(text)) return true;
  if (/(?:blob:|data:|https?:\/\/)[^\s\u0600-\u06FF]/i.test(text)) return true;
  if (/\.(?:png|jpg|jpeg|gif|bmp|webp|pdf|docx?)\b/i.test(text)) return true;
  if (/\bGRIER\b/i.test(text)) return true;
  if (/-{3,}/.test(text)) return true;
  return false;
}

function validateAndFilter(
  raw: GeneratedQuestion[],
  qType: string,
  count: number,
  seenTexts: Set<string>,
): GeneratedQuestion[] {
  const valid: GeneratedQuestion[] = [];

  for (const q of raw) {
    const text = sanitizeArabicText(q.question_text || "");
    if (text.length < 5) continue;

    // Arabic quality gate — reject if text has too many non-Arabic chars
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabicChars < text.length * 0.3) continue;

    // Filename/path artifact gate
    if (hasFilenameArtifacts(text)) continue;

    // Repetition gate
    if (hasRepetition(text)) continue;

    // Truncation gate
    if (isTruncated(text, qType)) continue;

    // Dedup within this batch and globally
    const textKey = text.slice(0, 80).toLowerCase();
    if (seenTexts.has(textKey)) continue;
    seenTexts.add(textKey);

    const normalized: GeneratedQuestion = {
      question_text: text,
      question_type: qType,
      marks: q.marks && q.marks > 0 ? q.marks : qType === "mcq" ? 2 : 1,
      difficulty: normalizeDifficulty(q.difficulty),
      source_lesson: sanitizeArabicText(q.source_lesson || ""),
      choices: [],
      correct_answer: "",
    };

    if (qType === "mcq") {
      const choices = Array.isArray(q.choices)
        ? q.choices.filter((c) => c && c.trim().length > 0).map((c) => sanitizeArabicText(c))
        : [];
      if (choices.length < 2) continue;
      // Validate choices for artifacts too
      if (choices.some((c) => hasFilenameArtifacts(c) || hasRepetition(c))) continue;
      normalized.choices = choices.slice(0, 4);
      if (q.correct_answer && choices.includes(q.correct_answer)) {
        normalized.correct_answer = q.correct_answer;
      } else if (q.correct_answer) {
        const match = choices.find((c) => c.trim() === q.correct_answer.trim());
        normalized.correct_answer = match || choices[0];
      } else {
        normalized.correct_answer = choices[0];
      }
    } else if (qType === "true_false") {
      const ans = (q.correct_answer || "").trim();
      normalized.correct_answer =
        ans === "صح" || ans === "خطأ" || ans === "true" || ans === "false"
          ? ans === "true" ? "صح" : ans === "false" ? "خطأ" : ans
          : "صح";
    } else {
      const answer = sanitizeArabicText(q.correct_answer || "");
      if (hasFilenameArtifacts(answer) || hasRepetition(answer)) continue;
      normalized.correct_answer = answer;
    }

    valid.push(normalized);
    if (valid.length >= count) break;
  }

  return valid;
}

function normalizeDifficulty(diff: string): string {
  const valid = ["easy", "medium", "hard", "mixed"];
  if (!diff) return "medium";
  const lower = diff.toLowerCase().trim();
  if (valid.includes(lower)) return lower;
  if (lower.includes("سهل") || lower.includes("easy")) return "easy";
  if (lower.includes("صعب") || lower.includes("hard")) return "hard";
  return "medium";
}

// ═══════════════════════════════════════════════════════════
// BANK DIRECT-INGESTION: parse raw questions from uploaded content
// ═══════════════════════════════════════════════════════════

// Patterns that indicate the start of a new question
const QUESTION_START_PATTERNS = [
  /(?:^|\n)\s*(?:سؤال\s*)?(?:ال)?س[ؤا]ال[\s\-)]*(\d+|[أ-ي])/i,
  /(?:^|\n)\s*(?:ال)?س[ؤا]ال\s+(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/i,
  /(?:^|\n)\s*(\d+)\s*[\.\)\-:]\s+/,
  /(?:^|\n)\s*([أ-ي])\s*[\.\)\-:]\s+/,
  /(?:^|\n)\s*(?:اختر|أختر|اكمل|أكمل|علل|اذكر|عرف|عرّف|قارن|اشرح|حل|أجب|اجب)/i,
  /(?:^|\n)\s*(?:ضع\s+علامة|صح\s+أم\s+خطأ|أمامك|بين\s*الأقواس)/i,
];

function detectQuestionType(text: string): string {
  const lower = text.trim();
  // MCQ: has choices like (أ) (ب) (ج) (د) or "اختر الإجابة"
  if (/(?:اختر|أختر)\s*(?:الإجابة|الاجابة|الصحيح)/i.test(lower)) return "mcq";
  if (/\([أ-ي]\)/.test(lower) && /\([ب-ي]\)/.test(lower)) return "mcq";
  // True/False
  if (/(?:صح\s*أم\s*خطأ|ضع\s+علامة|✓\s*أو\s*✗|صحيحة\s*أم\s*خاطئة)/i.test(lower)) return "true_false";
  // Complete / Fill in the blank
  if (/(?:أكمل|اكمل|أكمل\s+الفراغات?|ضع\s+كلمة|املأ\s+الفراغ|أعرب|اكمل\s+الجدول)/i.test(lower)) return "fill_blank";
  // Fill blank with underscores
  if (/_{3,}|\.+\s*\.+/.test(lower) && !/(?:صح|خطأ|اختر)/i.test(lower)) return "fill_blank";
  // Explain / Why
  if (/(?:علل|لماذا|اذكر\s+السبب|ما\s+السبب)/i.test(lower)) return "explain";
  // Short answer: اذكر/عدد/اكتب/ما هي/ما نوع
  if (/(?:اذكر|عدد\s+الأ|اكتب\s+الأ|ما\s+هي|ما\s+نوع|ما\s+اسم)/i.test(lower) && !/(?:علل|لماذا|قارن|اشرح)/i.test(lower)) return "short_answer";
  // Define
  if (/(?:عر[فّ]|ما\s+المقصود|عرّف\s+بـ|التعريف\s+بـ)/i.test(lower)) return "define";
  // Compare
  if (/(?:قارن\s+بين|اوضح\s+الفروق|اذكر\s+أوجه\s+الشبه|قارن)/i.test(lower)) return "compare";
  // Problem / Solve
  if (/(?:حل\s+المس[أا]لة|احسب|أحسب|مس[أا]لة\s+ح[سا]ابية|أوجد|اوجد)/i.test(lower)) return "problem";
  // Order / Match
  if (/(?:رت[بّ]|وص[لّ]|وصل\s+بين|طابق|طابقة|ضع\s+رقم)/i.test(lower)) return "order_match";
  // Image question
  if (/(?:أمامك\s+الشكل|الشكل\s+التالي|الرسم\s+التالي|انظر\s+إلى\s+الشكل)/i.test(lower)) return "image_question";
  // Default: essay
  return "essay";
}

function extractMCQChoices(questionText: string): { choices: string[]; correctAnswer: string; cleanText: string } {
  // Pattern 1: (أ) ... (ب) ... (ج) ... (د) ... with parentheses
  const choicePattern = /\(\s*([أ-ي])\s*\)\s*([^()\n]+)/g;
  const choices: string[] = [];
  let match;
  while ((match = choicePattern.exec(questionText)) !== null) {
    const t = sanitizeArabicText(match[2]);
    if (t.length > 0) choices.push(t);
  }
  if (choices.length >= 2) {
    const cleanText = sanitizeArabicText(questionText.replace(/\(\s*[أ-ي]\s*\)\s*[^()\n]+/g, "").trim());
    return { choices: choices.slice(0, 6), correctAnswer: choices[0], cleanText };
  }

  // Pattern 2: أ) ب) ج) د) without opening parenthesis
  const choicePattern2 = /([أ-ي])\)\s*([^\n]+)/g;
  const choices2: string[] = [];
  let match2;
  while ((match2 = choicePattern2.exec(questionText)) !== null) {
    const t = sanitizeArabicText(match2[2]);
    if (t.length > 0) choices2.push(t);
  }
  if (choices2.length >= 2) {
    const cleanText = sanitizeArabicText(questionText.replace(/[أ-ي]\)\s*[^\n]+/g, "").trim());
    return { choices: choices2.slice(0, 6), correctAnswer: choices2[0], cleanText };
  }

  // Pattern 3: أ- ب- ج- د- or أ. ب. ج. د. (dash or dot separator)
  const choicePattern3 = /(?:^|\n)\s*([أ-ي])\s*[-.\u2013]\s*([^\n]+)/g;
  const choices3: string[] = [];
  let match3;
  while ((match3 = choicePattern3.exec(questionText)) !== null) {
    const t = sanitizeArabicText(match3[2]);
    if (t.length > 0) choices3.push(t);
  }
  if (choices3.length >= 2) {
    const cleanText = sanitizeArabicText(questionText.replace(/(?:^|\n)\s*[أ-ي]\s*[-.\u2013]\s*[^\n]+/g, "").trim());
    return { choices: choices3.slice(0, 6), correctAnswer: choices3[0], cleanText };
  }

  // Pattern 4: English A) B) C) D) or A. B. C. D.
  const choicePattern4 = /(?:^|\n|\s)([A-Da-d])\s*[)\-.]\s*([^\n]+)/g;
  const choices4: string[] = [];
  let match4;
  while ((match4 = choicePattern4.exec(questionText)) !== null) {
    const t = sanitizeArabicText(match4[2]);
    if (t.length > 0) choices4.push(t);
  }
  if (choices4.length >= 2) {
    const cleanText = sanitizeArabicText(questionText.replace(/(?:^|\n|\s)[A-Da-d]\s*[)\-.]\s*[^\n]+/g, "").trim());
    return { choices: choices4.slice(0, 6), correctAnswer: choices4[0], cleanText };
  }

  // Pattern 5: Comma/dash separated options after "اختر"
  const afterChoose = questionText.match(/(?:اختر|أختر)\s*(?:الإجابة\s*)?(?:الصحيحة?\s*)?(?:مم[اا]\s*بين\s*الأقواس\s*)?[:：]?\s*(.+)/is);
  if (afterChoose) {
    const optsText = afterChoose[1];
    const opts = optsText.split(/[،,ـ\-\|]\s*/).map((o) => sanitizeArabicText(o)).filter((o) => o.length > 0);
    if (opts.length >= 2) {
      const cleanText = sanitizeArabicText(questionText.replace(/(?:اختر|أختر).*$/s, "").trim());
      return { choices: opts.slice(0, 6), correctAnswer: opts[0], cleanText };
    }
  }
  return { choices: [], correctAnswer: "", cleanText: sanitizeArabicText(questionText) };
}

function parseBankQuestionsLocal(
  content: string,
  body: GenerateRequest,
  seenTexts: Set<string>,
): GeneratedQuestion[] {
  const trimmed = content.trim();
  if (trimmed.length < 10) return [];

  // Split content into individual questions based on patterns
  // First try numbered questions: س1, سؤال 1, 1), 1.
  const numberSplit = trimmed.split(/\n\s*(?:س[ؤا]ال\s*)?(?:ال)?س[ؤا]ال\s*[\s\-)]*(?=\d|[أ-ي])|\n\s*(?=\d+\s*[\.\)\-:]\s+)/i);

  // Also try splitting on Arabic letter prefixes: أ), ب), etc.
  const arabicLetterSplit = trimmed.split(/\n\s*(?=[أ-ي]\s*[\.\)\-:]\s+)/);

  // Try splitting on question keywords
  const keywordSplit = trimmed.split(/\n\s*(?=اختر|أختر|اكمل|أكمل|علل|اذكر|عرف|عرّف|قارن|اشرح|حل|أجب|اجب|ضع\s+علامة|صح\s+أم\s+خطأ|أمامك|بين\s*الأقواس)/i);

  // Choose the split that gives the most segments (heuristic)
  const candidates = [numberSplit, arabicLetterSplit, keywordSplit];
  let bestSplit = candidates[0];
  let bestCount = bestSplit.filter((s) => s.trim().length >= 10).length;
  for (const candidate of candidates.slice(1)) {
    const count = candidate.filter((s) => s.trim().length >= 10).length;
    if (count > bestCount) {
      bestSplit = candidate;
      bestCount = count;
    }
  }

  // If we only got 1 segment, try line-by-line parsing
  if (bestCount <= 1) {
    const lines = trimmed.split(/\n/).map((l) => l.trim()).filter((l) => l.length >= 10);
    if (lines.length > 1) {
      bestSplit = lines;
    }
  }

  const questions: GeneratedQuestion[] = [];
  for (const segment of bestSplit) {
    const text = segment.trim();
    if (text.length < 10) continue;
    if (!/[\u0600-\u06FF]/.test(text)) continue;

    // Skip segments that look like headers or instructions, not actual questions
    if (text.length > 500) continue;

    // Skip lines that are clearly not questions (no question-like structure)
    const looksLikeQuestion = /(?:\?|؟|اختر|أكمل|علل|اذكر|عرف|قارن|احسب|أحسب|ضع|أجب|اجب|حل|اشرح|أمامك|بين\s*الأقواس|صح\s*أم\s*خطأ|السؤال|سؤال)/i.test(text);
    if (!looksLikeQuestion && text.length < 30) continue;

    // Detect question type
    const qType = detectQuestionType(text);

    // For MCQ, try to extract choices
    let choices: string[] = [];
    let correctAnswer = "";
    let questionText = sanitizeArabicText(text);

    if (qType === "mcq") {
      const mcq = extractMCQChoices(text);
      choices = mcq.choices;
      correctAnswer = mcq.correctAnswer;
      questionText = mcq.cleanText;
    } else if (qType === "true_false") {
      correctAnswer = "صح"; // default — teacher will correct
    }

    if (questionText.length < 5) continue;

    const textKey = questionText.slice(0, 80).toLowerCase();
    if (seenTexts.has(textKey)) continue;
    seenTexts.add(textKey);

    // Distribute marks evenly if total marks is set
    const totalMarks = body.totalMarks || 0;
    const marks = totalMarks > 0 ? Math.max(1, Math.round(totalMarks / Math.max(bestCount, 1))) : (qType === "mcq" ? 2 : 1);

    questions.push({
      question_text: questionText,
      question_type: qType,
      marks,
      difficulty: normalizeDifficulty(body.difficulty),
      source_lesson: sanitizeArabicText(body.lessons || ""),
      choices,
      correct_answer: correctAnswer,
    });
  }

  return questions;
}

// ── Gemini-powered direct ingestion: ask AI to extract questions as-is from content ──
async function generateBankDirectIngestion(
  body: GenerateRequest,
  apiKey: string,
  seenTexts: Set<string>,
): Promise<GeneratedQuestion[]> {
  const content = (body.extractedContent || "").trim();
  const hasImages = body.images && body.images.length > 0;
  if (content.length < 10 && !hasImages) return [];

  const promptLines: string[] = [];
  promptLines.push("أنت خبير تربوي متخصص في استخراج وتنسيق الأسئلة الجاهزة من النصوص التعليمية.");
  promptLines.push("مهمتك: استخراج الأسئلة الموجودة في المحتوى المرفق كما هي تماماً، دون توليد أي أسئلة جديدة.");
  promptLines.push("لا تخترع أسئلة غير موجودة. لا تضيف أسئلة. لا تحذف أسئلة.");
  promptLines.push("فقط استخرج ونسق الأسئلة الموجودة في النص بدقة.");
  promptLines.push("");
  promptLines.push("لكل سؤال، حدد نوعه بدقة من الأنواع التالية:");
  promptLines.push("- mcq: اختيار من متعدد (إذا كان هناك خيارات متعددة)");
  promptLines.push("- true_false: صح/خطأ");
  promptLines.push("- fill_blank: أكمل الفراغ");
  promptLines.push("- short_answer: إجابة قصيرة (اذكر، اكتب، ما هي)");
  promptLines.push("- explain: علل/لماذا");
  promptLines.push("- mention: اذكر/عدد");
  promptLines.push("- define: عرف/ما المقصود");
  promptLines.push("- compare: قارن");
  promptLines.push("- problem: مسائل حسابية");
  promptLines.push("- essay: مقالية/سؤال مفتوح");
  promptLines.push("- image_question: سؤال على شكل/رسم");
  promptLines.push("- order_match: ترتيب/توصيل");
  promptLines.push("");
  promptLines.push("قواعد صارمة:");
  promptLines.push("- انسخ نص السؤال كما هو من المحتوى، مع الحفاظ على الترقيم الأصلي.");
  promptLines.push("- إذا كان السؤال يحتوي على خيارات (أ، ب، ج، د)، ضعها في choices.");
  promptLines.push("- إذا لم تستطع تحديد الإجابة الصحيحة، اترك correct_answer فارغاً.");
  promptLines.push("- وزع الدرجات بشكل منطقي بحيث يكون المجموع قريباً من الدرجة النهائية.");
  promptLines.push("- اكتب جميع النصوص بالعربية الفصحى مع دعم RTL.");
  promptLines.push("");
  if (body.examInfo.subject) promptLines.push(`المادة: ${body.examInfo.subject}`);
  if (body.examInfo.grade_name) promptLines.push(`الصف: ${body.examInfo.grade_name}`);
  if (body.totalMarks) promptLines.push(`الدرجة النهائية: ${body.totalMarks} درجة`);
  promptLines.push("");
  promptLines.push("═══ المحتوى المرفوع (استخرج الأسئلة منه فقط) ═══");
  if (content.length >= 10) {
    promptLines.push(content);
  } else if (hasImages) {
    promptLines.push("(المحتوى موجود في الصور المرفقة — اقرأ الأسئلة من الصور واستخرجها كما هي)");
  }
  promptLines.push("");
  promptLines.push('أرجع JSON بهذا الشكل:');
  promptLines.push('{"questions": [{"question_text": "نص السؤال كما هو", "question_type": "mcq", "marks": 2, "difficulty": "medium", "source_lesson": "", "choices": ["خيار أ", "خيار ب"], "correct_answer": ""}]}');

  const promptText = promptLines.join("\n");

  // Build Gemini parts: text prompt + inline images (if any)
  const geminiParts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: promptText },
  ];
  if (hasImages) {
    const maxImages = Math.min(body.images!.length, 5);
    for (let i = 0; i < maxImages; i++) {
      const base64 = body.images![i];
      const raw = base64.includes(",") ? base64.split(",")[1] : base64;
      geminiParts.push({ inline_data: { mime_type: "image/png", data: raw } });
    }
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: geminiParts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        }),
      },
    );

    if (!res.ok) return [];

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const rawQuestions: GeneratedQuestion[] = (parsed.questions || []).map((q: Record<string, unknown>) => ({
      question_text: sanitizeArabicText(String(q.question_text || "")),
      question_type: smartTypeCorrection({ question_type: String(q.question_type || "essay"), choices: Array.isArray(q.choices) ? q.choices.map((c: unknown) => String(c)) : [] }),
      marks: Number(q.marks) || 1,
      difficulty: normalizeDifficulty(String(q.difficulty || "")),
      source_lesson: sanitizeArabicText(String(q.source_lesson || "")),
      choices: Array.isArray(q.choices) ? q.choices.map((c: unknown) => sanitizeArabicText(String(c))) : [],
      correct_answer: sanitizeArabicText(String(q.correct_answer || "")),
    }));

    // Validate and dedup
    const valid: GeneratedQuestion[] = [];
    for (const q of rawQuestions) {
      if (q.question_text.length < 5) continue;
      if (!/[\u0600-\u06FF]/.test(q.question_text)) continue;
      if (hasFilenameArtifacts(q.question_text)) continue;
      if (hasRepetition(q.question_text)) continue;
      const textKey = q.question_text.slice(0, 80).toLowerCase();
      if (seenTexts.has(textKey)) continue;
      seenTexts.add(textKey);
      valid.push(q);
    }

    return valid;
  } catch {
    return [];
  }
}

// ============ TRANSCRIPTION MODE (exact copy, no generation) ============
async function generateTranscription(
  body: GenerateRequest,
  apiKey: string,
  seenTexts: Set<string>,
): Promise<GeneratedQuestion[]> {
  const content = (body.extractedContent || "").trim();
  const hasImages = body.images && body.images.length > 0;
  if (content.length < 10 && !hasImages) return [];

  const promptLines: string[] = [];
  const action = body.aiAction || "extract";

  promptLines.push("أنت أداة تفريغ وتصنيف دقيقة للأسئلة. مهمتك: استخراج وتصنيف الأسئلة من المصدر المرفق بدقة عالية.");
  if (body.preserveWording !== false) {
    promptLines.push("تمنع منعاً باتاً: توليد أسئلة جديدة (إلا إذا طُلب غير ذلك)، تلخيص، تصحيح أخطاء، تغيير الأرقام أو الرموز أو ترتيب الخيارات.");
  } else {
    promptLines.push("يمكنك إعادة صياغة الأسئلة وتحسينها مع الحفاظ على المعنى العلمي والمفاهيم والأرقام.");
  }
  promptLines.push("انسخ النص كلمة بكلمة مع الحفاظ على: الأرقام، الوحدات، المعادلات، علامات الترقيم، النفي، الترتيب الأصلي للأسئلة والخيارات.");
  promptLines.push("");
  promptLines.push("═══ كشف نوع السؤال (الأهم) ═══");
  promptLines.push("صنّف كل سؤال على حدة بدقة. لا تعين نوعاً واحداً لكل الامتحان.");
  promptLines.push("- mcq (اختيار من متعدد): إذا كان السؤال يحتوي على خيارات متعددة بأي صيغة:");
  promptLines.push("  * خيارات مسبوقة بحروف عربية: (أ) (ب) (ج) (د) أو أ) ب) ج) د) أو أ- ب- ج- د- أو أ. ب. ج. د.");
  promptLines.push("  * خيارات مسبوقة بحروف إنجليزية: A) B) C) D) أو A. B. C. D. أو a) b) c) d)");
  promptLines.push("  * خيارات مفصولة بفواصل أو شرطات بعد كلمة اختر أو اختر الإجابة الصحيحة");
  promptLines.push("  * الخيارات قد تكون على سطور منفصلة — اجمعها كلها في مصفوفة choices وضع نص السؤال فقط في question_text");
  promptLines.push("  * مهم جداً: إذا رأيت أرقاماً متسلسلة (1، 2، 3...) متبوعة بخيارات (أ، ب، ج، د)، فهذه أسئلة اختيار من متعدد منفصلة");
  promptLines.push('- true_false: عبارة صح/خطأ، أو "ضع علامة" أو "صح أم خطأ"');
  promptLines.push("- fill_blank: جملة بها فراغ (______ أو ______)");
  promptLines.push("- short_answer: سؤال مباشر بإجابة قصيرة (اذكر، اكتب، ما هي)");
  promptLines.push("- essay: سؤال مقالي مفتوح يحتاج إجابة مطولة");
  promptLines.push("");
  promptLines.push("قواعد صارمة:");
  promptLines.push("- لا تخترع إجابة صحيحة. اترك correct_answer فارغاً ما لم تكن مكتوبة صراحة في المصدر.");
  promptLines.push("- لا تخترع درجات. ضع marks = 1 لكل سؤال ما لم تكن الدرجات مذكورة في المصدر.");
  promptLines.push("- إذا كان النص غير واضح أو غير مقروء في أي جزء، ضع علامة [غير واضح] داخل النص واجعل uncertain = true.");
  promptLines.push("- لا تقم بتخمين أو تعبئة الأجزاء الناقصة.");
  promptLines.push("- احافظ على ترتيب الأسئلة كما تظهر في المصدر.");
  promptLines.push("- ضع كل خيار في عنصر منفصل في مصفوفة choices (لا تدمج الخيارات في نص السؤال).");
  promptLines.push("- أزل حروف الترقيم الأولية (أ) ب) ج) د) أو A) B) C) D)) من نص الخيارات في choices — ضع نص الخيار فقط.");
  promptLines.push("");

  // Action-specific instructions
  switch (action) {
    case "to_mcq":
      promptLines.push("═══ الإجراء المطلوب: تحويل إلى اختيار من متعدد ═══");
      promptLines.push("حوّل كل سؤال إلى اختيار من متعدد بأنشئ 4 خيارات منطقية (أ، ب، ج، د) لكل سؤال.");
      promptLines.push("الإجابة الصحيحة يجب أن تكون مبنية على المحتوى. الخيارات الخاطئة يجب أن تكون منطقية وقابلة للاعتقاد.");
      promptLines.push("إذا كان السؤال أصلاً اختيار من متعدد، احتفظ بخياراته كما هي.");
      promptLines.push("");
      break;
    case "to_essay":
      promptLines.push("═══ الإجراء المطلوب: تحويل إلى أسئلة مقالية ═══");
      promptLines.push("حوّل كل سؤال إلى صيغة مقالية مفتوحة تحتاج إجابة مطولة. احذف الخيارات إن وجدت.");
      promptLines.push("");
      break;
    case "to_true_false":
      promptLines.push("═══ الإجراء المطلوب: تحويل إلى صح وخطأ ═══");
      promptLines.push("حوّل كل سؤال إلى عبارة صح أو خطأ. اجعل بعض العبارات صحيحة وبعضها خاطئة بشكل منطقي.");
      promptLines.push('ضع correct_answer = "صح" أو "خطأ" لكل سؤال.');
      promptLines.push("");
      break;
    case "generate_answers":
      promptLines.push("═══ الإجراء المطلوب: إنشاء نموذج إجابة وتحديد الإجابات الصحيحة ═══");
      promptLines.push("لكل سؤال، حدد الإجابة الصحيحة بناءً على المحتوى العلمي المرفق.");
      promptLines.push("لأسئلة الاختيار من متعدد، ضع correct_answer = نص الخيار الصحيح بالضبط.");
      promptLines.push("للأسئلة المقالية والقصيرة، اكتب إجابة نموذجية مختصرة في correct_answer.");
      promptLines.push("إذا لم تكن متأكداً من الإجابة، ضع uncertain = true ولا تخمن.");
      promptLines.push("");
      break;
    case "rephrase":
      promptLines.push("═══ الإجراء المطلوب: إعادة صياغة الأسئلة ═══");
      promptLines.push("أعد صياغة كل سؤال دون تغيير المعنى العلمي. حافظ على نفس نوع السؤال والخيارات إن وجدت.");
      promptLines.push("استخدم لغة عربية فصحى واضحة. لا تغير المفاهيم أو الأرقام.");
      promptLines.push("");
      break;
    case "generate_similar":
      promptLines.push("═══ الإجراء المطلوب: إنشاء أسئلة جديدة مشابهة ═══");
      promptLines.push("أنشئ أسئلة جديدة مشابهة في المستوى والنوع للمحتوى المرفق، لكن بأسئلة وصياغات مختلفة.");
      promptLines.push("احافظ على نفس أنواع الأسئلة ومستوى الصعوبة.");
      promptLines.push("");
      break;
    case "distribute_marks":
      promptLines.push("═══ الإجراء المطلوب: توزيع الدرجات ═══");
      if (body.totalMarksOverride && body.totalMarksOverride > 0) {
        promptLines.push(`وزع إجمالي ${body.totalMarksOverride} درجة على جميع الأسئلة بشكل منطقي (أسئلة المقالية درجة أعلى، الاختيار من متعدد درجة أقل).`);
      } else {
        promptLines.push("وزع الدرجات على الأسئلة بشكل منطقي: الاختيار من متعدد درجة أو درجتان، المقالية 3-5 درجات، صح/خطأ درجة واحدة.");
      }
      promptLines.push("");
      break;
    default:
      // "extract" — no additional instructions
      if (body.generateAnswerKey === false) {
        promptLines.push("لا تحاول تحديد الإجابات الصحيحة — اترك correct_answer فارغاً لكل سؤال.");
      } else {
        promptLines.push("إذا كانت الإجابة الصحيحة مذكورة صراحة في المصدر، ضعها في correct_answer. وإلا اتركها فارغة ولا تخمن.");
      }
      break;
  }
  promptLines.push("");
  if (body.examInfo.subject) promptLines.push(`المادة: ${body.examInfo.subject}`);
  if (body.examInfo.grade_name) promptLines.push(`الصف: ${body.examInfo.grade_name}`);
  promptLines.push("");
  promptLines.push("═══ المصدر (انسخ الأسئلة منه فقط) ═══");
  if (content.length >= 10) {
    promptLines.push(content);
  } else if (hasImages) {
    promptLines.push("(المصدر في الصور المرفقة — اقرأ الأسئلة وانسخها كما هي)");
  }
  promptLines.push("");
  promptLines.push('أرجع JSON بهذا الشكل بالضبط:');
  promptLines.push('{"questions": [{"question_text": "نص السؤال فقط بدون الخيارات", "question_type": "mcq", "marks": 1, "difficulty": "medium", "source_lesson": "", "choices": ["نص الخيار الأول", "نص الخيار الثاني", "نص الخيار الثالث", "نص الخيار الرابع"], "correct_answer": "", "uncertain": false}]}');
  promptLines.push('ملاحظة مهمة: question_text يجب أن يحتوي على نص السؤال فقط بدون الخيارات. الخيارات توضع في مصفوفة choices منفصلة.');

  const promptText = promptLines.join("\n");

  const geminiParts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [
    { text: promptText },
  ];
  if (hasImages) {
    const maxImages = Math.min(body.images!.length, 5);
    for (let i = 0; i < maxImages; i++) {
      const base64 = body.images![i];
      const raw = base64.includes(",") ? base64.split(",")[1] : base64;
      geminiParts.push({ inline_data: { mime_type: "image/png", data: raw } });
    }
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: geminiParts }],
          generationConfig: { temperature: action === "generate_similar" ? 0.4 : action === "rephrase" ? 0.3 : 0, maxOutputTokens: 8192, responseMimeType: "application/json" },
        }),
      },
    );

    if (!res.ok) return [];

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const rawQuestions: GeneratedQuestion[] = (parsed.questions || []).map((q: Record<string, unknown>) => ({
      question_text: sanitizeArabicText(String(q.question_text || "")),
      question_type: smartTypeCorrection({ question_type: String(q.question_type || "essay"), choices: Array.isArray(q.choices) ? q.choices.map((c: unknown) => String(c)) : [] }),
      marks: Number(q.marks) || 1,
      difficulty: normalizeDifficulty(String(q.difficulty || "")),
      source_lesson: sanitizeArabicText(String(q.source_lesson || "")),
      choices: Array.isArray(q.choices) ? q.choices.map((c: unknown) => sanitizeArabicText(String(c))) : [],
      correct_answer: sanitizeArabicText(String(q.correct_answer || "")),
    }));

    const valid: GeneratedQuestion[] = [];
    for (const q of rawQuestions) {
      if (q.question_text.length < 5) continue;
      const textKey = q.question_text.slice(0, 80).toLowerCase();
      if (seenTexts.has(textKey)) continue;
      seenTexts.add(textKey);
      valid.push(q);
    }

    return valid;
  } catch {
    return [];
  }
}

function mapToPrimaryType(t: string): string {
  const lower = t.toLowerCase().trim();
  const map: Record<string, string> = {
    mcq: "mcq",
    "multiple_choice": "mcq",
    "multiple-choice": "mcq",
    "اختيار": "mcq",
    true_false: "true_false",
    "true-false": "true_false",
    "truefalse": "true_false",
    complete: "fill_blank",
    fill_blank: "fill_blank",
    "fill-blank": "fill_blank",
    "fill in the blank": "fill_blank",
    explain: "essay",
    mention: "essay",
    define: "essay",
    compare: "essay",
    problem: "short_answer",
    essay: "essay",
    short_answer: "short_answer",
    "short-answer": "short_answer",
    image_question: "essay",
    order_match: "essay",
    matching: "essay",
  };
  return map[lower] || "essay";
}

// Smart type detection: if AI returned choices but type isn't mcq, fix it
function smartTypeCorrection(q: { question_type: string; choices: string[] }): string {
  const declaredType = mapToPrimaryType(q.question_type);
  const hasRealChoices = Array.isArray(q.choices) && q.choices.filter(c => c && c.trim().length > 0).length >= 2;
  if (hasRealChoices && declaredType !== 'mcq' && declaredType !== 'true_false') {
    return 'mcq';
  }
  // If no choices but type is mcq, downgrade to essay
  if (!hasRealChoices && declaredType === 'mcq') {
    return 'essay';
  }
  return declaredType;
}

