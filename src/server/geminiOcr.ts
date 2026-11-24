import { GoogleGenAI, ThinkingLevel, Type, type GenerateContentResponse } from '@google/genai';
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

export const DEFAULT_OCR_MODEL = 'gemini-4-hydrogen';

const DEPRECATED_OR_UNAVAILABLE_OCR_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
  'gemini-2.5-flash',
]);

export function resolveOcrModel(envModel?: string): string {
  const trimmed = (envModel || '').trim();
  if (!trimmed) {
    return DEFAULT_OCR_MODEL;
  }
  if (DEPRECATED_OR_UNAVAILABLE_OCR_MODELS.has(trimmed.toLowerCase())) {
    console.warn(
      `[DST OCR] GEMINI_OCR_MODEL="${trimmed}" is deprecated/unavailable; falling back to "${DEFAULT_OCR_MODEL}".`,
    );
    return DEFAULT_OCR_MODEL;
  }
  return trimmed;
}

export function buildOcrThinkingConfig(
  model: string,
): { thinkingConfig: { thinkingLevel: ThinkingLevel } } | Record<string, never> {
  // thinkingLevel is supported on Gemini 3 and Gemini 4 series models.
  // MEDIUM balances strong Arabic OCR/RTL reasoning with low latency so reverse proxies do not time out.
  if (/^gemini-(3|4)/i.test(model)) {
    return {
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.MEDIUM,
      },
    };
  }
  return {};
}

const OCR_MODEL = resolveOcrModel(process.env.GEMINI_OCR_MODEL);
const ALLOWED_OCR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_OCR_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB max decoded size

const SHEET_OCR_SYSTEM_INSTRUCTION =
  'أنت مدقق محاسبي دقيق جدًا متخصص في قراءة الجداول والكشوف الورقية المصرية لصرف الأسمدة الزراعية (المطبوعة والمكتوبة بخط اليد). التزم دائمًا بترتيب الأعمدة العربي من اليمين إلى اليسار [يوريا، نترات، سلفات]، ولا تخمّن أي رقم غير واضح مطلقًا (أرجِع null للخلايا الفارغة أو غير المقروءة).';

const MANIFEST_OCR_SYSTEM_INSTRUCTION =
  'أنت مدقق متخصص في قراءة بوالص شحن ونقل الأسمدة الزراعية المصرية (المطبوعة أو اليدوية). استخرج كل حقل بدقة حرفية ورقمية عالية دون أي تخمين أو افتراض؛ إن كان الحقل غير واضح أو غير موجود فأرجِع نصًا فارغًا أو null للأرقام.';

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

const PLACEHOLDER_API_KEYS = new Set(['MY_GEMINI_API_KEY', 'YOUR_GEMINI_API_KEY']);
const QUOTA_COOLDOWN_MS = 65_000; // 65s covers the 1-minute RPM/TPM window
const AUTH_ERROR_COOLDOWN_MS = 5 * 60_000; // 5m cooldown for invalid/disabled backup keys

/**
 * Collects unique Gemini API keys from server environment variables in priority order:
 * 1. GEMINI_API_KEY (primary)
 * 2. GEMINI_API_KEYS (comma, semicolon, or newline-separated optional fallback list)
 * 3. GEMINI_API_KEY_2 .. GEMINI_API_KEY_10 (numbered optional fallback keys)
 */
export function collectGeminiApiKeys(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const rawCandidates: string[] = [];
  if (typeof env.GEMINI_API_KEY === 'string') {
    rawCandidates.push(env.GEMINI_API_KEY);
  }
  if (typeof env.GEMINI_API_KEYS === 'string') {
    rawCandidates.push(...env.GEMINI_API_KEYS.split(/[\r\n,;]+/));
  }
  for (let i = 2; i <= 10; i++) {
    const numbered = env[`GEMINI_API_KEY_${i}`];
    if (typeof numbered === 'string') {
      rawCandidates.push(numbered);
    }
  }

  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of rawCandidates) {
    const trimmed = raw.trim();
    if (!trimmed || PLACEHOLDER_API_KEYS.has(trimmed) || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    keys.push(trimmed);
  }
  return keys;
}

export function isQuotaOrRateLimitError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit')
  );
}

export function isAuthOrKeyError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('api_key_invalid') ||
    msg.includes('permission_denied') ||
    msg.includes('api key not valid') ||
    msg.includes('403')
  );
}

