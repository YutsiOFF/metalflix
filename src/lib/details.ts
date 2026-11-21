/**
 * The title sheet: real plot, cast, director, runtime, and a trailer.
 *
 * Moviez only serves playback — an id, a poster, a title, a year. Everything a
 * detail page needs comes from elsewhere: Wikipedia (fr) through Wikidata for
 * the text and the credits, and YouTube for the trailer, searched through our
 * Worker because YouTube answers a browser without CORS headers.
 *
 * Nothing here is generated: when a source has nothing, the field stays empty
 * and the page simply leaves that block out.
 */

import { PLAYER_PROXY } from "./moviez";

export interface Credit {
  name: string;
  /** Empty when the article lists the actor without a role. */
  role: string;
  /** Portrait from Wikimedia Commons (Wikidata P18), when the actor has one. */
  photo?: string;
}

export interface TitleDetails {
  plot: string;
  credits: Credit[];
  director: string;
  runtime: string;
  /** YouTube video id, empty when no trailer was found. */
  trailer: string;
  article: string;
}

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKI_API = "https://fr.wikipedia.org/w/api.php";
const CACHE_KEY = "metalflix.details.v5";
/** The sheet has room for a real paragraph, unlike the hero one-liner. */
const PLOT_CHARS = 1100;
const MAX_CREDITS = 14;

const EMPTY: TitleDetails = { plot: "", credits: [], director: "", runtime: "", trailer: "", article: "" };

const PLOT_SECTION = /^(synopsis|intrigue|r[ée]sum[ée]|argument|histoire)\b/i;
const CAST_SECTION = /^(distribution|casting|voix)/i;
const CREW_SECTION = /^(fiche technique|[ée]quipe)/i;

type Cache = Record<string, TitleDetails>;
type Entry = { id: number; title: string; series: boolean; skipWiki?: boolean };
interface Section {
  index: string;
  line: string;
}
interface WikidataParts {
  article: string;
  director: string;
  runtime: string;
  description: string;
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
    // Private mode or full quota: the sheet just re-fetches next time.
  }
}

async function wikiJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Article URL → French title, e.g. ".../wiki/Hurlevent_(film,_2026)" → "Hurlevent (film, 2026)". */
function articleName(url: string): string {
  const tail = url.split("/wiki/")[1] ?? "";
  return tail ? decodeURIComponent(tail).replace(/_/g, " ") : "";
}

/** Minutes from Wikidata's P2047, shown the way a French film page would. */
function formatRuntime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) return "";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

