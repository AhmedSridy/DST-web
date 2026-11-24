import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicDisbursementId,
  buildExistingDisbursementIdMap,
  deduplicateDisbursementRows,
  resolveRestoredDisbursementTarget,
  stripSensitiveUserFields,
} from './disbursementDedup.ts';

test('resolveRestoredDisbursementTarget reuses legacy disb-... doc ID when matching (reportId, associationId, fertilizerCode) exists', () => {
  const existingMap = buildExistingDisbursementIdMap([
    {
      id: 'disb-1728000001-legacy',
      reportId: 'rep-gov-ismailia-2026-10-10',
      associationId: 'assoc-1',
      fertilizerCode: 'urea',
      createdByUid: 'staff_old',
    },
  ]);

  const resolved = resolveRestoredDisbursementTarget(existingMap, {
    reportId: 'rep-gov-ismailia-2026-10-10',
    associationId: 'assoc-1',
    fertilizerCode: 'urea',
  });

  assert.equal(resolved.id, 'disb-1728000001-legacy');
  assert.equal(resolved.isExisting, true);
  assert.equal(resolved.existingCreatedByUid, 'staff_old');
});

test('resolveRestoredDisbursementTarget falls back to deterministic ID when no existing doc matches', () => {
  const existingMap = buildExistingDisbursementIdMap([
    {
      id: 'disb-1728000001-legacy',
      reportId: 'rep-gov-ismailia-2026-10-10',
      associationId: 'assoc-1',
      fertilizerCode: 'urea',
    },
  ]);

  const resolved = resolveRestoredDisbursementTarget(existingMap, {
    reportId: 'rep-gov-ismailia-2026-10-10',
    associationId: 'assoc-1',
    fertilizerCode: 'nitrate',
  });

  assert.equal(
    resolved.id,
    buildDeterministicDisbursementId({
      reportId: 'rep-gov-ismailia-2026-10-10',
      associationId: 'assoc-1',
      fertilizerCode: 'nitrate',
    }),
  );
  assert.equal(resolved.id, 'rep-gov-ismailia-2026-10-10_assoc-1_nitrate');
  assert.equal(resolved.isExisting, false);
});

test('deduplicateDisbursementRows collapses duplicate keys to prevent doubled totals on restore', () => {
  const rows = [
    {
      id: 'disb-old',
      reportId: 'rep-gov-ismailia-2026-10-10',
      associationId: 'assoc-1',
      fertilizerCode: 'urea',
      actualDisbursed: 20,
    },
    {
      id: 'rep-gov-ismailia-2026-10-10_assoc-1_urea',
      reportId: 'rep-gov-ismailia-2026-10-10',
      associationId: 'assoc-1',
      fertilizerCode: 'urea',
      actualDisbursed: 25,
    },
    {
      id: 'rep-gov-ismailia-2026-10-10_assoc-1_nitrate',
      reportId: 'rep-gov-ismailia-2026-10-10',
      associationId: 'assoc-1',
      fertilizerCode: 'nitrate',
      actualDisbursed: 10,
    },
  ];

  const deduped = deduplicateDisbursementRows(rows);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].actualDisbursed, 25);
  assert.equal(deduped[1].fertilizerCode, 'nitrate');
});

test('stripSensitiveUserFields removes passwordHash and internal flags without mutating input', () => {
  const input = [
    {
      uid: 'u1',
      email: 'a@example.com',
      displayName: 'Test User',
      role: 'admin',
      isActive: true,
      passwordHash: 'sha256:secret',
      hasLegacyPasswordHash: true,
    },
  ];
  const cleaned = stripSensitiveUserFields(input);
  assert.equal('passwordHash' in cleaned[0], false);
  assert.equal('hasLegacyPasswordHash' in cleaned[0], false);
  assert.equal(cleaned[0].uid, 'u1');
  assert.equal(input[0].passwordHash, 'sha256:secret');
});
