import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAlertEmailContent,
  evaluateStockAlertRules,
  validateStockAlertRuleInput,
} from './stockAlerts.ts';
import type {
  AgriculturalAssociation,
  DailyDisbursementRow,
  DailyReport,
  Governorate,
  StockAlertRule,
} from '../types/domain.ts';

const GOVS: Governorate[] = [
  { id: 'gov-port-said', code: 'PTS', nameAr: 'بورسعيد', region: 'القناة', isActive: true },
];

const ASSOCS: AgriculturalAssociation[] = [
  {
    id: 'assoc-1',
    code: 'A1',
    nameAr: 'أرض الفيروز',
    normalizedName: 'ارض الفيروز',
    governorateId: 'gov-port-said',
    centerId: 'c1',
    managerName: '',
    managerPhone: '',
    isActive: true,
    active: true,
  },
  {
    id: 'assoc-2',
    code: 'A2',
    nameAr: 'جنوب بورسعيد',
    normalizedName: 'جنوب بورسعيد',
    governorateId: 'gov-port-said',
    centerId: 'c1',
    managerName: '',
    managerPhone: '',
    isActive: true,
    active: true,
  },
];

const REPORTS: DailyReport[] = [
  {
    id: 'rep-2026-05-01',
    governorateId: 'gov-port-said',
    reportDate: '2026-05-01',
    status: 'draft',
    createdByUid: 'u1',
    createdByName: 'Admin',
    centralSyncStatus: 'pending',
    createdAt: '2026-05-01T08:00:00Z',
    updatedAt: '2026-05-01T08:00:00Z',
  },
  {
    id: 'rep-2026-05-03',
    governorateId: 'gov-port-said',
    reportDate: '2026-05-03',
    status: 'draft',
    createdByUid: 'u1',
    createdByName: 'Admin',
    centralSyncStatus: 'pending',
    createdAt: '2026-05-03T08:00:00Z',
    updatedAt: '2026-05-03T08:00:00Z',
  },
];

function makeRule(overrides: Partial<StockAlertRule> = {}): StockAlertRule {
  return {
    id: 'rule-1',
    governorateId: 'gov-port-said',
    associationId: 'assoc-1',
    fertilizerCode: 'urea',
    minThreshold: 50,
    notifyInApp: true,
    notifyEmail: true,
    recipientEmail: 'ops@example.com',
    isEnabled: true,
    status: 'active',
    dismissedAt: null,
    dismissedBalance: null,
    dismissedDate: null,
    lastEmailSentAt: null,
    lastEmailStatus: null,
    lastEmailMessage: '',
    createdByUid: 'u1',
    createdByName: 'Admin',
    createdAt: '2026-05-01T08:00:00Z',
    updatedAt: '2026-05-01T08:00:00Z',
    ...overrides,
  };
}

function makeRow(overrides: Partial<DailyDisbursementRow>): DailyDisbursementRow {
  return {
    id: 'row-1',
    reportId: 'rep-2026-05-03',
    governorateId: 'gov-port-said',
    associationId: 'assoc-1',
    fertilizerCode: 'urea',
    openingBalance: 100,
    closingBalance: 40,
    settlementQty: 60,
    actualDisbursed: 60,
    variance: 0,
    varianceReason: '',
    updatedAt: '2026-05-03T09:00:00Z',
    ...overrides,
  };
}

test('validateStockAlertRuleInput validates threshold, channels, and email', () => {
  assert.equal(
    validateStockAlertRuleInput({
      governorateId: 'gov-port-said',
      associationId: 'assoc-1',
      fertilizerCode: 'urea',
      minThreshold: 0,
      notifyInApp: true,
      notifyEmail: false,
      recipientEmail: '',
    }).ok,
    true,
  );

  assert.equal(
    validateStockAlertRuleInput({
      governorateId: 'gov-port-said',
      associationId: 'assoc-1',
      fertilizerCode: 'urea',
      minThreshold: -5,
      notifyInApp: true,
      notifyEmail: false,
      recipientEmail: '',
    }).ok,
    false,
  );

  assert.equal(
    validateStockAlertRuleInput({
      governorateId: 'gov-port-said',
      associationId: 'assoc-1',
      fertilizerCode: 'urea',
      minThreshold: 50,
      notifyInApp: false,
      notifyEmail: false,
      recipientEmail: '',
    }).ok,
    false,
  );

  assert.equal(
    validateStockAlertRuleInput({
      governorateId: 'gov-port-said',
      associationId: 'assoc-1',
      fertilizerCode: 'urea',
      minThreshold: 50,
      notifyInApp: false,
      notifyEmail: true,
      recipientEmail: 'invalid-email',
    }).ok,
    false,
  );

  assert.equal(
    validateStockAlertRuleInput({
      governorateId: 'gov-port-said',
      associationId: 'assoc-1',
      fertilizerCode: 'nitrate',
      minThreshold: 25,
      notifyInApp: false,
      notifyEmail: true,
      recipientEmail: 'manager@agri.gov.eg',
    }).ok,
    true,
  );
});

