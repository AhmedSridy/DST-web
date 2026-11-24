import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AgriculturalAssociation,
  DailyDisbursementRow,
  DailyReport,
  Governorate,
} from '../types/domain.ts';
import {
  computeBalancesReport,
  computeDashboardGovChartData,
  computeLowBalanceAlerts,
  computeMultiDaySeries,
  computeOverdueReport,
  computeTodayVsLastMonthDisbursement,
  getGovernoratesWithActiveAssociations,
  getSameDayPreviousMonthIso,
} from './analytics.ts';

const govs: Governorate[] = [
  { id: 'gov-ismailia', code: 'ISM', nameAr: 'الإسماعيلية', region: 'القناة', isActive: true },
  { id: 'gov-suez', code: 'SUZ', nameAr: 'السويس', region: 'القناة', isActive: true },
];

const assocs: AgriculturalAssociation[] = [
  {
    id: 'a-1',
    code: 'ISM-001',
    nameAr: 'الضبعية',
    normalizedName: 'الضبعيه',
    governorateId: 'gov-ismailia',
    centerId: 'c-1',
    managerName: '',
    managerPhone: '',
    isActive: true,
  },
  {
    id: 'a-2',
    code: 'ISM-002',
    nameAr: 'نفيشة',
    normalizedName: 'نفيشه',
    governorateId: 'gov-ismailia',
    centerId: 'c-1',
    managerName: '',
    managerPhone: '',
    isActive: true,
  },
  {
    id: 'a-3',
    code: 'SUZ-001',
    nameAr: 'كبريت',
    normalizedName: 'كبريت',
    governorateId: 'gov-suez',
    centerId: 'c-2',
    managerName: '',
    managerPhone: '',
    isActive: true,
  },
];

const reports: DailyReport[] = [
  {
    id: 'rep-gov-ismailia-2026-11-10',
    governorateId: 'gov-ismailia',
    reportDate: '2026-11-10',
    status: 'draft',
    createdByUid: 'u1',
    createdByName: 'u1',
    centralSyncStatus: 'pending',
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
  },
  {
    id: 'rep-gov-ismailia-2026-11-12',
    governorateId: 'gov-ismailia',
    reportDate: '2026-11-12',
    status: 'draft',
    createdByUid: 'u1',
    createdByName: 'u1',
    centralSyncStatus: 'pending',
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
  },
];

const disbursements: DailyDisbursementRow[] = [
  // a-1 recorded on 2026-11-10 (urea closing 120) and updated on 2026-11-12 (urea closing 0 manually!)
  {
    id: 'd1',
    reportId: 'rep-gov-ismailia-2026-11-10',
    associationId: 'a-1',
    fertilizerCode: 'urea',
    openingBalance: 200,
    closingBalance: 120,
    settlementQty: 80,
    actualDisbursed: 80,
    variance: 0,
    varianceReason: '',
    updatedAt: '2026-11-10T00:00:00Z',
  },
  {
    id: 'd2',
    reportId: 'rep-gov-ismailia-2026-11-12',
    associationId: 'a-1',
    fertilizerCode: 'urea',
    openingBalance: 120,
    closingBalance: 0,
    settlementQty: 120,
    actualDisbursed: 120,
    variance: 0,
    varianceReason: '',
    updatedAt: '2026-11-12T00:00:00Z',
  },
  // a-2 only has null cells on 2026-11-12 (not recorded!)
  {
    id: 'd3',
    reportId: 'rep-gov-ismailia-2026-11-12',
    associationId: 'a-2',
    fertilizerCode: 'urea',
    openingBalance: null,
    closingBalance: null,
    settlementQty: null,
    actualDisbursed: null,
    variance: null,
    varianceReason: '',
    updatedAt: '2026-11-12T00:00:00Z',
  },
];

