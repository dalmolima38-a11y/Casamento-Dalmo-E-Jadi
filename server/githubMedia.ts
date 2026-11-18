import crypto from 'crypto';

const PROTECTED_STARTER_FILES = new Set([
  'lembranca-01.jpg',
  'lembranca-02.jpg',
  'lembranca-03.jpg',
  'lembranca-04.jpg',
]);

export type GitHubErrorCode =
  | 'GITHUB_SECRET_MISSING'
  | 'GITHUB_INVALID_PEM'
  | 'GITHUB_AUTH_REJECTED'
  | 'GITHUB_API_ERROR';

export class GitHubMediaConfigError extends Error {
  status: number;
  code: GitHubErrorCode;
  missingVars: string[];
  constructor(
    message: string,
    options: {
      code?: GitHubErrorCode;
      missingVars?: string[];
      status?: number;
    } = {}
  ) {
    super(message);
    this.status = options.status ?? 503;
    this.code = options.code ?? 'GITHUB_SECRET_MISSING';
    this.missingVars = options.missingVars ?? [];
  }
}

export interface GitHubPrivateKeyDiagnostics {
  present: boolean;
  keyLength: number;
  status: 'valid' | 'missing' | 'invalid_pem';
  format: 'pkcs1' | 'pkcs8' | 'unknown';
  hadRealNewlines: boolean;
  hadLiteralNewlines: boolean;
  hadSingleLineSpaces: boolean;
  errorReason?: string;
}

export interface GitHubMediaEnvStatus {
  configured: boolean;
  authMode: 'github_app' | 'fine_grained_token' | 'unconfigured';
  owner: string;
  repo: string;
  branch: string;
  targetDir: string;
  missingVars: string[];
  keyDiagnostics: GitHubPrivateKeyDiagnostics;
}

interface ParsedPemResult {
  keyObject: crypto.KeyObject | null;
  normalizedPem: string;
  diagnostics: GitHubPrivateKeyDiagnostics;
}

/**
 * Normalizes real newlines (\r\n, \r, \n), literal "\n" sequences, base64-wrapped PEMs,
 * and whitespace-collapsed single-line PEM pastes without altering any cryptographic bytes.
 * Never attempts to repair or reconstruct a truncated or corrupted key.
 */
function parseAndValidateGitHubPrivateKey(rawInput: string): ParsedPemResult {
  const raw = rawInput ?? '';
  const trimmed = raw.trim().replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1').trim();

  if (!trimmed) {
    return {
      keyObject: null,
      normalizedPem: '',
      diagnostics: {
        present: false,
        keyLength: 0,
        status: 'missing',
        format: 'unknown',
        hadRealNewlines: false,
        hadLiteralNewlines: false,
        hadSingleLineSpaces: false,
        errorReason: 'Secret GITHUB_APP_PRIVATE_KEY não definida ou vazia no servidor.',
      },
    };
  }

  const hadRealNewlines = raw.includes('\n') || raw.includes('\r');
  const hadLiteralNewlines = raw.includes('\\n') || raw.includes('\\r');

  // Step 1: Convert literal escaped "\r\n" / "\n" and CRLF into real LF newlines
  let candidate = trimmed
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  // Step 2: Support base64-encoded full PEM stored in single-line Secret managers
  if (!candidate.includes('-----BEGIN')) {
    try {
      const decoded = Buffer.from(candidate.replace(/\s+/g, ''), 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) {
        candidate = decoded
          .replace(/\\r\\n/g, '\n')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\n')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .trim();
      }
    } catch {
      // Leave candidate untouched; handled below as invalid PEM
    }
  }

  const pemBlockMatch =
    /-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(candidate);

  if (!pemBlockMatch) {
    return {
      keyObject: null,
      normalizedPem: '',
      diagnostics: {
        present: true,
        keyLength: trimmed.length,
        status: 'invalid_pem',
        format: 'unknown',
        hadRealNewlines,
        hadLiteralNewlines,
        hadSingleLineSpaces: candidate.includes(' '),
        errorReason:
          'Cabeçalho/rodapé PEM ausente ou incompatível. Esperado BEGIN RSA PRIVATE KEY (PKCS#1) ou BEGIN PRIVATE KEY (PKCS#8). Substitua a Secret pelo arquivo .pem original gerado no GitHub.',
      },
    };
  }

  const headerType = pemBlockMatch[1];
  const format: 'pkcs1' | 'pkcs8' = headerType === 'RSA PRIVATE KEY' ? 'pkcs1' : 'pkcs8';
  const rawBody = pemBlockMatch[2];
  const hadSingleLineSpaces = !rawBody.trim().includes('\n') && rawBody.trim().includes(' ');

  // Verify the PEM body contains strictly valid Base64 characters + whitespace (do NOT mutate/guess corrupted data)
  const compactBase64 = rawBody.replace(/\s+/g, '');
  if (!compactBase64 || !/^[A-Za-z0-9+/=]+$/.test(compactBase64) || compactBase64.length % 4 !== 0) {
    return {
      keyObject: null,
      normalizedPem: '',
      diagnostics: {
        present: true,
        keyLength: trimmed.length,
        status: 'invalid_pem',
        format,
        hadRealNewlines,
        hadLiteralNewlines,
        hadSingleLineSpaces,
        errorReason:
          'Conteúdo Base64 da chave privada inválido ou truncado. Substitua GITHUB_APP_PRIVATE_KEY pelo conteúdo completo do arquivo .pem original.',
      },
    };
  }

  // Re-wrap cleanly at 64 chars per line without altering a single cryptographic byte
  const wrappedBody = compactBase64.match(/.{1,64}/g)?.join('\n') || compactBase64;
  const normalizedPem = `-----BEGIN ${headerType}-----\n${wrappedBody}\n-----END ${headerType}-----\n`;

  try {
    const keyObject = crypto.createPrivateKey({
      key: normalizedPem,
      format: 'pem',
    });

    if (keyObject.asymmetricKeyType !== 'rsa') {
      return {
        keyObject: null,
        normalizedPem: '',
        diagnostics: {
          present: true,
          keyLength: trimmed.length,
          status: 'invalid_pem',
          format,
          hadRealNewlines,
          hadLiteralNewlines,
          hadSingleLineSpaces,
          errorReason:
            'A chave informada não é uma chave RSA válida para assinatura RS256 do GitHub App.',
        },
      };
    }

    return {
      keyObject,
      normalizedPem,
      diagnostics: {
        present: true,
        keyLength: trimmed.length,
        status: 'valid',
        format,
        hadRealNewlines,
        hadLiteralNewlines,
        hadSingleLineSpaces,
      },
    };
  } catch (err) {
    const errCode = (err as { code?: string })?.code || 'ERR_CRYPTO_INVALID_KEY';
    return {
      keyObject: null,
      normalizedPem: '',
      diagnostics: {
        present: true,
        keyLength: trimmed.length,
        status: 'invalid_pem',
        format,
        hadRealNewlines,
        hadLiteralNewlines,
        hadSingleLineSpaces,
        errorReason: `Falha criptográfica ao decodificar PEM (${errCode}). Substitua GITHUB_APP_PRIVATE_KEY pelo arquivo .pem original completo.`,
      },
    };
  }
}

