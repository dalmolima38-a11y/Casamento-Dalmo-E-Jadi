import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Heart, Minus, Plus, QrCode, ShoppingBag, X } from 'lucide-react';
import { useWedding } from '../context/WeddingContext';
import { GiftItem } from '../types/wedding';
import { formatBRL } from '../lib/pix';
import { ResilientImage } from './ResilientImage';

interface GiftDetailModalProps {
  gift: GiftItem | null;
  onClose: () => void;
  onAddToCart: (gift: GiftItem, quotas: number, customAmountCents?: number) => void;
  onPayNow: (
    gift: GiftItem,
    quotas: number,
    method: 'pix' | 'card',
    customAmountCents?: number
  ) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (giftId: string) => void;
}

const DEFAULT_CONTRIBUTION_PRESETS = [10000, 15000, 25000, 50000];

export const GiftDetailModal: React.FC<GiftDetailModalProps> = ({
  gift,
  onClose,
  onAddToCart,
  onPayNow,
  isFavorite = false,
  onToggleFavorite,
}) => {
  const { cardPaymentReady, cardPaymentStatusLoaded, cardPaymentUnavailableReason } = useWedding();
  const [quotas, setQuotas] = useState(1);
  const [customAmountReais, setCustomAmountReais] = useState('150,00');
  const [amountError, setAmountError] = useState<string | null>(null);

  useEffect(() => {
    setQuotas(1);
    setAmountError(null);
    if (gift) {
      setCustomAmountReais((gift.priceCents / 100).toFixed(2).replace('.', ','));
    }
  }, [gift]);

  useEffect(() => {
    if (!gift) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gift, onClose]);

  const presetValuesCents = useMemo(() => {
    if (!gift) return DEFAULT_CONTRIBUTION_PRESETS;
    const merged = new Set([...DEFAULT_CONTRIBUTION_PRESETS, gift.priceCents]);
    return Array.from(merged)
      .filter((v) => v >= 100)
      .sort((a, b) => a - b);
  }, [gift]);

  const parsedCustomCents = useMemo(() => {
    const cleaned = customAmountReais.replace(/[^\d,]/g, '').replace(',', '.');
    const num = Number.parseFloat(cleaned);
    if (Number.isNaN(num) || num < 1) return 0;
    return Math.round(num * 100);
  }, [customAmountReais]);

  if (!gift) return null;

  const isFlexibleGift = gift.category === 'Lua de mel' || gift.giftType === 'symbolic';
  const remaining = Math.max(0, gift.totalQuotas - gift.reservedQuotas - gift.paidQuotas);
  const fullyPaid = gift.paidQuotas >= gift.totalQuotas;
  const desiredUnits = gift.desiredUnits && gift.desiredUnits > 1 ? gift.desiredUnits : 1;
  const quotasPerUnit = gift.quotasPerUnit || 1;
  const giftedUnits = Math.floor(gift.paidQuotas / quotasPerUnit);
  const selectedTotalCents = isFlexibleGift ? parsedCustomCents : gift.priceCents * quotas;

  const availabilityText = fullyPaid
    ? 'Presente completo'
    : remaining === 0
      ? 'Reservado temporariamente'
      : 'Disponível';

  const typeLabel = isFlexibleGift ? 'Contribuição flexível' : 'Lista de Presentes';

  const handleSelectPreset = (cents: number) => {
    setAmountError(null);
    setCustomAmountReais((cents / 100).toFixed(2).replace('.', ','));
  };

  const handleDirectPayment = (method: 'pix' | 'card') => {
    if (remaining <= 0) return;
    if (method === 'card' && !cardPaymentReady) return;
    if (isFlexibleGift) {
      if (parsedCustomCents < 100) {
        setAmountError('Informe um valor a partir de R$ 1,00.');
        return;
      }
      onPayNow(gift, 1, method, parsedCustomCents);
      onClose();
      return;
    }
    onPayNow(gift, quotas, method);
    onClose();
  };

  const handleAddToCartOnly = () => {
    if (remaining <= 0) return;
    if (isFlexibleGift) {
      if (parsedCustomCents < 100) {
        setAmountError('Informe um valor a partir de R$ 1,00.');
        return;
      }
      onAddToCart(gift, 1, parsedCustomCents);
      onClose();
      return;
    }
    onAddToCart(gift, quotas);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gift-detail-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-marrom/65 p-0 sm:p-4 backdrop-blur-[2px]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92vh] w-full sm:max-w-lg overflow-y-auto rounded-t-2xl sm:rounded-xl border border-dourado/80 bg-marfim shadow-2xl"
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-dourado/35 bg-pergaminho">
          <ResilientImage
            src={gift.imageUrl}
            alt={gift.title}
            className="h-full w-full object-cover"
          />

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar detalhes do presente"
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md border border-dourado/70 bg-marfim/95 text-marrom shadow-sm hover:bg-creme transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(gift.id)}
              aria-label={
                isFavorite ? `Remover ${gift.title} dos favoritos` : `Favoritar ${gift.title}`
              }
              className="absolute left-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md border border-dourado/70 bg-marfim/95 text-terracota-escuro shadow-sm hover:bg-creme transition-colors"
            >
              <Heart className={`h-4 w-4 ${isFavorite ? 'fill-terracota-escuro' : ''}`} />
            </button>
          )}
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-marrom-suave">
              <span>{gift.category === 'Lua de mel' ? 'Lua de Mel' : gift.category}</span>
              <span aria-hidden="true">·</span>
              <span>{typeLabel}</span>
            </div>

            <h2
              id="gift-detail-title"
              className="mt-1.5 font-display text-2xl sm:text-3xl font-semibold leading-snug text-marrom"
            >
              {gift.title}
            </h2>
          </div>

          <p className="text-sm sm:text-base leading-relaxed text-marrom-suave">
            {gift.description}
          </p>

          {!isFlexibleGift && desiredUnits > 1 && (
            <div className="rounded-md border border-dourado/40 bg-creme/60 px-3.5 py-2.5 text-xs text-marrom-suave space-y-1">
              <p className="font-semibold text-marrom">
                Quantidade desejada: {desiredUnits} conjuntos
              </p>
              <p>
                {giftedUnits > 0
                  ? `${giftedUnits} de ${desiredUnits} conjuntos já presenteados.`
                  : `${desiredUnits} conjuntos disponíveis para presentear.`}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-dourado/45 bg-creme/70 px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-marrom-suave">
                Valor selecionado
              </p>
              <p className="mt-0.5 font-display text-2xl sm:text-[1.75rem] font-semibold text-terracota-escuro tabular-nums leading-tight">
                {selectedTotalCents >= 100
                  ? formatBRL(selectedTotalCents)
                  : formatBRL(gift.priceCents)}
              </p>
              {!isFlexibleGift && quotas > 1 && (
                <p className="mt-0.5 text-xs font-medium text-marrom-suave tabular-nums">
                  {quotas} unidades × {formatBRL(gift.priceCents)}
                </p>
              )}
            </div>
            <span
              className={`text-xs font-medium ${
                remaining > 0 ? 'text-oliva' : 'text-marrom-suave'
              }`}
            >
              {availabilityText}
            </span>
          </div>

          {isFlexibleGift && remaining > 0 && (
            <div className="rounded-md border border-dourado/40 bg-creme/55 p-3.5 space-y-3">
              <p className="text-xs font-medium text-marrom">
                Escolha o valor da sua contribuição:
              </p>
              <div className="flex flex-wrap gap-2">
                {presetValuesCents.map((cents) => {
                  const isSelected = parsedCustomCents === cents;
                  return (
                    <button
                      key={cents}
                      type="button"
                      onClick={() => handleSelectPreset(cents)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                        isSelected
                          ? 'border border-terracota-escuro bg-terracota-escuro text-creme-claro'
                          : 'border border-dourado/55 bg-marfim text-marrom hover:bg-pergaminho'
                      }`}
                    >
                      {formatBRL(cents)}
                    </button>
                  );
                })}
              </div>
              <div>
                <label
                  htmlFor="honeymoon-custom-value"
                  className="block text-[11px] font-medium text-marrom-suave"
                >
                  Ou informe outro valor (R$)
                </label>
                <input
                  id="honeymoon-custom-value"
                  type="text"
                  inputMode="decimal"
                  value={customAmountReais}
                  onChange={(e) => {
                    setAmountError(null);
                    setCustomAmountReais(e.target.value);
                  }}
                  placeholder="150,00"
                  className="mt-1 w-full sm:w-48 rounded-md border border-dourado/55 bg-marfim px-3 py-2 text-sm font-semibold text-terracota-escuro tabular-nums focus:border-terracota-escuro focus:outline-none"
                />
              </div>
              {amountError && (
                <p role="alert" className="text-xs text-terracota-escuro">
                  {amountError}
                </p>
              )}
            </div>
          )}

          {!isFlexibleGift && remaining > 1 && (
            <div className="flex items-center justify-between rounded-md border border-dourado/40 bg-creme/55 px-3.5 py-2.5">
              <div>
                <span className="block text-xs font-medium text-marrom">Quantidade</span>
                <span className="text-[11px] text-marrom-suave tabular-nums">
                  {quotas} {quotas === 1 ? 'unidade' : 'unidades'} · {formatBRL(selectedTotalCents)}
                </span>
              </div>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuotas((q) => Math.max(1, q - 1))}
                  aria-label="Diminuir quantidade"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-dourado/50 bg-marfim text-marrom hover:bg-pergaminho"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-6 text-center text-sm font-semibold text-marrom tabular-nums">
                  {quotas}
                </span>
                <button
                  type="button"
                  onClick={() => setQuotas((q) => Math.min(remaining, q + 1))}
                  aria-label="Aumentar quantidade"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-dourado/50 bg-marfim text-marrom hover:bg-pergaminho"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {remaining > 0 ? (
            <div className="space-y-2.5 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleDirectPayment('pix')}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-terracota-escuro bg-terracota-escuro px-4 py-3 text-xs font-semibold tracking-[0.12em] text-creme-claro uppercase shadow-xs hover:bg-terracota transition-colors"
                >
                  <QrCode className="h-4 w-4 shrink-0" />
                  PRESENTEAR COM PIX
                </button>
                <button
                  type="button"
                  disabled={!cardPaymentReady}
                  onClick={() => handleDirectPayment('card')}
                  title={
                    cardPaymentReady
                      ? 'Presentear com cartão'
                      : cardPaymentUnavailableReason ||
                        'Pagamento com cartão temporariamente indisponível'
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-dourado bg-creme px-4 py-3 text-xs font-semibold tracking-[0.12em] text-terracota-escuro uppercase shadow-xs hover:bg-pergaminho transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-creme"
                >
                  <CreditCard className="h-4 w-4 shrink-0" />
                  PRESENTEAR COM CARTÃO
                </button>
              </div>

              {cardPaymentStatusLoaded && !cardPaymentReady && (
                <p className="text-[11px] leading-snug text-marrom-suave">
                  {cardPaymentUnavailableReason ||
                    'Pagamento com cartão temporariamente indisponível enquanto finalizamos a ativação. Você pode presentear via Pix direto!'}
                </p>
              )}

              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto rounded-md border border-dourado/55 bg-marfim px-4 py-2 text-xs font-semibold tracking-wider text-marrom-suave uppercase hover:bg-pergaminho transition-colors"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={handleAddToCartOnly}
                  className="w-full flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-dourado/70 bg-creme/70 px-4 py-2 text-xs font-semibold tracking-wider text-marrom uppercase hover:bg-pergaminho transition-colors"
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  Adicionar à sacola
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-md border border-dourado/65 bg-creme/60 px-5 py-2.5 text-xs font-semibold tracking-wider text-marrom uppercase hover:bg-pergaminho transition-colors"
              >
                {fullyPaid ? 'Presente completo · Fechar' : 'Reservado temporariamente · Fechar'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
