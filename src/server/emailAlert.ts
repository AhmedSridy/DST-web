import nodemailer from 'nodemailer';

export interface FixedStockAlertEmailPayload {
  organizationNameAr: string;
  governorateName: string;
  associationName: string;
  fertilizerCode: 'urea' | 'nitrate' | 'sulfate';
  currentBalance: number | null;
  minThreshold: number;
  lastRecordedDate: string | null;
}

export interface SendStockAlertEmailResult {
  ok: boolean;
  status: 'sent' | 'failed' | 'unconfigured';
  message: string;
  messageId?: string;
}

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FERTILIZER_NAMES_AR: Record<'urea' | 'nitrate' | 'sulfate', string> = {
  urea: 'اليوريا',
  nitrate: 'النترات',
  sulfate: 'السلفات',
};

function sanitizeSingleLine(val: string, maxLen: number): string {
  return String(val || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const from = (process.env.SMTP_FROM || user || '').trim();
  return { host, port: Number.isFinite(port) && port > 0 ? port : 587, secure, user, pass, from };
}

export function isSmtpConfigured(): boolean {
  const cfg = getSmtpConfig();
  return Boolean(cfg.host && cfg.user && cfg.pass && cfg.from);
}

/**
 * Generates strictly fixed, server-controlled subject and plain-text body
 * from verified Firestore records. No free-form user input is accepted.
 */
export function buildFixedServerStockAlertEmail(payload: FixedStockAlertEmailPayload): {
  subject: string;
  text: string;
} {
  const org = sanitizeSingleLine(
    payload.organizationNameAr || 'منظومة DST لإدارة ومراقبة صرف الأسمدة الزراعية',
    120,
  );
  const gov = sanitizeSingleLine(payload.governorateName || 'غير محددة', 80);
  const assoc = sanitizeSingleLine(payload.associationName || 'غير محددة', 120);
  const fertName = FERTILIZER_NAMES_AR[payload.fertilizerCode] || 'اليوريا';
  const minThreshold = Number.isFinite(payload.minThreshold) ? payload.minThreshold : 0;
  const balanceText =
    payload.currentBalance !== null && Number.isFinite(payload.currentBalance)
      ? `${payload.currentBalance} شيكارة`
      : 'غير مسجل';
  const dateText = payload.lastRecordedDate
    ? sanitizeSingleLine(payload.lastRecordedDate, 20)
    : 'غير متاح';

  const subject = `[منظومة DST] تنبيه انخفاض مخزون ${fertName} — ${assoc}`.slice(0, 200);
  const text = [
    org,
    'تنبيه رسمي بانخفاض مخزون الأسمدة عن الحد الأدنى المقرر:',
    `المحافظة: ${gov}`,
    `مستودع الجمعية: ${assoc}`,
    `نوع السماد: ${fertName}`,
    `الرصيد الختامي المسجل: ${balanceText}`,
    `الحد الأدنى المقرر: ${minThreshold} شيكارة`,
    `تاريخ آخر رصد: ${dateText}`,
    'يرجى مراجعة رصيد المستودع في منظومة DST.',
  ].join('\n');

  return { subject, text };
}

export async function sendFixedStockAlertEmail(input: {
  to: string;
  payload: FixedStockAlertEmailPayload;
}): Promise<SendStockAlertEmailResult> {
  if (!isSmtpConfigured()) {
    return {
      ok: false,
      status: 'unconfigured',
      message: 'ميزة إرسال البريد عبر SMTP معطّلة تلقائيًا لعدم ضبط إعدادات SMTP على الخادم.',
    };
  }

  const to = String(input.to || '').trim();
  if (!to || to.length > 160 || !SIMPLE_EMAIL_RE.test(to)) {
    return {
      ok: false,
      status: 'failed',
      message: 'عنوان البريد الإلكتروني المسجل في قاعدة البيانات لهذه القاعدة غير صالح.',
    };
  }

  const { subject, text } = buildFixedServerStockAlertEmail(input.payload);
  const cfg = getSmtpConfig();

  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: {
        user: cfg.user,
        pass: cfg.pass,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });

    const info = await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      text,
    });

    return {
      ok: true,
      status: 'sent',
      message: `تم إرسال تنبيه المخزون الرسمي عبر SMTP إلى ${to}.`,
      messageId: info.messageId,
    };
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'تعذر الاتصال بخادم SMTP.';
    return {
      ok: false,
      status: 'failed',
      message: `تعذر إرسال البريد الإلكتروني عبر SMTP: ${detail}`.slice(0, 380),
    };
  }
}
