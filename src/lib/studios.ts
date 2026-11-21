/**
 * Studios (Marvel, DC) for the « Plateformes & studios » row.
 *
 * Unlike the streaming services, which are baked into the catalogue from TMDB,
 * a studio is read live from Wikidata — keyless and CORS-open: every film or
 * series whose producer, franchise, fictional universe or series is the
 * studio's, or that adapts a work published by its comics house. The answer is
 * kept a few days in localStorage, so the query runs once in a while.
 */

export type StudioKey = "marvel" | "dc";

export const STUDIO_ORDER: StudioKey[] = ["marvel", "dc"];

export const STUDIO_LABEL: Record<StudioKey, string> = {
  marvel: "Marvel",
  dc: "DC",
};

/** Wikidata items: studios, universes and franchises, then the comics publisher. */
const SOURCES: Record<StudioKey, { items: string[]; publisher: string }> = {
  marvel: {
    // Marvel Studios, Marvel Entertainment, Marvel Television (×2), MCU, Marvel Comics
    items: ["Q367466", "Q1200552", "Q125933445", "Q6778202", "Q642878", "Q173496"],
    publisher: "Q173496",
  },
  dc: {
    // DC Studios (×2), DC Entertainment, DC Comics, DCEU, DC Universe (several items)
    items: [
      "Q21463008",
      "Q31197934",
      "Q3011161",
      "Q2924461",
      "Q18281265",
      "Q1152150",
      "Q5204635",
      "Q5204636",
      "Q52619587",
      "Q114569106",
      "Q116545465",
    ],
    publisher: "Q2924461",
  },
};

const SPARQL = "https://query.wikidata.org/sparql";
const CACHE_KEY = "metalflix:studios:v1";
const CACHE_DAYS = 3;

/** Same key as the catalogue uses: a film and a series can share a TMDB number. */
export function titleKey(item: { id: number; type: "movie" | "series" }): string {
  return `${item.type === "movie" ? "m" : "t"}:${item.id}`;
}

export type StudioSets = Record<StudioKey, Set<string>>;

function query(studio: StudioKey): string {
  const { items, publisher } = SOURCES[studio];
  return `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wd: <http://www.wikidata.org/entity/>
SELECT DISTINCT ?m ?t WHERE {
  { VALUES ?v { ${items.map((id) => `wd:${id}`).join(" ")} }
    { ?i wdt:P272 ?v } UNION { ?i wdt:P8345 ?v } UNION { ?i wdt:P1080 ?v } UNION { ?i wdt:P179 ?v } }
  UNION { ?i wdt:P144 ?w. ?w wdt:P123 wd:${publisher}. }
  UNION { ?i wdt:P144 wd:${publisher}. }
  OPTIONAL { ?i wdt:P4947 ?m }
  OPTIONAL { ?i wdt:P4983 ?t }
  FILTER(BOUND(?m) || BOUND(?t))
}`;
}

async function fetchStudio(studio: StudioKey): Promise<string[]> {
  const res = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(query(studio))}`, {
    headers: { accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);
  const data = (await res.json()) as { results: { bindings: { m?: { value: string }; t?: { value: string } }[] } };
  const keys = new Set<string>();
  for (const row of data.results.bindings) {
    if (row.m?.value) keys.add(`m:${row.m.value}`);
    if (row.t?.value) keys.add(`t:${row.t.value}`);
  }
  return [...keys];
}

let pending: Promise<StudioSets> | null = null;

export function loadStudios(): Promise<StudioSets> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as { at: number; sets: Record<StudioKey, string[]> };
        if (Date.now() - cached.at < CACHE_DAYS * 86_400_000) {
          return { marvel: new Set(cached.sets.marvel), dc: new Set(cached.sets.dc) };
        }
      }
    } catch {
      // Unreadable cache: ask again.
    }
    const [marvel, dc] = await Promise.all(STUDIO_ORDER.map((key) => fetchStudio(key).catch(() => [] as string[])));
    if (marvel.length || dc.length) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), sets: { marvel, dc } }));
      } catch {
        // Private mode: fine, the sets live for this visit.
      }
    }
    return { marvel: new Set(marvel), dc: new Set(dc) };
  })();
  return pending;
}
