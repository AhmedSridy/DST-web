import assert from 'node:assert/strict';
import test from 'node:test';
import { OcrExtractionError, validateOcrImageInput } from './geminiOcr.ts';

test('validateOcrImageInput accepts valid jpeg/png/webp under 5MB', () => {
  const sampleBase64 = Buffer.from('fake-jpeg-bytes-for-unit-test-1234567890').toString('base64');
  const res = validateOcrImageInput(sampleBase64, 'image/jpeg');
  assert.equal(res.effectiveMime, 'image/jpeg');
  assert.ok(res.decodedBytes > 0);
});

test('validateOcrImageInput rejects unsupported MIME types', () => {
  const sampleBase64 = Buffer.from('fake-svg-bytes-for-unit-test-1234567890').toString('base64');
  assert.throws(
    () => validateOcrImageInput(sampleBase64, 'image/svg+xml'),
    (err: unknown) => err instanceof OcrExtractionError && err.code === 'UNSUPPORTED_IMAGE',
  );
  assert.throws(
    () => validateOcrImageInput(`data:application/pdf;base64,${sampleBase64}`, 'image/jpeg'),
    (err: unknown) => err instanceof OcrExtractionError && err.code === 'UNSUPPORTED_IMAGE',
  );
});

test('validateOcrImageInput rejects decoded images exceeding 5MB', () => {
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 128, 1).toString('base64');
  assert.throws(
    () => validateOcrImageInput(oversized, 'image/png'),
    (err: unknown) => err instanceof OcrExtractionError && err.code === 'IMAGE_TOO_LARGE',
  );
});
