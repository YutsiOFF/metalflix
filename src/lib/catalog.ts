export type Category = "film" | "serie" | "anime";

export type GenreKey =
  | "action"
  | "adventure"
  | "animation"
  | "comedy"
  | "crime"
  | "documentary"
  | "drama"
  | "family"
  | "fantasy"
  | "history"
  | "horror"
  | "music"
  | "mystery"
  | "romance"
  | "scifi"
  | "thriller"
  | "war"
  | "western";

/** Bit order must match scripts/genres.mjs. */
export const GENRE_ORDER: GenreKey[] = [
  "action",
  "adventure",
  "animation",
  "comedy",
  "crime",
  "documentary",
  "drama",
  "family",
  "fantasy",
  "history",
  "horror",
  "music",
  "mystery",
  "romance",
  "scifi",
  "thriller",
  "war",
  "western",
];

export const GENRE_LABEL: Record<GenreKey, string> = {
  action: "Action",
  adventure: "Aventure",
  animation: "Animation",
  comedy: "Comédie",
  crime: "Crime",
  documentary: "Documentaire",
  drama: "Drame",
  family: "Familial",
  fantasy: "Fantastique",
  history: "Histoire",
  horror: "Horreur",
  music: "Musique",
  mystery: "Mystère",
  romance: "Romance",
  scifi: "Science-fiction",
  thriller: "Thriller",
  war: "Guerre",
  western: "Western",
};

/** Where a title streams, in France. Bit order matches scripts/providers.mjs. */
export type PlatformKey = "netflix" | "prime" | "disney" | "paramount" | "canal" | "appletv";

export const PLATFORM_ORDER: PlatformKey[] = ["netflix", "prime", "disney", "paramount", "canal", "appletv"];

export const PLATFORM_LABEL: Record<PlatformKey, string> = {
  netflix: "Netflix",
  prime: "Prime Video",
  disney: "Disney+",
  paramount: "Paramount+",
  canal: "Canal+",
  appletv: "Apple TV+",
};

export interface Title {
  id: number;
  title: string;
  /**
   * The title the API carries when it differs from the French one ("Tangled"
   * for Raiponce). Search matches both, display only uses `title`.
   */
  alt?: string;
  year: number;
  type: "movie" | "series";
  category: Category;
  anime: boolean;
  poster: string;
  genres: GenreKey[];
  /** Subscription services carrying it in France; empty when none of ours does. */
  platforms: PlatformKey[];
  /** Where playback comes from: Moviez by TMDB id, or Anime-Sama by slug. */
  source: "moviez" | "animesama";
  slug?: string;
  /** Real release date (YYYY-MM-DD) when it is known, so `year` is never a guess. */
  date?: string;
  /** Announced but not out yet: it has no date, and belongs in no "nouveauté". */
  pending?: boolean;
  /** Picked up from the API after the build: its date has not been checked. */
  fresh?: boolean;
}

/** Compact rows from the build: [tmdbId, title, year, code, posterPath, genreMask, platformMask, alias?]. */
export type CatalogRow = [number, string, number, 0 | 1 | 2, string, number, number, string?];

/** Anime-Sama only: [id, title, slug, cover]. No TMDB id, no release year. */
export type AnimeSamaRow = [number, string, string, string];

import { API_BASE } from "./moviez";
// Release dates verified against TMDB (scripts/release-dates.mjs). The API's
// year for an announced title is a projection, which is how a film nobody has
// seen ended up in "Nouveautés" with a date that did not exist.
import releaseData from "../data/releases.json";
import topData from "../data/top.json";

const RELEASES = releaseData as { dates?: Record<string, string>; pending?: string[] };
const RELEASE_DATES = RELEASES.dates ?? {};
// Keys carry the type (`0:550` is the film, `1:550` the series): TMDB uses the
// same number in two separate id spaces.
const PENDING_KEYS = new Set(RELEASES.pending ?? []);
const TODAY = new Date().toISOString().slice(0, 10);

const POSTER_BASE = "https://image.tmdb.org/t/p/w500/";
const CATEGORIES: Category[] = ["film", "serie", "anime"];

let cached: Title[] | null = null;
let rest: Promise<void> | null = null;

export function genresOf(mask: number): GenreKey[] {
  if (!mask) return [];
  return GENRE_ORDER.filter((_, index) => (mask & (1 << index)) !== 0);
}

export function platformsOf(mask: number): PlatformKey[] {
  if (!mask) return [];
  return PLATFORM_ORDER.filter((_, index) => (mask & (1 << index)) !== 0);
}

