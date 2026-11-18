import { CartItem, GiftItem, GiftOrderItemSnapshot } from '../types/wedding';

export type CheckoutSelectionScope = 'gift' | 'cart' | 'custom';

export interface ResolvedCheckoutSelection {
  scope: CheckoutSelectionScope;
  hasValidSelection: boolean;
  invalidReason?: string;
  amountCents: number;
  isCustomAmount: boolean;
  quotas: number;
  giftTitle: string;
  items: CartItem[];
  snapshotItems: GiftOrderItemSnapshot[];
  directGift: GiftItem | null;
}

/**
 * Resolves the active gift/amount selection exclusively from URL query parameters,
 * catalog gifts, and cart items without ever fabricating a default contribution value.
 */
export function resolveCheckoutSelection(params: {
  searchParams: URLSearchParams;
  gifts: GiftItem[];
  cart: CartItem[];
}): ResolvedCheckoutSelection {
  const { searchParams, gifts, cart } = params;
  const paramGiftId = (searchParams.get('giftId') || '').trim();
  const paramQuotasRaw = Number.parseInt(searchParams.get('quotas') || '1', 10);
  const paramAmountRaw = Number.parseInt(searchParams.get('amount') || '0', 10);
  const paramMode = (searchParams.get('mode') || '').trim();
  const paramCustom = searchParams.get('custom') === '1';

  if (paramGiftId) {
    const gift = gifts.find((g) => g.id === paramGiftId && g.active) || null;
    if (!gift) {
      return {
        scope: 'gift',
        hasValidSelection: false,
        invalidReason: 'O presente selecionado não está mais disponível no catálogo.',
        amountCents: 0,
        isCustomAmount: false,
        quotas: 1,
        giftTitle: '',
        items: [],
        snapshotItems: [],
        directGift: null,
      };
    }

    const isFlexible = gift.category === 'Lua de mel' || gift.giftType === 'symbolic';
    const remaining = Math.max(0, gift.totalQuotas - gift.reservedQuotas - gift.paidQuotas);
    if (remaining <= 0) {
      return {
        scope: 'gift',
        hasValidSelection: false,
        invalidReason: `O presente "${gift.title}" já foi reservado ou completado.`,
        amountCents: 0,
        isCustomAmount: false,
        quotas: 1,
        giftTitle: gift.title,
        items: [],
        snapshotItems: [],
        directGift: gift,
      };
    }

    const safeQuotas = isFlexible
      ? 1
      : Math.max(1, Math.min(remaining, Number.isFinite(paramQuotasRaw) ? paramQuotasRaw : 1));
    const unitCents = isFlexible
      ? Number.isFinite(paramAmountRaw) && paramAmountRaw >= 100
        ? Math.min(100_000_000, Math.round(paramAmountRaw))
        : gift.priceCents
      : gift.priceCents;
    const totalCents = isFlexible ? unitCents : unitCents * safeQuotas;

    if (!Number.isInteger(totalCents) || totalCents < 100 || totalCents > 100_000_000) {
      return {
        scope: 'gift',
        hasValidSelection: false,
        invalidReason: 'Informe um valor válido a partir de R$ 1,00 na página de presentes.',
        amountCents: 0,
        isCustomAmount: false,
        quotas: 1,
        giftTitle: gift.title,
        items: [],
        snapshotItems: [],
        directGift: gift,
      };
    }

    const cartItem: CartItem = {
      gift,
      quotas: safeQuotas,
      ...(isFlexible ? { customAmountCents: totalCents } : {}),
    };

    const snapshot: GiftOrderItemSnapshot = {
      giftId: gift.id,
      title: gift.title,
      quotas: safeQuotas,
      unitPriceCents: unitCents,
      totalCents,
    };

    return {
      scope: 'gift',
      hasValidSelection: true,
      amountCents: totalCents,
      isCustomAmount: false,
      quotas: safeQuotas,
      giftTitle: isFlexible
        ? `${gift.title} (R$ ${(totalCents / 100).toFixed(2).replace('.', ',')})`
        : `${gift.title} (${safeQuotas}x)`,
      items: [cartItem],
      snapshotItems: [snapshot],
      directGift: gift,
    };
  }

  if (paramMode === 'cart' && !paramCustom) {
    if (cart.length === 0) {
      return {
        scope: 'cart',
        hasValidSelection: false,
        invalidReason: 'Sua sacola de presentes está vazia no momento.',
        amountCents: 0,
        isCustomAmount: false,
        quotas: 1,
        giftTitle: '',
        items: [],
        snapshotItems: [],
        directGift: null,
      };
    }

    const snapshotItems: GiftOrderItemSnapshot[] = cart.map((item) => {
      const isFlexible = item.gift.category === 'Lua de mel' || item.gift.giftType === 'symbolic';
      const unitPriceCents = isFlexible
        ? Math.max(100, item.customAmountCents ?? item.gift.priceCents)
        : item.gift.priceCents;
      const quotas = isFlexible ? 1 : item.quotas;
      return {
        giftId: item.gift.id,
        title: item.gift.title,
        quotas,
        unitPriceCents,
        totalCents: isFlexible ? unitPriceCents : unitPriceCents * quotas,
      };
    });

    const amountCents = snapshotItems.reduce((acc, i) => acc + i.totalCents, 0);
    const quotas = snapshotItems.reduce((acc, i) => acc + i.quotas, 0);
    const giftTitle = snapshotItems
      .map((i) => `${i.title} (${i.quotas}x)`)
      .join(', ')
      .slice(0, 155);

    return {
      scope: 'cart',
      hasValidSelection: amountCents >= 100,
      amountCents,
      isCustomAmount: false,
      quotas: Math.max(1, quotas),
      giftTitle,
      items: cart,
      snapshotItems,
      directGift: null,
    };
  }

  // Custom free-value contribution — NEVER invent a default amount like R$ 100,00
  const customCents =
    Number.isFinite(paramAmountRaw) && paramAmountRaw >= 100 && paramAmountRaw <= 100_000_000
      ? Math.round(paramAmountRaw)
      : 0;

  if (customCents < 100) {
    return {
      scope: 'custom',
      hasValidSelection: false,
      invalidReason: 'Nenhum valor foi escolhido ainda. Selecione um valor ou presente para continuar.',
      amountCents: 0,
      isCustomAmount: true,
      quotas: 1,
      giftTitle: '',
      items: [],
      snapshotItems: [],
      directGift: null,
    };
  }

  return {
    scope: 'custom',
    hasValidSelection: true,
    amountCents: customCents,
    isCustomAmount: true,
    quotas: 1,
    giftTitle: 'Contribuição livre para Dalmo & Jadi',
    items: [],
    snapshotItems: [
      {
        giftId: 'custom_contribution',
        title: 'Contribuição livre para Dalmo & Jadi',
        quotas: 1,
        unitPriceCents: customCents,
        totalCents: customCents,
      },
    ],
    directGift: null,
  };
}
