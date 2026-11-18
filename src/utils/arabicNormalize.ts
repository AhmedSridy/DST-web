import type { AgriculturalAssociation } from '../types/domain.ts';

const TASHKEEL_REGEX = /[\u064B-\u065F\u0670\u0640]/g;
const BRACKETS_AND_PUNCT_REGEX = /[()[\]{}«»"'`،؛:.\-_/\\]/g;
const COOPERATIVE_PREFIX_REGEX = /^(جمعية|الجمعية|تعاونية|التعاونية|الزراعية|زراعية)\s+/g;

/**
 * Converts Arabic-Indic (٠-٩) and Extended Arabic-Indic/Persian (۰-۹) digits
 * into Western ASCII digits (0-9) and strips invisible directionality markers.
 */
export function parseArabicDigits(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}

/**
 * Parses a numeric value from OCR or user input cleanly:
 * - Converts Arabic/Persian numerals
 * - Ignores non-numeric strings or negative numbers (returns null)
 * - Returns null on empty/whitespace (never guesses 0)
 */
export function parseOcrNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val < 0) return null;
    return Number(val.toFixed(3));
  }
  const normalized = parseArabicDigits(val).replace(/,/g, '').trim();
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return Number(num.toFixed(3));
}

/**
 * Escapes HTML special characters before interpolating any user-supplied or
 * extracted text into HTML templates (e.g., print/PDF HTML generation).
 */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalizes Arabic association or governorate names for deterministic matching:
 * - Removes Arabic diacritics (tashkeel) and tatweel
 * - Normalizes Alef forms (أ إ آ ٱ -> ا)
 * - Normalizes Alef Maksura (ى -> ي)
 * - Normalizes Teh Marbuta (ة -> ه)
 * - Removes brackets, punctuation, and collapses extra whitespace
 * - Converts Arabic-Indic & Persian digits to Western digits
 */
