import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFixedServerStockAlertEmail,
  isSmtpConfigured,
  sendFixedStockAlertEmail,
} from './emailAlert.ts';

test('isSmtpConfigured returns false and sendFixedStockAlertEmail auto-disables when SMTP env vars are missing', async () => {
  const prev = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM: process.env.SMTP_FROM,
  };
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;

  try {
    assert.equal(isSmtpConfigured(), false);
    const res = await sendFixedStockAlertEmail({
      to: 'admin@example.com',
      payload: {
        organizationNameAr: 'منظومة DST',
        governorateName: 'الإسماعيلية',
        associationName: 'جمعية التل الكبير',
        fertilizerCode: 'urea',
        currentBalance: 15,
        minThreshold: 50,
        lastRecordedDate: '2026-10-10',
      },
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 'unconfigured');
  } finally {
    if (prev.SMTP_HOST !== undefined) process.env.SMTP_HOST = prev.SMTP_HOST;
    if (prev.SMTP_USER !== undefined) process.env.SMTP_USER = prev.SMTP_USER;
    if (prev.SMTP_PASS !== undefined) process.env.SMTP_PASS = prev.SMTP_PASS;
    if (prev.SMTP_FROM !== undefined) process.env.SMTP_FROM = prev.SMTP_FROM;
  }
});

test('buildFixedServerStockAlertEmail produces fixed sanitized Arabic message with no header injection', () => {
  const { subject, text } = buildFixedServerStockAlertEmail({
    organizationNameAr: 'منظومة DST\r\nBcc: evil@attacker.test',
    governorateName: 'الإسماعيلية',
    associationName: 'جمعية القنطرة شرق',
    fertilizerCode: 'nitrate',
    currentBalance: 20,
    minThreshold: 40,
    lastRecordedDate: '2026-10-12',
  });

  assert.equal(subject.includes('\r'), false);
  assert.equal(subject.includes('\n'), false);
  assert.match(subject, /النترات/);
  assert.match(subject, /جمعية القنطرة شرق/);
  assert.match(text, /الرصيد الختامي المسجل: 20 شيكارة/);
  assert.match(text, /الحد الأدنى المقرر: 40 شيكارة/);
});
