import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Gift, ShoppingBag } from 'lucide-react';
import { useWedding } from '../context/WeddingContext';

export const FloatingGiftButton: React.FC = () => {
  const { cart, setCartOpen } = useWedding();
  const location = useLocation();
  const navigate = useNavigate();

  if (
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/pix') ||
    location.pathname.startsWith('/presentear')
  ) {
    return null;
  }

  const totalCount = cart.reduce((acc, item) => acc + item.quotas, 0);
  const isGiftsPage = location.pathname.startsWith('/presentes');

  const handleClick = () => {
    if (isGiftsPage) {
      setCartOpen(true);
      return;
    }
    if (totalCount > 0) {
      setCartOpen(true);
    } else {
      navigate('/presentes');
    }
  };

  if (isGiftsPage) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={`Abrir sacola com ${totalCount} ${totalCount === 1 ? 'presente' : 'presentes'}`}
        className="inline-flex fixed bottom-[max(0.85rem,env(safe-area-inset-bottom))] right-3.5 sm:bottom-6 sm:right-6 z-30 items-center justify-center gap-2 rounded-md border border-dourado/85 bg-terracota-escuro/95 sm:bg-terracota-escuro backdrop-blur-xs px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs font-semibold tracking-[0.14em] text-creme-claro uppercase shadow-[0_8px_20px_-4px_rgba(73,53,43,0.45)] hover:bg-terracota transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dourado"
      >
        <ShoppingBag className="h-4 w-4 text-dourado shrink-0" aria-hidden="true" />
        <span className="tabular-nums">SACOLA ({totalCount})</span>
      </button>
    );
  }

  const hideEmptyOnMobileHome = location.pathname === '/' && totalCount === 0;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={
        totalCount > 0 ? `Abrir sacola com ${totalCount} presentes` : 'Ir para lista de presentes'
      }
      className={`${
        hideEmptyOnMobileHome ? 'hidden sm:inline-flex' : 'inline-flex'
      } fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 sm:bottom-6 sm:right-6 z-30 h-11 w-11 sm:h-auto sm:w-auto items-center justify-center sm:gap-2 rounded-full sm:rounded-md border border-dourado/85 bg-terracota-escuro/95 sm:bg-terracota-escuro backdrop-blur-xs sm:px-4 sm:py-3 text-xs font-semibold tracking-[0.14em] text-creme-claro uppercase shadow-[0_8px_20px_-4px_rgba(73,53,43,0.45)] hover:bg-terracota transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dourado`}
    >
      <Gift className="h-5 w-5 sm:h-4 sm:w-4 text-dourado shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">
        {totalCount > 0 ? `Presentes (${totalCount})` : 'Presentear'}
      </span>
      {totalCount > 0 && (
        <span
          aria-hidden="true"
          className="sm:hidden absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-creme-claro bg-dourado px-1 text-[10px] font-bold text-marrom tabular-nums"
        >
          {totalCount}
        </span>
      )}
    </button>
  );
};
