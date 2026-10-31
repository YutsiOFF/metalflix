// Builds src/data/catalog.json from what the Moviez API actually serves.
//
// Two sources, merged:
//  1. the curated picks verified earlier (they carry hand-checked types, and
//     some TMDB movie/TV ids collide so those must stay explicit);
//  2. the bulk harvest of /api/browse (.cache/browse-*.json).
//
// Rows are emitted as compact tuples to keep the bundle small:
//   [tmdbId, title, year, code, posterPath]  with code 0=film 1=série 2=anime
//
// Run: node scripts/wikidata.mjs && node scripts/harvest.mjs && node scripts/build-catalog.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  } catch {
    return fallback;
  }
}

const verified = [
  ...(await readJson("./verify-results.json", [])),
  ...(await readJson("./verify-results2.json", [])),
];

const byId = new Map();
for (const item of verified) {
  if (!item.available || !item.title || !item.poster) continue;
  if (!byId.has(item.id)) byId.set(item.id, item);
}

// Curated picks. Anything not listed is left to the harvest.
const PICKS = {
  film: [
    11, 12, 13, 24, 98, 120, 121, 122, 129, 155, 238, 278, 329, 393, 550, 557, 559, 585, 603, 604,
    605, 680, 744, 808, 809, 812, 862, 920, 9806, 10138, 10191, 10681, 14160, 1724, 1726, 1891,
    1892, 1991, 19995, 24428, 27205, 273248, 4689, 1402, 245891, 324552, 458156, 603692, 271110,
    284053, 284054, 299534, 299536, 315635, 324857, 569094, 634649, 497698, 505642, 453395, 566525,
    616037, 640146, 99861, 118340, 140607, 438631, 693134, 157336, 76341, 361743, 502356, 475557,
    68718, 522627, 396535, 496243, 872906, 872585, 346698, 414906, 298618, 436270, 399566, 545611,
    354912, 150540, 1022789, 508442, 508943, 508439, 508947, 568124, 277834, 269149, 330457, 109445,
    8587, 976573, 1184918, 532639, 228326, 629542, 49051, 57158, 76600, 533535, 402431, 558449,
    1241982, 945961, 786892, 653346, 823464, 573435, 1011985, 912649, 939243, 936075,
  ],
  serie: [
    456, 1399, 1418, 1434, 1668, 2190, 2316, 46648, 48866, 60059, 60574, 60625, 60735, 61889, 63174,
    63333, 65494, 66732, 69050, 69740, 70523, 71446, 71912, 75006, 76479, 82856, 84958, 87108,
    87739, 88396, 91363, 92749, 94605, 94997, 95396, 95557, 106379, 108978, 114461, 136315, 1421,
    1100, 19885, 71728, 93405, 1416, 1411, 105248,
  ],
  anime: [
    12971, 30984, 31910, 37854, 46298, 61663, 62715, 65930, 85937, 95479, 209867, 114410, 94664,
    30991, 13916, 120089, 207332, 127532,
  ],
};

const RENAME = { 11: "La Guerre des étoiles" };

const notableFilms = new Set(await readJson("../.cache/wd-films.json", []));
const notableSeries = new Set(await readJson("../.cache/wd-series.json", []));
const animeIds = new Set(await readJson("../.cache/wd-anime.json", []));

const movies = await readJson("../.cache/browse-movie.json", []);
const shows = await readJson("../.cache/browse-tv.json", []);

const posterPath = (url) => String(url).replace(/^https?:\/\/image\.tmdb\.org\/t\/p\/w\d+\//, "");

const seen = new Set();
const rows = [];

for (const [category, ids] of Object.entries(PICKS)) {
  const code = category === "film" ? 0 : category === "serie" ? 1 : 2;
  for (const id of ids) {
    const hit = byId.get(id);
    if (!hit || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      title: RENAME[id] ?? hit.title,
      year: hit.year ?? 0,
      code,
      poster: posterPath(hit.poster),
      notable: true,
    });
  }
}

for (const item of [...movies, ...shows]) {
  const id = Number(item.source_id);
  if (!id || seen.has(id) || !item.poster || !item.year || !item.title) continue;
  seen.add(id);
  const isTv = item.kind === "tv";
  rows.push({
    id,
    title: item.title,
    year: item.year,
    code: isTv ? (animeIds.has(id) ? 2 : 1) : 0,
    poster: posterPath(item.poster),
    notable: isTv ? notableSeries.has(id) : notableFilms.has(id),
  });
}

// Recognisable titles first, then newest; the bundle keeps no popularity field.
rows.sort((a, b) => Number(b.notable) - Number(a.notable) || b.year - a.year || a.title.localeCompare(b.title, "fr"));

const compact = rows.map((row) => [row.id, row.title, row.year, row.code, row.poster]);
const json = JSON.stringify(compact);

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/data/catalog.json", import.meta.url), json + "\n");

const counts = rows.reduce(
  (acc, row) => ({ ...acc, [["film", "serie", "anime"][row.code]]: (acc[["film", "serie", "anime"][row.code]] ?? 0) + 1 }),
  {},
);
console.log(`catalogue: ${rows.length} titres`, counts);
console.log(`taille: ${(json.length / 1024).toFixed(0)} Kio · notables: ${rows.filter((r) => r.notable).length}`);