test('evaluateStockAlertRules triggers on closingBalance <= minThreshold and ignores null', () => {
  const rules: StockAlertRule[] = [
    makeRule({ id: 'r-equal', associationId: 'assoc-1', fertilizerCode: 'urea', minThreshold: 50 }),
    makeRule({ id: 'r-zero', associationId: 'assoc-1', fertilizerCode: 'nitrate', minThreshold: 0 }),
    makeRule({ id: 'r-ok', associationId: 'assoc-1', fertilizerCode: 'sulfate', minThreshold: 20 }),
    makeRule({ id: 'r-null', associationId: 'assoc-2', fertilizerCode: 'urea', minThreshold: 100 }),
  ];

  const disbursements: DailyDisbursementRow[] = [
    makeRow({ id: 'd1', associationId: 'assoc-1', fertilizerCode: 'urea', closingBalance: 50 }),
    makeRow({ id: 'd2', associationId: 'assoc-1', fertilizerCode: 'nitrate', closingBalance: 0 }),
    makeRow({ id: 'd3', associationId: 'assoc-1', fertilizerCode: 'sulfate', closingBalance: 25 }),
    makeRow({ id: 'd4', associationId: 'assoc-2', fertilizerCode: 'urea', closingBalance: null }),
  ];

  const res = evaluateStockAlertRules({
    rules,
    governorates: GOVS,
    associations: ASSOCS,
    reports: REPORTS,
    disbursements,
    upToDate: '2026-05-03',
  });

  const byId = new Map(res.evaluated.map((e) => [e.rule.id, e]));
  assert.equal(byId.get('r-equal')?.runtimeState, 'triggered');
  assert.equal(byId.get('r-zero')?.runtimeState, 'triggered');
  assert.equal(byId.get('r-ok')?.runtimeState, 'ok');
  assert.equal(byId.get('r-null')?.runtimeState, 'unrecorded');
  assert.equal(res.triggeredInApp.length, 2);
});

test('dismissing an alert hides it from triggeredInApp and resetting re-triggers it', () => {
  const disbursements: DailyDisbursementRow[] = [
    makeRow({ id: 'd1', associationId: 'assoc-1', fertilizerCode: 'urea', closingBalance: 35 }),
  ];

  const dismissedRule = makeRule({
    status: 'dismissed',
    dismissedAt: '2026-05-03T10:00:00Z',
    dismissedBalance: 35,
    dismissedDate: '2026-05-03',
  });

  const dismissedRes = evaluateStockAlertRules({
    rules: [dismissedRule],
    governorates: GOVS,
    associations: ASSOCS,
    reports: REPORTS,
    disbursements,
    upToDate: '2026-05-03',
  });

  assert.equal(dismissedRes.triggeredAll.length, 0);
  assert.equal(dismissedRes.triggeredInApp.length, 0);
  assert.equal(dismissedRes.dismissed.length, 1);

  const resetRule: StockAlertRule = {
    ...dismissedRule,
    status: 'active',
    dismissedAt: null,
    dismissedBalance: null,
    dismissedDate: null,
  };

  const resetRes = evaluateStockAlertRules({
    rules: [resetRule],
    governorates: GOVS,
    associations: ASSOCS,
    reports: REPORTS,
    disbursements,
    upToDate: '2026-05-03',
  });

  assert.equal(resetRes.triggeredAll.length, 1);
  assert.equal(resetRes.triggeredInApp.length, 1);
  assert.equal(resetRes.dismissed.length, 0);
  assert.equal(resetRes.triggeredAll[0].deficit, 15);
});

test('disabled rules do not trigger and email-only rules stay out of triggeredInApp', () => {
  const disbursements: DailyDisbursementRow[] = [
    makeRow({ id: 'd1', associationId: 'assoc-1', fertilizerCode: 'urea', closingBalance: 10 }),
    makeRow({ id: 'd2', associationId: 'assoc-1', fertilizerCode: 'nitrate', closingBalance: 5 }),
  ];

  const rules: StockAlertRule[] = [
    makeRule({ id: 'r-disabled', fertilizerCode: 'urea', isEnabled: false }),
    makeRule({
      id: 'r-email-only',
      fertilizerCode: 'nitrate',
      notifyInApp: false,
      notifyEmail: true,
    }),
  ];

  const res = evaluateStockAlertRules({
    rules,
    governorates: GOVS,
    associations: ASSOCS,
    reports: REPORTS,
    disbursements,
    upToDate: '2026-05-03',
  });

  assert.equal(res.disabled.length, 1);
  assert.equal(res.triggeredAll.length, 1);
  assert.equal(res.triggeredInApp.length, 0);
});

test('buildAlertEmailContent generates Arabic subject, body, and valid mailto URL', () => {
  const res = evaluateStockAlertRules({
    rules: [makeRule({ minThreshold: 60, recipientEmail: 'alert@example.com' })],
    governorates: GOVS,
    associations: ASSOCS,
    reports: REPORTS,
    disbursements: [makeRow({ closingBalance: 25 })],
    upToDate: '2026-05-03',
  });

  const email = buildAlertEmailContent(res.triggeredAll[0], 'منظومة DST');
  assert.match(email.subject, /يوريا/);
  assert.match(email.subject, /أرض الفيروز/);
  assert.match(email.text, /25 شيكارة/);
  assert.match(email.text, /60 شيكارة/);
  assert.ok(email.mailtoUrl.startsWith('mailto:alert%40example.com?subject='));
});
