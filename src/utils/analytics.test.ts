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
  computeLowBalanceAlerts,
  computeMultiDaySeries,
  computeOverdueReport,
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

