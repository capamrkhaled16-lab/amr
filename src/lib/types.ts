export interface AcademicStage {
  id: string;
  name: string;
  sort_order: number;
  base_subscription: number;
}

export interface GradeLevel {
  id: string;
  stage_id: string;
  name: string;
  sort_order: number;
  base_subscription: number;
}

export interface Group {
  id: string;
  grade_level_id: string;
  name: string;
  schedule: string | null;
  created_at: string;
}

export interface Student {
  id: string;
  group_id: string | null;
  name: string;
  phone: string | null;
  parent_phone: string | null;
  gender: "male" | "female";
  parent_token: string;
  enrollment_date: string;
  total_fees: number;
  paid_fees: number;
  is_deleted: boolean;
  status: string;
  discount_type: string | null;
  discount_amount: number;
  is_exempt: boolean;
  discount_mode: string | null;
  discount_percent: number;
  fee_mode: string;
  pro_rata_sessions: number;
  join_month_key: string | null;
}

export interface Session {
  id: string;
  group_id: string;
  title: string;
  month: string;
  is_archived: boolean;
  is_deleted: boolean;
  session_date: string | null;
  created_at: string;
}

export type AttendanceStatus = "present" | "absent" | "late" | "excused" | "unrecorded";

export interface AttendanceRecord {
  id: string;
  student_id: string;
  group_id: string | null;
  status: AttendanceStatus;
  notes: string | null;
  attendance_date: string;
  recorded_at: string;
  session_id: string | null;
  late_minutes: number | null;
}

export interface Payment {
  id: string;
  student_id: string;
  amount: number;
  payment_date: string;
  note: string | null;
  recorded_by: string | null;
  receipt_number: string | null;
  is_deleted: boolean;
  month_key: string | null;
  idempotency_key: string | null;
}

export interface MonthlySubscription {
  id: string;
  student_id: string;
  month: string;
  month_key: string;
  amount_due: number;
  amount_paid: number;
  status: string;
  paid_date: string | null;
  is_archived: boolean;
  note: string | null;
  receipt_number: string | null;
  is_exempt: boolean;
  exemption_note: string | null;
}

export interface Expense {
  id: string;
  category: string;
  amount: number;
  description: string | null;
  expense_date: string;
  recorded_by: string | null;
  group_id: string | null;
}

export interface Assistant {
  id: string;
  username: string;
  pin: string;
  display_name: string | null;
  is_active: boolean;
  logins_count: number;
  last_login_at: string | null;
  can_view_finance: boolean;
  can_edit_grades: boolean;
  can_manage_attendance: boolean;
  can_manage_students: boolean;
  can_manage_exams: boolean;
  can_manage_subscriptions: boolean;
  can_view_results_only: boolean;
  can_edit_questions: boolean;
  can_live_monitor: boolean;
  can_print_reports: boolean;
  can_grade_essay: boolean;
  can_view_subscriptions: boolean;
  can_view_attendance: boolean;
  can_view_students: boolean;
  can_view_exams: boolean;
  can_view_grades: boolean;
  can_view_tracking: boolean;
  can_view_certificates: boolean;
  can_view_parent_links: boolean;
  can_view_hall_of_fame: boolean;
  can_manage_exemptions: boolean;
  can_delete_evals: boolean;
}

export interface Homework {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  due_date: string;
  session_id: string;
  is_closed: boolean;
}

export type BehaviorRating =
  | 'excellent'
  | 'participatory'
  | 'quiet'
  | 'needs_attention'
  | 'disruptive';

export type BehaviorScope = 'daily' | 'monthly' | 'session';

export interface BehaviorEval {
  id: string;
  student_id: string;
  group_id: string | null;
  session_id: string | null;
  eval_type: string;
  rating: BehaviorRating | null;
  score: number;
  note: string | null;
  eval_date: string;
  scope: BehaviorScope;
  created_at: string;
}

export interface Settings {
  id: string;
  platform_name: string;
  management_name: string;
  teacher_name: string;
  logo_url: string | null;
}

// ============ EXAM TYPES ============

export type ExamLifecycleStatus = 'draft' | 'approved' | 'published' | 'archived';
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

export interface CenterExam {
  id: string;
  group_id: string;
  title: string;
  max_score: number;
  pass_score: number;
  exam_date: string | null;
  created_at: string;
  category: string;
  session_id: string | null;
}

export interface CenterGrade {
  id: string;
  center_exam_id: string;
  student_id: string;
  score: number;
  updated_at: string;
  is_locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
  is_deleted: boolean;
}

export interface OnlineExam {
  id: string;
  group_id: string | null;
  grade_level_id: string | null;
  title: string;
  description: string | null;
  subject: string | null;
  duration_minutes: number;
  open_at: string | null;
  close_at: string | null;
  is_published: boolean;
  is_draft: boolean;
  is_random: boolean;
  seconds_per_question: number;
  total_score: number;
  access_code: string | null;
  show_results: boolean;
  shuffle_questions: boolean;
  shuffle_choices: boolean;
  exam_type: string;
  lifecycle_status: string;
  country: string | null;
  education_system: string | null;
  language: string | null;
  academic_year: string | null;
  term: string | null;
  created_at: string;
}

