import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  ExternalLink,
  Heart,
  Lock,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { doc, increment, serverTimestamp, writeBatch } from 'firebase/firestore';
import { useWedding } from '../context/WeddingContext';
import { auth, db } from '../lib/firebase';
import { resolveCheckoutSelection } from '../lib/checkoutSelection';
import {
  loadMercadoPagoSdk,
  MercadoPagoBrickController,
  MercadoPagoCardBrickFormData,
} from '../lib/mercadopagoSdk';
import { formatBRL, generateRandomToken, sha256Hex } from '../lib/pix';
import { GiftOrderItemSnapshot } from '../types/wedding';
import { WatercolorCorners } from '../components/WatercolorCorners';

interface MpStatusResponse {
  ok?: boolean;
  configured: boolean;
  publicKeyConfigured?: boolean;
  publicKey?: string;
  publicKeyError?: string;
  cardBrickReady?: boolean;
  testMode: boolean;
  liveMode: boolean;
}

interface CardPaymentResultState {
  orderId: string;
  mpPaymentId?: string;
  mpOrderId?: string;
  mpStatus: string;
  mpStatusDetail?: string;
  mpPaymentType?: string;
  isPaid: boolean;
  isPending: boolean;
  isFailed?: boolean;
  totalAmountCents: number;
  giftTitle: string;
  testMode: boolean;
  threeDsInfo?: {
    external_resource_url?: string;
    creq?: string;
  };
}

interface CheckoutProRedirectSession {
  orderId: string;
  mpOrderId: string;
  checkoutUrl: string;
  amountCents: number;
  giftTitle: string;
  testMode: boolean;
}