function resolveGitHubConfig() {
  const owner = (process.env.GITHUB_MEDIA_OWNER || 'dalmofilho38-cyber').trim();
  const repo = (process.env.GITHUB_MEDIA_REPO || 'App-Casamento-Dalmo-e-Jadi').trim();
  const branch = (process.env.GITHUB_MEDIA_BRANCH || 'main').trim();

  const appId = (process.env.GITHUB_APP_ID || '').trim();
  const installationId = (process.env.GITHUB_APP_INSTALLATION_ID || '').trim();
  const rawPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY || '';
  const parsedKey = parseAndValidateGitHubPrivateKey(rawPrivateKey);
  const patToken = (process.env.GITHUB_MEDIA_TOKEN || process.env.GITHUB_TOKEN || '').trim();

  return {
    owner,
    repo,
    branch,
    appId,
    installationId,
    parsedKey,
    patToken,
  };
}

export function getGitHubMediaStatus(): GitHubMediaEnvStatus {
  const cfg = resolveGitHubConfig();
  const hasAppId = Boolean(cfg.appId);
  const hasInstId = Boolean(cfg.installationId);
  const keyValid = cfg.parsedKey.keyObject !== null;

  if (hasAppId && hasInstId && keyValid) {
    return {
      configured: true,
      authMode: 'github_app',
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
      targetDir: 'public/images/coverflow',
      missingVars: [],
      keyDiagnostics: cfg.parsedKey.diagnostics,
    };
  }

  if (cfg.patToken && !(hasAppId || hasInstId || cfg.parsedKey.diagnostics.present)) {
    return {
      configured: true,
      authMode: 'fine_grained_token',
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
      targetDir: 'public/images/coverflow',
      missingVars: [],
      keyDiagnostics: cfg.parsedKey.diagnostics,
    };
  }

  const missingVars: string[] = [];
  if (!hasAppId) missingVars.push('GITHUB_APP_ID');
  if (!hasInstId) missingVars.push('GITHUB_APP_INSTALLATION_ID');
  if (!cfg.parsedKey.diagnostics.present) missingVars.push('GITHUB_APP_PRIVATE_KEY');

  return {
    configured: false,
    authMode: 'unconfigured',
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    targetDir: 'public/images/coverflow',
    missingVars,
    keyDiagnostics: cfg.parsedKey.diagnostics,
  };
}

function createGitHubAppJwt(appId: string, keyObject: crypto.KeyObject): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(
    JSON.stringify({
      iat: nowSec - 60,
      exp: nowSec + 540,
      iss: appId,
    })
  ).toString('base64url');

  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signatureB64 = signer.sign(keyObject).toString('base64url');
  return `${signingInput}.${signatureB64}`;
}

let cachedInstallationToken: {
  cacheKey: string;
  token: string;
  expiresAtMs: number;
} | null = null;

