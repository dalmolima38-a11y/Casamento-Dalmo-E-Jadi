import crypto from 'crypto';
import { OFFICIAL_GIFT_CATALOG_MAP } from '../src/data/giftCatalogPrices.ts';
import type { FirebaseAdminAuthMode } from './firebaseAdmin.ts';
import {
  detectAdcAvailability,
  getFirestoreAdminAccessToken,
  isServiceAccountJsonConfigured,
  probeFirestoreAdminAccess,
} from './firebaseAdmin.ts';

export interface FirebaseServerConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

export interface GiftOrderItemInput {
  giftId: string;
  quotas: number;
  customAmountCents?: number;
}

export interface ResolvedGiftOrderItem {
  giftId: string;
  title: string;
  quotas: number;
  unitPriceCents: number;
  totalCents: number;
  isFlexible: boolean;
}

export type MercadoPagoCheckoutMethod = 'card' | 'pix';

export interface CreateMercadoPagoOrderRequest {
  orderId?: string;
  idempotencyKey?: string;
  method?: MercadoPagoCheckoutMethod;
  mode: 'gift' | 'cart' | 'custom';
  items?: GiftOrderItemInput[];
  customAmountCents?: number;
  giverName: string;
  giverContact: string;
  payerEmail?: string;
  messageToCouple?: string;
  lgpdConsent: boolean;
  orderTokenHash?: string;
}

