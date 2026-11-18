import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAssociationLockId,
  computeInviteId,
  escapeHtml,
  isAssociationVisibleOnDate,
  MAX_ASSOCIATION_NAME_LENGTH,
  normalizeArabicName,
  matchAssociationName,
  parseArabicDigits,
  parseOcrNumber,
  previewBulkAssociationLines,
  sanitizeExtractedText,
  sortAssociationsByOrder,
} from './arabicNormalize.ts';
import type { AgriculturalAssociation } from '../types/domain.ts';

test('parseArabicDigits and parseOcrNumber convert Arabic-Indic & Persian digits and keep unclear cells null', () => {
  assert.equal(parseArabicDigits('١٢٣٤٥٦٧٨٩٠'), '1234567890');
  assert.equal(parseArabicDigits('۱۲۳۴۵۶۷۸۹۰'), '1234567890');
  assert.equal(parseOcrNumber('٤٢٠'), 420);
  assert.equal(parseOcrNumber('۲۵۰'), 250);
  assert.equal(parseOcrNumber('٠'), 0);
  assert.equal(parseOcrNumber(''), null);
  assert.equal(parseOcrNumber('غير واضح'), null);
  assert.equal(parseOcrNumber(-5), null);
});

test('escapeHtml escapes XSS characters cleanly', () => {
  assert.equal(
    escapeHtml('<script>alert("xss")</script> & جمعية \'أ\''),
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; جمعية &#39;أ&#39;',
  );
});

test('normalizeArabicName removes tashkeel, unifies alef/yeh/teh marbuta, strips brackets', () => {
  assert.equal(normalizeArabicName('جَمْعِيَّةُ الإِسْمَاعِيلِيَّةِ (١)'), 'جمعيه الاسماعيليه 1');
  assert.equal(normalizeArabicName('  أبو صوير  -  المحطّة  '), 'ابو صوير المحطه');
  assert.equal(normalizeArabicName('الضبعيّة ى'), 'الضبعيه ي');
});

test('sanitizeExtractedText removes HTML tags and control characters', () => {
  assert.equal(sanitizeExtractedText('<script>alert(1)</script>جمعية نفيشة'), 'alert(1)جمعية نفيشة');
  assert.equal(sanitizeExtractedText('  سرابيوم\n\tالزراعية '), 'سرابيوم الزراعية');
});

test('matchAssociationName matches normalized Arabic names despite diacritics and prefixes', () => {
  const associations: AgriculturalAssociation[] = [
    {
      id: 'assoc-ism-1',
      code: 'ISM-101',
      nameAr: 'جمعية الضبعية الزراعية',
      normalizedName: normalizeArabicName('جمعية الضبعية الزراعية'),
      governorateId: 'gov-ismailia',
      centerId: 'ctr-ism-1',
      managerName: 'أحمد محمود',
      managerPhone: '01000000001',
      isActive: true,
    },
    {
      id: 'assoc-ps-1',
      code: 'PS-201',
      nameAr: 'جمعية أم خلف التعاونية',
      normalizedName: normalizeArabicName('جمعية أم خلف التعاونية'),
      governorateId: 'gov-portsaid',
      centerId: 'ctr-ps-1',
      managerName: 'محمد حسن',
      managerPhone: '01000000002',
      isActive: true,
    },
  ];

  const exactMatch = matchAssociationName('الضبعيه', associations);
  assert.equal(exactMatch.associationId, 'assoc-ism-1');
  assert.ok(exactMatch.confidence >= 0.85);

  const alefMatch = matchAssociationName('جمعية ام خلف (التعاونيه)', associations);
  assert.equal(alefMatch.associationId, 'assoc-ps-1');
  assert.ok(alefMatch.confidence >= 0.85);

  const noMatch = matchAssociationName('اسم غير موجود تماما ١٢٣', associations);
  assert.equal(noMatch.associationId, null);
});

