import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  Camera,
  Check,
  Eye,
  Loader2,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { IS_PREVIEW_MODE_ENABLED, useAuth } from '../context/AuthContext.tsx';
import type { ManifestOcrExtractedData } from '../types/domain.ts';
import { tonsToBags } from '../utils/calculations.ts';
import { resizeImageForUpload } from '../utils/imageResize.ts';

interface ManifestOcrPanelProps {
  onApproveFill: (data: ManifestOcrExtractedData, imageDataUrl: string) => void;
}

export const ManifestOcrPanel: React.FC<ManifestOcrPanelProps> = ({ onApproveFill }) => {
  const { authMode } = useAuth();
  const { governorates, associations, fertilizerTypes, extractManifest, pushToast } = useAppData();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [processing, setProcessing] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [zoom, setZoom] = useState(1);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [draft, setDraft] = useState<ManifestOcrExtractedData | null>(null);

  const selectedFert = useMemo(
    () =>
      draft?.fertilizerCode
        ? fertilizerTypes.find((f) => f.code === draft.fertilizerCode) || null
        : null,
    [draft?.fertilizerCode, fertilizerTypes],
  );

  const bagWeightKg = selectedFert?.bagWeightKg;
  const bagsPerTon =
    typeof bagWeightKg === 'number' && Number.isFinite(bagWeightKg) && bagWeightKg > 0
      ? Number((1000 / bagWeightKg).toFixed(2))
      : null;

  const isMissingFertilizer = !draft?.fertilizerCode;
  const isMissingDate = !draft?.arrivalDate?.trim();
  const canApproveDraft = Boolean(draft && !isMissingFertilizer && !isMissingDate);

  const handleFileSelected = async (file: File) => {
    setProcessing(true);
    try {
      const resized = await resizeImageForUpload(file, 1800, 0.9);
      setImageDataUrl(resized.dataUrl);

      if (authMode !== 'firebase') {
        throw new Error(
          'قراءة البوليصة الفعلية عبر Gemini Vision تتطلب تسجيل الدخول بحساب Google المعتمد.',
        );
      }

      const extracted = await extractManifest({
        imageBase64: resized.base64,
        mimeType: resized.mimeType,
      });
      setDraft(extracted);
      setZoom(1);
      setReviewOpen(true);
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تنبيه قراءة البوليصة',
        description: error instanceof Error ? error.message : 'تعذرت قراءة صورة البوليصة.',
      });
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openSampleManifestReview = () => {
    if (!IS_PREVIEW_MODE_ENABLED) return;
    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 520;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.strokeRect(20, 20, 820, 480);
      ctx.fillStyle = '#065f46';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('بوليصة شحن أسمدة زراعية رقم: BL-2026-9042', 200, 72);
      ctx.fillStyle = '#1e293b';
      ctx.font = '18px sans-serif';
      ctx.fillText('المحافظة: الإسماعيلية   |   الجمعية المستلمة: جمعية الضبعية الزراعية', 120, 145);
      ctx.fillText('الصنف: يوريا 46.5%   |   الوزن بالطن: 15 طن', 120, 205);
      ctx.fillText('رقم الجرار / السيارة: ط ص م 5518   |   السائق: علي حسن إبراهيم', 120, 265);
      ctx.fillText('جهة التوريد: مصنع موبكو للأسمدة - دمياط', 120, 325);
    }
    const sampleAssoc =
      associations.find((a) => a.nameAr.includes('الضبعية')) ||
      associations.find((a) => a.governorateId === 'gov-ismailia') ||
      associations[0];
    const url = canvas.toDataURL('image/jpeg', 0.9);
    setImageDataUrl(url);
    setZoom(1);
    setDraft({
      manifestNumber: 'BL-2026-9042',
      arrivalDate: '',
      arrivalTime: '10:30',
      governorateName: 'الإسماعيلية',
      matchedGovernorateId: sampleAssoc?.governorateId || 'gov-ismailia',
      associationName: sampleAssoc?.nameAr || 'الضبعية',
      matchedAssociationId: sampleAssoc?.id || null,
      fertilizerCode: null,
      manifestBags: null,
      weightTons: 15,
      tractorPlate: 'ط ص م 5518',
      driverName: 'علي حسن إبراهيم',
      driverPhone: '01099887766',
      driverNationalId: '28805141901122',
      supplySource: 'مصنع موبكو للأسمدة - دمياط',
      confidence: 0.92,
      warnings: [
        'يجب اختيار نوع السماد وتاريخ الوصول يدويًا قبل الاعتماد.',
        'عدد الشكاير غير مكتوب صراحة؛ استخدم زر تحويل الطن إلى شكاير بعد تحديد الصنف.',
      ],
    });
    setReviewOpen(true);
  };

  const handleConvertTons = () => {
    if (!draft || draft.weightTons === null) return;
    if (!draft.fertilizerCode) {
      pushToast({
        type: 'warning',
        title: 'اختر نوع السماد أولًا',
        description: 'لا يمكن تحويل الطن إلى شكاير قبل تحديد نوع السماد لمعرفة وزن الشيكارة الفعلي.',
      });
      return;
    }
    const converted = tonsToBags(draft.weightTons, bagWeightKg);
    if (converted === null) {
      pushToast({
        type: 'warning',
        title: 'وزن الشيكارة غير معرّف',
        description:
          'لم يُعرَّف وزن الشيكارة (bagWeightKg) لهذا الصنف في إعدادات الأصناف؛ تعذّر التحويل التلقائي ويجب إدخال عدد الشكاير يدويًا.',
      });
      return;
    }
    setDraft({
      ...draft,
      manifestBags: converted,
    });
  };

  const handleApproveAndFill = () => {
    if (!draft) return;
    if (!draft.fertilizerCode || !draft.arrivalDate.trim()) {
      pushToast({
        type: 'warning',
        title: 'حقول إلزامية ناقصة',
        description: 'يجب تحديد نوع السماد وتاريخ الوصول قبل اعتماد وتعبئة بيانات البوليصة.',
      });
      return;
    }
    onApproveFill(draft, imageDataUrl);
    setReviewOpen(false);
    pushToast({
      type: 'success',
      title: 'تمت تعبئة بيانات البوليصة في النموذج',
      description: 'يرجى مراجعة الأعداد الفعلية عند الاستلام ثم حفظ السجل.',
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFileSelected(f);
        }}
      />

      <button
        type="button"
        disabled={processing}
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap"
      >
        {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
        <span>{processing ? 'جارٍ قراءة البوليصة...' : 'قراءة بوليصة بالـ OCR'}</span>
      </button>

      {IS_PREVIEW_MODE_ENABLED && (
        <button
          type="button"
          onClick={openSampleManifestReview}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>نموذج بوليصة تجريبي</span>
        </button>
      )}

      {reviewOpen && draft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manifest-ocr-review-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-6"
        >
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 id="manifest-ocr-review-title" className="text-base font-bold text-slate-900">
                  مراجعة بيانات البوليصة المستخرجة بالـ OCR
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  نسبة الثقة: <span className="font-mono-num font-bold">{Math.round(draft.confidence * 100)}%</span> · لن تُحفظ البيانات إلا بعد الاعتماد والتسجيل
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                aria-label="إغلاق مراجعة البوليصة"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Zoomable Image */}
              <div className="lg:col-span-5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">صورة البوليصة الأصلية</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
                      aria-label="تصغير الصورة"
                      className="p-1.5 rounded border border-slate-200 hover:bg-slate-100"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs font-mono-num px-1.5">{Math.round(zoom * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.25).toFixed(2))))}
                      aria-label="تكبير الصورة"
                      className="p-1.5 rounded border border-slate-200 hover:bg-slate-100"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="border border-slate-200 rounded-xl bg-slate-50 overflow-auto max-h-[430px] p-2">
                  {imageDataUrl ? (
                    <img
                      src={imageDataUrl}
                      alt="معاينة البوليصة"
                      referrerPolicy="no-referrer"
                      style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
                      className="w-full h-auto object-contain transition-transform"
                    />
                  ) : (
                    <p className="text-xs text-slate-500 p-8 text-center">لا توجد صورة</p>
                  )}
                </div>

                {draft.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1 text-xs text-amber-900">
                    {draft.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Editable Extracted Fields */}
              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs content-start">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">رقم البوليصة</span>
                  <input
                    type="text"
                    value={draft.manifestNumber}
                    onChange={(e) => setDraft({ ...draft, manifestNumber: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">رقم لوحة الجرار</span>
                  <input
                    type="text"
                    value={draft.tractorPlate}
                    onChange={(e) => setDraft({ ...draft, tractorPlate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700 flex items-center justify-between">
                    <span>تاريخ الوصول *</span>
                    {isMissingDate && (
                      <span className="text-[11px] font-bold text-rose-700">⚠ مطلوب</span>
                    )}
                  </span>
                  <input
                    type="date"
                    required
                    value={draft.arrivalDate}
                    onChange={(e) => setDraft({ ...draft, arrivalDate: e.target.value })}
                    className={`w-full rounded-lg border px-3 py-2 font-mono-num ${
                      isMissingDate
                        ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300'
                        : 'border-slate-300 bg-white'
                    }`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">وقت الوصول</span>
                  <input
                    type="text"
                    value={draft.arrivalTime}
                    onChange={(e) => setDraft({ ...draft, arrivalTime: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">المحافظة</span>
                  <select
                    value={draft.matchedGovernorateId || ''}
                    onChange={(e) =>
                      setDraft({ ...draft, matchedGovernorateId: e.target.value || null })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="">اختر المحافظة</option>
                    {governorates.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nameAr}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">الجمعية المستلمة</span>
                  <select
                    value={draft.matchedAssociationId || ''}
                    onChange={(e) =>
                      setDraft({ ...draft, matchedAssociationId: e.target.value || null })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="">اختر الجمعية</option>
                    {associations
                      .filter(
                        (a) =>
                          !draft.matchedGovernorateId ||
                          a.governorateId === draft.matchedGovernorateId,
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nameAr} ({a.code})
                        </option>
                      ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700 flex items-center justify-between">
                    <span>نوع السماد *</span>
                    {isMissingFertilizer && (
                      <span className="text-[11px] font-bold text-rose-700">⚠ غير محدد</span>
                    )}
                  </span>
                  <select
                    required
                    value={draft.fertilizerCode || ''}
                    onChange={(e) =>
                      setDraft({ ...draft, fertilizerCode: e.target.value || null })
                    }
                    className={`w-full rounded-lg border px-3 py-2 ${
                      isMissingFertilizer
                        ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-300'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    <option value="">— اختر نوع السماد —</option>
                    {fertilizerTypes.map((f) => (
                      <option key={f.code} value={f.code}>
                        {f.nameAr} {f.bagWeightKg ? `(${f.bagWeightKg} كجم/شيكارة)` : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">جهة التوريد / المصنع</span>
                  <input
                    type="text"
                    value={draft.supplySource}
                    onChange={(e) => setDraft({ ...draft, supplySource: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>

                <div className="space-y-1">
                  <span className="font-semibold text-slate-700 block">الوزن بالطن</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.weightTons === null ? '' : draft.weightTons}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          weightTons: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num"
                    />
                    <button
                      type="button"
                      disabled={draft.weightTons === null || !draft.fertilizerCode}
                      onClick={handleConvertTons}
                      title={
                        bagsPerTon
                          ? `تحويل بناءً على وزن الشيكارة (${bagWeightKg} كجم = ${bagsPerTon} شيكارة/طن)`
                          : 'حدد نوع السماد أولًا لحساب معامل التحويل من وزن الشيكارة'
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-300 px-2.5 py-2 text-[11px] font-bold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Calculator className="w-3.5 h-3.5" />
                      {bagsPerTon ? `تحويل لشكاير (×${bagsPerTon})` : 'تحويل لشكاير'}
                    </button>
                  </div>
                </div>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">عدد شكاير البوليصة</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="غير محدد"
                    value={draft.manifestBags === null ? '' : draft.manifestBags}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        manifestBags: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className={`w-full rounded-lg border px-3 py-2 font-mono-num ${
                      draft.manifestBags === null
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-slate-300 bg-white'
                    }`}
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">اسم السائق</span>
                  <input
                    type="text"
                    value={draft.driverName}
                    onChange={(e) => setDraft({ ...draft, driverName: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-700">هاتف السائق</span>
                  <input
                    type="text"
                    value={draft.driverPhone}
                    onChange={(e) => setDraft({ ...draft, driverPhone: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-slate-700">الرقم القومي للسائق</span>
                  <input
                    type="text"
                    value={draft.driverNationalId}
                    onChange={(e) => setDraft({ ...draft, driverNationalId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-num"
                  />
                </label>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5">
              <div className="text-xs font-semibold text-rose-700">
                {!canApproveDraft && (
                  <span>
                    ⚠ لا يمكن الاعتماد قبل تحديد:{' '}
                    {[
                      isMissingFertilizer ? 'نوع السماد' : '',
                      isMissingDate ? 'تاريخ الوصول' : '',
                    ]
                      .filter(Boolean)
                      .join(' و')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setReviewOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={!canApproveDraft}
                  onClick={handleApproveAndFill}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Check className="w-4 h-4" />
                  اعتماد وتعبئة البيانات في النموذج
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
