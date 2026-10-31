/**
 * Short descriptions for the few titles in the hero.
 *
 * Moviez serves plays, not text: its catalogue carries a poster, a title and a
 * year, and `/api/check` returns the same four fields. The paragraph therefore
 * comes from the French Wikipedia article attached to the TMDB id in Wikidata;
 * when there is no article, Wikidata's own one-line description stands in
 * ("mini-série américaine de science-fiction"). Two requests for all six
 * titles, cached for the session so a rotation costs nothing. No key, no
 * backend, and no invented synopsis: a title with neither shows no text.
 */

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKI_API = "https://fr.wikipedia.org/w/api.php";
const CACHE_KEY = "metalflix.synopses";
const MAX_CHARS = 320;

type Cache = Record<string, string>;
type Lookup = { article?: string; description?: string };
interface Entry {
  id: number;
  series: boolean;
}

function readCache(): Cache {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "{}") as Cache;
  } catch {
    return {};
  }
}

function writeCache(cache: Cache) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Private mode or full quota: the text is a nicety, not state.
  }
}

/**
 * TMDB id → French Wikipedia article and/or Wikidata description. Films and
 * series use different TMDB id spaces that overlap numerically, so each id is
 * looked up through the property matching what the catalogue says it is —
 * otherwise a 2026 cartoon would inherit the description of a 1993 film.
 */
async function lookupFor(entries: Entry[]): Promise<Map<number, Lookup>> {
  const films = entries.filter((entry) => !entry.series).map((entry) => `"${entry.id}"`);
  const series = entries.filter((entry) => entry.series).map((entry) => `"${entry.id}"`);
  const branches = [
    films.length ? `{ VALUES ?tmdb { ${films.join(" ")} } ?item wdt:P4947 ?tmdb }` : "",
    series.length ? `{ VALUES ?tmdb { ${series.join(" ")} } ?item wdt:P4983 ?tmdb }` : "",
  ].filter(Boolean);
  const query = `SELECT ?tmdb ?article ?description WHERE {
  ${branches.join(" UNION ")}
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://fr.wikipedia.org/>. }
  OPTIONAL { ?item schema:description ?description. FILTER(LANG(?description) = "fr") }
}`;
  const res = await fetch(`${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);

  const data = (await res.json()) as {
    results: {
      bindings: {
        tmdb: { value: string };
        article?: { value: string };
        description?: { value: string };
      }[];
    };
  };

  const found = new Map<number, Lookup>();
  for (const row of data.results.bindings) {
    const id = Number(row.tmdb.value);
    const entry = found.get(id) ?? {};
    const title = row.article
      ? decodeURIComponent(row.article.value.split("/wiki/")[1] ?? "").replace(/_/g, " ")
      : "";
    if (title) entry.article = title;
    if (row.description?.value) entry.description = row.description.value;
    if (entry.article || entry.description) found.set(id, entry);
  }
  return found;
}

/** Article titles → intro paragraphs, one batched call. */
async function extractsFor(titles: string[]): Promise<Map<string, string>> {
  const url =
    `${WIKI_API}?action=query&format=json&origin=*&prop=extracts&exintro=1&explaintext=1&redirects=1` +
    `&titles=${encodeURIComponent(titles.join("|"))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`wiki ${res.status}`);

  const data = (await res.json()) as {
    query?: {
      pages?: Record<string, { title: string; extract?: string }>;
      normalized?: { from: string; to: string }[];
      redirects?: { from: string; to: string }[];
    };
  };

  const byTitle = new Map<string, string>();
  for (const page of Object.values(data.query?.pages ?? {})) {
    if (page.extract) byTitle.set(page.title, page.extract);
  }

  // A requested title can come back renamed (accents, redirects).
  const resolve = (title: string) => {
    let current = title;
    for (let hop = 0; hop < 3; hop += 1) {
      const next =
        data.query?.normalized?.find((entry) => entry.from === current)?.to ??
        data.query?.redirects?.find((entry) => entry.from === current)?.to;
      if (!next) break;
      current = next;
    }
    return current;
  };

  const extracts = new Map<string, string>();
  for (const title of titles) {
    const text = byTitle.get(resolve(title));
    if (text) extracts.set(title, text);
  }
  return extracts;
}

/** Keep two sentences at most: the hero is a teaser, not the article. */
function shorten(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_CHARS) return clean;
  const cut = clean.slice(0, MAX_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 120 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

function sentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const capitalised = clean.charAt(0).toUpperCase() + clean.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

function pick(cache: Cache, ids: number[]): Record<number, string> {
  const found: Record<number, string> = {};
  for (const id of ids) {
    const text = cache[String(id)];
    if (text) found[id] = text;
  }
  return found;
}

export async function loadSynopses(entries: Entry[]): Promise<Record<number, string>> {
  const ids = entries.map((entry) => entry.id);
  const cache = readCache();
  const pending = entries.filter((entry) => !(String(entry.id) in cache));
  if (!pending.length) return pick(cache, ids);

  try {
    const found = await lookupFor(pending);
    const articles = [...new Set([...found.values()].map((entry) => entry.article).filter(Boolean))] as string[];
    const extracts = articles.length ? await extractsFor(articles) : new Map<string, string>();

    for (const { id } of pending) {
      const hit = found.get(id);
      const paragraph = hit?.article ? extracts.get(hit.article) : undefined;
      const text = paragraph ? shorten(paragraph) : hit?.description ? sentence(hit.description) : "";
      cache[String(id)] = text;
    }
    writeCache(cache);
  } catch {
    // Offline or blocked: the hero reads fine without the paragraph.
  }

  return pick(cache, ids);
}
