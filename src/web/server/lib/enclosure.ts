const AUDIO_EXT = /\.(mp3|m4a|m4b|ogg|oga|wav|aac|flac|opus)(\?|#|$)/i;

/**
 * Many RSS feeds attach non-audio resources (OGP images, etc.) via the
 * <enclosure> element. We only want to surface enclosures that are actually
 * playable audio — judged by MIME type prefix or URL extension.
 */
export function isAudioEnclosure(
  type: string | null | undefined,
  url: string | null | undefined
): boolean {
  if (!url) return false;
  if (type && type.toLowerCase().startsWith('audio/')) return true;
  return AUDIO_EXT.test(url);
}
