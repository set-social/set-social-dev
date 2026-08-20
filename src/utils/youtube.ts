/** Matches youtube.com/watch?v=, youtu.be/, youtube.com/embed/, and
 * youtube.com/shorts/ — the URL shapes people actually paste in. */
const YOUTUBE_ID_PATTERN =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function extractYoutubeVideoId(url: string): string | null {
  const match = url.trim().match(YOUTUBE_ID_PATTERN);
  return match ? match[1] : null;
}

export function isYoutubeUrl(url: string): boolean {
  return extractYoutubeVideoId(url) != null;
}

/** No API key required — this is YouTube's stable public thumbnail convention. */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