export interface ExamQuestion {
  id: string;
  exam_id: string;
  type: string;
  question_text: string;
  choices: string[] | null;
  correct_choice_index: number | null;
  model_answer: string | null;
  points: number;
  sort_order: number;
  section_id: string | null;
  accepted_answers: string[] | null;
  created_at: string;
}

export interface ExamSubmission {
  id: string;
  exam_id: string;
  student_id: string | null;
  status: string;
  total_score: number;
  max_score: number;
  started_at: string;
  submitted_at: string | null;
  tab_switch_count: number;
  student_name: string | null;
  student_phone: string | null;
  current_question_index: number;
  answered_count: number;
  last_activity_at: string | null;
}

export interface ExamAnswer {
  id: string;
  submission_id: string;
  question_id: string;
  selected_choice_index: number | null;
  essay_answer: string | null;
  awarded_score: number;
  is_correct: boolean;
  graded_at: string | null;
}

export interface OnlineGrade {
  id: string;
  exam_id: string;
  student_id: string;
  score: number;
  max_score: number;
  is_manual_override: boolean;
  updated_at: string;
}

export interface Certificate {
  id: string;
  student_id: string;
  exam_title: string | null;
  score: number | null;
  max_score: number | null;
  serial_id: string;
  issued_at: string;
}

export interface ExamSection {
  id: string;
  exam_id: string;
  title: string;
  sort_order: number;
}

export interface QuestionBankItem {
  id: string;
  question_text: string;
  question_type: string;
  subject: string;
  stage_name: string;
  grade_name: string;
  lesson: string;
  difficulty: string;
  marks: number;
  answer: string;
  source_exam_id: string | null;
}

export interface ExamVariant {
  id: string;
  exam_id: string;
  variant_label: string;
  question_order: string[];
}

export type ExamReentryRequest = {
  id: string;
  exam_id: string;
  submission_id: string | null;
  student_id: string | null;
  student_name: string;
  student_phone: string | null;
  status: string;
  reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type ReentryRequestStatus = 'pending' | 'approved' | 'rejected';

// ============ HOMEWORK ============

export type HomeworkStatusType =
  | 'done'
  | 'complete'
  | 'completed'
  | 'late'
  | 'incomplete'
  | 'not_done'
  | 'absent'
  | 'excused'
  | 'unrecorded';

export interface HomeworkStatus {
  id: string;
  homework_id: string;
  student_id: string;
  status: HomeworkStatusType;
  teacher_note: string | null;
  recorded_at: string;
}

// ============ SUBSCRIPTIONS ============

export type SubscriptionStatus = 'paid' | 'partial' | 'unpaid' | 'exempt';

// ============ STUDENT STATUS ============

export type StudentStatus = 'active' | 'paused' | 'graduated' | 'withdrawn' | 'left' | 'deleted';

// ============ EXPENSES ============

export type ExpenseCategory =
  | 'rent'
  | 'utilities'
  | 'supplies'
  | 'salaries'
  | 'marketing'
  | 'maintenance'
  | 'electricity'
  | 'assistants'
  | 'other';

// ============ TRANSFERS ============

export interface GroupTransfer {
  id: string;
  student_id: string;
  from_group_id: string | null;
  to_group_id: string;
  transferred_at: string;
  actor_name: string | null;
}

// ============ ARCHIVE ============

export interface MonthlyArchive {
  id: string;
  student_id: string;
  archive_month: string;
  attendance_present: number;
  attendance_absent: number;
  attendance_late: number;
  attendance_excused: number;
  homework_done: number;
  homework_late: number;
  homework_total: number;
  behavior_avg: number;
  exam_avg: number;
  total_paid: number;
  total_due: number;
  is_locked: boolean;
  created_at: string;
}

export interface ArchiveRun {
  id: string;
  archive_month: string;
  run_type: string;
  status: string;
  carried_over_count: number;
  carried_over_total: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface CarriedOverBalance {
  id: string;
  student_id: string;
  from_month: string;
  to_month: string;
  amount: number;
  description: string;
  is_settled: boolean;
  created_at: string;
}

// ============ HALL OF FAME ============

export interface HallOfFameEntry {
  id: string;
  name: string;
  group_name: string | null;
  grade_name: string | null;
  stage_name: string | null;
  center_avg: number;
  online_avg: number;
  avg_score: number;
  exams_taken: number;
  attendance_rate: number;
}

// ============ AUDIT LOG ============

export interface AuditLog {
  id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  student_id: string | null;
  details: string | null;
  created_at: string;
}

// ============ ACCOUNTING ============

export interface AccountingCycle {
  id: string;
  cycle_number: number;
  start_date: string;
  end_date: string;
  total_amount: number;
  accounted_amount: number;
  remaining_amount: number;
  payment_ids: string[];
  status: string;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface MonthClosure {
  id: string;
  month_key: string;
  month_label: string;
  snapshot_data: Record<string, unknown>;
  closed_by: string | null;
  closed_at: string;
  is_reopened: boolean;
}

// ============ DATA CHECK & HEALTH ============

export interface DataCheckIssue {
  id: string;
  severity: string;
  category: string;
  description: string;
  affected_count: number;
  fix_action: string | null;
}

export interface HealthScore {
  overall: number;
  attendance: number;
  grades: number;
  homework: number;
  payments: number;
  behavior: number;
}