test('computeOverdueReport distinguishes manual zero (recorded) vs null (overdue)', () => {
  const overdue = computeOverdueReport({
    governorates: govs,
    associations: assocs,
    disbursements,
    selectedDate: '2026-11-12',
    currentGovernorateId: 'gov-ismailia',
  });

  // Current governorate comes first
  assert.equal(overdue[0].governorateId, 'gov-ismailia');
  assert.equal(overdue[0].recordedCount, 1); // a-1 recorded manual 0
  assert.equal(overdue[0].totalCount, 2);
  assert.equal(overdue[0].overdueCount, 1);
  assert.deepEqual(
    overdue[0].unrecordedAssociations.map((a) => a.id),
    ['a-2'],
  );

  // Suez has 0 recorded of 1
  assert.equal(overdue[1].governorateId, 'gov-suez');
  assert.equal(overdue[1].overdueCount, 1);
});

test('computeMultiDaySeries leaves gaps (null) on unrecorded days and orders oldest -> newest', () => {
  const series = computeMultiDaySeries({
    disbursements,
    associations: assocs,
    governorateId: 'gov-ismailia',
    endDate: '2026-11-12',
    days: 7,
    metric: 'disbursed',
  });

  assert.equal(series.length, 7);
  assert.equal(series[0].date, '2026-11-06');
  assert.equal(series[6].date, '2026-11-12');

  // 2026-11-10 has urea = 80; 2026-11-11 is a GAP (null, never 0); 2026-11-12 has urea = 120
  const nov10 = series.find((p) => p.date === '2026-11-10')!;
  const nov11 = series.find((p) => p.date === '2026-11-11')!;
  const nov12 = series.find((p) => p.date === '2026-11-12')!;
  assert.equal(nov10.urea, 80);
  assert.equal(nov11.urea, null);
  assert.equal(nov12.urea, 120);
});

test('computeLowBalanceAlerts alerts on recorded 0 < threshold, ignores unrecorded associations', () => {
  const res = computeLowBalanceAlerts({
    governorates: govs,
    associations: assocs,
    reports,
    disbursements,
    upToDate: '2026-11-12',
    minThresholds: { urea: 50, nitrate: null, sulfate: null },
  });

  // a-1 recorded closing 0 < 50 -> triggers alert!
  // a-2 & a-3 never recorded -> must NOT trigger alerts!
  assert.equal(res.totalCount, 1);
  assert.equal(res.alerts[0].associationId, 'a-1');
  assert.equal(res.alerts[0].currentBalance, 0);
  assert.equal(res.alerts[0].threshold, 50);
});

test('computeBalancesReport fetches latest closing balance up to date', () => {
  const rep = computeBalancesReport({
    governorates: govs,
    associations: assocs,
    reports,
    disbursements,
    upToDate: '2026-11-11',
  });
  const ism = rep.byGovernorate.find((g) => g.governorateId === 'gov-ismailia')!;
  const a1 = ism.associations.find((a) => a.associationId === 'a-1')!;
  const a2 = ism.associations.find((a) => a.associationId === 'a-2')!;
  assert.equal(a1.urea, 120); // 2026-11-10 value since upToDate is 2026-11-11
  assert.equal(a1.lastUpdatedDate, '2026-11-10');
  assert.equal(a2.hasAnyRecord, false);
  assert.equal(a2.urea, null);
});

test('computeOverdueReport excludes associations created after selectedDate and preserves sortOrder', () => {
  const datedAssocs: AgriculturalAssociation[] = [
    { ...assocs[1], sortOrder: 2 },
    { ...assocs[0], sortOrder: 1 },
    {
      id: 'a-new',
      code: 'ISM-999',
      nameAr: 'جمعية مستحدثة',
      normalizedName: 'جمعيه مستحدثه',
      governorateId: 'gov-ismailia',
      centerId: 'c-1',
      managerName: '',
      managerPhone: '',
      sortOrder: 0,
      isActive: true,
      createdAt: '2026-11-15T10:00:00Z',
    },
  ];

  const overdueOldDay = computeOverdueReport({
    governorates: govs,
    associations: datedAssocs,
    disbursements: [],
    selectedDate: '2026-11-12',
    currentGovernorateId: 'gov-ismailia',
  });
  // a-new must NOT be counted as overdue on 2026-11-12, and order respects sortOrder (a-1 then a-2)
  assert.deepEqual(
    overdueOldDay[0].unrecordedAssociations.map((a) => a.id),
    ['a-1', 'a-2'],
  );

  const overdueNewDay = computeOverdueReport({
    governorates: govs,
    associations: datedAssocs,
    disbursements: [],
    selectedDate: '2026-11-15',
    currentGovernorateId: 'gov-ismailia',
  });
  assert.deepEqual(
    overdueNewDay[0].unrecordedAssociations.map((a) => a.id),
    ['a-new', 'a-1', 'a-2'],
  );
});

