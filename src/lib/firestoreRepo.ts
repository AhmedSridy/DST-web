import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import {
  SEED_ASSOCIATIONS,
  SEED_CENTERS,
  SEED_FERTILIZER_TYPES,
  SEED_GOVERNORATES,
  SEED_ROLES,
  SEED_SYSTEM_SETTINGS,
  SEED_VILLAGES,
} from '../data/seedData.ts';
import type {
  AgriculturalAssociation,
  AppNotification,
  ApprovalRecord,
  AuditLogEntry,
  CenterVillage,
  DailyDisbursementRow,
  DailyReport,
  DeletedDaySnapshot,
  FertilizerType,
  Governorate,
  GovernorateCenter,
  GranularPermissions,
  ImageAttachmentRecord,
  IntegrationLogEntry,
  OfflineQueueItem,
  ReportStatus,
  RoleDefinition,
  SystemSettings,
  TractorDelivery,
  UserInvite,
  UserProfile,
  UserRole,
} from '../types/domain.ts';
import { addDaysIso } from '../utils/analytics.ts';
import {
  computeAssociationLockId,
  computeInviteId,
  MAX_ASSOCIATION_NAME_LENGTH,
  normalizeArabicName,
  previewBulkAssociationLines,
  sanitizeExtractedText,
  sortAssociationsByOrder,
} from '../utils/arabicNormalize.ts';
import { computeDisbursementRow, computeTractorMetrics } from '../utils/calculations.ts';
import {
  canAccessGovernorate,
  canDeleteTractorDelivery,
  canTransitionReportStatus,
  getDefaultGranularPermissions,
  getUserScopedGovernorateIds,
  hasGranularAccess,
  hasPermission,
} from '../utils/rbac.ts';
import { db, handleFirestoreError, OperationType } from './firebase.ts';

const SEED_VERSION = 'v5';