async function getGitHubAuthToken(forceRefresh = false): Promise<{
  token: string;
  owner: string;
  repo: string;
  branch: string;
  authMode: 'github_app' | 'fine_grained_token';
}> {
  const cfg = resolveGitHubConfig();
  const status = getGitHubMediaStatus();

  if (status.authMode === 'fine_grained_token') {
    return {
      token: cfg.patToken,
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
      authMode: 'fine_grained_token',
    };
  }

  if (status.missingVars.length > 0) {
    throw new GitHubMediaConfigError(
      `Secret(s) do GitHub App ausente(s) no servidor: ${status.missingVars.join(', ')}. Configure-as nas Secrets do Google AI Studio.`,
      { code: 'GITHUB_SECRET_MISSING', missingVars: status.missingVars, status: 503 }
    );
  }

  if (!cfg.parsedKey.keyObject) {
    throw new GitHubMediaConfigError(
      cfg.parsedKey.diagnostics.errorReason ||
        'A chave privada do GitHub App (GITHUB_APP_PRIVATE_KEY) é inválida. Substitua-a pelo arquivo .pem original gerado no GitHub.',
      { code: 'GITHUB_INVALID_PEM', missingVars: ['GITHUB_APP_PRIVATE_KEY'], status: 503 }
    );
  }

  const cacheKey = `${cfg.appId}:${cfg.installationId}:${cfg.owner}/${cfg.repo}`;
  if (
    !forceRefresh &&
    cachedInstallationToken &&
    cachedInstallationToken.cacheKey === cacheKey &&
    cachedInstallationToken.expiresAtMs - 120_000 > Date.now()
  ) {
    return {
      token: cachedInstallationToken.token,
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch,
      authMode: 'github_app',
    };
  }

  let appJwt: string;
  try {
    appJwt = createGitHubAppJwt(cfg.appId, cfg.parsedKey.keyObject);
  } catch {
    throw new GitHubMediaConfigError(
      'Falha ao assinar o JWT RS256 com GITHUB_APP_PRIVATE_KEY. Substitua a Secret pelo arquivo .pem original do GitHub App.',
      { code: 'GITHUB_INVALID_PEM', missingVars: ['GITHUB_APP_PRIVATE_KEY'], status: 503 }
    );
  }

  const tokenEndpoint = `https://api.github.com/app/installations/${encodeURIComponent(cfg.installationId)}/access_tokens`;
  const resp = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DalmoEJadiWeddingMedia/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repositories: [cfg.repo],
      permissions: { contents: 'write' },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const errPayload = (await resp.json().catch(() => ({}))) as { message?: string };
    const ghMsg = errPayload.message || 'autenticação recusada pelo GitHub';
    throw new GitHubMediaConfigError(
      `Autenticação recusada pelo GitHub (HTTP ${resp.status}): ${ghMsg}. Verifique se GITHUB_APP_ID (${cfg.appId}), GITHUB_APP_INSTALLATION_ID (${cfg.installationId}) e a permissão Contents: Read & write no repositório ${cfg.owner}/${cfg.repo} correspondem à chave privada configurada.`,
      {
        code: 'GITHUB_AUTH_REJECTED',
        status: resp.status === 401 || resp.status === 403 || resp.status === 404 || resp.status === 422 ? 503 : 502,
      }
    );
  }

  const tokenData = (await resp.json()) as { token?: string; expires_at?: string };
  if (!tokenData.token) {
    throw new GitHubMediaConfigError('GitHub App não retornou token de instalação válido.', {
      code: 'GITHUB_API_ERROR',
      status: 502,
    });
  }

  const expiresAtMs = tokenData.expires_at
    ? Date.parse(tokenData.expires_at)
    : Date.now() + 50 * 60_000;

  cachedInstallationToken = {
    cacheKey,
    token: tokenData.token,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 50 * 60_000,
  };

  return {
    token: tokenData.token,
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    authMode: 'github_app',
  };
}

/**
 * Safely verifies GitHub App configuration + RS256 key + live token exchange with GitHub
 * without returning or logging any private key, JWT, or installation token.
 */
export async function probeGitHubAppLiveAuth(): Promise<{
  ok: boolean;
  code?: GitHubErrorCode;
  status: GitHubMediaEnvStatus;
  githubTokenExchangeOk: boolean;
  message: string;
}> {
  const status = getGitHubMediaStatus();
  if (!status.configured) {
    const isInvalidPem = status.keyDiagnostics.status === 'invalid_pem';
    return {
      ok: false,
      code: isInvalidPem ? 'GITHUB_INVALID_PEM' : 'GITHUB_SECRET_MISSING',
      status,
      githubTokenExchangeOk: false,
      message: isInvalidPem
        ? status.keyDiagnostics.errorReason || 'Chave PEM inválida.'
        : `Secrets ausentes: ${status.missingVars.join(', ')}`,
    };
  }

  try {
    await getGitHubAuthToken(true);
    return {
      ok: true,
      status,
      githubTokenExchangeOk: true,
      message: 'Chave PEM validada com sucesso, JWT RS256 assinado e token de instalação obtido do GitHub.',
    };
  } catch (err) {
    const cfgErr = err instanceof GitHubMediaConfigError ? err : null;
    return {
      ok: false,
      code: cfgErr?.code || 'GITHUB_API_ERROR',
      status,
      githubTokenExchangeOk: false,
      message: err instanceof Error ? err.message : 'Erro ao validar autenticação com GitHub.',
    };
  }
}