export interface StoredMpOrderRecord {
  orderId: string;
  method: MercadoPagoCheckoutMethod;
  mpOrderId: string;
  mpPaymentId?: string;
  mpStatus: string;
  mpStatusDetail?: string;
  mpPaymentType?: string;
  checkoutUrl: string;
  pixQrCode?: string;
  pixQrCodeBase64?: string;
  pixTicketUrl?: string;
  expiresAtIso?: string;
  totalAmountCents: number;
  giftTitle: string;
  isCustomAmount: boolean;
  quotas: number;
  items: ResolvedGiftOrderItem[];
  giverName: string;
  giverContact: string;
  messageToCouple?: string;
  idempotencyKey: string;
  orderTokenHash: string;
  persistedByServer: boolean;
  isPaid: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

// In-memory store for deduplication and immediate status lookup during server uptime
const ordersById = new Map<string, StoredMpOrderRecord>();
const ordersByMpId = new Map<string, StoredMpOrderRecord>();
const ordersByIdempotency = new Map<string, StoredMpOrderRecord>();

export interface MercadoPagoSupportedMethodsInfo {
  checked: boolean;
  pix: boolean;
  card: boolean;
  activeMethodCount: number;
}

export interface MercadoPagoEnvStatus {
  configured: boolean;
  publicKeyConfigured: boolean;
  publicKey?: string;
  publicKeyError?: string;
  publicKeyModeMismatch?: boolean;
  cardBrickReady: boolean;
  accountVerified: boolean;
  testMode: boolean;
  liveMode: boolean;
  siteId?: string;
  verificationHttpStatus?: number;
  verificationError?: string;
  supportedPaymentMethods?: MercadoPagoSupportedMethodsInfo;
  webhookSecretConfigured: boolean;
  serviceAccountConfigured: boolean;
  serviceAccountJsonConfigured: boolean;
  adcAvailable?: boolean;
  firestoreAuthMode?: FirebaseAdminAuthMode;
  firestorePersistenceReady?: boolean;
}

interface CachedMpCredentialInfo {
  tokenHash: string;
  accountVerified: boolean;
  isTestAccount: boolean;
  siteId?: string;
  httpStatus: number;
  errorMessage?: string;
  supportedPaymentMethods?: MercadoPagoSupportedMethodsInfo;
  checkedAtMs: number;
}

let cachedMpCredInfo: CachedMpCredentialInfo | null = null;

export function getMercadoPagoPublicKey(): string {
  return (
    process.env.MERCADOPAGO_PUBLIC_KEY ||
    process.env.VITE_MERCADOPAGO_PUBLIC_KEY ||
    ''
  ).trim();
}

export function evaluateMercadoPagoPublicKey(
  rawPublicKey: string,
  accessToken: string,
  isTestAccount: boolean
): {
  configured: boolean;
  valid: boolean;
  safePublicKey?: string;
  error?: string;
  modeMismatch?: boolean;
} {
  const trimmed = rawPublicKey.trim();
  if (!trimmed) {
    return { configured: false, valid: false };
  }

  // CRITICAL: Never expose MERCADOPAGO_ACCESS_TOKEN (or an Access Token-shaped secret) to frontend
  const looksLikeAccessToken =
    (accessToken && trimmed === accessToken.trim()) ||
    /^(?:APP_USR|TEST)-\d{6,}-\d{4,}-[a-f0-9]+-\d+$/i.test(trimmed);
  if (looksLikeAccessToken) {
    return {
      configured: true,
      valid: false,
      error:
        'A chave informada em MERCADOPAGO_PUBLIC_KEY é um Access Token e foi bloqueada por segurança. Informe a Public Key de produção do Mercado Pago.',
    };
  }

  const keyIsTest = /^TEST-/i.test(trimmed);
  const keyIsLive = /^APP_USR-/i.test(trimmed);
  if (!keyIsTest && !keyIsLive) {
    return {
      configured: true,
      valid: false,
      error:
        'Formato inválido em MERCADOPAGO_PUBLIC_KEY. Utilize a Public Key das credenciais do Mercado Pago (APP_USR-... ou TEST-...).',
    };
  }

  if (accessToken && keyIsTest !== isTestAccount) {
    return {
      configured: true,
      valid: false,
      modeMismatch: true,
      error: isTestAccount
        ? 'Access Token está em modo Testes, mas MERCADOPAGO_PUBLIC_KEY é de Produção.'
        : 'Access Token está em Produção, mas MERCADOPAGO_PUBLIC_KEY é de Testes (TEST-). Utilize a Public Key de produção.',
    };
  }

  return {
    configured: true,
    valid: true,
    safePublicKey: trimmed,
  };
}

export function getMercadoPagoEnvStatus(): Omit<
  MercadoPagoEnvStatus,
  'accountVerified' | 'siteId' | 'verificationHttpStatus' | 'verificationError'
> & { accountVerified?: boolean; siteId?: string } {
  const token = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  const rawPublicKey = getMercadoPagoPublicKey();
  const webhookSecret = (process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
  const saJsonConfigured = isServiceAccountJsonConfigured();
  const tokenHash = token ? crypto.createHash('sha256').update(token).digest('hex') : '';
  const cachedMatches = Boolean(
    token && cachedMpCredInfo && cachedMpCredInfo.tokenHash === tokenHash
  );
  const testMode = token.startsWith('TEST-') || (cachedMatches ? Boolean(cachedMpCredInfo?.isTestAccount) : false);
  const liveMode = Boolean(token) && !testMode && (cachedMatches ? Boolean(cachedMpCredInfo?.accountVerified) : token.startsWith('APP_USR-'));
  const pkCheck = evaluateMercadoPagoPublicKey(rawPublicKey, token, testMode);

  return {
    configured: Boolean(token),
    publicKeyConfigured: pkCheck.valid,
    ...(pkCheck.safePublicKey ? { publicKey: pkCheck.safePublicKey } : {}),
    ...(pkCheck.error ? { publicKeyError: pkCheck.error } : {}),
    ...(pkCheck.modeMismatch ? { publicKeyModeMismatch: true } : {}),
    cardBrickReady: Boolean(token && pkCheck.valid),
    ...(cachedMatches ? { accountVerified: cachedMpCredInfo!.accountVerified } : {}),
    testMode,
    liveMode,
    ...(cachedMatches && cachedMpCredInfo?.siteId ? { siteId: cachedMpCredInfo.siteId } : {}),
    webhookSecretConfigured: Boolean(webhookSecret),
    serviceAccountConfigured: saJsonConfigured,
    serviceAccountJsonConfigured: saJsonConfigured,
  };
}

export async function verifyMercadoPagoEnvStatus(
  forceRefresh = false,
  firebaseConfig?: FirebaseServerConfig
): Promise<MercadoPagoEnvStatus> {
  const token = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  const publicKey = getMercadoPagoPublicKey();
  const webhookSecret = (process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
  const saJsonConfigured = isServiceAccountJsonConfigured();
  const adcAvailable = await detectAdcAvailability(forceRefresh);
  const fsProbe = firebaseConfig
    ? await probeFirestoreAdminAccess(firebaseConfig, { forceRefresh }).catch(() => null)
    : null;
  const firestorePersistenceReady = fsProbe ? fsProbe.firestoreReady : saJsonConfigured;
  const firestoreAuthMode: FirebaseAdminAuthMode = fsProbe
    ? fsProbe.authMode
    : saJsonConfigured
      ? 'service_account_json'
      : adcAvailable
        ? 'adc'
        : 'none';

  if (!token) {
    const pkCheck = evaluateMercadoPagoPublicKey(publicKey, '', false);
    return {
      configured: false,
      publicKeyConfigured: pkCheck.valid,
      ...(pkCheck.safePublicKey ? { publicKey: pkCheck.safePublicKey } : {}),
      ...(pkCheck.error ? { publicKeyError: pkCheck.error } : {}),
      cardBrickReady: false,
      accountVerified: false,
      testMode: false,
      liveMode: false,
      webhookSecretConfigured: Boolean(webhookSecret),
      serviceAccountConfigured: firestorePersistenceReady,
      serviceAccountJsonConfigured: saJsonConfigured,
      adcAvailable,
      firestoreAuthMode,
      firestorePersistenceReady,
    };
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const nowMs = Date.now();
  if (
    !forceRefresh &&
    cachedMpCredInfo &&
    cachedMpCredInfo.tokenHash === tokenHash &&
    nowMs - cachedMpCredInfo.checkedAtMs < 5 * 60_000
  ) {
    const isTest = token.startsWith('TEST-') || cachedMpCredInfo.isTestAccount;
    const pkCheck = evaluateMercadoPagoPublicKey(publicKey, token, isTest);
    return {
      configured: true,
      publicKeyConfigured: pkCheck.valid,
      ...(pkCheck.safePublicKey ? { publicKey: pkCheck.safePublicKey } : {}),
      ...(pkCheck.error ? { publicKeyError: pkCheck.error } : {}),
      ...(pkCheck.modeMismatch ? { publicKeyModeMismatch: true } : {}),
      cardBrickReady: Boolean(token && pkCheck.valid),
      accountVerified: cachedMpCredInfo.accountVerified,
      testMode: isTest,
      liveMode: cachedMpCredInfo.accountVerified && !isTest,
      ...(cachedMpCredInfo.siteId ? { siteId: cachedMpCredInfo.siteId } : {}),
      verificationHttpStatus: cachedMpCredInfo.httpStatus,
      ...(cachedMpCredInfo.errorMessage ? { verificationError: cachedMpCredInfo.errorMessage } : {}),
      ...(cachedMpCredInfo.supportedPaymentMethods
        ? { supportedPaymentMethods: cachedMpCredInfo.supportedPaymentMethods }
        : {}),
      webhookSecretConfigured: Boolean(webhookSecret),
      serviceAccountConfigured: firestorePersistenceReady,
      serviceAccountJsonConfigured: saJsonConfigured,
      adcAvailable,
      firestoreAuthMode,
      firestorePersistenceReady,
    };
  }

  try {
    const [res, pmRes] = await Promise.all([
      fetch('https://api.mercadopago.com/users/me', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(8000),
      }),
      fetch('https://api.mercadopago.com/v1/payment_methods', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null),
    ]);

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { message?: string };
      const errMsg =
        res.status === 401 || res.status === 403
          ? 'Credencial rejeitada pelo Mercado Pago (HTTP ' + res.status + ').'
          : errBody.message || `Falha na validação da credencial (HTTP ${res.status}).`;

      cachedMpCredInfo = {
        tokenHash,
        accountVerified: false,
        isTestAccount: token.startsWith('TEST-'),
        httpStatus: res.status,
        errorMessage: errMsg,
        checkedAtMs: nowMs,
      };

      const isTest = token.startsWith('TEST-');
      const pkCheck = evaluateMercadoPagoPublicKey(publicKey, token, isTest);

      return {
        configured: true,
        publicKeyConfigured: pkCheck.valid,
        ...(pkCheck.safePublicKey ? { publicKey: pkCheck.safePublicKey } : {}),
        ...(pkCheck.error ? { publicKeyError: pkCheck.error } : {}),
        ...(pkCheck.modeMismatch ? { publicKeyModeMismatch: true } : {}),
        cardBrickReady: Boolean(token && pkCheck.valid),
        accountVerified: false,
        testMode: isTest,
        liveMode: false,
        verificationHttpStatus: res.status,
        verificationError: errMsg,
        webhookSecretConfigured: Boolean(webhookSecret),
        serviceAccountConfigured: firestorePersistenceReady,
        serviceAccountJsonConfigured: saJsonConfigured,
        adcAvailable,
        firestoreAuthMode,
        firestorePersistenceReady,
      };
    }

    const userData = (await res.json()) as {
      tags?: unknown;
      site_id?: unknown;
    };
    const tags = Array.isArray(userData.tags)
      ? userData.tags.map((t) => String(t).toLowerCase())
      : [];
    const isTestAccount = token.startsWith('TEST-') || tags.includes('test_user');
    const siteId = typeof userData.site_id === 'string' ? userData.site_id : undefined;

    let supportedPaymentMethods: MercadoPagoSupportedMethodsInfo | undefined;
    if (pmRes && pmRes.ok) {
      const pmList = (await pmRes.json().catch(() => [])) as Array<{
        id?: string;
        payment_type_id?: string;
        status?: string;
      }>;
      if (Array.isArray(pmList)) {
        const activeMethods = pmList.filter(
          (m) => String(m?.status || '').toLowerCase() === 'active'
        );
        const pix = activeMethods.some((m) => String(m?.id || '').toLowerCase() === 'pix');
        const card = activeMethods.some((m) => {
          const pType = String(m?.payment_type_id || '').toLowerCase();
          return pType === 'credit_card' || pType === 'debit_card';
        });
        supportedPaymentMethods = {
          checked: true,
          pix,
          card,
          activeMethodCount: activeMethods.length,
        };
      }
    }

    cachedMpCredInfo = {
      tokenHash,
      accountVerified: true,
      isTestAccount,
      siteId,
      httpStatus: res.status,
      ...(supportedPaymentMethods ? { supportedPaymentMethods } : {}),
      checkedAtMs: nowMs,
    };

    const pkCheckOk = evaluateMercadoPagoPublicKey(publicKey, token, isTestAccount);
    return {
      configured: true,
      publicKeyConfigured: pkCheckOk.valid,
      ...(pkCheckOk.safePublicKey ? { publicKey: pkCheckOk.safePublicKey } : {}),
      ...(pkCheckOk.error ? { publicKeyError: pkCheckOk.error } : {}),
      ...(pkCheckOk.modeMismatch ? { publicKeyModeMismatch: true } : {}),
      cardBrickReady: Boolean(token && pkCheckOk.valid),
      accountVerified: true,
      testMode: isTestAccount,
      liveMode: !isTestAccount,
      ...(siteId ? { siteId } : {}),
      verificationHttpStatus: res.status,
      ...(supportedPaymentMethods ? { supportedPaymentMethods } : {}),
      webhookSecretConfigured: Boolean(webhookSecret),
      serviceAccountConfigured: firestorePersistenceReady,
      serviceAccountJsonConfigured: saJsonConfigured,
      adcAvailable,
      firestoreAuthMode,
      firestorePersistenceReady,
    };
  } catch {
    const isTestFallback = token.startsWith('TEST-');
    const pkCheckErr = evaluateMercadoPagoPublicKey(publicKey, token, isTestFallback);
    return {
      configured: true,
      publicKeyConfigured: pkCheckErr.valid,
      ...(pkCheckErr.safePublicKey ? { publicKey: pkCheckErr.safePublicKey } : {}),
      ...(pkCheckErr.error ? { publicKeyError: pkCheckErr.error } : {}),
      ...(pkCheckErr.modeMismatch ? { publicKeyModeMismatch: true } : {}),
      cardBrickReady: Boolean(token && pkCheckErr.valid),
      accountVerified: false,
      testMode: isTestFallback,
      liveMode: false,
      verificationError: 'Não foi possível contatar a API do Mercado Pago para validar o ambiente.',
      webhookSecretConfigured: Boolean(webhookSecret),
      serviceAccountConfigured: firestorePersistenceReady,
      serviceAccountJsonConfigured: saJsonConfigured,
      adcAvailable,
      firestoreAuthMode,
      firestorePersistenceReady,
    };
  }
}

export async function getFirestoreServiceAccountToken(
  _config?: FirebaseServerConfig
): Promise<string | null> {
  return getFirestoreAdminAccessToken();
}

interface FirestoreRestValue {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
  arrayValue?: { values?: FirestoreRestValue[] };
  mapValue?: { fields?: Record<string, FirestoreRestValue> };
}

function readFsString(fields: Record<string, FirestoreRestValue> | undefined, key: string): string {
  return typeof fields?.[key]?.stringValue === 'string' ? (fields[key].stringValue as string) : '';
}

function readFsInt(fields: Record<string, FirestoreRestValue> | undefined, key: string, fallback = 0): number {
  const raw = fields?.[key]?.integerValue;
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function readFsBool(fields: Record<string, FirestoreRestValue> | undefined, key: string, fallback = false): boolean {
  return typeof fields?.[key]?.booleanValue === 'boolean' ? (fields[key].booleanValue as boolean) : fallback;
}

function readFsItemsSnapshot(fields: Record<string, FirestoreRestValue> | undefined): { giftId: string; quotas: number }[] {
  const arr = fields?.itemsSnapshot?.arrayValue?.values;
  if (!Array.isArray(arr)) return [];
  const items: { giftId: string; quotas: number }[] = [];
  for (const val of arr) {
    const itemFields = val.mapValue?.fields;
    const giftId = readFsString(itemFields, 'giftId');
    const quotas = readFsInt(itemFields, 'quotas', 1);
    if (giftId && quotas >= 1) {
      items.push({ giftId, quotas });
    }
  }
  return items;
}

interface AuthoritativeGiftRecord {
  id: string;
  title: string;
  category: string;
  giftType: string;
  priceCents: number;
  active: boolean;
  totalQuotas: number;
  reservedQuotas: number;
  paidQuotas: number;
}

async function fetchAuthoritativeGift(
  config: FirebaseServerConfig,
  giftId: string,
  authToken?: string | null
): Promise<AuthoritativeGiftRecord | null> {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/gifts/${encodeURIComponent(giftId)}`;
  const attempts: Array<{ url: string; headers?: Record<string, string> }> = [];
  if (authToken) {
    attempts.push({ url: baseUrl, headers: { Authorization: `Bearer ${authToken}` } });
  }
  if (config.apiKey) {
    attempts.push({ url: `${baseUrl}?key=${encodeURIComponent(config.apiKey)}` });
  }

  try {
    for (const attempt of attempts) {
      const res = await fetch(attempt.url, {
        headers: attempt.headers,
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const docJson = (await res.json()) as { fields?: Record<string, FirestoreRestValue> };
        const f = docJson.fields;
        if (f) {
          return {
            id: giftId,
            title: readFsString(f, 'title'),
            category: readFsString(f, 'category'),
            giftType: readFsString(f, 'giftType') || 'full',
            priceCents: readFsInt(f, 'priceCents', 0),
            active: readFsBool(f, 'active', true),
            totalQuotas: readFsInt(f, 'totalQuotas', 1),
            reservedQuotas: readFsInt(f, 'reservedQuotas', 0),
            paidQuotas: readFsInt(f, 'paidQuotas', 0),
          };
        }
      }
    }
  } catch (err) {
    console.warn(`Fallback para catálogo oficial ao consultar presente ${giftId}:`, err);
  }

  const official = OFFICIAL_GIFT_CATALOG_MAP.get(giftId);
  if (!official) return null;
  return {
    id: official.id,
    title: official.title,
    category: official.category,
    giftType: official.giftType,
    priceCents: official.priceCents,
    active: true,
    totalQuotas: official.totalQuotas,
    reservedQuotas: 0,
    paidQuotas: 0,
  };
}

export function resolvePublicOrigin(req: {
  protocol: string;
  get: (name: string) => string | undefined;
}): string {
  const envAppUrl = (process.env.APP_URL || '').trim();
  if (envAppUrl && envAppUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envAppUrl)) {
    return envAppUrl.replace(/\/+$/, '');
  }
  const forwardedProto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const forwardedHost = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  return `${forwardedProto}://${forwardedHost}`;
}

export function resolveEffectiveProductionOrigin(req: {
  protocol: string;
  get: (name: string) => string | undefined;
}): {
  effectiveOrigin: string;
  currentOrigin: string;
  isPreviewOrigin: boolean;
} {
  const forwardedProto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const forwardedHost = (req.get('x-forwarded-host') || req.get('host') || 'localhost:3000')
    .split(',')[0]
    .trim();
  const requestOrigin = `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '');

  const envPublicUrl = (
    process.env.PUBLIC_APP_URL ||
    process.env.PRODUCTION_APP_URL ||
    ''
  ).trim();
  const envAppUrl = (process.env.APP_URL || '').trim();
  const candidateOrigin =
    requestOrigin && !/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(requestOrigin)
      ? requestOrigin
      : envAppUrl && envAppUrl !== 'MY_APP_URL' && /^https?:\/\//i.test(envAppUrl)
        ? envAppUrl.replace(/\/+$/, '')
        : requestOrigin;

  const isDevPreview = /^https?:\/\/ais-dev-([a-z0-9.-]+\.run\.app)$/i.test(candidateOrigin);
  const isLocal = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(candidateOrigin);

  if (envPublicUrl && /^https?:\/\//i.test(envPublicUrl)) {
    return {
      effectiveOrigin: envPublicUrl.replace(/\/+$/, ''),
      currentOrigin: candidateOrigin,
      isPreviewOrigin: isDevPreview || isLocal,
    };
  }

  if (isDevPreview) {
    return {
      effectiveOrigin: candidateOrigin.replace(/^https?:\/\/ais-dev-/i, 'https://ais-pre-'),
      currentOrigin: candidateOrigin,
      isPreviewOrigin: true,
    };
  }

  return {
    effectiveOrigin: candidateOrigin,
    currentOrigin: candidateOrigin,
    isPreviewOrigin: isLocal,
  };
}

export async function validateAndResolveOrderItems(
  config: FirebaseServerConfig,
  input: CreateMercadoPagoOrderRequest,
  saToken: string | null
): Promise<{
  items: ResolvedGiftOrderItem[];
  totalAmountCents: number;
  giftTitle: string;
  isCustomAmount: boolean;
  totalQuotas: number;
}> {
  if (input.mode === 'custom') {
    const cents = Math.round(Number(input.customAmountCents));
    if (!Number.isInteger(cents) || cents < 100 || cents > 100_000_000) {
      throw new Error('Informe um valor válido entre R$ 1,00 e R$ 1.000.000,00.');
    }
    return {
      items: [
        {
          giftId: 'custom_contribution',
          title: 'Contribuição livre para Dalmo & Jadi',
          quotas: 1,
          unitPriceCents: cents,
          totalCents: cents,
          isFlexible: true,
        },
      ],
      totalAmountCents: cents,
      giftTitle: 'Contribuição livre para Dalmo & Jadi',
      isCustomAmount: true,
      totalQuotas: 1,
    };
  }

  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 30) {
    throw new Error('Selecione ao menos um presente válido para prosseguir.');
  }

  // Merge duplicate giftIds cleanly
  const merged = new Map<string, GiftOrderItemInput>();
  for (const rawItem of input.items) {
    const giftId = String(rawItem?.giftId || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(giftId)) {
      throw new Error('Identificador de presente inválido.');
    }
    const quotas = Math.round(Number(rawItem?.quotas || 1));
    if (!Number.isInteger(quotas) || quotas < 1 || quotas > 50) {
      throw new Error('Quantidade inválida para um dos presentes selecionados.');
    }
    const prev = merged.get(giftId);
    if (prev) {
      merged.set(giftId, {
        giftId,
        quotas: Math.min(50, prev.quotas + quotas),
        customAmountCents: rawItem.customAmountCents ?? prev.customAmountCents,
      });
    } else {
      merged.set(giftId, { giftId, quotas, customAmountCents: rawItem.customAmountCents });
    }
  }

  const resolved: ResolvedGiftOrderItem[] = [];
  for (const item of merged.values()) {
    const gift = await fetchAuthoritativeGift(config, item.giftId, saToken);
    if (!gift) {
      throw new Error(`Presente não encontrado no catálogo (${item.giftId}).`);
    }
    if (!gift.active) {
      throw new Error(`O presente "${gift.title}" não está disponível no momento.`);
    }

    const isFlexible = gift.category === 'Lua de mel' || gift.giftType === 'symbolic';
    const requestedQuotas = isFlexible ? 1 : item.quotas;
    const remaining = Math.max(0, gift.totalQuotas - gift.reservedQuotas - gift.paidQuotas);
    if (remaining < requestedQuotas) {
      throw new Error(
        `O presente "${gift.title}" não possui cotas suficientes disponíveis no momento.`
      );
    }

    if (isFlexible) {
      const chosenCents =
        item.customAmountCents !== undefined
          ? Math.round(Number(item.customAmountCents))
          : gift.priceCents;
      if (!Number.isInteger(chosenCents) || chosenCents < 100 || chosenCents > 100_000_000) {
        throw new Error(`Valor inválido para "${gift.title}". Mínimo R$ 1,00.`);
      }
      resolved.push({
        giftId: gift.id,
        title: gift.title,
        quotas: 1,
        unitPriceCents: chosenCents,
        totalCents: chosenCents,
        isFlexible: true,
      });
    } else {
      // Strictly ignore any client-supplied price for fixed/quota gifts
      if (!Number.isInteger(gift.priceCents) || gift.priceCents < 100) {
        throw new Error(`Preço indisponível para "${gift.title}".`);
      }
      resolved.push({
        giftId: gift.id,
        title: gift.title,
        quotas: requestedQuotas,
        unitPriceCents: gift.priceCents,
        totalCents: gift.priceCents * requestedQuotas,
        isFlexible: false,
      });
    }
  }

  const totalAmountCents = resolved.reduce((acc, i) => acc + i.totalCents, 0);
  if (totalAmountCents < 100 || totalAmountCents > 100_000_000) {
    throw new Error('O valor total do pedido está fora dos limites permitidos.');
  }

  const totalQuotas = resolved.reduce((acc, i) => acc + i.quotas, 0);
  const giftTitle = resolved
    .map((item) =>
      item.isFlexible
        ? `${item.title} (R$ ${(item.totalCents / 100).toFixed(2).replace('.', ',')})`
        : `${item.title} (${item.quotas}x)`
    )
    .join(', ')
    .slice(0, 155);

  return {
    items: resolved,
    totalAmountCents,
    giftTitle,
    isCustomAmount: false,
    totalQuotas,
  };
}

function buildItemsSnapshotField(items: ResolvedGiftOrderItem[]): FirestoreRestValue {
  return {
    arrayValue: {
      values: items.slice(0, 30).map((item) => ({
        mapValue: {
          fields: {
            giftId: { stringValue: item.giftId.slice(0, 128) },
            title: { stringValue: item.title.slice(0, 140) },
            quotas: { integerValue: String(item.quotas) },
            unitPriceCents: { integerValue: String(item.unitPriceCents) },
            totalCents: { integerValue: String(item.totalCents) },
          },
        },
      })),
    },
  };
}

async function persistCreatedOrderViaServiceAccount(
  config: FirebaseServerConfig,
  saToken: string,
  record: StoredMpOrderRecord,
  expiryMinutes = 60
): Promise<boolean> {
  const baseDocumentsUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents`;
  const orderDocName = `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/gift_orders/${record.orderId}`;
  const expiresAtIso =
    record.expiresAtIso || new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

  const orderFields: Record<string, FirestoreRestValue> = {
    giftTitle: { stringValue: record.giftTitle.slice(0, 160) },
    itemsSnapshot: buildItemsSnapshotField(record.items),
    isCustomAmount: { booleanValue: record.isCustomAmount },
    quotas: { integerValue: String(Math.min(100, Math.max(1, record.quotas))) },
    amountCents: { integerValue: String(record.totalAmountCents) },
    giverName: { stringValue: record.giverName.slice(0, 120) },
    giverContact: { stringValue: record.giverContact.slice(0, 140) },
    status: { stringValue: 'awaiting_confirmation' },
    paymentMethod: {
      stringValue: record.method === 'pix' ? 'pix_webhook' : 'mercadopago_card',
    },
    orderTokenHash: { stringValue: record.orderTokenHash },
    idempotencyKey: { stringValue: record.idempotencyKey },
    mpOrderId: { stringValue: record.mpOrderId },
    mpTransactionStatus: { stringValue: record.mpStatus.slice(0, 60) },
    mpPaymentType: {
      stringValue: (record.mpPaymentType || (record.method === 'pix' ? 'pix' : 'checkout_pro')).slice(
        0,
        60
      ),
    },
    lgpdConsent: { booleanValue: true },
    expiresAtIso: { stringValue: expiresAtIso.slice(0, 40) },
  };

  if (record.mpPaymentId) {
    orderFields.mpPaymentId = { stringValue: record.mpPaymentId.slice(0, 128) };
  }
  if (record.mpStatusDetail) {
    orderFields.mpStatusDetail = { stringValue: record.mpStatusDetail.slice(0, 80) };
  }
  const optionalUrl = record.checkoutUrl || record.pixTicketUrl || '';
  if (optionalUrl) {
    orderFields.mpCheckoutUrl = { stringValue: optionalUrl.slice(0, 600) };
  }

  if (!record.isCustomAmount && record.items[0]?.giftId && record.items[0].giftId !== 'custom_contribution') {
    orderFields.giftId = { stringValue: record.items[0].giftId.slice(0, 128) };
  }
  if (record.messageToCouple?.trim()) {
    orderFields.messageToCouple = { stringValue: record.messageToCouple.trim().slice(0, 800) };
  }

  const writes: Record<string, unknown>[] = [
    {
      update: {
        name: orderDocName,
        fields: orderFields,
      },
      updateTransforms: [
        { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ],
      currentDocument: { exists: false },
    },
  ];

  if (!record.isCustomAmount) {
    for (const item of record.items) {
      if (item.giftId && item.giftId !== 'custom_contribution' && !item.giftId.startsWith('demo-')) {
        const giftDocName = `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/gifts/${item.giftId}`;
        // Verify gift exists in Firestore before adding quota transform
        const existsRes = await fetch(`${baseDocumentsUrl}/gifts/${encodeURIComponent(item.giftId)}`, {
          headers: { Authorization: `Bearer ${saToken}` },
          signal: AbortSignal.timeout(5000),
        });
        if (existsRes.ok) {
          writes.push({
            transform: {
              document: giftDocName,
              fieldTransforms: [
                { fieldPath: 'reservedQuotas', increment: { integerValue: String(item.quotas) } },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
            },
            currentDocument: { exists: true },
          });
        }
      }
    }
  }

  const commitRes = await fetch(`${baseDocumentsUrl}:commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${saToken}`,
    },
    body: JSON.stringify({ writes }),
    signal: AbortSignal.timeout(8000),
  });

  if (!commitRes.ok) {
    const errText = await commitRes.text().catch(() => '');
    console.warn('Não foi possível persistir pedido Mercado Pago via Service Account:', commitRes.status, errText);
    return false;
  }

  return true;
}

export interface MercadoPagoOrderPaymentEntry {
  id?: string;
  amount?: string;
  paid_amount?: string;
  status?: string;
  status_detail?: string;
  expiration_time?: string;
  date_of_expiration?: string;
  qr_data?: string;
  payment_method?: {
    id?: string;
    type?: string;
    installments?: number;
    qr_code?: string;
    qr_code_base64?: string;
    ticket_url?: string;
    data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
      qr_data?: string;
    };
  };
  point_of_interaction?: {
    type?: string;
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
}

export interface MercadoPagoOrderApiResponse {
  id: string;
  type?: string;
  processing_mode?: string;
  status?: string;
  status_detail?: string;
  total_amount?: string;
  total_paid_amount?: string;
  external_reference?: string;
  checkout_url?: string;
  expiration_time?: string;
  date_of_expiration?: string;
  qr_data?: string;
  type_response?: {
    qr_data?: string;
  };
  transactions?: {
    payments?: MercadoPagoOrderPaymentEntry[];
  };
}

function parseIsoDurationMs(isoDuration?: string): number | null {
  if (!isoDuration || typeof isoDuration !== 'string') return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(isoDuration.trim());
  if (!match) return null;
  const hours = Number.parseInt(match[1] || '0', 10);
  const minutes = Number.parseInt(match[2] || '0', 10);
  const seconds = Number.parseInt(match[3] || '0', 10);
  const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  return totalMs > 0 ? totalMs : null;
}

export function extractPixDetailsFromMpOrder(
  mpOrder: MercadoPagoOrderApiResponse,
  fallbackExpiryMinutes = 30
): {
  qrCode: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  expiresAtIso: string;
} {
  const firstPayment = mpOrder.transactions?.payments?.[0];
  const pm = firstPayment?.payment_method;
  const poiData = firstPayment?.point_of_interaction?.transaction_data;

  const qrCode = (
    pm?.qr_code ||
    pm?.data?.qr_code ||
    poiData?.qr_code ||
    firstPayment?.qr_data ||
    pm?.data?.qr_data ||
    mpOrder.type_response?.qr_data ||
    mpOrder.qr_data ||
    ''
  ).trim();

  const qrCodeBase64 = (
    pm?.qr_code_base64 ||
    pm?.data?.qr_code_base64 ||
    poiData?.qr_code_base64 ||
    ''
  ).trim() || undefined;

  const ticketUrl = (
    pm?.ticket_url ||
    pm?.data?.ticket_url ||
    poiData?.ticket_url ||
    ''
  ).trim() || undefined;

  const rawExpirationDate = (
    firstPayment?.date_of_expiration ||
    mpOrder.date_of_expiration ||
    ''
  ).trim();

  let expiresAtIso = '';
  if (rawExpirationDate) {
    const parsedDate = new Date(rawExpirationDate);
    if (!Number.isNaN(parsedDate.getTime())) {
      expiresAtIso = parsedDate.toISOString();
    }
  }
  if (!expiresAtIso) {
    const durationMs =
      parseIsoDurationMs(firstPayment?.expiration_time) ??
      parseIsoDurationMs(mpOrder.expiration_time) ??
      fallbackExpiryMinutes * 60 * 1000;
    expiresAtIso = new Date(Date.now() + durationMs).toISOString();
  }

  return {
    qrCode,
    qrCodeBase64,
    ticketUrl,
    expiresAtIso,
  };
}

export function interpretMercadoPagoOrderStatus(mpOrder: MercadoPagoOrderApiResponse) {
  const mpStatus = (mpOrder.status || 'created').toLowerCase();
  const mpStatusDetail = (mpOrder.status_detail || '').toLowerCase();
  const firstPayment = mpOrder.transactions?.payments?.[0];
  const mpPaymentId = firstPayment?.id ? String(firstPayment.id) : undefined;
  const mpPaymentStatus = (firstPayment?.status || '').toLowerCase();
  const mpPaymentDetail = (firstPayment?.status_detail || '').toLowerCase();
  const mpPaymentType = firstPayment?.payment_method?.id || firstPayment?.payment_method?.type;

  const isRefunded =
    mpStatus === 'refunded' ||
    mpPaymentStatus === 'refunded' ||
    mpStatusDetail === 'refunded' ||
    mpPaymentDetail === 'refunded';

  const isPaid =
    !isRefunded &&
    (mpStatus === 'processed' ||
      mpPaymentStatus === 'processed' ||
      mpPaymentStatus === 'approved' ||
      (mpStatusDetail === 'accredited' && mpStatus !== 'cancelled' && mpStatus !== 'expired'));

  const isExpired =
    !isPaid &&
    !isRefunded &&
    (mpStatus === 'expired' ||
      mpPaymentStatus === 'expired' ||
      mpStatusDetail === 'expired' ||
      mpPaymentDetail === 'expired');

  const isFailed =
    !isPaid &&
    (isRefunded ||
      isExpired ||
      ['cancelled', 'canceled', 'failed', 'rejected'].some(
        (s) => mpStatus === s || mpPaymentStatus === s
      ));

  const isPending = !isPaid && !isFailed;

  const paidAmountNum = Number.parseFloat(
    mpOrder.total_paid_amount ||
      firstPayment?.paid_amount ||
      (isPaid ? firstPayment?.amount || mpOrder.total_amount : '0') ||
      '0'
  );
  const orderAmountNum = Number.parseFloat(mpOrder.total_amount || firstPayment?.amount || '0');
  const paidAmountCents = Number.isNaN(paidAmountNum) ? 0 : Math.round(paidAmountNum * 100);
  const orderAmountCents = Number.isNaN(orderAmountNum) ? 0 : Math.round(orderAmountNum * 100);

  return {
    mpOrderId: String(mpOrder.id),
    mpStatus: isRefunded ? 'refunded' : mpStatus,
    mpStatusDetail: mpStatusDetail || mpPaymentDetail || undefined,
    mpPaymentId,
    mpPaymentType,
    isPaid,
    isFailed,
    isPending,
    isExpired,
    isRefunded,
    paidAmountCents: isPaid ? paidAmountCents || orderAmountCents : orderAmountCents,
  };
}

export async function createMercadoPagoCheckoutOrder(
  config: FirebaseServerConfig,
  origin: string,
  input: CreateMercadoPagoOrderRequest
): Promise<StoredMpOrderRecord & { deduplicated?: boolean }> {
  const mpToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  if (!mpToken) {
    throw new Error('MP_NOT_CONFIGURED');
  }

  const method: MercadoPagoCheckoutMethod = input.method === 'pix' ? 'pix' : 'card';
  const giverName = (input.giverName || '').trim().slice(0, 120);
  const rawContact = (input.giverContact || '').trim().slice(0, 140);
  const giverContact = rawContact.length >= 3 ? rawContact : 'Não informado';
  const candidateEmail = (input.payerEmail || '').trim();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail);

  if (giverName.length < 2) {
    throw new Error('Informe seu nome completo.');
  }
  if (!input.lgpdConsent) {
    throw new Error('É necessário concordar com a política de privacidade (LGPD).');
  }

  const rawIdempotency = (input.idempotencyKey || '').trim();
  const idempotencyKey =
    /^[a-zA-Z0-9_-]{8,128}$/.test(rawIdempotency)
      ? rawIdempotency
      : crypto.randomUUID();

  // Deduplicate identical checkout submissions
  const existingByKey = ordersByIdempotency.get(idempotencyKey);
  if (existingByKey && existingByKey.method === method) {
    return { ...existingByKey, deduplicated: true };
  }

  const rawOrderId = (input.orderId || '').trim();
  const orderId =
    /^[a-zA-Z0-9_-]{4,64}$/.test(rawOrderId)
      ? rawOrderId
      : `ord_${crypto.randomBytes(8).toString('hex')}`;

  const existingByOrderId = ordersById.get(orderId);
  if (existingByOrderId) {
    return { ...existingByOrderId, deduplicated: true };
  }

  const saToken = await getFirestoreServiceAccountToken(config).catch(() => null);
  const resolved = await validateAndResolveOrderItems(config, input, saToken);
  const totalAmountStr = (resolved.totalAmountCents / 100).toFixed(2);
  const isHttpsOrigin = origin.startsWith('https://');

  // Hosted Checkout Pro via Orders API (processing_mode: "manual") for both Pix and Card.
  // Payer email is never fabricated; when omitted, Mercado Pago collects any required buyer details on its hosted page.
  const mpPayload: Record<string, unknown> = {
    type: 'online',
    processing_mode: 'manual',
    total_amount: totalAmountStr,
    external_reference: orderId,
    description: `Presente Dalmo & Jadi — ${resolved.giftTitle}`.slice(0, 160),
    items: resolved.items.map((item) => ({
      external_code: item.giftId.slice(0, 64),
      title: item.title.slice(0, 120),
      description: 'Lista de Presentes — Casamento Dalmo & Jadi',
      quantity: item.quotas,
      unit_price: (item.unitPriceCents / 100).toFixed(2),
    })),
    ...(isEmailValid ? { payer: { email: candidateEmail } } : {}),
    config: {
      online: {
        success_url: `${origin}/obrigado?pedido=${encodeURIComponent(orderId)}&provider=mercadopago&retorno=success`,
        failure_url: `${origin}/obrigado?pedido=${encodeURIComponent(orderId)}&provider=mercadopago&retorno=failure`,
        pending_url: `${origin}/obrigado?pedido=${encodeURIComponent(orderId)}&provider=mercadopago&retorno=pending`,
        ...(isHttpsOrigin ? { auto_return: 'approved' } : {}),
      },
    },
  };

  const mpRes = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mpToken}`,
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(mpPayload),
    signal: AbortSignal.timeout(15000),
  });

  const mpData = (await mpRes.json().catch(() => ({}))) as MercadoPagoOrderApiResponse & {
    message?: string;
    errors?: { message?: string; details?: string[]; code?: string }[];
  };

  if (!mpRes.ok || !mpData.id) {
    const mpDetail =
      mpData.errors
        ?.map((e) => [e.message, ...(e.details || [])].filter(Boolean).join(' — '))
        .filter(Boolean)
        .join('; ') ||
      mpData.message ||
      `HTTP ${mpRes.status}`;
    console.error('Erro na API de Orders do Mercado Pago:', mpRes.status, JSON.stringify(mpData));
    throw new Error(`Não foi possível criar a ordem no Mercado Pago: ${mpDetail}`);
  }

  if (!mpData.checkout_url) {
    console.error('Ordem Checkout Pro criada sem checkout_url:', JSON.stringify(mpData));
    throw new Error('O Mercado Pago não retornou a URL do checkout hospedado.');
  }

  const firstPayment = mpData.transactions?.payments?.[0];
  const mpPaymentId = firstPayment?.id ? String(firstPayment.id) : undefined;
  const expiresAtIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const orderTokenHash =
    input.orderTokenHash && /^[a-f0-9]{32,128}$/i.test(input.orderTokenHash)
      ? input.orderTokenHash
      : crypto.createHash('sha256').update(crypto.randomBytes(16).toString('hex')).digest('hex');

  const nowIso = new Date().toISOString();
  const record: StoredMpOrderRecord = {
    orderId,
    method,
    mpOrderId: String(mpData.id),
    mpPaymentId,
    mpStatus: (mpData.status || 'created').toLowerCase(),
    mpStatusDetail: mpData.status_detail || firstPayment?.status_detail,
    mpPaymentType:
      firstPayment?.payment_method?.id ||
      firstPayment?.payment_method?.type ||
      (method === 'pix' ? 'pix' : 'checkout_pro'),
    checkoutUrl: String(mpData.checkout_url),
    expiresAtIso,
    totalAmountCents: resolved.totalAmountCents,
    giftTitle: resolved.giftTitle,
    isCustomAmount: resolved.isCustomAmount,
    quotas: resolved.totalQuotas,
    items: resolved.items,
    giverName,
    giverContact,
    messageToCouple: input.messageToCouple?.trim().slice(0, 800),
    idempotencyKey,
    orderTokenHash,
    persistedByServer: false,
    isPaid: false,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };

  if (saToken) {
    record.persistedByServer = await persistCreatedOrderViaServiceAccount(
      config,
      saToken,
      record,
      60
    );
  }

  ordersById.set(record.orderId, record);
  ordersByMpId.set(record.mpOrderId, record);
  ordersByIdempotency.set(record.idempotencyKey, record);

  return record;
}

export class MercadoPagoApiError extends Error {
  httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

export async function fetchMercadoPagoOrderById(
  mpOrderId: string,
  timeoutMs = 10000
): Promise<MercadoPagoOrderApiResponse> {
  const mpToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  if (!mpToken) {
    throw new Error('MP_NOT_CONFIGURED');
  }
  const res = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(mpOrderId)}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${mpToken}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new MercadoPagoApiError(
      `Erro ao consultar ordem ${mpOrderId} no Mercado Pago (${res.status}): ${txt}`,
      res.status
    );
  }
  return (await res.json()) as MercadoPagoOrderApiResponse;
}

export interface MercadoPagoDirectPaymentApiResponse {
  id?: string | number;
  status?: string;
  status_detail?: string;
  order?: { id?: string | number };
  external_reference?: string;
  transaction_amount?: number;
  transaction_details?: {
    total_paid_amount?: number;
  };
  payment_method_id?: string;
  payment_type_id?: string;
  installments?: number;
  date_of_expiration?: string;
  three_ds_info?: {
    external_resource_url?: string;
    creq?: string;
  };
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
}

export interface CreateDirectCardPaymentInput extends CreateMercadoPagoOrderRequest {
  cardToken: string;
  paymentMethodId: string;
  issuerId?: string | number;
  installments: number;
  identificationType?: string;
  identificationNumber?: string;
}

export function mapCardRejectionMessage(statusDetail?: string): string {
  switch ((statusDetail || '').toLowerCase()) {
    case 'cc_rejected_bad_filled_card_number':
      return 'Verifique o número do cartão informado e tente novamente.';
    case 'cc_rejected_bad_filled_date':
      return 'Verifique a data de validade do cartão e tente novamente.';
    case 'cc_rejected_bad_filled_security_code':
      return 'Verifique o código de segurança (CVV) e tente novamente.';
    case 'cc_rejected_bad_filled_other':
      return 'Algum dado do cartão não confere. Revise os campos e tente novamente.';
    case 'cc_rejected_call_for_authorize':
      return 'A operadora do cartão solicitou autorização prévia. Entre em contato com seu banco ou tente outro cartão.';
    case 'cc_rejected_card_disabled':
      return 'Este cartão ainda não está habilitado para compras online. Entre em contato com seu banco ou use outro cartão.';
    case 'cc_rejected_duplicated_payment':
      return 'Identificamos um pagamento recente semelhante. Aguarde alguns instantes antes de tentar novamente.';
    case 'cc_rejected_high_risk':
      return 'O pagamento não foi autorizado pela análise de segurança do cartão. Você pode tentar outro cartão ou pagar via Pix.';
    case 'cc_rejected_insufficient_amount':
      return 'Saldo ou limite insuficiente no cartão para este valor.';
    case 'cc_rejected_invalid_installments':
      return 'O número de parcelas escolhido não é suportado para este cartão.';
    case 'cc_rejected_max_attempts':
      return 'Limite de tentativas excedido para este cartão. Aguarde ou utilize outra forma de pagamento.';
    case 'cc_rejected_blacklist':
      return 'Não foi possível processar este cartão. Tente utilizar outro cartão ou pagar via Pix.';
    default:
      return 'O pagamento com cartão não foi aprovado pela operadora. Você pode revisar os dados, tentar outro cartão ou usar o Pix.';
  }
}

export function interpretMercadoPagoPaymentStatus(
  payment: MercadoPagoDirectPaymentApiResponse
) {
  const mpStatus = (payment.status || 'pending').toLowerCase();
  const mpStatusDetail = (payment.status_detail || '').toLowerCase();
  const mpPaymentId = payment.id !== undefined ? String(payment.id) : '';
  const mpOrderId = payment.order?.id !== undefined ? String(payment.order.id) : '';
  const rawPmId = (payment.payment_method_id || '').trim().toLowerCase();
  const mpPaymentType = rawPmId ? `card_brick_${rawPmId}` : 'card_brick';

  const isRefunded = mpStatus === 'refunded' || mpStatus === 'charged_back';
  const isPaid = !isRefunded && mpStatus === 'approved';
  const isExpired =
    !isPaid && !isRefunded && (mpStatus === 'cancelled' || mpStatus === 'canceled') && mpStatusDetail === 'expired';
  const isFailed =
    !isPaid &&
    (isRefunded ||
      isExpired ||
      ['rejected', 'cancelled', 'canceled'].includes(mpStatus));
  const isPending = !isPaid && !isFailed;

  const rawPaidAmount =
    typeof payment.transaction_details?.total_paid_amount === 'number' &&
    payment.transaction_details.total_paid_amount > 0
      ? payment.transaction_details.total_paid_amount
      : typeof payment.transaction_amount === 'number'
        ? payment.transaction_amount
        : 0;
  const paidAmountCents = Number.isFinite(rawPaidAmount) ? Math.round(rawPaidAmount * 100) : 0;

  return {
    mpOrderId,
    mpPaymentId,
    mpStatus: isRefunded ? 'refunded' : mpStatus,
    mpStatusDetail: mpStatusDetail || undefined,
    mpPaymentType,
    isPaid,
    isFailed,
    isPending,
    isExpired,
    isRefunded,
    paidAmountCents,
    threeDsInfo: payment.three_ds_info,
  };
}

export async function fetchMercadoPagoPaymentById(
  paymentId: string,
  timeoutMs = 10000
): Promise<MercadoPagoDirectPaymentApiResponse> {
  const mpToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  if (!mpToken) {
    throw new Error('MP_NOT_CONFIGURED');
  }
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${mpToken}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new MercadoPagoApiError(
      `Erro ao consultar pagamento ${paymentId} no Mercado Pago (${res.status}): ${txt}`,
      res.status
    );
  }
  return (await res.json()) as MercadoPagoDirectPaymentApiResponse;
}

export async function searchMercadoPagoPaymentByExternalRef(
  externalReference: string,
  throwOnApiError = false
): Promise<MercadoPagoDirectPaymentApiResponse | null> {
  const mpToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  if (!mpToken) {
    if (throwOnApiError) throw new Error('MP_NOT_CONFIGURED');
    return null;
  }
  const res = await fetch(
    `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(
      externalReference
    )}&sort=date_created&criteria=desc`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${mpToken}`,
      },
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!res.ok) {
    if (throwOnApiError && res.status !== 404 && res.status !== 400) {
      const txt = await res.text().catch(() => '');
      throw new MercadoPagoApiError(
        `Erro ao buscar pagamento por referência ${externalReference} no Mercado Pago (${res.status}): ${txt}`,
        res.status
      );
    }
    return null;
  }
  const json = (await res.json()) as { results?: MercadoPagoDirectPaymentApiResponse[] };
  const list = Array.isArray(json.results) ? json.results : [];
  if (list.length === 0) return null;
  // Prefer an approved payment when multiple retries occurred for the same reference
  return list.find((p) => (p.status || '').toLowerCase() === 'approved') || list[0];
}

