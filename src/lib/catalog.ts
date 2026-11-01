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

export interface Title {
  id: number;
  title: string;
  year: number;
  type: "movie" | "series";
  category: Category;
  anime: boolean;
  poster: string;
  genres: GenreKey[];
}

/** Compact rows from the build: [tmdbId, title, year, code, posterPath, genreMask?]. */
export type CatalogRow = [number, string, number, 0 | 1 | 2, string, number?];

const POSTER_BASE = "https://image.tmdb.org/t/p/w500/";
const CATEGORIES: Category[] = ["film", "serie", "anime"];

let cached: Title[] | null = null;
let rest: Promise<void> | null = null;

export function genresOf(mask: number): GenreKey[] {
  if (!mask) return [];
  return GENRE_ORDER.filter((_, index) => (mask & (1 << index)) !== 0);
}

function toTitles(rows: CatalogRow[]): Title[] {
  return rows.map(([id, title, year, code, path, mask]) => {
    const category = CATEGORIES[code] ?? "film";
    return {
      id,
      title,
      year,
      category,
      type: category === "film" ? "movie" : "series",
      anime: category === "anime",
      poster: path ? `${POSTER_BASE}${path}` : "",
      genres: genresOf(mask ?? 0),
    } satisfies Title;
  });
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
    cached = [...base, ...toTitles(rows)];
    onMerged(cached);
  })();
  return rest;
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
  return list.filter((t) => normalize(t.title).includes(q));
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
 * The hero rotates through a handful of recognisable titles: the catalogue is
 * sorted notability-first, so the head of the list is the right pool. The day
 * number offsets the window, so the selection turns over daily.
 */
export function dailyPicks(list: Title[], count: number): Title[] {
  const pool = list.filter((t) => t.poster && t.year >= 1975 && t.title.length <= 34).slice(0, 90);
  if (!pool.length) return list.slice(0, count);
  const start = Math.floor(Date.now() / 86_400_000) % pool.length;
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(start + i * 3) % pool.length]);
}

export const PAGE_SIZE = 72;
