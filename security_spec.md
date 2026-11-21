# Security Specification — DST Fertilizer Management System

## 1. Data Invariants
1. **Zero Self-Assigned Privilege Escalation & Invite-Only Onboarding**: Open self-registration is forbidden. Only the explicit bootstrap administrator (`ahmedsridy@gmail.com`) or a Google user claiming a matching active `/user_invites/{inviteId}` document may create `/users/{userId}` with the exact pre-authorized role and governorates. Non-admins cannot mutate `role`, `isActive`, `governorateIds`, or `permissions`. Legacy `passwordHash` fields are banned from `/users/{userId}` schemas and rules.
2. **PII Isolation**: User profiles (`/users/{userId}`) contain email addresses and are readable only by the owner (`request.auth.uid == userId`) or an administrator. Driver national IDs and phone numbers in `/tractor_deliveries` are strictly scoped to active authenticated users within authorized governorates.
3. **Path ID & Payload Boundary Hardening**: All document IDs must match `^[a-zA-Z0-9_-]+$` and be `<= 128` chars. All string fields enforce explicit `.size()` upper bounds, and numeric disbursement/bag quantities must be non-negative (`>= 0`).
4. **Immutable Audit Trail & Full Admin Correction Scope**: `createdByUid` and `createdAt` cannot be modified after creation; `/audit_logs` and `/approvals` cannot be modified or deleted by anyone (including `admin`), and `/roles` and `/system_settings` cannot be deleted. Administrators (`admin`) may perform audited corrections and permanent deletions on operational records (`agricultural_associations`, `daily_reports`, `daily_disbursements`, `tractor_deliveries`, `images_attachments`, `integration_logs`, `association_name_locks`, other `users`, and `user_invites`). Non-admins cannot hard-delete associations or mutate `integration_logs`/`images_attachments`.
5. **Workflow State Machine, Anti-Self-Approval & Atomic Approvals**:
   - `daily_reports` status transitions mirror `canTransitionReportStatus` in `firestore.rules` (draft -> completed -> under_review -> approved/rejected; rejected -> draft/completed; admin may reopen `approved -> draft` with an atomic `approvals` record).
   - Non-admin users (`chief`) CANNOT approve a report they created (`existing().createdByUid != request.auth.uid`); `admin` is exempted.
   - Rejecting a report requires a non-empty `rejectionReason`.
   - Every status change MUST set `lastApprovalId` and atomically create `/approvals/{lastApprovalId}` in the same `writeBatch`, verified via `existsAfter` and `getAfter` (`toStatus`, `reportId`, `actorUid`).
   - Once a `daily_reports` document reaches `approved`, non-admins cannot mutate its status or disbursements (only `chief` may update `centralSyncStatus` + `updatedAt` via the real server-side central sync route), while `admin` may still correct, reopen, or delete it.
6. **Tractor Creation & Deterministic Disbursement Integrity**:
   - Non-admin users creating `/tractor_deliveries/{id}` MUST set `approvalState == 'pending'`. Administrators may edit or revert `final_approved` tractors to `pending` and delete them with audit logging.
   - Creating `/daily_disbursements/{disbursementId}` enforces the deterministic key `${reportId}_${associationId}_${fertilizerCode}` (create-only so existing legacy documents remain updatable) and validates via `existsAfter`/`getAfter` that the parent `daily_reports/{reportId}` has matching `governorateId` and (for non-admins) `status != 'approved'`. Settlement `varianceReason` is optional.
7. **Strict Verified Authentication**: All client Firestore reads/writes (except `/test/connection`) require `request.auth != null && request.auth.token.email_verified == true`.
8. **Role/Governorate Lookup via `users/{uid}` & Firestore Rule Read Limits**:
   - Because the project runs on Firebase Starter Tier without Admin SDK IAM custom claims, RBAC role and governorate scoping in `allow get`, `allow list`, and writes perform a `get()` / `exists()` lookup against `/users/$(request.auth.uid)` (unless the caller matches the bootstrap admin token email).
   - **Firestore Limits**: Cloud Firestore allows up to **10** `get()`/`exists()`/`getAfter()`/`existsAfter()` calls per single-document request and **20** per multi-document transaction or `writeBatch`. Repeated calls to the same document path (such as `users/$(request.auth.uid)` or the same parent `daily_reports/{reportId}` across a batch) are cached by Firestore and counted once per unique path, keeping batches well within limits while requiring clients to scope `list` queries with matching `governorateId` filters.

## 2. Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Read**: `GET /users/user1` with `auth == null` -> DENIED.
2. **Unverified Email Write**: `CREATE /users/user1` with `email_verified: false` -> DENIED.
3. **Self-Role Escalation on Create**: `CREATE /users/u1` with `{ uid: "u1", role: "admin", ... }` by non-admin -> DENIED.
4. **Shadow Field / Password Hash Injection**: `CREATE` or `UPDATE /users/u1` including `passwordHash` or `{ isSuperUser: true }` -> DENIED.
5. **Role Tampering on Update**: `UPDATE /users/u1` changing `role` to `"chief"` as non-admin -> DENIED.
6. **Cross-User PII Read**: `GET /users/u2` as `u1` (`field_staff`) -> DENIED.
7. **Blanket Users List**: `LIST /users` as `field_staff` -> DENIED.
8. **ID Poisoning**: `CREATE /notifications/bad..id..with..1500chars` -> DENIED.
9. **Negative Quantity Injection**: `CREATE /daily_disbursements/r1_a1_urea` with `openingBalance: -50` -> DENIED.
10. **Pre-Approved Tractor Creation**: `CREATE /tractor_deliveries/t1` with `approvalState: "final_approved"` by non-admin -> DENIED.
11. **Self-Approval of Daily Report**: `UPDATE /daily_reports/r1` to `status: "approved"` by `chief` where `createdByUid == chief.uid` -> DENIED.
12. **Rejection Without Reason**: `UPDATE /daily_reports/r1` to `status: "rejected"` with `rejectionReason: ""` -> DENIED.
13. **Status Change Without Atomic Approval Record**: `UPDATE /daily_reports/r1` changing `status` without creating matching `/approvals/{lastApprovalId}` in the same batch -> DENIED.
14. **Non-Deterministic or Cross-Gov Disbursement Create**: `CREATE /daily_disbursements/randomId` or creating a disbursement under an `approved` report or mismatched `governorateId` -> DENIED.
15. **Audit Log Tampering**: `UPDATE` or `DELETE /audit_logs/log1` -> DENIED.
16. **Terminal State Mutation**: `UPDATE /daily_reports/r1` changing `status` when `existing().status == "approved"` by non-admin -> DENIED.
