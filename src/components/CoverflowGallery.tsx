import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import { CoverflowPhoto } from '../types/wedding';

interface CoverflowGalleryProps {
  photos: CoverflowPhoto[];
}

function getShortestOffset(index: number, activeIndex: number, total: number): number {
  if (total <= 1) return 0;
  let diff = index - activeIndex;
  if (total === 2) {
    return diff === 0 ? 0 : diff > 0 ? 1 : -1;
  }
  if (diff > total / 2) diff -= total;
  if (diff < -total / 2) diff += total;
  return diff;
}

function getCoverflowDisplayUrl(imageUrl: string, variant: 'card' | 'lightbox'): string {
  if (imageUrl.startsWith('/images/coverflow/')) {
    const filename = imageUrl.slice('/images/coverflow/'.length);
    if (filename && !filename.includes('/') && !filename.includes('..')) {
      return `/api/media/coverflow/display/${encodeURIComponent(filename)}?variant=${variant}`;
    }
  }
  return imageUrl;
}

function getCoverflowFallbackUrl(imageUrl: string): string {
  const jsdMatch = /^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+\/[^/@]+)@([^/]+)\/(.+)$/.exec(
    imageUrl.trim()
  );
  if (jsdMatch) {
    return `https://raw.githubusercontent.com/${jsdMatch[1]}/${jsdMatch[2]}/${jsdMatch[3]}`;
  }
  return imageUrl;
}

