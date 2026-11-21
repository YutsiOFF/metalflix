/**
 * MetalFlix player proxy.
 *
 * Moviez's viewer page carries its own ad tag, and its stream endpoint refuses
 * any origin but its own (`POST` from elsewhere → 403). This Worker serves the
 * player page from its own origin, with the ad scripts removed, then relays
 * `/api/v2/stream` and the HLS playlist/segments server-side, where no browser
 * `Origin` is involved. The page and its API therefore share one origin: no
 * CORS, no ads, and the catalogue itself is untouched.
 */

const ORIGIN = "https://api.moviez.ac";
const AD_HOST =
  /(onetag|fozekikikiminu|pla\.uqload\.vc|plausible|doubleclick|googlesyndication|adservice|popads|propellerads|adnxs|criteo|exoclick|juicyads)/i;

/**
 * Playback position, reported back to the site that embeds this page: MetalFlix
 * turns it into the progress bar of "Reprendre votre visionnage". The frame is
 * cross-origin, so postMessage is the only channel — no cookies, no storage.
 * Written as a plain string so nothing here can be mistaken for a template.
 */
const TRACKER =
  // Several <video> elements exist on the page; the feature is the longest one.
  '<script>(function(){var last=-1,at=0;' +
  'function pick(){var l=document.querySelectorAll("video"),b=null;' +
  'for(var i=0;i<l.length;i++){var d=l[i].duration;' +
  'if(isFinite(d)&&d>120&&(!b||d>b.duration))b=l[i];}return b;}' +
  'function tick(){var v=pick();if(v){' +
  'var r=v.currentTime/v.duration,n=Date.now();' +
  'if(Math.abs(r-last)>0.004&&n-at>4000){last=r;at=n;try{' +
  'window.top.postMessage({source:"metalflix-player",type:"progress",path:location.pathname,' +
  'position:v.currentTime,duration:v.duration,ratio:r},"*");}catch(e){}}}' +
  'setTimeout(tick,2000);}tick();})()</script>';

/**
 * Moviez caps free playback per day and its player prints the refusal inside
 * the frame ("Utilisation journalière atteinte"). The site shows nothing about
 * that cap: the message is cleared the moment it appears, and only that one —
 * the cast and language notices of the player are left alone.
 */
const QUOTA_WATCH =
  '<script>(function(){var m=document.getElementById("msg");if(!m)return;' +
  'function clear(){var t=m.textContent||"";' +
  'if(/journali|quota/i.test(t)){m.hidden=true;m.textContent="";}}' +
  'new MutationObserver(clear).observe(m,{childList:true,characterData:true,subtree:true});' +
  'clear();})()</script>';

/**
 * Casting on iPhone.
 *
 * iOS has no Chromecast: AirPlay is the only route, and Safari only exposes it
 * through the native video chrome, which this player's own controls replace.
 * The button below calls the same picker the native control would, on the
 * longest video of the page (the feature, not a trailer or an ad reel). Videos
 * also get the AirPlay attribute spelled out, and remote playback re-enabled in
 * case the player turned it off. It stays hidden wherever the picker does not
 * exist, so desktop browsers and Android see nothing new.
 */
