// Pulls TMDB ids from Wikidata: films and series that are well known (article
// count as a popularity proxy) plus TV anime, so the catalogue can rank what it
// harvested and sort animation into its own section.
//
// Run: node scripts/wikidata.mjs
import { mkdir, writeFile } from "node:fs/promises";

const UA = "MetalFlix/1.0 (https://github.com/YutsiOFF/metalflix)";
await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });

async function sparql(query, name) {
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("query", query);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/sparql-results+json", "user-agent": UA },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ids = [...new Set(data.results.bindings.map((b) => Number(b.tmdb.value)).filter(Number.isFinite))];
      await writeFile(new URL(`../.cache/wd-${name}.json`, import.meta.url), JSON.stringify(ids));
      console.log(`${name}: ${ids.length} ids`);
      return ids;
    } catch (error) {
      console.warn(`${name} tentative ${attempt + 1}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  return [];
}

// Films then series, each ranked by how many Wikipedia articles point at them.
await sparql(
  `SELECT ?tmdb WHERE {
     ?item wdt:P4947 ?tmdb .
     ?item wikibase:sitelinks ?sl .
     FILTER(?sl >= 25)
   } LIMIT 12000`,
  "films",
);

await sparql(
  `SELECT ?tmdb WHERE {
     ?item wdt:P4983 ?tmdb .
     ?item wikibase:sitelinks ?sl .
     FILTER(?sl >= 10)
   } LIMIT 12000`,
  "series",
);

// Anime: no single Wikidata statement covers the genre, so union what does
// resolve — "anime television series", the anime class itself, Japanese
// animation, and an explicit anime genre. Together they classify ~4 000 shows.
const anime = new Set();
for (const [index, query] of [
  `SELECT ?tmdb WHERE { ?item wdt:P31 wd:Q63952888 . ?item wdt:P4983 ?tmdb } LIMIT 8000`,
  `SELECT ?tmdb WHERE { ?item wdt:P31 wd:Q1107 . ?item wdt:P4983 ?tmdb } LIMIT 8000`,
  `SELECT ?tmdb WHERE { ?item wdt:P495 wd:Q17 ; wdt:P136 wd:Q202866 ; wdt:P4983 ?tmdb } LIMIT 8000`,
  `SELECT ?tmdb WHERE { ?item wdt:P136 wd:Q1107 ; wdt:P4983 ?tmdb } LIMIT 8000`,
].entries()) {
  for (const id of await sparql(query, `anime-${index}`)) anime.add(id);
}
await writeFile(new URL("../.cache/wd-anime.json", import.meta.url), JSON.stringify([...anime]));
console.log(`anime: ${anime.size} ids`);