function asSentence(text: string): string {
  const clean = text.trim();
  if (!clean) return "";
  const capitalised = clean.charAt(0).toUpperCase() + clean.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

/** Wikidata: French article, director, runtime and the one-line description. */
async function wikidataPart(entry: Entry): Promise<WikidataParts> {
  const property = entry.series ? "P4983" : "P4947";
  const query = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
SELECT ?article ?directorLabel ?duration ?description WHERE {
  ?item wdt:${property} "${entry.id}".
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://fr.wikipedia.org/>. }
  OPTIONAL { ?item wdt:P57 ?director. ?director rdfs:label ?directorLabel. FILTER(LANG(?directorLabel) = "fr") }
  OPTIONAL { ?item wdt:P2047 ?duration }
  OPTIONAL { ?item schema:description ?description. FILTER(LANG(?description) = "fr") }
}`;

  const res = await fetch(`${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);

  const data = (await res.json()) as {
    results: {
      bindings: {
        article?: { value: string };
        directorLabel?: { value: string };
        duration?: { value: string };
        description?: { value: string };
      }[];
    };
  };

  // Each OPTIONAL multiplies the rows, and the first one is not necessarily the
  // one carrying the director: take the first defined value per field.
  const found: WikidataParts = { article: "", director: "", runtime: "", description: "" };
  for (const row of data.results.bindings) {
    if (!found.article && row.article) found.article = articleName(row.article.value);
    if (!found.director && row.directorLabel) found.director = row.directorLabel.value;
    if (!found.runtime && row.duration) found.runtime = formatRuntime(Number(row.duration.value));
    if (!found.description && row.description) found.description = row.description.value;
  }
  return found;
}

/** "Sandra Hüller" and "sandra huller" are the same person. */
function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The cast as Wikidata knows it (P161), with each actor's portrait (P18) from
 * Wikimedia Commons, served as a small thumbnail. Keyless and CORS-open.
 */
async function castPart(entry: Entry): Promise<{ name: string; photo: string }[]> {
  const property = entry.series ? "P4983" : "P4947";
  const query = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?actor ?fr ?en ?image WHERE {
  ?item wdt:${property} "${entry.id}"; wdt:P161 ?actor.
  OPTIONAL { ?actor wdt:P18 ?image }
  OPTIONAL { ?actor rdfs:label ?fr. FILTER(LANG(?fr) = "fr") }
  OPTIONAL { ?actor rdfs:label ?en. FILTER(LANG(?en) = "en") }
} LIMIT 120`;
  const res = await fetch(`${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { accept: "application/sparql-results+json" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results: { bindings: { actor: { value: string }; fr?: { value: string }; en?: { value: string }; image?: { value: string } }[] };
  };
  const byActor = new Map<string, { name: string; photo: string }>();
  for (const row of data.results.bindings) {
    const name = row.fr?.value || row.en?.value || "";
    if (!name) continue;
    const known = byActor.get(row.actor.value);
    const photo = row.image?.value
      ? `${row.image.value.replace(/^http:/, "https:")}?width=240`
      : "";
    if (!known) byActor.set(row.actor.value, { name, photo });
    else if (!known.photo && photo) known.photo = photo;
  }
  return [...byActor.values()];
}

/** Section HTML → readable text, with the boxes and notes that leak captions removed. */
function toPlain(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const noise = doc.querySelectorAll(
      "script, style, sup, figure, table, h2, h3, h4, h5, .thumb, .gallery, .gallerytext, .navbox, .infobox, " +
        ".hatnote, .mw-editsection, .reference, .mw-references-wrap, .metadata, .side-box, .module-medias, " +
        ".mediaContainer, .mw-halign-right, .thumbcaption, .magnify, .legend",
    );
    for (let i = 0; i < noise.length; i += 1) noise[i].remove();
    return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

/**
 * The plot is read from the section's paragraphs only. Its images, its
 * infoboxes and their captions ("Un simple agriculteur et sa famille") sit in
 * other elements, so they never end up glued to the first sentence.
 */
function plotFrom(html: string): string {
  if (typeof DOMParser === "undefined") return shorten(stripOpening(toPlain(html)));
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const paragraphs = Array.from(doc.querySelectorAll("p"))
      .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((text) => text.length > 80);
    const text = paragraphs.join(" ");
    return shorten(stripOpening(text || toPlain(html)));
  } catch {
    return shorten(stripOpening(toPlain(html)));
  }
}

/** Drops the section title and the "Article détaillé" line that open it. */
function stripOpening(text: string): string {
  return text
    .replace(/^(synopsis|intrigue|r[ée]sum[ée]|argument|histoire|distribution|casting)\b[\s:–—-]*/i, "")
    .replace(/^(article d[ée]taill[ée]\s*:[^.]*\.|pour plus de d[ée]tails[^.]*\.)\s*/i, "")
    .trim();
}

/** The opening of the plot, cut on a sentence so it never stops mid-thought. */
function shorten(text: string): string {
  // Wikipedia's footnote marks ("[1]", "[2]", "[réf. nécessaire]") are noise here.
  const clean = text
    .replace(/\s*\[(?:\d+|[a-z]|réf[^\]]*|note[^\]]*)\](?:\s*,?\s*\[(?:\d+|[a-z]|réf[^\]]*|note[^\]]*)\])*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= PLOT_CHARS) return clean;
  const cut = clean.slice(0, PLOT_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 260 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/** Drops the "(VF : Dorothée Pousséo)" dubbing note from an actor's name. */
function withoutVoice(name: string): string {
  return name.replace(/\s*\((?:vf|vo|vostfr|voix)\b[^)]*\)\s*$/i, "").trim();
}

/** "Timothée Chalamet : Paul Atréides" → name + role. */
function splitCredit(raw: string): Credit {
  const line = raw.replace(/\[\d+\]/g, "").replace(/^[•·\-\s]+/, "").replace(/\s+/g, " ").trim();
  // The role follows the colon that sits outside parentheses: cutting at the
  // first " : " would break inside "(VF : Dorothée Pousséo)".
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === ":" && line[i - 1] === " " && line[i + 1] === " ") cut = i;
  }
  if (cut > 0) {
    return {
      name: withoutVoice(line.slice(0, cut)),
      role: line.slice(cut + 1).trim().replace(/[.;]$/, ""),
    };
  }
  const match = /^(.{2,70}?)\s*[–—]\s+(.+)$/.exec(line);
  if (match) return { name: withoutVoice(match[1]), role: match[2].trim() };
  return { name: withoutVoice(line), role: "" };
}

/** The distribution section's list items, cleaned and de-duplicated. */
function creditsFrom(html: string): Credit[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = doc.querySelectorAll("li");
  const out: Credit[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < items.length && out.length < MAX_CREDITS; i += 1) {
    // A nested <li> is a sub-credit ("Catherine, jeune"): its text belongs to
    // the child entry, not to the parent, which would otherwise swallow it.
    const clone = items[i].cloneNode(true) as Element;
    clone.querySelectorAll("ul, ol, sup, style, script").forEach((node) => node.remove());
    const raw = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    if (raw.length < 3 || raw.length > 200) continue;
    const credit = splitCredit(raw);
    if (credit.name.length < 3 || credit.name.length > 70) continue;
    const key = credit.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(credit);
  }
  return out;
}

const DIRECTOR_LINE = /^(?:r[ée]alis(?:ation|ateur|ateurs?)|un r[ée]alisateur)\s*:?\s*(.+)$/i;

/**
 * The director, from the article's "Fiche technique". Wikidata does not always
 * carry P57 on the item a TMDB id resolves to, but the crew list is written by
 * hand on the article and always names the director.
 */
