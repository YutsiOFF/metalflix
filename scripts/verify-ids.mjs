// Probes the Moviez /api/check endpoint for every candidate TMDB id and prints
// what actually resolves, so the catalogue only contains real, playable titles.
//
// Usage: node scripts/verify-ids.mjs [candidates.json] [results.json]
import { readFile, writeFile } from "node:fs/promises";

const candidateFile = process.argv[2] ?? "candidates.json";
const resultFile = process.argv[3] ?? "verify-results.json";

const candidates = JSON.parse(await readFile(new URL(candidateFile, import.meta.url), "utf8"));

const CONCURRENCY = 8;
const results = [];
let cursor = 0;

async function worker() {
  while (cursor < candidates.length) {
    const item = candidates[cursor++];
    const url = `https://api.moviez.ac/api/check/${item.id}`;
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      const data = await res.json();
      results.push({ ...item, http: res.status, ...data });
    } catch (err) {
      results.push({ ...item, http: 0, error: String(err) });
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
results.sort((a, b) => a.id - b.id);

const ok = results.filter((r) => r.available);
const bad = results.filter((r) => !r.available);

for (const r of ok) {
  const tag = r.anime ? "anime" : "     ";
  console.log(
    `OK   ${String(r.id).padStart(7)} ${String(r.detectedType).padEnd(6)} ${tag} ${String(r.year ?? "").padEnd(5)} ${r.title}   [${(r.languages || []).join(",")}${r.seasons ? `, ${r.seasons} saisons` : ""}]  (attendu: ${r.expected})`,
  );
}
console.log(`\n--- non disponibles (${bad.length}) ---`);
for (const r of bad) console.log(`KO   ${String(r.id).padStart(7)} (attendu: ${r.expected})`);

await writeFile(new URL(resultFile, import.meta.url), JSON.stringify(results, null, 2));
console.log(`\n${ok.length} OK / ${results.length} testés · écrit dans ${resultFile}`);
