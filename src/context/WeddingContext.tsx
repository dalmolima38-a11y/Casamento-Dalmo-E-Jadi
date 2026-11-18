import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import {
  AdminLog,
  CartItem,
  CeremonyPublicData,
  CoverflowPhoto,
  FaqItem,
  GalleryAlbum,
  GalleryPhoto,
  GiftItem,
  GiftOrder,
  GiftOrderStatus,
  GuestbookMessage,
  ModerationStatus,
  PadrinhoEntry,
  RsvpRecord,
  RsvpRevision,
  RsvpStatus,
  SiteSettings,
  TimelineEvent,
} from '../types/wedding';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from '../lib/firebase';
import {
  DEFAULT_SITE_SETTINGS,
  DEMO_ADMIN_LOGS,
  DEMO_ALBUMS,
  DEMO_COVERFLOW_PHOTOS,
  DEMO_FAQS,
  DEMO_GIFT_ORDERS,
  DEMO_GIFTS,
  DEMO_GUESTBOOK_MESSAGES,
  DEMO_RSVPS,
  DEMO_TIMELINE_EVENTS,
  OFFICIAL_GIFTS,
} from '../data/defaults';
import { resolveCeremonyPastor, resolvePadrinhosList } from '../lib/settingsSanitizer';

const CART_STORAGE_KEY = 'nps_gift_cart_v1';
const FAVORITES_STORAGE_KEY = 'nps_gift_favorites_v1';
const DEMO_STORE_KEY = 'nps_demo_workspace_v1';
const DEMO_ADMIN_FLAG_KEY = 'nps_demo_admin_active_v1';

export type AdminVerificationStatus = 'idle' | 'checking' | 'authorized' | 'denied' | 'error';

export function formatFirebaseAuthError(error: unknown): {
  message: string;
  suggestRedirect: boolean;
} {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  if (code === 'auth/unauthorized-domain' || rawMessage.includes('auth/unauthorized-domain')) {
    return {
      message: `O domínio atual (${host}) não está cadastrado em "Authorized domains" no Firebase Authentication. Cadastre-o no Firebase Console para liberar o login.`,
      suggestRedirect: false,
    };
  }
  if (code === 'auth/popup-blocked' || rawMessage.includes('auth/popup-blocked')) {
    return {
      message:
        'O navegador bloqueou a janela pop-up do Google. Libere os pop-ups deste site ou utilize o botão abaixo para entrar por redirecionamento.',
      suggestRedirect: true,
    };
  }
  if (code === 'auth/cancelled-popup-request') {
    return {
      message: 'A solicitação de pop-up anterior foi cancelada. Tente novamente ou entre por redirecionamento.',
      suggestRedirect: true,
    };
  }
  if (code === 'auth/popup-closed-by-user') {
    return {
      message: 'A janela de autenticação do Google foi fechada antes de concluir o login.',
      suggestRedirect: false,
    };
  }
  if (code === 'auth/operation-not-allowed') {
    return {
      message:
        'O provedor Google não está habilitado no Firebase Authentication deste projeto. Ative-o em Authentication > Sign-in method > Google.',
      suggestRedirect: false,
    };
  }
  if (
    code === 'auth/operation-not-supported-in-this-environment' ||
    code === 'auth/web-storage-unsupported'
  ) {
    return {
      message:
        'Este navegador restringe janelas pop-up integradas. Use a opção de redirecionamento abaixo para autenticar com sua conta Google.',
      suggestRedirect: true,
    };
  }
  if (code === 'auth/network-request-failed') {
    return {
      message: 'Falha de conexão com o Google/Firebase. Verifique sua internet e tente novamente.',
      suggestRedirect: false,
    };
  }
  if (code === 'auth/internal-error') {
    return {
      message:
        'O Google/Firebase retornou erro interno ao abrir a janela de login. Verifique se os cookies e domínios autorizados estão ativos ou tente o redirecionamento.',
      suggestRedirect: true,
    };
  }
  return {
    message: rawMessage
      ? `Não foi possível concluir o login com o Google (${code || 'erro'}).`
      : 'Não foi possível concluir o login com o Google.',
    suggestRedirect: true,
  };
}

interface DemoWorkspaceState {
  settings: SiteSettings;
  timelineEvents: TimelineEvent[];
  gifts: GiftItem[];
  albums: GalleryAlbum[];
  photos: GalleryPhoto[];
  coverflowPhotos: CoverflowPhoto[];
  guestbookMessages: GuestbookMessage[];
  faqs: FaqItem[];
  rsvps: RsvpRecord[];
  rsvpRevisions: RsvpRevision[];
  giftOrders: GiftOrder[];
  adminLogs: AdminLog[];
}

function createInitialDemoWorkspace(): DemoWorkspaceState {
  return {
    settings: DEFAULT_SITE_SETTINGS,
    timelineEvents: DEMO_TIMELINE_EVENTS,
    gifts: DEMO_GIFTS,
    albums: DEMO_ALBUMS,
    photos: [],
    coverflowPhotos: DEMO_COVERFLOW_PHOTOS,
    guestbookMessages: DEMO_GUESTBOOK_MESSAGES,
    faqs: DEMO_FAQS,
    rsvps: DEMO_RSVPS,
    rsvpRevisions: [],
    giftOrders: DEMO_GIFT_ORDERS,
    adminLogs: DEMO_ADMIN_LOGS,
  };
}

export function isBundledGiftImageUrl(url?: string): boolean {
  if (!url || !url.trim()) return true;
  const trimmed = url.trim();
  return (
    trimmed.startsWith('/src/assets/images/') ||
    trimmed.startsWith('/assets/') ||
    trimmed.startsWith('/images/')
  );
}

const BEDDING_CASAL_TITLE = 'Jogo de Cama Casal';
const BEDDING_CASAL_DESCRIPTION =
  'Jogo de cama para colchão de casal, com lençol, sobrelençol e fronhas, em tecido macio e confortável.';
const LEGACY_BEDDING_DESCRIPTION =
  'Jogos de cama macios em algodão e tons suaves de creme e marfim (3 conjuntos no total).';

function isLegacyBeddingRecord(gift: Partial<GiftItem> & { id?: string }): boolean {
  const titleTrimmed = (gift.title || '').trim();
  const isTargetId = gift.id === 'gift-17-jogo-de-cama';
  const isLegacyTitleInCategory =
    gift.category === 'Cama, Mesa & Banho' && titleTrimmed === 'Jogo de Cama';
  return isTargetId || isLegacyTitleInCategory;
}

function normalizeGiftRecord(gift: GiftItem): GiftItem {
  let next: GiftItem =
    (gift.category as string) === 'Cozinha' ? { ...gift, category: 'Cozinha & Mesa' } : gift;

  if (isLegacyBeddingRecord(next)) {
    const needsTitleUpdate = next.title.trim() === 'Jogo de Cama';
    const needsDescriptionUpdate =
      next.description === LEGACY_BEDDING_DESCRIPTION || !next.description?.trim();
    if (needsTitleUpdate || needsDescriptionUpdate) {
      next = {
        ...next,
        title: needsTitleUpdate ? BEDDING_CASAL_TITLE : next.title,
        description: needsDescriptionUpdate ? BEDDING_CASAL_DESCRIPTION : next.description,
      };
    }
  }

  return next;
}

