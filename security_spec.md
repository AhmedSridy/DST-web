# Security Specification — DST Fertilizer Management System

## 1. Data Invariants
1. **Zero Self-Assigned Privilege Escalation**: A non-admin user creating their own `/users/{userId}` profile MUST only receive the default `field_staff` role (unless bootstrapped admin email `ahmedsridy@gmail.com` is verified) and MUST NOT be able to mutate their `role` or `isActive` fields.
2. **PII Isolation**: User profiles (`/users/{userId}`) contain email addresses and are readable only by the owner (`request.auth.uid == userId`) or an administrator. Driver national IDs and phone numbers in `/tractor_deliveries` are protected from unauthenticated reads and list scraping.
3. **Path ID & Payload Boundary Hardening**: All document IDs must match `^[a-zA-Z0-9_-]+$` and be `<= 128` chars. All string fields enforce explicit `.size()` upper bounds, and numeric disbursement/bag quantities must be non-negative (`>= 0`).
4. **Immutable Ownership & Audit Trail**: `createdByUid` and `createdAt` cannot be modified after creation; `/audit_logs` cannot be modified or deleted by client SDKs.
5. **Terminal State Locking**: Once a `daily_reports` document reaches `approved`, non-admin clients cannot alter it.
6. **Strict Verified Authentication**: All client Firestore writes require `request.auth != null && request.auth.token.email_verified == true`.
7. **Zero Client Query Trust**: Every `allow list` rule validates `resource.data` against `request.auth` without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Read**: `GET /users/user1` with `auth == null` -> DENIED.
2. **Unverified Email Write**: `CREATE /users/user1` with `email_verified: false` -> DENIED.
3. **Self-Role Escalation on Create**: `CREATE /users/u1` with `{ uid: "u1", role: "admin", ... }` by non-admin -> DENIED.
4. **Shadow Field Injection**: `CREATE /users/u1` with extra `{ isSuperUser: true }` -> DENIED.
5. **Role Tampering on Update**: `UPDATE /users/u1` changing `role` to `"chief"` as non-admin -> DENIED.
6. **Cross-User PII Read**: `GET /users/u2` as `u1` (`field_staff`) -> DENIED.
7. **Blanket Users List**: `LIST /users` as `field_staff` -> DENIED.
8. **ID Poisoning**: `CREATE /notifications/bad..id..with..1500chars` -> DENIED.
9. **Negative Quantity Injection**: `CREATE /daily_disbursements/d1` with `openingBalance: -50` -> DENIED.
10. **Impersonated Ownership**: `CREATE /daily_reports/r1` with `createdByUid: "someone_else"` -> DENIED.
11. **Audit Log Tampering**: `UPDATE` or `DELETE /audit_logs/log1` -> DENIED.
12. **Terminal State Mutation**: `UPDATE /daily_reports/r1` when `existing().status == "approved"` by non-admin -> DENIED.
