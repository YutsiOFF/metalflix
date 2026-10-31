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

export function genresOf(mask: number): GenreKey[] {
  if (!mask) return [];
  return GENRE_ORDER.filter((_, index) => (mask & (1 << index)) !== 0);
}

/**
 * The 13k-title catalogue lives in its own chunk (~1 MB), so the shell paints
 * before it arrives instead of blocking the first render.
 */
export async function loadCatalog(): Promise<Title[]> {
  if (cached) return cached;
  const rows = (await import("../data/catalog.json")).default as CatalogRow[];
  cached = rows.map(([id, title, year, code, path, mask]) => {
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
  return cached;
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

/** Decades present in the catalogue, newest first. */
export function decadesOf(list: Title[]): number[] {
  const decades = new Set<number>();
  for (const item of list) if (item.year) decades.add(Math.floor(item.year / 10) * 10);
  return [...decades].sort((a, b) => b - a);
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

export const PAGE_SIZE = 60;