const AIRPLAY =
  '<script>(function(){' +
  'function pick(){var l=document.querySelectorAll("video"),b=null,bd=-1;' +
  'for(var i=0;i<l.length;i++){var v=l[i],d=isFinite(v.duration)?v.duration:0;' +
  'if(d>bd){bd=d;b=v;}}return b;}' +
  'function allow(){var v=pick();if(!v)return null;' +
  'v.setAttribute("x-webkit-airplay","allow");v.setAttribute("airplay","allow");' +
  'try{if("disableRemotePlayback" in v)v.disableRemotePlayback=false;}catch(e){}' +
  // With this left on, Safari offers an audio-only picker: sound goes out, the
  // picture stays on the phone, and no TV ever appears in the list.
  'try{if("webkitWirelessVideoPlaybackDisabled" in v)v.webkitWirelessVideoPlaybackDisabled=false;}catch(e){}' +
  'return v;}' +
  // iOS only casts to AirPlay, and its picker also lists speakers and Bluetooth
  // headsets, so tapping the button with a Chromecast around looks like the site
  // only sends sound. The sheet explains the limit and hands over the picker on
  // request instead of opening that list unasked.
  'function help(){' +
  'var p=document.createElement("div");p.id="mf-cast-help";' +
  'p.style.cssText="position:fixed;inset:0;z-index:2147483000;display:none;align-items:flex-end;' +
  'justify-content:center;padding:14px;background:rgba(0,0,0,.55)";' +
  'var c=document.createElement("div");' +
  'c.style.cssText="width:100%;max-width:440px;border-radius:16px;padding:16px 17px;' +
  'background:#0d0d10;color:#f2f2f4;font:500 13.5px/1.5 system-ui,-apple-system,sans-serif;' +
  'border:1px solid rgba(255,255,255,.14)";' +
  'var h=document.createElement("p");h.style.cssText="margin:0 0 10px;font-size:14.5px;font-weight:700";' +
  'h.textContent="Caster depuis un iPhone";' +
  'var a=document.createElement("p");a.style.cssText="margin:0 0 9px";' +
  'a.textContent="Safari ne voit pas les Chromecast : la liste ne propose que le son et les t\u00e9l\u00e9s AirPlay (Apple TV, Samsung, LG, Sony r\u00e9cents).";' +
  'var b=document.createElement("p");b.style.cssText="margin:0 0 14px";' +
  'b.textContent="Pas d\'AirPlay sur ta t\u00e9l\u00e9 (Chromecast, Android TV, Fire TV) ? Le bouton Caster de MetalFlix propose l\'app gratuite Web Video Cast, qui envoie la vid\u00e9o vers ces t\u00e9l\u00e9s.";' +
  'var row=document.createElement("div");row.style.cssText="display:flex;gap:9px";' +
  'var go=document.createElement("button");go.type="button";go.textContent="Choisir une TV AirPlay";' +
  'go.style.cssText="flex:1;padding:11px;border-radius:10px;border:0;background:#e4002b;color:#fff;font:700 13.5px system-ui,sans-serif";' +
  'var cl=document.createElement("button");cl.type="button";cl.textContent="Fermer";' +
  'cl.style.cssText="padding:11px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.2);' +
  'background:transparent;color:#f2f2f4;font:600 13.5px system-ui,sans-serif";' +
  'row.appendChild(go);row.appendChild(cl);c.appendChild(h);c.appendChild(a);c.appendChild(b);c.appendChild(row);p.appendChild(c);' +
  'cl.addEventListener("click",function(){p.style.display="none";});' +
  'p.addEventListener("click",function(e){if(e.target===p)p.style.display="none";});' +
  'go.addEventListener("click",function(){p.style.display="none";var v=allow();if(v){try{v.webkitShowPlaybackTargetPicker();}catch(e){}}});' +
  'return p;}' +
  'var sheet=help();' +
  'var available="unknown";' +
  'var btn=document.createElement("button");btn.type="button";btn.id="mf-airplay";' +
  'btn.title="Caster sur un téléviseur (AirPlay)";btn.setAttribute("aria-label","Caster sur un téléviseur");' +
  'btn.innerHTML=\'<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8V5a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v3"/><path d="M2 16v3a1 1 0 0 0 1 1h2"/><rect x="2" y="13" width="20" height="3" rx="1"/><path d="M12 12v9"/><path d="m8.5 21 3.5-4 3.5 4z"/></svg>\';' +
  'btn.style.cssText="position:fixed;top:12px;right:12px;z-index:2147483000;display:none;' +
  'place-items:center;width:42px;height:42px;padding:0;border-radius:50%;' +
  'border:1px solid rgba(255,255,255,.3);background:rgba(10,10,12,.7);color:#fff;' +
  'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);cursor:pointer";' +
  'function track(v){if(!v||v.__mfTrack)return;v.__mfTrack=1;' +
  'v.addEventListener("webkitplaybacktargetavailabilitychanged",function(e){available=e.availability||"unknown";});}' +
  'function sync(){var v=allow();track(v);' +
  'var ok=!!(v&&typeof v.webkitShowPlaybackTargetPicker==="function");' +
  'btn.style.display=ok?"grid":"none";}' +
  'btn.addEventListener("click",function(){var v=allow();if(!v)return;' +
  'if(available==="available"){try{v.webkitShowPlaybackTargetPicker();}catch(e){}return;}' +
  'sheet.style.display="flex";});' +
  // The catalogue page owns the casting sheet, but only this frame can raise the
  // AirPlay picker: it asks through postMessage (see PlayerModal.tsx).
  'window.addEventListener("message",function(e){if(e.data!=="metalflix:airplay")return;' +
  'var v=allow();if(v&&typeof v.webkitShowPlaybackTargetPicker==="function"){' +
  'try{v.webkitShowPlaybackTargetPicker();}catch(err){}}});' +
  'function mount(){if(!document.body)return setTimeout(mount,200);' +
  'document.body.appendChild(btn);document.body.appendChild(sheet);sync();setInterval(sync,1500);}' +
  'mount();})()</script>';

