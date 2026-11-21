/**
 * Wide artwork for the hero.
 *
 * Moviez only stores a portrait poster, and cropping one into a banner cuts
 * faces in half. Its viewer page (/<tmdb id>) does carry the film's 16:9
 * backdrop from TMDB, so the hero reads that page — six small requests, cached
 * for the session — and falls back to the poster when a title has none.
 */

const CACHE_KEY = "metalflix.backdrops";
const VIEWER = "https://api.moviez.ac/";
const IMAGE = /image\.tmdb\.org\/t\/p\/w\d+\/([\w-]+\.(?:jpg|jpeg|png|webp))/i;

type Cache = Record<string, string>;

function readCache(): Cache {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "{}") as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Private mode: the poster fallback keeps the hero whole.
  }
}

async function backdropOf(id: number, series = false): Promise<string> {
  // A series has its own TMDB id space: /<id> could be the film with the same
  // number, so its still is read from the episode viewer instead.
  const path = series ? `serie/${id}/1/1` : String(id);
  const res = await fetch(`${VIEWER}${path}`, { headers: { accept: "text/html" } });
  if (!res.ok) return "";
  const match = IMAGE.exec(await res.text());
  return match ? `https://image.tmdb.org/t/p/original/${match[1]}` : "";
}

/** TMDB id → backdrop URL, empty string when the title has none. */
export async function loadBackdrops(ids: number[], series = false): Promise<Cache> {
  const cache = readCache();
  const keyOf = (id: number) => (series ? `s:${id}` : String(id));
  const pending = ids.filter((id) => !(keyOf(id) in cache));
  if (!pending.length) return pick(cache, ids, keyOf);

  try {
    const found = await Promise.all(
      pending.map(async (id) => {
        try {
          return [keyOf(id), await backdropOf(id, series)] as const;
        } catch {
          return [keyOf(id), ""] as const;
        }
      }),
    );
    for (const [key, url] of found) cache[key] = url;
    writeCache(cache);
  } catch {
    // Offline or blocked: the poster still fills the hero.
  }

  return pick(cache, ids, keyOf);
}

function pick(cache: Cache, ids: number[], keyOf: (id: number) => string): Cache {
  const found: Cache = {};
  for (const id of ids) {
    const url = cache[keyOf(id)];
    if (url) found[String(id)] = url;
  }
  return found;
}
