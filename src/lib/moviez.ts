/** Thin client for the Moviez API (https://api.moviez.ac). No API key: the API is open. */

export type MoviezLang = "vf" | "vo" | "vostfr" | "multi";

export const API_BASE = "https://api.moviez.ac";

/**
 * The player page goes through our own Worker: it serves Moviez's viewer with
 * the ad scripts stripped and relays `/api/v2/stream`, which refuses any other
 * origin (a plain iframe on a foreign site gets a 403 and no video). Set to an
 * empty string to fall back to the raw, ad-supported Moviez page.
 */
export const PLAYER_PROXY = "https://site-23c9d24b0ff64195bb28e22f1e3c60f2.freebuff.page";

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

/**
 * Build the player URL. Through the proxy the route is prefixed with `/p`:
 * `/p/<id>` for films, `/p/serie/<id>/<saison>/<épisode>` for series.
 */
export function playerUrl({ id, type, lang, season = 1, episode = 1, autoplay = true }: PlayerTarget): string {
  const params = new URLSearchParams();
  if (lang && lang !== "vf") params.set("lang", lang);
  if (autoplay) params.set("autoplay", "1");
  const route = type === "series" ? `serie/${id}/${season}/${episode}` : `${id}`;
  const query = params.toString();
  // Played straight from Moviez, on their own origin: the page reaches its own
  // API there, the video streams from their CDN, and none of it goes through our
  // hosted proxy — which is the only thing that had a daily request allowance.
  return `${API_BASE}/${route}${query ? `?${query}` : ""}`;
}

export interface MoviezStream {
  hls: string;
  duration: number | null;
}

/**
 * The source really has no file for this title: not an outage, and not a
 * signature that expired. Asking again returns the same void, so the player has
 * to say so instead of inviting a retry that can never succeed.
 */
export class NoStreamError extends Error {
  constructor(message = "Aucun flux pour ce titre") {
    super(message);
    this.name = "NoStream";
  }
}

/**
 * Play inside our own player.
 *
 * The player page carries a short-lived token (`window.P2.t`) that its stream
 * endpoint trades for a signed HLS URL — and that endpoint answers 403 to every
 * origin but its own, a header a browser cannot fake. So our Worker makes that
 * one request on the site's behalf; the playlist and every segment then come
 * straight from Moviez's CDN, which allows our origin. Playback therefore runs
 * on MetalFlix itself, with our controls and no ad page, and the hosted relay
 * only ever sees one request per playback instead of one per segment.
 */
export async function resolveStream(target: PlayerTarget & { signal?: AbortSignal }): Promise<MoviezStream> {
  const { signal, ...rest } = target;
  const page = await fetch(playerUrl({ ...rest, autoplay: false }), { signal });
  if (!page.ok) throw new Error(`Moviez a répondu ${page.status}`);

  const raw = /window\.P2\s*=\s*(\{.*?\})\s*;/.exec(await page.text())?.[1];
  const token = raw ? (JSON.parse(raw) as { t?: string }).t : "";
  if (!token) throw new Error("Jeton de lecture introuvable");

  const relay = await fetch(`${PLAYER_PROXY}/mz?t=${encodeURIComponent(token)}`, { signal });
  const body = await relay.text();
  if (!relay.ok) {
    // The relay answers "Aucun flux" when the title has no file at all; every
    // other failure is the relay itself and deserves a retry.
    if (/aucun flux/i.test(body)) throw new NoStreamError();
    throw new Error(`Relais ${relay.status}`);
  }
  const data = JSON.parse(body) as { hls?: string; duration?: number | null };
  if (!data.hls) throw new NoStreamError();

  return { hls: data.hls, duration: data.duration ?? null };
}

export const LANG_LABEL: Record<string, string> = {
  vf: "VF",
  vo: "VO",
  vostfr: "VOSTFR",
  multi: "MULTI",
  en: "EN",
  ja: "JA",
};

/** Anime-Sama is resolved by our own Worker: seasons/versions, then playback. */
export function animeSamaInfoUrl(slug: string): string {
  return `${PLAYER_PROXY}/as/info?slug=${encodeURIComponent(slug)}`;
}

export function animeSamaPlayerUrl({
  slug,
  saison,
  version,
  episode,
}: {
  slug: string;
  saison: string;
  version: string;
  episode: number;
}): string {
  return `${PLAYER_PROXY}/as/p/${encodeURIComponent(slug)}/${encodeURIComponent(saison)}/${encodeURIComponent(version)}/${episode}`;
}
