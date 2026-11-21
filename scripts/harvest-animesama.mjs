// Harvests the Anime-Sama catalogue (anime-sama.to/catalogue/?page=N).
//
// The site is server-rendered: every card carries the slug, the display name
// and the poster in data attributes, so no browser is needed. The list is used
// to recognise anime titles that the TMDB/Wikidata pass missed — the stream
// players themselves (uqload, ansembed) are ad-sponsored iframes and are not
// touched here.
//
// Run: node scripts/harvest-animesama.mjs [maxPages]
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://anime-sama.to/catalogue/";
const PAGES = Number(process.argv[2] ?? 60);
const CONCURRENCY = 4;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

await mkdir(new URL("../.cache/", import.meta.url), { recursive: true });

const CARD = /data-url="\/catalogue\/([^"]+?)\/?" data-cat="([^"]*)" data-nom="([^"]*)" data-img="([^"]*)"/g;

function decode(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchPage(page) {
  const url = page === 1 ? BASE : `${BASE}?page=${page}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html", "accept-language": "fr-FR,fr;q=0.9" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      if (attempt === 2) {
        console.warn(`  ! page ${page}: ${error.message}`);
        return "";
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return "";
}

const bySlug = new Map();
let cursor = 1;
let ended = false;

const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (cursor <= PAGES && !ended) {
    const page = cursor++;
    const html = await fetchPage(page);
    if (!html) continue;
    const found = [...html.matchAll(CARD)];
    if (!found.length) {
      // Past the last page the site repeats the same cards: stop there.
      ended = true;
      console.log(`  fin du catalogue à la page ${page}`);
      continue;
    }
    for (const [, slug, cat, name, img] of found) {
      if (cat !== "oeuvre") continue;
      bySlug.set(slug, { slug, name: decode(name), cover: decode(img) });
    }
    if (page % 5 === 0) console.log(`  page ${page}: ${bySlug.size} animes`);
  }
});

await Promise.all(workers);

const items = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
await writeFile(new URL("../.cache/animesama.json", import.meta.url), JSON.stringify(items));
console.log(`Anime-Sama : ${items.length} animes → .cache/animesama.json`);
