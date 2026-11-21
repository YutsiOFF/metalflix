/**
 * Sagas (Fast & Furious, Star Wars, Harry Potter…), from Wikidata.
 *
 * Every film carrying a TMDB id and a "part of the series" (P179) that is a film
 * series, with its runtime (P2047). The answer (~8 000 rows, a few seconds) is
 * grouped here and kept a week in localStorage; App then keeps the sagas the
 * catalogue can actually play.
 */
import type { Title } from "./catalog";

const SPARQL = "https://query.wikidata.org/sparql";
const CACHE_KEY = "metalflix:sagas:v1";
const CACHE_DAYS = 7;

export interface SagaSource {
  /** Wikidata id of the series, e.g. "Q1576873". */
  id: string;
  name: string;
  /** [tmdb film id, runtime in minutes (0 when unknown)] */
  films: [number, number][];
}

export interface Saga {
  id: string;
  name: string;
  films: Title[];
  from: number;
  to: number;
  minutes: number;
}

const QUERY = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?m ?s ?fr ?en ?d WHERE {
  ?f wdt:P4947 ?m; wdt:P179 ?s.
  ?s wdt:P31/wdt:P279* wd:Q24856.
  OPTIONAL { ?f wdt:P2047 ?d }
  OPTIONAL { ?s rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
  OPTIONAL { ?s rdfs:label ?en FILTER(LANG(?en) = "en") }
}`;

/** "série de films Iron Man" → "Iron Man"; "trilogie Matrix" → "Matrix". */
function cleanName(raw: string): string {
  const name = raw
    .replace(/^(?:série|saga|franchise|trilogie|tétralogie|cycle)\s+(?:de\s+films?\s+)?(?:(?:sur|de|du|des)\s+)?(?:(?:la|le|les)\s+|l['’])?/i, "")
    .replace(/\s+\(série de films\)$/i, "")
    .trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : raw;
}

async function fetchSources(): Promise<SagaSource[]> {
  const res = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(QUERY)}`, {
    headers: { accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);
  const data = (await res.json()) as {
    results: {
      bindings: { m: { value: string }; s: { value: string }; fr?: { value: string }; en?: { value: string }; d?: { value: string } }[];
    };
  };
  const groups = new Map<string, { name: string; films: Map<number, number> }>();
  for (const row of data.results.bindings) {
    const id = row.s.value.split("/").pop() ?? "";
    const tmdb = Number(row.m.value);
    if (!id || !tmdb) continue;
    const group = groups.get(id) ?? { name: "", films: new Map<number, number>() };
    if (!group.name) group.name = row.fr?.value || row.en?.value || "";
    const minutes = Math.round(Number(row.d?.value ?? 0)) || 0;
    group.films.set(tmdb, Math.max(group.films.get(tmdb) ?? 0, minutes > 0 && minutes < 600 ? minutes : 0));
    groups.set(id, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.name && group.films.size >= 2)
    .map(([id, group]) => ({ id, name: cleanName(group.name), films: [...group.films.entries()] }));
}

let pending: Promise<SagaSource[]> | null = null;

export function loadSagaSources(): Promise<SagaSource[]> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { at: number; sagas: SagaSource[] };
        if (Date.now() - cached.at < CACHE_DAYS * 86_400_000 && cached.sagas?.length) return cached.sagas;
      }
    } catch {
      // Unreadable cache: ask again.
    }
    const sagas = await fetchSources();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), sagas }));
    } catch {
      // Private mode or full storage: the list lives for this visit.
    }
    return sagas;
  })();
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

/**
 * The sagas the catalogue can play: at least two of their films on the site,
 * in release order. A sub-series whose films all sit inside a bigger saga
 * ("Star Wars, première trilogie" inside "Star Wars") is dropped, and the most
 * recognisable sagas come first (the catalogue is ordered notable-first).
 */
export function buildSagas(sources: SagaSource[], catalog: Title[]): Saga[] {
  const films = new Map<number, { item: Title; rank: number }>();
  catalog.forEach((item, rank) => {
    if (item.category === "film" && item.poster && !films.has(item.id)) films.set(item.id, { item, rank });
  });

  const candidates = sources
    .map((source) => {
      const members = source.films
        .map(([id, minutes]) => ({ hit: films.get(id), minutes }))
        .filter((entry): entry is { hit: { item: Title; rank: number }; minutes: number } => Boolean(entry.hit));
      if (members.length < 2) return null;
      members.sort((a, b) => (a.hit.item.year || 9999) - (b.hit.item.year || 9999));
      const years = members.map((entry) => entry.hit.item.year).filter(Boolean);
      return {
        saga: {
          id: source.id,
          name: source.name,
          films: members.map((entry) => entry.hit.item),
          from: years.length ? Math.min(...years) : 0,
          to: years.length ? Math.max(...years) : 0,
          minutes: members.reduce((sum, entry) => sum + entry.minutes, 0),
        } as Saga,
        ids: new Set(members.map((entry) => entry.hit.item.id)),
        rank: Math.min(...members.map((entry) => entry.hit.rank)),
      };
    })
    .filter((entry): entry is { saga: Saga; ids: Set<number>; rank: number } => Boolean(entry));

  // Biggest first, so a sub-series meets its parent before it is kept.
  candidates.sort((a, b) => b.ids.size - a.ids.size || a.saga.name.length - b.saga.name.length);
  const kept: typeof candidates = [];
  for (const entry of candidates) {
    const inside = kept.some((other) => [...entry.ids].every((id) => other.ids.has(id)));
    if (!inside) kept.push(entry);
  }
  // The famous sagas open the page in a fixed order; after them, sagas with the
  // most recognisable films (the catalogue head is the notable titles).
  const priority = (name: string) => {
    const key = name.toLowerCase();
    const index = FEATURED.findIndex((word) => key.includes(word));
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  return kept
    .map((entry) => ({
      entry,
      first: priority(entry.saga.name),
      known: entry.saga.films.filter((item) => (films.get(item.id)?.rank ?? Infinity) < NOTABLE_HEAD).length,
    }))
    .sort((a, b) => a.first - b.first || b.known - a.known || a.entry.rank - b.entry.rank)
    .map(({ entry }) => entry.saga);
}

/** Sagas everybody knows, shown first in this order (matched inside the name). */
const FEATURED = [
  "fast and furious",
  "star wars",
  "harry potter",
  "seigneur des anneaux",
  "univers cinématographique marvel",
  "avengers",
  "jurassic",
  "mission impossible",
  "john wick",
  "pirates des caraïbes",
  "matrix",
  "indiana jones",
  "hunger games",
  "spider-man",
  "batman",
  "transformers",
  "toy story",
  "shrek",
  "rocky",
  "terminator",
  "alien",
  "twilight",
  "les bronzés",
  "taxi",
  "astérix",
  "conjuring",
  "scream",
  "saw",
  "destination finale",
  "chucky",
];

/** The catalogue's first rows are the notable titles (build-catalog sorts them first). */
const NOTABLE_HEAD = 8000;

/** "3 h 26" from minutes. */
export function sagaRuntime(minutes: number): string {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h ${String(rest).padStart(2, "0")}` : `${rest} min`;
}
