// Films Moviez sait lire mais que /api/browse ne liste pas encore.
//
// browse est un instantané paginé : une sortie récente arrive dans /api/check
// avant d'apparaître dans le catalogue feuilleté, donc elle manquait au site.
// TMDB donne les sorties récentes, /api/check dit lesquelles sont réellement
// lisibles, et seules celles-là sont gardées — un titre que Moviez refuse
// n'aurait rien à faire dans la grille.
//
// Run: node scripts/extra-films.mjs [pagesParAnnée]
import { mkdir, readFile, writeFile } from "node:fs/promises";

const PAGES = Number(process.argv[2] ?? 40);
const YEARS = [2026, 2025, 2024];
const CONCURRENCY = 12;

await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });

async function readJson(relative, fallback) {
  try {
    return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
  } catch {
    return fallback;
  }
}

let key = process.env.TMDB_KEY ?? "";
if (!key) {
  try {
    key = (await readFile(new URL("../.cache/tmdb-key", import.meta.url), "utf8")).trim();
  } catch {
    // garde plus bas
  }
}
if (!key) {
  console.error("clé TMDB absente : mets-la dans .cache/tmdb-key ou TMDB_KEY=…");
  process.exit(1);
}

const catalogue = [
  ...(await readJson("../src/data/catalog.json", [])),
  ...(await readJson("../src/data/catalog-rest.json", [])),
];
const known = new Set(catalogue.map((row) => Number(row[0])));
const previous = await readJson("../.cache/extra-films.json", []);
const extras = new Map(previous.map((item) => [Number(item.id), item]));
console.log(`catalogue ${known.size} ids · ${extras.size} extras déjà connus`);

/** TMDB discover, en français : le titre renvoyé est celui que cherche le public. */
async function tmdb(path) {
  const join = path.includes("?") ? "&" : "?";
  const url = `https://api.themoviedb.org/3${path}${join}language=fr-FR&api_key=${key}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).results ?? [];
    } catch (error) {
      if (attempt === 2) {
        console.warn(`  ! ${path} : ${error.message}`);
        return [];
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return [];
}

const candidates = new Map();
const add = (item) => {
  const id = Number(item.id);
  if (!id || known.has(id) || candidates.has(id)) return;
  candidates.set(id, {
    id,
    title: item.title || item.original_title || "",
    original: item.original_title || "",
    year: Number((item.release_date || "").slice(0, 4)) || 0,
  });
};

for (const year of YEARS) {
  for (let page = 1; page <= PAGES; page++) {
    for (const item of await tmdb(`/discover/movie?sort_by=popularity.desc&primary_release_year=${year}&page=${page}`)) {
      add(item);
    }
  }
  console.log(`  ${year}: ${candidates.size} candidats`);
}

// Les listes éditoriales ratissent plus large que « populaire par année ».
for (const [path, pages] of [
  ["/movie/popular", 20],
  ["/movie/now_playing", 5],
  ["/movie/upcoming", 5],
  ["/discover/movie?sort_by=popularity.desc&with_original_language=fr", 20],
]) {
  for (let page = 1; page <= pages; page++) {
    for (const item of await tmdb(`${path}${path.includes("?") ? "&" : "?"}page=${page}`)) add(item);
  }
}
console.log(`candidats hors catalogue : ${candidates.size}`);

const list = [...candidates.values()];
let cursor = 0;
let added = 0;

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < list.length) {
      const candidate = list[cursor++];
      let data;
      try {
        const res = await fetch(`https://api.moviez.ac/api/check/${candidate.id}`);
        if (!res.ok) continue;
        data = await res.json();
      } catch {
        continue;
      }
      if (!data?.available || data.detectedType === "series" || !data.poster) continue;
      const title = data.title || candidate.title;
      extras.set(candidate.id, {
        id: candidate.id,
        title,
        year: data.year || candidate.year,
        poster: data.poster,
        // Le titre TMDB reste cherchable quand Moviez en renvoie un autre.
        alt: candidate.title && candidate.title !== title ? candidate.title : undefined,
      });
      added += 1;
    }
  }),
);

const rows = [...extras.values()].sort((a, b) => b.year - a.year || a.title.localeCompare(b.title, "fr"));
await writeFile(new URL("../.cache/extra-films.json", import.meta.url), JSON.stringify(rows));
console.log(`extras: +${added} cette passe · ${rows.length} films au total → .cache/extra-films.json`);
