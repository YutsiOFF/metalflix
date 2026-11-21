// One-off probe: what do Anime-Sama's players actually expose?
//
// For a handful of anime, read the season page, its episodes.js, and then ask
// each hoster's embed page for a direct media URL. Nothing here ships with the
// site; it tells us which resolvers the Worker needs.
import { writeFile } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://anime-sama.to";
const SLUGS = ["frieren", "one-piece", "demon-slayer", "jujutsu-kaisen", "solo-leveling", "spy-x-family"];

async function get(url, referer) {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "*/*",
      "accept-language": "fr-FR,fr;q=0.9",
      ...(referer ? { referer } : {}),
    },
  });
  return { status: res.status, text: await res.text() };
}

const hosters = new Map();

for (const slug of SLUGS) {
  const seasonUrl = `${BASE}/catalogue/${slug}/saison1/vostfr/`;
  const page = await get(seasonUrl);
  if (page.status !== 200) {
    console.log(`${slug}: page ${page.status}`);
    continue;
  }
  // The file name sits in the page's own config, not always in a src attribute.
  const files = [...new Set([...page.text.matchAll(/["']((?:[^"']*\/)?episodes\.js[^"']*)["']/g)].map((m) => m[1]))];
  console.log(`\n${slug}: ${files.length} fichier(s) episodes`);
  for (const file of files) {
    const url = new URL(file, seasonUrl).toString();
    const eps = await get(url, seasonUrl);
    const links = [...new Set([...eps.text.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((v) => v.startsWith("http")))];
    for (const link of links.slice(0, 2)) {
      const host = new URL(link).host;
      hosters.set(host, (hosters.get(host) ?? 0) + 1);
    }
    console.log(`  ${url.split("/").pop()} → ${eps.status}, ${links.length} liens, ex: ${links.slice(0, 2).join(" , ")}`);
  }
}

console.log("\nHébergeurs vus:", [...hosters.entries()].map(([h, n]) => `${h} (${n})`).join(", "));

// Then: ask one embed page per hoster for a direct media URL.
const samples = new Map();
for (const slug of SLUGS) {
  const seasonUrl = `${BASE}/catalogue/${slug}/saison1/vostfr/`;
  const page = await get(seasonUrl);
  const file = page.text.match(/["']((?:[^"']*\/)?episodes\.js[^"']*)["']/)?.[1];
  if (!file) continue;
  const eps = await get(new URL(file, seasonUrl).toString(), seasonUrl);
  const first = eps.text.match(/'([^']+)'/)?.[1];
  if (!first) continue;
  const host = new URL(first).host;
  if (samples.has(host)) continue;
  samples.set(host, first);
}

const findings = {};
for (const [host, url] of samples) {
  const res = await get(url, `${BASE}/`);
  const media = [...new Set([...res.text.matchAll(/https?:[^"'\\\s]+?\.(?:mp4|m3u8)[^"'\\\s]*/g)].map((m) => m[0]))];
  const hints = [...new Set([...res.text.matchAll(/(?:sources|file|src)\s*[:=]\s*["'][^"']{4,160}["']/g)].map((m) => m[0]))].slice(0, 4);
  findings[host] = { sample: url, status: res.status, size: res.text.length, media: media.slice(0, 3), hints };
  console.log(`\n== ${host} (${res.status}, ${res.text.length} o)`);
  console.log(`   media: ${media.slice(0, 3).join(" | ") || "aucun"}`);
  if (hints.length) console.log(`   indices: ${hints.join(" | ").slice(0, 300)}`);
}

await writeFile(new URL("../.cache/player-probe.json", import.meta.url), JSON.stringify(findings, null, 2));
