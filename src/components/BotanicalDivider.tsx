import React from 'react';

interface BotanicalDividerProps {
  className?: string;
}

/**
 * Standardized section-transition divider: centered watercolor-styled sunflower
 * flanked by delicate antique-gold gradient lines with balanced breathing room.
 * Reserved strictly for transitions between main page sections.
 */
export const BotanicalDivider: React.FC<BotanicalDividerProps> = ({ className = '' }) => {
  return (
    <div
      className={`relative z-20 mx-auto flex max-w-4xl items-center justify-center gap-4 px-4 py-5 sm:py-7 ${className}`}
      aria-hidden="true"
    >
      <span className="h-px flex-1 max-w-[140px] sm:max-w-[220px] bg-gradient-to-r from-transparent via-dourado/55 to-dourado/90" />

      <svg
        width="54"
        height="34"
        viewBox="0 0 54 34"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        {/* Delicate sage & olive leaves flanking the sunflower */}
        <path
          d="M14 17C10.5 14 6.5 14.5 4.5 17C6.5 19.5 10.5 20 14 17Z"
          fill="#8D9A75"
          fillOpacity="0.85"
          stroke="#68734B"
          strokeWidth="0.7"
        />
        <path
          d="M40 17C43.5 14 47.5 14.5 49.5 17C47.5 19.5 43.5 20 40 17Z"
          fill="#8D9A75"
          fillOpacity="0.85"
          stroke="#68734B"
          strokeWidth="0.7"
        />
        <path
          d="M16.5 12.5C13.5 9.5 10.5 9 8.5 10.2C9.8 12.2 12.8 13.5 16.5 12.5Z"
          fill="#68734B"
          fillOpacity="0.7"
        />
        <path
          d="M37.5 21.5C40.5 24.5 43.5 25 45.5 23.8C44.2 21.8 41.2 20.5 37.5 21.5Z"
          fill="#68734B"
          fillOpacity="0.7"
        />

        {/* Golden watercolor sunflower petals */}
        {Array.from({ length: 14 }).map((_, idx) => {
          const angle = idx * (360 / 14);
          return (
            <ellipse
              key={idx}
              cx="27"
              cy="6.4"
              rx="2.2"
              ry="5.4"
              fill={idx % 2 === 0 ? '#E9B94E' : '#DDA230'}
              fillOpacity="0.92"
              stroke="#C6A46A"
              strokeWidth="0.45"
              transform={`rotate(${angle} 27 17)`}
            />
          );
        })}

        {/* Warm dark espresso seed center with subtle gold ring */}
        <circle cx="27" cy="17" r="5.3" fill="#49352B" stroke="#C6A46A" strokeWidth="0.9" />
        <circle cx="27" cy="17" r="3.2" fill="#6F4A34" fillOpacity="0.75" />
        <circle cx="25.6" cy="15.8" r="0.6" fill="#E9B94E" />
        <circle cx="28.3" cy="16.2" r="0.55" fill="#E9B94E" />
        <circle cx="26.8" cy="18.4" r="0.6" fill="#E9B94E" />
      </svg>

      <span className="h-px flex-1 max-w-[140px] sm:max-w-[220px] bg-gradient-to-l from-transparent via-dourado/55 to-dourado/90" />
    </div>
  );
};
