import React, { useMemo, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWedding } from '../context/WeddingContext';
import { FaqCategory } from '../types/wedding';
import { WatercolorCorners } from '../components/WatercolorCorners';

const FAQ_CATEGORIES: ('Todas' | FaqCategory)[] = [
  'Todas',
  'RSVP',
  'Presentes',
  'Horários',
  'Crianças',
  'Cerimônia',
  'Geral',
];

export const FaqPage: React.FC = () => {
  const { faqs } = useWedding();
  const [selectedCategory, setSelectedCategory] = useState<'Todas' | FaqCategory>('Todas');
  const [openId, setOpenId] = useState<string | null>(null);

  const visibleFaqs = useMemo(
    () =>
      faqs.filter((f) => selectedCategory === 'Todas' || f.category === selectedCategory),
    [faqs, selectedCategory]
  );

  const hasDemoFaqs = faqs.some((f) => f.isDemoExample);

  return (
    <div className="relative overflow-hidden py-14 sm:py-20">
      <WatercolorCorners variant="section" />
      <div className="relative z-20 mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <header className="text-center max-w-2xl mx-auto">
          <p className="text-xs font-semibold tracking-[0.22em] text-oliva uppercase">
            Perguntas Frequentes
          </p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl font-semibold text-marrom">
            Informações úteis aos convidados
          </h1>
          <p className="mt-3 text-base text-marrom-suave">
            Dúvidas sobre confirmação de presença, presentes via Pix, horários e organização do dia.
          </p>
        </header>

        {hasDemoFaqs && (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-dourado/45 bg-creme-claro p-4 text-sm text-marrom-suave">
            <Info className="h-5 w-5 text-dourado shrink-0 mt-0.5" />
            <p>
              Algumas respostas abaixo são modelos editáveis para que os noivos personalizem os
              detalhes específicos no{' '}
              <Link to="/admin" className="font-semibold text-terracota-escuro underline">
                Painel Administrativo
              </Link>
              .
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-2" role="tablist">
          {FAQ_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={selectedCategory === cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-md px-3.5 py-2 text-xs font-medium transition-colors ${
                selectedCategory === cat
                  ? 'bg-terracota-escuro text-creme-claro'
                  : 'border border-dourado/40 bg-creme-claro text-marrom hover:bg-pergaminho'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="mt-8 space-y-3">
          {visibleFaqs.map((item) => {
            const isOpen = openId === item.id;
            return (
              <div
                key={item.id}
                className="overflow-hidden rounded-lg border border-dourado/35 bg-creme-claro"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left hover:bg-creme/50 transition-colors"
                >
                  <div>
                    <span className="text-xs font-medium text-salvia">{item.category}</span>
                    <h2 className="mt-0.5 font-display text-xl font-semibold text-marrom">
                      {item.question}
                    </h2>
                  </div>
                  <ChevronDown
                    className={`h-5 w-5 text-terracota-escuro shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="border-t border-dourado/20 px-6 py-4 text-sm leading-relaxed text-marrom-suave">
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
