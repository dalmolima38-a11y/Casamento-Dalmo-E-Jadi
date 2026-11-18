import crypto from 'crypto';
import {
  buildPixBrCode,
  DEFAULT_PIX_IDENTIFIER_LABEL,
  formatPixKeyTypeLabel,
  type PixKeyValidationType,
  validatePixConfiguration,
  verifyPixBrCodeCrc,
} from '../src/lib/pix.ts';
import { getFirestoreAdminAccessToken } from './firebaseAdmin.ts';
import {
  type FirebaseServerConfig,
  type GiftOrderItemInput,
  validateAndResolveOrderItems,
} from './mercadopago.ts';

export interface CreateDirectPixOrderRequest {
  orderId?: string;
  orderTokenHash?: string;
  idempotencyKey?: string;
  mode: 'gift' | 'cart' | 'custom';
  items?: GiftOrderItemInput[];
  customAmountCents?: number;
  giverName: string;
  giverWhatsapp?: string;
  messageToCouple?: string;
  lgpdConsent: boolean;
  identifierLabel?: string;
}

export interface DirectPixSnapshotItem {
  giftId: string;
  title: string;
  quotas: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface DirectPixOrderResult {
  ok: true;
  orderId: string;
  orderTokenHash: string;
  idempotencyKey: string;
  persistedByServer: boolean;
  deduplicated: boolean;
  amountCents: number;
  giftTitle: string;
  isCustomAmount: boolean;
  quotas: number;
  itemsSnapshot: DirectPixSnapshotItem[];
  brCode: string;
  pixKey: string;
  pixKeyType: PixKeyValidationType;
  pixKeyTypeLabel: string;
  beneficiaryName: string;
  pixInstitution?: string;
  pixCity: string;
  identifierLabel: string;
  expiresAtIso: string;
  giverName: string;
  giverContact: string;
  messageToCouple?: string;
  status: 'awaiting_confirmation';
  paymentMethod: 'pix_manual';
}

export class DirectPixError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface AuthoritativePixSettings {
  pixEnabled: boolean;
  pixKey: string;
  pixKeyType: PixKeyValidationType;
  pixBeneficiaryName: string;
  pixInstitution?: string;
  pixCity: string;
  giftReservationExpiryMinutes: number;
}

interface CachedDirectPixEntry {
  result: DirectPixOrderResult;
  createdAtMs: number;
  signatureKey: string;
}

interface FirestoreRestValue {
  stringValue?: string;
  integerValue?: string;
  booleanValue?: boolean;
  arrayValue?: { values?: FirestoreRestValue[] };
  mapValue?: { fields?: Record<string, FirestoreRestValue> };
}

const VALID_PIX_KEY_TYPES = new Set<PixKeyValidationType>([
  'cpf',
  'cnpj',
  'email',
  'phone',
  'evp',
  'unconfigured',
]);

const DEDUPLICATION_TTL_MS = 15 * 60 * 1000;
const SIGNATURE_WINDOW_MS = 90 * 1000;

const ordersByIdempotency = new Map<string, CachedDirectPixEntry>();
const ordersBySignature = new Map<string, CachedDirectPixEntry>();

function pruneExpiredCache(nowMs: number): void {
  for (const [key, entry] of ordersByIdempotency.entries()) {
    if (nowMs - entry.createdAtMs > DEDUPLICATION_TTL_MS) {
      ordersByIdempotency.delete(key);
    }
  }
  for (const [sig, entry] of ordersBySignature.entries()) {
    if (nowMs - entry.createdAtMs > SIGNATURE_WINDOW_MS) {
      ordersBySignature.delete(sig);
    }
  }
}

function readFsString(
  fields: Record<string, FirestoreRestValue> | undefined,
  key: string
): string {
  return typeof fields?.[key]?.stringValue === 'string'
    ? (fields[key].stringValue as string)
    : '';
}

function readFsInt(
  fields: Record<string, FirestoreRestValue> | undefined,
  key: string,
  fallback: number
): number {
  const raw = fields?.[key]?.integerValue;
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function readFsBool(
  fields: Record<string, FirestoreRestValue> | undefined,
  key: string,
  fallback: boolean
): boolean {
  return typeof fields?.[key]?.booleanValue === 'boolean'
    ? (fields[key].booleanValue as boolean)
    : fallback;
}

async function fetchAuthoritativePixSettings(
  config: FirebaseServerConfig,
  saToken: string | null
): Promise<AuthoritativePixSettings> {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/site_settings/main`;
  const attempts: Array<{ url: string; headers?: Record<string, string> }> = [];
  if (saToken) {
    attempts.push({ url: baseUrl, headers: { Authorization: `Bearer ${saToken}` } });
  }
  if (config.apiKey) {
    attempts.push({ url: `${baseUrl}?key=${encodeURIComponent(config.apiKey)}` });
  }

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        headers: attempt.headers,
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;

      const docJson = (await res.json()) as { fields?: Record<string, FirestoreRestValue> };
      const f = docJson.fields;
      if (!f) continue;

      const rawKeyType = readFsString(f, 'pixKeyType') as PixKeyValidationType;
      const pixKeyType: PixKeyValidationType = VALID_PIX_KEY_TYPES.has(rawKeyType)
        ? rawKeyType
        : 'unconfigured';

      return {
        pixEnabled: readFsBool(f, 'pixEnabled', true),
        pixKey: readFsString(f, 'pixKey'),
        pixKeyType,
        pixBeneficiaryName: readFsString(f, 'pixBeneficiaryName') || 'Dalmo & Jadi',
        pixInstitution: readFsString(f, 'pixInstitution').trim(),
        pixCity: readFsString(f, 'pixCity') || 'Rio Pardo de Minas',
        giftReservationExpiryMinutes: Math.max(
          5,
          Math.min(10080, readFsInt(f, 'giftReservationExpiryMinutes', 60))
        ),
      };
    } catch {
      // Try next public/auth fallback attempt
    }
  }

  throw new DirectPixError(
    503,
    'PIX_SETTINGS_UNAVAILABLE',
    'Não foi possível validar a configuração Pix dos noivos no momento. Tente novamente em instantes.'
  );
}

async function persistDirectPixOrderViaServer(
  config: FirebaseServerConfig,
  saToken: string,
  result: DirectPixOrderResult
): Promise<boolean> {
  const baseDocumentsUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents`;
  const orderDocName = `projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/gift_orders/${result.orderId}`;

  const orderFields: Record<string, FirestoreRestValue> = {
    giftTitle: { stringValue: result.giftTitle.slice(0, 160) },
    itemsSnapshot: {
      arrayValue: {
        values: result.itemsSnapshot.slice(0, 30).map((item) => ({
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
    },
    isCustomAmount: { booleanValue: result.isCustomAmount },
    quotas: { integerValue: String(Math.min(1500, Math.max(1, result.quotas))) },
    amountCents: { integerValue: String(result.amountCents) },
    giverName: { stringValue: result.giverName.slice(0, 120) },
    giverContact: { stringValue: result.giverContact.slice(0, 140) },
    status: { stringValue: 'awaiting_confirmation' },
    paymentMethod: { stringValue: 'pix_manual' },
    orderTokenHash: { stringValue: result.orderTokenHash },
    lgpdConsent: { booleanValue: true },
    expiresAtIso: { stringValue: result.expiresAtIso.slice(0, 40) },
  };

  const primaryGiftId =
    !result.isCustomAmount &&
    result.itemsSnapshot[0]?.giftId &&
    result.itemsSnapshot[0].giftId !== 'custom_contribution'
      ? result.itemsSnapshot[0].giftId
      : '';
  if (primaryGiftId) {
    orderFields.giftId = { stringValue: primaryGiftId.slice(0, 128) };
  }
  if (result.messageToCouple) {
    orderFields.messageToCouple = { stringValue: result.messageToCouple.slice(0, 800) };
  }

  try {
    const commitRes = await fetch(`${baseDocumentsUrl}:commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${saToken}`,
      },
      body: JSON.stringify({
        writes: [
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
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!commitRes.ok) {
      const errText = await commitRes.text().catch(() => '');
      if (commitRes.status !== 401 && commitRes.status !== 403) {
        console.warn('Falha ao gravar pedido Pix direto via servidor:', commitRes.status, errText);
      }
      return false;
    }

    return true;
  } catch (err) {
    console.warn('Erro de rede ao gravar pedido Pix direto via servidor:', err);
    return false;
  }
}

export async function createDirectPixOrder(
  config: FirebaseServerConfig,
  rawInput: Partial<CreateDirectPixOrderRequest>
): Promise<DirectPixOrderResult> {
  const nowMs = Date.now();
  pruneExpiredCache(nowMs);

  const mode = rawInput.mode;
  if (mode !== 'gift' && mode !== 'cart' && mode !== 'custom') {
    throw new DirectPixError(400, 'INVALID_MODE', 'Modo de seleção Pix inválido.');
  }

  const cleanName = String(rawInput.giverName || '').trim().slice(0, 120);
  if (cleanName.length < 2) {
    throw new DirectPixError(
      400,
      'INVALID_GIVER_NAME',
      'Informe seu nome completo para identificarmos o presente.'
    );
  }

  if (rawInput.lgpdConsent !== true) {
    throw new DirectPixError(
      400,
      'LGPD_REQUIRED',
      'É necessário concordar com a política de privacidade (LGPD).'
    );
  }

  const rawWhatsapp = String(rawInput.giverWhatsapp || '').trim();
  const giverContact =
    rawWhatsapp.length >= 3 ? rawWhatsapp.slice(0, 140) : 'Não informado';
  const cleanMessage = String(rawInput.messageToCouple || '').trim().slice(0, 800);

  const rawIdempKey = String(rawInput.idempotencyKey || '').trim();
  const idempotencyKey =
    rawIdempKey && /^[a-zA-Z0-9_-]{4,128}$/.test(rawIdempKey)
      ? rawIdempKey
      : `pix_${crypto.randomBytes(12).toString('hex')}`;

  const existingByIdemp = ordersByIdempotency.get(idempotencyKey);
  if (existingByIdemp && nowMs - existingByIdemp.createdAtMs <= DEDUPLICATION_TTL_MS) {
    return {
      ...existingByIdemp.result,
      deduplicated: true,
    };
  }

  const rawOrderId = String(rawInput.orderId || '').trim();
  if (rawOrderId && !/^ord_[a-zA-Z0-9_-]{4,64}$/.test(rawOrderId)) {
    throw new DirectPixError(400, 'INVALID_ORDER_ID', 'Identificador do pedido inválido.');
  }
  const orderId = rawOrderId || `ord_${crypto.randomBytes(8).toString('hex')}`;

  const rawTokenHash = String(rawInput.orderTokenHash || '').trim().toLowerCase();
  if (rawTokenHash && !/^[a-f0-9]{64}$/.test(rawTokenHash)) {
    throw new DirectPixError(400, 'INVALID_TOKEN_HASH', 'Token de segurança do pedido inválido.');
  }
  const orderTokenHash =
    rawTokenHash ||
    crypto.createHash('sha256').update(crypto.randomBytes(24).toString('hex')).digest('hex');

  const saToken = await getFirestoreAdminAccessToken().catch(() => null);

  let resolved: Awaited<ReturnType<typeof validateAndResolveOrderItems>>;
  try {
    resolved = await validateAndResolveOrderItems(
      config,
      {
        orderId,
        idempotencyKey,
        method: 'pix',
        mode,
        items: Array.isArray(rawInput.items) ? rawInput.items : undefined,
        customAmountCents:
          typeof rawInput.customAmountCents === 'number'
            ? rawInput.customAmountCents
            : undefined,
        giverName: cleanName,
        giverContact,
        messageToCouple: cleanMessage || undefined,
        lgpdConsent: true,
        orderTokenHash,
      },
      saToken
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Não foi possível validar o presente selecionado.';
    const isQuotaConflict = /cotas suficientes|não está disponível/i.test(message);
    throw new DirectPixError(
      isQuotaConflict ? 409 : 400,
      isQuotaConflict ? 'QUOTA_CONFLICT' : 'ORDER_VALIDATION_ERROR',
      message
    );
  }

  const itemsSnapshot: DirectPixSnapshotItem[] = resolved.items.slice(0, 30).map((item) => ({
    giftId: item.giftId.slice(0, 128),
    title: item.title.slice(0, 140),
    quotas: Math.min(100, Math.max(1, Math.round(item.quotas))),
    unitPriceCents: Math.min(100_000_000, Math.max(100, Math.round(item.unitPriceCents))),
    totalCents: Math.min(100_000_000, Math.max(100, Math.round(item.totalCents))),
  }));

  const signatureSource = `${mode}|${cleanName.toLowerCase()}|${resolved.totalAmountCents}|${itemsSnapshot
    .map((item) => `${item.giftId}:${item.quotas}:${item.totalCents}`)
    .join(',')}`;
  const signatureKey = crypto.createHash('sha256').update(signatureSource).digest('hex');

  const existingBySignature = ordersBySignature.get(signatureKey);
  if (existingBySignature && nowMs - existingBySignature.createdAtMs <= SIGNATURE_WINDOW_MS) {
    ordersByIdempotency.set(idempotencyKey, existingBySignature);
    return {
      ...existingBySignature.result,
      deduplicated: true,
    };
  }

  const pixSettings = await fetchAuthoritativePixSettings(config, saToken);
  const pixValidation = validatePixConfiguration({
    pixEnabled: pixSettings.pixEnabled,
    pixKey: pixSettings.pixKey,
    pixKeyType: pixSettings.pixKeyType,
    pixBeneficiaryName: pixSettings.pixBeneficiaryName,
    pixCity: pixSettings.pixCity,
  });

  if (!pixValidation.valid) {
    throw new DirectPixError(
      422,
      'PIX_UNCONFIGURED',
      pixValidation.reason ||
        'Os dados Pix do casal ainda não estão configurados. Tente outra forma ou avise os noivos.'
    );
  }

  const identifierLabel =
    String(rawInput.identifierLabel || '').trim().slice(0, 60) || DEFAULT_PIX_IDENTIFIER_LABEL;
  const expiresAtIso = new Date(
    nowMs + pixSettings.giftReservationExpiryMinutes * 60 * 1000
  ).toISOString();

  const brCode = buildPixBrCode({
    pixKey: pixValidation.normalizedKey,
    pixKeyType: pixSettings.pixKeyType,
    beneficiaryName: pixSettings.pixBeneficiaryName,
    city: pixSettings.pixCity,
    amountCents: resolved.totalAmountCents,
    txid: orderId,
    description: identifierLabel,
  });

  if (!brCode || !verifyPixBrCodeCrc(brCode)) {
    throw new DirectPixError(
      422,
      'PIX_BRCODE_ERROR',
      'Não foi possível gerar um código Pix válido com a configuração atual. Avise os noivos.'
    );
  }

  const result: DirectPixOrderResult = {
    ok: true,
    orderId,
    orderTokenHash,
    idempotencyKey,
    persistedByServer: false,
    deduplicated: false,
    amountCents: resolved.totalAmountCents,
    giftTitle: resolved.giftTitle,
    isCustomAmount: resolved.isCustomAmount,
    quotas: resolved.totalQuotas,
    itemsSnapshot,
    brCode,
    pixKey: pixSettings.pixKey.trim(),
    pixKeyType: pixSettings.pixKeyType,
    pixKeyTypeLabel: formatPixKeyTypeLabel(pixSettings.pixKeyType),
    beneficiaryName: pixSettings.pixBeneficiaryName.trim(),
    ...(pixSettings.pixInstitution ? { pixInstitution: pixSettings.pixInstitution } : {}),
    pixCity: pixSettings.pixCity.trim(),
    identifierLabel,
    expiresAtIso,
    giverName: cleanName,
    giverContact,
    ...(cleanMessage ? { messageToCouple: cleanMessage } : {}),
    status: 'awaiting_confirmation',
    paymentMethod: 'pix_manual',
  };

  if (saToken) {
    result.persistedByServer = await persistDirectPixOrderViaServer(config, saToken, result);
  }

  const cacheEntry: CachedDirectPixEntry = {
    result,
    createdAtMs: nowMs,
    signatureKey,
  };
  ordersByIdempotency.set(idempotencyKey, cacheEntry);
  ordersBySignature.set(signatureKey, cacheEntry);

  return result;
}
