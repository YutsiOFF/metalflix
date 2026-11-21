// Remplit les trous du catalogue : /api/browse rend parfois une ligne sans
// affiche ou sans année, et le build la jette — alors que /api/check connaît la
// fiche complète. Ce sont des séries et des films déjà jouables, donc autant les
// récupérer que les perdre.
//
// Run: node scripts/fill-gaps.mjs
import { readFile, writeFile } from "node:fs/promises";

const CONCURRENCY = 14;

async function readJson(relative, fallback) {
  try {
    return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
  } catch {
    return fallback;
  }
}

const files = ["../.cache/browse-movie.json", "../.cache/browse-tv.json"];
let patched = 0;
let failed = 0;

for (const file of files) {
  const rows = await readJson(file, []);
  const holes = rows.filter((item) => item.source_id && (!item.poster || !item.year || !item.title));
  console.log(`${file}: ${holes.length} lignes incomplètes`);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < holes.length) {
        const item = holes[cursor++];
        try {
          const res = await fetch(`https://api.moviez.ac/api/check/${item.source_id}`);
          if (!res.ok) {
            failed += 1;
            continue;
          }
          const data = await res.json();
          if (!data?.available) {
            failed += 1;
            continue;
          }
          if (!item.poster && data.poster) item.poster = data.poster;
          if (!item.year && data.year) item.year = Number(data.year);
          if (!item.title && data.title) item.title = data.title;
          if (item.poster && item.year && item.title) patched += 1;
        } catch {
          failed += 1;
        }
      }
    }),
  );

  await writeFile(new URL(file, import.meta.url), JSON.stringify(rows));
}

console.log(`complétées : ${patched} · laissées de côté : ${failed}`);
