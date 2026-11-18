import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => undefined);

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function getAdminAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Autenticação administrativa obrigatória. Entre com sua conta Google.');
  }
  const idToken = await currentUser.getIdToken(forceRefresh);
  return {
    Authorization: `Bearer ${idToken}`,
  };
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatFirestorePersistenceError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  console.error(
    'Firestore Persistence Error:',
    JSON.stringify({
      operationType,
      path,
      code,
      error: rawMessage,
      userEmail: auth.currentUser?.email || null,
    })
  );

  if (code === 'permission-denied' || /permission[-_ ]denied|Missing or insufficient permissions/i.test(rawMessage)) {
    return `Permissão negada ao gravar no Firestore (${path || 'coleção'}). Verifique se você está autenticado como administrador e se os dados respeitam as regras de validação (${rawMessage}).`;
  }
  if (code === 'unavailable' || /offline|network/i.test(rawMessage)) {
    return `Firestore indisponível ou sem conexão no momento (${rawMessage}). Tente novamente.`;
  }
  if (rawMessage) {
    return `Erro ao salvar no Firestore${code ? ` (${code})` : ''}: ${rawMessage}`;
  }
  return 'Erro desconhecido ao salvar alterações no Firestore.';
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'site_settings', 'main'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Verifique a configuração do Firebase: cliente offline.');
    }
    return false;
  }
}
