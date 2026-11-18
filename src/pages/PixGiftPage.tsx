import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Heart,
  Lock,
  QrCode,
} from 'lucide-react';
import {
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { useWedding } from '../context/WeddingContext';
import { auth, db } from '../lib/firebase';
import { resolveCheckoutSelection } from '../lib/checkoutSelection';
import {
  buildPixBrCode,
  formatBRL,
  formatPixKeyTypeLabel,
  generateRandomToken,
  getSavedPixIdentifierLabel,
  sha256Hex,
  validatePixConfiguration,
  verifyPixBrCodeCrc,
} from '../lib/pix';
import { WatercolorCorners } from '../components/WatercolorCorners';

interface GeneratedDirectPixOrder {
  orderId: string;
  orderTokenHash: string;
  amountCents: number;
  giftTitle: string;
  brCode: string;
  pixKey: string;
  pixKeyTypeLabel: string;
  beneficiaryName: string;
  pixInstitution?: string;
  pixCity: string;
  identifierLabel: string;
  expiresAtIso: string;
  giverName: string;
}

interface DirectPixApiResponse {
  ok?: boolean;
  error?: string;
  orderId?: string;
  orderTokenHash?: string;
  idempotencyKey?: string;
  persistedByServer?: boolean;
  deduplicated?: boolean;
  amountCents?: number;
  giftTitle?: string;
  isCustomAmount?: boolean;
  quotas?: number;
  itemsSnapshot?: Array<{
    giftId: string;
    title: string;
    quotas: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  brCode?: string;
  pixKey?: string;
  pixKeyTypeLabel?: string;
  beneficiaryName?: string;
  pixInstitution?: string;
  pixCity?: string;
  identifierLabel?: string;
  expiresAtIso?: string;
  giverName?: string;
  giverContact?: string;
  messageToCouple?: string;
}

class UserFacingPixError extends Error {}

function reportPixClientError(params: {
  stage: 'create_order' | 'notify_pix';
  orderId?: string;
  error: unknown;
  payloadKeys?: string[];
}): void {
  const code =
    params.error && typeof params.error === 'object' && 'code' in params.error
      ? String((params.error as { code?: unknown }).code || '')
      : '';
  const message =
    params.error instanceof Error ? params.error.message : String(params.error || '');

  fetch('/api/pix/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({
      stage: params.stage,
      orderId: params.orderId || undefined,
      code: code || undefined,
      message: message.slice(0, 500),
      isAuthenticated: Boolean(auth.currentUser),
      isAnonymous: Boolean(auth.currentUser?.isAnonymous),
      payloadKeys: params.payloadKeys || [],
    }),
  }).catch(() => undefined);
}

