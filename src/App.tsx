import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { MonthProvider } from '@/context/MonthContext';
import LoginPage from '@/pages/LoginPage';
import AssistantLoginPage from '@/pages/AssistantLoginPage';
import type { ReactNode } from 'react';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import PageLoader from '@/components/ui/PageLoader';
import { ToastProvider } from '@/components/ui/Toast';
import { NotificationProvider } from '@/context/NotificationContext';
import PWAInstallPrompt from '@/components/ui/PWAInstallPrompt';
import OfflineBanner from '@/components/ui/OfflineBanner';

const DashboardPage = lazyWithRetry(() => import('@/pages/DashboardPage'));
const SettingsPage = lazyWithRetry(() => import('@/pages/SettingsPage'));
const ParentPortal = lazyWithRetry(() => import('@/pages/ParentPortal'));
const ExamPortalPage = lazyWithRetry(() => import('@/pages/ExamPortalPage'));

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { role, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="جاري التحقق من الجلسة..." />;
  if (!role) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { role, loading } = useAuth();
  if (loading) return <PageLoader label="جاري التحقق من الجلسة..." />;
  if (role) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
      <Route path="/assistant/login" element={<PublicOnlyRoute><AssistantLoginPage /></PublicOnlyRoute>} />
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <ErrorBoundary>
            <Suspense fallback={<PageLoader label="جاري تحميل لوحة التحكم..." />}>
              <DashboardPage />
            </Suspense>
          </ErrorBoundary>
        </ProtectedRoute>
      } />
      <Route path="/settings" element={
        <ProtectedRoute>
          <ErrorBoundary>
            <Suspense fallback={<PageLoader label="جاري تحميل الإعدادات..." />}>
              <SettingsPage />
            </Suspense>
          </ErrorBoundary>
        </ProtectedRoute>
      } />
      <Route path="/parent-portal" element={
        <ErrorBoundary>
          <Suspense fallback={<PageLoader label="جاري تحميل بوابة ولي الأمر..." />}>
            <ParentPortal />
          </Suspense>
        </ErrorBoundary>
      } />
      <Route path="/exam-portal" element={
        <ErrorBoundary>
          <Suspense fallback={<PageLoader label="جاري تحميل بوابة الامتحان..." />}>
            <ExamPortalPage />
          </Suspense>
        </ErrorBoundary>
      } />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary fullPage>
    <ThemeProvider>
    <SettingsProvider>
    <AuthProvider>
    <MonthProvider>
    <BrowserRouter>
    <NotificationProvider>
      <ToastProvider>
        <AppRoutes />
        <PWAInstallPrompt />
        <OfflineBanner />
      </ToastProvider>
    </NotificationProvider>
    </BrowserRouter>
    </MonthProvider>
    </AuthProvider>
    </SettingsProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}
