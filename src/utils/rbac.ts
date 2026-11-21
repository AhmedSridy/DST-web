import type {
  Governorate,
  GranularPermissions,
  ReportStatus,
  TractorDelivery,
  UserProfile,
  UserRole,
} from '../types/domain.ts';

export const ROLE_LABELS_AR: Record<UserRole, string> = {
  field_staff: 'موظف ميداني',
  supervisor: 'مشرف محافظة',
  chief: 'رئيس قطاع / مدير عام',
  admin: 'مدير النظام',
  viewer: 'مشاهد',
};

export const STATUS_LABELS_AR: Record<ReportStatus, string> = {
  draft: 'مسودة',
  completed: 'مكتمل',
  under_review: 'قيد المراجعة',
  approved: 'معتمد نهائيًا',
  rejected: 'مرفوض',
};

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  viewer: [
    'view_dashboard',
    'view_balances',
    'view_reports',
    'view_guide',
  ],
  field_staff: [
    'view_dashboard',
    'edit_daily_sheet',
    'use_ocr',
    'create_tractor',
    'submit_report',
    'view_balances',
    'view_analytics',
    'view_reports',
    'view_guide',
  ],
  supervisor: [
    'view_dashboard',
    'edit_daily_sheet',
    'use_ocr',
    'create_tractor',
    'approve_tractor',
    'delete_tractor',
    'manage_associations',
    'submit_report',
    'review_report',
    'resolve_variance',
    'view_balances',
    'view_analytics',
    'view_reports',
    'view_guide',
  ],
  chief: [
    'view_dashboard',
    'review_report',
    'approve_report',
    'reject_report',
    'sync_central',
    'view_balances',
    'view_analytics',
    'view_reports',
    'view_guide',
  ],
  admin: [
    'view_dashboard',
    'edit_daily_sheet',
    'use_ocr',
    'create_tractor',
    'approve_tractor',
    'delete_tractor',
    'manage_associations',
    'submit_report',
    'review_report',
    'approve_report',
    'reject_report',
    'resolve_variance',
    'sync_central',
    'view_balances',
    'view_analytics',
    'view_reports',
    'view_guide',
    'manage_users',
    'manage_settings',
    'view_audit_logs',
  ],
};

export function getDefaultGranularPermissions(role: UserRole): GranularPermissions {
  switch (role) {
    case 'admin':
      return {
        canEdit: true,
        canExport: true,
        canClearDay: true,
        canManageAssociations: true,
        canViewBalances: true,
        canViewAnalytics: true,
      };
    case 'supervisor':
      return {
        canEdit: true,
        canExport: true,
        canClearDay: true,
        canManageAssociations: true,
        canViewBalances: true,
        canViewAnalytics: true,
      };
    case 'chief':
      return {
        canEdit: false,
        canExport: true,
        canClearDay: false,
        canManageAssociations: false,
        canViewBalances: true,
        canViewAnalytics: true,
      };
    case 'field_staff':
      return {
        canEdit: true,
        canExport: true,
        canClearDay: false,
        canManageAssociations: false,
        canViewBalances: true,
        canViewAnalytics: true,
      };
    case 'viewer':
    default:
      return {
        canEdit: false,
        canExport: false,
        canClearDay: false,
        canManageAssociations: false,
        canViewBalances: true,
        canViewAnalytics: false,
      };
  }
}

export function resolveUserPermissions(user: UserProfile | null | undefined): GranularPermissions {
  if (!user) {
    return getDefaultGranularPermissions('viewer');
  }
  const defaults = getDefaultGranularPermissions(user.role);
  if (!user.permissions) return defaults;
  return {
    canEdit: typeof user.permissions.canEdit === 'boolean' ? user.permissions.canEdit : defaults.canEdit,
    canExport: typeof user.permissions.canExport === 'boolean' ? user.permissions.canExport : defaults.canExport,
    canClearDay: typeof user.permissions.canClearDay === 'boolean' ? user.permissions.canClearDay : defaults.canClearDay,
    canManageAssociations:
      typeof user.permissions.canManageAssociations === 'boolean'
        ? user.permissions.canManageAssociations
        : defaults.canManageAssociations,
    canViewBalances:
      typeof user.permissions.canViewBalances === 'boolean'
        ? user.permissions.canViewBalances
        : defaults.canViewBalances,
    canViewAnalytics:
      typeof user.permissions.canViewAnalytics === 'boolean'
        ? user.permissions.canViewAnalytics
        : defaults.canViewAnalytics,
  };
}

export function getUserScopedGovernorateIds(user: UserProfile | null | undefined): string[] | null {
  if (!user) return [];
  if (user.governorateIds && user.governorateIds.length > 0) {
    return user.governorateIds;
  }
  if (user.governorateId && user.governorateId.trim().length > 0) {
    return [user.governorateId];
  }
  if (user.role === 'admin' || user.role === 'chief') {
    return null; // unrestricted across all 27 governorates
  }
  return [];
}

export function canAccessGovernorate(
  user: UserProfile | null | undefined,
  governorateId: string,
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const scoped = getUserScopedGovernorateIds(user);
  if (scoped === null) return true;
  return scoped.includes(governorateId);
}

export function getVisibleGovernorates(
  user: UserProfile | null | undefined,
  governorates: Governorate[],
): Governorate[] {
  const scoped = getUserScopedGovernorateIds(user);
  if (scoped === null || user?.role === 'admin') {
    return governorates;
  }
  return governorates.filter((g) => scoped.includes(g.id));
}

export function hasPermission(role: UserRole | undefined, permission: string): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function hasGranularAccess(
  user: UserProfile | null | undefined,
  flag: keyof GranularPermissions,
): boolean {
  if (!user || !user.isActive) return false;
  if (user.role === 'admin') return true;
  return resolveUserPermissions(user)[flag];
}

export function canTransitionReportStatus(
  currentStatus: ReportStatus,
  nextStatus: ReportStatus,
  role: UserRole,
  options?: { actorUid?: string; reportCreatedByUid?: string },
): boolean {
  if (role === 'admin') return true;
  if (currentStatus === 'approved') return false;

  if (nextStatus === 'completed') {
    return (
      (currentStatus === 'draft' || currentStatus === 'rejected') &&
      hasPermission(role, 'submit_report')
    );
  }
  if (nextStatus === 'under_review') {
    return currentStatus === 'completed' && hasPermission(role, 'review_report');
  }
  if (nextStatus === 'approved') {
    if (
      options?.actorUid &&
      options?.reportCreatedByUid &&
      options.actorUid === options.reportCreatedByUid
    ) {
      return false;
    }
    return (
      (currentStatus === 'under_review' || currentStatus === 'completed') &&
      hasPermission(role, 'approve_report')
    );
  }
  if (nextStatus === 'rejected') {
    return (
      (currentStatus === 'under_review' || currentStatus === 'completed') &&
      hasPermission(role, 'reject_report')
    );
  }
  if (nextStatus === 'draft') {
    return currentStatus === 'rejected' && hasPermission(role, 'submit_report');
  }
  return false;
}

export function canDeleteTractorDelivery(
  user: UserProfile | null | undefined,
  tractor: Pick<TractorDelivery, 'governorateId' | 'approvalState'>,
): boolean {
  if (!user || !user.isActive) return false;
  if (!hasPermission(user.role, 'delete_tractor')) return false;
  if (user.role === 'admin') return true;
  if (!canAccessGovernorate(user, tractor.governorateId)) return false;
  return tractor.approvalState !== 'final_approved';
}