export function normalizeArabicName(input: string): string {
  if (!input) return '';
  const text = parseArabicDigits(input)
    .replace(TASHKEEL_REGEX, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(BRACKETS_AND_PUNCT_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.toLowerCase();
}

/**
 * Strips noisy HTML/script characters from AI-extracted or user-supplied text
 * to prevent text injection in rendered views.
 */
export function sanitizeExtractedText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingCooperativeWords(normalized: string): string {
  let out = normalized;
  for (let i = 0; i < 3; i++) {
    out = out.replace(COOPERATIVE_PREFIX_REGEX, '').trim();
  }
  return out;
}

function diceCoefficient(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) || 0;
    if (count > 0) {
      bigramsA.set(bg, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

export function matchAssociationName(
  rawName: string,
  associations: AgriculturalAssociation[],
): { associationId: string | null; confidence: number } {
  const clean = normalizeArabicName(sanitizeExtractedText(rawName));
  if (!clean || associations.length === 0) {
    return { associationId: null, confidence: 0 };
  }

  const strippedInput = stripLeadingCooperativeWords(clean);
  let bestId: string | null = null;
  let bestScore = 0;

  for (const assoc of associations) {
    if (!assoc.isActive) continue;
    const normAssoc = normalizeArabicName(assoc.normalizedName || assoc.nameAr);
    const normCode = normalizeArabicName(assoc.code);
    const strippedAssoc = stripLeadingCooperativeWords(normAssoc);

    if (clean === normAssoc || (normCode && clean === normCode) || strippedInput === strippedAssoc) {
      return { associationId: assoc.id, confidence: 1 };
    }

    let score = Math.max(
      diceCoefficient(clean, normAssoc),
      diceCoefficient(strippedInput, strippedAssoc),
    );

    if (strippedInput.length >= 3 && strippedAssoc.includes(strippedInput)) {
      score = Math.max(score, 0.88);
    } else if (strippedAssoc.length >= 3 && strippedInput.includes(strippedAssoc)) {
      score = Math.max(score, 0.86);
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = assoc.id;
    }
  }

  if (bestScore >= 0.58) {
    return { associationId: bestId, confidence: Number(bestScore.toFixed(2)) };
  }

  return { associationId: null, confidence: Number(bestScore.toFixed(2)) };
}

export const MAX_ASSOCIATION_NAME_LENGTH = 120;

/**
 * Deterministic pure-ASCII hex digest (FNV-1a triple lane, 24 hex chars) safe in both Node and Browser.
 */
export function deterministicAsciiHash24(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b1;
  let h3 = 0x85ebca6b;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (b + i), 0x01000193) >>> 0;
    h3 = Math.imul(h3 ^ (b * 31 + 7), 0x85ebca6b) >>> 0;
  }
  return (
    h1.toString(16).padStart(8, '0') +
    h2.toString(16).padStart(8, '0') +
    h3.toString(16).padStart(8, '0')
  );
}

function sanitizeAsciiIdSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'id';
}

export function computeAssociationLockId(governorateId: string, normalizedName: string): string {
  return `lock_${sanitizeAsciiIdSegment(governorateId)}_${deterministicAsciiHash24(normalizedName)}`;
}

export function computeInviteId(email: string): string {
  return `inv_${deterministicAsciiHash24(email.trim().toLowerCase())}`;
}

export function sortAssociationsByOrder(
  associations: AgriculturalAssociation[],
): AgriculturalAssociation[] {
  return [...associations].sort((a, b) => {
    const orderA = typeof a.sortOrder === 'number' && Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.sortOrder === 'number' && Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.nameAr.localeCompare(b.nameAr, 'ar');
  });
}

/**
 * Date-aware association visibility rule:
 * - If an association already has recorded disbursement data on `selectedDate`, always show it
 *   so historical reports remain 100% intact even if later deactivated or backdated.
 * - Otherwise, show only active associations whose createdAt date (if present) is <= selectedDate.
 */
export function isAssociationVisibleOnDate(
  assoc: AgriculturalAssociation,
  selectedDate: string,
  recordedAssocIds?: Set<string>,
): boolean {
  if (recordedAssocIds && recordedAssocIds.has(assoc.id)) {
    return true;
  }
  const activeFlag = assoc.isActive !== false && assoc.active !== false;
  if (!activeFlag) return false;
  if (assoc.createdAt && assoc.createdAt.length >= 10) {
    const createdDate = assoc.createdAt.slice(0, 10);
    if (createdDate > selectedDate) return false;
  }
  return true;
}

export interface BulkAssociationPreviewItem {
  lineNumber: number;
  rawName: string;
  cleanName: string;
  normalizedName: string;
  status: 'valid_new' | 'duplicate_existing' | 'duplicate_in_batch' | 'too_long' | 'invalid';
  reason?: string;
}

export function previewBulkAssociationLines(
  rawText: string,
  existingGovAssocs: AgriculturalAssociation[],
): {
  items: BulkAssociationPreviewItem[];
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
} {
  const existingMap = new Map<string, AgriculturalAssociation>();
  for (const a of existingGovAssocs) {
    const norm = a.normalizedName || normalizeArabicName(a.nameAr);
    if (norm && !existingMap.has(norm)) {
      existingMap.set(norm, a);
    }
  }

  const seenInBatch = new Set<string>();
  const lines = rawText.split(/\r?\n/);
  const items: BulkAssociationPreviewItem[] = [];
  let validCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  lines.forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    const cleanName = sanitizeExtractedText(trimmed);
    const normalizedName = normalizeArabicName(cleanName);

    if (!cleanName || !normalizedName) {
      invalidCount++;
      items.push({
        lineNumber: index + 1,
        rawName: trimmed,
        cleanName,
        normalizedName,
        status: 'invalid',
        reason: 'اسم غير صالح أو فارغ بعد التنظيف',
      });
      return;
    }

    if (cleanName.length > MAX_ASSOCIATION_NAME_LENGTH) {
      invalidCount++;
      items.push({
        lineNumber: index + 1,
        rawName: trimmed,
        cleanName,
        normalizedName,
        status: 'too_long',
        reason: `يتجاوز الحد الأقصى (${MAX_ASSOCIATION_NAME_LENGTH} حرفًا)`,
      });
      return;
    }

    const existing = existingMap.get(normalizedName);
    if (existing) {
      duplicateCount++;
      items.push({
        lineNumber: index + 1,
        rawName: trimmed,
        cleanName,
        normalizedName,
        status: 'duplicate_existing',
        reason: existing.isActive === false
          ? `مكرر مع جمعية موقوفة («${existing.nameAr}»)`
          : `مسجل بالفعل في المحافظة («${existing.nameAr}»)`,
      });
      return;
    }

    if (seenInBatch.has(normalizedName)) {
      duplicateCount++;
      items.push({
        lineNumber: index + 1,
        rawName: trimmed,
        cleanName,
        normalizedName,
        status: 'duplicate_in_batch',
        reason: 'مكرر داخل نفس القائمة المُلصقة',
      });
      return;
    }

    seenInBatch.add(normalizedName);
    validCount++;
    items.push({
      lineNumber: index + 1,
      rawName: trimmed,
      cleanName,
      normalizedName,
      status: 'valid_new',
    });
  });

  return { items, validCount, duplicateCount, invalidCount };
}

