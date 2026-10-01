import { COVER_PRESETS, type CoverPreset } from '@vital/dto';
import { useState } from 'react';

const PRESET_COVER = /\/days\/([a-z]+)\.jpg(?:[?#].*)?$/;

/** List rows and chips use a small file. The hero and the editor keep the original. */
export function coverImageSrc(src: string, preset: CoverPreset, size: 'thumb' | 'full'): string {
  const full = src || `/days/${preset}.jpg`;
  if (size === 'full') return full;
  const name = PRESET_COVER.exec(full)?.[1];
  if (name && (COVER_PRESETS as readonly string[]).includes(name)) return `/days/thumbs/${name}.webp`;
  return full;
}

export function CoverImage({
  src,
  preset,
  size = 'full',
  className = '',
  alt,
}: {
  src: string;
  preset: CoverPreset;
  size?: 'thumb' | 'full';
  className?: string;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  const full = src || `/days/${preset}.jpg`;
  const url = failed ? full : coverImageSrc(src, preset, size);
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
