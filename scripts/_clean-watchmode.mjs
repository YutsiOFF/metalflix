/**
 * One-off removal of the Watchmode integration. Every cut is asserted.
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";

function must(text, needle, where) {
  const at = text.indexOf(needle);
  if (at < 0) throw new Error(`marqueur introuvable (${where}): ${needle.slice(0, 60)}`);
  return at;
}

function cut(text, from, to, where) {
  const start = must(text, from, where);
  const end = text.indexOf(to, start + from.length);
  if (end < 0) throw new Error(`fin introuvable (${where})`);
  return text.slice(0, start) + text.slice(end);
}

function drop(text, needle, where) {
  must(text, needle, where);
  return text.split(needle).join("");
}

// ------------------------------------------------------------------- Worker
const workerPath = "proxy/worker.js";
let worker = readFileSync(workerPath, "utf8");
worker = cut(worker, "/**\n * Watchmode: where a title", "export default {", "bloc Watchmode du Worker");
worker = drop(worker, `    if (path === "/wm") return watchmode(url, env);\n`, "route /wm");
worker = worker.replace("async fetch(request, env) {", "async fetch(request) {");
writeFileSync(workerPath, worker);

// -------------------------------------------------------------- PlayerModal
const playerPath = "src/components/PlayerModal.tsx";
let player = readFileSync(playerPath, "utf8");
player = drop(player, `import { WATCH_KIND, watchSources, type WatchSource } from "../lib/watchmode";\n`, "import client");
player = drop(
  player,
  `  // Legal availability, so a title the source does not carry still leads
  // somewhere: null while it loads, an empty list when nothing is listed.
  const [where, setWhere] = useState<WatchSource[] | null>(null);
`,
  "état where",
);
player = cut(player, "  // Where the title actually is, in France.", "  // The Cast SDK downloads", "effet Watchmode");
player = cut(player, "\n          {where?.length ? (", "        </aside>", "bloc de la fiche");
writeFileSync(playerPath, player);

// ------------------------------------------------------------------- styles
const stylePath = "src/styles.css";
const css = readFileSync(stylePath, "utf8");
const marker = "\n/* =====================================================================\n   « Où le regarder »";
writeFileSync(stylePath, `${css.slice(0, must(css, marker, "bloc CSS")).trimEnd()}\n`);

// -------------------------------------------------------------------- README
const readmePath = "README.md";
const readme = readFileSync(readmePath, "utf8");
writeFileSync(readmePath, cut(readme, "## Où le regarder", "## Construire le catalogue", "section README"));

// --------------------------------------------------------------------- files
rmSync("src/lib/watchmode.ts");
rmSync(".watchmode-key");
console.log("Watchmode retiré : Worker, PlayerModal, styles.css, README, lib, clé locale");