function cleanPage(html) {
  const cleaned = html
    // Drop every script whose tag or body touches an ad host; keep the player.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => (AD_HOST.test(tag) ? "" : tag))
    .replace(/\sdata-ts-[a-z-]+=["'][^"']*["']/gi, "")
    // Preconnects to ad hosts are pointless once the scripts are gone.
    .replace(/<link\b[^>]*href=["'][^"']*(?:onetag|fozekikikiminu|uqload)[^"']*["'][^>]*>/gi, "");

  // Added last, so the ad filter above never sees (and strips) the tracker.
  const tail = TRACKER + QUOTA_WATCH + AIRPLAY;
  if (cleaned.includes("</body>")) return cleaned.replace(/<\/body>/i, tail + "</body>");
  return cleaned + tail;
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extra,
    },
  });

/**
 * Trailer lookup.
 *
 * TMDB needs a key and refuses scrapers, so the keyless source for a trailer is
 * YouTube itself — whose results page a browser cannot read (no CORS). The
 * Worker reads it, keeps the first result that actually looks like a trailer
 * and returns its id; the site then embeds youtube-nocookie, so no YouTube
 * script ever runs on our origin.
 */
const YT_KEEP = /(bande[- ]annonce|trailer|teaser)/i;
const YT_DROP =
  /(r[ée]action|reaction|critique|review|analyse|expliqu|th[ée]orie|parodie|fan ?made|making[- ]of|interview|extrait|clip|jeu vid[ée]o)/i;