async function copyTextSafely(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export const PixGiftPage: React.FC = () => {
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

  const pixValidation = useMemo(
    () =>
      validatePixConfiguration({
        pixEnabled: settings.pixEnabled,
        pixKey: settings.pixKey,
        pixKeyType: settings.pixKeyType,
        pixBeneficiaryName: settings.pixBeneficiaryName,
        pixCity: settings.pixCity,
      }),
    [
      settings.pixEnabled,
      settings.pixKey,
      settings.pixKeyType,
      settings.pixBeneficiaryName,
      settings.pixCity,
    ]
  );

  const pixIdentifierLabel = useMemo(() => getSavedPixIdentifierLabel(), []);

  const [giverName, setGiverName] = useState('');
  const [lgpdConsent, setLgpdConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generatedOrder, setGeneratedOrder] = useState<GeneratedDirectPixOrder | null>(null);

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const copyCodeTimerRef = useRef<number | null>(null);
  const copyKeyTimerRef = useRef<number | null>(null);
  const [confirmingNotice, setConfirmingNotice] = useState(false);
  const [guestNotifiedPix, setGuestNotifiedPix] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  const [idempotencyKey, setIdempotencyKey] = useState<string>(
    () => `pix_${generateRandomToken(12)}`
  );
  const clientPersistedOrderIdsRef = useRef<Set<string>>(new Set());
  const selectionQueryKey = searchParams.toString();

  useEffect(() => {
    setIdempotencyKey(`pix_${generateRandomToken(12)}`);
    setGeneratedOrder(null);
    setGuestNotifiedPix(false);
    setErrorMsg(null);
    setNotifyError(null);
    setCopiedCode(false);
    setCopiedKey(false);
  }, [selectionQueryKey]);

  useEffect(() => {
    return () => {
      if (copyCodeTimerRef.current) window.clearTimeout(copyCodeTimerRef.current);
      if (copyKeyTimerRef.current) window.clearTimeout(copyKeyTimerRef.current);
    };
  }, []);

  const handleGeneratePix = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!selection.hasValidSelection || selection.amountCents < 100) {
      setErrorMsg(
        selection.invalidReason || 'Selecione um presente ou valor antes de gerar o Pix.'
      );
      return;
    }

    if (!pixValidation.valid) {
      setErrorMsg(
        pixValidation.reason ||
          'Os dados Pix do casal ainda não estão disponíveis. Tente outra forma ou avise os noivos.'
      );
      return;
    }

    const cleanName = giverName.trim().slice(0, 120);
    if (cleanName.length < 2) {
      setErrorMsg('Informe seu nome completo para identificarmos o presente.');
      return;
    }

    if (!lgpdConsent) {
      setErrorMsg('É necessário concordar com a política de privacidade (LGPD).');
      return;
    }

    const defaultContact = 'Não informado';

    setSubmitting(true);
    let activeOrderId: string | undefined;
    let activePayloadKeys: string[] = [];

    try {
      if (isDemoMode || demoAdminActive) {
        const orderId = `ord_${generateRandomToken(8)}`;
        const orderToken = generateRandomToken(16);
        const orderTokenHash = await sha256Hex(orderToken);
        const expiryMinutes = Math.max(5, settings.giftReservationExpiryMinutes || 60);
        const expiresAtIso = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

        const brCode = buildPixBrCode({
          pixKey: pixValidation.normalizedKey,
          pixKeyType: settings.pixKeyType,
          beneficiaryName: settings.pixBeneficiaryName,
          city: settings.pixCity,
          amountCents: selection.amountCents,
          txid: orderId,
          description: pixIdentifierLabel,
        });

        if (!brCode || !verifyPixBrCodeCrc(brCode)) {
          setErrorMsg(
            'Não foi possível montar um código Pix válido com a configuração atual. Avise os noivos.'
          );
          return;
        }

        const primaryGiftId =
          !selection.isCustomAmount &&
          selection.snapshotItems[0]?.giftId &&
          selection.snapshotItems[0].giftId !== 'custom_contribution'
            ? selection.snapshotItems[0].giftId
            : undefined;

        demoActions.createGiftOrder(
          {
            id: orderId,
            ...(primaryGiftId ? { giftId: primaryGiftId } : {}),
            giftTitle: selection.giftTitle.slice(0, 160),
            itemsSnapshot: selection.snapshotItems,
            isCustomAmount: selection.isCustomAmount,
            quotas: selection.quotas,
            amountCents: selection.amountCents,
            giverName: cleanName,
            giverContact: defaultContact,
            status: 'awaiting_confirmation',
            paymentMethod: 'pix_manual',
            orderTokenHash,
            lgpdConsent: true,
            expiresAtIso,
          },
          []
        );

        if (selection.scope === 'cart' && !selection.isCustomAmount) {
          clearCart();
        }

        setGeneratedOrder({
          orderId,
          orderTokenHash,
          amountCents: selection.amountCents,
          giftTitle: selection.giftTitle,
          brCode,
          pixKey: settings.pixKey.trim(),
          pixKeyTypeLabel: formatPixKeyTypeLabel(settings.pixKeyType),
          beneficiaryName: settings.pixBeneficiaryName.trim(),
          pixInstitution: settings.pixInstitution?.trim() || undefined,
          pixCity: settings.pixCity.trim(),
          identifierLabel: pixIdentifierLabel,
          expiresAtIso,
          giverName: cleanName,
        });
        return;
      }

      const apiRes = await fetch('/api/pix/direct-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          mode: selection.scope,
          ...(selection.scope === 'custom'
            ? { customAmountCents: selection.amountCents }
            : {
                items: selection.items.map((item) => ({
                  giftId: item.gift.id,
                  quotas: item.quotas,
                  ...(typeof item.customAmountCents === 'number'
                    ? { customAmountCents: item.customAmountCents }
                    : {}),
                })),
              }),
          giverName: cleanName,
          lgpdConsent: true,
          identifierLabel: pixIdentifierLabel,
        }),
      });

      const data = (await apiRes.json().catch(() => ({}))) as DirectPixApiResponse;
      if (!apiRes.ok) {
        throw new UserFacingPixError(
          data.error ||
            'Não foi possível gerar os dados Pix agora. Verifique as informações e tente novamente.'
        );
      }

      if (
        !data.orderId ||
        !data.orderTokenHash ||
        !data.brCode ||
        !verifyPixBrCodeCrc(data.brCode) ||
        typeof data.amountCents !== 'number' ||
        !data.giftTitle ||
        !data.pixKey ||
        !data.beneficiaryName ||
        !data.pixCity ||
        !data.expiresAtIso
      ) {
        throw new UserFacingPixError(
          'Não foi possível montar um código Pix válido no momento. Tente novamente em instantes.'
        );
      }

      activeOrderId = data.orderId;

      if (!data.persistedByServer && !clientPersistedOrderIdsRef.current.has(data.orderId)) {
        const sanitizedSnapshot = (data.itemsSnapshot || selection.snapshotItems)
          .slice(0, 30)
          .map((item) => ({
            giftId: String(item.giftId).slice(0, 128),
            title: String(item.title).slice(0, 140),
            quotas: Math.min(100, Math.max(1, Math.round(Number(item.quotas) || 1))),
            unitPriceCents: Math.min(
              100_000_000,
              Math.max(100, Math.round(Number(item.unitPriceCents) || 100))
            ),
            totalCents: Math.min(
              100_000_000,
              Math.max(100, Math.round(Number(item.totalCents) || 100))
            ),
          }));

        const isCustomOrder = Boolean(data.isCustomAmount);
        const primaryGiftId =
          !isCustomOrder &&
          sanitizedSnapshot[0]?.giftId &&
          sanitizedSnapshot[0].giftId !== 'custom_contribution' &&
          !sanitizedSnapshot[0].giftId.startsWith('demo-')
            ? sanitizedSnapshot[0].giftId
            : undefined;

        const now = serverTimestamp();
        const includeItemsSnapshot = !isCustomOrder && sanitizedSnapshot.length > 1;
        const baseOrderPayload: Record<string, unknown> = {
          ...(primaryGiftId ? { giftId: primaryGiftId } : {}),
          giftTitle: data.giftTitle.slice(0, 160),
          isCustomAmount: isCustomOrder,
          quotas: Math.min(100, Math.max(1, Math.round(Number(data.quotas) || 1))),
          amountCents: Math.min(100_000_000, Math.max(100, Math.round(data.amountCents))),
          giverName: (data.giverName || cleanName).slice(0, 120),
          giverContact: (data.giverContact || defaultContact).slice(0, 140),
          status: 'awaiting_confirmation',
          paymentMethod: 'pix_manual',
          orderTokenHash: data.orderTokenHash,
          lgpdConsent: true,
          expiresAtIso: data.expiresAtIso.slice(0, 40),
          createdAt: now,
          updatedAt: now,
        };

        const orderDocPayload: Record<string, unknown> = includeItemsSnapshot
          ? { ...baseOrderPayload, itemsSnapshot: sanitizedSnapshot }
          : baseOrderPayload;

        activePayloadKeys = Object.keys(orderDocPayload);
        try {
          await setDoc(doc(db, 'gift_orders', data.orderId), orderDocPayload);
        } catch (writeErr) {
          const errCode =
            writeErr && typeof writeErr === 'object' && 'code' in writeErr
              ? String((writeErr as { code?: unknown }).code || '')
              : '';
          if (includeItemsSnapshot && errCode === 'permission-denied') {
            activePayloadKeys = Object.keys(baseOrderPayload);
            await setDoc(doc(db, 'gift_orders', data.orderId), baseOrderPayload);
          } else {
            throw writeErr;
          }
        }
        clientPersistedOrderIdsRef.current.add(data.orderId);
      }

      if (selection.scope === 'cart' && !selection.isCustomAmount) {
        clearCart();
      }

      setGeneratedOrder({
        orderId: data.orderId,
        orderTokenHash: data.orderTokenHash,
        amountCents: data.amountCents,
        giftTitle: data.giftTitle,
        brCode: data.brCode,
        pixKey: data.pixKey,
        pixKeyTypeLabel: data.pixKeyTypeLabel || formatPixKeyTypeLabel(settings.pixKeyType),
        beneficiaryName: data.beneficiaryName,
        pixInstitution: data.pixInstitution?.trim() || undefined,
        pixCity: data.pixCity,
        identifierLabel: data.identifierLabel || pixIdentifierLabel,
        expiresAtIso: data.expiresAtIso,
        giverName: data.giverName || cleanName,
      });
    } catch (err) {
      if (err instanceof UserFacingPixError) {
        setErrorMsg(err.message);
      } else {
        reportPixClientError({
          stage: 'create_order',
          orderId: activeOrderId,
          error: err,
          payloadKeys: activePayloadKeys,
        });
        setErrorMsg(
          'Não foi possível registrar seu pedido Pix no momento. Tente novamente em instantes ou entre em contato com os noivos.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuestInformedPix = async () => {
    if (!generatedOrder || confirmingNotice || guestNotifiedPix) return;
    setConfirmingNotice(true);
    setNotifyError(null);
    const timestampLabel = new Date().toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const note = `Convidado informou Pix em ${timestampLabel}`.slice(0, 300);

    try {
      if (isDemoMode || demoAdminActive) {
        demoActions.attachOrderReceipt(generatedOrder.orderId, note);
      } else {
        await updateDoc(doc(db, 'gift_orders', generatedOrder.orderId), {
          status: 'awaiting_confirmation',
          receiptProofHash: generatedOrder.orderTokenHash,
          receiptNote: note,
          updatedAt: serverTimestamp(),
        });
      }
      setGuestNotifiedPix(true);
    } catch (err) {
      reportPixClientError({
        stage: 'notify_pix',
        orderId: generatedOrder.orderId,
        error: err,
        payloadKeys: ['status', 'receiptProofHash', 'receiptNote', 'updatedAt'],
      });
      setNotifyError(
        'Não foi possível enviar o aviso agora, mas seu pedido Pix já está registrado. Guarde seu comprovante e tente novamente em instantes.'
      );
    } finally {
      setConfirmingNotice(false);
    }
  };

  return (
    <div className="relative overflow-hidden py-12 sm:py-20">
      <WatercolorCorners variant="section" />
      <div className="relative z-20 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <header className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.22em] text-oliva uppercase">
            Presentear via Pix direto
          </p>
          <h1 className="mt-3 font-display text-3xl sm:text-5xl font-semibold text-marrom leading-tight">
            Seu carinho se transforma em presente 🌻
          </h1>
          <p className="mt-3 text-base text-marrom-suave">
            Escolha como realizar seu Pix e faça parte dos nossos sonhos.
          </p>
        </header>

        {!generatedOrder && !selection.hasValidSelection ? (
          <div className="mt-10 rounded-xl border border-dourado/50 bg-creme-claro p-8 text-center space-y-4">
            <QrCode className="mx-auto h-10 w-10 text-terracota-escuro" />
            <h2 className="font-display text-2xl font-semibold text-marrom">
              Escolha um presente ou valor primeiro
            </h2>
            <p className="text-sm text-marrom-suave max-w-md mx-auto">
              {selection.invalidReason ||
                'Para gerar o QR Code Pix, selecione um presente da lista ou informe o valor desejado na página de presentes.'}
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
        ) : generatedOrder ? (
          <div className="mt-8 space-y-6 rounded-xl border border-dourado/55 bg-creme-claro p-6 sm:p-10 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-dourado/25 pb-5">
              <div className="space-y-1.5 min-w-0">
                <p className="text-xs font-semibold tracking-wider text-oliva uppercase">
                  Pedido nº {generatedOrder.orderId}
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-semibold text-marrom">
                  Dados para transferência Pix
                </h2>
                <div className="space-y-0.5 text-sm text-marrom-suave">
                  <p>
                    <span className="font-medium text-marrom">Presenteador(a):</span>{' '}
                    {generatedOrder.giverName}
                  </p>
                  <p>
                    <span className="font-medium text-marrom">Resumo do presente:</span>{' '}
                    {generatedOrder.giftTitle}
                  </p>
                </div>
              </div>
              <div className="text-left sm:text-right shrink-0">
                <span className="block text-xs text-marrom-suave">Valor do presente</span>
                <span className="font-display text-3xl font-semibold text-terracota-escuro tabular-nums">
                  {formatBRL(generatedOrder.amountCents)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[248px_1fr] gap-6 items-start">
              {/* 1. QR Code Pix */}
              <div className="flex flex-col items-center rounded-lg border border-dourado/45 bg-white p-5 text-center shadow-xs">
                <span className="mb-3 block text-xs font-semibold uppercase tracking-wider text-marrom">
                  1. QR Code Pix
                </span>
                <QRCodeSVG
                  value={generatedOrder.brCode}
                  size={200}
                  bgColor="#FFFFFF"
                  fgColor="#49352B"
                  level="M"
                />
                <p className="mt-3 text-xs leading-relaxed text-marrom-suave">
                  Abra o aplicativo do seu banco e aponte a câmera para o QR Code.
                </p>
              </div>

              {/* 2. Pix Copia e Cola & 3. Chave Pix */}
              <div className="space-y-4 min-w-0">
                <div className="rounded-lg border border-dourado/40 bg-marfim p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-marrom">
                      2. Pix Copia e Cola
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const copied = await copyTextSafely(generatedOrder.brCode);
                        if (copied) {
                          setCopiedCode(true);
                          if (copyCodeTimerRef.current) {
                            window.clearTimeout(copyCodeTimerRef.current);
                          }
                          copyCodeTimerRef.current = window.setTimeout(
                            () => setCopiedCode(false),
                            3000
                          );
                        }
                      }}
                      className="inline-flex min-h-[44px] sm:min-h-[38px] items-center gap-1.5 rounded-md bg-terracota-escuro px-3.5 py-2 text-xs font-semibold text-creme-claro hover:bg-terracota transition-colors"
                    >
                      {copiedCode ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Copiado!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copiar código Pix
                        </>
                      )}
                    </button>
                  </div>
                  <p className="break-all rounded border border-dourado/30 bg-creme-claro p-2.5 font-mono text-[11px] leading-relaxed text-marrom-suave select-all">
                    {generatedOrder.brCode}
                  </p>
                </div>

                <div className="rounded-lg border border-dourado/40 bg-marfim p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-marrom">
                        3. Chave Pix
                      </span>
                      <p className="mt-1 break-all font-mono text-sm font-semibold text-terracota-escuro select-all">
                        {generatedOrder.pixKey}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const copied = await copyTextSafely(generatedOrder.pixKey);
                        if (copied) {
                          setCopiedKey(true);
                          if (copyKeyTimerRef.current) {
                            window.clearTimeout(copyKeyTimerRef.current);
                          }
                          copyKeyTimerRef.current = window.setTimeout(
                            () => setCopiedKey(false),
                            3000
                          );
                        }
                      }}
                      className="inline-flex min-h-[44px] sm:min-h-[38px] items-center gap-1.5 rounded-md border border-dourado/70 bg-creme-claro px-3.5 py-2 text-xs font-semibold text-marrom hover:bg-pergaminho transition-colors shrink-0"
                    >
                      {copiedKey ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-salvia" />
                          Copiado!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copiar chave Pix
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Dados do recebedor */}
            <section
              aria-label="Dados do recebedor"
              className="rounded-lg border border-dourado/45 bg-marfim p-4 sm:p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dourado/25 pb-2.5">
                <h3 className="font-display text-xl font-semibold text-marrom">
                  Dados do recebedor
                </h3>
                <span className="text-xs font-medium text-marrom-suave">
                  🌻 {generatedOrder.identifierLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs text-marrom-suave">
                <div className="min-w-0">
                  <span className="block text-[11px] uppercase tracking-wider">
                    Nome completo do titular
                  </span>
                  <strong className="mt-0.5 block text-sm text-marrom break-words">
                    {generatedOrder.beneficiaryName}
                  </strong>
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] uppercase tracking-wider">
                    Tipo de chave Pix
                  </span>
                  <strong className="mt-0.5 block text-sm text-marrom">
                    {generatedOrder.pixKeyTypeLabel}
                  </strong>
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] uppercase tracking-wider">
                    Instituição financeira
                  </span>
                  <strong className="mt-0.5 block text-sm text-marrom break-words">
                    {generatedOrder.pixInstitution || 'Conferir no aplicativo do banco'}
                  </strong>
                </div>
                <div className="min-w-0">
                  <span className="block text-[11px] uppercase tracking-wider">
                    Valor escolhido
                  </span>
                  <strong className="mt-0.5 block text-sm text-terracota-escuro tabular-nums">
                    {formatBRL(generatedOrder.amountCents)}
                  </strong>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-md border border-dourado/35 bg-creme/70 px-3.5 py-2.5 text-xs text-marrom">
                <Lock className="h-4 w-4 text-oliva shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Antes de confirmar, confira o nome do recebedor e o valor no aplicativo do seu
                  banco.
                </p>
              </div>
            </section>

            <div className="border-t border-dourado/25 pt-5 space-y-4">
              {guestNotifiedPix ? (
                <div className="rounded-lg border border-oliva/45 bg-oliva/10 p-5 text-center space-y-3">
                  <CheckCircle2 className="mx-auto h-9 w-9 text-oliva" />
                  <div>
                    <h3 className="font-display text-2xl font-semibold text-marrom">
                      Recebemos o aviso do seu Pix! 💛
                    </h3>
                    <p className="mt-1 text-sm text-marrom-suave max-w-xl mx-auto">
                      Obrigado pelo carinho, <strong>{generatedOrder.giverName}</strong>! Seu pedido (
                      <code>{generatedOrder.orderId}</code>) permanece registrado como{' '}
                      <strong>aguardando conferência dos noivos</strong> até a validação do
                      recebimento na conta.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
                    <Link
                      to="/presentes"
                      className="w-full sm:w-auto rounded-md bg-terracota-escuro px-5 py-2.5 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors"
                    >
                      Voltar aos presentes
                    </Link>
                    <Link
                      to="/recados"
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-md border border-terracota-escuro px-5 py-2.5 text-xs font-semibold tracking-wider text-terracota-escuro uppercase hover:bg-pergaminho transition-colors"
                    >
                      <Heart className="h-4 w-4" />
                      Deixar recado no mural
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-start gap-2.5 text-xs text-marrom-suave">
                    <Clock className="h-4 w-4 text-terracota-escuro shrink-0 mt-0.5" />
                    <p>
                      Após concluir a transferência no seu banco, clique ao lado para avisar os
                      noivos. A confirmação final é feita manualmente pelo casal.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={confirmingNotice}
                    onClick={handleGuestInformedPix}
                    className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-2 rounded-md bg-salvia px-6 py-3 text-xs font-semibold tracking-wider text-white uppercase hover:opacity-95 disabled:opacity-50 transition-opacity"
                  >
                    <Check className="h-4 w-4" />
                    {confirmingNotice ? 'Registrando aviso...' : 'Já realizei meu Pix'}
                  </button>
                </div>
              )}

              {notifyError && (
                <p role="alert" className="rounded-md bg-terracota/10 px-4 py-2.5 text-xs text-terracota-escuro">
                  {notifyError}
                </p>
              )}

              <div className="text-center pt-1">
                <Link
                  to="/presentes"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-marrom-suave hover:text-terracota-escuro transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Alterar presente ou valor
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleGeneratePix}
            className="mt-8 space-y-6 rounded-xl border border-dourado/45 bg-creme-claro p-6 sm:p-10 shadow-sm"
          >
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
                    <span>Total no Pix</span>
                    <span className="tabular-nums">{formatBRL(selection.amountCents)}</span>
                  </div>
                </div>
              )}
            </div>

            {!pixValidation.valid && (
              <div className="flex items-start gap-3 rounded-lg border border-terracota/45 bg-terracota/10 p-4 text-sm text-terracota-escuro">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Recebimento via Pix direto indisponível no momento</p>
                  <p className="mt-1 text-xs">{pixValidation.reason}</p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="pix-giver-name" className="block text-sm font-medium text-marrom">
                  Seu nome completo *
                </label>
                <input
                  id="pix-giver-name"
                  type="text"
                  required
                  maxLength={120}
                  autoComplete="name"
                  value={giverName}
                  onChange={(e) => setGiverName(e.target.value)}
                  placeholder="Ex.: Maria Oliveira"
                  className="mt-1.5 min-h-[44px] w-full rounded-md border border-dourado/45 bg-marfim px-3.5 py-2.5 text-base sm:text-sm text-marrom focus:border-terracota-escuro focus:outline-none"
                />
              </div>

              <label className="flex items-start gap-3 text-xs leading-relaxed text-marrom-suave cursor-pointer">
                <input
                  type="checkbox"
                  checked={lgpdConsent}
                  onChange={(e) => setLgpdConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-dourado accent-terracota-escuro"
                />
                <span>
                  Autorizo o uso dos meus dados exclusivamente para identificar meu presente junto
                  aos noivos (LGPD).{' '}
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

            <div className="flex items-start gap-2.5 rounded-md border border-dourado/30 bg-creme/60 px-3.5 py-3 text-xs text-marrom-suave">
              <Lock className="h-4 w-4 text-oliva shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-marrom">Pagamento seguro</p>
                <p className="mt-0.5 leading-relaxed">
                  Seus dados de pagamento são protegidos durante a transação. Pix direto para{' '}
                  <strong className="text-marrom">
                    {settings.pixBeneficiaryName || 'Dalmo & Jadi'}
                  </strong>{' '}
                  ({pixIdentifierLabel}), sem taxas extras.
                </p>
              </div>
            </div>

            {errorMsg && (
              <p role="alert" className="rounded-md bg-terracota/10 px-4 py-3 text-sm text-terracota-escuro">
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !pixValidation.valid}
              className="inline-flex w-full min-h-[48px] items-center justify-center gap-2 rounded-md bg-terracota-escuro px-6 py-3.5 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota disabled:opacity-50 transition-colors"
            >
              <QrCode className="h-4 w-4" />
              {submitting
                ? 'Gerando QR Code Pix...'
                : `Gerar QR Code e Pix Copia e Cola (${formatBRL(selection.amountCents)})`}
            </button>

            <div className="text-center">
              <Link
                to="/presentes"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-marrom-suave hover:text-terracota-escuro transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Alterar presente ou valor
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