function normalizeComparableTitle(value?: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const REMOVED_LEGACY_EXAMPLE_GIFT_ID = 'demo-gift-1';

function isRemovedArtisanalDinnerwareExample(
  gift: Partial<GiftItem> & { id?: string }
): boolean {
  const titleKey = normalizeComparableTitle(gift.title);
  if (titleKey === 'aparelho de jantar ceramica artesanal (exemplo)') {
    return true;
  }
  return (
    gift.id === REMOVED_LEGACY_EXAMPLE_GIFT_ID &&
    gift.priceCents === 65000 &&
    titleKey.includes('aparelho de jantar') &&
    titleKey.includes('ceramica artesanal')
  );
}

const OFFICIAL_HONEYMOON_ID = 'gift-49-lua-de-mel-ilhabela';

const CATALOG_ADDITION_IDS = new Set([
  'gift-39-cuscuzeira',
  'gift-40-boleira',
  'gift-41-fruteira',
  'gift-42-geladeira',
  'gift-43-fogao',
  'gift-44-batedeira',
  'gift-45-ventilador',
  'gift-46-tapete-para-quarto',
  'gift-47-cortinas',
  'gift-48-estante',
  OFFICIAL_HONEYMOON_ID,
]);

function loadDemoWorkspace(): DemoWorkspaceState {
  try {
    const raw = localStorage.getItem(DEMO_STORE_KEY);
    if (!raw) return createInitialDemoWorkspace();
    const parsed = JSON.parse(raw) as Partial<DemoWorkspaceState>;
    const base = createInitialDemoWorkspace();
    const hasLegacyTimeline =
      Array.isArray(parsed.timelineEvents) &&
      parsed.timelineEvents.some(
        (ev) =>
          ev.id === 'demo-timeline-1' ||
          ev.id === 'demo-timeline-2' ||
          ev.id === 'demo-timeline-3' ||
          ev.title?.includes('(Exemplo Editável)')
      );
    const hasLegacyStoryIntro =
      parsed.settings?.storyIntro?.startsWith('Cada capítulo até aqui foi desenhado');
    const hasLegacyGiftIntro =
      parsed.settings?.giftIntroMessage?.startsWith('Seu carinho é nosso maior presente');

    let migratedGifts: GiftItem[] = base.gifts;
    if (Array.isArray(parsed.gifts) && parsed.gifts.length > 0) {
      const hasLegacyDemoGifts = parsed.gifts.some((g) => g.id.startsWith('demo-gift-'));
      const officialById = new Map<string, GiftItem>(OFFICIAL_GIFTS.map((o) => [o.id, o]));
      const existingById = new Map<string, GiftItem>();

      for (const g of parsed.gifts) {
        const isUnreservedDemoPlaceholder =
          g.id.startsWith('demo-gift-') &&
          g.isDemoExample &&
          (g.reservedQuotas || 0) === 0 &&
          (g.paidQuotas || 0) === 0;
        const isRemovedTargetExample = isRemovedArtisanalDinnerwareExample(g);
        const isRemovedHoneymoonItem =
          g.category === 'Lua de mel' && g.id !== OFFICIAL_HONEYMOON_ID;
        if (!isUnreservedDemoPlaceholder && !isRemovedTargetExample && !isRemovedHoneymoonItem) {
          const normalized = normalizeGiftRecord(g);
          const official = officialById.get(normalized.id);
          if (official && isBundledGiftImageUrl(normalized.imageUrl)) {
            existingById.set(normalized.id, {
              ...normalized,
              imageUrl: official.imageUrl,
              needsPhotoReview: official.needsPhotoReview,
              photoSource: official.photoSource,
            });
          } else {
            existingById.set(normalized.id, normalized);
          }
        }
      }

      if (hasLegacyDemoGifts) {
        for (const official of OFFICIAL_GIFTS) {
          if (!existingById.has(official.id)) {
            existingById.set(official.id, official);
          }
        }
      } else {
        // Ensure official gifts remain up to date if none exist yet
        const hasAnyOfficial = OFFICIAL_GIFTS.some((o) => existingById.has(o.id));
        if (!hasAnyOfficial && existingById.size === 0) {
          for (const official of OFFICIAL_GIFTS) {
            existingById.set(official.id, official);
          }
        } else {
          // Safely merge newly added official catalog items without creating duplicates
          const existingList = Array.from(existingById.values());
          for (const official of OFFICIAL_GIFTS) {
            if (!CATALOG_ADDITION_IDS.has(official.id)) continue;
            if (existingById.has(official.id)) continue;
            const targetKey = normalizeComparableTitle(official.title);
            const hasEquivalent =
              official.id !== OFFICIAL_HONEYMOON_ID &&
              existingList.some((g) => normalizeComparableTitle(g.title).includes(targetKey));
            if (!hasEquivalent) {
              existingById.set(official.id, official);
            }
          }
        }
      }

      migratedGifts = Array.from(existingById.values()).sort(
        (a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999)
      );
    }

    return {
      ...base,
      ...parsed,
      settings: parsed.settings
        ? {
            ...base.settings,
            ...parsed.settings,
            venueCity: parsed.settings.venueCity?.includes('CEP')
              ? base.settings.venueCity
              : parsed.settings.venueCity || base.settings.venueCity,
            venueCep: parsed.settings.venueCep ?? base.settings.venueCep,
            weddingTimeDisplay:
              parsed.settings.weddingTimeDisplay === '15:00 h'
                ? base.settings.weddingTimeDisplay
                : parsed.settings.weddingTimeDisplay || base.settings.weddingTimeDisplay,
            ceremonyPastor: resolveCeremonyPastor(parsed.settings.ceremonyPastor),
            ceremonyPlanner: parsed.settings.ceremonyPlanner ?? base.settings.ceremonyPlanner,
            dressCodeImageUrl: parsed.settings.dressCodeImageUrl ?? base.settings.dressCodeImageUrl,
            dressCodeColors: Array.isArray(parsed.settings.dressCodeColors)
              ? parsed.settings.dressCodeColors
              : base.settings.dressCodeColors,
            dressCodeMessage: parsed.settings.dressCodeMessage ?? base.settings.dressCodeMessage,
            guestGuidelines:
              Array.isArray(parsed.settings.guestGuidelines) &&
              parsed.settings.guestGuidelines.length > 0
                ? parsed.settings.guestGuidelines
                : base.settings.guestGuidelines,
            padrinhos: resolvePadrinhosList(parsed.settings.padrinhos),
            storyIntro: hasLegacyStoryIntro ? base.settings.storyIntro : parsed.settings.storyIntro,
            giftIntroMessage: hasLegacyGiftIntro
              ? base.settings.giftIntroMessage
              : parsed.settings.giftIntroMessage,
          }
        : base.settings,
      gifts: migratedGifts,
      timelineEvents:
        hasLegacyTimeline || !parsed.timelineEvents
          ? base.timelineEvents
          : parsed.timelineEvents,
      coverflowPhotos: Array.isArray(parsed.coverflowPhotos)
        ? parsed.coverflowPhotos
        : base.coverflowPhotos,
      // Safety invariant: never restore any demo order as 'confirmed' / paid
      giftOrders: (parsed.giftOrders || base.giftOrders).map((o) =>
        o.status === 'confirmed' ? { ...o, status: 'awaiting_confirmation' as GiftOrderStatus } : o
      ),
    };
  } catch {
    return createInitialDemoWorkspace();
  }
}

interface WeddingContextValue {
  loading: boolean;
  firestoreConnected: boolean;
  isDemoMode: boolean;
  demoAdminActive: boolean;
  enterDemoAdmin: () => void;
  exitDemoAdmin: () => void;
  resetDemoWorkspace: () => void;

  settings: SiteSettings;
  usingDemoSettings: boolean;
  ceremonyData: CeremonyPublicData | null;
  ceremonySha: string | null;
  ceremonySource: 'github' | 'defaults';
  refreshCeremony: () => Promise<{
    source: 'github' | 'defaults';
    sha: string | null;
    data: CeremonyPublicData;
  } | null>;
  applySavedCeremony: (data: CeremonyPublicData, sha: string) => void;
  timelineEvents: TimelineEvent[];
  gifts: GiftItem[];
  albums: GalleryAlbum[];
  photos: GalleryPhoto[];
  coverflowPhotos: CoverflowPhoto[];
  guestbookMessages: GuestbookMessage[];
  faqs: FaqItem[];

  // Auth & Admin
  user: User | null;
  authReady: boolean;
  isAdmin: boolean;
  adminCheckStatus: AdminVerificationStatus;
  adminCheckError: string | null;
  authRedirectError: unknown | null;
  clearAuthRedirectError: () => void;
  loginWithGoogle: () => Promise<void>;
  loginWithGoogleRedirect: () => Promise<void>;
  retryAdminVerification: () => Promise<void>;
  logout: () => Promise<void>;

  // Admin datasets
  rsvps: RsvpRecord[];
  rsvpRevisions: RsvpRevision[];
  giftOrders: GiftOrder[];
  adminLogs: AdminLog[];
  seedDemoData: () => Promise<void>;
  syncOfficialCatalog: () => Promise<{ added: number; updatedPhotos: number; removedPlaceholders: number }>;
  deleteAdminGiftOrder: (orderId: string) => Promise<{ mode: 'deleted' | 'archived' }>;
  seeding: boolean;

  // Demo workspace mutation helpers (local only, never simulates real payments)
  demoActions: {
    updateSettings: (next: SiteSettings) => void;
    saveGift: (gift: GiftItem) => void;
    reorderGifts: (orderedIds: string[]) => void;
    deleteGift: (giftId: string) => void;
    createGiftOrder: (order: GiftOrder, reservedItems: { giftId: string; quotas: number }[]) => void;
    attachOrderReceipt: (orderId: string, receiptNote: string, receiptPath?: string) => void;
    cancelGiftOrder: (orderId: string, newStatus: 'cancelled' | 'expired') => void;
    createRsvp: (rsvp: RsvpRecord) => void;
    updateRsvpStatus: (rsvpId: string, status: RsvpStatus) => void;
    deleteRsvp: (rsvpId: string) => void;
    createRsvpRevision: (revision: RsvpRevision) => boolean;
    applyRsvpRevision: (revisionId: string, approve: boolean) => void;
    createGuestbookMessage: (msg: GuestbookMessage) => void;
    moderateGuestbookMessage: (id: string, status: ModerationStatus) => void;
    deleteGuestbookMessage: (id: string) => void;
    createGalleryPhoto: (photo: GalleryPhoto) => void;
    moderateGalleryPhoto: (id: string, status: ModerationStatus) => void;
    deleteGalleryPhoto: (id: string) => void;
    addCoverflowPhoto: (photo: CoverflowPhoto) => void;
    updateCoverflowPhoto: (photo: CoverflowPhoto) => void;
    reorderCoverflowPhotos: (orderedIds: string[]) => void;
    deleteCoverflowPhoto: (id: string) => void;
    addTimelineEvent: (ev: TimelineEvent) => void;
    updateTimelineEvent: (ev: TimelineEvent) => void;
    reorderTimelineEvents: (orderedIds: string[]) => void;
    deleteTimelineEvent: (id: string) => void;
    addFaq: (faq: FaqItem) => void;
    deleteFaq: (id: string) => void;
  };

  // Cart & Favorites
  cart: CartItem[];
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  addToCart: (gift: GiftItem, quotas?: number, customAmountCents?: number) => void;
  updateCartQuotas: (giftId: string, quotas: number) => void;
  updateCartCustomAmount: (giftId: string, customAmountCents: number) => void;
  removeFromCart: (giftId: string) => void;
  clearCart: () => void;
  favorites: string[];
  toggleFavorite: (giftId: string) => void;

  // Privacy modal
  privacyModalOpen: boolean;
  setPrivacyModalOpen: (open: boolean) => void;

  // Card payment readiness
  cardPaymentReady: boolean;
  cardPaymentStatusLoaded: boolean;
  cardPaymentUnavailableReason: string | null;
}

const WeddingContext = createContext<WeddingContextValue | undefined>(undefined);

export const WeddingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [firestoreConnected, setFirestoreConnected] = useState(false);

  // Demo admin mode is permanently disabled in production/public UI
  const demoAdminActive = false;
  const [demoState, setDemoState] = useState<DemoWorkspaceState>(loadDemoWorkspace);

  // Live Firestore state (used automatically when Firestore has data)
  const [liveSettings, setLiveSettings] = useState<SiteSettings | null>(null);
  const [ceremonyData, setCeremonyData] = useState<CeremonyPublicData | null>(null);
  const [ceremonySha, setCeremonySha] = useState<string | null>(null);
  const [ceremonySource, setCeremonySource] = useState<'github' | 'defaults'>('defaults');
  const [liveTimeline, setLiveTimeline] = useState<TimelineEvent[] | null>(null);
  const [liveGifts, setLiveGifts] = useState<GiftItem[] | null>(null);
  const [liveAlbums, setLiveAlbums] = useState<GalleryAlbum[] | null>(null);
  const [livePhotos, setLivePhotos] = useState<GalleryPhoto[] | null>(null);
  const [liveCoverflowPhotos, setLiveCoverflowPhotos] = useState<CoverflowPhoto[] | null>(null);
  const [liveGuestbook, setLiveGuestbook] = useState<GuestbookMessage[] | null>(null);
  const [liveFaqs, setLiveFaqs] = useState<FaqItem[] | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdminDocPresent, setIsAdminDocPresent] = useState(false);
  const [serverAdminVerified, setServerAdminVerified] = useState(false);
  const [adminCheckStatus, setAdminCheckStatus] = useState<AdminVerificationStatus>('idle');
  const [adminCheckError, setAdminCheckError] = useState<string | null>(null);
  const [authRedirectError, setAuthRedirectError] = useState<unknown | null>(null);

  const [liveRsvps, setLiveRsvps] = useState<RsvpRecord[]>([]);
  const [liveRevisions, setLiveRevisions] = useState<RsvpRevision[]>([]);
  const [liveOrders, setLiveOrders] = useState<GiftOrder[]>([]);
  const [liveLogs, setLiveLogs] = useState<AdminLog[]>([]);
  const [seeding, setSeeding] = useState(false);

  const [cartOpen, setCartOpen] = useState(false);
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false);
  const [cardPaymentReady, setCardPaymentReady] = useState(false);
  const [cardPaymentStatusLoaded, setCardPaymentStatusLoaded] = useState(false);
  const [cardPaymentUnavailableReason, setCardPaymentUnavailableReason] = useState<string | null>(
    null
  );

  const [rawCart, setRawCart] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CartItem[];
      return Array.isArray(parsed)
        ? parsed
            .map((item) => ({
              ...item,
              gift: normalizeGiftRecord(item.gift),
            }))
            .filter((item) => !isRemovedArtisanalDinnerwareExample(item.gift))
        : [];
    } catch {
      return [];
    }
  });

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      return Array.isArray(parsed)
        ? parsed.filter((id) => id !== REMOVED_LEGACY_EXAMPLE_GIFT_ID)
        : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(demoState));
    } catch {
      // ignore storage errors
    }
  }, [demoState]);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(rawCart));
    } catch {
      // ignore storage errors
    }
  }, [rawCart]);

  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    } catch {
      // ignore storage errors
    }
  }, [favorites]);

  const verifyAdminSessionOnServer = useCallback(async (targetUser: User | null) => {
    if (!targetUser) {
      setServerAdminVerified(false);
      setAdminCheckStatus('idle');
      setAdminCheckError(null);
      return;
    }
    if (!targetUser.emailVerified) {
      setServerAdminVerified(false);
      setAdminCheckStatus('denied');
      setAdminCheckError('Esta conta Google não possui permissão para acessar o painel administrativo.');
      return;
    }

    setAdminCheckStatus('checking');
    setAdminCheckError(null);
    try {
      let idToken = await targetUser.getIdToken();
      let res = await fetch('/api/admin/session', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.status === 401) {
        idToken = await targetUser.getIdToken(true);
        res = await fetch('/api/admin/session', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
      }
      const respContentType = (res.headers.get('content-type') || '').toLowerCase();
      if (respContentType.includes('text/html')) {
        setServerAdminVerified(false);
        setAdminCheckStatus('error');
        setAdminCheckError(
          'A sessão do ambiente de preview expirou no navegador (resposta HTML do proxy). Recarregue a página e faça login novamente.'
        );
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        authorized?: boolean;
        error?: string;
      };
      if (res.ok && data.authorized === true) {
        setServerAdminVerified(true);
        setAdminCheckStatus('authorized');
        setAdminCheckError(null);
        return;
      }
      if (res.status === 403) {
        setServerAdminVerified(false);
        setAdminCheckStatus('denied');
        setAdminCheckError(
          data.error || 'Esta conta Google não possui permissão para acessar o painel administrativo.'
        );
        return;
      }
      setServerAdminVerified(false);
      setAdminCheckStatus('error');
      setAdminCheckError(
        data.error || 'Não foi possível validar sua sessão administrativa no servidor.'
      );
    } catch {
      setServerAdminVerified(false);
      setAdminCheckStatus('error');
      setAdminCheckError('Erro de rede ao validar permissões administrativas no servidor.');
    }
  }, []);

  const isAdmin = useMemo(() => {
    if (!user || !user.emailVerified) return false;
    return serverAdminVerified || isAdminDocPresent;
  }, [user, serverAdminVerified, isAdminDocPresent]);

  const usingDemoSettings = liveSettings === null;
  const isDemoMode = !isAdmin && usingDemoSettings;

  const refreshCeremony = useCallback(async () => {
    try {
      const res = await fetch(`/api/ceremony?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || contentType.includes('text/html')) {
        return null;
      }
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        source?: 'github' | 'defaults';
        sha?: string | null;
        data?: CeremonyPublicData;
      } | null;
      if (payload?.ok && payload.data) {
        const nextSource: 'github' | 'defaults' =
          payload.source === 'github' ? 'github' : 'defaults';
        const nextSha = payload.sha ?? null;
        setCeremonyData(payload.data);
        setCeremonySha(nextSha);
        setCeremonySource(nextSource);
        return { source: nextSource, sha: nextSha, data: payload.data };
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const applySavedCeremony = useCallback((data: CeremonyPublicData, sha: string) => {
    setCeremonyData(data);
    setCeremonySha(sha);
    setCeremonySource('github');
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem(DEMO_ADMIN_FLAG_KEY);
    } catch {
      // ignore
    }
    testFirestoreConnection().then(setFirestoreConnected);
    void refreshCeremony();

    getRedirectResult(auth).catch((err) => {
      setAuthRedirectError(err);
    });

    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      void verifyAdminSessionOnServer(currentUser);
    });

    return () => unsubAuth();
  }, [verifyAdminSessionOnServer, refreshCeremony]);

  useEffect(() => {
    let active = true;
    fetch('/api/mercadopago/status')
      .then(async (res) => {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok || contentType.includes('text/html')) {
          return null;
        }
        return (await res.json().catch(() => null)) as {
          configured?: boolean;
          cardBrickReady?: boolean;
          publicKeyError?: string;
        } | null;
      })
      .then((data) => {
        if (!active) return;
        const ready = Boolean(data?.configured && data?.cardBrickReady && !data?.publicKeyError);
        setCardPaymentReady(ready);
        setCardPaymentUnavailableReason(
          ready
            ? null
            : 'Pagamento com cartão temporariamente indisponível enquanto finalizamos a ativação. Você pode presentear via Pix direto!'
        );
      })
      .catch(() => {
        if (!active) return;
        setCardPaymentReady(false);
        setCardPaymentUnavailableReason(
          'Pagamento com cartão temporariamente indisponível no momento. Você pode presentear via Pix direto!'
        );
      })
      .finally(() => {
        if (active) setCardPaymentStatusLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authReady || !user) {
      setIsAdminDocPresent(false);
      return;
    }
    const adminRef = doc(db, 'admins', user.uid);
    const unsub = onSnapshot(
      adminRef,
      (snap) => setIsAdminDocPresent(snap.exists()),
      () => setIsAdminDocPresent(false)
    );
    return () => unsub();
  }, [authReady, user]);

  // Public Firestore listeners (non-blocking fallback to demoState if empty/unconfigured)
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(
        doc(db, 'site_settings', 'main'),
        (snap) => {
          if (snap.exists()) {
            const incoming = snap.data() as Partial<SiteSettings>;
            setLiveSettings({
              ...DEFAULT_SITE_SETTINGS,
              ...incoming,
              ceremonyPastor: resolveCeremonyPastor(incoming.ceremonyPastor),
              padrinhos: resolvePadrinhosList(incoming.padrinhos),
            });
          } else {
            setLiveSettings(null);
          }
          setLoading(false);
        },
        () => {
          setLiveSettings(null);
          setLoading(false);
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'timeline_events'), orderBy('order', 'asc')),
        (snap) => {
          setLiveTimeline(
            snap.empty
              ? null
              : snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TimelineEvent, 'id'>) }))
          );
        },
        () => setLiveTimeline(null)
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'gifts'),
        (snap) => {
          setLiveGifts(
            snap.empty
              ? null
              : snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GiftItem, 'id'>) }))
          );
        },
        () => setLiveGifts(null)
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'gallery_albums'), orderBy('order', 'asc')),
        (snap) => {
          setLiveAlbums(
            snap.empty
              ? null
              : snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GalleryAlbum, 'id'>) }))
          );
        },
        () => setLiveAlbums(null)
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'faqs'), orderBy('order', 'asc')),
        (snap) => {
          setLiveFaqs(
            snap.empty
              ? null
              : snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FaqItem, 'id'>) }))
          );
        },
        () => setLiveFaqs(null)
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'coverflow_photos'), orderBy('order', 'asc')),
        (snap) => {
          setLiveCoverflowPhotos(
            snap.empty
              ? null
              : snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CoverflowPhoto, 'id'>) }))
          );
        },
        () => setLiveCoverflowPhotos(null)
      )
    );

    return () => unsubs.forEach((fn) => fn());
  }, []);

  useEffect(() => {
    if (!authReady) return;

    const messagesQuery = isAdmin
      ? query(collection(db, 'guestbook_messages'), orderBy('createdAt', 'desc'))
      : query(
          collection(db, 'guestbook_messages'),
          where('status', '==', 'approved'),
          orderBy('createdAt', 'desc')
        );

    const photosQuery = isAdmin
      ? query(collection(db, 'gallery_photos'), orderBy('createdAt', 'desc'))
      : query(
          collection(db, 'gallery_photos'),
          where('status', '==', 'approved'),
          orderBy('createdAt', 'desc')
        );

    const unsubMessages = onSnapshot(
      messagesQuery,
      (snap) => {
        setLiveGuestbook(
          snap.empty
            ? null
            : snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GuestbookMessage, 'id'>) }))
        );
      },
      () => setLiveGuestbook(null)
    );

    const unsubPhotos = onSnapshot(
      photosQuery,
      (snap) => {
        setLivePhotos(
          snap.empty
            ? null
            : snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GalleryPhoto, 'id'>) }))
        );
      },
      () => setLivePhotos(null)
    );

    return () => {
      unsubMessages();
      unsubPhotos();
    };
  }, [authReady, isAdmin]);

  useEffect(() => {
    if (!authReady || !isAdmin) {
      setLiveRsvps([]);
      setLiveRevisions([]);
      setLiveOrders([]);
      setLiveLogs([]);
      return;
    }

    const unsubRsvps = onSnapshot(
      query(collection(db, 'rsvps'), orderBy('createdAt', 'desc')),
      (snap) =>
        setLiveRsvps(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RsvpRecord, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'rsvps')
    );

    const unsubRevisions = onSnapshot(
      query(collection(db, 'rsvp_revisions'), orderBy('createdAt', 'desc')),
      (snap) =>
        setLiveRevisions(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RsvpRevision, 'id'>) }))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'rsvp_revisions')
    );

    const unsubOrders = onSnapshot(
      query(collection(db, 'gift_orders'), orderBy('createdAt', 'desc')),
      (snap) =>
        setLiveOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GiftOrder, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'gift_orders')
    );

    const unsubLogs = onSnapshot(
      query(collection(db, 'admin_logs'), orderBy('createdAt', 'desc')),
      (snap) =>
        setLiveLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminLog, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'admin_logs')
    );

    return () => {
      unsubRsvps();
      unsubRevisions();
      unsubOrders();
      unsubLogs();
    };
  }, [authReady, isAdmin]);

  const enterDemoAdmin = useCallback(() => {
    // Modo demonstração desativado na interface administrativa
  }, []);

  const exitDemoAdmin = useCallback(() => {
    try {
      localStorage.removeItem(DEMO_ADMIN_FLAG_KEY);
    } catch {
      // ignore
    }
  }, []);

  const resetDemoWorkspace = useCallback(() => {
    const fresh = createInitialDemoWorkspace();
    setDemoState(fresh);
    try {
      localStorage.setItem(DEMO_STORE_KEY, JSON.stringify(fresh));
    } catch {
      // ignore
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setAuthRedirectError(null);
    await signInWithPopup(auth, googleProvider);
  }, []);

  const loginWithGoogleRedirect = useCallback(async () => {
    setAuthRedirectError(null);
    await signInWithRedirect(auth, googleProvider);
  }, []);

  const clearAuthRedirectError = useCallback(() => {
    setAuthRedirectError(null);
  }, []);

  const retryAdminVerification = useCallback(async () => {
    await verifyAdminSessionOnServer(auth.currentUser);
  }, [verifyAdminSessionOnServer]);

  const logout = useCallback(async () => {
    setServerAdminVerified(false);
    setAdminCheckStatus('idle');
    setAdminCheckError(null);
    setAuthRedirectError(null);
    await signOut(auth);
  }, []);

  const syncOfficialCatalog = useCallback(async () => {
    if (!isAdmin || !user) return { added: 0, updatedPhotos: 0, removedPlaceholders: 0 };
    setSeeding(true);
    let added = 0;
    let updatedPhotos = 0;
    let removedPlaceholders = 0;
    try {
      const existingSnap = await getDocs(collection(db, 'gifts'));
      const existingDocsById = new Map<string, Partial<GiftItem>>();
      const batch = writeBatch(db);
      const now = serverTimestamp();

      let migratedCategories = 0;
      let migratedBeddingCount = 0;
      for (const docSnap of existingSnap.docs) {
        const data = docSnap.data() as Partial<GiftItem>;
        const isUnreservedDemo =
          docSnap.id.startsWith('demo-gift-') &&
          data.isDemoExample === true &&
          (data.paidQuotas || 0) === 0 &&
          (data.reservedQuotas || 0) === 0;
        const isRemovedTargetExample = isRemovedArtisanalDinnerwareExample({
          ...data,
          id: docSnap.id,
        });
        const isLegacyHoneymoon =
          data.category === 'Lua de mel' && docSnap.id !== OFFICIAL_HONEYMOON_ID;

        if (isUnreservedDemo || isRemovedTargetExample) {
          batch.delete(doc(db, 'gifts', docSnap.id));
          removedPlaceholders += 1;
        } else if (isLegacyHoneymoon) {
          if ((data.paidQuotas || 0) === 0 && (data.reservedQuotas || 0) === 0) {
            batch.delete(doc(db, 'gifts', docSnap.id));
            removedPlaceholders += 1;
          } else if (data.active !== false) {
            batch.update(doc(db, 'gifts', docSnap.id), { active: false, updatedAt: now });
          }
        } else {
          const updatePatch: Record<string, unknown> = {};
          if ((data.category as string) === 'Cozinha') {
            updatePatch.category = 'Cozinha & Mesa';
            data.category = 'Cozinha & Mesa';
            migratedCategories += 1;
          }
          if (isLegacyBeddingRecord({ ...data, id: docSnap.id })) {
            const needsTitle = (data.title || '').trim() === 'Jogo de Cama';
            const needsDesc =
              data.description === LEGACY_BEDDING_DESCRIPTION || !data.description?.trim();
            if (needsTitle) {
              updatePatch.title = BEDDING_CASAL_TITLE;
              data.title = BEDDING_CASAL_TITLE;
            }
            if (needsDesc) {
              updatePatch.description = BEDDING_CASAL_DESCRIPTION;
              data.description = BEDDING_CASAL_DESCRIPTION;
            }
            if (needsTitle || needsDesc) {
              migratedBeddingCount += 1;
            }
          }
          if (Object.keys(updatePatch).length > 0) {
            batch.update(doc(db, 'gifts', docSnap.id), {
              ...updatePatch,
              updatedAt: now,
            });
          }
          existingDocsById.set(docSnap.id, data);
        }
      }

      const existingTitleList = Array.from(existingDocsById.values()).map((d) =>
        normalizeComparableTitle(d.title)
      );

      for (const official of OFFICIAL_GIFTS) {
        const existingData = existingDocsById.get(official.id);
        if (!existingData) {
          const targetKey = normalizeComparableTitle(official.title);
          const hasEquivalent =
            official.id !== OFFICIAL_HONEYMOON_ID &&
            (CATALOG_ADDITION_IDS.has(official.id) || official.id === 'gift-17-jogo-de-cama') &&
            existingTitleList.some((t) => t.includes(targetKey));
          if (hasEquivalent) continue;

          const { id, ...rest } = official;
          batch.set(doc(db, 'gifts', id), {
            ...rest,
            reservedQuotas: 0,
            paidQuotas: 0,
            isDemoExample: false,
            createdAt: now,
            updatedAt: now,
          });
          added += 1;
        } else if (
          isBundledGiftImageUrl(existingData.imageUrl) &&
          (existingData.imageUrl !== official.imageUrl ||
            existingData.needsPhotoReview !== official.needsPhotoReview ||
            existingData.photoSource !== official.photoSource)
        ) {
          batch.update(doc(db, 'gifts', official.id), {
            imageUrl: official.imageUrl ?? '',
            needsPhotoReview: Boolean(official.needsPhotoReview),
            photoSource: (official.photoSource ?? '').slice(0, 160),
            updatedAt: now,
          });
          updatedPhotos += 1;
        }
      }

      if (
        added > 0 ||
        updatedPhotos > 0 ||
        removedPlaceholders > 0 ||
        migratedCategories > 0 ||
        migratedBeddingCount > 0
      ) {
        batch.set(doc(collection(db, 'admin_logs')), {
          actorUid: user.uid,
          actorEmail: user.email || '',
          action: 'Sincronização do catálogo oficial',
          details: `${added} presente(s) adicionados, ${updatedPhotos} foto(s) atualizadas, ${removedPlaceholders} exemplo(s) removidos, ${migratedCategories} unificado(s) para Cozinha & Mesa, ${migratedBeddingCount} ajuste(s) em Jogo de Cama Casal.`,
          createdAt: now,
        });
        await batch.commit();
      }
      return { added, updatedPhotos, removedPlaceholders };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'gifts');
      return { added, updatedPhotos, removedPlaceholders };
    } finally {
      setSeeding(false);
    }
  }, [isAdmin, user]);

  const seedDemoData = useCallback(async () => {
    if (!isAdmin || !user) return;
    setSeeding(true);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();

      const settingsRef = doc(db, 'site_settings', 'main');
      batch.set(settingsRef, { ...DEFAULT_SITE_SETTINGS, updatedAt: now }, { merge: true });

      const existingGifts = await getDocs(collection(db, 'gifts'));
      const existingGiftsById = new Map(
        existingGifts.docs.map((d) => [d.id, d.data() as Partial<GiftItem>])
      );
      for (const gift of OFFICIAL_GIFTS) {
        const current = existingGiftsById.get(gift.id);
        if (!current) {
          const { id, ...rest } = gift;
          batch.set(doc(db, 'gifts', id), {
            ...rest,
            reservedQuotas: 0,
            paidQuotas: 0,
            isDemoExample: false,
            createdAt: now,
            updatedAt: now,
          });
        } else {
          const updatePatch: Record<string, unknown> = {};
          if (
            isBundledGiftImageUrl(current.imageUrl) &&
            (current.imageUrl !== gift.imageUrl ||
              current.needsPhotoReview !== gift.needsPhotoReview ||
              current.photoSource !== gift.photoSource)
          ) {
            updatePatch.imageUrl = gift.imageUrl ?? '';
            updatePatch.needsPhotoReview = Boolean(gift.needsPhotoReview);
            updatePatch.photoSource = (gift.photoSource ?? '').slice(0, 160);
          }
          if (isLegacyBeddingRecord({ ...current, id: gift.id })) {
            if ((current.title || '').trim() === 'Jogo de Cama') {
              updatePatch.title = BEDDING_CASAL_TITLE;
            }
            if (current.description === LEGACY_BEDDING_DESCRIPTION || !current.description?.trim()) {
              updatePatch.description = BEDDING_CASAL_DESCRIPTION;
            }
          }
          if (Object.keys(updatePatch).length > 0) {
            batch.update(doc(db, 'gifts', gift.id), {
              ...updatePatch,
              updatedAt: now,
            });
          }
        }
      }
      for (const docSnap of existingGifts.docs) {
        const data = docSnap.data() as Partial<GiftItem>;
        const isUnreservedDemo =
          docSnap.id.startsWith('demo-gift-') &&
          data.isDemoExample === true &&
          (data.paidQuotas || 0) === 0 &&
          (data.reservedQuotas || 0) === 0;
        if (
          isUnreservedDemo ||
          isRemovedArtisanalDinnerwareExample({ ...data, id: docSnap.id })
        ) {
          batch.delete(doc(db, 'gifts', docSnap.id));
        }
      }

      const existingTimeline = await getDocs(collection(db, 'timeline_events'));
      if (existingTimeline.empty) {
        for (const ev of DEMO_TIMELINE_EVENTS) {
          const { id, ...rest } = ev;
          batch.set(doc(db, 'timeline_events', id), { ...rest, createdAt: now, updatedAt: now });
        }
      }

      const existingAlbums = await getDocs(collection(db, 'gallery_albums'));
      if (existingAlbums.empty) {
        for (const alb of DEMO_ALBUMS) {
          const { id, ...rest } = alb;
          batch.set(doc(db, 'gallery_albums', id), { ...rest, createdAt: now });
        }
      }

      const existingFaqs = await getDocs(collection(db, 'faqs'));
      if (existingFaqs.empty) {
        for (const faq of DEMO_FAQS) {
          const { id, ...rest } = faq;
          batch.set(doc(db, 'faqs', id), { ...rest, updatedAt: now });
        }
      }

      const existingCoverflow = await getDocs(collection(db, 'coverflow_photos'));
      if (existingCoverflow.empty) {
        for (const cp of DEMO_COVERFLOW_PHOTOS) {
          const { id, ...rest } = cp;
          batch.set(doc(db, 'coverflow_photos', id), { ...rest, createdAt: now, updatedAt: now });
        }
      }

      batch.set(doc(collection(db, 'admin_logs')), {
        actorUid: user.uid,
        actorEmail: user.email || '',
        action: 'Inicialização do catálogo oficial',
        details: 'Lista oficial com 38 presentes e configurações sincronizadas no Firestore.',
        createdAt: now,
      });

      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'seedDemoData');
    } finally {
      setSeeding(false);
    }
  }, [isAdmin, user]);

  const deleteAdminGiftOrder = useCallback(
    async (orderId: string): Promise<{ mode: 'deleted' | 'archived' }> => {
      if (!user || !user.emailVerified || !isAdmin || demoAdminActive) {
        throw new Error('Apenas administradores autenticados podem excluir registros.');
      }
      const idToken = await user.getIdToken();
      const response = await fetch(`/api/admin/gift-orders/${encodeURIComponent(orderId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        mode?: 'deleted' | 'archived';
        error?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Não foi possível excluir este registro.');
      }
      const mode: 'deleted' | 'archived' = data.mode === 'archived' ? 'archived' : 'deleted';
      setLiveOrders((prev) =>
        mode === 'deleted'
          ? prev.filter((o) => o.id !== orderId)
          : prev.map((o) => (o.id === orderId ? { ...o, adminArchived: true } : o))
      );
      return { mode };
    },
    [user, isAdmin, demoAdminActive]
  );

  // Local Demo Workspace Mutations (explicitly never marks any order as confirmed/paid)
  const demoActions = useMemo(
    () => ({
      updateSettings: (next: SiteSettings) => {
        setDemoState((prev) => ({
          ...prev,
          settings: next,
          adminLogs: [
            {
              id: `demo-log-${Date.now()}`,
              actorUid: 'demo-mode',
              actorEmail: 'modo-demonstracao@local',
              action: 'Configurações atualizadas (Demo)',
              details: 'Preferências salvas localmente no modo demonstração.',
            },
            ...prev.adminLogs,
          ],
        }));
      },
      saveGift: (gift: GiftItem) => {
        setDemoState((prev) => {
          const exists = prev.gifts.some((g) => g.id === gift.id);
          const gifts = exists
            ? prev.gifts.map((g) => (g.id === gift.id ? gift : g))
            : [...prev.gifts, gift];
          return {
            ...prev,
            gifts,
            adminLogs: [
              {
                id: `demo-log-${Date.now()}`,
                actorUid: 'demo-mode',
                actorEmail: 'modo-demonstracao@local',
                action: exists ? 'Presente editado' : 'Presente adicionado',
                details: gift.title,
              },
              ...prev.adminLogs,
            ],
          };
        });
      },
      reorderGifts: (orderedIds: string[]) => {
        setDemoState((prev) => {
          const map = new Map(prev.gifts.map((g) => [g.id, g]));
          const reordered: GiftItem[] = [];
          orderedIds.forEach((id, index) => {
            const found = map.get(id);
            if (found) reordered.push({ ...found, sortOrder: index + 1 });
          });
          prev.gifts.forEach((g) => {
            if (!orderedIds.includes(g.id)) {
              reordered.push({ ...g, sortOrder: reordered.length + 1 });
            }
          });
          return {
            ...prev,
            gifts: reordered,
          };
        });
      },
      deleteGift: (giftId: string) => {
        setDemoState((prev) => ({
          ...prev,
          gifts: prev.gifts.filter((g) => g.id !== giftId),
        }));
      },
      createGiftOrder: (
        order: GiftOrder,
        reservedItems: { giftId: string; quotas: number }[]
      ) => {
        const safeOrder: GiftOrder = {
          ...order,
          status: order.status === 'confirmed' ? 'awaiting_confirmation' : order.status,
          paymentMethod:
            order.paymentMethod === 'mercadopago_card' ? 'mercadopago_card' : 'demo_preview',
        };
        setDemoState((prev) => ({
          ...prev,
          gifts: prev.gifts.map((g) => {
            const match = reservedItems.find((ri) => ri.giftId === g.id);
            if (!match) return g;
            const maxAdd = Math.max(0, g.totalQuotas - g.reservedQuotas - g.paidQuotas);
            return { ...g, reservedQuotas: g.reservedQuotas + Math.min(maxAdd, match.quotas) };
          }),
          giftOrders: [safeOrder, ...prev.giftOrders],
        }));
      },
      attachOrderReceipt: (orderId: string, receiptNote: string, receiptPath?: string) => {
        setDemoState((prev) => ({
          ...prev,
          giftOrders: prev.giftOrders.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  status: 'awaiting_confirmation',
                  receiptNote,
                  ...(receiptPath ? { receiptPath } : {}),
                }
              : o
          ),
        }));
      },
      cancelGiftOrder: (orderId: string, newStatus: 'cancelled' | 'expired') => {
        setDemoState((prev) => {
          const ord = prev.giftOrders.find((o) => o.id === orderId);
          const releaseMap = new Map<string, number>();
          if (ord && !ord.isCustomAmount) {
            if (ord.itemsSnapshot && ord.itemsSnapshot.length > 0) {
              for (const snap of ord.itemsSnapshot) {
                releaseMap.set(snap.giftId, (releaseMap.get(snap.giftId) || 0) + snap.quotas);
              }
            } else if (ord.giftId) {
              releaseMap.set(ord.giftId, ord.quotas);
            }
          }
          return {
            ...prev,
            giftOrders: prev.giftOrders.map((o) =>
              o.id === orderId ? { ...o, status: newStatus } : o
            ),
            gifts: prev.gifts.map((g) => {
              const qty = releaseMap.get(g.id) || 0;
              return qty > 0
                ? { ...g, reservedQuotas: Math.max(0, g.reservedQuotas - qty) }
                : g;
            }),
          };
        });
      },
      createRsvp: (rsvp: RsvpRecord) => {
        setDemoState((prev) => ({
          ...prev,
          rsvps: [rsvp, ...prev.rsvps],
        }));
      },
      updateRsvpStatus: (rsvpId: string, status: RsvpStatus) => {
        setDemoState((prev) => ({
          ...prev,
          rsvps: prev.rsvps.map((r) => (r.id === rsvpId ? { ...r, status } : r)),
        }));
      },
      deleteRsvp: (rsvpId: string) => {
        setDemoState((prev) => ({
          ...prev,
          rsvps: prev.rsvps.filter((r) => r.id !== rsvpId),
        }));
      },
      createRsvpRevision: (revision: RsvpRevision) => {
        let matched = false;
        setDemoState((prev) => {
          const target = prev.rsvps.find((r) => r.id === revision.rsvpId);
          if (!target || target.editTokenHash !== revision.tokenHash) {
            return prev;
          }
          matched = true;
          return {
            ...prev,
            rsvpRevisions: [revision, ...prev.rsvpRevisions],
          };
        });
        return matched;
      },
      applyRsvpRevision: (revisionId: string, approve: boolean) => {
        setDemoState((prev) => {
          const rev = prev.rsvpRevisions.find((r) => r.id === revisionId);
          if (!rev) return prev;
          return {
            ...prev,
            rsvpRevisions: prev.rsvpRevisions.map((r) =>
              r.id === revisionId ? { ...r, reviewStatus: approve ? 'applied' : 'rejected' } : r
            ),
            rsvps: approve
              ? prev.rsvps.map((r) =>
                  r.id === rev.rsvpId
                    ? {
                        ...r,
                        attending: rev.attending,
                        attendeesCount: rev.attendeesCount,
                        attendeeNames: rev.attendeeNames,
                        ...(rev.notes !== undefined ? { notes: rev.notes } : {}),
                        status: rev.attending ? 'approved' : 'declined',
                      }
                    : r
                )
              : prev.rsvps,
          };
        });
      },
      createGuestbookMessage: (msg: GuestbookMessage) => {
        setDemoState((prev) => ({
          ...prev,
          guestbookMessages: [msg, ...prev.guestbookMessages],
        }));
      },
      moderateGuestbookMessage: (id: string, status: ModerationStatus) => {
        setDemoState((prev) => ({
          ...prev,
          guestbookMessages: prev.guestbookMessages.map((m) =>
            m.id === id ? { ...m, status } : m
          ),
        }));
      },
      deleteGuestbookMessage: (id: string) => {
        setDemoState((prev) => ({
          ...prev,
          guestbookMessages: prev.guestbookMessages.filter((m) => m.id !== id),
        }));
      },
      createGalleryPhoto: (photo: GalleryPhoto) => {
        setDemoState((prev) => ({
          ...prev,
          photos: [photo, ...prev.photos],
        }));
      },
      moderateGalleryPhoto: (id: string, status: ModerationStatus) => {
        setDemoState((prev) => ({
          ...prev,
          photos: prev.photos.map((p) => (p.id === id ? { ...p, status } : p)),
        }));
      },
      deleteGalleryPhoto: (id: string) => {
        setDemoState((prev) => ({
          ...prev,
          photos: prev.photos.filter((p) => p.id !== id),
        }));
      },
      addCoverflowPhoto: (photo: CoverflowPhoto) => {
        setDemoState((prev) => ({
          ...prev,
          coverflowPhotos: [...prev.coverflowPhotos, photo],
        }));
      },
      updateCoverflowPhoto: (photo: CoverflowPhoto) => {
        setDemoState((prev) => ({
          ...prev,
          coverflowPhotos: prev.coverflowPhotos.map((p) => (p.id === photo.id ? photo : p)),
        }));
      },
      reorderCoverflowPhotos: (orderedIds: string[]) => {
        setDemoState((prev) => {
          const map = new Map(prev.coverflowPhotos.map((p) => [p.id, p]));
          const reordered: CoverflowPhoto[] = [];
          orderedIds.forEach((id, index) => {
            const found = map.get(id);
            if (found) reordered.push({ ...found, order: index + 1 });
          });
          prev.coverflowPhotos.forEach((p) => {
            if (!orderedIds.includes(p.id)) {
              reordered.push({ ...p, order: reordered.length + 1 });
            }
          });
          return {
            ...prev,
            coverflowPhotos: reordered,
          };
        });
      },
      deleteCoverflowPhoto: (id: string) => {
        setDemoState((prev) => ({
          ...prev,
          coverflowPhotos: prev.coverflowPhotos.filter((p) => p.id !== id),
        }));
      },
      addTimelineEvent: (ev: TimelineEvent) => {
        setDemoState((prev) => ({
          ...prev,
          timelineEvents: [...prev.timelineEvents, ev],
        }));
      },
      updateTimelineEvent: (ev: TimelineEvent) => {
        setDemoState((prev) => ({
          ...prev,
          timelineEvents: prev.timelineEvents.map((t) => (t.id === ev.id ? ev : t)),
        }));
      },
      reorderTimelineEvents: (orderedIds: string[]) => {
        setDemoState((prev) => {
          const map = new Map(prev.timelineEvents.map((t) => [t.id, t]));
          const reordered: TimelineEvent[] = [];
          orderedIds.forEach((id, index) => {
            const found = map.get(id);
            if (found) reordered.push({ ...found, order: index + 1 });
          });
          prev.timelineEvents.forEach((t) => {
            if (!orderedIds.includes(t.id)) {
              reordered.push({ ...t, order: reordered.length + 1 });
            }
          });
          return {
            ...prev,
            timelineEvents: reordered,
          };
        });
      },
      deleteTimelineEvent: (id: string) => {
        setDemoState((prev) => ({
          ...prev,
          timelineEvents: prev.timelineEvents.filter((t) => t.id !== id),
        }));
      },
      addFaq: (faq: FaqItem) => {
        setDemoState((prev) => ({
          ...prev,
          faqs: [...prev.faqs, faq],
        }));
      },
      deleteFaq: (id: string) => {
        setDemoState((prev) => ({
          ...prev,
          faqs: prev.faqs.filter((f) => f.id !== id),
        }));
      },
    }),
    []
  );

  const addToCart = useCallback(
    (gift: GiftItem, quotas = 1, customAmountCents?: number) => {
      const normalizedGift = normalizeGiftRecord(gift);
      if (isRemovedArtisanalDinnerwareExample(normalizedGift)) return;
      const remaining = Math.max(
        0,
        normalizedGift.totalQuotas - normalizedGift.reservedQuotas - normalizedGift.paidQuotas
      );
      if (remaining <= 0) return;

      const isFlexibleGift =
        normalizedGift.category === 'Lua de mel' || normalizedGift.giftType === 'symbolic';

      setRawCart((prev) => {
        const idx = prev.findIndex((i) => i.gift.id === normalizedGift.id);
        if (isFlexibleGift) {
          const chosenCents =
            customAmountCents && customAmountCents >= 100
              ? Math.round(customAmountCents)
              : idx >= 0 && prev[idx].customAmountCents
                ? prev[idx].customAmountCents
                : normalizedGift.priceCents;

          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = {
              gift: normalizedGift,
              quotas: 1,
              customAmountCents: chosenCents,
            };
            return updated;
          }
          return [
            ...prev,
            { gift: normalizedGift, quotas: 1, customAmountCents: chosenCents },
          ];
        }

        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = {
            gift: normalizedGift,
            quotas: Math.min(remaining, updated[idx].quotas + quotas),
          };
          return updated;
        }
        return [...prev, { gift: normalizedGift, quotas: Math.min(remaining, Math.max(1, quotas)) }];
      });
      setCartOpen(true);
    },
    []
  );

  const updateCartQuotas = useCallback((giftId: string, quotas: number) => {
    setRawCart((prev) =>
      prev
        .map((item) => {
          if (item.gift.id !== giftId) return item;
          const remaining = Math.max(
            0,
            item.gift.totalQuotas - item.gift.reservedQuotas - item.gift.paidQuotas
          );
          return { ...item, quotas: Math.min(remaining, Math.max(0, quotas)) };
        })
        .filter((item) => item.quotas > 0)
    );
  }, []);

  const updateCartCustomAmount = useCallback((giftId: string, customAmountCents: number) => {
    const safeCents = Math.max(100, Math.round(customAmountCents));
    setRawCart((prev) =>
      prev.map((item) =>
        item.gift.id === giftId
          ? { ...item, quotas: 1, customAmountCents: safeCents }
          : item
      )
    );
  }, []);

  const removeFromCart = useCallback((giftId: string) => {
    setRawCart((prev) => prev.filter((item) => item.gift.id !== giftId));
  }, []);

  const clearCart = useCallback(() => {
    setRawCart([]);
  }, []);

  // Resolve active data source: Production Firestore (if seeded/authenticated) vs Demo Workspace
  const useLive = !demoAdminActive && !usingDemoSettings;

  const settings = useMemo<SiteSettings>(() => {
    const base = useLive && liveSettings ? liveSettings : demoState.settings;
    if (!ceremonyData) return base;
    if (ceremonySource !== 'github' && useLive && liveSettings) {
      return base;
    }
    const combinedPadrinhos: PadrinhoEntry[] = [
      ...ceremonyData.bridesmaids.map((p, idx) => ({
        ...p,
        side: 'noiva' as const,
        order: p.order || idx + 1,
      })),
      ...ceremonyData.groomsmen.map((p, idx) => ({
        ...p,
        side: 'noivo' as const,
        order: p.order || idx + 1,
      })),
    ];
    return {
      ...base,
      venueName: ceremonyData.church.name || base.venueName,
      venueCity: ceremonyData.church.city || base.venueCity,
      venueCep: ceremonyData.church.cep || base.venueCep,
      venueStreetAddress: ceremonyData.church.streetAddress || base.venueStreetAddress,
      venueCoordinates: ceremonyData.church.coordinates ?? base.venueCoordinates,
      venueMapUrl: ceremonyData.church.mapUrl ?? base.venueMapUrl,
      venuePhotoUrl: ceremonyData.church.photoUrl || base.venuePhotoUrl,
      weddingDateDisplay: ceremonyData.church.dateDisplay || base.weddingDateDisplay,
      weddingTimeDisplay: ceremonyData.church.timeDisplay || base.weddingTimeDisplay,
      ceremonyPastor: ceremonyData.church.pastor || base.ceremonyPastor,
      ceremonyPlanner: ceremonyData.church.planner || base.ceremonyPlanner,
      padrinhos: combinedPadrinhos,
    };
  }, [useLive, liveSettings, demoState.settings, ceremonyData, ceremonySource]);
  const rawTimelineEvents = useLive && liveTimeline ? liveTimeline : demoState.timelineEvents;
  const timelineEvents = useMemo(
    () => [...rawTimelineEvents].sort((a, b) => a.order - b.order),
    [rawTimelineEvents]
  );
  const legacyKitchenMigratedRef = useRef(false);
  useEffect(() => {
    if (!isAdmin || demoAdminActive || !user || !liveGifts || legacyKitchenMigratedRef.current) {
      return;
    }
    const legacyDocs = liveGifts.filter((g) => (g.category as string) === 'Cozinha');
    const legacyBeddingDocs = liveGifts.filter((g) => {
      if (!isLegacyBeddingRecord(g)) return false;
      return (
        g.title.trim() === 'Jogo de Cama' ||
        g.description === LEGACY_BEDDING_DESCRIPTION ||
        !g.description?.trim()
      );
    });
    const removedExampleDocs = liveGifts.filter((g) => isRemovedArtisanalDinnerwareExample(g));
    const legacyHoneymoonDocs = liveGifts.filter(
      (g) => g.category === 'Lua de mel' && g.id !== OFFICIAL_HONEYMOON_ID
    );
    const missingCatalogAdditions = OFFICIAL_GIFTS.filter((official) => {
      if (!CATALOG_ADDITION_IDS.has(official.id)) return false;
      if (liveGifts.some((g) => g.id === official.id)) return false;
      if (official.id === OFFICIAL_HONEYMOON_ID) return true;
      const targetKey = normalizeComparableTitle(official.title);
      return !liveGifts.some((g) => normalizeComparableTitle(g.title).includes(targetKey));
    });

    if (
      legacyDocs.length === 0 &&
      legacyBeddingDocs.length === 0 &&
      removedExampleDocs.length === 0 &&
      legacyHoneymoonDocs.length === 0 &&
      missingCatalogAdditions.length === 0
    ) {
      return;
    }

    legacyKitchenMigratedRef.current = true;
    const batch = writeBatch(db);
    const now = serverTimestamp();
    for (const g of legacyDocs) {
      batch.update(doc(db, 'gifts', g.id), {
        category: 'Cozinha & Mesa',
        updatedAt: now,
      });
    }
    for (const g of legacyBeddingDocs) {
      const patch: Record<string, unknown> = { updatedAt: now };
      if (g.title.trim() === 'Jogo de Cama') {
        patch.title = BEDDING_CASAL_TITLE;
      }
      if (g.description === LEGACY_BEDDING_DESCRIPTION || !g.description?.trim()) {
        patch.description = BEDDING_CASAL_DESCRIPTION;
      }
      batch.update(doc(db, 'gifts', g.id), patch);
    }
    for (const g of removedExampleDocs) {
      batch.delete(doc(db, 'gifts', g.id));
    }
    for (const g of legacyHoneymoonDocs) {
      if ((g.paidQuotas || 0) === 0 && (g.reservedQuotas || 0) === 0) {
        batch.delete(doc(db, 'gifts', g.id));
      } else if (g.active !== false) {
        batch.update(doc(db, 'gifts', g.id), { active: false, updatedAt: now });
      }
    }
    for (const official of missingCatalogAdditions) {
      const { id, ...rest } = official;
      batch.set(doc(db, 'gifts', id), {
        ...rest,
        reservedQuotas: 0,
        paidQuotas: 0,
        isDemoExample: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    batch.set(doc(collection(db, 'admin_logs')), {
      actorUid: user.uid,
      actorEmail: user.email || '',
      action: 'Atualização do catálogo oficial',
      details: `${legacyDocs.length} unificado(s), ${legacyBeddingDocs.length} ajustado(s) para Jogo de Cama Casal, ${removedExampleDocs.length} exemplo(s) excluído(s), ${legacyHoneymoonDocs.length} item(ns) antigo(s) de Lua de Mel removido(s), ${missingCatalogAdditions.length} novo(s) presente(s) adicionados.`,
      createdAt: now,
    });
    batch.commit().catch((err) => {
      legacyKitchenMigratedRef.current = false;
      handleFirestoreError(err, OperationType.WRITE, 'gifts');
    });
  }, [isAdmin, demoAdminActive, user, liveGifts]);

  const rawGifts = useLive && liveGifts ? liveGifts : demoState.gifts;
  const removedTargetIds = useMemo(() => {
    const ids = new Set<string>([REMOVED_LEGACY_EXAMPLE_GIFT_ID]);
    for (const g of rawGifts) {
      if (isRemovedArtisanalDinnerwareExample(g)) {
        ids.add(g.id);
      }
    }
    return ids;
  }, [rawGifts]);

  useEffect(() => {
    setFavorites((prev) => {
      const next = prev.filter((id) => !removedTargetIds.has(id));
      return next.length === prev.length ? prev : next;
    });
    setRawCart((prev) => {
      const next = prev.filter(
        (item) =>
          !removedTargetIds.has(item.gift.id) &&
          !isRemovedArtisanalDinnerwareExample(item.gift)
      );
      return next.length === prev.length ? prev : next;
    });
  }, [removedTargetIds]);

  const toggleFavorite = useCallback(
    (giftId: string) => {
      if (removedTargetIds.has(giftId)) return;
      setFavorites((prev) =>
        prev.includes(giftId) ? prev.filter((id) => id !== giftId) : [...prev, giftId]
      );
    },
    [removedTargetIds]
  );

  const gifts = useMemo(
    () =>
      rawGifts
        .map(normalizeGiftRecord)
        .filter(
          (g) =>
            !isRemovedArtisanalDinnerwareExample(g) &&
            !(g.category === 'Lua de mel' && g.id !== OFFICIAL_HONEYMOON_ID)
        )
        .sort(
          (a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || a.title.localeCompare(b.title)
        ),
    [rawGifts]
  );

  const cart = useMemo(() => {
    const giftsById = new Map(gifts.map((g) => [g.id, g]));
    return rawCart
      .filter(
        (item) =>
          !removedTargetIds.has(item.gift.id) &&
          !isRemovedArtisanalDinnerwareExample(item.gift) &&
          !(item.gift.category === 'Lua de mel' && item.gift.id !== OFFICIAL_HONEYMOON_ID)
      )
      .map((item) => {
        const latestGift = giftsById.get(item.gift.id);
        return {
          ...item,
          gift: latestGift ? latestGift : normalizeGiftRecord(item.gift),
        };
      });
  }, [rawCart, gifts, removedTargetIds]);
  const albums = useLive && liveAlbums ? liveAlbums : demoState.albums;
  const photos = useLive && livePhotos ? livePhotos : demoState.photos;
  const rawCoverflowPhotos =
    useLive && liveCoverflowPhotos ? liveCoverflowPhotos : demoState.coverflowPhotos;
  const coverflowPhotos = useMemo(
    () => [...rawCoverflowPhotos].sort((a, b) => a.order - b.order),
    [rawCoverflowPhotos]
  );
  const guestbookMessages =
    useLive && liveGuestbook ? liveGuestbook : demoState.guestbookMessages;
  const faqs = useLive && liveFaqs ? liveFaqs : demoState.faqs;

  const rsvps = isAdmin && !demoAdminActive ? liveRsvps : demoState.rsvps;
  const rsvpRevisions = isAdmin && !demoAdminActive ? liveRevisions : demoState.rsvpRevisions;
  const giftOrders = isAdmin && !demoAdminActive ? liveOrders : demoState.giftOrders;
  const adminLogs = isAdmin && !demoAdminActive ? liveLogs : demoState.adminLogs;

  const value: WeddingContextValue = {
    loading,
    firestoreConnected,
    isDemoMode,
    demoAdminActive,
    enterDemoAdmin,
    exitDemoAdmin,
    resetDemoWorkspace,
    settings,
    usingDemoSettings,
    ceremonyData,
    ceremonySha,
    ceremonySource,
    refreshCeremony,
    applySavedCeremony,
    timelineEvents,
    gifts,
    albums,
    photos,
    coverflowPhotos,
    guestbookMessages,
    faqs,
    user,
    authReady,
    isAdmin,
    adminCheckStatus,
    adminCheckError,
    authRedirectError,
    clearAuthRedirectError,
    loginWithGoogle,
    loginWithGoogleRedirect,
    retryAdminVerification,
    logout,
    rsvps,
    rsvpRevisions,
    giftOrders,
    adminLogs,
    seedDemoData,
    syncOfficialCatalog,
    deleteAdminGiftOrder,
    seeding,
    demoActions,
    cart,
    cartOpen,
    setCartOpen,
    addToCart,
    updateCartQuotas,
    updateCartCustomAmount,
    removeFromCart,
    clearCart,
    favorites,
    toggleFavorite,
    privacyModalOpen,
    setPrivacyModalOpen,
    cardPaymentReady,
    cardPaymentStatusLoaded,
    cardPaymentUnavailableReason,
  };

  return <WeddingContext.Provider value={value}>{children}</WeddingContext.Provider>;
};

export function useWedding(): WeddingContextValue {
  const ctx = useContext(WeddingContext);
  if (!ctx) {
    throw new Error('useWedding deve ser usado dentro de WeddingProvider');
  }
  return ctx;
}
