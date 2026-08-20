import { extractYoutubeVideoId, isYoutubeUrl, youtubeThumbnailUrl } from '../youtube';

describe('extractYoutubeVideoId', () => {
  it('parses a standard watch URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a shortened youtu.be URL', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses an embed URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a shorts URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses a watch URL with extra query params', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(extractYoutubeVideoId('https://vimeo.com/12345')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractYoutubeVideoId('')).toBeNull();
  });
});

describe('isYoutubeUrl', () => {
  it('is true for a valid link', () => {
    expect(isYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
  });

  it('is false for an invalid link', () => {
    expect(isYoutubeUrl('not a url')).toBe(false);
  });
});

describe('youtubeThumbnailUrl', () => {
  it('builds the stable public thumbnail URL', () => {
    expect(youtubeThumbnailUrl('dQw4w9WgXcQ')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });
});
