import { firebaseProjectId, firestoreDatabaseId } from '../lib/firebase-admin.ts';

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
}

const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
  firebaseProjectId,
)}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents`;

export const FIRESTORE_DOC_PREFIX = `projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents`;

function buildFirestoreRestHeaders(
  idToken: string,
  appCheckToken?: string,
  withJsonBody = false,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${idToken}`,
    Accept: 'application/json',
  };
  if (withJsonBody) {
    headers['Content-Type'] = 'application/json';
  }
  const cleanAppCheck = appCheckToken?.trim();
  if (cleanAppCheck) {
    headers['X-Firebase-AppCheck'] = cleanAppCheck;
  }
  return headers;
}

export function decodeFirestoreValue(val: FirestoreValue | undefined): unknown {
  if (!val) return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((v) => decodeFirestoreValue(v));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

export function decodeFirestoreFields(
  fields?: Record<string, FirestoreValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}

export function encodeFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => encodeFirestoreValue(item)),
      },
    };
  }
  if (typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function encodeFirestoreFields(
  data: Record<string, unknown>,
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      fields[k] = encodeFirestoreValue(v);
    }
  }
  return fields;
}

export class FirestoreRestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FirestoreRestError';
    this.status = status;
  }
}

export async function fsRestGetDocument(
  docPath: string,
  idToken: string,
  appCheckToken?: string,
): Promise<Record<string, unknown> | null> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const url = `${FIRESTORE_REST_BASE}/${cleanPath}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: buildFirestoreRestHeaders(idToken, appCheckToken, false),
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new FirestoreRestError(
      `Firestore REST GET ${cleanPath} failed (${res.status}): ${bodyText.slice(0, 200)}`,
      res.status,
    );
  }
  const docJson = (await res.json()) as FirestoreDocument;
  return decodeFirestoreFields(docJson.fields);
}

export async function fsRestQueryDisbursements(
  governorateId: string,
  reportId: string,
  idToken: string,
  appCheckToken?: string,
): Promise<Array<Record<string, unknown>>> {
  const url = `${FIRESTORE_REST_BASE}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'daily_disbursements' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'governorateId' },
                op: 'EQUAL',
                value: { stringValue: governorateId },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'reportId' },
                op: 'EQUAL',
                value: { stringValue: reportId },
              },
            },
          ],
        },
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: buildFirestoreRestHeaders(idToken, appCheckToken, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new FirestoreRestError(
      `Firestore REST runQuery daily_disbursements failed (${res.status}): ${bodyText.slice(0, 200)}`,
      res.status,
    );
  }

  const rows = (await res.json()) as Array<{ document?: FirestoreDocument }>;
  const results: Array<Record<string, unknown>> = [];
  for (const entry of rows) {
    if (!entry.document) continue;
    const id = entry.document.name?.split('/').pop() || '';
    results.push({
      id,
      ...decodeFirestoreFields(entry.document.fields),
    });
  }
  return results;
}

export async function fsRestQueryAssociationDisbursements(
  governorateId: string,
  associationId: string,
  fertilizerCode: string,
  idToken: string,
  appCheckToken?: string,
): Promise<Array<Record<string, unknown>>> {
  const url = `${FIRESTORE_REST_BASE}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'daily_disbursements' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'governorateId' },
                op: 'EQUAL',
                value: { stringValue: governorateId },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'associationId' },
                op: 'EQUAL',
                value: { stringValue: associationId },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'fertilizerCode' },
                op: 'EQUAL',
                value: { stringValue: fertilizerCode },
              },
            },
          ],
        },
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: buildFirestoreRestHeaders(idToken, appCheckToken, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new FirestoreRestError(
      `Firestore REST runQuery association disbursements failed (${res.status}): ${bodyText.slice(0, 200)}`,
      res.status,
    );
  }

  const rows = (await res.json()) as Array<{ document?: FirestoreDocument }>;
  const results: Array<Record<string, unknown>> = [];
  for (const entry of rows) {
    if (!entry.document) continue;
    const id = entry.document.name?.split('/').pop() || '';
    results.push({
      id,
      ...decodeFirestoreFields(entry.document.fields),
    });
  }
  return results;
}

export interface RestCommitWrite {
  update?: {
    name: string;
    fields: Record<string, FirestoreValue>;
  };
  updateMask?: {
    fieldPaths: string[];
  };
  updateTransforms?: Array<{
    fieldPath: string;
    setToServerValue: 'REQUEST_TIME';
  }>;
  currentDocument?: {
    exists: boolean;
  };
}

export async function fsRestCommitWrites(
  writes: RestCommitWrite[],
  idToken: string,
  appCheckToken?: string,
): Promise<void> {
  const url = `${FIRESTORE_REST_BASE}:commit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildFirestoreRestHeaders(idToken, appCheckToken, true),
    body: JSON.stringify({ writes }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new FirestoreRestError(
      `Firestore REST commit failed (${res.status}): ${bodyText.slice(0, 250)}`,
      res.status,
    );
  }
}
