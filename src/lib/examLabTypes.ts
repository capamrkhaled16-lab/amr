export type GenerationMode = 'platform' | 'gemini' | 'both';
export type ExamTemplate = 'classic' | 'modern' | 'clean' | 'center';
export type ExamStatus = 'draft' | 'approved' | 'archived';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'mixed';

export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'complete'
  | 'explain'
  | 'mention'
  | 'define'
  | 'compare'
  | 'problem'
  | 'image_question'
  | 'essay'
  | 'order_match';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'اختر الإجابة الصحيحة',
  true_false: 'صح أو خطأ',
  complete: 'أكمل',
  explain: 'علل',
  mention: 'اذكر',
  define: 'ما المقصود بـ',
  compare: 'قارن',
  problem: 'مسائل / تطبيقات',
  image_question: 'أسئلة على الصور والأشكال',
  essay: 'أسئلة مقالية',
  order_match: 'ترتيب / توصيل',
};

export const QUESTION_TYPE_SHORT: Record<QuestionType, string> = {
  mcq: 'اختياري',
  true_false: 'صح/خطأ',
  complete: 'أكمل',
  explain: 'علل',
  mention: 'اذكر',
  define: 'تعريف',
  compare: 'قارن',
  problem: 'مسائل',
  image_question: 'صور',
  essay: 'مقالية',
  order_match: 'توصيل',
};

export type ExamLabExam = {
  id: string;
  teacher_name: string;
  teacher_phone: string;
  center_name: string;
  subject: string;
  stage_id: string | null;
  grade_level_id: string | null;
  group_id: string | null;
  stage_name: string;
  grade_name: string;
  group_name: string;
  book_name: string;
  unit_name: string;
  chapter_name: string;
  lessons: string;
  exam_title: string;
  exam_date: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  generation_mode: GenerationMode;
  template: ExamTemplate;
  status: ExamStatus;
  difficulty: Difficulty;
  question_types: Partial<Record<QuestionType, number>>;
  extracted_content: string;
  answer_key: AnswerKeyEntry[];
  created_at: string;
  updated_at: string;
};

export type AnswerKeyEntry = {
  question_id: string;
  question_number: number;
  answer: string;
};

export type ExamLabQuestion = {
  id: string;
  exam_id: string;
  question_text: string;
  question_type: QuestionType;
  marks: number | null;
  difficulty: Difficulty;
  source_lesson: string;
  choices: string[];
  correct_answer: string;
  image_url: string | null;
  sort_order: number;
  is_approved: boolean;
  version_label: string;
};

export type ExamLabAsset = {
  id: string;
  exam_id: string;
  file_name: string;
  file_type: string;
  file_url: string;
  file_order: number;
  extracted_text: string;
};

export type ExamLabPrompt = {
  id: string;
  exam_id: string;
  prompt_text: string;
  is_edited: boolean;
};

export type ExamLabQuestionBankItem = {
  id: string;
  question_text: string;
  question_type: QuestionType;
  subject: string;
  stage_name: string;
  grade_name: string;
  lesson: string;
  difficulty: Difficulty;
  marks: number;
  answer: string;
  source_exam_id: string | null;
};

export type ExamLabVersion = {
  id: string;
  exam_id: string;
  version_label: string;
  question_order: string[];
};

export type ExamDraft = {
  exam: Partial<ExamLabExam>;
  questions: ExamLabQuestion[];
  assets: ExamLabAsset[];
  prompt: string;
  extractedContent: string;
};

export const TEMPLATE_LABELS: Record<ExamTemplate, string> = {
  classic: 'كلاسيكي مدرسي',
  modern: 'أكاديمي حديث',
  clean: 'علمي بسيط',
  center: 'امتحان سنتر',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
  mixed: 'متنوع',
};