test('computeDashboardGovChartData dynamically follows active associations regardless of disbursement value', () => {
  const allGovs: Governorate[] = [
    ...govs,
    { id: 'gov-cairo', code: 'CAI', nameAr: 'القاهرة', region: 'القاهرة الكبرى', isActive: true },
  ];

  // Cairo has NO active associations -> excluded; Ismailia & Suez have active associations -> included (Suez with 0 disbursement)
  const initialChart = computeDashboardGovChartData({
    governorates: allGovs,
    associations: assocs,
    reports,
    disbursements,
  });
  assert.deepEqual(
    initialChart.map((p) => p.governorateId),
    ['gov-ismailia', 'gov-suez'],
  );
  assert.equal(initialChart.find((p) => p.governorateId === 'gov-suez')?.المنصرف, 0);

  // Add an active association to Cairo -> Cairo immediately appears even with 0 disbursements
  const withCairoAssoc: AgriculturalAssociation[] = [
    ...assocs,
    {
      id: 'a-cairo-1',
      code: 'CAI-001',
      nameAr: 'جمعية المطرية',
      normalizedName: 'جمعيه المطريه',
      governorateId: 'gov-cairo',
      centerId: 'c-cairo',
      managerName: '',
      managerPhone: '',
      isActive: true,
    },
  ];
  const chartWithCairo = computeDashboardGovChartData({
    governorates: allGovs,
    associations: withCairoAssoc,
    reports,
    disbursements,
  });
  assert.deepEqual(
    chartWithCairo.map((p) => p.governorateId),
    ['gov-ismailia', 'gov-suez', 'gov-cairo'],
  );

  // Deactivate all associations in Ismailia -> Ismailia disappears immediately even though it has disbursements
  // Deactivate one association in Ismailia while keeping the other active -> Ismailia stays and keeps historical total
  const oneDeactivated = assocs.map((a) => (a.id === 'a-1' ? { ...a, isActive: false } : a));
  const chartPartialDeact = computeDashboardGovChartData({
    governorates: allGovs,
    associations: oneDeactivated,
    reports,
    disbursements,
  });
  assert.equal(chartPartialDeact.find((p) => p.governorateId === 'gov-ismailia')?.المنصرف, 200);

  const allIsmDeactivated = assocs.map((a) =>
    a.governorateId === 'gov-ismailia' ? { ...a, isActive: false } : a,
  );
  const chartNoIsm = computeDashboardGovChartData({
    governorates: allGovs,
    associations: allIsmDeactivated,
    reports,
    disbursements,
  });
  assert.deepEqual(
    chartNoIsm.map((p) => p.governorateId),
    ['gov-suez'],
  );

  // When NO governorate has any active associations -> returns empty list cleanly
  const noneActive = assocs.map((a) => ({ ...a, isActive: false }));
  assert.deepEqual(getGovernoratesWithActiveAssociations(allGovs, noneActive), []);
  assert.deepEqual(
    computeDashboardGovChartData({
      governorates: allGovs,
      associations: noneActive,
      reports,
      disbursements,
    }),
    [],
  );
});

test('analytics helpers safely ignore disbursements referencing permanently deleted associations', () => {
  const orphanDisbursements: DailyDisbursementRow[] = [
    ...disbursements,
    {
      id: 'd-orphan',
      reportId: 'rep-gov-ismailia-2026-11-12',
      governorateId: 'gov-ismailia',
      associationId: 'deleted-assoc-999',
      fertilizerCode: 'urea',
      openingBalance: 50,
      closingBalance: 10,
      settlementQty: 40,
      actualDisbursed: 40,
      variance: 0,
      varianceReason: '',
      updatedAt: '2026-11-12T00:00:00Z',
    },
  ];

  const balances = computeBalancesReport({
    governorates: govs,
    associations: assocs,
    reports,
    disbursements: orphanDisbursements,
    upToDate: '2026-11-12',
  });
  assert.equal(balances.byGovernorate.length, 2);
  assert.equal(
    balances.byGovernorate
      .find((g) => g.governorateId === 'gov-ismailia')
      ?.associations.some((a) => a.associationId === 'deleted-assoc-999'),
    false,
  );

  const lowAlerts = computeLowBalanceAlerts({
    governorates: govs,
    associations: assocs,
    reports,
    disbursements: orphanDisbursements,
    upToDate: '2026-11-12',
    minThresholds: { urea: 50, nitrate: null, sulfate: null },
  });
  assert.equal(
    lowAlerts.alerts.some((a) => a.associationId === 'deleted-assoc-999'),
    false,
  );
});