export function assertSafeCoverflowFilename(rawFilename: string): string {
  const safe = rawFilename.trim();
  if (
    !safe ||
    safe.includes('/') ||
    safe.includes('\\') ||
    safe.includes('..') ||
    !/^[a-zA-Z0-9._-]+\.(webp|jpg|jpeg|png)$/i.test(safe)
  ) {
    throw new Error('Nome de arquivo inválido para public/images/coverflow/.');
  }
  return safe;
}

export function extractGitHubCoverflowFilename(imageUrl: string): string | null {
  const cfg = resolveGitHubConfig();
  const trimmed = imageUrl.trim();
  const escOwner = cfg.owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escRepo = cfg.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const jsdRegex = new RegExp(
    `^https://cdn\\.jsdelivr\\.net/gh/${escOwner}/${escRepo}@[^/]+/public/images/coverflow/([^?#]+)$`
  );
  const rawRegex = new RegExp(
    `^https://raw\\.githubusercontent\\.com/${escOwner}/${escRepo}/[^/]+/public/images/coverflow/([^?#]+)$`
  );
  const match = jsdRegex.exec(trimmed) || rawRegex.exec(trimmed);
  if (!match) return null;
  try {
    return assertSafeCoverflowFilename(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

async function probeImageUrlReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'image/webp,image/jpeg,image/png,image/*;q=0.9',
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 0;
  } catch {
    return false;
  }
}

async function verifyPublicGitHubImageUrls(
  cdnUrl: string,
  rawUrl: string
): Promise<{ publicUrl: string; provider: 'jsdelivr' | 'github_raw' }> {
  const backoffMs = [0, 700, 1200, 1800, 2400];

  for (let i = 0; i < backoffMs.length; i++) {
    if (backoffMs[i] > 0) {
      await new Promise((r) => setTimeout(r, backoffMs[i]));
    }
    if (await probeImageUrlReady(cdnUrl)) {
      return { publicUrl: cdnUrl, provider: 'jsdelivr' };
    }
    if (i >= 2 && (await probeImageUrlReady(rawUrl))) {
      return { publicUrl: rawUrl, provider: 'github_raw' };
    }
  }

  throw new Error(
    'A fotografia foi enviada ao GitHub, mas a URL pública ainda não respondeu com imagem válida. Verifique se o repositório está público e tente novamente em instantes.'
  );
}

export async function uploadCoverflowImageToGitHub(params: {
  buffer: Buffer;
  filename: string;
  caption?: string;
  actorEmail: string;
}): Promise<{
  filename: string;
  repoPath: string;
  commitSha: string;
  publicUrl: string;
  fallbackRawUrl: string;
  provider: 'jsdelivr' | 'github_raw';
  authMode: 'github_app' | 'fine_grained_token';
}> {
  const safeFilename = assertSafeCoverflowFilename(params.filename);
  const auth = await getGitHubAuthToken();
  const repoPath = `public/images/coverflow/${safeFilename}`;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(auth.owner)}/${encodeURIComponent(auth.repo)}/contents/${repoPath}`;

  const commitMessage = params.caption
    ? `feat(galeria): adiciona ${safeFilename} (${params.caption.slice(0, 60)})`
    : `feat(galeria): adiciona ${safeFilename} na Galeria 3D`;

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DalmoEJadiWeddingMedia/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      content: params.buffer.toString('base64'),
      branch: auth.branch,
      committer: {
        name: 'Painel Dalmo & Jadi',
        email: params.actorEmail || 'noreply@dalmoejadi.wedding',
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const putBody = (await putRes.json().catch(() => ({}))) as {
    message?: string;
    commit?: { sha?: string };
    content?: { sha?: string; download_url?: string };
  };

  if (!putRes.ok || !putBody.commit?.sha) {
    throw new GitHubMediaConfigError(
      `Falha ao gravar fotografia no GitHub (HTTP ${putRes.status}): ${putBody.message || 'verifique permissões Contents: write do GitHub App.'}`,
      { code: putRes.status === 401 || putRes.status === 403 ? 'GITHUB_AUTH_REJECTED' : 'GITHUB_API_ERROR', status: 502 }
    );
  }

  const commitSha = putBody.commit.sha;
  const cdnUrl = `https://cdn.jsdelivr.net/gh/${auth.owner}/${auth.repo}@${commitSha}/${repoPath}`;
  const rawUrl = `https://raw.githubusercontent.com/${auth.owner}/${auth.repo}/${commitSha}/${repoPath}`;

  const verified = await verifyPublicGitHubImageUrls(cdnUrl, rawUrl);

  return {
    filename: safeFilename,
    repoPath,
    commitSha,
    publicUrl: verified.publicUrl,
    fallbackRawUrl: rawUrl,
    provider: verified.provider,
    authMode: auth.authMode,
  };
}

