// What does the sibnet link of an episode actually return?
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const seasonUrl = "https://anime-sama.to/catalogue/one-piece/saison1/vostfr/";

const page = await (await fetch(seasonUrl, { headers: { "user-agent": UA, referer: "https://anime-sama.to/" } })).text();
const file = /["']([^"']*(?:episodes|eps)[0-9]*\.js[^"']*)["']/.exec(page)?.[1];
const eps = await (
  await fetch(new URL(file, seasonUrl).toString(), { headers: { "user-agent": UA, referer: seasonUrl } })
).text();

for (const [, body] of eps.matchAll(/(?:var|let|const)\s+\w+\s*=\s*\[([\s\S]*?)\]/g)) {
  const urls = [...body.matchAll(/['"](https?:\/\/[^'"]+)['"]/g)].map((m) => m[1]);
  if (!urls.length) continue;
  console.log(`tableau: ${urls.length} liens · premier ${urls[0]}`);
}

const sibnet = [...eps.matchAll(/['"](https?:\/\/[^'"]*sibnet[^'"]*)['"]/g)].map((m) => m[1])[0];
console.log("lien sibnet:", sibnet);

if (sibnet) {
  for (const [label, headers] of [
    ["sans referer", { "user-agent": UA }],
    ["referer anime-sama", { "user-agent": UA, referer: "https://anime-sama.to/" }],
    ["referer sibnet", { "user-agent": UA, referer: "https://video.sibnet.ru/" }],
  ]) {
    const res = await fetch(sibnet, { headers });
    const text = await res.text();
    const mp4 = /(\/v\/[^"'\s]+\.mp4)/.exec(text)?.[1];
    console.log(`${label}: ${res.status}, ${text.length} o, mp4=${mp4 ?? "aucun"}`);
  }
}
