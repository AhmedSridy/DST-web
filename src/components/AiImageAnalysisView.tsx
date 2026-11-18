import React, { useMemo, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronUp, Copy, FileSearch, Loader2, Save } from 'lucide-react';
import { OcrClientError, useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { getTodayDateIso } from '../data/seedData.ts';
import type { SheetSectionType } from '../types/domain.ts';
import { formatNumberAr } from '../utils/calculations.ts';
import { resizeImageForUpload } from '../utils/imageResize.ts';
import { getVisibleGovernorates } from '../utils/rbac.ts';

export const AiImageAnalysisView: React.FC = () => {
  const { authMode, profile } = useAuth();
  const {
    governorates,
    associations,
    fertilizerTypes,
    disbursements,
    attachments,
    analyzeSingleSheet,
    saveAnalyzedAttachment,
    pushToast,
  } = useAppData();

  const visibleGovs = useMemo(
    () => getVisibleGovernorates(profile, governorates),
    [governorates, profile],
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [govId, setGovId] = useState(visibleGovs[0]?.id || 'gov-ismailia');
  const govAssocs = useMemo(
    () => associations.filter((a) => a.governorateId === govId && a.isActive),
    [associations, govId],
  );
  const [assocId, setAssocId] = useState(govAssocs[0]?.id || '');
  const [fertCode, setFertCode] = useState('urea');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [rawResponseText, setRawResponseText] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  const [analysisResult, setAnalysisResult] = useState<{
    extractedOpeningBalance: number | null;
    extractedClosingBalance: number | null;
    extractedSettlement: number | null;
    confidence: number;
    notes: string;
  } | null>(null);

  const selectedAssoc = useMemo(
    () => associations.find((a) => a.id === assocId) || govAssocs[0],
    [assocId, associations, govAssocs],
  );
  const selectedFert = useMemo(
    () => fertilizerTypes.find((f) => f.code === fertCode) || fertilizerTypes[0],
    [fertCode, fertilizerTypes],
  );

  const lastRecordedBalance = useMemo(() => {
    const match = disbursements.find(
      (d) =>
        d.associationId === (selectedAssoc?.id || '') &&
        d.fertilizerCode === fertCode &&
        d.closingBalance !== null,
    );
    return match?.closingBalance ?? 0;
  }, [disbursements, fertCode, selectedAssoc?.id]);

  const handleImagePicked = async (file: File) => {
    setAnalyzing(true);
    setRawResponseText('');
    setShowRaw(false);
    try {
      const resized = await resizeImageForUpload(file, 1800, 0.9);
      setImageDataUrl(resized.dataUrl);

      if (authMode !== 'firebase') {
        throw new Error(
          'تحليل الكشف الفردي بالذكاء الاصطناعي يتطلب تسجيل الدخول بحساب Google المعتمد. يمكنك تجربة «معاينة تحليل تجريبي» لاختبار سير العمل.',
        );
      }

      const res = await analyzeSingleSheet({
        imageBase64: resized.base64,
        mimeType: resized.mimeType,
        associationId: selectedAssoc?.id || '',
        associationName: selectedAssoc?.nameAr || '',
        fertilizerCode: fertCode,
        fertilizerNameAr: selectedFert?.nameAr || 'يوريا',
        lastRecordedBalance,
      });
      setRawResponseText(res.rawResponseText || '');
      setAnalysisResult({
        extractedOpeningBalance: res.extractedOpeningBalance,
        extractedClosingBalance: res.extractedClosingBalance,
        extractedSettlement: res.extractedSettlement,
        confidence: res.confidence,
        notes: res.notes,
      });
    } catch (error: unknown) {
      if (error instanceof OcrClientError && error.rawResponseText) {
        setRawResponseText(error.rawResponseText);
      }
      pushToast({
        type: 'error',
        title: 'تعذر تحليل الصورة',
        description: error instanceof Error ? error.message : 'حدث خطأ أثناء التحليل.',
      });
    } finally {
      setAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const runSamplePreview = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#065f46';
      ctx.lineWidth = 3;
      ctx.strokeRect(16, 16, 688, 328);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(`كشف مخزون فردي - ${selectedAssoc?.nameAr || ''}`, 180, 65);
      ctx.font = '18px sans-serif';
      ctx.fillText(
        `صنف ${selectedFert?.nameAr || 'يوريا'}: الرصيد الختامي الفعلي = ${lastRecordedBalance + 4} شيكارة`,
        120,
        155,
      );
    }
    setImageDataUrl(canvas.toDataURL('image/jpeg', 0.9));
    setRawResponseText(
      JSON.stringify(
        {
          extractedOpeningBalance: 420,
          extractedClosingBalance: lastRecordedBalance + 4,
          extractedSettlement: 416 - lastRecordedBalance,
          confidence: 0.91,
        },
        null,
        2,
      ),
    );
    setAnalysisResult({
      extractedOpeningBalance: 420,
      extractedClosingBalance: lastRecordedBalance + 4,
      extractedSettlement: Math.max(0, 420 - (lastRecordedBalance + 4)),
      confidence: 0.91,
      notes: '⚠ يوجد اختلاف قدره 4 شكاير بين الرصيد المقروء من صورة الكشف وآخر رصيد مسجل بالنظام.',
    });
  };

  const handleSaveAttachment = async () => {
    if (!analysisResult || !selectedAssoc) return;
    const extractedClose = analysisResult.extractedClosingBalance;
    const discrepancy =
      extractedClose !== null ? Number((extractedClose - lastRecordedBalance).toFixed(2)) : null;

    await saveAnalyzedAttachment({
      associationId: selectedAssoc.id,
      associationName: selectedAssoc.nameAr,
      governorateId: govId,
      reportDate: getTodayDateIso(),
      fertilizerCode: fertCode,
      sectionType: 'full_sheet' as SheetSectionType,
      extractedClosingBalance: extractedClose,
      lastRecordedBalance,
      discrepancy,
      confidence: analysisResult.confidence,
      notes: analysisResult.notes,
      imageDataUrl,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          تحليل صور كشوف المخزون الفردية (AI Vision)
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          ارفع صورة كشف جمعية واحدة لمقارنة الرصيد الختامي المستخرج مع آخر رصيد مسجل وحفظ المرفق بسجل الصور المحللة.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4">
          <div className="space-y-3">
            <div>
              <label htmlFor="ai-gov" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                المحافظة
              </label>
              <select
                id="ai-gov"
                value={govId}
                onChange={(e) => {
                  const nextGov = e.target.value;
                  setGovId(nextGov);
                  const first = associations.find((a) => a.governorateId === nextGov && a.isActive);
                  if (first) setAssocId(first.id);
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              >
                {visibleGovs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nameAr}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ai-assoc" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                الجمعية الزراعية
              </label>
              <select
                id="ai-assoc"
                value={selectedAssoc?.id || ''}
                onChange={(e) => setAssocId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              >
                {govAssocs.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nameAr} ({a.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ai-fert" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                نوع السماد
              </label>
              <select
                id="ai-fert"
                value={fertCode}
                onChange={(e) => setFertCode(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm"
              >
                {fertilizerTypes.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.nameAr}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3.5 py-2.5 flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-300">آخر رصيد ختامي مسجل بالنظام:</span>
              <span className="font-bold font-mono-num text-slate-900 dark:text-slate-100">
                {formatNumberAr(lastRecordedBalance)} شيكارة
              </span>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImagePicked(f);
            }}
          />

          <div className="flex flex-wrap gap-2.5 pt-2">
            <button
              type="button"
              disabled={analyzing}
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              <span>{analyzing ? 'جارٍ التحليل...' : 'رفع وتحليل صورة الكشف'}</span>
            </button>
            <button
              type="button"
              onClick={runSamplePreview}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <FileSearch className="w-4 h-4" />
              <span>معاينة تحليل تجريبي</span>
            </button>
          </div>
        </div>

        {/* Result & Comparison Card */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            نتيجة القراءة والمطابقة مع الرصيد المسجل
          </h3>

          {!analysisResult ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
              اختر الجمعية والصنف ثم ارفع صورة الكشف لعرض المقارنة الفورية هنا.
            </div>
          ) : (
            <div className="space-y-4">
              {imageDataUrl && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-800 max-h-56 flex justify-center">
                  <img
                    src={imageDataUrl}
                    alt="صورة الكشف المحلل"
                    referrerPolicy="no-referrer"
                    className="max-h-56 object-contain"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <span className="text-slate-500 dark:text-slate-400">بداية اليوم</span>
                  <p className="mt-1 font-bold font-mono-num text-sm text-slate-900 dark:text-slate-100">
                    {formatNumberAr(analysisResult.extractedOpeningBalance)}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/40 p-3">
                  <span className="text-emerald-800 dark:text-emerald-300">الختامي المقروء</span>
                  <p className="mt-1 font-bold font-mono-num text-sm text-emerald-900 dark:text-emerald-200">
                    {formatNumberAr(analysisResult.extractedClosingBalance)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <span className="text-slate-500 dark:text-slate-400">التسوية المقروءة</span>
                  <p className="mt-1 font-bold font-mono-num text-sm text-slate-900 dark:text-slate-100">
                    {formatNumberAr(analysisResult.extractedSettlement)}
                  </p>
                </div>
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/40 p-3">
                  <span className="text-amber-800 dark:text-amber-300">فرق المقارنة</span>
                  <p className="mt-1 font-bold font-mono-num text-sm text-amber-900 dark:text-amber-200">
                    {analysisResult.extractedClosingBalance !== null
                      ? formatNumberAr(analysisResult.extractedClosingBalance - lastRecordedBalance)
                      : '—'}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3.5 text-xs text-slate-700 dark:text-slate-300 space-y-1">
                <p className="font-semibold">
                  نسبة الثقة:{' '}
                  <span className="font-mono-num">{Math.round(analysisResult.confidence * 100)}%</span>
                </p>
                <p>{analysisResult.notes}</p>
              </div>

              {rawResponseText && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
                  <button
                    type="button"
                    onClick={() => setShowRaw((v) => !v)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 flex items-center justify-between font-semibold text-slate-700 dark:text-slate-300"
                  >
                    <span>عرض الرد الخام</span>
                    {showRaw ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {showRaw && (
                    <div className="p-3 bg-slate-900 text-slate-100 space-y-2">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(rawResponseText);
                            pushToast({ type: 'info', title: 'تم نسخ الرد الخام' });
                          }}
                          className="inline-flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-[11px] hover:bg-slate-600"
                        >
                          <Copy className="w-3 h-3" />
                          نسخ
                        </button>
                      </div>
                      <pre dir="ltr" className="text-[11px] font-mono overflow-x-auto max-h-40 whitespace-pre-wrap">
                        {rawResponseText}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSaveAttachment()}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800"
                >
                  <Save className="w-4 h-4" />
                  حفظ المرفق في سجل الصور المحللة
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Analyzed History */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          سجل الصور المحللة والمرفقات
        </h3>
        {attachments.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-4">لا توجد صور محفوظة بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                  <th className="px-3 py-2 text-right">الجمعية</th>
                  <th className="px-3 py-2 text-center">التاريخ</th>
                  <th className="px-3 py-2 text-center">المستخرج</th>
                  <th className="px-3 py-2 text-center">المسجل</th>
                  <th className="px-3 py-2 text-center">الفرق</th>
                  <th className="px-3 py-2 text-right">ملاحظات التحليل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {attachments.map((att) => (
                  <tr key={att.id}>
                    <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                      {att.associationName}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono-num">{att.reportDate}</td>
                    <td className="px-3 py-2.5 text-center font-mono-num">
                      {formatNumberAr(att.extractedClosingBalance)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono-num">
                      {formatNumberAr(att.lastRecordedBalance)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono-num font-bold">
                      {formatNumberAr(att.discrepancy)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{att.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
