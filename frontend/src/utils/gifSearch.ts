export interface GifResult {
  id: string;
  url: string;
  preview: string;
  width: number;
  height: number;
}

const TENOR_API_KEY = import.meta.env.VITE_TENOR_API_KEY as string | undefined;

/**
 * Search for GIFs via the Tenor API v2.
 * Returns an empty array if no API key is configured.
 */
export async function searchGifs(query: string): Promise<GifResult[]> {
  if (!TENOR_API_KEY || !query.trim()) return [];

  const params = new URLSearchParams({
    q: query.trim(),
    key: TENOR_API_KEY,
    limit: '8',
    media_filter: 'tinygif,gif',
    contentfilter: 'medium',
  });

  try {
    const res = await fetch(`https://tenor.googleapis.com/v2/search?${params}`);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.results ?? []).map((r: any) => {
      const gif = r.media_formats?.gif ?? r.media_formats?.tinygif;
      const tiny = r.media_formats?.tinygif ?? r.media_formats?.gif;
      return {
        id: r.id,
        url: gif?.url ?? '',
        preview: tiny?.url ?? gif?.url ?? '',
        width: tiny?.dims?.[0] ?? 200,
        height: tiny?.dims?.[1] ?? 150,
      };
    }).filter((g: GifResult) => g.url);
  } catch {
    return [];
  }
}

/** Check whether the Tenor API key is configured. */
export function isGifSearchAvailable(): boolean {
  return !!TENOR_API_KEY;
}
