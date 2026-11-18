import React, { useState } from 'react';
import { Calendar, Clock, Info, MapPin, Maximize2, Minimize2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWedding } from '../context/WeddingContext';
import { DEFAULT_PADRINHOS_SLOTS, DEFAULT_SITE_SETTINGS } from '../data/defaults';
import { WEDDING_ASSETS } from '../data/assets';
import { BotanicalDivider } from '../components/BotanicalDivider';
import { WatercolorCorners } from '../components/WatercolorCorners';
import {
  normalizeVenueCityDisplay,
  resolveCeremonyPastor,
  resolvePadrinhosList,
} from '../lib/settingsSanitizer';
import { getCeremonyPhotoFallbackUrl } from '../lib/imageOptimizer';
import { PadrinhoEntry } from '../types/wedding';

function formatCeremonyTimeHeading(raw?: string): string {
  const clean = (raw || DEFAULT_SITE_SETTINGS.weddingTimeDisplay || '15h').trim();
  if (!clean) return 'Às 15h';
  if (/^às\b/i.test(clean)) return clean.replace(/^às/i, 'Às');
  return `Às ${clean}`;
}

const TitleGoldOrnament: React.FC = () => (
  <div className="mt-2.5 flex items-center justify-center gap-2.5" aria-hidden="true">
    <span className="h-px w-10 sm:w-14 bg-gradient-to-r from-transparent to-dourado/80" />
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-dourado" fill="none">
      <path
        d="M10 2.5L12.1 7.9L17.5 10L12.1 12.1L10 17.5L7.9 12.1L2.5 10L7.9 7.9L10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="rgba(198, 164, 106, 0.2)"
      />
    </svg>
    <span className="h-px w-10 sm:w-14 bg-gradient-to-l from-transparent to-dourado/80" />
  </div>
);

const SmallGoldHeart: React.FC = () => (
  <svg
    viewBox="0 0 28 28"
    className="h-4 w-4 text-terracota-escuro/85 shrink-0"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M14 22.8C14 22.8 5.5 17.4 5.5 11.2C5.5 8.4 7.7 6.4 10.2 6.4C11.9 6.4 13.3 7.3 14 8.6C14.7 7.3 16.1 6.4 17.8 6.4C20.3 6.4 22.5 8.4 22.5 11.2C22.5 17.4 14 22.8 14 22.8Z"
      stroke="#C6A46A"
      strokeWidth="1.3"
      fill="rgba(166, 90, 67, 0.16)"
    />
  </svg>
);

