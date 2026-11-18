import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  Printer,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { getTodayDateIso } from '../data/seedData.ts';
import type {
  DeletedDaySnapshot,
  ExportFormat,
  ExportScope,
  SheetOcrExtractedRow,
  SheetSectionType,
} from '../types/domain.ts';
import { computeBalancesReport, isRowRecorded } from '../utils/analytics.ts';
import {
  isAssociationVisibleOnDate,
  normalizeArabicName,
  parseArabicDigits,
  sortAssociationsByOrder,
} from '../utils/arabicNormalize.ts';
import { computeDisbursementRow, formatNumberAr } from '../utils/calculations.ts';
import {
  exportToExcel,
  exportToPdf,
  exportToWord,
  type SheetExportRowInput,
} from '../utils/exportDocuments.ts';
import {
  getVisibleGovernorates,
  hasGranularAccess,
  STATUS_LABELS_AR,
} from '../utils/rbac.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { ExportModal } from './ExportModal.tsx';
import { SheetImageReaderCard } from './SheetImageReaderCard.tsx';

interface EditableCellState {
  openingBalance: number | null;
  closingBalance: number | null;
  settlementQty: number | null;
  varianceReason: string;
}

const EMPTY_CELL: EditableCellState = {
  openingBalance: null,
  closingBalance: null,
  settlementQty: null,
  varianceReason: '',
};

const FERT_ORDER: ReadonlyArray<{ code: 'urea' | 'nitrate' | 'sulfate'; nameAr: string }> = [
  { code: 'urea', nameAr: 'يوريا' },
  { code: 'nitrate', nameAr: 'نترات' },
  { code: 'sulfate', nameAr: 'سلفات' },
];

type NumericFieldKey = 'openingBalance' | 'closingBalance' | 'settlementQty';

interface DailyDisbursementSheetProps {
  onManageAssociations?: (governorateId: string) => void;
}

