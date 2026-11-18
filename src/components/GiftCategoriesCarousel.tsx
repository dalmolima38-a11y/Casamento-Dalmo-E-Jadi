import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { GiftCategory, GiftItem } from '../types/wedding';
import { WEDDING_ASSETS } from '../data/assets';
import { GIFT_IMAGES } from '../data/giftImages';
import { ResilientImage } from './ResilientImage';

interface GiftCategoriesCarouselProps {
  gifts: GiftItem[];
}

interface CategoryDescriptor {
  category: GiftCategory;
  displayTitle?: string;
  description: string;
  fallbackImage: string;
  isPrimary?: boolean;
}

const REGISTERED_CATEGORIES: CategoryDescriptor[] = [
  {
    category: 'Cozinha & Mesa',
    displayTitle: 'Cozinha',
    description: 'Sabores para compartilhar.',
    fallbackImage: GIFT_IMAGES.gift01CookwareSet,
    isPrimary: true,
  },
  {
    category: 'Cama, Mesa & Banho',
    description: 'Enxoval macio e aconchegante para o nosso lar',
    fallbackImage: GIFT_IMAGES.gift17BeddingSheets,
    isPrimary: true,
  },
  {
    category: 'Eletrodomésticos',
    description: 'Praticidade e carinho para a rotina de cada dia',
    fallbackImage: GIFT_IMAGES.gift31CoffeeMaker,
    isPrimary: true,
  },
  {
    category: 'Decoração & Conforto',
    description: 'Detalhes acolhedores que trazem paz para a casa',
    fallbackImage: GIFT_IMAGES.gift38TableLamp,
    isPrimary: true,
  },
  {
    category: 'Momentos a dois',
    description: 'Memórias e encontros especiais juntos',
    fallbackImage: WEDDING_ASSETS.giftMomentsDinner,
  },
  {
    category: 'Lua de mel',
    description: 'Primeira viagem do nosso felizes para sempre',
    fallbackImage: GIFT_IMAGES.gift49HoneymoonIlhabela,
  },
  {
    category: 'Contribuições especiais',
    description: 'Carinho e bênçãos para o nosso começo',
    fallbackImage: WEDDING_ASSETS.watercolorGiftsSunflowers,
  },
];

export const GiftCategoriesCarousel: React.FC<GiftCategoriesCarouselProps> = ({ gifts }) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const categoryCards = useMemo(() => {
    const activeGifts = gifts.filter((g) => g.active);

    const populated = REGISTERED_CATEGORIES.filter((item) => {
      if (activeGifts.length === 0) return Boolean(item.isPrimary);
      return activeGifts.some((g) => g.category === item.category);
    });

    const listToRender =
      populated.length > 0
        ? populated
        : REGISTERED_CATEGORIES.filter((item) => item.isPrimary);

    return listToRender.map((item) => {
      const registeredImage = activeGifts.find(
        (g) => g.category === item.category && Boolean(g.imageUrl?.trim())
      )?.imageUrl;

      return {
        category: item.category,
        title: item.displayTitle || item.category,
        description: item.description,
        imageUrl: registeredImage || item.fallbackImage,
        to: `/presentes?categoria=${encodeURIComponent(item.category)}`,
      };
    });
  }, [gifts]);

  const updateScrollButtons = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    window.addEventListener('resize', updateScrollButtons);
    return () => window.removeEventListener('resize', updateScrollButtons);
  }, [updateScrollButtons, categoryCards.length]);

  const scrollByStep = (direction: 'left' | 'right') => {
    const el = trackRef.current;
    if (!el) return;
    const step = Math.max(240, Math.round(el.clientWidth * 0.72));
    el.scrollBy({
      left: direction === 'right' ? step : -step,
      behavior: 'smooth',
    });
  };

  return (
    <div className="relative flex items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={() => scrollByStep('left')}
        disabled={!canScrollLeft}
        aria-label="Categorias anteriores"
        className="hidden sm:inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dourado/70 bg-marfim text-marrom shadow-xs transition-all duration-200 hover:border-dourado hover:bg-creme hover:text-terracota-escuro disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>

      <div
        ref={trackRef}
        onScroll={updateScrollButtons}
        role="region"
        aria-label="Carrossel de categorias de presentes"
        className="min-w-0 flex-1 flex gap-3.5 sm:gap-4 lg:gap-5 overflow-x-auto scroll-smooth snap-x snap-mandatory py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {categoryCards.map((item) => (
          <Link
            key={item.category}
            to={item.to}
            className="group w-[78%] sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2.5rem)/3)] shrink-0 snap-start flex flex-col overflow-hidden rounded-xl border border-dourado/65 bg-[#FFFDF9] text-left shadow-[0_10px_24px_-16px_rgba(111,88,75,0.22)] transition-all duration-300 hover:-translate-y-0.5 hover:border-dourado hover:shadow-[0_16px_30px_-16px_rgba(111,88,75,0.28)] focus-visible:outline-none"
          >
            {/* Fotografia ocupando ~65-70% da altura total do cartão */}
            <div className="relative aspect-[4/3] sm:aspect-[16/10] w-full overflow-hidden border-b border-dourado/35 bg-creme">
              <ResilientImage
                src={item.imageUrl}
                alt={`Categoria ${item.title}`}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              />
            </div>

            <div className="flex flex-1 flex-col justify-between p-3.5 sm:p-4">
              <div>
                <h4 className="font-display text-lg sm:text-xl font-semibold text-marrom leading-snug group-hover:text-terracota-escuro transition-colors">
                  {item.title}
                </h4>
                <p className="mt-1 text-xs sm:text-[13px] leading-relaxed text-marrom-suave line-clamp-2">
                  {item.description}
                </p>
              </div>

              <div className="mt-2.5 flex items-center justify-between border-t border-dourado/25 pt-2 text-[11px] sm:text-xs font-semibold tracking-[0.12em] text-terracota-escuro uppercase">
                <span>Explorar presentes</span>
                <ArrowRight
                  className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>
        ))}
      </div>

      <button
        type="button"
        onClick={() => scrollByStep('right')}
        disabled={!canScrollRight}
        aria-label="Próximas categorias"
        className="hidden sm:inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dourado/70 bg-marfim text-marrom shadow-xs transition-all duration-200 hover:border-dourado hover:bg-creme hover:text-terracota-escuro disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};