export function isTransientServerError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('unavailable') ||
    msg.includes('fetch failed') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('socket') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  );
}

function createAiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 75_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export class GeminiKeyFailoverManager {
  private cooldownUntilByKey = new Map<string, number>();
  private activeKeyIndex = 0;

  constructor(
    private readonly getKeys: () => string[] = () => collectGeminiApiKeys(process.env),
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly quotaCooldownMs = QUOTA_COOLDOWN_MS,
    private readonly authCooldownMs = AUTH_ERROR_COOLDOWN_MS,
  ) {}

  /**
   * Executes a Gemini API call with automatic, transparent failover across all configured keys.
   * - On quota exhaustion (429 / RESOURCE_EXHAUSTED) or invalid key: immediately marks that key
   *   in temporary cooldown and switches to the next healthy key with zero user-facing interruption.
   * - On transient 5xx/network errors: retries briefly before failing over to another key.
   * - On non-key errors (e.g. 404 model not found, 400 invalid image): throws immediately.
   */
  async execute<T>(fn: (apiKey: string, keyPosition: number, totalKeys: number) => Promise<T>): Promise<T> {
    const keys = this.getKeys();
    if (keys.length === 0) {
      throw new OcrExtractionError(
        'مفتاح GEMINI_API_KEY غير مهيأ على الخادم لتشغيل القراءة الذكية (OCR).',
        'MISSING_KEY',
      );
    }

    const currentNow = this.now();
    const total = keys.length;
    const startIdx = this.activeKeyIndex % total;

    // Build ordered candidate list: healthy (non-cooled-down) keys first starting from activeKeyIndex,
    // followed by cooled-down keys sorted by soonest cooldown expiry (fallback if all are cooled down).
    const healthyIndices: number[] = [];
    const cooledIndices: Array<{ idx: number; until: number }> = [];

    for (let offset = 0; offset < total; offset++) {
      const idx = (startIdx + offset) % total;
      const until = this.cooldownUntilByKey.get(keys[idx]) ?? 0;
      if (until <= currentNow) {
        healthyIndices.push(idx);
      } else {
        cooledIndices.push({ idx, until });
      }
    }

    cooledIndices.sort((a, b) => a.until - b.until);
    const orderedIndices =
      healthyIndices.length > 0
        ? healthyIndices
        : cooledIndices.map((entry) => entry.idx);

    let lastError: unknown;
    let quotaFailures = 0;

    for (let pos = 0; pos < orderedIndices.length; pos++) {
      const keyIdx = orderedIndices[pos];
      const apiKey = keys[keyIdx];
      const maxAttemptsForThisKey = total === 1 ? 3 : 2;

      for (let attempt = 1; attempt <= maxAttemptsForThisKey; attempt++) {
        try {
          const result = await fn(apiKey, keyIdx + 1, total);
          this.activeKeyIndex = keyIdx;
          this.cooldownUntilByKey.delete(apiKey);
          return result;
        } catch (error: unknown) {
          lastError = error;

          if (isQuotaOrRateLimitError(error)) {
            quotaFailures++;
            this.cooldownUntilByKey.set(apiKey, this.now() + this.quotaCooldownMs);
            const hasAnotherKey = pos + 1 < orderedIndices.length;
            if (hasAnotherKey) {
              const nextKeyNum = orderedIndices[pos + 1] + 1;
              console.warn(
                `[DST OCR] API key #${keyIdx + 1}/${total} hit quota limit (429); transparently switching to key #${nextKeyNum}/${total}.`,
              );
              break; // Immediately fail over to next key without waiting
            }
            if (total === 1 && attempt < maxAttemptsForThisKey) {
              const delayMs = 600 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
              await this.sleep(delayMs);
              continue;
            }
            break;
          }

          if (isAuthOrKeyError(error)) {
            this.cooldownUntilByKey.set(apiKey, this.now() + this.authCooldownMs);
            if (pos + 1 < orderedIndices.length) {
              const nextKeyNum = orderedIndices[pos + 1] + 1;
              console.warn(
                `[DST OCR] API key #${keyIdx + 1}/${total} returned auth/permission error; switching to key #${nextKeyNum}/${total}.`,
              );
              break;
            }
            throw error;
          }

          if (isTransientServerError(error)) {
            if (attempt < maxAttemptsForThisKey) {
              const delayMs = 500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
              await this.sleep(delayMs);
              continue;
            }
            if (pos + 1 < orderedIndices.length) {
              const nextKeyNum = orderedIndices[pos + 1] + 1;
              console.warn(
                `[DST OCR] API key #${keyIdx + 1}/${total} failed after transient retries; trying key #${nextKeyNum}/${total}.`,
              );
              break;
            }
            throw error;
          }

          // Non-retryable client/model/image error -> surface immediately without burning other keys
          throw error;
        }
      }
    }

    if (quotaFailures > 0 && total > 1) {
      throw new OcrExtractionError(
        `تم تجاوز حد الحصة المؤقتة لجميع مفاتيح الذكاء الاصطناعي المتاحة (${total}). يُرجى الانتظار دقيقة ثم إعادة المحاولة.`,
        'QUOTA_EXCEEDED',
      );
    }

    throw lastError;
  }
}