export const DailyDisbursementSheet: React.FC<DailyDisbursementSheetProps> = ({
  onManageAssociations,
}) => {
  const { profile } = useAuth();
  const {
    governorates,
    centers,
    associations,
    fertilizerTypes,
    reports,
    disbursements,
    tractors,
    settings,
    saveDisbursementsBatch,
    clearDayRecords,
    restoreDayRecords,
    transitionReportStatus,
    pushToast,
  } = useAppData();

  const visibleGovernorates = useMemo(
    () => getVisibleGovernorates(profile, governorates),
    [governorates, profile],
  );

  const [selectedGovId, setSelectedGovId] = useState<string>(
    () => visibleGovernorates[0]?.id || 'gov-ismailia',
  );
  const [selectedCenterFilter, setSelectedCenterFilter] = useState<string>('all');
  const [assocSearch, setAssocSearch] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateIso());
  const [saving, setSaving] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<DeletedDaySnapshot | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState<number>(0);
  const [activeRawInput, setActiveRawInput] = useState<{ key: string; raw: string } | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (visibleGovernorates.length > 0 && !visibleGovernorates.some((g) => g.id === selectedGovId)) {
      setSelectedGovId(visibleGovernorates[0].id);
    }
  }, [selectedGovId, visibleGovernorates]);

  useEffect(() => {
    if (undoSecondsLeft <= 0) {
      if (undoSnapshot) setUndoSnapshot(null);
      return;
    }
    undoTimerRef.current = window.setTimeout(() => {
      setUndoSecondsLeft((s) => s - 1);
    }, 1000);
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    };
  }, [undoSecondsLeft, undoSnapshot]);

  const currentReportId = `rep-${selectedGovId}-${selectedDate}`;
  const currentReport = useMemo(
    () => reports.find((r) => r.id === currentReportId),
    [currentReportId, reports],
  );

  const govCenters = useMemo(
    () => centers.filter((c) => c.governorateId === selectedGovId && c.isActive),
    [centers, selectedGovId],
  );

  const recordedAssocIdsForDay = useMemo(() => {
    const set = new Set<string>();
    for (const d of disbursements) {
      if (d.reportId !== currentReportId) continue;
      if (isRowRecorded(d) || (d.varianceReason || '').trim() !== '') {
        set.add(d.associationId);
      }
    }
    return set;
  }, [currentReportId, disbursements]);

  // Date-aware, sortOrder-respected list of associations for this governorate + date
  const dayAssociations = useMemo(
    () =>
      sortAssociationsByOrder(
        associations.filter(
          (a) =>
            a.governorateId === selectedGovId &&
            isAssociationVisibleOnDate(a, selectedDate, recordedAssocIdsForDay),
        ),
      ),
    [associations, recordedAssocIdsForDay, selectedDate, selectedGovId],
  );

  const visibleAssociations = useMemo(() => {
    const q = normalizeArabicName(assocSearch);
    return dayAssociations.filter((a) => {
      if (selectedCenterFilter !== 'all' && a.centerId !== selectedCenterFilter) return false;
      if (q) {
        const hay = `${normalizeArabicName(a.nameAr)} ${normalizeArabicName(a.code)}`;
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [assocSearch, dayAssociations, selectedCenterFilter]);

  const orderedFertilizers = useMemo(() => {
    return FERT_ORDER.map((base) => {
      const found = fertilizerTypes.find((f) => f.code === base.code);
      return found || { id: base.code, code: base.code, nameAr: base.nameAr, unit: 'شيكارة', weightKg: 50, isActive: true };
    });
  }, [fertilizerTypes]);

  const [draftCells, setDraftCells] = useState<Record<string, EditableCellState>>({});

  useEffect(() => {
    const map: Record<string, EditableCellState> = {};
    for (const assoc of dayAssociations) {
      for (const fert of orderedFertilizers) {
        const key = `${assoc.id}::${fert.code}`;
        const existing = disbursements.find(
          (d) =>
            d.reportId === currentReportId &&
            d.associationId === assoc.id &&
            d.fertilizerCode === fert.code,
        );
        map[key] = {
          openingBalance: existing?.openingBalance ?? null,
          closingBalance: existing?.closingBalance ?? null,
          settlementQty: existing?.settlementQty ?? null,
          varianceReason: existing?.varianceReason ?? '',
        };
      }
    }
    setDraftCells(map);
    setActiveRawInput(null);
  }, [currentReportId, dayAssociations, disbursements, orderedFertilizers]);

  const canEdit =
    hasGranularAccess(profile, 'canEdit') &&
    (currentReport?.status !== 'approved' || profile?.role === 'admin');
  const canExport = hasGranularAccess(profile, 'canExport');
  const canClearDay =
    hasGranularAccess(profile, 'canClearDay') &&
    (currentReport?.status !== 'approved' || profile?.role === 'admin');
  const canManageAssociations = hasGranularAccess(profile, 'canManageAssociations');

  const handleNumericChange = (
    assocId: string,
    fertCode: string,
    field: NumericFieldKey,
    rawValue: string,
    inputKey: string,
  ) => {
    const normalized = parseArabicDigits(rawValue).trim();
    if (normalized !== '' && !/^\d*(\.\d*)?$/.test(normalized)) {
      return;
    }
    setActiveRawInput({ key: inputKey, raw: rawValue });

    setDraftCells((prev) => {
      const cellKey = `${assocId}::${fertCode}`;
      const cur = prev[cellKey] || { ...EMPTY_CELL };
      if (normalized === '') {
        return { ...prev, [cellKey]: { ...cur, [field]: null } };
      }
      if (normalized === '.') {
        return prev;
      }
      const n = Number(normalized);
      const parsed = Number.isFinite(n) && n >= 0 ? Number(n.toFixed(3)) : null;
      return { ...prev, [cellKey]: { ...cur, [field]: parsed } };
    });
  };

  const getNumericDisplayValue = (
    assocId: string,
    fertCode: string,
    field: NumericFieldKey,
    inputKey: string,
  ): string => {
    if (activeRawInput && activeRawInput.key === inputKey) {
      return activeRawInput.raw;
    }
    const val = draftCells[`${assocId}::${fertCode}`]?.[field];
    return val === null || val === undefined ? '' : String(val);
  };

  const getRowReason = (assocId: string): string => {
    const reasons = orderedFertilizers
      .map((ft) => (draftCells[`${assocId}::${ft.code}`]?.varianceReason || '').trim())
      .filter(Boolean);
    const unique = reasons.filter((v, idx, arr) => arr.indexOf(v) === idx);
    return unique.join(' | ');
  };

  const updateRowReason = (assocId: string, value: string) => {
    setDraftCells((prev) => {
      const next = { ...prev };
      for (const ft of orderedFertilizers) {
        const key = `${assocId}::${ft.code}`;
        const cur = next[key] || { ...EMPTY_CELL };
        next[key] = { ...cur, varianceReason: value };
      }
      return next;
    });
  };

  const handleGridKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colKey: string,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const targetRow = e.shiftKey ? rowIdx - 1 : rowIdx + 1;
      const target = inputRefs.current[`${targetRow}::${colKey}`];
      if (target) {
        target.focus();
        target.select();
      }
    }
  };

  const handleApplyOcrRows = (rows: SheetOcrExtractedRow[], _sectionType: SheetSectionType) => {
    setDraftCells((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        if (!row.matchedAssociationId) continue;
        const applyFert = (
          fertCode: string,
          o: number | null,
          c: number | null,
          s: number | null,
        ) => {
          const key = `${row.matchedAssociationId}::${fertCode}`;
          const cur = next[key] || { ...EMPTY_CELL };
          next[key] = {
            openingBalance: o !== null ? o : cur.openingBalance,
            closingBalance: c !== null ? c : cur.closingBalance,
            settlementQty: s !== null ? s : cur.settlementQty,
            varianceReason: cur.varianceReason,
          };
        };

        applyFert('urea', row.ureaOpening, row.ureaClosing, row.ureaSettlement);
        applyFert('nitrate', row.nitrateOpening, row.nitrateClosing, row.nitrateSettlement);
        applyFert('sulfate', row.sulfateOpening, row.sulfateClosing, row.sulfateSettlement);
      }
      return next;
    });
  };

  const buildPayloadRows = () => {
    const rows: Array<{
      associationId: string;
      fertilizerCode: string;
      openingBalance: number | null;
      closingBalance: number | null;
      settlementQty: number | null;
      varianceReason: string;
    }> = [];

    for (const assoc of dayAssociations) {
      const sharedReason = getRowReason(assoc.id);
      for (const fert of orderedFertilizers) {
        const key = `${assoc.id}::${fert.code}`;
        const cell = draftCells[key] || { ...EMPTY_CELL };
        rows.push({
          associationId: assoc.id,
          fertilizerCode: fert.code,
          openingBalance: cell.openingBalance,
          closingBalance: cell.closingBalance,
          settlementQty: cell.settlementQty,
          varianceReason: cell.varianceReason || sharedReason,
        });
      }
    }
    return rows;
  };

  const handleSaveSheet = async () => {
    const payloadRows = buildPayloadRows();
    for (const row of payloadRows) {
      const calc = computeDisbursementRow(row, settings.treatEmptyAsZero);
      if (calc.hasVariance && !row.varianceReason.trim()) {
        const assoc = dayAssociations.find((a) => a.id === row.associationId);
        const fert = orderedFertilizers.find((f) => f.code === row.fertilizerCode);
        pushToast({
          type: 'error',
          title: 'سبب الفرق مطلوب',
          description: `يوجد فرق تسوية (${calc.variance}) في جمعية ${assoc?.nameAr || ''} (${fert?.nameAr || ''}). يُرجى توضيح السبب قبل الحفظ.`,
        });
        return;
      }
    }

    setSaving(true);
    try {
      await saveDisbursementsBatch({
        governorateId: selectedGovId,
        reportDate: selectedDate,
        rows: payloadRows,
      });
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر حفظ الكشف',
        description: error instanceof Error ? error.message : 'حدث خطأ أثناء الحفظ.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitForReview = async () => {
    await handleSaveSheet();
    try {
      await transitionReportStatus(
        currentReportId,
        'completed',
        'تم استكمال الإدخال والإرسال للمراجعة',
      );
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر تغيير الحالة',
        description: error instanceof Error ? error.message : 'يرجى التحقق من حالة التقرير.',
      });
    }
  };

  const handleClearToday = async () => {
    setClearConfirmOpen(false);
    try {
      const snapshot = await clearDayRecords(selectedGovId, selectedDate);
      setUndoSnapshot(snapshot);
      setUndoSecondsLeft(10);
      pushToast({
        type: 'info',
        title: 'تم مسح سجل اليوم',
        description: 'يمكنك التراجع واستعادة البيانات خلال 10 ثوانٍ.',
      });
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر مسح سجل اليوم',
        description: error instanceof Error ? error.message : 'حدث خطأ غير متوقع.',
      });
    }
  };

  const handleUndoClear = async () => {
    if (!undoSnapshot) return;
    const snap = undoSnapshot;
    setUndoSnapshot(null);
    setUndoSecondsLeft(0);
    await restoreDayRecords(snap);
  };

  const handleExportConfirm = async (format: ExportFormat, scope: ExportScope) => {
    const gov = governorates.find((g) => g.id === selectedGovId) || {
      id: selectedGovId,
      code: selectedGovId,
      nameAr: selectedGovId,
      region: '',
      isActive: true,
    };

    const sheetRows: SheetExportRowInput[] = dayAssociations.map((assoc) => {
      const ctr = centers.find((c) => c.id === assoc.centerId);
      const getCell = (code: string) => draftCells[`${assoc.id}::${code}`] || EMPTY_CELL;
      const u = getCell('urea');
      const n = getCell('nitrate');
      const s = getCell('sulfate');
      const sharedReason = getRowReason(assoc.id);
      return {
        association: assoc,
        centerName: ctr?.nameAr || '',
        urea: {
          opening: u.openingBalance,
          closing: u.closingBalance,
          settlement: u.settlementQty,
          reason: u.varianceReason || sharedReason,
        },
        nitrate: {
          opening: n.openingBalance,
          closing: n.closingBalance,
          settlement: n.settlementQty,
          reason: n.varianceReason || sharedReason,
        },
        sulfate: {
          opening: s.openingBalance,
          closing: s.closingBalance,
          settlement: s.settlementQty,
          reason: s.varianceReason || sharedReason,
        },
      };
    });

    const dayTractors = tractors.filter(
      (t) => t.governorateId === selectedGovId && t.arrivalDate === selectedDate,
    );

    const balancesSummaries = computeBalancesReport({
      governorates: visibleGovernorates,
      associations,
      reports,
      disbursements,
      upToDate: selectedDate,
    }).byGovernorate;

    const exportCtx = {
      organizationNameAr:
        settings.organizationNameAr || 'منظومة DST لإدارة ومراقبة صرف الأسمدة الزراعية',
      governorate: gov,
      reportDate: selectedDate,
      sheetRows,
      tractors: dayTractors,
      balancesSummaries,
      associations,
      centers,
      fertilizerTypes,
      settings,
      treatEmptyAsZero: settings.treatEmptyAsZero,
    };

    try {
      let filename = '';
      if (format === 'xlsx') filename = await exportToExcel(exportCtx);
      else if (format === 'docx') filename = await exportToWord(exportCtx, scope);
      else filename = await exportToPdf(exportCtx, scope);

      pushToast({
        type: 'success',
        title: 'تم تصدير الملف بنجاح',
        description: `الملف: ${filename}`,
      });
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر تصدير الملف',
        description: error instanceof Error ? error.message : 'حدث خطأ أثناء إنشاء الملف.',
      });
    }
  };

  // Logic warnings & completion checklist across all 3 fertilizers
  const sheetDiagnostics = useMemo(() => {
    const incompleteAssocs: Array<{ nameAr: string; missingLabels: string[] }> = [];
    const logicAlerts: string[] = [];

    for (const assoc of dayAssociations) {
      const cells = orderedFertilizers.map((ft) => ({
        fertName: ft.nameAr,
        ...(draftCells[`${assoc.id}::${ft.code}`] || EMPTY_CELL),
      }));

      const hasAnyValue = cells.some(
        (c) => c.openingBalance !== null || c.closingBalance !== null || c.settlementQty !== null,
      );
      if (hasAnyValue) {
        const missingLabels: string[] = [];
        if (cells.every((c) => c.openingBalance === null)) missingLabels.push('بداية اليوم');
        if (cells.every((c) => c.closingBalance === null)) missingLabels.push('نهاية اليوم');
        if (cells.every((c) => c.settlementQty === null)) missingLabels.push('التسوية');
        if (missingLabels.length > 0) {
          incompleteAssocs.push({
            nameAr: assoc.nameAr,
            missingLabels,
          });
        }
      }

      for (const c of cells) {
        const calc = computeDisbursementRow(c, settings.treatEmptyAsZero);
        if (calc.hasNegativeDisbursed) {
          logicAlerts.push(`${assoc.nameAr} (${c.fertName}): المنصرف سالب لأن البداية أقل من النهاية.`);
        } else if (calc.hasVariance) {
          logicAlerts.push(
            `${assoc.nameAr} (${c.fertName}): يوجد فرق تسوية قدره ${formatNumberAr(calc.variance)} شيكارة.`,
          );
        }
      }
    }

    return { incompleteAssocs, logicAlerts };
  }, [dayAssociations, draftCells, orderedFertilizers, settings.treatEmptyAsZero]);

  const totalsByFert = useMemo(() => {
    const res: Record<
      string,
      { open: number; close: number; settle: number; actual: number; variance: number }
    > = {};
    for (const fert of orderedFertilizers) {
      res[fert.code] = { open: 0, close: 0, settle: 0, actual: 0, variance: 0 };
      for (const assoc of visibleAssociations) {
        const cell = draftCells[`${assoc.id}::${fert.code}`];
        if (!cell) continue;
        const calc = computeDisbursementRow(cell, settings.treatEmptyAsZero);
        res[fert.code].open += cell.openingBalance ?? 0;
        res[fert.code].close += cell.closingBalance ?? 0;
        res[fert.code].settle += cell.settlementQty ?? 0;
        res[fert.code].actual += calc.actualDisbursed ?? 0;
        res[fert.code].variance += calc.variance ?? 0;
      }
    }
    return res;
  }, [draftCells, orderedFertilizers, settings.treatEmptyAsZero, visibleAssociations]);

  const currentGov = governorates.find((g) => g.id === selectedGovId);
  const dayTractorsCount = tractors.filter(
    (t) => t.governorateId === selectedGovId && t.arrivalDate === selectedDate,
  ).length;

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label
              htmlFor="sheet-gov-select"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
            >
              المحافظة
            </label>
            <select
              id="sheet-gov-select"
              value={selectedGovId}
              onChange={(e) => {
                setSelectedGovId(e.target.value);
                setSelectedCenterFilter('all');
              }}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
            >
              {visibleGovernorates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameAr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="sheet-date-input"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
            >
              تاريخ الكشف
            </label>
            <input
              id="sheet-date-input"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono-num text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
            />
          </div>

          <div className="pt-5">
            <span className="inline-block rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              الحالة: {STATUS_LABELS_AR[currentReport?.status || 'draft']}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageAssociations && onManageAssociations && (
            <button
              type="button"
              onClick={() => onManageAssociations(selectedGovId)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-900 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
            >
              <Building2 className="w-3.5 h-3.5" />
              🏢 إدارة الجمعيات
            </button>
          )}
          {canExport && (
            <button
              type="button"
              onClick={() => setExportModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <Download className="w-4 h-4" />
              تصدير
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <Printer className="w-4 h-4" />
            طباعة الكشف
          </button>
          {canClearDay && (
            <button
              type="button"
              onClick={() => setClearConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-semibold text-rose-800 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              🗑️ مسح سجل اليوم
            </button>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveSheet()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60 transition-colors"
              >
                <Save className="w-4 h-4" />
                {saving ? 'جارٍ الحفظ...' : 'حفظ الكشف'}
              </button>
              {(!currentReport || currentReport.status === 'draft' || currentReport.status === 'rejected') && (
                <button
                  type="button"
                  onClick={() => void handleSubmitForReview()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  إرسال للمراجعة
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 10-Second Undo Bar */}
      {undoSnapshot && undoSecondsLeft > 0 && (
        <div
          role="status"
          className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 px-4 py-3 text-xs text-amber-950 dark:text-amber-100"
        >
          <span>
            تم مسح سجل {currentGov?.nameAr} ليوم {undoSnapshot.reportDate}. هل تريد استرجاعه؟ (متبقٍ{' '}
            <strong className="font-mono-num">{undoSecondsLeft}</strong> ثوانٍ)
          </span>
          <button
            type="button"
            onClick={() => void handleUndoClear()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3.5 py-1.5 font-bold text-white hover:bg-amber-800"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            تراجع
          </button>
        </div>
      )}

      {/* Sheet OCR Card */}
      {canEdit && (
        <SheetImageReaderCard
          governorateId={selectedGovId}
          associations={dayAssociations}
          onApplyRows={handleApplyOcrRows}
        />
      )}

      {/* Post-OCR Completion Checklist & Logic Alerts */}
      {(sheetDiagnostics.incompleteAssocs.length > 0 || sheetDiagnostics.logicAlerts.length > 0) && (
        <div className="no-print grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
          {sheetDiagnostics.incompleteAssocs.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 p-3.5 space-y-1.5">
              <p className="font-bold text-amber-900 dark:text-amber-200">
                قائمة استكمال الأقسام ({sheetDiagnostics.incompleteAssocs.length} جمعية غير مكتملة):
              </p>
              <ul className="space-y-1 text-amber-800 dark:text-amber-300 max-h-24 overflow-y-auto">
                {sheetDiagnostics.incompleteAssocs.slice(0, 6).map((item) => (
                  <li key={item.nameAr}>
                    • {item.nameAr}: ينقصها ({item.missingLabels.join(' / ')})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sheetDiagnostics.logicAlerts.length > 0 && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/40 p-3.5 space-y-1.5">
              <p className="font-bold text-rose-900 dark:text-rose-200">
                تنبيهات المعادلات والفروقات ({sheetDiagnostics.logicAlerts.length}):
              </p>
              <ul className="space-y-1 text-rose-800 dark:text-rose-300 max-h-24 overflow-y-auto">
                {sheetDiagnostics.logicAlerts.slice(0, 6).map((msg, i) => (
                  <li key={i}>• {msg}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Per-Fertilizer Quick Totals Strip (Urea / Nitrate / Sulfate) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        {orderedFertilizers.map((ft) => {
          const tot = totalsByFert[ft.code] || { open: 0, close: 0, settle: 0, actual: 0, variance: 0 };
          return (
            <div
              key={ft.code}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 flex items-center justify-between gap-2"
            >
              <div>
                <p className="font-extrabold text-sm text-slate-900 dark:text-slate-100">{ft.nameAr}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                  بداية: {formatNumberAr(tot.open)} · نهاية: {formatNumberAr(tot.close)} · تسوية:{' '}
                  {formatNumberAr(tot.settle)}
                </p>
              </div>
              <div className="text-left font-mono-num">
                <p className="font-bold text-emerald-800 dark:text-emerald-300">
                  منصرف: {formatNumberAr(tot.actual)}
                </p>
                <p
                  className={`text-[11px] font-bold ${
                    Math.abs(tot.variance) > 0.0001
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  فرق: {formatNumberAr(tot.variance)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Unified Paper-Sheet Grid (NO Fertilizer Tabs) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="no-print px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/60">
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="تصفية بنقطة التوزيع"
              value={selectedCenterFilter}
              onChange={(e) => setSelectedCenterFilter(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 focus:border-emerald-600 focus:outline-none"
            >
              <option value="all">
                كل نقاط التوزيع ({formatNumberAr(dayAssociations.length)} جمعية)
              </option>
              {govCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2" />
              <input
                type="search"
                value={assocSearch}
                onChange={(e) => setAssocSearch(e.target.value)}
                placeholder="بحث بالجمعية..."
                aria-label="بحث في جمعيات الكشف"
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pr-8 pl-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:border-emerald-600 focus:outline-none w-44"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            جدول موحّد للثلاثة أصناف (يوريا · نترات · سلفات) — اضغط Enter للنزول للخلية التالية رأسيًا وTab أفقيًا
          </p>
        </div>

        {/* Unified 19-Column Desktop Table (No "الوارد" column) */}
        <div
          data-testid="unified-sheet-scroll-container"
          className="hidden md:block overflow-auto max-h-[68vh] relative"
        >
          <table
            data-testid="unified-disbursement-table"
            className="w-max min-w-full text-[11px] border-separate border-spacing-0"
          >
            <thead>
              <tr className="h-[36px] bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                <th
                  rowSpan={2}
                  className="sticky right-0 top-0 z-30 w-[44px] min-w-[44px] max-w-[44px] bg-slate-100 dark:bg-slate-800 border-b border-l border-slate-300 dark:border-slate-600 px-2 py-2 text-center font-bold"
                >
                  #
                </th>
                <th
                  rowSpan={2}
                  className="sticky right-[44px] top-0 z-30 w-[205px] min-w-[205px] bg-slate-100 dark:bg-slate-800 border-b border-l-2 border-slate-300 dark:border-slate-600 px-3 py-2 text-right font-bold shadow-[-3px_0_6px_-3px_rgba(0,0,0,0.12)]"
                >
                  الجمعية / نقطة التوزيع
                </th>
                <th
                  colSpan={3}
                  className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 border-b border-l border-slate-300 dark:border-slate-600 px-2 py-2 text-center font-bold"
                >
                  بداية اليوم
                </th>
                <th
                  colSpan={3}
                  className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 border-b border-l border-slate-300 dark:border-slate-600 px-2 py-2 text-center font-bold"
                >
                  نهاية اليوم
                </th>
                <th
                  colSpan={3}
                  className="sticky top-0 z-20 bg-emerald-100 dark:bg-emerald-950 border-b border-l border-slate-300 dark:border-slate-600 px-2 py-2 text-center font-bold text-emerald-900 dark:text-emerald-200"
                >
                  المنصرف اليومي (بداية − نهاية)
                </th>
                <th
                  colSpan={3}
                  className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 border-b border-l border-slate-300 dark:border-slate-600 px-2 py-2 text-center font-bold"
                >
                  التسوية
                </th>
                <th
                  colSpan={3}
                  className="sticky top-0 z-20 bg-amber-100 dark:bg-amber-950 border-b border-l border-slate-300 dark:border-slate-600 px-2 py-2 text-center font-bold text-amber-950 dark:text-amber-200"
                >
                  فرق التسوية (المنصرف − التسوية)
                </th>
                <th
                  rowSpan={2}
                  className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 border-b border-l border-slate-300 dark:border-slate-600 px-3 py-2 text-center font-bold min-w-[96px]"
                >
                  الحالة
                </th>
                <th
                  rowSpan={2}
                  className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-600 px-3 py-2 text-right font-bold min-w-[180px]"
                >
                  ملاحظات / سبب الفرق
                </th>
              </tr>
              <tr className="bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {/* بداية اليوم */}
                {orderedFertilizers.map((ft) => (
                  <th
                    key={`h-open-${ft.code}`}
                    className="sticky top-[36px] z-20 bg-slate-50 dark:bg-slate-800 border-b border-l border-slate-300 dark:border-slate-600 px-1.5 py-1.5 text-center font-bold min-w-[74px]"
                  >
                    {ft.nameAr}
                  </th>
                ))}
                {/* نهاية اليوم */}
                {orderedFertilizers.map((ft) => (
                  <th
                    key={`h-close-${ft.code}`}
                    className="sticky top-[36px] z-20 bg-slate-50 dark:bg-slate-800 border-b border-l border-slate-300 dark:border-slate-600 px-1.5 py-1.5 text-center font-bold min-w-[74px]"
                  >
                    {ft.nameAr}
                  </th>
                ))}
                {/* المنصرف */}
                {orderedFertilizers.map((ft) => (
                  <th
                    key={`h-act-${ft.code}`}
                    className="sticky top-[36px] z-20 bg-emerald-50 dark:bg-emerald-950 border-b border-l border-slate-300 dark:border-slate-600 px-1.5 py-1.5 text-center font-bold text-emerald-900 dark:text-emerald-300 min-w-[66px]"
                  >
                    {ft.nameAr}
                  </th>
                ))}
                {/* التسوية */}
                {orderedFertilizers.map((ft) => (
                  <th
                    key={`h-settle-${ft.code}`}
                    className="sticky top-[36px] z-20 bg-slate-50 dark:bg-slate-800 border-b border-l border-slate-300 dark:border-slate-600 px-1.5 py-1.5 text-center font-bold min-w-[74px]"
                  >
                    {ft.nameAr}
                  </th>
                ))}
                {/* فرق التسوية */}
                {orderedFertilizers.map((ft) => (
                  <th
                    key={`h-var-${ft.code}`}
                    className="sticky top-[36px] z-20 bg-amber-50 dark:bg-amber-950 border-b border-l border-slate-300 dark:border-slate-600 px-1.5 py-1.5 text-center font-bold text-amber-950 dark:text-amber-300 min-w-[62px]"
                  >
                    {ft.nameAr}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {visibleAssociations.length === 0 ? (
                <tr>
                  <td
                    colSpan={19}
                    className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    لا توجد جمعيات مسجلة لهذه المحافظة في هذا التاريخ أو مطابقة للتصفية الحالية.
                  </td>
                </tr>
              ) : (
                visibleAssociations.map((assoc, rowIdx) => {
                  const ctr = centers.find((c) => c.id === assoc.centerId);
                  const uCell = draftCells[`${assoc.id}::urea`] || EMPTY_CELL;
                  const nCell = draftCells[`${assoc.id}::nitrate`] || EMPTY_CELL;
                  const sCell = draftCells[`${assoc.id}::sulfate`] || EMPTY_CELL;

                  const uCalc = computeDisbursementRow(uCell, settings.treatEmptyAsZero);
                  const nCalc = computeDisbursementRow(nCell, settings.treatEmptyAsZero);
                  const sCalc = computeDisbursementRow(sCell, settings.treatEmptyAsZero);
                  const calcs = [uCalc, nCalc, sCalc];

                  const anyVariance = calcs.some((c) => c.hasVariance || c.hasNegativeDisbursed);
                  const anyCalculated = calcs.some((c) => c.variance !== null);
                  const rowReason = getRowReason(assoc.id);
                  const stickyRowBg = anyVariance
                    ? 'bg-amber-50 dark:bg-slate-900'
                    : 'bg-white dark:bg-slate-900';

                  return (
                    <tr
                      key={assoc.id}
                      className={
                        anyVariance
                          ? 'bg-amber-50/70 dark:bg-amber-950/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }
                    >
                      {/* Sticky # */}
                      <td
                        className={`sticky right-0 z-10 w-[44px] min-w-[44px] max-w-[44px] ${stickyRowBg} border-b border-l border-slate-200 dark:border-slate-700 px-2 py-2 text-center font-mono-num font-bold text-slate-500 dark:text-slate-400`}
                      >
                        {rowIdx + 1}
                      </td>

                      {/* Sticky الجمعية */}
                      <td
                        className={`sticky right-[44px] z-10 w-[205px] min-w-[205px] ${stickyRowBg} border-b border-l-2 border-slate-200 dark:border-slate-700 px-3 py-2 shadow-[-3px_0_6px_-3px_rgba(0,0,0,0.08)]`}
                      >
                        <div className="font-bold text-slate-900 dark:text-slate-100 leading-tight">
                          {assoc.nameAr}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          <span className="font-mono-num">{assoc.code}</span>
                          {ctr ? ` · ${ctr.nameAr}` : ''}
                        </div>
                      </td>

                      {/* بداية اليوم: يوريا | نترات | سلفات */}
                      {orderedFertilizers.map((ft) => {
                        const colKey = `${ft.code}:openingBalance`;
                        const inputKey = `${assoc.id}::${colKey}`;
                        return (
                          <td
                            key={colKey}
                            className="border-b border-l border-slate-200 dark:border-slate-700 p-1 text-center"
                          >
                            <input
                              ref={(el) => {
                                inputRefs.current[`${rowIdx}::${colKey}`] = el;
                              }}
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              placeholder="—"
                              disabled={!canEdit}
                              aria-label={`بداية اليوم ${ft.nameAr} ${assoc.nameAr}`}
                              value={getNumericDisplayValue(assoc.id, ft.code, 'openingBalance', inputKey)}
                              onFocus={(e) => {
                                const val = draftCells[`${assoc.id}::${ft.code}`]?.openingBalance;
                                setActiveRawInput({
                                  key: inputKey,
                                  raw: val === null || val === undefined ? '' : String(val),
                                });
                                e.currentTarget.select();
                              }}
                              onBlur={() =>
                                setActiveRawInput((cur) => (cur?.key === inputKey ? null : cur))
                              }
                              onChange={(e) =>
                                handleNumericChange(
                                  assoc.id,
                                  ft.code,
                                  'openingBalance',
                                  e.target.value,
                                  inputKey,
                                )
                              }
                              onKeyDown={(e) => handleGridKeyDown(e, rowIdx, colKey)}
                              className="w-[66px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1.5 text-center font-mono-num text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800/50"
                            />
                          </td>
                        );
                      })}

                      {/* نهاية اليوم: يوريا | نترات | سلفات */}
                      {orderedFertilizers.map((ft) => {
                        const colKey = `${ft.code}:closingBalance`;
                        const inputKey = `${assoc.id}::${colKey}`;
                        return (
                          <td
                            key={colKey}
                            className="border-b border-l border-slate-200 dark:border-slate-700 p-1 text-center"
                          >
                            <input
                              ref={(el) => {
                                inputRefs.current[`${rowIdx}::${colKey}`] = el;
                              }}
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              placeholder="—"
                              disabled={!canEdit}
                              aria-label={`نهاية اليوم ${ft.nameAr} ${assoc.nameAr}`}
                              value={getNumericDisplayValue(assoc.id, ft.code, 'closingBalance', inputKey)}
                              onFocus={(e) => {
                                const val = draftCells[`${assoc.id}::${ft.code}`]?.closingBalance;
                                setActiveRawInput({
                                  key: inputKey,
                                  raw: val === null || val === undefined ? '' : String(val),
                                });
                                e.currentTarget.select();
                              }}
                              onBlur={() =>
                                setActiveRawInput((cur) => (cur?.key === inputKey ? null : cur))
                              }
                              onChange={(e) =>
                                handleNumericChange(
                                  assoc.id,
                                  ft.code,
                                  'closingBalance',
                                  e.target.value,
                                  inputKey,
                                )
                              }
                              onKeyDown={(e) => handleGridKeyDown(e, rowIdx, colKey)}
                              className="w-[66px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1.5 text-center font-mono-num text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800/50"
                            />
                          </td>
                        );
                      })}

                      {/* المنصرف اليومي: يوريا | نترات | سلفات */}
                      {calcs.map((calc, idx) => (
                        <td
                          key={`act-${orderedFertilizers[idx].code}`}
                          className={`border-b border-l border-slate-200 dark:border-slate-700 px-2 py-2 text-center font-mono-num font-bold bg-emerald-50/50 dark:bg-emerald-950/30 ${
                            calc.hasNegativeDisbursed
                              ? 'text-rose-700 dark:text-rose-400'
                              : 'text-emerald-900 dark:text-emerald-300'
                          }`}
                        >
                          {formatNumberAr(calc.actualDisbursed)}
                        </td>
                      ))}

                      {/* التسوية: يوريا | نترات | سلفات */}
                      {orderedFertilizers.map((ft) => {
                        const colKey = `${ft.code}:settlementQty`;
                        const inputKey = `${assoc.id}::${colKey}`;
                        return (
                          <td
                            key={colKey}
                            className="border-b border-l border-slate-200 dark:border-slate-700 p-1 text-center"
                          >
                            <input
                              ref={(el) => {
                                inputRefs.current[`${rowIdx}::${colKey}`] = el;
                              }}
                              type="text"
                              inputMode="decimal"
                              dir="ltr"
                              placeholder="—"
                              disabled={!canEdit}
                              aria-label={`التسوية ${ft.nameAr} ${assoc.nameAr}`}
                              value={getNumericDisplayValue(assoc.id, ft.code, 'settlementQty', inputKey)}
                              onFocus={(e) => {
                                const val = draftCells[`${assoc.id}::${ft.code}`]?.settlementQty;
                                setActiveRawInput({
                                  key: inputKey,
                                  raw: val === null || val === undefined ? '' : String(val),
                                });
                                e.currentTarget.select();
                              }}
                              onBlur={() =>
                                setActiveRawInput((cur) => (cur?.key === inputKey ? null : cur))
                              }
                              onChange={(e) =>
                                handleNumericChange(
                                  assoc.id,
                                  ft.code,
                                  'settlementQty',
                                  e.target.value,
                                  inputKey,
                                )
                              }
                              onKeyDown={(e) => handleGridKeyDown(e, rowIdx, colKey)}
                              className="w-[66px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-1.5 text-center font-mono-num text-xs text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800/50"
                            />
                          </td>
                        );
                      })}

                      {/* فرق التسوية: يوريا | نترات | سلفات */}
                      {calcs.map((calc, idx) => (
                        <td
                          key={`var-${orderedFertilizers[idx].code}`}
                          className={`border-b border-l border-slate-200 dark:border-slate-700 px-2 py-2 text-center font-mono-num font-bold ${
                            calc.hasVariance || calc.hasNegativeDisbursed
                              ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                              : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {formatNumberAr(calc.variance)}
                        </td>
                      ))}

                      {/* الحالة */}
                      <td className="border-b border-l border-slate-200 dark:border-slate-700 px-2 py-2 text-center whitespace-nowrap">
                        {!anyCalculated ? (
                          <span className="text-[11px] text-slate-400">غير مكتمل</span>
                        ) : anyVariance ? (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-bold bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300">
                            <AlertTriangle className="w-3 h-3" />
                            ⚠ اختلاف
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-bold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            ✔ مطابق
                          </span>
                        )}
                      </td>

                      {/* ملاحظات / سبب الفرق */}
                      <td className="border-b border-slate-200 dark:border-slate-700 p-1.5 min-w-[180px]">
                        <input
                          ref={(el) => {
                            inputRefs.current[`${rowIdx}::row:reason`] = el;
                          }}
                          type="text"
                          disabled={!canEdit}
                          placeholder={anyVariance ? 'سبب الفرق (إلزامي)...' : 'ملاحظات أو لا يوجد فرق'}
                          aria-label={`ملاحظات وسبب الفرق ${assoc.nameAr}`}
                          value={rowReason}
                          onChange={(e) => updateRowReason(assoc.id, e.target.value)}
                          onKeyDown={(e) => handleGridKeyDown(e, rowIdx, 'row:reason')}
                          className={`w-full rounded border px-2 py-1.5 text-xs focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-800/50 ${
                            anyVariance && !rowReason.trim()
                              ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200'
                              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100'
                          }`}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {visibleAssociations.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-100">
                  <td className="sticky right-0 bottom-0 z-30 bg-slate-100 dark:bg-slate-800 border-t-2 border-l border-slate-300 dark:border-slate-600 px-2 py-3 text-center font-mono-num">
                    Σ
                  </td>
                  <td className="sticky right-[44px] bottom-0 z-30 bg-slate-100 dark:bg-slate-800 border-t-2 border-l-2 border-slate-300 dark:border-slate-600 px-3 py-3 text-right shadow-[-3px_0_6px_-3px_rgba(0,0,0,0.12)]">
                    الإجمالي ({formatNumberAr(visibleAssociations.length)} جمعية)
                  </td>
                  {orderedFertilizers.map((ft) => (
                    <td
                      key={`f-open-${ft.code}`}
                      className="sticky bottom-0 z-20 bg-slate-100 dark:bg-slate-800 border-t-2 border-l border-slate-300 dark:border-slate-600 px-2 py-3 text-center font-mono-num"
                    >
                      {formatNumberAr(totalsByFert[ft.code]?.open)}
                    </td>
                  ))}
                  {orderedFertilizers.map((ft) => (
                    <td
                      key={`f-close-${ft.code}`}
                      className="sticky bottom-0 z-20 bg-slate-100 dark:bg-slate-800 border-t-2 border-l border-slate-300 dark:border-slate-600 px-2 py-3 text-center font-mono-num"
                    >
                      {formatNumberAr(totalsByFert[ft.code]?.close)}
                    </td>
                  ))}
                  {orderedFertilizers.map((ft) => (
                    <td
                      key={`f-act-${ft.code}`}
                      className="sticky bottom-0 z-20 bg-emerald-100 dark:bg-emerald-950 border-t-2 border-l border-slate-300 dark:border-slate-600 px-2 py-3 text-center font-mono-num text-emerald-900 dark:text-emerald-200"
                    >
                      {formatNumberAr(totalsByFert[ft.code]?.actual)}
                    </td>
                  ))}
                  {orderedFertilizers.map((ft) => (
                    <td
                      key={`f-settle-${ft.code}`}
                      className="sticky bottom-0 z-20 bg-slate-100 dark:bg-slate-800 border-t-2 border-l border-slate-300 dark:border-slate-600 px-2 py-3 text-center font-mono-num"
                    >
                      {formatNumberAr(totalsByFert[ft.code]?.settle)}
                    </td>
                  ))}
                  {orderedFertilizers.map((ft) => (
                    <td
                      key={`f-var-${ft.code}`}
                      className="sticky bottom-0 z-20 bg-amber-100 dark:bg-amber-950 border-t-2 border-l border-slate-300 dark:border-slate-600 px-2 py-3 text-center font-mono-num text-amber-950 dark:text-amber-200"
                    >
                      {formatNumberAr(totalsByFert[ft.code]?.variance)}
                    </td>
                  ))}
                  <td
                    colSpan={2}
                    className="sticky bottom-0 z-20 bg-slate-100 dark:bg-slate-800 border-t-2 border-slate-300 dark:border-slate-600 px-3 py-3 text-xs text-slate-600 dark:text-slate-300"
                  >
                    شكارة (50 كجم)
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Unified Mobile Cards View (All 3 Fertilizers Stacked per Association, NO Tabs) */}
        <div
          data-testid="mobile-unified-cards"
          className="md:hidden divide-y divide-slate-200 dark:divide-slate-700"
        >
          {visibleAssociations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              لا توجد جمعيات مسجلة لهذا التاريخ أو مطابقة لخيارات البحث الحالية.
            </div>
          ) : (
            visibleAssociations.map((assoc, rowIdx) => {
              const uCell = draftCells[`${assoc.id}::urea`] || EMPTY_CELL;
              const nCell = draftCells[`${assoc.id}::nitrate`] || EMPTY_CELL;
              const sCell = draftCells[`${assoc.id}::sulfate`] || EMPTY_CELL;
              const rowCalcs = [
                computeDisbursementRow(uCell, settings.treatEmptyAsZero),
                computeDisbursementRow(nCell, settings.treatEmptyAsZero),
                computeDisbursementRow(sCell, settings.treatEmptyAsZero),
              ];
              const anyVar = rowCalcs.some((c) => c.hasVariance || c.hasNegativeDisbursed);
              const anyCalc = rowCalcs.some((c) => c.variance !== null);
              const rowReason = getRowReason(assoc.id);

              return (
                <div key={assoc.id} className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        <span className="font-mono-num text-slate-400 ml-1.5">#{rowIdx + 1}</span>
                        {assoc.nameAr}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                        {assoc.code}
                      </p>
                    </div>
                    {!anyCalc ? (
                      <span className="rounded px-2 py-1 text-xs bg-slate-100 dark:bg-slate-800 text-slate-500">
                        غير مكتمل
                      </span>
                    ) : anyVar ? (
                      <span className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-bold bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        ⚠ اختلاف
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-bold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        ✔ مطابق
                      </span>
                    )}
                  </div>

                  {/* All 3 Fertilizers Stacked Cleanly */}
                  <div className="space-y-2.5">
                    {orderedFertilizers.map((ft, fIdx) => {
                      const calc = rowCalcs[fIdx];
                      const fields: Array<{ key: NumericFieldKey; label: string }> = [
                        { key: 'openingBalance', label: 'بداية' },
                        { key: 'closingBalance', label: 'نهاية' },
                        { key: 'settlementQty', label: 'تسوية' },
                      ];
                      return (
                        <div
                          key={ft.code}
                          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-2.5 space-y-2"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {ft.nameAr}
                            </span>
                            <div className="flex items-center gap-3 font-mono-num">
                              <span className="text-emerald-800 dark:text-emerald-300 font-bold">
                                منصرف: {formatNumberAr(calc.actualDisbursed)}
                              </span>
                              <span
                                className={`font-bold ${
                                  calc.hasVariance
                                    ? 'text-rose-700 dark:text-rose-400'
                                    : 'text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                فرق: {formatNumberAr(calc.variance)}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs">
                            {fields.map((fld) => {
                              const inputKey = `m::${assoc.id}::${ft.code}::${fld.key}`;
                              return (
                                <label key={fld.key} className="space-y-1">
                                  <span className="text-[11px] text-slate-600 dark:text-slate-300">
                                    {fld.label}
                                  </span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    dir="ltr"
                                    placeholder="—"
                                    disabled={!canEdit}
                                    value={getNumericDisplayValue(
                                      assoc.id,
                                      ft.code,
                                      fld.key,
                                      inputKey,
                                    )}
                                    onFocus={(e) => {
                                      const val = draftCells[`${assoc.id}::${ft.code}`]?.[fld.key];
                                      setActiveRawInput({
                                        key: inputKey,
                                        raw: val === null || val === undefined ? '' : String(val),
                                      });
                                      e.currentTarget.select();
                                    }}
                                    onBlur={() =>
                                      setActiveRawInput((cur) => (cur?.key === inputKey ? null : cur))
                                    }
                                    onChange={(e) =>
                                      handleNumericChange(
                                        assoc.id,
                                        ft.code,
                                        fld.key,
                                        e.target.value,
                                        inputKey,
                                      )
                                    }
                                    className="w-full min-h-[48px] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-2 text-center font-mono-num text-sm dark:text-slate-100"
                                  />
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <input
                    type="text"
                    disabled={!canEdit}
                    placeholder={anyVar ? 'سبب الفرق (إلزامي)...' : 'ملاحظات أو سبب الفرق'}
                    value={rowReason}
                    onChange={(e) => updateRowReason(assoc.id, e.target.value)}
                    className={`w-full min-h-[48px] rounded-lg border px-3 py-2 text-xs ${
                      anyVar && !rowReason.trim()
                        ? 'border-rose-400 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200'
                        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100'
                    }`}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      <ExportModal
        open={exportModalOpen}
        governorateNameAr={currentGov?.nameAr || selectedGovId}
        reportDate={selectedDate}
        associationsCount={dayAssociations.length}
        tractorsCount={dayTractorsCount}
        onClose={() => setExportModalOpen(false)}
        onExport={handleExportConfirm}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        title="تأكيد مسح سجل اليوم"
        message={`هل تريد مسح جميع سجلات الصرف لمحافظة «${currentGov?.nameAr || ''}» بتاريخ ${selectedDate}؟ لن يؤثر ذلك على الأيام السابقة، ويمكنك التراجع خلال 10 ثوانٍ.`}
        confirmLabel="مسح سجل اليوم"
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={() => void handleClearToday()}
      />
    </div>
  );
};
