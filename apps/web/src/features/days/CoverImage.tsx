import { useState } from 'react';
import type { CoverPreset } from '@vital/dto';

export function CoverImage({
  src,
  preset,
  className = '',
  alt,
}: {
  src: string;
  preset: CoverPreset;
  className?: string;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  const fallback = `/days/${preset}.jpg`;
  const url = failed ? fallback : src;
  return (
    <img
      src={url}
      alt={alt}
      className={`object-cover ${className}`}
      onError={() => {
        if (!failed) setFailed(true);
      }}
    />
  );
}
