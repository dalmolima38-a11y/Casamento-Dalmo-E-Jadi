import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreditCard, Heart, Pencil, QrCode, Search, SlidersHorizontal } from 'lucide-react';
import { useWedding } from '../context/WeddingContext';
import { GiftCategory, GiftItem } from '../types/wedding';
import { formatBRL } from '../lib/pix';
import { AnimatedGiftBox } from '../components/AnimatedGiftBox';
import { GiftDetailModal } from '../components/GiftDetailModal';
import {
  CategoryFilter,
  MobileGiftFiltersSheet,
  PriceRange,
} from '../components/MobileGiftFiltersSheet';
import { ResilientImage } from '../components/ResilientImage';
import { WatercolorCorners } from '../components/WatercolorCorners';

const PRIMARY_CATEGORIES: GiftCategory[] = [
  'Cozinha & Mesa',
  'Cama, Mesa & Banho',
  'Eletrodomésticos',
  'Decoração & Conforto',
];

const OPTIONAL_CATEGORIES: GiftCategory[] = [
  'Momentos a dois',
  'Lua de mel',
  'Contribuições especiais',
];

const ALL_SUPPORTED_FILTERS: CategoryFilter[] = [
  'Todos',
  ...PRIMARY_CATEGORIES,
  ...OPTIONAL_CATEGORIES,
  'Favoritos',
];

function resolveCategoryParam(raw: string | null): CategoryFilter {
  if (!raw) return 'Todos';
  if (raw === 'Cozinha') return 'Cozinha & Mesa';
  const match = ALL_SUPPORTED_FILTERS.find((c) => c === raw);
  return match || 'Todos';
}

type SortOption = 'featured' | 'price_asc' | 'price_desc';

const CUSTOM_GIFT_SUGGESTIONS_CENTS = [3000, 5000, 10000, 15000, 25000] as const;

function parseBrazilianCurrencyCents(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  if (trimmed.includes(',')) {
    const normalized = trimmed.replace(/[^\d,]/g, '').replace(',', '.');
    const num = Number.parseFloat(normalized);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.round(num * 100);
  }

  const onlyDigitsAndDots = trimmed.replace(/[^\d.]/g, '');
  if (!onlyDigitsAndDots) return 0;

  if (onlyDigitsAndDots.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(onlyDigitsAndDots)) {
      const num = Number.parseInt(onlyDigitsAndDots.replace(/\./g, ''), 10);
      return Number.isFinite(num) && num > 0 ? num * 100 : 0;
    }
    const num = Number.parseFloat(onlyDigitsAndDots);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.round(num * 100);
  }

  const num = Number.parseInt(onlyDigitsAndDots, 10);
  return Number.isFinite(num) && num > 0 ? num * 100 : 0;
}

function formatBrazilianCurrencyInput(raw: string): string {
  const stripped = raw.replace(/R\$/gi, '').replace(/\s+/g, '');
  if (!stripped) return '';

  const hasComma = stripped.includes(',');
  const candidate = hasComma
    ? stripped.replace(/\./g, '')
    : /^\d{1,3}(\.\d{3})+$/.test(stripped)
      ? stripped.replace(/\./g, '')
      : stripped.replace('.', ',');

  const cleaned = candidate.replace(/[^\d,]/g, '');
  if (!cleaned) return '';

  const commaIdx = cleaned.indexOf(',');
  if (commaIdx === -1) {
    return cleaned.slice(0, 7);
  }

  const intPart = cleaned.slice(0, commaIdx).slice(0, 7);
  const decPart = cleaned
    .slice(commaIdx + 1)
    .replace(/,/g, '')
    .slice(0, 2);

  return `${intPart || '0'},${decPart}`;
}

function formatBrazilianCurrencyFromCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const GiftsPage: React.FC = () => {
  const {
    settings,
    gifts,
    addToCart,
    favorites,
    toggleFavorite,
    cardPaymentReady,
    cardPaymentStatusLoaded,
    cardPaymentUnavailableReason,
  } = useWedding();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>(() =>
    resolveCategoryParam(searchParams.get('categoria'))
  );

  useEffect(() => {
    const paramCat = resolveCategoryParam(searchParams.get('categoria'));
    setSelectedCategory(paramCat);
  }, [searchParams]);

  const handleSelectCategory = (cat: CategoryFilter) => {
    setSelectedCategory(cat);
    const next = new URLSearchParams(searchParams);
    if (cat === 'Todos') {
      next.delete('categoria');
    } else {
      next.set('categoria', cat);
    }
    setSearchParams(next, { replace: true });
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [priceRange, setPriceRange] = useState<PriceRange>('all');
  const [sortBy, setSortBy] = useState<SortOption>('featured');
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const [freeGiftReais, setFreeGiftReais] = useState('');
  const [freeGiftError, setFreeGiftError] = useState<string | null>(null);

  const parsedFreeGiftCents = useMemo(
    () => parseBrazilianCurrencyCents(freeGiftReais),
    [freeGiftReais]
  );

  const handleStartFreeGift = (method: 'pix' | 'card') => {
    if (method === 'card' && !cardPaymentReady) {
      setFreeGiftError(
        cardPaymentUnavailableReason ||
          'Pagamento com cartão temporariamente indisponível. Você pode presentear via Pix direto!'
      );
      return;
    }
    if (parsedFreeGiftCents <= 0) {
      setFreeGiftError('Escolha ou digite um valor para continuar.');
      amountInputRef.current?.focus();
      return;
    }
    if (parsedFreeGiftCents < 100) {
      setFreeGiftError('Informe um valor a partir de R$ 1,00.');
      amountInputRef.current?.focus();
      return;
    }
    setFreeGiftError(null);
    const targetRoute = method === 'card' ? '/presentear/cartao' : '/presentear/pix';
    navigate(`${targetRoute}?custom=1&amount=${parsedFreeGiftCents}`);
  };

  const handleDirectPayGift = (
    gift: GiftItem,
    quotas: number,
    method: 'pix' | 'card',
    customAmountCents?: number
  ) => {
    if (method === 'card' && !cardPaymentReady) return;
    const isFlexible = gift.category === 'Lua de mel' || gift.giftType === 'symbolic';
    const amount = isFlexible
      ? Math.max(100, customAmountCents ?? gift.priceCents)
      : gift.priceCents * quotas;
    const targetRoute = method === 'card' ? '/presentear/cartao' : '/presentear/pix';
    navigate(
      `${targetRoute}?giftId=${encodeURIComponent(gift.id)}&quotas=${isFlexible ? 1 : quotas}&amount=${amount}`
    );
  };

  const activeGifts = useMemo(() => gifts.filter((gift) => gift.active), [gifts]);

  const visibleCategories = useMemo<CategoryFilter[]>(() => {
    const populatedOptional = OPTIONAL_CATEGORIES.filter((cat) =>
      activeGifts.some((g) => g.category === cat)
    );
    return ['Todos', ...PRIMARY_CATEGORIES, ...populatedOptional, 'Favoritos'];
  }, [activeGifts]);

  const mobileCategories = useMemo<CategoryFilter[]>(() => {
    const mobileOptional = OPTIONAL_CATEGORIES.filter(
      (cat) => cat === 'Lua de mel' || activeGifts.some((g) => g.category === cat)
    );
    return ['Todos', ...PRIMARY_CATEGORIES, ...mobileOptional, 'Favoritos'];
  }, [activeGifts]);

  const activeFilterCount =
    (selectedCategory !== 'Todos' ? 1 : 0) + (priceRange !== 'all' ? 1 : 0);

  const handleClearMobileFilters = () => {
    handleSelectCategory('Todos');
    setPriceRange('all');
  };

  const filteredGifts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return activeGifts
      .filter((gift) => {
        if (selectedCategory === 'Favoritos') return favorites.includes(gift.id);
        if (selectedCategory !== 'Todos') return gift.category === selectedCategory;
        return true;
      })
      .filter((gift) => {
        if (!q) return true;
        return (
          gift.title.toLowerCase().includes(q) ||
          gift.description.toLowerCase().includes(q) ||
          gift.category.toLowerCase().includes(q)
        );
      })
      .filter((gift) => {
        if (priceRange === 'up_to_150') return gift.priceCents <= 15000;
        if (priceRange === '150_to_200') return gift.priceCents > 15000 && gift.priceCents <= 20000;
        if (priceRange === 'above_200') return gift.priceCents > 20000;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'price_asc') {
          return a.priceCents - b.priceCents || (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
        }
        if (sortBy === 'price_desc') {
          return b.priceCents - a.priceCents || (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
        }
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || a.title.localeCompare(b.title);
      });
  }, [activeGifts, selectedCategory, searchTerm, priceRange, sortBy, favorites]);

  const mobileCategorySections = useMemo(() => {
    if (selectedCategory === 'Favoritos') {
      return filteredGifts.length > 0
        ? [{ category: 'Favoritos', items: filteredGifts }]
        : [];
    }

    const orderedCategories: string[] = [...PRIMARY_CATEGORIES, ...OPTIONAL_CATEGORIES];
    const grouped = new Map<string, GiftItem[]>();

    for (const gift of filteredGifts) {
      const existing = grouped.get(gift.category);
      if (existing) {
        existing.push(gift);
      } else {
        grouped.set(gift.category, [gift]);
      }
    }

    const sections: { category: string; items: GiftItem[] }[] = [];
    for (const cat of orderedCategories) {
      const items = grouped.get(cat);
      if (items && items.length > 0) {
        sections.push({ category: cat, items });
        grouped.delete(cat);
      }
    }

    for (const [cat, items] of grouped.entries()) {
      if (items.length > 0) {
        sections.push({ category: cat, items });
      }
    }

    return sections;
  }, [filteredGifts, selectedCategory]);

  const introMessage =
    settings.giftIntroMessage?.trim() ||
    'Sua presença é o nosso maior presente. Mas, se desejar nos presentear, reunimos aqui alguns sonhos que queremos realizar juntos.';

  return (
    <div className="relative overflow-hidden pt-12 pb-24 sm:py-16">
      <WatercolorCorners variant="section" />
      <div className="relative z-20 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Cabeçalho Floral Aquarela */}
        <header className="text-center max-w-3xl mx-auto">
          <h1 className="font-display font-semibold text-marrom text-center leading-[1.2] sm:leading-[1.15]">
            <span className="block text-[1.65rem] min-[375px]:text-[1.85rem] sm:text-[2.2rem] lg:text-[2.5rem] tracking-[0.02em]">
              Pequenos Gestos
            </span>
            <span className="block font-delicate text-[2.65rem] min-[375px]:text-[2.95rem] sm:text-[3.45rem] lg:text-[3.9rem] font-normal tracking-normal text-terracota-escuro leading-[0.82] my-0.5 sm:my-1">
              realizam
            </span>
            <span className="block text-[1.45rem] min-[375px]:text-[1.6rem] sm:text-[1.95rem] lg:text-[2.25rem] tracking-[0.11em] uppercase">
              GRANDES SONHOS
            </span>
          </h1>
          <p className="mt-4 mx-auto max-w-2xl font-display text-lg sm:text-xl italic leading-relaxed text-marrom-suave">
            “{introMessage}”
          </p>
        </header>

        {/* Custom Contribution Strip */}
        <div className="mt-8 ornamental-frame rounded-xl bg-creme-claro p-4 sm:px-6 sm:py-5 space-y-4">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-5 lg:gap-8">
            <div className="flex items-center justify-start gap-4 sm:gap-[18px] min-w-0 lg:w-[46%]">
              <AnimatedGiftBox className="h-[50px] w-[50px] sm:h-[68px] sm:w-[68px] shrink-0" />
              <div className="min-w-0">
                <p className="font-display text-2xl font-semibold text-marrom">
                  Um presente do seu jeitinho
                </p>
                <p className="mt-1 text-sm italic leading-relaxed text-marrom-suave">
                  Não existe valor esperado. Escolha com carinho a quantia que fizer sentido para
                  você.
                </p>
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="space-y-1.5">
                <label
                  htmlFor="free-gift-amount"
                  className="block text-xs sm:text-[13px] font-semibold text-marrom"
                >
                  Quanto você gostaria de presentear?
                </label>

                <div
                  onClick={() => amountInputRef.current?.focus()}
                  className="flex items-center gap-2 rounded-lg border border-dourado/75 bg-marfim px-3.5 py-2.5 min-h-[44px] shadow-[inset_0_1px_2px_rgba(92,58,41,0.04)] transition-all cursor-text hover:border-terracota/70 focus-within:border-terracota-escuro focus-within:ring-2 focus-within:ring-terracota/20"
                >
                  <span
                    className="text-sm font-semibold text-marrom-suave select-none shrink-0"
                    aria-hidden="true"
                  >
                    R$
                  </span>
                  <input
                    ref={amountInputRef}
                    id="free-gift-amount"
                    type="text"
                    inputMode="decimal"
                    value={freeGiftReais}
                    onChange={(e) => {
                      setFreeGiftError(null);
                      setFreeGiftReais(formatBrazilianCurrencyInput(e.target.value));
                    }}
                    onBlur={() => {
                      if (parsedFreeGiftCents > 0) {
                        setFreeGiftReais(formatBrazilianCurrencyFromCents(parsedFreeGiftCents));
                      } else if (freeGiftReais.trim()) {
                        setFreeGiftReais('');
                      }
                    }}
                    aria-label="Quanto você gostaria de presentear? Valor em reais"
                    aria-describedby="free-gift-helper"
                    placeholder="Ex.: R$ 50,00"
                    className="w-full min-w-0 bg-transparent text-base sm:text-[15px] font-semibold text-terracota-escuro placeholder:font-normal placeholder:text-marrom-suave/70 tabular-nums focus:outline-none"
                  />
                  <Pencil
                    className="h-3.5 w-3.5 text-terracota/75 shrink-0 pointer-events-none"
                    aria-hidden="true"
                  />
                </div>

                <p id="free-gift-helper" className="text-xs leading-snug text-marrom-suave">
                  Você pode digitar o valor que desejar ou escolher uma sugestão abaixo.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => handleStartFreeGift('pix')}
                  className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-lg border border-terracota-escuro bg-terracota-escuro px-4 py-2.5 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors whitespace-nowrap"
                >
                  <QrCode className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Presentear com Pix
                </button>

                <button
                  type="button"
                  disabled={!cardPaymentReady}
                  onClick={() => handleStartFreeGift('card')}
                  title={
                    cardPaymentReady
                      ? 'Presentear com cartão de crédito'
                      : cardPaymentUnavailableReason ||
                        'Pagamento com cartão temporariamente indisponível'
                  }
                  className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-lg border border-dourado/90 bg-creme px-4 py-2.5 text-xs font-semibold tracking-wider text-terracota-escuro uppercase hover:bg-pergaminho transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-creme"
                >
                  <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Presentear com Cartão
                </button>
              </div>

              {cardPaymentStatusLoaded && !cardPaymentReady && (
                <p className="text-[11px] leading-snug text-marrom-suave">
                  {cardPaymentUnavailableReason ||
                    'Pagamento com cartão temporariamente indisponível enquanto finalizamos a ativação. Você pode presentear via Pix direto!'}
                </p>
              )}

              {freeGiftError && (
                <p role="alert" className="text-xs font-semibold text-terracota-escuro">
                  {freeGiftError}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-dourado/25 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-marrom-suave mr-0.5">
                Ou escolha uma sugestão:
              </span>
              {CUSTOM_GIFT_SUGGESTIONS_CENTS.map((cents) => {
                const active = parsedFreeGiftCents === cents;
                return (
                  <button
                    key={cents}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setFreeGiftError(null);
                      setFreeGiftReais(formatBrazilianCurrencyFromCents(cents));
                    }}
                    className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                      active
                        ? 'border border-terracota-escuro bg-terracota-escuro text-creme-claro shadow-xs'
                        : 'border border-dourado/55 bg-marfim text-marrom hover:bg-pergaminho hover:border-dourado'
                    }`}
                  >
                    {formatBRL(cents)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mobile Compact Search, Filters & Sort (< 768px) */}
        <div className="mt-5 space-y-2.5 md:hidden">
          <div className="flex items-center gap-2">
            <div className="relative flex-[13_1_0%] min-w-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#873F2C]/80"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar presente..."
                aria-label="Buscar presente"
                className="min-h-[44px] w-full rounded-lg border border-[#873F2C]/65 bg-marfim py-2.5 pl-9 pr-3 text-sm text-marrom placeholder:text-marrom-suave/75 focus:border-[#873F2C] focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              aria-expanded={mobileFiltersOpen}
              aria-haspopup="dialog"
              aria-label={
                activeFilterCount > 0
                  ? `Abrir filtros (${activeFilterCount} ${activeFilterCount === 1 ? 'filtro ativo' : 'filtros ativos'})`
                  : 'Abrir filtros'
              }
              className={`min-h-[44px] flex-[7_1_0%] min-w-0 inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeFilterCount > 0
                  ? 'border-[#873F2C] bg-[#FFF3E3] text-[#873F2C]'
                  : 'border-[#873F2C]/65 bg-marfim text-marrom hover:bg-pergaminho'
              }`}
            >
              <SlidersHorizontal
                className="h-3.5 w-3.5 shrink-0 text-[#873F2C]"
                aria-hidden="true"
              />
              <span>Filtros</span>
              {activeFilterCount > 0 && (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#873F2C] px-1 text-[10px] font-bold text-white tabular-nums leading-none">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label="Ordenar presentes"
              className="min-h-[40px] w-auto rounded-lg border border-[#873F2C]/65 bg-marfim py-1.5 pl-3 pr-7 text-xs font-medium text-marrom focus:border-[#873F2C] focus:outline-none"
            >
              <option value="featured">Recomendados</option>
              <option value="price_asc">Mais acessíveis</option>
              <option value="price_desc">Maiores valores</option>
            </select>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={handleClearMobileFilters}
                className="min-h-[40px] px-2 text-xs font-medium text-marrom-suave underline decoration-[#873F2C]/50 underline-offset-2 hover:text-[#873F2C] transition-colors whitespace-nowrap"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>

        {/* Desktop Filter & Search Toolbar (>= 768px, unchanged) */}
        <div className="hidden md:block mt-6 space-y-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Categorias de presentes">
            {visibleCategories.map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleSelectCategory(cat)}
                  className={`rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'border border-dourado/60 bg-terracota-escuro text-creme-claro'
                      : 'border border-dourado/45 bg-creme-claro text-marrom hover:bg-pergaminho'
                  }`}
                >
                  {cat}
                  {cat === 'Favoritos' && favorites.length > 0 ? ` (${favorites.length})` : ''}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-marrom-suave" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar presente ou categoria..."
                aria-label="Buscar presentes"
                className="w-full rounded-md border border-dourado/50 bg-creme-claro py-2.5 pl-10 pr-4 text-sm text-marrom placeholder:text-marrom-suave/70 focus:border-terracota-escuro focus:outline-none"
              />
            </div>

            <select
              value={priceRange}
              onChange={(e) => setPriceRange(e.target.value as PriceRange)}
              aria-label="Filtrar por faixa de valor"
              className="w-full rounded-md border border-[#873F2C]/65 bg-marfim px-3.5 py-2.5 text-sm text-marrom focus:border-[#873F2C] focus:outline-none"
            >
              <option value="all">Todos os valores</option>
              <option value="up_to_150">Até R$ 150</option>
              <option value="150_to_200">De R$ 150 a R$ 200</option>
              <option value="above_200">Acima de R$ 200</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              aria-label="Ordenar presentes"
              className="w-full rounded-md border border-[#873F2C]/65 bg-marfim px-3.5 py-2.5 text-sm text-marrom focus:border-[#873F2C] focus:outline-none"
            >
              <option value="featured">Recomendados</option>
              <option value="price_asc">Mais acessíveis</option>
              <option value="price_desc">Maiores valores</option>
            </select>
          </div>
        </div>

        {/* Gift Catalog Grid */}
        {filteredGifts.length === 0 ? (
          <div className="mt-12 rounded-xl border border-dourado/50 bg-creme-claro p-12 text-center">
            <p className="font-display text-2xl text-marrom">Nenhum presente encontrado</p>
            <p className="mt-2 text-sm text-marrom-suave">
              Tente limpar os filtros ou contribuir com um valor livre via Pix.
            </p>
            <button
              type="button"
              onClick={() => {
                handleSelectCategory('Todos');
                setSearchTerm('');
                setPriceRange('all');
              }}
              className="mt-5 rounded-md border border-terracota-escuro px-4 py-2 text-xs font-semibold text-terracota-escuro uppercase hover:bg-terracota/10 transition-colors"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Horizontal Category Carousels (< 768px) */}
            <div className="mt-5 md:hidden">
              {mobileCategorySections.map((section, index) => (
                <React.Fragment key={section.category}>
                  <section aria-label={section.category}>
                    <h2 className="text-center font-display text-[1.35rem] font-semibold tracking-[0.01em] text-marrom leading-tight">
                      {section.category === 'Lua de mel' ? 'Lua de Mel' : section.category}
                    </h2>

                    <div
                      className={
                        section.items.length === 1
                          ? 'mt-2.5 flex justify-center overflow-x-auto no-scrollbar pb-0.5'
                          : 'mt-2.5 -mx-4 px-4 flex gap-[10px] overflow-x-auto snap-x snap-mandatory scroll-pl-4 no-scrollbar pb-0.5'
                      }
                    >
                    {section.items.map((gift) => {
                      const remaining = Math.max(
                        0,
                        gift.totalQuotas - gift.reservedQuotas - gift.paidQuotas
                      );
                      const isFav = favorites.includes(gift.id);
                      const fullyPaid = gift.paidQuotas >= gift.totalQuotas;

                      return (
                        <article
                          key={gift.id}
                          className="flex w-[154px] min-[390px]:w-[162px] min-[425px]:w-[170px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-dourado/70 bg-marfim shadow-[0_6px_16px_-12px_rgba(111,88,75,0.2)]"
                        >
                          <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden border-b border-dourado/30 bg-pergaminho">
                            <button
                              type="button"
                              onClick={() => setSelectedGift(gift)}
                              aria-label={`Ver detalhes de ${gift.title}`}
                              className="absolute inset-0 block h-full w-full text-left focus-visible:outline-none"
                            >
                              <ResilientImage
                                src={gift.imageUrl}
                                alt={gift.title}
                                sizes="(max-width: 767px) 220px, 800px"
                                className="h-full w-full object-cover"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleFavorite(gift.id)}
                              aria-label={
                                isFav
                                  ? `Remover ${gift.title} dos favoritos`
                                  : `Favoritar ${gift.title}`
                              }
                              className="absolute right-1.5 top-1.5 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-dourado/55 bg-creme-claro/90 text-terracota-escuro transition-colors"
                            >
                              <Heart
                                className={`h-3.5 w-3.5 ${isFav ? 'fill-terracota-escuro' : ''}`}
                              />
                            </button>
                          </div>

                          <div className="flex min-w-0 flex-1 flex-col justify-between p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => setSelectedGift(gift)}
                              className="flex min-h-[2.4em] w-full items-center justify-center text-center focus-visible:outline-none"
                            >
                              <h3 className="font-display text-[15px] font-semibold leading-[1.2] text-marrom line-clamp-2 text-center">
                                {gift.title}
                              </h3>
                            </button>

                            <div className="mt-2.5">
                              <p className="font-display text-lg font-semibold text-[#873F2C] tabular-nums leading-none text-center">
                                {formatBRL(gift.priceCents)}
                              </p>

                              <button
                                type="button"
                                disabled={remaining <= 0}
                                onClick={() => setSelectedGift(gift)}
                                className="mt-2.5 inline-flex min-h-[38px] w-full items-center justify-center rounded-md border border-[#873F2C] bg-[#FFF8EF] px-2 py-1.5 text-center text-[11px] font-semibold tracking-[0.1em] text-[#873F2C] uppercase transition-colors duration-200 active:bg-[#873F2C] active:text-white disabled:opacity-45 disabled:cursor-not-allowed"
                              >
                                {remaining > 0
                                  ? 'PRESENTEAR'
                                  : fullyPaid
                                    ? 'Completo'
                                    : 'Reservado'}
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                    </div>
                  </section>
                  {index < mobileCategorySections.length - 1 && (
                    <hr
                      aria-hidden="true"
                      className="mx-auto mt-[18px] mb-[20px] h-px w-[65%] border-0 bg-[#B8755A]/65"
                    />
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Desktop Gift Catalog Grid (>= 768px, unchanged) */}
            <div className="hidden md:grid mt-10 grid-cols-2 gap-6 lg:grid-cols-3">
              {filteredGifts.map((gift) => {
              const remaining = Math.max(
                0,
                gift.totalQuotas - gift.reservedQuotas - gift.paidQuotas
              );
              const isFav = favorites.includes(gift.id);
              const fullyPaid = gift.paidQuotas >= gift.totalQuotas;
              const desiredUnits = gift.desiredUnits && gift.desiredUnits > 1 ? gift.desiredUnits : 1;
              const quotasPerUnit = gift.quotasPerUnit || 1;
              const giftedUnits = Math.floor(gift.paidQuotas / quotasPerUnit);

              return (
                <article
                  key={gift.id}
                  className="group flex flex-col overflow-hidden rounded-xl border border-dourado/70 bg-marfim shadow-[0_8px_20px_-14px_rgba(111,88,75,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                >
                  {/* Fotografia em proporção 4:3 */}
                  <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden border-b border-dourado/30 bg-pergaminho">
                    <button
                      type="button"
                      onClick={() => setSelectedGift(gift)}
                      aria-label={`Ver detalhes de ${gift.title}`}
                      className="absolute inset-0 block h-full w-full text-left focus-visible:outline-none"
                    >
                      <ResilientImage
                        src={gift.imageUrl}
                        alt={gift.title}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(gift.id)}
                      aria-label={
                        isFav ? `Remover ${gift.title} dos favoritos` : `Favoritar ${gift.title}`
                      }
                      className="absolute right-2.5 top-2.5 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md border border-dourado/60 bg-creme-claro/92 text-terracota-escuro hover:bg-creme-claro transition-colors"
                    >
                      <Heart className={`h-4 w-4 ${isFav ? 'fill-terracota-escuro' : ''}`} />
                    </button>
                  </div>

                  {/* Corpo do cartão */}
                  <div className="flex min-w-0 flex-1 flex-col justify-between p-4 sm:p-5">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-medium text-marrom-suave">
                        <span>{gift.category === 'Lua de mel' ? 'Lua de Mel' : gift.category}</span>
                        {desiredUnits > 1 && (
                          <span className="text-oliva font-semibold">
                            {giftedUnits}/{desiredUnits} conjuntos
                          </span>
                        )}
                      </div>

                      <h2 className="mt-1 font-display text-xl font-semibold text-marrom leading-snug">
                        <button
                          type="button"
                          onClick={() => setSelectedGift(gift)}
                          className="text-left hover:text-terracota-escuro transition-colors focus-visible:outline-none"
                        >
                          {gift.title}
                        </button>
                      </h2>

                      <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-marrom-suave line-clamp-2">
                        {gift.description}
                      </p>
                    </div>

                    <div className="mt-4 border-t border-dourado/25 pt-3">
                      <div className="flex items-end justify-between gap-2">
                        <div>
                          <span className="block text-[11px] font-medium text-marrom-suave leading-none mb-0.5">
                            Valor
                          </span>
                          <p className="font-display text-xl sm:text-[1.4rem] font-semibold text-[#873F2C] tabular-nums leading-tight">
                            {formatBRL(gift.priceCents)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedGift(gift)}
                          className="text-xs font-medium text-marrom-suave underline decoration-dourado/70 underline-offset-2 hover:text-terracota-escuro transition-colors shrink-0"
                        >
                          Ver detalhes
                        </button>
                      </div>

                      <button
                        type="button"
                        disabled={remaining <= 0}
                        onClick={() => setSelectedGift(gift)}
                        className="mt-3.5 w-full rounded-md border border-[#873F2C] bg-[#FFF8EF] px-4 py-2.5 text-center text-xs font-semibold tracking-[0.14em] text-[#873F2C] uppercase transition-colors duration-200 [@media(hover:hover)]:enabled:hover:bg-[#873F2C] [@media(hover:hover)]:enabled:hover:text-white disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        {remaining > 0
                          ? 'QUERO PRESENTEAR'
                          : fullyPaid
                            ? 'Presente completo'
                            : 'Reservado'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            </div>
          </>
        )}
      </div>

      <GiftDetailModal
        gift={selectedGift}
        onClose={() => setSelectedGift(null)}
        onAddToCart={addToCart}
        onPayNow={handleDirectPayGift}
        isFavorite={selectedGift ? favorites.includes(selectedGift.id) : false}
        onToggleFavorite={toggleFavorite}
      />

      <MobileGiftFiltersSheet
        open={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        categories={mobileCategories}
        selectedCategory={selectedCategory}
        selectedPriceRange={priceRange}
        favoritesCount={favorites.length}
        onApply={(nextCategory, nextPriceRange) => {
          handleSelectCategory(nextCategory);
          setPriceRange(nextPriceRange);
        }}
        onClear={handleClearMobileFilters}
      />
    </div>
  );
};