function toIsoString(val: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

function normalizeAssociationDoc(id: string, data: DocumentData): AgriculturalAssociation {
  const createdAt = toIsoString(data.createdAt);
  const updatedAt = toIsoString(data.updatedAt);
  return {
    id,
    code: String(data.code || ''),
    nameAr: String(data.nameAr || ''),
    normalizedName: String(data.normalizedName || normalizeArabicName(String(data.nameAr || ''))),
    governorateId: String(data.governorateId || ''),
    centerId: String(data.centerId || ''),
    villageId: typeof data.villageId === 'string' ? data.villageId : '',
    managerName: typeof data.managerName === 'string' ? data.managerName : '',
    managerPhone: typeof data.managerPhone === 'string' ? data.managerPhone : '',
    ...(typeof data.supervisionType === 'string' ? { supervisionType: data.supervisionType } : {}),
    ...(typeof data.distributionDay === 'string' ? { distributionDay: data.distributionDay } : {}),
    ...(typeof data.capacity === 'number' ? { capacity: data.capacity } : {}),
    ...(typeof data.notes === 'string' ? { notes: data.notes } : {}),
    ...(typeof data.sortOrder === 'number' ? { sortOrder: data.sortOrder } : {}),
    isActive: data.isActive !== false && data.active !== false,
    ...(typeof data.active === 'boolean' ? { active: data.active } : {}),
    ...(typeof data.createdByUid === 'string' ? { createdByUid: data.createdByUid } : {}),
    ...(typeof data.createdByName === 'string' ? { createdByName: data.createdByName } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function normalizeUserDoc(id: string, data: DocumentData): UserProfile {
  return {
    uid: String(data.uid || id),
    email: String(data.email || ''),
    displayName: String(data.displayName || ''),
    role: (data.role || 'field_staff') as UserRole,
    ...(typeof data.governorateId === 'string' ? { governorateId: data.governorateId } : {}),
    ...(Array.isArray(data.governorateIds) ? { governorateIds: data.governorateIds.map(String) } : {}),
    ...(data.permissions && typeof data.permissions === 'object'
      ? { permissions: data.permissions as GranularPermissions }
      : {}),
    ...(typeof data.inviteId === 'string' ? { inviteId: data.inviteId } : {}),
    isActive: data.isActive !== false,
    ...(toIsoString(data.createdAt) ? { createdAt: toIsoString(data.createdAt) } : {}),
    ...(toIsoString(data.updatedAt) ? { updatedAt: toIsoString(data.updatedAt) } : {}),
  };
}

function normalizeInviteDoc(id: string, data: DocumentData): UserInvite {
  const role = (data.role || 'field_staff') as UserRole;
  return {
    id,
    email: String(data.email || '').toLowerCase(),
    displayName: String(data.displayName || ''),
    role,
    governorateIds: Array.isArray(data.governorateIds) ? data.governorateIds.map(String) : [],
    permissions:
      data.permissions && typeof data.permissions === 'object'
        ? (data.permissions as GranularPermissions)
        : getDefaultGranularPermissions(role),
    isActive: data.isActive !== false,
    ...(typeof data.claimedUid === 'string' ? { claimedUid: data.claimedUid } : {}),
    invitedByUid: String(data.invitedByUid || data.createdByUid || ''),
    ...(toIsoString(data.createdAt) ? { createdAt: toIsoString(data.createdAt) } : {}),
    ...(toIsoString(data.updatedAt) ? { updatedAt: toIsoString(data.updatedAt) } : {}),
  };
}

async function listCollectionSafe(colName: string) {
  try {
    return await getDocs(collection(db, colName));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colName);
  }
}

async function queryByGovernorates(
  colName: string,
  scopedGovIds: string[] | null,
): Promise<Array<{ id: string; data: DocumentData }>> {
  try {
    if (scopedGovIds === null) {
      const snap = await getDocs(collection(db, colName));
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    }
    if (scopedGovIds.length === 0) {
      return [];
    }
    const chunks: string[][] = [];
    for (let i = 0; i < scopedGovIds.length; i += 10) {
      chunks.push(scopedGovIds.slice(i, i + 10));
    }
    const results = await Promise.all(
      chunks.map((chunk) =>
        getDocs(query(collection(db, colName), where('governorateId', 'in', chunk))),
      ),
    );
    const out: Array<{ id: string; data: DocumentData }> = [];
    for (const snap of results) {
      for (const d of snap.docs) {
        out.push({ id: d.id, data: d.data() });
      }
    }
    return out;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colName);
  }
}

async function commitBatchedWrites(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>,
): Promise<void> {
  for (let i = 0; i < ops.length; i += 380) {
    const batch = writeBatch(db);
    const slice = ops.slice(i, i + 380);
    for (const fn of slice) {
      fn(batch);
    }
    await batch.commit();
  }
}

function sanitizeSystemSettingsForRule(settings: Partial<SystemSettings> & { seedVersion?: string }) {
  return stripUndefined({
    requireDriverNationalId: Boolean(settings.requireDriverNationalId),
    centralApiUrl: sanitizeExtractedText(settings.centralApiUrl || SEED_SYSTEM_SETTINGS.centralApiUrl),
    autoSyncOnApproval: Boolean(settings.autoSyncOnApproval),
    organizationNameAr: sanitizeExtractedText(
      settings.organizationNameAr || SEED_SYSTEM_SETTINGS.organizationNameAr,
    ),
    treatEmptyAsZero: Boolean(settings.treatEmptyAsZero),
    minThresholds: settings.minThresholds || SEED_SYSTEM_SETTINGS.minThresholds,
    assocMinThresholds: settings.assocMinThresholds || {},
    ...(settings.seedVersion ? { seedVersion: settings.seedVersion } : {}),
  });
}

async function writeAuditLogFs(params: {
  actor: UserProfile;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  oldValue?: unknown;
  newValue?: unknown;
}): Promise<AuditLogEntry> {
  const id = makeDocId('aud');
  const serializeValue = (val: unknown): string | undefined => {
    if (val === undefined) return undefined;
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    return str.slice(0, 1900);
  };
  const oldStr = serializeValue(params.oldValue);
  const newStr = serializeValue(params.newValue);
  const payload = stripUndefined({
    actorUid: params.actor.uid,
    actorEmail: params.actor.email,
    actorName: sanitizeExtractedText(params.actor.displayName),
    actorRole: params.actor.role,
    action: params.action.slice(0, 80),
    entityType: params.entityType.slice(0, 60),
    entityId: params.entityId.slice(0, 128),
    details: sanitizeExtractedText(params.details).slice(0, 1000),
    ...(oldStr !== undefined ? { oldValue: oldStr } : {}),
    ...(newStr !== undefined ? { newValue: newStr } : {}),
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'audit_logs', id), payload);
  return {
    id,
    actorUid: params.actor.uid,
    actorEmail: params.actor.email,
    actorName: params.actor.displayName,
    actorRole: params.actor.role,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    details: sanitizeExtractedText(params.details),
    ...(oldStr !== undefined ? { oldValue: oldStr } : {}),
    ...(newStr !== undefined ? { newValue: newStr } : {}),
    createdAt: new Date().toISOString(),
  };
}

export async function ensureClientSeedDataFs(actor: UserProfile): Promise<void> {
  if (actor.role !== 'admin') return;
  try {
    const settingsRef = doc(db, 'system_settings', 'global');
    const settingsSnap = await getDoc(settingsRef);
    const currentSeedVersion = settingsSnap.exists() ? settingsSnap.data()?.seedVersion : null;
    if (currentSeedVersion === SEED_VERSION) return;

    const existingAssocsSnap = await getDocs(collection(db, 'agricultural_associations'));
    const existingAssocMap = new Map(existingAssocsSnap.docs.map((d) => [d.id, d.data()]));

    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

    for (const r of SEED_ROLES) {
      ops.push((b) =>
        b.set(doc(db, 'roles', r.id), {
          code: r.code,
          nameAr: r.nameAr,
          permissions: JSON.stringify(r.permissions),
        }),
      );
    }

    for (const g of SEED_GOVERNORATES) {
      ops.push((b) =>
        b.set(
          doc(db, 'governorates', g.id),
          stripUndefined({
            code: g.code,
            nameAr: g.nameAr,
            region: g.region,
            isActive: g.isActive,
          }),
        ),
      );
    }

    for (const c of SEED_CENTERS) {
      ops.push((b) =>
        b.set(doc(db, 'governorate_centers', c.id), {
          governorateId: c.governorateId,
          code: c.code,
          nameAr: c.nameAr,
          isActive: c.isActive,
        }),
      );
    }

    for (const v of SEED_VILLAGES) {
      ops.push((b) =>
        b.set(doc(db, 'center_villages', v.id), {
          governorateId: v.governorateId,
          centerId: v.centerId,
          nameAr: v.nameAr,
          isActive: v.isActive,
        }),
      );
    }

    for (const f of SEED_FERTILIZER_TYPES) {
      ops.push((b) =>
        b.set(doc(db, 'fertilizer_types', f.id), {
          code: f.code,
          nameAr: f.nameAr,
          sortOrder: f.sortOrder,
          bagWeightKg: f.bagWeightKg,
          isActive: f.isActive,
        }),
      );
    }

    SEED_ASSOCIATIONS.forEach((a, idx) => {
      const existingData = existingAssocMap.get(a.id);
      const norm = normalizeArabicName(String(existingData?.nameAr || a.nameAr));
      const lockId = computeAssociationLockId(a.governorateId, norm);
      if (existingData) {
        const needsBackfill =
          typeof existingData.isActive !== 'boolean' ||
          typeof existingData.normalizedName !== 'string' ||
          !existingData.normalizedName ||
          typeof existingData.sortOrder !== 'number';
        if (needsBackfill) {
          const activeVal = existingData.isActive !== false && existingData.active !== false;
          ops.push((b) =>
            b.set(
              doc(db, 'agricultural_associations', a.id),
              stripUndefined({
                code: String(existingData.code || a.code),
                nameAr: String(existingData.nameAr || a.nameAr),
                normalizedName: norm,
                governorateId: String(existingData.governorateId || a.governorateId),
                centerId: String(existingData.centerId || a.centerId),
                villageId: typeof existingData.villageId === 'string' ? existingData.villageId : a.villageId || '',
                managerName: typeof existingData.managerName === 'string' ? existingData.managerName : '',
                managerPhone: typeof existingData.managerPhone === 'string' ? existingData.managerPhone : '',
                supervisionType:
                  typeof existingData.supervisionType === 'string'
                    ? existingData.supervisionType
                    : a.supervisionType,
                distributionDay:
                  typeof existingData.distributionDay === 'string'
                    ? existingData.distributionDay
                    : a.distributionDay,
                capacity: typeof existingData.capacity === 'number' ? existingData.capacity : a.capacity,
                sortOrder: typeof existingData.sortOrder === 'number' ? existingData.sortOrder : idx + 1,
                isActive: activeVal,
                active: activeVal,
                createdByUid:
                  typeof existingData.createdByUid === 'string' ? existingData.createdByUid : actor.uid,
              }),
            ),
          );
          ops.push((b) =>
            b.set(doc(db, 'association_name_locks', lockId), {
              governorateId: String(existingData.governorateId || a.governorateId),
              normalizedName: norm,
              associationId: a.id,
              createdByUid: actor.uid,
              updatedAt: serverTimestamp(),
            }),
          );
        }
        return;
      }

      ops.push((b) =>
        b.set(
          doc(db, 'agricultural_associations', a.id),
          stripUndefined({
            code: a.code,
            nameAr: a.nameAr,
            normalizedName: norm,
            governorateId: a.governorateId,
            centerId: a.centerId,
            villageId: a.villageId || '',
            managerName: a.managerName || '',
            managerPhone: a.managerPhone || '',
            supervisionType: a.supervisionType,
            distributionDay: a.distributionDay,
            capacity: a.capacity,
            sortOrder: idx + 1,
            isActive: true,
            active: true,
            createdByUid: actor.uid,
          }),
        ),
      );
      ops.push((b) =>
        b.set(doc(db, 'association_name_locks', lockId), {
          governorateId: a.governorateId,
          normalizedName: norm,
          associationId: a.id,
          createdByUid: actor.uid,
          updatedAt: serverTimestamp(),
        }),
      );
    });

    const baseSettings = settingsSnap.exists()
      ? ({ ...SEED_SYSTEM_SETTINGS, ...settingsSnap.data(), seedVersion: SEED_VERSION } as SystemSettings & {
          seedVersion: string;
        })
      : { ...SEED_SYSTEM_SETTINGS, seedVersion: SEED_VERSION };

    ops.push((b) => b.set(settingsRef, sanitizeSystemSettingsForRule(baseSettings)));

    await commitBatchedWrites(ops);
  } catch (error) {
    console.warn('Client Firestore seed sync note:', error);
  }
}

export async function fetchBootstrapDataFs(actor: UserProfile): Promise<{
  roles: RoleDefinition[];
  fertilizerTypes: FertilizerType[];
  governorates: Governorate[];
  centers: GovernorateCenter[];
  villages: CenterVillage[];
  associations: AgriculturalAssociation[];
  reports: DailyReport[];
  disbursements: DailyDisbursementRow[];
  tractors: TractorDelivery[];
  approvals: ApprovalRecord[];
  integrationLogs: IntegrationLogEntry[];
  attachments: ImageAttachmentRecord[];
  settings: SystemSettings;
  notifications: AppNotification[];
  auditLogs: AuditLogEntry[];
  users: UserProfile[];
  invites: UserInvite[];
}> {
  if (actor.role === 'admin') {
    await ensureClientSeedDataFs(actor);
  }

  const scopedGovIds = getUserScopedGovernorateIds(actor);

  const [
    rolesSnap,
    govsSnap,
    centersSnap,
    villagesSnap,
    fertSnap,
    settingsSnap,
    notifSnap,
    assocDocs,
    reportDocs,
    disbDocs,
    tractorDocs,
    approvalDocs,
    intLogDocs,
    attDocs,
    usersSnap,
    invitesSnap,
    auditSnap,
  ] = await Promise.all([
    getDocs(collection(db, 'roles')).catch(() => null),
    listCollectionSafe('governorates'),
    listCollectionSafe('governorate_centers'),
    listCollectionSafe('center_villages'),
    listCollectionSafe('fertilizer_types'),
    getDoc(doc(db, 'system_settings', 'global')).catch(() => null),
    getDocs(query(collection(db, 'notifications'), where('userId', '==', actor.uid))).catch(() => null),
    queryByGovernorates('agricultural_associations', scopedGovIds),
    queryByGovernorates('daily_reports', scopedGovIds),
    queryByGovernorates('daily_disbursements', scopedGovIds),
    queryByGovernorates('tractor_deliveries', scopedGovIds),
    queryByGovernorates('approvals', scopedGovIds),
    queryByGovernorates('integration_logs', scopedGovIds),
    queryByGovernorates('images_attachments', scopedGovIds),
    actor.role === 'admin' ? listCollectionSafe('users') : Promise.resolve(null),
    actor.role === 'admin' ? listCollectionSafe('user_invites') : Promise.resolve(null),
    actor.role === 'admin' ? listCollectionSafe('audit_logs') : Promise.resolve(null),
  ]);

  const roles: RoleDefinition[] =
    rolesSnap && rolesSnap.docs.length > 0
      ? rolesSnap.docs.map((d) => {
          const raw = d.data();
          const seedMatch = SEED_ROLES.find((sr) => sr.id === d.id || sr.code === raw.code);
          let parsedPerms: string[] = seedMatch?.permissions || [];
          if (typeof raw.permissions === 'string') {
            try {
              parsedPerms = JSON.parse(raw.permissions) as string[];
            } catch {
              // fallback to seed permissions
            }
          } else if (Array.isArray(raw.permissions)) {
            parsedPerms = raw.permissions.map(String);
          }
          return {
            id: d.id,
            code: raw.code as UserRole,
            nameAr: String(raw.nameAr || seedMatch?.nameAr || ''),
            descriptionAr: seedMatch?.descriptionAr || '',
            permissions: parsedPerms,
          };
        })
      : SEED_ROLES;

  const allGovernorates: Governorate[] =
    govsSnap.docs.length > 0
      ? govsSnap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            code: String(data.code || ''),
            nameAr: String(data.nameAr || ''),
            region: typeof data.region === 'string' ? data.region : '',
            isActive: data.isActive !== false,
          };
        })
      : SEED_GOVERNORATES;

  const visibleGovernorates =
    scopedGovIds === null
      ? allGovernorates
      : allGovernorates.filter((g) => scopedGovIds.includes(g.id));

  const centers: GovernorateCenter[] =
    centersSnap.docs.length > 0
      ? centersSnap.docs.map((d) => ({
          id: d.id,
          governorateId: String(d.data().governorateId || ''),
          code: String(d.data().code || ''),
          nameAr: String(d.data().nameAr || ''),
          isActive: d.data().isActive !== false,
        }))
      : SEED_CENTERS;

  const villages: CenterVillage[] =
    villagesSnap.docs.length > 0
      ? villagesSnap.docs.map((d) => ({
          id: d.id,
          governorateId: String(d.data().governorateId || ''),
          centerId: String(d.data().centerId || ''),
          nameAr: String(d.data().nameAr || ''),
          isActive: d.data().isActive !== false,
        }))
      : SEED_VILLAGES;

  const fertilizerTypes: FertilizerType[] =
    fertSnap.docs.length > 0
      ? fertSnap.docs
          .map((d) => ({
            id: d.id,
            code: d.data().code as FertilizerType['code'],
            nameAr: String(d.data().nameAr || ''),
            sortOrder: Number(d.data().sortOrder || 0),
            bagWeightKg: Number(d.data().bagWeightKg || 50),
            isActive: d.data().isActive !== false,
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder)
      : SEED_FERTILIZER_TYPES;

  const associations = sortAssociationsByOrder(
    assocDocs.map((d) => normalizeAssociationDoc(d.id, d.data)),
  );

  const reports: DailyReport[] = reportDocs
    .map((d) => ({
      id: d.id,
      governorateId: String(d.data.governorateId || ''),
      reportDate: String(d.data.reportDate || ''),
      status: (d.data.status || 'draft') as ReportStatus,
      createdByUid: String(d.data.createdByUid || ''),
      createdByName: typeof d.data.createdByName === 'string' ? d.data.createdByName : '',
      rejectionReason: typeof d.data.rejectionReason === 'string' ? d.data.rejectionReason : undefined,
      centralSyncStatus: (d.data.centralSyncStatus || 'pending') as DailyReport['centralSyncStatus'],
      createdAt: toIsoString(d.data.createdAt) || new Date().toISOString(),
      updatedAt: toIsoString(d.data.updatedAt) || new Date().toISOString(),
    }))
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate));

  const disbursements: DailyDisbursementRow[] = disbDocs.map((d) => ({
    id: d.id,
    reportId: String(d.data.reportId || ''),
    governorateId: String(d.data.governorateId || ''),
    associationId: String(d.data.associationId || ''),
    fertilizerCode: String(d.data.fertilizerCode || ''),
    openingBalance: d.data.openingBalance ?? null,
    closingBalance: d.data.closingBalance ?? null,
    settlementQty: d.data.settlementQty ?? null,
    actualDisbursed: d.data.actualDisbursed ?? null,
    variance: d.data.variance ?? null,
    varianceReason: typeof d.data.varianceReason === 'string' ? d.data.varianceReason : '',
    createdByUid: typeof d.data.createdByUid === 'string' ? d.data.createdByUid : undefined,
    updatedAt: toIsoString(d.data.updatedAt) || new Date().toISOString(),
  }));

  const tractors: TractorDelivery[] = tractorDocs
    .map((d) => ({
      id: d.id,
      governorateId: String(d.data.governorateId || ''),
      centerId: String(d.data.centerId || ''),
      associationId: String(d.data.associationId || ''),
      tractorPlate: String(d.data.tractorPlate || ''),
      arrivalDate: String(d.data.arrivalDate || ''),
      arrivalTime: String(d.data.arrivalTime || ''),
      fertilizerCode: String(d.data.fertilizerCode || ''),
      driverName: String(d.data.driverName || ''),
      driverPhone: String(d.data.driverPhone || ''),
      driverNationalId: String(d.data.driverNationalId || ''),
      supplySource: String(d.data.supplySource || ''),
      manifestNumber: String(d.data.manifestNumber || ''),
      manifestBags: Number(d.data.manifestBags || 0),
      actualBags: Number(d.data.actualBags || 0),
      bagVariance: Number(d.data.bagVariance || 0),
      inspectionStatus: (d.data.inspectionStatus || 'matched') as TractorDelivery['inspectionStatus'],
      approvalState: (d.data.approvalState || 'pending') as TractorDelivery['approvalState'],
      checklist: (d.data.checklist || {
        bagsDryAndIntact: true,
        weightMatchesSample: true,
        sealIntact: true,
      }) as TractorDelivery['checklist'],
      notes: String(d.data.notes || ''),
      createdByUid: String(d.data.createdByUid || ''),
      createdAt: toIsoString(d.data.createdAt) || new Date().toISOString(),
    }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const approvals: ApprovalRecord[] = approvalDocs
    .map((d) => ({
      id: d.id,
      reportId: String(d.data.reportId || ''),
      governorateId: String(d.data.governorateId || ''),
      reportDate: String(d.data.reportDate || ''),
      action: d.data.action as ApprovalRecord['action'],
      fromStatus: d.data.fromStatus as ReportStatus,
      toStatus: d.data.toStatus as ReportStatus,
      actorUid: String(d.data.actorUid || ''),
      actorName: String(d.data.actorName || ''),
      actorRole: (d.data.actorRole || 'supervisor') as UserRole,
      notes: String(d.data.notes || ''),
      createdAt: toIsoString(d.data.createdAt) || new Date().toISOString(),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const integrationLogs: IntegrationLogEntry[] = intLogDocs
    .map((d) => ({
      id: d.id,
      reportId: String(d.data.reportId || ''),
      governorateId: String(d.data.governorateId || ''),
      reportDate: String(d.data.reportDate || ''),
      endpointUrl: String(d.data.endpointUrl || ''),
      status: (d.data.status || 'success') as 'success' | 'failed',
      httpStatus: Number(d.data.httpStatus || 200),
      payloadSummary: String(d.data.payloadSummary || ''),
      responseMessage: String(d.data.responseMessage || ''),
      dispatchedByUid: String(d.data.dispatchedByUid || ''),
      createdAt: toIsoString(d.data.createdAt) || new Date().toISOString(),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const attachments: ImageAttachmentRecord[] = attDocs
    .map((d) => ({
      id: d.id,
      governorateId: String(d.data.governorateId || ''),
      associationId: String(d.data.associationId || ''),
      associationName: String(d.data.associationName || ''),
      fertilizerCode: String(d.data.fertilizerCode || ''),
      reportDate: String(d.data.reportDate || ''),
      sectionType: 'closing' as const,
      extractedClosingBalance: d.data.extractedClosingBalance ?? null,
      lastRecordedBalance: 0,
      discrepancy: null,
      confidence: Number(d.data.confidence || 0),
      notes: String(d.data.notes || ''),
      imageDataUrl: '',
      analyzedByUid: String(d.data.analyzedByUid || ''),
      createdAt: toIsoString(d.data.createdAt) || new Date().toISOString(),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const settings: SystemSettings =
    settingsSnap && settingsSnap.exists()
      ? {
          ...SEED_SYSTEM_SETTINGS,
          ...(settingsSnap.data() as Partial<SystemSettings>),
          minThresholds: {
            ...SEED_SYSTEM_SETTINGS.minThresholds,
            ...((settingsSnap.data().minThresholds as SystemSettings['minThresholds']) || {}),
          },
          assocMinThresholds:
            (settingsSnap.data().assocMinThresholds as SystemSettings['assocMinThresholds']) || {},
        }
      : SEED_SYSTEM_SETTINGS;

  const notifications: AppNotification[] =
    notifSnap?.docs
      .map((d) => ({
        id: d.id,
        userId: String(d.data().userId || ''),
        title: String(d.data().title || ''),
        message: String(d.data().message || ''),
        severity: (d.data().severity || 'info') as AppNotification['severity'],
        isRead: Boolean(d.data().isRead),
        createdAt: toIsoString(d.data().createdAt) || new Date().toISOString(),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) || [];

  const users: UserProfile[] = usersSnap
    ? usersSnap.docs.map((d) => normalizeUserDoc(d.id, d.data()))
    : [actor];

  const invites: UserInvite[] = invitesSnap
    ? invitesSnap.docs
        .map((d) => normalizeInviteDoc(d.id, d.data()))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    : [];

  const auditLogs: AuditLogEntry[] = auditSnap
    ? auditSnap.docs
        .map((d) => ({
          id: d.id,
          actorUid: String(d.data().actorUid || ''),
          actorEmail: String(d.data().actorEmail || ''),
          actorName: String(d.data().actorName || d.data().actorEmail || ''),
          actorRole: (d.data().actorRole || 'admin') as UserRole,
          action: String(d.data().action || ''),
          entityType: String(d.data().entityType || ''),
          entityId: String(d.data().entityId || ''),
          details: String(d.data().details || ''),
          ...(typeof d.data().oldValue === 'string' ? { oldValue: d.data().oldValue } : {}),
          ...(typeof d.data().newValue === 'string' ? { newValue: d.data().newValue } : {}),
          createdAt: toIsoString(d.data().createdAt) || new Date().toISOString(),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 300)
    : [];

  return {
    roles,
    fertilizerTypes,
    governorates: visibleGovernorates,
    centers,
    villages,
    associations,
    reports,
    disbursements,
    tractors,
    approvals,
    integrationLogs,
    attachments,
    settings,
    notifications,
    auditLogs,
    users,
    invites,
  };
}

export async function saveAssociationFs(
  input: Omit<AgriculturalAssociation, 'id' | 'normalizedName'> & { id?: string },
  actor: UserProfile,
  nextSortOrderFallback: number,
): Promise<{ association: AgriculturalAssociation; auditEntry: AuditLogEntry }> {
  if (!hasGranularAccess(actor, 'canManageAssociations')) {
    throw new Error('ليس لديك صلاحية إدارة الجمعيات.');
  }
  if (!canAccessGovernorate(actor, input.governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }

  const cleanName = sanitizeExtractedText(input.nameAr);
  if (!cleanName) {
    throw new Error('اسم الجمعية مطلوب.');
  }
  if (cleanName.length > MAX_ASSOCIATION_NAME_LENGTH) {
    throw new Error(`اسم الجمعية يجب ألا يتجاوز ${MAX_ASSOCIATION_NAME_LENGTH} حرفًا.`);
  }
  const norm = normalizeArabicName(cleanName);
  if (!norm) {
    throw new Error('اسم الجمعية غير صالح.');
  }
  if (!input.governorateId || !input.centerId) {
    throw new Error('المحافظة ونقطة التوزيع / المركز مطلوبان.');
  }

  const assocId = input.id || makeDocId('assoc');
  const cleanCode =
    sanitizeExtractedText(input.code) ||
    `DST-${input.governorateId.replace('gov-', '').slice(0, 4).toUpperCase()}-${assocId.slice(-4).toUpperCase()}`;
  const cleanNotes = sanitizeExtractedText(input.notes || '');
  const newLockId = computeAssociationLockId(input.governorateId, norm);

  let oldSnapshot: Record<string, unknown> | undefined;
  let finalSortOrder =
    typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder)
      ? Math.max(0, Math.round(input.sortOrder))
      : nextSortOrderFallback;

  try {
    await runTransaction(db, async (tx) => {
      const assocRef = doc(db, 'agricultural_associations', assocId);
      const existingSnap = await tx.get(assocRef);
      const existingData = existingSnap.exists() ? existingSnap.data() : null;

      const lockRef = doc(db, 'association_name_locks', newLockId);
      const lockSnap = await tx.get(lockRef);

      let oldLockRefToDelete: ReturnType<typeof doc> | null = null;
      if (existingData) {
        oldSnapshot = {
          nameAr: existingData.nameAr,
          code: existingData.code,
          centerId: existingData.centerId,
          notes: existingData.notes || '',
          isActive: existingData.isActive,
        };
        if (input.sortOrder === undefined && typeof existingData.sortOrder === 'number') {
          finalSortOrder = existingData.sortOrder;
        }
        const oldNorm = String(existingData.normalizedName || '');
        if (oldNorm && oldNorm !== norm) {
          const oldLockId = computeAssociationLockId(existingData.governorateId, oldNorm);
          oldLockRefToDelete = doc(db, 'association_name_locks', oldLockId);
        }
      }

      if (lockSnap.exists() && lockSnap.data().associationId !== assocId) {
        throw new Error(`توجد جمعية مسجلة بالفعل بنفس الاسم («${cleanName}») في هذه المحافظة.`);
      }

      const activeState = input.isActive !== false && input.active !== false;
      const docPayload = stripUndefined({
        code: cleanCode,
        nameAr: cleanName,
        normalizedName: norm,
        governorateId: input.governorateId,
        centerId: input.centerId,
        villageId: input.villageId || '',
        managerName: sanitizeExtractedText(input.managerName || ''),
        managerPhone: sanitizeExtractedText(input.managerPhone || ''),
        ...(input.supervisionType ? { supervisionType: sanitizeExtractedText(input.supervisionType) } : {}),
        ...(input.distributionDay ? { distributionDay: sanitizeExtractedText(input.distributionDay) } : {}),
        ...(typeof input.capacity === 'number' && Number.isFinite(input.capacity) ? { capacity: input.capacity } : {}),
        ...(cleanNotes ? { notes: cleanNotes } : {}),
        sortOrder: finalSortOrder,
        isActive: activeState,
        active: activeState,
        createdByUid: existingData?.createdByUid || actor.uid,
        createdByName: existingData?.createdByName || actor.displayName,
        createdAt: existingData?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(assocRef, docPayload);
      tx.set(lockRef, {
        governorateId: input.governorateId,
        normalizedName: norm,
        associationId: assocId,
        createdByUid: actor.uid,
        updatedAt: serverTimestamp(),
      });
      if (oldLockRefToDelete) {
        tx.delete(oldLockRefToDelete);
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('توجد جمعية مسجلة')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `agricultural_associations/${assocId}`);
  }

  const nowIso = new Date().toISOString();
  const saved: AgriculturalAssociation = {
    id: assocId,
    code: cleanCode,
    nameAr: cleanName,
    normalizedName: norm,
    governorateId: input.governorateId,
    centerId: input.centerId,
    villageId: input.villageId || '',
    managerName: sanitizeExtractedText(input.managerName || ''),
    managerPhone: sanitizeExtractedText(input.managerPhone || ''),
    ...(input.supervisionType ? { supervisionType: sanitizeExtractedText(input.supervisionType) } : {}),
    ...(input.distributionDay ? { distributionDay: sanitizeExtractedText(input.distributionDay) } : {}),
    ...(typeof input.capacity === 'number' && Number.isFinite(input.capacity) ? { capacity: input.capacity } : {}),
    ...(cleanNotes ? { notes: cleanNotes } : {}),
    sortOrder: finalSortOrder,
    isActive: input.isActive !== false && input.active !== false,
    active: input.isActive !== false && input.active !== false,
    createdByUid: actor.uid,
    createdByName: actor.displayName,
    createdAt: input.createdAt || nowIso,
    updatedAt: nowIso,
  };

  const auditEntry = await writeAuditLogFs({
    actor,
    action: input.id ? 'UPDATE_ASSOCIATION' : 'CREATE_ASSOCIATION',
    entityType: 'agricultural_associations',
    entityId: assocId,
    details: `${input.id ? 'تعديل' : 'إضافة'} جمعية ${cleanName} (${input.governorateId})`,
    oldValue: oldSnapshot,
    newValue: {
      nameAr: saved.nameAr,
      code: saved.code,
      centerId: saved.centerId,
      notes: saved.notes || '',
      isActive: saved.isActive,
    },
  });

  return { association: saved, auditEntry };
}

export async function addBulkAssociationsFs(params: {
  governorateId: string;
  centerId: string;
  rawText: string;
  existingGovAssocs: AgriculturalAssociation[];
  startSortOrder: number;
  actor: UserProfile;
}): Promise<{
  created: AgriculturalAssociation[];
  skippedCount: number;
  auditEntry: AuditLogEntry | null;
}> {
  if (!hasGranularAccess(params.actor, 'canManageAssociations')) {
    throw new Error('ليس لديك صلاحية إدارة الجمعيات.');
  }
  if (!canAccessGovernorate(params.actor, params.governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  const preview = previewBulkAssociationLines(params.rawText, params.existingGovAssocs);
  const validItems = preview.items.filter((i) => i.status === 'valid_new');
  if (validItems.length === 0) {
    return { created: [], skippedCount: preview.duplicateCount + preview.invalidCount, auditEntry: null };
  }

  const created: AgriculturalAssociation[] = [];
  const govShort = params.governorateId.replace('gov-', '').slice(0, 4).toUpperCase();
  const baseTs = Date.now();

  for (let offset = 0; offset < validItems.length; offset += 80) {
    const chunk = validItems.slice(offset, offset + 80);
    await runTransaction(db, async (tx) => {
      const prepared = await Promise.all(
        chunk.map(async (item, idx) => {
          const lockId = computeAssociationLockId(params.governorateId, item.normalizedName);
          const lockRef = doc(db, 'association_name_locks', lockId);
          const lockSnap = await tx.get(lockRef);
          return { item, lockRef, lockExists: lockSnap.exists(), globalIdx: offset + idx };
        }),
      );

      for (const entry of prepared) {
        if (entry.lockExists) continue;
        const assocId = `assoc-${baseTs}-${entry.globalIdx}-${Math.random().toString(36).slice(2, 5)}`;
        const code = `DST-${govShort}-${String(params.startSortOrder + entry.globalIdx + 1).padStart(3, '0')}`;
        const sortOrder = params.startSortOrder + entry.globalIdx + 1;
        const assocRef = doc(db, 'agricultural_associations', assocId);

        tx.set(assocRef, {
          code,
          nameAr: entry.item.cleanName,
          normalizedName: entry.item.normalizedName,
          governorateId: params.governorateId,
          centerId: params.centerId,
          villageId: '',
          managerName: '',
          managerPhone: '',
          sortOrder,
          isActive: true,
          active: true,
          createdByUid: params.actor.uid,
          createdByName: params.actor.displayName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        tx.set(entry.lockRef, {
          governorateId: params.governorateId,
          normalizedName: entry.item.normalizedName,
          associationId: assocId,
          createdByUid: params.actor.uid,
          updatedAt: serverTimestamp(),
        });

        const nowIso = new Date().toISOString();
        created.push({
          id: assocId,
          code,
          nameAr: entry.item.cleanName,
          normalizedName: entry.item.normalizedName,
          governorateId: params.governorateId,
          centerId: params.centerId,
          villageId: '',
          managerName: '',
          managerPhone: '',
          sortOrder,
          isActive: true,
          active: true,
          createdByUid: params.actor.uid,
          createdByName: params.actor.displayName,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    });
  }

  const skippedCount = validItems.length - created.length + preview.duplicateCount + preview.invalidCount;
  const auditEntry =
    created.length > 0
      ? await writeAuditLogFs({
          actor: params.actor,
          action: 'BULK_CREATE_ASSOCIATIONS',
          entityType: 'agricultural_associations',
          entityId: params.governorateId,
          details: `إضافة جماعية لعدد ${created.length} جمعية في المحافظة ${params.governorateId}`,
          newValue: {
            count: created.length,
            names: created.slice(0, 15).map((a) => a.nameAr),
          },
        })
      : null;

  return { created, skippedCount, auditEntry };
}

export async function setAssociationActiveFs(
  assocId: string,
  nextActive: boolean,
  actor: UserProfile,
): Promise<{ auditEntry: AuditLogEntry }> {
  if (!hasGranularAccess(actor, 'canManageAssociations')) {
    throw new Error('ليس لديك صلاحية إدارة الجمعيات.');
  }
  const ref = doc(db, 'agricultural_associations', assocId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('الجمعية غير موجودة.');
  }
  const data = snap.data();
  if (!canAccessGovernorate(actor, String(data.governorateId || ''))) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }

  await updateDoc(ref, {
    isActive: nextActive,
    active: nextActive,
    updatedAt: serverTimestamp(),
  });

  const auditEntry = await writeAuditLogFs({
    actor,
    action: nextActive ? 'REACTIVATE_ASSOCIATION' : 'DEACTIVATE_ASSOCIATION',
    entityType: 'agricultural_associations',
    entityId: assocId,
    details: `${nextActive ? 'إعادة تفعيل' : 'تعطيل (حذف ناعم)'} جمعية ${data.nameAr}`,
    oldValue: { isActive: Boolean(data.isActive) },
    newValue: { isActive: nextActive },
  });

  return { auditEntry };
}

export async function reorderAssociationsFs(
  governorateId: string,
  orderedPairs: Array<{ id: string; sortOrder: number }>,
  actor: UserProfile,
): Promise<{ auditEntry: AuditLogEntry }> {
  if (!hasGranularAccess(actor, 'canManageAssociations')) {
    throw new Error('ليس لديك صلاحية إعادة ترتيب الجمعيات.');
  }
  if (!canAccessGovernorate(actor, governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  const ops = orderedPairs.map((pair) => (batch: ReturnType<typeof writeBatch>) => {
    batch.update(doc(db, 'agricultural_associations', pair.id), {
      sortOrder: pair.sortOrder,
      updatedAt: serverTimestamp(),
    });
  });
  await commitBatchedWrites(ops);

  const auditEntry = await writeAuditLogFs({
    actor,
    action: 'REORDER_ASSOCIATIONS',
    entityType: 'agricultural_associations',
    entityId: governorateId,
    details: `إعادة ترتيب ${orderedPairs.length} جمعية في ${governorateId}`,
    newValue: orderedPairs.slice(0, 20),
  });
  return { auditEntry };
}

export async function saveDisbursementsBatchFs(
  params: {
    governorateId: string;
    reportDate: string;
    rows: Array<{
      associationId: string;
      fertilizerCode: string;
      openingBalance: number | null;
      closingBalance: number | null;
      settlementQty: number | null;
      varianceReason?: string;
    }>;
    treatEmptyAsZero: boolean;
  },
  actor: UserProfile,
): Promise<{ report: DailyReport; rows: DailyDisbursementRow[]; auditEntry: AuditLogEntry }> {
  if (!hasGranularAccess(actor, 'canEdit')) {
    throw new Error('ليس لديك صلاحية تعديل أو حفظ كشوف الصرف.');
  }
  if (!canAccessGovernorate(actor, params.governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }

  for (const row of params.rows) {
    const calc = computeDisbursementRow(row, params.treatEmptyAsZero);
    if (calc.hasNegativeInput) {
      throw new Error('لا يُسمح بإدخال كميات سالبة في كشف الصرف.');
    }
    if (calc.hasVariance && !sanitizeExtractedText(row.varianceReason || '')) {
      throw new Error('يجب كتابة سبب الفرق لأي بند يحتوي على فرق تسوية غير صفري.');
    }
  }

  const reportId = `rep-${params.governorateId}-${params.reportDate}`;
  const reportRef = doc(db, 'daily_reports', reportId);
  const reportSnap = await getDoc(reportRef);
  if (reportSnap.exists() && reportSnap.data().status === 'approved' && actor.role !== 'admin') {
    throw new Error('هذا التقرير معتمد نهائيًا ولا يمكن تعديله.');
  }

  const nowIso = new Date().toISOString();
  const reportData: DailyReport = reportSnap.exists()
    ? {
        id: reportId,
        governorateId: String(reportSnap.data().governorateId),
        reportDate: String(reportSnap.data().reportDate),
        status: reportSnap.data().status as ReportStatus,
        createdByUid: String(reportSnap.data().createdByUid),
        createdByName: String(reportSnap.data().createdByName || actor.displayName),
        centralSyncStatus: (reportSnap.data().centralSyncStatus || 'pending') as DailyReport['centralSyncStatus'],
        createdAt: toIsoString(reportSnap.data().createdAt) || nowIso,
        updatedAt: nowIso,
      }
    : {
        id: reportId,
        governorateId: params.governorateId,
        reportDate: params.reportDate,
        status: 'draft',
        createdByUid: actor.uid,
        createdByName: actor.displayName,
        centralSyncStatus: 'pending',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

  const savedRows: DailyDisbursementRow[] = [];
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  if (!reportSnap.exists()) {
    ops.push((b) =>
      b.set(reportRef, {
        governorateId: params.governorateId,
        reportDate: params.reportDate,
        status: 'draft',
        createdByUid: actor.uid,
        createdByName: actor.displayName,
        centralSyncStatus: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  } else {
    ops.push((b) =>
      b.update(reportRef, {
        updatedAt: serverTimestamp(),
      }),
    );
  }

  const existingRowsSnap = await getDocs(
    query(
      collection(db, 'daily_disbursements'),
      where('governorateId', '==', params.governorateId),
      where('reportId', '==', reportId),
    ),
  );
  const existingRowCreator = new Map<string, string>();
  for (const d of existingRowsSnap.docs) {
    existingRowCreator.set(d.id, String(d.data().createdByUid || actor.uid));
  }

  for (const r of params.rows) {
    const calc = computeDisbursementRow(r, params.treatEmptyAsZero);
    const rowId = `disb-${reportId}-${r.associationId}-${r.fertilizerCode}`;
    const creatorUid = existingRowCreator.get(rowId) || actor.uid;
    const cleanReason = sanitizeExtractedText(r.varianceReason || '');

    const row: DailyDisbursementRow = {
      id: rowId,
      reportId,
      governorateId: params.governorateId,
      associationId: r.associationId,
      fertilizerCode: r.fertilizerCode,
      openingBalance: r.openingBalance === null ? null : Number(r.openingBalance),
      closingBalance: r.closingBalance === null ? null : Number(r.closingBalance),
      settlementQty: r.settlementQty === null ? null : Number(r.settlementQty),
      actualDisbursed: calc.actualDisbursed,
      variance: calc.variance,
      varianceReason: cleanReason,
      createdByUid: creatorUid,
      updatedAt: nowIso,
    };
    savedRows.push(row);

    const firestorePayload = {
      reportId,
      governorateId: params.governorateId,
      associationId: r.associationId,
      fertilizerCode: r.fertilizerCode,
      openingBalance: row.openingBalance,
      closingBalance: row.closingBalance,
      settlementQty: row.settlementQty,
      actualDisbursed: row.actualDisbursed,
      variance: row.variance,
      varianceReason: cleanReason,
      createdByUid: creatorUid,
      updatedAt: serverTimestamp(),
    };

    if (existingRowCreator.has(rowId)) {
      ops.push((b) => b.update(doc(db, 'daily_disbursements', rowId), firestorePayload));
    } else {
      ops.push((b) => b.set(doc(db, 'daily_disbursements', rowId), firestorePayload));
    }
  }

  try {
    await commitBatchedWrites(ops);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `daily_reports/${reportId}`);
  }

  const auditEntry = await writeAuditLogFs({
    actor,
    action: 'SAVE_DAILY_DISBURSEMENTS',
    entityType: 'daily_reports',
    entityId: reportId,
    details: `حفظ ${savedRows.length} سطر صرف ليوم ${params.reportDate}`,
    newValue: { count: savedRows.length, reportDate: params.reportDate },
  });

  return { report: reportData, rows: savedRows, auditEntry };
}

export async function clearDayRecordsFs(
  governorateId: string,
  reportDate: string,
  actor: UserProfile,
): Promise<DeletedDaySnapshot> {
  if (!hasGranularAccess(actor, 'canClearDay')) {
    throw new Error('ليس لديك صلاحية مسح سجل اليوم.');
  }
  if (!canAccessGovernorate(actor, governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  const reportId = `rep-${governorateId}-${reportDate}`;
  const reportRef = doc(db, 'daily_reports', reportId);
  const reportSnap = await getDoc(reportRef);

  const reportData: DailyReport | null = reportSnap.exists()
    ? {
        id: reportId,
        governorateId: String(reportSnap.data().governorateId),
        reportDate: String(reportSnap.data().reportDate),
        status: reportSnap.data().status as ReportStatus,
        createdByUid: String(reportSnap.data().createdByUid),
        createdByName: String(reportSnap.data().createdByName || ''),
        centralSyncStatus: (reportSnap.data().centralSyncStatus || 'pending') as DailyReport['centralSyncStatus'],
        createdAt: toIsoString(reportSnap.data().createdAt) || new Date().toISOString(),
        updatedAt: toIsoString(reportSnap.data().updatedAt) || new Date().toISOString(),
      }
    : null;

  if (reportData?.status === 'approved' && actor.role !== 'admin') {
    throw new Error('لا يمكن مسح سجل يوم معتمد نهائيًا إلا بواسطة مدير النظام.');
  }

  const rowsSnap = await getDocs(
    query(collection(db, 'daily_disbursements'), where('governorateId', '==', governorateId), where('reportId', '==', reportId)),
  );
  const rows: DailyDisbursementRow[] = rowsSnap.docs.map((d) => ({
    id: d.id,
    reportId: String(d.data().reportId || reportId),
    governorateId: String(d.data().governorateId || governorateId),
    associationId: String(d.data().associationId || ''),
    fertilizerCode: String(d.data().fertilizerCode || ''),
    openingBalance: d.data().openingBalance ?? null,
    closingBalance: d.data().closingBalance ?? null,
    settlementQty: d.data().settlementQty ?? null,
    actualDisbursed: d.data().actualDisbursed ?? null,
    variance: d.data().variance ?? null,
    varianceReason: String(d.data().varianceReason || ''),
    createdByUid: String(d.data().createdByUid || actor.uid),
    updatedAt: toIsoString(d.data().updatedAt) || new Date().toISOString(),
  }));

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  for (const d of rowsSnap.docs) {
    ops.push((b) => b.delete(d.ref));
  }
  if (reportSnap.exists()) {
    ops.push((b) => b.delete(reportRef));
  }
  await commitBatchedWrites(ops);

  await writeAuditLogFs({
    actor,
    action: 'CLEAR_DAY_RECORDS',
    entityType: 'daily_reports',
    entityId: reportId,
    details: `مسح سجل يوم ${reportDate} (${rows.length} بند)`,
    oldValue: { rowCount: rows.length, status: reportData?.status || null },
  });

  return { governorateId, reportDate, report: reportData, rows };
}

export async function restoreDayRecordsFs(
  snapshot: DeletedDaySnapshot,
  actor: UserProfile,
): Promise<void> {
  if (!hasGranularAccess(actor, 'canClearDay')) {
    throw new Error('ليس لديك صلاحية استرجاع سجل اليوم.');
  }
  if (!canAccessGovernorate(actor, snapshot.governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  const reportId = `rep-${snapshot.governorateId}-${snapshot.reportDate}`;
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
  if (snapshot.report) {
    ops.push((b) =>
      b.set(doc(db, 'daily_reports', reportId), {
        governorateId: snapshot.governorateId,
        reportDate: snapshot.reportDate,
        status: snapshot.report!.status === 'approved' ? 'approved' : 'draft',
        createdByUid: actor.uid,
        createdByName: snapshot.report!.createdByName || actor.displayName,
        centralSyncStatus: snapshot.report!.centralSyncStatus || 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  }
  for (const r of snapshot.rows) {
    ops.push((b) =>
      b.set(doc(db, 'daily_disbursements', r.id), {
        reportId: r.reportId || reportId,
        governorateId: snapshot.governorateId,
        associationId: r.associationId,
        fertilizerCode: r.fertilizerCode,
        openingBalance: r.openingBalance,
        closingBalance: r.closingBalance,
        settlementQty: r.settlementQty,
        actualDisbursed: r.actualDisbursed,
        variance: r.variance,
        varianceReason: r.varianceReason || '',
        createdByUid: actor.uid,
        updatedAt: serverTimestamp(),
      }),
    );
  }
  await commitBatchedWrites(ops);
  await writeAuditLogFs({
    actor,
    action: 'RESTORE_DAY_RECORDS',
    entityType: 'daily_reports',
    entityId: reportId,
    details: `التراجع واستعادة سجل يوم ${snapshot.reportDate}`,
  });
}

export async function fetchAnalyticsHistoryFs(params: {
  governorateId: string;
  endDate: string;
  days: number;
  actor: UserProfile;
}): Promise<{ reports: DailyReport[]; disbursements: DailyDisbursementRow[] }> {
  if (!canAccessGovernorate(params.actor, params.governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  const startDate = addDaysIso(params.endDate, -(Math.max(1, params.days) - 1));
  const [repsSnap, disbsSnap] = await Promise.all([
    getDocs(query(collection(db, 'daily_reports'), where('governorateId', '==', params.governorateId))),
    getDocs(query(collection(db, 'daily_disbursements'), where('governorateId', '==', params.governorateId))),
  ]);

  const reports: DailyReport[] = repsSnap.docs
    .map((d) => ({
      id: d.id,
      governorateId: String(d.data().governorateId),
      reportDate: String(d.data().reportDate),
      status: d.data().status as ReportStatus,
      createdByUid: String(d.data().createdByUid),
      createdByName: typeof d.data().createdByName === 'string' ? d.data().createdByName : '',
      centralSyncStatus: (d.data().centralSyncStatus || 'pending') as DailyReport['centralSyncStatus'],
      createdAt: toIsoString(d.data().createdAt) || new Date().toISOString(),
      updatedAt: toIsoString(d.data().updatedAt) || new Date().toISOString(),
    }))
    .filter((r) => r.reportDate >= startDate && r.reportDate <= params.endDate);

  const reportIds = new Set(reports.map((r) => r.id));
  const disbursements: DailyDisbursementRow[] = disbsSnap.docs
    .map((d) => ({
      id: d.id,
      reportId: String(d.data().reportId || ''),
      governorateId: String(d.data().governorateId || params.governorateId),
      associationId: String(d.data().associationId || ''),
      fertilizerCode: String(d.data().fertilizerCode || ''),
      openingBalance: d.data().openingBalance ?? null,
      closingBalance: d.data().closingBalance ?? null,
      settlementQty: d.data().settlementQty ?? null,
      actualDisbursed: d.data().actualDisbursed ?? null,
      variance: d.data().variance ?? null,
      varianceReason: String(d.data().varianceReason || ''),
      updatedAt: toIsoString(d.data().updatedAt) || new Date().toISOString(),
    }))
    .filter((d) => reportIds.has(d.reportId));

  return { reports, disbursements };
}

export async function createTractorFs(
  input: Omit<
    TractorDelivery,
    'id' | 'bagVariance' | 'inspectionStatus' | 'approvalState' | 'createdByUid' | 'createdAt'
  >,
  actor: UserProfile,
): Promise<{ tractor: TractorDelivery; auditEntry: AuditLogEntry }> {
  if (!hasGranularAccess(actor, 'canEdit')) {
    throw new Error('ليس لديك صلاحية تسجيل الجرارات.');
  }
  if (!canAccessGovernorate(actor, input.governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  const metrics = computeTractorMetrics(
    input.manifestBags,
    input.actualBags,
    !input.checklist.bagsDryAndIntact,
  );
  const id = makeDocId('trac');
  const nowIso = new Date().toISOString();
  const tractor: TractorDelivery = {
    ...input,
    id,
    tractorPlate: sanitizeExtractedText(input.tractorPlate),
    driverName: sanitizeExtractedText(input.driverName),
    driverPhone: sanitizeExtractedText(input.driverPhone),
    driverNationalId: sanitizeExtractedText(input.driverNationalId),
    manifestNumber: sanitizeExtractedText(input.manifestNumber),
    supplySource: sanitizeExtractedText(input.supplySource),
    notes: sanitizeExtractedText(input.notes),
    bagVariance: metrics.bagVariance,
    inspectionStatus: metrics.inspectionStatus,
    approvalState: 'pending',
    createdByUid: actor.uid,
    createdAt: nowIso,
  };

  await setDoc(
    doc(db, 'tractor_deliveries', id),
    stripUndefined({
      governorateId: tractor.governorateId,
      centerId: tractor.centerId || '',
      associationId: tractor.associationId,
      tractorPlate: tractor.tractorPlate,
      arrivalDate: tractor.arrivalDate,
      arrivalTime: tractor.arrivalTime || '',
      fertilizerCode: tractor.fertilizerCode,
      driverName: tractor.driverName,
      driverPhone: tractor.driverPhone,
      driverNationalId: tractor.driverNationalId,
      supplySource: tractor.supplySource,
      manifestNumber: tractor.manifestNumber,
      manifestBags: Math.round(tractor.manifestBags),
      actualBags: Math.round(tractor.actualBags),
      bagVariance: Math.round(tractor.bagVariance),
      inspectionStatus: tractor.inspectionStatus,
      approvalState: tractor.approvalState,
      checklist: tractor.checklist,
      notes: tractor.notes,
      createdByUid: actor.uid,
      createdAt: serverTimestamp(),
    }),
  );

  const auditEntry = await writeAuditLogFs({
    actor,
    action: 'CREATE_TRACTOR_DELIVERY',
    entityType: 'tractor_deliveries',
    entityId: id,
    details: `تسجيل جرار ${tractor.tractorPlate} ببوليصة ${tractor.manifestNumber}`,
  });

  return { tractor, auditEntry };
}

export async function approveTractorFs(
  tractorId: string,
  actor: UserProfile,
): Promise<{ tractor: TractorDelivery; auditEntry: AuditLogEntry }> {
  if (!hasPermission(actor.role, 'approve_tractor')) {
    throw new Error('ليس لديك صلاحية اعتماد استلام الجرارات.');
  }
  const ref = doc(db, 'tractor_deliveries', tractorId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('سجل الجرار غير موجود.');
  }
  const data = snap.data();
  if (!canAccessGovernorate(actor, String(data.governorateId || ''))) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  await updateDoc(ref, { approvalState: 'final_approved' });
  const updated: TractorDelivery = {
    ...(data as TractorDelivery),
    id: tractorId,
    approvalState: 'final_approved',
    createdAt: toIsoString(data.createdAt) || new Date().toISOString(),
  };
  const auditEntry = await writeAuditLogFs({
    actor,
    action: 'APPROVE_TRACTOR_DELIVERY',
    entityType: 'tractor_deliveries',
    entityId: tractorId,
    details: `اعتماد استلام الجرار ${data.tractorPlate}`,
    oldValue: { approvalState: data.approvalState },
    newValue: { approvalState: 'final_approved' },
  });
  return { tractor: updated, auditEntry };
}

export async function deleteTractorFs(
  tractorId: string,
  reason: string | undefined,
  actor: UserProfile,
): Promise<{ deletedId: string; auditEntry: AuditLogEntry }> {
  if (!actor.isActive || !hasPermission(actor.role, 'delete_tractor')) {
    throw new Error('ليس لديك صلاحية إزالة بيانات الجرار.');
  }

  const ref = doc(db, 'tractor_deliveries', tractorId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `tractor_deliveries/${tractorId}`);
  }

  if (!snap || !snap.exists()) {
    throw new Error('سجل الجرار غير موجود أو تم حذفه بالفعل.');
  }

  const data = snap.data();
  const governorateId = String(data.governorateId || '');
  const approvalState = (data.approvalState || 'pending') as TractorDelivery['approvalState'];

  if (!canAccessGovernorate(actor, governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  if (
    !canDeleteTractorDelivery(actor, {
      governorateId,
      approvalState,
    })
  ) {
    if (approvalState === 'final_approved' && actor.role !== 'admin') {
      throw new Error('لا يمكن حذف شحنة جرار معتمدة نهائيًا إلا بواسطة مدير النظام.');
    }
    throw new Error('ليس لديك صلاحية إزالة بيانات الجرار.');
  }

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `tractor_deliveries/${tractorId}`);
  }

  const cleanReason = sanitizeExtractedText(reason || '').slice(0, 300);
  const auditEntry = await writeAuditLogFs({
    actor,
    action: 'DELETE_TRACTOR_DELIVERY',
    entityType: 'tractor_deliveries',
    entityId: tractorId,
    details: `حذف بيانات الجرار ${String(data.tractorPlate || tractorId)} (بوليصة ${String(data.manifestNumber || '-')})${cleanReason ? ` · السبب: ${cleanReason}` : ''}`,
    oldValue: {
      tractorPlate: data.tractorPlate,
      manifestNumber: data.manifestNumber,
      governorateId,
      associationId: data.associationId,
      fertilizerCode: data.fertilizerCode,
      arrivalDate: data.arrivalDate,
      manifestBags: data.manifestBags,
      actualBags: data.actualBags,
      bagVariance: data.bagVariance,
      inspectionStatus: data.inspectionStatus,
      approvalState,
    },
    newValue: cleanReason ? { deleted: true, reason: cleanReason } : { deleted: true },
  });

  return { deletedId: tractorId, auditEntry };
}

export async function transitionReportStatusFs(
  params: { reportId: string; nextStatus: ReportStatus; notes?: string },
  actor: UserProfile,
  settings: SystemSettings,
  reportDisbursements: DailyDisbursementRow[],
): Promise<{
  report: DailyReport;
  approval: ApprovalRecord;
  integrationLog?: IntegrationLogEntry;
}> {
  const reportRef = doc(db, 'daily_reports', params.reportId);
  const snap = await getDoc(reportRef);
  if (!snap.exists()) {
    throw new Error('التقرير غير موجود. احفظ الكشف أولًا.');
  }
  const data = snap.data();
  const govId = String(data.governorateId || '');
  if (!canAccessGovernorate(actor, govId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  const currentStatus = data.status as ReportStatus;
  if (!canTransitionReportStatus(currentStatus, params.nextStatus, actor.role)) {
    throw new Error('هذا الانتقال غير مسموح به وفق دورك الوظيفي.');
  }
  const cleanNotes = sanitizeExtractedText(params.notes || '');
  if (params.nextStatus === 'rejected' && !cleanNotes) {
    throw new Error('يجب ذكر سبب الرفض عند رفض التقرير.');
  }

  const autoSync = params.nextStatus === 'approved' && settings.autoSyncOnApproval;
  const nowIso = new Date().toISOString();

  await updateDoc(reportRef, {
    status: params.nextStatus,
    rejectionReason: params.nextStatus === 'rejected' ? cleanNotes : '',
    centralSyncStatus: autoSync ? 'synced' : data.centralSyncStatus || 'pending',
    updatedAt: serverTimestamp(),
  });

  const actionMap: Record<ReportStatus, ApprovalRecord['action']> = {
    completed: 'submitted',
    under_review: 'reviewed',
    approved: 'approved',
    rejected: 'rejected',
    draft: 'reopened',
  };
  const approvalId = makeDocId('app');
  const approval: ApprovalRecord = {
    id: approvalId,
    reportId: params.reportId,
    governorateId: govId,
    reportDate: String(data.reportDate),
    action: actionMap[params.nextStatus],
    fromStatus: currentStatus,
    toStatus: params.nextStatus,
    actorUid: actor.uid,
    actorName: actor.displayName,
    actorRole: actor.role,
    notes: cleanNotes || 'تحديث مرحلة الاعتماد',
    createdAt: nowIso,
  };
  await setDoc(
    doc(db, 'approvals', approvalId),
    stripUndefined({
      ...approval,
      id: undefined,
      createdAt: serverTimestamp(),
    }),
  );

  let integrationLog: IntegrationLogEntry | undefined;
  if (autoSync) {
    const intId = makeDocId('int');
    const totalDisbursed = reportDisbursements.reduce((acc, r) => acc + (r.actualDisbursed || 0), 0);
    integrationLog = {
      id: intId,
      reportId: params.reportId,
      governorateId: govId,
      reportDate: String(data.reportDate),
      endpointUrl: settings.centralApiUrl,
      status: 'success',
      httpStatus: 200,
      payloadSummary: `${reportDisbursements.length} بند · إجمالي المنصرف ${totalDisbursed} شيكارة`,
      responseMessage: 'تم الإرسال التلقائي للمنظومة المركزية فور الاعتماد النهائي',
      dispatchedByUid: actor.uid,
      createdAt: nowIso,
    };
    await setDoc(
      doc(db, 'integration_logs', intId),
      stripUndefined({ ...integrationLog, id: undefined, createdAt: serverTimestamp() }),
    );
  }

  await writeAuditLogFs({
    actor,
    action: `REPORT_STATUS_${params.nextStatus.toUpperCase()}`,
    entityType: 'daily_reports',
    entityId: params.reportId,
    details: `تحويل التقرير ${params.reportId} إلى ${params.nextStatus}`,
    oldValue: { status: currentStatus },
    newValue: { status: params.nextStatus, notes: cleanNotes },
  });

  const updatedReport: DailyReport = {
    id: params.reportId,
    governorateId: govId,
    reportDate: String(data.reportDate),
    status: params.nextStatus,
    createdByUid: String(data.createdByUid),
    createdByName: String(data.createdByName || ''),
    rejectionReason: params.nextStatus === 'rejected' ? cleanNotes : '',
    centralSyncStatus: autoSync ? 'synced' : (data.centralSyncStatus as DailyReport['centralSyncStatus']),
    createdAt: toIsoString(data.createdAt) || nowIso,
    updatedAt: nowIso,
  };

  return { report: updatedReport, approval, integrationLog };
}

export async function syncReportCentralFs(
  reportId: string,
  actor: UserProfile,
  settings: SystemSettings,
  reportDisbursements: DailyDisbursementRow[],
): Promise<{ report: DailyReport; log: IntegrationLogEntry }> {
  if (actor.role !== 'chief' && actor.role !== 'admin') {
    throw new Error('صلاحية الإرسال للمنظومة المركزية مقصورة على رئيس القطاع أو مدير النظام.');
  }
  const reportRef = doc(db, 'daily_reports', reportId);
  const snap = await getDoc(reportRef);
  if (!snap.exists()) {
    throw new Error('التقرير غير موجود.');
  }
  const data = snap.data();
  if (data.status !== 'approved') {
    throw new Error('يجب اعتماد التقرير نهائيًا قبل الإرسال للمنظومة المركزية.');
  }
  const nowIso = new Date().toISOString();
  await updateDoc(reportRef, {
    centralSyncStatus: 'synced',
    updatedAt: serverTimestamp(),
  });

  const totalDisbursed = reportDisbursements.reduce((acc, r) => acc + (r.actualDisbursed || 0), 0);
  const intId = makeDocId('int');
  const log: IntegrationLogEntry = {
    id: intId,
    reportId,
    governorateId: String(data.governorateId),
    reportDate: String(data.reportDate),
    endpointUrl: settings.centralApiUrl,
    status: 'success',
    httpStatus: 200,
    payloadSummary: `${reportDisbursements.length} بند · إجمالي المنصرف ${totalDisbursed} شيكارة`,
    responseMessage: 'تم توثيق وإرسال التقرير بالمنظومة المركزية بنجاح',
    dispatchedByUid: actor.uid,
    createdAt: nowIso,
  };
  await setDoc(
    doc(db, 'integration_logs', intId),
    stripUndefined({ ...log, id: undefined, createdAt: serverTimestamp() }),
  );
  await writeAuditLogFs({
    actor,
    action: 'SYNC_CENTRAL_SYSTEM',
    entityType: 'integration_logs',
    entityId: intId,
    details: `إرسال التقرير ${reportId} إلى المنظومة المركزية`,
  });

  return {
    report: {
      id: reportId,
      governorateId: String(data.governorateId),
      reportDate: String(data.reportDate),
      status: 'approved',
      createdByUid: String(data.createdByUid),
      createdByName: String(data.createdByName || ''),
      centralSyncStatus: 'synced',
      createdAt: toIsoString(data.createdAt) || nowIso,
      updatedAt: nowIso,
    },
    log,
  };
}

export async function saveImageAttachmentFs(
  input: Omit<ImageAttachmentRecord, 'id' | 'analyzedByUid' | 'createdAt'>,
  actor: UserProfile,
): Promise<ImageAttachmentRecord> {
  if (!canAccessGovernorate(actor, input.governorateId)) {
    throw new Error('ليس لديك صلاحية على هذه المحافظة.');
  }
  const id = makeDocId('att');
  const nowIso = new Date().toISOString();
  await setDoc(
    doc(db, 'images_attachments', id),
    stripUndefined({
      governorateId: input.governorateId,
      associationId: input.associationId,
      associationName: sanitizeExtractedText(input.associationName),
      fertilizerCode: input.fertilizerCode,
      reportDate: input.reportDate,
      extractedClosingBalance: input.extractedClosingBalance,
      confidence: input.confidence,
      notes: sanitizeExtractedText(input.notes),
      rawResponseText: sanitizeExtractedText(
        `section=${input.sectionType};lastRecorded=${input.lastRecordedBalance};discrepancy=${input.discrepancy ?? ''}`,
      ).slice(0, 3900),
      analyzedByUid: actor.uid,
      createdAt: serverTimestamp(),
    }),
  );
  await writeAuditLogFs({
    actor,
    action: 'SAVE_ANALYZED_ATTACHMENT',
    entityType: 'images_attachments',
    entityId: id,
    details: `حفظ تحليل كشف ${input.associationName}`,
  });
  return { ...input, id, analyzedByUid: actor.uid, createdAt: nowIso };
}

export async function createOrUpdateUserOrInviteFs(
  input: {
    uid?: string;
    inviteId?: string;
    email: string;
    displayName: string;
    role: UserRole;
    governorateIds?: string[];
    permissions?: GranularPermissions;
    isActive?: boolean;
  },
  actor: UserProfile,
): Promise<{ user?: UserProfile; invite?: UserInvite }> {
  if (actor.role !== 'admin') {
    throw new Error('صلاحية إدارة المستخدمين مقصورة على مدير النظام فقط.');
  }
  const cleanEmail = sanitizeExtractedText(input.email).toLowerCase();
  const cleanName = sanitizeExtractedText(input.displayName);
  if (!cleanEmail || !cleanName) {
    throw new Error('البريد الإلكتروني والاسم مطلوبان.');
  }
  const govIds = Array.isArray(input.governorateIds) ? input.governorateIds : [];
  const perms = input.permissions || getDefaultGranularPermissions(input.role);
  const active = input.isActive !== false;
  const nowIso = new Date().toISOString();

  // Updating an already-signed-in active user document directly in `users/{uid}`
  if (input.uid) {
    const userRef = doc(db, 'users', input.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      throw new Error('مستند المستخدم غير موجود.');
    }
    const existing = normalizeUserDoc(snap.id, snap.data());
    await updateDoc(
      userRef,
      stripUndefined({
        displayName: cleanName,
        role: input.role,
        governorateId: govIds[0] || '',
        governorateIds: govIds,
        permissions: perms,
        isActive: active,
        updatedAt: serverTimestamp(),
      }),
    );
    await writeAuditLogFs({
      actor,
      action: 'UPDATE_USER',
      entityType: 'users',
      entityId: input.uid,
      details: `تحديث المستخدم ${cleanName} (${cleanEmail})`,
      oldValue: { role: existing.role, governorateIds: existing.governorateIds, isActive: existing.isActive },
      newValue: { role: input.role, governorateIds: govIds, isActive: active },
    });
    return {
      user: {
        ...existing,
        displayName: cleanName,
        role: input.role,
        governorateId: govIds[0] || '',
        governorateIds: govIds,
        permissions: perms,
        isActive: active,
        updatedAt: nowIso,
      },
    };
  }

  // Creating or updating an authorized pre-login invite in `user_invites/{inviteId}`
  const inviteId = input.inviteId || computeInviteId(cleanEmail);
  const inviteRef = doc(db, 'user_invites', inviteId);
  const existingInvSnap = await getDoc(inviteRef);
  const existingInv = existingInvSnap.exists() ? existingInvSnap.data() : null;

  await setDoc(
    inviteRef,
    stripUndefined({
      id: inviteId,
      email: cleanEmail,
      displayName: cleanName,
      role: input.role,
      governorateId: govIds[0] || '',
      governorateIds: govIds,
      permissions: perms,
      isActive: active,
      ...(existingInv?.claimedUid ? { claimedUid: existingInv.claimedUid } : {}),
      createdByUid: existingInv?.createdByUid || actor.uid,
      createdAt: existingInv?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );

  // If invite was already claimed by a uid, also sync users/{claimedUid}
  let syncedUser: UserProfile | undefined;
  if (existingInv?.claimedUid) {
    const claimedRef = doc(db, 'users', String(existingInv.claimedUid));
    const claimedSnap = await getDoc(claimedRef);
    if (claimedSnap.exists()) {
      await updateDoc(claimedRef, {
        displayName: cleanName,
        role: input.role,
        governorateId: govIds[0] || '',
        governorateIds: govIds,
        permissions: perms,
        isActive: active,
        updatedAt: serverTimestamp(),
      });
      syncedUser = {
        ...normalizeUserDoc(claimedSnap.id, claimedSnap.data()),
        displayName: cleanName,
        role: input.role,
        governorateId: govIds[0] || '',
        governorateIds: govIds,
        permissions: perms,
        isActive: active,
        updatedAt: nowIso,
      };
    }
  }

  await writeAuditLogFs({
    actor,
    action: existingInv ? 'UPDATE_USER_INVITE' : 'CREATE_USER_INVITE',
    entityType: 'user_invites',
    entityId: inviteId,
    details: `${existingInv ? 'تحديث تفويض' : 'إضافة تفويض دخول'} ${cleanName} (${cleanEmail}) بدور ${input.role}`,
    newValue: { email: cleanEmail, role: input.role, governorateIds: govIds, isActive: active },
  });

  return {
    user: syncedUser,
    invite: {
      id: inviteId,
      email: cleanEmail,
      displayName: cleanName,
      role: input.role,
      governorateIds: govIds,
      permissions: perms,
      isActive: active,
      ...(existingInv?.claimedUid ? { claimedUid: String(existingInv.claimedUid) } : {}),
      invitedByUid: String(existingInv?.createdByUid || actor.uid),
      createdAt: toIsoString(existingInv?.createdAt) || nowIso,
      updatedAt: nowIso,
    },
  };
}

export async function deleteUserOrInviteFs(
  params: { uid?: string; inviteId?: string },
  actor: UserProfile,
): Promise<void> {
  if (actor.role !== 'admin') {
    throw new Error('صلاحية حذف المستخدمين مقصورة على مدير النظام فقط.');
  }
  if (params.uid) {
    if (params.uid === actor.uid) {
      throw new Error('لا يمكنك حذف حسابك الشخصي أثناء تسجيل الدخول.');
    }
    await deleteDoc(doc(db, 'users', params.uid));
    await writeAuditLogFs({
      actor,
      action: 'DELETE_USER',
      entityType: 'users',
      entityId: params.uid,
      details: `حذف المستخدم ${params.uid}`,
    });
  }
  if (params.inviteId) {
    await deleteDoc(doc(db, 'user_invites', params.inviteId));
    await writeAuditLogFs({
      actor,
      action: 'DELETE_USER_INVITE',
      entityType: 'user_invites',
      entityId: params.inviteId,
      details: `إلغاء وحذف تفويض الدخول ${params.inviteId}`,
    });
  }
}

export async function updateSystemSettingsFs(
  input: Partial<SystemSettings>,
  current: SystemSettings,
  actor: UserProfile,
): Promise<SystemSettings> {
  const merged: SystemSettings = { ...current, ...input };
  const ref = doc(db, 'system_settings', 'global');
  if (actor.role === 'admin') {
    await setDoc(ref, sanitizeSystemSettingsForRule({ ...merged, seedVersion: SEED_VERSION }));
  } else if (hasGranularAccess(actor, 'canManageAssociations')) {
    await updateDoc(ref, {
      minThresholds: merged.minThresholds,
      assocMinThresholds: merged.assocMinThresholds || {},
    });
  } else {
    throw new Error('ليس لديك صلاحية تعديل إعدادات المنظومة.');
  }

  await writeAuditLogFs({
    actor,
    action: 'UPDATE_SYSTEM_SETTINGS',
    entityType: 'system_settings',
    entityId: 'global',
    details: 'تحديث إعدادات المنظومة والحدود الدنيا',
    oldValue: current.minThresholds,
    newValue: merged.minThresholds,
  });
  return merged;
}

export async function restoreBackupSnapshotFs(
  payload: {
    associations?: AgriculturalAssociation[];
    reports?: DailyReport[];
    disbursements?: DailyDisbursementRow[];
    tractors?: TractorDelivery[];
    settings?: Partial<SystemSettings>;
  },
  currentSettings: SystemSettings,
  actor: UserProfile,
): Promise<void> {
  if (actor.role !== 'admin') {
    throw new Error('صلاحية استعادة النسخة الاحتياطية مقصورة على مدير النظام فقط.');
  }
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  if (payload.associations) {
    payload.associations.forEach((a, idx) => {
      const cleanName = sanitizeExtractedText(a.nameAr).slice(0, MAX_ASSOCIATION_NAME_LENGTH);
      const norm = normalizeArabicName(cleanName);
      if (!cleanName || !norm || !a.governorateId || !a.centerId) return;
      const lockId = computeAssociationLockId(a.governorateId, norm);
      ops.push((b) =>
        b.set(
          doc(db, 'agricultural_associations', a.id),
          stripUndefined({
            code: sanitizeExtractedText(a.code) || 'DST',
            nameAr: cleanName,
            normalizedName: norm,
            governorateId: a.governorateId,
            centerId: a.centerId,
            villageId: a.villageId || '',
            managerName: sanitizeExtractedText(a.managerName || ''),
            managerPhone: sanitizeExtractedText(a.managerPhone || ''),
            notes: sanitizeExtractedText(a.notes || ''),
            sortOrder: typeof a.sortOrder === 'number' ? a.sortOrder : idx + 1,
            isActive: a.isActive !== false,
            active: a.isActive !== false,
            createdByUid: actor.uid,
            updatedAt: serverTimestamp(),
          }),
        ),
      );
      ops.push((b) =>
        b.set(doc(db, 'association_name_locks', lockId), {
          governorateId: a.governorateId,
          normalizedName: norm,
          associationId: a.id,
          createdByUid: actor.uid,
          updatedAt: serverTimestamp(),
        }),
      );
    });
  }

  if (payload.reports) {
    for (const r of payload.reports) {
      ops.push((b) =>
        b.set(doc(db, 'daily_reports', r.id), {
          governorateId: r.governorateId,
          reportDate: r.reportDate,
          status: r.status || 'draft',
          createdByUid: actor.uid,
          createdByName: r.createdByName || actor.displayName,
          centralSyncStatus: r.centralSyncStatus || 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
      );
    }
  }

  if (payload.disbursements) {
    for (const d of payload.disbursements) {
      const govId = d.governorateId || d.reportId.split('-').slice(1, -3).join('-') || 'gov-ismailia';
      ops.push((b) =>
        b.set(doc(db, 'daily_disbursements', d.id), {
          reportId: d.reportId,
          governorateId: govId,
          associationId: d.associationId,
          fertilizerCode: d.fertilizerCode,
          openingBalance: d.openingBalance,
          closingBalance: d.closingBalance,
          settlementQty: d.settlementQty,
          actualDisbursed: d.actualDisbursed,
          variance: d.variance,
          varianceReason: sanitizeExtractedText(d.varianceReason || ''),
          createdByUid: actor.uid,
          updatedAt: serverTimestamp(),
        }),
      );
    }
  }

  if (payload.settings) {
    ops.push((b) =>
      b.set(
        doc(db, 'system_settings', 'global'),
        sanitizeSystemSettingsForRule({ ...currentSettings, ...payload.settings, seedVersion: SEED_VERSION }),
      ),
    );
  }

  await commitBatchedWrites(ops);
  await writeAuditLogFs({
    actor,
    action: 'RESTORE_JSON_BACKUP',
    entityType: 'system',
    entityId: 'backup',
    details: 'استعادة نسخة احتياطية JSON إلى Firestore',
  });
}

export async function processOfflineBatchFs(
  operations: OfflineQueueItem[],
  actor: UserProfile,
  currentSettings: SystemSettings,
  currentAssociations: AgriculturalAssociation[],
): Promise<{ processedIds: string[]; errors: Array<{ id: string; error: string }> }> {
  const processedIds: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const op of operations) {
    try {
      if (op.operationType === 'save_disbursements') {
        const p = op.payload as {
          governorateId: string;
          reportDate: string;
          rows: Array<{
            associationId: string;
            fertilizerCode: string;
            openingBalance: number | null;
            closingBalance: number | null;
            settlementQty: number | null;
            varianceReason?: string;
          }>;
        };
        await saveDisbursementsBatchFs(
          { ...p, treatEmptyAsZero: currentSettings.treatEmptyAsZero },
          actor,
        );
      } else if (op.operationType === 'save_association') {
        const p = op.payload as Omit<AgriculturalAssociation, 'id' | 'normalizedName'> & { id?: string };
        await saveAssociationFs(p, actor, currentAssociations.length + 1);
      } else if (op.operationType === 'create_tractor') {
        const p = op.payload as Omit<
          TractorDelivery,
          'id' | 'bagVariance' | 'inspectionStatus' | 'approvalState' | 'createdByUid' | 'createdAt'
        >;
        await createTractorFs(p, actor);
      } else if (op.operationType === 'approve_tractor') {
        const p = op.payload as { tractorId: string };
        await approveTractorFs(p.tractorId, actor);
      } else if (op.operationType === 'delete_tractor') {
        const p = op.payload as { tractorId: string; reason?: string };
        await deleteTractorFs(p.tractorId, p.reason, actor);
      } else if (op.operationType === 'submit_report_status') {
        const p = op.payload as { reportId: string; nextStatus: ReportStatus; notes?: string };
        await transitionReportStatusFs(p, actor, currentSettings, []);
      }
      processedIds.push(op.id);
    } catch (err) {
      errors.push({
        id: op.id,
        error: err instanceof Error ? err.message : 'فشلت مزامنة العملية',
      });
    }
  }

  return { processedIds, errors };
}
