// Streaming platforms (France), keyed by TMDB id, stored as a bitmask.
//
// Neither /api/browse nor /api/check says where a title streams, so the site
// asks TMDB's "watch providers" once per title and bakes the answer into the
// catalogue. The key stays in .cache/tmdb-key (git-ignored) and is only used
// here: nothing at runtime calls TMDB.
//
// Providers kept, in bit order — must match src/lib/catalog.ts:
//   0 Netflix · 1 Prime Video · 2 Disney+ · 3 Paramount+ · 4 Canal+ · 5 Apple TV+
//
// Adding a provider means every stored mask only carries the old bits, so the
// cached answers have to be rebuilt: force a pass with FORCE=1.
//
// Run: node scripts/providers.mjs [maxTitles]   (FORCE=1 to re-ask everything)
import { mkdir, readFile, writeFile } from "node:fs/promises";

const REGION = "FR";
export const PLATFORMS = [
  ["netflix", "Netflix", 8],
  ["prime", "Prime Video", 119],
  ["disney", "Disney+", 337],
  ["paramount", "Paramount+", 531],
  ["canal", "Canal+", 381],
  ["appletv", "Apple TV+", 350],
];
const FORCE = process.env.FORCE === "1";
const BIT = new Map(PLATFORMS.map(([, , id], index) => [id, index]));

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
    // falls through to the guard below
  }
}
if (!key) {
  console.error("clé TMDB absente : mets-la dans .cache/tmdb-key ou TMDB_KEY=…");
  process.exit(1);
}

const HEAD = (await readJson("../src/data/catalog.json", [])).length ? "../src/data/catalog.json" : null;
const rows = [
  ...(await readJson("../src/data/catalog.json", [])),
  ...(await readJson("../src/data/catalog-rest.json", [])),
];

// code 0 = film, 1 = série, 2 = anime (TMDB côté télévision dans la majorité des cas).
const targets = [];
const seen = new Set();
for (const [id, , , code] of rows) {
  if (!id || seen.has(id)) continue;
  seen.add(id);
  targets.push({ id, kind: code === 0 ? "movie" : "tv" });
}

const limit = Number(process.argv[2] ?? 0);
const queue = limit ? targets.slice(0, limit) : targets;

const previous = await readJson("../.cache/providers.json", { masks: {} });
const masks = new Map(Object.entries(previous.masks ?? {}).map(([id, mask]) => [Number(id), Number(mask)]));
console.log(`${queue.length} titres à interroger · ${masks.size} déjà connus${HEAD ? "" : " · catalogue absent"}`);

async function providersOf(id, kind) {
  const url = `https://api.themoviedb.org/3/${kind}/${id}/watch/providers?api_key=${key}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      // A TMDB id is one kind or the other: the wrong endpoint answers 404.
      if (res.status === 404) return null;
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const fr = body.results?.[REGION] ?? {};
      const offers = [...(fr.flatrate ?? []), ...(fr.ads ?? [])];
      let mask = 0;
      for (const offer of offers) {
        const bit = BIT.get(offer.provider_id);
        if (bit !== undefined) mask |= 1 << bit;
      }
      return mask;
    } catch (error) {
      if (attempt === 3) {
        console.warn(`  ! ${kind}/${id}: ${error.message}`);
        return undefined;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return undefined;
}

let done = 0;
let hits = 0;
let cursor = 0;
const CONCURRENCY = 24;

async function save() {
  const payload = {
    version: 1,
    region: REGION,
    keys: PLATFORMS.map(([sku]) => sku),
    providers: Object.fromEntries(PLATFORMS.map(([sku, label, id]) => [sku, { label, id }])),
    masks: Object.fromEntries([...masks].map(([id, mask]) => [id, mask])),
  };
  await writeFile(new URL("../.cache/providers.json", import.meta.url), JSON.stringify(payload));
}

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < queue.length) {
      const { id, kind } = queue[cursor++];
      if (masks.has(id) && !FORCE) {
        done += 1;
        continue;
      }
      let mask = await providersOf(id, kind);
      if (mask === null) mask = (await providersOf(id, kind === "movie" ? "tv" : "movie")) ?? 0;
      if (mask === undefined) continue; // network hiccup: retried on the next run
      masks.set(id, mask);
      if (mask) hits += 1;
      done += 1;
      if (done % 1000 === 0) {
        await save();
        console.log(`  ${done}/${queue.length} · ${hits} sur une plateforme`);
      }
    }
  }),
);

await save();
console.log(`plateformes: ${masks.size} titres vérifiés · ${[...masks.values()].filter(Boolean).length} sur au moins une`);