test('getSameDayPreviousMonthIso handles normal months, year rollover, and end-of-month clamping', () => {
  assert.equal(getSameDayPreviousMonthIso('2026-11-21'), '2026-10-21');
  assert.equal(getSameDayPreviousMonthIso('2026-01-15'), '2025-12-15');
  assert.equal(getSameDayPreviousMonthIso('2026-03-31'), '2026-02-28');
  assert.equal(getSameDayPreviousMonthIso('2024-03-31'), '2024-02-29');
  assert.equal(getSameDayPreviousMonthIso('2026-05-31'), '2026-04-30');
});

test('computeTodayVsLastMonthDisbursement computes totals, delta, percentChange, and fixed fertilizer order', () => {
  const momReports: DailyReport[] = [
    {
      id: 'rep-gov-ismailia-2026-10-21',
      governorateId: 'gov-ismailia',
      reportDate: '2026-10-21',
      status: 'approved',
      createdByUid: 'u1',
      createdByName: 'u1',
      centralSyncStatus: 'pending',
      createdAt: '2026-10-21T08:00:00Z',
      updatedAt: '2026-10-21T08:00:00Z',
    },
    {
      id: 'rep-gov-ismailia-2026-11-21',
      governorateId: 'gov-ismailia',
      reportDate: '2026-11-21',
      status: 'draft',
      createdByUid: 'u1',
      createdByName: 'u1',
      centralSyncStatus: 'pending',
      createdAt: '2026-11-21T08:00:00Z',
      updatedAt: '2026-11-21T08:00:00Z',
    },
    {
      id: 'rep-gov-suez-2026-11-20',
      governorateId: 'gov-suez',
      reportDate: '2026-11-20',
      status: 'draft',
      createdByUid: 'u1',
      createdByName: 'u1',
      centralSyncStatus: 'pending',
      createdAt: '2026-11-20T08:00:00Z',
      updatedAt: '2026-11-20T08:00:00Z',
    },
  ];

  const momRows: DailyDisbursementRow[] = [
    // Previous month same day (2026-10-21): urea 100 + nitrate 60 + sulfate 40 = 200
    {
      id: 'p1',
      reportId: 'rep-gov-ismailia-2026-10-21',
      associationId: 'a-1',
      fertilizerCode: 'urea',
      openingBalance: 200,
      closingBalance: 100,
      settlementQty: 100,
      actualDisbursed: 100,
      variance: 0,
      varianceReason: '',
      updatedAt: '2026-10-21T08:00:00Z',
    },
    {
      id: 'p2',
      reportId: 'rep-gov-ismailia-2026-10-21',
      associationId: 'a-1',
      fertilizerCode: 'nitrate',
      openingBalance: 100,
      closingBalance: 40,
      settlementQty: 60,
      actualDisbursed: 60,
      variance: 0,
      varianceReason: '',
      updatedAt: '2026-10-21T08:00:00Z',
    },
    {
      id: 'p3',
      reportId: 'rep-gov-ismailia-2026-10-21',
      associationId: 'a-1',
      fertilizerCode: 'sulfate',
      openingBalance: 80,
      closingBalance: 40,
      settlementQty: 40,
      actualDisbursed: 40,
      variance: 0,
      varianceReason: '',
      updatedAt: '2026-10-21T08:00:00Z',
    },
    // Today (2026-11-21): urea 150 + nitrate 80 + sulfate 20 = 250 (+50, +25%)
    {
      id: 't1',
      reportId: 'rep-gov-ismailia-2026-11-21',
      associationId: 'a-1',
      fertilizerCode: 'urea',
      openingBalance: 300,
      closingBalance: 150,
      settlementQty: 150,
      actualDisbursed: 150,
      variance: 0,
      varianceReason: '',
      updatedAt: '2026-11-21T08:00:00Z',
    },
    {
      id: 't2',
      reportId: 'rep-gov-ismailia-2026-11-21',
      associationId: 'a-1',
      fertilizerCode: 'nitrate',
      openingBalance: 120,
      closingBalance: 40,
      settlementQty: 80,
      actualDisbursed: 80,
      variance: 0,
      varianceReason: '',
      updatedAt: '2026-11-21T08:00:00Z',
    },
    {
      id: 't3',
      reportId: 'rep-gov-ismailia-2026-11-21',
      associationId: 'a-1',
      fertilizerCode: 'sulfate',
      openingBalance: 50,
      closingBalance: 30,
      settlementQty: 20,
      actualDisbursed: 20,
      variance: 0,
      varianceReason: '',
      updatedAt: '2026-11-21T08:00:00Z',
    },
    // Unrelated date (must be ignored)
    {
      id: 'other1',
      reportId: 'rep-gov-suez-2026-11-20',
      associationId: 'a-3',
      fertilizerCode: 'urea',
      openingBalance: 900,
      closingBalance: 100,
      settlementQty: 800,
      actualDisbursed: 800,
      variance: 0,
      varianceReason: '',
      updatedAt: '2026-11-20T08:00:00Z',
    },
  ];

  const cmp = computeTodayVsLastMonthDisbursement({
    reports: momReports,
    disbursements: momRows,
    todayDate: '2026-11-21',
  });

  assert.equal(cmp.todayDate, '2026-11-21');
  assert.equal(cmp.prevMonthDate, '2026-10-21');
  assert.equal(cmp.prevMonthTotal, 200);
  assert.equal(cmp.todayTotal, 250);
  assert.equal(cmp.deltaBags, 50);
  assert.equal(cmp.percentChange, 25);
  assert.equal(cmp.direction, 'up');
  assert.equal(cmp.hasTodayData, true);
  assert.equal(cmp.hasPrevMonthData, true);
  assert.deepEqual(
    cmp.byFertilizer.map((f) => f.code),
    ['urea', 'nitrate', 'sulfate'],
  );
  assert.equal(cmp.byFertilizer[0].delta, 50);
  assert.equal(cmp.byFertilizer[1].delta, 20);
  assert.equal(cmp.byFertilizer[2].delta, -20);
});

