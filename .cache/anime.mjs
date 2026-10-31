import { writeFile } from "node:fs/promises";
const UA = "MetalFlix/1.0 (https://github.com/YutsiOFF/metalflix)";
const queries = {
  animeTvSeries: `SELECT ?tmdb WHERE { ?item wdt:P31 wd:Q63952888 . ?item wdt:P4983 ?tmdb } LIMIT 8000`,
  animeInstance: `SELECT ?tmdb WHERE { ?item wdt:P31 wd:Q1107 . ?item wdt:P4983 ?tmdb } LIMIT 8000`,
  japanAnimation: `SELECT ?tmdb WHERE { ?item wdt:P495 wd:Q17 ; wdt:P136 wd:Q202866 ; wdt:P4983 ?tmdb } LIMIT 8000`,
  animeGenre: `SELECT ?tmdb WHERE { ?item wdt:P136 wd:Q1107 . ?item wdt:P4983 ?tmdb } LIMIT 8000`,
};
const all = new Set();
for (const [name, query] of Object.entries(queries)) {
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("query", query);
  try {
    const res = await fetch(url, { headers: { accept: "application/sparql-results+json", "user-agent": UA }, signal: AbortSignal.timeout(120000) });
    const data = await res.json();
    const ids = [...new Set(data.results.bindings.map((b) => Number(b.tmdb.value)).filter(Number.isFinite))];
    ids.forEach((id) => all.add(id));
    console.log(`${name}: ${ids.length}`);
  } catch (e) { console.log(`${name}: ERREUR ${e.message}`); }
}
await writeFile(".cache/wd-anime.json", JSON.stringify([...all]));
console.log(`anime total: ${all.size}`);
