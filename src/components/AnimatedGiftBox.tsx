import React from 'react';

interface AnimatedGiftBoxProps {
  className?: string;
}

export const AnimatedGiftBox: React.FC<AnimatedGiftBoxProps> = ({ className = '' }) => {
  return (
    <div
      className={`animate-gift-box select-none pointer-events-auto inline-flex items-center justify-center ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 112 112"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full drop-shadow-[0_6px_12px_rgba(135,63,44,0.12)]"
      >
        <defs>
          <linearGradient id="giftIvoryBody" x1="20" y1="42" x2="92" y2="96" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFDF8" />
            <stop offset="60%" stopColor="#FFF5E6" />
            <stop offset="100%" stopColor="#F3E2CC" />
          </linearGradient>
          <linearGradient id="giftTerracottaLid" x1="16" y1="34" x2="96" y2="49" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9C4D38" />
            <stop offset="55%" stopColor="#873F2C" />
            <stop offset="100%" stopColor="#723322" />
          </linearGradient>
          <linearGradient id="giftGoldBow" x1="32" y1="14" x2="80" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#E9B94E" />
            <stop offset="50%" stopColor="#D4AF63" />
            <stop offset="100%" stopColor="#B88E46" />
          </linearGradient>
        </defs>

        {/* Subtle botanical sparkles */}
        <path
          d="M17 30C18.5 30 19.5 29 19.5 27.5C19.5 29 20.5 30 22 30C20.5 30 19.5 31 19.5 32.5C19.5 31 18.5 30 17 30Z"
          fill="#C6A46A"
          opacity="0.75"
        />
        <path
          d="M92 24C93.2 24 94 23.2 94 22C94 23.2 94.8 24 96 24C94.8 24 94 24.8 94 26C94 24.8 93.2 24 92 24Z"
          fill="#C6A46A"
          opacity="0.7"
        />

        {/* Soft ground shadow */}
        <ellipse cx="56" cy="97.5" rx="31" ry="4" fill="#873F2C" fillOpacity="0.1" />

        {/* Gift box base */}
        <rect
          x="22"
          y="47"
          width="68"
          height="47"
          rx="4"
          fill="url(#giftIvoryBody)"
          stroke="#873F2C"
          strokeWidth="1.6"
        />

        {/* Delicate shadow right under the lid */}
        <rect x="23" y="48" width="66" height="4" fill="#873F2C" fillOpacity="0.11" />

        {/* Vertical gold & terracotta ribbon on body */}
        <rect x="49" y="47" width="14" height="47" fill="#A65A43" />
        <rect x="52.5" y="47" width="7" height="47" fill="url(#giftGoldBow)" />
        <line x1="49" y1="47" x2="49" y2="94" stroke="#873F2C" strokeWidth="1.2" />
        <line x1="63" y1="47" x2="63" y2="94" stroke="#873F2C" strokeWidth="1.2" />

        {/* Gift box lid */}
        <rect
          x="17"
          y="35"
          width="78"
          height="13.5"
          rx="3.5"
          fill="url(#giftTerracottaLid)"
          stroke="#723322"
          strokeWidth="1.5"
        />
        {/* Vertical ribbon over lid */}
        <rect x="49.5" y="35" width="13" height="13.5" fill="url(#giftGoldBow)" stroke="#873F2C" strokeWidth="1.2" />

        {/* Delicate golden bow */}
        <path
          d="M55 34.5C47 21 31 18.5 29.5 26.5C28.2 33 41.5 36.2 54.5 34.8Z"
          fill="url(#giftGoldBow)"
          stroke="#873F2C"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="M57 34.5C65 21 81 18.5 82.5 26.5C83.8 33 70.5 36.2 57.5 34.8Z"
          fill="url(#giftGoldBow)"
          stroke="#873F2C"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {/* Inner bow folds */}
        <path d="M51 32.5C45 27.5 37 26.5 35.5 29" stroke="#FFF9F0" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <path d="M61 32.5C67 27.5 75 26.5 76.5 29" stroke="#FFF9F0" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />

        {/* Graceful ribbon tails */}
        <path
          d="M53.5 35.5C48.5 41.5 43.5 45.5 39.5 49.5L44.5 50.5L47.5 47.5"
          stroke="#C6A46A"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M58.5 35.5C63.5 41.5 68.5 45.5 72.5 49.5L67.5 50.5L64.5 47.5"
          stroke="#C6A46A"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Center knot */}
        <circle cx="56" cy="34.5" r="4.8" fill="url(#giftGoldBow)" stroke="#873F2C" strokeWidth="1.4" />
        <circle cx="54.8" cy="33.3" r="1.3" fill="#FFF9F0" opacity="0.75" />
      </svg>
    </div>
  );
};