function toTitles(rows: CatalogRow[]): Title[] {
  return rows.map(([id, title, rowYear, code, path, mask, platformMask, alt]) => {
    const category = CATEGORIES[code] ?? "film";
    const key = `${code}:${id}`;
    const date = RELEASE_DATES[key];
    const year = date ? Number(date.slice(0, 4)) || rowYear : rowYear;
    return {
      id,
      title,
      alt,
      year,
      date: date || undefined,
      pending: PENDING_KEYS.has(key) || undefined,
      category,
      type: category === "film" ? "movie" : "series",
      anime: category === "anime",
      poster: path ? `${POSTER_BASE}${path}` : "",
      genres: genresOf(mask ?? 0),
      platforms: platformsOf(platformMask ?? 0),
      source: "moviez",
    } satisfies Title;
  });
}

/** Titles the Moviez catalogue does not carry, played through our Worker. */
function toAnimeSama(rows: AnimeSamaRow[]): Title[] {
  return rows.map(([id, title, slug, cover]) => ({
    id,
    title,
    year: 0,
    category: "anime",
    type: "series",
    anime: true,
    poster: cover,
    genres: [],
    platforms: [],
    source: "animesama",
    slug,
  }));
}

/**
 * The catalogue is split in two chunks: this one carries the ~14 000 titles the
 * rails and the default sort show (recognisable first, then newest), so the
 * shell paints on it instead of waiting for the whole 46k-row file.
 */
export async function loadCatalog(): Promise<Title[]> {
  if (cached) return cached;
  const rows = (await import("../data/catalog.json")).default as CatalogRow[];
  cached = toTitles(rows);
  return cached;
}

/**
 * The deep catalogue — every film the API serves, back to the silents — rides a
 * second chunk fetched right after the first paint, then widens the counts and
 * the search. `onMerged` receives the complete list once it is there.
 */
export async function loadRestCatalog(onMerged: (list: Title[]) => void): Promise<void> {
  if (rest) return rest;
  rest = (async () => {
    const rows = (await import("../data/catalog-rest.json")).default as CatalogRow[];
    const base = cached ?? (await loadCatalog());
    // Anime-Sama's own catalogue rides along: those titles have no stream in
    // Moviez, and our Worker plays them without a single ad script.
    const animeSama = toAnimeSama((await import("../data/animesama.json")).default as AnimeSamaRow[]);
    cached = [...base, ...toTitles(rows), ...animeSama];
    onMerged(cached);
  })();
  return rest;
}

/** The rows `/api/browse` returns: no genre, no anime flag, just the basics. */
interface BrowseItem {
  kind: string;
  poster: string;
  source_id: number;
  title: string;
  year: number;
}

const FRESH_KEY = "metalflix:fresh";
const FRESH_TTL = 30 * 60 * 1000;
/** 120 rows a page; the first pages are where the API puts what it just added. */
const BROWSE_PAGES = 3;

let freshCache: { at: number; items: BrowseItem[] } | null = null;

/** The first pages of both browse lists, kept for half an hour per tab. */
async function readBrowse(): Promise<BrowseItem[]> {
  if (freshCache && Date.now() - freshCache.at < FRESH_TTL) return freshCache.items;
  try {
    const stored = JSON.parse(sessionStorage.getItem(FRESH_KEY) ?? "null");
    if (stored && Array.isArray(stored.items) && Date.now() - stored.at < FRESH_TTL) {
      freshCache = stored;
      return stored.items;
    }
  } catch {
    // Storage blocked (private mode): ask the API on every load instead.
  }

  const offsets = Array.from({ length: BROWSE_PAGES }, (_, index) => index * 120);
  const pages = await Promise.all(
    (["movie", "tv"] as const).flatMap((kind) =>
      offsets.map((offset) =>
        fetch(`${API_BASE}/api/browse?kind=${kind}&limit=120&offset=${offset}`)
          .then((res) => (res.ok ? (res.json() as Promise<{ items?: BrowseItem[] }>) : null))
          .then((data) => data?.items ?? [])
          .catch(() => [] as BrowseItem[]),
      ),
    ),
  );

  const items = pages.flat();
  if (items.length) {
    freshCache = { at: Date.now(), items };
    try {
      sessionStorage.setItem(FRESH_KEY, JSON.stringify(freshCache));
    } catch {
      // Quota or private mode: the in-memory copy is enough.
    }
  }
  return items;
}

/** Fresh additions first, everything else untouched, no duplicate ids. */
export function mergeTitles(base: Title[], extra: Title[]): Title[] {
  if (!extra.length) return base;
  const ids = new Set(base.map((item) => item.id));
  const added = extra.filter((item) => !ids.has(item.id));
  return added.length ? [...added, ...base] : base;
}

/**
 * What the API gained since the catalogue file was built.
 *
 * Nothing prompts a rebuild: the catalogue is a snapshot written at build time
 * and GitHub Pages only serves files. `/api/browse` is CORS-open, so the site
 * reads its first pages on load and merges whatever it has never seen — a film,
 * a series or an anime added today shows up in the hero and the "Nouveautés"
 * rows without waiting for the next deploy. Those rows carry no genre and no
 * anime flag, so a brand-new title settles in Films or Séries until the next
 * build tags it properly.
 */
