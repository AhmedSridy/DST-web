import React, { useMemo, useState } from 'react';
import { CheckCircle2, Eye, Plus, Trash2, Truck, Upload, X } from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { getTodayDateIso } from '../data/seedData.ts';
import type { InspectionStatus, ManifestOcrExtractedData, TractorDelivery } from '../types/domain.ts';
import { computeTractorMetrics, formatNumberAr } from '../utils/calculations.ts';
import { resizeImageForUpload } from '../utils/imageResize.ts';
import {
  canDeleteTractorDelivery,
  getVisibleGovernorates,
  hasGranularAccess,
  hasPermission,
} from '../utils/rbac.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { ManifestOcrPanel } from './ManifestOcrPanel.tsx';

const INSPECTION_LABELS_AR: Record<InspectionStatus, string> = {
  matched: '✔ مطابق',
  shortage: '⚠ اختلاف (عجز)',
  surplus: '⚠ اختلاف (زيادة)',
  damaged: '⚠ اختلاف (تلف)',
};

export const TractorsView: React.FC = () => {
  const { profile } = useAuth();
  const {
    governorates,
    centers,
    associations,
    fertilizerTypes,
    tractors,
    settings,
    createTractor,
    approveTractor,
    deleteTractor,
    pushToast,
  } = useAppData();

  const visibleGovs = useMemo(
    () => getVisibleGovernorates(profile, governorates),
    [governorates, profile],
  );
  const visibleGovSet = useMemo(() => new Set(visibleGovs.map((g) => g.id)), [visibleGovs]);

  const [showForm, setShowForm] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ title: string; url: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TractorDelivery | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const [govId, setGovId] = useState(visibleGovs[0]?.id || 'gov-ismailia');
  const govCenters = useMemo(
    () => centers.filter((c) => c.governorateId === govId),
    [centers, govId],
  );
  const [centerId, setCenterId] = useState(() => centers.find((c) => c.governorateId === govId)?.id || '');
  const filteredAssocs = useMemo(
    () =>
      associations.filter(
        (a) => a.governorateId === govId && (!centerId || a.centerId === centerId) && a.isActive,
      ),
    [associations, centerId, govId],
  );

  const [associationId, setAssociationId] = useState(
    () => associations.find((a) => a.governorateId === govId)?.id || '',
  );
  const [tractorPlate, setTractorPlate] = useState('');
  const [arrivalDate, setArrivalDate] = useState(getTodayDateIso());
  const [arrivalTime, setArrivalTime] = useState('09:30');
  const [fertilizerCode, setFertilizerCode] = useState('urea');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [driverNationalId, setDriverNationalId] = useState('');
  const [manifestNumber, setManifestNumber] = useState('');
  const [supplySource, setSupplySource] = useState('');
  const [manifestBags, setManifestBags] = useState<number>(0);
  const [actualBags, setActualBags] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [manifestImageDataUrl, setManifestImageDataUrl] = useState('');
  const [receiptImageDataUrl, setReceiptImageDataUrl] = useState('');
  const [checklist, setChecklist] = useState({
    sealIntact: true,
    bagsDryAndIntact: true,
    manifestMatchesPlate: true,
    weightVerified: true,
  });

  const liveMetrics = useMemo(
    () => computeTractorMetrics(manifestBags, actualBags, !checklist.bagsDryAndIntact),
    [actualBags, checklist.bagsDryAndIntact, manifestBags],
  );

  const visibleTractors = useMemo(
    () => tractors.filter((t) => visibleGovSet.has(t.governorateId)),
    [tractors, visibleGovSet],
  );

  const handleOcrApproveFill = (data: ManifestOcrExtractedData, imgUrl: string) => {
    setShowForm(true);
    if (data.matchedGovernorateId && visibleGovSet.has(data.matchedGovernorateId)) {
      setGovId(data.matchedGovernorateId);
      const firstCtr = centers.find((c) => c.governorateId === data.matchedGovernorateId);
      if (firstCtr) setCenterId(firstCtr.id);
    }
    if (data.matchedAssociationId) {
      const assoc = associations.find((a) => a.id === data.matchedAssociationId);
      if (assoc && visibleGovSet.has(assoc.governorateId)) {
        setGovId(assoc.governorateId);
        setCenterId(assoc.centerId);
        setAssociationId(assoc.id);
      }
    }
    if (data.manifestNumber) setManifestNumber(data.manifestNumber);
    if (data.arrivalDate) setArrivalDate(data.arrivalDate);
    if (data.arrivalTime) setArrivalTime(data.arrivalTime);
    if (data.fertilizerCode) setFertilizerCode(data.fertilizerCode);
    if (data.tractorPlate) setTractorPlate(data.tractorPlate);
    if (data.driverName) setDriverName(data.driverName);
    if (data.driverPhone) setDriverPhone(data.driverPhone);
    if (data.driverNationalId) setDriverNationalId(data.driverNationalId);
    if (data.supplySource) setSupplySource(data.supplySource);
    if (data.manifestBags !== null) {
      setManifestBags(data.manifestBags);
      if (actualBags === 0) setActualBags(data.manifestBags);
    }
    if (imgUrl) setManifestImageDataUrl(imgUrl);
  };

  const handleAttachmentUpload = async (file: File, kind: 'manifest' | 'receipt') => {
    const resized = await resizeImageForUpload(file, 1800, 0.9);
    if (kind === 'manifest') setManifestImageDataUrl(resized.dataUrl);
    else setReceiptImageDataUrl(resized.dataUrl);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tractorPlate.trim() || !manifestNumber.trim() || !associationId) {
      pushToast({
        type: 'error',
        title: 'بيانات ناقصة',
        description: 'يرجى إدخال رقم الجرار ورقم البوليصة واختيار الجمعية المستلمة.',
      });
      return;
    }

    try {
      await createTractor({
        governorateId: govId,
        centerId,
        associationId,
        tractorPlate,
        arrivalDate,
        arrivalTime,
        fertilizerCode,
        driverName,
        driverPhone,
        driverNationalId,
        manifestNumber,
        supplySource,
        manifestBags,
        actualBags,
        checklist,
        manifestImageDataUrl: manifestImageDataUrl || undefined,
        receiptImageDataUrl: receiptImageDataUrl || undefined,
        notes,
      });
      setShowForm(false);
      setTractorPlate('');
      setManifestNumber('');
      setManifestBags(0);
      setActualBags(0);
      setDriverName('');
      setDriverPhone('');
      setDriverNationalId('');
      setNotes('');
      setManifestImageDataUrl('');
      setReceiptImageDataUrl('');
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر تسجيل الجرار',
        description: error instanceof Error ? error.message : 'تحقق من الحقول المدخلة.',
      });
    }
  };

  const canCreate =
    hasPermission(profile?.role, 'create_tractor') && hasGranularAccess(profile, 'canEdit');
  const canApprove = hasPermission(profile?.role, 'approve_tractor');

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteTractor(deleteTarget.id, deleteReason);
      setDeleteTarget(null);
      setDeleteReason('');
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر حذف بيانات الجرار',
        description: error instanceof Error ? error.message : 'تحقق من الصلاحيات وحالة الاتصال.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            إدارة الجرارات الواردة والبوليصات
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            تسجيل وفحص الشحنات ومطابقة العدد الفعلي مع عدد البوليصة (فرق الشحنة = العدد الفعلي − عدد البوليصة)
          </p>
        </div>

        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            <ManifestOcrPanel onApproveFill={handleOcrApproveFill} />
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              {showForm ? 'إغلاق النموذج' : 'تسجيل جرار جديد'}
            </button>
          </div>
        )}
      </div>

      {/* Registration Form */}
      {showForm && canCreate && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              نموذج تسجيل وفحص جرار وارد
            </h3>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              فرق الشحنة:{' '}
              <span className="font-mono-num font-bold text-slate-900 dark:text-slate-100">
                {formatNumberAr(liveMetrics.bagVariance)}
              </span>{' '}
              ({INSPECTION_LABELS_AR[liveMetrics.inspectionStatus]})
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">المحافظة</span>
              <select
                value={govId}
                onChange={(e) => {
                  const next = e.target.value;
                  setGovId(next);
                  const ctr = centers.find((c) => c.governorateId === next);
                  setCenterId(ctr?.id || '');
                  const asc = associations.find((a) => a.governorateId === next && a.isActive);
                  setAssociationId(asc?.id || '');
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              >
                {visibleGovs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nameAr}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">المركز</span>
              <select
                value={centerId}
                onChange={(e) => {
                  setCenterId(e.target.value);
                  const asc = associations.find((a) => a.centerId === e.target.value && a.isActive);
                  if (asc) setAssociationId(asc.id);
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              >
                <option value="">الكل</option>
                {govCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameAr}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">الجمعية المستلمة</span>
              <select
                value={associationId}
                onChange={(e) => setAssociationId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              >
                {(filteredAssocs.length
                  ? filteredAssocs
                  : associations.filter((a) => a.governorateId === govId && a.isActive)
                ).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nameAr}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">نوع السماد</span>
              <select
                value={fertilizerCode}
                onChange={(e) => setFertilizerCode(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              >
                {fertilizerTypes.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.nameAr}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">رقم الجرار / السيارة *</span>
              <input
                type="text"
                required
                value={tractorPlate}
                onChange={(e) => setTractorPlate(e.target.value)}
                placeholder="مثال: ط ص م 4821"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">رقم البوليصة *</span>
              <input
                type="text"
                required
                value={manifestNumber}
                onChange={(e) => setManifestNumber(e.target.value)}
                placeholder="BL-2026-..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">تاريخ الوصول</span>
              <input
                type="date"
                value={arrivalDate}
                onChange={(e) => setArrivalDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">وقت الوصول</span>
              <input
                type="text"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">عدد البوليصة (شيكارة)</span>
              <input
                type="number"
                min={0}
                value={manifestBags}
                onChange={(e) => setManifestBags(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">العدد الفعلي المستلم</span>
              <input
                type="number"
                min={0}
                value={actualBags}
                onChange={(e) => setActualBags(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">اسم السائق</span>
              <input
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">هاتف السائق</span>
              <input
                type="text"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                الرقم القومي للسائق {settings.requireDriverNationalId ? '*' : '(اختياري)'}
              </span>
              <input
                type="text"
                required={settings.requireDriverNationalId}
                value={driverNationalId}
                onChange={(e) => setDriverNationalId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num"
              />
            </label>

            <label className="space-y-1 sm:col-span-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">جهة التوريد</span>
              <input
                type="text"
                value={supplySource}
                onChange={(e) => setSupplySource(e.target.value)}
                placeholder="مثال: مصنع موبكو للأسمدة"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              />
            </label>

            <label className="space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300">ملاحظات الفحص</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              />
            </label>
          </div>

          {/* Inspection Checklist */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-2">
            <p className="text-xs font-bold text-slate-800 dark:text-slate-200">قائمة التحقق من الاستلام</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
              {(
                [
                  ['sealIntact', 'سلامة الأختام والرصاص'],
                  ['bagsDryAndIntact', 'الشكاير جافة وسليمة دون تلف'],
                  ['manifestMatchesPlate', 'مطابقة اللوحة مع البوليصة'],
                  ['weightVerified', 'تم التحقق من الوزن والعد الفعلي'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={checklist[key]}
                    onChange={(e) =>
                      setChecklist((prev) => ({ ...prev, [key]: e.target.checked }))
                    }
                    className="w-4 h-4 accent-emerald-700"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Attachments */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
              <Upload className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              <span>{manifestImageDataUrl ? 'تم إرفاق صورة البوليصة' : 'إرفاق صورة البوليصة'}</span>
              <input
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleAttachmentUpload(f, 'manifest');
                }}
              />
            </label>

            <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700">
              <Upload className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              <span>{receiptImageDataUrl ? 'تم إرفاق إثبات الاستلام' : 'إرفاق إثبات الاستلام'}</span>
              <input
                type="file"
                accept="image/*,.heic,.heif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleAttachmentUpload(f, 'receipt');
                }}
              />
            </label>

            <button
              type="submit"
              className="mr-auto rounded-lg bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-800"
            >
              حفظ سجل الجرار
            </button>
          </div>
        </form>
      )}

      {/* Tractors Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                <th className="px-3 py-3 text-right">الجرار والبوليصة</th>
                <th className="px-3 py-3 text-right">الجمعية المستلمة</th>
                <th className="px-3 py-3 text-center">الصنف</th>
                <th className="px-3 py-3 text-center">عدد البوليصة</th>
                <th className="px-3 py-3 text-center">العدد الفعلي</th>
                <th className="px-3 py-3 text-center">فرق الشحنة والحالة</th>
                <th className="px-3 py-3 text-center">الاعتماد</th>
                <th className="px-3 py-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleTractors.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    لا توجد شحنات جرارات مسجلة في النطاق المحدد بعد.
                  </td>
                </tr>
              ) : (
                visibleTractors.map((tr) => {
                  const assoc = associations.find((a) => a.id === tr.associationId);
                  const gov = governorates.find((g) => g.id === tr.governorateId);
                  const fert = fertilizerTypes.find((f) => f.code === tr.fertilizerCode);
                  return (
                    <tr key={tr.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-3">
                        <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          <Truck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                          <span>{tr.tractorPlate}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-mono-num">
                          {tr.manifestNumber} · {tr.arrivalDate}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {assoc?.nameAr || tr.associationId}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{gov?.nameAr}</div>
                      </td>
                      <td className="px-3 py-3 text-center font-semibold">
                        {fert?.nameAr || tr.fertilizerCode}
                      </td>
                      <td className="px-3 py-3 text-center font-mono-num">
                        {formatNumberAr(tr.manifestBags)}
                      </td>
                      <td className="px-3 py-3 text-center font-mono-num font-bold text-slate-900 dark:text-slate-100">
                        {formatNumberAr(tr.actualBags)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-block rounded px-2 py-0.5 font-semibold ${
                            tr.inspectionStatus === 'matched'
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {INSPECTION_LABELS_AR[tr.inspectionStatus]} ({formatNumberAr(tr.bagVariance)})
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-block rounded px-2 py-0.5 font-semibold ${
                            tr.approvalState === 'final_approved'
                              ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {tr.approvalState === 'final_approved' ? '✔ معتمد' : 'قيد الانتظار'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          {tr.manifestImageDataUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewImage({
                                  title: `بوليصة ${tr.manifestNumber}`,
                                  url: tr.manifestImageDataUrl!,
                                })
                              }
                              aria-label={`معاينة بوليصة ${tr.manifestNumber}`}
                              className="rounded border border-slate-300 dark:border-slate-600 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {tr.approvalState === 'pending' && canApprove && (
                            <button
                              type="button"
                              onClick={() => void approveTractor(tr.id)}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-800 whitespace-nowrap"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              اعتماد الشحنة
                            </button>
                          )}
                          {canDeleteTractorDelivery(profile, tr) && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteReason('');
                                setDeleteTarget(tr);
                              }}
                              aria-label={`حذف بيانات الجرار ${tr.tractorPlate}`}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              حذف
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manifest Image Preview Modal */}
      {previewImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-2xl w-full p-4 space-y-3 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {previewImage.title}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                aria-label="إغلاق المعاينة"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={previewImage.url}
              alt={previewImage.title}
              referrerPolicy="no-referrer"
              className="w-full max-h-[70vh] object-contain rounded-lg border border-slate-200 dark:border-slate-700"
            />
          </div>
        </div>
      )}

      {/* Permanent Tractor Removal Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="تأكيد إزالة بيانات الجرار"
        message={
          deleteTarget
            ? `سيتم حذف سجل الجرار «${deleteTarget.tractorPlate}» (بوليصة رقم ${deleteTarget.manifestNumber}) نهائيًا من قاعدة البيانات.\nالجمعية: ${associations.find((a) => a.id === deleteTarget.associationId)?.nameAr || deleteTarget.associationId} · الصنف: ${fertilizerTypes.find((f) => f.code === deleteTarget.fertilizerCode)?.nameAr || deleteTarget.fertilizerCode} · العدد الفعلي: ${formatNumberAr(deleteTarget.actualBags)} شيكارة.\nسيتم حفظ نسخة من البيانات في سجل التدقيق.`
            : ''
        }
        warningNote={
          deleteTarget?.approvalState === 'final_approved'
            ? 'تنبيه: هذه الشحنة معتمدة نهائيًا، وإزالتها نهائية ولا يمكن التراجع عنها.'
            : undefined
        }
        reasonLabel="سبب الإزالة (اختياري)"
        reasonPlaceholder="مثال: بوليصة مكررة أو خطأ في إدخال بيانات الشحنة..."
        reasonValue={deleteReason}
        onReasonChange={setDeleteReason}
        confirmLabel={isDeleting ? 'جارٍ الحذف...' : 'حذف نهائي'}
        cancelLabel="إلغاء"
        variant="danger"
        isSubmitting={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (isDeleting) return;
          setDeleteTarget(null);
          setDeleteReason('');
        }}
      />
    </div>
  );
};