export async function createMercadoPagoDirectCardPayment(
  config: FirebaseServerConfig,
  origin: string,
  input: CreateDirectCardPaymentInput
): Promise<{
  ok: boolean;
  rejected: boolean;
  rejectionMessage?: string;
  orderId: string;
  mpPaymentId: string;
  mpOrderId?: string;
  mpStatus: string;
  mpStatusDetail?: string;
  mpPaymentType: string;
  isPaid: boolean;
  isPending: boolean;
  totalAmountCents: number;
  giftTitle: string;
  isCustomAmount: boolean;
  quotas: number;
  items: ResolvedGiftOrderItem[];
  expiresAtIso: string;
  persistedByServer: boolean;
  deduplicated: boolean;
  threeDsInfo?: { external_resource_url?: string; creq?: string };
}> {
  const mpToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  if (!mpToken) {
    throw new Error('MP_NOT_CONFIGURED');
  }

  const giverName = (input.giverName || '').trim().slice(0, 120);
  const rawContact = (input.giverContact || '').trim().slice(0, 140);
  const giverContact = rawContact.length >= 3 ? rawContact : 'Não informado';
  const cardToken = (input.cardToken || '').trim();
  const paymentMethodId = (input.paymentMethodId || '').trim().toLowerCase();
  const installments = Math.round(Number(input.installments) || 1);
  const candidateEmail = (input.payerEmail || '').trim();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail);

  if (giverName.length < 2) {
    throw new Error('Informe seu nome completo.');
  }
  if (!input.lgpdConsent) {
    throw new Error('É necessário concordar com a política de privacidade (LGPD).');
  }
  if (!cardToken || cardToken.length < 6) {
    throw new Error('Token do cartão ausente ou inválido. Preencha os dados do cartão novamente.');
  }
  if (!paymentMethodId) {
    throw new Error('Bandeira ou meio de pagamento do cartão não identificado.');
  }
  if (!Number.isInteger(installments) || installments < 1 || installments > 24) {
    throw new Error('Número de parcelas inválido.');
  }
  if (!isEmailValid) {
    throw new Error('Informe um e-mail válido no formulário do cartão para processar a cobrança.');
  }

  const rawIdempotency = (input.idempotencyKey || '').trim();
  const idempotencyKey =
    /^[a-zA-Z0-9_-]{8,128}$/.test(rawIdempotency)
      ? rawIdempotency
      : crypto.randomUUID();

  const existingByKey = ordersByIdempotency.get(idempotencyKey);
  if (existingByKey && existingByKey.mpPaymentId) {
    const isRejectedCached = existingByKey.mpStatus === 'rejected' || existingByKey.mpStatus === 'cancelled';
    return {
      ok: !isRejectedCached,
      rejected: isRejectedCached,
      ...(isRejectedCached ? { rejectionMessage: mapCardRejectionMessage(existingByKey.mpStatusDetail) } : {}),
      orderId: existingByKey.orderId,
      mpPaymentId: existingByKey.mpPaymentId,
      ...(existingByKey.mpOrderId ? { mpOrderId: existingByKey.mpOrderId } : {}),
      mpStatus: existingByKey.mpStatus,
      ...(existingByKey.mpStatusDetail ? { mpStatusDetail: existingByKey.mpStatusDetail } : {}),
      mpPaymentType: existingByKey.mpPaymentType || `card_brick_${paymentMethodId}`,
      isPaid: existingByKey.isPaid,
      isPending: !existingByKey.isPaid && !isRejectedCached,
      totalAmountCents: existingByKey.totalAmountCents,
      giftTitle: existingByKey.giftTitle,
      isCustomAmount: existingByKey.isCustomAmount,
      quotas: existingByKey.quotas,
      items: existingByKey.items,
      expiresAtIso: existingByKey.expiresAtIso || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      persistedByServer: existingByKey.persistedByServer,
      deduplicated: true,
    };
  }

  const rawOrderId = (input.orderId || '').trim();
  const orderId =
    /^[a-zA-Z0-9_-]{4,64}$/.test(rawOrderId)
      ? rawOrderId
      : `ord_${crypto.randomBytes(8).toString('hex')}`;

  const saToken = await getFirestoreServiceAccountToken(config).catch(() => null);
  const resolved = await validateAndResolveOrderItems(config, input, saToken);
  const transactionAmount = Number((resolved.totalAmountCents / 100).toFixed(2));

  const nameParts = giverName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || 'Convidado';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ').slice(0, 80) : undefined;
  const cleanIdNumber = (input.identificationNumber || '').replace(/\D/g, '').slice(0, 20);
  const cleanIdType = (input.identificationType || '').trim().toUpperCase().slice(0, 10);
  const isPublicHttps = origin.startsWith('https://') && !origin.includes('localhost');

  const paymentPayload: Record<string, unknown> = {
    transaction_amount: transactionAmount,
    token: cardToken,
    description: `Presente Dalmo & Jadi — ${resolved.giftTitle}`.slice(0, 160),
    installments,
    payment_method_id: paymentMethodId,
    ...(input.issuerId !== undefined && String(input.issuerId).trim() !== ''
      ? {
          issuer_id: Number.isFinite(Number(input.issuerId))
            ? Number(input.issuerId)
            : String(input.issuerId).trim(),
        }
      : {}),
    external_reference: orderId,
    ...(isPublicHttps ? { notification_url: `${origin}/api/webhooks/mercadopago` } : {}),
    payer: {
      email: candidateEmail,
      first_name: firstName,
      ...(lastName ? { last_name: lastName } : {}),
      ...(cleanIdType && cleanIdNumber
        ? { identification: { type: cleanIdType, number: cleanIdNumber } }
        : {}),
    },
    additional_info: {
      items: resolved.items.map((item) => ({
        id: item.giftId.slice(0, 64),
        title: item.title.slice(0, 120),
        description: 'Lista de Presentes — Casamento Dalmo & Jadi',
        quantity: item.quotas,
        unit_price: Number((item.unitPriceCents / 100).toFixed(2)),
      })),
    },
    metadata: {
      order_id: orderId,
      payment_origin: 'card_brick',
    },
  };

  const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${mpToken}`,
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(paymentPayload),
    signal: AbortSignal.timeout(15000),
  });

  const mpData = (await mpRes.json().catch(() => ({}))) as MercadoPagoDirectPaymentApiResponse & {
    message?: string;
    cause?: Array<{ code?: string | number; description?: string }>;
  };

  if (!mpRes.ok || mpData.id === undefined) {
    const mpDetail =
      mpData.cause
        ?.map((c) => c.description)
        .filter(Boolean)
        .join('; ') ||
      mpData.message ||
      `HTTP ${mpRes.status}`;
    console.error('Erro na API /v1/payments do Mercado Pago:', mpRes.status, JSON.stringify(mpData));
    throw new Error(`Não foi possível processar o pagamento com cartão: ${mpDetail}`);
  }

  // Re-query authoritative payment state directly from Mercado Pago GET /v1/payments/:id
  const authoritativePayment = await fetchMercadoPagoPaymentById(String(mpData.id), 10000).catch(
    () => mpData
  );
  const interpreted = interpretMercadoPagoPaymentStatus(authoritativePayment);

  if (interpreted.isFailed) {
    return {
      ok: false,
      rejected: true,
      rejectionMessage: mapCardRejectionMessage(interpreted.mpStatusDetail),
      orderId,
      mpPaymentId: interpreted.mpPaymentId,
      ...(interpreted.mpOrderId ? { mpOrderId: interpreted.mpOrderId } : {}),
      mpStatus: interpreted.mpStatus,
      ...(interpreted.mpStatusDetail ? { mpStatusDetail: interpreted.mpStatusDetail } : {}),
      mpPaymentType: interpreted.mpPaymentType,
      isPaid: false,
      isPending: false,
      totalAmountCents: resolved.totalAmountCents,
      giftTitle: resolved.giftTitle,
      isCustomAmount: resolved.isCustomAmount,
      quotas: resolved.totalQuotas,
      items: resolved.items,
      expiresAtIso: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      persistedByServer: false,
      deduplicated: false,
      ...(interpreted.threeDsInfo ? { threeDsInfo: interpreted.threeDsInfo } : {}),
    };
  }

  const orderTokenHash =
    input.orderTokenHash && /^[a-f0-9]{32,128}$/i.test(input.orderTokenHash)
      ? input.orderTokenHash
      : crypto.createHash('sha256').update(crypto.randomBytes(16).toString('hex')).digest('hex');
  const expiresAtIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const record: StoredMpOrderRecord = {
    orderId,
    method: 'card',
    mpOrderId: interpreted.mpOrderId || '',
    mpPaymentId: interpreted.mpPaymentId,
    mpStatus: interpreted.mpStatus,
    mpStatusDetail: interpreted.mpStatusDetail,
    mpPaymentType: interpreted.mpPaymentType,
    checkoutUrl: '',
    expiresAtIso,
    totalAmountCents: resolved.totalAmountCents,
    giftTitle: resolved.giftTitle,
    isCustomAmount: resolved.isCustomAmount,
    quotas: resolved.totalQuotas,
    items: resolved.items,
    giverName,
    giverContact,
    messageToCouple: input.messageToCouple?.trim().slice(0, 800),
    idempotencyKey,
    orderTokenHash,
    persistedByServer: false,
    isPaid: interpreted.isPaid && interpreted.paidAmountCents >= resolved.totalAmountCents,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };

  if (saToken) {
    const createdViaSa = await persistCreatedOrderViaServiceAccount(config, saToken, record, 60);
    if (createdViaSa && record.isPaid) {
      const reconciled = await reconcilePaymentWithFirestore(
        config,
        saToken,
        orderId,
        authoritativePayment
      );
      record.persistedByServer = reconciled.updated || createdViaSa;
    } else {
      record.persistedByServer = createdViaSa;
    }
  }

  ordersById.set(record.orderId, record);
  if (record.mpOrderId) {
    ordersByMpId.set(record.mpOrderId, record);
  }
  ordersByIdempotency.set(record.idempotencyKey, record);

  return {
    ok: true,
    rejected: false,
    orderId: record.orderId,
    mpPaymentId: interpreted.mpPaymentId,
    ...(interpreted.mpOrderId ? { mpOrderId: interpreted.mpOrderId } : {}),
    mpStatus: interpreted.mpStatus,
    ...(interpreted.mpStatusDetail ? { mpStatusDetail: interpreted.mpStatusDetail } : {}),
    mpPaymentType: interpreted.mpPaymentType,
    isPaid: record.isPaid,
    isPending: !record.isPaid,
    totalAmountCents: record.totalAmountCents,
    giftTitle: record.giftTitle,
    isCustomAmount: record.isCustomAmount,
    quotas: record.quotas,
    items: record.items,
    expiresAtIso,
    persistedByServer: record.persistedByServer,
    deduplicated: false,
    ...(interpreted.threeDsInfo ? { threeDsInfo: interpreted.threeDsInfo } : {}),
  };
}

function isNotFoundMpStatus(err: unknown): boolean {
  return err instanceof MercadoPagoApiError && (err.httpStatus === 404 || err.httpStatus === 400);
}

/**
 * Queries Mercado Pago API authoritatively for an incoming webhook event.
 * Handles both Orders API orders and standalone Card Brick Payments API payments.
 */
export async function lookupMercadoPagoOrderForWebhook(params: {
  dataId: string;
  eventKind: string;
  action?: string;
}): Promise<{
  mpOrder: MercadoPagoOrderApiResponse | null;
  mpPayment?: MercadoPagoDirectPaymentApiResponse | null;
  reason?: string;
}> {
  const dataId = params.dataId.trim();
  const kind = params.eventKind.trim().toLowerCase();
  const action = (params.action || '').trim().toLowerCase();

  const isOrderEvent =
    kind === 'order' ||
    kind === 'orders' ||
    kind === 'topic_orders_wh' ||
    action.startsWith('order.');
  const isPaymentEvent = kind === 'payment' || kind === 'payments' || action.startsWith('payment.');

  if (isOrderEvent) {
    try {
      const mpOrder = await fetchMercadoPagoOrderById(dataId, 4500);
      return { mpOrder };
    } catch (err) {
      if (isNotFoundMpStatus(err)) {
        return { mpOrder: null, reason: 'order_not_found' };
      }
      throw err;
    }
  }

  if (isPaymentEvent) {
    let payment: MercadoPagoDirectPaymentApiResponse;
    try {
      payment = await fetchMercadoPagoPaymentById(dataId, 4500);
    } catch (err) {
      if (isNotFoundMpStatus(err)) {
        return { mpOrder: null, reason: 'payment_not_found' };
      }
      throw err;
    }

    if (payment.order?.id) {
      try {
        const mpOrder = await fetchMercadoPagoOrderById(String(payment.order.id), 4500);
        return { mpOrder, mpPayment: payment };
      } catch (err) {
        if (!isNotFoundMpStatus(err)) {
          throw err;
        }
      }
    }
    if (payment.external_reference) {
      const mpOrder = await searchMercadoPagoOrderByExternalRef(payment.external_reference);
      if (mpOrder) {
        return { mpOrder, mpPayment: payment };
      }
      // Direct Card Brick /v1/payments has no v1/orders parent — return standalone payment
      return { mpOrder: null, mpPayment: payment };
    }
    return { mpOrder: null, mpPayment: payment, reason: 'payment_without_reference' };
  }

  // Ambiguous notification topic: try Order first, then Payment only if 404/400
  try {
    const mpOrder = await fetchMercadoPagoOrderById(dataId, 4500);
    return { mpOrder };
  } catch (err) {
    if (!isNotFoundMpStatus(err)) {
      throw err;
    }
  }

  try {
    const payment = await fetchMercadoPagoPaymentById(dataId, 4500);
    if (payment.order?.id) {
      const mpOrder = await fetchMercadoPagoOrderById(String(payment.order.id), 4500).catch((err) => {
        if (isNotFoundMpStatus(err)) return null;
        throw err;
      });
      if (mpOrder) {
        return { mpOrder, mpPayment: payment };
      }
    }
    if (payment.external_reference) {
      const mpOrder = await searchMercadoPagoOrderByExternalRef(payment.external_reference);
      if (mpOrder) {
        return { mpOrder, mpPayment: payment };
      }
      return { mpOrder: null, mpPayment: payment };
    }
    return { mpOrder: null, mpPayment: payment, reason: 'payment_without_reference' };
  } catch (err) {
    if (isNotFoundMpStatus(err)) {
      return { mpOrder: null, reason: 'resource_not_found' };
    }
    throw err;
  }
}

export async function searchMercadoPagoOrderByExternalRef(
  externalReference: string,
  throwOnApiError = false
): Promise<MercadoPagoOrderApiResponse | null> {
  const mpToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  if (!mpToken) {
    if (throwOnApiError) throw new Error('MP_NOT_CONFIGURED');
    return null;
  }
  const res = await fetch(
    `https://api.mercadopago.com/v1/orders?external_reference=${encodeURIComponent(externalReference)}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${mpToken}`,
      },
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!res.ok) {
    if (throwOnApiError && res.status !== 404 && res.status !== 400) {
      const txt = await res.text().catch(() => '');
      throw new MercadoPagoApiError(
        `Erro ao buscar ordem por referência ${externalReference} no Mercado Pago (${res.status}): ${txt}`,
        res.status
      );
    }
    return null;
  }
  const json = (await res.json()) as { data?: MercadoPagoOrderApiResponse[]; results?: MercadoPagoOrderApiResponse[] };
  const list = json.data || json.results || [];
  return list[0] || null;
}

