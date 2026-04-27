import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { UserRole } from '@shared/types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Rediriger vers l'espace approprié selon le rôle
    switch (user.role) {
      case UserRole.SUPER_ADMIN:
        return <Navigate to="/admin" replace />;
      case UserRole.MANAGER:
      case UserRole.TEAM_LEAD:
      case UserRole.BU_MANAGER:
        return <Navigate to="/manager" replace />;
      case UserRole.COMMERCIAL:
      case UserRole.RECRUITER:
        return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
}
