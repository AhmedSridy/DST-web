import { GoogleGenAI, Type, type GenerateContentResponse } from '@google/genai';
import type {
  AgriculturalAssociation,
  Governorate,
  ManifestOcrExtractedData,
  SheetOcrExtractedRow,
  SheetSectionType,
} from '../types/domain.ts';
import {
  matchAssociationName,
  normalizeArabicName,
  parseOcrNumber,
  sanitizeExtractedText,
} from '../utils/arabicNormalize.ts';

const OCR_MODEL = 'gemini-4-hydrogen';

export class OcrExtractionError extends Error {
  rawResponseText?: string;
  code: string;

  constructor(message: string, code = 'OCR_ERROR', rawResponseText?: string) {
    super(message);
    this.name = 'OcrExtractionError';
    this.code = code;
    this.rawResponseText = rawResponseText;
  }
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new OcrExtractionError(
      'مفتاح GEMINI_API_KEY غير مهيأ على الخادم لتشغيل القراءة الذكية (OCR).',
      'MISSING_KEY',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withExponentialBackoff<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const isTransient =
        msg.includes('429') ||
        msg.includes('500') ||
        msg.includes('503') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('fetch');

      if (!isTransient || attempt === maxAttempts) {
        break;
      }
      const delayMs = 600 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function toArabicOcrError(error: unknown, rawText?: string): OcrExtractionError {
  if (error instanceof OcrExtractionError) {
    return error;
  }
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('GEMINI_API_KEY')) {
    return new OcrExtractionError(raw, 'MISSING_KEY', rawText);
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED')) {
    return new OcrExtractionError(
      'تعذر التحقق من صلاحية مفتاح الذكاء الاصطناعي على الخادم.',
      'AUTH_ERROR',
      rawText,
    );
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return new OcrExtractionError(
      'تم تجاوز حد الحصة المؤقتة لخدمة الذكاء الاصطناعي. يُرجى الانتظار دقيقة ثم إعادة المحاولة.',
      'QUOTA_EXCEEDED',
      rawText,
    );
  }
  if (
    raw.includes('ECONNREFUSED') ||
    raw.includes('ENOTFOUND') ||
    raw.includes('ETIMEDOUT') ||
    raw.toLowerCase().includes('fetch failed') ||
    raw.toLowerCase().includes('network')
  ) {
    return new OcrExtractionError(
      'فشل الاتصال بخدمة القراءة الذكية عبر الشبكة. تحقق من الاتصال وأعد المحاولة.',
      'NETWORK_ERROR',
      rawText,
    );
  }
  if (
    raw.includes('INVALID_ARGUMENT') ||
    raw.toLowerCase().includes('unsupported') ||
    raw.toLowerCase().includes('mime') ||
    raw.toLowerCase().includes('image')
  ) {
    return new OcrExtractionError(
      'صيغة الصورة غير مدعومة أو حجمها/أبعادها غير صالحة. يُرجى رفع صورة JPEG أو PNG واضحة.',
      'UNSUPPORTED_IMAGE',
      rawText,
    );
  }
  return new OcrExtractionError(
    `تعذرت قراءة الصورة بالذكاء الاصطناعي: ${sanitizeExtractedText(raw).slice(0, 140)}`,
    'OCR_FAILED',
    rawText,
  );
}

function stripDataUrlPrefix(base64OrDataUrl: string): { base64: string; detectedMime?: string } {
  if (base64OrDataUrl.startsWith('data:')) {
    const [header, data] = base64OrDataUrl.split(',');
    const mimeMatch = header.match(/data:([^;]+);/);
    return { base64: data || '', detectedMime: mimeMatch?.[1] };
  }
  return { base64: base64OrDataUrl };
}

function sanitizeNullableNumber(val: unknown): number | null {
  return parseOcrNumber(val);
}

function extractTriplet(arr: unknown): [number | null, number | null, number | null] {
  if (!Array.isArray(arr)) return [null, null, null];
  return [
    parseOcrNumber(arr[0]),
    parseOcrNumber(arr[1]),
    parseOcrNumber(arr[2]),
  ];
}

export async function extractSheetNumbersOcr(params: {
  imageBase64: string;
  mimeType: string;
  sectionType: SheetSectionType;
  associations: AgriculturalAssociation[];
}): Promise<{ rows: SheetOcrExtractedRow[]; summaryNote: string; rawResponseText: string }> {
  const { base64, detectedMime } = stripDataUrlPrefix(params.imageBase64);
  if (!base64 || base64.length < 20) {
    throw new OcrExtractionError('بيانات الصورة المرسلة غير مكتملة أو تالفة.', 'UNSUPPORTED_IMAGE');
  }

  const effectiveMime = detectedMime || params.mimeType || 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(effectiveMime)) {
    throw new OcrExtractionError(
      `صيغة الصورة (${effectiveMime}) غير مدعومة. يرجى استخدام JPEG أو PNG أو WEBP.`,
      'UNSUPPORTED_IMAGE',
    );
  }

