import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

interface PublicNavItem {
  label: string;
  to: string;
  visible: boolean;
}

const PUBLIC_NAV_ITEMS: PublicNavItem[] = [
  { label: 'Início', to: '/', visible: true },
  { label: 'Presentes', to: '/presentes', visible: true },
  { label: 'Cerimônia', to: '/cerimonia', visible: true },
  { label: 'Mural', to: '/recados', visible: true },
];

const PUBLIC_CTA_LINK = {
  label: 'Confirmar presença',
  mobileLabel: 'CONFIRMAR PRESENÇA',
  to: '/rsvp',
};

export const Navbar: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const visibleNavItems = PUBLIC_NAV_ITEMS.filter((item) => item.visible);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <header className="sticky top-0 z-40 border-b border-dourado/40 bg-marfim/92 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand wordmark */}
        <Link
          to="/"
          onClick={() => setMobileOpen(false)}
          className="font-script text-3xl sm:text-4xl text-terracota-escuro whitespace-nowrap shrink-0 hover:text-terracota transition-colors"
        >
          Dalmo &amp; Jadi
        </Link>

        {/* Zone 2: Shared public nav links (Desktop) */}
        <nav className="hidden md:flex items-center gap-7" aria-label="Navegação principal">
          {visibleNavItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`font-display text-base font-semibold tracking-wide whitespace-nowrap shrink-0 pb-0.5 transition-colors border-b ${
                isActive(item.to)
                  ? 'text-terracota-escuro border-dourado'
                  : 'text-marrom border-transparent hover:text-terracota-escuro hover:border-dourado/60'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Zone 3: 1 primary CTA + mobile menu toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <Link
            to={PUBLIC_CTA_LINK.to}
            className="hidden sm:inline-flex items-center justify-center rounded-md border border-dourado/60 bg-terracota-escuro px-4 py-2 text-xs font-semibold tracking-wider text-creme-claro uppercase whitespace-nowrap shrink-0 hover:bg-terracota transition-colors"
          >
            {PUBLIC_CTA_LINK.label}
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Fechar menu' : 'Abrir menu'}
            className="inline-flex md:hidden h-11 w-11 items-center justify-center rounded-md border border-dourado/50 text-marrom hover:bg-pergaminho/60 transition-colors"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-dourado/30 bg-creme-claro px-4 py-3.5 shadow-lg">
          <nav className="flex flex-col gap-1" aria-label="Navegação principal mobile">
            {visibleNavItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={`flex min-h-[42px] items-center rounded-md px-3 font-display text-base font-semibold tracking-wide transition-colors ${
                  isActive(item.to)
                    ? 'border-l-2 border-dourado bg-terracota/10 text-terracota-escuro'
                    : 'text-marrom hover:bg-pergaminho/50 hover:text-terracota-escuro'
                }`}
              >
                {item.label}
              </Link>
            ))}

            <div className="mt-2 border-t border-dourado/30 pt-3">
              <Link
                to={PUBLIC_CTA_LINK.to}
                onClick={() => setMobileOpen(false)}
                className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-dourado/60 bg-terracota-escuro px-4 py-2.5 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors"
              >
                {PUBLIC_CTA_LINK.mobileLabel}
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
};
