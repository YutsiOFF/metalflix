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
  /** 0–1, reported by the player page itself (see `recordProgress`). */
  progress?: number;
  /** Explicitly marked as watched to the end, or playback left past ~95 %. */
  done?: boolean;
}

/**
 * Device-level history for viewers without a profile: the resume rail should
 * work for someone who just opened the link, with nothing to create.
 */
export const LOCAL_PROFILE_ID = "invite";

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

/**
 * Re-watching a title moves it to the top instead of duplicating it, and keeps
 * the "terminé" mark the viewer already gave it.
 */
export function recordWatch(profileId: string, entry: Omit<HistoryEntry, "at">, at = Date.now()): Library {
  const library = readLibrary(profileId);
  const previous = library.history.find((item) => item.id === entry.id);
  const rest = library.history.filter((item) => item.id !== entry.id);
  const history = [{ ...entry, done: entry.done ?? previous?.done ?? false, at }, ...rest].slice(0, MAX_HISTORY);
  return write(profileId, { ...library, history });
}

/** The player cannot report playback progress, so "terminé" is an explicit act. */
export function markDone(profileId: string, id: number, done: boolean): Library {
  const library = readLibrary(profileId);
  return write(profileId, {
    ...library,
    history: library.history.map((item) => (item.id === id ? { ...item, done } : item)),
  });
}

/**
 * Playback position reported by the player page. The entry already exists (the
 * player recorded it when it opened), so this only refreshes the season/episode
 * and how far in the viewer is — the history order is left alone.
 */
export function recordProgress(
  profileId: string,
  id: number,
  position: { season?: number; episode?: number },
  progress: number,
): Library {
  const library = readLibrary(profileId);
  const index = library.history.findIndex((item) => item.id === id);
  if (index < 0) return library;

  const ratio = Math.min(1, Math.max(0, progress));
  const current = library.history[index];
  const season = position.season ?? current.season;
  const episode = position.episode ?? current.episode;
  if (current.progress === ratio && current.season === season && current.episode === episode) return library;

  const history = [...library.history];
  history[index] = {
    ...current,
    ...(season && episode ? { season, episode } : {}),
    progress: ratio,
  };
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
