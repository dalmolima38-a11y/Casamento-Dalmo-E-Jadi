import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { GiftCategory } from '../types/wedding';

export type CategoryFilter = 'Todos' | 'Favoritos' | GiftCategory;
export type PriceRange = 'all' | 'up_to_150' | '150_to_200' | 'above_200';

interface MobileGiftFiltersSheetProps {
  open: boolean;
  onClose: () => void;
  categories: CategoryFilter[];
  selectedCategory: CategoryFilter;
  selectedPriceRange: PriceRange;
  favoritesCount: number;
  onApply: (category: CategoryFilter, priceRange: PriceRange) => void;
  onClear: () => void;
}

const PRICE_OPTIONS: { value: PriceRange; label: string }[] = [
  { value: 'all', label: 'Todos os valores' },
  { value: 'up_to_150', label: 'Até R$ 150' },
  { value: '150_to_200', label: 'De R$ 150 a R$ 200' },
  { value: 'above_200', label: 'Acima de R$ 200' },
];

export const MobileGiftFiltersSheet: React.FC<MobileGiftFiltersSheetProps> = ({
  open,
  onClose,
  categories,
  selectedCategory,
  selectedPriceRange,
  favoritesCount,
  onApply,
  onClear,
}) => {
  const [draftCategory, setDraftCategory] = useState<CategoryFilter>(selectedCategory);
  const [draftPriceRange, setDraftPriceRange] = useState<PriceRange>(selectedPriceRange);

  useEffect(() => {
    if (open) {
      setDraftCategory(selectedCategory);
      setDraftPriceRange(selectedPriceRange);
    }
  }, [open, selectedCategory, selectedPriceRange]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleApply = () => {
    onApply(draftCategory, draftPriceRange);
    onClose();
  };

  const handleClear = () => {
    setDraftCategory('Todos');
    setDraftPriceRange('all');
    onClear();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-filters-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end bg-marrom/60 backdrop-blur-[2px] md:hidden"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-dourado/80 bg-marfim px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-dourado/55"
        />

        <div className="flex items-center justify-between border-b border-dourado/30 pb-3">
          <h2
            id="mobile-filters-title"
            className="font-display text-xl font-semibold text-marrom"
          >
            Filtrar presentes
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar filtros"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-dourado/50 bg-creme-claro text-marrom hover:bg-pergaminho transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-5">
          <div>
            <p className="mb-2.5 text-xs font-semibold tracking-wider text-marrom-suave uppercase">
              Categorias
            </p>
            <div className="grid grid-cols-2 gap-2">
              {categories.map((cat) => {
                const active = draftCategory === cat;
                const displayLabel =
                  cat === 'Todos'
                    ? 'Todas'
                    : cat === 'Favoritos' && favoritesCount > 0
                      ? `Favoritos (${favoritesCount})`
                      : cat;

                return (
                  <button
                    key={cat}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDraftCategory(cat)}
                    className={`min-h-[42px] rounded-lg border px-3 py-2 text-left text-xs font-medium leading-snug transition-colors ${
                      active
                        ? 'border-[#873F2C] bg-[#873F2C] text-white'
                        : 'border-[#873F2C]/40 bg-creme-claro text-marrom hover:bg-pergaminho'
                    }`}
                  >
                    {displayLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2.5 text-xs font-semibold tracking-wider text-marrom-suave uppercase">
              Valores
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PRICE_OPTIONS.map((opt) => {
                const active = draftPriceRange === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDraftPriceRange(opt.value)}
                    className={`min-h-[42px] rounded-lg border px-3 py-2 text-left text-xs font-medium leading-snug transition-colors ${
                      active
                        ? 'border-[#873F2C] bg-[#873F2C] text-white'
                        : 'border-[#873F2C]/40 bg-creme-claro text-marrom hover:bg-pergaminho'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-dourado/30 pt-3.5">
          <button
            type="button"
            onClick={handleClear}
            className="min-h-[44px] px-2 text-xs font-medium text-marrom-suave underline decoration-dourado/70 underline-offset-2 hover:text-[#873F2C] transition-colors whitespace-nowrap"
          >
            Limpar filtros
          </button>

          <button
            type="button"
            onClick={handleApply}
            className="min-h-[44px] flex-1 rounded-lg border border-[#873F2C] bg-[#873F2C] px-4 py-2.5 text-xs font-semibold tracking-[0.12em] text-white uppercase shadow-sm hover:bg-terracota-escuro transition-colors"
          >
            APLICAR FILTROS
          </button>
        </div>
      </div>
    </div>
  );
};
