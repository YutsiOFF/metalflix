// End-to-end check of the Anime-Sama player: page → master → variant → segment.
const PROXY = "https://site-23c9d24b0ff64195bb28e22f1e3c60f2.freebuff.page";

async function check(label, path) {
  const started = Date.now();
  const page = await (await fetch(PROXY + path)).text();
  const error = /class="err">([^<]*)/.exec(page)?.[1];
  const stream = /\/as\/hls\?u=[^"]+/.exec(page)?.[0];
  let result = "aucun flux";
  if (stream) {
    const master = await (await fetch(PROXY + stream)).text();
    const variantLine = master.split("\n").find((line) => line.startsWith("/as/hls?"));
    const variant = variantLine ? await (await fetch(PROXY + variantLine)).text() : "";
    const segmentLine = variant.split("\n").find((line) => line.startsWith("/as/hls?"));
    const segment = segmentLine ? await fetch(PROXY + segmentLine, { headers: { range: "bytes=0-2047" } }) : null;
    result = segment ? `segment ${segment.status} ${segment.headers.get("content-type")}` : "variante vide";
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${label.padEnd(26)} ${seconds}s · ${result}${error ? " · " + error : ""}`);
}

await check("frieren s1e1", "/as/p/frieren/saison1/vostfr/1");
await check("zombie s1e1", "/as/p/zombie-sagashitemasu/saison1/vostfr/1");
await check("zombie s1e3", "/as/p/zombie-sagashitemasu/saison1/vostfr/3");
await check("one-piece s1e1", "/as/p/one-piece/saison1/vostfr/1");
await check("jujutsu-kaisen s1e1", "/as/p/jujutsu-kaisen/saison1/vostfr/1");
await check("spy-x-family s1e1", "/as/p/spy-x-family/saison1/vostfr/1");
await check("zombie s2e1 (piste vide)", "/as/p/zombie-sagashitemasu/saison2/vostfr/1");
