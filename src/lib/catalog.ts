import raw from "../data/catalog.json";

export type Category = "film" | "serie" | "anime";

export interface Title {
  id: number;
  title: string;
  year: number | null;
  type: "movie" | "series";
  category: Category;
  anime: boolean;
  seasons: number | null;
  languages: string[];
  poster: string;
}

export const CATALOG = raw as Title[];

export const CATEGORY_LABEL: Record<Category | "all", string> = {
  all: "Tout",
  film: "Films",
  serie: "Séries",
  anime: "Animes",
};

export function countByCategory(category: Category | "all"): number {
  return category === "all" ? CATALOG.length : CATALOG.filter((t) => t.category === category).length;
}

/** Accent-insensitive search over title + year + id. */
export function searchTitles(query: string, list: Title[] = CATALOG): Title[] {
  const q = normalize(query.trim());
  if (!q) return list;
  if (/^\d+$/.test(q)) return list.filter((t) => String(t.id).includes(q) || String(t.year ?? "").includes(q));
  return list.filter((t) => normalize(t.title).includes(q));
}

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function findTitle(id: number): Title | undefined {
  return CATALOG.find((t) => t.id === id);
}

/** A deterministic "à la une" rotation: changes daily, no backend needed. */
export function dailyPicks(count = 3): Title[] {
  // Short titles only: the hero renders them in one oversized metal line.
  const pool = CATALOG.filter((t) => t.poster && (t.year ?? 0) >= 2000 && t.title.length <= 24);
  const seed = Math.floor(Date.now() / 86_400_000);
  const picks: Title[] = [];
  for (let i = 0; i < count * 4 && picks.length < count; i++) {
    const candidate = pool[(seed * 31 + i * 97) % pool.length];
    if (candidate && !picks.some((p) => p.id === candidate.id)) picks.push(candidate);
  }
  return picks;
}
