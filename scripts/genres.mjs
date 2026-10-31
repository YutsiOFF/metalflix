// Genre tags from Wikidata, keyed by TMDB id, stored as a bitmask.
//
// Neither /api/browse nor /api/check exposes genres, so the site fills them in
// offline. Wikidata covers the notable part of the catalogue — which is exactly
// the part the rails and the default sort show first.
//
// Two strategies, because the data is shaped differently:
//   • films: one query per canonical genre film item (fast, precise);
//   • series: one bulk query on the genre labels actually used for TV
//     ("série télévisée dramatique", "sitcom", …), matched by keyword.
//
// Run: node scripts/genres.mjs   → .cache/genres.json
import { mkdir, readFile, writeFile } from "node:fs/promises";

const UA = "MetalFlix/1.0 (https://github.com/YutsiOFF/metalflix)";
await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });

/** Order defines the bit index — appended genres must go at the end. */
export const GENRES = [
  ["action", "Action", "Q188473"],
  ["adventure", "Aventure", "Q319221"],
  ["animation", "Animation", "Q202866"],
  ["comedy", "Comédie", "Q157443"],
  ["crime", "Crime", "Q959790"],
  ["documentary", "Documentaire", "Q93204"],
  ["drama", "Drame", "Q130232"],
  ["family", "Familial", "Q1361932"],
  ["fantasy", "Fantastique", "Q157394"],
  ["history", "Histoire", "Q17013749"],
  ["horror", "Horreur", "Q200092"],
  ["music", "Musique", "Q842256"],
  ["mystery", "Mystère", "Q1200678"],
  ["romance", "Romance", "Q1054574"],
  ["scifi", "Science-fiction", "Q471839"],
  ["thriller", "Thriller", "Q2484376"],
  ["war", "Guerre", "Q369747"],
  ["western", "Western", "Q172980"],
];

export const GENRE_KEYS = GENRES.map(([key]) => key);

// Specific patterns first: "comédie dramatique" is both, but "science-fiction"
// must not fall into a broader bucket on its way through.
const RULES = [
  ["horror", /horreur|horror|épouvante|epouvante/],
  ["scifi", /science[- ]fiction|sci[- ]?fi/],
  ["fantasy", /fantastique|fantasy|merveilleux/],
  ["animation", /animation|animé|anime|dessin animé|animated/],
  ["documentary", /documentaire|documentary/],
  ["western", /western/],
  ["war", /guerre|\bwar\b/],
  ["crime", /criminel|crime|polici|mafia|gangster|braquage/],
  ["thriller", /thriller|suspense/],
  ["mystery", /mystère|mystere|mystery|énigme/],
  ["romance", /amour|romance|romantique|romantic/],
  ["comedy", /comédie|comedie|comedy|sitcom|humour|parodie|burlesque/],
  ["action", /action/],
  ["adventure", /aventure|adventure/],
  ["family", /jeunesse|familial|family|enfants|children/],
  ["music", /musical|musique|music/],
  ["history", /historique|historical|péplum/],
  ["drama", /drame|drama|telenovela|soap|feuilleton|mélodrame/],
];

function bitFor(label) {
  const text = label.toLowerCase();
  for (const [key, pattern] of RULES) {
    if (pattern.test(text)) return GENRE_KEYS.indexOf(key);
  }
  return -1;
}

async function sparql(query) {
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("query", query);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/sparql-results+json", "user-agent": UA },
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).results.bindings;
    } catch (error) {
      console.warn(`  tentative ${attempt + 1}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  return [];
}

// `ONLY=action,horror node scripts/genres.mjs` re-queries just those genres and
// merges into the existing file, so a wrong QID does not cost a full re-run.
const only = new Set((process.env.ONLY ?? "").split(",").filter(Boolean));

const masks = new Map(); // tmdb id → bitmask
if (only.size) {
  try {
    const existing = JSON.parse(await readFile(new URL("../.cache/genres.json", import.meta.url), "utf8"));
    for (const [id, mask] of Object.entries(existing.masks ?? {})) masks.set(Number(id), Number(mask));
  } catch {
    // No previous file: just collect the requested genres.
  }
}
function add(id, bit) {
  if (bit < 0 || !Number.isFinite(id)) return;
  masks.set(id, (masks.get(id) ?? 0) | (1 << bit));
}

// ── Films: one query per canonical genre item ───────────────────────────────
for (const [index, [key, , qid]] of GENRES.entries()) {
  if (only.size && !only.has(key)) continue;
  const rows = await sparql(
    `SELECT ?tmdb WHERE { ?item wdt:P136 wd:${qid} ; wdt:P4947 ?tmdb } LIMIT 30000`,
  );
  const before = masks.size;
  for (const row of rows) add(Number(row.tmdb.value), index);
  console.log(`film ${key}: ${rows.length} ids (+${masks.size - before} nouveaux)`);
  await new Promise((r) => setTimeout(r, 1200));
}

// ── Séries: genres réellement utilisés pour la télévision ───────────────────
const tvRows = only.size
  ? []
  : await sparql(
  `SELECT ?tmdb ?gLabel WHERE {
     ?item wdt:P4983 ?tmdb ; wdt:P136 ?g .
     SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
   } LIMIT 60000`,
);
let matched = 0;
for (const row of tvRows) {
  const bit = bitFor(row.gLabel.value);
  if (bit < 0) continue;
  matched += 1;
  add(Number(row.tmdb.value), bit);
}
console.log(`série: ${tvRows.length} lignes, ${matched} classées`);

const payload = { version: 1, keys: GENRE_KEYS, masks: Object.fromEntries([...masks].map(([id, mask]) => [id, mask])) };
const json = JSON.stringify(payload);
await writeFile(new URL("../.cache/genres.json", import.meta.url), json);
const tagged = [...masks.values()].filter((mask) => mask > 0).length;
console.log(`genres: ${tagged} titres étiquetés · ${(json.length / 1024).toFixed(0)} Kio`);
