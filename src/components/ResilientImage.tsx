import React, { useEffect, useState } from 'react';
import { Flower2 } from 'lucide-react';

interface ResilientImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  sizes?: string;
}

export const ResilientImage: React.FC<ResilientImageProps> = ({
  src,
  alt,
  className = '',
  fallbackLabel,
  sizes = '(max-width: 640px) 480px, 800px',
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-pergaminho via-creme to-dourado/20 p-4 text-center text-marrom-suave ${className}`}
        role="img"
        aria-label={alt}
      >
        <Flower2 className="h-8 w-8 text-dourado/80 mb-2" />
        <span className="font-display text-sm italic">{fallbackLabel || alt}</span>
      </div>
    );
  }

  const localGiftMatch = /^\/images\/gifts\/([a-zA-Z0-9._-]+)$/.exec(src.trim());
  if (localGiftMatch) {
    const filename = encodeURIComponent(localGiftMatch[1]);
    return (
      <picture className="block h-full w-full">
        <source
          type="image/avif"
          srcSet={`/api/media/gifts/display/${filename}?format=avif&variant=mobile 480w, /api/media/gifts/display/${filename}?format=avif&variant=desktop 800w`}
          sizes={sizes}
        />
        <source
          type="image/webp"
          srcSet={`/api/media/gifts/display/${filename}?format=webp&variant=mobile 480w, /api/media/gifts/display/${filename}?format=webp&variant=desktop 800w`}
          sizes={sizes}
        />
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={className}
        />
      </picture>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
