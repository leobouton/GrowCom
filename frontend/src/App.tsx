import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';
import { UserRole } from '@shared/types';

// Auth pages
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { InvitationPage } from './pages/auth/InvitationPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage';

// Admin pages
import { AdminDashboard } from './pages/admin/AdminDashboard';

// Manager pages
import { ManagerDashboard } from './pages/manager/ManagerDashboard';
import { ParametragePage } from './pages/manager/ParametragePage';
import { TeamPage } from './pages/manager/TeamPage';
import { OdooPage } from './pages/manager/OdooPage';
import { BillingPage } from './pages/manager/BillingPage';
import { ReportsPage } from './pages/manager/ReportsPage';
// Commercial pages
import { CommercialDashboard } from './pages/commercial/CommercialDashboard';
import { ProjectionsPage } from './pages/commercial/ProjectionsPage';

function RootRedirect() {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  switch (user?.role) {
    case UserRole.SUPER_ADMIN:
      return <Navigate to="/admin" replace />;
    case UserRole.MANAGER:
    case UserRole.TEAM_LEAD:
    case UserRole.BU_MANAGER:
      return <Navigate to="/manager" replace />;
    case UserRole.COMMERCIAL:
    case UserRole.RECRUITER:
      return <Navigate to="/dashboard" replace />;
    default:
      return <Navigate to="/login" replace />;
  }
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Route racine */}
        <Route path="/" element={<RootRedirect />} />

        {/* Routes publiques */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invitation" element={<InvitationPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        {/* Espace Super Admin */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={[UserRole.SUPER_ADMIN]}>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
        </Route>

        {/* Espace Manager */}
        <Route
          path="/manager"
          element={
            <ProtectedRoute allowedRoles={[UserRole.MANAGER, UserRole.TEAM_LEAD, UserRole.BU_MANAGER]}>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<ManagerDashboard />} />
          <Route path="parametrage" element={<ParametragePage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="odoo" element={<OdooPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="disputes" element={<Navigate to="/manager/team" replace />} />
          <Route path="reports" element={<ReportsPage />} />
        </Route>

        {/* Espace Commercial (accessible aussi aux TEAM_LEAD pour leurs propres ventes) */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allowedRoles={[UserRole.COMMERCIAL, UserRole.RECRUITER, UserRole.TEAM_LEAD]}>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<CommercialDashboard />} />
          <Route path="projections" element={<ProjectionsPage />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