const defaultKeyFailoverManager = new GeminiKeyFailoverManager();

async function runWithGeminiFailover<T>(
  operation: (ai: GoogleGenAI) => Promise<T>,
): Promise<T> {
  return defaultKeyFailoverManager.execute((apiKey) => operation(createAiClient(apiKey)));
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
  if (
    raw.includes('NOT_FOUND') ||
    raw.includes('404') ||
    raw.toLowerCase().includes('model not found') ||
    raw.toLowerCase().includes('is not found')
  ) {
    return new OcrExtractionError(
      `نموذج القراءة الذكية المحدد (${OCR_MODEL}) غير متاح أو غير موجود. يُرجى مراجعة متغير البيئة GEMINI_OCR_MODEL.`,
      'MODEL_NOT_FOUND',
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
    raw.includes('ECONNRESET') ||
    raw.toLowerCase().includes('fetch failed') ||
    raw.toLowerCase().includes('timed out') ||
    raw.toLowerCase().includes('timeout') ||
    raw.toLowerCase().includes('aborted') ||
    raw.toLowerCase().includes('network')
  ) {
    return new OcrExtractionError(
      'فشل الاتصال بخدمة القراءة الذكية عبر الشبكة أو انتهت مهلة الاستجابة. يُرجى إعادة المحاولة.',
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
    return { base64: data || '', detectedMime: mimeMatch?.[1]?.toLowerCase() };
  }
  return { base64: base64OrDataUrl };
}

export function validateOcrImageInput(
  imageBase64: unknown,
  mimeType: unknown,
): { base64: string; effectiveMime: string; decodedBytes: number } {
  if (typeof imageBase64 !== 'string' || !imageBase64.trim()) {
    throw new OcrExtractionError('بيانات الصورة المرسلة مفقودة أو غير صالحة.', 'UNSUPPORTED_IMAGE');
  }

  const { base64: rawBase64, detectedMime } = stripDataUrlPrefix(imageBase64.trim());
  const base64 = rawBase64.replace(/\s+/g, '');
  if (!base64 || base64.length < 20) {
    throw new OcrExtractionError('بيانات الصورة المرسلة غير مكتملة أو تالفة.', 'UNSUPPORTED_IMAGE');
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new OcrExtractionError('ترميز الصورة (Base64) غير صالح.', 'UNSUPPORTED_IMAGE');
  }

  const providedMime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  const effectiveMime = detectedMime || providedMime;
  if (!ALLOWED_OCR_MIME_TYPES.has(effectiveMime)) {
    throw new OcrExtractionError(
      `صيغة الصورة (${effectiveMime || 'غير محددة'}) غير مدعومة. يُسمح فقط بصور JPEG أو PNG أو WEBP.`,
      'UNSUPPORTED_IMAGE',
    );
  }
  if (providedMime && detectedMime && providedMime !== detectedMime) {
    throw new OcrExtractionError(
      'عدم تطابق بين نوع الصورة المعلن ونوع البيانات الفعلي. يُرجى رفع صورة صالحة.',
      'UNSUPPORTED_IMAGE',
    );
  }

  const decodedBuffer = Buffer.from(base64, 'base64');
  if (decodedBuffer.byteLength === 0) {
    throw new OcrExtractionError('بيانات الصورة فارغة بعد فك الترميز.', 'UNSUPPORTED_IMAGE');
  }
  if (decodedBuffer.byteLength > MAX_OCR_IMAGE_BYTES) {
    const sizeMb = (decodedBuffer.byteLength / (1024 * 1024)).toFixed(1);
    throw new OcrExtractionError(
      `حجم الصورة (${sizeMb} ميجابايت) يتجاوز الحد الأقصى المسموح (5 ميجابايت بعد فك الترميز).`,
      'IMAGE_TOO_LARGE',
    );
  }

  return { base64, effectiveMime, decodedBytes: decodedBuffer.byteLength };
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
  const { base64, effectiveMime } = validateOcrImageInput(params.imageBase64, params.mimeType);

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
    const response: GenerateContentResponse = await runWithGeminiFailover((ai) =>
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
          systemInstruction: SHEET_OCR_SYSTEM_INSTRUCTION,
          ...buildOcrThinkingConfig(OCR_MODEL),
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
  const { base64, effectiveMime } = validateOcrImageInput(params.imageBase64, params.mimeType);

  const prompt = [
    `اقرأ صورة كشف المخزون الفردي للجمعية الزراعية: "${params.associationName}" لصنف السماد: "${params.fertilizerNameAr}".`,
    `آخر رصيد مسجل بالنظام للمقارنة هو: ${params.lastRecordedBalance} شيكارة.`,
    `استخرج بداية اليوم، نهاية اليوم، والتسوية بدقة دون تخمين (أرجِع null لأي رقم غير واضح، وحوّل الأرقام العربية ٠-٩ إلى إنجليزية). لا يوجد عمود وارد.`,
  ].join('\n');

  let rawResponseText = '';
  try {
    const response = await runWithGeminiFailover((ai) =>
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
          systemInstruction: SHEET_OCR_SYSTEM_INSTRUCTION,
          ...buildOcrThinkingConfig(OCR_MODEL),
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
  const { base64, effectiveMime } = validateOcrImageInput(params.imageBase64, params.mimeType);

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
    `حدد نوع السماد من القيم: urea (يوريا) أو nitrate (نترات) أو sulfate (سلفات). إذا لم يكن نوع السماد واضحًا أو غير مذكور فأرجِع نصًا فارغًا دون تخمين.`,
    `أرجِع التاريخ بصيغة YYYY-MM-DD إن كان مكتوبًا بوضوح فقط (وإلا أرجِع نصًا فارغًا دون افتراض تاريخ اليوم)، والوقت بصيغة HH:MM، وعدد الشكاير والوزن بالطن.`,
  ].join('\n');

  try {
    const response = await runWithGeminiFailover((ai) =>
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
          systemInstruction: MANIFEST_OCR_SYSTEM_INSTRUCTION,
          ...buildOcrThinkingConfig(OCR_MODEL),
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
    let fertilizerCode: 'urea' | 'nitrate' | 'sulfate' | null = null;
    if (rawFert.includes('urea') || rawFert.includes('يوريا')) fertilizerCode = 'urea';
    else if (rawFert.includes('nitrate') || rawFert.includes('نترات')) fertilizerCode = 'nitrate';
    else if (rawFert.includes('sulfate') || rawFert.includes('سلفات')) fertilizerCode = 'sulfate';

    const rawDate = sanitizeExtractedText(parsed.arrivalDate || '');
    const arrivalDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '';

    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.map((w) => sanitizeExtractedText(w)).filter(Boolean)
      : [];

    if (!fertilizerCode) {
      warnings.push('لم يتم التعرف على نوع السماد في البوليصة؛ يجب تحديد نوع السماد يدويًا قبل الاعتماد.');
    }
    if (!arrivalDate) {
      warnings.push('تاريخ الوصول غير واضح أو مفقود في البوليصة؛ يجب إدخال التاريخ يدويًا قبل الاعتماد.');
    }

    const bags = sanitizeNullableNumber(parsed.manifestBags);
    const tons = sanitizeNullableNumber(parsed.weightTons);
    if (bags === null && tons !== null) {
      warnings.push('عدد الشكاير غير مكتوب صراحة؛ يمكنك استخدام زر تحويل الطن إلى شكاير بعد تحديد نوع السماد.');
    }

    return {
      manifestNumber: sanitizeExtractedText(parsed.manifestNumber || ''),
      arrivalDate,
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