const YT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** YouTube embeds JSON inside the page; titles come back escaped. */
function unescapeJson(text) {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

async function trailer(url) {
  const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
  if (q.length < 2) return json({ id: null }, 400);

  const upstream = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=fr&gl=FR`,
    { headers: { "user-agent": YT_UA, "accept-language": "fr-FR,fr;q=0.9" } },
  );
  if (!upstream.ok) return json({ id: null, reason: `recherche ${upstream.status}` }, 502);

  const html = await upstream.text();
  const marker = /"videoRenderer":\{"videoId":"([\w-]{11})"/g;
  let match;
  let rank = 0;
  while ((match = marker.exec(html)) && rank < 12) {
    rank += 1;
    const chunk = html.slice(match.index, match.index + 2600);
    const title = unescapeJson(/"title":\{"runs":\[\{"text":"(.*?)"\}\]/.exec(chunk)?.[1] ?? "");
    if (!title || !YT_KEEP.test(title) || YT_DROP.test(title)) continue;
    const length =
      /"lengthText":\{"accessibility":\{"accessibilityData":\{"label":"(.*?)"\}\},"simpleText":"(.*?)"/.exec(
        chunk,
      )?.[2] ?? "";
    return json({ id: match[1], title, length }, 200, { "cache-control": "public, max-age=86400" });
  }

  return json({ id: null });
}

/** Shown inside the frame when Moviez really has nothing for this title. */
function offlinePage(status) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>Lecteur indisponible</title>
<style>html,body{margin:0;height:100%;background:#0b0b0d;color:#f4f4f5;font-family:Inter,system-ui,sans-serif}
.box{max-width:32rem;margin:0 auto;padding:16vh 1.5rem 2rem;text-align:center}
h1{font-size:1.35rem;margin:0 0 .75rem}p{color:#8a8a96;line-height:1.65;margin:0 0 .6rem}</style></head>
<body><div class="box"><h1>Lecteur indisponible</h1>
<p>Moviez n'a pas ouvert de flux pour ce titre (réponse ${status}).</p>
<p>Essayez une autre langue, une autre saison, ou un autre titre : le catalogue continue de fonctionner.</p>
</div></body></html>`;
}

async function playerPage(url) {
  const rest = url.pathname.replace(/^\/p\/?/, "");
  const parts = rest.split("/");
  // A series Moviez only carries as a film (and the reverse) used to land on a
  // bare "Lecteur indisponible": try the other shape before giving up.
  const routes = parts[0] === "serie" ? [rest, parts[1]] : [rest, `serie/${rest}/1/1`];

  let status = 0;
  for (const route of routes) {
    const upstream = await fetch(`${ORIGIN}/${route}${url.search}`, {
      headers: { referer: `${ORIGIN}/`, "user-agent": "MetalFlix/1.0" },
    });
    if (upstream.ok) {
      const html = cleanPage(await upstream.text());
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }
    status = upstream.status;
  }

  return new Response(offlinePage(status), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/** The page posts its token here; Moviez only answers its own origin. */
async function stream(request) {
  const body = await request.text();
  const upstream = await fetch(`${ORIGIN}/api/v2/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, referer: `${ORIGIN}/` },
    body,
  });

  const text = await upstream.text();
  // Errors go back untouched: the player page clears Moviez's daily-cap message
  // itself (QUOTA_WATCH), so the viewer never reads it.
  if (!upstream.ok) return new Response(text, { status: upstream.status, headers: { "content-type": "application/json" } });

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return new Response(text, { status: 502, headers: { "content-type": "text/plain" } });
  }

  // Playlists and segments come back through us, so the browser never has to
  // ask a CDN that may not allow this origin. The URL is absolute on purpose:
  // the Cast receiver is handed this string directly and a relative path
  // leaves it spinning on its logo forever.
  if (typeof data.hls === "string") {
    data.hls = new URL(`/hls?u=${encodeURIComponent(data.hls)}`, request.url).toString();
  }
  return json(data);
}

/**
 * One request per playback, for the site's own player.
 *
 * The site reads the token its player page embeds (that page is served with
 * `access-control-allow-origin: *`) and asks us to trade it for the signed HLS
 * URL. Moviez refuses the trade to any other origin, which is why this hop
 * exists at all; the URL itself then plays straight from their CDN, whose
 * playlists and segments allow our origin — so no segment ever comes through
 * the hosted relay, and its allowance only sees start-of-playback calls.
 */
async function moviezSource(url) {
  const token = url.searchParams.get("t");
  if (!token) return json({ error: "Jeton manquant" }, 400);

  const upstream = await fetch(`${ORIGIN}/api/v2/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, referer: `${ORIGIN}/` },
    body: JSON.stringify({ t: token }),
  });
  if (!upstream.ok) return json({ error: "Aucun flux", status: upstream.status }, upstream.status);

  let data;
  try {
    data = await upstream.json();
  } catch {
    return json({ error: "Réponse illisible" }, 502);
  }
  if (typeof data.hls !== "string") return json({ error: "Aucun flux" }, 404);

  return json({ hls: data.hls, duration: data.duration ?? null }, 200, { "cache-control": "no-store" });
}

/** Rewrite every URI inside a playlist, tags included (keys, init segments). */
function rewritePlaylist(text, base, route = "/hls", extra = "") {
  const absolute = (value) => new URL(value, base).toString();
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_, value) => `URI="${route}?u=${encodeURIComponent(absolute(value))}${extra}"`,
        );
      }
      return `${route}?u=${encodeURIComponent(absolute(trimmed))}${extra}`;
    })
    .join("\n");
}

async function hls(url, request) {
  const target = url.searchParams.get("u");
  if (!target) return new Response("Paramètre u manquant", { status: 400 });

  const headers = { referer: `${ORIGIN}/`, origin: ORIGIN };
  const range = request.headers.get("range");
  if (range) headers.range = range;

  const upstream = await fetch(target, { headers });
  const type = upstream.headers.get("content-type") || "";

  if (/mpegurl/i.test(type) || target.includes(".m3u8")) {
    const body = rewritePlaylist(await upstream.text(), target);
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": type || "application/octet-stream",
      "content-length": upstream.headers.get("content-length") || "",
      "accept-ranges": upstream.headers.get("accept-ranges") || "bytes",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}

/** Player assets (`/player2/static/…`, `/anime/static/…`) stay on our origin. */
async function asset(request, url) {
  const upstream = await fetch(`${ORIGIN}${url.pathname}${url.search}`, { headers: { referer: `${ORIGIN}/` } });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*",
    },
  });
}

