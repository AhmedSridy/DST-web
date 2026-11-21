/**
 * Firestore Security Rules Unit Test Suite (@firebase/rules-unit-testing).
 *
 * Requires the Firebase Firestore Emulator (Java + firebase-tools):
 *   firebase emulators:exec --only firestore "npx tsx --test tests/firestore.rules.test.ts"
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';

const PROJECT_ID = 'dst-rules-test';
const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

let testEnv: RulesTestEnvironment;

before(async () => {
  const rules = fs.readFileSync(RULES_PATH, 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080),
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'staff_ism'), {
      uid: 'staff_ism',
      email: 'staff@dst.test',
      displayName: 'موظف الإسماعيلية',
      role: 'field_staff',
      governorateId: 'gov-ismailia',
      governorateIds: ['gov-ismailia'],
      isActive: true,
    });
    await setDoc(doc(db, 'users', 'sup_ism'), {
      uid: 'sup_ism',
      email: 'sup@dst.test',
      displayName: 'مشرف الإسماعيلية',
      role: 'supervisor',
      governorateId: 'gov-ismailia',
      governorateIds: ['gov-ismailia'],
      isActive: true,
    });
    await setDoc(doc(db, 'users', 'chief_all'), {
      uid: 'chief_all',
      email: 'chief@dst.test',
      displayName: 'رئيس قطاع',
      role: 'chief',
      governorateIds: [],
      isActive: true,
    });
    await setDoc(doc(db, 'users', 'admin_1'), {
      uid: 'admin_1',
      email: 'ahmedsridy@gmail.com',
      displayName: 'مدير النظام',
      role: 'admin',
      governorateIds: [],
      isActive: true,
    });
  });
});

function authedDb(uid: string, email: string) {
  return testEnv
    .authenticatedContext(uid, { email, email_verified: true })
    .firestore();
}

test('tractor_deliveries create: non-admin must create with approvalState=pending', async () => {
  const staffDb = authedDb('staff_ism', 'staff@dst.test');
  const baseTractor = {
    governorateId: 'gov-ismailia',
    centerId: 'ctr-1',
    associationId: 'assoc-1',
    tractorPlate: 'س ي 1234',
    arrivalDate: '2026-10-10',
    fertilizerCode: 'urea',
    manifestNumber: 'M-100',
    manifestBags: 200,
    actualBags: 200,
    bagVariance: 0,
    inspectionStatus: 'matched',
    createdByUid: 'staff_ism',
    createdAt: serverTimestamp(),
  };

  await assertFails(
    setDoc(doc(staffDb, 'tractor_deliveries', 'trac_bad'), {
      ...baseTractor,
      approvalState: 'final_approved',
    }),
  );

  await assertSucceeds(
    setDoc(doc(staffDb, 'tractor_deliveries', 'trac_ok'), {
      ...baseTractor,
      approvalState: 'pending',
    }),
  );
});

test('daily_reports update: requires valid transition, atomic approval doc, non-empty rejectionReason, and blocks self-approval', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'daily_reports', 'rep_1'), {
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-10',
      status: 'under_review',
      createdByUid: 'staff_ism',
      centralSyncStatus: 'pending',
    });
    await setDoc(doc(db, 'daily_reports', 'rep_chief_own'), {
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-11',
      status: 'under_review',
      createdByUid: 'chief_all',
      centralSyncStatus: 'pending',
    });
  });

  const chiefDb = authedDb('chief_all', 'chief@dst.test');
  const staffDb = authedDb('staff_ism', 'staff@dst.test');

  // 1) Status update without atomic approvals/{lastApprovalId} fails
  await assertFails(
    updateDoc(doc(chiefDb, 'daily_reports', 'rep_1'), {
      status: 'approved',
      lastApprovalId: 'app_missing',
      updatedAt: serverTimestamp(),
    }),
  );

  // 2) Rejection with empty rejectionReason fails even with batch approval doc
  {
    const batch = writeBatch(chiefDb);
    batch.update(doc(chiefDb, 'daily_reports', 'rep_1'), {
      status: 'rejected',
      rejectionReason: '',
      lastApprovalId: 'app_rej_empty',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(chiefDb, 'approvals', 'app_rej_empty'), {
      reportId: 'rep_1',
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-10',
      action: 'rejected',
      fromStatus: 'under_review',
      toStatus: 'rejected',
      actorUid: 'chief_all',
      actorRole: 'chief',
      createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  }

  // 3) Self-approval by chief fails
  {
    const batch = writeBatch(chiefDb);
    batch.update(doc(chiefDb, 'daily_reports', 'rep_chief_own'), {
      status: 'approved',
      rejectionReason: '',
      lastApprovalId: 'app_self',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(chiefDb, 'approvals', 'app_self'), {
      reportId: 'rep_chief_own',
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-11',
      action: 'approved',
      fromStatus: 'under_review',
      toStatus: 'approved',
      actorUid: 'chief_all',
      actorRole: 'chief',
      createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  }

  // 4) Field staff cannot approve under_review report
  {
    const batch = writeBatch(staffDb);
    batch.update(doc(staffDb, 'daily_reports', 'rep_1'), {
      status: 'approved',
      rejectionReason: '',
      lastApprovalId: 'app_staff_bad',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(staffDb, 'approvals', 'app_staff_bad'), {
      reportId: 'rep_1',
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-10',
      action: 'approved',
      fromStatus: 'under_review',
      toStatus: 'approved',
      actorUid: 'staff_ism',
      actorRole: 'field_staff',
      createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  }

  // 5) Chief atomic approval of another user's report succeeds
  {
    const batch = writeBatch(chiefDb);
    batch.update(doc(chiefDb, 'daily_reports', 'rep_1'), {
      status: 'approved',
      rejectionReason: '',
      lastApprovalId: 'app_ok_1',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(chiefDb, 'approvals', 'app_ok_1'), {
      reportId: 'rep_1',
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-10',
      action: 'approved',
      fromStatus: 'under_review',
      toStatus: 'approved',
      actorUid: 'chief_all',
      actorRole: 'chief',
      createdAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  }
});

test('daily_disbursements create: enforces deterministic ID, matching governorateId, and non-approved parent report', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'daily_reports', 'rep_draft'), {
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-10',
      status: 'draft',
      createdByUid: 'staff_ism',
    });
    await setDoc(doc(db, 'daily_reports', 'rep_approved'), {
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-09',
      status: 'approved',
      createdByUid: 'staff_ism',
    });
  });

  const staffDb = authedDb('staff_ism', 'staff@dst.test');

  // Non-deterministic ID rejected
  await assertFails(
    setDoc(doc(staffDb, 'daily_disbursements', 'random_id_123'), {
      reportId: 'rep_draft',
      governorateId: 'gov-ismailia',
      associationId: 'assoc_1',
      fertilizerCode: 'urea',
      openingBalance: 100,
      closingBalance: 80,
      settlementQty: 20,
      actualDisbursed: 20,
      variance: 0,
      createdByUid: 'staff_ism',
      updatedAt: serverTimestamp(),
    }),
  );

  // Approved report parent rejected for non-admin
  await assertFails(
    setDoc(doc(staffDb, 'daily_disbursements', 'rep_approved_assoc_1_urea'), {
      reportId: 'rep_approved',
      governorateId: 'gov-ismailia',
      associationId: 'assoc_1',
      fertilizerCode: 'urea',
      openingBalance: 100,
      closingBalance: 80,
      settlementQty: 20,
      actualDisbursed: 20,
      variance: 0,
      createdByUid: 'staff_ism',
      updatedAt: serverTimestamp(),
    }),
  );

  // Valid deterministic ID on draft report succeeds
  await assertSucceeds(
    setDoc(doc(staffDb, 'daily_disbursements', 'rep_draft_assoc_1_urea'), {
      reportId: 'rep_draft',
      governorateId: 'gov-ismailia',
      associationId: 'assoc_1',
      fertilizerCode: 'urea',
      openingBalance: 100,
      closingBalance: 80,
      settlementQty: 20,
      actualDisbursed: 20,
      variance: 0,
      createdByUid: 'staff_ism',
      updatedAt: serverTimestamp(),
    }),
  );
});

test('users: rejects passwordHash writes and allows admin deleteField() cleanup', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'legacy_user'), {
      uid: 'legacy_user',
      email: 'legacy@dst.test',
      displayName: 'مستخدم قديم',
      role: 'field_staff',
      governorateIds: ['gov-ismailia'],
      passwordHash: 'deadbeef',
      isActive: true,
    });
  });

  const adminDb = authedDb('admin_1', 'ahmedsridy@gmail.com');

  // Adding passwordHash is rejected even for admin
  await assertFails(
    updateDoc(doc(adminDb, 'users', 'staff_ism'), {
      passwordHash: 'abc123',
      updatedAt: serverTimestamp(),
    }),
  );

  // Removing legacy passwordHash via deleteField() succeeds for admin
  await assertSucceeds(
    updateDoc(doc(adminDb, 'users', 'legacy_user'), {
      passwordHash: deleteField(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test('admin full permissions: delete associations, update/delete integration_logs & images_attachments, edit/reopen/delete approved reports & tractors', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'agricultural_associations', 'assoc_del'), {
      code: 'ISM-010',
      nameAr: 'جمعية للتجربة',
      normalizedName: 'جمعيه للتجربه',
      governorateId: 'gov-ismailia',
      centerId: 'ctr-1',
      isActive: true,
    });
    await setDoc(doc(db, 'integration_logs', 'ilog_1'), {
      reportId: 'rep_app',
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-10',
      endpointUrl: 'https://example.gov.eg/sync',
      status: 'failed',
      httpStatus: 502,
      responseMessage: 'timeout',
      dispatchedByUid: 'chief_all',
    });
    await setDoc(doc(db, 'images_attachments', 'att_1'), {
      governorateId: 'gov-ismailia',
      associationId: 'assoc_del',
      associationName: 'جمعية للتجربة',
      fertilizerCode: 'urea',
      reportDate: '2026-10-10',
      extractedClosingBalance: 120,
      confidence: 0.9,
      notes: 'ملاحظة أولية',
      analyzedByUid: 'staff_ism',
    });
    await setDoc(doc(db, 'daily_reports', 'rep_app'), {
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-10',
      status: 'approved',
      createdByUid: 'staff_ism',
      centralSyncStatus: 'pending',
    });
    await setDoc(doc(db, 'daily_disbursements', 'rep_app_assoc_del_urea'), {
      reportId: 'rep_app',
      governorateId: 'gov-ismailia',
      associationId: 'assoc_del',
      fertilizerCode: 'urea',
      openingBalance: 100,
      closingBalance: 60,
      settlementQty: 35,
      actualDisbursed: 40,
      variance: 5,
      varianceReason: '',
      createdByUid: 'staff_ism',
    });
    await setDoc(doc(db, 'tractor_deliveries', 'trac_app'), {
      governorateId: 'gov-ismailia',
      centerId: 'ctr-1',
      associationId: 'assoc_del',
      tractorPlate: 'س ي 9999',
      arrivalDate: '2026-10-10',
      fertilizerCode: 'urea',
      manifestNumber: 'M-999',
      manifestBags: 300,
      actualBags: 300,
      bagVariance: 0,
      inspectionStatus: 'matched',
      approvalState: 'final_approved',
      createdByUid: 'staff_ism',
    });
    await setDoc(doc(db, 'audit_logs', 'aud_1'), {
      actorUid: 'admin_1',
      action: 'TEST',
      entityType: 'system',
      entityId: 'sys',
    });
    await setDoc(doc(db, 'approvals', 'app_existing'), {
      reportId: 'rep_app',
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-10',
      action: 'approved',
      fromStatus: 'under_review',
      toStatus: 'approved',
      actorUid: 'chief_all',
      actorRole: 'chief',
    });
    await setDoc(doc(db, 'roles', 'admin'), { code: 'admin', nameAr: 'مدير النظام' });
    await setDoc(doc(db, 'system_settings', 'global'), {
      requireDriverNationalId: false,
      centralApiUrl: '',
      autoSyncOnApproval: false,
    });
  });

  const adminDb = authedDb('admin_1', 'ahmedsridy@gmail.com');
  const supDb = authedDb('sup_ism', 'sup@dst.test');

  // Non-admin CANNOT hard delete associations, nor update/delete integration_logs or images_attachments
  await assertFails(deleteDoc(doc(supDb, 'agricultural_associations', 'assoc_del')));
  await assertFails(updateDoc(doc(supDb, 'integration_logs', 'ilog_1'), { responseMessage: 'hack' }));
  await assertFails(deleteDoc(doc(supDb, 'integration_logs', 'ilog_1')));
  await assertFails(updateDoc(doc(supDb, 'images_attachments', 'att_1'), { notes: 'hack' }));
  await assertFails(deleteDoc(doc(supDb, 'images_attachments', 'att_1')));

  // Admin CAN update and delete integration_logs and images_attachments
  await assertSucceeds(updateDoc(doc(adminDb, 'integration_logs', 'ilog_1'), { responseMessage: 'تمت المراجعة' }));
  await assertSucceeds(deleteDoc(doc(adminDb, 'integration_logs', 'ilog_1')));
  await assertSucceeds(updateDoc(doc(adminDb, 'images_attachments', 'att_1'), { notes: 'ملاحظة مصححة' }));
  await assertSucceeds(deleteDoc(doc(adminDb, 'images_attachments', 'att_1')));

  // Admin CAN edit disbursement under an approved report even with empty varianceReason, and delete it
  await assertSucceeds(
    updateDoc(doc(adminDb, 'daily_disbursements', 'rep_app_assoc_del_urea'), {
      closingBalance: 55,
      actualDisbursed: 45,
      variance: 10,
      varianceReason: '',
      updatedAt: serverTimestamp(),
    }),
  );
  await assertSucceeds(deleteDoc(doc(adminDb, 'daily_disbursements', 'rep_app_assoc_del_urea')));

  // Admin CAN revert final_approved tractor to pending, edit bags, and delete it
  await assertSucceeds(
    updateDoc(doc(adminDb, 'tractor_deliveries', 'trac_app'), {
      approvalState: 'pending',
      actualBags: 295,
      bagVariance: -5,
      inspectionStatus: 'shortage',
    }),
  );
  await assertSucceeds(deleteDoc(doc(adminDb, 'tractor_deliveries', 'trac_app')));

  // Admin CAN reopen an approved report to draft with atomic approvals record, and delete it
  {
    const batch = writeBatch(adminDb);
    batch.update(doc(adminDb, 'daily_reports', 'rep_app'), {
      status: 'draft',
      rejectionReason: '',
      lastApprovalId: 'app_reopen_1',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(adminDb, 'approvals', 'app_reopen_1'), {
      reportId: 'rep_app',
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-10',
      action: 'reopened',
      fromStatus: 'approved',
      toStatus: 'draft',
      actorUid: 'admin_1',
      actorRole: 'admin',
      notes: 'إعادة فتح للتصحيح',
      createdAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  }
  await assertSucceeds(deleteDoc(doc(adminDb, 'daily_reports', 'rep_app')));

  // Admin CAN hard delete association
  await assertSucceeds(deleteDoc(doc(adminDb, 'agricultural_associations', 'assoc_del')));

  // Immutable collections MUST stay locked even for admin
  await assertFails(updateDoc(doc(adminDb, 'audit_logs', 'aud_1'), { details: 'tamper' }));
  await assertFails(deleteDoc(doc(adminDb, 'audit_logs', 'aud_1')));
  await assertFails(updateDoc(doc(adminDb, 'approvals', 'app_existing'), { notes: 'tamper' }));
  await assertFails(deleteDoc(doc(adminDb, 'approvals', 'app_existing')));
  await assertFails(deleteDoc(doc(adminDb, 'roles', 'admin')));
  await assertFails(deleteDoc(doc(adminDb, 'system_settings', 'global')));
  await assertFails(deleteDoc(doc(adminDb, 'users', 'admin_1'))); // Cannot self-delete
});

