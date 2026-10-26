import { useState, useEffect, useLayoutEffect, useCallback, useRef, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { resetBodyScrollLock, lockBodyScroll, unlockBodyScroll } from '@/lib/bodyScrollLock';
import {
  Home,
  Users,
  UsersRound,
  UserRound,
  BarChart3,
  Award,
  ClipboardPenLine,
  ClipboardList,
  MessageCircle,
  UserCog,
  CreditCard,
  Settings,
  LogOut,
  ChevronLeft,
  GraduationCap,
  ClipboardCheck,
  CalendarDays,
  BookOpen,
  Trash2,
  Menu,
  X,
  Maximize2,
  Minimize2,
  Globe,
  Archive,
  Wallet,
  Calculator,
  CalendarCheck,
  Activity,
  ShieldCheck,
  Bot,
  Brain,
  FlaskConical,
  Bell,
} from 'lucide-react';
import FloatingActionButton from '@/components/ui/FloatingActionButton';
import { useAuth } from '@/context/AuthContext';
import { useMonth } from '@/context/MonthContext';
import {
  fetchStages,
  fetchGradeLevels,
  fetchGroups,
  fetchStudentsByGroup,
  fetchDashboardKPIs,
  fetchGroupStats,
  deletePaymentWithAudit,
} from '@/lib/data';
import { getCached, isCacheFresh, invalidateByPrefix } from '@/lib/cache';
import { formatCurrency } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { checkMonthReset } from '@/lib/monthReset';
import { computeFinancialSummary, filterStudentsByHierarchy } from '@/lib/financeCalc';
import type { AcademicStage, GradeLevel, Group, Student, Payment } from '@/lib/types';
import { usePersistedState, getPersistedId, setPersistedId } from '@/hooks/usePersistedState';
import { useMissingDataDetector } from '@/hooks/useMissingDataDetector';
import { NOTIFICATION_NAVIGATE_EVENT, type NotificationActionTarget } from '@/context/NotificationContext';

type EnrichedStudent = Student & { group_name?: string; grade_name?: string; stage_name?: string };
import Navbar from '@/components/ui/Navbar';
import Watermark from '@/components/ui/Watermark';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Stepper from '@/components/ui/Stepper';
import Breadcrumbs from '@/components/ui/Breadcrumbs';
import Button from '@/components/ui/Button';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import UnifiedGroupSelector from '@/components/ui/UnifiedGroupSelector';
import { useSettings } from '@/context/SettingsContext';
import SmartEmptyState from '@/components/ui/SmartEmptyState';

const HomeDashboard = lazyWithRetry(() => import('@/components/dashboard/HomeDashboard'));
const GroupManager = lazyWithRetry(() => import('@/components/dashboard/GroupManager'));
const StudentManager = lazyWithRetry(() => import('@/components/dashboard/StudentManager'));
const TaskCenter = lazyWithRetry(() => import('@/components/dashboard/TaskCenter'));
const ActivityLogModal = lazyWithRetry(() => import('@/components/dashboard/ActivityLogModal'));
const DailyCollectionsWidget = lazyWithRetry(() => import('@/components/dashboard/DailyCollectionsWidget'));
const SecretFinancialWidget = lazyWithRetry(() => import('@/components/dashboard/SecretFinancialWidget'));
const CommandBar = lazyWithRetry(() => import('@/components/ui/CommandBar'));

const AssistantsManager = lazyWithRetry(() => import('@/components/dashboard/AssistantsManager'));
const FinancesModule = lazyWithRetry(() => import('@/components/dashboard/FinancesModule'));
const SubscriptionsModule = lazyWithRetry(() => import('@/components/dashboard/SubscriptionsModule'));
const ParentLinksModule = lazyWithRetry(() => import('@/components/dashboard/ParentLinksModule'));
const ArchiveOverview = lazyWithRetry(() => import('@/components/dashboard/ArchiveOverview'));
const AttendanceModule = lazyWithRetry(() => import('@/components/modules/AttendanceModule'));
const CenterGrades = lazyWithRetry(() => import('@/components/modules/CenterGrades'));
const OnlineGrades = lazyWithRetry(() => import('@/components/modules/OnlineGrades'));
const OnlineExamGrades = lazyWithRetry(() => import('@/components/modules/OnlineExamGrades'));
const CertificateModule = lazyWithRetry(() => import('@/components/modules/CertificateModule'));
const ExamBuilder = lazyWithRetry(() => import('@/components/modules/ExamBuilder'));
const LiveExamMonitor = lazyWithRetry(() => import('@/components/modules/LiveExamMonitor'));
const HomeworkBehavior = lazyWithRetry(() => import('@/components/modules/HomeworkBehavior'));
const SessionCalendar = lazyWithRetry(() => import('@/components/modules/SessionCalendar'));
const SmartCenterControl = lazyWithRetry(() => import('@/components/dashboard/SmartCenterControl'));
const AccountingCycles = lazyWithRetry(() => import('@/components/dashboard/AccountingCycles'));
const FinancialInvestigation = lazyWithRetry(() => import('@/components/dashboard/FinancialInvestigation'));
const MonthClosureManager = lazyWithRetry(() => import('@/components/dashboard/MonthClosureManager'));
const HealthScoreWidget = lazyWithRetry(() => import('@/components/dashboard/HealthScoreWidget'));
const PlatformDataCheck = lazyWithRetry(() => import('@/components/dashboard/PlatformDataCheck'));
const AskPlatform = lazyWithRetry(() => import('@/components/dashboard/AskPlatform'));
const PlatformIntelligence = lazyWithRetry(() => import('@/components/dashboard/PlatformIntelligence'));
const ExamLab = lazyWithRetry(() => import('@/components/exam-lab/ExamLab'));
const ExamManagementDashboard = lazyWithRetry(() => import('@/components/dashboard/ExamManagementDashboard'));

type Tab =
  | 'home'
  | 'stepper'
  | 'attendance'
  | 'session-calendar'
  | 'grades'
  | 'certificates'
  | 'exams'
  | 'online-grades'
  | 'tracking'
  | 'subscriptions'
  | 'parent'
  | 'assistants'
  | 'finances'
  | 'daily-collections'
  | 'archive'
  | 'accounting'
  | 'month-closure'
  | 'monitoring'
  | 'health-score'
  | 'data-check'
  | 'ask-platform'
  | 'intelligence'
  | 'exam-lab'
  | 'exam-management'
  | 'settings';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'الرئيسية', icon: <Home size={16} /> },
  { id: 'stepper', label: 'قائمة الطلاب', icon: <UsersRound size={16} /> },
  { id: 'attendance', label: 'حضور المركز', icon: <ClipboardCheck size={16} /> },
  { id: 'session-calendar', label: 'مواعيد الحصص', icon: <CalendarDays size={16} /> },
  { id: 'grades', label: 'سجل الدرجات', icon: <BarChart3 size={16} /> },
  { id: 'certificates', label: 'شهادات التقدير', icon: <Award size={16} /> },
  { id: 'exams', label: 'منصة الامتحانات', icon: <ClipboardPenLine size={16} /> },
  { id: 'online-grades', label: 'درجات امتحانات الأونلاين', icon: <Globe size={16} /> },
  { id: 'tracking', label: 'الواجبات والسلوك', icon: <ClipboardPenLine size={16} /> },
  { id: 'subscriptions', label: 'إجمالي المجموعة', icon: <CalendarDays size={16} /> },
  { id: 'parent', label: 'أولياء الأمور وواتساب', icon: <MessageCircle size={16} /> },
  { id: 'archive', label: 'الأرشيف', icon: <Archive size={16} /> },
  { id: 'accounting', label: 'المحاسبة', icon: <Calculator size={16} /> },
  { id: 'month-closure', label: 'إغلاق الشهر', icon: <CalendarCheck size={16} /> },
  { id: 'monitoring', label: 'مركز المتابعة', icon: <Activity size={16} /> },
  { id: 'health-score', label: 'مؤشر صحة السنتر', icon: <Activity size={16} /> },
  { id: 'data-check', label: 'فحص المنصة', icon: <ShieldCheck size={16} /> },
  { id: 'ask-platform', label: 'اسأل المنصة', icon: <Bot size={16} /> },
  { id: 'intelligence', label: 'ذكاء المنصة', icon: <Brain size={16} /> },
  { id: 'exam-lab', label: 'معمل الاختبارات', icon: <FlaskConical size={16} /> },
  { id: 'exam-management', label: 'إدارة الامتحانات', icon: <ClipboardList size={16} /> },
  { id: 'assistants', label: 'إدارة المساعدين', icon: <UserRound size={16} /> },
  { id: 'finances', label: 'الماليات والمدفوعات', icon: <CreditCard size={16} /> },
  { id: 'daily-collections', label: 'تحصيل اليوم', icon: <Wallet size={16} /> },
  { id: 'settings', label: 'الإعدادات', icon: <Settings size={16} /> },
];

