// Harvests the actual Moviez catalogue through /api/browse.
//
// The API has no dump endpoint: browse is paginated (limit maxes at 120) and
// offset walks it. Everything returned is already playable, which is why this
// is better than guessing TMDB ids.
//
// Run: node scripts/harvest.mjs [maxPagesPerKind]
import { mkdir, writeFile } from "node:fs/promises";

// 120 items per page. Movies go much deeper than series: the API serves ~38 000
// movie rows but only ~11 000 tv rows, so the series harvest stops on its own.
const PAGES = { movie: Number(process.argv[2] ?? 60), tv: Number(process.argv[3] ?? 60) };
const STEP = 120;
const CONCURRENCY = 6;

await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });

async function fetchPage(kind, offset) {
  const url = `https://api.moviez.ac/api/browse?kind=${kind}&limit=${STEP}&offset=${offset}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).items ?? [];
    } catch (error) {
      if (attempt === 2) {
        console.warn(`  ! ${kind} offset ${offset}: ${error.message}`);
        return [];
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return [];
}

for (const kind of ["movie", "tv"]) {
  const maxPages = PAGES[kind];
  const offsets = Array.from({ length: maxPages }, (_, i) => i * STEP);
  const items = [];
  let cursor = 0;
  let ended = false; // past the last page: stop asking, the worker keeps the others busy
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < offsets.length && !ended) {
      const offset = offsets[cursor++];
      const page = await fetchPage(kind, offset);
      items.push(...page);
      if (items.length % 6000 < page.length) console.log(`  ${kind}: ${items.length} lignes (offset ${offset})`);
      if (page.length === 0) {
        ended = true;
        console.log(`  ${kind}: fin du catalogue à l'offset ${offset}`);
      }
    }
  });
  await Promise.all(workers);

  const seen = new Set();
  const unique = items.filter((item) => {
    const key = `${item.kind}:${item.source_id}`;
    if (!item.source_id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const withPoster = unique.filter((i) => i.poster && i.year);
  console.log(
    `${kind}: ${items.length} lignes → ${unique.length} uniques → ${withPoster.length} avec affiche + année`,
  );
  await writeFile(new URL(`../.cache/browse-${kind}.json`, import.meta.url), JSON.stringify(unique));
}

console.log("catalogue brut dans .cache/");