test('computeAssociationLockId and computeInviteId are deterministic and ASCII-safe', () => {
  const l1 = computeAssociationLockId('gov-ismailia', normalizeArabicName('جمعية الضبعية'));
  const l2 = computeAssociationLockId('gov-ismailia', normalizeArabicName('جمعيه الضبعيه'));
  const l3 = computeAssociationLockId('gov-suez', normalizeArabicName('جمعيه الضبعيه'));
  assert.equal(l1, l2);
  assert.notEqual(l1, l3);
  assert.match(l1, /^[a-zA-Z0-9_-]+$/);

  const inv1 = computeInviteId('  User@Example.com ');
  const inv2 = computeInviteId('user@example.com');
  assert.equal(inv1, inv2);
  assert.match(inv1, /^inv_[0-9a-f]{24}$/);
});

test('sortAssociationsByOrder and isAssociationVisibleOnDate enforce order and historical visibility', () => {
  const list: AgriculturalAssociation[] = [
    {
      id: 'a-old-inactive',
      code: 'C1',
      nameAr: 'ألف قديمة موقوفة',
      normalizedName: 'الف قديمه موقوفه',
      governorateId: 'gov-ismailia',
      centerId: 'ctr-1',
      managerName: '',
      managerPhone: '',
      sortOrder: 1,
      isActive: false,
      createdAt: '2026-11-01T08:00:00Z',
    },
    {
      id: 'a-second',
      code: 'C2',
      nameAr: 'ثانية',
      normalizedName: 'ثانيه',
      governorateId: 'gov-ismailia',
      centerId: 'ctr-1',
      managerName: '',
      managerPhone: '',
      sortOrder: 5,
      isActive: true,
      createdAt: '2026-11-01T08:00:00Z',
    },
    {
      id: 'a-future',
      code: 'C3',
      nameAr: 'جمعية جديدة',
      normalizedName: 'جمعيه جديده',
      governorateId: 'gov-ismailia',
      centerId: 'ctr-1',
      managerName: '',
      managerPhone: '',
      sortOrder: 2,
      isActive: true,
      createdAt: '2026-11-20T08:00:00Z',
    },
  ];

  const sorted = sortAssociationsByOrder(list);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['a-old-inactive', 'a-future', 'a-second'],
  );

  // On 2026-11-15: a-future (created 2026-11-20) is hidden unless recorded; a-old-inactive is visible ONLY if recorded
  assert.equal(isAssociationVisibleOnDate(list[2], '2026-11-15'), false);
  assert.equal(isAssociationVisibleOnDate(list[2], '2026-11-20'), true);
  assert.equal(isAssociationVisibleOnDate(list[0], '2026-11-15'), false);
  assert.equal(
    isAssociationVisibleOnDate(list[0], '2026-11-15', new Set(['a-old-inactive'])),
    true,
  );
});

test('previewBulkAssociationLines classifies new, existing duplicates, batch duplicates, and over-120 chars', () => {
  const existing: AgriculturalAssociation[] = [
    {
      id: 'a-1',
      code: 'C1',
      nameAr: 'الضبعية',
      normalizedName: normalizeArabicName('الضبعية'),
      governorateId: 'gov-ismailia',
      centerId: 'ctr-1',
      managerName: '',
      managerPhone: '',
      isActive: true,
    },
  ];
  const tooLong = 'أ'.repeat(MAX_ASSOCIATION_NAME_LENGTH + 1);
  const raw = [
    'جمعية جديدة 1',
    'الضبعيه',
    'جمعيه جديده ١',
    tooLong,
    '   ',
    'جمعية جديدة 2',
  ].join('\n');

  const preview = previewBulkAssociationLines(raw, existing);
  assert.equal(preview.validCount, 2);
  assert.equal(preview.duplicateCount, 2);
  assert.equal(preview.invalidCount, 1);
  assert.deepEqual(
    preview.items.map((i) => i.status),
    ['valid_new', 'duplicate_existing', 'duplicate_in_batch', 'too_long', 'valid_new'],
  );
});

