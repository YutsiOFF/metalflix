// French titles for the whole catalogue.
//
// /api/browse hands out whatever title the source file happens to carry, and for
// a lot of catalogue entries that is the English one: "Tangled" for Raiponce,
// "Moana" for Vaiana. Nothing then finds them by the name French viewers know,
// which makes the catalogue look like it is missing the Disney classics when it
// actually carries them. TMDB knows both titles, so the French one is fetched
// once per id and baked into the build; the source title stays as a search
// alias.
//
// Run: node scripts/titles-fr.mjs [maxTitles]   (resumes from .cache/titles-fr.json)
import { mkdir, readFile, writeFile } from "node:fs/promises";

const REGION_LANG = "fr-FR";
const CONCURRENCY = 32;

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
    // handled below
  }
}
if (!key) {
  console.error("clé TMDB absente : mets-la dans .cache/tmdb-key ou TMDB_KEY=…");
  process.exit(1);
}

const rows = [
  ...(await readJson("../src/data/catalog.json", [])),
  ...(await readJson("../src/data/catalog-rest.json", [])),
];

const targets = [];
const seen = new Set();
for (const [id, , , code] of rows) {
  // Anime-Sama rows carry a synthetic id: they are not TMDB titles.
  if (!id || id >= 900_000_000 || seen.has(id)) continue;
  seen.add(id);
  targets.push({ id, kind: code === 0 ? "movie" : "tv" });
}

const previous = await readJson("../.cache/titles-fr.json", {});
const titles = new Map(Object.entries(previous).map(([id, value]) => [Number(id), value]));

const limit = Number(process.argv[2] ?? 0);
const queue = (limit ? targets.slice(0, limit) : targets).filter((item) => !titles.has(item.id));
console.log(`${queue.length} titres à interroger · ${titles.size} déjà connus`);

async function fetchTitle(id, kind) {
  const url = `https://api.themoviedb.org/3/${kind}/${id}?api_key=${key}&language=${REGION_LANG}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 404) return null; // wrong kind for this id
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const title = data.title ?? data.name ?? "";
      const original = data.original_title ?? data.original_name ?? "";
      return { t: title, o: original && original !== title ? original : undefined };
    } catch (error) {
      if (attempt === 3) {
        console.warn(`  ! ${kind}/${id}: ${error.message}`);
        return undefined;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return undefined;
}

async function save() {
  await writeFile(
    new URL("../.cache/titles-fr.json", import.meta.url),
    JSON.stringify(Object.fromEntries(titles)),
  );
}

let done = 0;
let cursor = 0;

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < queue.length) {
      const { id, kind } = queue[cursor++];
      let value = await fetchTitle(id, kind);
      if (value === null) value = (await fetchTitle(id, kind === "movie" ? "tv" : "movie")) ?? { t: "" };
      if (value === undefined) continue; // network hiccup: retried on the next run
      titles.set(id, value);
      done += 1;
      if (done % 2000 === 0) {
        await save();
        console.log(`  ${done}/${queue.length}`);
      }
    }
  }),
);

await save();
const renamed = [...titles.values()].filter((value) => value.t).length;
console.log(`titres français: ${titles.size} interrogés · ${renamed} avec un titre`);
