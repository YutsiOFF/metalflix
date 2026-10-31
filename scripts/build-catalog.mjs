// Builds src/data/catalog.json from the live Moviez /api/check responses.
//
// The Moviez API has no search/list endpoint: it is addressed by TMDB id. So the
// catalogue is a curated set of ids, and every title/poster/year comes from the
// API itself (never hand-written), which keeps the site honest if a title moves.
//
// Run: node scripts/build-catalog.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

const verified = [
  ...JSON.parse(await readFile(new URL("./verify-results.json", import.meta.url), "utf8")),
  ...JSON.parse(await readFile(new URL("./verify-results2.json", import.meta.url), "utf8")),
];

const byId = new Map();
for (const item of verified) {
  if (!item.available || !item.title || !item.poster) continue;
  // Keep the first hit per id (batch 1 wins over batch 2).
  if (!byId.has(item.id)) byId.set(item.id, item);
}

// Curated category per id. Anything not listed here is left out on purpose:
// some ids resolve to a different film than intended (TMDB movie/TV id spaces
// collide), so the catalogue is an explicit pick, not "everything that answered".
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

// Titles that read badly out of context in French UI.
const RENAME = {
  11: "La Guerre des étoiles",
  4689: "Sympathy for Mister Vengeance",
};

const LANGS = ["vf", "vo", "vostfr", "multi"];

const catalog = [];
for (const [category, ids] of Object.entries(PICKS)) {
  for (const id of ids) {
    const hit = byId.get(id);
    if (!hit) {
      console.warn(`! ${category}: id ${id} introuvable dans les résultats vérifiés`);
      continue;
    }
    const languages = (hit.languages || [])
      .map((l) => String(l).toLowerCase())
      .filter((l) => LANGS.includes(l))
      .sort((a, b) => LANGS.indexOf(a) - LANGS.indexOf(b));

    catalog.push({
      id: hit.id,
      title: RENAME[hit.id] ?? hit.title,
      year: hit.year ?? null,
      type: hit.detectedType,
      category,
      // The animated catalogue section decides the badge, not the API's optional flag.
      anime: category === "anime",
      seasons: hit.detectedType === "series" ? hit.seasons ?? null : null,
      languages: languages.length ? languages : ["vf"],
      poster: hit.poster,
    });
  }
}

// De-duplicate (an id picked twice) and sort newest first inside each category.
const seen = new Set();
const clean = catalog
  .filter((item) => (seen.has(item.id) ? false : seen.add(item.id)))
  .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title, "fr"));

await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../src/data/catalog.json", import.meta.url), JSON.stringify(clean, null, 2) + "\n");

const counts = clean.reduce((acc, item) => ({ ...acc, [item.category]: (acc[item.category] ?? 0) + 1 }), {});
console.log(`catalogue: ${clean.length} titres`, counts);
