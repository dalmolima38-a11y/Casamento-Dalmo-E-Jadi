import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useSpring } from 'motion/react';
import { Camera, ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { useWedding } from '../context/WeddingContext';
import { WEDDING_ASSETS } from '../data/assets';
import { BotanicalDivider } from '../components/BotanicalDivider';
import { WatercolorCorners } from '../components/WatercolorCorners';

interface LightboxState {
  chapterTitle: string;
  images: string[];
  index: number;
}

const SunflowerMarkerSvg: React.FC<{ className?: string }> = ({ className = 'h-9 w-9' }) => (
  <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
    <g stroke="#C6A46A" strokeWidth="1.2">
      {Array.from({ length: 16 }).map((_, i) => {
        const angle = i * 22.5;
        return (
          <ellipse
            key={i}
            cx="32"
            cy="12"
            rx="3.6"
            ry="10.5"
            fill={i % 2 === 0 ? '#E8B84B' : '#D99E32'}
            fillOpacity="0.92"
            transform={`rotate(${angle} 32 32)`}
          />
        );
      })}
    </g>
    <circle cx="32" cy="32" r="10.5" fill="#49352B" stroke="#C6A46A" strokeWidth="1.5" />
    <circle cx="32" cy="32" r="6.5" fill="#6F4A34" fillOpacity="0.65" />
    <circle cx="29.5" cy="29.5" r="1.2" fill="#E8C988" />
    <circle cx="34.5" cy="30.5" r="1" fill="#E8C988" />
    <circle cx="31.5" cy="34.5" r="1.1" fill="#E8C988" />
  </svg>
);

const GoldHeaderOrnament: React.FC = () => (
  <svg viewBox="0 0 220 26" fill="none" aria-hidden="true" className="mx-auto h-6 w-48 text-dourado">
    <path d="M10 13H86" stroke="currentColor" strokeWidth="1" strokeOpacity="0.7" />
    <path d="M134 13H210" stroke="currentColor" strokeWidth="1" strokeOpacity="0.7" />
    <path
      d="M110 4C112 9 115 11 120 13C115 15 112 17 110 22C108 17 105 15 100 13C105 11 108 9 110 4Z"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="#C6A46A"
      fillOpacity="0.25"
    />
    <circle cx="93" cy="13" r="2" fill="currentColor" fillOpacity="0.75" />
    <circle cx="127" cy="13" r="2" fill="currentColor" fillOpacity="0.75" />
  </svg>
);

const ChapterPhotoFrame: React.FC<{
  src?: string;
  alt: string;
  aspectClass?: string;
  placeholderLabel?: string;
  onExpand?: () => void;
}> = ({ src, alt, aspectClass = 'aspect-[4/3]', placeholderLabel, onExpand }) => {
  const [failed, setFailed] = useState(false);
  const hasValidImage = Boolean(src && src.trim() && !failed);

  return (
    <div className="relative border border-dourado/80 bg-[#FAF4EA] p-2.5 shadow-[0_14px_30px_-14px_rgba(73,53,43,0.28)]">
      {/* Delicate corner ornaments */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1 left-1 h-3 w-3 border-t border-l border-dourado"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1 right-1 h-3 w-3 border-t border-r border-dourado"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 left-1 h-3 w-3 border-b border-l border-dourado"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-1 right-1 h-3 w-3 border-b border-r border-dourado"
      />

      <div className={`relative overflow-hidden border border-dourado/40 ${aspectClass}`}>
        {hasValidImage ? (
          <button
            type="button"
            onClick={onExpand}
            aria-label={`Ampliar fotografia: ${alt}`}
            className="group relative block h-full w-full text-left focus-visible:outline-none"
          >
            <img
              src={src}
              alt={alt}
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
            <span className="pointer-events-none absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-sm bg-marrom/75 px-2.5 py-1 text-[11px] font-medium text-creme-claro opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <Expand className="h-3 w-3" />
              Ampliar
            </span>
          </button>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#FAF4EA] via-[#F6EBDD] to-[#EDE0CE] p-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dourado/55 bg-[#FAF4EA]/85">
              <Camera className="h-5 w-5 text-dourado" aria-hidden="true" />
            </div>
            <p className="mt-3 font-display text-base italic text-marrom">
              {placeholderLabel || 'Fotografia deste capítulo'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Controle temporário de manutenção da página Nossa História.
 * Para reativar a linha do tempo completa com capítulos e fotos originais,
 * basta alterar este valor para `false`.
 */
const IS_STORY_UNDER_MAINTENANCE = true;

const OpenBookHeartIcon: React.FC<{ className?: string }> = ({ className = 'h-12 w-12 sm:h-14 sm:w-14' }) => (
  <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
    {/* Pequeno coração delicado em terracota */}
    <path
      d="M32 23.5C32 23.5 25.5 19.2 25.5 14.9C25.5 12.6 27.3 11 29.3 11C30.6 11 31.5 11.7 32 12.6C32.5 11.7 33.4 11 34.7 11C36.7 11 38.5 12.6 38.5 14.9C38.5 19.2 32 23.5 32 23.5Z"
      stroke="#873F2C"
      strokeWidth="1.5"
      strokeLinejoin="round"
      fill="#A65A43"
      fillOpacity="0.16"
    />
    {/* Livro aberto em traço fino dourado */}
    <path
      d="M32 30.5C27.5 27.4 20.5 26.8 12.5 28.2V49.2C20.5 47.8 27.5 48.4 32 51.5C36.5 48.4 43.5 47.8 51.5 49.2V28.2C43.5 26.8 36.5 27.4 32 30.5Z"
      stroke="#C6A46A"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="#FFF9F0"
      fillOpacity="0.65"
    />
    <path d="M32 30.5V51.5" stroke="#C6A46A" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M17.5 34.2C21.2 33.8 24.8 34.1 27.5 35.1" stroke="#C6A46A" strokeOpacity="0.65" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M17.5 39.2C21.2 38.8 24.8 39.1 27.5 40.1" stroke="#C6A46A" strokeOpacity="0.65" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M46.5 34.2C42.8 33.8 39.2 34.1 36.5 35.1" stroke="#C6A46A" strokeOpacity="0.65" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M46.5 39.2C42.8 38.8 39.2 39.1 36.5 40.1" stroke="#C6A46A" strokeOpacity="0.65" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const StoryMaintenanceView: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      aria-label="Página em manutenção"
      className="relative flex min-h-[calc(100vh-11rem)] items-center justify-center overflow-hidden px-4 py-12 sm:px-6 sm:py-16"
    >
      {/* Fundo marfim texturizado com lavagem em aquarela */}
      <div className="pointer-events-none absolute inset-0 z-0 select-none" aria-hidden="true">
        <img
          src={WEDDING_ASSETS.watercolorPaperBackdrop}
          alt=""
          className="h-full w-full object-cover object-center opacity-55"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 48%, rgba(255, 249, 240, 0.52) 0%, rgba(255, 249, 240, 0.34) 58%, rgba(246, 235, 221, 0.5) 100%)',
          }}
        />
      </div>

      {/* Detalhes florais em aquarela nos cantos */}
      <WatercolorCorners variant="hero" />

      <div className="relative z-20 mx-auto w-full max-w-2xl">
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="invitation-panel relative rounded-xl bg-marfim/92 px-6 py-11 text-center backdrop-blur-[2px] sm:px-14 sm:py-14"
        >
          {/* 1. Ícone de livro aberto com coração */}
          <div className="flex justify-center">
            <OpenBookHeartIcon />
          </div>

          {/* 2. Título "PÁGINA EM MANUTENÇÃO" */}
          <h1 className="mt-5 font-display text-lg min-[375px]:text-xl sm:text-2xl font-semibold tracking-[0.22em] sm:tracking-[0.28em] text-marrom uppercase">
            Página em Manutenção
          </h1>

          {/* 3. Mensagem caligráfica romântica */}
          <p className="mx-auto mt-3.5 max-w-lg font-delicate text-[1.95rem] min-[375px]:text-[2.2rem] sm:text-[2.75rem] leading-[1.2] text-terracota-escuro">
            Em breve, a história mais linda de amor...
          </p>

          {/* 4. Pequeno ornamento dourado abaixo da mensagem */}
          <div className="mt-6">
            <GoldHeaderOrnament />
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export const StoryPage: React.FC = () => {
  if (IS_STORY_UNDER_MAINTENANCE) {
    return <StoryMaintenanceView />;
  }

  return <StoryTimelineContent />;
};

const StoryTimelineContent: React.FC = () => {
  const { settings, timelineEvents } = useWedding();
  const timelineRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  const { scrollYProgress } = useScroll({
    target: timelineRef,
    offset: ['start 72%', 'end 82%'],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 24,
    restDelta: 0.001,
  });

  useEffect(() => {
    if (!lightbox) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightbox(null);
      } else if (e.key === 'ArrowRight' && lightbox.images.length > 1) {
        setLightbox((prev) =>
          prev ? { ...prev, index: (prev.index + 1) % prev.images.length } : null
        );
      } else if (e.key === 'ArrowLeft' && lightbox.images.length > 1) {
        setLightbox((prev) =>
          prev
            ? {
                ...prev,
                index: (prev.index - 1 + prev.images.length) % prev.images.length,
              }
            : null
        );
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightbox]);

  const openLightbox = (chapterTitle: string, images: string[], startIndex: number) => {
    const valid = images.filter((img) => img && img.trim().length > 0);
    if (valid.length === 0) return;
    setLightbox({
      chapterTitle,
      images: valid,
      index: Math.max(0, Math.min(startIndex, valid.length - 1)),
    });
  };

  return (
    <div className="relative min-h-screen">
      {/* Floral Aquarela Ivory Frontispiece */}
      <section className="relative overflow-hidden pt-14 pb-10 sm:pt-20 sm:pb-12">
        <div className="pointer-events-none absolute inset-0 z-0 select-none" aria-hidden="true">
          <img
            src={WEDDING_ASSETS.watercolorPaperBackdrop}
            alt=""
            className="h-full w-full object-cover object-center opacity-55"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 45%, rgba(255, 249, 240, 0.55) 0%, rgba(255, 249, 240, 0.35) 60%, rgba(246, 235, 221, 0.5) 100%)',
            }}
          />
        </div>

        <WatercolorCorners variant="hero" />

        <div className="relative z-20 mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <motion.header
            initial={shouldReduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            className="invitation-panel relative rounded-xl bg-marfim/92 px-6 py-10 text-center backdrop-blur-[2px] sm:px-14 sm:py-14"
          >
            <GoldHeaderOrnament />

            <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-marrom sm:text-5xl lg:text-6xl">
              Nossa História
            </h1>

            <p className="mt-2 font-script text-3xl text-terracota-escuro sm:text-4xl">
              Caminhando juntos na luz de Deus
            </p>

            <div className="mx-auto mt-6 max-w-2xl border-t border-b border-dourado/45 py-5">
              <blockquote className="font-display text-xl leading-relaxed text-marrom italic sm:text-2xl">
                “{settings.storyIntro}”
              </blockquote>
            </div>
          </motion.header>
        </div>
      </section>

      <BotanicalDivider />

      {/* Interactive Vertical Timeline — Golden Thread Behind Opaque Ivory Event Cards */}
      <section
        aria-label="Linha do tempo da história do casal"
        className="relative z-20 overflow-hidden pt-8 pb-14 sm:pt-10 sm:pb-20"
      >
        <div ref={timelineRef} className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          {/* BACKGROUND LAYER (z-0): Continuous organic golden line passing strictly BEHIND cards */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-1/2 z-0 w-28 -translate-x-1/2 sm:w-36"
          >
            <svg
              viewBox="0 0 120 1200"
              preserveAspectRatio="none"
              className="h-full w-full overflow-visible"
            >
              <defs>
                <filter id="golden-thread-glow" x="-40%" y="-10%" width="180%" height="120%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Soft muted guide line */}
              <path
                d="M 60 0 C 86 150, 34 300, 60 450 C 86 600, 34 750, 60 900 C 86 1040, 40 1130, 60 1200"
                stroke="#C6A46A"
                strokeOpacity="0.28"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                fill="none"
              />

              {/* Subtle parallel botanical filament */}
              <path
                d="M 64 0 C 42 180, 78 360, 58 540 C 38 720, 78 900, 60 1200"
                stroke="#C6A46A"
                strokeOpacity="0.18"
                strokeWidth="1"
                strokeDasharray="4 6"
                vectorEffect="non-scaling-stroke"
                fill="none"
              />

              {/* Scroll-illuminated glowing golden thread */}
              <motion.path
                d="M 60 0 C 86 150, 34 300, 60 450 C 86 600, 34 750, 60 900 C 86 1040, 40 1130, 60 1200"
                stroke="#C6A46A"
                strokeWidth="2.4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                filter="url(#golden-thread-glow)"
                fill="none"
                style={{ pathLength: shouldReduceMotion ? 1 : smoothProgress }}
              />
            </svg>
          </div>

          {/* FOREGROUND CHAPTERS: Opaque ivory paper cards (z-10) + Sunflower markers (z-20) */}
          <div className="relative space-y-16 sm:space-y-24">
            {timelineEvents.map((ev, index) => {
              const isEven = index % 2 === 0;
              const chapterImages = [
                ...(ev.imageUrl ? [ev.imageUrl] : []),
                ...(ev.galleryUrls || []),
              ].filter((u) => u && u.trim().length > 0);
              const galleryList = (ev.galleryUrls || []).filter((u) => u && u.trim().length > 0);
              const paragraphs = ev.description
                .split(/\n\s*\n/)
                .map((p) => p.trim())
                .filter(Boolean);

              return (
                <div key={ev.id} className="relative">
                  {/* Delicate Sunflower Marker along the vertical axis (z-20) */}
                  <motion.div
                    initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.85 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                    className="relative z-20 mx-auto mb-5 flex flex-col items-center"
                  >
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-dourado/80 bg-[#FAF4EA] shadow-[0_6px_22px_-4px_rgba(198,164,106,0.65)]">
                      <SunflowerMarkerSvg className="h-10 w-10" />
                    </div>
                  </motion.div>

                  {/* Opaque Handmade Ivory Card (z-10) hiding the z-0 golden line behind it */}
                  <motion.article
                    initial={
                      shouldReduceMotion
                        ? false
                        : { opacity: 0, y: 24 }
                    }
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.2 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    className={`invitation-panel relative z-10 w-full rounded-xl p-6 sm:p-10 lg:w-[86%] ${
                      isEven ? 'lg:mr-auto' : 'lg:ml-auto'
                    }`}
                  >
                    {/* Chapter Kicker & Title */}
                    <div className="border-b border-dourado/35 pb-5">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-semibold tracking-[0.2em] text-salvia uppercase">
                        <span>{ev.dateLabel}</span>
                        {ev.subtitle && (
                          <>
                            <span aria-hidden="true" className="text-dourado">
                              ·
                            </span>
                            <span className="text-terracota-escuro">{ev.subtitle}</span>
                          </>
                        )}
                      </div>

                      <h2 className="mt-2 font-display text-3xl font-semibold leading-tight text-marrom sm:text-4xl">
                        {ev.title}
                      </h2>
                    </div>

                    {/* Alternating Narrative + Large Golden-Framed Photograph */}
                    <div className="mt-7 grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
                      <div
                        className={`lg:col-span-7 ${
                          isEven ? 'lg:order-1' : 'lg:order-2'
                        } space-y-4`}
                      >
                        {paragraphs.map((paragraph, pIdx) => (
                          <p
                            key={pIdx}
                            className={`text-[15.5px] leading-[1.85] text-marrom-suave sm:text-base ${
                              pIdx === 0
                                ? 'first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:font-display first-letter:text-5xl first-letter:font-semibold first-letter:leading-[0.82] first-letter:text-terracota-escuro'
                                : ''
                            }`}
                          >
                            {paragraph}
                          </p>
                        ))}
                      </div>

                      <div
                        className={`lg:col-span-5 ${
                          isEven ? 'lg:order-2' : 'lg:order-1'
                        }`}
                      >
                        <ChapterPhotoFrame
                          src={ev.imageUrl}
                          alt={ev.title}
                          aspectClass="aspect-[4/4] sm:aspect-[4/3] lg:aspect-[4/5]"
                          placeholderLabel={`Fotografia · ${ev.title}`}
                          onExpand={() =>
                            ev.imageUrl &&
                            openLightbox(ev.title, chapterImages, 0)
                          }
                        />
                      </div>
                    </div>

                    {/* Chapter-Associated Photo Gallery */}
                    <div className="mt-8 border-t border-dourado/30 pt-6">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-display text-lg font-medium italic text-marrom">
                          Registros deste capítulo
                        </p>
                        {galleryList.length > 0 && (
                          <span className="text-xs tracking-wider text-marrom-suave uppercase tabular-nums">
                            {galleryList.length}{' '}
                            {galleryList.length === 1 ? 'fotografia' : 'fotografias'}
                          </span>
                        )}
                      </div>

                      {galleryList.length > 0 ? (
                        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                          {galleryList.map((photoUrl, gIdx) => {
                            const lightboxIdx = ev.imageUrl ? gIdx + 1 : gIdx;
                            return (
                              <ChapterPhotoFrame
                                key={`${ev.id}-gal-${gIdx}`}
                                src={photoUrl}
                                alt={`${ev.title} — fotografia ${gIdx + 1}`}
                                aspectClass="aspect-[4/3]"
                                onExpand={() =>
                                  openLightbox(ev.title, chapterImages, lightboxIdx)
                                }
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                          {[1, 2, 3].map((slot) => (
                            <ChapterPhotoFrame
                              key={`${ev.id}-slot-${slot}`}
                              alt={`${ev.title} — espaço fotográfico ${slot}`}
                              aspectClass="aspect-[4/3]"
                              placeholderLabel={`Memória 0${slot}`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.article>
                </div>
              );
            })}
          </div>

          {/* Closing Milestone on the Glowing Golden Line */}
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.35 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-20 pt-16 sm:pt-20"
          >
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-dourado/80 bg-[#FAF4EA] shadow-[0_6px_22px_-4px_rgba(198,164,106,0.65)]">
              <SunflowerMarkerSvg className="h-10 w-10" />
            </div>

            <div className="invitation-panel mx-auto max-w-3xl rounded-xl px-6 py-10 text-center sm:px-12 sm:py-12">
              <GoldHeaderOrnament />
              <p className="mt-5 font-display text-3xl font-semibold italic text-marrom sm:text-4xl">
                Nosso felizes para sempre está apenas começando. 🌻
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link
                  to="/rsvp"
                  className="rounded-md bg-terracota-escuro px-6 py-3 text-xs font-semibold tracking-[0.16em] text-creme-claro uppercase transition-colors hover:bg-terracota"
                >
                  Confirmar presença
                </Link>
                <Link
                  to="/presentes"
                  className="rounded-md border border-dourado/80 bg-[#FAF4EA] px-6 py-3 text-xs font-semibold tracking-[0.16em] text-marrom uppercase transition-colors hover:bg-pergaminho/70"
                >
                  Lista de presentes
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Accessible Lightbox Modal for Real Couple Photographs */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.chapterTitle}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-marrom/90 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-4xl rounded-xl border border-dourado/70 bg-[#FAF4EA] p-4 shadow-2xl sm:p-6"
          >
            <div className="mb-3 flex items-center justify-between gap-4 border-b border-dourado/30 pb-3">
              <div>
                <p className="font-display text-xl font-semibold text-marrom">
                  {lightbox.chapterTitle}
                </p>
                {lightbox.images.length > 1 && (
                  <p className="text-xs text-marrom-suave tabular-nums">
                    Fotografia {lightbox.index + 1} de {lightbox.images.length}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Fechar visualização ampliada"
                className="rounded-md border border-dourado/50 p-2 text-marrom hover:bg-pergaminho/70"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-marrom/10">
              <img
                src={lightbox.images[lightbox.index]}
                alt={`${lightbox.chapterTitle} — fotografia ${lightbox.index + 1}`}
                referrerPolicy="no-referrer"
                className="max-h-[72vh] w-auto object-contain"
              />

              {lightbox.images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox((prev) =>
                        prev
                          ? {
                              ...prev,
                              index: (prev.index - 1 + prev.images.length) % prev.images.length,
                            }
                          : null
                      )
                    }
                    aria-label="Fotografia anterior"
                    className="absolute left-3 rounded-full border border-dourado/70 bg-[#FAF4EA]/90 p-2.5 text-marrom shadow hover:bg-[#FAF4EA]"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox((prev) =>
                        prev ? { ...prev, index: (prev.index + 1) % prev.images.length } : null
                      )
                    }
                    aria-label="Próxima fotografia"
                    className="absolute right-3 rounded-full border border-dourado/70 bg-[#FAF4EA]/90 p-2.5 text-marrom shadow hover:bg-[#FAF4EA]"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
