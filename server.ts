import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch as undiciFetch } from 'undici';
import {
  requireActiveUser,
  requireAuth,
  type AuthenticatedRequest,
} from './src/middleware/auth.ts';
import {
  encodeFirestoreFields,
  FIRESTORE_DOC_PREFIX,
  FirestoreRestError,
  fsRestCommitWrites,
  fsRestGetDocument,
  fsRestQueryAssociationDisbursements,
  fsRestQueryDisbursements,
} from './src/server/firestoreRest.ts';
import {
  analyzeSingleSheetOcr,
  extractManifestOcr,
  extractSheetNumbersOcr,
  OcrExtractionError,
} from './src/server/geminiOcr.ts';
import { createSsrfSafeDispatcher, validateCentralApiUrl } from './src/server/ssrfGuard.ts';
import { isSmtpConfigured, sendFixedStockAlertEmail } from './src/server/emailAlert.ts';
import { SEED_ASSOCIATIONS, SEED_GOVERNORATES } from './src/data/seedData.ts';
import type {
  AgriculturalAssociation,
  Governorate,
  IntegrationLogEntry,
  SheetSectionType,
} from './src/types/domain.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOC_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function makeServerDocId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function extractReportDateFromReportId(reportId: string): string | null {
  const match = reportId.match(/(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : null;
}

function ocrErrorHttpStatus(code: string): number {
  if (code === 'QUOTA_EXCEEDED') return 429;
  if (code === 'IMAGE_TOO_LARGE') return 413;
  if (code === 'NETWORK_ERROR' || code === 'MISSING_KEY') return 503;
  return 400;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const distDir = path.resolve(__dirname, 'dist');
  const hasDistBuild = fs.existsSync(path.join(distDir, 'index.html'));
  const wantsProd = process.env.NODE_ENV === 'production' || Boolean(process.env.K_SERVICE);
  const isProd = wantsProd && hasDistBuild;

  if (wantsProd && !hasDistBuild) {
    console.warn(
      '[DST Server] dist/index.html not found (e.g. cold-start before build); falling back to Vite dev middleware.',
    );
  }

  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'dst-fertilizer-system',
      mode: isProd ? 'production' : 'development',
    });
  });

  // In-memory rate limiters keyed by authenticated Firebase UID (not shared across multiple instances).
  const aiBurstLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthenticatedRequest).user?.uid || 'anonymous',
    handler: (_req, res) => {
      res.status(429).json({
        error:
          'تم تجاوز الحد المؤقت لطلبات القراءة الذكية (20 طلبًا كل 10 دقائق). يُرجى الانتظار قليلًا ثم المحاولة مجددًا.',
      });
    },
  });

  const aiDailyLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    limit: 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthenticatedRequest).user?.uid || 'anonymous',
    handler: (_req, res) => {
      res.status(429).json({
        error: 'تم استنفاد الحد اليومي المسموح لطلبات القراءة الذكية (200 طلب يوميًا لهذا الحساب).',
      });
    },
  });

  const requireAiRole = requireActiveUser(['field_staff', 'supervisor', 'admin']);
  const requireCentralSyncRole = requireActiveUser(['chief', 'admin']);
  const requireAdminOnly = requireActiveUser(['admin']);

  const emailAlertLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req as AuthenticatedRequest).user?.uid || 'anonymous',
    handler: (_req, res) => {
      res.status(429).json({
        error:
          'تم تجاوز الحد المؤقت لإرسال رسائل تنبيه المخزون عبر SMTP (10 رسائل كل 10 دقائق).',
      });
    },
  });

  // Server-Side Gemini Vision OCR Endpoints
  app.post(
    '/api/ai/extract-sheet-numbers',
    requireAuth,
    requireAiRole,
    aiBurstLimiter,
    aiDailyLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { imageBase64, mimeType, sectionType, governorateId, associations } = req.body as {
          imageBase64: string;
          mimeType: string;
          sectionType: SheetSectionType;
          governorateId?: string;
          associations?: AgriculturalAssociation[];
        };
        const sourceAssocs =
          Array.isArray(associations) && associations.length > 0
            ? associations
            : SEED_ASSOCIATIONS;
        const scopedAssocs = governorateId
          ? sourceAssocs.filter((a) => a.governorateId === governorateId)
          : sourceAssocs;

        const result = await extractSheetNumbersOcr({
          imageBase64,
          mimeType,
          sectionType: sectionType || 'full_sheet',
          associations: scopedAssocs.length ? scopedAssocs : sourceAssocs,
        });
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof OcrExtractionError) {
          res.status(ocrErrorHttpStatus(error.code)).json({
            error: error.message,
            code: error.code,
            rawResponseText: error.rawResponseText || '',
          });
          return;
        }
        res.status(500).json({
          error: error instanceof Error ? error.message : 'فشلت قراءة أرقام الكشف بالذكاء الاصطناعي.',
        });
      }
    },
  );

  app.post(
    '/api/ai/analyze-sheet',
    requireAuth,
    requireAiRole,
    aiBurstLimiter,
    aiDailyLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const {
          imageBase64,
          mimeType,
          associationName,
          fertilizerNameAr,
          lastRecordedBalance,
        } = req.body;
        const result = await analyzeSingleSheetOcr({
          imageBase64,
          mimeType,
          associationName,
          fertilizerNameAr,
          lastRecordedBalance: Number(lastRecordedBalance) || 0,
        });
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof OcrExtractionError) {
          res.status(ocrErrorHttpStatus(error.code)).json({
            error: error.message,
            code: error.code,
            rawResponseText: error.rawResponseText || '',
          });
          return;
        }
        res.status(500).json({
          error: error instanceof Error ? error.message : 'فشل تحليل صورة الكشف الفردي.',
        });
      }
    },
  );

  app.post(
    '/api/ai/extract-manifest',
    requireAuth,
    requireAiRole,
    aiBurstLimiter,
    aiDailyLimiter,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { imageBase64, mimeType, governorates, associations } = req.body as {
          imageBase64: string;
          mimeType: string;
          governorates?: Governorate[];
          associations?: AgriculturalAssociation[];
        };
        const result = await extractManifestOcr({
          imageBase64,
          mimeType,
          governorates:
            Array.isArray(governorates) && governorates.length > 0
              ? governorates
              : SEED_GOVERNORATES,
          associations:
            Array.isArray(associations) && associations.length > 0
              ? associations
              : SEED_ASSOCIATIONS,
        });
        res.json(result);
      } catch (error: unknown) {
        if (error instanceof OcrExtractionError) {
          res.status(ocrErrorHttpStatus(error.code)).json({
            error: error.message,
            code: error.code,
            rawResponseText: error.rawResponseText || '',
          });
          return;
        }
        res.status(500).json({
          error: error instanceof Error ? error.message : 'فشلت قراءة البوليصة بالذكاء الاصطناعي.',
        });
      }
    },
  );

  // Real Central System HTTP Sync Endpoint (chief/admin only, DNS-rebinding-safe SSRF guard, Firestore REST via caller token)
  app.post(
    '/api/central/sync',
    requireAuth,
    requireCentralSyncRole,
    async (req: AuthenticatedRequest, res) => {
      const idToken = req.idToken!;
      const appCheckToken = req.appCheckToken;
      const actor = req.userProfile!;
      const rawReportId = typeof req.body?.reportId === 'string' ? req.body.reportId.trim() : '';

      if (!rawReportId || !DOC_ID_RE.test(rawReportId)) {
        res.status(400).json({ error: 'معرّف التقرير (reportId) غير صالح أو مفقود.' });
        return;
      }

      try {
        const [reportDoc, settingsDoc] = await Promise.all([
          fsRestGetDocument(`daily_reports/${encodeURIComponent(rawReportId)}`, idToken, appCheckToken),
          fsRestGetDocument('system_settings/global', idToken, appCheckToken),
        ]);

        if (!reportDoc) {
          res.status(404).json({ error: 'التقرير غير موجود أو لا تملك صلاحية الوصول إليه.' });
          return;
        }

        if (String(reportDoc.status || '') !== 'approved') {
          res.status(400).json({
            error: 'يجب اعتماد التقرير نهائيًا قبل إرساله إلى المنظومة المركزية.',
          });
          return;
        }

        const centralApiUrl = String(settingsDoc?.centralApiUrl || '').trim();
        if (!centralApiUrl) {
          res.status(400).json({
            error: 'رابط واجهة التكامل المركزية غير مُعدّ في إعدادات المنظومة.',
          });
          return;
        }

        const urlCheck = await validateCentralApiUrl(centralApiUrl);
        if (!urlCheck.ok) {
          res.status(400).json({ error: urlCheck.reason });
          return;
        }

        const governorateId = String(reportDoc.governorateId || '');
        const reportDate = String(reportDoc.reportDate || '');
        const rows = await fsRestQueryDisbursements(
          governorateId,
          rawReportId,
          idToken,
          appCheckToken,
        );

        const totalDisbursed = rows.reduce((sum, r) => {
          const val = typeof r.actualDisbursed === 'number' ? r.actualDisbursed : 0;
          return sum + val;
        }, 0);

        const payloadSummary = `${rows.length} بند · إجمالي المنصرف ${totalDisbursed} شيكارة`;
        const dispatchedAt = new Date().toISOString();

        const outgoingPayload = {
          reportId: rawReportId,
          governorateId,
          reportDate,
          status: 'approved',
          rowsCount: rows.length,
          totalDisbursed,
          dispatchedByUid: actor.uid,
          dispatchedAt,
          disbursements: rows.map((r) => ({
            associationId: String(r.associationId || ''),
            fertilizerCode: String(r.fertilizerCode || ''),
            openingBalance: r.openingBalance ?? null,
            closingBalance: r.closingBalance ?? null,
            settlementQty: r.settlementQty ?? null,
            actualDisbursed: r.actualDisbursed ?? null,
            variance: r.variance ?? null,
            varianceReason: String(r.varianceReason || ''),
          })),
        };

        // Optional server-only Bearer token (never logged or returned to clients)
        const centralApiToken = (process.env.CENTRAL_API_TOKEN || '').trim();
        const outgoingHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };
        if (centralApiToken) {
          outgoingHeaders.Authorization = `Bearer ${centralApiToken}`;
        }

        let httpStatus = 0;
        let syncSuccess = false;
        let responseMessage = '';
        const ssrfDispatcher = createSsrfSafeDispatcher();

        try {
          const remoteRes = await undiciFetch(urlCheck.url.toString(), {
            method: 'POST',
            headers: outgoingHeaders,
            body: JSON.stringify(outgoingPayload),
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
            dispatcher: ssrfDispatcher,
          });
          httpStatus = remoteRes.status;
          syncSuccess = remoteRes.ok; // true strictly for real HTTP 2xx
          const bodySnippet = (await remoteRes.text().catch(() => ''))
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 260);
          responseMessage = syncSuccess
            ? `استجابة الخادم المركزي (${httpStatus})${bodySnippet ? `: ${bodySnippet}` : ''}`
            : `رفض الخادم المركزي الطلب (${httpStatus})${bodySnippet ? `: ${bodySnippet}` : ''}`;
        } catch (fetchErr: unknown) {
          httpStatus = 0;
          syncSuccess = false;
          const causeMessage =
            fetchErr instanceof Error && fetchErr.cause instanceof Error
              ? fetchErr.cause.message
              : fetchErr instanceof Error
                ? fetchErr.message
                : '';
          const reason =
            fetchErr instanceof Error && fetchErr.name === 'TimeoutError'
              ? 'انتهت مهلة الاتصال بالخادم المركزي (10 ثوانٍ).'
              : causeMessage.includes('مرفوض أمنيًا')
                ? causeMessage
                : fetchErr instanceof Error
                  ? `فشل الاتصال بالخادم المركزي: ${fetchErr.message}`
                  : 'تعذر الوصول إلى الخادم المركزي.';
          responseMessage = reason.slice(0, 380);
        } finally {
          await ssrfDispatcher.close().catch(() => {});
        }

        const nextSyncStatus: 'synced' | 'failed' = syncSuccess ? 'synced' : 'failed';
        const logId = makeServerDocId('int');
        const auditId = makeServerDocId('aud');
        const nowIso = new Date().toISOString();

        const logEntry: IntegrationLogEntry = {
          id: logId,
          reportId: rawReportId,
          governorateId,
          reportDate,
          endpointUrl: urlCheck.url.toString().slice(0, 300),
          status: syncSuccess ? 'success' : 'failed',
          httpStatus,
          payloadSummary: payloadSummary.slice(0, 400),
          responseMessage: responseMessage.slice(0, 400),
          dispatchedByUid: actor.uid,
          createdAt: nowIso,
        };

        await fsRestCommitWrites(
          [
            {
              update: {
                name: `${FIRESTORE_DOC_PREFIX}/daily_reports/${rawReportId}`,
                fields: encodeFirestoreFields({
                  centralSyncStatus: nextSyncStatus,
                }),
              },
              updateMask: {
                fieldPaths: ['centralSyncStatus'],
              },
              updateTransforms: [
                {
                  fieldPath: 'updatedAt',
                  setToServerValue: 'REQUEST_TIME',
                },
              ],
              currentDocument: { exists: true },
            },
            {
              update: {
                name: `${FIRESTORE_DOC_PREFIX}/integration_logs/${logId}`,
                fields: encodeFirestoreFields({
                  reportId: logEntry.reportId,
                  governorateId: logEntry.governorateId,
                  reportDate: logEntry.reportDate,
                  endpointUrl: logEntry.endpointUrl,
                  status: logEntry.status,
                  httpStatus: logEntry.httpStatus,
                  payloadSummary: logEntry.payloadSummary,
                  responseMessage: logEntry.responseMessage,
                  dispatchedByUid: logEntry.dispatchedByUid,
                }),
              },
              updateTransforms: [
                {
                  fieldPath: 'createdAt',
                  setToServerValue: 'REQUEST_TIME',
                },
              ],
              currentDocument: { exists: false },
            },
            {
              update: {
                name: `${FIRESTORE_DOC_PREFIX}/audit_logs/${auditId}`,
                fields: encodeFirestoreFields({
                  actorUid: actor.uid,
                  actorEmail: actor.email,
                  actorName: actor.displayName,
                  actorRole: actor.role,
                  action: syncSuccess ? 'SYNC_CENTRAL_SYSTEM' : 'SYNC_CENTRAL_SYSTEM_FAILED',
                  entityType: 'integration_logs',
                  entityId: logId,
                  details: `إرسال التقرير ${rawReportId} إلى ${logEntry.endpointUrl} — النتيجة: ${logEntry.status} (HTTP ${httpStatus})`.slice(
                    0,
                    980,
                  ),
                }),
              },
              updateTransforms: [
                {
                  fieldPath: 'createdAt',
                  setToServerValue: 'REQUEST_TIME',
                },
              ],
              currentDocument: { exists: false },
            },
          ],
          idToken,
          appCheckToken,
        );

        if (!syncSuccess) {
          res.status(502).json({
            error: responseMessage,
            centralSyncStatus: 'failed',
            log: logEntry,
          });
          return;
        }

        res.json({
          ok: true,
          centralSyncStatus: 'synced',
          log: logEntry,
        });
      } catch (error: unknown) {
        if (error instanceof FirestoreRestError) {
          const status = error.status === 403 ? 403 : error.status === 404 ? 404 : 500;
          res.status(status).json({
            error:
              status === 403
                ? 'رفضت قواعد أمان Firestore العملية. تحقق من الصلاحيات.'
                : 'تعذر قراءة أو توثيق بيانات التقرير في Firestore.',
          });
          return;
        }
        console.error('Central sync error:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : 'حدث خطأ غير متوقع أثناء الإرسال المركزي.',
        });
      }
    },
  );

  // Optional Admin-Only SMTP Stock Alert Dispatch (auto-disabled when SMTP_* env vars are absent)
  // Recipient email and fixed message content are derived strictly from Firestore records (never from request body).
  app.get('/api/alerts/email-status', requireAuth, requireAdminOnly, (_req, res) => {
    res.json({
      configured: isSmtpConfigured(),
    });
  });

  app.post(
    '/api/alerts/send-email',
    requireAuth,
    requireAdminOnly,
    emailAlertLimiter,
    async (req: AuthenticatedRequest, res) => {
      if (!isSmtpConfigured()) {
        res.status(503).json({
          ok: false,
          status: 'unconfigured',
          message: 'ميزة إرسال البريد عبر SMTP معطّلة تلقائيًا لعدم ضبط إعدادات SMTP على الخادم.',
        });
        return;
      }

      const idToken = req.idToken!;
      const appCheckToken = req.appCheckToken;
      const rawRuleId = typeof req.body?.ruleId === 'string' ? req.body.ruleId.trim() : '';

      if (!rawRuleId || !DOC_ID_RE.test(rawRuleId)) {
        res.status(400).json({
          ok: false,
          status: 'failed',
          message: 'معرّف قاعدة التنبيه (ruleId) غير صالح أو مفقود.',
        });
        return;
      }

      try {
        const ruleDoc = await fsRestGetDocument(
          `stock_alert_rules/${encodeURIComponent(rawRuleId)}`,
          idToken,
          appCheckToken,
        );
        if (!ruleDoc) {
          res.status(404).json({
            ok: false,
            status: 'failed',
            message: 'قاعدة التنبيه غير موجودة في قاعدة البيانات.',
          });
          return;
        }

        if (ruleDoc.isEnabled === false || ruleDoc.notifyEmail !== true) {
          res.status(400).json({
            ok: false,
            status: 'failed',
            message: 'إرسال البريد الإلكتروني غير مفعّل في قاعدة التنبيه المحددة.',
          });
          return;
        }

        const recipientEmail = String(ruleDoc.recipientEmail || '').trim();
        const governorateId = String(ruleDoc.governorateId || '').trim();
        const associationId = String(ruleDoc.associationId || '').trim();
        const rawFert = String(ruleDoc.fertilizerCode || 'urea');
        const fertilizerCode: 'urea' | 'nitrate' | 'sulfate' =
          rawFert === 'nitrate' || rawFert === 'sulfate' ? rawFert : 'urea';
        const minThreshold = Number(ruleDoc.minThreshold ?? 0);

        const [assocDoc, govDoc, settingsDoc, matchingRows] = await Promise.all([
          DOC_ID_RE.test(associationId)
            ? fsRestGetDocument(
                `agricultural_associations/${encodeURIComponent(associationId)}`,
                idToken,
                appCheckToken,
              )
            : Promise.resolve(null),
          DOC_ID_RE.test(governorateId)
            ? fsRestGetDocument(
                `governorates/${encodeURIComponent(governorateId)}`,
                idToken,
                appCheckToken,
              )
            : Promise.resolve(null),
          fsRestGetDocument('system_settings/global', idToken, appCheckToken),
          DOC_ID_RE.test(governorateId) && DOC_ID_RE.test(associationId)
            ? fsRestQueryAssociationDisbursements(
                governorateId,
                associationId,
                fertilizerCode,
                idToken,
                appCheckToken,
              )
            : Promise.resolve([]),
        ]);

        // Determine latest closing balance strictly from Firestore disbursement records
        let latestBalance: number | null = null;
        let latestDate: string | null = null;
        for (const row of matchingRows) {
          const closing =
            typeof row.closingBalance === 'number' && Number.isFinite(row.closingBalance)
              ? row.closingBalance
              : null;
          if (closing === null) continue;
          const rowDate = extractReportDateFromReportId(String(row.reportId || '')) || '';
          if (latestDate === null || rowDate >= latestDate) {
            latestDate = rowDate || null;
            latestBalance = closing;
          }
        }

        const result = await sendFixedStockAlertEmail({
          to: recipientEmail,
          payload: {
            organizationNameAr: String(
              settingsDoc?.organizationNameAr || 'منظومة DST لإدارة ومراقبة صرف الأسمدة الزراعية',
            ),
            governorateName: String(govDoc?.nameAr || governorateId),
            associationName: String(assocDoc?.nameAr || associationId),
            fertilizerCode,
            currentBalance: latestBalance,
            minThreshold,
            lastRecordedDate: latestDate,
          },
        });

        if (result.status === 'sent') {
          res.json(result);
          return;
        }
        if (result.status === 'unconfigured') {
          res.status(503).json(result);
          return;
        }
        res.status(502).json(result);
      } catch (error: unknown) {
        if (error instanceof FirestoreRestError) {
          const status = error.status === 403 ? 403 : error.status === 404 ? 404 : 500;
          res.status(status).json({
            ok: false,
            status: 'failed',
            message: 'تعذر قراءة بيانات قاعدة التنبيه من Firestore.',
          });
          return;
        }
        console.error('Stock alert SMTP dispatch error:', error);
        res.status(500).json({
          ok: false,
          status: 'failed',
          message: 'حدث خطأ غير متوقع أثناء محاولة إرسال بريد التنبيه.',
        });
      }
    },
  );

  if (!isProd) {
    // If a browser previously cached a production /sw.js, cleanly unregister it during Vite fallback
    // so stale precached bundles cannot hijack the live server.
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.send(`
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    try {
      await self.registration.unregister();
    } catch {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => {
        if ('navigate' in client) client.navigate(client.url);
      });
    } catch {}
  })());
});
`);
    });

    // Handle /@vite/client cleanly when HMR is disabled to prevent browser WebSocket errors
    if (process.env.DISABLE_HMR === 'true') {
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript').send(`
export function createHotContext() {
  return {
    accept() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function updateStyle(id, content) {
  let style = document.querySelector('style[data-vite-dev-id="' + id + '"]');
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  const style = document.querySelector('style[data-vite-dev-id="' + id + '"]');
  if (style) style.remove();
}
export function injectQuery(url) {
  return url;
}
`);
      });
    }

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {

    // Clean up legacy Vite dev service worker registrations (/dev-sw.js) in browsers
    // that previously visited this origin in development mode, preventing blank screens.
    app.get('/dev-sw.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.send(`
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    try {
      await self.registration.unregister();
    } catch {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => {
        if ('navigate' in client) client.navigate(client.url);
      });
    } catch {}
  })());
});
`);
    });

    app.use(
      express.static(distDir, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'manifest.webmanifest'
          ) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );

    const STATIC_EXT_RE = /\.[a-zA-Z0-9]{1,10}$/;

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      // Never return index.html (text/html) for missing JS/CSS/font/image/source assets
      if (
        req.path.startsWith('/assets/') ||
        req.path.startsWith('/src/') ||
        req.path.startsWith('/@vite/') ||
        req.path.startsWith('/node_modules/') ||
        STATIC_EXT_RE.test(req.path)
      ) {
        res.status(404).type('text/plain').send('Asset not found');
        return;
      }
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Not found');
      }
    });
  }

  // Clean JSON error handler for body-parser limits (413) and malformed JSON (400) on /api/*
  app.use(
    (
      err: Error & { status?: number; statusCode?: number; type?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!req.path.startsWith('/api/')) {
        next(err);
        return;
      }
      if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
        res.status(413).json({
          error:
            'حجم الصورة المرسلة يتجاوز الحد الأقصى المسموح على الخادم (10 ميجابايت). يُرجى تقليل حجم الصورة والمحاولة مجددًا.',
          code: 'IMAGE_TOO_LARGE',
        });
        return;
      }
      if (err.type === 'entity.parse.failed' || err.status === 400 || err.statusCode === 400) {
        res.status(400).json({
          error: 'صيغة بيانات الطلب المرسلة غير صالحة.',
        });
        return;
      }
      console.error('Unhandled /api error:', err);
      res.status(500).json({
        error: 'حدث خطأ غير متوقع أثناء معالجة الطلب على الخادم.',
      });
    },
  );

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `DST Fertilizer Management Server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`,
    );
  });

  // Cloud Run / Google Frontend load balancer uses a 60s idle keep-alive timeout.
  // Keeping Node's keepAliveTimeout > 60s prevents random ERR_CONNECTION_RESET / "Failed to fetch" on POST requests.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  httpServer.requestTimeout = 120_000;
}

void startServer();
