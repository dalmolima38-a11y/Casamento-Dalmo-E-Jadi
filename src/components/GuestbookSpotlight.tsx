import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import { GuestbookMessage } from '../types/wedding';

interface GuestbookSpotlightProps {
  messages: GuestbookMessage[];
}

const AUTO_ROTATE_MS = 4000;

const slideVariants = {
  enter: (direction: number) => ({
    x: direction >= 0 ? 52 : -52,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction >= 0 ? -52 : 52,
    opacity: 0,
  }),
};

export const GuestbookSpotlight: React.FC<GuestbookSpotlightProps> = ({ messages }) => {
  const shouldReduceMotion = useReducedMotion();
  const count = messages.length;

  const [[activeIndex, direction], setSlide] = useState<[number, number]>([0, 1]);
  const [isPaused, setIsPaused] = useState(false);
  const [interactionTick, setInteractionTick] = useState(0);

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  // Keep active index within bounds if messages update live via Firestore/moderação
  useEffect(() => {
    if (count === 0) {
      setSlide([0, 1]);
      return;
    }
    if (activeIndex >= count) {
      setSlide([0, 1]);
    }
  }, [count, activeIndex]);

  const goNext = useCallback(
    (manual = false) => {
      if (count <= 1) return;
      setSlide(([prev]) => [(prev + 1) % count, 1]);
      if (manual) {
        setInteractionTick((t) => t + 1);
      }
    },
    [count]
  );

  const goPrev = useCallback(
    (manual = false) => {
      if (count <= 1) return;
      setSlide(([prev]) => [(prev - 1 + count) % count, -1]);
      if (manual) {
        setInteractionTick((t) => t + 1);
      }
    },
    [count]
  );

  useEffect(() => {
    if (count <= 1 || isPaused) return;
    const timer = window.setInterval(() => {
      setSlide(([prev]) => [(prev + 1) % count, 1]);
    }, AUTO_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [count, isPaused, interactionTick]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsPaused(true);
    if (e.touches.length !== 1) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current !== null && touchStartY.current !== null && count > 1) {
      const endX = e.changedTouches[0]?.clientX ?? touchStartX.current;
      const endY = e.changedTouches[0]?.clientY ?? touchStartY.current;
      const dx = endX - touchStartX.current;
      const dy = endY - touchStartY.current;
      if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) goNext(true);
        else goPrev(true);
      }
    }
    touchStartX.current = null;
    touchStartY.current = null;
    setIsPaused(false);
    setInteractionTick((t) => t + 1);
  };

  const currentMessage = count > 0 ? messages[activeIndex % count] : null;

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => {
        setIsPaused(false);
        setInteractionTick((t) => t + 1);
      }}
      onFocus={() => setIsPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsPaused(false);
          setInteractionTick((t) => t + 1);
        }
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="region"
      aria-roledescription={count > 1 ? 'carrossel de recados' : undefined}
      aria-label="Recados dos convidados"
      className="relative mx-auto w-full md:w-[72%] lg:w-[68%] max-w-3xl rounded-xl border border-dourado/75 bg-gradient-to-b from-[#FFFDF9] to-[#FAF1E4]/85 px-4 py-4 sm:px-6 sm:py-5 shadow-[0_10px_28px_-16px_rgba(111,88,75,0.22)]"
    >
      {/* Ornamento decorativo com linhas douradas e coração acima do título */}
      <div className="mb-2.5 text-center">
        <div className="flex items-center justify-center gap-2.5" aria-hidden="true">
          <span className="h-px w-8 sm:w-10 bg-dourado/55" />
          <Heart className="h-3.5 w-3.5 text-terracota-escuro/85 fill-terracota/15" />
          <span className="h-px w-8 sm:w-10 bg-dourado/55" />
        </div>
        <h3 className="mt-1.5 font-display text-lg sm:text-xl font-semibold tracking-wide text-terracota-escuro leading-snug">
          Recadinho do Coração
        </h3>
      </div>

      {!currentMessage ? (
        <div className="px-2 py-1 text-center">
          <p className="font-display text-base sm:text-lg italic leading-relaxed text-marrom">
            “Deixe sua mensagem de carinho e faça parte da nossa história!”
          </p>
        </div>
      ) : (
        <div className="relative flex items-center">
          {count > 1 && (
            <button
              type="button"
              onClick={() => goPrev(true)}
              aria-label="Recado anterior"
              className="z-10 shrink-0 inline-flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full border border-dourado/55 bg-marfim/90 text-marrom-suave hover:border-dourado hover:text-terracota-escuro hover:bg-creme transition-colors"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          {/* Área de transição horizontal com altura adaptativa sem cortes */}
          <div className={`min-w-0 flex-1 overflow-hidden ${count > 1 ? 'px-2.5 sm:px-4' : 'px-2'}`}>
            <div className="grid grid-cols-1 grid-rows-1 items-center">
              <AnimatePresence initial={false} custom={direction}>
                <motion.div
                  key={currentMessage.id}
                  custom={direction}
                  variants={shouldReduceMotion ? undefined : slideVariants}
                  initial={shouldReduceMotion ? { opacity: 0 } : 'enter'}
                  animate={shouldReduceMotion ? { opacity: 1 } : 'center'}
                  exit={shouldReduceMotion ? { opacity: 0 } : 'exit'}
                  transition={{ duration: shouldReduceMotion ? 0.15 : 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="col-start-1 row-start-1 flex flex-col items-center justify-center text-center"
                >
                  <blockquote className="font-display text-base sm:text-lg lg:text-[1.18rem] italic leading-relaxed text-marrom break-words">
                    “{currentMessage.message}”
                  </blockquote>
                  <p className="mt-2.5 font-display text-sm sm:text-[15px] font-semibold tracking-wide text-terracota-escuro">
                    — {currentMessage.authorName}
                    {currentMessage.relationship ? (
                      <span className="font-normal text-marrom-suave">
                        {' '}
                        · {currentMessage.relationship}
                      </span>
                    ) : null}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {count > 1 && (
            <button
              type="button"
              onClick={() => goNext(true)}
              aria-label="Próximo recado"
              className="z-10 shrink-0 inline-flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full border border-dourado/55 bg-marfim/90 text-marrom-suave hover:border-dourado hover:text-terracota-escuro hover:bg-creme transition-colors"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* Indicadores discretos */}
      {count > 1 && (
        <div
          className="mt-3.5 flex items-center justify-center gap-1.5"
          role="tablist"
          aria-label="Indicadores de posição dos recados"
        >
          {messages.map((msg, idx) => {
            const isActive = idx === activeIndex % count;
            return (
              <button
                key={msg.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Ver recado ${idx + 1}`}
                onClick={() => {
                  setSlide([idx, idx >= activeIndex ? 1 : -1]);
                  setInteractionTick((t) => t + 1);
                }}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  isActive ? 'w-5 bg-terracota-escuro' : 'w-1.5 bg-dourado/55 hover:bg-dourado'
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
