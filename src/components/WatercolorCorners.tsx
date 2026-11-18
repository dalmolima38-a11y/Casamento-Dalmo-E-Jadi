import React from 'react';
import { WEDDING_ASSETS } from '../data/assets';

interface WatercolorCornerProps {
  variant?: 'hero' | 'section';
}

/**
 * Corner-anchored watercolor floral bouquets & botanical sprigs.
 * Uses radial corner masks + mix-blend-multiply so paper margins disappear seamlessly
 * on #FFF9F0 ivory cotton paper while keeping the center open and legible.
 */
export const WatercolorCorners: React.FC<WatercolorCornerProps> = ({ variant = 'hero' }) => {
  const isHero = variant === 'hero';

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[2] select-none ${
        isHero ? 'overflow-x-clip' : 'overflow-hidden'
      }`}
      aria-hidden="true"
    >
      {/* Top-Left Large Watercolor Sunflower Bouquet */}
      <img
        src={WEDDING_ASSETS.watercolorSunflowerTl}
        alt=""
        className={`absolute mix-blend-multiply object-contain animate-botanical-sway ${
          isHero
            ? '-left-8 -top-8 w-44 opacity-80 sm:-left-10 sm:-top-10 sm:w-72 sm:opacity-90 lg:-left-10 lg:-top-10 lg:w-[23rem]'
            : '-left-8 -top-8 w-36 opacity-65 sm:w-56 sm:opacity-80'
        }`}
        style={{
          maskImage: 'radial-gradient(ellipse at 18% 18%, black 42%, transparent 76%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 18% 18%, black 42%, transparent 76%)',
        }}
      />

      {/* Top-Right Smaller Botanical Sprig (Olive, Sage & Chamomile) */}
      <img
        src={WEDDING_ASSETS.watercolorBotanicalSprig}
        alt=""
        className={`absolute mix-blend-multiply object-contain ${
          isHero
            ? '-right-7 -top-6 w-32 rotate-[12deg] opacity-75 sm:-right-8 sm:-top-8 sm:w-52 sm:opacity-85 lg:w-64'
            : '-right-8 -top-8 w-28 rotate-[12deg] opacity-60 sm:w-44 sm:opacity-75'
        }`}
        style={{
          maskImage: 'radial-gradient(ellipse at 72% 24%, black 38%, transparent 74%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 72% 24%, black 38%, transparent 74%)',
        }}
      />

      {/* Bottom-Left Smaller Botanical Sprig */}
      <img
        src={WEDDING_ASSETS.watercolorBotanicalSprig}
        alt=""
        className={`absolute mix-blend-multiply object-contain ${
          isHero
            ? '-bottom-8 -left-8 w-32 -rotate-[145deg] opacity-70 sm:-bottom-8 sm:-left-8 sm:w-48 sm:opacity-85 lg:w-60'
            : 'hidden'
        }`}
        style={{
          maskImage: 'radial-gradient(ellipse at 26% 74%, black 38%, transparent 74%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 26% 74%, black 38%, transparent 74%)',
        }}
      />

      {/* Bottom-Right Large Watercolor Sunflower Bouquet */}
      <img
        src={WEDDING_ASSETS.watercolorSunflowerBr}
        alt=""
        className={`absolute mix-blend-multiply object-contain animate-botanical-sway ${
          isHero
            ? '-bottom-9 -right-9 w-48 opacity-80 sm:-bottom-10 sm:-right-10 sm:w-72 sm:opacity-92 lg:-bottom-10 lg:-right-10 lg:w-[24rem]'
            : '-bottom-8 -right-8 w-36 opacity-65 sm:w-56 sm:opacity-80'
        }`}
        style={{
          animationDelay: '1.8s',
          maskImage: 'radial-gradient(ellipse at 82% 82%, black 42%, transparent 76%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 82% 82%, black 42%, transparent 76%)',
        }}
      />
    </div>
  );
};