export interface PendingFirestoreGiftOrder {
  orderId: string;
  status: string;
  paymentMethod: string;
  mpOrderId: string;
  mpPaymentId: string;
  mpPaymentType: string;
  receiptNote: string;
  amountCents: number;
  giverName: string;
  adminArchived: boolean;
}

export async function listPendingGiftOrdersForAdmin(
  config: FirebaseServerConfig,
  idToken: string
): Promise<PendingFirestoreGiftOrder[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'gift_orders' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'IN',
            value: {
              arrayValue: {
                values: [
                  { stringValue: 'awaiting_confirmation' },
                  { stringValue: 'reserved' },
                ],
              },
            },
          },
        },
        limit: 200,
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    throw new Error(`FIRESTORE_LIST_FAILED:${res.status}:${errTxt.slice(0, 240)}`);
  }

  const rows = (await res.json()) as Array<{
    document?: { name?: string; fields?: Record<string, FirestoreRestValue> };
  }>;
  const results: PendingFirestoreGiftOrder[] = [];
  for (const row of rows) {
    const docName = row.document?.name;
    const f = row.document?.fields;
    if (!docName || !f) continue;
    const orderId = docName.split('/').pop() || '';
    if (!orderId) continue;
    const adminArchived = readFsBool(f, 'adminArchived', false);
    if (adminArchived) continue;
    results.push({
      orderId,
      status: readFsString(f, 'status'),
      paymentMethod: readFsString(f, 'paymentMethod'),
      mpOrderId: readFsString(f, 'mpOrderId'),
      mpPaymentId: readFsString(f, 'mpPaymentId'),
      mpPaymentType: readFsString(f, 'mpPaymentType'),
      receiptNote: readFsString(f, 'receiptNote'),
      amountCents: readFsInt(f, 'amountCents', 0),
      giverName: readFsString(f, 'giverName'),
      adminArchived,
    });
  }
  return results;
}

