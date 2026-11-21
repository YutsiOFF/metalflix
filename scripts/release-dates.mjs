// Vraies dates de sortie des titres récents.
//
// Le catalogue reprend l'année que l'API annonce, et pour un film seulement
// annoncé (une suite pas encore tournée, par exemple) cette année est une
// projection : le titre se retrouvait dans « Nouveautés » avec une date qui
// n'existe pas. TMDB connaît la date réelle, alors on la relève une fois pour
// toutes et le site s'en sert pour afficher l'année juste et pour laisser les
// titres pas encore sortis hors des nouveautés.
//
// Run: node scripts/release-dates.mjs [premièreAnnée]
import { readFile, writeFile } from "node:fs/promises";

const FROM_YEAR = Number(process.argv[2] ?? 2022);
const CONCURRENCY = 40;

async function readJson(relative, fallback) {
  try {
    return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
  } catch {
    return fallback;
  }
}

let key = process.env.TMDB_KEY ?? "";
if (!key) {
  try {
    key = (await readFile(new URL("../.cache/tmdb-key", import.meta.url), "utf8")).trim();
  } catch {
    // message plus bas
  }
}
if (!key) {
  console.error("clé TMDB absente : mets-la dans .cache/tmdb-key ou TMDB_KEY=…");
  process.exit(1);
}

const rows = [
  ...(await readJson("../src/data/catalog.json", [])),
  ...(await readJson("../src/data/catalog-rest.json", [])),
];

// id → type, la dernière écriture gagne : un même nombre peut vivre dans les
// deux espaces d'identifiants de TMDB (film et série), le catalogue tranche.
// La clé porte le type : un même nombre existe dans les deux espaces
// d'identifiants de TMDB (le film 550 et la série 550 ne sont pas le même
// titre), et sans cela une date de film écrasait l'année d'une série.
const targets = new Map();
for (const row of rows) {
  const id = Number(row[0]);
  const year = Number(row[2]);
  if (!id || !year || year < FROM_YEAR) continue;
  const code = Number(row[3]) || 0;
  targets.set(`${code}:${id}`, { id, year, code });
}

const list = [...targets.values()];
console.log(`${list.length} titres depuis ${FROM_YEAR} à vérifier`);

const dates = {};
const pending = [];
let cursor = 0;
let done = 0;

async function lookup({ id, code }) {
  const kind = code === 0 ? "movie" : "tv";
  const url = `https://api.themoviedb.org/3/${kind}/${id}?language=fr-FR&api_key=${key}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return (kind === "movie" ? data.release_date : data.first_air_date) || "";
    } catch {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return null;
}

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < list.length) {
      const target = list[cursor++];
      const date = await lookup(target);
      done += 1;
      if (done % 500 === 0) console.log(`  ${done}/${list.length}`);
      if (date === null) continue;
      const key = `${target.code}:${target.id}`;
      if (date) dates[key] = date;
      // Une date vide n'est pas une erreur : le titre est annoncé, pas sorti.
      else pending.push(key);
    }
  }),
);

const payload = { updated: new Date().toISOString().slice(0, 10), dates, pending };
await writeFile(new URL("../src/data/releases.json", import.meta.url), JSON.stringify(payload) + "\n");
console.log(
  `dates: ${Object.keys(dates).length} relevées · ${pending.length} titres sans date de sortie → src/data/releases.json`,
);