export const CeremonyPage: React.FC = () => {
  const { settings } = useWedding();
  const [expandedMap, setExpandedMap] = useState(false);
  const [photoFallbackTier, setPhotoFallbackTier] = useState<0 | 1 | 2>(0);

  const customPhoto = settings.venuePhotoUrl?.trim() || '';
  const primaryPhotoSrc =
    customPhoto &&
    !customPhoto.includes('/assets/aistudio/') &&
    !customPhoto.startsWith('/images/ceremony/')
      ? customPhoto
      : '/images/igreja-jardim-florestal.png';

  React.useEffect(() => {
    setPhotoFallbackTier(0);
  }, [primaryPhotoSrc]);

  const fallbackRawUrl = getCeremonyPhotoFallbackUrl(primaryPhotoSrc);
  const churchPhotoSrc =
    photoFallbackTier === 0
      ? primaryPhotoSrc
      : photoFallbackTier === 1 && fallbackRawUrl
        ? fallbackRawUrl
        : '/images/igreja-jardim-florestal.png';

  const handlePhotoError = () => {
    setPhotoFallbackTier((prev) => {
      if (prev === 0 && fallbackRawUrl) return 1;
      return 2;
    });
  };

  const dateDisplay = settings.weddingDateDisplay?.trim() || DEFAULT_SITE_SETTINGS.weddingDateDisplay;
  const timeHeading = formatCeremonyTimeHeading(settings.weddingTimeDisplay);
  const venueName = settings.venueName?.trim() || DEFAULT_SITE_SETTINGS.venueName;
  const normalizedCity = normalizeVenueCityDisplay(settings.venueCity);
  const pastorDisplay = resolveCeremonyPastor(settings.ceremonyPastor);
  const plannerDisplay =
    settings.ceremonyPlanner?.trim() ||
    DEFAULT_SITE_SETTINGS.ceremonyPlanner ||
    'Ludimila De Giovanni';

  const customStreet = settings.venueStreetAddress?.trim();
  const hasDistinctStreetLine =
    Boolean(customStreet) &&
    !/^jardim florestal,?\s*rio pardo de minas/i.test(customStreet || '');

  const confirmedCoordinates = settings.venueCoordinates?.trim();
  const hasConfirmedPin = Boolean(confirmedCoordinates);
  const verifiedSearchText =
    'Igreja Adventista do Sétimo Dia, Jardim Florestal, Rio Pardo de Minas - MG, CEP 39530-000';
  const mapQuery = hasConfirmedPin ? confirmedCoordinates : verifiedSearchText;

  const googleMapsHref = settings.venueMapUrl?.trim()
    ? settings.venueMapUrl.trim()
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;

  const embedSrc = `https://maps.google.com/maps?q=${encodeURIComponent(
    mapQuery
  )}&t=&z=${hasConfirmedPin ? '17' : '15'}&ie=UTF8&iwloc=&output=embed`;

  const resolvedPadrinhos = resolvePadrinhosList(
    settings.padrinhos !== undefined ? settings.padrinhos : DEFAULT_PADRINHOS_SLOTS
  );

  const getGroupEntries = (side: 'noiva' | 'noivo'): PadrinhoEntry[] =>
    resolvedPadrinhos
      .filter((p) => p.side === side && p.published !== false && p.name.trim().length > 0)
      .sort((a, b) => a.order - b.order);

  const madrinhas = getGroupEntries('noiva');
  const padrinhos = getGroupEntries('noivo');

  return (
    <div className="relative overflow-hidden py-8 sm:py-12 lg:py-14">
      <WatercolorCorners variant="section" />

      <div className="relative z-20 mx-auto max-w-[1120px] px-3 sm:px-6 lg:px-8">
        {/* ============================================================ */}
        {/* BLOCO 1 — O LUGAR DO NOSSO SIM (CERIMÔNIA + MAPA INTEGRADO)  */}
        {/* ============================================================ */}
        <section
          aria-labelledby="ceremony-hero-title"
          className="invitation-panel relative overflow-hidden rounded-xl backdrop-blur-[1.5px]"
        >
          {/* Corner Gold Flourishes */}
          <span
            className="pointer-events-none absolute left-3 top-3 sm:left-4 sm:top-4 z-[3] h-4 w-4 sm:h-5 sm:w-5 rounded-tl-lg border-l border-t border-dourado/85"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute right-3 top-3 sm:right-4 sm:top-4 z-[3] h-4 w-4 sm:h-5 sm:w-5 rounded-tr-lg border-r border-t border-dourado/85"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute bottom-3 left-3 sm:bottom-4 sm:left-4 z-[3] h-4 w-4 sm:h-5 sm:w-5 rounded-bl-lg border-b border-l border-dourado/85"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute bottom-3 right-3 sm:bottom-4 sm:right-4 z-[3] h-4 w-4 sm:h-5 sm:w-5 rounded-br-lg border-b border-r border-dourado/85"
            aria-hidden="true"
          />

          {/* Top Unified Area: Informações da Cerimônia + Fotografia da Igreja */}
          <div className="relative">
            {/* Soft Inner Botanical Accent (Top-Left) */}
            <div
              className="pointer-events-none absolute inset-0 z-[1] select-none overflow-hidden"
              aria-hidden="true"
            >
              <img
                src={WEDDING_ASSETS.watercolorSunflowerTl}
                alt=""
                className="absolute -left-5 -top-5 w-24 opacity-55 mix-blend-multiply sm:-left-6 sm:-top-6 sm:w-32 lg:w-36"
                style={{
                  maskImage: 'radial-gradient(ellipse at 25% 25%, black 35%, transparent 72%)',
                  WebkitMaskImage: 'radial-gradient(ellipse at 25% 25%, black 35%, transparent 72%)',
                }}
              />
            </div>

            {/* Mobile / Tablet Visual Header Image (feathered cleanly into ivory paper below) */}
            <div className="relative h-56 w-full overflow-hidden sm:h-68 lg:hidden">
              <img
                src={churchPhotoSrc}
                alt={`Fachada de ${venueName}`}
                onError={handlePhotoError}
                className="h-full w-full object-cover object-center opacity-90"
                style={{
                  maskImage:
                    'linear-gradient(to bottom, black 54%, rgba(0,0,0,0.45) 82%, transparent 100%)',
                  WebkitMaskImage:
                    'linear-gradient(to bottom, black 54%, rgba(0,0,0,0.45) 82%, transparent 100%)',
                }}
              />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-20"
                style={{
                  background:
                    'linear-gradient(to top, rgba(255, 249, 240, 0.96) 0%, rgba(255, 249, 240, 0.45) 55%, transparent 100%)',
                }}
                aria-hidden="true"
              />
            </div>

            {/* Desktop Integrated Right-Side Church Photo (never shifts or obscures left text) */}
            <div
              className="pointer-events-none hidden lg:block absolute inset-y-0 right-0 z-[1] w-[47%] overflow-hidden select-none"
              aria-hidden="true"
            >
              <img
                src={churchPhotoSrc}
                alt=""
                onError={handlePhotoError}
                className="h-full w-full object-cover object-center opacity-85 mix-blend-multiply"
                style={{
                  maskImage:
                    'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.12) 14%, rgba(0,0,0,0.68) 36%, black 62%, black 100%), linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
                  WebkitMaskImage:
                    'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.12) 14%, rgba(0,0,0,0.68) 36%, black 62%, black 100%), linear-gradient(to bottom, transparent 0%, black 10%, black 90%, transparent 100%)',
                  maskComposite: 'intersect',
                  WebkitMaskComposite: 'source-in',
                }}
              />
              <div
                className="absolute inset-y-0 left-0 w-[34%]"
                style={{
                  background:
                    'linear-gradient(to right, rgba(255,249,240,0.96) 0%, rgba(255,249,240,0.5) 55%, transparent 100%)',
                }}
              />
            </div>

            {/* Left Area — Informações da Cerimônia */}
            <div className="relative z-20 px-5 pb-7 pt-2 sm:px-9 sm:pb-8 lg:w-[58%] lg:px-11 lg:pt-10 lg:pb-9">
              <div className="text-center lg:text-left">
                <h1
                  id="ceremony-hero-title"
                  className="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-semibold text-marrom leading-[1.08]"
                >
                  O lugar do nosso sim
                </h1>
                <div
                  className="mx-auto lg:mx-0 mt-3.5 mb-5 h-px w-20 bg-dourado/75"
                  aria-hidden="true"
                />
              </div>

              {/* Date, Time & Location — Unified Icon/Text Grid */}
              <div className="mx-auto w-fit max-w-full lg:mx-0 lg:w-full grid grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-3 sm:gap-x-3.5 gap-y-3.5 text-left">
                <Calendar
                  className="h-4 w-4 text-terracota-escuro shrink-0"
                  aria-hidden="true"
                />
                <p className="min-w-0 font-display text-[1.35rem] min-[375px]:text-2xl sm:text-[1.7rem] font-semibold text-marrom leading-tight">
                  {dateDisplay}
                </p>

                <Clock
                  className="h-4 w-4 text-terracota-escuro shrink-0"
                  aria-hidden="true"
                />
                <p className="min-w-0 font-display text-xl sm:text-[1.4rem] font-semibold text-terracota-escuro tabular-nums leading-tight">
                  {timeHeading}
                </p>

                <MapPin
                  className="h-4 w-4 text-terracota-escuro shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="font-display text-[17px] min-[375px]:text-lg sm:text-[1.28rem] font-semibold text-marrom leading-snug">
                    {venueName}
                  </p>
                  {hasDistinctStreetLine && (
                    <p className="text-sm text-marrom-suave leading-snug">{customStreet}</p>
                  )}
                  <p className="text-sm sm:text-[15px] text-marrom-suave leading-snug">
                    {normalizedCity}
                  </p>
                </div>
              </div>

              {/* Secondary Area separated by discreet gold hairline: Pastor & Cerimonialista */}
              <div className="mt-5 pt-4 border-t border-dourado/40">
                <div className="flex flex-wrap items-start justify-center lg:justify-start gap-x-8 gap-y-3 text-center lg:text-left">
                  <div className="min-w-0 max-w-full">
                    <p className="font-display text-xs font-semibold tracking-[0.18em] text-oliva uppercase">
                      Pastor
                    </p>
                    <p className="mt-0.5 text-[15px] font-medium leading-snug text-marrom">
                      {pastorDisplay}
                    </p>
                  </div>

                  <div className="min-w-0 max-w-full">
                    <p className="font-display text-xs font-semibold tracking-[0.18em] text-oliva uppercase">
                      Cerimonialista
                    </p>
                    <p className="mt-0.5 text-[15px] font-medium leading-snug text-marrom">
                      {plannerDisplay}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Integrated Map Inside the Same Visual Composition */}
          <div className="relative z-20 border-t border-dourado/35 bg-marfim/40 px-4 pb-6 pt-5 sm:px-9 sm:pb-8 sm:pt-6 lg:px-11">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-display text-xs font-semibold tracking-[0.26em] text-oliva uppercase">
                  LOCALIZAÇÃO
                </p>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-marrom-suave">
                  <Info className="h-3.5 w-3.5 text-dourado shrink-0" aria-hidden="true" />
                  {hasConfirmedPin ? (
                    <span>
                      Marcador geográfico confirmado:{' '}
                      <strong className="text-marrom">{confirmedCoordinates}</strong>
                    </span>
                  ) : (
                    <span>
                      Mapa posicionado na {venueName}. Marcador exato configurável no{' '}
                      <Link to="/admin" className="font-semibold text-terracota-escuro underline">
                        Painel Administrativo
                      </Link>
                      .
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setExpandedMap((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-dourado/55 bg-creme-claro px-3 py-1.5 text-xs font-medium text-marrom hover:bg-pergaminho transition-colors whitespace-nowrap"
              >
                {expandedMap ? (
                  <>
                    <Minimize2 className="h-3.5 w-3.5" />
                    Reduzir mapa
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3.5 w-3.5" />
                    Ampliar mapa
                  </>
                )}
              </button>
            </div>

            <div className="mt-3.5 overflow-hidden rounded-lg border border-dourado/50 bg-creme-claro shadow-xs">
              <iframe
                title="Mapa interativo — Igreja Adventista do Sétimo Dia — Jardim Florestal"
                src={embedSrc}
                className={`w-full border-0 transition-all duration-300 ${
                  expandedMap ? 'h-[460px]' : 'h-72 sm:h-80'
                }`}
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>

            <div className="mt-5 flex justify-center">
              <a
                href={googleMapsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-terracota-escuro px-7 py-3 text-xs font-semibold tracking-wider text-creme-claro uppercase hover:bg-terracota transition-colors whitespace-nowrap shadow-sm"
              >
                <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                ABRIR NO GOOGLE MAPS
              </a>
            </div>
          </div>
        </section>

        <BotanicalDivider className="my-7 sm:my-9" />

        {/* ============================================================ */}
        {/* BLOCO 2 — NOSSAS MADRINHAS E PADRINHOS                       */}
        {/* ============================================================ */}
        <section
          aria-labelledby="ceremony-padrinhos-title"
          className="ornamental-frame relative overflow-hidden rounded-xl bg-creme-claro/92 px-3 py-7 sm:px-9 sm:py-10"
        >
          <header className="text-center">
            <h2
              id="ceremony-padrinhos-title"
              className="font-display text-3xl sm:text-4xl font-semibold text-marrom"
            >
              Nossas Madrinhas e Padrinhos
            </h2>
            <TitleGoldOrnament />
          </header>

          {/* Two Symmetrical Columns Separated by Gold Vertical Hairline & Centered Heart */}
          <div className="mt-7 sm:mt-9 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] max-[339px]:grid-cols-1 gap-2 sm:gap-7 lg:gap-12 items-stretch">
            {/* Coluna Esquerda: Madrinhas */}
            <div className="min-w-0 px-1 sm:px-3 flex flex-col items-center">
              <h3 className="font-display text-lg sm:text-2xl font-semibold text-marrom text-center">
                Madrinhas
              </h3>
              <div className="mt-1.5 h-px w-12 sm:w-16 bg-dourado/65" aria-hidden="true" />

              <ul className="mt-4 sm:mt-5 w-full space-y-3 sm:space-y-3.5">
                {madrinhas.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-center text-center">
                    <p className="font-display text-[13.5px] min-[375px]:text-[14.5px] min-[430px]:text-[15.5px] sm:text-lg md:text-[1.26rem] font-medium text-terracota leading-[1.28] break-words text-balance">
                      {entry.name.trim()}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            {/* Tiny Viewport (<340px) Fallback Horizontal Divider */}
            <div
              className="hidden max-[339px]:flex items-center justify-center gap-3 my-5"
              aria-hidden="true"
            >
              <span className="h-px flex-1 max-w-[80px] bg-dourado/60" />
              <SmallGoldHeart />
              <span className="h-px flex-1 max-w-[80px] bg-dourado/60" />
            </div>

            {/* Vertical Gold Divider with Centered Small Heart */}
            <div
              className="max-[339px]:hidden flex flex-col items-center justify-center py-1 shrink-0"
              aria-hidden="true"
            >
              <span className="w-px flex-1 bg-gradient-to-b from-transparent via-dourado/75 to-dourado/75" />
              <div className="my-2.5 flex items-center justify-center">
                <SmallGoldHeart />
              </div>
              <span className="w-px flex-1 bg-gradient-to-t from-transparent via-dourado/75 to-dourado/75" />
            </div>

            {/* Coluna Direita: Padrinhos */}
            <div className="min-w-0 px-1 sm:px-3 flex flex-col items-center">
              <h3 className="font-display text-lg sm:text-2xl font-semibold text-marrom text-center">
                Padrinhos
              </h3>
              <div className="mt-1.5 h-px w-12 sm:w-16 bg-dourado/65" aria-hidden="true" />

              <ul className="mt-4 sm:mt-5 w-full space-y-3 sm:space-y-3.5">
                {padrinhos.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-center text-center">
                    <p className="font-display text-[13.5px] min-[375px]:text-[14.5px] min-[430px]:text-[15.5px] sm:text-lg md:text-[1.26rem] font-medium text-terracota leading-[1.28] break-words text-balance">
                      {entry.name.trim()}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
