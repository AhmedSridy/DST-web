import type {
  AgriculturalAssociation,
  DailyDisbursementRow,
  DailyReport,
  FertilizerThresholdConfig,
  Governorate,
} from '../types/domain.ts';
import { computeDisbursementRow } from './calculations.ts';
import { isAssociationVisibleOnDate, sortAssociationsByOrder } from './arabicNormalize.ts';

export type CoreFertilizerCode = 'urea' | 'nitrate' | 'sulfate';

export const CORE_FERTILIZERS: Array<{ code: CoreFertilizerCode; nameAr: string }> = [
  { code: 'urea', nameAr: 'يوريا' },
  { code: 'nitrate', nameAr: 'نترات' },
  { code: 'sulfate', nameAr: 'سلفات' },
];

export function isRowRecorded(row: DailyDisbursementRow | undefined | null): boolean {
  if (!row) return false;
  return (
    row.openingBalance !== null ||
    row.closingBalance !== null ||
    row.settlementQty !== null
  );
}

export function addDaysIso(dateIso: string, deltaDays: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function generateDateRangeIso(endDate: string, days: number): string[] {
  const safeDays = Math.max(1, Math.min(90, Math.round(days)));
  const out: string[] = [];
  for (let i = safeDays - 1; i >= 0; i--) {
    out.push(addDaysIso(endDate, -i));
  }
  return out;
}

export interface AssociationCompletionMissing {
  associationId: string;
  associationName: string;
  missingOpening: boolean;
  missingClosing: boolean;
  missingSettlement: boolean;
  hasAnyData: boolean;
}

export function computeAssociationCompletion(
  associations: AgriculturalAssociation[],
  disbursements: DailyDisbursementRow[],
  reportId: string,
  selectedDate?: string,
): {
  completedCount: number;
  missingOpeningCount: number;
  missingClosingCount: number;
  missingSettlementCount: number;
  details: AssociationCompletionMissing[];
} {
  const reportRows = disbursements.filter((d) => d.reportId === reportId);
  const recordedSet = new Set(reportRows.filter((r) => isRowRecorded(r)).map((r) => r.associationId));
  const sortedAssocs = sortAssociationsByOrder(associations);
  const details: AssociationCompletionMissing[] = [];
  let completedCount = 0;
  let missingOpeningCount = 0;
  let missingClosingCount = 0;
  let missingSettlementCount = 0;

  for (const assoc of sortedAssocs) {
    const visible = selectedDate
      ? isAssociationVisibleOnDate(assoc, selectedDate, recordedSet)
      : assoc.isActive;
    if (!visible) continue;
    const rows = reportRows.filter((r) => r.associationId === assoc.id);
    const hasOpening = rows.some((r) => r.openingBalance !== null);
    const hasClosing = rows.some((r) => r.closingBalance !== null);
    const hasSettlement = rows.some((r) => r.settlementQty !== null);
    const hasAnyData = hasOpening || hasClosing || hasSettlement;

    if (!hasOpening) missingOpeningCount++;
    if (!hasClosing) missingClosingCount++;
    if (!hasSettlement) missingSettlementCount++;
    if (hasOpening && hasClosing && hasSettlement) {
      completedCount++;
    }

    details.push({
      associationId: assoc.id,
      associationName: assoc.nameAr,
      missingOpening: !hasOpening,
      missingClosing: !hasClosing,
      missingSettlement: !hasSettlement,
      hasAnyData,
    });
  }

  return {
    completedCount,
    missingOpeningCount,
    missingClosingCount,
    missingSettlementCount,
    details,
  };
}

export interface AssociationBalanceEntry {
  associationId: string;
  associationCode: string;
  associationName: string;
  governorateId: string;
  urea: number | null;
  nitrate: number | null;
  sulfate: number | null;
  total: number;
  lastUpdatedDate: string | null;
  hasAnyRecord: boolean;
}

export interface GovernorateBalanceSummary {
  governorateId: string;
  governorateName: string;
  totalAssociations: number;
  recordedAssociations: number;
  urea: number;
  nitrate: number;
  sulfate: number;
  grandTotal: number;
  associations: AssociationBalanceEntry[];
}

export function computeBalancesReport(params: {
  governorates: Governorate[];
  associations: AgriculturalAssociation[];
  reports: DailyReport[];
  disbursements: DailyDisbursementRow[];
  upToDate: string;
}): {
  byGovernorate: GovernorateBalanceSummary[];
  grandTotals: { urea: number; nitrate: number; sulfate: number; total: number };
} {
  const reportById = new Map(params.reports.map((r) => [r.id, r]));

  // Map: `${associationId}::${fertilizerCode}` -> { closingBalance, date }
  const latestMap = new Map<string, { val: number; date: string }>();

  for (const row of params.disbursements) {
    if (row.closingBalance === null || row.closingBalance === undefined) continue;
    const rep = reportById.get(row.reportId);
    if (!rep) continue;
    if (rep.reportDate > params.upToDate) continue;

    const key = `${row.associationId}::${row.fertilizerCode}`;
    const existing = latestMap.get(key);
    if (!existing || rep.reportDate > existing.date) {
      latestMap.set(key, { val: Number(row.closingBalance), date: rep.reportDate });
    }
  }

  const byGovernorate: GovernorateBalanceSummary[] = [];
  const grandTotals = { urea: 0, nitrate: 0, sulfate: 0, total: 0 };

  for (const gov of params.governorates) {
    const govAssocs = sortAssociationsByOrder(
      params.associations.filter((a) => a.governorateId === gov.id && a.isActive),
    );
    if (govAssocs.length === 0) continue;

    let govUrea = 0;
    let govNitrate = 0;
    let govSulfate = 0;
    let recordedCount = 0;
    const entries: AssociationBalanceEntry[] = [];

    for (const assoc of govAssocs) {
      const u = latestMap.get(`${assoc.id}::urea`);
      const n = latestMap.get(`${assoc.id}::nitrate`);
      const s = latestMap.get(`${assoc.id}::sulfate`);

      const dates = [u?.date, n?.date, s?.date].filter((d): d is string => Boolean(d));
      const lastUpdatedDate = dates.length > 0 ? dates.sort().reverse()[0] : null;
      const hasAnyRecord = dates.length > 0;
      if (hasAnyRecord) recordedCount++;

      const ureaVal = u ? u.val : null;
      const nitrateVal = n ? n.val : null;
      const sulfateVal = s ? s.val : null;
      const assocTotal = (ureaVal || 0) + (nitrateVal || 0) + (sulfateVal || 0);

      govUrea += ureaVal || 0;
      govNitrate += nitrateVal || 0;
      govSulfate += sulfateVal || 0;

      entries.push({
        associationId: assoc.id,
        associationCode: assoc.code,
        associationName: assoc.nameAr,
        governorateId: gov.id,
        urea: ureaVal,
        nitrate: nitrateVal,
        sulfate: sulfateVal,
        total: assocTotal,
        lastUpdatedDate,
        hasAnyRecord,
      });
    }

    const govGrand = govUrea + govNitrate + govSulfate;
    grandTotals.urea += govUrea;
    grandTotals.nitrate += govNitrate;
    grandTotals.sulfate += govSulfate;
    grandTotals.total += govGrand;

    byGovernorate.push({
      governorateId: gov.id,
      governorateName: gov.nameAr,
      totalAssociations: govAssocs.length,
      recordedAssociations: recordedCount,
      urea: govUrea,
      nitrate: govNitrate,
      sulfate: govSulfate,
      grandTotal: govGrand,
      associations: entries,
    });
  }

  return { byGovernorate, grandTotals };
}

export interface OverdueGovernorateItem {
  governorateId: string;
  governorateName: string;
  recordedCount: number;
  totalCount: number;
  overdueCount: number;
  unrecordedAssociations: Array<{ id: string; code: string; nameAr: string }>;
}

export function computeOverdueReport(params: {
  governorates: Governorate[];
  associations: AgriculturalAssociation[];
  disbursements: DailyDisbursementRow[];
  selectedDate: string;
  currentGovernorateId?: string;
}): OverdueGovernorateItem[] {
  const items: OverdueGovernorateItem[] = [];

  for (const gov of params.governorates) {
    const reportId = `rep-${gov.id}-${params.selectedDate}`;
    const rowsForDay = params.disbursements.filter((d) => d.reportId === reportId);
    const recordedSet = new Set<string>();
    for (const row of rowsForDay) {
      if (isRowRecorded(row)) {
        recordedSet.add(row.associationId);
      }
    }

    const govAssocs = sortAssociationsByOrder(
      params.associations.filter(
        (a) =>
          a.governorateId === gov.id &&
          isAssociationVisibleOnDate(a, params.selectedDate, recordedSet),
      ),
    );
    if (govAssocs.length === 0) continue;

    const unrecordedAssociations = govAssocs
      .filter((a) => !recordedSet.has(a.id))
      .map((a) => ({ id: a.id, code: a.code, nameAr: a.nameAr }));

    items.push({
      governorateId: gov.id,
      governorateName: gov.nameAr,
      recordedCount: govAssocs.length - unrecordedAssociations.length,
      totalCount: govAssocs.length,
      overdueCount: unrecordedAssociations.length,
      unrecordedAssociations,
    });
  }

  // Sort: current governorate first, then most overdue descending, then name
  return items.sort((a, b) => {
    if (params.currentGovernorateId) {
      if (a.governorateId === params.currentGovernorateId && b.governorateId !== params.currentGovernorateId) {
        return -1;
      }
      if (b.governorateId === params.currentGovernorateId && a.governorateId !== params.currentGovernorateId) {
        return 1;
      }
    }
    if (b.overdueCount !== a.overdueCount) {
      return b.overdueCount - a.overdueCount;
    }
    return a.governorateName.localeCompare(b.governorateName, 'ar');
  });
}

export type AnalyticsMetricKey = 'disbursed' | 'closing' | 'opening';

export interface MultiDaySeriesPoint {
  date: string;
  shortLabel: string;
  urea: number | null;
  nitrate: number | null;
  sulfate: number | null;
  total: number | null;
}

export type MultiDayPoint = MultiDaySeriesPoint;

export function computeMultiDaySeries(params: {
  disbursements: DailyDisbursementRow[];
  associations: AgriculturalAssociation[];
  reports?: DailyReport[];
  governorateId: string;
  associationId?: string | 'all';
  endDate: string;
  days: 7 | 14 | 30;
  metric: AnalyticsMetricKey;
  treatEmptyAsZero?: boolean;
}): MultiDaySeriesPoint[] {
  const dates = generateDateRangeIso(params.endDate, params.days);
  const targetAssocs = new Set(
    params.associations
      .filter(
        (a) =>
          a.governorateId === params.governorateId &&
          a.isActive &&
          (!params.associationId || params.associationId === 'all' || a.id === params.associationId),
      )
      .map((a) => a.id),
  );

  return dates.map((dateIso) => {
    const reportId = `rep-${params.governorateId}-${dateIso}`;
    const dayRows = params.disbursements.filter(
      (d) => d.reportId === reportId && targetAssocs.has(d.associationId),
    );

    const calcForFert = (fert: CoreFertilizerCode): number | null => {
      const fertRows = dayRows.filter((r) => r.fertilizerCode === fert && isRowRecorded(r));
      if (fertRows.length === 0) return null;

      let sum = 0;
      let hasAnyValue = false;

      for (const row of fertRows) {
        if (params.metric === 'closing') {
          if (row.closingBalance !== null && row.closingBalance !== undefined) {
            sum += Number(row.closingBalance);
            hasAnyValue = true;
          }
        } else if (params.metric === 'opening') {
          if (row.openingBalance !== null && row.openingBalance !== undefined) {
            sum += Number(row.openingBalance);
            hasAnyValue = true;
          }
        } else {
          const comp = computeDisbursementRow(
            {
              openingBalance: row.openingBalance,
              closingBalance: row.closingBalance,
              settlementQty: row.settlementQty,
            },
            Boolean(params.treatEmptyAsZero),
          );
          if (comp.actualDisbursed !== null) {
            sum += comp.actualDisbursed;
            hasAnyValue = true;
          }
        }
      }

      return hasAnyValue ? Number(sum.toFixed(2)) : null;
    };

    const [, m, d] = dateIso.split('-');
    const urea = calcForFert('urea');
    const nitrate = calcForFert('nitrate');
    const sulfate = calcForFert('sulfate');
    const nonNull = [urea, nitrate, sulfate].filter((v): v is number => v !== null);
    const total =
      nonNull.length > 0 ? Number(nonNull.reduce((s, v) => s + v, 0).toFixed(2)) : null;

    return {
      date: dateIso,
      shortLabel: `${Number(d)}/${Number(m)}`,
      urea,
      nitrate,
      sulfate,
      total,
    };
  });
}

export interface LowBalanceAlertItem {
  governorateId: string;
  governorateName: string;
  associationId: string;
  associationName: string;
  fertilizerCode: CoreFertilizerCode;
  fertilizerName: string;
  currentBalance: number;
  threshold: number;
  lastUpdatedDate: string;
}

export function computeLowBalanceAlerts(params: {
  governorates: Governorate[];
  associations: AgriculturalAssociation[];
  reports: DailyReport[];
  disbursements: DailyDisbursementRow[];
  upToDate: string;
  minThresholds: FertilizerThresholdConfig;
  assocMinThresholds?: Record<string, Partial<FertilizerThresholdConfig>>;
  maxRows?: number;
}): {
  alerts: LowBalanceAlertItem[];
  totalCount: number;
  truncated: boolean;
} {
  const maxRows = params.maxRows ?? 200;
  const windowStart = addDaysIso(params.upToDate, -59); // last 60 days inclusive
  const reportById = new Map(params.reports.map((r) => [r.id, r]));

  // Map `${assocId}::${fert}` -> { balance, date } within 60-day window
  const latestWithinWindow = new Map<string, { balance: number; date: string }>();

  for (const row of params.disbursements) {
    if (row.closingBalance === null || row.closingBalance === undefined) continue;
    const rep = reportById.get(row.reportId);
    if (!rep) continue;
    if (rep.reportDate < windowStart || rep.reportDate > params.upToDate) continue;

    const key = `${row.associationId}::${row.fertilizerCode}`;
    const existing = latestWithinWindow.get(key);
    if (!existing || rep.reportDate > existing.date) {
      latestWithinWindow.set(key, { balance: Number(row.closingBalance), date: rep.reportDate });
    }
  }

  const govMap = new Map(params.governorates.map((g) => [g.id, g]));
  const allAlerts: LowBalanceAlertItem[] = [];

  for (const assoc of params.associations) {
    if (!assoc.isActive) continue;
    const gov = govMap.get(assoc.governorateId);
    if (!gov) continue;

    for (const fert of CORE_FERTILIZERS) {
      const assocOverride = params.assocMinThresholds?.[assoc.id]?.[fert.code];
      const threshold =
        assocOverride !== undefined ? assocOverride : params.minThresholds[fert.code];

      // Null or undefined means threshold monitoring is disabled for this fertilizer
      if (threshold === null || threshold === undefined) continue;

      const latest = latestWithinWindow.get(`${assoc.id}::${fert.code}`);
      // Unrecorded within last 60 days -> skip cleanly (never alert as 0)
      if (!latest) continue;

      if (latest.balance < threshold) {
        allAlerts.push({
          governorateId: gov.id,
          governorateName: gov.nameAr,
          associationId: assoc.id,
          associationName: assoc.nameAr,
          fertilizerCode: fert.code,
          fertilizerName: fert.nameAr,
          currentBalance: latest.balance,
          threshold,
          lastUpdatedDate: latest.date,
        });
      }
    }
  }

  allAlerts.sort((a, b) => {
    const defA = a.threshold - a.currentBalance;
    const defB = b.threshold - b.currentBalance;
    if (defB !== defA) return defB - defA;
    return a.associationName.localeCompare(b.associationName, 'ar');
  });

  return {
    alerts: allAlerts.slice(0, maxRows),
    totalCount: allAlerts.length,
    truncated: allAlerts.length > maxRows,
  };
}

export function getGovernoratesWithActiveAssociations(
  governorates: Governorate[],
  associations: AgriculturalAssociation[],
): Governorate[] {
  const activeGovIds = new Set(
    associations.filter((a) => a.isActive).map((a) => a.governorateId),
  );
  return governorates.filter((g) => activeGovIds.has(g.id));
}

export interface DashboardGovChartPoint {
  governorateId: string;
  name: string;
  المنصرف: number;
  التسوية: number;
}

/**
 * Returns chart points ONLY for governorates that have at least one active association.
 * Historical total disbursed/settlement for each visible governorate includes all of its
 * existing records (including soft-deactivated associations), while permanently deleted
 * associations' records are gone from disbursements.
 */
export function computeDashboardGovChartData(params: {
  governorates: Governorate[];
  associations: AgriculturalAssociation[];
  reports: DailyReport[];
  disbursements: DailyDisbursementRow[];
}): DashboardGovChartPoint[] {
  const activeGovs = getGovernoratesWithActiveAssociations(
    params.governorates,
    params.associations,
  );
  return activeGovs.map((gov) => {
    const govRepIds = new Set(
      params.reports.filter((r) => r.governorateId === gov.id).map((r) => r.id),
    );
    const govRows = params.disbursements.filter(
      (d) => govRepIds.has(d.reportId) || d.governorateId === gov.id,
    );
    const disbursed = govRows.reduce((s, r) => s + (r.actualDisbursed || 0), 0);
    const settled = govRows.reduce((s, r) => s + (r.settlementQty || 0), 0);
    return {
      governorateId: gov.id,
      name: gov.nameAr,
      المنصرف: disbursed,
      التسوية: settled,
    };
  });
}

/**
 * Returns the ISO date (YYYY-MM-DD) for the same calendar day of the previous month.
 * Clamps end-of-month dates to the last valid day of the previous month
 * (e.g., 2026-03-31 -> 2026-02-28, 2024-03-31 -> 2024-02-29, 2026-01-15 -> 2025-12-15).
 */
export function getSameDayPreviousMonthIso(dateIso: string): string {
  const parts = dateIso.split('-').map(Number);
  const year = parts[0] || 2026;
  const month = parts[1] || 1;
  const day = parts[2] || 1;

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const daysInPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(1, day), daysInPrevMonth);

  return `${String(prevYear).padStart(4, '0')}-${String(prevMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export interface TodayVsLastMonthFertilizerBreakdown {
  code: CoreFertilizerCode;
  nameAr: string;
  today: number;
  prevMonth: number;
  delta: number;
}

export interface TodayVsLastMonthComparison {
  todayDate: string;
  prevMonthDate: string;
  todayTotal: number;
  prevMonthTotal: number;
  deltaBags: number;
  percentChange: number | null;
  direction: 'up' | 'down' | 'same';
  hasTodayData: boolean;
  hasPrevMonthData: boolean;
  byFertilizer: TodayVsLastMonthFertilizerBreakdown[];
  summaryChartData: Array<{
    key: 'prevMonth' | 'today';
    label: string;
    date: string;
    المنصرف: number;
  }>;
  fertilizerChartData: Array<{
    name: string;
    'الشهر الماضي': number;
    'اليوم': number;
  }>;
}

/**
 * Compares total disbursed fertilizer bags on `todayDate` against the same day
 * of the previous month, preserving the fixed fertilizer order (urea -> nitrate -> sulfate).
 */
export function computeTodayVsLastMonthDisbursement(params: {
  reports: DailyReport[];
  disbursements: DailyDisbursementRow[];
  todayDate: string;
}): TodayVsLastMonthComparison {
  const todayDate = params.todayDate;
  const prevMonthDate = getSameDayPreviousMonthIso(todayDate);
  const reportDateById = new Map(params.reports.map((r) => [r.id, r.reportDate]));

  const resolveRowDate = (row: DailyDisbursementRow): string | null => {
    if (typeof row.reportId !== 'string' || !row.reportId) return null;
    const fromReport = reportDateById.get(row.reportId);
    if (fromReport) return fromReport;
    const match = row.reportId.match(/(\d{4}-\d{2}-\d{2})$/);
    return match ? match[1] : null;
  };

  const todayByFert: Record<CoreFertilizerCode, number> = { urea: 0, nitrate: 0, sulfate: 0 };
  const prevByFert: Record<CoreFertilizerCode, number> = { urea: 0, nitrate: 0, sulfate: 0 };
  let hasTodayData = false;
  let hasPrevMonthData = false;

  for (const row of params.disbursements) {
    if (
      row.fertilizerCode !== 'urea' &&
      row.fertilizerCode !== 'nitrate' &&
      row.fertilizerCode !== 'sulfate'
    ) {
      continue;
    }

    const rowDate = resolveRowDate(row);
    if (rowDate !== todayDate && rowDate !== prevMonthDate) continue;

    let disbursed: number | null =
      row.actualDisbursed !== null && row.actualDisbursed !== undefined
        ? Number(row.actualDisbursed)
        : null;

    if (disbursed === null && row.openingBalance !== null && row.closingBalance !== null) {
      disbursed = computeDisbursementRow(
        {
          openingBalance: row.openingBalance,
          closingBalance: row.closingBalance,
          settlementQty: row.settlementQty,
        },
        false,
      ).actualDisbursed;
    }

    if (disbursed === null || !Number.isFinite(disbursed)) continue;

    if (rowDate === todayDate) {
      todayByFert[row.fertilizerCode] += disbursed;
      hasTodayData = true;
    } else if (rowDate === prevMonthDate) {
      prevByFert[row.fertilizerCode] += disbursed;
      hasPrevMonthData = true;
    }
  }

  const round2 = (n: number) => Number(n.toFixed(2));

  const byFertilizer: TodayVsLastMonthFertilizerBreakdown[] = CORE_FERTILIZERS.map((ft) => {
    const today = round2(todayByFert[ft.code]);
    const prevMonth = round2(prevByFert[ft.code]);
    return {
      code: ft.code,
      nameAr: ft.nameAr,
      today,
      prevMonth,
      delta: round2(today - prevMonth),
    };
  });

  const todayTotal = round2(byFertilizer.reduce((sum, item) => sum + item.today, 0));
  const prevMonthTotal = round2(byFertilizer.reduce((sum, item) => sum + item.prevMonth, 0));
  const deltaBags = round2(todayTotal - prevMonthTotal);
  const direction: 'up' | 'down' | 'same' =
    deltaBags > 0 ? 'up' : deltaBags < 0 ? 'down' : 'same';

  let percentChange: number | null;
  if (prevMonthTotal > 0) {
    percentChange = Number((((todayTotal - prevMonthTotal) / prevMonthTotal) * 100).toFixed(1));
  } else if (todayTotal === 0) {
    percentChange = 0;
  } else {
    percentChange = null;
  }

  return {
    todayDate,
    prevMonthDate,
    todayTotal,
    prevMonthTotal,
    deltaBags,
    percentChange,
    direction,
    hasTodayData,
    hasPrevMonthData,
    byFertilizer,
    summaryChartData: [
      {
        key: 'prevMonth',
        label: 'الشهر الماضي',
        date: prevMonthDate,
        المنصرف: prevMonthTotal,
      },
      {
        key: 'today',
        label: 'اليوم',
        date: todayDate,
        المنصرف: todayTotal,
      },
    ],
    fertilizerChartData: byFertilizer.map((f) => ({
      name: f.nameAr,
      'الشهر الماضي': f.prevMonth,
      'اليوم': f.today,
    })),
  };
}
