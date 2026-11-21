import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Edit3,
  GripVertical,
  ListPlus,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Slash,
  Trash2,
  X,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import type { AssociationLinkedRecordCounts } from '../lib/firestoreRepo.ts';
import type { AgriculturalAssociation } from '../types/domain.ts';
import {
  MAX_ASSOCIATION_NAME_LENGTH,
  normalizeArabicName,
  previewBulkAssociationLines,
  sanitizeExtractedText,
  sortAssociationsByOrder,
} from '../utils/arabicNormalize.ts';
import { formatNumberAr } from '../utils/calculations.ts';
import { getVisibleGovernorates, hasGranularAccess } from '../utils/rbac.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { useOnlineStatus } from './PwaControls.tsx';

interface AssociationsManagerViewProps {
  initialGovId?: string;
}

export const AssociationsManagerView: React.FC<AssociationsManagerViewProps> = ({
  initialGovId,
}) => {
  const { profile, authMode } = useAuth();
  const isOnline = useOnlineStatus();
  const {
    governorates,
    centers,
    villages,
    associations,
    saveAssociation,
    addBulkAssociations,
    deactivateAssociation,
    reactivateAssociation,
    countAssociationLinkedRecords,
    deleteAssociationPermanently,
    reorderAssociations,
    pushToast,
  } = useAppData();

  const visibleGovs = useMemo(
    () => getVisibleGovernorates(profile, governorates),
    [governorates, profile],
  );
  const visibleGovSet = useMemo(() => new Set(visibleGovs.map((g) => g.id)), [visibleGovs]);

  const [activeGovId, setActiveGovId] = useState<string>(() => {
    if (initialGovId && visibleGovSet.has(initialGovId)) return initialGovId;
    return visibleGovs[0]?.id || 'gov-ismailia';
  });

  useEffect(() => {
    if (initialGovId && visibleGovSet.has(initialGovId)) {
      setActiveGovId(initialGovId);
      setFilterCenterId('all');
    }
  }, [initialGovId, visibleGovSet]);

  useEffect(() => {
    if (visibleGovs.length > 0 && !visibleGovSet.has(activeGovId)) {
      setActiveGovId(visibleGovs[0].id);
    }
  }, [activeGovId, visibleGovSet, visibleGovs]);

  const [filterCenterId, setFilterCenterId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // Single-add inline bar state
  const [singleName, setSingleName] = useState('');
  const [singleCode, setSingleCode] = useState('');
  const [singleCenterId, setSingleCenterId] = useState('');
  const [singleNotes, setSingleNotes] = useState('');
  const [singleError, setSingleError] = useState<string | null>(null);
  const [savingSingle, setSavingSingle] = useState(false);

  // Bulk-add modal state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkCenterId, setBulkCenterId] = useState('');
  const [savingBulk, setSavingBulk] = useState(false);

  // Edit modal, Soft delete, & Admin Permanent delete confirmation
  const [editing, setEditing] = useState<Partial<AgriculturalAssociation> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgriculturalAssociation | null>(null);
  const [permDeleteTarget, setPermDeleteTarget] = useState<AgriculturalAssociation | null>(null);
  const [permDeleteCounts, setPermDeleteCounts] = useState<AssociationLinkedRecordCounts | null>(
    null,
  );
  const [countingAssocId, setCountingAssocId] = useState<string | null>(null);
  const [isPermDeleting, setIsPermDeleting] = useState(false);
  const [permDeleteError, setPermDeleteError] = useState<string | null>(null);
  const [draggedAssocId, setDraggedAssocId] = useState<string | null>(null);

  const canManage = hasGranularAccess(profile, 'canManageAssociations');
  const isAdmin = profile?.role === 'admin';
  const permDeleteOfflineBlocked = authMode === 'firebase' && !isOnline;
  const activeGov = governorates.find((g) => g.id === activeGovId);

  const handleOpenPermanentDelete = async (assoc: AgriculturalAssociation) => {
    if (!isAdmin) return;
    if (permDeleteOfflineBlocked) {
      pushToast({
        type: 'warning',
        title: 'يتطلب اتصالًا بالإنترنت',
        description: 'الحذف النهائي للجمعيات يعمل أونلاين فقط ولا يُضاف إلى طابور المزامنة.',
      });
      return;
    }
    setCountingAssocId(assoc.id);
    setPermDeleteError(null);
    try {
      const counts = await countAssociationLinkedRecords(assoc.id, assoc.governorateId);
      setPermDeleteCounts(counts);
      setPermDeleteTarget(assoc);
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر فحص السجلات المرتبطة',
        description: error instanceof Error ? error.message : 'تحقق من الاتصال ثم أعد المحاولة.',
      });
    } finally {
      setCountingAssocId(null);
    }
  };

  const handleConfirmPermanentDelete = async () => {
    if (!permDeleteTarget || isPermDeleting) return;
    setIsPermDeleting(true);
    setPermDeleteError(null);
    try {
      await deleteAssociationPermanently(permDeleteTarget.id);
      setPermDeleteTarget(null);
      setPermDeleteCounts(null);
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : 'تعذر إتمام الحذف النهائي. يمكنك إعادة المحاولة لاستكمال حذف السجلات المتبقية.';
      setPermDeleteError(msg);
      pushToast({
        type: 'error',
        title: 'تعذر إتمام الحذف النهائي',
        description: msg,
      });
    } finally {
      setIsPermDeleting(false);
    }
  };

  const govCenters = useMemo(
    () => centers.filter((c) => c.governorateId === activeGovId && c.isActive),
    [activeGovId, centers],
  );

  const defaultCenterForGov = useMemo(() => {
    if (govCenters.length > 0) return govCenters[0].id;
    return `ctr-${activeGovId.replace('gov-', '')}-general`;
  }, [activeGovId, govCenters]);

  useEffect(() => {
    setSingleCenterId(defaultCenterForGov);
    setBulkCenterId(defaultCenterForGov);
  }, [defaultCenterForGov]);

  // All associations for this governorate (both active and inactive) sorted by sortOrder
  const govAllAssociations = useMemo(
    () =>
      sortAssociationsByOrder(
        associations.filter((a) => a.governorateId === activeGovId && visibleGovSet.has(a.governorateId)),
      ),
    [activeGovId, associations, visibleGovSet],
  );

  const govActiveAssociations = useMemo(
    () => govAllAssociations.filter((a) => a.isActive !== false && a.active !== false),
    [govAllAssociations],
  );

  const govInactiveCount = govAllAssociations.length - govActiveAssociations.length;

  const filteredAssociations = useMemo(() => {
    const q = normalizeArabicName(searchQuery);
    return govAllAssociations.filter((a) => {
      const isAct = a.isActive !== false && a.active !== false;
      if (!showInactive && !isAct) return false;
      if (filterCenterId !== 'all' && a.centerId !== filterCenterId) return false;
      if (q) {
        const ctrName = centers.find((c) => c.id === a.centerId)?.nameAr || '';
        const hay = `${normalizeArabicName(a.nameAr)} ${normalizeArabicName(a.code)} ${normalizeArabicName(a.notes || '')} ${normalizeArabicName(a.managerName)} ${normalizeArabicName(ctrName)}`;
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [centers, filterCenterId, govAllAssociations, searchQuery, showInactive]);

  const singleDuplicateWarning = useMemo(() => {
    const clean = sanitizeExtractedText(singleName);
    if (!clean) return null;
    if (clean.length > MAX_ASSOCIATION_NAME_LENGTH) {
      return `يتجاوز الاسم الحد الأقصى المسموح به (${MAX_ASSOCIATION_NAME_LENGTH} حرفًا).`;
    }
    const norm = normalizeArabicName(clean);
    const dup = govAllAssociations.find((a) => normalizeArabicName(a.nameAr) === norm);
    if (!dup) return null;
    return dup.isActive === false
      ? `الاسم مسجل مسبقًا كجمعية موقوفة («${dup.nameAr}»): يمكنك تفعيل «إظهار الموقوفة» وإعادة تفعيلها.`
      : `توجد جمعية مسجلة بالفعل بنفس الاسم في هذه المحافظة («${dup.nameAr}»).`;
  }, [govAllAssociations, singleName]);

  const bulkPreview = useMemo(
    () => previewBulkAssociationLines(bulkText, govAllAssociations),
    [bulkText, govAllAssociations],
  );

  const canReorderActiveList =
    canManage && !searchQuery.trim() && filterCenterId === 'all' && !showInactive;

  const handleSingleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSingleError(null);
    const clean = sanitizeExtractedText(singleName);
    if (!clean) {
      setSingleError('اسم الجمعية إلزامي.');
      return;
    }
    if (clean.length > MAX_ASSOCIATION_NAME_LENGTH) {
      setSingleError(`الحد الأقصى لاسم الجمعية هو ${MAX_ASSOCIATION_NAME_LENGTH} حرفًا.`);
      return;
    }
    if (singleDuplicateWarning) {
      setSingleError(singleDuplicateWarning);
      return;
    }

    setSavingSingle(true);
    try {
      await saveAssociation({
        code: singleCode.trim(),
        nameAr: clean,
        governorateId: activeGovId,
        centerId: singleCenterId || defaultCenterForGov,
        villageId: '',
        managerName: '',
        managerPhone: '',
        notes: singleNotes.trim(),
        isActive: true,
      });
      setSingleName('');
      setSingleCode('');
      setSingleNotes('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر إضافة الجمعية.';
      setSingleError(msg);
      pushToast({ type: 'error', title: 'تعذر إضافة الجمعية', description: msg });
    } finally {
      setSavingSingle(false);
    }
  };

  const handleSaveBulk = async () => {
    if (bulkPreview.validCount === 0) return;
    setSavingBulk(true);
    try {
      const res = await addBulkAssociations({
        governorateId: activeGovId,
        centerId: bulkCenterId || defaultCenterForGov,
        rawText: bulkText,
      });
      if (res.createdCount > 0) {
        setBulkText('');
        setBulkOpen(false);
      }
    } catch (err: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر الحفظ الجماعي',
        description: err instanceof Error ? err.message : 'تحقق من البيانات وحاول مجددًا.',
      });
    } finally {
      setSavingBulk(false);
    }
  };

  const handleSaveEditModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await saveAssociation({
        id: editing.id,
        code: editing.code || '',
        nameAr: editing.nameAr || '',
        governorateId: editing.governorateId || activeGovId,
        centerId: editing.centerId || defaultCenterForGov,
        villageId: editing.villageId || '',
        managerName: editing.managerName || '',
        managerPhone: editing.managerPhone || '',
        notes: editing.notes || '',
        supervisionType: editing.supervisionType || '',
        distributionDay: editing.distributionDay || '',
        ...(typeof editing.capacity === 'number' && Number.isFinite(editing.capacity)
          ? { capacity: editing.capacity }
          : {}),
        sortOrder: editing.sortOrder,
        isActive: editing.isActive !== false,
      });
      setEditing(null);
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر حفظ تعديلات الجمعية',
        description: error instanceof Error ? error.message : 'تحقق من الحقول المطلوبة.',
      });
    }
  };

  const moveAssociationStep = async (assocId: string, delta: -1 | 1) => {
    const ids = govActiveAssociations.map((a) => a.id);
    const idx = ids.indexOf(assocId);
    const targetIdx = idx + delta;
    if (idx < 0 || targetIdx < 0 || targetIdx >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved);
    try {
      await reorderAssociations(activeGovId, next);
    } catch (err: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر إعادة الترتيب',
        description: err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الترتيب.',
      });
    }
  };

  const handleDropReorder = async (targetAssocId: string) => {
    if (!draggedAssocId || draggedAssocId === targetAssocId) {
      setDraggedAssocId(null);
      return;
    }
    const ids = govActiveAssociations.map((a) => a.id);
    const fromIdx = ids.indexOf(draggedAssocId);
    const toIdx = ids.indexOf(targetAssocId);
    setDraggedAssocId(null);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...ids];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    try {
      await reorderAssociations(activeGovId, next);
    } catch (err: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر إعادة الترتيب',
        description: err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الترتيب.',
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Governorate Selector */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              إدارة الجمعيات — محافظة {activeGov?.nameAr || ''}
            </h2>
            <span className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-1 text-xs font-bold text-emerald-900 dark:text-emerald-300 font-mono-num">
              عدد الجمعيات: {formatNumberAr(filteredAssociations.length)}
              {govInactiveCount > 0 && !showInactive
                ? ` (${formatNumberAr(govInactiveCount)} موقوفة)`
                : ''}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            إضافة جمعية واحدة أو عدة جمعيات، تعديل البيانات، إيقاف ناعم مع حفظ السجلات التاريخية، وإعادة الترتيب في الكشوف والتصدير.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="اختيار المحافظة"
            value={activeGovId}
            onChange={(e) => {
              setActiveGovId(e.target.value);
              setFilterCenterId('all');
              setSingleError(null);
            }}
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-bold text-slate-900 dark:text-slate-100"
          >
            {visibleGovs.map((g) => (
              <option key={g.id} value={g.id}>
                محافظة {g.nameAr}
              </option>
            ))}
          </select>

          {canManage && (
            <button
              type="button"
              onClick={() => {
                setBulkText('');
                setBulkOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <ListPlus className="w-4 h-4" />
              📋 إضافة جماعية
            </button>
          )}
        </div>
      </div>

      {/* Single Add Inline Form (inside selected governorate) */}
      {canManage && (
        <form
          onSubmit={(e) => void handleSingleAdd(e)}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              ➕ إضافة جمعية واحدة في {activeGov?.nameAr}
            </h3>
            <span className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400">
              {singleName.length} / {MAX_ASSOCIATION_NAME_LENGTH} حرفًا
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-end">
            <label className="lg:col-span-4 space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                اسم الجمعية *
              </span>
              <input
                type="text"
                required
                maxLength={MAX_ASSOCIATION_NAME_LENGTH}
                value={singleName}
                onChange={(e) => {
                  setSingleName(e.target.value);
                  setSingleError(null);
                }}
                placeholder="مثال: جمعية الصالحية الجديدة"
                aria-label="اسم الجمعية الجديدة"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 focus:border-emerald-600 focus:outline-none"
              />
            </label>

            <label className="lg:col-span-2 space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                الكود (اختياري)
              </span>
              <input
                type="text"
                value={singleCode}
                onChange={(e) => setSingleCode(e.target.value)}
                placeholder="تلقائي"
                dir="ltr"
                aria-label="كود الجمعية اختياري"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num text-left"
              />
            </label>

            <label className="lg:col-span-2 space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                المركز / نقطة التوزيع
              </span>
              <select
                aria-label="مركز الجمعية الجديدة"
                value={singleCenterId}
                onChange={(e) => setSingleCenterId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-2.5 py-2"
              >
                {govCenters.length === 0 ? (
                  <option value={defaultCenterForGov}>نقطة توزيع عامة</option>
                ) : (
                  govCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameAr}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="lg:col-span-3 space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                ملاحظات (اختياري)
              </span>
              <input
                type="text"
                value={singleNotes}
                onChange={(e) => setSingleNotes(e.target.value)}
                placeholder="ملاحظات إدارية أو توصيف..."
                aria-label="ملاحظات الجمعية الجديدة"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              />
            </label>

            <div className="lg:col-span-1">
              <button
                type="submit"
                disabled={savingSingle || Boolean(singleDuplicateWarning)}
                className="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white hover:bg-emerald-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                {savingSingle ? '...' : 'إضافة'}
              </button>
            </div>
          </div>

          {(singleError || singleDuplicateWarning) && (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 px-3 py-2 text-rose-800 dark:text-rose-200 font-semibold"
            >
              ⚠ {singleError || singleDuplicateWarning}
            </p>
          )}
        </form>
      )}

      {/* Search, Center Filter & Show Inactive Toggle */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center text-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث باسم الجمعية أو الكود أو الملاحظات..."
            aria-label="بحث في الجمعيات"
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 pr-9 pl-3 py-2 focus:border-emerald-600 focus:outline-none"
          />
        </div>

        <select
          aria-label="تصفية بالمركز"
          value={filterCenterId}
          onChange={(e) => setFilterCenterId(e.target.value)}
          className="rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
        >
          <option value="all">كل المراكز ونقاط التوزيع</option>
          {govCenters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameAr}
            </option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="w-4 h-4 accent-emerald-700"
          />
          <span>إظهار الموقوفة ({formatNumberAr(govInactiveCount)})</span>
        </label>
      </div>

      {/* Associations Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {canManage && !canReorderActiveList && govActiveAssociations.length > 1 && (
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
            لإعادة ترتيب الجمعيات بالسحب أو أزرار ▲ / ▼، أزل البحث والتصفية وأغلق «إظهار الموقوفة».
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                <th className="px-3 py-3 text-center w-14">#</th>
                <th className="px-3 py-3 text-right">الكود</th>
                <th className="px-3 py-3 text-right">اسم الجمعية</th>
                <th className="px-3 py-3 text-right">المركز / نقطة التوزيع</th>
                <th className="px-3 py-3 text-right">ملاحظات / المدير</th>
                <th className="px-3 py-3 text-center">الحالة</th>
                {canManage && <th className="px-3 py-3 text-center">الترتيب والإجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filteredAssociations.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 7 : 6}
                    className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    لا توجد جمعيات مسجلة في هذه المحافظة أو مطابقة لمعايير البحث الحالية.
                  </td>
                </tr>
              ) : (
                filteredAssociations.map((assoc, idx) => {
                  const isAct = assoc.isActive !== false && assoc.active !== false;
                  const ctr = centers.find((c) => c.id === assoc.centerId);
                  const vil = villages.find((v) => v.id === assoc.villageId);
                  const activeIdx = govActiveAssociations.findIndex((a) => a.id === assoc.id);
                  const canMoveUp = canReorderActiveList && isAct && activeIdx > 0;
                  const canMoveDown =
                    canReorderActiveList &&
                    isAct &&
                    activeIdx >= 0 &&
                    activeIdx < govActiveAssociations.length - 1;

                  return (
                    <tr
                      key={assoc.id}
                      draggable={canReorderActiveList && isAct}
                      onDragStart={() => setDraggedAssocId(assoc.id)}
                      onDragOver={(e) => {
                        if (canReorderActiveList && isAct) e.preventDefault();
                      }}
                      onDrop={() => {
                        if (canReorderActiveList && isAct) void handleDropReorder(assoc.id);
                      }}
                      className={`${
                        !isAct
                          ? 'bg-slate-50 dark:bg-slate-900/40 opacity-75'
                          : draggedAssocId === assoc.id
                            ? 'bg-emerald-50 dark:bg-emerald-950/40'
                            : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="px-2 py-3 text-center font-mono-num font-bold text-slate-500 dark:text-slate-400">
                        <div className="inline-flex items-center gap-1">
                          {canReorderActiveList && isAct && (
                            <GripVertical
                              className="w-3.5 h-3.5 text-slate-400 cursor-grab"
                              aria-hidden="true"
                            />
                          )}
                          <span>{idx + 1}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono-num font-bold text-emerald-900 dark:text-emerald-400 whitespace-nowrap">
                        {assoc.code}
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                          <span>{assoc.nameAr}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {ctr?.nameAr || 'نقطة توزيع عامة'}
                        {vil ? ` · ${vil.nameAr}` : ''}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300 max-w-[220px]">
                        {assoc.notes && (
                          <div className="text-slate-700 dark:text-slate-200 truncate" title={assoc.notes}>
                            {assoc.notes}
                          </div>
                        )}
                        {(assoc.managerName || assoc.managerPhone || assoc.supervisionType) && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {[assoc.supervisionType, assoc.managerName, assoc.managerPhone]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                        {!assoc.notes && !assoc.managerName && !assoc.supervisionType && (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center whitespace-nowrap">
                        {isAct ? (
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300">
                            ✔ نشطة
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            ⛔ موقوفة
                          </span>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {isAct && (
                              <>
                                <button
                                  type="button"
                                  disabled={!canMoveUp}
                                  onClick={() => void moveAssociationStep(assoc.id, -1)}
                                  aria-label={`رفع ترتيب ${assoc.nameAr}`}
                                  title="نقل للأعلى"
                                  className="rounded border border-slate-300 dark:border-slate-600 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={!canMoveDown}
                                  onClick={() => void moveAssociationStep(assoc.id, 1)}
                                  aria-label={`خفض ترتيب ${assoc.nameAr}`}
                                  title="نقل للأسفل"
                                  className="rounded border border-slate-300 dark:border-slate-600 p-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              aria-label={`تعديل ${assoc.nameAr}`}
                              onClick={() => setEditing(assoc)}
                              className="rounded border border-slate-300 dark:border-slate-600 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {isAct ? (
                              <button
                                type="button"
                                aria-label={`إيقاف ${assoc.nameAr}`}
                                title="إيقاف (حذف ناعم)"
                                onClick={() => setDeleteTarget(assoc)}
                                className="rounded border border-amber-300 dark:border-amber-800 p-1.5 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                              >
                                <Slash className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                aria-label={`إعادة تفعيل ${assoc.nameAr}`}
                                onClick={() => void reactivateAssociation(assoc.id)}
                                className="inline-flex items-center gap-1 rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100"
                              >
                                <RotateCcw className="w-3 h-3" />
                                إعادة تفعيل
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                disabled={permDeleteOfflineBlocked || countingAssocId === assoc.id}
                                aria-label={`حذف نهائي ${assoc.nameAr}`}
                                title={
                                  permDeleteOfflineBlocked
                                    ? 'الحذف النهائي يتطلب اتصالًا بالإنترنت'
                                    : 'حذف نهائي (يمحو الجمعية وسجلاتها)'
                                }
                                onClick={() => void handleOpenPermanentDelete(assoc)}
                                className="rounded border border-rose-300 dark:border-rose-800 p-1.5 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40"
                              >
                                {countingAssocId === assoc.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Add Modal with Live Preview */}
      {bulkOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-assoc-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3
                  id="bulk-assoc-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100"
                >
                  📋 إضافة جماعية للجمعيات — محافظة {activeGov?.nameAr}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  اكتب اسم كل جمعية في سطر مستقل؛ تُعرض معاينة فورية لاكتشاف المكررات أو الأسماء الأطول من {MAX_ASSOCIATION_NAME_LENGTH} حرفًا قبل الحفظ.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                aria-label="إغلاق نافذة الإضافة الجماعية"
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="block space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                المركز / نقطة التوزيع للدفعة
              </span>
              <select
                value={bulkCenterId}
                onChange={(e) => setBulkCenterId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              >
                {govCenters.length === 0 ? (
                  <option value={defaultCenterForGov}>نقطة توزيع عامة</option>
                ) : (
                  govCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameAr}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                قائمة أسماء الجمعيات (سطر لكل جمعية)
              </span>
              <textarea
                rows={6}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'جمعية السلام الجديدة\nجمعية الأمل الزراعية\nجمعية الرواد بالمحطة'}
                aria-label="قائمة أسماء الجمعيات للإضافة الجماعية"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 p-3 text-xs leading-relaxed focus:border-emerald-600 focus:outline-none"
              />
            </label>

            {/* Live Preview Summary */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  معاينة قبل الحفظ ({formatNumberAr(bulkPreview.items.length)} بند)
                </span>
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                  <span className="rounded px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300">
                    ✔ جديد: {formatNumberAr(bulkPreview.validCount)}
                  </span>
                  <span className="rounded px-2 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300">
                    ⚠ مكرر: {formatNumberAr(bulkPreview.duplicateCount)}
                  </span>
                  <span className="rounded px-2 py-0.5 bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300">
                    ✖ غير صالح: {formatNumberAr(bulkPreview.invalidCount)}
                  </span>
                </div>
              </div>

              {bulkPreview.items.length === 0 ? (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  الصق أو اكتب أسماء الجمعيات أعلاه لعرض المعاينة.
                </p>
              ) : (
                <ul className="max-h-44 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  {bulkPreview.items.map((item) => (
                    <li
                      key={`${item.lineNumber}-${item.rawName}`}
                      className="px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <span className="text-slate-400 font-mono-num ml-2">
                          #{item.lineNumber}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {item.cleanName || item.rawName}
                        </span>
                        {item.reason && (
                          <span className="mr-2 text-[11px] text-slate-500 dark:text-slate-400">
                            — {item.reason}
                          </span>
                        )}
                      </div>
                      {item.status === 'valid_new' ? (
                        <span className="shrink-0 rounded px-2 py-0.5 text-[11px] font-bold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300">
                          ✔ جديدة
                        </span>
                      ) : item.status === 'duplicate_existing' ||
                        item.status === 'duplicate_in_batch' ? (
                        <span className="shrink-0 rounded px-2 py-0.5 text-[11px] font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300">
                          ⚠ مكرر
                        </span>
                      ) : (
                        <span className="shrink-0 rounded px-2 py-0.5 text-[11px] font-bold bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300">
                          ✖ مرفوض
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={savingBulk || bulkPreview.validCount === 0}
                onClick={() => void handleSaveBulk()}
                className="rounded-lg bg-emerald-700 px-5 py-2 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {savingBulk
                  ? 'جارٍ الحفظ...'
                  : `حفظ (${formatNumberAr(bulkPreview.validCount)})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="assoc-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <form
            onSubmit={(e) => void handleSaveEditModal(e)}
            className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3
                id="assoc-modal-title"
                className="text-base font-bold text-slate-900 dark:text-slate-100"
              >
                تعديل بيانات الجمعية
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="إغلاق"
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    اسم الجمعية *
                  </span>
                  <span className="text-[11px] font-mono-num text-slate-400">
                    {(editing.nameAr || '').length} / {MAX_ASSOCIATION_NAME_LENGTH}
                  </span>
                </div>
                <input
                  type="text"
                  required
                  maxLength={MAX_ASSOCIATION_NAME_LENGTH}
                  value={editing.nameAr || ''}
                  onChange={(e) => setEditing({ ...editing, nameAr: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  كود الجمعية
                </span>
                <input
                  type="text"
                  value={editing.code || ''}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num text-left"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  المركز / نقطة التوزيع
                </span>
                <select
                  value={editing.centerId || defaultCenterForGov}
                  onChange={(e) =>
                    setEditing({ ...editing, centerId: e.target.value, villageId: '' })
                  }
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
                >
                  {govCenters.length === 0 ? (
                    <option value={defaultCenterForGov}>نقطة توزيع عامة</option>
                  ) : (
                    govCenters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameAr}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  القرية (اختياري)
                </span>
                <select
                  value={editing.villageId || ''}
                  onChange={(e) => setEditing({ ...editing, villageId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
                >
                  <option value="">غير محدد</option>
                  {villages
                    .filter((v) => v.centerId === editing.centerId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nameAr}
                      </option>
                    ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  مدير الجمعية
                </span>
                <input
                  type="text"
                  value={editing.managerName || ''}
                  onChange={(e) => setEditing({ ...editing, managerName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
                />
              </label>

              <label className="space-y-1">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  هاتف المدير
                </span>
                <input
                  type="text"
                  value={editing.managerPhone || ''}
                  onChange={(e) => setEditing({ ...editing, managerPhone: e.target.value })}
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num text-left"
                />
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  ملاحظات
                </span>
                <input
                  type="text"
                  value={editing.notes || ''}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  placeholder="ملاحظات إدارية اختيارية..."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-5 py-2 font-bold text-white hover:bg-emerald-800"
              >
                حفظ التعديلات
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="تأكيد إيقاف الجمعية (حذف ناعم)"
        message={`هل تريد إيقاف جمعية «${deleteTarget?.nameAr || ''}» (${deleteTarget?.code || ''})؟ لن تظهر في كشوف الصرف الجديدة، مع بقاء كافة سجلات الأيام السابقة محفوظة وإمكانية إعادة تفعيلها لاحقًا.`}
        confirmLabel="إيقاف الجمعية"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            void deactivateAssociation(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(permDeleteTarget && permDeleteCounts)}
        title="تأكيد الحذف النهائي للجمعية"
        message={
          permDeleteTarget && permDeleteCounts
            ? permDeleteCounts.total === 0
              ? `هل تريد الحذف النهائي لجمعية «${permDeleteTarget.nameAr}» (${permDeleteTarget.code})؟\nلا توجد أي سجلات صرف أو جرارات أو مرفقات مرتبطة بهذه الجمعية. لا يمكن التراجع عن هذا الإجراء.`
              : `أنت على وشك الحذف النهائي لجمعية «${permDeleteTarget.nameAr}» (${permDeleteTarget.code}).\nالسجلات المرتبطة التي سيتم حذفها نهائيًا:\n• بنود الصرف اليومي (daily_disbursements): ${formatNumberAr(permDeleteCounts.disbursements)}\n• شحنات الجرارات (tractor_deliveries): ${formatNumberAr(permDeleteCounts.tractors)}\n• مرفقات تحليل الصور (images_attachments): ${formatNumberAr(permDeleteCounts.attachments)}`
            : ''
        }
        warningNote={
          permDeleteCounts && permDeleteCounts.total > 0
            ? 'تحذير: الحذف النهائي يمحو تاريخ أرصدة الجمعية وسجلاتها بالكامل ولا يمكن التراجع عنه. يُنصح بشدة بتصدير نسخة احتياطية JSON أولًا من صفحة «الإدارة والتدقيق» قبل المتابعة.'
            : undefined
        }
        errorMessage={permDeleteError}
        confirmTextExpected={
          permDeleteCounts && permDeleteCounts.total > 0 ? permDeleteTarget?.nameAr : undefined
        }
        confirmTextLabel={
          permDeleteTarget
            ? `للتأكيد النهائي اكتب اسم الجمعية بالضبط: «${permDeleteTarget.nameAr}»`
            : undefined
        }
        confirmTextPlaceholder={permDeleteTarget?.nameAr}
        confirmLabel={
          isPermDeleting
            ? 'جارٍ الحذف النهائي...'
            : permDeleteError
              ? 'إعادة المحاولة'
              : 'حذف نهائي'
        }
        isSubmitting={isPermDeleting}
        onCancel={() => {
          if (!isPermDeleting) {
            setPermDeleteTarget(null);
            setPermDeleteCounts(null);
            setPermDeleteError(null);
          }
        }}
        onConfirm={() => void handleConfirmPermanentDelete()}
      />
    </div>
  );
};
