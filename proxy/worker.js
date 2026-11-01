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

function cleanPage(html) {
  return html
    // Drop every script whose tag or body touches an ad host; keep the player.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => (AD_HOST.test(tag) ? "" : tag))
    .replace(/\sdata-ts-[a-z-]+=["'][^"']*["']/gi, "")
    // Preconnects to ad hosts are pointless once the scripts are gone.
    .replace(/<link\b[^>]*href=["'][^"']*(?:onetag|fozekikikiminu|uqload)[^"']*["'][^>]*>/gi, "");
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });

async function playerPage(url) {
  const rest = url.pathname.replace(/^\/p\/?/, "");
  const upstream = await fetch(`${ORIGIN}/${rest}${url.search}`, {
    headers: { referer: `${ORIGIN}/`, "user-agent": "MetalFlix/1.0" },
  });
  if (!upstream.ok) return new Response("Lecteur indisponible", { status: upstream.status });

  const html = cleanPage(await upstream.text());
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
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
  if (!upstream.ok) return new Response(text, { status: upstream.status, headers: { "content-type": "application/json" } });

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return new Response(text, { status: 502, headers: { "content-type": "text/plain" } });
  }

  // Playlists and segments come back through us, so the browser never has to
  // ask a CDN that may not allow this origin.
  if (typeof data.hls === "string") data.hls = `/hls?u=${encodeURIComponent(data.hls)}`;
  return json(data);
}

/** Rewrite every URI inside a playlist, tags included (keys, init segments). */
function rewritePlaylist(text, base) {
  const absolute = (value) => new URL(value, base).toString();
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, value) => `URI="/hls?u=${encodeURIComponent(absolute(value))}"`);
      }
      return `/hls?u=${encodeURIComponent(absolute(trimmed))}`;
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
    if (path === "/api/v2/stream") return stream(request);
    if (path === "/hls") return hls(url, request);
    if (path.startsWith("/player2/") || path.startsWith("/anime/") || path.startsWith("/static/")) {
      return asset(request, url);
    }
    if (path === "/" || path === "/health") return json({ ok: true, service: "metalflix-player" });

    return new Response("Introuvable", { status: 404 });
  },
};
