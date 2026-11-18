import crypto from 'crypto';
import type { App, Credential } from 'firebase-admin/app';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';

export interface FirebaseAdminTargetConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

export type FirebaseAdminAuthMode = 'service_account_json' | 'adc' | 'none';

interface ParsedServiceAccount {
  project_id?: string;
  client_email: string;
  private_key: string;
}

export interface FirebaseAdminProbeResult {
  projectId: string;
  firestoreDatabaseId: string;
  authMode: FirebaseAdminAuthMode;
  adcAvailable: boolean;
  serviceAccountJsonConfigured: boolean;
  sdkInitialized: boolean;
  canReadFirestore: boolean;
  canWriteFirestore: boolean | null;
  firestoreReady: boolean;
  runtimeProjectId?: string;
  runtimeServiceAccountEmail?: string;
  errorCode?: string;
  errorMessage?: string;
  checkedAtIso: string;
}

const ADMIN_APP_NAME = 'dalmo-jadi-server-admin';

let cachedAdcAvailable: { available: boolean; checkedAtMs: number } | null = null;
let cachedCredential: { mode: FirebaseAdminAuthMode; credential: Credential; keySig: string } | null = null;
let cachedAdminApp: { app: App; keySig: string; projectId: string } | null = null;
let cachedAccessToken: { token: string; expiresAtMs: number; keySig: string } | null = null;
let cachedProbeResult: { result: FirebaseAdminProbeResult; checkedAtMs: number } | null = null;

function parseServiceAccountJson(): ParsedServiceAccount | null {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    const jsonText = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonText) as Partial<ParsedServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch (err) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON inválido:', err);
    return null;
  }
}

export function isServiceAccountJsonConfigured(): boolean {
  return parseServiceAccountJson() !== null;
}

/**
 * Checks whether Google Cloud Application Default Credentials (ADC) are available
 * in the current runtime (Cloud Run / GCE Metadata Server or GOOGLE_APPLICATION_CREDENTIALS),
 * without ever reading, generating, or exposing private keys.
 */
let cachedMetadataIdentity: { projectId?: string; email?: string } = {};

export async function detectAdcAvailability(forceRefresh = false): Promise<boolean> {
  const now = Date.now();
  if (!forceRefresh && cachedAdcAvailable && now - cachedAdcAvailable.checkedAtMs < 5 * 60_000) {
    return cachedAdcAvailable.available;
  }

  if ((process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) {
    cachedAdcAvailable = { available: true, checkedAtMs: now };
    return true;
  }

  try {
    const [emailRes, projRes] = await Promise.all([
      fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email', {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1500),
      }),
      fetch('http://metadata.google.internal/computeMetadata/v1/project/project-id', {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1500),
      }).catch(() => null),
    ]);
    if (emailRes.ok) {
      cachedMetadataIdentity = {
        email: (await emailRes.text()).trim() || undefined,
        projectId: projRes && projRes.ok ? (await projRes.text()).trim() || undefined : undefined,
      };
    }
    const available = emailRes.ok;
    cachedAdcAvailable = { available, checkedAtMs: now };
    return available;
  } catch {
    // Fallback check via official firebase-admin applicationDefault() token exchange
    try {
      const cred = applicationDefault();
      const token = await Promise.race([
        cred.getAccessToken(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ADC_TIMEOUT')), 2000)),
      ]);
      const available = Boolean(token?.access_token);
      cachedAdcAvailable = { available, checkedAtMs: now };
      return available;
    } catch {
      cachedAdcAvailable = { available: false, checkedAtMs: now };
      return false;
    }
  }
}

