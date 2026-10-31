const tests = [
  "/api/browse",
  "/api/browse?limit=500",
  "/api/browse?limit=2000",
  "/api/browse?page=2",
  "/api/browse?offset=60",
  "/api/browse?kind=movie",
  "/api/browse?kind=tv",
  "/api/browse?q=dune",
  "/api/browse?sort=year",
  "/api/browse?limit=60&page=3",
  "/api/list?limit=1000",
  "/api/list?kind=movie",
];
for (const t of tests) {
  try {
    const r = await fetch("https://api.moviez.ac" + t, { headers: { accept: "application/json" } });
    const j = await r.json();
    const items = j.items ?? [];
    const first = items[0] ?? {};
    console.log(
      `${String(r.status)} ${t}\n    count=${j.count} items=${items.length} next=${j.next ?? j.cursor ?? j.total ?? "-"} first=${first.kind}:${first.source_id}:${String(first.title).slice(0, 28)} poster=${first.poster ? "oui" : "non"}`
    );
  } catch (e) {
    console.log(`ERR ${t} ${e.message}`);
  }
}
