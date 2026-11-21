import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  createSeedApprovals,
  createSeedAuditLogs,
  createSeedIntegrationLogs,
  createSeedReportsAndDisbursements,
  createSeedTractors,
  getTodayDateIso,
  SEED_ASSOCIATIONS,
  SEED_CENTERS,
  SEED_FERTILIZER_TYPES,
  SEED_GOVERNORATES,
  SEED_IMAGE_ATTACHMENTS,
  SEED_ROLES,
  SEED_SYSTEM_SETTINGS,
  SEED_VILLAGES,
} from '../data/seedData.ts';
import {
  addBulkAssociationsFs,
  approveTractorFs,
  cleanupLegacyPasswordHashesFs,
  clearDayRecordsFs,
  countAssociationLinkedRecordsFs,
  createOrUpdateUserOrInviteFs,
  createTractorFs,
  deleteAssociationPermanentlyFs,
  deleteImageAttachmentAdminFs,
  deleteIntegrationLogAdminFs,
  deleteTractorFs,
  deleteUserOrInviteFs,
  fetchAnalyticsHistoryFs,
  fetchBootstrapDataFs,
  processOfflineBatchFs,
  reorderAssociationsFs,
  restoreBackupSnapshotFs,
  restoreDayRecordsFs,
  saveAssociationFs,
  saveDisbursementsBatchFs,
  saveImageAttachmentFs,
  setAssociationActiveFs,
  transitionReportStatusFs,
  updateImageAttachmentAdminFs,
  updateIntegrationLogAdminFs,
  updateSystemSettingsFs,
  updateTractorAdminFs,
  type AssociationLinkedRecordCounts,
} from '../lib/firestoreRepo.ts';
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
  ManifestOcrExtractedData,
  OfflineQueueItem,
  ReportStatus,
  RoleDefinition,
  SheetOcrExtractedRow,
  SheetSectionType,
  SystemSettings,
  TractorDelivery,
  UserInvite,
  UserProfile,
  UserRole,
} from '../types/domain.ts';
import { addDaysIso } from '../utils/analytics.ts';
import {
  MAX_ASSOCIATION_NAME_LENGTH,
  normalizeArabicName,
  previewBulkAssociationLines,
  sanitizeExtractedText,
  sortAssociationsByOrder,
} from '../utils/arabicNormalize.ts';
import { computeDisbursementRow, computeTractorMetrics } from '../utils/calculations.ts';
import {
  enqueueOfflineOperation,
  getOfflineQueue,
  loadCachedSnapshot,
  removeOfflineQueueItem,
  saveCachedSnapshot,
  saveSessionState,
} from '../utils/offlineDb.ts';
import {
  canAccessGovernorate,
  canDeleteTractorDelivery,
  canTransitionReportStatus,
  getDefaultGranularPermissions,
  hasGranularAccess,
  hasPermission,
} from '../utils/rbac.ts';
import { IS_PREVIEW_MODE_ENABLED, PREVIEW_USERS, useAuth } from './AuthContext.tsx';
import type { ToastMessage } from '../components/ToastContainer.tsx';
import { useOnlineStatus } from '../components/PwaControls.tsx';

export class OcrClientError extends Error {
  code?: string;
  rawResponseText?: string;

  constructor(message: string, code?: string, rawResponseText?: string) {
    super(message);
    this.name = 'OcrClientError';
    this.code = code;
    this.rawResponseText = rawResponseText;
  }
}

interface AppDataState {
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
}

