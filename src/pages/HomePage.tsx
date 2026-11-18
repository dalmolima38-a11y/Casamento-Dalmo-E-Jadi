import React from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import {
  CheckCircle2,
  Gift,
  MessageSquareHeart,
  Navigation,
} from 'lucide-react';
import { useWedding } from '../context/WeddingContext';
import { WEDDING_ASSETS } from '../data/assets';
import { CountdownTimer } from '../components/CountdownTimer';
import { BotanicalDivider } from '../components/BotanicalDivider';
import { CoverflowGallery } from '../components/CoverflowGallery';
import { GuestbookSpotlight } from '../components/GuestbookSpotlight';
import { GiftCategoriesCarousel } from '../components/GiftCategoriesCarousel';
import { WatercolorCorners } from '../components/WatercolorCorners';
import { getCeremonyPhotoFallbackUrl } from '../lib/imageOptimizer';

export const HomePage: React.FC = () => {
  const { settings, gifts, coverflowPhotos, guestbookMessages } = useWedding();
  const approvedGuestbookMessages = guestbookMessages.filter((m) => m.status === 'approved');
  const shouldReduceMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const heroBgY = useTransform(scrollY, [0, 700], [0, shouldReduceMotion ? 0 : 40]);

  const [photoFallbackTier, setPhotoFallbackTier] = React.useState<0 | 1 | 2>(0);
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

  const sectionReveal = shouldReduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 18 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0.15 },
        transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <div className="relative">
      {/* 1. HERO FLORAL AQUARELA — Convite Único Integrado com Fotografia da Igreja */}
      <section className="relative overflow-x-clip">
        {/* Soft Handmade Watercolor Paper Wash (feathered smoothly at bottom so no seam separates Hero & Ceremony) */}
        <motion.div
          style={{
            y: heroBgY,
            maskImage: 'linear-gradient(to bottom, black 68%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 68%, transparent 100%)',
          }}
          className="pointer-events-none absolute inset-0 z-0 select-none"
          aria-hidden="true"
        >
          <img
            src={WEDDING_ASSETS.watercolorPaperBackdrop}
            alt=""
            className="h-full w-full object-cover object-center opacity-50"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 45%, rgba(255, 249, 240, 0.5) 0%, rgba(255, 249, 240, 0.25) 60%, transparent 100%)',
            }}
          />
        </motion.div>

        {/* Corner Watercolor Sunflowers (TL & BR) and Botanical Sprigs (TR & BL) at z-[2] */}
        <WatercolorCorners variant="hero" />

        {/* Unified Invitation Panel (~93% desktop width, full readable mobile container) at z-20 above falling petals */}
        <div className="relative z-20 mx-auto w-full max-w-[1360px] px-2.5 pt-6 pb-8 sm:px-5 sm:pt-10 sm:pb-12 lg:px-6 lg:pt-12 lg:pb-14">
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="invitation-panel relative mx-auto w-full md:w-[95%] lg:w-[94%] overflow-hidden rounded-xl py-7 backdrop-blur-[1.5px] sm:py-9 lg:py-11"
          >
            {/* Subtle Inner Corner Sunflower (Top-Left) & Botanical Sprig Accent */}
            <div className="pointer-events-none absolute inset-0 z-[1] select-none" aria-hidden="true">
              <img
                src={WEDDING_ASSETS.watercolorSunflowerTl}
                alt=""
                className="absolute -left-5 -top-5 w-24 opacity-70 mix-blend-multiply sm:-left-6 sm:-top-6 sm:w-36 sm:opacity-75 lg:w-44"
                style={{
                  maskImage: 'radial-gradient(ellipse at 25% 25%, black 38%, transparent 74%)',
                  WebkitMaskImage: 'radial-gradient(ellipse at 25% 25%, black 38%, transparent 74%)',
                }}
              />
              <img
                src={WEDDING_ASSETS.watercolorBotanicalSprig}
                alt=""
                className="hidden md:block absolute -bottom-7 -left-6 w-36 -rotate-[142deg] opacity-35 mix-blend-multiply"
                style={{
                  maskImage: 'radial-gradient(ellipse at 30% 70%, black 35%, transparent 72%)',
                  WebkitMaskImage: 'radial-gradient(ellipse at 30% 70%, black 35%, transparent 72%)',
                }}
              />
            </div>

            {/* Subtle Corner Gold Flourishes */}
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

            {/* Main Textual & Interactive Content — 100% centralizado na largura interna da moldura */}
            <div className="relative z-20 w-full text-center">
              <div className="px-3.5 sm:px-8 lg:px-12">
              {/* 1. Título Superior */}
              <p className="mt-1 font-display text-[11px] sm:text-xs lg:text-sm font-semibold tracking-[0.2em] sm:tracking-[0.26em] text-oliva uppercase">
                NOSSO FELIZES PARA SEMPRE
              </p>

              {/* 2. Nomes em Caligrafia Original */}
              <h1 className="mt-2.5 sm:mt-3 flex flex-col items-center justify-center md:flex-row md:items-baseline md:gap-4">
                <span className="font-script text-[3.35rem] min-[375px]:text-6xl sm:text-7xl lg:text-[5rem] text-terracota-escuro leading-[0.95]">
                  Dalmo
                </span>
                <span className="my-0.5 md:my-0 flex items-center justify-center gap-3 md:gap-0">
                  <span className="h-px w-8 bg-dourado/80 md:hidden" aria-hidden="true" />
                  <span className="font-script text-2xl sm:text-3xl md:text-5xl lg:text-[3.25rem] text-dourado leading-none">
                    &amp;
                  </span>
                  <span className="h-px w-8 bg-dourado/80 md:hidden" aria-hidden="true" />
                </span>
                <span className="font-script text-[3.35rem] min-[375px]:text-6xl sm:text-7xl lg:text-[5rem] text-terracota-escuro leading-[0.95]">
                  Jadi
                </span>
              </h1>

              {/* 3. Frase dos Girassóis */}
              <blockquote className="mx-auto mt-3.5 sm:mt-4 max-w-xl font-display text-[1.06rem] min-[375px]:text-lg sm:text-xl lg:text-[1.35rem] italic leading-relaxed text-marrom">
                “{settings.heroQuote}”
              </blockquote>

              <div className="mx-auto my-3.5 sm:my-4 h-px w-20 sm:w-28 bg-dourado/45" aria-hidden="true" />
              </div>

              {/* 4. BLOCO CENTRALIZADO DE DATA & IGREJA (Mobile, Tablet & Desktop) + Fotografia decorativa ao fundo somente à direita */}
              <div className="relative w-full py-2 sm:py-3">
                {/* Camada absoluta decorativa da igreja alinhada à borda direita interna do convite, sem nunca invadir a metade esquerda */}
                <div
                  className="pointer-events-none absolute -top-9 -bottom-10 right-0 z-[1] w-[50%] md:w-[46%] lg:w-[43%] max-w-[540px] overflow-hidden select-none"
                  aria-hidden="true"
                >
                  <img
                    src={churchPhotoSrc}
                    alt=""
                    onError={handlePhotoError}
                    className="h-full w-full translate-x-[4%] scale-[1.06] object-cover object-[52%_38%] opacity-[0.34] min-[375px]:opacity-[0.42] md:opacity-[0.5] lg:opacity-[0.58] mix-blend-multiply"
                    style={{
                      maskImage:
                        'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.08) 14%, rgba(0,0,0,0.45) 38%, rgba(0,0,0,0.88) 70%, black 100%), linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.72) 18%, black 36%, black 66%, rgba(0,0,0,0.72) 84%, transparent 100%)',
                      WebkitMaskImage:
                        'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.08) 14%, rgba(0,0,0,0.45) 38%, rgba(0,0,0,0.88) 70%, black 100%), linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.72) 18%, black 36%, black 66%, rgba(0,0,0,0.72) 84%, transparent 100%)',
                      maskComposite: 'intersect',
                      WebkitMaskComposite: 'source-in',
                    }}
                  />
                  {/* Suavização progressiva em marfim junto à borda esquerda desta camada para manter contraste total nos textos centrais */}
                  <div
                    className="absolute inset-y-0 left-0 w-[42%]"
                    style={{
                      background:
                        'linear-gradient(to right, rgba(255,249,240,0.92) 0%, rgba(255,249,240,0.38) 58%, transparent 100%)',
                    }}
                  />
                </div>

                {/* Conteúdo centralizado no eixo interno do convite em todas as resoluções */}
                <div className="relative z-20 mx-auto flex w-full flex-col items-center px-3.5 text-center sm:px-8 lg:px-12">
                  {/* Data e Horário: DOMINGO | JAN 10 2027 | ÀS 15:00 h (10 centralizado no eixo) */}
                  <div className="mx-auto grid w-full max-w-[440px] lg:max-w-[500px] grid-cols-[1fr_auto_1fr] items-center">
                    <div className="pr-2.5 min-[375px]:pr-3.5 sm:pr-5 text-right font-display text-[clamp(0.64rem,2.9vw,0.78rem)] md:text-[13px] lg:text-sm font-semibold tracking-[0.13em] min-[375px]:tracking-[0.18em] md:tracking-[0.2em] text-marrom uppercase [text-shadow:0_1px_6px_rgba(255,249,240,0.96)]">
                      Domingo
                    </div>

                    <div className="border-x border-dourado/80 px-3.5 min-[375px]:px-5 sm:px-6 lg:px-7 py-0.5 text-center">
                      <p className="font-display text-[clamp(0.64rem,2.9vw,0.76rem)] md:text-xs font-semibold tracking-[0.2em] text-terracota-escuro uppercase leading-tight">
                        Jan
                      </p>
                      <p className="font-display text-[clamp(1.85rem,8.5vw,2.4rem)] md:text-[2.5rem] lg:text-[2.75rem] font-semibold text-[#B87929] tabular-nums leading-[0.95] my-0.5">
                        10
                      </p>
                      <p className="font-display text-[clamp(0.64rem,2.9vw,0.76rem)] md:text-xs font-semibold tracking-[0.18em] text-marrom tabular-nums leading-tight">
                        2027
                      </p>
                    </div>

                    <div className="pl-2.5 min-[375px]:pl-3.5 sm:pl-5 text-left font-display text-[clamp(0.64rem,2.9vw,0.78rem)] md:text-[13px] lg:text-sm font-semibold tracking-[0.1em] min-[375px]:tracking-[0.15em] md:tracking-[0.18em] text-marrom uppercase whitespace-nowrap [text-shadow:0_1px_6px_rgba(255,249,240,0.96)]">
                      Às 15:00 h
                    </div>
                  </div>

                  {/* Divisória ornamental discreta conectando o eixo da data ao logotipo oficial */}
                  <div className="my-3 sm:my-3.5 flex items-center justify-center gap-2" aria-hidden="true">
                    <span className="h-px w-10 sm:w-12 bg-dourado/65" />
                    <span className="h-1.5 w-1.5 rotate-45 border border-dourado/85" />
                    <span className="h-px w-10 sm:w-12 bg-dourado/65" />
                  </div>

                  {/* Logotipo Oficial da Igreja Adventista do Sétimo Dia + Informações Centralizadas */}
                  <div className="flex flex-col items-center text-center [text-shadow:0_1px_8px_rgba(255,249,240,0.98)]">
                    <img
                      src="/images/logo-iasd-dourado.png"
                      alt="Logotipo oficial da Igreja Adventista do Sétimo Dia"
                      className="h-9 min-[375px]:h-10 lg:h-11 w-auto object-contain select-none translate-x-[1.5px]"
                    />

                    <p className="mt-1.5 sm:mt-2 font-display text-[clamp(0.76rem,3.4vw,0.92rem)] md:text-sm lg:text-[15px] font-semibold tracking-[0.15em] md:tracking-[0.18em] text-terracota-escuro uppercase leading-snug">
                      Igreja Adventista
                      <br />
                      do Sétimo Dia
                    </p>
                    <p className="mt-0.5 font-display text-[clamp(0.65rem,2.9vw,0.78rem)] md:text-xs lg:text-[13px] font-semibold tracking-[0.22em] text-[#9A6B25] uppercase">
                      Jardim Florestal
                    </p>
                    <p className="mt-0.5 font-display text-[clamp(0.7rem,3.1vw,0.84rem)] md:text-xs lg:text-[13px] italic text-marrom-suave">
                      Rio Pardo de Minas – MG
                    </p>
                  </div>
                </div>
              </div>

              <div className="px-3.5 sm:px-8 lg:px-12">
              {/* 5. Cronômetro Flip Clock Compacto (1 linha no mobile) */}
              <div className="relative z-10 mt-2 sm:mt-5">
                <CountdownTimer targetIso={settings.weddingDateIso} />
              </div>

              {/* 6. Botões Principais + Link Inferior */}
              <div className="relative z-10 mt-6 sm:mt-7 flex flex-col md:flex-row items-center justify-center gap-3">
                <Link
                  to="/presentes"
                  className="w-full md:w-auto inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-[#873F2C] bg-[#873F2C] px-6 py-3 text-xs font-semibold tracking-[0.15em] text-[#FFF9F0] uppercase shadow-sm hover:bg-terracota transition-colors whitespace-nowrap"
                >
                  <Gift className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Escolher um Presente
                </Link>

                <Link
                  to="/rsvp"
                  className="w-full md:w-auto inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-[#873F2C] bg-[#FFF9F0] px-6 py-3 text-xs font-semibold tracking-[0.15em] text-[#873F2C] uppercase hover:bg-creme transition-colors whitespace-nowrap"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Confirmar Presença
                </Link>
              </div>

              {/* 7. Link Inferior: Ver Mapa e Como Chegar */}
              <div className="relative z-10 mt-4 flex justify-center">
                <Link
                  to="/cerimonia"
                  className="inline-flex min-h-[36px] items-center justify-center gap-1.5 px-2 py-1 text-xs font-semibold tracking-[0.16em] text-terracota-escuro uppercase underline decoration-dourado/75 underline-offset-4 hover:text-terracota transition-colors"
                >
                  <Navigation className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Ver mapa e como chegar
                </Link>
              </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Divisória floral separando o convite inicial da seção Nossa Caminhada */}
      <BotanicalDivider />

      {/* 2. HISTÓRIA, MURAL & GALERIA — Cartão Único com Carrossel 3D Coverflow */}
      <section className="relative pt-6 pb-12 sm:pt-8 sm:pb-16">
        <motion.div {...sectionReveal} className="relative z-20 mx-auto max-w-6xl px-3 sm:px-6 lg:px-8">
          <div className="ornamental-frame relative overflow-hidden rounded-xl bg-marfim/92 px-3.5 py-6 sm:px-10 sm:py-9">
            {/* Subtle corner watercolor sunflower accents behind card content */}
            <div className="pointer-events-none absolute inset-0 z-0 select-none" aria-hidden="true">
              <img
                src={WEDDING_ASSETS.watercolorSunflowerTl}
                alt=""
                className="absolute -top-6 -left-6 w-28 sm:w-44 opacity-28 mix-blend-multiply"
                style={{
                  maskImage: 'radial-gradient(ellipse at 32% 32%, black 35%, transparent 72%)',
                  WebkitMaskImage: 'radial-gradient(ellipse at 32% 32%, black 35%, transparent 72%)',
                }}
              />
              <img
                src={WEDDING_ASSETS.watercolorBotanicalSprig}
                alt=""
                className="absolute -right-8 -bottom-6 w-32 sm:w-44 rotate-180 opacity-28 mix-blend-multiply"
                style={{
                  maskImage: 'radial-gradient(ellipse at 65% 65%, black 35%, transparent 72%)',
                  WebkitMaskImage: 'radial-gradient(ellipse at 65% 65%, black 35%, transparent 72%)',
                }}
              />
            </div>

            <div className="relative z-10 space-y-3.5 sm:space-y-4">
              {/* 1. Título tipográfico em duas linhas */}
              <div className="mx-auto max-w-3xl text-center">
                <h2 className="space-y-0.5 sm:space-y-1 text-center">
                  <span className="block whitespace-nowrap leading-[1.08]">
                    <span className="font-display font-medium text-marrom-suave text-[clamp(1.08rem,4.4vw,1.9rem)] align-baseline">
                      Meu
                    </span>{' '}
                    <span className="font-delicate font-normal text-terracota-escuro text-[clamp(1.7rem,6.8vw,2.95rem)] leading-[0.82] align-baseline px-0.5">
                      coração
                    </span>{' '}
                    <span className="font-display font-medium text-marrom-suave text-[clamp(1.08rem,4.4vw,1.9rem)] align-baseline">
                      escolhe
                    </span>
                  </span>
                  <span className="block whitespace-nowrap leading-[1.08]">
                    <span className="font-delicate font-normal text-terracota-escuro text-[clamp(1.7rem,6.8vw,2.95rem)] leading-[0.82] align-baseline pr-0.5">
                      você
                    </span>{' '}
                    <span className="font-display font-medium text-marrom-suave text-[clamp(1.08rem,4.4vw,1.9rem)] align-baseline">
                      todos os dias.
                    </span>
                  </span>
                </h2>
              </div>

              {/* 2 & 3. Galeria interativa em carrossel 3D Coverflow + indicadores + legenda discreta */}
              <div className="space-y-1.5">
                <CoverflowGallery photos={coverflowPhotos} />
                <p className="text-center font-display text-xs sm:text-[13px] tracking-[0.06em] text-marrom-suave">
                  Fotos do Casal
                </p>
              </div>

              {/* 4. Quadro rotativo com mensagens aprovadas dos convidados */}
              <GuestbookSpotlight messages={approvedGuestbookMessages} />

              {/* 5. Botão centralizado: Mural de Recados */}
              <div className="flex justify-center pt-0.5">
                <Link
                  to="/recados"
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#963F28] bg-[#FFF8EF] px-7 py-3 text-xs sm:text-[13px] font-semibold tracking-[0.16em] text-[#963F28] uppercase shadow-sm transition-colors duration-[250ms] hover:bg-[#963F28] hover:text-[#FFF8EF]"
                >
                  <MessageSquareHeart className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Mural de Recados
                </Link>
              </div>

              {/* 6. Subseção Integrada — Categorias de Presentes dentro da mesma moldura */}
              <div className="border-t border-dourado/35 pt-5 sm:pt-6 space-y-4 sm:space-y-5">
                <div className="mx-auto max-w-4xl text-center">
                  <h3 className="font-display font-semibold text-marrom leading-[1.3] sm:leading-[1.25]">
                    <span className="block sm:inline text-[1.45rem] min-[375px]:text-[1.6rem] sm:text-[1.8rem] lg:text-[2rem] tracking-[0.02em] sm:tracking-[0.03em]">
                      Pequenos Gestos
                    </span>{' '}
                    <span className="block sm:inline-block font-delicate text-[2.2rem] min-[375px]:text-[2.45rem] sm:text-[2.75rem] lg:text-[3.15rem] font-normal tracking-normal text-terracota-escuro align-middle sm:mx-1.5 leading-[0.82] my-0.5 sm:my-0">
                      realizam
                    </span>{' '}
                    <span className="block sm:inline text-[1.2rem] min-[375px]:text-[1.35rem] sm:text-[1.6rem] lg:text-[1.85rem] tracking-[0.07em] sm:tracking-[0.09em] uppercase">
                      GRANDES SONHOS
                    </span>
                  </h3>
                  <p className="mx-auto mt-3 max-w-xl text-center text-[15px] sm:text-base italic leading-relaxed text-marrom-suave px-1">
                    “Sua presença é o nosso maior presente. Mas, se desejar nos presentear,
                    reunimos aqui alguns sonhos que queremos realizar juntos.”
                  </p>
                </div>

                {/* Carrossel horizontal responsivo de categorias reais */}
                <GiftCategoriesCarousel gifts={gifts} />

                {/* Botão destacado centralizado para a Lista Completa de Presentes */}
                <div className="flex justify-center pt-1">
                  <Link
                    to="/presentes"
                    className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-lg border border-[#873F2C] bg-[#873F2C] px-8 py-3.5 text-xs sm:text-[13px] font-semibold tracking-[0.16em] text-[#FFF9F0] uppercase shadow-md transition-all duration-[250ms] hover:bg-terracota hover:shadow-lg"
                  >
                    <Gift className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Quero Presentear
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>
    </div>
  );
};
