export class OcrClientError extends Error {
  code?: string;
  rawResponseText?: string;

  constructor(message: string, code?: string, rawResponseText?: string) {
    super(message);
    this.name = 'OcrClientError';
    this.code = code;
    this.rawResponseText = rawResponseText;
  }
}

export interface ResilientFetchOptions {
  fetchImpl?: typeof fetch;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  getAppCheckToken?: () => Promise<string | null>;
  isOnline?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxNetworkRetries?: number;
  healthCheckUrl?: string;
}

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

export function isAbortOrTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name || '';
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return name === 'AbortError' || name === 'TimeoutError' || msg.includes('aborted') || msg.includes('timed out');
}

export function isNetworkFetchError(error: unknown): boolean {
  if (error instanceof OcrClientError) return false;
  if (isAbortOrTimeoutError(error)) return false;
  if (error instanceof TypeError) return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('network request failed') ||
    msg.includes('err_connection') ||
    msg.includes('err_network')
  );
}

export function formatHttpErrorAr(status: number, serverMessage?: string): string {
  if (serverMessage && serverMessage.trim()) {
    return serverMessage.trim();
  }
  if (status === 401) {
    return 'انتهت جلسة تسجيل الدخول. يُرجى إعادة تسجيل الدخول بحساب Google ثم المحاولة مجددًا.';
  }
  if (status === 403) {
    return 'لا تملك صلاحية تنفيذ هذا الطلب على الخادم.';
  }
  if (status === 413) {
    return 'حجم الصورة المرسلة كبير جدًا. يُرجى اختيار صورة أصغر أو تصوير الصفحة بوضوح متوسط ثم إعادة المحاولة.';
  }
  if (status === 429) {
    return 'تم تجاوز الحد المؤقت للطلبات. يُرجى الانتظار دقيقة ثم إعادة المحاولة.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'الخادم مشغول مؤقتًا أو انتهت مهلة معالجة الصورة. يُرجى المحاولة مجددًا بعد لحظات.';
  }
  return `حدث خطأ غير متوقع في الخادم (رمز ${status}). يُرجى المحاولة مجددًا.`;
}

async function probeServerReachability(
  fetchImpl: typeof fetch,
  healthCheckUrl: string,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetchImpl(healthCheckUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
      redirect: 'manual',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function resilientApiFetch<T>(
  url: string,
  requestInit: RequestInit | undefined,
  deps: ResilientFetchOptions,
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const isOnline =
    deps.isOnline ??
    (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const isAiRoute = url.startsWith('/api/ai/');
  const timeoutMs = deps.timeoutMs ?? (isAiRoute ? 95_000 : 30_000);
  const maxNetworkRetries = deps.maxNetworkRetries ?? 1;
  const healthCheckUrl = deps.healthCheckUrl ?? '/api/health';

  if (!isOnline()) {
    throw new Error(
      'الجهاز غير متصل بالإنترنت حاليًا. خدمة القراءة الذكية (OCR) والطلبات السحابية تتطلب اتصالًا بالإنترنت.',
    );
  }

  const acquireToken = async (forceRefresh: boolean): Promise<string | null> => {
    for (let tAttempt = 0; tAttempt <= 1; tAttempt++) {
      try {
        return await deps.getIdToken(forceRefresh);
      } catch (err: unknown) {
        if (tAttempt === 0 && isOnline()) {
          await sleep(600);
          continue;
        }
        void err;
        throw new Error(
          'تعذر تجديد جلسة تسجيل الدخول عبر الشبكة. تحقق من الاتصال أو أعد تحديث الصفحة ثم حاول مجددًا.',
        );
      }
    }
    return null;
  };

  let token = await acquireToken(false);
  if (!token) {
    throw new Error('يجب تسجيل الدخول بحساب Google المعتمد لإجراء هذا الطلب مع الخادم.');
  }

  const appCheckToken = deps.getAppCheckToken ? await deps.getAppCheckToken().catch(() => null) : null;
  let refreshedTokenOnce = false;
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt <= maxNetworkRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchImpl(url, {
        ...requestInit,
        cache: 'no-store',
        credentials: 'include',
        signal: requestInit?.signal ?? controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Firebase-Auth': token,
          ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
          ...(requestInit?.headers || {}),
        },
      });

      // If the Firebase ID token expired right before upload, force-refresh once and retry seamlessly
      if (res.status === 401 && !refreshedTokenOnce) {
        refreshedTokenOnce = true;
        const freshToken = await acquireToken(true).catch(() => null);
        if (freshToken && freshToken !== token) {
          token = freshToken;
          continue;
        }
      }

      // Retry transient gateway errors (502/503/504) once before surfacing an error
      if (TRANSIENT_HTTP_STATUSES.has(res.status) && attempt < maxNetworkRetries) {
        await sleep(800 * (attempt + 1));
        continue;
      }

      const contentType = (res.headers?.get('content-type') || '').toLowerCase();
      const json = contentType.includes('application/json')
        ? ((await res.json().catch(() => ({}))) as T & {
            error?: string;
            code?: string;
            rawResponseText?: string;
          })
        : ((await res.json().catch(() => ({}))) as T & {
            error?: string;
            code?: string;
            rawResponseText?: string;
          });

      if (!res.ok) {
        const message = formatHttpErrorAr(res.status, json.error);
        if (json.rawResponseText !== undefined || json.code) {
          throw new OcrClientError(message, json.code, json.rawResponseText);
        }
        throw new Error(message);
      }

      return json;
    } catch (error: unknown) {
      if (error instanceof OcrClientError) {
        throw error;
      }

      if (isAbortOrTimeoutError(error)) {
        throw new Error(
          'انتهت مهلة انتظار استجابة القراءة الذكية من الخادم. يُرجى المحاولة مجددًا أو تقسيم الكشف إلى صفحات أصغر.',
        );
      }

      if (isNetworkFetchError(error)) {
        lastNetworkError = error;
        if (attempt < maxNetworkRetries && isOnline()) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        break;
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // Persistent network failure: never show raw English "Failed to fetch"
  if (!isOnline()) {
    throw new Error('انقطع الاتصال بالإنترنت أثناء إرسال الطلب. تحقق من الشبكة وأعد المحاولة.');
  }

  const serverReachable = await probeServerReachability(fetchImpl, healthCheckUrl);
  if (serverReachable) {
    throw new Error(
      'انقطع الاتصال أثناء رفع الصورة أو معالجتها بالذكاء الاصطناعي. يُرجى المحاولة مجددًا أو اختيار صورة بحجم أصغر.',
    );
  }

  void lastNetworkError;
  throw new Error(
    'تعذر الاتصال بخادم المنظومة حاليًا. تحقق من اتصال الإنترنت أو أعد تحديث الصفحة لتجديد الجلسة ثم أعد المحاولة.',
  );
}