interface AppDataContextValue extends AppDataState {
  loadingData: boolean;
  offlineQueue: OfflineQueueItem[];
  isSyncing: boolean;
  toasts: ToastMessage[];
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  syncNow: () => Promise<void>;
  refreshData: () => Promise<void>;
  saveAssociation: (
    input: Omit<AgriculturalAssociation, 'id' | 'normalizedName'> & { id?: string },
  ) => Promise<void>;
  addBulkAssociations: (params: {
    governorateId: string;
    centerId: string;
    rawText: string;
  }) => Promise<{ createdCount: number; skippedCount: number }>;
  deactivateAssociation: (id: string) => Promise<void>;
  reactivateAssociation: (id: string) => Promise<void>;
  countAssociationLinkedRecords: (
    associationId: string,
    governorateId: string,
  ) => Promise<AssociationLinkedRecordCounts>;
  deleteAssociationPermanently: (associationId: string) => Promise<AssociationLinkedRecordCounts>;
  reorderAssociations: (governorateId: string, orderedIds: string[]) => Promise<void>;
  saveDisbursementsBatch: (params: {
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
  }) => Promise<void>;
  clearDayRecords: (governorateId: string, reportDate: string) => Promise<DeletedDaySnapshot>;
  restoreDayRecords: (snapshot: DeletedDaySnapshot) => Promise<void>;
  fetchAnalyticsHistory: (params: {
    governorateId: string;
    endDate: string;
    days: number;
  }) => Promise<{ reports: DailyReport[]; disbursements: DailyDisbursementRow[] }>;
  createTractor: (
    input: Omit<
      TractorDelivery,
      'id' | 'bagVariance' | 'inspectionStatus' | 'approvalState' | 'createdByUid' | 'createdAt'
    >,
  ) => Promise<void>;
  approveTractor: (tractorId: string) => Promise<void>;
  updateTractorAdmin: (
    tractorId: string,
    patch: Partial<
      Pick<
        TractorDelivery,
        | 'tractorPlate'
        | 'manifestNumber'
        | 'arrivalDate'
        | 'arrivalTime'
        | 'fertilizerCode'
        | 'driverName'
        | 'driverPhone'
        | 'driverNationalId'
        | 'supplySource'
        | 'manifestBags'
        | 'actualBags'
        | 'approvalState'
        | 'notes'
        | 'checklist'
      >
    >,
  ) => Promise<void>;
  deleteTractor: (tractorId: string, reason?: string) => Promise<void>;
  transitionReportStatus: (
    reportId: string,
    nextStatus: ReportStatus,
    notes?: string,
  ) => Promise<void>;
  syncReportCentral: (reportId: string) => Promise<void>;
  updateIntegrationLogAdmin: (
    logId: string,
    patch: { status?: 'success' | 'failed'; httpStatus?: number; responseMessage?: string },
  ) => Promise<void>;
  deleteIntegrationLogAdmin: (logId: string) => Promise<void>;
  extractSheetNumbers: (params: {
    imageBase64: string;
    mimeType: string;
    sectionType: SheetSectionType;
    governorateId: string;
  }) => Promise<{ rows: SheetOcrExtractedRow[]; summaryNote: string; rawResponseText: string }>;
  analyzeSingleSheet: (params: {
    imageBase64: string;
    mimeType: string;
    associationId: string;
    associationName: string;
    fertilizerCode: string;
    fertilizerNameAr: string;
    lastRecordedBalance: number;
  }) => Promise<{
    extractedOpeningBalance: number | null;
    extractedClosingBalance: number | null;
    extractedSettlement: number | null;
    confidence: number;
    notes: string;
    rawResponseText: string;
  }>;
  saveAnalyzedAttachment: (
    input: Omit<ImageAttachmentRecord, 'id' | 'analyzedByUid' | 'createdAt'>,
  ) => Promise<void>;
  updateAttachmentAdmin: (
    attachmentId: string,
    patch: { extractedClosingBalance?: number | null; notes?: string; reportDate?: string },
  ) => Promise<void>;
  deleteAttachmentAdmin: (attachmentId: string) => Promise<void>;
  extractManifest: (params: {
    imageBase64: string;
    mimeType: string;
  }) => Promise<ManifestOcrExtractedData>;
  createOrUpdateUser: (input: {
    uid?: string;
    inviteId?: string;
    email: string;
    displayName: string;
    role: UserRole;
    governorateIds?: string[];
    permissions?: GranularPermissions;
    isActive?: boolean;
  }) => Promise<void>;
  deleteUser: (uidOrInviteId: string, kind?: 'user' | 'invite') => Promise<void>;
  updateUserRole: (
    uid: string,
    role: UserRole,
    isActive: boolean,
    extra?: {
      governorateIds?: string[];
      permissions?: GranularPermissions;
      displayName?: string;
      inviteId?: string;
      email?: string;
    },
  ) => Promise<void>;
  cleanupLegacyPasswordHashes: () => Promise<{ scanned: number; cleaned: number }>;
  updateSettings: (input: Partial<SystemSettings>) => Promise<void>;
  exportBackupJson: () => string;
  restoreBackupJson: (rawJson: string) => Promise<void>;
  addAuditEntryLocal: (
    action: string,
    entityType: string,
    entityId: string,
    details: string,
    diff?: { oldValue?: unknown; newValue?: unknown },
  ) => void;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

const PREVIEW_CACHE_KEY = 'dst-preview-state-v4';
const APP_CACHE_KEY = 'dst-app-state-v4';

function buildInitialSeedState(_currentUser?: UserProfile | null): AppDataState {
  const today = getTodayDateIso();
  const { reports, disbursements } = createSeedReportsAndDisbursements(today);
  const seededAssocs = SEED_ASSOCIATIONS.map((a, idx) => ({
    ...a,
    sortOrder: typeof a.sortOrder === 'number' ? a.sortOrder : idx + 1,
    active: a.isActive,
  }));
  return {
    roles: SEED_ROLES,
    fertilizerTypes: SEED_FERTILIZER_TYPES,
    governorates: SEED_GOVERNORATES,
    centers: SEED_CENTERS,
    villages: SEED_VILLAGES,
    associations: seededAssocs,
    reports,
    disbursements,
    tractors: createSeedTractors(today),
    approvals: createSeedApprovals(today),
    integrationLogs: createSeedIntegrationLogs(today),
    attachments: SEED_IMAGE_ATTACHMENTS,
    settings: SEED_SYSTEM_SETTINGS,
    notifications: [],
    auditLogs: createSeedAuditLogs(today),
    users: IS_PREVIEW_MODE_ENABLED ? Object.values(PREVIEW_USERS) : [],
    invites: [],
  };
}

export const AppDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, authMode, getIdToken, syncPreviewProfile } = useAuth();
  const isOnline = useOnlineStatus();
  const [state, setState] = useState<AppDataState>(() => buildInitialSeedState(profile));
  const [loadingData, setLoadingData] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('dst-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('dst-theme', theme);
    } catch {
      // Ignore storage error
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const persistLocalSnapshot = useCallback(async (nextState: AppDataState) => {
    await saveCachedSnapshot(APP_CACHE_KEY, nextState);
  }, []);

  const apiFetch = useCallback(
    async <T,>(url: string, options?: RequestInit): Promise<T> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error('يجب تسجيل الدخول بحساب Google المعتمد لإجراء هذا الطلب مع خدمة الذكاء الاصطناعي.');
      }
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(options?.headers || {}),
        },
      });
      const json = (await res.json().catch(() => ({}))) as T & {
        error?: string;
        code?: string;
        rawResponseText?: string;
      };
      if (!res.ok) {
        if (json.rawResponseText !== undefined || json.code) {
          throw new OcrClientError(
            json.error || `خطأ في الخادم (${res.status})`,
            json.code,
            json.rawResponseText,
          );
        }
        throw new Error(json.error || `خطأ في الخادم (${res.status})`);
      }
      return json;
    },
    [getIdToken],
  );

  const refreshData = useCallback(async () => {
    const queue = await getOfflineQueue();
    setOfflineQueue(queue);

    if (authMode === 'unauthenticated' || !profile) return;

    if (authMode === 'preview') {
      const cached = await loadCachedSnapshot<AppDataState>(PREVIEW_CACHE_KEY);
      if (cached) {
        const merged: AppDataState = {
          ...cached,
          associations: sortAssociationsByOrder(cached.associations || SEED_ASSOCIATIONS),
          invites: cached.invites || [],
          settings: { ...SEED_SYSTEM_SETTINGS, ...(cached.settings || {}) },
          roles: cached.roles?.length >= SEED_ROLES.length ? cached.roles : SEED_ROLES,
          governorates:
            cached.governorates?.length >= SEED_GOVERNORATES.length
              ? cached.governorates
              : SEED_GOVERNORATES,
        };
        setState(merged);
        await saveSessionState('localPreviewUsers', merged.users);
      } else {
        const seeded = buildInitialSeedState(profile);
        setState(seeded);
        await saveCachedSnapshot(PREVIEW_CACHE_KEY, seeded);
        await saveSessionState('localPreviewUsers', seeded.users);
      }
      return;
    }

    setLoadingData(true);
    try {
      if (!isOnline) {
        const cached = await loadCachedSnapshot<AppDataState>(APP_CACHE_KEY);
        if (cached) setState(cached);
        return;
      }
      const data = await fetchBootstrapDataFs(profile);
      setState(data);
      await persistLocalSnapshot(data);
    } catch (error: unknown) {
      const cached = await loadCachedSnapshot<AppDataState>(APP_CACHE_KEY);
      if (cached) {
        setState(cached);
      }
      pushToast({
        type: 'warning',
        title: 'استخدام النسخة المخزنة محليًا',
        description: error instanceof Error ? error.message : 'تعذر تحميل البيانات من Firestore',
      });
    } finally {
      setLoadingData(false);
    }
  }, [authMode, isOnline, persistLocalSnapshot, profile, pushToast]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const syncNow = useCallback(async () => {
    const queue = await getOfflineQueue();
    setOfflineQueue(queue);
    if (queue.length === 0 || !isOnline || authMode !== 'firebase' || !profile) return;

    setIsSyncing(true);
    try {
      const result = await processOfflineBatchFs(
        queue,
        profile,
        state.settings,
        state.associations,
      );

      for (const id of result.processedIds) {
        await removeOfflineQueueItem(id);
      }
      const remaining = await getOfflineQueue();
      setOfflineQueue(remaining);

      if (result.skippedWarnings.length > 0) {
        pushToast({
          type: 'warning',
          title: 'تم تخطي بنود مرتبطة بجمعيات محذوفة نهائيًا',
          description: result.skippedWarnings.slice(0, 2).join(' · '),
        });
      }
      if (result.processedIds.length > 0) {
        pushToast({
          type: 'success',
          title: 'اكتملت المزامنة السحابية',
          description: `تمت مزامنة ${result.processedIds.length} عملية إلى Firestore بنجاح.`,
        });
        await refreshData();
      }
      if (result.errors.length > 0) {
        pushToast({
          type: 'error',
          title: 'تعذرت مزامنة بعض العمليات',
          description: result.errors[0].error,
        });
      }
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذرت المزامنة',
        description: error instanceof Error ? error.message : 'حدث خطأ أثناء المزامنة.',
      });
    } finally {
      setIsSyncing(false);
    }
  }, [authMode, isOnline, profile, pushToast, refreshData, state.associations, state.settings]);

  useEffect(() => {
    if (isOnline && offlineQueue.length > 0 && authMode === 'firebase' && profile) {
      void syncNow();
    }
  }, [authMode, isOnline, offlineQueue.length, profile, syncNow]);

  const commitState = useCallback(
    async (updater: (prev: AppDataState) => AppDataState) => {
      setState((prev) => {
        const next = updater(prev);
        const key = authMode === 'preview' ? PREVIEW_CACHE_KEY : APP_CACHE_KEY;
        void saveCachedSnapshot(key, next);
        if (authMode === 'preview') {
          void saveSessionState('localPreviewUsers', next.users);
        }
        return next;
      });
    },
    [authMode],
  );

  const addAuditEntryLocal = useCallback(
    (
      action: string,
      entityType: string,
      entityId: string,
      details: string,
      diff?: { oldValue?: unknown; newValue?: unknown },
    ) => {
      if (!profile) return;
      const serializeVal = (v: unknown) =>
        v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v);
      const entry: AuditLogEntry = {
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        actorUid: profile.uid,
        actorEmail: profile.email,
        actorName: profile.displayName,
        actorRole: profile.role,
        action,
        entityType,
        entityId,
        details: sanitizeExtractedText(details),
        ...(diff?.oldValue !== undefined ? { oldValue: serializeVal(diff.oldValue) } : {}),
        ...(diff?.newValue !== undefined ? { newValue: serializeVal(diff.newValue) } : {}),
        createdAt: new Date().toISOString(),
      };
      void commitState((prev) => ({
        ...prev,
        auditLogs: [entry, ...prev.auditLogs],
      }));
    },
    [commitState, profile],
  );

  const saveAssociation = async (
    input: Omit<AgriculturalAssociation, 'id' | 'normalizedName'> & { id?: string },
  ) => {
    if (!hasGranularAccess(profile, 'canManageAssociations')) {
      throw new Error('ليس لديك صلاحية إدارة الجمعيات.');
    }
    if (!canAccessGovernorate(profile, input.governorateId)) {
      throw new Error('ليس لديك صلاحية على هذه المحافظة.');
    }
    const cleanName = sanitizeExtractedText(input.nameAr);
    if (!cleanName || !input.governorateId || !input.centerId) {
      throw new Error('يُرجى إدخال اسم الجمعية وتحديد المحافظة ونقطة التوزيع.');
    }
    if (cleanName.length > MAX_ASSOCIATION_NAME_LENGTH) {
      throw new Error(`اسم الجمعية يجب ألا يتجاوز ${MAX_ASSOCIATION_NAME_LENGTH} حرفًا.`);
    }

    const norm = normalizeArabicName(cleanName);
    const assocId = input.id || `assoc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const duplicate = state.associations.find(
      (a) =>
        a.governorateId === input.governorateId &&
        a.id !== assocId &&
        normalizeArabicName(a.nameAr) === norm,
    );
    if (duplicate) {
      throw new Error(
        duplicate.isActive === false
          ? `توجد جمعية موقوفة بنفس الاسم («${duplicate.nameAr}») في هذه المحافظة؛ يمكنك إعادة تفعيلها من زر إظهار الموقوفة.`
          : `توجد جمعية مسجلة بالفعل بنفس الاسم («${cleanName}») في هذه المحافظة.`,
      );
    }

    const govMaxOrder = state.associations
      .filter((a) => a.governorateId === input.governorateId)
      .reduce((m, a) => Math.max(m, a.sortOrder || 0), 0);

    if (authMode === 'firebase' && profile) {
      if (!isOnline) {
        await enqueueOfflineOperation('save_association', input as unknown as Record<string, unknown>);
        setOfflineQueue(await getOfflineQueue());
      } else {
        const { association: saved, auditEntry } = await saveAssociationFs(
          input,
          profile,
          govMaxOrder + 1,
        );
        await commitState((prev) => ({
          ...prev,
          associations: sortAssociationsByOrder(
            prev.associations.some((a) => a.id === saved.id)
              ? prev.associations.map((a) => (a.id === saved.id ? saved : a))
              : [...prev.associations, saved],
          ),
          auditLogs: [auditEntry, ...prev.auditLogs],
        }));
        pushToast({ type: 'success', title: input.id ? 'تم تعديل الجمعية' : 'تمت إضافة الجمعية' });
        return;
      }
    }

    const existing = state.associations.find((a) => a.id === assocId);
    const autoCode =
      sanitizeExtractedText(input.code) ||
      `DST-${input.governorateId.replace('gov-', '').slice(0, 4).toUpperCase()}-${String(govMaxOrder + 1).padStart(3, '0')}`;
    const cleanNotes = sanitizeExtractedText(input.notes || '');
    const nowIso = new Date().toISOString();
    const assoc: AgriculturalAssociation = {
      id: assocId,
      code: autoCode,
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
      sortOrder:
        typeof input.sortOrder === 'number'
          ? input.sortOrder
          : existing?.sortOrder ?? govMaxOrder + 1,
      isActive: input.isActive !== false,
      active: input.isActive !== false,
      createdByUid: existing?.createdByUid || profile?.uid || 'local',
      createdByName: existing?.createdByName || profile?.displayName || 'مستخدم النظام',
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    await commitState((prev) => ({
      ...prev,
      associations: sortAssociationsByOrder(
        prev.associations.some((a) => a.id === assoc.id)
          ? prev.associations.map((a) => (a.id === assoc.id ? assoc : a))
          : [...prev.associations, assoc],
      ),
    }));
    addAuditEntryLocal(
      input.id ? 'UPDATE_ASSOCIATION' : 'CREATE_ASSOCIATION',
      'agricultural_associations',
      assoc.id,
      `${input.id ? 'تعديل' : 'إضافة'} جمعية ${assoc.nameAr}`,
      {
        oldValue: existing
          ? { nameAr: existing.nameAr, code: existing.code, notes: existing.notes || '' }
          : undefined,
        newValue: { nameAr: assoc.nameAr, code: assoc.code, notes: assoc.notes || '' },
      },
    );
    pushToast({
      type: !isOnline && authMode === 'firebase' ? 'warning' : 'success',
      title:
        !isOnline && authMode === 'firebase'
          ? 'تم الحفظ محليًا بانتظار المزامنة'
          : input.id
            ? 'تم تعديل الجمعية'
            : 'تمت إضافة الجمعية',
    });
  };

  const addBulkAssociations = async (params: {
    governorateId: string;
    centerId: string;
    rawText: string;
  }): Promise<{ createdCount: number; skippedCount: number }> => {
    if (!hasGranularAccess(profile, 'canManageAssociations')) {
      throw new Error('ليس لديك صلاحية إدارة الجمعيات.');
    }
    if (!canAccessGovernorate(profile, params.governorateId)) {
      throw new Error('ليس لديك صلاحية على هذه المحافظة.');
    }
    const existingGovAssocs = state.associations.filter(
      (a) => a.governorateId === params.governorateId,
    );
    const startSortOrder = existingGovAssocs.reduce((m, a) => Math.max(m, a.sortOrder || 0), 0);

    if (authMode === 'firebase' && profile && isOnline) {
      const res = await addBulkAssociationsFs({
        ...params,
        existingGovAssocs,
        startSortOrder,
        actor: profile,
      });
      if (res.created.length > 0) {
        await commitState((prev) => ({
          ...prev,
          associations: sortAssociationsByOrder([...prev.associations, ...res.created]),
          auditLogs: res.auditEntry ? [res.auditEntry, ...prev.auditLogs] : prev.auditLogs,
        }));
      }
      pushToast({
        type: res.created.length > 0 ? 'success' : 'warning',
        title: `تمت إضافة ${res.created.length} جمعية جديدة`,
        description: res.skippedCount > 0 ? `تم استبعاد ${res.skippedCount} بند مكرر أو غير صالح.` : undefined,
      });
      return { createdCount: res.created.length, skippedCount: res.skippedCount };
    }

    const preview = previewBulkAssociationLines(params.rawText, existingGovAssocs);
    const valid = preview.items.filter((i) => i.status === 'valid_new');
    const govShort = params.governorateId.replace('gov-', '').slice(0, 4).toUpperCase();
    const nowIso = new Date().toISOString();
    const created: AgriculturalAssociation[] = valid.map((item, idx) => ({
      id: `assoc-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
      code: `DST-${govShort}-${String(startSortOrder + idx + 1).padStart(3, '0')}`,
      nameAr: item.cleanName,
      normalizedName: item.normalizedName,
      governorateId: params.governorateId,
      centerId: params.centerId,
      villageId: '',
      managerName: '',
      managerPhone: '',
      sortOrder: startSortOrder + idx + 1,
      isActive: true,
      active: true,
      createdByUid: profile?.uid || 'local',
      createdByName: profile?.displayName || 'مستخدم النظام',
      createdAt: nowIso,
      updatedAt: nowIso,
    }));

    if (created.length > 0) {
      await commitState((prev) => ({
        ...prev,
        associations: sortAssociationsByOrder([...prev.associations, ...created]),
      }));
      addAuditEntryLocal(
        'BULK_CREATE_ASSOCIATIONS',
        'agricultural_associations',
        params.governorateId,
        `إضافة جماعية لعدد ${created.length} جمعية في ${params.governorateId}`,
        { newValue: created.map((c) => c.nameAr) },
      );
    }

    const skippedCount = preview.duplicateCount + preview.invalidCount;
    pushToast({
      type: created.length > 0 ? 'success' : 'warning',
      title: `تمت إضافة ${created.length} جمعية جديدة`,
      description: skippedCount > 0 ? `تم استبعاد ${skippedCount} بند مكرر أو غير صالح.` : undefined,
    });
    return { createdCount: created.length, skippedCount };
  };

  const deactivateAssociation = async (id: string) => {
    if (!hasGranularAccess(profile, 'canManageAssociations')) {
      throw new Error('ليس لديك صلاحية تعطيل الجمعيات.');
    }
    const target = state.associations.find((a) => a.id === id);
    if (authMode === 'firebase' && profile && isOnline) {
      const { auditEntry } = await setAssociationActiveFs(id, false, profile);
      await commitState((prev) => ({
        ...prev,
        associations: prev.associations.map((a) =>
          a.id === id ? { ...a, isActive: false, active: false } : a,
        ),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({ type: 'info', title: `تم إيقاف جمعية «${target?.nameAr || ''}»` });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      associations: prev.associations.map((a) =>
        a.id === id ? { ...a, isActive: false, active: false } : a,
      ),
    }));
    addAuditEntryLocal(
      'DEACTIVATE_ASSOCIATION',
      'agricultural_associations',
      id,
      `إيقاف (حذف ناعم) جمعية ${target?.nameAr || id}`,
      { oldValue: { isActive: true }, newValue: { isActive: false } },
    );
    pushToast({ type: 'info', title: 'تم إيقاف الجمعية بنجاح (مع الاحتفاظ بالسجلات التاريخية)' });
  };

  const reactivateAssociation = async (id: string) => {
    if (!hasGranularAccess(profile, 'canManageAssociations')) {
      throw new Error('ليس لديك صلاحية إعادة تفعيل الجمعيات.');
    }
    const target = state.associations.find((a) => a.id === id);
    if (authMode === 'firebase' && profile && isOnline) {
      const { auditEntry } = await setAssociationActiveFs(id, true, profile);
      await commitState((prev) => ({
        ...prev,
        associations: prev.associations.map((a) =>
          a.id === id ? { ...a, isActive: true, active: true } : a,
        ),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({ type: 'success', title: `تمت إعادة تفعيل جمعية «${target?.nameAr || ''}»` });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      associations: prev.associations.map((a) =>
        a.id === id ? { ...a, isActive: true, active: true } : a,
      ),
    }));
    addAuditEntryLocal(
      'REACTIVATE_ASSOCIATION',
      'agricultural_associations',
      id,
      `إعادة تفعيل جمعية ${target?.nameAr || id}`,
      { oldValue: { isActive: false }, newValue: { isActive: true } },
    );
    pushToast({ type: 'success', title: 'تمت إعادة تفعيل الجمعية بنجاح' });
  };

  const countAssociationLinkedRecords = async (
    associationId: string,
    governorateId: string,
  ): Promise<AssociationLinkedRecordCounts> => {
    if (profile?.role !== 'admin') {
      throw new Error('صلاحية الحذف النهائي للجمعيات مقصورة على مدير النظام فقط.');
    }
    if (authMode === 'firebase' && profile) {
      if (!isOnline) {
        throw new Error('الحذف النهائي للجمعيات يتطلب اتصالًا بالإنترنت.');
      }
      return countAssociationLinkedRecordsFs(associationId, governorateId, profile);
    }
    const disbursements = state.disbursements.filter((d) => d.associationId === associationId).length;
    const tractors = state.tractors.filter((t) => t.associationId === associationId).length;
    const attachments = state.attachments.filter((a) => a.associationId === associationId).length;
    return {
      disbursements,
      tractors,
      attachments,
      total: disbursements + tractors + attachments,
    };
  };

  const deleteAssociationPermanently = async (
    associationId: string,
  ): Promise<AssociationLinkedRecordCounts> => {
    if (profile?.role !== 'admin') {
      throw new Error('صلاحية الحذف النهائي للجمعيات مقصورة على مدير النظام فقط.');
    }
    const target = state.associations.find((a) => a.id === associationId);
    if (!target) {
      throw new Error('الجمعية غير موجودة أو تم حذفها بالفعل.');
    }
    if (authMode === 'firebase' && profile) {
      if (!isOnline) {
        throw new Error('الحذف النهائي للجمعيات يعمل أونلاين فقط ولا يمكن تنفيذه دون اتصال.');
      }
      const { deletedCounts, auditEntry } = await deleteAssociationPermanentlyFs(target, profile);
      await commitState((prev) => ({
        ...prev,
        associations: prev.associations.filter((a) => a.id !== associationId),
        disbursements: prev.disbursements.filter((d) => d.associationId !== associationId),
        tractors: prev.tractors.filter((t) => t.associationId !== associationId),
        attachments: prev.attachments.filter((att) => att.associationId !== associationId),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({
        type: 'success',
        title: `تم الحذف النهائي لجمعية «${target.nameAr}»`,
        description:
          deletedCounts.total > 0
            ? `تم مسح ${deletedCounts.disbursements} بند صرف، ${deletedCounts.tractors} جرار، و${deletedCounts.attachments} مرفق.`
            : 'لم تكن هناك سجلات مرتبطة بالجمعية.',
      });
      return deletedCounts;
    }

    const deletedCounts: AssociationLinkedRecordCounts = {
      disbursements: state.disbursements.filter((d) => d.associationId === associationId).length,
      tractors: state.tractors.filter((t) => t.associationId === associationId).length,
      attachments: state.attachments.filter((a) => a.associationId === associationId).length,
      total: 0,
    };
    deletedCounts.total =
      deletedCounts.disbursements + deletedCounts.tractors + deletedCounts.attachments;

    await commitState((prev) => ({
      ...prev,
      associations: prev.associations.filter((a) => a.id !== associationId),
      disbursements: prev.disbursements.filter((d) => d.associationId !== associationId),
      tractors: prev.tractors.filter((t) => t.associationId !== associationId),
      attachments: prev.attachments.filter((att) => att.associationId !== associationId),
    }));
    addAuditEntryLocal(
      'DELETE_ASSOCIATION_PERMANENT',
      'agricultural_associations',
      associationId,
      `حذف نهائي للجمعية «${target.nameAr}» (${target.code}) مع ${deletedCounts.total} سجل مرتبط`,
      {
        oldValue: {
          id: target.id,
          code: target.code,
          nameAr: target.nameAr,
          governorateId: target.governorateId,
          centerId: target.centerId,
          isActive: target.isActive,
        },
        newValue: { deleted: true, deletedCounts },
      },
    );
    pushToast({
      type: 'success',
      title: `تم الحذف النهائي لجمعية «${target.nameAr}»`,
      description:
        deletedCounts.total > 0
          ? `تم مسح ${deletedCounts.disbursements} بند صرف، ${deletedCounts.tractors} جرار، و${deletedCounts.attachments} مرفق.`
          : 'لم تكن هناك سجلات مرتبطة بالجمعية.',
    });
    return deletedCounts;
  };

  const reorderAssociations = async (governorateId: string, orderedIds: string[]) => {
    if (!hasGranularAccess(profile, 'canManageAssociations')) {
      throw new Error('ليس لديك صلاحية إعادة ترتيب الجمعيات.');
    }
    if (!canAccessGovernorate(profile, governorateId)) {
      throw new Error('ليس لديك صلاحية على هذه المحافظة.');
    }
    const orderMap = new Map(orderedIds.map((id, idx) => [id, idx + 1]));
    const pairs = orderedIds.map((id, idx) => ({ id, sortOrder: idx + 1 }));

    if (authMode === 'firebase' && profile && isOnline) {
      const { auditEntry } = await reorderAssociationsFs(governorateId, pairs, profile);
      await commitState((prev) => ({
        ...prev,
        associations: sortAssociationsByOrder(
          prev.associations.map((a) =>
            orderMap.has(a.id) ? { ...a, sortOrder: orderMap.get(a.id)! } : a,
          ),
        ),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({ type: 'success', title: 'تم حفظ ترتيب الجمعيات' });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      associations: sortAssociationsByOrder(
        prev.associations.map((a) =>
          orderMap.has(a.id) ? { ...a, sortOrder: orderMap.get(a.id)! } : a,
        ),
      ),
    }));
    addAuditEntryLocal(
      'REORDER_ASSOCIATIONS',
      'agricultural_associations',
      governorateId,
      `إعادة ترتيب ${orderedIds.length} جمعية في ${governorateId}`,
    );
    pushToast({ type: 'success', title: 'تم حفظ ترتيب الجمعيات' });
  };

  const saveDisbursementsBatch = async (params: {
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
  }) => {
    if (!hasGranularAccess(profile, 'canEdit')) {
      throw new Error('ليس لديك صلاحية تعديل أو حفظ كشوف الصرف.');
    }
    if (!canAccessGovernorate(profile, params.governorateId)) {
      throw new Error('ليس لديك صلاحية على هذه المحافظة.');
    }

    for (const row of params.rows) {
      const calc = computeDisbursementRow(row, state.settings.treatEmptyAsZero);
      if (calc.hasNegativeInput) {
        throw new Error('لا يُسمح بإدخال كميات سالبة في كشف الصرف.');
      }
    }

    if (authMode === 'firebase' && profile) {
      if (!isOnline) {
        await enqueueOfflineOperation('save_disbursements', params as unknown as Record<string, unknown>);
        setOfflineQueue(await getOfflineQueue());
      } else {
        const res = await saveDisbursementsBatchFs(
          { ...params, treatEmptyAsZero: state.settings.treatEmptyAsZero },
          profile,
        );
        await commitState((prev) => {
          const map = new Map(prev.disbursements.map((d) => [d.id, d]));
          for (const r of res.rows) map.set(r.id, r);
          const reports = prev.reports.some((rep) => rep.id === res.report.id)
            ? prev.reports.map((rep) => (rep.id === res.report.id ? res.report : rep))
            : [res.report, ...prev.reports];
          return {
            ...prev,
            reports,
            disbursements: Array.from(map.values()),
            auditLogs: [res.auditEntry, ...prev.auditLogs],
          };
        });
        pushToast({ type: 'success', title: 'تم حفظ كشف الصرف اليومي' });
        return;
      }
    }

    const reportId = `rep-${params.governorateId}-${params.reportDate}`;
    const now = new Date().toISOString();
    await commitState((prev) => {
      const existingReport = prev.reports.find((r) => r.id === reportId);
      const report: DailyReport = existingReport
        ? { ...existingReport, updatedAt: now }
        : {
            id: reportId,
            governorateId: params.governorateId,
            reportDate: params.reportDate,
            status: 'draft',
            createdByUid: profile?.uid || 'local',
            createdByName: profile?.displayName || 'مستخدم المنظومة',
            centralSyncStatus: 'pending',
            createdAt: now,
            updatedAt: now,
          };

      const map = new Map(prev.disbursements.map((d) => [d.id, d]));
      for (const r of params.rows) {
        const calc = computeDisbursementRow(r, prev.settings.treatEmptyAsZero);
        const existingLocal = prev.disbursements.find(
          (d) =>
            d.reportId === reportId &&
            d.associationId === r.associationId &&
            d.fertilizerCode === r.fertilizerCode,
        );
        const rowId = existingLocal
          ? existingLocal.id
          : `${reportId}_${r.associationId}_${r.fertilizerCode}`;
        map.set(rowId, {
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
          varianceReason: sanitizeExtractedText(r.varianceReason || ''),
          updatedAt: now,
        });
      }

      return {
        ...prev,
        reports: existingReport
          ? prev.reports.map((rep) => (rep.id === reportId ? report : rep))
          : [report, ...prev.reports],
        disbursements: Array.from(map.values()),
      };
    });
    addAuditEntryLocal('SAVE_DAILY_DISBURSEMENTS', 'daily_reports', reportId, 'حفظ بيانات كشف الصرف اليومي');
    pushToast({
      type: !isOnline && authMode === 'firebase' ? 'warning' : 'success',
      title: !isOnline && authMode === 'firebase' ? 'تم الحفظ محليًا بانتظار المزامنة' : 'تم حفظ كشف الصرف اليومي',
    });
  };

  const clearDayRecords = async (
    governorateId: string,
    reportDate: string,
  ): Promise<DeletedDaySnapshot> => {
    if (!hasGranularAccess(profile, 'canClearDay')) {
      throw new Error('ليس لديك صلاحية مسح سجل اليوم.');
    }
    if (!canAccessGovernorate(profile, governorateId)) {
      throw new Error('ليس لديك صلاحية على هذه المحافظة.');
    }

    if (authMode === 'firebase' && profile && isOnline) {
      const snapshot = await clearDayRecordsFs(governorateId, reportDate, profile);
      const reportId = `rep-${governorateId}-${reportDate}`;
      await commitState((prev) => ({
        ...prev,
        reports: prev.reports.filter((r) => r.id !== reportId),
        disbursements: prev.disbursements.filter((d) => d.reportId !== reportId),
      }));
      return snapshot;
    }

    const reportId = `rep-${governorateId}-${reportDate}`;
    const existingReport = state.reports.find((r) => r.id === reportId) || null;
    if (existingReport?.status === 'approved' && profile?.role !== 'admin') {
      throw new Error('لا يمكن مسح سجل يوم معتمد نهائيًا إلا بواسطة مدير النظام.');
    }
    const existingRows = state.disbursements.filter((d) => d.reportId === reportId);
    const snapshot: DeletedDaySnapshot = {
      governorateId,
      reportDate,
      report: existingReport,
      rows: existingRows,
    };

    await commitState((prev) => ({
      ...prev,
      reports: prev.reports.filter((r) => r.id !== reportId),
      disbursements: prev.disbursements.filter((d) => d.reportId !== reportId),
    }));
    addAuditEntryLocal('CLEAR_DAY_RECORDS', 'daily_reports', reportId, `مسح سجل يوم ${reportDate}`);
    return snapshot;
  };

  const restoreDayRecords = async (snapshot: DeletedDaySnapshot) => {
    if (!hasGranularAccess(profile, 'canClearDay')) {
      throw new Error('ليس لديك صلاحية استرجاع سجل اليوم.');
    }

    if (authMode === 'firebase' && profile && isOnline) {
      await restoreDayRecordsFs(snapshot, profile);
    }

    await commitState((prev) => {
      const reportId = `rep-${snapshot.governorateId}-${snapshot.reportDate}`;
      const nextReports = snapshot.report
        ? [snapshot.report, ...prev.reports.filter((r) => r.id !== reportId)]
        : prev.reports;
      const map = new Map(prev.disbursements.map((d) => [d.id, d]));
      for (const row of snapshot.rows) map.set(row.id, row);
      return {
        ...prev,
        reports: nextReports,
        disbursements: Array.from(map.values()),
      };
    });

    addAuditEntryLocal(
      'RESTORE_DAY_RECORDS',
      'daily_reports',
      `rep-${snapshot.governorateId}-${snapshot.reportDate}`,
      `التراجع واستعادة سجل يوم ${snapshot.reportDate}`,
    );
    pushToast({ type: 'success', title: 'تم التراجع واستعادة بيانات اليوم' });
  };

  const fetchAnalyticsHistory = async (params: {
    governorateId: string;
    endDate: string;
    days: number;
  }) => {
    if (authMode === 'firebase' && profile && isOnline) {
      return fetchAnalyticsHistoryFs({ ...params, actor: profile });
    }

    const startDate = addDaysIso(params.endDate, -(Math.max(1, params.days) - 1));
    const filteredReports = state.reports.filter(
      (r) =>
        r.governorateId === params.governorateId &&
        r.reportDate >= startDate &&
        r.reportDate <= params.endDate,
    );
    const ids = new Set(filteredReports.map((r) => r.id));
    return {
      reports: filteredReports,
      disbursements: state.disbursements.filter((d) => ids.has(d.reportId)),
    };
  };

  const createTractor = async (
    input: Omit<
      TractorDelivery,
      'id' | 'bagVariance' | 'inspectionStatus' | 'approvalState' | 'createdByUid' | 'createdAt'
    >,
  ) => {
    if (!canAccessGovernorate(profile, input.governorateId)) {
      throw new Error('ليس لديك صلاحية على هذه المحافظة.');
    }
    if (state.settings.requireDriverNationalId && !sanitizeExtractedText(input.driverNationalId)) {
      throw new Error('الرقم القومي للسائق إلزامي وفق إعدادات المنظومة.');
    }
    if (input.manifestBags < 0 || input.actualBags < 0) {
      throw new Error('أعداد الشكاير يجب أن تكون موجبة أو صفر.');
    }

    if (authMode === 'firebase' && profile) {
      if (!isOnline) {
        await enqueueOfflineOperation('create_tractor', input as unknown as Record<string, unknown>);
        setOfflineQueue(await getOfflineQueue());
      } else {
        const { tractor, auditEntry } = await createTractorFs(input, profile);
        await commitState((prev) => ({
          ...prev,
          tractors: [tractor, ...prev.tractors],
          auditLogs: [auditEntry, ...prev.auditLogs],
        }));
        pushToast({ type: 'success', title: 'تم تسجيل الجرار والبوليصة' });
        return;
      }
    }

    const metrics = computeTractorMetrics(
      input.manifestBags,
      input.actualBags,
      !input.checklist.bagsDryAndIntact,
    );
    const created: TractorDelivery = {
      ...input,
      id: `trac-${Date.now()}`,
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
      createdByUid: profile?.uid || 'local',
      createdAt: new Date().toISOString(),
    };
    await commitState((prev) => ({
      ...prev,
      tractors: [created, ...prev.tractors],
    }));
    addAuditEntryLocal(
      'CREATE_TRACTOR_DELIVERY',
      'tractor_deliveries',
      created.id,
      `تسجيل جرار ${created.tractorPlate} ببوليصة ${created.manifestNumber}`,
    );
    pushToast({ type: 'success', title: 'تم تسجيل الجرار والبوليصة' });
  };

  const approveTractor = async (tractorId: string) => {
    if (authMode === 'firebase' && profile) {
      if (!isOnline) {
        await enqueueOfflineOperation('approve_tractor', { tractorId });
        setOfflineQueue(await getOfflineQueue());
      } else {
        const { tractor, auditEntry } = await approveTractorFs(tractorId, profile);
        await commitState((prev) => ({
          ...prev,
          tractors: prev.tractors.map((t) => (t.id === tractorId ? tractor : t)),
          auditLogs: [auditEntry, ...prev.auditLogs],
        }));
        pushToast({ type: 'success', title: 'تم اعتماد استلام الجرار' });
        return;
      }
    }

    const target = state.tractors.find((t) => t.id === tractorId);
    if (!target || target.approvalState === 'final_approved') return;

    await commitState((prev) => ({
      ...prev,
      tractors: prev.tractors.map((t) =>
        t.id === tractorId ? { ...t, approvalState: 'final_approved' } : t,
      ),
    }));

    addAuditEntryLocal(
      'APPROVE_TRACTOR_DELIVERY',
      'tractor_deliveries',
      tractorId,
      `اعتماد استلام الجرار ${target.tractorPlate} (${target.actualBags} شيكارة)`,
    );
    pushToast({ type: 'success', title: 'تم اعتماد استلام الجرار بنجاح' });
  };

  const updateTractorAdmin = async (
    tractorId: string,
    patch: Partial<
      Pick<
        TractorDelivery,
        | 'tractorPlate'
        | 'manifestNumber'
        | 'arrivalDate'
        | 'arrivalTime'
        | 'fertilizerCode'
        | 'driverName'
        | 'driverPhone'
        | 'driverNationalId'
        | 'supplySource'
        | 'manifestBags'
        | 'actualBags'
        | 'approvalState'
        | 'notes'
        | 'checklist'
      >
    >,
  ) => {
    if (profile?.role !== 'admin') {
      throw new Error('صلاحية تعديل سجلات الجرارات مقصورة على مدير النظام فقط.');
    }
    const target = state.tractors.find((t) => t.id === tractorId);
    if (!target) {
      throw new Error('سجل الجرار غير موجود.');
    }
    if (authMode === 'firebase' && profile) {
      if (!isOnline) {
        throw new Error('تعديل سجلات الجرارات بواسطة المدير يتطلب اتصالًا بالإنترنت.');
      }
      const { tractor, auditEntry } = await updateTractorAdminFs(tractorId, patch, profile);
      await commitState((prev) => ({
        ...prev,
        tractors: prev.tractors.map((t) => (t.id === tractorId ? tractor : t)),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({ type: 'success', title: 'تم حفظ تعديلات سجل الجرار' });
      return;
    }

    const nextManifestBags = Math.max(0, Math.round(patch.manifestBags ?? target.manifestBags));
    const nextActualBags = Math.max(0, Math.round(patch.actualBags ?? target.actualBags));
    const nextChecklist = patch.checklist ?? target.checklist;
    const metrics = computeTractorMetrics(
      nextManifestBags,
      nextActualBags,
      !nextChecklist.bagsDryAndIntact,
    );
    const updated: TractorDelivery = {
      ...target,
      ...patch,
      tractorPlate: sanitizeExtractedText(patch.tractorPlate ?? target.tractorPlate),
      manifestNumber: sanitizeExtractedText(patch.manifestNumber ?? target.manifestNumber),
      driverName: sanitizeExtractedText(patch.driverName ?? target.driverName),
      driverPhone: sanitizeExtractedText(patch.driverPhone ?? target.driverPhone),
      driverNationalId: sanitizeExtractedText(patch.driverNationalId ?? target.driverNationalId),
      supplySource: sanitizeExtractedText(patch.supplySource ?? target.supplySource),
      notes: sanitizeExtractedText(patch.notes ?? target.notes),
      manifestBags: nextManifestBags,
      actualBags: nextActualBags,
      bagVariance: Math.round(metrics.bagVariance),
      inspectionStatus: metrics.inspectionStatus,
      checklist: nextChecklist,
    };

    await commitState((prev) => ({
      ...prev,
      tractors: prev.tractors.map((t) => (t.id === tractorId ? updated : t)),
    }));
    addAuditEntryLocal(
      'ADMIN_UPDATE_TRACTOR',
      'tractor_deliveries',
      tractorId,
      `تعديل سجل الجرار ${updated.tractorPlate} بواسطة مدير النظام`,
      {
        oldValue: {
          tractorPlate: target.tractorPlate,
          manifestNumber: target.manifestNumber,
          manifestBags: target.manifestBags,
          actualBags: target.actualBags,
          approvalState: target.approvalState,
        },
        newValue: {
          tractorPlate: updated.tractorPlate,
          manifestNumber: updated.manifestNumber,
          manifestBags: updated.manifestBags,
          actualBags: updated.actualBags,
          approvalState: updated.approvalState,
        },
      },
    );
    pushToast({ type: 'success', title: 'تم حفظ تعديلات سجل الجرار' });
  };

  const deleteTractor = async (tractorId: string, reason?: string) => {
    const target = state.tractors.find((t) => t.id === tractorId);
    if (!target) {
      throw new Error('سجل الجرار غير موجود.');
    }
    if (!profile || !profile.isActive || !hasPermission(profile.role, 'delete_tractor')) {
      throw new Error('ليس لديك صلاحية إزالة بيانات الجرار.');
    }
    if (!canAccessGovernorate(profile, target.governorateId)) {
      throw new Error('ليس لديك صلاحية على هذه المحافظة.');
    }
    if (!canDeleteTractorDelivery(profile, target)) {
      if (target.approvalState === 'final_approved' && profile.role !== 'admin') {
        throw new Error('لا يمكن حذف شحنة جرار معتمدة نهائيًا إلا بواسطة مدير النظام.');
      }
      throw new Error('ليس لديك صلاحية إزالة بيانات الجرار.');
    }

    const cleanReason = sanitizeExtractedText(reason || '').slice(0, 300);
    const oldSnapshot = {
      tractorPlate: target.tractorPlate,
      manifestNumber: target.manifestNumber,
      governorateId: target.governorateId,
      associationId: target.associationId,
      fertilizerCode: target.fertilizerCode,
      arrivalDate: target.arrivalDate,
      manifestBags: target.manifestBags,
      actualBags: target.actualBags,
      bagVariance: target.bagVariance,
      inspectionStatus: target.inspectionStatus,
      approvalState: target.approvalState,
    };

    if (authMode === 'firebase' && profile) {
      if (!isOnline) {
        await enqueueOfflineOperation('delete_tractor', {
          tractorId,
          ...(cleanReason ? { reason: cleanReason } : {}),
        });
        setOfflineQueue(await getOfflineQueue());
        await commitState((prev) => ({
          ...prev,
          tractors: prev.tractors.filter((t) => t.id !== tractorId),
        }));
        addAuditEntryLocal(
          'DELETE_TRACTOR_DELIVERY',
          'tractor_deliveries',
          tractorId,
          `حذف بيانات الجرار ${target.tractorPlate} (بوليصة ${target.manifestNumber})${cleanReason ? ` · السبب: ${cleanReason}` : ''}`,
          {
            oldValue: oldSnapshot,
            newValue: cleanReason ? { deleted: true, reason: cleanReason } : { deleted: true },
          },
        );
        pushToast({
          type: 'warning',
          title: 'تم حذف السجل محليًا بانتظار المزامنة',
          description: 'سيتم تنفيذ الحذف السحابي وتوثيقه تلقائيًا عند عودة الاتصال.',
        });
        return;
      }

      const { auditEntry } = await deleteTractorFs(tractorId, cleanReason, profile);
      await commitState((prev) => ({
        ...prev,
        tractors: prev.tractors.filter((t) => t.id !== tractorId),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({ type: 'success', title: 'تم حذف بيانات الجرار نهائيًا' });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      tractors: prev.tractors.filter((t) => t.id !== tractorId),
    }));
    addAuditEntryLocal(
      'DELETE_TRACTOR_DELIVERY',
      'tractor_deliveries',
      tractorId,
      `حذف بيانات الجرار ${target.tractorPlate} (بوليصة ${target.manifestNumber})${cleanReason ? ` · السبب: ${cleanReason}` : ''}`,
      {
        oldValue: oldSnapshot,
        newValue: cleanReason ? { deleted: true, reason: cleanReason } : { deleted: true },
      },
    );
    pushToast({ type: 'success', title: 'تم حذف بيانات الجرار نهائيًا' });
  };

  const syncReportCentral = async (reportId: string) => {
    const target = state.reports.find((r) => r.id === reportId);
    if (!target || target.status !== 'approved') {
      throw new Error('يجب اعتماد التقرير نهائيًا قبل إرساله للنظام المركزي.');
    }
    const cleanUrl = (state.settings.centralApiUrl || '').trim();
    if (!cleanUrl) {
      throw new Error('رابط واجهة التكامل المركزية غير مُعدّ في إعدادات المنظومة.');
    }
    if (authMode !== 'firebase' || !profile) {
      throw new Error(
        'الإرسال المركزي الحقيقي يتطلب تسجيل الدخول بحساب Google المعتمد وإعداد رابط HTTPS مركزي.',
      );
    }

    const token = await getIdToken();
    if (!token) {
      throw new Error('تعذر الحصول على رمز التحقق للمستخدم. أعد تسجيل الدخول بحساب Google.');
    }

    const res = await fetch('/api/central/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reportId }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      centralSyncStatus?: 'synced' | 'failed';
      log?: IntegrationLogEntry;
    };

    if (json.log || json.centralSyncStatus) {
      const nowIso = new Date().toISOString();
      await commitState((prev) => ({
        ...prev,
        reports: prev.reports.map((r) =>
          r.id === reportId
            ? {
                ...r,
                centralSyncStatus: json.centralSyncStatus || r.centralSyncStatus,
                updatedAt: nowIso,
              }
            : r,
        ),
        integrationLogs: json.log ? [json.log, ...prev.integrationLogs] : prev.integrationLogs,
      }));
    }

    if (!res.ok || !json.ok || json.centralSyncStatus !== 'synced') {
      throw new Error(json.error || `فشل الإرسال إلى الخادم المركزي (${res.status}).`);
    }

    pushToast({ type: 'success', title: 'تم الإرسال للمنظومة المركزية بنجاح' });
  };

  const updateIntegrationLogAdmin = async (
    logId: string,
    patch: { status?: 'success' | 'failed'; httpStatus?: number; responseMessage?: string },
  ) => {
    if (profile?.role !== 'admin') {
      throw new Error('صلاحية تعديل سجلات التكامل مقصورة على مدير النظام فقط.');
    }
    const target = state.integrationLogs.find((l) => l.id === logId);
    if (!target) throw new Error('سجل التكامل غير موجود.');

    if (authMode === 'firebase' && profile) {
      if (!isOnline) throw new Error('تعديل سجلات التكامل يتطلب اتصالًا بالإنترنت.');
      const { auditEntry } = await updateIntegrationLogAdminFs(logId, patch, profile);
      await commitState((prev) => ({
        ...prev,
        integrationLogs: prev.integrationLogs.map((l) =>
          l.id === logId
            ? {
                ...l,
                status: patch.status ?? l.status,
                httpStatus: patch.httpStatus !== undefined ? Math.round(patch.httpStatus) : l.httpStatus,
                responseMessage:
                  patch.responseMessage !== undefined
                    ? sanitizeExtractedText(patch.responseMessage).slice(0, 400)
                    : l.responseMessage,
              }
            : l,
        ),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({ type: 'success', title: 'تم تعديل سجل التكامل' });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      integrationLogs: prev.integrationLogs.map((l) =>
        l.id === logId
          ? {
              ...l,
              status: patch.status ?? l.status,
              httpStatus: patch.httpStatus !== undefined ? Math.round(patch.httpStatus) : l.httpStatus,
              responseMessage:
                patch.responseMessage !== undefined
                  ? sanitizeExtractedText(patch.responseMessage).slice(0, 400)
                  : l.responseMessage,
            }
          : l,
      ),
    }));
    addAuditEntryLocal(
      'ADMIN_UPDATE_INTEGRATION_LOG',
      'integration_logs',
      logId,
      `تعديل سجل التكامل للتقرير ${target.reportId}`,
      {
        oldValue: {
          status: target.status,
          httpStatus: target.httpStatus,
          responseMessage: target.responseMessage,
        },
        newValue: patch,
      },
    );
    pushToast({ type: 'success', title: 'تم تعديل سجل التكامل' });
  };

  const deleteIntegrationLogAdmin = async (logId: string) => {
    if (profile?.role !== 'admin') {
      throw new Error('صلاحية حذف سجلات التكامل مقصورة على مدير النظام فقط.');
    }
    const target = state.integrationLogs.find((l) => l.id === logId);
    if (!target) throw new Error('سجل التكامل غير موجود.');

    if (authMode === 'firebase' && profile) {
      if (!isOnline) throw new Error('حذف سجلات التكامل يتطلب اتصالًا بالإنترنت.');
      const { auditEntry } = await deleteIntegrationLogAdminFs(logId, profile);
      await commitState((prev) => ({
        ...prev,
        integrationLogs: prev.integrationLogs.filter((l) => l.id !== logId),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({ type: 'info', title: 'تم حذف سجل التكامل' });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      integrationLogs: prev.integrationLogs.filter((l) => l.id !== logId),
    }));
    addAuditEntryLocal(
      'ADMIN_DELETE_INTEGRATION_LOG',
      'integration_logs',
      logId,
      `حذف سجل التكامل للتقرير ${target.reportId}`,
      {
        oldValue: {
          reportId: target.reportId,
          status: target.status,
          httpStatus: target.httpStatus,
          responseMessage: target.responseMessage,
        },
        newValue: { deleted: true },
      },
    );
    pushToast({ type: 'info', title: 'تم حذف سجل التكامل' });
  };

  const transitionReportStatus = async (
    reportId: string,
    nextStatus: ReportStatus,
    notes?: string,
  ) => {
    if (!profile) return;
    const target = state.reports.find((r) => r.id === reportId);
    if (!target) throw new Error('التقرير غير موجود. احفظ الكشف أولًا.');
    if (
      nextStatus === 'approved' &&
      profile.role !== 'admin' &&
      target.createdByUid === profile.uid
    ) {
      throw new Error('لا يجوز للمستخدم اعتماد تقرير أنشأه بنفسه.');
    }
    if (
      !canTransitionReportStatus(target.status, nextStatus, profile.role, {
        actorUid: profile.uid,
        reportCreatedByUid: target.createdByUid,
      })
    ) {
      throw new Error('هذا الانتقال غير مسموح به وفق دورك الوظيفي.');
    }
    if (nextStatus === 'rejected' && !sanitizeExtractedText(notes || '')) {
      throw new Error('يجب ذكر سبب الرفض عند رفض التقرير.');
    }

    if (authMode === 'firebase') {
      if (!isOnline) {
        await enqueueOfflineOperation('submit_report_status', { reportId, nextStatus, notes });
        setOfflineQueue(await getOfflineQueue());
      } else {
        const res = await transitionReportStatusFs({ reportId, nextStatus, notes }, profile);
        await commitState((prev) => ({
          ...prev,
          reports: prev.reports.map((r) => (r.id === reportId ? res.report : r)),
          approvals: [res.approval, ...prev.approvals],
        }));
        pushToast({ type: 'success', title: 'تم تحديث حالة التقرير بنجاح' });

        // Trigger REAL HTTP central sync only if autoSyncOnApproval is enabled AND centralApiUrl is configured
        if (
          nextStatus === 'approved' &&
          state.settings.autoSyncOnApproval &&
          state.settings.centralApiUrl.trim()
        ) {
          try {
            await syncReportCentral(reportId);
          } catch (syncErr: unknown) {
            pushToast({
              type: 'warning',
              title: 'تم الاعتماد، لكن فشل الإرسال المركزي التلقائي',
              description:
                syncErr instanceof Error ? syncErr.message : 'تحقق من إعدادات الرابط المركزي.',
            });
          }
        }
        return;
      }
    }

    const now = new Date().toISOString();
    const actionMap: Record<ReportStatus, ApprovalRecord['action']> = {
      completed: 'submitted',
      under_review: 'reviewed',
      approved: 'approved',
      rejected: 'rejected',
      draft: 'reopened',
    };
    const approvalId = `app-${Date.now()}`;
    const approval: ApprovalRecord = {
      id: approvalId,
      reportId,
      governorateId: target.governorateId,
      reportDate: target.reportDate,
      action: actionMap[nextStatus],
      fromStatus: target.status,
      toStatus: nextStatus,
      actorUid: profile.uid,
      actorName: profile.displayName,
      actorRole: profile.role,
      notes: sanitizeExtractedText(notes || '') || 'تحديث مرحلة الاعتماد',
      createdAt: now,
    };

    await commitState((prev) => ({
      ...prev,
      reports: prev.reports.map((r) =>
        r.id === reportId
          ? {
              ...r,
              status: nextStatus,
              rejectionReason: nextStatus === 'rejected' ? sanitizeExtractedText(notes || '') : '',
              lastApprovalId: approvalId,
              updatedAt: now,
            }
          : r,
      ),
      approvals: [approval, ...prev.approvals],
    }));

    addAuditEntryLocal(
      `REPORT_STATUS_${nextStatus.toUpperCase()}`,
      'daily_reports',
      reportId,
      `تحويل التقرير ${reportId} إلى ${nextStatus}`,
    );
    pushToast({ type: 'success', title: 'تم تحديث حالة التقرير بنجاح' });
  };

  const extractSheetNumbers = async (params: {
    imageBase64: string;
    mimeType: string;
    sectionType: SheetSectionType;
    governorateId: string;
  }) => {
    const govAssocs = state.associations.filter(
      (a) => a.governorateId === params.governorateId && a.isActive,
    );
    return apiFetch<{ rows: SheetOcrExtractedRow[]; summaryNote: string; rawResponseText: string }>(
      '/api/ai/extract-sheet-numbers',
      {
        method: 'POST',
        body: JSON.stringify({ ...params, associations: govAssocs }),
      },
    );
  };

  const analyzeSingleSheet = async (params: {
    imageBase64: string;
    mimeType: string;
    associationId: string;
    associationName: string;
    fertilizerCode: string;
    fertilizerNameAr: string;
    lastRecordedBalance: number;
  }) => {
    return apiFetch<{
      extractedOpeningBalance: number | null;
      extractedClosingBalance: number | null;
      extractedSettlement: number | null;
      confidence: number;
      notes: string;
      rawResponseText: string;
    }>('/api/ai/analyze-sheet', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  };

  const saveAnalyzedAttachment = async (
    input: Omit<ImageAttachmentRecord, 'id' | 'analyzedByUid' | 'createdAt'>,
  ) => {
    if (authMode === 'firebase' && profile && isOnline) {
      const saved = await saveImageAttachmentFs(input, profile);
      await commitState((prev) => ({
        ...prev,
        attachments: [saved, ...prev.attachments],
      }));
      pushToast({ type: 'success', title: 'تم حفظ نتيجة التحليل والمرفق' });
      return;
    }

    const saved: ImageAttachmentRecord = {
      ...input,
      id: `att-${Date.now()}`,
      analyzedByUid: profile?.uid || 'local',
      createdAt: new Date().toISOString(),
    };
    await commitState((prev) => ({
      ...prev,
      attachments: [saved, ...prev.attachments],
    }));
    addAuditEntryLocal('SAVE_ANALYZED_ATTACHMENT', 'images_attachments', saved.id, `حفظ تحليل كشف ${saved.associationName}`);
    pushToast({ type: 'success', title: 'تم حفظ نتيجة التحليل والمرفق' });
  };

  const updateAttachmentAdmin = async (
    attachmentId: string,
    patch: { extractedClosingBalance?: number | null; notes?: string; reportDate?: string },
  ) => {
    if (profile?.role !== 'admin') {
      throw new Error('صلاحية تعديل المرفقات المحللة مقصورة على مدير النظام فقط.');
    }
    const target = state.attachments.find((a) => a.id === attachmentId);
    if (!target) throw new Error('المرفق غير موجود.');

    if (authMode === 'firebase' && profile) {
      if (!isOnline) throw new Error('تعديل المرفقات يتطلب اتصالًا بالإنترنت.');
      const { auditEntry } = await updateImageAttachmentAdminFs(attachmentId, patch, profile);
      await commitState((prev) => ({
        ...prev,
        attachments: prev.attachments.map((a) => {
          if (a.id !== attachmentId) return a;
          const nextClosing =
            patch.extractedClosingBalance === undefined
              ? a.extractedClosingBalance
              : patch.extractedClosingBalance;
          return {
            ...a,
            extractedClosingBalance: nextClosing,
            discrepancy:
              nextClosing !== null && nextClosing !== undefined
                ? nextClosing - a.lastRecordedBalance
                : null,
            notes:
              patch.notes !== undefined ? sanitizeExtractedText(patch.notes).slice(0, 500) : a.notes,
            reportDate: patch.reportDate ?? a.reportDate,
          };
        }),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({ type: 'success', title: 'تم تعديل المرفق المحلل' });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      attachments: prev.attachments.map((a) => {
        if (a.id !== attachmentId) return a;
        const nextClosing =
          patch.extractedClosingBalance === undefined
            ? a.extractedClosingBalance
            : patch.extractedClosingBalance;
        return {
          ...a,
          extractedClosingBalance: nextClosing,
          discrepancy:
            nextClosing !== null && nextClosing !== undefined
              ? nextClosing - a.lastRecordedBalance
              : null,
          notes:
            patch.notes !== undefined ? sanitizeExtractedText(patch.notes).slice(0, 500) : a.notes,
          reportDate: patch.reportDate ?? a.reportDate,
        };
      }),
    }));
    addAuditEntryLocal(
      'ADMIN_UPDATE_ATTACHMENT',
      'images_attachments',
      attachmentId,
      `تعديل مرفق تحليل الكشف للجمعية ${target.associationName}`,
      {
        oldValue: {
          extractedClosingBalance: target.extractedClosingBalance,
          notes: target.notes,
          reportDate: target.reportDate,
        },
        newValue: patch,
      },
    );
    pushToast({ type: 'success', title: 'تم تعديل المرفق المحلل' });
  };

  const deleteAttachmentAdmin = async (attachmentId: string) => {
    if (profile?.role !== 'admin') {
      throw new Error('صلاحية حذف المرفقات المحللة مقصورة على مدير النظام فقط.');
    }
    const target = state.attachments.find((a) => a.id === attachmentId);
    if (!target) throw new Error('المرفق غير موجود.');

    if (authMode === 'firebase' && profile) {
      if (!isOnline) throw new Error('حذف المرفقات يتطلب اتصالًا بالإنترنت.');
      const { auditEntry } = await deleteImageAttachmentAdminFs(attachmentId, profile);
      await commitState((prev) => ({
        ...prev,
        attachments: prev.attachments.filter((a) => a.id !== attachmentId),
        auditLogs: [auditEntry, ...prev.auditLogs],
      }));
      pushToast({ type: 'info', title: 'تم حذف المرفق المحلل' });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((a) => a.id !== attachmentId),
    }));
    addAuditEntryLocal(
      'ADMIN_DELETE_ATTACHMENT',
      'images_attachments',
      attachmentId,
      `حذف مرفق تحليل الكشف للجمعية ${target.associationName}`,
      {
        oldValue: {
          associationId: target.associationId,
          associationName: target.associationName,
          reportDate: target.reportDate,
          extractedClosingBalance: target.extractedClosingBalance,
        },
        newValue: { deleted: true },
      },
    );
    pushToast({ type: 'info', title: 'تم حذف المرفق المحلل' });
  };

  const extractManifest = async (params: { imageBase64: string; mimeType: string }) => {
    return apiFetch<ManifestOcrExtractedData>('/api/ai/extract-manifest', {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        governorates: state.governorates,
        associations: state.associations.filter((a) => a.isActive),
      }),
    });
  };

  const createOrUpdateUser = async (input: {
    uid?: string;
    inviteId?: string;
    email: string;
    displayName: string;
    role: UserRole;
    governorateIds?: string[];
    permissions?: GranularPermissions;
    isActive?: boolean;
  }) => {
    const cleanEmail = sanitizeExtractedText(input.email).toLowerCase();
    const cleanName = sanitizeExtractedText(input.displayName);
    if (!cleanEmail || !cleanName) {
      throw new Error('البريد الإلكتروني والاسم مطلوبان.');
    }

    if (authMode === 'firebase' && profile) {
      const res = await createOrUpdateUserOrInviteFs(input, profile);
      await commitState((prev) => ({
        ...prev,
        users: res.user
          ? prev.users.some((u) => u.uid === res.user!.uid)
            ? prev.users.map((u) => (u.uid === res.user!.uid ? res.user! : u))
            : [res.user!, ...prev.users]
          : prev.users,
        invites: res.invite
          ? prev.invites.some((inv) => inv.id === res.invite!.id)
            ? prev.invites.map((inv) => (inv.id === res.invite!.id ? res.invite! : inv))
            : [res.invite!, ...prev.invites]
          : prev.invites,
      }));
      pushToast({
        type: 'success',
        title: input.uid
          ? 'تم تحديث بيانات المستخدم'
          : 'تمت إضافة/تحديث تفويض الدخول بالبريد الإلكتروني بنجاح',
      });
      return;
    }

    const uid = input.uid || `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const user: UserProfile = {
      uid,
      email: cleanEmail,
      displayName: cleanName,
      role: input.role,
      governorateIds: input.governorateIds || [],
      permissions: input.permissions || getDefaultGranularPermissions(input.role),
      isActive: input.isActive !== false,
      createdAt: now,
      updatedAt: now,
    };

    await commitState((prev) => {
      const existing = prev.users.find((u) => u.uid === uid);
      const mergedUser: UserProfile = existing
        ? {
            ...existing,
            ...user,
            createdAt: existing.createdAt,
          }
        : user;
      return {
        ...prev,
        users: existing
          ? prev.users.map((u) => (u.uid === uid ? mergedUser : u))
          : [mergedUser, ...prev.users],
      };
    });
    await syncPreviewProfile(user);
    addAuditEntryLocal(
      input.uid ? 'UPDATE_USER' : 'CREATE_USER',
      'users',
      uid,
      `${input.uid ? 'تحديث' : 'إضافة'} المستخدم ${cleanName} (${cleanEmail})`,
    );
    pushToast({ type: 'success', title: input.uid ? 'تم تحديث بيانات المستخدم' : 'تمت إضافة المستخدم بنجاح' });
  };

  const deleteUser = async (uidOrInviteId: string, kind: 'user' | 'invite' = 'user') => {
    if (kind === 'user' && uidOrInviteId === profile?.uid) {
      throw new Error('لا يمكنك حذف حسابك الشخصي أثناء تسجيل الدخول.');
    }
    if (authMode === 'firebase' && profile) {
      await deleteUserOrInviteFs(
        kind === 'invite' ? { inviteId: uidOrInviteId } : { uid: uidOrInviteId },
        profile,
      );
      await commitState((prev) => ({
        ...prev,
        users: kind === 'user' ? prev.users.filter((u) => u.uid !== uidOrInviteId) : prev.users,
        invites:
          kind === 'invite' ? prev.invites.filter((i) => i.id !== uidOrInviteId) : prev.invites,
      }));
      pushToast({
        type: 'info',
        title: kind === 'invite' ? 'تم إلغاء دعوة الدخول' : 'تم حذف المستخدم',
      });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      users: prev.users.filter((u) => u.uid !== uidOrInviteId),
    }));
    addAuditEntryLocal('DELETE_USER', 'users', uidOrInviteId, `حذف المستخدم ${uidOrInviteId}`);
    pushToast({ type: 'info', title: 'تم حذف المستخدم' });
  };

  const updateUserRole = async (
    uid: string,
    role: UserRole,
    isActive: boolean,
    extra?: {
      governorateIds?: string[];
      permissions?: GranularPermissions;
      displayName?: string;
      inviteId?: string;
      email?: string;
    },
  ) => {
    if (authMode === 'firebase' && profile) {
      const targetUser = state.users.find((u) => u.uid === uid);
      const targetInvite = state.invites.find((i) => i.id === (extra?.inviteId || uid));
      const res = await createOrUpdateUserOrInviteFs(
        {
          ...(targetUser ? { uid: targetUser.uid } : {}),
          ...(targetInvite ? { inviteId: targetInvite.id } : {}),
          email: extra?.email || targetUser?.email || targetInvite?.email || '',
          displayName: extra?.displayName || targetUser?.displayName || targetInvite?.displayName || '',
          role,
          governorateIds: extra?.governorateIds ?? targetUser?.governorateIds ?? targetInvite?.governorateIds,
          permissions: extra?.permissions ?? targetUser?.permissions ?? targetInvite?.permissions,
          isActive,
        },
        profile,
      );
      await commitState((prev) => ({
        ...prev,
        users: res.user
          ? prev.users.map((u) => (u.uid === res.user!.uid ? res.user! : u))
          : prev.users,
        invites: res.invite
          ? prev.invites.map((i) => (i.id === res.invite!.id ? res.invite! : i))
          : prev.invites,
      }));
      pushToast({ type: 'success', title: 'تم تحديث صلاحيات المستخدم' });
      return;
    }

    let syncedUser: UserProfile | null = null;
    await commitState((prev) => ({
      ...prev,
      users: prev.users.map((u) => {
        if (u.uid !== uid) return u;
        const next: UserProfile = {
          ...u,
          displayName: extra?.displayName ? sanitizeExtractedText(extra.displayName) : u.displayName,
          role,
          isActive,
          governorateIds: extra?.governorateIds ?? u.governorateIds,
          permissions: extra?.permissions ?? getDefaultGranularPermissions(role),
          updatedAt: new Date().toISOString(),
        };
        syncedUser = next;
        return next;
      }),
    }));
    if (syncedUser) await syncPreviewProfile(syncedUser);
    addAuditEntryLocal('UPDATE_USER_ROLE', 'users', uid, `تحديث صلاحيات/دور المستخدم إلى ${role}`);
    pushToast({ type: 'success', title: 'تم تحديث صلاحيات المستخدم' });
  };

  const cleanupLegacyPasswordHashes = async (): Promise<{ scanned: number; cleaned: number }> => {
    if (authMode !== 'firebase' || !profile) {
      return { scanned: state.users.length, cleaned: 0 };
    }
    const res = await cleanupLegacyPasswordHashesFs(profile);
    pushToast({
      type: 'success',
      title: 'اكتمل فحص وتنظيف وثائق المستخدمين',
      description:
        res.cleaned > 0
          ? `تمت إزالة حقل passwordHash القديم من ${res.cleaned} مستند (من أصل ${res.scanned}).`
          : `تم فحص ${res.scanned} مستند ولم يُعثر على أي حقول passwordHash قديمة.`,
    });
    return res;
  };

  const updateSettings = async (input: Partial<SystemSettings>) => {
    const normalizedInput: Partial<SystemSettings> = { ...input };
    if (typeof normalizedInput.centralApiUrl === 'string') {
      const trimmed = normalizedInput.centralApiUrl.trim();
      normalizedInput.centralApiUrl = trimmed;
      if (!trimmed) {
        normalizedInput.autoSyncOnApproval = false;
      }
    }
    if (authMode === 'firebase' && profile) {
      const updated = await updateSystemSettingsFs(normalizedInput, state.settings, profile);
      await commitState((prev) => ({ ...prev, settings: updated }));
      pushToast({ type: 'success', title: 'تم حفظ إعدادات المنظومة' });
      return;
    }
    await commitState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...normalizedInput },
    }));
    addAuditEntryLocal(
      'UPDATE_SYSTEM_SETTINGS',
      'system_settings',
      'global',
      'تحديث إعدادات المنظومة والحدود الدنيا',
      { oldValue: state.settings.minThresholds, newValue: input.minThresholds || state.settings.minThresholds },
    );
    pushToast({ type: 'success', title: 'تم حفظ إعدادات المنظومة' });
  };

  const exportBackupJson = () => {
    const snapshot = {
      schemaVersion: 'dst-backup-v4',
      exportedAt: new Date().toISOString(),
      associations: state.associations,
      reports: state.reports,
      disbursements: state.disbursements,
      tractors: state.tractors,
      settings: state.settings,
      users: state.users,
      invites: state.invites,
    };
    return JSON.stringify(snapshot, null, 2);
  };

  const restoreBackupJson = async (rawJson: string) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      throw new Error('ملف النسخة الاحتياطية غير صالح (صيغة JSON غير صحيحة).');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('بنية ملف النسخة الاحتياطية غير صالحة.');
    }

    const payload = {
      associations: Array.isArray(parsed.associations)
        ? (parsed.associations as AgriculturalAssociation[])
        : undefined,
      reports: Array.isArray(parsed.reports) ? (parsed.reports as DailyReport[]) : undefined,
      disbursements: Array.isArray(parsed.disbursements)
        ? (parsed.disbursements as DailyDisbursementRow[])
        : undefined,
      tractors: Array.isArray(parsed.tractors) ? (parsed.tractors as TractorDelivery[]) : undefined,
      settings:
        parsed.settings && typeof parsed.settings === 'object'
          ? (parsed.settings as Partial<SystemSettings>)
          : undefined,
    };

    if (authMode === 'firebase' && profile) {
      await restoreBackupSnapshotFs(payload, state.settings, profile);
      await refreshData();
      pushToast({ type: 'success', title: 'تمت استعادة النسخة الاحتياطية بنجاح' });
      return;
    }

    await commitState((prev) => ({
      ...prev,
      associations: payload.associations?.length
        ? sortAssociationsByOrder(payload.associations)
        : prev.associations,
      reports: payload.reports ? payload.reports : prev.reports,
      disbursements: payload.disbursements ? payload.disbursements : prev.disbursements,
      tractors: payload.tractors ? payload.tractors : prev.tractors,
      settings: payload.settings ? { ...prev.settings, ...payload.settings } : prev.settings,
    }));
    addAuditEntryLocal('RESTORE_JSON_BACKUP', 'system', 'backup', 'استعادة نسخة احتياطية JSON');
    pushToast({ type: 'success', title: 'تمت استعادة النسخة الاحتياطية بنجاح' });
  };

  const value = useMemo<AppDataContextValue>(
    () => ({
      ...state,
      loadingData,
      offlineQueue,
      isSyncing,
      toasts,
      theme,
      toggleTheme,
      pushToast,
      dismissToast,
      syncNow,
      refreshData,
      saveAssociation,
      addBulkAssociations,
      deactivateAssociation,
      reactivateAssociation,
      countAssociationLinkedRecords,
      deleteAssociationPermanently,
      reorderAssociations,
      saveDisbursementsBatch,
      clearDayRecords,
      restoreDayRecords,
      fetchAnalyticsHistory,
      createTractor,
      approveTractor,
      updateTractorAdmin,
      deleteTractor,
      transitionReportStatus,
      syncReportCentral,
      updateIntegrationLogAdmin,
      deleteIntegrationLogAdmin,
      extractSheetNumbers,
      analyzeSingleSheet,
      saveAnalyzedAttachment,
      updateAttachmentAdmin,
      deleteAttachmentAdmin,
      extractManifest,
      createOrUpdateUser,
      deleteUser,
      updateUserRole,
      cleanupLegacyPasswordHashes,
      updateSettings,
      exportBackupJson,
      restoreBackupJson,
      addAuditEntryLocal,
    }),
    [
      state,
      loadingData,
      offlineQueue,
      isSyncing,
      toasts,
      theme,
      toggleTheme,
      pushToast,
      dismissToast,
      syncNow,
      refreshData,
      addAuditEntryLocal,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
};

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
