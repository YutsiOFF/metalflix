/** Thin client for the Moviez API (https://api.moviez.ac). No API key: the API is open. */

export type MoviezLang = "vf" | "vo" | "vostfr" | "multi";

export const API_BASE = "https://api.moviez.ac";

export interface MoviezCheck {
  available: boolean;
  detectedType?: "movie" | "series";
  embed?: string;
  languages?: string[];
  poster?: string;
  title?: string;
  year?: number;
  tmdb_id?: number;
  seasons?: number;
  anime?: boolean;
}

/**
 * `/api/check/<id>` is the source of truth: is this title playable, is it a film
 * or a series, and which audio languages actually exist right now.
 */
export async function checkTitle(tmdbId: number, signal?: AbortSignal): Promise<MoviezCheck> {
  const res = await fetch(`${API_BASE}/api/check/${tmdbId}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Moviez a répondu ${res.status}`);
  return (await res.json()) as MoviezCheck;
}

export interface PlayerTarget {
  id: number;
  type: "movie" | "series";
  lang: MoviezLang;
  season?: number;
  episode?: number;
  autoplay?: boolean;
}

/** Build the player URL. Films: `/<id>`, series: `/serie/<id>/<saison>/<épisode>`. */
export function playerUrl({ id, type, lang, season = 1, episode = 1, autoplay = true }: PlayerTarget): string {
  const params = new URLSearchParams();
  if (lang && lang !== "vf") params.set("lang", lang);
  if (autoplay) params.set("autoplay", "1");
  const path = type === "series" ? `/serie/${id}/${season}/${episode}` : `/${id}`;
  const query = params.toString();
  return `${API_BASE}${path}${query ? `?${query}` : ""}`;
}

export const LANG_LABEL: Record<string, string> = {
  vf: "VF",
  vo: "VO",
  vostfr: "VOSTFR",
  multi: "MULTI",
  en: "EN",
  ja: "JA",
};
