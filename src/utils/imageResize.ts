export interface ResizedImageResult {
  base64: string;
  mimeType: 'image/jpeg';
  dataUrl: string;
  width: number;
  height: number;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
const TARGET_MAX_BASE64_CHARS = 1_800_000; // ~1.35 MB binary JPEG -> fast & reliable over mobile/proxy

function isHeicFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return (
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

function encodeCanvasWithinTarget(
  source: HTMLImageElement,
  initialWidth: number,
  initialHeight: number,
  initialQuality: number,
): { dataUrl: string; base64: string; width: number; height: number } {
  const renderAt = (w: number, h: number, q: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('تعذر تهيئة Canvas لمعالجة الصورة.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    const base64 = dataUrl.split(',')[1] || '';
    return { dataUrl, base64, width: w, height: h };
  };

  let best = renderAt(initialWidth, initialHeight, initialQuality);
  if (best.base64.length <= TARGET_MAX_BASE64_CHARS) {
    return best;
  }

  // Step down JPEG quality slightly while preserving full resolution
  for (const q of [0.82, 0.74, 0.66]) {
    if (q >= initialQuality) continue;
    best = renderAt(initialWidth, initialHeight, q);
    if (best.base64.length <= TARGET_MAX_BASE64_CHARS) {
      return best;
    }
  }

  // If still oversized (very dense photo), step down dimensions moderately
  const scale = 1350 / Math.max(initialWidth, initialHeight);
  if (scale < 1) {
    const w2 = Math.max(1, Math.round(initialWidth * scale));
    const h2 = Math.max(1, Math.round(initialHeight * scale));
    best = renderAt(w2, h2, 0.74);
  }
  return best;
}

/**
 * Converts HEIC/HEIF if needed, enforces size checks, and resizes an uploaded/captured image
 * in-browser using Canvas to a crisp, proxy-safe JPEG payload.
 */
export async function resizeImageForUpload(
  file: File,
  maxDimension = 1600,
  quality = 0.86,
): Promise<ResizedImageResult> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('حجم الصورة يتجاوز الحد الأقصى المسموح به (25 ميجابايت). يُرجى اختيار صورة أصغر.');
  }

  let sourceBlob: Blob = file;
  if (isHeicFile(file)) {
    try {
      const { default: heic2any } = await import('heic2any');
      const converted = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.86,
      });
      sourceBlob = Array.isArray(converted) ? converted[0] : converted;
    } catch {
      throw new Error(
        'تعذر تحويل صورة iPhone (HEIC/HEIF). يُرجى حفظها بصيغة JPEG أو PNG أو تفعيل التوافق من إعدادات الكاميرا.',
      );
    }
  }

  const imageUrl = URL.createObjectURL(sourceBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () =>
        reject(new Error('صيغة الصورة غير مدعومة أو الملف تالف. يُرجى استخدام JPEG أو PNG أو WEBP.'));
      el.src = imageUrl;
    });

    let targetWidth = img.naturalWidth || img.width;
    let targetHeight = img.naturalHeight || img.height;

    if (targetWidth > maxDimension || targetHeight > maxDimension) {
      if (targetWidth >= targetHeight) {
        targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
        targetWidth = maxDimension;
      } else {
        targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
        targetHeight = maxDimension;
      }
    }

    const encoded = encodeCanvasWithinTarget(img, targetWidth, targetHeight, quality);

    return {
      base64: encoded.base64,
      mimeType: 'image/jpeg',
      dataUrl: encoded.dataUrl,
      width: encoded.width,
      height: encoded.height,
    };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

/**
 * Rotates an existing image Data URL by 90 or -90 degrees (CW/CCW) on an HTML canvas.
 */
export async function rotateImageDataUrl(
  dataUrl: string,
  degrees: 90 | -90,
  quality = 0.9,
): Promise<ResizedImageResult> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('تعذر تدوير الصورة المحددة.'));
    el.src = dataUrl;
  });

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = srcH;
  canvas.height = srcW;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('تعذر تهيئة Canvas لتدوير الصورة.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -srcW / 2, -srcH / 2);

  const rotatedUrl = canvas.toDataURL('image/jpeg', quality);
  return {
    dataUrl: rotatedUrl,
    base64: rotatedUrl.split(',')[1] || '',
    mimeType: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
  };
}