export async function deleteCoverflowImageFromGitHub(params: {
  filename: string;
  actorEmail: string;
}): Promise<{ deleted: boolean; reason: 'deleted' | 'protected_starter' | 'not_found' }> {
  const safeFilename = assertSafeCoverflowFilename(params.filename);
  if (PROTECTED_STARTER_FILES.has(safeFilename.toLowerCase())) {
    return { deleted: false, reason: 'protected_starter' };
  }

  const auth = await getGitHubAuthToken();
  const repoPath = `public/images/coverflow/${safeFilename}`;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(auth.owner)}/${encodeURIComponent(auth.repo)}/contents/${repoPath}`;

  const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(auth.branch)}`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DalmoEJadiWeddingMedia/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (getRes.status === 404) {
    return { deleted: false, reason: 'not_found' };
  }
  if (!getRes.ok) {
    const body = (await getRes.json().catch(() => ({}))) as { message?: string };
    throw new GitHubMediaConfigError(
      `Não foi possível localizar arquivo no GitHub para exclusão (HTTP ${getRes.status}): ${body.message || 'erro desconhecido'}.`,
      { code: getRes.status === 401 || getRes.status === 403 ? 'GITHUB_AUTH_REJECTED' : 'GITHUB_API_ERROR', status: 502 }
    );
  }

  const fileMeta = (await getRes.json()) as { sha?: string };
  if (!fileMeta.sha) {
    return { deleted: false, reason: 'not_found' };
  }

  const delRes = await fetch(apiUrl, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DalmoEJadiWeddingMedia/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `chore(galeria): remove ${safeFilename} da Galeria 3D`,
      sha: fileMeta.sha,
      branch: auth.branch,
      committer: {
        name: 'Painel Dalmo & Jadi',
        email: params.actorEmail || 'noreply@dalmoejadi.wedding',
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!delRes.ok && delRes.status !== 404) {
    const body = (await delRes.json().catch(() => ({}))) as { message?: string };
    throw new GitHubMediaConfigError(
      `Falha ao remover arquivo do GitHub (HTTP ${delRes.status}): ${body.message || 'erro desconhecido'}.`,
      { code: delRes.status === 401 || delRes.status === 403 ? 'GITHUB_AUTH_REJECTED' : 'GITHUB_API_ERROR', status: 502 }
    );
  }

  return { deleted: true, reason: 'deleted' };
}

export const CEREMONY_JSON_REPO_PATH = 'public/data/cerimonia.json';
export const CEREMONY_IMAGES_REPO_DIR = 'public/images/cerimonia';
export const DEFAULT_CHURCH_PHOTO_URL = '/images/igreja-jardim-florestal.png';

export interface CeremonyPadrinhoEntry {
  id: string;
  side: 'noiva' | 'noivo';
  name: string;
  published: boolean;
  order: number;
}

export interface CeremonyChurchInfo {
  name: string;
  city: string;
  cep: string;
  streetAddress: string;
  coordinates: string;
  mapUrl: string;
  photoUrl: string;
  dateDisplay: string;
  timeDisplay: string;
  pastor: string;
  planner: string;
}

export interface CeremonyPublicData {
  version: number;
  updatedAt: string;
  updatedBy?: string;
  church: CeremonyChurchInfo;
  bridesmaids: CeremonyPadrinhoEntry[];
  groomsmen: CeremonyPadrinhoEntry[];
}

const DEFAULT_MADRINHAS_NAMES = [
  'Géssica Bahia',
  'Anndy Tainá',
  'Cibelly Vitória',
  'Debora Caroline',
  'Cecília Barbosa Alves',
  'Kayriny Coutinho',
];

const DEFAULT_PADRINHOS_NAMES = [
  'Gabriel Peres',
  'Gustavo Ortega',
  'Lucas Mattos',
  'Marcos Prates',
  'Michele de Giovanni',
  'Lucas Oliveira',
];

export const DEFAULT_CEREMONY_PUBLIC_DATA: CeremonyPublicData = {
  version: 1,
  updatedAt: '',
  church: {
    name: 'Igreja Adventista do Sétimo Dia — Jardim Florestal',
    city: 'Rio Pardo de Minas — MG',
    cep: '39530-000',
    streetAddress: 'Jardim Florestal, Rio Pardo de Minas – MG',
    coordinates: '',
    mapUrl: '',
    photoUrl: DEFAULT_CHURCH_PHOTO_URL,
    dateDisplay: 'Domingo, 10 de janeiro de 2027',
    timeDisplay: '15h',
    pastor: 'Pr. Fabiano Paulo de Andrade',
    planner: 'Ludimila De Giovanni',
  },
  bridesmaids: DEFAULT_MADRINHAS_NAMES.map((name, i) => ({
    id: `padrinho-noiva-${i + 1}`,
    side: 'noiva',
    name,
    published: true,
    order: i + 1,
  })),
  groomsmen: DEFAULT_PADRINHOS_NAMES.map((name, i) => ({
    id: `padrinho-noivo-${i + 1}`,
    side: 'noivo',
    name,
    published: true,
    order: i + 1,
  })),
};

