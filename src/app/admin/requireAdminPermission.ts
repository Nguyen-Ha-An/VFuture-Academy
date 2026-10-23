import { forbidden } from 'next/navigation';

import { ApiError } from '@/lib/api';
import { requirePermission, type UnscopedPermission } from '@/lib/permissions';

export async function requireAdminPermission(permission: UnscopedPermission) {
  try {
    return await requirePermission(permission);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) forbidden();
    throw error;
  }
}
