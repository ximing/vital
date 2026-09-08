import { describe, expect, it } from 'vitest';
import { fileKindOf, fileModeFromResponse } from '../src/file-kind.js';

describe('fileKindOf', () => {
  it('maps direct-link extensions', () => {
    expect(fileKindOf('https://ex.com/a/report.pdf')).toBe('pdf');
    expect(fileKindOf('https://ex.com/v/clip.mp4?t=3')).toBe('video');
    expect(fileKindOf('https://ex.com/v/clip.MOV')).toBe('video');
    expect(fileKindOf('https://ex.com/a/song.flac')).toBe('audio');
    expect(fileKindOf('https://ex.com/a/page.html')).toBeNull();
    expect(fileKindOf('https://ex.com/a.png')).toBeNull(); // images stay article-mode
  });
});

describe('fileModeFromResponse', () => {
  it('accepts pdf/video/audio mime with known size within 5GB', () => {
    expect(fileModeFromResponse('https://ex.com/a.pdf', 'application/pdf', 123)).toEqual({
      url: 'https://ex.com/a.pdf', mime: 'application/pdf', size: 123,
    });
    expect(fileModeFromResponse('https://ex.com/a.mp4', 'video/mp4; charset=binary', 500)).toEqual({
      url: 'https://ex.com/a.mp4', mime: 'video/mp4', size: 500,
    });
  });

  it('rejects html, images, unknown mime, unknown length, and oversized', () => {
    expect(fileModeFromResponse('https://ex.com/a', 'text/html', 100)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.jpg', 'image/jpeg', 100)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a', 'application/x-msdownload', 100)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.pdf', 'application/pdf', null)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.mp4', 'video/mp4', 5 * 1024 ** 3 + 1)).toBeNull();
  });

  it('rejects text mimes (.mp4 URL serving text/plain stays article-mode)', () => {
    expect(fileModeFromResponse('https://ex.com/a.mp4', 'text/plain', 100)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.md', 'text/markdown', 100)).toBeNull();
  });

  it('rejects mimes outside the upload whitelist (stricter than the video/audio prefix)', () => {
    expect(fileModeFromResponse('https://ex.com/a.avi', 'video/avi', 100)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.wav', 'audio/x-wav', 100)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.pdf', 'application/x-pdf', 100)).toBeNull();
  });

  it('rejects non-finite content lengths (NaN from malformed headers)', () => {
    expect(fileModeFromResponse('https://ex.com/a.pdf', 'application/pdf', Number.NaN)).toBeNull();
    expect(fileModeFromResponse('https://ex.com/a.pdf', 'application/pdf', 0)).toBeNull();
  });
});