  const ai = getAiClient();
  const assocNamesSample = params.associations
    .slice(0, 90)
    .map((a) => `${a.nameAr} (${a.code})`)
    .join('، ');

  const isFullSheet = params.sectionType === 'full_sheet';

  const sectionHintMap: Record<SheetSectionType, string> = {
    opening: 'بداية اليوم فقط (رصيد افتتاحي)',
    closing: 'نهاية اليوم فقط (رصيد ختامي)',
    settlement: 'التسوية فقط (المنصرف الدفتري)',
    full_sheet: 'كشف كامل (يضم مجموعات الأعمدة: بداية اليوم، نهاية اليوم، المنصرف إن وُجد، التسوية)',
  };

  const prompt = [
    `أنت مدقق بيانات محاسبية متخصص في قراءة كشوف صرف الأسمدة الزراعية المصرية (المطبوعة أو المكتوبة بخط اليد).`,
    `نوع الكشف المطلوب قراءته: ${sectionHintMap[params.sectionType]}.`,
    `أسماء الجمعيات المرجعية للمحافظة: ${assocNamesSample}.`,
    ``,
    `قواعد استخراج صارمة جدًا:`,
    `1. الجدول عربي من اليمين إلى اليسار (RTL). داخل كل مجموعة أعمدة، الترتيب من اليمين إلى اليسار هو: [يوريا (index 0), نترات (index 1), سلفات (index 2)].`,
    isFullSheet
      ? `2. في الكشف الكامل، أرجِع لكل صف: name (اسم الجمعية)، s (مصفوفة 3 أرقام للبداية [يوريا، نترات، سلفات])، e (مصفوفة 3 أرقام للنهاية)، p (مصفوفة 3 أرقام لعمود المنصرف إن كان مطبوعًا/مكتوبًا في الجدول، وإلا [null,null,null])، t (مصفوفة 3 أرقام للتسوية)، conf (الثقة من 0 إلى 1).`
      : `2. في القسم الفردي (${sectionHintMap[params.sectionType]})، أرجِع لكل صف: name (اسم الجمعية)، v (مصفوفة 3 أرقام [يوريا، نترات، سلفات])، conf (الثقة من 0 إلى 1).`,
    `3. حوّل أي أرقام عربية هندية (٠-٩) أو فارسية (۰-۹) إلى أرقام إنجليزية قياسية.`,
    `4. ممنوع تمامًا تخمين أي رقم غير واضح أو مطموس أو خلية فارغة: أرجِع null لأي خانة غير واضحة أو فارغة، ولا تجعلها صفرًا أبدًا إلا إذا كان الصفر مكتوبًا بوضوح.`,
    `5. تجاهل السطور الفارغة أو صفوف الإجماليات النهائية إذا لم تمثل جمعية، وتجاهل أي قيم غير رقمية أو سالبة.`,
  ].join('\n');

  let rawResponseText = '';

