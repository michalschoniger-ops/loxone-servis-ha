/* global self, caches, fetch, Request, Response, URL */
const CACHE_NAME = "evora-smart-hub-shell-v3.0.49";
const scopeUrl = new URL(self.registration.scope);

function relativePath(url) {
  const value = new URL(url);
  if (value.origin !== scopeUrl.origin || !value.pathname.startsWith(scopeUrl.pathname)) return null;
  return value.pathname.slice(scopeUrl.pathname.length);
}

function isPrivateRequest(request) {
  const path = relativePath(request.url);
  return path === null || path === "healthz" || path.startsWith("api/");
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const rootRequest = new Request(self.registration.scope, { cache: "reload" });
  const response = await fetch(rootRequest);
  if (!response.ok) throw new Error("App shell is unavailable");
  await cache.put(rootRequest, response.clone());
  const html = await response.text();
  const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], scopeUrl))
    .filter((url) => url.origin === scopeUrl.origin && url.pathname.startsWith(scopeUrl.pathname));
  assetUrls.push(new URL("evora-hub-mark.svg", scopeUrl));
  await Promise.all(assetUrls.map((url) => cache.add(new Request(url, { cache: "reload" }))));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await cacheAppShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("evora-smart-hub-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || isPrivateRequest(request)) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(new Request(self.registration.scope), response.clone());
      }
      return response;
    }).catch(async () => (await caches.match(new Request(self.registration.scope))) || Response.error()));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })));
});