export const CardGiftPage: React.FC = () => {
  const {
    settings,
    gifts,
    cart,
    clearCart,
    setPrivacyModalOpen,
    isDemoMode,
    demoAdminActive,
    demoActions,
  } = useWedding();
  const [searchParams] = useSearchParams();

  const selection = useMemo(
    () => resolveCheckoutSelection({ searchParams, gifts, cart }),
    [searchParams, gifts, cart]
  );

  const [giverName, setGiverName] = useState('');
  const [lgpdConsent, setLgpdConsent] = useState(false);

  const giverNameRef = useRef<HTMLInputElement | null>(null);
  const lgpdCheckboxRef = useRef<HTMLInputElement | null>(null);

  const [mpStatus, setMpStatus] = useState<MpStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [brickLoading, setBrickLoading] = useState(false);
  const [brickReady, setBrickReady] = useState(false);
  const [brickLoadError, setBrickLoadError] = useState<string | null>(null);
  const [processingPayment, setProcessingPayment] = useState(false);
  const processingRef = useRef(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [firestoreSyncWarning, setFirestoreSyncWarning] = useState<string | null>(null);

  const [cardResult, setCardResult] = useState<CardPaymentResultState | null>(null);
  const [checkingResultStatus, setCheckingResultStatus] = useState(false);

  const [showCheckoutProOption, setShowCheckoutProOption] = useState(false);
  const [creatingCheckoutPro, setCreatingCheckoutPro] = useState(false);
  const [checkoutProSession, setCheckoutProSession] =
    useState<CheckoutProRedirectSession | null>(null);

  const [idempotencyKey, setIdempotencyKey] = useState(() => `mp_${generateRandomToken(12)}`);

  const brickControllerRef = useRef<MercadoPagoBrickController | null>(null);

  // Latest values ref for Brick callbacks (avoids remounting Brick while typing)
  const latestStateRef = useRef({
    giverName,
    lgpdConsent,
    idempotencyKey,
    selection,
    settings,
    isDemoMode,
    demoAdminActive,
  });

  useEffect(() => {
    latestStateRef.current = {
      giverName,
      lgpdConsent,
      idempotencyKey,
      selection,
      settings,
      isDemoMode,
      demoAdminActive,
    };
  }, [
    giverName,
    lgpdConsent,
    idempotencyKey,
    selection,
    settings,
    isDemoMode,
    demoAdminActive,
  ]);

  useEffect(() => {
    let active = true;
    setStatusLoading(true);
    fetch('/api/mercadopago/status')
      .then((r) => r.json())
      .then((data) => {
        if (active && typeof data?.configured === 'boolean') {
          setMpStatus(data as MpStatusResponse);
        }
      })
      .catch(() => {
        if (active) {
          setMpStatus(null);
        }
      })
      .finally(() => {
        if (active) setStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const persistCardOrderInFirestore = useCallback(
    async (params: {
      orderId: string;
      orderTokenHash: string;
      idempotencyKey: string;
      mpOrderId?: string;
      mpPaymentId?: string;
      mpStatus: string;
      mpStatusDetail?: string;
      mpPaymentType: string;
      checkoutUrl?: string;
      expiresAtIso: string;
      resolvedTitle: string;
      resolvedAmountCents: number;
      isCustomAmount: boolean;
      quotas: number;
      resolvedItems: GiftOrderItemSnapshot[];
      giverName: string;
      combinedContact: string;
      isDemo: boolean;
    }): Promise<{ persisted: boolean; warning?: string }> => {
      const primaryGiftId =
        !params.isCustomAmount &&
        params.resolvedItems[0]?.giftId &&
        params.resolvedItems[0].giftId !== 'custom_contribution'
          ? params.resolvedItems[0].giftId
          : undefined;

      const receiptNote = params.mpPaymentId
        ? `Cartão Mercado Pago · Pagamento #${params.mpPaymentId}`.slice(0, 300)
        : undefined;

      if (!params.isDemo) {
        const now = serverTimestamp();
        const baseOrderPayload: Record<string, unknown> = {
          ...(primaryGiftId ? { giftId: primaryGiftId } : {}),
          giftTitle: params.resolvedTitle.slice(0, 160),
          isCustomAmount: params.isCustomAmount,
          quotas: params.quotas,
          amountCents: params.resolvedAmountCents,
          giverName: params.giverName.slice(0, 120),
          giverContact: params.combinedContact.slice(0, 140),
          status: 'awaiting_confirmation',
          paymentMethod: 'mercadopago_card',
          orderTokenHash: params.orderTokenHash,
          idempotencyKey: params.idempotencyKey.slice(0, 128),
          ...(params.mpOrderId ? { mpOrderId: params.mpOrderId.slice(0, 128) } : {}),
          mpTransactionStatus: params.mpStatus.slice(0, 60),
          ...(params.mpStatusDetail ? { mpStatusDetail: params.mpStatusDetail.slice(0, 80) } : {}),
          mpPaymentType: params.mpPaymentType.slice(0, 60),
          ...(params.checkoutUrl ? { mpCheckoutUrl: params.checkoutUrl.slice(0, 600) } : {}),
          ...(receiptNote ? { receiptNote } : {}),
          lgpdConsent: true,
          expiresAtIso: params.expiresAtIso.slice(0, 40),
          createdAt: now,
          updatedAt: now,
        };

        const commitWithSnapshot = async (includeSnapshot: boolean) => {
          const batch = writeBatch(db);
          if (!params.isCustomAmount) {
            for (const item of params.resolvedItems) {
              if (
                item.giftId &&
                item.giftId !== 'custom_contribution' &&
                !item.giftId.startsWith('demo-')
              ) {
                batch.update(doc(db, 'gifts', item.giftId), {
                  reservedQuotas: increment(item.quotas),
                  updatedAt: now,
                });
              }
            }
          }
          const docPayload = includeSnapshot
            ? { ...baseOrderPayload, itemsSnapshot: params.resolvedItems }
            : baseOrderPayload;
          batch.set(doc(db, 'gift_orders', params.orderId), docPayload);
          await batch.commit();
        };

        try {
          await commitWithSnapshot(true);
          return { persisted: true };
        } catch (fsErr) {
          const errCode =
            fsErr && typeof fsErr === 'object' && 'code' in fsErr
              ? String((fsErr as { code?: unknown }).code || '')
              : '';
          if (errCode === 'permission-denied' && (params.isCustomAmount || params.resolvedItems.length <= 1)) {
            try {
              await commitWithSnapshot(false);
              return { persisted: true };
            } catch (retryErr) {
              fsErr = retryErr;
            }
          }

          const finalCode =
            fsErr && typeof fsErr === 'object' && 'code' in fsErr
              ? String((fsErr as { code?: unknown }).code || '')
              : '';
          const finalMessage = fsErr instanceof Error ? fsErr.message : String(fsErr || '');
          fetch('/api/pix/client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            body: JSON.stringify({
              stage: 'card_order',
              orderId: params.orderId,
              code: finalCode || undefined,
              message: finalMessage.slice(0, 500),
              isAuthenticated: Boolean(auth.currentUser),
              isAnonymous: Boolean(auth.currentUser?.isAnonymous),
              payloadKeys: Object.keys(baseOrderPayload),
            }),
          }).catch(() => undefined);

          return {
            persisted: false,
            warning:
              'Não foi possível gravar o pedido automaticamente no painel do site. Guarde o código do pedido/pagamento abaixo e informe os noivos.',
          };
        }
      }

      demoActions.createGiftOrder(
        {
          id: params.orderId,
          ...(primaryGiftId ? { giftId: primaryGiftId } : {}),
          giftTitle: params.resolvedTitle.slice(0, 160),
          itemsSnapshot: params.resolvedItems,
          isCustomAmount: params.isCustomAmount,
          quotas: params.quotas,
          amountCents: params.resolvedAmountCents,
          giverName: params.giverName.slice(0, 120),
          giverContact: params.combinedContact.slice(0, 140),
          status: 'awaiting_confirmation',
          paymentMethod: 'mercadopago_card',
          orderTokenHash: params.orderTokenHash,
          idempotencyKey: params.idempotencyKey,
          ...(params.mpOrderId ? { mpOrderId: params.mpOrderId } : {}),
          ...(params.mpPaymentId ? { mpPaymentId: params.mpPaymentId } : {}),
          mpTransactionStatus: params.mpStatus,
          ...(params.mpStatusDetail ? { mpStatusDetail: params.mpStatusDetail } : {}),
          mpPaymentType: params.mpPaymentType,
          ...(params.checkoutUrl ? { mpCheckoutUrl: params.checkoutUrl } : {}),
          ...(receiptNote ? { receiptNote } : {}),
          lgpdConsent: true,
          expiresAtIso: params.expiresAtIso,
        },
        params.isCustomAmount
          ? []
          : params.resolvedItems
              .filter((i) => i.giftId !== 'custom_contribution')
              .map((i) => ({ giftId: i.giftId, quotas: i.quotas }))
      );
      return { persisted: true };
    },
    [demoActions]
  );

  const resolvedPublicKey = useMemo(() => {
    const serverKey = (mpStatus?.publicKey || '').trim();
    if (serverKey) return serverKey;
    const envKey = String(import.meta.env.VITE_MERCADOPAGO_PUBLIC_KEY || '').trim();
    if (!envKey || /^(?:APP_USR|TEST)-\d{6,}-\d{4,}-[a-f0-9]+-\d+$/i.test(envKey)) {
      return '';
    }
    return envKey;
  }, [mpStatus?.publicKey]);

  const isCardBrickReady = Boolean(
    mpStatus?.configured && !mpStatus?.publicKeyError && resolvedPublicKey
  );

  // Mount Mercado Pago Card Payment Brick whenever publicKey & valid amount are ready
  useEffect(() => {
    const publicKey = resolvedPublicKey;
    const canMountBrick =
      isCardBrickReady &&
      Boolean(publicKey) &&
      selection.hasValidSelection &&
      selection.amountCents >= 100 &&
      !cardResult &&
      !checkoutProSession;

    if (!canMountBrick || !publicKey) {
      return;
    }

    let cancelled = false;
    setBrickLoading(true);
    setBrickReady(false);
    setBrickLoadError(null);

    const mountBrick = async () => {
      try {
        await loadMercadoPagoSdk();
        if (cancelled || !window.MercadoPago) return;

        const containerEl = document.getElementById('mp-card-brick-container');
        if (!containerEl) return;
        containerEl.innerHTML = '';

        const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
        const bricksBuilder = mp.bricks();

        const controller = await bricksBuilder.create(
          'cardPayment',
          'mp-card-brick-container',
          {
            initialization: {
              amount: Number((selection.amountCents / 100).toFixed(2)),
            },
            customization: {
              visual: {
                style: {
                  theme: 'flat',
                  customVariables: {
                    fontFamily: '"Inter", "Roboto", Arial, Helvetica, sans-serif',
                    baseColor: '#0F172A',
                    baseColorFirstVariant: '#1E293B',
                    baseColorSecondVariant: '#020617',
                    textPrimaryColor: '#0F172A',
                    textSecondaryColor: '#475569',
                    inputBackgroundColor: '#FFFFFF',
                    formBackgroundColor: '#FFFFFF',
                    outlinePrimaryColor: '#334155',
                    errorColor: '#DC2626',
                    successColor: '#15803D',
                    borderRadiusMedium: '8px',
                    borderRadiusLarge: '10px',
                  },
                },
                texts: {
                  formSubmit: 'Confirmar pagamento',
                },
              },
              paymentMethods: {
                minInstallments: 1,
                maxInstallments: 12,
              },
            },
            callbacks: {
              onReady: () => {
                if (!cancelled) {
                  setBrickLoading(false);
                  setBrickReady(true);
                }
              },
              onError: (err) => {
                console.error('Erro no pagamento com cartão:', err);
                if (!cancelled) {
                  setBrickLoading(false);
                  setBrickLoadError(
                    'Não foi possível carregar os campos de pagamento agora. Você pode atualizar a página ou escolher pagar via Pix direto.'
                  );
                }
              },
              onSubmit: async (formData: MercadoPagoCardBrickFormData) => {
                if (processingRef.current) {
                  return;
                }
                const state = latestStateRef.current;
                setErrorMsg(null);

                const cleanName = state.giverName.trim().slice(0, 120);
                if (cleanName.length < 2) {
                  setErrorMsg('Informe seu nome completo acima antes de confirmar o pagamento.');
                  giverNameRef.current?.focus();
                  giverNameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  throw new Error('MISSING_GIVER_NAME');
                }
                if (!state.lgpdConsent) {
                  setErrorMsg(
                    'Marque a autorização da política de privacidade (LGPD) antes de confirmar o presente.'
                  );
                  lgpdCheckboxRef.current?.focus();
                  lgpdCheckboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  throw new Error('MISSING_LGPD_CONSENT');
                }

                const combinedContact = 'Não informado';

                processingRef.current = true;
                setProcessingPayment(true);
                try {
                  const orderId = `ord_${generateRandomToken(8)}`;
                  const orderToken = generateRandomToken(16);
                  const orderTokenHash = await sha256Hex(orderToken);

                  const payloadItems = state.selection.isCustomAmount
                    ? undefined
                    : state.selection.items.map((item) => {
                        const isFlex =
                          item.gift.category === 'Lua de mel' || item.gift.giftType === 'symbolic';
                        return {
                          giftId: item.gift.id,
                          quotas: isFlex ? 1 : item.quotas,
                          ...(isFlex
                            ? { customAmountCents: item.customAmountCents ?? item.gift.priceCents }
                            : {}),
                        };
                      });

                  const res = await fetch('/api/mercadopago/card-payment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      orderId,
                      idempotencyKey: state.idempotencyKey,
                      mode: state.selection.isCustomAmount
                        ? 'custom'
                        : state.selection.scope === 'gift'
                          ? 'gift'
                          : 'cart',
                      items: payloadItems,
                      ...(state.selection.isCustomAmount
                        ? { customAmountCents: state.selection.amountCents }
                        : {}),
                      giverName: cleanName,
                      giverContact: combinedContact,
                      payerEmail: formData.payer?.email?.trim(),
                      lgpdConsent: true,
                      orderTokenHash,
                      cardToken: formData.token,
                      paymentMethodId: formData.payment_method_id,
                      issuerId: formData.issuer_id,
                      installments: formData.installments,
                      identificationType: formData.payer?.identification?.type,
                      identificationNumber: formData.payer?.identification?.number,
                    }),
                  });

                  const data = (await res.json().catch(() => ({}))) as {
                    ok?: boolean;
                    rejected?: boolean;
                    error?: string;
                    orderId?: string;
                    mpPaymentId?: string;
                    mpOrderId?: string;
                    mpStatus?: string;
                    mpStatusDetail?: string;
                    mpPaymentType?: string;
                    isPaid?: boolean;
                    isPending?: boolean;
                    totalAmountCents?: number;
                    giftTitle?: string;
                    isCustomAmount?: boolean;
                    quotas?: number;
                    items?: GiftOrderItemSnapshot[];
                    expiresAtIso?: string;
                    persistedByServer?: boolean;
                    deduplicated?: boolean;
                    testMode?: boolean;
                    threeDsInfo?: { external_resource_url?: string; creq?: string };
                  };

                  if (!res.ok || data.rejected || !data.orderId) {
                    // Generate a fresh idempotency key so a corrected retry isn't blocked by deduplication
                    setIdempotencyKey(`mp_${generateRandomToken(12)}`);
                    const friendlyErr =
                      data.error ||
                      'Não foi possível aprovar o pagamento com este cartão. Revise os dados ou tente outro cartão.';
                    setErrorMsg(friendlyErr);
                    throw new Error(friendlyErr);
                  }

                  const resolvedAmountCents = data.totalAmountCents ?? state.selection.amountCents;
                  const resolvedTitle = data.giftTitle || state.selection.giftTitle;
                  const resolvedItems: GiftOrderItemSnapshot[] = (
                    data.items && data.items.length > 0 ? data.items : state.selection.snapshotItems
                  ).map((i) => ({
                    giftId: i.giftId.slice(0, 128),
                    title: i.title.slice(0, 140),
                    quotas: Math.min(100, Math.max(1, Math.round(i.quotas))),
                    unitPriceCents: Math.round(i.unitPriceCents),
                    totalCents: Math.round(i.totalCents),
                  }));

                  setFirestoreSyncWarning(null);
                  if (!data.persistedByServer && !data.deduplicated) {
                    const expiryMinutes = state.settings.giftReservationExpiryMinutes || 60;
                    const expiresAtIso =
                      data.expiresAtIso ||
                      new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

                    const persistResult = await persistCardOrderInFirestore({
                      orderId: data.orderId,
                      orderTokenHash,
                      idempotencyKey: state.idempotencyKey,
                      mpOrderId: data.mpOrderId,
                      mpPaymentId: data.mpPaymentId,
                      mpStatus: data.mpStatus || (data.isPaid ? 'approved' : 'in_process'),
                      mpStatusDetail: data.mpStatusDetail,
                      mpPaymentType: data.mpPaymentType || `card_brick_${formData.payment_method_id}`,
                      expiresAtIso,
                      resolvedTitle,
                      resolvedAmountCents,
                      isCustomAmount: Boolean(data.isCustomAmount ?? state.selection.isCustomAmount),
                      quotas: data.quotas ?? state.selection.quotas,
                      resolvedItems,
                      giverName: cleanName,
                      combinedContact,
                      isDemo: Boolean(state.isDemoMode || state.demoAdminActive),
                    });
                    if (!persistResult.persisted && persistResult.warning) {
                      setFirestoreSyncWarning(persistResult.warning);
                    }
                  }

                  if (state.selection.scope === 'cart' && !state.selection.isCustomAmount) {
                    clearCart();
                  }

                  setCardResult({
                    orderId: data.orderId,
                    mpPaymentId: data.mpPaymentId,
                    mpOrderId: data.mpOrderId,
                    mpStatus: data.mpStatus || (data.isPaid ? 'approved' : 'in_process'),
                    mpStatusDetail: data.mpStatusDetail,
                    mpPaymentType: data.mpPaymentType,
                    isPaid: Boolean(data.isPaid),
                    isPending: Boolean(data.isPending),
                    totalAmountCents: resolvedAmountCents,
                    giftTitle: resolvedTitle,
                    testMode: Boolean(data.testMode),
                    threeDsInfo: data.threeDsInfo,
                  });
                } finally {
                  processingRef.current = false;
                  setProcessingPayment(false);
                }
              },
            },
          }
        );

        if (cancelled) {
          void controller.unmount();
          return;
        }
        brickControllerRef.current = controller;
      } catch (err) {
        if (!cancelled) {
          setBrickLoading(false);
          setBrickLoadError(
            err instanceof Error
              ? err.message
              : 'Não foi possível inicializar o pagamento com cartão no site.'
          );
        }
      }
    };

    void mountBrick();

    return () => {
      cancelled = true;
      if (brickControllerRef.current) {
        try {
          void brickControllerRef.current.unmount();
        } catch {
          // ignore unmount cleanup errors
        }
        brickControllerRef.current = null;
      }
    };
  }, [
    isCardBrickReady,
    resolvedPublicKey,
    selection.hasValidSelection,
    selection.amountCents,
    cardResult,
    checkoutProSession,
    persistCardOrderInFirestore,
    clearCart,
  ]);

  const handleRefreshPaymentStatus = async () => {
    if (!cardResult?.orderId || checkingResultStatus) return;
    setCheckingResultStatus(true);
    try {
      const res = await fetch(
        `/api/mercadopago/orders/${encodeURIComponent(cardResult.orderId)}/status`
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        mpPaymentId?: string;
        mpOrderId?: string;
        mpStatus?: string;
        mpStatusDetail?: string;
        isPaid?: boolean;
        isPending?: boolean;
        isFailed?: boolean;
        totalAmountCents?: number;
      };
      if (res.ok && data.ok) {
        setCardResult((prev) =>
          prev
            ? {
                ...prev,
                mpPaymentId: data.mpPaymentId || prev.mpPaymentId,
                mpOrderId: data.mpOrderId || prev.mpOrderId,
                mpStatus: data.mpStatus || prev.mpStatus,
                mpStatusDetail: data.mpStatusDetail || prev.mpStatusDetail,
                isPaid: Boolean(data.isPaid),
                isPending: Boolean(data.isPending),
                isFailed: Boolean(data.isFailed),
                totalAmountCents: data.totalAmountCents || prev.totalAmountCents,
              }
            : prev
        );
      }
    } finally {
      setCheckingResultStatus(false);
    }
  };

  const handleStartOptionalCheckoutPro = async () => {
    setErrorMsg(null);
    if (!isCardBrickReady) {
      setErrorMsg(
        'Pagamento com cartão temporariamente indisponível enquanto finalizamos a ativação. Você pode presentear via Pix direto!'
      );
      return;
    }
    if (!selection.hasValidSelection || selection.amountCents < 100) {
      setErrorMsg(selection.invalidReason || 'Selecione um presente ou valor válido.');
      return;
    }

    const cleanName = giverName.trim().slice(0, 120);
    if (cleanName.length < 2) {
      setErrorMsg('Informe seu nome completo acima antes de continuar no Mercado Pago.');
      giverNameRef.current?.focus();
      return;
    }
    if (!lgpdConsent) {
      setErrorMsg('Marque a autorização da política de privacidade (LGPD) para continuar.');
      lgpdCheckboxRef.current?.focus();
      return;
    }

    const combinedContact = 'Não informado';

    setCreatingCheckoutPro(true);
    try {
      const orderId = `ord_${generateRandomToken(8)}`;
      const orderToken = generateRandomToken(16);
      const orderTokenHash = await sha256Hex(orderToken);

      const payloadItems = selection.isCustomAmount
        ? undefined
        : selection.items.map((item) => {
            const isFlex =
              item.gift.category === 'Lua de mel' || item.gift.giftType === 'symbolic';
            return {
              giftId: item.gift.id,
              quotas: isFlex ? 1 : item.quotas,
              ...(isFlex
                ? { customAmountCents: item.customAmountCents ?? item.gift.priceCents }
                : {}),
            };
          });

      const res = await fetch('/api/mercadopago/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          idempotencyKey,
          method: 'card',
          mode: selection.isCustomAmount
            ? 'custom'
            : selection.scope === 'gift'
              ? 'gift'
              : 'cart',
          items: payloadItems,
          ...(selection.isCustomAmount ? { customAmountCents: selection.amountCents } : {}),
          giverName: cleanName,
          giverContact: combinedContact,
          lgpdConsent: true,
          orderTokenHash,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        orderId?: string;
        mpOrderId?: string;
        checkoutUrl?: string;
        expiresAtIso?: string;
        totalAmountCents?: number;
        giftTitle?: string;
        isCustomAmount?: boolean;
        quotas?: number;
        items?: GiftOrderItemSnapshot[];
        mpStatus?: string;
        persistedByServer?: boolean;
        deduplicated?: boolean;
        testMode?: boolean;
      };

      if (!res.ok || !data.checkoutUrl || !data.orderId || !data.mpOrderId) {
        setErrorMsg(
          data.error || 'Não foi possível abrir sua conta no Mercado Pago agora. Tente novamente.'
        );
        return;
      }

      const resolvedAmountCents = data.totalAmountCents ?? selection.amountCents;
      const resolvedTitle = data.giftTitle || selection.giftTitle;
      const resolvedItems: GiftOrderItemSnapshot[] = (
        data.items && data.items.length > 0 ? data.items : selection.snapshotItems
      ).map((i) => ({
        giftId: i.giftId.slice(0, 128),
        title: i.title.slice(0, 140),
        quotas: Math.min(100, Math.max(1, Math.round(i.quotas))),
        unitPriceCents: Math.round(i.unitPriceCents),
        totalCents: Math.round(i.totalCents),
      }));

      if (!data.persistedByServer && !data.deduplicated) {
        const expiryMinutes = settings.giftReservationExpiryMinutes || 60;
        const expiresAtIso =
          data.expiresAtIso || new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

        const persistResult = await persistCardOrderInFirestore({
          orderId: data.orderId,
          orderTokenHash,
          idempotencyKey,
          mpOrderId: data.mpOrderId,
          mpStatus: data.mpStatus || 'created',
          mpPaymentType: 'checkout_pro',
          checkoutUrl: data.checkoutUrl,
          expiresAtIso,
          resolvedTitle,
          resolvedAmountCents,
          isCustomAmount: Boolean(data.isCustomAmount ?? selection.isCustomAmount),
          quotas: data.quotas ?? selection.quotas,
          resolvedItems,
          giverName: cleanName,
          combinedContact,
          isDemo: Boolean(isDemoMode || demoAdminActive),
        });
        if (!persistResult.persisted) {
          setErrorMsg(
            persistResult.warning ||
              'Não foi possível registrar seu pedido antes de abrir o pagamento. Tente novamente em instantes ou use o Pix direto.'
          );
          return;
        }
      }

      if (selection.scope === 'cart' && !selection.isCustomAmount) {
        clearCart();
      }

      setCheckoutProSession({
        orderId: data.orderId,
        mpOrderId: data.mpOrderId,
        checkoutUrl: data.checkoutUrl,
        amountCents: resolvedAmountCents,
        giftTitle: resolvedTitle,
        testMode: Boolean(data.testMode),
      });

      try {
        if (window.top && window.top !== window.self) {
          window.top.location.href = data.checkoutUrl;
          return;
        }
      } catch {
        // Cross-origin frame protection; visible fallback link stays rendered
      }
      window.location.assign(data.checkoutUrl);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Erro ao conectar com o Mercado Pago agora.'
      );
    } finally {
      setCreatingCheckoutPro(false);
    }
  };

  return (
    <div className="relative overflow-hidden py-12 sm:py-20">
      <WatercolorCorners variant="section" />
      <div className="relative z-20 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <header className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.22em] text-oliva uppercase">
            Presentear com Cartão
          </p>
          <h1 className="mt-3 font-display text-3xl sm:text-5xl font-semibold text-marrom leading-tight">
            Carinho em forma de presente 🌻
          </h1>
          <p className="mt-3 text-base text-marrom-suave">
            Conclua seu presente com cartão de crédito com praticidade e segurança.
          </p>
        </header>

        {!cardResult && !checkoutProSession && !selection.hasValidSelection ? (
          <div className="mt-10 rounded-xl border border-dourado/50 bg-creme-claro p-8 text-center space-y-4">
            <CreditCard className="mx-auto h-10 w-10 text-terracota-escuro" />
            <h2 className="font-display text-2xl font-semibold text-marrom">
              Escolha um presente ou valor primeiro
            </h2>
            <p className="text-sm text-marrom-suave max-w-md mx-auto">
              {selection.invalidReason ||
                'Selecione um presente da lista ou informe o valor desejado na página de presentes antes de preencher o cartão.'}
            </p>
            <div className="pt-2">
              <Link
                to="/presentes"
                className="inline-flex items-center gap-2 rounded-md bg-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar para Presentes
              </Link>
            </div>
          </div>
        ) : cardResult ? (
          <div className="mt-8 rounded-xl border border-dourado/55 bg-creme-claro p-6 sm:p-10 text-center space-y-5 shadow-sm">
            {cardResult.isPaid ? (
              <CheckCircle2 className="mx-auto h-12 w-12 text-oliva" />
            ) : cardResult.isFailed ? (
              <AlertTriangle className="mx-auto h-12 w-12 text-terracota-escuro" />
            ) : (
              <Clock className="mx-auto h-12 w-12 text-terracota-escuro" />
            )}

            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-oliva uppercase">
                Pedido nº {cardResult.orderId}
                {cardResult.mpPaymentId ? ` · Pagamento #${cardResult.mpPaymentId}` : ''}
                {cardResult.testMode ? ' · Testes' : ''}
              </p>
              <h2 className="mt-2 font-display text-3xl sm:text-4xl font-semibold text-marrom">
                {cardResult.isPaid
                  ? 'Presente confirmado com sucesso! 🌻💛'
                  : cardResult.threeDsInfo?.external_resource_url
                    ? 'Verificação adicional do banco'
                    : cardResult.isFailed
                      ? 'Pagamento não concluído'
                      : 'Pagamento em análise no Mercado Pago'}
              </h2>
              <p className="mt-2 text-sm text-marrom-suave">
                {cardResult.giftTitle} —{' '}
                <strong className="text-terracota-escuro tabular-nums">
                  {formatBRL(cardResult.totalAmountCents)}
                </strong>
              </p>
            </div>

            {cardResult.isPaid ? (
              <p className="mx-auto max-w-xl text-sm leading-relaxed text-marrom-suave">
                Seu pagamento com cartão foi aprovado pelo Mercado Pago! {settings.coupleNames}{' '}
                agradecem imensamente pelo carinho em fazer parte desse sonho.
              </p>
            ) : cardResult.threeDsInfo?.external_resource_url ? (
              <div className="mx-auto max-w-xl space-y-4 rounded-lg border border-dourado/45 bg-marfim p-5 text-sm text-marrom-suave">
                <p>
                  Seu banco solicitou uma confirmação adicional para concluir a compra com
                  segurança. Conclua a verificação abaixo e depois atualize o status:
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <a
                    href={cardResult.threeDsInfo.external_resource_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full sm:w-auto min-h-[44px] items-center justify-center gap-2 rounded-md bg-terracota-escuro px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-creme-claro hover:bg-terracota transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir verificação do banco
                  </a>
                  <button
                    type="button"
                    disabled={checkingResultStatus}
                    onClick={handleRefreshPaymentStatus}
                    className="inline-flex w-full sm:w-auto min-h-[44px] items-center justify-center gap-2 rounded-md border border-dourado bg-creme px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-marrom hover:bg-pergaminho"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${checkingResultStatus ? 'animate-spin' : ''}`}
                    />
                    Já verifiquei · Atualizar status
                  </button>
                </div>
              </div>
            ) : cardResult.isFailed ? (
              <div className="mx-auto max-w-xl space-y-3 text-sm text-marrom-suave">
                <p>
                  O pagamento não foi aprovado ou foi cancelado pela operadora do cartão. Você pode
                  tentar novamente ou escolher presentear com Pix direto.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCardResult(null);
                      setErrorMsg(null);
                      setIdempotencyKey(`mp_${generateRandomToken(12)}`);
                    }}
                    className="inline-flex w-full sm:w-auto min-h-[44px] items-center justify-center rounded-md border border-dourado bg-creme px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-marrom hover:bg-pergaminho"
                  >
                    Tentar com outro cartão
                  </button>
                  <Link
                    to={`/presentear/pix${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
                    className="inline-flex w-full sm:w-auto min-h-[44px] items-center justify-center gap-2 rounded-md bg-terracota-escuro px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-creme-claro hover:bg-terracota"
                  >
                    <QrCode className="h-4 w-4" />
                    Presentear com Pix
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-xl space-y-3 text-sm text-marrom-suave">
                <p>
                  Seu pagamento está em análise pelo banco emissor. Assim que houver confirmação,
                  o pedido será atualizado automaticamente.
                </p>
                <button
                  type="button"
                  disabled={checkingResultStatus}
                  onClick={handleRefreshPaymentStatus}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-dourado bg-creme px-4 py-2 text-xs font-semibold uppercase tracking-wider text-marrom hover:bg-pergaminho"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${checkingResultStatus ? 'animate-spin' : ''}`}
                  />
                  Atualizar status do pagamento
                </button>
              </div>
            )}

            {firestoreSyncWarning && (
              <div className="mx-auto max-w-xl rounded-lg border border-terracota/40 bg-terracota/10 px-4 py-3 text-xs text-terracota-escuro text-left">
                {firestoreSyncWarning}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Link
                to="/presentes"
                className="w-full sm:w-auto rounded-md bg-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors"
              >
                Voltar aos presentes
              </Link>
              <Link
                to="/recados"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md border border-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-terracota-escuro uppercase hover:bg-pergaminho transition-colors"
              >
                <Heart className="h-4 w-4" />
                Deixar recado no mural
              </Link>
            </div>
          </div>
        ) : checkoutProSession ? (
          <div className="mt-8 space-y-6 rounded-xl border border-dourado/50 bg-creme-claro p-6 sm:p-10 shadow-sm text-center">
            <CreditCard className="mx-auto h-11 w-11 text-terracota-escuro" />
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-oliva uppercase">
                Pedido nº {checkoutProSession.orderId} · MP {checkoutProSession.mpOrderId}
                {checkoutProSession.testMode ? ' · Testes' : ''}
              </p>
              <h2 className="mt-2 font-display text-3xl font-semibold text-marrom">
                Continuando no Mercado Pago
              </h2>
              <p className="mt-2 text-sm text-marrom-suave">
                {checkoutProSession.giftTitle} —{' '}
                <strong className="text-terracota-escuro tabular-nums">
                  {formatBRL(checkoutProSession.amountCents)}
                </strong>
              </p>
            </div>
            <p className="mx-auto max-w-xl text-sm text-marrom-suave">
              Caso a página segura da sua conta Mercado Pago não tenha aberto automaticamente,
              clique no botão abaixo:
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <a
                href={checkoutProSession.checkoutUrl}
                target="_top"
                rel="noopener noreferrer"
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-md bg-terracota-escuro px-7 py-3.5 text-xs font-semibold tracking-wider text-creme-claro uppercase shadow-sm hover:bg-terracota transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Continuar no Mercado Pago
              </a>
              <Link
                to={`/obrigado?pedido=${encodeURIComponent(checkoutProSession.orderId)}&provider=mercadopago`}
                className="inline-flex w-full sm:w-auto items-center justify-center rounded-md border border-dourado/70 bg-creme px-5 py-3 text-xs font-semibold tracking-wider text-marrom uppercase hover:bg-pergaminho transition-colors"
              >
                Consultar status do pedido
              </Link>
            </div>
          </div>
        ) : statusLoading ? (
          <div className="mt-8 rounded-xl border border-dourado/45 bg-creme-claro p-8 text-center text-sm text-marrom-suave">
            Verificando disponibilidade do pagamento com cartão no Mercado Pago...
          </div>
        ) : !isCardBrickReady ? (
          <div className="mt-8 rounded-xl border border-dourado/55 bg-creme-claro p-6 sm:p-10 text-center space-y-5 shadow-sm">
            <CreditCard className="mx-auto h-10 w-10 text-terracota-escuro" />
            <div className="space-y-2">
              <h2 className="font-display text-2xl sm:text-3xl font-semibold text-marrom">
                Pagamento com cartão temporariamente indisponível
              </h2>
              <p className="mx-auto max-w-xl text-sm leading-relaxed text-marrom-suave">
                O pagamento com cartão está temporariamente indisponível no momento. Enquanto
                isso, você pode presentear os noivos normalmente com Pix direto.
              </p>
            </div>

            {selection.hasValidSelection && (
              <div className="mx-auto max-w-md rounded-lg border border-dourado/35 bg-creme/65 px-4 py-3 text-sm text-marrom flex items-center justify-between gap-3">
                <span className="truncate">{selection.giftTitle}</span>
                <strong className="text-terracota-escuro tabular-nums shrink-0">
                  {formatBRL(selection.amountCents)}
                </strong>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
              <Link
                to={`/presentear/pix${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-md bg-terracota-escuro px-6 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors"
              >
                <QrCode className="h-4 w-4" />
                Presentear com Pix direto
              </Link>
              <Link
                to="/presentes"
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-md border border-dourado/70 bg-creme px-5 py-3 text-xs font-semibold tracking-wider text-marrom uppercase hover:bg-pergaminho transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar para Presentes
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-8 space-y-6 rounded-xl border border-dourado/45 bg-creme-claro p-5 sm:p-10 shadow-sm">
            {/* Chosen gift / amount summary */}
            <div className="rounded-lg border border-dourado/35 bg-creme/65 p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold tracking-wider text-salvia uppercase">
                  Resumo do seu presente
                </p>
                <Link
                  to="/presentes"
                  className="text-xs font-medium text-marrom-suave underline decoration-dourado/70 underline-offset-2 hover:text-terracota-escuro transition-colors"
                >
                  Alterar presente ou valor
                </Link>
              </div>

              {selection.isCustomAmount ? (
                <div className="flex items-center justify-between text-sm text-marrom">
                  <span>{selection.giftTitle}</span>
                  <span className="font-semibold text-terracota-escuro tabular-nums">
                    {formatBRL(selection.amountCents)}
                  </span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selection.snapshotItems.map((item) => (
                    <div
                      key={item.giftId}
                      className="flex items-center justify-between text-sm text-marrom"
                    >
                      <span>
                        {item.title} ({item.quotas}x)
                      </span>
                      <span className="font-semibold tabular-nums">
                        {formatBRL(item.totalCents)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-dourado/25 pt-2.5 text-base font-semibold text-terracota-escuro">
                    <span>Total no Cartão</span>
                    <span className="tabular-nums">{formatBRL(selection.amountCents)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Guest identification (simplified, without optional phone/message fields) */}
            <div className="space-y-4">
              <div>
                <label htmlFor="card-giver-name" className="block text-sm font-medium text-marrom">
                  Seu nome completo *
                </label>
                <input
                  ref={giverNameRef}
                  id="card-giver-name"
                  type="text"
                  required
                  maxLength={120}
                  autoComplete="name"
                  value={giverName}
                  onChange={(e) => {
                    setErrorMsg(null);
                    setGiverName(e.target.value);
                  }}
                  placeholder="Ex.: Maria Oliveira"
                  className="mt-1.5 min-h-[44px] w-full rounded-md border border-dourado/45 bg-marfim px-3.5 py-2.5 text-base sm:text-sm text-marrom focus:border-terracota-escuro focus:outline-none"
                />
              </div>

              <label className="flex items-start gap-3 text-xs leading-relaxed text-marrom-suave cursor-pointer">
                <input
                  ref={lgpdCheckboxRef}
                  type="checkbox"
                  checked={lgpdConsent}
                  onChange={(e) => {
                    setErrorMsg(null);
                    setLgpdConsent(e.target.checked);
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-dourado accent-terracota-escuro"
                />
                <span>
                  Autorizo o uso dos meus dados exclusivamente para identificar meu presente e
                  processar o pagamento junto aos noivos (LGPD).{' '}
                  <button
                    type="button"
                    onClick={() => setPrivacyModalOpen(true)}
                    className="font-semibold text-terracota-escuro underline"
                  >
                    Ler política
                  </button>
                </span>
              </label>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-lg border border-terracota/45 bg-terracota/10 px-4 py-3 text-sm text-terracota-escuro space-y-2"
              >
                <p className="font-medium">{errorMsg}</p>
                <p className="text-xs text-marrom-suave">
                  Você pode revisar os dados do cartão, tentar outro cartão ou{' '}
                  <Link
                    to={`/presentear/pix${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
                    className="font-semibold text-terracota-escuro underline"
                  >
                    presentear com Pix direto
                  </Link>
                  .
                </p>
              </div>
            )}

            {/* Neutral Financial Card Payment Container (Official Mercado Pago Card Brick) */}
            <section
              aria-label="Pagamento seguro com cartão"
              className="financial-checkout-zone space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Lock className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900">Pagamento seguro</h2>
                    <p className="text-xs text-slate-600">
                      Seus dados de pagamento são protegidos durante a transação.
                    </p>
                  </div>
                </div>
                {mpStatus?.configured && isCardBrickReady && (
                  <div
                    className="flex items-center gap-2 shrink-0 px-1 py-0.5"
                    aria-label="Processado pelo Mercado Pago"
                  >
                    <img
                      src="/images/mercado-pago-logo.svg"
                      alt="Mercado Pago"
                      width={24}
                      height={24}
                      className="h-6 w-6 shrink-0 object-contain"
                    />
                    <div className="leading-tight">
                      <span className="block text-xs font-semibold tracking-tight text-[#0A0080]">
                        Mercado Pago
                      </span>
                      {mpStatus?.testMode && (
                        <span className="block text-[10px] font-medium text-slate-500">
                          Modo de testes
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate-600">Total do presente</span>
                  <span className="text-lg font-bold text-slate-900 tabular-nums">
                    {formatBRL(selection.amountCents)}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  O valor total e eventuais condições de parcelamento são exibidos antes da
                  confirmação.
                </p>
              </div>

              {statusLoading ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 py-8 text-center text-xs text-slate-600">
                  Carregando pagamento com cartão...
                </div>
              ) : !mpStatus?.configured || !isCardBrickReady ? (
                <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-900">
                      Pagamento com cartão indisponível no momento
                    </p>
                    <p className="mt-1 leading-relaxed">
                      Você pode{' '}
                      <Link
                        to={`/presentear/pix${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
                        className="font-semibold text-slate-900 underline"
                      >
                        presentear via Pix direto
                      </Link>{' '}
                      ou tentar novamente em instantes.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {brickLoading && !brickReady && (
                    <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-8 text-xs text-slate-600">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-500" />
                      <span>Carregando formulário de pagamento...</span>
                    </div>
                  )}
                  {brickLoadError && (
                    <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                      {brickLoadError}
                    </p>
                  )}
                  <div
                    id="mp-card-brick-container"
                    className={processingPayment ? 'opacity-60 pointer-events-none select-none' : ''}
                  />
                  {processingPayment && (
                    <div
                      role="status"
                      className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-800"
                    >
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-700" />
                      <span>Confirmando pagamento com segurança. Aguarde um instante...</span>
                    </div>
                  )}
                </>
              )}

              {mpStatus?.configured && isCardBrickReady && (
                <div className="flex items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
                  <Lock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span>Pagamento processado com segurança pelo Mercado Pago.</span>
                </div>
              )}
            </section>

            {/* Discreet Optional Mercado Pago Account (Checkout Pro) */}
            {isCardBrickReady && mpStatus?.configured && (
              <div className="border-t border-dourado/25 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCheckoutProOption((prev) => !prev)}
                  aria-expanded={showCheckoutProOption}
                  className="mx-auto flex min-h-[44px] items-center justify-center gap-1.5 px-2 text-xs font-medium text-marrom-suave hover:text-terracota-escuro transition-colors"
                >
                  <span>Prefere pagar com sua conta Mercado Pago?</span>
                  {showCheckoutProOption ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>

                {showCheckoutProOption && (
                  <div className="mt-2 rounded-lg border border-dourado/35 bg-creme/60 p-4 text-center space-y-3">
                    <p className="text-xs leading-relaxed text-marrom-suave max-w-lg mx-auto">
                      Você será direcionado ao ambiente do Mercado Pago para concluir o pagamento
                      com os meios salvos em sua conta.
                    </p>
                    <button
                      type="button"
                      disabled={creatingCheckoutPro}
                      onClick={handleStartOptionalCheckoutPro}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-dourado bg-creme-claro px-5 py-2.5 text-xs font-semibold tracking-wider text-terracota-escuro uppercase hover:bg-pergaminho disabled:opacity-50 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {creatingCheckoutPro
                        ? 'Abrindo Mercado Pago...'
                        : 'Continuar no Mercado Pago'}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dourado/25 pt-4 text-xs">
              <Link
                to="/presentes"
                className="inline-flex items-center gap-1.5 font-medium text-marrom-suave hover:text-terracota-escuro transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Alterar presente ou valor
              </Link>
              <Link
                to={`/presentear/pix${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
                className="inline-flex items-center gap-1.5 font-semibold text-terracota-escuro hover:underline"
              >
                <QrCode className="h-3.5 w-3.5" />
                Prefiro presentear com Pix direto
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
