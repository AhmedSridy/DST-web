import assert from 'node:assert/strict';
import test from 'node:test';
import { ThinkingLevel } from '@google/genai';
import {
  buildOcrThinkingConfig,
  collectGeminiApiKeys,
  DEFAULT_OCR_MODEL,
  GeminiKeyFailoverManager,
  OcrExtractionError,
  resolveOcrModel,
  validateOcrImageInput,
} from './geminiOcr.ts';

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

test('resolveOcrModel defaults to gemini-4-hydrogen and falls back from unavailable legacy models', () => {
  assert.equal(DEFAULT_OCR_MODEL, 'gemini-4-hydrogen');
  assert.equal(resolveOcrModel(undefined), 'gemini-4-hydrogen');
  assert.equal(resolveOcrModel('  '), 'gemini-4-hydrogen');
  assert.equal(resolveOcrModel('gemini-2.5-flash'), 'gemini-4-hydrogen');
  assert.equal(resolveOcrModel('gemini-2.0-flash'), 'gemini-4-hydrogen');
  assert.equal(resolveOcrModel('gemini-4-neon'), 'gemini-4-neon');
});

test('buildOcrThinkingConfig enables ThinkingLevel.MEDIUM for Gemini 3/4 models', () => {
  assert.deepEqual(buildOcrThinkingConfig('gemini-4-hydrogen'), {
    thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
  });
  assert.deepEqual(buildOcrThinkingConfig('gemini-4-neon'), {
    thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
  });
  assert.deepEqual(buildOcrThinkingConfig('custom-other-model'), {});
});

test('collectGeminiApiKeys gathers primary, comma/newline list, and numbered fallback keys in order without duplicates', () => {
  const keys = collectGeminiApiKeys({
    GEMINI_API_KEY: ' key-1 ',
    GEMINI_API_KEYS: 'key-2, key-1\nkey-3;  ',
    GEMINI_API_KEY_2: 'key-4',
    GEMINI_API_KEY_3: 'MY_GEMINI_API_KEY',
    GEMINI_API_KEY_4: 'key-2',
    GEMINI_API_KEY_5: 'key-5',
  });
  assert.deepEqual(keys, ['key-1', 'key-2', 'key-3', 'key-4', 'key-5']);
});

test('GeminiKeyFailoverManager transparently switches to backup key on 429 and remembers healthy key during cooldown', async () => {
  let fakeNow = 1_000_000;
  const manager = new GeminiKeyFailoverManager(
    () => ['key-A', 'key-B', 'key-C'],
    () => fakeNow,
    async () => undefined,
    60_000,
  );

  const triedCall1: string[] = [];
  const res1 = await manager.execute(async (apiKey) => {
    triedCall1.push(apiKey);
    if (apiKey === 'key-A') {
      throw new Error('429 RESOURCE_EXHAUSTED: quota exceeded');
    }
    return `ok:${apiKey}`;
  });
  assert.equal(res1, 'ok:key-B');
  assert.deepEqual(triedCall1, ['key-A', 'key-B']);

  // Second call within cooldown starts directly on healthy key-B without retrying key-A
  const triedCall2: string[] = [];
  const res2 = await manager.execute(async (apiKey) => {
    triedCall2.push(apiKey);
    return `ok:${apiKey}`;
  });
  assert.equal(res2, 'ok:key-B');
  assert.deepEqual(triedCall2, ['key-B']);

  // If key-B hits quota too, switches seamlessly to key-C
  const triedCall3: string[] = [];
  const res3 = await manager.execute(async (apiKey) => {
    triedCall3.push(apiKey);
    if (apiKey === 'key-B') {
      throw new Error('429 RESOURCE_EXHAUSTED');
    }
    return `ok:${apiKey}`;
  });
  assert.equal(res3, 'ok:key-C');
  assert.deepEqual(triedCall3, ['key-B', 'key-C']);

  // After cooldown passes, key-A is eligible again when key-C hits 429
  fakeNow += 65_000;
  const triedCall4: string[] = [];
  const res4 = await manager.execute(async (apiKey) => {
    triedCall4.push(apiKey);
    if (apiKey === 'key-C') {
      throw new Error('429 RESOURCE_EXHAUSTED');
    }
    return `ok:${apiKey}`;
  });
  assert.equal(res4, 'ok:key-A');
  assert.deepEqual(triedCall4, ['key-C', 'key-A']);
});

test('GeminiKeyFailoverManager fails over on invalid key, stops immediately on 404, and throws QUOTA_EXCEEDED if all keys are exhausted', async () => {
  const manager = new GeminiKeyFailoverManager(
    () => ['bad-key', 'good-key'],
    () => 10_000,
    async () => undefined,
  );

  // Invalid first key -> transparently fails over to good-key
  const okRes = await manager.execute(async (apiKey) => {
    if (apiKey === 'bad-key') throw new Error('API_KEY_INVALID');
    return `used:${apiKey}`;
  });
  assert.equal(okRes, 'used:good-key');

  // Non-key 404 model error -> throws immediately without trying other keys
  const freshManager = new GeminiKeyFailoverManager(
    () => ['k1', 'k2'],
    () => 10_000,
    async () => undefined,
  );
  const attempts404: string[] = [];
  await assert.rejects(
    () =>
      freshManager.execute(async (apiKey) => {
        attempts404.push(apiKey);
        throw new Error('404 NOT_FOUND: model not found');
      }),
    /404 NOT_FOUND/,
  );
  assert.deepEqual(attempts404, ['k1']);

  // All keys exhausted -> throws OcrExtractionError with QUOTA_EXCEEDED
  await assert.rejects(
    () =>
      freshManager.execute(async () => {
        throw new Error('429 RESOURCE_EXHAUSTED');
      }),
    (err: unknown) => err instanceof OcrExtractionError && err.code === 'QUOTA_EXCEEDED',
  );
});