async function resolveAdminCredential(): Promise<{
  mode: FirebaseAdminAuthMode;
  credential: Credential | null;
  keySig: string;
}> {
  const sa = parseServiceAccountJson();
  if (sa) {
    const keySig = `sa:${crypto.createHash('sha256').update(sa.client_email).digest('hex').slice(0, 16)}`;
    if (cachedCredential && cachedCredential.keySig === keySig) {
      return cachedCredential;
    }
    const credential = cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    });
    cachedCredential = { mode: 'service_account_json', credential, keySig };
    return cachedCredential;
  }

  const adcOk = await detectAdcAvailability();
  if (adcOk) {
    const keySig = 'adc:default';
    if (cachedCredential && cachedCredential.keySig === keySig) {
      return cachedCredential;
    }
    const credential = applicationDefault();
    cachedCredential = { mode: 'adc', credential, keySig };
    return cachedCredential;
  }

  return { mode: 'none', credential: null, keySig: 'none' };
}

export async function getFirebaseAdminContext(
  config: FirebaseAdminTargetConfig
): Promise<{
  mode: FirebaseAdminAuthMode;
  app: App | null;
  db: Firestore | null;
  credential: Credential | null;
}> {
  const resolved = await resolveAdminCredential();
  if (!resolved.credential || resolved.mode === 'none') {
    return { mode: 'none', app: null, db: null, credential: null };
  }

  if (
    cachedAdminApp &&
    cachedAdminApp.keySig === resolved.keySig &&
    cachedAdminApp.projectId === config.projectId
  ) {
    const db = getFirestore(cachedAdminApp.app, config.firestoreDatabaseId);
    return { mode: resolved.mode, app: cachedAdminApp.app, db, credential: resolved.credential };
  }

  const existing = getApps().find((a) => a.name === ADMIN_APP_NAME);
  const app =
    existing ||
    initializeApp(
      {
        credential: resolved.credential,
        projectId: config.projectId,
      },
      ADMIN_APP_NAME
    );

  cachedAdminApp = { app, keySig: resolved.keySig, projectId: config.projectId };
  const db = getFirestore(app, config.firestoreDatabaseId);
  return { mode: resolved.mode, app, db, credential: resolved.credential };
}

/**
 * Returns an OAuth2 access token from either FIREBASE_SERVICE_ACCOUNT_JSON (fallback)
 * or Google Cloud Application Default Credentials (ADC).
 * Never logs or exposes private keys or tokens.
 */
export async function getFirestoreAdminAccessToken(): Promise<string | null> {
  const resolved = await resolveAdminCredential();
  if (!resolved.credential || resolved.mode === 'none') {
    return null;
  }

  const nowMs = Date.now();
  if (
    cachedAccessToken &&
    cachedAccessToken.keySig === resolved.keySig &&
    cachedAccessToken.expiresAtMs > nowMs + 60_000
  ) {
    return cachedAccessToken.token;
  }

  const tok = await resolved.credential.getAccessToken();
  if (!tok?.access_token) {
    return null;
  }

  cachedAccessToken = {
    token: tok.access_token,
    expiresAtMs: nowMs + Math.max(120, tok.expires_in || 1800) * 1000,
    keySig: resolved.keySig,
  };
  return cachedAccessToken.token;
}

function classifyFirestoreError(err: unknown): { code: string; message: string } {
  const rawMsg = err instanceof Error ? err.message : String(err || 'UNKNOWN_ERROR');
  const rawCode =
    typeof (err as { code?: unknown })?.code === 'number' ||
    typeof (err as { code?: unknown })?.code === 'string'
      ? String((err as { code?: unknown }).code)
      : '';

  if (rawCode === '7' || /PERMISSION_DENIED|Missing or insufficient permissions/i.test(rawMsg)) {
    return {
      code: 'PERMISSION_DENIED',
      message:
        'A identidade de execução possui credencial ADC válida, mas não tem permissão IAM (roles/datastore.user) no projeto Firebase.',
    };
  }
  if (rawCode === '5' || /NOT_FOUND/i.test(rawMsg)) {
    return {
      code: 'NOT_FOUND',
      message: 'Banco de dados ou coleção não encontrado no projeto informado.',
    };
  }
  if (/UNAUTHENTICATED|Could not load the default credentials/i.test(rawMsg)) {
    return {
      code: 'UNAUTHENTICATED',
      message: 'Credenciais administrativas do Google Cloud não encontradas ou inválidas.',
    };
  }
  return {
    code: rawCode || 'FIRESTORE_ERROR',
    message: rawMsg.slice(0, 220),
  };
}

