import { useAuthStore } from '../stores/auth.store';
import { UserRole } from '@shared/types';

export function useAuth() {
  const { user, isAuthenticated, accessToken } = useAuthStore();

  return {
    user,
    isAuthenticated,
    accessToken,
    isManager: user?.role === UserRole.MANAGER,
    isCommercial: user?.role === UserRole.COMMERCIAL,
    isSuperAdmin: user?.role === UserRole.SUPER_ADMIN,
  };
}
