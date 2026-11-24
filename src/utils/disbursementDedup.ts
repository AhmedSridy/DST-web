export interface DisbursementKeyInput {
  reportId: string;
  associationId: string;
  fertilizerCode: string;
}

export interface ExistingDisbursementMeta {
  id: string;
  createdByUid?: string;
}

export function buildDisbursementDedupKey(input: DisbursementKeyInput): string {
  return `${input.reportId}::${input.associationId}::${input.fertilizerCode}`;
}

export function buildDeterministicDisbursementId(input: DisbursementKeyInput): string {
  return `${input.reportId}_${input.associationId}_${input.fertilizerCode}`;
}

/**
 * Builds a lookup map from `(reportId, associationId, fertilizerCode)` to the
 * existing Firestore document ID (including legacy `disb-...` documents).
 * If both a deterministic doc and a legacy doc somehow exist, the first encountered
 * legacy or deterministic ID is retained consistently.
 */
export function buildExistingDisbursementIdMap(
  docs: Array<{
    id: string;
    reportId: string;
    associationId: string;
    fertilizerCode: string;
    createdByUid?: string;
  }>,
): Map<string, ExistingDisbursementMeta> {
  const map = new Map<string, ExistingDisbursementMeta>();
  for (const d of docs) {
    if (!d.reportId || !d.associationId || !d.fertilizerCode) continue;
    const key = buildDisbursementDedupKey(d);
    if (!map.has(key)) {
      map.set(key, {
        id: d.id,
        ...(d.createdByUid ? { createdByUid: d.createdByUid } : {}),
      });
    }
  }
  return map;
}

/**
 * Resolves the target Firestore document ID for a restored disbursement row:
 * - If a document already exists for `(reportId, associationId, fertilizerCode)`
 *   (including legacy `disb-...` IDs), reuse that existing ID to avoid duplicates.
 * - Otherwise generate the deterministic `{reportId}_{associationId}_{fertilizerCode}` ID.
 */
export function resolveRestoredDisbursementTarget(
  existingIdMap: Map<string, ExistingDisbursementMeta>,
  row: DisbursementKeyInput,
): {
  id: string;
  isExisting: boolean;
  existingCreatedByUid?: string;
} {
  const key = buildDisbursementDedupKey(row);
  const existing = existingIdMap.get(key);
  if (existing) {
    return {
      id: existing.id,
      isExisting: true,
      existingCreatedByUid: existing.createdByUid,
    };
  }
  return {
    id: buildDeterministicDisbursementId(row),
    isExisting: false,
  };
}

/**
 * Deduplicates an array of disbursement rows by `(reportId, associationId, fertilizerCode)`,
 * keeping the last entry per unique key.
 */
export function deduplicateDisbursementRows<T extends DisbursementKeyInput>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(buildDisbursementDedupKey(row), row);
  }
  return Array.from(byKey.values());
}

/**
 * Strips sensitive or internal-only fields (such as legacy `passwordHash` and
 * client-side detection flags) from user records before exporting JSON backups.
 */
export function stripSensitiveUserFields<T extends object>(
  users: T[],
): Array<Record<string, unknown>> {
  return users.map((u) => {
    const clone: Record<string, unknown> = { ...(u as Record<string, unknown>) };
    delete clone.passwordHash;
    delete clone.hasLegacyPasswordHash;
    return clone;
  });
}