export function assertSafeCeremonyFilename(rawFilename: string): string {
  const safe = rawFilename.trim();
  if (
    !safe ||
    safe.includes('/') ||
    safe.includes('\\') ||
    safe.includes('..') ||
    !/^[a-zA-Z0-9._-]+\.(webp|jpg|jpeg|png)$/i.test(safe)
  ) {
    throw new Error('Nome de arquivo inválido para public/images/cerimonia/.');
  }
  return safe;
}

export async function uploadCeremonyImageToGitHub(params: {
  buffer: Buffer;
  filename: string;
  actorEmail: string;
}): Promise<{
  filename: string;
  repoPath: string;
  commitSha: string;
  publicUrl: string;
  fallbackRawUrl: string;
  provider: 'jsdelivr' | 'github_raw';
  authMode: 'github_app' | 'fine_grained_token';
}> {
  const safeFilename = assertSafeCeremonyFilename(params.filename);
  const auth = await getGitHubAuthToken();
  const repoPath = `${CEREMONY_IMAGES_REPO_DIR}/${safeFilename}`;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(auth.owner)}/${encodeURIComponent(auth.repo)}/contents/${repoPath}`;

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DalmoEJadiWeddingMedia/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `feat(cerimonia): publica fotografia da igreja (${safeFilename})`,
      content: params.buffer.toString('base64'),
      branch: auth.branch,
      committer: {
        name: 'Painel Dalmo & Jadi',
        email: params.actorEmail || 'noreply@dalmoejadi.wedding',
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const putBody = (await putRes.json().catch(() => ({}))) as {
    message?: string;
    commit?: { sha?: string };
  };

  if (!putRes.ok || !putBody.commit?.sha) {
    throw new GitHubMediaConfigError(
      `Falha ao salvar fotografia da igreja no GitHub (HTTP ${putRes.status}): ${putBody.message || 'verifique permissões Contents: write do GitHub App.'}`,
      { code: putRes.status === 401 || putRes.status === 403 ? 'GITHUB_AUTH_REJECTED' : 'GITHUB_API_ERROR', status: 502 }
    );
  }

  const commitSha = putBody.commit.sha;
  const cdnUrl = `https://cdn.jsdelivr.net/gh/${auth.owner}/${auth.repo}@${commitSha}/${repoPath}`;
  const rawUrl = `https://raw.githubusercontent.com/${auth.owner}/${auth.repo}/${commitSha}/${repoPath}`;

  const verified = await verifyPublicGitHubImageUrls(cdnUrl, rawUrl);

  return {
    filename: safeFilename,
    repoPath,
    commitSha,
    publicUrl: verified.publicUrl,
    fallbackRawUrl: rawUrl,
    provider: verified.provider,
    authMode: auth.authMode,
  };
}

function sanitizeCeremonySideEntries(
  rawList: unknown,
  side: 'noiva' | 'noivo',
  usedIds: Set<string>
): CeremonyPadrinhoEntry[] {
  if (!Array.isArray(rawList)) return [];
  const normalized: CeremonyPadrinhoEntry[] = [];
  for (let i = 0; i < rawList.length && normalized.length < 30; i++) {
    const raw = rawList[i] as Partial<CeremonyPadrinhoEntry> | null | undefined;
    if (!raw || typeof raw !== 'object') continue;
    const cleanName = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : '';
    if (!cleanName) continue;

    let id =
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim().slice(0, 80)
        : `padrinho-${side}-${i + 1}`;
    while (usedIds.has(id)) {
      id = `padrinho-${side}-${crypto.randomBytes(3).toString('hex')}`;
    }
    usedIds.add(id);

    const rawOrder = Number(raw.order);
    normalized.push({
      id,
      side,
      name: cleanName,
      published: raw.published !== false,
      order: Number.isFinite(rawOrder) && rawOrder > 0 ? Math.min(100, Math.round(rawOrder)) : normalized.length + 1,
    });
  }

  return normalized
    .sort((a, b) => a.order - b.order)
    .map((entry, idx) => ({ ...entry, order: idx + 1 }));
}