const processedWebhookDeliveries = new Map<string, number>();
const WEBHOOK_DEDUP_TTL_MS = 15 * 60_000;
const reconcileLocks = new Map<string, Promise<unknown>>();

export function isDuplicateWebhookDelivery(deliveryKey: string): boolean {
  if (!deliveryKey) return false;
  const expiresAt = processedWebhookDeliveries.get(deliveryKey);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    processedWebhookDeliveries.delete(deliveryKey);
    return false;
  }
  return true;
}

export function markWebhookDeliveryProcessed(deliveryKey: string): void {
  if (!deliveryKey) return;
  const now = Date.now();
  if (processedWebhookDeliveries.size >= 1000) {
    for (const [key, exp] of processedWebhookDeliveries.entries()) {
      if (now > exp) processedWebhookDeliveries.delete(key);
    }
    if (processedWebhookDeliveries.size >= 1000) {
      const oldest = processedWebhookDeliveries.keys().next().value;
      if (oldest) processedWebhookDeliveries.delete(oldest);
    }
  }
  processedWebhookDeliveries.set(deliveryKey, now + WEBHOOK_DEDUP_TTL_MS);
}

export async function withOrderReconcileLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  const prev = reconcileLocks.get(orderId) || Promise.resolve();
  const next = prev.catch(() => undefined).then(() => fn());
  reconcileLocks.set(orderId, next);
  try {
    return await next;
  } finally {
    if (reconcileLocks.get(orderId) === next) {
      reconcileLocks.delete(orderId);
    }
  }
}