  try {
    const response: GenerateContentResponse = await withExponentialBackoff(() =>
      ai.models.generateContent({
        model: OCR_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: effectiveMime,
                data: base64,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: isFullSheet
            ? {
                type: Type.OBJECT,
                properties: {
                  summaryNote: { type: Type.STRING },
                  rows: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        s: { type: Type.ARRAY, items: { type: Type.NUMBER, nullable: true } },
                        e: { type: Type.ARRAY, items: { type: Type.NUMBER, nullable: true } },
                        p: { type: Type.ARRAY, items: { type: Type.NUMBER, nullable: true } },
                        t: { type: Type.ARRAY, items: { type: Type.NUMBER, nullable: true } },
                        conf: { type: Type.NUMBER },
                        notes: { type: Type.STRING },
                      },
                      required: ['name', 's', 'e', 't', 'conf'],
                    },
                  },
                },
                required: ['rows'],
              }
            : {
                type: Type.OBJECT,
                properties: {
                  summaryNote: { type: Type.STRING },
                  rows: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        v: { type: Type.ARRAY, items: { type: Type.NUMBER, nullable: true } },
                        conf: { type: Type.NUMBER },
                        notes: { type: Type.STRING },
                      },
                      required: ['name', 'v', 'conf'],
                    },
                  },
                },
                required: ['rows'],
              },
        },
      }),
    );

    rawResponseText = (response.text || '').trim();
    let parsed: { summaryNote?: string; rows?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(rawResponseText || '{}') as {
        summaryNote?: string;
        rows?: Array<Record<string, unknown>>;
      };
    } catch {
      throw new OcrExtractionError(
        'تعذر تحليل استجابة الذكاء الاصطناعي بصيغة JSON منظمة. يمكنك فتح «عرض الرد الخام» لفحص النص.',
        'UNPARSEABLE_JSON',
        rawResponseText,
      );
    }

    const rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
    if (rawRows.length === 0) {
      throw new OcrExtractionError(
        'لم يتم العثور على أي صفوف جمعيات أو أرقام مقروءة في الصورة. تحقق من وضوح الصورة أو قم بتدويرها.',
        'NO_ROWS_FOUND',
        rawResponseText,
      );
    }

    // Track duplicate matched associations across rows
    const matchCounts = new Map<string, number>();
    const interim = rawRows.map((row, idx) => {
      const extractedName = sanitizeExtractedText(row.name || row.associationName || `صف ${idx + 1}`);
      const match = matchAssociationName(extractedName, params.associations);
      if (match.associationId) {
        matchCounts.set(match.associationId, (matchCounts.get(match.associationId) || 0) + 1);
      }
      return { row, idx, extractedName, match };
    });

    const rows: SheetOcrExtractedRow[] = interim.map(({ row, idx, extractedName, match }) => {
      const confidence = Math.max(0, Math.min(1, Number(row.conf ?? row.confidence) || 0.7));
      const duplicateAssociationWarning = Boolean(
        match.associationId && (matchCounts.get(match.associationId) || 0) > 1,
      );

      let ureaOpening: number | null = null;
      let nitrateOpening: number | null = null;
      let sulfateOpening: number | null = null;
      let ureaClosing: number | null = null;
      let nitrateClosing: number | null = null;
      let sulfateClosing: number | null = null;
      let ureaSettlement: number | null = null;
      let nitrateSettlement: number | null = null;
      let sulfateSettlement: number | null = null;
      let ureaExtractedDisbursed: number | null = null;
      let nitrateExtractedDisbursed: number | null = null;
      let sulfateExtractedDisbursed: number | null = null;

      if (isFullSheet) {
        const s = extractTriplet(row.s);
        const e = extractTriplet(row.e);
        const t = extractTriplet(row.t);
        const p = extractTriplet(row.p);
        [ureaOpening, nitrateOpening, sulfateOpening] = s;
        [ureaClosing, nitrateClosing, sulfateClosing] = e;
        [ureaSettlement, nitrateSettlement, sulfateSettlement] = t;
        [ureaExtractedDisbursed, nitrateExtractedDisbursed, sulfateExtractedDisbursed] = p;
      } else {
        const v = extractTriplet(row.v);
        if (params.sectionType === 'opening') {
          [ureaOpening, nitrateOpening, sulfateOpening] = v;
        } else if (params.sectionType === 'closing') {
          [ureaClosing, nitrateClosing, sulfateClosing] = v;
        } else if (params.sectionType === 'settlement') {
          [ureaSettlement, nitrateSettlement, sulfateSettlement] = v;
        }
      }

      // Cross-check extracted "المنصرف" (p) vs (s - e) when both exist
      const disbursedMismatchWarnings: string[] = [];
      const checkDisbursed = (
        label: string,
        sVal: number | null,
        eVal: number | null,
        pVal: number | null,
      ) => {
        if (sVal !== null && eVal !== null && pVal !== null) {
          const expected = Number((sVal - eVal).toFixed(3));
          if (Math.abs(expected - pVal) > 0.01) {
            disbursedMismatchWarnings.push(
              `${label}: المنصرف المقروء (${pVal}) يختلف عن (بداية − نهاية) = ${expected}`,
            );
          }
        }
      };

      if (isFullSheet) {
        checkDisbursed('يوريا', ureaOpening, ureaClosing, ureaExtractedDisbursed);
        checkDisbursed('نترات', nitrateOpening, nitrateClosing, nitrateExtractedDisbursed);
        checkDisbursed('سلفات', sulfateOpening, sulfateClosing, sulfateExtractedDisbursed);
      }

      // Check if relevant fields contain null
      const relevantValues: Array<number | null> = isFullSheet
        ? [
            ureaOpening,
            ureaClosing,
            ureaSettlement,
            nitrateOpening,
            nitrateClosing,
            nitrateSettlement,
            sulfateOpening,
            sulfateClosing,
            sulfateSettlement,
          ]
        : params.sectionType === 'opening'
          ? [ureaOpening, nitrateOpening, sulfateOpening]
          : params.sectionType === 'closing'
            ? [ureaClosing, nitrateClosing, sulfateClosing]
            : [ureaSettlement, nitrateSettlement, sulfateSettlement];

      const hasNullCell = relevantValues.some((v) => v === null);
      const needsReview =
        confidence < 0.8 ||
        hasNullCell ||
        !match.associationId ||
        disbursedMismatchWarnings.length > 0 ||
        duplicateAssociationWarning;

      return {
        rowIndex: idx + 1,
        extractedName,
        matchedAssociationId: match.associationId,
        matchConfidence: match.confidence,
        ureaOpening,
        ureaClosing,
        ureaSettlement,
        ureaExtractedDisbursed,
        nitrateOpening,
        nitrateClosing,
        nitrateSettlement,
        nitrateExtractedDisbursed,
        sulfateOpening,
        sulfateClosing,
        sulfateSettlement,
        sulfateExtractedDisbursed,
        disbursedMismatchWarnings,
        duplicateAssociationWarning,
        confidence: Number(confidence.toFixed(2)),
        needsReview,
        // Automatically uncheck any row needing review (<0.8 confidence, null, unmatched, duplicate, or mismatch)
        include: !needsReview,
        notes: sanitizeExtractedText(row.notes || ''),
      };
    });

    return {
      rows,
      summaryNote: sanitizeExtractedText(
        parsed.summaryNote || 'تمت القراءة بنجاح. يُرجى مراجعة الصفوف المعلّمة بـ «⚠ راجع» قبل الإدراج.',
      ),
      rawResponseText,
    };
  } catch (error) {
    throw toArabicOcrError(error, rawResponseText);
  }
}

