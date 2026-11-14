// MetalFlix service worker.
//
// It exists for two reasons: a browser only offers "install to home screen"
// when a service worker with a fetch handler is registered, and the app shell
// should still open when the phone loses its connection.
//
// Only our own origin is touched: posters (image.tmdb.org), the Moviez API, the
// Wikipedia lookups and the player frames all go straight to the network, so
// they are never served stale.
const CACHE = "metalflix-v1";
const SHELL = ["./", "./index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A navigation goes to the network first: the catalogue changes often, and a
  // stale shell would hide a new build. Offline, the cached shell takes over.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html").then((hit) => hit ?? caches.match("./"))),
    );
    return;
  }

  // Build assets carry a content hash in their name, so a cached copy is
  // always the right one.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.includes("/assets/")) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
