/**
 * Real plot summaries for the titles in the hero.
 *
 * Moviez serves plays, not text: its catalogue carries a poster, a title and a
 * year, and its viewer page has no description at all. The Wikipedia *intro*
 * was standing in, but it reads like a record card — "X est un film américain
 * réalisé par…" — instead of telling what the film is about. This reads the
 * article's "Synopsis" / "Intrigue" section instead, which is the plot.
 *
 * The TMDB id is resolved to a French Wikipedia article through Wikidata, one
 * cached SPARQL query for all six titles. A title with no synopsis section
 * falls back to Wikidata's one-line description; nothing is invented.
 */

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKI_API = "https://fr.wikipedia.org/w/api.php";
/** v2: the cache used to hold article intros, which read like record cards. */
const CACHE_KEY = "metalflix.synopsis.v2";
const MAX_CHARS = 420;

type Cache = Record<string, string>;
type Lookup = { article?: string; description?: string };
interface Entry {
  id: number;
  series: boolean;
}

interface Section {
  index: string;
  line: string;
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

async function wikiJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * TMDB id → French Wikipedia article and/or Wikidata description. Films and
 * series use different TMDB id spaces that overlap numerically, so each id is
 * looked up through the property matching what the catalogue says it is.
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

/** Article HTML → one readable paragraph. */
function toPlain(html: string): string {
  // Parsing beats stripping tags here: the media boxes, infoboxes and gallery
  // captions become elements we can remove whole, instead of leaking in as
  // "Affiche officielle sur Allociné, Bande-annonce officielle sur…".
  if (typeof DOMParser === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const noise = doc.querySelectorAll(
      "script, style, sup, figure, table, h2, h3, h4, h5, .thumb, .gallery, .gallerytext, .navbox, " +
        ".infobox, .hatnote, .mw-editsection, .reference, .mw-references-wrap, .metadata, .side-box, " +
        ".module-medias, .mediaContainer, .mw-halign-right",
    );
    for (let i = 0; i < noise.length; i += 1) noise[i].remove();
    return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

/** Drops the section title and the "Article détaillé" line that open it. */
function stripOpening(text: string): string {
  return text
    .replace(/^(synopsis|intrigue|r[ée]sum[ée]|argument|histoire)\b[\s:–—-]*/i, "")
    .replace(/^(article d[ée]taill[ée]\s*:[^.]*\.|pour plus de d[ée]tails[^.]*\.)\s*/i, "")
    .trim();
}

/** Keep the opening of the plot, up to two sentences or the character budget. */
function shorten(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= MAX_CHARS) return clean;
  const cut = clean.slice(0, MAX_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 140 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

const PLOT_SECTION = /^(synopsis|intrigue|r[ée]sum[ée]|argument|histoire)\b/i;

/** The plot section of one article, or an empty string when it has none. */
async function synopsisFor(article: string): Promise<string> {
  const page = encodeURIComponent(article);
  const sections = (await wikiJson(
    // origin=* is what lets a static page read the API from the browser at all:
    // without it Wikipedia answers without the CORS headers and every call fails.
    `${WIKI_API}?action=parse&format=json&origin=*&prop=sections&redirects=1&page=${page}`,
  )) as { parse?: { sections?: Section[] } };

  const list = sections.parse?.sections ?? [];
  // Exact titles first ("Synopsis"), then anything that starts with one.
  const target = list.find((entry) => PLOT_SECTION.test(entry.line) && entry.line.length < 24) ?? list.find((entry) => PLOT_SECTION.test(entry.line));
  if (!target) return "";

  const body = (await wikiJson(
    `${WIKI_API}?action=parse&format=json&origin=*&prop=text&redirects=1&section=${target.index}&page=${page}`,
  )) as { parse?: { text?: { "*"?: string } } };

  return shorten(stripOpening(toPlain(body.parse?.text?.["*"] ?? "")));
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
    const results = await Promise.all(
      pending.map(async ({ id }) => {
        const hit = found.get(id);
        if (!hit) return [id, ""] as const;
        if (!hit.article) return [id, hit.description ? sentence(hit.description) : ""] as const;
        try {
          const plot = await synopsisFor(hit.article);
          // No plot section: the description beats the record-card intro.
          return [id, plot || (hit.description ? sentence(hit.description) : "")] as const;
        } catch {
          return [id, hit.description ? sentence(hit.description) : ""] as const;
        }
      }),
    );

    for (const [id, text] of results) cache[String(id)] = text;
    writeCache(cache);
  } catch {
    // Offline or blocked: the hero reads fine without the paragraph.
  }

  return pick(cache, ids);
}
