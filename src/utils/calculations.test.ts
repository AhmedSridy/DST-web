import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDisbursementRow,
  computeTractorMetrics,
  tonsToBags,
  bagsToTons,
} from './calculations.ts';

test('computeDisbursementRow calculates actualDisbursed = opening - closing and variance accurately', () => {
  // actualDisbursed = opening - closing = 120 - 50 = 70
  // variance = actualDisbursed - settlement = 70 - 70 = 0
  const matched = computeDisbursementRow({
    openingBalance: 120,
    closingBalance: 50,
    settlementQty: 70,
  });
  assert.equal(matched.actualDisbursed, 70);
  assert.equal(matched.variance, 0);
  assert.equal(matched.hasVariance, false);
  assert.equal(matched.hasNegativeInput, false);
  assert.equal(matched.isRecorded, true);

  // variance != 0
  const mismatched = computeDisbursementRow({
    openingBalance: 100,
    closingBalance: 30,
    settlementQty: 65,
  });
  assert.equal(mismatched.actualDisbursed, 70);
  assert.equal(mismatched.variance, 5);
  assert.equal(mismatched.hasVariance, true);
});

test('computeDisbursementRow preserves null unrecorded cells unless treatEmptyAsZero is true', () => {
  const unrecorded = computeDisbursementRow({
    openingBalance: null,
    closingBalance: null,
    settlementQty: null,
  });
  assert.equal(unrecorded.isRecorded, false);
  assert.equal(unrecorded.actualDisbursed, null);
  assert.equal(unrecorded.variance, null);

  // Manually entered zero counts as recorded
  const manualZero = computeDisbursementRow({
    openingBalance: 0,
    closingBalance: 0,
    settlementQty: 0,
  });
  assert.equal(manualZero.isRecorded, true);
  assert.equal(manualZero.actualDisbursed, 0);
  assert.equal(manualZero.variance, 0);

  // treatEmptyAsZero fallback
  const withSetting = computeDisbursementRow(
    {
      openingBalance: 50,
      closingBalance: null,
      settlementQty: null,
    },
    true,
  );
  assert.equal(withSetting.actualDisbursed, 50);
  assert.equal(withSetting.variance, 50);
});

test('computeDisbursementRow detects negative inputs and negative disbursed', () => {
  const invalid = computeDisbursementRow({
    openingBalance: -10,
    closingBalance: 5,
    settlementQty: 5,
  });
  assert.equal(invalid.hasNegativeInput, true);

  const negativeDisbursed = computeDisbursementRow({
    openingBalance: 20,
    closingBalance: 35,
    settlementQty: 0,
  });
  assert.equal(negativeDisbursed.actualDisbursed, -15);
  assert.equal(negativeDisbursed.hasNegativeDisbursed, true);
});

test('computeTractorMetrics classifies matched, shortage, surplus, damaged (actual - manifest)', () => {
  assert.deepEqual(computeTractorMetrics(400, 400), {
    bagVariance: 0,
    inspectionStatus: 'matched',
  });
  assert.deepEqual(computeTractorMetrics(400, 392), {
    bagVariance: -8,
    inspectionStatus: 'shortage',
  });
  assert.deepEqual(computeTractorMetrics(400, 405), {
    bagVariance: 5,
    inspectionStatus: 'surplus',
  });
  assert.deepEqual(computeTractorMetrics(400, 395, true), {
    bagVariance: -5,
    inspectionStatus: 'damaged',
  });
});

test('tonsToBags and bagsToTons convert dynamically via 1000 / bagWeightKg and reject missing weight', () => {
  assert.equal(tonsToBags(25, 50), 500);
  assert.equal(tonsToBags(12.5, 50), 250);
  assert.equal(tonsToBags(10, 25), 400);
  assert.equal(bagsToTons(500, 50), 25);
  assert.equal(bagsToTons(400, 25), 10);

  assert.equal(tonsToBags(15, undefined), null);
  assert.equal(tonsToBags(15, null), null);
  assert.equal(tonsToBags(15, 0), null);
  assert.equal(tonsToBags(15, -50), null);
  assert.equal(bagsToTons(300, undefined), null);
});

test('computeDisbursementRow flags variance cleanly even when varianceReason is omitted or empty', () => {
  const withEmptyReason = computeDisbursementRow({
    openingBalance: 250,
    closingBalance: 100,
    settlementQty: 140,
  });
  assert.equal(withEmptyReason.actualDisbursed, 150);
  assert.equal(withEmptyReason.variance, 10);
  assert.equal(withEmptyReason.hasVariance, true);
  assert.equal(withEmptyReason.hasNegativeInput, false);
});

