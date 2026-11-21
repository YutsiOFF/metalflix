// Reads one season's episodes.js and reports the player arrays it contains.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function get(url, referer) {
  const res = await fetch(url, { headers: { "user-agent": UA, referer: referer || "https://anime-sama.to/" } });
  return { status: res.status, text: await res.text() };
}

const slug = process.argv[2] ?? "zombie-sagashitemasu";
const saison = process.argv[3] ?? "saison1";
const version = process.argv[4] ?? "vostfr";

const seasonUrl = `https://anime-sama.to/catalogue/${slug}/${saison}/${version}/`;
const page = await get(seasonUrl);
const files = [...new Set([...page.text.matchAll(/["']([^"']*(?:episodes|eps)[0-9]*\.js[^"']*)["']/g)].map((m) => m[1]))];
console.log(`${slug}/${saison}/${version}: page ${page.status}, fichiers ${files.join(" , ") || "aucun"}`);

for (const file of files) {
  const url = new URL(file, seasonUrl).toString();
  const eps = await get(url, seasonUrl);
  const groups = [...eps.text.matchAll(/(?:var|let|const)\s+(\w+)\s*=\s*\[([\s\S]*?)\]/g)];
  console.log(`  ${file} → ${eps.status}, ${groups.length} tableau(x)`);
  for (const [, name, body] of groups) {
    const urls = [...body.matchAll(/https?:\/\/[^'"]+/g)].map((m) => m[0]);
    console.log(`    ${name}: ${urls.length} liens, premier = ${urls[0] ? new URL(urls[0]).host : "—"}`);
  }
}