export async function analyzeSingleSheetOcr(params: {
  imageBase64: string;
  mimeType: string;
  associationName: string;
  fertilizerNameAr: string;
  lastRecordedBalance: number;
}): Promise<{
  extractedOpeningBalance: number | null;
  extractedClosingBalance: number | null;
  extractedSettlement: number | null;
  confidence: number;
  notes: string;
  rawResponseText: string;
}> {
  const { base64, detectedMime } = stripDataUrlPrefix(params.imageBase64);
  if (!base64 || base64.length < 20) {
    throw new OcrExtractionError('بيانات صورة الكشف الفردي غير صالحة.', 'UNSUPPORTED_IMAGE');
  }

  const ai = getAiClient();
  const prompt = [
    `اقرأ صورة كشف المخزون الفردي للجمعية الزراعية: "${params.associationName}" لصنف السماد: "${params.fertilizerNameAr}".`,
    `آخر رصيد مسجل بالنظام للمقارنة هو: ${params.lastRecordedBalance} شيكارة.`,
    `استخرج بداية اليوم، نهاية اليوم، والتسوية بدقة دون تخمين (أرجِع null لأي رقم غير واضح، وحوّل الأرقام العربية ٠-٩ إلى إنجليزية). لا يوجد عمود وارد.`,
  ].join('\n');

  let rawResponseText = '';
  try {
    const response = await withExponentialBackoff(() =>
      ai.models.generateContent({
        model: OCR_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: detectedMime || params.mimeType || 'image/jpeg',
                data: base64,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              extractedOpeningBalance: { type: Type.NUMBER, nullable: true },
              extractedClosingBalance: { type: Type.NUMBER, nullable: true },
              extractedSettlement: { type: Type.NUMBER, nullable: true },
              confidence: { type: Type.NUMBER },
              notes: { type: Type.STRING },
            },
            required: ['confidence', 'notes'],
          },
        },
      }),
    );

    rawResponseText = (response.text || '').trim();
    const parsed = JSON.parse(rawResponseText || '{}') as Record<string, unknown>;
    return {
      extractedOpeningBalance: sanitizeNullableNumber(parsed.extractedOpeningBalance),
      extractedClosingBalance: sanitizeNullableNumber(parsed.extractedClosingBalance),
      extractedSettlement: sanitizeNullableNumber(parsed.extractedSettlement),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.75)),
      notes: sanitizeExtractedText(parsed.notes || 'تم تحليل الكشف الفردي.'),
      rawResponseText,
    };
  } catch (error) {
    throw toArabicOcrError(error, rawResponseText);
  }
}

