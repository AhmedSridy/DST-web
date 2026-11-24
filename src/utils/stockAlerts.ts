import type {
  AgriculturalAssociation,
  DailyDisbursementRow,
  DailyReport,
  Governorate,
  StockAlertRule,
} from '../types/domain.ts';

export type SupportedFertilizerCode = 'urea' | 'nitrate' | 'sulfate';

export type StockAlertRuntimeState =
  | 'triggered'
  | 'dismissed'
  | 'ok'
  | 'unrecorded'
  | 'disabled';

export interface EvaluatedStockAlert {
  rule: StockAlertRule;
  associationName: string;
  associationActive: boolean;
  governorateName: string;
  fertilizerNameAr: string;
  currentBalance: number | null;
  lastRecordedDate: string | null;
  deficit: number;
  runtimeState: StockAlertRuntimeState;
}

export interface EvaluateStockAlertsResult {
  evaluated: EvaluatedStockAlert[];
  triggeredInApp: EvaluatedStockAlert[];
  triggeredAll: EvaluatedStockAlert[];
  dismissed: EvaluatedStockAlert[];
  ok: EvaluatedStockAlert[];
  unrecorded: EvaluatedStockAlert[];
  disabled: EvaluatedStockAlert[];
}

export interface StockAlertRuleValidationInput {
  governorateId: string;
  associationId: string;
  fertilizerCode: string;
  minThreshold: number;
  notifyInApp: boolean;
  notifyEmail: boolean;
  recipientEmail: string;
}

export const FERTILIZER_LABELS_AR: Record<SupportedFertilizerCode, string> = {
  urea: 'يوريا',
  nitrate: 'نترات',
  sulfate: 'سلفات',
};

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isSupportedFertilizerCode(code: string): code is SupportedFertilizerCode {
  return code === 'urea' || code === 'nitrate' || code === 'sulfate';
}

export function isValidAlertEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length >= 5 && trimmed.length <= 160 && SIMPLE_EMAIL_RE.test(trimmed);
}

export function validateStockAlertRuleInput(
  input: StockAlertRuleValidationInput,
): { ok: true } | { ok: false; error: string } {
  if (!input.governorateId || !input.governorateId.trim()) {
    return { ok: false, error: 'يُرجى اختيار المحافظة أولًا.' };
  }
  if (!input.associationId || !input.associationId.trim()) {
    return { ok: false, error: 'يُرجى اختيار مستودع الجمعية الزراعية.' };
  }
  if (!isSupportedFertilizerCode(input.fertilizerCode)) {
    return { ok: false, error: 'نوع السماد المختار غير مدعوم.' };
  }
  if (
    typeof input.minThreshold !== 'number' ||
    !Number.isFinite(input.minThreshold) ||
    input.minThreshold < 0
  ) {
    return { ok: false, error: 'الحد الأدنى للمخزون يجب أن يكون رقمًا يساوي صفرًا أو أكبر.' };
  }
  if (!input.notifyInApp && !input.notifyEmail) {
    return {
      ok: false,
      error: 'يجب تفعيل قناة تنبيه واحدة على الأقل (تنبيه داخل النظام أو عبر البريد الإلكتروني).',
    };
  }
  if (input.notifyEmail && !isValidAlertEmail(input.recipientEmail || '')) {
    return {
      ok: false,
      error: 'يُرجى إدخال عنوان بريد إلكتروني صحيح لاستلام تنبيهات البريد.',
    };
  }
  return { ok: true };
}

function subtractDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Evaluates all user-configured stock alert rules against the latest recorded
 * closingBalance (within a 60-day window up to upToDate).
 *
 * Null-vs-zero invariant:
 * - Unrecorded (null) closing balances NEVER trigger an alert ('unrecorded').
 * - Recorded closingBalance === 0 with minThreshold >= 0 MUST trigger (0 <= minThreshold).
 */