function normalizeCeremonyDataFromRaw(
  raw: unknown,
  fallback: CeremonyPublicData = DEFAULT_CEREMONY_PUBLIC_DATA
): CeremonyPublicData {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const churchRaw =
    obj.church && typeof obj.church === 'object'
      ? (obj.church as Record<string, unknown>)
      : {};

  const pickNonEmpty = (val: unknown, prev: string, maxLen: number): string => {
    if (typeof val !== 'string') return prev;
    const t = val.trim().slice(0, maxLen);
    return t.length > 0 ? t : prev;
  };

  const pickOptional = (val: unknown, prev: string, maxLen: number): string => {
    if (typeof val !== 'string') return prev;
    return val.trim().slice(0, maxLen);
  };

  const usedIds = new Set<string>();
  const bridesmaids = Array.isArray(obj.bridesmaids)
    ? sanitizeCeremonySideEntries(obj.bridesmaids, 'noiva', usedIds)
    : fallback.bridesmaids.map((e) => {
        usedIds.add(e.id);
        return { ...e };
      });
  const groomsmen = Array.isArray(obj.groomsmen)
    ? sanitizeCeremonySideEntries(obj.groomsmen, 'noivo', usedIds)
    : fallback.groomsmen.map((e) => {
        usedIds.add(e.id);
        return { ...e };
      });

  return {
    version: typeof obj.version === 'number' && obj.version >= 1 ? obj.version : 1,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : fallback.updatedAt,
    ...(typeof obj.updatedBy === 'string' && obj.updatedBy.trim()
      ? { updatedBy: obj.updatedBy.trim() }
      : {}),
    church: {
      name: pickNonEmpty(churchRaw.name, fallback.church.name, 200),
      city: pickNonEmpty(churchRaw.city, fallback.church.city, 120),
      cep: pickNonEmpty(churchRaw.cep, fallback.church.cep, 20),
      streetAddress: pickNonEmpty(churchRaw.streetAddress, fallback.church.streetAddress, 240),
      coordinates: pickOptional(churchRaw.coordinates, fallback.church.coordinates, 80),
      mapUrl: pickOptional(churchRaw.mapUrl, fallback.church.mapUrl, 500),
      photoUrl: pickNonEmpty(churchRaw.photoUrl, fallback.church.photoUrl, 600),
      dateDisplay: pickNonEmpty(churchRaw.dateDisplay, fallback.church.dateDisplay, 100),
      timeDisplay: pickNonEmpty(churchRaw.timeDisplay, fallback.church.timeDisplay, 40),
      pastor: pickNonEmpty(churchRaw.pastor, fallback.church.pastor, 120),
      planner: pickNonEmpty(churchRaw.planner, fallback.church.planner, 120),
    },
    bridesmaids,
    groomsmen,
  };
}

