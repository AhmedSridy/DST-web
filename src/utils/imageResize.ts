import heic2any from 'heic2any';

export interface ResizedImageResult {
  base64: string;
  mimeType: 'image/jpeg';
  dataUrl: string;
  width: number;
  height: number;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

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

/**
 * Converts HEIC/HEIF if needed, enforces size checks, and resizes an uploaded/captured image
 * in-browser using Canvas to a maximum dimension of 1800px at JPEG quality 0.9.
 */
export async function resizeImageForUpload(
  file: File,
  maxDimension = 1800,
  quality = 0.9,
): Promise<ResizedImageResult> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('حجم الصورة يتجاوز الحد الأقصى المسموح به (25 ميجابايت). يُرجى اختيار صورة أصغر.');
  }

  let sourceBlob: Blob = file;
  if (isHeicFile(file)) {
    try {
      const converted = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.9,
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

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('تعذر تهيئة Canvas لمعالجة الصورة.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1] || '';

    return {
      base64,
      mimeType: 'image/jpeg',
      dataUrl,
      width: targetWidth,
      height: targetHeight,
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
