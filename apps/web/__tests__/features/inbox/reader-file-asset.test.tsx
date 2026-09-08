import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReaderFileAsset } from '@/features/inbox/ReaderFileAsset';
import type { InboxAsset } from '@vital/dto';

function asset(mime: string): InboxAsset {
  return {
    id: 'a1',
    attachmentId: 'att1',
    url: 'https://s3/x',
    originalSrc: 'x',
    sortOrder: 0,
    mime,
  };
}

describe('ReaderFileAsset', () => {
  it('renders video for video mime', () => {
    render(<ReaderFileAsset asset={asset('video/mp4')} />);
    expect(screen.getByTestId('reader-video').tagName).toBe('VIDEO');
  });

  it('renders iframe for pdf', () => {
    render(<ReaderFileAsset asset={asset('application/pdf')} />);
    expect(screen.getByTestId('reader-pdf').tagName).toBe('IFRAME');
  });

  it('renders audio for audio mime', () => {
    render(<ReaderFileAsset asset={asset('audio/mpeg')} />);
    expect(screen.getByTestId('reader-audio').tagName).toBe('AUDIO');
  });

  it('renders nothing for image mime', () => {
    const { container } = render(<ReaderFileAsset asset={asset('image/jpeg')} />);
    expect(container.firstChild).toBeNull();
  });
});
