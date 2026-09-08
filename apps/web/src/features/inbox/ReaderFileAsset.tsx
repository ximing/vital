import type { InboxAsset } from '@vital/dto';

/** Non-image assets the reader renders as standalone widgets (PDF / video / audio). */
export function isFileAsset(asset: InboxAsset): boolean {
  return (
    asset.mime === 'application/pdf' ||
    asset.mime.startsWith('video/') ||
    asset.mime.startsWith('audio/')
  );
}

/**
 * Inline-renders non-image file assets (PDF / video / audio) from a signed URL.
 * Image assets are handled by the reader article body and are ignored here.
 */
export function ReaderFileAsset({ asset }: { asset: InboxAsset }) {
  if (!isFileAsset(asset) || !asset.url) return null;

  if (asset.mime === 'application/pdf') {
    return (
      <iframe
        data-testid="reader-pdf"
        title={asset.originalSrc}
        src={asset.url}
        className="h-[70vh] w-full rounded-lg border border-border"
      />
    );
  }

  if (asset.mime.startsWith('video/')) {
    return (
      <video
        data-testid="reader-video"
        controls
        preload="metadata"
        src={asset.url}
        className="w-full rounded-lg border border-border"
      />
    );
  }

  if (asset.mime.startsWith('audio/')) {
    return (
      <audio
        data-testid="reader-audio"
        controls
        preload="metadata"
        src={asset.url}
        className="w-full"
      />
    );
  }

  return null;
}
