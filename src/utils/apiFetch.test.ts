import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatHttpErrorAr,
  isNetworkFetchError,
  OcrClientError,
  resilientApiFetch,
} from './apiFetch.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('resilientApiFetch retries once on transient TypeError: Failed to fetch and succeeds seamlessly', async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async () => {
    calls++;
    if (calls === 1) {
      throw new TypeError('Failed to fetch');
    }
    return jsonResponse({ rows: [{ rowIndex: 1 }], summaryNote: 'ok', rawResponseText: '{}' }, 200);
  };

  const result = await resilientApiFetch<{ rows: Array<{ rowIndex: number }> }>(
    '/api/ai/extract-sheet-numbers',
    { method: 'POST', body: '{}' },
    {
      fetchImpl: mockFetch,
      getIdToken: async () => 'token-1',
      sleep: async () => undefined,
      isOnline: () => true,
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.rows.length, 1);
});

test('resilientApiFetch sends X-Firebase-Auth (without Authorization) and refreshes token once on 401', async () => {
  const seenFirebaseHeaders: string[] = [];
  let sawAuthorizationHeader = false;
  let refreshed = false;
  const mockFetch: typeof fetch = async (_url, init) => {
    const headers = (init?.headers as Record<string, string>) || {};
    if ('Authorization' in headers || 'authorization' in headers) {
      sawAuthorizationHeader = true;
    }
    const firebaseHeader = headers['X-Firebase-Auth'] || '';
    seenFirebaseHeaders.push(firebaseHeader);
    if (firebaseHeader === 'expired-token') {
      return jsonResponse({ error: 'expired' }, 401);
    }
    return jsonResponse({ ok: true }, 200);
  };

  const result = await resilientApiFetch<{ ok: boolean }>(
    '/api/ai/extract-manifest',
    { method: 'POST', body: '{}' },
    {
      fetchImpl: mockFetch,
      getIdToken: async (forceRefresh) => {
        if (forceRefresh) {
          refreshed = true;
          return 'fresh-token';
        }
        return 'expired-token';
      },
      sleep: async () => undefined,
      isOnline: () => true,
    },
  );

  assert.equal(refreshed, true);
  assert.equal(sawAuthorizationHeader, false);
  assert.equal(result.ok, true);
  assert.deepEqual(seenFirebaseHeaders, ['expired-token', 'fresh-token']);
});

test('resilientApiFetch retries transient getIdToken network error and never leaks Failed to fetch', async () => {
  let tokenAttempts = 0;
  const mockFetch: typeof fetch = async () => jsonResponse({ ok: true }, 200);

  const ok = await resilientApiFetch<{ ok: boolean }>(
    '/api/ai/extract-sheet-numbers',
    { method: 'POST', body: '{}' },
    {
      fetchImpl: mockFetch,
      getIdToken: async () => {
        tokenAttempts++;
        if (tokenAttempts === 1) throw new TypeError('Failed to fetch');
        return 'recovered-token';
      },
      sleep: async () => undefined,
      isOnline: () => true,
    },
  );
  assert.equal(tokenAttempts, 2);
  assert.equal(ok.ok, true);

  await assert.rejects(
    () =>
      resilientApiFetch(
        '/api/ai/extract-sheet-numbers',
        { method: 'POST', body: '{}' },
        {
          fetchImpl: mockFetch,
          getIdToken: async () => {
            throw new TypeError('Failed to fetch');
          },
          sleep: async () => undefined,
          isOnline: () => true,
        },
      ),
    (err: unknown) => err instanceof Error && !err.message.includes('Failed to fetch') && err.message.includes('تجديد جلسة'),
  );
});

test('resilientApiFetch retries once on 504 Gateway Timeout and succeeds', async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response('<html>504 Gateway Timeout</html>', {
        status: 504,
        headers: { 'Content-Type': 'text/html' },
      });
    }
    return jsonResponse({ ok: true }, 200);
  };

  const res = await resilientApiFetch<{ ok: boolean }>(
    '/api/ai/analyze-sheet',
    { method: 'POST', body: '{}' },
    {
      fetchImpl: mockFetch,
      getIdToken: async () => 'tok',
      sleep: async () => undefined,
      isOnline: () => true,
    },
  );

  assert.equal(calls, 2);
  assert.equal(res.ok, true);
});

test('resilientApiFetch never surfaces raw "Failed to fetch" and differentiates server-reachable vs unreachable', async () => {
  // Case A: /api/ai fails persistently but /api/health responds 200 -> image/upload interruption message
  const mockFetchHealthyServer: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/api/health')) {
      return jsonResponse({ ok: true }, 200);
    }
    throw new TypeError('Failed to fetch');
  };

  await assert.rejects(
    () =>
      resilientApiFetch(
        '/api/ai/extract-sheet-numbers',
        { method: 'POST', body: '{}' },
        {
          fetchImpl: mockFetchHealthyServer,
          getIdToken: async () => 'tok',
          sleep: async () => undefined,
          isOnline: () => true,
        },
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message.includes('Failed to fetch'), false);
      assert.ok(err.message.includes('انقطع الاتصال أثناء رفع الصورة'));
      return true;
    },
  );

  // Case B: both /api/ai and /api/health fail -> session/server unreachable message
  const mockFetchUnreachable: typeof fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  await assert.rejects(
    () =>
      resilientApiFetch(
        '/api/ai/extract-sheet-numbers',
        { method: 'POST', body: '{}' },
        {
          fetchImpl: mockFetchUnreachable,
          getIdToken: async () => 'tok',
          sleep: async () => undefined,
          isOnline: () => true,
        },
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message.includes('Failed to fetch'), false);
      assert.ok(err.message.includes('تعذر الاتصال بخادم المنظومة'));
      return true;
    },
  );
});

test('resilientApiFetch preserves OcrClientError code/rawResponseText and reports offline immediately', async () => {
  await assert.rejects(
    () =>
      resilientApiFetch(
        '/api/ai/extract-sheet-numbers',
        { method: 'POST', body: '{}' },
        {
          getIdToken: async () => 'tok',
          isOnline: () => false,
        },
      ),
    /غير متصل بالإنترنت/,
  );

  const mockFetchOcrErr: typeof fetch = async () =>
    jsonResponse({ error: 'تعذر التحليل', code: 'UNPARSEABLE_JSON', rawResponseText: '{bad' }, 400);

  await assert.rejects(
    () =>
      resilientApiFetch(
        '/api/ai/extract-sheet-numbers',
        { method: 'POST', body: '{}' },
        {
          fetchImpl: mockFetchOcrErr,
          getIdToken: async () => 'tok',
          isOnline: () => true,
        },
      ),
    (err: unknown) =>
      err instanceof OcrClientError &&
      err.code === 'UNPARSEABLE_JSON' &&
      err.rawResponseText === '{bad',
  );

  assert.equal(isNetworkFetchError(new TypeError('Failed to fetch')), true);
  assert.ok(formatHttpErrorAr(413).includes('حجم الصورة'));
});
