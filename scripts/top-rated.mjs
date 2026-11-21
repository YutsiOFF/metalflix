/**
 * « Top 10 des films aujourd'hui » : les films récents les mieux notés.
 *
 * The catalogue carries no rating, so the ranking comes from TMDB: its
 * `/discover/movie` sorted by note, restricted to films out in the last 18
 * months with enough votes to mean something. The list is then intersected with
 * the catalogue — a great film the site cannot play has no business in the row —
 * and written to `src/data/top.json`, which the site reads at build time.
 *
 * Usage: node scripts/top-rated.mjs [pages]
 */
import { readFileSync, writeFileSync } from "node:fs";

const KEY_FILE = new URL("../.cache/tmdb-key", import.meta.url);
const OUT = new URL("../src/data/top.json", import.meta.url);
const LOCALE = "fr-FR";
/** Note is meaningless on a handful of votes: "mieux noté" needs a floor. */
const MIN_VOTES = 200;
/** Recency window, in days: what is "sorti" lately without being brand new. */
const WINDOW_DAYS = 540;

async function key() {
  if (process.env.TMDB_KEY) return process.env.TMDB_KEY.trim();
  try {
    return (await readFileSync(KEY_FILE, "utf8")).trim();
  } catch {
    console.error("clé TMDB absente : mets-la dans .cache/tmdb-key ou TMDB_KEY=…");
    process.exit(1);
  }
}

const today = new Date();
const since = new Date(today.getTime() - WINDOW_DAYS * 86_400_000);
const iso = (date) => date.toISOString().slice(0, 10);

const rows = [
  ...JSON.parse(readFileSync(new URL("../src/data/catalog.json", import.meta.url), "utf8")),
  ...JSON.parse(readFileSync(new URL("../src/data/catalog-rest.json", import.meta.url), "utf8")),
];
const playable = new Set(rows.filter((row) => row[3] === 0).map((row) => row[0]));

const token = await key();
const pages = Number(process.argv[2] ?? 4);
const found = [];

for (let page = 1; page <= pages; page += 1) {
  const url = new URL("https://api.themoviedb.org/3/discover/movie");
  url.search = new URLSearchParams({
    api_key: token,
    language: LOCALE,
    sort_by: "vote_average.desc",
    "vote_count.gte": String(MIN_VOTES),
    // 16 is Animation: the row is for films and series, not for animation.
    without_genres: "16",
    "primary_release_date.gte": iso(since),
    "primary_release_date.lte": iso(today),
    include_adult: "false",
    page: String(page),
  }).toString();

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`TMDB ${res.status} à la page ${page}`);
    break;
  }
  const data = await res.json();
  for (const item of data.results ?? []) found.push(item);
  await new Promise((done) => setTimeout(done, 120));
}

// Japanese animation is the Anime-Sama shelf's business: the row is for films.
const kept = found.filter(
  (item) => playable.has(item.id) && item.original_language !== "ja" && item.adult !== true,
);
const ids = kept.slice(0, 80).map((item) => item.id);
const notes = {};
for (const item of kept.slice(0, 80)) notes[String(item.id)] = Math.round(item.vote_average * 10) / 10;

writeFileSync(
  OUT,
  `${JSON.stringify({ updated: iso(today), window: `${iso(since)} → ${iso(today)}`, minVotes: MIN_VOTES, ids, notes }, null, 0)}\n`,
);

console.log(`TMDB : ${found.length} films récupérés sur ${pages} pages`);
console.log(`dans le catalogue : ${kept.length}`);
console.log(`écrit : ${ids.length} ids dans src/data/top.json`);
console.log("tête de liste :");
for (const item of kept.slice(0, 10)) {
  console.log(`  ${item.vote_average.toFixed(1)} · ${item.title} (${item.id}) · ${item.release_date}`);
}