export async function reconcileOrderWithFirestore(
  config: FirebaseServerConfig,
  bearerToken: string,
  orderId: string,
  mpOrder: MercadoPagoOrderApiResponse,
  logActor?: { uid: string; email: string }
): Promise<{
  updated: boolean;
  alreadyConfirmed?: boolean;
  amountMismatch?: boolean;
  referenceMismatch?: boolean;
  firestoreStatus: string;
  persistError?: string;
  persistHttpStatus?: number;
  interpreted: ReturnType<typeof interpretMercadoPagoOrderStatus>;
}> {
  const interpreted = interpretMercadoPagoOrderStatus(mpOrder);

  // Security guard: verify external_reference matches orderId when provided by Mercado Pago
  if (mpOrder.external_reference && mpOrder.external_reference.trim() !== orderId) {
    console.warn(
      `Reconciliação bloqueada por divergência de external_reference: esperado=${orderId}, MP=${mpOrder.external_reference}`
    );
    return {
      updated: false,
      referenceMismatch: true,
      firestoreStatus: 'reference_mismatch',
      persistError: `Referência externa divergente no Mercado Pago (esperado: ${orderId}, recebido: ${mpOrder.external_reference}).`,
      interpreted,
    };
  }

  const baseDocumentsUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents`;
  const orderDocPath = `${baseDocumentsUrl}/gift_orders/${encodeURIComponent(orderId)}`;
  const orderDocName = `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/gift_orders/${orderId}`;

  const orderRes = await fetch(orderDocPath, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(8000),
  });

  if (!orderRes.ok) {
    const errTxt = await orderRes.text().catch(() => '');
    const isPerm = orderRes.status === 401 || orderRes.status === 403;
    return {
      updated: false,
      firestoreStatus: isPerm ? 'permission_denied' : orderRes.status === 404 ? 'not_found' : 'read_error',
      persistError: isPerm
        ? 'Sem permissão autenticada no Firestore para ler este pedido.'
        : orderRes.status === 404
          ? 'Pedido não encontrado no Firestore.'
          : `Erro ao ler pedido no Firestore (HTTP ${orderRes.status}): ${errTxt.slice(0, 160)}`,
      persistHttpStatus: orderRes.status,
      interpreted,
    };
  }

  const orderDoc = (await orderRes.json()) as {
    updateTime?: string;
    fields?: Record<string, FirestoreRestValue>;
  };
  const fields = orderDoc.fields;
  const currentStatus = readFsString(fields, 'status');
  const currentPaymentMethod = readFsString(fields, 'paymentMethod');
  const currentMpOrderId = readFsString(fields, 'mpOrderId');
  const currentMpTxStatus = readFsString(fields, 'mpTransactionStatus');
  const currentMpPaymentId = readFsString(fields, 'mpPaymentId');
  const expectedAmountCents = readFsInt(fields, 'amountCents', 0);
  const isCustomAmount = readFsBool(fields, 'isCustomAmount', false);
  const primaryGiftId = readFsString(fields, 'giftId');
  const totalQuotas = readFsInt(fields, 'quotas', 1);
  const itemsSnapshot = readFsItemsSnapshot(fields);

  // Security guard: verify MP Order ID matches Firestore record when both exist (and require at least external_reference or mpOrderId match)
  const mpOrderIdMatchesRecord =
    Boolean(currentMpOrderId) && currentMpOrderId === interpreted.mpOrderId;
  const externalRefMatchesRecord =
    typeof mpOrder.external_reference === 'string' &&
    mpOrder.external_reference.trim() === orderId;
  if ((currentMpOrderId && currentMpOrderId !== interpreted.mpOrderId) || (!mpOrderIdMatchesRecord && !externalRefMatchesRecord)) {
    return {
      updated: false,
      referenceMismatch: true,
      firestoreStatus: currentStatus || 'reference_mismatch',
      persistError: `Identificador da ordem Mercado Pago divergente para o pedido ${orderId}.`,
      interpreted,
    };
  }

  // Verify amount integrity before confirming
  const amountMatches =
    expectedAmountCents > 0 && interpreted.paidAmountCents >= expectedAmountCents;
  const amountMismatch = interpreted.isPaid && !amountMatches;
  if (amountMismatch) {
    console.warn(
      `Reconciliação bloqueada por divergência de valor no pedido ${orderId}: esperado=${expectedAmountCents}, pagoMP=${interpreted.paidAmountCents}`
    );
    return {
      updated: false,
      amountMismatch: true,
      firestoreStatus: currentStatus || 'amount_mismatch',
      interpreted,
    };
  }

  let targetStatus = currentStatus || 'awaiting_confirmation';
  if (interpreted.isRefunded) {
    targetStatus = 'cancelled';
  } else if (interpreted.isPaid && amountMatches) {
    targetStatus = 'confirmed';
  } else if (interpreted.isFailed && currentStatus !== 'confirmed') {
    targetStatus = interpreted.isExpired ? 'expired' : 'cancelled';
  } else if (currentStatus !== 'confirmed') {
    targetStatus = 'awaiting_confirmation';
  }

  // Update in-memory cache as well
  const mem = ordersById.get(orderId) || ordersByMpId.get(interpreted.mpOrderId);
  if (mem) {
    mem.mpStatus = interpreted.mpStatus;
    mem.mpStatusDetail = interpreted.mpStatusDetail;
    mem.mpPaymentId = interpreted.mpPaymentId;
    mem.mpPaymentType = interpreted.mpPaymentType;
    mem.isPaid = targetStatus === 'confirmed';
    mem.updatedAtIso = new Date().toISOString();
  }

  const isPixOrder =
    interpreted.mpPaymentType === 'pix' ||
    interpreted.mpPaymentType === 'bank_transfer' ||
    currentPaymentMethod === 'pix_webhook';

  // Idempotency: if order is already in the exact target state with same MP state, avoid redundant writes
  if (
    currentStatus === targetStatus &&
    currentMpOrderId === interpreted.mpOrderId.slice(0, 128) &&
    currentMpTxStatus === interpreted.mpStatus.slice(0, 60) &&
    (!interpreted.mpPaymentId || currentMpPaymentId === interpreted.mpPaymentId.slice(0, 128)) &&
    (!isPixOrder || currentPaymentMethod === 'pix_webhook')
  ) {
    return {
      updated: false,
      alreadyConfirmed: currentStatus === 'confirmed',
      amountMismatch,
      firestoreStatus: currentStatus,
      interpreted,
    };
  }

  const updateFields: Record<string, FirestoreRestValue> = {
    status: { stringValue: targetStatus },
    mpOrderId: { stringValue: interpreted.mpOrderId.slice(0, 128) },
    mpTransactionStatus: { stringValue: interpreted.mpStatus.slice(0, 60) },
  };
  const fieldPaths = ['status', 'mpOrderId', 'mpTransactionStatus'];

  if (isPixOrder && currentPaymentMethod !== 'pix_webhook') {
    updateFields.paymentMethod = { stringValue: 'pix_webhook' };
    fieldPaths.push('paymentMethod');
  }

  if (interpreted.mpPaymentId) {
    updateFields.mpPaymentId = { stringValue: interpreted.mpPaymentId.slice(0, 128) };
    fieldPaths.push('mpPaymentId');
  }
  if (interpreted.mpStatusDetail) {
    updateFields.mpStatusDetail = { stringValue: interpreted.mpStatusDetail.slice(0, 80) };
    fieldPaths.push('mpStatusDetail');
  }
  if (interpreted.mpPaymentType) {
    updateFields.mpPaymentType = { stringValue: interpreted.mpPaymentType.slice(0, 60) };
    fieldPaths.push('mpPaymentType');
  }

  const transitioningToConfirmed = targetStatus === 'confirmed' && currentStatus !== 'confirmed';
  const transitioningToCancelled =
    (targetStatus === 'cancelled' || targetStatus === 'expired') &&
    (currentStatus === 'reserved' || currentStatus === 'awaiting_confirmation');
  const transitioningRefundFromConfirmed =
    interpreted.isRefunded && targetStatus === 'cancelled' && currentStatus === 'confirmed';

  if (transitioningToConfirmed && !readFsString(fields, 'confirmedAtIso')) {
    updateFields.confirmedAtIso = { stringValue: new Date().toISOString().slice(0, 40) };
    fieldPaths.push('confirmedAtIso');
  }

  const writes: Record<string, unknown>[] = [
    {
      update: {
        name: orderDocName,
        fields: updateFields,
      },
      updateMask: { fieldPaths },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: orderDoc.updateTime
        ? { updateTime: orderDoc.updateTime }
        : { exists: true },
    },
  ];

  // Quota transitions (idempotent: only on state transition!)
  if (
    !isCustomAmount &&
    (transitioningToConfirmed || transitioningToCancelled || transitioningRefundFromConfirmed)
  ) {
    const quotaTargets =
      itemsSnapshot.length > 0
        ? itemsSnapshot
        : primaryGiftId
          ? [{ giftId: primaryGiftId, quotas: totalQuotas }]
          : [];

    for (const target of quotaTargets) {
      if (!target.giftId || target.giftId === 'custom_contribution' || target.giftId.startsWith('demo-')) {
        continue;
      }
      const giftRes = await fetch(`${baseDocumentsUrl}/gifts/${encodeURIComponent(target.giftId)}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!giftRes.ok) continue;
      const giftDoc = (await giftRes.json()) as {
        updateTime?: string;
        fields?: Record<string, FirestoreRestValue>;
      };
      const currentReserved = readFsInt(giftDoc.fields, 'reservedQuotas', 0);
      const currentPaid = readFsInt(giftDoc.fields, 'paidQuotas', 0);
      const giftTotal = readFsInt(giftDoc.fields, 'totalQuotas', 1);

      const giftTransforms: Record<string, unknown>[] = [
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ];

      if (transitioningRefundFromConfirmed) {
        const undoPaid = Math.min(currentPaid, target.quotas);
        if (undoPaid > 0) {
          giftTransforms.push({
            fieldPath: 'paidQuotas',
            increment: { integerValue: String(-undoPaid) },
          });
        }
      } else {
        const releaseQty = Math.min(currentReserved, target.quotas);
        if (releaseQty > 0) {
          giftTransforms.push({
            fieldPath: 'reservedQuotas',
            increment: { integerValue: String(-releaseQty) },
          });
        }
        if (transitioningToConfirmed) {
          const room = Math.max(0, giftTotal - (currentReserved - releaseQty) - currentPaid);
          const addPaid = Math.min(room, target.quotas);
          if (addPaid > 0) {
            giftTransforms.push({
              fieldPath: 'paidQuotas',
              increment: { integerValue: String(addPaid) },
            });
          }
        }
      }

      if (giftTransforms.length > 1) {
        writes.push({
          transform: {
            document: `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/gifts/${target.giftId}`,
            fieldTransforms: giftTransforms,
          },
          currentDocument: giftDoc.updateTime
            ? { updateTime: giftDoc.updateTime }
            : { exists: true },
        });
      }
    }
  }

  if (logActor && (transitioningToConfirmed || transitioningToCancelled || transitioningRefundFromConfirmed)) {
    const logId = `log_${crypto.randomBytes(6).toString('hex')}`;
    const methodText = isPixOrder ? 'Pix Automático' : 'Cartão';
    writes.push({
      update: {
        name: `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/admin_logs/${logId}`,
        fields: {
          actorUid: { stringValue: logActor.uid },
          actorEmail: { stringValue: logActor.email.slice(0, 200) },
          action: {
            stringValue: transitioningToConfirmed
              ? `Pagamento ${methodText} (Mercado Pago) confirmado`
              : transitioningRefundFromConfirmed
                ? `Pagamento ${methodText} (Mercado Pago) reembolsado`
                : `Pedido ${methodText} (Mercado Pago) cancelado/expirado`,
          },
          details: {
            stringValue: `Pedido ${orderId} · MP Order ${interpreted.mpOrderId}${interpreted.mpPaymentId ? ` · Pagamento ${interpreted.mpPaymentId}` : ''}`.slice(
              0,
              500
            ),
          },
        },
      },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    });
  }

  const commitRes = await fetch(`${baseDocumentsUrl}:commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ writes }),
    signal: AbortSignal.timeout(10000),
  });

  if (!commitRes.ok) {
    const errTxt = await commitRes.text().catch(() => '');
    console.error('Falha ao atualizar pedido Mercado Pago no Firestore:', commitRes.status, errTxt);
    let parsedMsg = '';
    try {
      const parsed = JSON.parse(errTxt) as { error?: { message?: string; status?: string } };
      parsedMsg = parsed.error?.message || parsed.error?.status || '';
    } catch {
      // ignore parse failure
    }
    return {
      updated: false,
      amountMismatch,
      firestoreStatus: currentStatus,
      persistError:
        commitRes.status === 401 || commitRes.status === 403
          ? `O Firestore recusou a gravação autenticada (${parsedMsg || 'PERMISSION_DENIED'}).`
          : `Não foi possível gravar a atualização no Firestore (HTTP ${commitRes.status}${parsedMsg ? `: ${parsedMsg}` : ''}).`,
      persistHttpStatus: commitRes.status,
      interpreted,
    };
  }

  return {
    updated: true,
    alreadyConfirmed: currentStatus === 'confirmed' && targetStatus === 'confirmed',
    amountMismatch,
    firestoreStatus: targetStatus,
    interpreted,
  };
}

export async function reconcilePaymentWithFirestore(
  config: FirebaseServerConfig,
  bearerToken: string,
  orderId: string,
  payment: MercadoPagoDirectPaymentApiResponse,
  logActor?: { uid: string; email: string }
): Promise<{
  updated: boolean;
  alreadyConfirmed?: boolean;
  amountMismatch?: boolean;
  referenceMismatch?: boolean;
  firestoreStatus: string;
  persistError?: string;
  persistHttpStatus?: number;
  interpreted: ReturnType<typeof interpretMercadoPagoPaymentStatus>;
}> {
  const interpreted = interpretMercadoPagoPaymentStatus(payment);

  if (payment.external_reference && payment.external_reference.trim() !== orderId) {
    console.warn(
      `Reconciliação de pagamento bloqueada por divergência de external_reference: esperado=${orderId}, MP=${payment.external_reference}`
    );
    return {
      updated: false,
      referenceMismatch: true,
      firestoreStatus: 'reference_mismatch',
      persistError: `Referência externa divergente no Mercado Pago (esperado: ${orderId}, recebido: ${payment.external_reference}).`,
      interpreted,
    };
  }

  const baseDocumentsUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents`;
  const orderDocPath = `${baseDocumentsUrl}/gift_orders/${encodeURIComponent(orderId)}`;
  const orderDocName = `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/gift_orders/${orderId}`;

  const orderRes = await fetch(orderDocPath, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    signal: AbortSignal.timeout(8000),
  });

  if (!orderRes.ok) {
    const errTxt = await orderRes.text().catch(() => '');
    const isPerm = orderRes.status === 401 || orderRes.status === 403;
    return {
      updated: false,
      firestoreStatus: isPerm ? 'permission_denied' : orderRes.status === 404 ? 'not_found' : 'read_error',
      persistError: isPerm
        ? 'Sem permissão autenticada no Firestore para ler este pedido.'
        : orderRes.status === 404
          ? 'Pedido não encontrado no Firestore.'
          : `Erro ao ler pedido no Firestore (HTTP ${orderRes.status}): ${errTxt.slice(0, 160)}`,
      persistHttpStatus: orderRes.status,
      interpreted,
    };
  }

  const orderDoc = (await orderRes.json()) as {
    updateTime?: string;
    fields?: Record<string, FirestoreRestValue>;
  };
  const fields = orderDoc.fields;
  const currentStatus = readFsString(fields, 'status');
  const currentMpTxStatus = readFsString(fields, 'mpTransactionStatus');
  const currentMpPaymentId = readFsString(fields, 'mpPaymentId');
  const currentMpPaymentType = readFsString(fields, 'mpPaymentType');
  const expectedAmountCents = readFsInt(fields, 'amountCents', 0);
  const isCustomAmount = readFsBool(fields, 'isCustomAmount', false);
  const primaryGiftId = readFsString(fields, 'giftId');
  const totalQuotas = readFsInt(fields, 'quotas', 1);
  const itemsSnapshot = readFsItemsSnapshot(fields);

  const externalRefMatchesRecord =
    typeof payment.external_reference === 'string' && payment.external_reference.trim() === orderId;
  const paymentIdMatchesRecord =
    Boolean(currentMpPaymentId) && currentMpPaymentId === interpreted.mpPaymentId;
  if (
    (currentMpPaymentId && currentMpPaymentId !== interpreted.mpPaymentId) ||
    (!externalRefMatchesRecord && !paymentIdMatchesRecord)
  ) {
    return {
      updated: false,
      referenceMismatch: true,
      firestoreStatus: currentStatus || 'reference_mismatch',
      persistError: `Identificador do pagamento Mercado Pago divergente para o pedido ${orderId}.`,
      interpreted,
    };
  }

  const amountMatches =
    expectedAmountCents > 0 && interpreted.paidAmountCents >= expectedAmountCents;
  const amountMismatch = interpreted.isPaid && !amountMatches;
  if (amountMismatch) {
    console.warn(
      `Reconciliação de pagamento bloqueada por divergência de valor no pedido ${orderId}: esperado=${expectedAmountCents}, pagoMP=${interpreted.paidAmountCents}`
    );
    return {
      updated: false,
      amountMismatch: true,
      firestoreStatus: currentStatus || 'amount_mismatch',
      interpreted,
    };
  }

  let targetStatus = currentStatus || 'awaiting_confirmation';
  if (interpreted.isRefunded) {
    targetStatus = 'cancelled';
  } else if (interpreted.isPaid && amountMatches) {
    targetStatus = 'confirmed';
  } else if (interpreted.isFailed && currentStatus !== 'confirmed') {
    targetStatus = interpreted.isExpired ? 'expired' : 'cancelled';
  } else if (currentStatus !== 'confirmed') {
    targetStatus = 'awaiting_confirmation';
  }

  updateInMemoryMpPaymentStatus(orderId, payment);

  if (
    currentStatus === targetStatus &&
    currentMpPaymentId === interpreted.mpPaymentId.slice(0, 128) &&
    currentMpTxStatus === interpreted.mpStatus.slice(0, 60) &&
    currentMpPaymentType === interpreted.mpPaymentType.slice(0, 60)
  ) {
    return {
      updated: false,
      alreadyConfirmed: currentStatus === 'confirmed',
      amountMismatch,
      firestoreStatus: currentStatus,
      interpreted,
    };
  }

  const updateFields: Record<string, FirestoreRestValue> = {
    status: { stringValue: targetStatus },
    mpPaymentId: { stringValue: interpreted.mpPaymentId.slice(0, 128) },
    mpTransactionStatus: { stringValue: interpreted.mpStatus.slice(0, 60) },
    mpPaymentType: { stringValue: interpreted.mpPaymentType.slice(0, 60) },
  };
  const fieldPaths = ['status', 'mpPaymentId', 'mpTransactionStatus', 'mpPaymentType'];

  if (interpreted.mpOrderId) {
    updateFields.mpOrderId = { stringValue: interpreted.mpOrderId.slice(0, 128) };
    fieldPaths.push('mpOrderId');
  }
  if (interpreted.mpStatusDetail) {
    updateFields.mpStatusDetail = { stringValue: interpreted.mpStatusDetail.slice(0, 80) };
    fieldPaths.push('mpStatusDetail');
  }

  const transitioningToConfirmed = targetStatus === 'confirmed' && currentStatus !== 'confirmed';
  const transitioningToCancelled =
    (targetStatus === 'cancelled' || targetStatus === 'expired') &&
    (currentStatus === 'reserved' || currentStatus === 'awaiting_confirmation');
  const transitioningRefundFromConfirmed =
    interpreted.isRefunded && targetStatus === 'cancelled' && currentStatus === 'confirmed';

  if (transitioningToConfirmed && !readFsString(fields, 'confirmedAtIso')) {
    updateFields.confirmedAtIso = { stringValue: new Date().toISOString().slice(0, 40) };
    fieldPaths.push('confirmedAtIso');
  }

  const writes: Record<string, unknown>[] = [
    {
      update: {
        name: orderDocName,
        fields: updateFields,
      },
      updateMask: { fieldPaths },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: orderDoc.updateTime
        ? { updateTime: orderDoc.updateTime }
        : { exists: true },
    },
  ];

  if (
    !isCustomAmount &&
    (transitioningToConfirmed || transitioningToCancelled || transitioningRefundFromConfirmed)
  ) {
    const quotaTargets =
      itemsSnapshot.length > 0
        ? itemsSnapshot
        : primaryGiftId
          ? [{ giftId: primaryGiftId, quotas: totalQuotas }]
          : [];

    for (const target of quotaTargets) {
      if (!target.giftId || target.giftId === 'custom_contribution' || target.giftId.startsWith('demo-')) {
        continue;
      }
      const giftRes = await fetch(`${baseDocumentsUrl}/gifts/${encodeURIComponent(target.giftId)}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!giftRes.ok) continue;
      const giftDoc = (await giftRes.json()) as {
        updateTime?: string;
        fields?: Record<string, FirestoreRestValue>;
      };
      const currentReserved = readFsInt(giftDoc.fields, 'reservedQuotas', 0);
      const currentPaid = readFsInt(giftDoc.fields, 'paidQuotas', 0);
      const giftTotal = readFsInt(giftDoc.fields, 'totalQuotas', 1);

      const giftTransforms: Record<string, unknown>[] = [
        { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
      ];

      if (transitioningRefundFromConfirmed) {
        const undoPaid = Math.min(currentPaid, target.quotas);
        if (undoPaid > 0) {
          giftTransforms.push({
            fieldPath: 'paidQuotas',
            increment: { integerValue: String(-undoPaid) },
          });
        }
      } else {
        const releaseQty = Math.min(currentReserved, target.quotas);
        if (releaseQty > 0) {
          giftTransforms.push({
            fieldPath: 'reservedQuotas',
            increment: { integerValue: String(-releaseQty) },
          });
        }
        if (transitioningToConfirmed) {
          const room = Math.max(0, giftTotal - (currentReserved - releaseQty) - currentPaid);
          const addPaid = Math.min(room, target.quotas);
          if (addPaid > 0) {
            giftTransforms.push({
              fieldPath: 'paidQuotas',
              increment: { integerValue: String(addPaid) },
            });
          }
        }
      }

      if (giftTransforms.length > 1) {
        writes.push({
          transform: {
            document: `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/gifts/${target.giftId}`,
            fieldTransforms: giftTransforms,
          },
          currentDocument: giftDoc.updateTime
            ? { updateTime: giftDoc.updateTime }
            : { exists: true },
        });
      }
    }
  }

  if (logActor && (transitioningToConfirmed || transitioningToCancelled || transitioningRefundFromConfirmed)) {
    const logId = `log_${crypto.randomBytes(6).toString('hex')}`;
    writes.push({
      update: {
        name: `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/admin_logs/${logId}`,
        fields: {
          actorUid: { stringValue: logActor.uid },
          actorEmail: { stringValue: logActor.email.slice(0, 200) },
          action: {
            stringValue: transitioningToConfirmed
              ? 'Pagamento Cartão Brick (Mercado Pago) confirmado'
              : transitioningRefundFromConfirmed
                ? 'Pagamento Cartão Brick (Mercado Pago) reembolsado'
                : 'Pagamento Cartão Brick (Mercado Pago) recusado/cancelado',
          },
          details: {
            stringValue: `Pedido ${orderId} · Pagamento ${interpreted.mpPaymentId}`.slice(0, 500),
          },
        },
      },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    });
  }

  const commitRes = await fetch(`${baseDocumentsUrl}:commit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ writes }),
    signal: AbortSignal.timeout(10000),
  });

  if (!commitRes.ok) {
    const errTxt = await commitRes.text().catch(() => '');
    console.error('Falha ao atualizar pagamento Cartão Brick no Firestore:', commitRes.status, errTxt);
    let parsedMsg = '';
    try {
      const parsed = JSON.parse(errTxt) as { error?: { message?: string; status?: string } };
      parsedMsg = parsed.error?.message || parsed.error?.status || '';
    } catch {
      // ignore
    }
    return {
      updated: false,
      amountMismatch,
      firestoreStatus: currentStatus,
      persistError:
        commitRes.status === 401 || commitRes.status === 403
          ? `O Firestore recusou a gravação autenticada (${parsedMsg || 'PERMISSION_DENIED'}).`
          : `Não foi possível gravar a atualização no Firestore (HTTP ${commitRes.status}${parsedMsg ? `: ${parsedMsg}` : ''}).`,
      persistHttpStatus: commitRes.status,
      interpreted,
    };
  }

  return {
    updated: true,
    alreadyConfirmed: currentStatus === 'confirmed' && targetStatus === 'confirmed',
    amountMismatch,
    firestoreStatus: targetStatus,
    interpreted,
  };
}