/* ── Anime-Sama ───────────────────────────────────────────────────────────
 * Anime-Sama has no TMDB ids and no embed API: a season page names an
 * `episodes.js` file whose array holds one hoster URL per episode, and each
 * hoster hides the stream behind a page full of ad scripts. The resolvers
 * below pull the stream out server-side and our own page plays it, so the
 * iframe never loads an ad tag.
 */

const AS_ORIGIN = "https://anime-sama.to";
const AS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function asGet(target, referer) {
  const res = await fetch(target, {
    headers: {
      "user-agent": AS_UA,
      accept: "*/*",
      "accept-language": "fr-FR,fr;q=0.9",
      referer: referer || `${AS_ORIGIN}/`,
    },
  });
  return { status: res.status, text: await res.text() };
}

/**
 * uqload ships its player config through Dean Edwards' packer (a word table and
 * a payload full of radix-N numbers). Unpacking it is deterministic and keeps
 * the ad-laden page itself out of the browser.
 */
function unpack(source) {
  const match = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/.exec(
    source,
  );
  if (!match) return "";
  const [, raw, base, count, words] = match;
  let payload = raw.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const radix = Number(base);
  const table = words.split("|");
  for (let index = Number(count) - 1; index >= 0; index--) {
    if (!table[index]) continue;
    payload = payload.replace(new RegExp(`\\b${index.toString(radix)}\\b`, "g"), table[index]);
  }
  return payload;
}