export async function loadFreshAdditions(): Promise<Title[]> {
  const known = cached ?? (await loadCatalog());
  const items = await readBrowse();
  if (!items.length) return [];

  const knownIds = new Set(known.map((item) => item.id));
  const added: Title[] = [];
  for (const item of items) {
    const id = Number(item.source_id);
    if (!id || knownIds.has(id) || !item.poster || !item.year || !item.title) continue;
    knownIds.add(id);
    const series = item.kind === "tv";
    added.push({
      id,
      title: item.title,
      year: item.year,
      category: series ? "serie" : "film",
      type: series ? "series" : "movie",
      anime: false,
      poster: item.poster,
      genres: [],
      platforms: [],
      source: "moviez",
      fresh: true,
    });
  }

  if (!added.length) return [];
  added.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title, "fr"));
  cached = mergeTitles(cached ?? known, added);
  return added;
}

export const CATEGORY_LABEL: Record<Category | "all", string> = {
  all: "Tout",
  film: "Films",
  serie: "Séries",
  anime: "Animes",
};

export function countByCategory(list: Title[], category: Category | "all"): number {
  return category === "all" ? list.length : list.filter((item) => item.category === category).length;
}

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function searchTitles(query: string, list: Title[]): Title[] {
  const q = normalize(query.trim());
  if (!q) return list;
  if (/^\d+$/.test(q)) return list.filter((t) => String(t.id).includes(q) || String(t.year).includes(q));
  return list.filter((t) => normalize(t.title).includes(q) || (t.alt ? normalize(t.alt).includes(q) : false));
}

export function findTitle(list: Title[], id: number): Title | undefined {
  return list.find((item) => item.id === id);
}

/**
 * Years present in the catalogue, newest first. Grouping by decade hid the
 * current one behind a label that ends in 0, so the newest year looked missing.
 */
export function yearsOf(list: Title[]): { year: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const item of list) if (item.year) counts.set(item.year, (counts.get(item.year) ?? 0) + 1);
  return [...counts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => b.year - a.year);
}

/**
 * The hero is the shop window for what just came out: the banner only draws
 * from the newest release year available, widening one year at a time when the
 * API has not filled it yet. The catalogue is sorted notability-first, so the
 * pool has to be built from the years, not from the head of the list — that head
 * is where the 1994 classics live. The day number offsets the window, so the
 * selection turns over daily without ever leaving the newest films.
 */
export function dailyPicks(list: Title[], count: number): Title[] {
  const currentYear = new Date().getFullYear();
  // Only titles that have already come out, and long enough names to fit.
  const playable = list.filter(
    (t) =>
      t.poster &&
      !t.pending &&
      (!t.date || t.date <= TODAY) &&
      t.year >= 1975 &&
      t.year <= currentYear &&
      t.title.length <= 34,
  );

  let pool: Title[] = [];
  for (let year = currentYear; year >= currentYear - 3; year--) {
    pool = playable.filter((t) => t.year >= year);
    if (pool.length >= count * 3) break;
  }
  if (pool.length < count) {
    // Nothing recent enough at all (a very fresh build): fall back to the
    // newest titles there are instead of showing the old head of the list.
    pool = [...playable].sort((a, b) => b.year - a.year).slice(0, count * 4);
  }
  if (!pool.length) return list.slice(0, count);

  pool.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title, "fr"));
  const start = Math.floor(Date.now() / 86_400_000) % pool.length;
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(start + i) % pool.length]);
}

// -------------------------------------------------------------------- top note
// Written by scripts/top-rated.mjs: recent films, best rated on TMDB, kept only
// when the catalogue carries them. The site reads it at build time, so the order
// ships with the bundle instead of costing a request.
const TOP_IDS: number[] = (topData as { ids?: number[] }).ids ?? [];
const TOP_NOTES: Record<string, number> = (topData as { notes?: Record<string, number> }).notes ?? {};

/** TMDB note of a ranked film, or null when the title is not in the list. */
export function topNote(id: number): number | null {
  const note = TOP_NOTES[String(id)];
  return typeof note === "number" ? note : null;
}

/**
 * « Top des films aujourd'hui » : les films sortis récemment, les mieux notés
 * d'abord. Falls back to the newest films when the dataset has not been built.
 */
export function ratedTop(list: Title[], count: number): Title[] {
  if (!TOP_IDS.length) return dailyPicks(list, count);
  const films = new Map<number, Title>();
  // No anime here either: that shelf has its own rows.
  for (const item of list) if (item.category === "film" && !item.anime) films.set(item.id, item);
  const picked: Title[] = [];
  for (const id of TOP_IDS) {
    const item = films.get(id);
    if (!item) continue;
    picked.push(item);
    if (picked.length === count) break;
  }
  return picked.length ? picked : dailyPicks(list, count);
}

export const PAGE_SIZE = 72;