export function verifyMercadoPagoWebhookSignature(params: {
  xSignatureHeader: string;
  xRequestIdHeader: string;
  dataId: string;
  secret: string;
}): boolean {
  const { xSignatureHeader, xRequestIdHeader, dataId } = params;
  const secret = (params.secret || '').trim();
  if (!xSignatureHeader || !secret) return false;

  const parts = xSignatureHeader.split(',');
  let ts = '';
  let v1 = '';
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim().toLowerCase();
    const v = part.slice(eqIdx + 1).trim();
    if (k === 'ts') ts = v;
    if (k === 'v1') v1 = v.toLowerCase();
  }
  if (!ts || !v1 || !/^[a-f0-9]+$/.test(v1)) return false;

  // Mercado Pago official manifest template: id:[data.id_url];request-id:[x-request-id];ts:[ts];
  const normalizedId = /^[a-zA-Z0-9]+$/.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifestSegments: string[] = [];
  if (normalizedId) manifestSegments.push(`id:${normalizedId}`);
  if (xRequestIdHeader) manifestSegments.push(`request-id:${xRequestIdHeader}`);
  manifestSegments.push(`ts:${ts}`);
  const manifest = `${manifestSegments.join(';')};`;

  const expectedHex = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  if (expectedHex.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex), Buffer.from(v1));
}

