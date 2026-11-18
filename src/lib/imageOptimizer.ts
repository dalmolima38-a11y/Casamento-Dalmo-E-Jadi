import { getAdminAuthHeaders } from './firebase';

export const MAX_RAW_SELECT_BYTES = 25 * 1024 * 1024; // 25 MB before client optimization
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

export interface OptimizedImageResult {
  blob: Blob;
  fileName: string;
  mimeType: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  originalBytes: number;
  optimizedBytes: number;
}

export interface MediaUploadResponse {
  ok: boolean;
  url: string;
  fallbackUrl?: string;
  filename: string;
  repoPath?: string;
  commitSha?: string;
  provider?: 'jsdelivr' | 'github_raw';
  sizeBytes: number;
  storageBackend: 'github_cdn';
  persistent: boolean;
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

export function isSupportedImageFile(file: File): boolean {
  if (file.type && ALLOWED_IMAGE_MIME_TYPES.has(file.type.toLowerCase())) {
    return true;
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
}

export function extractGitHubCoverflowFilenameFromUrl(imageUrl: string): string | null {
  const trimmed = imageUrl.trim();
  const jsdMatch =
    /^https:\/\/cdn\.jsdelivr\.net\/gh\/dalmofilho38-cyber\/App-Casamento-Dalmo-e-Jadi@[^/]+\/public\/images\/coverflow\/([^?#]+)$/.exec(
      trimmed
    );
  const rawMatch =
    /^https:\/\/raw\.githubusercontent\.com\/dalmofilho38-cyber\/App-Casamento-Dalmo-e-Jadi\/[^/]+\/public\/images\/coverflow\/([^?#]+)$/.exec(
      trimmed
    );
  const match = jsdMatch || rawMatch;
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]).trim();
    if (!decoded || decoded.includes('/') || decoded.includes('..')) return null;
    if (!/^[a-zA-Z0-9._-]+\.(webp|jpg|jpeg|png)$/i.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function decodeImageElement(file: File): Promise<{
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fallback below for browsers without imageOrientation option support
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Não foi possível decodificar a imagem selecionada.'));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * Resizes oversized photos proportionally (max 1600 px on longest side), corrects EXIF orientation,
 * and encodes them as WebP (or high-quality JPEG fallback) before uploading.
 */
export async function optimizeImageForUpload(
  file: File,
  options: { maxDimension?: number; targetMaxBytes?: number; quality?: number } = {}
): Promise<OptimizedImageResult> {
  const maxDimension = options.maxDimension ?? 1600;
  const targetMaxBytes = options.targetMaxBytes ?? 1200 * 1024;
  const baseQuality = options.quality ?? 0.86;

  if (!isSupportedImageFile(file)) {
    throw new Error('Formato inválido. Selecione uma imagem JPG, JPEG, PNG ou WEBP.');
  }
  if (file.size <= 0 || file.size > MAX_RAW_SELECT_BYTES) {
    throw new Error('O arquivo selecionado ultrapassa o limite de 25 MB para otimização.');
  }

  const decoded = await decodeImageElement(file);
  try {
    const srcW = Math.max(1, decoded.width);
    const srcH = Math.max(1, decoded.height);
    const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Navegador sem suporte a processamento de imagem (Canvas 2D).');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    decoded.draw(ctx, targetW, targetH);

    let chosenMime: 'image/webp' | 'image/jpeg' = 'image/webp';
    let blob = await canvasToBlob(canvas, 'image/webp', baseQuality);
    if (!blob || blob.type !== 'image/webp') {
      chosenMime = 'image/jpeg';
      blob = await canvasToBlob(canvas, 'image/jpeg', Math.min(0.9, baseQuality + 0.02));
    }

    if (blob && blob.size > targetMaxBytes) {
      const tighter = await canvasToBlob(canvas, chosenMime, 0.78);
      if (tighter && tighter.size < blob.size) {
        blob = tighter;
      }
    }

    canvas.width = 0;
    canvas.height = 0;

    if (!blob || blob.size === 0) {
      throw new Error('Falha ao converter a fotografia para envio.');
    }

    const baseName =
      (file.name || 'fotografia')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 48) || 'fotografia';
    const ext = chosenMime === 'image/webp' ? 'webp' : 'jpg';

    return {
      blob,
      fileName: `${baseName}.${ext}`,
      mimeType: chosenMime,
      width: targetW,
      height: targetH,
      originalBytes: file.size,
      optimizedBytes: blob.size,
    };
  } finally {
    decoded.cleanup();
  }
}

function sendXhrMultipart(params: {
  url: string;
  formData: FormData;
  headers: Record<string, string>;
  timeoutMs: number;
  onProgress?: (percent: number) => void;
}): Promise<{ status: number; responseUrl: string; contentType: string; bodyText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', params.url, true);
    xhr.withCredentials = true;
    xhr.timeout = params.timeoutMs;

    for (const [key, val] of Object.entries(params.headers)) {
      xhr.setRequestHeader(key, val);
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0 && params.onProgress) {
        // Reserve 85..100% for GitHub commit + CDN URL verification + Firestore write
        const pct = Math.min(85, Math.round((ev.loaded / ev.total) * 85));
        params.onProgress(pct);
      }
    };

    xhr.onload = () => {
      resolve({
        status: xhr.status,
        responseUrl: xhr.responseURL || params.url,
        contentType: (xhr.getResponseHeader('content-type') || '').toLowerCase(),
        bodyText: xhr.responseText || '',
      });
    };

    xhr.onerror = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        reject(new Error('Sem conexão com a internet. Verifique sua rede e tente novamente.'));
        return;
      }
      reject(
        new Error(
          'Falha de rede/proxy ao enviar a fotografia para o servidor (possível expiração de sessão do preview ou bloqueio CORS). Recarregue a página e tente novamente.'
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          'O envio para o GitHub demorou mais que o limite (60s). Tente novamente em instantes.'
        )
      );
    };

    xhr.onabort = () => {
      reject(new Error('O envio da fotografia foi cancelado antes de concluir.'));
    };

    xhr.send(params.formData);
  });
}