function directorFrom(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const row of Array.from(doc.querySelectorAll("tr"))) {
    const cells = Array.from(row.querySelectorAll("th, td")).map((cell) =>
      (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    if (cells.length >= 2 && /^r[ée]alis/i.test(cells[0])) return cells[1];
  }

  for (const node of Array.from(doc.querySelectorAll("li, dd, p"))) {
    const line = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (line.length > 140) continue;
    const match = DIRECTOR_LINE.exec(line);
    if (match) return match[1].replace(/[.;]$/, "").trim();
  }
  return "";
}

/** Plot, cast and director, read from the article's own sections. */
async function articlePart(article: string): Promise<{ plot: string; credits: Credit[]; director: string }> {
  const page = encodeURIComponent(article);
  const sections = (await wikiJson(
    // origin=* is what lets a static page read the API from the browser at all.
    `${WIKI_API}?action=parse&format=json&origin=*&prop=sections&redirects=1&page=${page}`,
  )) as { parse?: { sections?: Section[] } };

  const list = sections.parse?.sections ?? [];
  const lookup = (pattern: RegExp) =>
    list.find((entry) => pattern.test(entry.line) && entry.line.length < 24) ??
    list.find((entry) => pattern.test(entry.line));

  const plotSection = lookup(PLOT_SECTION);
  const castSection = lookup(CAST_SECTION);
  const crewSection = lookup(CREW_SECTION);

  const body = async (index?: string) => {
    if (!index) return "";
    const data = (await wikiJson(
      `${WIKI_API}?action=parse&format=json&origin=*&prop=text&redirects=1&section=${index}&page=${page}`,
    )) as { parse?: { text?: { "*"?: string } } };
    return data.parse?.text?.["*"] ?? "";
  };

  const [plotHtml, castHtml, crewHtml] = await Promise.all([
    body(plotSection?.index),
    body(castSection?.index),
    body(crewSection?.index),
  ]);

  return {
    plot: plotFrom(plotHtml),
    credits: castHtml ? creditsFrom(castHtml) : [],
    director: crewHtml ? directorFrom(crewHtml) : "",
  };
}

/** Trailer id from the Worker, the only side able to read YouTube. */
async function trailerQuery(query: string): Promise<string> {
  if (!PLAYER_PROXY) return "";
  const res = await fetch(`${PLAYER_PROXY}/yt?q=${encodeURIComponent(query)}`);
  if (!res.ok) return "";
  const data = (await res.json()) as { id?: string | null };
  return data.id ?? "";
}

/**
 * A trailer, or nothing. Catalogue titles sometimes arrive with the year glued
 * on ("Backrooms2026") and many keep their original title, so the French query
 * comes first and a plain "trailer" query catches what it misses.
 */
async function trailerFor(title: string): Promise<string> {
  const clean = title.replace(/\s*[([]?\d{4}[)\]]?\s*$/, "").trim() || title;
  const french = await trailerQuery(`${clean} bande annonce VF`);
  if (french) return french;
  return trailerQuery(`${clean} trailer`);
}

export async function loadDetails(entry: Entry): Promise<TitleDetails> {
  const cache = readCache();
  const key = String(entry.id);
  const hit = cache[key];
  if (hit) return hit;

  const [wiki, trailer, cast] = await Promise.all([
    entry.skipWiki
      ? Promise.resolve(null)
      : (async (): Promise<Partial<TitleDetails> | null> => {
          try {
            const meta = await wikidataPart(entry);
            const oneLine = asSentence(meta.description);
            // No French article linked: Wikidata's one-line description still
            // says what the title is, which beats an empty block.
            if (!meta.article) return { ...meta, plot: oneLine, credits: [] };
            const text = await articlePart(meta.article);
            return {
              ...meta,
              plot: text.plot || oneLine,
              credits: text.credits,
              director: meta.director || text.director,
            };
          } catch {
            return null;
          }
        })(),
    trailerFor(entry.title).catch(() => ""),
    entry.skipWiki ? Promise.resolve([]) : castPart(entry).catch(() => []),
  ]);

  // The article gives the billing order and the roles; Wikidata gives faces.
  // Names are matched loosely (accents, case); with no article list at all,
  // Wikidata's own cast list (photos first) stands in.
  const photos = new Map(cast.map((actor) => [nameKey(actor.name), actor.photo]));
  let credits: Credit[] = (wiki?.credits ?? []).map((credit) => ({
    ...credit,
    photo: photos.get(nameKey(credit.name)) || undefined,
  }));
  if (!credits.length && cast.length) {
    credits = [...cast]
      .sort((a, b) => Number(Boolean(b.photo)) - Number(Boolean(a.photo)))
      .slice(0, MAX_CREDITS)
      .map((actor) => ({ name: actor.name, role: "", photo: actor.photo || undefined }));
  }

  const details: TitleDetails = {
    ...EMPTY,
    ...(wiki ?? {}),
    credits,
    trailer: trailer || "",
  };

  cache[key] = details;
  writeCache(cache);
  return details;
}
