import { supabase } from '@/lib/supabase';
import type {
  ExamLabExam,
  ExamLabQuestion,
  ExamLabAsset,
  ExamLabPrompt,
  ExamLabQuestionBankItem,
  ExamLabVersion,
  QuestionType,
  GenerationMode,
  ExamTemplate,
  Difficulty,
} from '@/lib/examLabTypes';

// ============ OFFLINE-FIRST LOCAL STORAGE LAYER ============

const LS_KEYS = {
  exams: 'examLab_exams',
  questions: 'examLab_questions',
  prompts: 'examLab_prompts',
  versions: 'examLab_versions',
  questionBank: 'examLab_questionBank',
  pendingSync: 'examLab_pendingSync',
} as const;

function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function lsWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable — non-fatal
  }
}

function genId(): string {
  return 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

// Track operations that need to sync when back online
type PendingOp = {
  type: 'upsert_exam' | 'delete_exam' | 'upsert_question' | 'delete_question' | 'reorder_questions' | 'upsert_prompt' | 'insert_version';
  payload: unknown;
  timestamp: number;
};

function addPendingOp(op: PendingOp): void {
  const ops = lsRead<PendingOp[]>(LS_KEYS.pendingSync, []);
  ops.push(op);
  lsWrite(LS_KEYS.pendingSync, ops);
}

// ============ EXAMS ============

export async function fetchExamLabExams(): Promise<ExamLabExam[]> {
  if (!isOnline()) {
    return lsRead<ExamLabExam[]>(LS_KEYS.exams, []);
  }
  try {
    const { data, error } = await supabase
      .from('exam_lab_exams')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const exams = (data ?? []) as ExamLabExam[];
    lsWrite(LS_KEYS.exams, exams);
    return exams;
  } catch {
    return lsRead<ExamLabExam[]>(LS_KEYS.exams, []);
  }
}

export async function fetchExamLabExam(id: string): Promise<ExamLabExam | null> {
  // Try local first for instant load
  const localExams = lsRead<ExamLabExam[]>(LS_KEYS.exams, []);
  const localExam = localExams.find(e => e.id === id) ?? null;

  if (!isOnline()) return localExam;

  try {
    const { data, error } = await supabase
      .from('exam_lab_exams')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const exam = data as ExamLabExam | null;
    if (exam) {
      // Update local cache
      const updated = localExams.filter(e => e.id !== id);
      updated.unshift(exam);
      lsWrite(LS_KEYS.exams, updated);
    }
    return exam ?? localExam;
  } catch {
    return localExam;
  }
}

export async function upsertExamLabExam(exam: Partial<ExamLabExam> & { id?: string }): Promise<string> {
  const now = new Date().toISOString();
  const id = exam.id ?? genId();

  const fullExam: ExamLabExam = {
    id,
    teacher_name: exam.teacher_name ?? '',
    teacher_phone: exam.teacher_phone ?? '',
    center_name: exam.center_name ?? '',
    subject: exam.subject ?? '',
    stage_id: exam.stage_id ?? null,
    grade_level_id: exam.grade_level_id ?? null,
    group_id: exam.group_id ?? null,
    stage_name: exam.stage_name ?? '',
    grade_name: exam.grade_name ?? '',
    group_name: exam.group_name ?? '',
    book_name: exam.book_name ?? '',
    unit_name: exam.unit_name ?? '',
    chapter_name: exam.chapter_name ?? '',
    lessons: exam.lessons ?? '',
    exam_title: exam.exam_title ?? '',
    exam_date: exam.exam_date ?? null,
    duration_minutes: exam.duration_minutes ?? null,
    total_marks: exam.total_marks ?? null,
    generation_mode: exam.generation_mode ?? 'platform',
    template: exam.template ?? 'classic',
    status: exam.status ?? 'draft',
    difficulty: exam.difficulty ?? 'mixed',
    question_types: exam.question_types ?? {},
    extracted_content: exam.extracted_content ?? '',
    answer_key: exam.answer_key ?? [],
    created_at: exam.created_at ?? now,
    updated_at: now,
  };

  // Always save locally first (instant)
  const localExams = lsRead<ExamLabExam[]>(LS_KEYS.exams, []);
  const idx = localExams.findIndex(e => e.id === id);
  if (idx >= 0) localExams[idx] = fullExam;
  else localExams.unshift(fullExam);
  lsWrite(LS_KEYS.exams, localExams);

  // Try remote if online
  if (isOnline()) {
    try {
      const payload = {
        teacher_name: fullExam.teacher_name,
        teacher_phone: fullExam.teacher_phone,
        center_name: fullExam.center_name,
        subject: fullExam.subject,
        stage_id: fullExam.stage_id,
        grade_level_id: fullExam.grade_level_id,
        group_id: fullExam.group_id,
        stage_name: fullExam.stage_name,
        grade_name: fullExam.grade_name,
        group_name: fullExam.group_name,
        book_name: fullExam.book_name,
        unit_name: fullExam.unit_name,
        chapter_name: fullExam.chapter_name,
        lessons: fullExam.lessons,
        exam_title: fullExam.exam_title,
        exam_date: fullExam.exam_date,
        duration_minutes: fullExam.duration_minutes,
        total_marks: fullExam.total_marks,
        generation_mode: fullExam.generation_mode,
        template: fullExam.template,
        status: fullExam.status,
        difficulty: fullExam.difficulty,
        question_types: fullExam.question_types,
        extracted_content: fullExam.extracted_content,
        answer_key: fullExam.answer_key,
        updated_at: now,
      };

      if (exam.id) {
        const { error } = await supabase
          .from('exam_lab_exams')
          .update(payload)
          .eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('exam_lab_exams')
          .insert({ ...payload, id })
          .select('id')
          .single();
        if (error) throw error;
        // Use the real DB id going forward
        if (data?.id && data.id !== id) {
          // Replace local id with DB id
          const exams = lsRead<ExamLabExam[]>(LS_KEYS.exams, []);
          const ei = exams.findIndex(e => e.id === id);
          if (ei >= 0) {
            exams[ei].id = data.id;
            lsWrite(LS_KEYS.exams, exams);
          }
          // Also update questions that referenced the old id
          const localQs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
          let qsChanged = false;
          for (const q of localQs) {
            if (q.exam_id === id) { q.exam_id = data.id; qsChanged = true; }
          }
          if (qsChanged) lsWrite(LS_KEYS.questions, localQs);
          return data.id;
        }
      }
    } catch {
      addPendingOp({ type: 'upsert_exam', payload: fullExam, timestamp: Date.now() });
    }
  } else {
    addPendingOp({ type: 'upsert_exam', payload: fullExam, timestamp: Date.now() });
  }

  return id;
}

export async function deleteExamLabExam(id: string): Promise<void> {
  // Remove locally
  const localExams = lsRead<ExamLabExam[]>(LS_KEYS.exams, []);
  lsWrite(LS_KEYS.exams, localExams.filter(e => e.id !== id));

  // Remove local questions for this exam
  const localQs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
  lsWrite(LS_KEYS.questions, localQs.filter(q => q.exam_id !== id));

  if (isOnline()) {
    try {
      const { error } = await supabase.from('exam_lab_exams').delete().eq('id', id);
      if (error) throw error;
    } catch {
      addPendingOp({ type: 'delete_exam', payload: { id }, timestamp: Date.now() });
    }
  } else {
    addPendingOp({ type: 'delete_exam', payload: { id }, timestamp: Date.now() });
  }
}

export async function copyExamLabExam(id: string): Promise<string> {
  const localExams = lsRead<ExamLabExam[]>(LS_KEYS.exams, []);
  const original = localExams.find(e => e.id === id);

  if (original) {
    const newId = genId();
    const now = new Date().toISOString();
    const copy: ExamLabExam = {
      ...original,
      id: newId,
      exam_title: `${original.exam_title} (نسخة)`,
      status: 'draft',
      created_at: now,
      updated_at: now,
    };
    localExams.unshift(copy);
    lsWrite(LS_KEYS.exams, localExams);

    // Copy questions locally
    const localQs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
    const examQs = localQs.filter(q => q.exam_id === id);
    for (const q of examQs) {
      localQs.push({
        ...q,
        id: genId(),
        exam_id: newId,
        is_approved: false,
      });
    }
    lsWrite(LS_KEYS.questions, localQs);

    // Also try remote if online
    if (isOnline()) {
      try {
        const remoteOriginal = await fetchExamLabExam(id);
        if (remoteOriginal && !remoteOriginal.id.startsWith('local-')) {
          const { id: _, created_at, updated_at, ...rest } = remoteOriginal;
          const remoteNewId = await upsertExamLabExam({
            ...rest,
            exam_title: `${remoteOriginal.exam_title} (نسخة)`,
            status: 'draft',
          });
          const questions = await fetchExamLabQuestions(id);
          for (const q of questions) {
            await upsertExamLabQuestion({
              exam_id: remoteNewId,
              question_text: q.question_text,
              question_type: q.question_type,
              marks: q.marks,
              difficulty: q.difficulty,
              source_lesson: q.source_lesson,
              choices: q.choices,
              correct_answer: q.correct_answer,
              image_url: q.image_url,
              sort_order: q.sort_order,
              is_approved: false,
              version_label: q.version_label,
            });
          }
          return remoteNewId;
        }
      } catch {
        // fallback to local copy already made
      }
    }
    return newId;
  }

  // Fallback: try remote
  try {
    const remoteOriginal = await fetchExamLabExam(id);
    if (!remoteOriginal) throw new Error('Exam not found');
    const { id: _, created_at, updated_at, ...rest } = remoteOriginal;
    const newId = await upsertExamLabExam({
      ...rest,
      exam_title: `${remoteOriginal.exam_title} (نسخة)`,
      status: 'draft',
    });
    const questions = await fetchExamLabQuestions(id);
    for (const q of questions) {
      await upsertExamLabQuestion({
        exam_id: newId,
        question_text: q.question_text,
        question_type: q.question_type,
        marks: q.marks,
        difficulty: q.difficulty,
        source_lesson: q.source_lesson,
        choices: q.choices,
        correct_answer: q.correct_answer,
        image_url: q.image_url,
        sort_order: q.sort_order,
        is_approved: false,
        version_label: q.version_label,
      });
    }
    return newId;
  } catch {
    throw new Error('Exam not found');
  }
}

// ============ QUESTIONS ============

export async function fetchExamLabQuestions(examId: string): Promise<ExamLabQuestion[]> {
  if (!isOnline()) {
    const localQs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
    return localQs.filter(q => q.exam_id === examId).sort((a, b) => a.sort_order - b.sort_order);
  }
  try {
    const { data, error } = await supabase
      .from('exam_lab_questions')
      .select('*')
      .eq('exam_id', examId)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    const questions = (data ?? []) as ExamLabQuestion[];
    // Merge with local (local takes precedence for unsaved edits)
    const localQs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
    const localForExam = localQs.filter(q => q.exam_id === examId);
    const localIds = new Set(localForExam.map(q => q.id));
    const merged = [...questions.filter(q => !localIds.has(q.id)), ...localForExam];
    merged.sort((a, b) => a.sort_order - b.sort_order);
    return merged;
  } catch {
    const localQs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
    return localQs.filter(q => q.exam_id === examId).sort((a, b) => a.sort_order - b.sort_order);
  }
}

export async function upsertExamLabQuestion(q: Partial<ExamLabQuestion> & { exam_id: string; id?: string }): Promise<string> {
  const id = q.id ?? genId();

  const fullQuestion: ExamLabQuestion = {
    id,
    exam_id: q.exam_id,
    question_text: q.question_text ?? '',
    question_type: q.question_type ?? 'mcq',
    marks: q.marks ?? null,
    difficulty: q.difficulty ?? 'medium',
    source_lesson: q.source_lesson ?? '',
    choices: q.choices ?? [],
    correct_answer: q.correct_answer ?? '',
    image_url: q.image_url ?? null,
    sort_order: q.sort_order ?? 0,
    is_approved: q.is_approved ?? false,
    version_label: q.version_label ?? 'A',
  };

  // Save locally first
  const localQs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
  const idx = localQs.findIndex(x => x.id === id);
  if (idx >= 0) localQs[idx] = fullQuestion;
  else localQs.push(fullQuestion);
  lsWrite(LS_KEYS.questions, localQs);

  // Try remote
  if (isOnline()) {
    try {
      const payload = {
        exam_id: fullQuestion.exam_id,
        question_text: fullQuestion.question_text,
        question_type: fullQuestion.question_type,
        marks: fullQuestion.marks,
        difficulty: fullQuestion.difficulty,
        source_lesson: fullQuestion.source_lesson,
        choices: fullQuestion.choices,
        correct_answer: fullQuestion.correct_answer,
        image_url: fullQuestion.image_url,
        sort_order: fullQuestion.sort_order,
        is_approved: fullQuestion.is_approved,
        version_label: fullQuestion.version_label,
      };

      if (q.id && !q.id.startsWith('local-')) {
        const { error } = await supabase
          .from('exam_lab_questions')
          .update(payload)
          .eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('exam_lab_questions')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        if (data?.id && data.id !== id) {
          // Replace local id with DB id
          const qs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
          const qi = qs.findIndex(x => x.id === id);
          if (qi >= 0) {
            qs[qi].id = data.id;
            lsWrite(LS_KEYS.questions, qs);
          }
          return data.id;
        }
      }
    } catch {
      addPendingOp({ type: 'upsert_question', payload: fullQuestion, timestamp: Date.now() });
    }
  } else {
    addPendingOp({ type: 'upsert_question', payload: fullQuestion, timestamp: Date.now() });
  }

  return id;
}

export async function deleteExamLabQuestion(id: string): Promise<void> {
  // Remove locally
  const localQs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
  lsWrite(LS_KEYS.questions, localQs.filter(q => q.id !== id));

  if (isOnline()) {
    try {
      const { error } = await supabase.from('exam_lab_questions').delete().eq('id', id);
      if (error) throw error;
    } catch {
      addPendingOp({ type: 'delete_question', payload: { id }, timestamp: Date.now() });
    }
  } else {
    addPendingOp({ type: 'delete_question', payload: { id }, timestamp: Date.now() });
  }
}

export async function reorderExamLabQuestions(examId: string, orderedIds: string[]): Promise<void> {
  // Update locally
  const localQs = lsRead<ExamLabQuestion[]>(LS_KEYS.questions, []);
  for (let i = 0; i < orderedIds.length; i++) {
    const q = localQs.find(x => x.id === orderedIds[i]);
    if (q) q.sort_order = i;
  }
  lsWrite(LS_KEYS.questions, localQs);

  if (isOnline()) {
    try {
      for (let i = 0; i < orderedIds.length; i++) {
        if (!orderedIds[i].startsWith('local-')) {
          await supabase
            .from('exam_lab_questions')
            .update({ sort_order: i })
            .eq('id', orderedIds[i]);
        }
      }
    } catch {
      addPendingOp({ type: 'reorder_questions', payload: { examId, orderedIds }, timestamp: Date.now() });
    }
  } else {
    addPendingOp({ type: 'reorder_questions', payload: { examId, orderedIds }, timestamp: Date.now() });
  }
}

// ============ ASSETS ============

export async function fetchExamLabAssets(examId: string): Promise<ExamLabAsset[]> {
  if (!isOnline()) return [];
  try {
    const { data, error } = await supabase
      .from('exam_lab_assets')
      .select('*')
      .eq('exam_id', examId)
      .order('file_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ExamLabAsset[];
  } catch {
    return [];
  }
}

export async function insertExamLabAsset(asset: Omit<ExamLabAsset, 'id'>): Promise<string> {
  if (!isOnline()) return genId();
  try {
    const { data, error } = await supabase
      .from('exam_lab_assets')
      .insert({
        exam_id: asset.exam_id,
        file_name: asset.file_name,
        file_type: asset.file_type,
        file_url: asset.file_url,
        file_order: asset.file_order,
        extracted_text: asset.extracted_text,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  } catch {
    return genId();
  }
}

export async function deleteExamLabAsset(id: string): Promise<void> {
  if (!isOnline()) return;
  try {
    await supabase.from('exam_lab_assets').delete().eq('id', id);
  } catch {
    // non-fatal
  }
}

export async function reorderExamLabAssets(examId: string, orderedIds: string[]): Promise<void> {
  if (!isOnline()) return;
  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await supabase
        .from('exam_lab_assets')
        .update({ file_order: i })
        .eq('id', orderedIds[i]);
    }
  } catch {
    // non-fatal
  }
}

// ============ PROMPTS ============

export async function fetchExamLabPrompt(examId: string): Promise<ExamLabPrompt | null> {
  // Try local first
  const localPrompts = lsRead<ExamLabPrompt[]>(LS_KEYS.prompts, []);
  const localPrompt = localPrompts.find(p => p.exam_id === examId) ?? null;

  if (!isOnline()) return localPrompt;

  try {
    const { data, error } = await supabase
      .from('exam_lab_prompts')
      .select('*')
      .eq('exam_id', examId)
      .maybeSingle();
    if (error) throw error;
    return (data as ExamLabPrompt | null) ?? localPrompt;
  } catch {
    return localPrompt;
  }
}

export async function upsertExamLabPrompt(examId: string, promptText: string, isEdited = false): Promise<void> {
  // Save locally
  const localPrompts = lsRead<ExamLabPrompt[]>(LS_KEYS.prompts, []);
  const existing = localPrompts.find(p => p.exam_id === examId);
  if (existing) {
    existing.prompt_text = promptText;
    existing.is_edited = isEdited;
  } else {
    localPrompts.push({ id: genId(), exam_id: examId, prompt_text: promptText, is_edited: isEdited });
  }
  lsWrite(LS_KEYS.prompts, localPrompts);

  if (!isOnline()) {
    addPendingOp({ type: 'upsert_prompt', payload: { examId, promptText, isEdited }, timestamp: Date.now() });
    return;
  }

  try {
    const remoteExisting = await fetchExamLabPrompt(examId);
    if (remoteExisting && !remoteExisting.id.startsWith('local-')) {
      await supabase
        .from('exam_lab_prompts')
        .update({ prompt_text: promptText, is_edited: isEdited })
        .eq('id', remoteExisting.id);
    } else {
      await supabase
        .from('exam_lab_prompts')
        .insert({ exam_id: examId, prompt_text: promptText, is_edited: isEdited });
    }
  } catch {
    addPendingOp({ type: 'upsert_prompt', payload: { examId, promptText, isEdited }, timestamp: Date.now() });
  }
}

// ============ QUESTION BANK ============

export async function fetchExamLabQuestionBank(): Promise<ExamLabQuestionBankItem[]> {
  if (!isOnline()) {
    return lsRead<ExamLabQuestionBankItem[]>(LS_KEYS.questionBank, []);
  }
  try {
    const { data, error } = await supabase
      .from('exam_lab_question_bank')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const items = (data ?? []) as ExamLabQuestionBankItem[];
    lsWrite(LS_KEYS.questionBank, items);
    return items;
  } catch {
    return lsRead<ExamLabQuestionBankItem[]>(LS_KEYS.questionBank, []);
  }
}

export async function insertExamLabQuestionBankItem(item: Omit<ExamLabQuestionBankItem, 'id'>): Promise<void> {
  const localItems = lsRead<ExamLabQuestionBankItem[]>(LS_KEYS.questionBank, []);
  localItems.unshift({ ...item, id: genId() });
  lsWrite(LS_KEYS.questionBank, localItems);

  if (!isOnline()) return;

  try {
    await supabase.from('exam_lab_question_bank').insert({
      question_text: item.question_text,
      question_type: item.question_type,
      subject: item.subject,
      stage_name: item.stage_name,
      grade_name: item.grade_name,
      lesson: item.lesson,
      difficulty: item.difficulty,
      marks: item.marks,
      answer: item.answer,
      source_exam_id: item.source_exam_id,
    });
  } catch {
    // non-fatal
  }
}

export async function deleteExamLabQuestionBankItem(id: string): Promise<void> {
  const localItems = lsRead<ExamLabQuestionBankItem[]>(LS_KEYS.questionBank, []);
  lsWrite(LS_KEYS.questionBank, localItems.filter(i => i.id !== id));

  if (!isOnline()) return;

  try {
    await supabase.from('exam_lab_question_bank').delete().eq('id', id);
  } catch {
    // non-fatal
  }
}

// ============ VERSIONS ============

export async function fetchExamLabVersions(examId: string): Promise<ExamLabVersion[]> {
  if (!isOnline()) {
    const localVersions = lsRead<ExamLabVersion[]>(LS_KEYS.versions, []);
    return localVersions.filter(v => v.exam_id === examId);
  }
  try {
    const { data, error } = await supabase
      .from('exam_lab_versions')
      .select('*')
      .eq('exam_id', examId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ExamLabVersion[];
  } catch {
    const localVersions = lsRead<ExamLabVersion[]>(LS_KEYS.versions, []);
    return localVersions.filter(v => v.exam_id === examId);
  }
}

export async function insertExamLabVersion(examId: string, label: string, questionOrder: string[]): Promise<void> {
  // Save locally
  const localVersions = lsRead<ExamLabVersion[]>(LS_KEYS.versions, []);
  localVersions.push({
    id: genId(),
    exam_id: examId,
    version_label: label,
    question_order: questionOrder,
  });
  lsWrite(LS_KEYS.versions, localVersions);

  if (!isOnline()) {
    addPendingOp({ type: 'insert_version', payload: { examId, label, questionOrder }, timestamp: Date.now() });
    return;
  }

  try {
    await supabase.from('exam_lab_versions').insert({
      exam_id: examId,
      version_label: label,
      question_order: questionOrder,
    });
  } catch {
    addPendingOp({ type: 'insert_version', payload: { examId, label, questionOrder }, timestamp: Date.now() });
  }
}

// ============ SYNC: replay pending ops when back online ============

export async function syncPendingOps(): Promise<void> {
  if (!isOnline()) return;
  const ops = lsRead<PendingOp[]>(LS_KEYS.pendingSync, []);
  if (ops.length === 0) return;

  const remaining: PendingOp[] = [];
  for (const op of ops) {
    try {
      switch (op.type) {
        case 'upsert_exam': {
          const exam = op.payload as ExamLabExam;
          const payload = {
            teacher_name: exam.teacher_name,
            teacher_phone: exam.teacher_phone,
            center_name: exam.center_name,
            subject: exam.subject,
            stage_id: exam.stage_id,
            grade_level_id: exam.grade_level_id,
            group_id: exam.group_id,
            stage_name: exam.stage_name,
            grade_name: exam.grade_name,
            group_name: exam.group_name,
            book_name: exam.book_name,
            unit_name: exam.unit_name,
            chapter_name: exam.chapter_name,
            lessons: exam.lessons,
            exam_title: exam.exam_title,
            exam_date: exam.exam_date,
            duration_minutes: exam.duration_minutes,
            total_marks: exam.total_marks,
            generation_mode: exam.generation_mode,
            template: exam.template,
            status: exam.status,
            difficulty: exam.difficulty,
            question_types: exam.question_types,
            extracted_content: exam.extracted_content,
            answer_key: exam.answer_key,
            updated_at: new Date().toISOString(),
          };
          if (exam.id.startsWith('local-')) {
            const { error } = await supabase.from('exam_lab_exams').insert({ ...payload, id: exam.id });
            if (error) throw error;
          } else {
            const { error } = await supabase.from('exam_lab_exams').upsert({ ...payload, id: exam.id });
            if (error) throw error;
          }
          break;
        }
        case 'delete_exam': {
          const { id } = op.payload as { id: string };
          await supabase.from('exam_lab_exams').delete().eq('id', id);
          break;
        }
        case 'upsert_question': {
          const q = op.payload as ExamLabQuestion;
          const payload = {
            exam_id: q.exam_id,
            question_text: q.question_text,
            question_type: q.question_type,
            marks: q.marks,
            difficulty: q.difficulty,
            source_lesson: q.source_lesson,
            choices: q.choices,
            correct_answer: q.correct_answer,
            image_url: q.image_url,
            sort_order: q.sort_order,
            is_approved: q.is_approved,
            version_label: q.version_label,
          };
          if (q.id.startsWith('local-')) {
            const { error } = await supabase.from('exam_lab_questions').insert({ ...payload, id: q.id });
            if (error) throw error;
          } else {
            const { error } = await supabase.from('exam_lab_questions').upsert({ ...payload, id: q.id });
            if (error) throw error;
          }
          break;
        }
        case 'delete_question': {
          const { id } = op.payload as { id: string };
          await supabase.from('exam_lab_questions').delete().eq('id', id);
          break;
        }
        case 'reorder_questions': {
          const { orderedIds } = op.payload as { examId: string; orderedIds: string[] };
          for (let i = 0; i < orderedIds.length; i++) {
            if (!orderedIds[i].startsWith('local-')) {
              await supabase.from('exam_lab_questions').update({ sort_order: i }).eq('id', orderedIds[i]);
            }
          }
          break;
        }
        case 'upsert_prompt': {
          const { examId, promptText, isEdited } = op.payload as { examId: string; promptText: string; isEdited: boolean };
          await upsertExamLabPrompt(examId, promptText, isEdited);
          break;
        }
        case 'insert_version': {
          const { examId, label, questionOrder } = op.payload as { examId: string; label: string; questionOrder: string[] };
          await supabase.from('exam_lab_versions').insert({ exam_id: examId, version_label: label, question_order: questionOrder });
          break;
        }
      }
    } catch {
      remaining.push(op);
    }
  }
  lsWrite(LS_KEYS.pendingSync, remaining);
}