export async function uploadCoverflowViaServer(params: {
  blob: Blob;
  fileName: string;
  caption?: string;
  onProgress?: (percent: number) => void;
}): Promise<MediaUploadResponse> {
  const buildFormData = () => {
    const fd = new FormData();
    fd.append('file', params.blob, params.fileName);
    if (params.caption?.trim()) {
      fd.append('caption', params.caption.trim().slice(0, 200));
    }
    return fd;
  };

  let headers = await getAdminAuthHeaders(false);
  let res = await sendXhrMultipart({
    url: '/api/media/coverflow',
    formData: buildFormData(),
    headers,
    timeoutMs: 60_000,
    onProgress: params.onProgress,
  });

  if (res.status === 401) {
    headers = await getAdminAuthHeaders(true);
    res = await sendXhrMultipart({
      url: '/api/media/coverflow',
      formData: buildFormData(),
      headers,
      timeoutMs: 60_000,
      onProgress: params.onProgress,
    });
  }

  if (res.contentType.includes('text/html') && res.bodyText.includes('<html')) {
    throw new Error(
      'A sessão de acesso ao servidor expirou no navegador (resposta HTML do proxy). Recarregue a página e entre novamente.'
    );
  }

  let parsed: Partial<MediaUploadResponse> & { error?: string } = {};
  try {
    parsed = JSON.parse(res.bodyText || '{}');
  } catch {
    // Non-JSON response
  }

  if (res.status < 200 || res.status >= 300 || !parsed.ok || !parsed.url) {
    throw new Error(
      parsed.error ||
        `Erro HTTP ${res.status || 'desconhecido'} ao publicar a fotografia no GitHub.`
    );
  }

  params.onProgress?.(92);
  return {
    ok: true,
    url: parsed.url,
    fallbackUrl: parsed.fallbackUrl,
    filename: parsed.filename || params.fileName,
    repoPath: parsed.repoPath,
    commitSha: parsed.commitSha,
    provider: parsed.provider,
    sizeBytes: parsed.sizeBytes || params.blob.size,
    storageBackend: 'github_cdn',
    persistent: true,
  };
}

