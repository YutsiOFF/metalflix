/**
 * Keeps an account's library identical on every device.
 *
 * Each sync pulls the cloud copy, merges it with this device's copy and pushes
 * the result back. Per title the most recent change wins (`t`, else `at`); a
 * title removed on one device is remembered with the time of its removal, so it
 * does not come back from another device that still had it.
 */
import { pullDoc, pushDoc, type CloudDoc } from "./cloud";
import { readLibrary, saveLibrary, type HistoryEntry, type Library, type LibraryItem } from "./library";

const MAX_HISTORY = 300;

type Tombs = Record<string, number>;

interface SyncState {
  /** Ids present after the last sync: one missing now was removed here. */
  history: number[];
  watchlist: number[];
  removedHistory: Tombs;
  removedWatchlist: Tombs;
}

function stateKey(profileId: string) {
  return `metalflix.sync.${profileId}`;
}

function readState(profileId: string): SyncState | null {
  try {
    const raw = localStorage.getItem(stateKey(profileId));
    return raw ? (JSON.parse(raw) as SyncState) : null;
  } catch {
    return null;
  }
}

function stamp(item: { at: number; t?: number }): number {
  return Math.max(item.t ?? 0, item.at ?? 0);
}

function mergeTombs(a: Tombs = {}, b: Tombs = {}): Tombs {
  const out: Tombs = { ...a };
  for (const [id, at] of Object.entries(b)) out[id] = Math.max(out[id] ?? 0, at);
  return out;
}

function mergeList<T extends LibraryItem>(local: T[], remote: T[], tombs: Tombs): T[] {
  const byId = new Map<number, T>();
  for (const item of [...remote, ...local]) {
    const known = byId.get(item.id);
    if (!known || stamp(item) >= stamp(known)) byId.set(item.id, item);
  }
  return [...byId.values()]
    .filter((item) => !(String(item.id) in tombs) || stamp(item) > tombs[String(item.id)])
    .sort((a, b) => b.at - a.at);
}

/** Pull, merge, push. Returns the merged library (already saved on the device). */
export async function syncLibrary(profileId: string): Promise<Library> {
  const now = Date.now();
  const local = readLibrary(profileId);
  const previous = readState(profileId);

  // Removed here since the last sync → tombstone, so the cloud forgets it too.
  const localTombsHistory: Tombs = { ...(previous?.removedHistory ?? {}) };
  const localTombsWatch: Tombs = { ...(previous?.removedWatchlist ?? {}) };
  if (previous) {
    const historyIds = new Set(local.history.map((item) => item.id));
    const watchIds = new Set(local.watchlist.map((item) => item.id));
    for (const id of previous.history) if (!historyIds.has(id)) localTombsHistory[id] = now;
    for (const id of previous.watchlist) if (!watchIds.has(id)) localTombsWatch[id] = now;
  }

  const remote = (await pullDoc()) ?? ({ history: [], watchlist: [] } as CloudDoc);
  const removedHistory = mergeTombs(localTombsHistory, remote.removedHistory);
  const removedWatchlist = mergeTombs(localTombsWatch, remote.removedWatchlist);

  const merged: Library = {
    history: mergeList(local.history, remote.history as HistoryEntry[], removedHistory).slice(0, MAX_HISTORY),
    watchlist: mergeList(local.watchlist, remote.watchlist as LibraryItem[], removedWatchlist),
  };

  // Tombstones older than 60 days have done their job.
  const fresh = (tombs: Tombs) =>
    Object.fromEntries(Object.entries(tombs).filter(([, at]) => now - at < 60 * 86_400_000));

  const doc: CloudDoc = {
    ...merged,
    removedHistory: fresh(removedHistory),
    removedWatchlist: fresh(removedWatchlist),
  };
  await pushDoc(doc);

  // Anything recorded on this device while the network round-trip ran (a
  // position, a new title) is folded in rather than overwritten.
  const latest = readLibrary(profileId);
  const final: Library = {
    history: mergeList(latest.history, merged.history, removedHistory).slice(0, MAX_HISTORY),
    watchlist: mergeList(latest.watchlist, merged.watchlist, removedWatchlist),
  };
  saveLibrary(profileId, final);
  const state: SyncState = {
    history: final.history.map((item) => item.id),
    watchlist: final.watchlist.map((item) => item.id),
    removedHistory: doc.removedHistory ?? {},
    removedWatchlist: doc.removedWatchlist ?? {},
  };
  localStorage.setItem(stateKey(profileId), JSON.stringify(state));
  return final;
}