export default function DashboardPage() {
  const { role, logout, isMaster, can, assistant } = useAuth();
  const { monthKey } = useMonth();
  const navigate = useNavigate();
  const [tab, setTab] = usePersistedState<Tab>('dash_tab', 'home');
  // Never auto-restore the Archive tab on login/reload — always land on home.
  // The user can still navigate to Archive manually via the header icon.
  useEffect(() => { if (tab === 'archive') setTab('home'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [stages, setStages] = useState<AcademicStage[]>([]);
  const [selectedStage, setSelectedStage] = useState<AcademicStage | null>(null);
  const [gradeLevels, setGradeLevels] = useState<GradeLevel[]>([]);
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const studentsReqIdRef = useRef(0);
  const groupsReqIdRef = useRef(0);
  const statsReqIdRef = useRef(0);
  const kpiReqIdRef = useRef(0);
  // Safety: prevent infinite loading states
  useEffect(() => {
    if (!groupsLoading) return;
    const t = setTimeout(() => setGroupsLoading(false), 800);
    return () => clearTimeout(t);
  }, [groupsLoading]);
  useEffect(() => {
    if (!studentsLoading) return;
    const t = setTimeout(() => setStudentsLoading(false), 800);
    return () => clearTimeout(t);
  }, [studentsLoading]);
  const [allStudents, setAllStudents] = useState<EnrichedStudent[]>([]);
  const [fees, setFees] = useState({ collected: 0, remaining: 0 });
  const [monthlyPaidMap, setMonthlyPaidMap] = useState<Map<string, number>>(new Map());
  const [monthExemptMap, setMonthExemptMap] = useState<Map<string, true>>(new Map());
  const [groupStats, setGroupStats] = useState({ totalStudents: 0, collected: 0, remaining: 0, fullyPaid: 0, partialPaid: 0 });
  const [groupPayments, setGroupPayments] = useState<(Payment & { student_name?: string })[]>([]);
  const [groupPaymentsOpen, setGroupPaymentsOpen] = useState(false);
  const [deletePayTarget, setDeletePayTarget] = useState<Payment | null>(null);
  const { settings } = useSettings();
  const [gradesTab, setGradesTab] = usePersistedState<'center' | 'online'>('dash_gradesTab', 'center');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [secretFinOpen, setSecretFinOpen] = useState(false);
  const [searchFocus, setSearchFocus] = useState<{ stageId: string; gradeId: string; groupId: string; studentId: string } | null>(null);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [groupSwitcherOpen, setGroupSwitcherOpen] = useState(false);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [notifFocusStudentId, setNotifFocusStudentId] = useState<string | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);

  const loadStages = useCallback(async () => {
    try {
      const data = await fetchStages();
      setStages(data);
      // Restore persisted stage
      const savedStageId = getPersistedId('dash_stage');
      if (savedStageId) {
        const match = data.find((s) => s.id === savedStageId);
        if (match) setSelectedStage(match);
      }
    } catch {
      /* page still renders, stages empty */
    }
  }, []);

  const loadKPIs = useCallback(async (mk?: string) => {
    const activeMonth = mk ?? monthKey;
    const cacheKey = `kpi_${activeMonth}`;
    const reqId = ++kpiReqIdRef.current;
    setKpiError(null);

    // If we have cached data, show it immediately and skip the loading spinner
    const cached = getCached<Awaited<ReturnType<typeof fetchDashboardKPIs>>>(cacheKey);
    if (cached) {
      setAllStudents(cached.allStudents);
      setFees(cached.fees);
      setMonthlyPaidMap(new Map(cached.monthlyPaidArr ?? []));
      setMonthExemptMap(new Map((cached.monthExemptArr ?? []).map((id) => [id, true] as [string, true])));
      setAllGroups(cached.allGroups);
      setKpiLoading(false);
      // If cache is fresh, no need to refetch
      if (isCacheFresh(cacheKey)) return;
    }
    // KPI loading runs in the background — UI shows whatever data is already available
    try {
      const { allStudents, fees, monthlyPaidArr, monthExemptArr, allGroups } = await fetchDashboardKPIs(activeMonth);
      if (reqId !== kpiReqIdRef.current) return;
      setAllStudents(allStudents);
      setFees(fees);
      setMonthlyPaidMap(new Map(monthlyPaidArr));
      setMonthExemptMap(new Map(monthExemptArr.map((id) => [id, true] as [string, true])));
      setAllGroups(allGroups);
    } catch (err) {
      if (reqId !== kpiReqIdRef.current) return;
      const msg = err instanceof Error ? err.message : 'تعذّر تحميل البيانات';
      setKpiError(msg === 'timeout' ? 'انتهت مهلة الاتصال بالخادم' : msg);
    } finally {
      if (reqId === kpiReqIdRef.current) setKpiLoading(false);
    }
  }, [monthKey]);

  // Safety: force-clear loading state after 3s even if KPI fetch hangs
  useEffect(() => {
    if (!kpiLoading) return;
    const timeout = setTimeout(() => setKpiLoading(false), 3000);
    return () => clearTimeout(timeout);
  }, [kpiLoading]);

  useEffect(() => {
    checkMonthReset();
    loadStages();
  }, [loadStages]);

  // Reload KPIs whenever the active month changes — ensures strict monthly isolation
  useEffect(() => {
    loadKPIs(monthKey);
  }, [monthKey, loadKPIs]);

  // Preload only the 5 most frequently used tab modules on mount.
  // Preloading all 24 chunks (~700KB) competes with initial render on mobile.
  // Remaining tabs lazy-load on first navigation — the Suspense fallback handles it.
  useEffect(() => {
    const priority = [
      () => import('@/components/modules/AttendanceModule'),
      () => import('@/components/modules/HomeworkBehavior'),
      () => import('@/components/modules/CenterGrades'),
      () => import('@/components/dashboard/FinancesModule'),
      () => import('@/components/dashboard/SubscriptionsModule'),
    ];
    const schedule = (index: number) => {
      if (index >= priority.length) return;
      const run = () => {
        priority[index]().catch(() => {});
        schedule(index + 1);
      };
      if ('requestIdleCallback' in window) {
        (window as Window).requestIdleCallback(run, { timeout: 3000 });
      } else {
        setTimeout(run, 500);
      }
    };
    schedule(0);
  }, []);

  // Keyboard shortcut: Ctrl+K / Cmd+K to open command bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandBarOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const loadGradeLevels = useCallback(async () => {
    if (!selectedStage) return;
    try {
      const data = await fetchGradeLevels(selectedStage.id);
      setGradeLevels(data);
      const savedGradeId = getPersistedId('dash_grade');
      const match = savedGradeId ? data.find((g) => g.id === savedGradeId) : null;
      if (match) {
        setSelectedGrade(match);
      } else {
        setSelectedGrade(null);
        setSelectedGroup(null);
        setGroups([]);
        setStudents([]);
      }
    } catch {
      // Preserve existing data on transient fetch failure
    }
  }, [selectedStage]);

  useEffect(() => { loadGradeLevels(); }, [loadGradeLevels]);

  const loadGroups = useCallback(async () => {
    if (!selectedGrade) return;
    const reqId = ++groupsReqIdRef.current;
    const gradeId = selectedGrade.id;
    // Only show loading skeleton on first load, not on refresh when data exists
    if (groups.length === 0) setGroupsLoading(true);
    try {
      const data = await fetchGroups(gradeId);
      if (reqId !== groupsReqIdRef.current) return;
      setGroups(data);
      const savedGroupId = getPersistedId('dash_group');
      const match = savedGroupId ? data.find((g) => g.id === savedGroupId) : null;
      if (match) {
        setSelectedGroup(match);
      } else {
        setSelectedGroup(null);
        setStudents([]);
      }
    } catch {
      // Preserve existing data on transient fetch failure
    } finally {
      if (reqId === groupsReqIdRef.current) setGroupsLoading(false);
    }
  }, [selectedGrade]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  const loadStudents = useCallback(async () => {
    if (!selectedGroup) return;
    const reqId = ++studentsReqIdRef.current;
    const gid = selectedGroup.id;
    if (students.length === 0) setStudentsLoading(true);
    try {
      const data = await fetchStudentsByGroup(gid);
      if (reqId !== studentsReqIdRef.current) return;
      setStudents(data);
    } catch {
      // Preserve existing student data on transient fetch failure
    } finally {
      if (reqId === studentsReqIdRef.current) setStudentsLoading(false);
    }
  }, [selectedGroup]);

  useEffect(() => { loadStudents(); }, [loadStudents]);

  const loadGroupStats = useCallback(async () => {
    if (!selectedGroup) return;
    const reqId = ++statsReqIdRef.current;
    const gid = selectedGroup.id;
    try {
      const stats = await fetchGroupStats(gid, monthKey);
      if (reqId !== statsReqIdRef.current) return;
      setGroupStats(stats);
    } catch {
      /* keep previous stats */
    }
  }, [selectedGroup, monthKey]);

  useEffect(() => { loadGroupStats(); }, [loadGroupStats]);

  // Persist hierarchy selections
  useEffect(() => { setPersistedId('dash_stage', selectedStage?.id ?? null); }, [selectedStage]);
  useEffect(() => { setPersistedId('dash_grade', selectedGrade?.id ?? null); }, [selectedGrade]);
  useEffect(() => { setPersistedId('dash_group', selectedGroup?.id ?? null); }, [selectedGroup]);

  // Stable refs for realtime callbacks — avoids tearing down/rebuilding the
  // WebSocket subscription every time monthKey changes (which creates new
  // useCallback references for loadKPIs/loadStudents/loadGroupStats).
  const loadKPIsRef = useRef(loadKPIs);
  const loadStudentsRef = useRef(loadStudents);
  const loadGroupStatsRef = useRef(loadGroupStats);
  const selectedGroupRef = useRef(selectedGroup);
  loadKPIsRef.current = loadKPIs;
  loadStudentsRef.current = loadStudents;
  loadGroupStatsRef.current = loadGroupStats;
  selectedGroupRef.current = selectedGroup;

  useEffect(() => {
    let debounced: ReturnType<typeof setTimeout> | null = null;
    let groupDebounced: ReturnType<typeof setTimeout> | null = null;
    const triggerKPIRefresh = () => {
      if (debounced) clearTimeout(debounced);
      debounced = setTimeout(() => loadKPIsRef.current(), 1500);
    };
    const triggerGroupRefresh = () => {
      if (groupDebounced) clearTimeout(groupDebounced);
      groupDebounced = setTimeout(() => {
        if (selectedGroupRef.current) {
          loadStudentsRef.current();
          loadGroupStatsRef.current();
        }
      }, 800);
    };

    const triggerBoth = () => { triggerKPIRefresh(); triggerGroupRefresh(); };
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, triggerBoth)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students' }, triggerBoth)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'monthly_subscriptions' }, triggerBoth)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, triggerBoth)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, triggerGroupRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'center_grades' }, triggerGroupRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'homework_status' }, triggerGroupRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'behavior_eval' }, triggerGroupRefresh)
      .subscribe();

    return () => {
      if (debounced) clearTimeout(debounced);
      if (groupDebounced) clearTimeout(groupDebounced);
      supabase.removeChannel(channel);
    };
  }, []);

  // Smart auto-refresh: when the app returns to the foreground (visibilitychange,
  // focus, pageshow) or reconnects (online), refresh data once. All reloads are
  // debounced and deduped to prevent loops, duplicate requests, or logout.
  useEffect(() => {
    let lastRefresh = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const doRefresh = () => {
      const now = Date.now();
      // Throttle: at most one refresh per 4s to avoid duplicate requests.
      if (now - lastRefresh < 4000) return;
      lastRefresh = now;
      try {
        invalidateByPrefix('students_');
        invalidateByPrefix('kpi_');
        loadKPIsRef.current();
        if (selectedGroupRef.current) {
          loadStudentsRef.current();
          loadGroupStatsRef.current();
        }
      } catch { /* ignore — realtime will catch up */ }
    };

    const scheduleRefresh = () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        doRefresh();
      }, 600);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    const onFocus = () => scheduleRefresh();
    const onOnline = () => scheduleRefresh();
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) scheduleRefresh();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  useEffect(() => {
    if (sidebarOpen) {
      lockBodyScroll();
      return () => { unlockBodyScroll(); };
    }
  }, [sidebarOpen]);

  // Safety: reset body scroll lock and inline styles when switching tabs/groups.
  // Only resets body styles — DOM node removal is handled by React's own unmount logic.
  useLayoutEffect(() => {
    if (!sidebarOpen) {
      resetBodyScrollLock();
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
    }
  }, [tab, selectedGroup, sidebarOpen]);

  // Scroll position restoration: save on scroll, restore after refresh.
  const scrollRestoreKey = `dash_scroll_${tab}`;
  useEffect(() => {
    const saved = sessionStorage.getItem(scrollRestoreKey);
    if (saved) {
      const y = parseInt(saved, 10);
      if (Number.isFinite(y) && y > 0) {
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
      sessionStorage.removeItem(scrollRestoreKey);
    }
  }, [scrollRestoreKey]);

  useEffect(() => {
    let ticking = false;
    let lastSave = 0;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const now = Date.now();
        if (now - lastSave > 500) {
          lastSave = now;
          sessionStorage.setItem(scrollRestoreKey, String(window.scrollY));
        }
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [scrollRestoreKey]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function switchTab(t: Tab) {
    setTab(t);
    setSidebarOpen(false);
  }

  function guardedSwitch(
    newStage: AcademicStage | null,
    newGrade: GradeLevel | null,
    newGroup: Group | null
  ) {
    setSelectedStage(newStage);
    setSelectedGrade(newGrade);
    setSelectedGroup(newGroup);
  }

  function refreshGroups() {
    loadGroups();
    loadKPIs();
  }

  function refreshStudents() {
    loadStudents();
    loadGroupStats();
  }

  async function openGroupPayments() {
    if (!selectedGroup) return;
    setGroupPayments([]);
    setGroupPaymentsOpen(true);
    if (students.length === 0) return;
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*, student:students(name)')
        .in('student_id', students.map((s) => s.id))
        .eq('month_key', monthKey)
        .eq('is_deleted', false)
        .order('payment_date', { ascending: false });
      if (error) throw new Error(error.message);
      if (data) {
        const mapped = (data as (Payment & { student?: { name: string } })[]).map((p) => ({
          ...p,
          student_name: p.student?.name,
        }));
        setGroupPayments(mapped);
      }
    } catch {
      /* modal stays open with empty list */
    }
  }

  const [deletePayLoading, setDeletePayLoading] = useState(false);

  async function handleDeleteGroupPayment() {
    if (!deletePayTarget || deletePayLoading) return;
    setDeletePayLoading(true);
    try {
      await deletePaymentWithAudit(deletePayTarget.id, isMaster ? 'المدرس' : assistant?.display_name ?? assistant?.username ?? 'مساعد', isMaster ? 'master' : 'assistant');
      setDeletePayTarget(null);
      await openGroupPayments();
      refreshStudents();
    } catch (err) {
      console.error('[handleDeleteGroupPayment]', err);
    } finally {
      setDeletePayLoading(false);
    }
  }

  // Filter students by the currently selected stage/grade/group for sub-module views.
  const filteredStudents = useMemo(
    () => filterStudentsByHierarchy(allStudents, selectedStage?.name, selectedGrade?.name, selectedGroup?.id),
    [allStudents, selectedStage, selectedGrade, selectedGroup]
  );

  // Global financial summary — always computed from ALL students, never filtered.
  // The home dashboard must show platform-wide totals regardless of local selections.
  const globalFinancialSummary = useMemo(
    () => computeFinancialSummary(allStudents, monthlyPaidMap, monthExemptMap),
    [allStudents, monthlyPaidMap, monthExemptMap]
  );

  // Local financial summary for sub-module views that need filtered totals.
  const financialSummary = useMemo(
    () => computeFinancialSummary(filteredStudents, monthlyPaidMap, monthExemptMap),
    [filteredStudents, monthlyPaidMap, monthExemptMap]
  );

  const stepIndex = !selectedStage ? 0 : !selectedGrade ? 1 : !selectedGroup ? 2 : 3;

  const handleMissingDataNavigate = useCallback((groupId: string, _groupName: string, target: 'attendance' | 'tracking' | 'grades') => {
    const group = allGroups.find((g) => g.id === groupId);
    if (group) {
      const grade = gradeLevels.find((gl) => gl.id === group.grade_level_id);
      const stage = stages.find((s) => s.id === grade?.stage_id);
      guardedSwitch(stage ?? null, grade ?? null, group);
    }
    setTab(target);
    setSidebarOpen(false);
  }, [allGroups, gradeLevels, stages, setTab]);

  useMissingDataDetector({
    onNavigate: handleMissingDataNavigate,
  });

  // Listen for notification "عرض البيانات" navigation events
  useEffect(() => {
    function handleNotifNav(e: Event) {
      const detail = (e as CustomEvent<NotificationActionTarget>).detail;
      if (!detail) return;
      const group = allGroups.find((g) => g.id === detail.groupId);
      if (group) {
        const grade = gradeLevels.find((gl) => gl.id === group.grade_level_id);
        const stage = stages.find((s) => s.id === grade?.stage_id);
        setSelectedStage(stage ?? null);
        setSelectedGrade(grade ?? null);
        setSelectedGroup(group);
      }
      setNotifFocusStudentId(detail.studentId ?? null);
      setTab(detail.tab);
      setSidebarOpen(false);
      // Clear focus after a delay so it doesn't persist unnecessarily
      setTimeout(() => setNotifFocusStudentId(null), 5000);
    }
    window.addEventListener(NOTIFICATION_NAVIGATE_EVENT, handleNotifNav);
    return () => window.removeEventListener(NOTIFICATION_NAVIGATE_EVENT, handleNotifNav);
  }, [allGroups, gradeLevels, stages, setTab]);

  // Tabs that require a group selection
  const groupRequired: Tab[] = ['attendance', 'session-calendar', 'grades', 'certificates', 'tracking', 'subscriptions'];
  const gradeRequired: Tab[] = ['exams'];
  const needsGroup = groupRequired.includes(tab) && !selectedGroup;
  const needsGrade = gradeRequired.includes(tab) && !selectedGrade;

  // Filter tabs by permissions — master sees everything
  const visibleTabs = useMemo(
    () => TABS.filter((t) => {
      if (isMaster) return true;
      if (t.id === 'home' || t.id === 'stepper') return true;
      if (t.id === 'assistants' || t.id === 'settings') return false;
      if (t.id === 'finances') return can('can_view_finance');
      if (t.id === 'daily-collections') return can('can_view_finance');
      if (t.id === 'subscriptions') return can('can_view_subscriptions');
      if (t.id === 'attendance') return can('can_view_attendance');
      if (t.id === 'session-calendar') return can('can_view_attendance');
      if (t.id === 'grades') return can('can_view_grades');
      if (t.id === 'certificates') return can('can_view_certificates');
      if (t.id === 'exams') return can('can_view_exams');
      if (t.id === 'online-grades') return can('can_view_exams');
      if (t.id === 'tracking') return can('can_view_tracking');
      if (t.id === 'parent') return can('can_view_parent_links');
      if (t.id === 'archive') return can('can_view_attendance') || can('can_view_grades') || can('can_view_tracking');
      if (t.id === 'accounting') return isMaster || can('can_view_finance');
      if (t.id === 'month-closure') return isMaster || can('can_view_finance');
      if (t.id === 'monitoring') return true;
      if (t.id === 'health-score') return true;
      if (t.id === 'data-check') return true;
      if (t.id === 'ask-platform') return true;
      if (t.id === 'exam-lab') return true;
      return false;
    }),
    [isMaster, can]
  );

  return (
    <div className="min-h-screen pb-12">
      <Navbar
        onLogout={handleLogout}
        onSearchNavigate={async (s, target) => {
          if (!s.group_id && target !== 'profile') return;
          // Hoist resolved values so searchFocus uses them, not stale React state.
          let resolvedStage: AcademicStage | null = selectedStage;
          let resolvedGrade: GradeLevel | null = selectedGrade;
          let resolvedGroupId = s.group_id ?? '';
          // ID-based lookup: resolve stage and grade from the group's foreign keys
          // rather than matching by name (which fails with similar names).
          if (s.group_id) {
            // Find the group in allGroups (already loaded) or fetch it directly
            let grp = allGroups.find((g) => g.id === s.group_id) ?? null;
            if (!grp) {
              // Fallback: fetch groups for the grade level if we can resolve it
              // For now, set the group directly from the search result's embedded data
              grp = s.group_id ? { id: s.group_id, name: s.group_name ?? '', grade_level_id: '', schedule: null } as Group : null;
            }
            // Resolve grade + stage via the group's grade_level relationship
            // Use fetchGroups to find the full group object with grade_level_id
            try {
              // Check if the group is already in the current groups list
              let fullGrp = groups.find((g) => g.id === s.group_id) ?? null;
              if (!fullGrp && selectedGrade) {
                const gradeGroups = await fetchGroups(selectedGrade.id);
                fullGrp = gradeGroups.find((g) => g.id === s.group_id) ?? null;
              }
              // If we still don't have it, try to resolve via allGroups
              if (!fullGrp) {
                fullGrp = grp;
              }
              // Resolve grade level from allGroups enriched data
              const enrichedGrp = allGroups.find((g) => g.id === s.group_id);
              const gradeLevelId = fullGrp?.grade_level_id ?? enrichedGrp?.grade_level_id ?? '';
              // Find the grade in gradeLevels or fetch it
              let gl = gradeLevels.find((g) => g.id === gradeLevelId) ?? null;
              if (!gl && gradeLevelId) {
                // Fetch stages to find the right stage, then grade levels
                const stagesData = await fetchStages();
                for (const st of stagesData) {
                  const gdata = await fetchGradeLevels(st.id);
                  const found = gdata.find((g) => g.id === gradeLevelId);
                  if (found) {
                    gl = found;
                    if (st.id !== selectedStage?.id) {
                      setSelectedStage(st);
                      resolvedStage = st;
                    }
                    break;
                  }
                }
              } else if (gl && gl.stage_id !== selectedStage?.id) {
                const stage = stages.find((st) => st.id === gl!.stage_id);
                if (stage) {
                  setSelectedStage(stage);
                  resolvedStage = stage;
                }
              }
              if (gl) {
                setSelectedGrade(gl);
                resolvedGrade = gl;
              }
              if (fullGrp) {
                setSelectedGroup(fullGrp);
                resolvedGroupId = fullGrp.id;
              }
            } catch {
              // Fallback: just set the group from search result
              if (grp) setSelectedGroup(grp);
            }
          }
          // Build searchFocus from the RESOLVED values, not the stale state
          // (setSelectedStage/Grade/Group batch and don't update synchronously).
          setSearchFocus({ stageId: resolvedStage?.id ?? '', gradeId: resolvedGrade?.id ?? '', groupId: resolvedGroupId, studentId: s.id });
          setNotifFocusStudentId(s.id);
          const tabMap: Record<string, Tab> = {
            finance: 'finances',
            attendance: 'attendance',
            homework: 'tracking',
            exams: 'exams',
            profile: 'home',
          };
          setTab(tabMap[target] ?? 'attendance');
        }}
        rightContent={
          isMaster ? (
            <Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>
              <Settings size={16} />
              <span className="hidden sm:inline">الإعدادات</span>
            </Button>
          ) : undefined
        }
        onOpenFinances={() => setSecretFinOpen(true)}
        onOpenArchive={() => setTab('archive')}
      />

      <Suspense fallback={null}>
        <CommandBar
          open={commandBarOpen}
          onClose={() => setCommandBarOpen(false)}
          onNavigate={(t) => setTab(t as Tab)}
          onSearchStudent={(q) => { setTab('attendance'); }}
        />
      </Suspense>
      <Suspense fallback={null}>
        <TaskCenter
          open={taskCenterOpen}
          onClose={() => setTaskCenterOpen(false)}
          onNavigate={(t) => setTab(t as Tab)}
          allGroups={allGroups}
        />
      </Suspense>

      {/* Mobile menu toggle bar */}
      <div className={`lg:hidden sticky top-14 z-30 glass border-b border-white/[0.06] px-3 py-2.5 flex items-center justify-between ${focusMode ? 'hidden' : ''}`}>
        <span className="text-sm font-bold text-white flex items-center gap-2 min-w-0">
          {visibleTabs.find((t) => t.id === tab)?.icon}
          <span className="truncate">{visibleTabs.find((t) => t.id === tab)?.label ?? 'القائمة'}</span>
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setTaskCenterOpen(true)} className="p-2.5 rounded-xl hover:bg-white/10 text-amber-400 transition active:scale-90 min-w-[40px] min-h-[40px] flex items-center justify-center" title="مركز المهام">
            <Bell size={20} />
          </button>
          <button onClick={() => setFocusMode(true)} className="p-2.5 rounded-xl hover:bg-white/10 text-amber-400 transition active:scale-90 min-w-[40px] min-h-[40px] flex items-center justify-center" title="وضع التركيز">
            <Maximize2 size={20} />
          </button>
          <button onClick={() => setSidebarOpen(true)} className="p-2.5 rounded-xl hover:bg-white/10 text-emerald-400 transition active:scale-90 min-w-[40px] min-h-[40px] flex items-center justify-center">
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* Focus mode exit bar */}
      {focusMode && (
        <div className="lg:hidden sticky top-14 z-30 glass border-b border-white/[0.06] px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-bold text-amber-400 flex items-center gap-2">
            <Maximize2 size={18} />
            وضع التركيز
          </span>
          <button onClick={() => setFocusMode(false)} className="p-2.5 rounded-xl hover:bg-white/10 text-slate-400 transition active:scale-90" title="إنهاء وضع التركيز">
            <Minimize2 size={20} />
          </button>
        </div>
      )}

      {/* Mobile overlay — no AnimatePresence to prevent orphaned ghost overlays */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/55 z-40 lg:hidden pointer-events-auto"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar navigation */}
      <aside
        className={`fixed top-14 right-0 h-[calc(100vh-3.5rem)] w-72 sm:w-64 glass border-l border-white/10 z-50 drawer-transition lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        } ${focusMode ? 'lg:translate-x-full lg:opacity-0 lg:pointer-events-none' : ''}`}
      >
        <div className="h-full flex flex-col">
          {/* Mobile close header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 lg:hidden">
            <span className="text-sm font-bold text-white">أقسام المنصة</span>
            <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-lg hover:bg-white/10 text-slate-400 transition min-w-[36px] min-h-[36px] flex items-center justify-center">
              <X size={18} />
            </button>
          </div>

          {/* All Groups quick switcher */}
          {allGroups.length > 0 && (
            <div className="px-3 pt-3 pb-1">
              <button
                onClick={() => setGroupSwitcherOpen((v) => !v)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition ${groupSwitcherOpen ? 'bg-[#d4af37]/15 text-white' : 'glass-light text-slate-400 hover:text-white hover:bg-white/5'}`}
              >
                <span className="flex items-center gap-2"><UsersRound size={14} /> كل المجموعات</span>
                <ChevronLeft size={14} className={`transition-transform ${groupSwitcherOpen ? '-rotate-90' : ''}`} />
              </button>
              {groupSwitcherOpen && (
                <GroupHierarchyTree
                  groups={allGroups}
                  selectedGroupId={selectedGroup?.id ?? null}
                  onSelect={(g, grade, stage) => {
                    guardedSwitch(stage, grade, g);
                    setGroupSwitcherOpen(false);
                    setSidebarOpen(false);
                    setTab('attendance');
                  }}
                />
              )}
            </div>
          )}

          {/* Nav items */}
          <nav className="flex-1 overflow-y-auto p-3 space-y-0.5 modal-body premium-scroll">
            {visibleTabs.map((t) => {
              const isActive = tab === t.id;
              const isDivider = t.id === 'parent' || t.id === 'assistants' || t.id === 'finances' || t.id === 'accounting' || t.id === 'monitoring';
              const prevTab = visibleTabs[visibleTabs.indexOf(t) - 1];
              const showDivider = isDivider && prevTab && !['parent', 'assistants', 'settings', 'finances', 'daily-collections', 'accounting', 'month-closure', 'monitoring', 'health-score', 'data-check', 'ask-platform'].includes(prevTab.id);
              return (
                <div key={t.id}>
                  {showDivider && (
                    <div className="pt-2">
                      <div className="h-px premium-divider my-3" />
                      {t.id === 'finances' && (
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-1">الماليات</p>
                      )}
                      {t.id === 'parent' && (
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-1">التواصل</p>
                      )}
                      {t.id === 'accounting' && (
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-1">المحاسبة والإغلاق</p>
                      )}
                      {t.id === 'monitoring' && (
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-1">المتابعة والفحص</p>
                      )}
                      {t.id === 'assistants' && (
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-1">الإدارة</p>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => switchTab(t.id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-semibold transition-all premium-interactive ${
                      isActive
                        ? 'premium-nav-active text-white'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      isActive
                        ? 'bg-[#d4af37]/15 text-[#d4af37]'
                        : 'text-slate-500'
                    }`}>{t.icon}</span>
                    <span className="truncate">{t.label}</span>
                    {isActive && <span className="mr-auto w-1 h-1 rounded-full bg-[#d4af37]/70" />}
                  </button>
                </div>
              );
            })}
          </nav>

          {/* Logout at bottom */}
          <div className="p-3 border-t border-white/[0.06] safe-area-bottom">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-semibold text-red-400 hover:bg-red-500/10 transition premium-interactive"
            >
              <span className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-red-400"><LogOut size={16} /></span>
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main content — offset for sidebar on desktop */}
      <div className={`lg:mr-64 ${focusMode ? 'lg:mr-0' : ''}`}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 pb-24 lg:pb-6">
        <div className="relative min-h-[60vh]">
          <div key={tab}>
          {/* HOME */}
          {tab === 'home' && (
            kpiError && allStudents.length === 0 ? (
              <SmartEmptyState status="error" message={kpiError} onRetry={loadKPIs} />
            ) : (
            <ErrorBoundary fallbackTitle="تعذّر تحميل الرئيسية">
              <HomeDashboard
                totalStudents={allStudents.length}
                totalCollected={globalFinancialSummary.collected}
                totalRemaining={globalFinancialSummary.remaining}
                fullyPaid={globalFinancialSummary.fullyPaid}
                partialPaid={globalFinancialSummary.partialPaid}
                unpaidCount={globalFinancialSummary.unpaid}
                isMaster={isMaster}
                allStudents={allStudents}
                monthlyPaidMap={monthlyPaidMap}
                monthExemptMap={monthExemptMap}
                groupsCount={allGroups.length}
                groupId={selectedGroup?.id}
                groupName={selectedGroup?.name}
                students={selectedGroup ? students : []}
                allGroups={allGroups}
                onOpenActivityLog={() => setActivityLogOpen(true)}
                onNavigate={(t: string) => setTab(t as Tab)}
              />
            </ErrorBoundary>
            )
          )}

            {/* STEPPER — mandatory progression */}
            {tab === 'stepper' && (
              <div className="space-y-6">
                <div className="glass-card rounded-2xl p-6 space-y-6">
                  <div>
                    <h2 className="text-lg font-bold text-white mb-1">التدرج الإلزامي وإدارة المجموعات</h2>
                    <p className="text-xs text-slate-400">اختر المرحلة → الصف → المجموعة للوصول إلى الوحدات.</p>
                  </div>

                  <Stepper
                    steps={[
                      { id: 'stage', label: 'المرحلة' },
                      { id: 'grade', label: 'الصف' },
                      { id: 'group', label: 'المجموعة' },
                      { id: 'module', label: 'الوحدة' },
                    ]}
                    current={stepIndex}
                    onStepClick={(i) => {
                      if (i === 0) { guardedSwitch(null, null, null); }
                      if (i === 1) { guardedSwitch(selectedStage, null, null); }
                      if (i === 2) { guardedSwitch(selectedStage, selectedGrade, null); }
                    }}
                  />

                  <UnifiedGroupSelector
                    stages={stages}
                    gradeLevels={gradeLevels}
                    groups={groups}
                    groupsLoading={groupsLoading}
                    selectedStage={selectedStage}
                    selectedGrade={selectedGrade}
                    selectedGroup={selectedGroup}
                    onSelect={guardedSwitch}
                    showStepper={false}
                  />

                  {/* Instant group summary */}
                  {selectedGroup && (
                    <div className="glass-light rounded-2xl p-5 border border-emerald-500/20">
                      <h4 className="text-sm font-bold text-white mb-3 text-center">ملخص المجموعة: {selectedGroup.name}</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-center">
                        <SummaryBox label="إجمالي الطلاب" value={`${groupStats.totalStudents} طالب`} color="text-white" />
                        {isMaster ? (
                          <>
                            <SummaryBox label="دفع كامل" value={`${groupStats.fullyPaid} طالب`} color="text-emerald-400" />
                            <SummaryBox label="متبقي / جزئي" value={`${groupStats.partialPaid} طالب`} color="text-amber-400" />
                            <button onClick={openGroupPayments} className="glass-light rounded-xl p-3 hover:bg-emerald-500/10 transition cursor-pointer text-right" title="عرض تفاصيل الحركات">
                              <span className="text-[10px] text-slate-400 block mb-1">المبلغ المحصل (انقر للتفاصيل)</span>
                              <span className="text-base font-bold text-emerald-400">{formatCurrency(groupStats.collected)} ج.م</span>
                            </button>
                          </>
                        ) : (
                          <SummaryBox label="الاشتراكات" value="إدارة الأشهر" color="text-blue-400" />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Student manager visible under stepper */}
                {selectedGroup && (
                  <ErrorBoundary fallbackTitle="تعذّر تحميل إدارة الطلاب">
                    <StudentManager
                      groupId={selectedGroup.id}
                      gradeLevelId={selectedGrade?.id ?? null}
                      students={students}
                      loading={studentsLoading}
                      onRefresh={refreshStudents}
                    />
                  </ErrorBoundary>
                )}
              </div>
            )}

            {/* ATTENDANCE — requires group */}
            {tab === 'attendance' && (
              needsGroup ? <GroupRequiredNotice stages={stages} gradeLevels={gradeLevels} groups={groups} groupsLoading={groupsLoading} selectedStage={selectedStage} selectedGrade={selectedGrade} onSelect={guardedSwitch} /> : (
                selectedGroup && (
                  <div className="space-y-4">
                    <Breadcrumbs crumbs={[{ label: selectedStage?.name ?? '' }, { label: selectedGrade?.name ?? '' }, { label: selectedGroup.name, isLast: true }]} onHomeClick={() => setTab('home')} />
                    <GroupBreadcrumb
                      stage={selectedStage?.name}
                      grade={selectedGrade?.name}
                      group={selectedGroup.name}
                      onChangeGroup={() => setTab('stepper')}
                      stages={stages}
                      gradeLevels={gradeLevels}
                      groups={groups}
                      groupsLoading={groupsLoading}
                      selectedStage={selectedStage}
                      selectedGrade={selectedGrade}
                      selectedGroup={selectedGroup}
                      onSelect={guardedSwitch}
                    />
                    <Suspense fallback={null}>
                      <ErrorBoundary fallbackTitle="تعذّر تحميل صفحة الحضور">
                        <AttendanceModule groupId={selectedGroup.id} students={students} groupName={selectedGroup.name} stageName={selectedStage?.name} gradeName={selectedGrade?.name} focusStudentId={notifFocusStudentId} />
                      </ErrorBoundary>
                    </Suspense>
                    <div className="pt-6 border-t border-white/10">
                      <ErrorBoundary fallbackTitle="تعذّر تحميل إدارة الطلاب">
                        <StudentManager groupId={selectedGroup.id} gradeLevelId={selectedGrade?.id ?? null} students={students} loading={studentsLoading} onRefresh={refreshStudents} />
                      </ErrorBoundary>
                    </div>
                  </div>
                )
              )
            )}

            {/* SESSION CALENDAR — requires group */}
            {tab === 'session-calendar' && (
              needsGroup ? <GroupRequiredNotice stages={stages} gradeLevels={gradeLevels} groups={groups} groupsLoading={groupsLoading} selectedStage={selectedStage} selectedGrade={selectedGrade} onSelect={guardedSwitch} /> : (
                selectedGroup && (
                  <div className="space-y-4">
                    <Breadcrumbs crumbs={[{ label: selectedStage?.name ?? '' }, { label: selectedGrade?.name ?? '' }, { label: selectedGroup.name, isLast: true }]} onHomeClick={() => setTab('home')} />
                    <GroupBreadcrumb
                      stage={selectedStage?.name}
                      grade={selectedGrade?.name}
                      group={selectedGroup.name}
                      onChangeGroup={() => setTab('stepper')}
                      stages={stages}
                      gradeLevels={gradeLevels}
                      groups={groups}
                      groupsLoading={groupsLoading}
                      selectedStage={selectedStage}
                      selectedGrade={selectedGrade}
                      selectedGroup={selectedGroup}
                      onSelect={guardedSwitch}
                    />
                    <Suspense fallback={null}>
                      <ErrorBoundary fallbackTitle="تعذّر تحميل مواعيد الحصص">
                        <SessionCalendar groupId={selectedGroup.id} />
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                )
              )
            )}

            {/* GRADES — requires group, dual tabs */}
            {tab === 'grades' && (
              needsGroup ? <GroupRequiredNotice stages={stages} gradeLevels={gradeLevels} groups={groups} groupsLoading={groupsLoading} selectedStage={selectedStage} selectedGrade={selectedGrade} onSelect={guardedSwitch} /> : (
                selectedGroup && (
                  <div className="space-y-4">
                    <Breadcrumbs crumbs={[{ label: selectedStage?.name ?? '' }, { label: selectedGrade?.name ?? '' }, { label: selectedGroup.name, isLast: true }]} onHomeClick={() => setTab('home')} />
                    <GroupBreadcrumb
                      stage={selectedStage?.name}
                      grade={selectedGrade?.name}
                      group={selectedGroup.name}
                      onChangeGroup={() => setTab('stepper')}
                      stages={stages}
                      gradeLevels={gradeLevels}
                      groups={groups}
                      groupsLoading={groupsLoading}
                      selectedStage={selectedStage}
                      selectedGrade={selectedGrade}
                      selectedGroup={selectedGroup}
                      onSelect={guardedSwitch}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setGradesTab('center')}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${gradesTab === 'center' ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400'}`}
                      >
                        درجات السنتر
                      </button>
                      <button
                        onClick={() => setGradesTab('online')}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${gradesTab === 'online' ? 'bg-emerald-600 text-white' : 'glass-light text-slate-400'}`}
                      >
                        الامتحانات الإلكترونية
                      </button>
                    </div>
                    {gradesTab === 'center' && (
                      <Suspense fallback={null}>
                        <ErrorBoundary fallbackTitle="تعذّر تحميل درجات السنتر">
                          <CenterGrades groupId={selectedGroup.id} students={students} focusStudentId={notifFocusStudentId} />
                        </ErrorBoundary>
                      </Suspense>
                    )}
                    {gradesTab === 'online' && (
                      <Suspense fallback={null}>
                        <ErrorBoundary fallbackTitle="تعذّر تحميل الدرجات الإلكترونية">
                          <OnlineGrades groupId={selectedGroup.id} students={students} />
                        </ErrorBoundary>
                      </Suspense>
                    )}
                  </div>
                )
              )
            )}

            {/* CERTIFICATES — requires group */}
            {tab === 'certificates' && (
              needsGroup ? <GroupRequiredNotice stages={stages} gradeLevels={gradeLevels} groups={groups} groupsLoading={groupsLoading} selectedStage={selectedStage} selectedGrade={selectedGrade} onSelect={guardedSwitch} /> : (
                selectedGroup && (
                  <div className="space-y-4">
                    <Breadcrumbs crumbs={[{ label: selectedStage?.name ?? '' }, { label: selectedGrade?.name ?? '' }, { label: selectedGroup.name, isLast: true }]} onHomeClick={() => setTab('home')} />
                    <GroupBreadcrumb
                      stage={selectedStage?.name}
                      grade={selectedGrade?.name}
                      group={selectedGroup.name}
                      onChangeGroup={() => setTab('stepper')}
                      stages={stages}
                      gradeLevels={gradeLevels}
                      groups={groups}
                      groupsLoading={groupsLoading}
                      selectedStage={selectedStage}
                      selectedGrade={selectedGrade}
                      selectedGroup={selectedGroup}
                      onSelect={guardedSwitch}
                    />
                    <Suspense fallback={null}>
                      <ErrorBoundary fallbackTitle="تعذّر تحميل الشهادات">
                        <CertificateModule students={students} />
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                )
              )
            )}

            {/* EXAMS — requires group */}
            {tab === 'exams' && (
              <div className="space-y-4">
                {selectedGrade && (
                  <Breadcrumbs crumbs={[{ label: selectedStage?.name ?? '' }, { label: selectedGrade.name, isLast: true }]} onHomeClick={() => setTab('home')} />
                )}
                <Suspense fallback={null}>
                  <ErrorBoundary fallbackTitle="تعذّر تحميل منصة الامتحانات">
                    <ExamBuilder
                      gradeLevelId={selectedGrade?.id ?? null}
                      groupId={selectedGroup?.id}
                      groupName={selectedGroup?.name}
                      stageName={selectedStage?.name}
                      gradeName={selectedGrade?.name}
                      onNeedGrade={() => setTab('stepper')}
                    />
                  </ErrorBoundary>
                </Suspense>
                {selectedGrade && (
                  <div className="pt-4 border-t border-white/10">
                    <Suspense fallback={null}>
                      <ErrorBoundary fallbackTitle="تعذّر تحميل مراقبة الامتحانات">
                        <LiveExamMonitor gradeLevelId={selectedGrade.id} groupId={selectedGroup?.id ?? null} />
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                )}
              </div>
            )}

            {/* ONLINE EXAM GRADES — walk-in student results, no group needed */}
            {tab === 'online-grades' && (
              <Suspense fallback={null}>
                <ErrorBoundary fallbackTitle="تعذّر تحميل درجات امتحانات الأونلاين">
                  <OnlineExamGrades />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* TRACKING — homework & behavior, requires group */}
            {tab === 'tracking' && (
              needsGroup ? <GroupRequiredNotice stages={stages} gradeLevels={gradeLevels} groups={groups} groupsLoading={groupsLoading} selectedStage={selectedStage} selectedGrade={selectedGrade} onSelect={guardedSwitch} /> : (
                selectedGroup && (
                  <div className="space-y-4">
                    <Breadcrumbs crumbs={[{ label: selectedStage?.name ?? '' }, { label: selectedGrade?.name ?? '' }, { label: selectedGroup.name, isLast: true }]} onHomeClick={() => setTab('home')} />
                    <GroupBreadcrumb
                      stage={selectedStage?.name}
                      grade={selectedGrade?.name}
                      group={selectedGroup.name}
                      onChangeGroup={() => setTab('stepper')}
                      stages={stages}
                      gradeLevels={gradeLevels}
                      groups={groups}
                      groupsLoading={groupsLoading}
                      selectedStage={selectedStage}
                      selectedGrade={selectedGrade}
                      selectedGroup={selectedGroup}
                      onSelect={guardedSwitch}
                    />
                    <Suspense fallback={null}>
                      <ErrorBoundary fallbackTitle="تعذّر تحميل الواجبات والسلوك">
                        <HomeworkBehavior groupId={selectedGroup.id} students={students} studentsLoading={studentsLoading} focusStudentId={notifFocusStudentId} />
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                )
              )
            )}

            {/* SUBSCRIPTIONS — monthly subscription tracking, requires group */}
            {tab === 'subscriptions' && (
              needsGroup ? <GroupRequiredNotice stages={stages} gradeLevels={gradeLevels} groups={groups} groupsLoading={groupsLoading} selectedStage={selectedStage} selectedGrade={selectedGrade} onSelect={guardedSwitch} /> : (
                selectedGroup && selectedStage && selectedGrade && (
                  <div className="space-y-4">
                    <Breadcrumbs crumbs={[{ label: selectedStage?.name ?? '' }, { label: selectedGrade?.name ?? '' }, { label: selectedGroup.name, isLast: true }]} onHomeClick={() => setTab('home')} />
                    <GroupBreadcrumb
                      stage={selectedStage?.name}
                      grade={selectedGrade?.name}
                      group={selectedGroup.name}
                      onChangeGroup={() => setTab('stepper')}
                      stages={stages}
                      gradeLevels={gradeLevels}
                      groups={groups}
                      groupsLoading={groupsLoading}
                      selectedStage={selectedStage}
                      selectedGrade={selectedGrade}
                      selectedGroup={selectedGroup}
                      onSelect={guardedSwitch}
                    />
                    <Suspense fallback={null}>
                      <ErrorBoundary fallbackTitle="تعذّر تحميل الاشتراكات">
                        <SubscriptionsModule groupId={selectedGroup.id} stageId={selectedStage.id} gradeLevelId={selectedGrade.id} />
                      </ErrorBoundary>
                    </Suspense>
                  </div>
                )
              )
            )}

            {/* PARENT PORTAL LINKS */}
            {tab === 'parent' && (
              <Suspense fallback={null}>
                <ErrorBoundary fallbackTitle="تعذّر تحميل روابط أولياء الأمور">
                  <ParentLinksModule groupId={selectedGroup?.id ?? null} />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* ARCHIVE — fully independent module, manages its own group filter */}
            {tab === 'archive' && (
              <Suspense fallback={null}>
                <ErrorBoundary fallbackTitle="تعذّر تحميل الأرشيف">
                  <ArchiveOverview allGroups={allGroups} />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* ACCOUNTING — AccountingCycles + FinancialInvestigation */}
            {tab === 'accounting' && (isMaster || can('can_view_finance')) && (
              <ErrorBoundary fallbackTitle="تعذّر تحميل المحاسبة">
                <div className="space-y-6">
                  <AccountingCycles />
                  <FinancialInvestigation />
                </div>
              </ErrorBoundary>
            )}

            {/* MONTH CLOSURE */}
            {tab === 'month-closure' && (isMaster || can('can_view_finance')) && (
              <ErrorBoundary fallbackTitle="تعذّر تحميل إغلاق الشهر">
                <MonthClosureManager />
              </ErrorBoundary>
            )}

            {/* MONITORING — Smart Center Control */}
            {tab === 'monitoring' && (
              <ErrorBoundary fallbackTitle="تعذّر تحميل مركز المتابعة">
                <SmartCenterControl allGroups={allGroups} onNavigate={(t: string) => setTab(t as Tab)} />
              </ErrorBoundary>
            )}

            {/* HEALTH SCORE */}
            {tab === 'health-score' && (
              <ErrorBoundary fallbackTitle="تعذّر تحميل مؤشر الصحة">
                <HealthScoreWidget onNavigate={(t: string) => setTab(t as Tab)} />
              </ErrorBoundary>
            )}

            {/* DATA CHECK */}
            {tab === 'data-check' && (
              <ErrorBoundary fallbackTitle="تعذّر تحميل فحص المنصة">
                <PlatformDataCheck onNavigate={(t: string) => setTab(t as Tab)} />
              </ErrorBoundary>
            )}

            {/* ASK PLATFORM */}
            {tab === 'ask-platform' && (
              <ErrorBoundary fallbackTitle="تعذّر تحميل اسأل المنصة">
                <AskPlatform />
              </ErrorBoundary>
            )}

            {/* PLATFORM INTELLIGENCE — read-only analysis layer */}
            {tab === 'intelligence' && (
              <Suspense fallback={null}>
                <ErrorBoundary fallbackTitle="تعذّر تحميل ذكاء المنصة">
                  <PlatformIntelligence />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* EXAM LAB — standalone exam authoring workspace */}
            {tab === 'exam-lab' && (
              <Suspense fallback={null}>
                <ErrorBoundary fallbackTitle="تعذّر تحميل معمل الاختبارات">
                  <ExamLab />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* EXAM MANAGEMENT — all exams across the platform */}
            {tab === 'exam-management' && (isMaster || can('can_manage_exams') || can('can_view_exams')) && (
              <Suspense fallback={null}>
                <ErrorBoundary fallbackTitle="تعذّر تحميل لوحة إدارة الامتحانات">
                  <ExamManagementDashboard
                    onResumeExam={(examId, gradeId) => {
                      if (gradeId) {
                        const grade = gradeLevels.find((g) => g.id === gradeId);
                        if (grade) {
                          setSelectedStage(stages.find((s) => s.id === grade.stage_id) ?? null);
                          setSelectedGrade(grade);
                        }
                      }
                      localStorage.setItem(`exam_draft_${gradeId ?? 'default'}`, examId);
                      setTab('exams');
                    }}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* ASSISTANTS — master only */}
            {tab === 'assistants' && isMaster && (
              <Suspense fallback={null}>
                <ErrorBoundary fallbackTitle="تعذّر تحميل إدارة المساعدين">
                  <AssistantsManager />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* DAILY COLLECTIONS — requires finance permission */}
            {tab === 'daily-collections' && can('can_view_finance') && (
              <ErrorBoundary fallbackTitle="تعذّر تحميل تحصيل اليوم">
                <DailyCollectionsWidget isMaster={isMaster} onBack={() => setTab('finances')} />
              </ErrorBoundary>
            )}

            {/* FINANCES — requires permission */}
            {tab === 'finances' && can('can_view_finance') && (
              <Suspense fallback={null}>
                <ErrorBoundary fallbackTitle="تعذّر تحميل الماليات">
                  <FinancesModule
                    focusStageId={searchFocus?.stageId ?? null}
                    focusGradeId={searchFocus?.gradeId ?? null}
                    focusGroupId={searchFocus?.groupId ?? null}
                    focusStudentId={searchFocus?.studentId ?? null}
                    onBack={() => setTab('home')}
                  />
                </ErrorBoundary>
              </Suspense>
            )}

            {/* SETTINGS — master only */}
            {tab === 'settings' && isMaster && (
              <div className="space-y-4">
                <div className="glass-card rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white mb-2">الإعدادات</h2>
                  <p className="text-sm text-slate-400 mb-4">لإعدادات المنصة الكاملة ورفع اللوجو وصورة المعلم، انتقل إلى صفحة الإعدادات.</p>
                  <Button onClick={() => navigate('/settings')}>
                    <Settings size={16} /> فتح صفحة الإعدادات
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
      <Watermark />

      <FloatingActionButton
        onQuickAttendance={() => setTab('attendance')}
        onQuickAddStudent={() => setTab('stepper')}
        onGoFinances={() => setTab('finances')}
        onOpenActivityLog={() => setActivityLogOpen(true)}
      />

      <ActivityLogModal open={activityLogOpen} onClose={() => setActivityLogOpen(false)} />

      <Modal open={groupPaymentsOpen} onClose={() => setGroupPaymentsOpen(false)} title={`حركات المبلغ المحصل — ${selectedGroup?.name ?? ''}`} size="md">
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {groupPayments.length === 0 ? (
            <p className="text-center text-slate-400 py-6">لا توجد حركات مسجلة في هذه المجموعة.</p>
          ) : (
            <>
              <div className="glass-light rounded-xl p-3 text-center mb-2">
                <p className="text-xs text-slate-400">إجمالي المحصل للمجموعة</p>
                <p className="text-xl font-black text-emerald-400">{formatCurrency(groupPayments.reduce((s, p) => s + (p.amount ?? 0), 0))} ج.م</p>
              </div>
              {groupPayments.map((p) => (
                <div key={p.id} className="glass-light rounded-xl p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-bold text-emerald-400 text-sm">{formatCurrency(p.amount)} ج.م</p>
                    <p className="text-xs text-slate-400 mt-0.5">{p.student_name ?? 'طالب'}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{p.payment_date}{p.recorded_by ? ` • سجّلها: ${p.recorded_by}` : ''}</p>
                    {p.note && <p className="text-xs text-slate-500 mt-0.5">{p.note}</p>}
                  </div>
                  <button onClick={() => setDeletePayTarget(p)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition flex-shrink-0" title="حذف هذه الحركة">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deletePayTarget}
        onClose={() => setDeletePayTarget(null)}
        onConfirm={handleDeleteGroupPayment}
        loading={deletePayLoading}
        title="حذف الحركة المالية"
        subtext="سيتم حذف هذه الدفعة وخصم المبلغ من المدفوعات والإجمالي فوراً، مع تسجيل العملية في السجل. هل أنت متأكد؟"
        confirmLabel="تأكيد الحذف"
      />

      {isMaster && <SecretFinancialWidget open={secretFinOpen} onClose={() => setSecretFinOpen(false)} />}
    </div>
  );
}

function GroupRequiredNotice({
  stages,
  gradeLevels,
  groups,
  groupsLoading,
  selectedStage,
  selectedGrade,
  onSelect,
}: {
  stages: AcademicStage[];
  gradeLevels: GradeLevel[];
  groups: Group[];
  groupsLoading: boolean;
  selectedStage: AcademicStage | null;
  selectedGrade: GradeLevel | null;
  onSelect: (stage: AcademicStage | null, grade: GradeLevel | null, group: Group | null) => void;
}) {
  return (
    <div className="glass-card rounded-2xl p-6 space-y-4">
      <div className="text-center">
        <GraduationCap className="mx-auto text-slate-600 mb-3" size={40} />
        <h3 className="text-base font-bold text-white mb-1">اختر المجموعة للوصول إلى هذه الوحدة</h3>
        <p className="text-xs text-slate-400">اختر المرحلة ← الصف ← المجموعة من القوائم أدناه</p>
      </div>
      <UnifiedGroupSelector
        stages={stages}
        gradeLevels={gradeLevels}
        groups={groups}
        groupsLoading={groupsLoading}
        selectedStage={selectedStage}
        selectedGrade={selectedGrade}
        selectedGroup={null}
        onSelect={onSelect}
      />
    </div>
  );
}

function InlineGroupFilter(props: {
  stages: AcademicStage[];
  gradeLevels: GradeLevel[];
  groups: Group[];
  groupsLoading: boolean;
  selectedStage: AcademicStage | null;
  selectedGrade: GradeLevel | null;
  selectedGroup: Group | null;
  onSelect: (stage: AcademicStage | null, grade: GradeLevel | null, group: Group | null) => void;
}) {
  return <UnifiedGroupSelector {...props} />;
}

function GradeRequiredNotice({ onGoStepper }: { onGoStepper: () => void }) {
  return (
    <div className="glass-card rounded-2xl p-12 text-center">
      <GraduationCap className="mx-auto text-slate-600 mb-4" size={48} />
      <h3 className="text-lg font-bold text-white mb-2">يجب اختيار صف أولاً</h3>
      <p className="text-sm text-slate-400 mb-4">
        انتقل إلى تبويب «قائمة الطلاب» واختر المرحلة ← الصف للوصول إلى منصة الامتحانات.
      </p>
      <Button onClick={onGoStepper}>
        <BookOpen size={16} /> الذهاب إلى التدرج
      </Button>
    </div>
  );
}

function GroupBreadcrumb({
  stage,
  grade,
  group,
  onChangeGroup,
  stages,
  gradeLevels,
  groups,
  groupsLoading,
  selectedStage,
  selectedGrade,
  selectedGroup,
  onSelect,
}: {
  stage?: string;
  grade?: string;
  group: string;
  onChangeGroup: () => void;
  stages: AcademicStage[];
  gradeLevels: GradeLevel[];
  groups: Group[];
  groupsLoading: boolean;
  selectedStage: AcademicStage | null;
  selectedGrade: GradeLevel | null;
  selectedGroup: Group | null;
  onSelect: (stage: AcademicStage | null, grade: GradeLevel | null, group: Group | null) => void;
}) {
  return (
    <div className="glass-card rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm">
          {stage && <span className="text-slate-500">{stage}</span>}
          {grade && (
            <>
              <ChevronLeft size={14} className="text-slate-600" />
              <span className="text-slate-500">{grade}</span>
            </>
          )}
          <ChevronLeft size={14} className="text-slate-600" />
          <span className="text-emerald-400 font-semibold">{group}</span>
        </div>
        <button onClick={onChangeGroup} className="text-[10px] font-bold text-slate-400 hover:text-emerald-400 transition flex items-center gap-1">
          <Users size={12} /> تغيير
        </button>
      </div>
      <UnifiedGroupSelector
        stages={stages}
        gradeLevels={gradeLevels}
        groups={groups}
        groupsLoading={groupsLoading}
        selectedStage={selectedStage}
        selectedGrade={selectedGrade}
        selectedGroup={selectedGroup}
        onSelect={onSelect}
        showStepper={false}
        compact
      />
    </div>
  );
}

function SummaryBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="glass-light rounded-xl p-3">
      <span className="text-[10px] text-slate-400 block mb-1">{label}</span>
      <span className={`text-base font-bold ${color}`}>{value}</span>
    </div>
  );
}

type EnrichedGroup = Group & {
  grade_level?: { id: string; name: string; stage?: { id: string; name: string; sort_order: number } } | null;
};

function GroupHierarchyTree({
  groups,
  selectedGroupId,
  onSelect,
}: {
  groups: EnrichedGroup[];
  selectedGroupId: string | null;
  onSelect: (g: Group, grade: GradeLevel, stage: AcademicStage) => void;
}) {
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [expandedGrades, setExpandedGrades] = useState<Set<string>>(new Set());

  const tree = useMemo(() => {
    const stageMap = new Map<string, { name: string; sort_order: number; grades: Map<string, { name: string; groups: Group[] }> }>();
    for (const g of groups) {
      const stageName = g.grade_level?.stage?.name ?? 'غير مصنف';
      const stageOrder = g.grade_level?.stage?.sort_order ?? 999;
      const gradeName = g.grade_level?.name ?? 'غير مصنف';
      if (!stageMap.has(stageName)) stageMap.set(stageName, { name: stageName, sort_order: stageOrder, grades: new Map() });
      const stage = stageMap.get(stageName)!;
      if (!stage.grades.has(gradeName)) stage.grades.set(gradeName, { name: gradeName, groups: [] });
      stage.grades.get(gradeName)!.groups.push(g);
    }
    return [...stageMap.values()].sort((a, b) => a.sort_order - b.sort_order);
  }, [groups]);

  function toggleStage(name: string) {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function toggleGrade(key: string) {
    setExpandedGrades((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function handleSelect(g: Group) {
    const enriched = groups.find((x) => x.id === g.id);
    const gradeName = enriched?.grade_level?.name ?? '';
    const stageName = enriched?.grade_level?.stage?.name ?? '';
    const grade: GradeLevel = { id: enriched?.grade_level?.id ?? g.grade_level_id, stage_id: enriched?.grade_level?.stage?.id ?? '', name: gradeName, sort_order: 0, base_subscription: 0 };
    const stage: AcademicStage = { id: enriched?.grade_level?.stage?.id ?? '', name: stageName, sort_order: enriched?.grade_level?.stage?.sort_order ?? 0, base_subscription: 0 };
    onSelect(g, grade, stage);
  }

  return (
    <div className="mt-2 max-h-64 overflow-y-auto modal-body space-y-0.5">
      {tree.map((stage) => {
        const stageExpanded = expandedStages.has(stage.name);
        return (
          <div key={stage.name}>
            <button
              onClick={() => toggleStage(stage.name)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-bold text-slate-300 hover:bg-white/5 transition"
            >
              <ChevronLeft size={12} className={`text-slate-500 transition-transform ${stageExpanded ? '-rotate-90' : ''}`} />
              <GraduationCap size={12} className="text-emerald-400" />
              {stage.name}
              <span className="text-slate-600 font-normal">{stage.grades.size}</span>
            </button>
            {stageExpanded && (
              <div className="pr-4 space-y-0.5">
                {[...stage.grades.values()].map((grade) => {
                  const gradeKey = `${stage.name}__${grade.name}`;
                  const gradeExpanded = expandedGrades.has(gradeKey);
                  return (
                    <div key={gradeKey}>
                      <button
                        onClick={() => toggleGrade(gradeKey)}
                        className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-400 hover:bg-white/5 transition"
                      >
                        <ChevronLeft size={11} className={`text-slate-600 transition-transform ${gradeExpanded ? '-rotate-90' : ''}`} />
                        <BookOpen size={11} className="text-sky-400" />
                        {grade.name}
                        <span className="text-slate-600 font-normal">{grade.groups.length}</span>
                      </button>
                      {gradeExpanded && (
                        <div className="pr-4 space-y-0.5">
                          {grade.groups.map((g) => (
                            <button
                              key={g.id}
                              onClick={() => handleSelect(g)}
                              className={`w-full text-right px-2 py-1 rounded-lg text-[11px] font-semibold transition ${selectedGroupId === g.id ? 'bg-emerald-600/20 text-emerald-300' : 'text-slate-500 hover:bg-white/5 hover:text-white'}`}
                            >
                              <UsersRound size={10} className="inline ml-1 text-slate-600" />
                              {g.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