export function evaluateStockAlertRules(params: {
  rules: StockAlertRule[];
  governorates: Governorate[];
  associations: AgriculturalAssociation[];
  reports: DailyReport[];
  disbursements: DailyDisbursementRow[];
  upToDate: string;
}): EvaluateStockAlertsResult {
  const { rules, governorates, associations, reports, disbursements, upToDate } = params;

  const govMap = new Map(governorates.map((g) => [g.id, g]));
  const assocMap = new Map(associations.map((a) => [a.id, a]));
  const reportDateById = new Map<string, string>();
  const cutoffDate = subtractDaysIso(upToDate, 60);

  for (const r of reports) {
    if (r.reportDate <= upToDate && r.reportDate >= cutoffDate) {
      reportDateById.set(r.id, r.reportDate);
    }
  }

  // Latest recorded closingBalance per associationId::fertilizerCode
  const latestMap = new Map<string, { balance: number; date: string; updatedAt: string }>();
  for (const row of disbursements) {
    if (row.closingBalance === null || row.closingBalance === undefined) continue;
    if (!Number.isFinite(row.closingBalance)) continue;
    const reportDate = reportDateById.get(row.reportId);
    if (!reportDate) continue;

    const key = `${row.associationId}::${row.fertilizerCode}`;
    const prev = latestMap.get(key);
    const rowUpdatedAt = row.updatedAt || '';
    if (
      !prev ||
      reportDate > prev.date ||
      (reportDate === prev.date && rowUpdatedAt >= prev.updatedAt)
    ) {
      latestMap.set(key, {
        balance: row.closingBalance,
        date: reportDate,
        updatedAt: rowUpdatedAt,
      });
    }
  }

  const stateRank: Record<StockAlertRuntimeState, number> = {
    triggered: 0,
    dismissed: 1,
    ok: 2,
    unrecorded: 3,
    disabled: 4,
  };

  const evaluated: EvaluatedStockAlert[] = rules.map((rule) => {
    const assoc = assocMap.get(rule.associationId);
    const gov = govMap.get(rule.governorateId);
    const latest = latestMap.get(`${rule.associationId}::${rule.fertilizerCode}`) || null;
    const currentBalance = latest ? latest.balance : null;
    const lastRecordedDate = latest ? latest.date : null;
    const deficit =
      currentBalance !== null ? Math.max(0, rule.minThreshold - currentBalance) : 0;

    let runtimeState: StockAlertRuntimeState;
    if (!rule.isEnabled) {
      runtimeState = 'disabled';
    } else if (currentBalance === null) {
      runtimeState = 'unrecorded';
    } else if (currentBalance <= rule.minThreshold) {
      runtimeState = rule.status === 'dismissed' ? 'dismissed' : 'triggered';
    } else {
      runtimeState = 'ok';
    }

    return {
      rule,
      associationName: assoc?.nameAr || rule.associationId,
      associationActive: assoc ? assoc.isActive !== false && assoc.active !== false : true,
      governorateName: gov?.nameAr || rule.governorateId,
      fertilizerNameAr: FERTILIZER_LABELS_AR[rule.fertilizerCode] || rule.fertilizerCode,
      currentBalance,
      lastRecordedDate,
      deficit,
      runtimeState,
    };
  });

  evaluated.sort((a, b) => {
    const rankDiff = stateRank[a.runtimeState] - stateRank[b.runtimeState];
    if (rankDiff !== 0) return rankDiff;
    if (a.runtimeState === 'triggered' || a.runtimeState === 'dismissed') {
      if (b.deficit !== a.deficit) return b.deficit - a.deficit;
    }
    return a.associationName.localeCompare(b.associationName, 'ar');
  });

  const triggeredAll = evaluated.filter((item) => item.runtimeState === 'triggered');
  const triggeredInApp = triggeredAll.filter((item) => item.rule.notifyInApp);
  const dismissed = evaluated.filter((item) => item.runtimeState === 'dismissed');
  const ok = evaluated.filter((item) => item.runtimeState === 'ok');
  const unrecorded = evaluated.filter((item) => item.runtimeState === 'unrecorded');
  const disabled = evaluated.filter((item) => item.runtimeState === 'disabled');

  return {
    evaluated,
    triggeredInApp,
    triggeredAll,
    dismissed,
    ok,
    unrecorded,
    disabled,
  };
}

export function buildAlertEmailContent(
  item: EvaluatedStockAlert,
  organizationNameAr = 'منظومة DST لإدارة ومراقبة صرف الأسمدة الزراعية',
): { subject: string; text: string; mailtoUrl: string } {
  const balanceText =
    item.currentBalance !== null
      ? `${item.currentBalance.toLocaleString('en-US')} شيكارة`
      : 'غير مسجل';
  const thresholdText = `${item.rule.minThreshold.toLocaleString('en-US')} شيكارة`;
  const subject = `تنبيه مخزون منخفض: ${item.fertilizerNameAr} — جمعية ${item.associationName}`;
  const lines = [
    organizationNameAr,
    '',
    'تنبيه وصول مخزون السماد إلى الحد الأدنى المحدد:',
    `- المحافظة: ${item.governorateName}`,
    `- مستودع الجمعية: ${item.associationName}`,
    `- نوع السماد: ${item.fertilizerNameAr}`,
    `- الرصيد الحالي المسجل: ${balanceText}`,
    `- الحد الأدنى المضبوط: ${thresholdText}`,
    `- العجز عن الحد الأدنى: ${item.deficit.toLocaleString('en-US')} شيكارة`,
    `- تاريخ آخر رصد: ${item.lastRecordedDate || 'غير متاح'}`,
    '',
    'يُرجى مراجعة المستودع واتخاذ إجراءات الإمداد اللازمة، أو تجاهل/إعادة ضبط التنبيه من داخل المنظومة.',
  ];
  const text = lines.join('\n');
  const recipient = (item.rule.recipientEmail || '').trim();
  const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  return { subject, text, mailtoUrl };
}
