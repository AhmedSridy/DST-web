export type UserRole = 'field_staff' | 'supervisor' | 'chief' | 'admin' | 'viewer';

export type ReportStatus = 'draft' | 'completed' | 'under_review' | 'approved' | 'rejected';

export type InspectionStatus = 'matched' | 'shortage' | 'surplus' | 'damaged';

export type TractorApprovalState = 'pending' | 'final_approved';

export type SheetSectionType = 'opening' | 'closing' | 'settlement' | 'full_sheet';

export type FertilizerCode = 'urea' | 'nitrate' | 'sulfate' | string;

export type ExportFormat = 'xlsx' | 'docx' | 'pdf';
export type ExportScope = 'both' | 'sheet_only' | 'tractors_only';

export interface GranularPermissions {
  canEdit: boolean;
  canExport: boolean;
  canClearDay: boolean;
  canManageAssociations: boolean;
  canViewBalances: boolean;
  canViewAnalytics: boolean;
}

export interface RoleDefinition {
  id: string;
  code: UserRole;
  nameAr: string;
  descriptionAr: string;
  permissions: string[];
}

export interface Governorate {
  id: string;
  code: string;
  nameAr: string;
  region: string;
  isActive: boolean;
}

export interface GovernorateCenter {
  id: string;
  governorateId: string;
  code: string;
  nameAr: string;
  isActive: boolean;
}

export interface CenterVillage {
  id: string;
  governorateId: string;
  centerId: string;
  nameAr: string;
  isActive: boolean;
}

export interface AgriculturalAssociation {
  id: string;
  code: string;
  nameAr: string;
  normalizedName: string;
  governorateId: string;
  centerId: string;
  villageId?: string;
  managerName: string;
  managerPhone: string;
  supervisionType?: string;
  distributionDay?: string;
  capacity?: number;
  notes?: string;
  sortOrder?: number;
  isActive: boolean;
  active?: boolean;
  createdByUid?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  governorateId?: string;
  governorateIds?: string[];
  permissions?: GranularPermissions;
  passwordHash?: string;
  inviteId?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserInvite {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  governorateIds: string[];
  permissions: GranularPermissions;
  isActive: boolean;
  invitedByUid: string;
  claimedUid?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface FertilizerType {
  id: string;
  code: FertilizerCode;
  nameAr: string;
  sortOrder: number;
  bagWeightKg: number;
  isActive: boolean;
}

export interface DailyDisbursementRow {
  id: string;
  reportId: string;
  governorateId?: string;
  associationId: string;
  fertilizerCode: FertilizerCode;
  openingBalance: number | null;
  incomingQty?: number;
  closingBalance: number | null;
  settlementQty: number | null;
  actualDisbursed: number | null;
  variance: number | null;
  varianceReason: string;
  createdByUid?: string;
  updatedAt: string;
}

export interface DailyReport {
  id: string;
  governorateId: string;
  reportDate: string;
  status: ReportStatus;
  createdByUid: string;
  createdByName: string;
  rejectionReason?: string;
  centralSyncStatus: 'pending' | 'synced' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  reportId: string;
  governorateId: string;
  reportDate: string;
  action: 'submitted' | 'reviewed' | 'approved' | 'rejected' | 'reopened';
  fromStatus: ReportStatus;
  toStatus: ReportStatus;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  notes: string;
  createdAt: string;
}

export interface TractorDelivery {
  id: string;
  governorateId: string;
  centerId: string;
  associationId: string;
  tractorPlate: string;
  arrivalDate: string;
  arrivalTime: string;
  fertilizerCode: FertilizerCode;
  driverName: string;
  driverPhone: string;
  driverNationalId: string;
  manifestNumber: string;
  supplySource: string;
  manifestBags: number;
  actualBags: number;
  bagVariance: number;
  inspectionStatus: InspectionStatus;
  checklist: {
    sealIntact: boolean;
    bagsDryAndIntact: boolean;
    manifestMatchesPlate: boolean;
    weightVerified: boolean;
  };
  manifestImageDataUrl?: string;
  receiptImageDataUrl?: string;
  notes: string;
  approvalState: TractorApprovalState;
  createdByUid: string;
  createdAt: string;
}

export interface ImageAttachmentRecord {
  id: string;
  associationId: string;
  associationName: string;
  governorateId: string;
  reportDate: string;
  fertilizerCode: FertilizerCode;
  sectionType: SheetSectionType;
  extractedClosingBalance: number | null;
  lastRecordedBalance: number;
  discrepancy: number | null;
  confidence: number;
  notes: string;
  imageDataUrl: string;
  analyzedByUid: string;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

export interface IntegrationLogEntry {
  id: string;
  reportId: string;
  governorateId: string;
  reportDate: string;
  endpointUrl: string;
  status: 'success' | 'failed';
  httpStatus: number;
  payloadSummary: string;
  responseMessage: string;
  dispatchedByUid: string;
  createdAt: string;
}

export interface FertilizerThresholdConfig {
  urea: number | null;
  nitrate: number | null;
  sulfate: number | null;
}

export interface SystemSettings {
  id: string;
  requireDriverNationalId: boolean;
  centralApiUrl: string;
  autoSyncOnApproval: boolean;
  organizationNameAr: string;
  treatEmptyAsZero: boolean;
  minThresholds: FertilizerThresholdConfig;
  assocMinThresholds?: Record<string, Partial<FertilizerThresholdConfig>>;
}

export interface SheetOcrExtractedRow {
  rowIndex: number;
  pageNumber?: number;
  extractedName: string;
  matchedAssociationId: string | null;
  matchConfidence: number;
  ureaOpening: number | null;
  ureaClosing: number | null;
  ureaSettlement: number | null;
  ureaExtractedDisbursed?: number | null;
  nitrateOpening: number | null;
  nitrateClosing: number | null;
  nitrateSettlement: number | null;
  nitrateExtractedDisbursed?: number | null;
  sulfateOpening: number | null;
  sulfateClosing: number | null;
  sulfateSettlement: number | null;
  sulfateExtractedDisbursed?: number | null;
  disbursedMismatchWarnings?: string[];
  duplicateAssociationWarning?: boolean;
  confidence: number;
  needsReview: boolean;
  include: boolean;
  notes?: string;
}

export interface ManifestOcrExtractedData {
  manifestNumber: string;
  arrivalDate: string;
  arrivalTime: string;
  governorateName: string;
  matchedGovernorateId: string | null;
  associationName: string;
  matchedAssociationId: string | null;
  fertilizerCode: FertilizerCode;
  manifestBags: number | null;
  weightTons: number | null;
  tractorPlate: string;
  driverName: string;
  driverPhone: string;
  driverNationalId: string;
  supplySource: string;
  confidence: number;
  warnings: string[];
}

export interface OfflineQueueItem {
  id: string;
  operationType:
    | 'save_disbursements'
    | 'create_tractor'
    | 'approve_tractor'
    | 'delete_tractor'
    | 'save_association'
    | 'submit_report_status';
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

export interface DeletedDaySnapshot {
  governorateId: string;
  reportDate: string;
  report: DailyReport | null;
  rows: DailyDisbursementRow[];
}
