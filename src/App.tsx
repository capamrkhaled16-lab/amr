import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Sessions from './pages/Sessions'
import Attendance from './pages/Attendance'
import Students from './pages/Students'
import HallOfFame from './pages/HallOfFame'
import CenterExams from './pages/CenterExams'
import Homework from './pages/Homework'
import Behavior from './pages/Behavior'
import Subscriptions from './pages/Subscriptions'
import Certificates from './pages/Certificates'
import Settings from './pages/Settings'
import ParentPortal from './pages/ParentPortal'
import type { JSX } from 'react'

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { assistant } = useAuth()
  if (!assistant) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/parent/:token" element={<ParentPortal />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/sessions" element={<ProtectedRoute><Sessions /></ProtectedRoute>} />
      <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
      <Route path="/students" element={<ProtectedRoute><Students /></ProtectedRoute>} />
      <Route path="/hall-of-fame" element={<ProtectedRoute><HallOfFame /></ProtectedRoute>} />
      <Route path="/center-exams" element={<ProtectedRoute><CenterExams /></ProtectedRoute>} />
      <Route path="/homework" element={<ProtectedRoute><Homework /></ProtectedRoute>} />
      <Route path="/behavior" element={<ProtectedRoute><Behavior /></ProtectedRoute>} />
      <Route path="/subscriptions" element={<ProtectedRoute><Subscriptions /></ProtectedRoute>} />
      <Route path="/certificates" element={<ProtectedRoute><Certificates /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
