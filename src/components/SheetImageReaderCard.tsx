import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Loader2,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { OcrClientError, useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import type {
  AgriculturalAssociation,
  SheetOcrExtractedRow,
  SheetSectionType,
} from '../types/domain.ts';
import { matchAssociationName } from '../utils/arabicNormalize.ts';
import { resizeImageForUpload, rotateImageDataUrl } from '../utils/imageResize.ts';

interface SheetImageReaderCardProps {
  governorateId: string;
  associations: AgriculturalAssociation[];
  onApplyRows: (rows: SheetOcrExtractedRow[], sectionType: SheetSectionType) => void;
}

interface QueuedPage {
  id: string;
  name: string;
  dataUrl: string;
  base64: string;
  mimeType: 'image/jpeg';
}

const MODE_LABELS: Array<{ id: SheetSectionType; label: string }> = [
  { id: 'full_sheet', label: 'كشف كامل' },
  { id: 'opening', label: 'بداية اليوم' },
  { id: 'closing', label: 'نهاية اليوم' },
  { id: 'settlement', label: 'التسوية' },
];

export const SheetImageReaderCard: React.FC<SheetImageReaderCardProps> = ({
  governorateId,
  associations,
  onApplyRows,
}) => {
  const { authMode } = useAuth();
  const { extractSheetNumbers, pushToast } = useAppData();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sectionType, setSectionType] = useState<SheetSectionType>('full_sheet');
  const [pages, setPages] = useState<QueuedPage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rawResponseText, setRawResponseText] = useState<string>('');
  const [showRawDebug, setShowRawDebug] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [summaryNote, setSummaryNote] = useState('');
  const [extractedRows, setExtractedRows] = useState<SheetOcrExtractedRow[]>([]);

  const analyzePages = async (targetPages: QueuedPage[], mode: SheetSectionType) => {
    if (targetPages.length === 0) return;
    setErrorMessage(null);
    setRawResponseText('');
    setIsProcessing(true);

    try {
      if (authMode !== 'firebase') {
        throw new OcrClientError(
          'تشغيل قراءة Gemini Vision OCR الفعلية يتطلب تسجيل الدخول بحساب Google المعتمد. يمكنك تدوير الصور المرفوعة أو الضغط على «نموذج مراجعة تجريبي» لاختبار جدول المراجعة.',
          'PREVIEW_MODE',
        );
      }

      const mergedRows: SheetOcrExtractedRow[] = [];
      const rawChunks: string[] = [];
      const notes: string[] = [];

      for (let pIdx = 0; pIdx < targetPages.length; pIdx++) {
        const page = targetPages[pIdx];
        const res = await extractSheetNumbers({
          imageBase64: page.base64,
          mimeType: page.mimeType,
          sectionType: mode,
          governorateId,
        });
        if (res.summaryNote) notes.push(`صفحة ${pIdx + 1}: ${res.summaryNote}`);
        if (res.rawResponseText) rawChunks.push(`--- صفحة ${pIdx + 1} ---\n${res.rawResponseText}`);

        for (const row of res.rows) {
          mergedRows.push({
            ...row,
            rowIndex: mergedRows.length + 1,
            pageNumber: pIdx + 1,
          });
        }
      }

      // Cross-page duplicate association check
      const seenAssocs = new Map<string, number>();
      for (const r of mergedRows) {
        if (r.matchedAssociationId) {
          seenAssocs.set(r.matchedAssociationId, (seenAssocs.get(r.matchedAssociationId) || 0) + 1);
        }
      }
      const normalizedMerged = mergedRows.map((r) => {
        const dup = Boolean(r.matchedAssociationId && (seenAssocs.get(r.matchedAssociationId) || 0) > 1);
        const needsReview = r.needsReview || dup;
        return {
          ...r,
          duplicateAssociationWarning: dup,
          needsReview,
          include: !needsReview,
        };
      });

      setExtractedRows(normalizedMerged);
      setSummaryNote(notes.join(' | ') || 'تمت قراءة الصور بنجاح.');
      setRawResponseText(rawChunks.join('\n\n'));
      setReviewOpen(true);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'تعذرت قراءة الصورة.';
      if (error instanceof OcrClientError && error.rawResponseText) {
        setRawResponseText(error.rawResponseText);
      }
      setErrorMessage(msg);
      pushToast({ type: 'error', title: 'تنبيه القراءة الذكية', description: msg });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFilesSelected = async (fileList: FileList) => {
    setErrorMessage(null);
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setIsProcessing(true);
    try {
      const converted: QueuedPage[] = [];
      for (let i = 0; i < files.length; i++) {
        const resized = await resizeImageForUpload(files[i]);
        converted.push({
          id: `pg-${Date.now()}-${i}`,
          name: files[i].name || `صفحة ${i + 1}`,
          dataUrl: resized.dataUrl,
          base64: resized.base64,
          mimeType: resized.mimeType,
        });
      }
      const nextPages = [...pages, ...converted];
      setPages(nextPages);
      setActivePageIndex(nextPages.length - converted.length);
      await analyzePages(nextPages, sectionType);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'تعذرت معالجة الصور المحددة.';
      setErrorMessage(msg);
      pushToast({ type: 'error', title: 'خطأ في الصورة', description: msg });
      setIsProcessing(false);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRotatePage = async (index: number, degrees: 90 | -90) => {
    const target = pages[index];
    if (!target) return;
    const rotated = await rotateImageDataUrl(target.dataUrl, degrees, 0.9);
    setPages((prev) =>
      prev.map((p, i) =>
        i === index ? { ...p, dataUrl: rotated.dataUrl, base64: rotated.base64 } : p,
      ),
    );
  };

  const openSampleReviewFixture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 920;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.strokeRect(18, 18, 884, 384);
      ctx.fillStyle = '#065f46';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('كشف الصرف اليومي — نموذج اختبار المراجعة الضوئية', 220, 62);
      ctx.fillStyle = '#0f172a';
      ctx.font = '18px sans-serif';
      ctx.fillText('1) صف واضح: بداية 420 · نهاية 310 · المنصرف 110 · التسوية 110', 80, 140);
      ctx.fillText('2) صف للمراجعة: بداية 380 · نهاية [غير واضح] · التسوية 180', 80, 200);
    }
    const sampleUrl = canvas.toDataURL('image/jpeg', 0.9);
    setPages([
      {
        id: 'sample-pg-1',
        name: 'نموذج-كشف-يومي.jpg',
        dataUrl: sampleUrl,
        base64: sampleUrl.split(',')[1] || '',
        mimeType: 'image/jpeg',
      },
    ]);
    setActivePageIndex(0);

    const firstAssoc = associations[0]?.nameAr || 'جمعية 1';
    const secondAssoc = associations[1]?.nameAr || 'جمعية 2';
    const m1 = matchAssociationName(firstAssoc, associations);
    const m2 = matchAssociationName(secondAssoc, associations);

    const sampleRows: SheetOcrExtractedRow[] = [
      {
        rowIndex: 1,
        pageNumber: 1,
        extractedName: firstAssoc,
        matchedAssociationId: m1.associationId,
        matchConfidence: m1.confidence,
        ureaOpening: 420,
        ureaClosing: 310,
        ureaSettlement: 110,
        ureaExtractedDisbursed: 110,
        nitrateOpening: 260,
        nitrateClosing: 185,
        nitrateSettlement: 75,
        nitrateExtractedDisbursed: 75,
        sulfateOpening: 110,
        sulfateClosing: 80,
        sulfateSettlement: 30,
        sulfateExtractedDisbursed: 30,
        disbursedMismatchWarnings: [],
        duplicateAssociationWarning: false,
        confidence: 0.96,
        needsReview: false,
        include: true,
      },
      {
        rowIndex: 2,
        pageNumber: 1,
        extractedName: secondAssoc,
        matchedAssociationId: m2.associationId,
        matchConfidence: m2.confidence,
        ureaOpening: 380,
        ureaClosing: null,
        ureaSettlement: 180,
        ureaExtractedDisbursed: 200,
        nitrateOpening: 190,
        nitrateClosing: 130,
        nitrateSettlement: 55,
        nitrateExtractedDisbursed: 65,
        sulfateOpening: null,
        sulfateClosing: 70,
        sulfateSettlement: 20,
        sulfateExtractedDisbursed: null,
        disbursedMismatchWarnings: ['نترات: المنصرف المقروء (65) يختلف عن (بداية − نهاية) = 60'],
        duplicateAssociationWarning: false,
        confidence: 0.72,
        needsReview: true,
        include: false,
        notes: 'تحتوي على خانات غير واضحة واختلاف في عمود المنصرف — تم إلغاء تحديدها تلقائيًا للمراجعة',
      },
    ];
    setExtractedRows(sampleRows);
    setSummaryNote('نموذج مراجعة تجريبي — الصف الأول جاهز والصف الثاني معلّم «⚠ راجع» وغير محدد تلقائيًا.');
    setRawResponseText(JSON.stringify({ rows: sampleRows }, null, 2));
    setReviewOpen(true);
  };

  const updateRowField = (
    idx: number,
    field: keyof SheetOcrExtractedRow,
    value: string | number | boolean | null,
  ) => {
    setExtractedRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)),
    );
  };

  const parseNullableInput = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };

  const handleConfirmInsert = () => {
    const selected = extractedRows.filter((r) => r.include && r.matchedAssociationId);
    if (selected.length === 0) {
      pushToast({
        type: 'warning',
        title: 'لم يتم تحديد صفوف صالحة',
        description: 'حدد صفًا واحدًا على الأقل مع اختيار الجمعية المطابقة له.',
      });
      return;
    }
    onApplyRows(selected, sectionType);
    setReviewOpen(false);
    pushToast({
      type: 'success',
      title: 'تم إدراج البيانات المراجعة',
      description: `تم تطبيق ${selected.length} صف على كشف الصرف اليومي.`,
    });
  };

  const activePage = pages[activePageIndex] || pages[0];

  return (
    <div className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-400">
            <Sparkles className="w-4 h-4" />
            <h3 className="text-sm font-bold">قراءة أرقام كشف الصرف من الصور بالذكاء الاصطناعي (OCR)</h3>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            يدعم رفع عدة صفحات لنفس النوع، تدوير الصور 90°، تحويل صور HEIC، واستخراج RTL الدقيق بترتيب [يوريا، نترات، سلفات] دون تخمين الخانات غير الواضحة.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 4 Clear Section Mode Pills */}
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
            {MODE_LABELS.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setSectionType(mode.id)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors ${
                  sectionType === mode.id
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-700'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleFilesSelected(e.target.files);
              }
            }}
          />

          <button
            type="button"
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Camera className="w-4 h-4" />
            )}
            <span>{isProcessing ? 'جارٍ قراءة الصفحات...' : 'رفع / تصوير صفحات الكشف'}</span>
          </button>

          <button
            type="button"
            onClick={openSampleReviewFixture}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>نموذج مراجعة تجريبي</span>
          </button>
        </div>
      </div>

      {/* Multi-page thumbnails with rotation controls */}
      {pages.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-slate-700 dark:text-slate-200">
              الصفحات المرفوعة ({pages.length}):
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => void analyzePages(pages, sectionType)}
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                إعادة تحليل كل الصفحات ({MODE_LABELS.find((m) => m.id === sectionType)?.label})
              </button>
              <button
                type="button"
                onClick={() => {
                  setPages([]);
                  setExtractedRows([]);
                }}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800"
              >
                تفريغ الصور
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {pages.map((pg, idx) => (
              <div
                key={pg.id}
                className={`rounded-lg border p-2 bg-white dark:bg-slate-900 space-y-1.5 w-36 ${
                  idx === activePageIndex
                    ? 'border-emerald-600 ring-1 ring-emerald-500'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActivePageIndex(idx)}
                  className="w-full h-20 overflow-hidden rounded border border-slate-100 dark:border-slate-800 bg-slate-50"
                >
                  <img src={pg.dataUrl} alt={pg.name} className="w-full h-full object-contain" />
                </button>
                <p className="text-[11px] font-medium truncate text-slate-700 dark:text-slate-300">
                  صفحة {idx + 1}
                </p>
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    title="تدوير 90° يمين"
                    aria-label={`تدوير صفحة ${idx + 1} يمين`}
                    onClick={() => void handleRotatePage(idx, 90)}
                    className="p-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="تدوير 90° يسار"
                    aria-label={`تدوير صفحة ${idx + 1} يسار`}
                    onClick={() => void handleRotatePage(idx, -90)}
                    className="p-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    title="حذف الصفحة"
                    aria-label={`حذف صفحة ${idx + 1}`}
                    onClick={() =>
                      setPages((prev) => prev.filter((item) => item.id !== pg.id))
                    }
                    className="p-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-2"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
            <span>{errorMessage}</span>
          </div>
          {rawResponseText && (
            <div>
              <button
                type="button"
                onClick={() => setShowRawDebug((v) => !v)}
                className="inline-flex items-center gap-1 text-[11px] font-bold underline"
              >
                {showRawDebug ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                عرض الرد الخام للتشخيص
              </button>
              {showRawDebug && (
                <pre
                  dir="ltr"
                  className="mt-2 max-h-48 overflow-auto rounded bg-slate-900 text-slate-100 p-2.5 text-[11px] font-mono"
                >
                  {rawResponseText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mandatory Review Modal */}
      {reviewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sheet-ocr-review-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-3 sm:p-6"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-7xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
              <div>
                <h3 id="sheet-ocr-review-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                  شاشة المراجعة الإلزامية لنتائج القراءة الضوئية (OCR)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{summaryNote}</p>
              </div>
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                aria-label="إغلاق نافذة المراجعة"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5 grid grid-cols-1 xl:grid-cols-12 gap-5">
              {/* Image Preview + Rotation */}
              <div className="xl:col-span-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    الصورة ({activePageIndex + 1} من {Math.max(1, pages.length)})
                  </p>
                  {activePage && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleRotatePage(activePageIndex, 90)}
                        className="rounded border border-slate-300 dark:border-slate-600 p-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                        title="تدوير يمين 90°"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRotatePage(activePageIndex, -90)}
                        className="rounded border border-slate-300 dark:border-slate-600 p-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                        title="تدوير يسار 90°"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 overflow-hidden">
                  {activePage?.dataUrl ? (
                    <img
                      src={activePage.dataUrl}
                      alt="صورة كشف الصرف للمراجعة"
                      referrerPolicy="no-referrer"
                      className="w-full h-auto object-contain max-h-[340px]"
                    />
                  ) : (
                    <div className="p-8 text-center text-xs text-slate-500">لا توجد معاينة صورة</div>
                  )}
                </div>

                {pages.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pages.map((pg, i) => (
                      <button
                        key={pg.id}
                        type="button"
                        onClick={() => setActivePageIndex(i)}
                        className={`rounded px-2 py-1 text-[11px] font-bold border ${
                          i === activePageIndex
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        صفحة {i + 1}
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  الخانات باللون الأصفر غير واضحة ولم تُخمَّن. الصفوف المعلّمة بـ «⚠ راجع» أُلغي تحديدها تلقائيًا حتى تراجعها وتؤكد إدراجها.
                </p>

                {/* Collapsible Raw Response Debug */}
                {rawResponseText && (
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setShowRawDebug((v) => !v)}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700 dark:text-slate-300"
                      >
                        {showRawDebug ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        عرض الرد الخام
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(rawResponseText);
                          pushToast({ type: 'info', title: 'تم نسخ الرد الخام' });
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400 hover:underline"
                      >
                        <Copy className="w-3 h-3" />
                        نسخ
                      </button>
                    </div>
                    {showRawDebug && (
                      <pre
                        dir="ltr"
                        className="max-h-40 overflow-auto rounded bg-slate-900 text-slate-100 p-2 text-[10px] font-mono"
                      >
                        {rawResponseText}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              {/* Editable Review Table */}
              <div className="xl:col-span-9 space-y-2 overflow-x-auto">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                  <span>رموز الحقول داخل كل صنف: ب = بداية اليوم · ن = نهاية اليوم · ت = التسوية</span>
                  <span>الترتيب المعتمد: يوريا ← نترات ← سلفات</span>
                </div>
                <table className="w-full text-xs border-collapse border border-slate-200 dark:border-slate-700">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                      <th className="border border-slate-200 dark:border-slate-700 px-1.5 py-2 text-center">إدراج</th>
                      <th className="border border-slate-200 dark:border-slate-700 px-2 py-2 text-right">الاسم المقروء</th>
                      <th className="border border-slate-200 dark:border-slate-700 px-2 py-2 text-right">الجمعية المطابقة</th>
                      <th className="border border-slate-200 dark:border-slate-700 px-1.5 py-2 text-center">يوريا (ب/ن/ت)</th>
                      <th className="border border-slate-200 dark:border-slate-700 px-1.5 py-2 text-center">نترات (ب/ن/ت)</th>
                      <th className="border border-slate-200 dark:border-slate-700 px-1.5 py-2 text-center">سلفات (ب/ن/ت)</th>
                      <th className="border border-slate-200 dark:border-slate-700 px-1.5 py-2 text-center">المراجعة والثقة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extractedRows.map((row, idx) => {
                      const flagged =
                        row.needsReview ||
                        !row.matchedAssociationId ||
                        Boolean(row.duplicateAssociationWarning) ||
                        Boolean(row.disbursedMismatchWarnings?.length);
                      return (
                        <tr
                          key={`${row.rowIndex}-${idx}`}
                          className={
                            flagged
                              ? 'bg-amber-50/40 dark:bg-amber-950/20'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }
                        >
                          <td className="border border-slate-200 dark:border-slate-700 px-1.5 py-2 text-center">
                            <input
                              type="checkbox"
                              aria-label={`إدراج الصف ${row.rowIndex}`}
                              checked={row.include}
                              onChange={(e) => updateRowField(idx, 'include', e.target.checked)}
                              className="w-4 h-4 accent-emerald-700"
                            />
                          </td>
                          <td className="border border-slate-200 dark:border-slate-700 px-2 py-2 font-medium text-slate-800 dark:text-slate-200 min-w-[100px]">
                            <div>{row.extractedName}</div>
                            {row.pageNumber && (
                              <span className="text-[10px] text-slate-500">صفحة {row.pageNumber}</span>
                            )}
                            {row.duplicateAssociationWarning && (
                              <div className="text-[10px] text-rose-700 dark:text-rose-400 font-bold mt-0.5">
                                ⚠ جمعية مكررة
                              </div>
                            )}
                            {row.disbursedMismatchWarnings?.map((w, wi) => (
                              <div key={wi} className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                ⚠ {w}
                              </div>
                            ))}
                          </td>
                          <td className="border border-slate-200 dark:border-slate-700 px-2 py-2 min-w-[150px]">
                            <select
                              aria-label={`مطابقة الجمعية للصف ${row.rowIndex}`}
                              value={row.matchedAssociationId || ''}
                              onChange={(e) =>
                                updateRowField(idx, 'matchedAssociationId', e.target.value || null)
                              }
                              className={`w-full rounded border px-2 py-1 text-xs ${
                                row.matchedAssociationId
                                  ? 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                                  : 'border-amber-400 bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200'
                              }`}
                            >
                              <option value="">غير مطابق — اختر يدويًا</option>
                              {associations.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.nameAr} ({a.code})
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Urea, Nitrate, Sulfate 3 fields each (ب / ن / ت) */}
                          {(
                            [
                              ['urea', 'يوريا', 'ureaOpening', 'ureaClosing', 'ureaSettlement'],
                              ['nitrate', 'نترات', 'nitrateOpening', 'nitrateClosing', 'nitrateSettlement'],
                              ['sulfate', 'سلفات', 'sulfateOpening', 'sulfateClosing', 'sulfateSettlement'],
                            ] as const
                          ).map(([keyCode, labelAr, fOpen, fClose, fSettle]) => (
                            <td key={keyCode} className="border border-slate-200 dark:border-slate-700 px-1.5 py-1.5">
                              <div className="grid grid-cols-3 gap-1 min-w-[132px]">
                                {(
                                  [
                                    [fOpen, 'ب', 'بداية'],
                                    [fClose, 'ن', 'نهاية'],
                                    [fSettle, 'ت', 'تسوية'],
                                  ] as const
                                ).map(([field, shortLbl, fullLbl]) => {
                                  const val = row[field];
                                  return (
                                    <input
                                      key={field}
                                      type="number"
                                      min={0}
                                      placeholder={shortLbl}
                                      title={`${labelAr} - ${fullLbl}`}
                                      value={val === null ? '' : val}
                                      onChange={(e) =>
                                        updateRowField(idx, field, parseNullableInput(e.target.value))
                                      }
                                      className={`w-full rounded border px-1 py-1 text-center font-mono-num text-[11px] ${
                                        val === null
                                          ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-100'
                                          : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100'
                                      }`}
                                    />
                                  );
                                })}
                              </div>
                            </td>
                          ))}

                          <td className="border border-slate-200 dark:border-slate-700 px-1.5 py-2 text-center min-w-[82px]">
                            <div className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                              {Math.round(row.confidence * 100)}%
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 mt-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                flagged
                                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                              }`}
                            >
                              {flagged ? (
                                <>
                                  <AlertCircle className="w-3 h-3" />
                                  ⚠ راجع
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="w-3 h-3" />
                                  ✔ واضح
                                </>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                لن يتم تعديل بيانات الكشف إلا بعد تأكيد الإدراج من هنا.
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setReviewOpen(false)}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleConfirmInsert}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800"
                >
                  <Check className="w-4 h-4" />
                  إدراج المحدد في الكشف
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
