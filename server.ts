import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { requireAuth, type AuthenticatedRequest } from './src/middleware/auth.ts';
import {
  analyzeSingleSheetOcr,
  extractManifestOcr,
  extractSheetNumbersOcr,
  OcrExtractionError,
} from './src/server/geminiOcr.ts';
import { SEED_ASSOCIATIONS, SEED_GOVERNORATES } from './src/data/seedData.ts';
import type {
  AgriculturalAssociation,
  Governorate,
  SheetSectionType,
} from './src/types/domain.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'dst-fertilizer-system' });
  });

  // Server-Side Gemini Vision OCR Endpoints (stateless token verification only;
  // all Firestore persistence and RBAC are enforced client-side via firestore.rules).
  app.post(
    '/api/ai/extract-sheet-numbers',
    requireAuth,
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
        res.status(400).json({
          error: error instanceof Error ? error.message : 'فشلت قراءة البوليصة بالذكاء الاصطناعي.',
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