export async function readCeremonyJsonFromGitHub(): Promise<{
  exists: boolean;
  source: 'github' | 'defaults';
  sha: string | null;
  data: CeremonyPublicData;
}> {
  const auth = await getGitHubAuthToken();
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(auth.owner)}/${encodeURIComponent(auth.repo)}/contents/${CEREMONY_JSON_REPO_PATH}?ref=${encodeURIComponent(auth.branch)}&_ts=${Date.now()}`;

  const getRes = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DalmoEJadiWeddingMedia/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (getRes.status === 404) {
    return {
      exists: false,
      source: 'defaults',
      sha: null,
      data: DEFAULT_CEREMONY_PUBLIC_DATA,
    };
  }

  if (!getRes.ok) {
    const body = (await getRes.json().catch(() => ({}))) as { message?: string };
    throw new GitHubMediaConfigError(
      `Falha ao consultar dados da cerimônia no GitHub (HTTP ${getRes.status}): ${body.message || 'erro desconhecido'}.`,
      { code: getRes.status === 401 || getRes.status === 403 ? 'GITHUB_AUTH_REJECTED' : 'GITHUB_API_ERROR', status: 502 }
    );
  }

  const fileBody = (await getRes.json()) as { sha?: string; content?: string; encoding?: string };
  if (!fileBody.content) {
    return {
      exists: Boolean(fileBody.sha),
      source: 'defaults',
      sha: fileBody.sha || null,
      data: DEFAULT_CEREMONY_PUBLIC_DATA,
    };
  }

  let parsed: unknown = null;
  try {
    const decoded = Buffer.from(fileBody.content.replace(/\s+/g, ''), 'base64').toString('utf8');
    parsed = JSON.parse(decoded);
  } catch {
    throw new GitHubMediaConfigError(
      'O arquivo public/data/cerimonia.json no GitHub contém JSON inválido.',
      { code: 'GITHUB_API_ERROR', status: 502 }
    );
  }

  return {
    exists: true,
    source: 'github',
    sha: fileBody.sha || null,
    data: normalizeCeremonyDataFromRaw(parsed, DEFAULT_CEREMONY_PUBLIC_DATA),
  };
}

export async function saveCeremonyJsonToGitHub(params: {
  church?: Partial<CeremonyChurchInfo>;
  bridesmaids?: unknown;
  groomsmen?: unknown;
  expectedSha?: string | null;
  resetPhotoToDefault?: boolean;
  actorEmail: string;
}): Promise<{
  repoPath: string;
  commitSha: string;
  sha: string;
  data: CeremonyPublicData;
}> {
  const current = await readCeremonyJsonFromGitHub();

  if (params.expectedSha !== undefined && params.expectedSha !== current.sha) {
    throw new GitHubMediaConfigError(
      'Os dados da cerimônia foram alterados recentemente no GitHub (SHA desatualizado). Recarregue a aba antes de salvar para evitar sobrescrever alterações.',
      { code: 'GITHUB_API_ERROR', status: 409 }
    );
  }

  const incomingChurch = params.church && typeof params.church === 'object' ? params.church : {};
  const keepNonEmpty = (incoming: unknown, existing: string, maxLen: number): string => {
    if (typeof incoming !== 'string') return existing;
    const trimmed = incoming.trim().slice(0, maxLen);
    return trimmed.length > 0 ? trimmed : existing;
  };
  const mergeOptional = (incoming: unknown, existing: string, maxLen: number): string => {
    if (typeof incoming !== 'string') return existing;
    return incoming.trim().slice(0, maxLen);
  };

  let nextPhotoUrl = current.data.church.photoUrl;
  if (params.resetPhotoToDefault) {
    nextPhotoUrl = DEFAULT_CHURCH_PHOTO_URL;
  } else if (typeof incomingChurch.photoUrl === 'string' && incomingChurch.photoUrl.trim()) {
    const candidatePhoto = incomingChurch.photoUrl.trim().slice(0, 600);
    if (
      !candidatePhoto.startsWith('/assets/aistudio/') &&
      !candidatePhoto.startsWith('/images/ceremony/')
    ) {
      nextPhotoUrl = candidatePhoto;
    }
  }

  const usedIds = new Set<string>();
  const nextBridesmaids =
    params.bridesmaids !== undefined
      ? sanitizeCeremonySideEntries(params.bridesmaids, 'noiva', usedIds)
      : current.data.bridesmaids.map((e) => {
          usedIds.add(e.id);
          return { ...e };
        });
  const nextGroomsmen =
    params.groomsmen !== undefined
      ? sanitizeCeremonySideEntries(params.groomsmen, 'noivo', usedIds)
      : current.data.groomsmen.map((e) => {
          usedIds.add(e.id);
          return { ...e };
        });

  const nextData: CeremonyPublicData = {
    version: (current.data.version || 0) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: params.actorEmail || 'admin',
    church: {
      name: keepNonEmpty(incomingChurch.name, current.data.church.name, 200),
      city: keepNonEmpty(incomingChurch.city, current.data.church.city, 120),
      cep: keepNonEmpty(incomingChurch.cep, current.data.church.cep, 20),
      streetAddress: keepNonEmpty(incomingChurch.streetAddress, current.data.church.streetAddress, 240),
      coordinates: mergeOptional(incomingChurch.coordinates, current.data.church.coordinates, 80),
      mapUrl: mergeOptional(incomingChurch.mapUrl, current.data.church.mapUrl, 500),
      photoUrl: nextPhotoUrl || DEFAULT_CHURCH_PHOTO_URL,
      dateDisplay: keepNonEmpty(incomingChurch.dateDisplay, current.data.church.dateDisplay, 100),
      timeDisplay: keepNonEmpty(incomingChurch.timeDisplay, current.data.church.timeDisplay, 40),
      pastor: keepNonEmpty(incomingChurch.pastor, current.data.church.pastor, 120),
      planner: keepNonEmpty(incomingChurch.planner, current.data.church.planner, 120),
    },
    bridesmaids: nextBridesmaids,
    groomsmen: nextGroomsmen,
  };

  const auth = await getGitHubAuthToken();
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(auth.owner)}/${encodeURIComponent(auth.repo)}/contents/${CEREMONY_JSON_REPO_PATH}`;
  const serialized = `${JSON.stringify(nextData, null, 2)}\n`;

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DalmoEJadiWeddingMedia/1.0',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `chore(cerimonia): atualiza informações públicas da cerimônia (v${nextData.version})`,
      content: Buffer.from(serialized, 'utf8').toString('base64'),
      branch: auth.branch,
      ...(current.sha ? { sha: current.sha } : {}),
      committer: {
        name: 'Painel Dalmo & Jadi',
        email: params.actorEmail || 'noreply@dalmoejadi.wedding',
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const putBody = (await putRes.json().catch(() => ({}))) as {
    message?: string;
    commit?: { sha?: string };
    content?: { sha?: string };
  };

  if (putRes.status === 409) {
    throw new GitHubMediaConfigError(
      'Conflito de versão (SHA) ao gravar no GitHub. Recarregue a aba Cerimônia e tente salvar novamente.',
      { code: 'GITHUB_API_ERROR', status: 409 }
    );
  }

  if (!putRes.ok || !putBody.commit?.sha || !putBody.content?.sha) {
    throw new GitHubMediaConfigError(
      `Falha ao salvar dados da cerimônia no GitHub (HTTP ${putRes.status}): ${putBody.message || 'verifique permissões Contents: write do GitHub App.'}`,
      { code: putRes.status === 401 || putRes.status === 403 ? 'GITHUB_AUTH_REJECTED' : 'GITHUB_API_ERROR', status: 502 }
    );
  }

  return {
    repoPath: CEREMONY_JSON_REPO_PATH,
    commitSha: putBody.commit.sha,
    sha: putBody.content.sha,
    data: nextData,
  };
}