/**
 * Safely tests whether the backend Firebase Admin SDK can read (and optionally write/delete
 * a harmless probe document in `test/adc_connection_probe`) without modifying any real
 * gifts, orders, RSVPs, or security rules.
 */
export async function probeFirestoreAdminAccess(
  config: FirebaseAdminTargetConfig,
  options: { testWrite?: boolean; forceRefresh?: boolean } = {}
): Promise<FirebaseAdminProbeResult> {
  const nowMs = Date.now();
  if (
    !options.forceRefresh &&
    !options.testWrite &&
    cachedProbeResult &&
    nowMs - cachedProbeResult.checkedAtMs < 60_000
  ) {
    return cachedProbeResult.result;
  }

  const serviceAccountJsonConfigured = isServiceAccountJsonConfigured();
  const adcAvailable = await detectAdcAvailability(Boolean(options.forceRefresh));
  const ctx = await getFirebaseAdminContext(config);

  const baseResult: FirebaseAdminProbeResult = {
    projectId: config.projectId,
    firestoreDatabaseId: config.firestoreDatabaseId,
    authMode: ctx.mode,
    adcAvailable,
    serviceAccountJsonConfigured,
    sdkInitialized: Boolean(ctx.db),
    canReadFirestore: false,
    canWriteFirestore: options.testWrite ? false : null,
    firestoreReady: false,
    ...(ctx.mode === 'adc' && cachedMetadataIdentity.projectId
      ? { runtimeProjectId: cachedMetadataIdentity.projectId }
      : {}),
    ...(ctx.mode === 'adc' && cachedMetadataIdentity.email
      ? { runtimeServiceAccountEmail: cachedMetadataIdentity.email }
      : {}),
    checkedAtIso: new Date().toISOString(),
  };

  if (!ctx.db) {
    baseResult.errorCode = 'NO_CREDENTIALS';
    baseResult.errorMessage =
      'Nenhuma credencial ADC nem FIREBASE_SERVICE_ACCOUNT_JSON disponível neste ambiente.';
    if (!options.testWrite) {
      cachedProbeResult = { result: baseResult, checkedAtMs: nowMs };
    }
    return baseResult;
  }

  // 1. Read test on harmless probe path (or non-PII settings doc)
  try {
    await ctx.db.collection('test').doc('adc_connection_probe').get();
    baseResult.canReadFirestore = true;
  } catch (err) {
    const classified = classifyFirestoreError(err);
    baseResult.canReadFirestore = false;
    baseResult.errorCode = classified.code;
    baseResult.errorMessage = classified.message;
    if (!options.testWrite) {
      cachedProbeResult = { result: baseResult, checkedAtMs: nowMs };
    }
    return baseResult;
  }

  // 2. Optional write+cleanup test strictly on test/adc_connection_probe (never touches real data)
  if (options.testWrite) {
    const probeRef = ctx.db.collection('test').doc('adc_connection_probe');
    try {
      await probeRef.set(
        {
          probe: true,
          authMode: ctx.mode,
          checkedAtIso: new Date().toISOString(),
        },
        { merge: true }
      );
      const verifySnap = await probeRef.get();
      baseResult.canWriteFirestore = verifySnap.exists;
      await probeRef.delete().catch(() => undefined);
    } catch (err) {
      const classified = classifyFirestoreError(err);
      baseResult.canWriteFirestore = false;
      baseResult.errorCode = classified.code;
      baseResult.errorMessage = classified.message;
    }
  }

  baseResult.firestoreReady =
    baseResult.canReadFirestore && (options.testWrite ? baseResult.canWriteFirestore === true : true);

  if (!options.testWrite) {
    cachedProbeResult = { result: baseResult, checkedAtMs: nowMs };
  }
  return baseResult;
}
