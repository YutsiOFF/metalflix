var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var ORIGIN = "https://api.moviez.ac";
var AD_HOST = /(onetag|fozekikikiminu|pla\.uqload\.vc|plausible|doubleclick|googlesyndication|adservice|popads|propellerads|adnxs|criteo|exoclick|juicyads)/i;
function cleanPage(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => AD_HOST.test(tag) ? "" : tag).replace(/\sdata-ts-[a-z-]+=["'][^"']*["']/gi, "").replace(/<link\b[^>]*href=["'][^"']*(?:onetag|fozekikikiminu|uqload)[^"']*["'][^>]*>/gi, "");
}
__name(cleanPage, "cleanPage");
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }
}), "json");
async function playerPage(url) {
  const rest = url.pathname.replace(/^\/p\/?/, "");
  const upstream = await fetch(`${ORIGIN}/${rest}${url.search}`, {
    headers: { referer: `${ORIGIN}/`, "user-agent": "MetalFlix/1.0" }
  });
  if (!upstream.ok) return new Response("Lecteur indisponible", { status: upstream.status });
  const html = cleanPage(await upstream.text());
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer"
    }
  });
}
__name(playerPage, "playerPage");
async function stream(request) {
  const body = await request.text();
  const upstream = await fetch(`${ORIGIN}/api/v2/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, referer: `${ORIGIN}/` },
    body
  });
  const text = await upstream.text();
  if (!upstream.ok) return new Response(text, { status: upstream.status, headers: { "content-type": "application/json" } });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return new Response(text, { status: 502, headers: { "content-type": "text/plain" } });
  }
  if (typeof data.hls === "string") data.hls = `/hls?u=${encodeURIComponent(data.hls)}`;
  return json(data);
}
__name(stream, "stream");
function rewritePlaylist(text, base) {
  const absolute = /* @__PURE__ */ __name((value) => new URL(value, base).toString(), "absolute");
  return text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_, value) => `URI="/hls?u=${encodeURIComponent(absolute(value))}"`);
    }
    return `/hls?u=${encodeURIComponent(absolute(trimmed))}`;
  }).join("\n");
}
__name(rewritePlaylist, "rewritePlaylist");
async function hls(url, request) {
  const target = url.searchParams.get("u");
  if (!target) return new Response("Param\xE8tre u manquant", { status: 400 });
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
        "access-control-allow-origin": "*"
      }
    });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": type || "application/octet-stream",
      "content-length": upstream.headers.get("content-length") || "",
      "accept-ranges": upstream.headers.get("accept-ranges") || "bytes",
      "cache-control": "public, max-age=3600",
      "access-control-allow-origin": "*"
    }
  });
}
__name(hls, "hls");
async function asset(request, url) {
  const upstream = await fetch(`${ORIGIN}${url.pathname}${url.search}`, { headers: { referer: `${ORIGIN}/` } });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*"
    }
  });
}
__name(asset, "asset");
var worker_default = {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, range"
        }
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
  }
};

// ../../../AppData/Local/npm-cache/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Local/npm-cache/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-N3fAFf/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../AppData/Local/npm-cache/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-N3fAFf/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
