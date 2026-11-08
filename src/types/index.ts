export interface AcademicStage {
  id: string
  name: string
  sort_order: number
  created_at: string
  base_subscription: number
}

export interface GradeLevel {
  id: string
  stage_id: string
  name: string
  sort_order: number
  created_at: string
  base_subscription: number
}

export interface Group {
  id: string
  grade_level_id: string
  name: string
  created_at: string
  schedule: string | null
}

export interface Student {
  id: string
  group_id: string | null
  name: string
  phone: string | null
  parent_phone: string | null
  gender: string
  parent_token: string
  enrollment_date: string | null
  total_fees: number | null
  paid_fees: number | null
  created_at: string
  is_deleted: boolean
  status: string
  discount_type: string | null
  discount_amount: number | null
  is_exempt: boolean
  discount_mode: string | null
  discount_percent: number
  fee_mode: string
  pro_rata_sessions: number
  join_month_key: string | null
}

export interface Session {
  id: string
  group_id: string
  title: string
  month: string
  is_archived: boolean
  created_at: string
  is_deleted: boolean
  session_date: string | null
}

export interface Attendance {
  id: string
  student_id: string
  group_id: string | null
  status: string
  notes: string | null
  attendance_date: string
  recorded_at: string | null
  session_id: string | null
  late_minutes: number | null
}

export interface Assistant {
  id: string
  username: string
  pin: string
  display_name: string | null
  is_active: boolean
  created_at: string
  logins_count: number
  last_login_at: string | null
  can_view_finance: boolean
  can_edit_grades: boolean
  can_manage_attendance: boolean
  can_manage_students: boolean
  can_manage_exams: boolean
  can_manage_subscriptions: boolean
  can_view_results_only: boolean
  can_edit_questions: boolean
  can_live_monitor: boolean
  can_print_reports: boolean
  can_grade_essay: boolean
  can_view_subscriptions: boolean
  can_view_attendance: boolean
  can_view_students: boolean
  can_view_exams: boolean
  can_view_grades: boolean
  can_view_tracking: boolean
  can_view_certificates: boolean
  can_view_parent_links: boolean
  can_view_hall_of_fame: boolean
  can_manage_exemptions: boolean
  can_delete_evals: boolean | null
}

export interface Settings {
  id: string
  platform_name: string
  management_name: string | null
  teacher_name: string | null
  logo_url: string | null
  teacher_photo_url: string | null
  updated_at: string | null
  master_pin: string | null
  default_pin_active: boolean
  late_payment_alert_day: number
  gemini_api_key: string | null
  app_icon_url: string | null
  login_heading: string | null
  login_description: string | null
  login_portrait_visible: boolean
  bg_color: string | null
  card_color: string | null
  primary_accent: string | null
  secondary_accent: string | null
  text_color: string | null
}

export interface CenterExam {
  id: string
  group_id: string
  title: string
  max_score: number
  pass_score: number
  exam_date: string | null
  created_at: string
  category: string
  session_id: string | null
}

export interface CenterGrade {
  id: string
  center_exam_id: string
  student_id: string
  score: number
  updated_at: string | null
  is_deleted: boolean
  deleted_at: string | null
  is_locked: boolean
  note: string | null
}

export interface Homework {
  id: string
  group_id: string
  title: string
  description: string | null
  due_date: string | null
  created_at: string
  session_id: string
  is_closed: boolean
}

export interface HomeworkStatus {
  id: string
  homework_id: string
  student_id: string
  status: string
  teacher_note: string | null
  recorded_at: string | null
}

export interface BehaviorEval {
  id: string
  student_id: string
  group_id: string | null
  rating: string
  note: string | null
  eval_date: string
  created_at: string
  scope: string
  session_id: string | null
}

export interface HallOfFameEntry {
  id: string
  name: string
  group_id: string
  group_name: string
  grade_name: string
  stage_name: string
  avg_score: number | null
  attendance_rate: number | null
  homework_rate: number | null
  behavior_score: number | null
  exams_taken: number
  overall_score: number | null
}

export interface Payment {
  id: string
  student_id: string
  amount: number
  payment_date: string
  note: string | null
  created_at: string
  recorded_by: string | null
  recorded_at: string | null
  receipt_number: string | null
  is_deleted: boolean
  deleted_at: string | null
  month_key: string | null
  is_historical_payment: boolean
  target_archive_month: string | null
  requires_manager_override: boolean
  idempotency_key: string | null
}

export interface MonthlySubscription {
  id: string
  student_id: string
  month: string
  month_key: string
  amount_due: number
  amount_paid: number
  status: string
  paid_date: string | null
  is_archived: boolean
  note: string | null
  recorded_by: string | null
  created_at: string
  receipt_number: string | null
  is_exempt: boolean
  exemption_note: string | null
}

export interface Certificate {
  id: string
  student_id: string
  exam_title: string | null
  score: number | null
  max_score: number | null
  serial_id: string
  issued_at: string
  created_at: string
}
