import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessGovernorate,
  canDeleteTractorDelivery,
  canTransitionReportStatus,
  getUserScopedGovernorateIds,
  getVisibleGovernorates,
  hasGranularAccess,
  hasPermission,
} from './rbac.ts';
import type { Governorate, UserProfile } from '../types/domain.ts';

test('RBAC permissions enforce role boundaries including viewer role', () => {
  assert.equal(hasPermission('viewer', 'view_dashboard'), true);
  assert.equal(hasPermission('viewer', 'edit_daily_sheet'), false);
  assert.equal(hasPermission('viewer', 'manage_users'), false);

  assert.equal(hasPermission('field_staff', 'edit_daily_sheet'), true);
  assert.equal(hasPermission('field_staff', 'approve_report'), false);
  assert.equal(hasPermission('field_staff', 'manage_users'), false);

  assert.equal(hasPermission('supervisor', 'manage_associations'), true);
  assert.equal(hasPermission('supervisor', 'approve_tractor'), true);
  assert.equal(hasPermission('supervisor', 'approve_report'), false);

  assert.equal(hasPermission('chief', 'approve_report'), true);
  assert.equal(hasPermission('chief', 'reject_report'), true);
  assert.equal(hasPermission('chief', 'manage_settings'), false);

  assert.equal(hasPermission('admin', 'manage_users'), true);
  assert.equal(hasPermission('admin', 'view_audit_logs'), true);
});

test('Granular permissions and governorate scope restrict restricted users cleanly', () => {
  const govs: Governorate[] = [
    { id: 'gov-ismailia', code: 'ISM', nameAr: 'الإسماعيلية', region: 'القناة', isActive: true },
    { id: 'gov-suez', code: 'SUZ', nameAr: 'السويس', region: 'القناة', isActive: true },
    { id: 'gov-portsaid', code: 'PTS', nameAr: 'بورسعيد', region: 'القناة', isActive: true },
  ];

  const restrictedUser: UserProfile = {
    uid: 'u-1',
    email: 'u1@dst.eg',
    displayName: 'مستخدم مقيد',
    role: 'field_staff',
    governorateIds: ['gov-suez'],
    permissions: {
      canEdit: true,
      canExport: false,
      canClearDay: false,
      canManageAssociations: false,
      canViewBalances: true,
      canViewAnalytics: false,
    },
    isActive: true,
  };

  assert.equal(canAccessGovernorate(restrictedUser, 'gov-suez'), true);
  assert.equal(canAccessGovernorate(restrictedUser, 'gov-ismailia'), false);
  assert.deepEqual(
    getVisibleGovernorates(restrictedUser, govs).map((g) => g.id),
    ['gov-suez'],
  );
  assert.equal(hasGranularAccess(restrictedUser, 'canEdit'), true);
  assert.equal(hasGranularAccess(restrictedUser, 'canExport'), false);
  assert.equal(hasGranularAccess(restrictedUser, 'canViewAnalytics'), false);

  // Empty governorateIds on non-admin/non-chief MUST restrict to [] (fail-closed)
  const unallocatedSupervisor: UserProfile = {
    ...restrictedUser,
    role: 'supervisor',
    governorateIds: [],
  };
  assert.deepEqual(getUserScopedGovernorateIds(unallocatedSupervisor), []);
  assert.equal(canAccessGovernorate(unallocatedSupervisor, 'gov-suez'), false);

  // Admin & Chief with empty governorateIds retain global scope (null)
  const adminUser: UserProfile = { ...restrictedUser, role: 'admin', governorateIds: [] };
  assert.equal(getUserScopedGovernorateIds(adminUser), null);
  assert.equal(canAccessGovernorate(adminUser, 'gov-suez'), true);
});

test('Report workflow transitions enforce multi-stage approval chain and forbid non-admin self-approval', () => {
  assert.equal(canTransitionReportStatus('draft', 'completed', 'field_staff'), true);
  assert.equal(canTransitionReportStatus('draft', 'approved', 'field_staff'), false);
  assert.equal(canTransitionReportStatus('completed', 'under_review', 'supervisor'), true);
  assert.equal(canTransitionReportStatus('under_review', 'approved', 'chief'), true);
  assert.equal(
    canTransitionReportStatus('under_review', 'approved', 'chief', {
      actorUid: 'chief-1',
      reportCreatedByUid: 'chief-1',
    }),
    false,
  );
  assert.equal(
    canTransitionReportStatus('under_review', 'approved', 'chief', {
      actorUid: 'chief-1',
      reportCreatedByUid: 'staff-1',
    }),
    true,
  );
  assert.equal(
    canTransitionReportStatus('under_review', 'approved', 'admin', {
      actorUid: 'admin-1',
      reportCreatedByUid: 'admin-1',
    }),
    true,
  );
  assert.equal(canTransitionReportStatus('under_review', 'rejected', 'chief'), true);
  assert.equal(canTransitionReportStatus('approved', 'draft', 'chief'), false);
  assert.equal(canTransitionReportStatus('approved', 'draft', 'admin'), true);
});

test('canDeleteTractorDelivery enforces role, governorate scope, and final_approved guard', () => {
  const baseProfile: Omit<UserProfile, 'role'> = {
    uid: 'u-test',
    email: 'test@dst.eg',
    displayName: 'مستخدم اختبار',
    governorateIds: ['gov-ismailia'],
    isActive: true,
  };

  const pendingIsmailia = { governorateId: 'gov-ismailia', approvalState: 'pending' as const };
  const approvedIsmailia = { governorateId: 'gov-ismailia', approvalState: 'final_approved' as const };
  const pendingSuez = { governorateId: 'gov-suez', approvalState: 'pending' as const };

  assert.equal(hasPermission('admin', 'delete_tractor'), true);
  assert.equal(hasPermission('supervisor', 'delete_tractor'), true);
  assert.equal(hasPermission('field_staff', 'delete_tractor'), false);
  assert.equal(hasPermission('chief', 'delete_tractor'), false);
  assert.equal(hasPermission('viewer', 'delete_tractor'), false);

  // Admin can delete both pending and final_approved across any governorate
  const admin: UserProfile = { ...baseProfile, role: 'admin', governorateIds: [] };
  assert.equal(canDeleteTractorDelivery(admin, pendingIsmailia), true);
  assert.equal(canDeleteTractorDelivery(admin, approvedIsmailia), true);
  assert.equal(canDeleteTractorDelivery(admin, pendingSuez), true);

  // Supervisor can delete pending tractors inside assigned governorate only
  const supervisor: UserProfile = { ...baseProfile, role: 'supervisor' };
  assert.equal(canDeleteTractorDelivery(supervisor, pendingIsmailia), true);
  assert.equal(canDeleteTractorDelivery(supervisor, pendingSuez), false);
  assert.equal(canDeleteTractorDelivery(supervisor, approvedIsmailia), false);

  // Inactive supervisor or unassigned supervisor cannot delete
  assert.equal(canDeleteTractorDelivery({ ...supervisor, isActive: false }, pendingIsmailia), false);
  assert.equal(canDeleteTractorDelivery({ ...supervisor, governorateIds: [] }, pendingIsmailia), false);

  // Field staff, chief, and viewer cannot delete tractors
  assert.equal(canDeleteTractorDelivery({ ...baseProfile, role: 'field_staff' }, pendingIsmailia), false);
  assert.equal(
    canDeleteTractorDelivery({ ...baseProfile, role: 'chief', governorateIds: [] }, pendingIsmailia),
    false,
  );
  assert.equal(canDeleteTractorDelivery({ ...baseProfile, role: 'viewer' }, pendingIsmailia), false);
});

