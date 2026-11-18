import React from 'react';
import { Link } from 'react-router-dom';
import { useWedding } from '../context/WeddingContext';

export const Footer: React.FC = () => {
  const { setPrivacyModalOpen } = useWedding();

  return (
    <footer className="relative z-20 border-t border-dourado/45 bg-creme/85 text-marrom backdrop-blur-[2px]">
      <div className="mx-auto max-w-5xl px-4 pt-8 pb-20 sm:py-9 sm:px-6 lg:px-8 text-center">
        {/* Compact Brand Lockup */}
        <div>
          <p className="font-script text-3xl sm:text-4xl text-terracota-escuro leading-none">
            Dalmo &amp; Jadi
          </p>
          <p className="mt-1 font-display text-[11px] sm:text-xs font-semibold tracking-[0.24em] text-oliva uppercase">
            Nosso Felizes para Sempre
          </p>
        </div>

        <div className="mx-auto my-4 h-px w-20 bg-dourado/55" aria-hidden="true" />

        {/* Essential navigation links */}
        <nav
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs sm:text-sm text-marrom-suave"
          aria-label="Links do rodapé"
        >
          <Link to="/" className="hover:text-terracota-escuro transition-colors">
            Início
          </Link>
          <Link to="/presentes" className="hover:text-terracota-escuro transition-colors">
            Presentes
          </Link>
          <Link to="/rsvp" className="hover:text-terracota-escuro transition-colors">
            Confirmar Presença
          </Link>
          <Link to="/cerimonia" className="hover:text-terracota-escuro transition-colors">
            Cerimônia
          </Link>
          <Link to="/recados" className="hover:text-terracota-escuro transition-colors">
            Mural
          </Link>
          <Link to="/galeria" className="hover:text-terracota-escuro transition-colors">
            Galeria
          </Link>
          <Link to="/faq" className="hover:text-terracota-escuro transition-colors">
            FAQ
          </Link>
        </nav>

        {/* Privacy & Discreet Admin */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-marrom-suave/85">
          <button
            type="button"
            onClick={() => setPrivacyModalOpen(true)}
            className="hover:text-terracota-escuro underline-offset-4 hover:underline transition-colors"
          >
            Política de Privacidade (LGPD)
          </button>
          <span aria-hidden="true">·</span>
          <Link
            to="/admin"
            className="hover:text-terracota-escuro underline-offset-4 hover:underline transition-colors"
          >
            Acesso administrativo
          </Link>
        </div>
      </div>
    </footer>
  );
};
