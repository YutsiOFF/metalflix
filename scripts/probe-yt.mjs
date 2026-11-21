// Sonde jetable : est-ce qu'une recherche YouTube en HTML donne un vrai trailer,
// et à quel rang ? Sert à caler le filtre avant de le porter dans le Worker.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const BAD = /(r[ée]action|reaction|critique|review|analyse|expliqu|ending|th[ée]orie|top \d|scene|sc[èe]ne culte|fan ?made|parodie|d[ée]bile)/i;
const GOOD = /(bande[- ]annonce|trailer|teaser)/i;

function hits(html) {
  const out = [];
  const re = /"videoRenderer":\{"videoId":"([\w-]{11})"/g;
  let m;
  while ((m = re.exec(html))) {
    const window = html.slice(m.index, m.index + 2600);
    const title = /"title":\{"runs":\[\{"text":"(.*?)"\}\]/.exec(window)?.[1] ?? "";
    const owner = /"ownerText":\{"runs":\[\{"text":"(.*?)"\}\]/.exec(window)?.[1] ?? "";
    const length =
      /"lengthText":\{"accessibility":\{"accessibilityData":\{"label":"(.*?)"\}\},"simpleText":"(.*?)"/.exec(window)?.[2] ??
      "";
    const decode = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"');
    out.push({ id: m[1], title: decode(title), owner: decode(owner), length });
  }
  return out;
}

async function search(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=fr&gl=FR`;
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "fr-FR,fr;q=0.9" } });
  if (!res.ok) return { status: res.status, results: [] };
  return { status: res.status, results: hits(await res.text()) };
}

const titles = [
  "Dune : Deuxième Partie",
  "Hurlevent",
  "Interstellar",
  "Le Comte de Monte-Cristo",
];

for (const title of titles) {
  const { status, results } = await search(`${title} bande annonce VF`);
  const ranked = results
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => GOOD.test(entry.title) && !BAD.test(entry.title));
  console.log(`\n=== ${title} (${status}, ${results.length} résultats)`);
  console.log(
    ranked
      .slice(0, 3)
      .map((entry) => `  #${entry.index} ${entry.id} ${entry.length} — ${entry.title} [${entry.owner}]`)
      .join("\n") || "  (rien de retenu)",
  );
  console.log(
    `  bruts : ${results
      .slice(0, 4)
      .map((entry) => `${entry.title} [${entry.owner}]`)
      .join(" | ")}`,
  );
}