export const CoverflowGallery: React.FC<CoverflowGalleryProps> = ({ photos }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [fallbackIds, setFallbackIds] = useState<Record<string, boolean>>({});
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const pointerStartX = useRef<number | null>(null);
  const pointerStartY = useRef<number | null>(null);
  const didDrag = useRef(false);

  const count = photos.length;

  useEffect(() => {
    if (count > 0 && activeIndex >= count) {
      setActiveIndex(0);
    }
  }, [count, activeIndex]);

  const goNext = useCallback(() => {
    if (count <= 1) return;
    setActiveIndex((prev) => (prev + 1) % count);
  }, [count]);

  const goPrev = useCallback(() => {
    if (count <= 1) return;
    setActiveIndex((prev) => (prev - 1 + count) % count);
  }, [count]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxOpen(false);
      } else if (e.key === 'ArrowRight') {
        goNext();
      } else if (e.key === 'ArrowLeft') {
        goPrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen, goNext, goPrev]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    pointerStartX.current = e.touches[0].clientX;
    pointerStartY.current = e.touches[0].clientY;
    didDrag.current = false;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (pointerStartX.current === null || pointerStartY.current === null) return;
    const endX = e.changedTouches[0]?.clientX ?? pointerStartX.current;
    const endY = e.changedTouches[0]?.clientY ?? pointerStartY.current;
    const dx = endX - pointerStartX.current;
    const dy = endY - pointerStartY.current;

    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy)) {
      didDrag.current = true;
      if (dx < 0) goNext();
      else goPrev();
    }
    pointerStartX.current = null;
    pointerStartY.current = null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    pointerStartX.current = e.clientX;
    pointerStartY.current = e.clientY;
    didDrag.current = false;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (pointerStartX.current === null) return;
    const dx = e.clientX - pointerStartX.current;
    if (Math.abs(dx) > 40) {
      didDrag.current = true;
      if (dx < 0) goNext();
      else goPrev();
    }
    pointerStartX.current = null;
    pointerStartY.current = null;
  };

  if (count === 0) {
    return (
      <div className="mx-auto flex h-48 max-w-md items-center justify-center rounded-xl border border-dourado/55 bg-creme/55 p-6 text-center">
        <p className="font-display text-lg italic text-marrom-suave">
          Em breve compartilharemos nossas lembranças especiais aqui.
        </p>
      </div>
    );
  }

  const activePhoto = photos[activeIndex] || photos[0];

  return (
    <div className="relative w-full select-none">
      {/* 3D Coverflow Stage */}
      <div
        className="relative mx-auto flex h-[210px] w-full items-center justify-center overflow-hidden sm:h-[300px] md:h-[355px] lg:h-[395px]"
        style={{ perspective: '1200px' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        role="region"
        aria-roledescription="carrossel 3D"
        aria-label="Galeria de lembranças do casal"
      >
        {/* Subtle Desktop Prev/Next Arrows */}
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              aria-label="Fotografia anterior"
              className="hidden sm:inline-flex absolute left-1 md:left-3 z-40 h-10 w-10 items-center justify-center rounded-full border border-dourado/75 bg-marfim/90 text-terracota-escuro shadow-sm backdrop-blur-xs hover:bg-creme transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Próxima fotografia"
              className="hidden sm:inline-flex absolute right-1 md:right-3 z-40 h-10 w-10 items-center justify-center rounded-full border border-dourado/75 bg-marfim/90 text-terracota-escuro shadow-sm backdrop-blur-xs hover:bg-creme transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        <div
          className="relative flex h-full w-full items-center justify-center"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {photos.map((photo, index) => {
            const diff = getShortestOffset(index, activeIndex, count);
            const absDiff = Math.abs(diff);
            const isCenter = diff === 0;

            let transform = 'translate3d(0, 0, -280px) scale(0.55)';
            let opacity = 0;
            let zIndex = 0;
            let pointerEvents: 'auto' | 'none' = 'none';

            if (isCenter) {
              transform = 'translate3d(0%, 0, 0px) rotateY(0deg) scale(1)';
              opacity = 1;
              zIndex = 30;
              pointerEvents = 'auto';
            } else if (absDiff === 1) {
              const dir = diff < 0 ? -1 : 1;
              transform = `translate3d(${dir * 58}%, 0, -135px) rotateY(${-dir * 32}deg) scale(0.8)`;
              opacity = 0.82;
              zIndex = 20;
              pointerEvents = 'auto';
            } else if (absDiff === 2 && count >= 4) {
              const dir = diff < 0 ? -1 : 1;
              transform = `translate3d(${dir * 102}%, 0, -245px) rotateY(${-dir * 42}deg) scale(0.64)`;
              opacity = 0.46;
              zIndex = 10;
              pointerEvents = 'auto';
            }

            const hasFailed = Boolean(failedIds[photo.id]);

            return (
              <div
                key={photo.id}
                style={{
                  transform,
                  opacity,
                  zIndex,
                  pointerEvents,
                  transition:
                    'transform 500ms cubic-bezier(0.22, 1, 0.36, 1), opacity 500ms ease',
                  willChange: 'transform, opacity',
                }}
                className="absolute w-[62%] max-w-[235px] sm:w-[330px] sm:max-w-none md:w-[410px] lg:w-[465px]"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (didDrag.current) {
                      didDrag.current = false;
                      return;
                    }
                    if (isCenter) {
                      setLightboxOpen(true);
                    } else {
                      setActiveIndex(index);
                    }
                  }}
                  aria-label={
                    isCenter
                      ? `Ampliar fotografia: ${photo.caption || `Lembrança ${index + 1}`}`
                      : `Selecionar fotografia ${index + 1}`
                  }
                  className={`group relative block w-full overflow-hidden rounded-lg border bg-[#FAF4EA] p-1 sm:p-1.5 text-left focus-visible:outline-none ${
                    isCenter
                      ? 'border-dourado shadow-[0_18px_36px_-14px_rgba(73,53,43,0.42),0_4px_12px_-4px_rgba(198,164,106,0.3)]'
                      : 'border-dourado/70 shadow-[0_10px_24px_-12px_rgba(73,53,43,0.28)]'
                  }`}
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[5px] bg-pergaminho/50">
                    {!hasFailed ? (
                      <img
                        src={
                          fallbackIds[photo.id]
                            ? getCoverflowFallbackUrl(photo.imageUrl)
                            : getCoverflowDisplayUrl(photo.imageUrl, 'card')
                        }
                        alt={photo.caption || `Lembrança de Dalmo & Jadi ${index + 1}`}
                        draggable={false}
                        decoding="async"
                        onError={() => {
                          if (!fallbackIds[photo.id]) {
                            setFallbackIds((prev) => ({ ...prev, [photo.id]: true }));
                          } else {
                            setFailedIds((prev) => ({ ...prev, [photo.id]: true }));
                          }
                        }}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-marrom-suave">
                        {photo.caption || 'Lembrança do casal'}
                      </div>
                    )}

                    {isCenter && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded bg-marrom/70 px-2 py-0.5 text-[10px] font-medium text-creme-claro opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      >
                        <Expand className="h-3 w-3" />
                        <span className="hidden sm:inline">Ampliar</span>
                      </span>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Subtle Active Caption */}
      {activePhoto?.caption && (
        <p className="mt-1.5 text-center font-display text-sm sm:text-base italic text-marrom-suave px-2">
          {activePhoto.caption}
        </p>
      )}

      {/* Position Indicators */}
      {count > 1 && (
        <div
          className="mt-3 flex items-center justify-center gap-2"
          role="tablist"
          aria-label="Indicadores de posição da galeria"
        >
          {photos.map((photo, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={photo.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Ir para fotografia ${index + 1}`}
                onClick={() => setActiveIndex(index)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  isActive
                    ? 'w-6 bg-terracota-escuro'
                    : 'w-2 bg-dourado/55 hover:bg-dourado'
                }`}
              />
            );
          })}
        </div>
      )}

      {/* Enlarged Lightbox Modal */}
      {lightboxOpen && activePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activePhoto.caption || 'Fotografia ampliada'}
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-marrom/85 p-3 sm:p-6 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-xl border border-dourado/80 bg-[#FAF4EA] p-3.5 sm:p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-dourado/30 pb-2.5">
              <div className="min-w-0">
                <p className="font-display text-lg sm:text-xl font-semibold text-marrom truncate">
                  {activePhoto.caption || 'Nossas lembranças'}
                </p>
                <p className="text-xs text-marrom-suave tabular-nums">
                  Fotografia {activeIndex + 1} de {count}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                aria-label="Fechar visualização ampliada"
                className="rounded-md border border-dourado/55 p-2 text-marrom hover:bg-pergaminho/70 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-marrom/10">
              <img
                src={
                  fallbackIds[`lb-${activePhoto.id}`]
                    ? getCoverflowFallbackUrl(activePhoto.imageUrl)
                    : getCoverflowDisplayUrl(activePhoto.imageUrl, 'lightbox')
                }
                alt={activePhoto.caption || 'Fotografia ampliada'}
                decoding="async"
                onError={() => {
                  if (!fallbackIds[`lb-${activePhoto.id}`]) {
                    setFallbackIds((prev) => ({ ...prev, [`lb-${activePhoto.id}`]: true }));
                  }
                }}
                className="max-h-[72vh] w-auto max-w-full object-contain"
              />

              {count > 1 && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    aria-label="Fotografia anterior"
                    className="absolute left-2.5 rounded-full border border-dourado/75 bg-[#FAF4EA]/90 p-2 text-marrom shadow hover:bg-[#FAF4EA]"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label="Próxima fotografia"
                    className="absolute right-2.5 rounded-full border border-dourado/75 bg-[#FAF4EA]/90 p-2 text-marrom shadow hover:bg-[#FAF4EA]"
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