export function getInMemoryMpOrder(orderId: string): StoredMpOrderRecord | undefined {
  return ordersById.get(orderId);
}

export function getInMemoryMpOrderByMpId(mpOrderId: string): StoredMpOrderRecord | undefined {
  return ordersByMpId.get(mpOrderId);
}

export async function fetchFirestoreOrderMeta(
  config: FirebaseServerConfig,
  bearerToken: string,
  orderId: string
): Promise<{
  exists: boolean;
  status: string;
  paymentMethod: string;
  mpOrderId: string;
  mpPaymentId: string;
  mpTransactionStatus: string;
  mpStatusDetail: string;
  mpPaymentType: string;
  receiptNote: string;
  amountCents: number;
} | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/gift_orders/${encodeURIComponent(orderId)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) {
      return {
        exists: false,
        status: '',
        paymentMethod: '',
        mpOrderId: '',
        mpPaymentId: '',
        mpTransactionStatus: '',
        mpStatusDetail: '',
        mpPaymentType: '',
        receiptNote: '',
        amountCents: 0,
      };
    }
    if (!res.ok) return null;
    const docJson = (await res.json()) as { fields?: Record<string, FirestoreRestValue> };
    const f = docJson.fields;
    return {
      exists: true,
      status: readFsString(f, 'status'),
      paymentMethod: readFsString(f, 'paymentMethod'),
      mpOrderId: readFsString(f, 'mpOrderId'),
      mpPaymentId: readFsString(f, 'mpPaymentId'),
      mpTransactionStatus: readFsString(f, 'mpTransactionStatus'),
      mpStatusDetail: readFsString(f, 'mpStatusDetail'),
      mpPaymentType: readFsString(f, 'mpPaymentType'),
      receiptNote: readFsString(f, 'receiptNote'),
      amountCents: readFsInt(f, 'amountCents', 0),
    };
  } catch {
    return null;
  }
}

export function updateInMemoryMpOrderStatus(
  orderId: string,
  mpOrder: MercadoPagoOrderApiResponse
) {
  const interpreted = interpretMercadoPagoOrderStatus(mpOrder);
  const existing = ordersById.get(orderId) || ordersByMpId.get(interpreted.mpOrderId);
  if (existing) {
    existing.mpStatus = interpreted.mpStatus;
    existing.mpStatusDetail = interpreted.mpStatusDetail;
    existing.mpPaymentId = interpreted.mpPaymentId;
    existing.mpPaymentType = interpreted.mpPaymentType;
    existing.isPaid = interpreted.isPaid;
    existing.updatedAtIso = new Date().toISOString();
  }
  return interpreted;
}

export function updateInMemoryMpPaymentStatus(
  orderId: string,
  payment: MercadoPagoDirectPaymentApiResponse
) {
  const interpreted = interpretMercadoPagoPaymentStatus(payment);
  const existing = ordersById.get(orderId);
  if (existing) {
    existing.mpStatus = interpreted.mpStatus;
    existing.mpStatusDetail = interpreted.mpStatusDetail;
    existing.mpPaymentId = interpreted.mpPaymentId;
    existing.mpPaymentType = interpreted.mpPaymentType;
    existing.isPaid = interpreted.isPaid;
    existing.updatedAtIso = new Date().toISOString();
  }
  return interpreted;
}