test('computeTodayVsLastMonthDisbursement handles zero previous month and missing data cleanly without Infinity', () => {
  const onlyTodayRows: DailyDisbursementRow[] = [
    {
      id: 't-only',
      reportId: 'rep-gov-ismailia-2026-11-21',
      associationId: 'a-1',
      fertilizerCode: 'urea',
      openingBalance: 100,
      closingBalance: 60,
      settlementQty: 40,
      actualDisbursed: 40,
      variance: 0,
      varianceReason: '',
      updatedAt: '2026-11-21T08:00:00Z',
    },
  ];

  const onlyToday = computeTodayVsLastMonthDisbursement({
    reports: [],
    disbursements: onlyTodayRows,
    todayDate: '2026-11-21',
  });
  assert.equal(onlyToday.todayTotal, 40);
  assert.equal(onlyToday.prevMonthTotal, 0);
  assert.equal(onlyToday.deltaBags, 40);
  assert.equal(onlyToday.percentChange, null);
  assert.equal(onlyToday.hasTodayData, true);
  assert.equal(onlyToday.hasPrevMonthData, false);

  const empty = computeTodayVsLastMonthDisbursement({
    reports: [],
    disbursements: [],
    todayDate: '2026-11-21',
  });
  assert.equal(empty.todayTotal, 0);
  assert.equal(empty.prevMonthTotal, 0);
  assert.equal(empty.percentChange, 0);
  assert.equal(empty.direction, 'same');
  assert.equal(empty.hasTodayData, false);
  assert.equal(empty.hasPrevMonthData, false);
});
