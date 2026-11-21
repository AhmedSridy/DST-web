import type { InspectionStatus } from '../types/domain.ts';

export interface DisbursementInput {
  openingBalance: number | null;
  closingBalance: number | null;
  settlementQty: number | null;
}

export interface DisbursementComputation {
  actualDisbursed: number | null;
  variance: number | null;
  hasVariance: boolean;
  hasNegativeInput: boolean;
  hasNegativeDisbursed: boolean;
  isRecorded: boolean;
}

/**
 * Core DST Fertilizer Accounting Equations (Prompt B Specification — no incoming column):
 * - المنصرف الفعلي = بداية اليوم − نهاية اليوم
 * - فرق التسوية = المنصرف الفعلي − التسوية
 */
export function computeDisbursementRow(
  input: DisbursementInput,
  treatEmptyAsZero = false,
): DisbursementComputation {
  const { openingBalance, closingBalance, settlementQty } = input;

  const isRecorded =
    openingBalance !== null || closingBalance !== null || settlementQty !== null;

  const checkNegOrNaN = (v: number | null) =>
    v !== null && (Number.isNaN(v) || v < 0);

  const hasNegativeInput =
    checkNegOrNaN(openingBalance) ||
    checkNegOrNaN(closingBalance) ||
    checkNegOrNaN(settlementQty);

  const effOpen = openingBalance !== null ? Math.max(0, Number(openingBalance)) : treatEmptyAsZero ? 0 : null;
  const effClose = closingBalance !== null ? Math.max(0, Number(closingBalance)) : treatEmptyAsZero ? 0 : null;
  const effSettle = settlementQty !== null ? Math.max(0, Number(settlementQty)) : treatEmptyAsZero ? 0 : null;

  const actualDisbursed =
    effOpen !== null && effClose !== null
      ? Number((effOpen - effClose).toFixed(3))
      : null;

  const variance =
    actualDisbursed !== null && effSettle !== null
      ? Number((actualDisbursed - effSettle).toFixed(3))
      : null;

  const hasVariance = variance !== null && Math.abs(variance) > 0.0001;
  const hasNegativeDisbursed = actualDisbursed !== null && actualDisbursed < -0.0001;

  return {
    actualDisbursed,
    variance,
    hasVariance,
    hasNegativeInput,
    hasNegativeDisbursed,
    isRecorded,
  };
}

/**
 * Core Tractor Shipment Equation:
 * - فرق الشحنة = العدد الفعلي − عدد البوليصة
 */
export function computeTractorMetrics(
  manifestBags: number,
  actualBags: number,
  isDamaged = false,
): { bagVariance: number; inspectionStatus: InspectionStatus } {
  const safeManifest = Math.max(0, Math.round(Number(manifestBags) || 0));
  const safeActual = Math.max(0, Math.round(Number(actualBags) || 0));
  const bagVariance = safeActual - safeManifest;

  if (isDamaged) {
    return { bagVariance, inspectionStatus: 'damaged' };
  }
  if (bagVariance === 0) {
    return { bagVariance: 0, inspectionStatus: 'matched' };
  }
  if (bagVariance < 0) {
    return { bagVariance, inspectionStatus: 'shortage' };
  }
  return { bagVariance, inspectionStatus: 'surplus' };
}

/**
 * Converts metric tons to bags using the fertilizer's configured bagWeightKg (1000 / bagWeightKg).
 * Returns null if bagWeightKg is missing/invalid so the caller never guesses a conversion factor.
 */
export function tonsToBags(tons: number, bagWeightKg: number | null | undefined): number | null {
  if (!Number.isFinite(tons) || tons < 0) return null;
  if (typeof bagWeightKg !== 'number' || !Number.isFinite(bagWeightKg) || bagWeightKg <= 0) {
    return null;
  }
  return Math.round(tons * (1000 / bagWeightKg));
}

export function bagsToTons(bags: number, bagWeightKg: number | null | undefined): number | null {
  if (!Number.isFinite(bags) || bags < 0) return null;
  if (typeof bagWeightKg !== 'number' || !Number.isFinite(bagWeightKg) || bagWeightKg <= 0) {
    return null;
  }
  return Number((bags / (1000 / bagWeightKg)).toFixed(3));
}

export function formatNumberAr(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value);
}
