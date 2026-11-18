import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

interface CountdownTimerProps {
  targetIso: string;
}

interface TimeRemaining {
  passed: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function calculateRemaining(targetIso: string): TimeRemaining {
  // Always compute against the exact Brasília timestamp (America/Sao_Paulo, UTC-03:00)
  const targetMs = new Date(targetIso).getTime();
  const nowMs = Date.now();
  if (Number.isNaN(targetMs)) {
    return { passed: false, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const diff = targetMs - nowMs;
  if (diff <= 0) {
    return { passed: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { passed: false, days, hours, minutes, seconds };
}

interface FlipUnitProps {
  value: number;
  label: string;
}

const FlipUnit: React.FC<FlipUnitProps> = ({ value, label }) => {
  const formatted = String(value).padStart(2, '0');
  const prevRef = useRef<string>(formatted);
  const [prevVal, setPrevVal] = useState<string>(formatted);
  const [flipKey, setFlipKey] = useState<number>(0);
  const [isFlipping, setIsFlipping] = useState<boolean>(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (formatted !== prevRef.current) {
      setPrevVal(prevRef.current);
      prevRef.current = formatted;
      if (!shouldReduceMotion) {
        setFlipKey((k) => k + 1);
        setIsFlipping(true);
        const timer = window.setTimeout(() => {
          setIsFlipping(false);
          setPrevVal(formatted);
        }, 460);
        return () => window.clearTimeout(timer);
      } else {
        setPrevVal(formatted);
      }
    }
  }, [formatted, shouldReduceMotion]);

  const digitStyle: React.CSSProperties = {
    fontSize: 'clamp(1.18rem, 4.4vw, 1.95rem)',
    lineHeight: 1,
  };

  return (
    <div className="flex min-w-0 flex-col items-center">
      <div
        style={{
          width: 'clamp(42px, 11.4vw, 62px)',
          height: 'clamp(46px, 12.6vw, 66px)',
        }}
        className="flip-perspective relative rounded-[7px] border border-dourado/75 bg-[#743423] shadow-[0_8px_18px_-8px_rgba(73,53,43,0.4),0_2px_4px_rgba(0,0,0,0.16)] select-none"
        aria-label={`${formatted} ${label}`}
      >
        {/* Static Upper Half (shows NEW value underneath during flip) */}
        <div className="absolute inset-x-0 top-0 z-[1] h-1/2 overflow-hidden rounded-t-[6px] bg-gradient-to-b from-[#984934] to-terracota-escuro">
          <div
            style={digitStyle}
            className="absolute inset-x-0 top-0 flex h-[200%] items-center justify-center font-display font-semibold text-creme tabular-nums"
          >
            {formatted}
          </div>
        </div>

        {/* Static Lower Half (shows PREV value until bottom flap lands) */}
        <div className="absolute inset-x-0 bottom-0 z-[1] h-1/2 overflow-hidden rounded-b-[6px] bg-gradient-to-b from-[#743423] to-[#652B1C]">
          <div
            style={digitStyle}
            className="absolute inset-x-0 bottom-0 flex h-[200%] items-center justify-center font-display font-semibold text-[#F1E2CA] tabular-nums"
          >
            {isFlipping ? prevVal : formatted}
          </div>
        </div>

        {/* Animated Top Flap (folds down from 0 to -90deg showing PREV value) */}
        {isFlipping && !shouldReduceMotion && (
          <div
            key={`top-${flipKey}`}
            className="animate-flip-top absolute inset-x-0 top-0 z-[3] h-1/2 overflow-hidden rounded-t-[6px] bg-gradient-to-b from-[#984934] to-terracota-escuro"
          >
            <div
              style={digitStyle}
              className="absolute inset-x-0 top-0 flex h-[200%] items-center justify-center font-display font-semibold text-creme tabular-nums"
            >
              {prevVal}
            </div>
          </div>
        )}

        {/* Animated Bottom Flap (unfolds from 90 to 0deg showing NEW value) */}
        {isFlipping && !shouldReduceMotion && (
          <div
            key={`bot-${flipKey}`}
            className="animate-flip-bottom absolute inset-x-0 bottom-0 z-[4] h-1/2 overflow-hidden rounded-b-[6px] bg-gradient-to-b from-[#743423] to-[#652B1C] shadow-[0_6px_12px_rgba(0,0,0,0.28)]"
          >
            <div
              style={digitStyle}
              className="absolute inset-x-0 bottom-0 flex h-[200%] items-center justify-center font-display font-semibold text-[#F1E2CA] tabular-nums"
            >
              {formatted}
            </div>
          </div>
        )}

        {/* Delicate 1px Center Seam only (lateral decorative notches removed) */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 z-[5] h-px -translate-y-1/2 bg-[#3E1A10]/60 shadow-[0_1px_0_rgba(250,244,234,0.14)]"
          aria-hidden="true"
        />
      </div>

      <span className="mt-1.5 font-display text-[9px] sm:text-[11px] font-semibold tracking-[0.04em] sm:tracking-[0.16em] text-marrom uppercase whitespace-nowrap">
        {label}
      </span>
    </div>
  );
};

export const CountdownTimer: React.FC<CountdownTimerProps> = ({ targetIso }) => {
  const [remaining, setRemaining] = useState<TimeRemaining>(() => calculateRemaining(targetIso));

  useEffect(() => {
    setRemaining(calculateRemaining(targetIso));
    const timer = window.setInterval(() => {
      setRemaining(calculateRemaining(targetIso));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [targetIso]);

  if (remaining.passed) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-dourado/65 bg-terracota-escuro px-6 py-5 text-center text-creme shadow-md">
        <p className="font-display text-2xl sm:text-3xl font-semibold text-creme">
          Celebramos o nosso Felizes para Sempre!
        </p>
        <p className="mt-1.5 text-sm text-creme/90">
          Obrigado por fazer parte deste dia abençoado por Deus. Compartilhe suas memórias na
          galeria colaborativa.
        </p>
      </div>
    );
  }

  return (
    <div
      className="mx-auto grid w-fit max-w-full grid-cols-4 items-start justify-center gap-1.5 sm:gap-2.5 md:gap-3"
      aria-label="Relógio de contagem regressiva para o casamento"
    >
      <FlipUnit value={remaining.days} label="Dias" />
      <FlipUnit value={remaining.hours} label="Horas" />
      <FlipUnit value={remaining.minutes} label="Minutos" />
      <FlipUnit value={remaining.seconds} label="Segundos" />
    </div>
  );
};
