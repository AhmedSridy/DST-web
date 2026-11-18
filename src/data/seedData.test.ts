import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSeedReportsAndDisbursements,
  createSeedTractors,
  SEED_ASSOCIATIONS,
  SEED_CENTERS,
  SEED_GOVERNORATES,
} from './seedData.ts';

test('seedData includes all 27 Egyptian governorates and official associations for Ismailia, Suez, and Port Said', () => {
  assert.equal(SEED_GOVERNORATES.length, 27);

  const govIds = new Set(SEED_GOVERNORATES.map((g) => g.id));
  const centerIds = new Set(SEED_CENTERS.map((c) => c.id));

  // Every governorate must have at least 1 center so associations can be added
  for (const gov of SEED_GOVERNORATES) {
    assert.ok(
      SEED_CENTERS.some((c) => c.governorateId === gov.id),
      `Governorate ${gov.nameAr} is missing a center`,
    );
  }

  const seenCodes = new Set<string>();
  const seenIds = new Set<string>();

  for (const assoc of SEED_ASSOCIATIONS) {
    assert.ok(govIds.has(assoc.governorateId), `Invalid governorateId for ${assoc.nameAr}`);
    assert.ok(centerIds.has(assoc.centerId), `Invalid centerId for ${assoc.nameAr}`);
    assert.ok(!seenCodes.has(assoc.code), `Duplicate association code: ${assoc.code}`);
    assert.ok(!seenIds.has(assoc.id), `Duplicate association id: ${assoc.id}`);
    seenCodes.add(assoc.code);
    seenIds.add(assoc.id);
  }

  const ismailiaCount = SEED_ASSOCIATIONS.filter((a) => a.governorateId === 'gov-ismailia').length;
  const suezCount = SEED_ASSOCIATIONS.filter((a) => a.governorateId === 'gov-suez').length;
  const portSaidCount = SEED_ASSOCIATIONS.filter((a) => a.governorateId === 'gov-portsaid').length;

  assert.equal(ismailiaCount, 80);
  assert.equal(suezCount, 14);
  assert.equal(portSaidCount, 51);
});

test('all seeded reports/disbursements start unrecorded with zero fabricated data', () => {
  const { reports, disbursements } = createSeedReportsAndDisbursements('2026-11-17');
  assert.equal(reports.length, 0);
  assert.equal(disbursements.length, 0);
  assert.equal(createSeedTractors('2026-11-17').length, 0);
});
