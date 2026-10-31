/**
 * Per-profile watch history and watchlist, stored on the device.
 *
 * Entries keep a snapshot of the title (poster, year, kind) so the lists still
 * render for a TMDB id that is not in the bundled catalogue.
 */
import type { Category, Title } from "./catalog";

export interface LibraryItem {
  id: number;
  title: string;
  poster: string | null;
  year: number | null;
  type: "movie" | "series";
  category: Category;
  at: number;
}

export interface HistoryEntry extends LibraryItem {
  season?: number;
  episode?: number;
}

export interface Library {
  history: HistoryEntry[];
  watchlist: LibraryItem[];
}

export const EMPTY_LIBRARY: Library = { history: [], watchlist: [] };

const MAX_HISTORY = 300;

function key(profileId: string) {
  return `metalflix.library.${profileId}`;
}

export function snapshotOf(title: Title): Omit<LibraryItem, "at"> {
  return {
    id: title.id,
    title: title.title,
    poster: title.poster || null,
    year: title.year || null,
    type: title.type,
    category: title.category,
  };
}

export function readLibrary(profileId: string): Library {
  try {
    const raw = localStorage.getItem(key(profileId));
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      history: Array.isArray(parsed?.history) ? parsed.history : [],
      watchlist: Array.isArray(parsed?.watchlist) ? parsed.watchlist : [],
    };
  } catch {
    return EMPTY_LIBRARY;
  }
}

function write(profileId: string, library: Library): Library {
  localStorage.setItem(key(profileId), JSON.stringify(library));
  return library;
}

/** Re-watching a title moves it to the top instead of duplicating it. */
export function recordWatch(profileId: string, entry: Omit<HistoryEntry, "at">, at = Date.now()): Library {
  const library = readLibrary(profileId);
  const rest = library.history.filter((item) => item.id !== entry.id);
  const history = [{ ...entry, at }, ...rest].slice(0, MAX_HISTORY);
  return write(profileId, { ...library, history });
}

export function clearHistory(profileId: string): Library {
  const library = readLibrary(profileId);
  return write(profileId, { ...library, history: [] });
}

export function removeHistory(profileId: string, id: number): Library {
  const library = readLibrary(profileId);
  return write(profileId, { ...library, history: library.history.filter((item) => item.id !== id) });
}

export function toggleWatchlist(profileId: string, item: Omit<LibraryItem, "at">): Library {
  const library = readLibrary(profileId);
  const exists = library.watchlist.some((entry) => entry.id === item.id);
  const watchlist = exists
    ? library.watchlist.filter((entry) => entry.id !== item.id)
    : [{ ...item, at: Date.now() }, ...library.watchlist];
  return write(profileId, { ...library, watchlist });
}

/** Group by catalogue section, newest first — history is read per category. */
export function groupByCategory<T extends { category: Category }>(items: T[]): Record<Category, T[]> {
  return {
    film: items.filter((item) => item.category === "film"),
    serie: items.filter((item) => item.category === "serie"),
    anime: items.filter((item) => item.category === "anime"),
  };
}

export function relativeDate(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `il y a ${days} j`;
  return new Date(timestamp).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
