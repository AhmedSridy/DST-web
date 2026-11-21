import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  fsRestQueryDisbursements,
} from './src/server/firestoreRest.ts';
import {
  analyzeSingleSheetOcr,
  extractManifestOcr,
  extractSheetNumbersOcr,
  OcrExtractionError,
} from './src/server/geminiOcr.ts';
import { validateCentralApiUrl } from './src/server/ssrfGuard.ts';
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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'dst-fertilizer-system' });
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
          res.status(400).json({
            error: error.message,
            code: error.code,
            rawResponseText: error.rawResponseText || '',
          });
          return;
        }
        res.status(400).json({
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
          res.status(400).json({
            error: error.message,
            code: error.code,
            rawResponseText: error.rawResponseText || '',
          });
          return;
        }
        res.status(400).json({
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
          res.status(400).json({
            error: error.message,
            code: error.code,
            rawResponseText: error.rawResponseText || '',
          });
          return;
        }
        res.status(400).json({
          error: error instanceof Error ? error.message : 'فشلت قراءة البوليصة بالذكاء الاصطناعي.',
        });
      }
    },
  );

  // Real Central System HTTP Sync Endpoint (chief/admin only, SSRF-protected, Firestore REST via caller token)
  app.post(
    '/api/central/sync',
    requireAuth,
    requireCentralSyncRole,
    async (req: AuthenticatedRequest, res) => {
      const idToken = req.idToken!;
      const actor = req.userProfile!;
      const rawReportId = typeof req.body?.reportId === 'string' ? req.body.reportId.trim() : '';

      if (!rawReportId || !DOC_ID_RE.test(rawReportId)) {
        res.status(400).json({ error: 'معرّف التقرير (reportId) غير صالح أو مفقود.' });
        return;
      }

      try {
        const [reportDoc, settingsDoc] = await Promise.all([
          fsRestGetDocument(`daily_reports/${encodeURIComponent(rawReportId)}`, idToken),
          fsRestGetDocument('system_settings/global', idToken),
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
        const rows = await fsRestQueryDisbursements(governorateId, rawReportId, idToken);

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

        let httpStatus = 0;
        let syncSuccess = false;
        let responseMessage = '';

        try {
          const remoteRes = await fetch(urlCheck.url.toString(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(outgoingPayload),
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
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
          const reason =
            fetchErr instanceof Error && fetchErr.name === 'TimeoutError'
              ? 'انتهت مهلة الاتصال بالخادم المركزي (10 ثوانٍ).'
              : fetchErr instanceof Error
                ? `فشل الاتصال بالخادم المركزي: ${fetchErr.message}`
                : 'تعذر الوصول إلى الخادم المركزي.';
          responseMessage = reason.slice(0, 380);
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

  if (!isProd) {
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
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DST Fertilizer Management Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
