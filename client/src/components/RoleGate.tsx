import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { hasMinRole, type UserRole } from '@/types';

export function RoleGate({
  minRole,
  children,
  fallback = null,
}: {
  minRole: UserRole;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !hasMinRole(user.role, minRole)) return <>{fallback}</>;
  return <>{children}</>;
}