export async function deleteCoverflowViaGitHub(imageUrl: string): Promise<{
  attempted: boolean;
  githubDeleted: boolean;
  reason?: string;
}> {
  const filename = extractGitHubCoverflowFilenameFromUrl(imageUrl);
  if (!filename) {
    return { attempted: false, githubDeleted: false, reason: 'not_github_cdn_url' };
  }

  let headers = await getAdminAuthHeaders(false);
  let res = await fetch(`/api/media/coverflow/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    headers,
    credentials: 'same-origin',
  });

  if (res.status === 401) {
    headers = await getAdminAuthHeaders(true);
    res = await fetch(`/api/media/coverflow/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
      headers,
      credentials: 'same-origin',
    });
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    githubDeleted?: boolean;
    reason?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error || `Falha ao remover "${filename}" do GitHub (HTTP ${res.status}).`);
  }

  return {
    attempted: true,
    githubDeleted: Boolean(data.githubDeleted),
    reason: data.reason,
  };
}

export async function uploadCeremonyPhotoViaServer(params: {
  blob: Blob;
  fileName: string;
  onProgress?: (percent: number) => void;
}): Promise<MediaUploadResponse> {
  const buildFormData = () => {
    const fd = new FormData();
    fd.append('file', params.blob, params.fileName);
    return fd;
  };

  let headers = await getAdminAuthHeaders(false);
  let res = await sendXhrMultipart({
    url: '/api/media/ceremony',
    formData: buildFormData(),
    headers,
    timeoutMs: 60_000,
    onProgress: params.onProgress,
  });

  if (res.status === 401) {
    headers = await getAdminAuthHeaders(true);
    res = await sendXhrMultipart({
      url: '/api/media/ceremony',
      formData: buildFormData(),
      headers,
      timeoutMs: 60_000,
      onProgress: params.onProgress,
    });
  }

  if (res.contentType.includes('text/html') && res.bodyText.includes('<html')) {
    throw new Error(
      'A sessão de acesso ao servidor expirou no navegador (resposta HTML do proxy). Recarregue a página e entre novamente.'
    );
  }

  let parsed: Partial<MediaUploadResponse> & { error?: string } = {};
  try {
    parsed = JSON.parse(res.bodyText || '{}');
  } catch {
    // Non-JSON response
  }

  if (res.status < 200 || res.status >= 300 || !parsed.ok || !parsed.url) {
    throw new Error(
      parsed.error ||
        `Erro HTTP ${res.status || 'desconhecido'} ao publicar fotografia da igreja no GitHub.`
    );
  }

  params.onProgress?.(95);
  return {
    ok: true,
    url: parsed.url,
    fallbackUrl: parsed.fallbackUrl,
    filename: parsed.filename || params.fileName,
    repoPath: parsed.repoPath,
    commitSha: parsed.commitSha,
    provider: parsed.provider,
    sizeBytes: parsed.sizeBytes || params.blob.size,
    storageBackend: 'github_cdn',
    persistent: true,
  };
}

export function getCeremonyPhotoFallbackUrl(imageUrl: string): string | null {
  const trimmed = (imageUrl || '').trim();
  const jsdMatch =
    /^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^@]+)@([^/]+)\/(.+)$/.exec(trimmed);
  if (jsdMatch) {
    return `https://raw.githubusercontent.com/${jsdMatch[1]}/${jsdMatch[2]}/${jsdMatch[3]}/${jsdMatch[4]}`;
  }
  return null;
}

