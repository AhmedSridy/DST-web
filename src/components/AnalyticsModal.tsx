import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Loader2,
  Save,
  TrendingDown,
  X,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { getTodayDateIso } from '../data/seedData.ts';
import type {
  DailyDisbursementRow,
  DailyReport,
  FertilizerThresholdConfig,
} from '../types/domain.ts';
import {
  computeLowBalanceAlerts,
  computeMultiDaySeries,
  computeOverdueReport,
  getGovernoratesWithActiveAssociations,
  type AnalyticsMetricKey,
  type MultiDayPoint,
} from '../utils/analytics.ts';
import { sortAssociationsByOrder } from '../utils/arabicNormalize.ts';
import { formatNumberAr } from '../utils/calculations.ts';
import { getVisibleGovernorates } from '../utils/rbac.ts';

export type AnalyticsTabId = 'overdue' | 'comparison' | 'thresholds';

interface AnalyticsModalProps {
  open: boolean;
  initialTab?: AnalyticsTabId;
  activeGovernorateId?: string;
  onClose: () => void;
}

function buildSegmentedPaths(
  points: MultiDayPoint[],
  accessor: (p: MultiDayPoint) => number | null,
  xForIndex: (idx: number) => number,
  yForValue: (val: number) => number,
): { paths: string[]; coords: Array<{ idx: number; x: number; y: number; val: number; date: string }> } {
  const paths: string[] = [];
  const coords: Array<{ idx: number; x: number; y: number; val: number; date: string }> = [];
  let currentSegment: string[] = [];

  points.forEach((pt, idx) => {
    const val = accessor(pt);
    if (val === null) {
      if (currentSegment.length > 0) {
        paths.push(currentSegment.join(' '));
        currentSegment = [];
      }
      return;
    }
    const x = xForIndex(idx);
    const y = yForValue(val);
    coords.push({ idx, x, y, val, date: pt.date });
    currentSegment.push(`${currentSegment.length === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
  });

  if (currentSegment.length > 0) {
    paths.push(currentSegment.join(' '));
  }

  return { paths, coords };
}

export const AnalyticsModal: React.FC<AnalyticsModalProps> = ({
  open,
  initialTab = 'overdue',
  activeGovernorateId,
  onClose,
}) => {
  const { profile } = useAuth();
  const {
    governorates,
    associations,
    reports,
    disbursements,
    settings,
    fetchAnalyticsHistory,
    updateSettings,
    pushToast,
  } = useAppData();

  const visibleGovernorates = useMemo(
    () => getVisibleGovernorates(profile, governorates),
    [governorates, profile],
  );

  const activeChartGovs = useMemo(
    () => getGovernoratesWithActiveAssociations(visibleGovernorates, associations),
    [associations, visibleGovernorates],
  );

  const [activeTab, setActiveTab] = useState<AnalyticsTabId>(initialTab);
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [initialTab, open]);

  // Tab 1: Overdue state
  const [overdueDate, setOverdueDate] = useState<string>(getTodayDateIso());
  const effectiveGovId = activeGovernorateId || visibleGovernorates[0]?.id || 'gov-ismailia';

  const overdueReport = useMemo(() => {
    const govItems = computeOverdueReport({
      governorates: visibleGovernorates,
      associations,
      disbursements,
      selectedDate: overdueDate,
      currentGovernorateId: effectiveGovId,
    });

    // Build lookup of each association's last recorded date up to overdueDate
    const repById = new Map(reports.map((r) => [r.id, r]));
    const lastDateByAssoc = new Map<string, string>();
    for (const row of disbursements) {
      if (
        row.openingBalance === null &&
        row.closingBalance === null &&
        row.settlementQty === null
      ) {
        continue;
      }
      const rep = repById.get(row.reportId);
      if (!rep || rep.reportDate >= overdueDate) continue;
      const prev = lastDateByAssoc.get(row.associationId);
      if (!prev || rep.reportDate > prev) {
        lastDateByAssoc.set(row.associationId, rep.reportDate);
      }
    }

    const totalActiveCount = govItems.reduce((s, g) => s + g.totalCount, 0);
    const recordedCount = govItems.reduce((s, g) => s + g.recordedCount, 0);
    const overdueCount = govItems.reduce((s, g) => s + g.overdueCount, 0);

    const targetMs = Date.parse(`${overdueDate}T00:00:00Z`);
    const items = govItems.flatMap((gov) =>
      gov.unrecordedAssociations.map((a) => {
        const lastDate = lastDateByAssoc.get(a.id) || null;
        const daysOverdue =
          lastDate && !Number.isNaN(targetMs)
            ? Math.max(1, Math.round((targetMs - Date.parse(`${lastDate}T00:00:00Z`)) / 86400000))
            : null;
        return {
          associationId: a.id,
          associationNameAr: a.nameAr,
          governorateId: gov.governorateId,
          governorateNameAr: gov.governorateName,
          isCurrentGovernorate: gov.governorateId === effectiveGovId,
          lastRecordedDate: lastDate,
          daysOverdue,
        };
      }),
    );

    return {
      totalActiveCount,
      recordedCount,
      overdueCount,
      items,
    };
  }, [associations, disbursements, effectiveGovId, overdueDate, reports, visibleGovernorates]);

  // Tab 2: Comparison state
  const [compGovId, setCompGovId] = useState<string>(
    activeChartGovs.some((g) => g.id === effectiveGovId)
      ? effectiveGovId
      : activeChartGovs[0]?.id || '',
  );
  const [compMetric, setCompMetric] = useState<AnalyticsMetricKey>('disbursed');
  const [compDays, setCompDays] = useState<7 | 14 | 30>(7);
  const [compEndDate, setCompEndDate] = useState<string>(getTodayDateIso());
  const [compLoading, setCompLoading] = useState(false);
  const [compHistory, setCompHistory] = useState<{
    reports: DailyReport[];
    disbursements: DailyDisbursementRow[];
  }>({ reports: [], disbursements: [] });

  useEffect(() => {
    if (activeChartGovs.length === 0) {
      if (compGovId !== '') setCompGovId('');
      return;
    }
    if (!activeChartGovs.some((g) => g.id === compGovId)) {
      setCompGovId(
        activeChartGovs.some((g) => g.id === effectiveGovId)
          ? effectiveGovId
          : activeChartGovs[0].id,
      );
    }
  }, [activeChartGovs, compGovId, effectiveGovId]);

  useEffect(() => {
    if (!open || activeTab !== 'comparison' || !compGovId) return;
    let cancelled = false;
    setCompLoading(true);
    void fetchAnalyticsHistory({
      governorateId: compGovId,
      endDate: compEndDate,
      days: compDays,
    })
      .then((res) => {
        if (!cancelled) setCompHistory(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          pushToast({
            type: 'error',
            title: 'تعذر تحميل مقارنة الأيام',
            description: err instanceof Error ? err.message : 'حدث خطأ أثناء الاستعلام.',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setCompLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, compDays, compEndDate, compGovId, fetchAnalyticsHistory, open, pushToast]);

  const seriesPoints = useMemo(
    () =>
      computeMultiDaySeries({
        governorateId: compGovId,
        associations,
        endDate: compEndDate,
        days: compDays,
        metric: compMetric,
        reports: compHistory.reports.length ? compHistory.reports : reports,
        disbursements: compHistory.disbursements.length ? compHistory.disbursements : disbursements,
        treatEmptyAsZero: settings.treatEmptyAsZero,
      }),
    [associations, compDays, compEndDate, compGovId, compHistory, compMetric, disbursements, reports, settings.treatEmptyAsZero],
  );

  // Tab 3: Low Balance Thresholds state
  const [globalThresh, setGlobalThresh] = useState<FertilizerThresholdConfig>(
    settings.minThresholds || { urea: null, nitrate: null, sulfate: null },
  );
  const [assocOverrides, setAssocOverrides] = useState<
    Record<string, Partial<FertilizerThresholdConfig>>
  >(settings.assocMinThresholds || {});
  const [overrideAssocId, setOverrideAssocId] = useState<string>('');
  const [savingThresh, setSavingThresh] = useState(false);

  useEffect(() => {
    setGlobalThresh(settings.minThresholds || { urea: null, nitrate: null, sulfate: null });
    setAssocOverrides(settings.assocMinThresholds || {});
  }, [settings.assocMinThresholds, settings.minThresholds]);

  const canEditThresholds = profile?.role === 'admin' || profile?.role === 'supervisor';

  const visibleAssocs = useMemo(() => {
    const allowedGovIds = new Set(visibleGovernorates.map((g) => g.id));
    return sortAssociationsByOrder(
      associations.filter((a) => a.isActive && allowedGovIds.has(a.governorateId)),
    );
  }, [associations, visibleGovernorates]);

  const lowBalanceResult = useMemo(
    () =>
      computeLowBalanceAlerts({
        governorates: visibleGovernorates,
        associations,
        reports,
        disbursements,
        upToDate: getTodayDateIso(),
        minThresholds: globalThresh,
        assocMinThresholds: assocOverrides,
        maxRows: 200,
      }),
    [assocOverrides, associations, disbursements, globalThresh, reports, visibleGovernorates],
  );

  const parseThresholdInput = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const handleSaveThresholds = async () => {
    setSavingThresh(true);
    try {
      await updateSettings({
        minThresholds: globalThresh,
        assocMinThresholds: assocOverrides,
      });
    } catch (err: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر حفظ الحدود الدنيا',
        description: err instanceof Error ? err.message : 'تحقق من الصلاحيات.',
      });
    } finally {
      setSavingThresh(false);
    }
  };

  if (!open) return null;

  // SVG Chart Geometry (RTL: oldest index 0 on RIGHT x=rightX, newest index N-1 on LEFT x=leftX)
  const svgW = 760;
  const svgH = 290;
  const padL = 44;
  const padR = 54;
  const padT = 24;
  const padB = 42;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const allNonNullVals = seriesPoints.flatMap((p) =>
    [p.urea, p.nitrate, p.sulfate].filter((v): v is number => v !== null),
  );
  const maxVal = Math.max(10, ...allNonNullVals);
  const minVal = 0;

  const xForIndex = (idx: number) => {
    if (seriesPoints.length <= 1) return padL + plotW / 2;
    // RTL: idx 0 (oldest) at right edge (padL + plotW), idx N-1 (newest) at left edge (padL)
    const ratio = idx / (seriesPoints.length - 1);
    return padL + plotW * (1 - ratio);
  };

  const yForValue = (val: number) => {
    const norm = (val - minVal) / (maxVal - minVal || 1);
    return padT + plotH * (1 - norm);
  };

  const ureaGeo = buildSegmentedPaths(seriesPoints, (p) => p.urea, xForIndex, yForValue);
  const nitrateGeo = buildSegmentedPaths(seriesPoints, (p) => p.nitrate, xForIndex, yForValue);
  const sulfateGeo = buildSegmentedPaths(seriesPoints, (p) => p.sulfate, xForIndex, yForValue);

  const currentAssocOverride = overrideAssocId ? assocOverrides[overrideAssocId] || {} : {};

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="analytics-modal-title"
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/65 p-3 sm:p-5"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <div>
              <h3 id="analytics-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                📊 المتابعة والتحليل والرقابة التاريخية
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                رصد الجمعيات المتأخرة، مقارنة الأداء عبر الأيام، ومراقبة حدود المخزون الدنيا
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق نافذة المتابعة والتحليل"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Strip */}
        <div className="px-5 pt-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap gap-2 bg-slate-50/70 dark:bg-slate-800/50">
          {(
            [
              {
                id: 'overdue',
                label: `⏰ الكشوف المتأخرة (${formatNumberAr(overdueReport.overdueCount)})`,
                icon: Clock,
              },
              { id: 'comparison', label: '📈 مقارنة الأيام', icon: BarChart3 },
              {
                id: 'thresholds',
                label: `📉 الأرصدة المنخفضة (${formatNumberAr(lowBalanceResult.totalCount)})`,
                icon: TrendingDown,
              },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-emerald-700 text-emerald-900 dark:text-emerald-300 bg-white dark:bg-slate-900 rounded-t-lg'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {/* TAB 1: Overdue */}
          {activeTab === 'overdue' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    سجّلت{' '}
                    <span className="font-mono-num text-emerald-700 dark:text-emerald-400">
                      {formatNumberAr(overdueReport.recordedCount)}
                    </span>{' '}
                    من{' '}
                    <span className="font-mono-num">
                      {formatNumberAr(overdueReport.totalActiveCount)}
                    </span>{' '}
                    جمعية ليوم <span className="font-mono-num">{overdueDate}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    الصفر المُدخل يدويًا يُحتسب كسجل مكتمل، بينما الخانات الفارغة تُعد غير مسجلة. تظهر محافظتك الحالية أولًا ثم المحافظات الأكثر تأخيرًا.
                  </p>
                </div>

                <label className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">تاريخ المتابعة:</span>
                  <input
                    type="date"
                    value={overdueDate}
                    onChange={(e) => setOverdueDate(e.target.value)}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 font-mono-num dark:text-slate-100"
                  />
                </label>
              </div>

              {overdueReport.items.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-8 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-700 dark:text-emerald-400 mx-auto" />
                  <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    ✔️ جميع الجمعيات سجّلت كشوفها لهذا اليوم!
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2.5 text-right">الجمعية الزراعية</th>
                        <th className="px-3 py-2.5 text-right">المحافظة</th>
                        <th className="px-3 py-2.5 text-center">آخر تاريخ تسجيل</th>
                        <th className="px-3 py-2.5 text-center">حالة التأخير</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {overdueReport.items.map((item) => (
                        <tr
                          key={item.associationId}
                          className={
                            item.isCurrentGovernorate
                              ? 'bg-amber-50/40 dark:bg-amber-950/20'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                            {item.associationNameAr}
                            {item.isCurrentGovernorate && (
                              <span className="mr-2 inline-block rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.5 text-[10px]">
                                المحافظة المختارة
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                            {item.governorateNameAr}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono-num text-slate-600 dark:text-slate-300">
                            {item.lastRecordedDate || 'لم تسجل من قبل'}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {item.daysOverdue === null ? (
                              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-bold bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300">
                                <AlertTriangle className="w-3 h-3" />
                                ⚠ لم تسجل مطلقًا
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-300">
                                <Clock className="w-3 h-3" />
                                متأخرة {formatNumberAr(item.daysOverdue)} يوم
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Multi-Day Comparison */}
          {activeTab === 'comparison' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">المحافظة</span>
                  <select
                    value={compGovId}
                    disabled={activeChartGovs.length === 0}
                    onChange={(e) => setCompGovId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 dark:text-slate-100 disabled:opacity-50"
                  >
                    {activeChartGovs.length === 0 ? (
                      <option value="">لا توجد جمعيات مفعّلة</option>
                    ) : (
                      activeChartGovs.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.nameAr}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">المؤشر</span>
                  <select
                    value={compMetric}
                    onChange={(e) => setCompMetric(e.target.value as AnalyticsMetricKey)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 dark:text-slate-100"
                  >
                    <option value="disbursed">المنصرف اليومي</option>
                    <option value="closing">الرصيد الختامي</option>
                    <option value="opening">بداية اليوم</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">نطاق الأيام</span>
                  <select
                    value={compDays}
                    onChange={(e) => setCompDays(Number(e.target.value) as 7 | 14 | 30)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 dark:text-slate-100"
                  >
                    <option value={7}>آخر 7 أيام</option>
                    <option value={14}>آخر 14 يومًا</option>
                    <option value={30}>آخر 30 يومًا</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">تاريخ النهاية</span>
                  <input
                    type="date"
                    value={compEndDate}
                    onChange={(e) => setCompEndDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 font-mono-num dark:text-slate-100"
                  />
                </label>
              </div>

              {/* Accessible RTL SVG Line Chart */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white dark:bg-slate-900 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-bold text-slate-900 dark:text-slate-100">
                    منحنى مقارنة الأصناف (من الأقدم يمينًا إلى الأحدث يسارًا — الفجوات تعني أيامًا غير مسجلة)
                  </h4>
                  {compLoading && <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />}
                </div>

                {/* Legend (Color + Line Pattern + Marker Shape) */}
                <div className="flex flex-wrap items-center gap-5 text-xs">
                  <span className="inline-flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-400">
                    <svg width="28" height="12" aria-hidden="true">
                      <line x1="2" y1="6" x2="26" y2="6" stroke="#047857" strokeWidth="2.5" />
                      <circle cx="14" cy="6" r="3.5" fill="#047857" />
                    </svg>
                    يوريا (خط متصل · دائرة)
                  </span>
                  <span className="inline-flex items-center gap-2 font-semibold text-sky-700 dark:text-sky-400">
                    <svg width="28" height="12" aria-hidden="true">
                      <line x1="2" y1="6" x2="26" y2="6" stroke="#0284c7" strokeWidth="2.5" strokeDasharray="6 3" />
                      <rect x="10.5" y="2.5" width="7" height="7" fill="#0284c7" />
                    </svg>
                    نترات (خط متقطع · مربع)
                  </span>
                  <span className="inline-flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
                    <svg width="28" height="12" aria-hidden="true">
                      <line x1="2" y1="6" x2="26" y2="6" stroke="#b45309" strokeWidth="2.5" strokeDasharray="2 3" />
                      <polygon points="14,1.5 18,10 10,10" fill="#b45309" />
                    </svg>
                    سلفات (خط منقّط · مثلث)
                  </span>
                </div>

                {activeChartGovs.length === 0 ? (
                  <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400 rounded-lg border border-dashed border-slate-200 dark:border-slate-700">
                    لا توجد جمعيات مفعّلة لعرض المخططات
                  </div>
                ) : (
                <div className="overflow-x-auto">
                  <svg
                    role="img"
                    aria-label="رسم بياني خطي لمقارنة صرف وأرصدة الأسمدة عبر الأيام"
                    viewBox={`0 0 ${svgW} ${svgH}`}
                    className="w-full min-w-[540px] h-auto select-none"
                  >
                    <title>مقارنة الأيام للأسمدة (يوريا، نترات، سلفات)</title>
                    {/* Horizontal gridlines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                      const y = padT + plotH * (1 - t);
                      const labelVal = Math.round(minVal + (maxVal - minVal) * t);
                      return (
                        <g key={t}>
                          <line
                            x1={padL}
                            y1={y}
                            x2={svgW - padR}
                            y2={y}
                            stroke="#cbd5e1"
                            strokeDasharray="3 3"
                            strokeWidth="1"
                          />
                          <text
                            x={svgW - padR + 8}
                            y={y + 4}
                            fontSize="10"
                            fill="#64748b"
                            textAnchor="start"
                          >
                            {labelVal}
                          </text>
                        </g>
                      );
                    })}

                    {/* X Axis Dates (oldest right -> newest left) */}
                    {seriesPoints.map((pt, idx) => {
                      const step = seriesPoints.length > 14 ? 4 : seriesPoints.length > 8 ? 2 : 1;
                      if (idx % step !== 0 && idx !== seriesPoints.length - 1) return null;
                      const x = xForIndex(idx);
                      return (
                        <text
                          key={pt.date}
                          x={x}
                          y={svgH - 14}
                          fontSize="10"
                          fill="#64748b"
                          textAnchor="middle"
                        >
                          {pt.date.slice(5)}
                        </text>
                      );
                    })}

                    {/* Segmented Paths (gaps preserved when day is null) */}
                    {ureaGeo.paths.map((d, i) => (
                      <path key={`u-p-${i}`} d={d} fill="none" stroke="#047857" strokeWidth="2.5" />
                    ))}
                    {nitrateGeo.paths.map((d, i) => (
                      <path
                        key={`n-p-${i}`}
                        d={d}
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth="2.5"
                        strokeDasharray="6 3"
                      />
                    ))}
                    {sulfateGeo.paths.map((d, i) => (
                      <path
                        key={`s-p-${i}`}
                        d={d}
                        fill="none"
                        stroke="#b45309"
                        strokeWidth="2.5"
                        strokeDasharray="2 3"
                      />
                    ))}

                    {/* Markers */}
                    {ureaGeo.coords.map((pt) => (
                      <circle key={`u-m-${pt.idx}`} cx={pt.x} cy={pt.y} r="4" fill="#047857">
                        <title>{`${pt.date} · يوريا: ${pt.val}`}</title>
                      </circle>
                    ))}
                    {nitrateGeo.coords.map((pt) => (
                      <rect
                        key={`n-m-${pt.idx}`}
                        x={pt.x - 3.5}
                        y={pt.y - 3.5}
                        width="7"
                        height="7"
                        fill="#0284c7"
                      >
                        <title>{`${pt.date} · نترات: ${pt.val}`}</title>
                      </rect>
                    ))}
                    {sulfateGeo.coords.map((pt) => (
                      <polygon
                        key={`s-m-${pt.idx}`}
                        points={`${pt.x},${pt.y - 4.5} ${pt.x + 4.5},${pt.y + 3.5} ${pt.x - 4.5},${pt.y + 3.5}`}
                        fill="#b45309"
                      >
                        <title>{`${pt.date} · سلفات: ${pt.val}`}</title>
                      </polygon>
                    ))}
                  </svg>
                </div>
                )}
              </div>

              {/* Matching Data Table */}
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                      <th className="px-3 py-2.5 text-right">التاريخ</th>
                      <th className="px-3 py-2.5 text-center">يوريا</th>
                      <th className="px-3 py-2.5 text-center">نترات</th>
                      <th className="px-3 py-2.5 text-center">سلفات</th>
                      <th className="px-3 py-2.5 text-center">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {[...seriesPoints].reverse().map((pt) => (
                      <tr key={pt.date} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                          {pt.date}
                        </td>
                        <td className="px-3 py-2 text-center font-mono-num dark:text-slate-200">
                          {pt.urea === null ? '—' : formatNumberAr(pt.urea)}
                        </td>
                        <td className="px-3 py-2 text-center font-mono-num dark:text-slate-200">
                          {pt.nitrate === null ? '—' : formatNumberAr(pt.nitrate)}
                        </td>
                        <td className="px-3 py-2 text-center font-mono-num dark:text-slate-200">
                          {pt.sulfate === null ? '—' : formatNumberAr(pt.sulfate)}
                        </td>
                        <td className="px-3 py-2 text-center font-mono-num font-bold text-emerald-800 dark:text-emerald-400">
                          {pt.total === null ? 'غير مسجل' : formatNumberAr(pt.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: Low Balance Thresholds */}
          {activeTab === 'thresholds' && (
            <div className="space-y-4">
              {/* Threshold Config */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-slate-100">
                      حدود التنبيه للأرصدة المنخفضة (شيكارة) — اترك الحقل فارغًا لتعطيل التنبيه لهذا الصنف
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      يتم الفحص عبر آخر 60 يومًا لكل جمعية؛ السجلات غير المدخلة (فارغة) لا تطلق تنبيهًا، بينما الصفر المسجل أقل من الحد يظهر فورًا.
                    </p>
                  </div>
                  {canEditThresholds && (
                    <button
                      type="button"
                      disabled={savingThresh}
                      onClick={() => void handleSaveThresholds()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {savingThresh ? 'جارٍ الحفظ...' : 'حفظ الحدود'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      ['urea', 'الحد الأدنى العام: يوريا'],
                      ['nitrate', 'الحد الأدنى العام: نترات'],
                      ['sulfate', 'الحد الأدنى العام: سلفات'],
                    ] as const
                  ).map(([code, lbl]) => (
                    <label key={code} className="space-y-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{lbl}</span>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEditThresholds}
                        placeholder="معطّل (فارغ)"
                        value={globalThresh[code] === null ? '' : globalThresh[code]}
                        onChange={(e) =>
                          setGlobalThresh((prev) => ({
                            ...prev,
                            [code]: parseThresholdInput(e.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 font-mono-num dark:text-slate-100 disabled:opacity-60"
                      />
                    </label>
                  ))}
                </div>

                {/* Per-Association Override */}
                {canEditThresholds && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-700 space-y-2">
                    <p className="font-semibold text-slate-700 dark:text-slate-300">
                      تخصيص حد أدنى لجمعية محددة (اختياري):
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <select
                        value={overrideAssocId}
                        onChange={(e) => setOverrideAssocId(e.target.value)}
                        className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 dark:text-slate-100"
                      >
                        <option value="">اختر جمعية لتخصيصها...</option>
                        {visibleAssocs.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nameAr}
                          </option>
                        ))}
                      </select>

                      {overrideAssocId &&
                        (['urea', 'nitrate', 'sulfate'] as const).map((code) => (
                          <input
                            key={code}
                            type="number"
                            min={0}
                            placeholder={`تخصيص ${code === 'urea' ? 'يوريا' : code === 'nitrate' ? 'نترات' : 'سلفات'}`}
                            value={
                              currentAssocOverride[code] === null ||
                              currentAssocOverride[code] === undefined
                                ? ''
                                : currentAssocOverride[code]
                            }
                            onChange={(e) => {
                              const parsed = parseThresholdInput(e.target.value);
                              setAssocOverrides((prev) => ({
                                ...prev,
                                [overrideAssocId]: {
                                  ...(prev[overrideAssocId] || {}),
                                  [code]: parsed,
                                },
                              }));
                            }}
                            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 font-mono-num dark:text-slate-100"
                          />
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {lowBalanceResult.truncated && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2 text-amber-900 dark:text-amber-200">
                  يُعرض أول 200 تنبيه من إجمالي {formatNumberAr(lowBalanceResult.totalCount)} تنبيهًا مطابقًا.
                </div>
              )}

              {lowBalanceResult.alerts.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-8 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-700 dark:text-emerald-400 mx-auto" />
                  <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    ✔️ لا توجد أرصدة منخفضة دون الحدود المعرّفة حاليًا.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                        <th className="px-3 py-2.5 text-right">الجمعية</th>
                        <th className="px-3 py-2.5 text-right">المحافظة</th>
                        <th className="px-3 py-2.5 text-center">الصنف</th>
                        <th className="px-3 py-2.5 text-center">الرصيد الحالي</th>
                        <th className="px-3 py-2.5 text-center">الحد الأدنى</th>
                        <th className="px-3 py-2.5 text-center">تاريخ السجل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {lowBalanceResult.alerts.map((al, i) => (
                        <tr key={`${al.associationId}-${al.fertilizerCode}-${i}`} className="bg-rose-50/30 dark:bg-rose-950/20">
                          <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                            {al.associationName}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                            {al.governorateName}
                          </td>
                          <td className="px-3 py-2.5 text-center font-semibold dark:text-slate-200">
                            {al.fertilizerName}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono-num font-bold text-rose-700 dark:text-rose-400">
                            {formatNumberAr(al.currentBalance)}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono-num text-slate-700 dark:text-slate-300">
                            {formatNumberAr(al.threshold)}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono-num text-slate-600 dark:text-slate-400">
                            {al.lastUpdatedDate}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
