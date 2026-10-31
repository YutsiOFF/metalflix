export type Category = "film" | "serie" | "anime";

export interface Title {
  id: number;
  title: string;
  year: number;
  type: "movie" | "series";
  category: Category;
  anime: boolean;
  poster: string;
}

/** Compact rows from the build: [tmdbId, title, year, code, posterPath]. */
export type CatalogRow = [number, string, number, 0 | 1 | 2, string];

const POSTER_BASE = "https://image.tmdb.org/t/p/w500/";
const CATEGORIES: Category[] = ["film", "serie", "anime"];

let cached: Title[] | null = null;

/**
 * The 13k-title catalogue lives in its own chunk (~1 MB), so the shell paints
 * before it arrives instead of blocking the first render.
 */
export async function loadCatalog(): Promise<Title[]> {
  if (cached) return cached;
  const rows = (await import("../data/catalog.json")).default as CatalogRow[];
  cached = rows.map(([id, title, year, code, path]) => {
    const category = CATEGORIES[code] ?? "film";
    return {
      id,
      title,
      year,
      category,
      type: category === "film" ? "movie" : "series",
      anime: category === "anime",
      poster: path ? `${POSTER_BASE}${path}` : "",
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

/** A deterministic daily pick from the most recognisable titles. */
export function dailyPick(list: Title[]): Title {
  const pool = list.filter((t) => t.title.length <= 24 && t.year >= 1990).slice(0, 120);
  return pool[Math.floor(Date.now() / 86_400_000) % Math.max(pool.length, 1)] ?? list[0];
}

export const PAGE_SIZE = 60;