/** One hoster page → the stream it hides (HLS or progressive MP4). */
async function resolveStream(playerUrl) {
  const page = await asGet(playerUrl, `${AS_ORIGIN}/`);
  const html = page.text;

  const hls = /https?:\/\/[^"'\s\\]+?\.m3u8[^"'\s\\]*/.exec(html);
  if (hls) return { kind: "hls", url: hls[0] };

  const decoded = unpack(html);
  if (decoded) {
    const file =
      /file\s*:\s*["']([^"']+)["']/.exec(decoded) || /src\s*:\s*["']([^"']+\.(?:mp4|m3u8)[^"']*)["']/.exec(decoded);
    if (file) return { kind: /\.m3u8/.test(file[1]) ? "hls" : "mp4", url: file[1] };
  }

  const sibnet = /(\/v\/[^"'\s]+\.mp4)/.exec(html);
  if (sibnet) return { kind: "mp4", url: `https://video.sibnet.ru${sibnet[1]}` };

  const og = /property=["']og:video["'][^>]*content=["']([^"']+)["']/.exec(html);
  if (og) return { kind: "mp4", url: og[1] };

  return null;
}

function asPlayerPage({ title, stream, referer, error }) {
  const src = stream ? `/as/hls?u=${encodeURIComponent(stream.url)}&r=${encodeURIComponent(referer)}` : "";
  const player = !stream
    ? `<p class="err">${error || "Source indisponible."}</p>`
    : stream.kind === "hls"
      ? `<video id="v" controls playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script>
<script>(function(){var v=document.getElementById("v"),u=${JSON.stringify(src)};
if(v.canPlayType("application/vnd.apple.mpegurl")){v.src=u;v.play().catch(function(){});return;}
if(window.Hls){var h=new window.Hls();h.loadSource(u);h.attachMedia(v);
h.on(window.Hls.Events.MANIFEST_PARSED,function(){v.play().catch(function(){});});
h.on(window.Hls.Events.ERROR,function(e,d){if(d.fatal){document.getElementById("note").textContent="Flux interrompu ("+d.details+").";}});}
else{document.getElementById("note").textContent="Ce navigateur ne lit pas le HLS.";}})();</script>`
      : `<video id="v" controls playsinline autoplay src="${src}"></video>`;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>html,body{margin:0;height:100%;background:#08090b;color:#f3f4f6;font-family:system-ui,sans-serif}
video{display:block;width:100%;height:100%;background:#000;object-fit:contain}
.err,.note{display:block;text-align:center;color:#9aa1ad;font-size:14px;line-height:1.6;padding:24px 20px;margin:0}
.err{padding-top:30vh}</style></head><body>${player}<p class="note" id="note"></p>
<script>(function(){var n=document.getElementById("note"),v=document.getElementById("v");
if(!v)return;var t=setTimeout(function(){n.textContent="Le flux ne démarre pas : cette source est indisponible pour cet épisode.";},18000);
function ok(){clearTimeout(t);}v.addEventListener("loadeddata",ok);v.addEventListener("canplay",ok);})();</script>
${TRACKER}</body></html>`;
}

/** Every episode file the season page references (one per hoster group). */
function episodeFiles(html, seasonUrl) {
  const found = new Set();
  for (const [, file] of html.matchAll(/["']([^"']*(?:episodes|eps)[0-9]*\.js[^"']*)["']/g)) {
    found.add(new URL(file, seasonUrl).toString());
  }
  return [...found];
}

/**
 * `episodes.js` holds one array per player (`var eps1 = [...]`, `eps2 = [...]`),
 * each with the same episode count and a different hoster. Reading every array
 * is what makes a fallback possible when one hoster refuses to serve.
 */
function episodeGroups(text) {
  const groups = [];
  for (const [, body] of text.matchAll(/(?:var|let|const)\s+\w+\s*=\s*\[([\s\S]*?)\]/g)) {
    const urls = [...body.matchAll(/['"](https?:\/\/[^'"]+)['"]/g)].map((match) => match[1]);
    if (urls.length) groups.push(urls);
  }
  if (groups.length) return groups;
  const loose = [...text.matchAll(/['"](https?:\/\/[^'"]+)['"]/g)].map((match) => match[1]);
  return loose.length ? [loose] : [];
}

/**
 * Some CDNs sign their segments to the IP that opened the page (ansembed does):
 * the playlist loads, then every segment answers 403 and the player spins
 * forever. Reading one segment up front tells us whether a source is usable.
 */
async function sourceWorks(stream, referer) {
  const headers = { "user-agent": AS_UA, referer };
  try {
    if (stream.kind === "mp4") {
      const res = await fetch(stream.url, { headers: { ...headers, range: "bytes=0-1023" } });
      return res.status >= 200 && res.status < 400;
    }
    const master = await fetch(stream.url, { headers });
    if (!master.ok) return false;
    const manifest = await master.text();
    if (!manifest.includes("#EXTM3U")) return false;
    const variantUrl = manifest
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (!variantUrl) return false;

    const variant = await fetch(new URL(variantUrl, stream.url).toString(), { headers });
    if (!variant.ok) return false;
    const segmentUrl = (await variant.text())
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (!segmentUrl) return false;

    const segment = await fetch(new URL(segmentUrl, variantUrl).toString(), {
      headers: { ...headers, range: "bytes=0-1023" },
    });
    return segment.ok;
  } catch {
    return false;
  }
}

/** Seasons and their versions (vostfr / vf) for one Anime-Sama slug. */
async function asInfo(url) {
  const slug = url.searchParams.get("slug");
  if (!slug) return json({ error: "Paramètre slug manquant" }, 400);
  const page = await asGet(`${AS_ORIGIN}/catalogue/${encodeURIComponent(slug)}/`);
  if (page.status !== 200) return json({ error: `Anime-Sama a répondu ${page.status}` }, 502);

  // Links are relative on some pages (`saison1/vostfr`) and absolute on
  // others; scans share the same shape and must not be listed as seasons.
  const pattern = /(?:^|["'/])(saison[0-9]+|film[0-9]*|oav[0-9]*|episode[0-9]*)\/(vostfr|vf)/gi;
  const seasons = [];
  const seen = new Map();
  for (const [, saison, version] of page.text.matchAll(pattern)) {
    if (!seen.has(saison)) {
      seen.set(saison, []);
      seasons.push({ saison, versions: seen.get(saison) });
    }
    if (!seen.get(saison).includes(version)) seen.get(saison).push(version);
  }
  return json({ slug, seasons });
}

/** Our own player page for one episode, with the stream resolved up front. */
async function asPlayer(url) {
  const parts = url.pathname.replace(/^\/as\/p\/?/, "").split("/").filter(Boolean);
  const [slug, saison = "saison1", version = "vostfr", rawEpisode = "1"] = parts;
  const episode = Math.max(1, Number(rawEpisode) || 1);
  const htmlError = (message) =>
    new Response(asPlayerPage({ title: slug, error: message }), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });

  if (!slug) return htmlError("Lien incomplet.");
  const seasonUrl = `${AS_ORIGIN}/catalogue/${slug}/${saison}/${version}/`;
  const page = await asGet(seasonUrl);
  if (page.status !== 200) return htmlError(`Anime-Sama a répondu ${page.status}.`);

  const files = episodeFiles(page.text, seasonUrl);
  if (!files.length) return htmlError("Aucune liste d'épisodes pour cette saison.");

  // One player per file: resolve them all, then keep the first whose segments
  // actually answer, so a signed/broken hoster cannot hang the player.
  const candidates = [];
  for (const file of files) {
    const episodes = await asGet(file, seasonUrl);
    for (const group of episodeGroups(episodes.text)) {
      const link = group[episode - 1];
      if (link && !candidates.includes(link)) candidates.push(link);
    }
  }
  if (!candidates.length) return htmlError(`Épisode ${episode} introuvable.`);

  // Try the hosters that answer datacenter requests first: ansembed signs its
  // segments to the viewer's address and refuses ours, but the same episode is
  // nearly always mirrored on uqload or sendvid.
  const rank = (playerUrl) => {
    const host = new URL(playerUrl).host;
    if (host.includes("uqload")) return 0;
    if (host.includes("sendvid")) return 1;
    if (host.includes("sibnet")) return 2;
    if (host.includes("ansembed")) return 9;
    return 5;
  };
  candidates.sort((a, b) => rank(a) - rank(b));

  const rejected = [];
  let chosen = null;
  for (const playerUrl of candidates) {
    const stream = await resolveStream(playerUrl);
    const referer = `${new URL(playerUrl).origin}/`;
    if (!stream) {
      rejected.push(new URL(playerUrl).host);
      continue;
    }
    if (await sourceWorks(stream, referer)) {
      chosen = { stream, referer };
      break;
    }
    rejected.push(`${new URL(playerUrl).host} (segments refusés)`);
  }

  if (!chosen) {
    return htmlError(
      `Aucune source lisible pour cet épisode. Sources refusées : ${rejected.join(", ") || "inconnues"}.`,
    );
  }

  return new Response(
    asPlayerPage({
      title: `${slug} · ${saison} · ${version} · épisode ${episode}`,
      stream: chosen.stream,
      referer: chosen.referer,
    }),
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

/** Stream proxy: playlists are rewritten, segments relayed, referer forwarded. */
async function asMedia(url, request) {
  const target = url.searchParams.get("u");
  if (!target) return new Response("Paramètre u manquant", { status: 400 });
  const referer = url.searchParams.get("r") || `${AS_ORIGIN}/`;
  const headers = { "user-agent": AS_UA, referer };
  const range = request.headers.get("range");
  if (range) headers.range = range;

  const upstream = await fetch(target, { headers });
  const type = upstream.headers.get("content-type") || "";

  if (/mpegurl/i.test(type) || target.includes(".m3u8")) {
    const extra = `&r=${encodeURIComponent(referer)}`;
    const body = rewritePlaylist(await upstream.text(), target, "/as/hls", extra);
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": type || "application/octet-stream",
      "content-length": upstream.headers.get("content-length") || "",
      "accept-ranges": upstream.headers.get("accept-ranges") || "bytes",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, range",
        },
      });
    }

if (path.startsWith("/p/")) return playerPage(url);
    if (path === "/yt") return trailer(url);
    if (path === "/as/info") return asInfo(url);
    if (path.startsWith("/as/p/")) return asPlayer(url);
    if (path === "/as/hls") return asMedia(url, request);
    if (path === "/api/v2/stream") return stream(request);
    if (path === "/mz") return moviezSource(url);
    if (path === "/hls") return hls(url, request);
    if (path.startsWith("/player2/") || path.startsWith("/anime/") || path.startsWith("/static/")) {
      return asset(request, url);
    }
    if (path === "/" || path === "/health") return json({ ok: true, service: "metalflix-player" });

    return new Response("Introuvable", { status: 404 });
  },
};