export async function extractManifestOcr(params: {
  imageBase64: string;
  mimeType: string;
  governorates: Governorate[];
  associations: AgriculturalAssociation[];
}): Promise<ManifestOcrExtractedData> {
  const { base64, detectedMime } = stripDataUrlPrefix(params.imageBase64);
  if (!base64 || base64.length < 20) {
    throw new OcrExtractionError('بيانات صورة البوليصة غير صالحة.', 'UNSUPPORTED_IMAGE');
  }

  const ai = getAiClient();
  const assocSample = params.associations
    .slice(0, 60)
    .map((a) => `${a.nameAr}`)
    .join('، ');
  const govSample = params.governorates.map((g) => g.nameAr).join('، ');

  const prompt = [
    `أنت خبير استخراج بيانات بوالص شحن ونقل الأسمدة الزراعية المصرية.`,
    `استخرج الحقول من صورة البوليصة بدقة دون تخمين. إذا لم يكن الحقل واضحًا فأرجِع نصًا فارغًا أو null للأرقام.`,
    `المحافظات المرجعية: ${govSample}.`,
    `أمثلة الجمعيات: ${assocSample}.`,
    `حدد نوع السماد من القيم: urea (يوريا) أو nitrate (نترات) أو sulfate (سلفات).`,
    `أرجِع التاريخ بصيغة YYYY-MM-DD إن أمكن، والوقت بصيغة HH:MM، وعدد الشكاير والوزن بالطن.`,
  ].join('\n');

  try {
    const response = await withExponentialBackoff(() =>
      ai.models.generateContent({
        model: OCR_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: detectedMime || params.mimeType || 'image/jpeg',
                data: base64,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              manifestNumber: { type: Type.STRING },
              arrivalDate: { type: Type.STRING },
              arrivalTime: { type: Type.STRING },
              governorateName: { type: Type.STRING },
              associationName: { type: Type.STRING },
              fertilizerCode: { type: Type.STRING },
              manifestBags: { type: Type.INTEGER, nullable: true },
              weightTons: { type: Type.NUMBER, nullable: true },
              tractorPlate: { type: Type.STRING },
              driverName: { type: Type.STRING },
              driverPhone: { type: Type.STRING },
              driverNationalId: { type: Type.STRING },
              supplySource: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              warnings: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['manifestNumber', 'confidence'],
          },
        },
      }),
    );

    const parsed = JSON.parse((response.text || '{}').trim()) as Record<string, unknown>;
    const govName = sanitizeExtractedText(parsed.governorateName || '');
    const assocName = sanitizeExtractedText(parsed.associationName || '');

    const normGov = normalizeArabicName(govName);
    const matchedGov =
      params.governorates.find((g) => {
        const ng = normalizeArabicName(g.nameAr);
        return normGov && (ng === normGov || ng.includes(normGov) || normGov.includes(ng));
      }) || null;

    const scopedAssocs = matchedGov
      ? params.associations.filter((a) => a.governorateId === matchedGov.id)
      : params.associations;
    const assocMatch = matchAssociationName(assocName, scopedAssocs.length ? scopedAssocs : params.associations);

    const rawFert = sanitizeExtractedText(parsed.fertilizerCode || '').toLowerCase();
    let fertilizerCode = 'urea';
    if (rawFert.includes('nitrate') || rawFert.includes('نترات')) fertilizerCode = 'nitrate';
    else if (rawFert.includes('sulfate') || rawFert.includes('سلفات')) fertilizerCode = 'sulfate';

    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.map((w) => sanitizeExtractedText(w)).filter(Boolean)
      : [];

    const bags = sanitizeNullableNumber(parsed.manifestBags);
    const tons = sanitizeNullableNumber(parsed.weightTons);
    if (bags === null && tons !== null) {
      warnings.push('عدد الشكاير غير مكتوب صراحة؛ يمكنك استخدام زر التحويل من الطن (×20).');
    }

    return {
      manifestNumber: sanitizeExtractedText(parsed.manifestNumber || ''),
      arrivalDate: sanitizeExtractedText(parsed.arrivalDate || new Date().toISOString().slice(0, 10)),
      arrivalTime: sanitizeExtractedText(parsed.arrivalTime || ''),
      governorateName: govName,
      matchedGovernorateId: matchedGov?.id || null,
      associationName: assocName,
      matchedAssociationId: assocMatch.associationId,
      fertilizerCode,
      manifestBags: bags !== null ? Math.round(bags) : null,
      weightTons: tons,
      tractorPlate: sanitizeExtractedText(parsed.tractorPlate || ''),
      driverName: sanitizeExtractedText(parsed.driverName || ''),
      driverPhone: sanitizeExtractedText(parsed.driverPhone || ''),
      driverNationalId: sanitizeExtractedText(parsed.driverNationalId || ''),
      supplySource: sanitizeExtractedText(parsed.supplySource || ''),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.8)),
      warnings,
    };
  } catch (error) {
    throw toArabicOcrError(error);
  }
}
